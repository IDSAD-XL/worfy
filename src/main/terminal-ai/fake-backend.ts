// The fake assist process (WORFY_AGENT=fake, ADR-0058, "Последствия"): tests and e2e runs never
// start Claude Code for Terminal AI and never spend the subscription. With it the service does not
// import the Agent SDK at all (backendFromEnv, src/main/terminal-ai/assist.ts).
//
// Answers come from the JSON file WORFY_TERMINAL_AI_ANSWERS, read anew on every request: an array of
//
//   {"feature": "suggest",            the feature it answers; any feature when absent
//    "match": "git st",               a substring of the input line or of the request words; any when absent
//    "answer": "git status",          the model's text, as the model would write it (backticks and all)
//    "delayMs": 300,                  how long the "model" takes; 0 when absent
//    "thinking": true,                the stream starts with a thinking block
//    "rateLimit": {"status": "allowed", "rateLimitType": "five_hour", "utilization": 0.4, "resetsAt": 1791202800}}
//                                     a rate_limit_event before the answer, as Claude Code sends one per process
//
// The first entry that matches answers; with none the answer is empty. Every request appends one
// JSON line to WORFY_TERMINAL_AI_LOG when it ends: the feature, the model, the context after
// redaction, whether it was cancelled (closed before its answer) and whether it was the cold retry
// through query().
import { appendFileSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import type { ClaimOptions, Options } from '@anthropic-ai/claude-agent-sdk'
import { TERMINAL_AI_FEATURES } from '../../shared/terminal-ai/settings'
import type { AssistBackend, AssistMeta, AssistQuery, AssistSpare } from './assist'

export const fakeAnswerSchema = z.object({
  feature: z.enum(TERMINAL_AI_FEATURES).optional(),
  match: z.string().optional(),
  answer: z.string(),
  delayMs: z.number().nonnegative().optional(),
  thinking: z.boolean().optional(),
  rateLimit: z
    .object({
      status: z.string(),
      rateLimitType: z.string().optional(),
      utilization: z.number().optional(),
      resetsAt: z.number().optional(),
    })
    .optional(),
})
export type FakeAnswer = z.infer<typeof fakeAnswerSchema>

/** One line of WORFY_TERMINAL_AI_LOG. */
export interface FakeLogEntry {
  feature: AssistMeta['feature']
  model: string | null
  context: AssistMeta['context']
  cancelled: boolean
  cold: boolean
}

export interface FakeBackendOptions {
  /** WORFY_TERMINAL_AI_ANSWERS; no file — every answer is empty. */
  answersFile?: string | undefined
  /** WORFY_TERMINAL_AI_LOG; no file — nothing is written. */
  logFile?: string | undefined
}

function readAnswers(file: string | undefined): FakeAnswer[] {
  if (file === undefined || file === '') return []
  try {
    return z.array(fakeAnswerSchema).parse(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    console.warn(`[terminal-ai] fake: cannot read the answers file ${file}: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

function answerFor(answers: readonly FakeAnswer[], meta: AssistMeta): FakeAnswer | undefined {
  const { line, request } = meta.context
  return answers.find((entry) => {
    if (entry.feature !== undefined && entry.feature !== meta.feature) return false
    if (entry.match === undefined) return true
    return line.includes(entry.match) || (request ?? '').includes(entry.match)
  })
}

let fakeSession = 0

/** One fake request: the messages Claude Code would stream, ending early on close(). */
function fakeRun(model: string | null, meta: AssistMeta, cold: boolean, options: FakeBackendOptions): AssistQuery {
  const entry = answerFor(readAnswers(options.answersFile), meta)
  const sessionId = `fake-terminal-ai-${++fakeSession}`
  let closed = false
  let logged = false
  let wake: (() => void) | null = null

  const log = (cancelled: boolean): void => {
    if (logged) return
    logged = true
    if (options.logFile === undefined || options.logFile === '') return
    const line: FakeLogEntry = { feature: meta.feature, model, context: meta.context, cancelled, cold }
    appendFileSync(options.logFile, `${JSON.stringify(line)}\n`)
  }

  async function* messages(): AsyncGenerator<unknown, void> {
    try {
      yield { type: 'system', subtype: 'init', claude_code_version: 'fake', apiKeySource: 'none', model: model ?? 'default', plugins: [], session_id: sessionId }
      if (entry?.rateLimit !== undefined) {
        const { status, rateLimitType, utilization, resetsAt } = entry.rateLimit
        yield { type: 'rate_limit_event', rate_limit_info: { status, rateLimitType, utilization, resetsAt }, session_id: sessionId }
      }
      if (entry?.thinking === true) {
        yield { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, session_id: sessionId }
      }
      const delay = entry?.delayMs ?? 0
      if (delay > 0 && !closed) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay)
          wake = () => {
            clearTimeout(timer)
            resolve()
          }
        })
      }
      if (closed) return
      const text = entry?.answer ?? ''
      yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, session_id: sessionId }
      // The answer is out: a close() from now on is the service letting the process go, not a cancel.
      log(false)
      yield { type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId }
    } finally {
      log(closed)
    }
  }

  const generator = messages()
  return {
    [Symbol.asyncIterator]: () => generator,
    close() {
      if (closed) return
      closed = true
      log(true)
      wake?.()
    },
  }
}

/** The fake backend over an answers file and a log file. */
export function fakeAssistBackend(options: FakeBackendOptions): AssistBackend {
  return {
    async prewarm(): Promise<AssistSpare> {
      let exit: () => void = () => undefined
      const exited = new Promise<void>((resolve) => (exit = resolve))
      let run: AssistQuery | null = null
      return {
        claimed: Promise.resolve({ cwd: '', sessionId: '' }),
        exited,
        claim(params: { prompt: string; options: ClaimOptions }, meta: AssistMeta): AssistQuery {
          run = fakeRun(params.options.model ?? null, meta, false, options)
          return run
        },
        close() {
          run?.close()
          exit()
        },
      }
    },
    query(params: { prompt: string; options: Options }, meta: AssistMeta): AssistQuery {
      return fakeRun(params.options.model ?? null, meta, true, options)
    },
  }
}
