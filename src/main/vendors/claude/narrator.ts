// The narrator's requests on Claude Code (worfy-product-session ticket 32): one line of what a Product Session's
// advisor is doing, from Haiku (src/main/agent/narrator.ts decides when to ask and what to send).
//
// Each request is a cold query() of the Agent SDK under the user's own Claude Code login, the same path the
// Sessions take, never an API key: the agent environment without API_KEY_VARS. Its options (narratorOptions, a
// pure function, so a unit test reads exactly what goes to the SDK) are those of Terminal AI's spare process
// (terminal-ai.ts, ADR-0058): no settings of the user or a Project, no MCP servers, no tools, one turn, no
// transcript, no thinking — and Haiku 4.5 by its id (HAIKU_WITHOUT_THINKING: the alias haiku now takes thinking-off
// as adaptive thinking, which would spend the short output limit). The narrator is not a Session, so it is not bound by
// isSelectableModel (Sessions never run on haiku). Its folder is the empty <WORFY_DATA_DIR>/narrator, outside
// every Project, so no Node is ever made for it. CLAUDE_CODE_MAX_OUTPUT_TOKENS keeps the answer short.
//
// Under WORFY_AGENT=fake the requests go to the fake agent (src/main/agent/fake-query.ts), which plays
// test/fixtures/agent-scripts/<WORFY_NARRATOR_SCRIPT or "narrator">.jsonl; WORFY_NARRATOR_FIRST_MS and
// WORFY_NARRATOR_EVERY_MS shorten the cadence then, so an e2e run need not wait 20 s. Neither is read otherwise.
//
// The SDK and the app are loaded at the first real request.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_SETTINGS } from '../../../shared/agent/settings'
import { API_KEY_VARS, withoutApiKeys, type Env } from '../../agent/env'
import { FakeReleases, fakeQueryFactory } from '../../agent/fake-query'
import { NARRATOR_SYSTEM_PROMPT, type NarratorAsk, type NarratorCadence } from '../../agent/narrator'
import type { QueryFactory } from '../../agent/session'
import { oneMessage } from './one-shot'
import { claudeExecutablePath, type RuntimeInfo } from './options'
import { HAIKU_WITHOUT_THINKING } from './terminal-ai'

/** The model of every request: the narrator is not a Session (see the head of this file). */
export const NARRATOR_MODEL = HAIKU_WITHOUT_THINKING
/** The folder every request runs in, under worfy's data folder: empty, worfy's own, outside every Project. */
export const NARRATOR_DIR = 'narrator'
export const narratorDir = (dataDir: string): string => join(dataDir, NARRATOR_DIR)
/** The most the answer may take, in tokens: one line needs far fewer. */
export const NARRATOR_MAX_OUTPUT_TOKENS = 256

export interface NarratorOptionsInput {
  /** The agent environment (agentEnv()); its API keys are dropped again here. */
  env: Readonly<Env>
  runtime: RuntimeInfo
  cwd: string
  stderr?: ((data: string) => void) | undefined
}

