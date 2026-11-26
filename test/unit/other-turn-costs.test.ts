// The cost of every turn worfy runs other than the Assistant's own (worfy-assistant ticket 27, src/main/agent/turn-cost.ts):
// it reaches the Assistant's usage ledger (noteOtherTurn) once per turn, so the Assistant's share of a Limits window is
// a share, not the whole window. The Sessions of a registry run on the fake agent (src/main/agent/fake-query.ts); the
// one-shot reads the `result` recorded from Claude Code (test/fixtures/sdk-messages/controls.jsonl). No test starts
// Claude Code or asks a model.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantUsageLedger } from '../../src/main/assistant/budget/ledger'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { SessionRegistry, type Session } from '../../src/main/agent/session'
import { noteOneTurnResult, setTurnCostSink, turnCostObserver } from '../../src/main/agent/turn-cost'
import { narratorAskOver } from '../../src/main/vendors/claude/narrator'
import { readOneShot } from '../../src/main/vendors/claude/one-shot'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { LimitWindowState } from '../../src/shared/agent/limits'
import { removeTestTree } from '../remove'

const NOW = Date.UTC(2026, 10, 26, 10, 0)
const HOUR = 60 * 60_000

let dir: string
/** What reached the sink, in order. */
let noted: number[]
let registry: SessionRegistry | null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-turn-cost-'))
  noted = []
  registry = null
  setTurnCostSink((costUsd) => void noted.push(costUsd))
})

afterEach(() => {
  setTurnCostSink(null)
  registry?.closeAll()
  removeTestTree(dir)
})

