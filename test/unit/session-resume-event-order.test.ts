// worfy-polish ticket 123: the order of the events main sends for a Session started again with `resume`
// (the Orchestrator Autopilot gives back), recorded on the real Session (src/main/agent/session.ts) with
// the fake agent. The new Session is `pending-…` until the first system/init of its process: the user's
// message goes out as a `prompt` under that id, and `renamed` brings the Session back to its SDK session's
// id before anything else comes under it. test/unit/session-prompt-after-restart.test.tsx gives the
// renderer's store these orders; a change here must change them there too.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { SessionRegistry, type Session } from '../../src/main/agent/session'
import type { AgentEvent } from '../../src/shared/agent/events'

const QUESTION = 'Is there a decent MCP server for Slack?'

let dir: string
let registry: SessionRegistry
/** What main sent (`<session id>:<type>`) and what reached the fake agent (`agent:<text>`), in order. */
let timeline: string[] = []

/** One turn of the fake agent: it waits for a message, then answers `answer` in message `messageId`. */
function turnScript(messageId: string, answer: string): string {
  const init = { type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.322', uuid: `${messageId}-init` }
  const assistant = { type: 'assistant', message: { id: messageId, model: 'm', type: 'message', role: 'assistant', content: [{ type: 'text', text: answer }] }, parent_tool_use_id: null, session_id: '{{session}}', uuid: `${messageId}-text` }
  const result = { type: 'result', subtype: 'success', is_error: false, result: answer, total_cost_usd: 0.01, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: '{{session}}', uuid: `${messageId}-result` }
  return [{ fake: 'wait_message' }, init, assistant, result].map((line) => JSON.stringify(line)).join('\n')
}

beforeEach(async () => {
  timeline = []
  dir = await mkdtemp(join(tmpdir(), 'worfy-p123-'))
  // The first process answers in msg_a; every process that resumes the session answers in msg_b.
  await writeFile(join(dir, 'first.jsonl'), turnScript('msg_a', 'Answer A'))
  await writeFile(join(dir, 'resumed.jsonl'), turnScript('msg_b', 'Answer B'))
  const record = (call: FakeCall): void => {
    if (call.kind === 'message') timeline.push(`agent:${call.text}`)
  }
  registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: dir, script: (request) => (request.resume === undefined ? 'first' : 'resumed'), record }))
})

afterEach(async () => {
  registry.closeAll()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const sink = (sessionId: string, event: AgentEvent): void => {
  timeline.push(event.type === 'prompt' ? `${sessionId}:prompt:${event.text}` : `${sessionId}:${event.type}`)
}

const idle = (session: Session) => vi.waitFor(() => expect(session.state).toBe('idle'))
const results = (): number => timeline.filter((entry) => entry.endsWith(':result')).length
/** The entries that place a message: its `prompt`, the agent getting it, `renamed`, init and result. */
const placing = (): string[] => timeline.filter((entry) => /^agent:|:(prompt:.*|renamed|init|result)$/.test(entry))

/** A turn in the first process, then a new Session that resumes the same SDK session, as Autopilot's give-back starts it. */
async function restarted(): Promise<{ sdk: string; resumed: Session }> {
  const first = registry.start(dir, undefined, sink)
  await idle(first)
  first.send('first question')
  await vi.waitFor(() => expect(results()).toBe(1))
  await idle(first)
  const sdk = first.sdkId as string
  expect(first.id).toBe(sdk)
  first.close()
  await first.exited()
  const resumed = registry.start(dir, sdk, sink)
  await idle(resumed)
  expect(resumed.id).toMatch(/^pending-/)
  return { sdk, resumed }
}

describe('the events of a message sent after the agent process was started again (worfy-polish ticket 123)', () => {
  it('the `prompt` goes out under the temporary id before the agent gets the message; `renamed` comes next, before the init', async () => {
    const { sdk, resumed } = await restarted()
    const pending = resumed.id
    resumed.send(QUESTION)
    await vi.waitFor(() => expect(results()).toBe(2))
    expect(placing()).toEqual([
      `${sdk}:prompt:first question`,
      'agent:first question',
      `${sdk}:init`,
      `${sdk}:result`,
      `${pending}:prompt:${QUESTION}`,
      `agent:${QUESTION}`,
      `${sdk}:renamed`,
      `${sdk}:init`,
      `${sdk}:result`,
    ])
    // `renamed` is the first event under the SDK id after the restart: nothing of the new Session, an
    // echo of the message least of all, can reach the store under that id before it.
    const restart = timeline.indexOf(`${pending}:prompt:${QUESTION}`)
    expect(timeline.slice(restart).find((entry) => entry.startsWith(`${sdk}:`))).toBe(`${sdk}:renamed`)
  })

  it('a message queued in the new Session goes out under the SDK id, after the result of the turn before it', async () => {
    const { sdk, resumed } = await restarted()
    const pending = resumed.id
    expect(resumed.send(QUESTION)).toBe('sent')
    expect(resumed.send('and one more')).toBe('queued')
    await vi.waitFor(() => expect(results()).toBe(3))
    expect(placing().slice(4)).toEqual([
      `${pending}:prompt:${QUESTION}`,
      `agent:${QUESTION}`,
      `${sdk}:renamed`,
      `${sdk}:init`,
      `${sdk}:result`,
      `${sdk}:prompt:and one more`,
      'agent:and one more',
      `${sdk}:init`,
      `${sdk}:result`,
    ])
  })
})
