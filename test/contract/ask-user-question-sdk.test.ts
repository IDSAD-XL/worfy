// How the real Claude Code handles AskUserQuestion when worfy answers it (worfy-ui ticket 17): the
// Agent SDK's own binary runs against a local stand-in of the Messages API
// (messages-api-stand-in.ts) — no model is called, nothing is written under the real ~/.claude —
// and worfy's PermissionGate is its canUseTool. The scripted "model" asks; the test answers through
// the gate as the Session view would; the stand-in records what Claude Code told the model.
//
// The fake agent (src/main/agent/fake-query.ts, the `question` directive) copies what these tests
// pin down, so the tests on the fake agent are only as true as these.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { questionResultText } from '../../src/main/agent/fake-query'
import { PermissionGate, QUESTION_DECLINED_MESSAGE, type PermissionAnswer } from '../../src/main/agent/permissions'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { QuestionPick } from '../../src/shared/agent/questions'
import { claudeEnv, startMessagesApiStandIn, type RecordedToolResult } from './messages-api-stand-in'

type QuestionRequest = Extract<AgentEvent, { type: 'question_request' }>

const COLOUR = { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue', description: 'cold' }] }
const SIZE = { question: 'Which size?', header: 'Size', multiSelect: false, options: [{ label: 'S', description: 'small' }, { label: 'L', description: 'large' }] }
const FRUITS = {
  question: 'Which fruits?',
  header: 'Fruits',
  multiSelect: true,
  options: [{ label: 'Apple', description: 'a' }, { label: 'Pear', description: 'p' }, { label: 'Plum', description: 'pl' }],
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/** What Claude Code told the model, without the system reminder it appends. */
const said = (result: RecordedToolResult | null): string => (typeof result?.content === 'string' ? result.content.split('\n\n<system-reminder>')[0]! : JSON.stringify(result?.content))

/**
 * Runs one turn of the real Claude Code in `mode` whose model asks `questions`; `respond` answers the
 * gate's question request. Answers the events the gate sent and the tool's result.
 */
async function ask(mode: 'default' | 'acceptEdits' | 'bypassPermissions', questions: unknown[], respond: (gate: PermissionGate, request: QuestionRequest) => void) {
  const standIn = await startMessagesApiStandIn({ id: 'toolu_question_1', name: 'AskUserQuestion', input: { questions } })
  const home = await mkdtemp(join(tmpdir(), 'worfy-ask-home-'))
  const cwd = await mkdtemp(join(tmpdir(), 'worfy-ask-cwd-'))
  cleanups.push(async () => {
    await standIn.close()
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const events: AgentEvent[] = []
  const gate: PermissionGate = new PermissionGate(
    (event) => {
      events.push(event)
      if (event.type === 'question_request') queueMicrotask(() => respond(gate, event))
    },
    () => undefined,
  )
  const stderr: string[] = []
  const given: PermissionAnswer[] = []
  const run = query({
    prompt: 'Ask me.',
    options: {
      cwd,
      env: claudeEnv(standIn, home),
      permissionMode: mode,
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      model: 'claude-sonnet-4-5',
      canUseTool: async (toolName, input, options) => {
        const answer = await gate.canUseTool(toolName, input, options)
        given.push(answer)
        return answer
      },
      stderr: (data) => stderr.push(data),
    },
  })
  for await (const message of run) if (message.type === 'result') break
  run.close()
  expect(standIn.offered(), `the model was not offered AskUserQuestion; stderr: ${stderr.join('')}`).toBe(true)
  const result = standIn.toolResult()
  // The fake agent says to the model what this Claude Code said.
  expect(given).toHaveLength(1)
  if (given[0]?.behavior === 'allow') expect(questionResultText({ questions }, given[0])).toBe(said(result))
  return { events, result }
}

const pick = (selected: string[], other: string | null = null): QuestionPick => ({ selected, other })

describe('the real Claude Code asks through canUseTool, and reads the answers worfy gives', () => {
  it('in bypassPermissions (a new Session\'s mode) too: a question request, not a permission request; one option', async () => {
    const { events, result } = await ask('bypassPermissions', [COLOUR], (gate, request) => gate.answerQuestion(request.requestId, [pick(['Blue'])]))
    expect(events.map((event) => event.type)).toEqual(['question_request', 'question_resolved'])
    expect(events[0]).toMatchObject({ toolUseId: 'toolu_question_1', questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false }] })
    expect(events[1]).toMatchObject({ outcome: 'answered', answers: { 'Which colour?': 'Blue' } })
    expect(said(result)).toBe('Your questions have been answered: "Which colour?"="Blue". You can now continue with these answers in mind.')
    expect(result?.is_error).toBeUndefined()
  })

  it('in default mode: multiSelect labels joined by ", " read as picked options', async () => {
    const { result } = await ask('default', [FRUITS], (gate, request) => gate.answerQuestion(request.requestId, [pick(['Plum', 'Apple'])]))
    expect(said(result)).toBe('Your questions have been answered: "Which fruits?"="Apple, Plum". You can now continue with these answers in mind.')
  })

  it('in acceptEdits: "Other" text reaches the model as the user\'s own words; two questions in one call', async () => {
    const { result } = await ask('acceptEdits', [COLOUR, SIZE], (gate, request) => gate.answerQuestion(request.requestId, [pick(['Red']), pick([], 'Huge, please')]))
    expect(said(result)).toBe(
      'The user answered: "Which colour?"="Red", "Which size?"="Huge, please". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
    )
  })

  it('"Decline" is a refusal the model reads as the tool\'s error', async () => {
    const { events, result } = await ask('bypassPermissions', [COLOUR], (gate, request) => gate.answerQuestion(request.requestId, null))
    expect(events[1]).toMatchObject({ type: 'question_resolved', outcome: 'declined', answers: {} })
    expect(said(result)).toBe(QUESTION_DECLINED_MESSAGE)
    expect(result?.is_error).toBe(true)
  })
})