/** What one request of the narrator starts Claude Code with. */
export function narratorOptions(input: NarratorOptionsInput): Options {
  const env = withoutApiKeys(input.env)
  for (const key of API_KEY_VARS) delete env[key]
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(NARRATOR_MAX_OUTPUT_TOKENS)
  const executable = claudeExecutablePath(input.runtime)
  return {
    cwd: input.cwd,
    model: NARRATOR_MODEL,
    thinking: { type: 'disabled' },
    settingSources: [],
    mcpServers: {},
    strictMcpConfig: true,
    tools: [],
    permissionMode: 'dontAsk',
    maxTurns: 1,
    persistSession: false,
    systemPrompt: NARRATOR_SYSTEM_PROMPT,
    env,
    ...(executable === undefined ? {} : { pathToClaudeCodeExecutable: executable }),
    ...(input.stderr === undefined ? {} : { stderr: input.stderr }),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const stopped = (): Error => new Error('the request was stopped')

/**
 * The narrator's request over `start`: the digest as the one user message, no tool allowed, the text of the
 * turn's `result` as the answer. Rejects when the result is an error or never comes, and when `signal` stops it;
 * the query is closed in every case.
 */
export const narratorAskOver =
  (start: QueryFactory, cwd: string): NarratorAsk =>
  async (digest, signal) => {
    if (signal.aborted) throw stopped()
    const stderr: string[] = []
    const query = await start({
      prompt: oneMessage(digest),
      cwd,
      resume: undefined,
      stderr: (data) => stderr.push(data),
      settings: { ...DEFAULT_SETTINGS, model: NARRATOR_MODEL },
      canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'The narrator uses no tools.' }),
      unattended: false,
    })
    const close = (): void => query.close()
    if (signal.aborted) {
      close()
      throw stopped()
    }
    signal.addEventListener('abort', close, { once: true })
    try {
      for await (const message of query) {
        if (signal.aborted) break
        if (!isRecord(message) || message.type !== 'result') continue
        if (message.subtype === 'success' && message.is_error !== true && typeof message.result === 'string') return message.result
        const errors = Array.isArray(message.errors) ? `: ${message.errors.map(String).join('; ')}` : ''
        throw new Error(`no line from ${NARRATOR_MODEL} (${String(message.subtype)}${errors})`)
      }
      if (signal.aborted) throw stopped()
      const said = stderr.join('').trim().split('\n').at(-1)
      throw new Error(`Claude Code ended before the line${said ? `: ${said}` : ''}`)
    } finally {
      signal.removeEventListener('abort', close)
      close()
    }
  }

/** Claude Code of one narrator request, through the Agent SDK, in a folder made at the call. */
export const claudeNarratorQuery: QueryFactory = async (request) => {
  const [{ query }, { app }, { agentEnv }] = await Promise.all([import('@anthropic-ai/claude-agent-sdk'), import('electron'), import('../../agent/env')])
  mkdirSync(request.cwd, { recursive: true })
  const options = narratorOptions({
    env: (await agentEnv()).env,
    runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch },
    cwd: request.cwd,
    stderr: request.stderr,
  })
  return query({ prompt: request.prompt, options }) as unknown as Awaited<ReturnType<QueryFactory>>
}

/** A positive whole number of ms from `value`, else undefined. */
function msOf(value: string | undefined): number | undefined {
  const ms = value === undefined ? Number.NaN : Number(value)
  return Number.isInteger(ms) && ms > 0 ? ms : undefined
}

/**
 * The narrator's requests and cadence for the app: Haiku through the SDK, or under WORFY_AGENT=fake the fake
 * agent with the script WORFY_NARRATOR_SCRIPT (default `narrator`) and the cadence of the WORFY_NARRATOR_* variables.
 * The fake agent of the narrator has its own `wait_release` names, so it never takes the Sessions' release hook.
 */
export function narratorFromEnv(dataDir: string, appPath: string, env: NodeJS.ProcessEnv = process.env): { ask: NarratorAsk; cadence: Partial<NarratorCadence> } {
  const cwd = narratorDir(dataDir)
  if (env.WORFY_AGENT !== 'fake') return { ask: narratorAskOver(claudeNarratorQuery, cwd), cadence: {} }
  const log = env.WORFY_AGENT_LOG
  const fake = fakeQueryFactory({
    scriptsDir: env.WORFY_AGENT_SCRIPTS ?? join(appPath, 'test', 'fixtures', 'agent-scripts'),
    script: env.WORFY_NARRATOR_SCRIPT ?? 'narrator',
    record: log ? (call) => appendFileSync(log, `${JSON.stringify({ narrator: true, ...call })}\n`) : undefined,
    releases: new FakeReleases(),
  })
  const firstMs = msOf(env.WORFY_NARRATOR_FIRST_MS)
  const everyMs = msOf(env.WORFY_NARRATOR_EVERY_MS)
  return { ask: narratorAskOver(fake, cwd), cadence: { ...(firstMs === undefined ? {} : { firstMs }), ...(everyMs === undefined ? {} : { everyMs }) } }
}