const init = { type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.322' }
/** A `result` whose total_cost_usd is `costUsd`: what Claude Code's process has cost so far. */
const result = (costUsd: number, text = 'done') => ({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: costUsd, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: '{{session}}' })
/** One turn of the fake agent: it waits for a message, then ends the turn at `costUsd` so far. */
const turn = (costUsd: number): unknown[] => [{ fake: 'wait_message' }, init, result(costUsd)]

function script(name: string, lines: unknown[]): void {
  writeFileSync(join(dir, `${name}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'))
}

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9

/** The registry of the Sessions over the fake agent, with the observer of the costs: `first` for a new process, `resumed` after it. */
function sessions(): SessionRegistry {
  registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: dir, script: (request) => (request.resume === undefined ? 'first' : 'resumed') }))
  registry.observe(turnCostObserver())
  return registry
}

const settled = (session: Session, state: Session['state']) => vi.waitFor(() => expect(session.state).toBe(state))

describe('the Sessions of the registry', () => {
  it('note each turn once: the difference from the last result of the process, and a new process from zero', async () => {
    // Two turns of one process (0.01, then 0.03 in all), its crash, then a new process that resumes the conversation
    // and whose first turn already costs more than the whole old process did.
    script('first', [...turn(0.01), ...turn(0.03), { fake: 'wait_message' }, { fake: 'crash', error: 'the agent died' }])
    script('resumed', turn(0.05))
    const session = sessions().start(dir, undefined, () => undefined)
    await settled(session, 'idle')
    session.send('one')
    await vi.waitFor(() => expect(noted).toHaveLength(1))
    await settled(session, 'idle')
    session.send('two')
    await vi.waitFor(() => expect(noted).toHaveLength(2))
    await settled(session, 'idle')
    session.send('three')
    await settled(session, 'error')
    session.send('four')
    await vi.waitFor(() => expect(noted).toHaveLength(3))

    expect(noted.map((cost) => Number(cost.toFixed(6)))).toEqual([0.01, 0.02, 0.05])
  })

  it('make the Assistant\'s share of a Limits window smaller than the window once other turns cost something', async () => {
    const ledger = new AssistantUsageLedger({ dataDir: join(dir, 'data'), now: () => NOW })
    setTurnCostSink((costUsd) => ledger.noteOtherTurn(costUsd))
    ledger.noteCall({ kind: 'conversation', source: null, wakeId: null, model: 'claude-opus-5-5', usage: { inputTokens: 10, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, costUsd: 0.1 })
    script('first', [...turn(0.1), ...turn(0.3)])
    const session = sessions().start(dir, undefined, () => undefined)
    await settled(session, 'idle')
    session.send('one')
    await vi.waitFor(() => expect(Object.values(ledger.snapshot().otherCost)).toHaveLength(1))
    await settled(session, 'idle')
    session.send('two')
    await vi.waitFor(() => expect(close(Object.values(ledger.snapshot().otherCost)[0] ?? 0, 0.3)).toBe(true))

    const window: LimitWindowState = { utilization: 0.4, resetsAt: (NOW + 2 * HOUR) / 1000, status: 'allowed', receivedAt: NOW, source: 'sdk' }
    const [share] = ledger.limitsShare({ windows: { five_hour: window } })
    // The Assistant spent 0.1 of the 0.4 the window saw: a quarter of its 40 %, not all of it.
    expect(share?.share).toBeCloseTo(0.4 * (0.1 / 0.4))
    expect(share?.share).toBeLessThan(0.4)
  })
})

describe('the observer of the registry', () => {
  const feed = (events: [string, AgentEvent][]): void => {
    const observe = turnCostObserver()
    for (const [sessionId, event] of events) observe(sessionId, event)
  }
  const resultEvent = (costUsd: number): AgentEvent => ({ type: 'result', subtype: 'success', isError: false, text: '', costUsd, usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, durationMs: 1, numTurns: 1, interrupted: false }) as unknown as AgentEvent

  it('counts from zero after the Session starts a new process (`starting`, a restart with the same conversation)', () => {
    feed([
      ['s1', resultEvent(0.03)],
      ['s1', { type: 'state', state: 'starting', error: null } as AgentEvent],
      ['s1', resultEvent(0.05)],
    ])
    expect(noted).toEqual([0.03, 0.05])
  })

  it('keeps the process\'s figure when the Session takes its Vendor session\'s id', () => {
    feed([
      ['pending-1', resultEvent(0.01)],
      ['sdk-1', { type: 'renamed', from: 'pending-1' } as AgentEvent],
      ['sdk-1', resultEvent(0.03)],
    ])
    expect(noted.map((cost) => Number(cost.toFixed(6)))).toEqual([0.01, 0.02])
  })

  it('keeps each Session apart, and notes nothing for a turn that cost nothing (a Codex Session, an interrupted turn)', () => {
    feed([
      ['a', resultEvent(0.02)],
      ['b', resultEvent(0.04)],
      ['a', resultEvent(0.02)],
      ['codex', resultEvent(0)],
    ])
    expect(noted).toEqual([0.02, 0.04])
  })
})

describe('the requests outside the registry: one process, one turn', () => {
  /** The first `result` Claude Code gave in the recorded controls run. */
  const recorded = (): Record<string, unknown> => {
    const lines = readFileSync(join(__dirname, '..', 'fixtures', 'sdk-messages', 'controls.jsonl'), 'utf8').split('\n').filter((line) => line.trim() !== '')
    const found = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((message) => message.type === 'result')
    if (found === undefined) throw new Error('controls.jsonl has no result')
    return found
  }

  it('a one-shot notes the cost of its result once (readOneShot)', async () => {
    const message: Record<string, unknown> = { ...recorded(), structured_output: { answer: 'ok' } }
    async function* messages(): AsyncGenerator<unknown> {
      yield { type: 'system', subtype: 'init' }
      yield message
    }
    await readOneShot(messages())
    expect(noted).toEqual([message.total_cost_usd])
  })

  it('a one-shot that ends without an answer still notes what its turn cost', async () => {
    async function* messages(): AsyncGenerator<unknown> {
      yield { ...result(0.07), subtype: 'error_max_turns', is_error: true }
    }
    await readOneShot(messages())
    expect(noted).toEqual([0.07])
  })

  it('the narrator notes the cost of its request once', async () => {
    script('narrator', [{ fake: 'wait_message' }, result(0.0004, 'Reads the roadmap')])
    const ask = narratorAskOver(fakeQueryFactory({ scriptsDir: dir, script: () => 'narrator' }), dir)
    expect(await ask('digest', new AbortController().signal)).toBe('Reads the roadmap')
    expect(noted).toEqual([0.0004])
  })

  it('a message other than a result, or a result without a cost, notes nothing; nor does anything without a sink', () => {
    noteOneTurnResult({ type: 'assistant' })
    noteOneTurnResult({ type: 'result', subtype: 'success' })
    noteOneTurnResult(null)
    setTurnCostSink(null)
    noteOneTurnResult(result(0.5))
    expect(noted).toEqual([])
  })

  it('a sink that throws never fails the request that reported', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setTurnCostSink(() => {
      throw new Error('the ledger could not be written')
    })
    expect(() => noteOneTurnResult(result(0.5))).not.toThrow()
    expect(warn).toHaveBeenCalledWith('[agent] the cost of a turn was not noted', expect.any(Error))
    warn.mockRestore()
  })
})
