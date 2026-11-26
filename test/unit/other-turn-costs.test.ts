// The cost of every turn worfy runs other than the Assistant's own (worfy-assistant ticket 27, src/main/agent/turn-cost.ts):
// it reaches the Assistant's usage ledger once per turn, so the Assistant's share of a Limits window is a share, not the
// whole window. Claude Code restores a conversation's cost when it resumes it (the `cost-state` records of its
// transcript), so a Session's turn is the rise of its conversation's total, kept by the ledger across processes, Sessions
// and restarts of worfy. The Sessions of a registry run on the fake agent (src/main/agent/fake-query.ts), whose resumed
// scripts report the restored total as Claude Code does; the one-shot reads the `result` recorded from Claude Code
// (test/fixtures/sdk-messages/controls.jsonl). No test starts Claude Code or asks a model.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantUsageLedger, ledgerTurnCostSink } from '../../src/main/assistant/budget/ledger'
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
/** What reached a recording sink, in order: a one-turn cost as is, a conversation's total as `<id>=<total>`. */
let noted: (number | string)[]
let registries: SessionRegistry[]

/** A sink that only records what reached it. */
const recording = () => ({
  turn: (costUsd: number) => void noted.push(costUsd),
  conversationTotal: (conversationId: string, totalUsd: number) => void noted.push(`${conversationId}=${totalUsd}`),
  renamed: (from: string, to: string) => void noted.push(`${from}->${to}`),
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-turn-cost-'))
  noted = []
  registries = []
  setTurnCostSink(recording())
})

afterEach(() => {
  setTurnCostSink(null)
  for (const registry of registries) registry.closeAll()
  removeTestTree(dir)
})

const init = { type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.322' }
/** A `result` whose total_cost_usd is `costUsd`: what the conversation has cost so far, as Claude Code reports it. */
const result = (costUsd: number, text = 'done') => ({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: costUsd, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: '{{session}}' })
/** One turn of the fake agent: it waits for a message, then ends the turn at `costUsd` so far. */
const turn = (costUsd: number): unknown[] => [{ fake: 'wait_message' }, init, result(costUsd)]

function script(name: string, lines: unknown[]): void {
  writeFileSync(join(dir, `${name}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'))
}

/** The ledger of the Assistant over this test's data folder; a second one over the same folder is worfy started again. */
const ledgerOf = (): AssistantUsageLedger => new AssistantUsageLedger({ dataDir: join(dir, 'data'), now: () => NOW })
/** What every other turn cost in all, as the ledger kept it, to the micro-dollar. */
const other = (ledger: AssistantUsageLedger): number => Number(Object.values(ledger.snapshot().otherCost).reduce((sum, cost) => sum + cost, 0).toFixed(6))
/** The ledger as the sink, as the app sets it at its start. */
const into = (ledger: AssistantUsageLedger): void => setTurnCostSink(ledgerTurnCostSink(() => ledger))

/** A registry of the Sessions over the fake agent, with the observer of the costs: `first` for a new conversation, `resumed` for one resumed. */
function sessions(): SessionRegistry {
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: dir, script: (request) => (request.resume === undefined ? 'first' : 'resumed') }))
  registry.observe(turnCostObserver())
  registries.push(registry)
  return registry
}

const settled = (session: Session, state: Session['state']) => vi.waitFor(() => expect(session.state).toBe(state))

/** How many `result` events each Session started by `open` has sent. */
const results = new WeakMap<Session, number>()

/** Starts a Session of `registry`, a new conversation or `resume`, counting its results. */
function open(registry: SessionRegistry, resume?: string): Session {
  let count = 0
  const session = registry.start(dir, resume, (_id, event) => {
    if (event.type === 'result') results.set(session, ++count)
  })
  return session
}

/** Sends `text` and waits for the result of its turn. */
async function ask(session: Session, text: string): Promise<void> {
  await settled(session, 'idle')
  const before = results.get(session) ?? 0
  session.send(text)
  await vi.waitFor(() => expect(results.get(session) ?? 0).toBe(before + 1))
}

describe('the Sessions of the registry', () => {
  it('note each turn once: the rise of the conversation\'s total, which a resumed process restores rather than restarts', async () => {
    const ledger = ledgerOf()
    into(ledger)
    // Two turns of one process (0.01, then 0.03 in all), its crash, then a new process that resumes the conversation:
    // Claude Code restores the 0.03, and its turn brings the total to 0.05.
    script('first', [...turn(0.01), ...turn(0.03), { fake: 'wait_message' }, { fake: 'crash', error: 'the agent died' }])
    script('resumed', turn(0.05))
    const session = open(sessions())
    await ask(session, 'one')
    expect(other(ledger)).toBe(0.01)
    await ask(session, 'two')
    expect(other(ledger)).toBe(0.03)
    session.send('three')
    await settled(session, 'error')
    session.send('four')
    await vi.waitFor(() => expect(other(ledger)).toBe(0.05))
  })

  it('keep the conversation\'s total across a new Session that resumes it and across a restart of worfy', async () => {
    script('first', turn(0.01))
    script('resumed', turn(0.04))
    const before = ledgerOf()
    into(before)
    const first = open(sessions())
    await ask(first, 'one')
    const sdk = first.sdkId as string
    first.close()
    await first.exited()

    // worfy starts again: a new ledger read from the file, a new registry and observer, the Orchestrator resumed.
    const after = ledgerOf()
    into(after)
    const resumed = open(sessions(), sdk)
    await ask(resumed, 'two')
    // 0.01 before the restart, and the resumed turn's 0.03 on top of the restored 0.01: never the 0.01 again.
    expect(other(after)).toBe(0.04)
  })

  it('count a new conversation from zero, and a resumed one whose total went down (nothing restored) from zero too', async () => {
    const ledger = ledgerOf()
    into(ledger)
    script('first', turn(0.03))
    script('resumed', turn(0.005))
    const one = open(sessions())
    const two = open(sessions())
    await ask(one, 'one')
    await ask(two, 'one')
    expect(one.sdkId).not.toBe(two.sdkId)
    expect(other(ledger)).toBe(0.06)
    const sdk = one.sdkId as string
    one.close()
    await one.exited()
    const again = open(sessions(), sdk)
    await ask(again, 'two')
    expect(other(ledger)).toBe(0.065)
  })

  it('make the Assistant\'s share of a Limits window smaller than the window once other turns cost something', async () => {
    const ledger = ledgerOf()
    into(ledger)
    ledger.noteCall({ kind: 'conversation', source: null, wakeId: null, model: 'claude-opus-5-5', usage: { inputTokens: 10, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, costUsd: 0.1 })
    script('first', [...turn(0.1), ...turn(0.3)])
    const session = open(sessions())
    await ask(session, 'one')
    await ask(session, 'two')
    expect(other(ledger)).toBe(0.3)

    const window: LimitWindowState = { utilization: 0.4, resetsAt: (NOW + 2 * HOUR) / 1000, status: 'allowed', receivedAt: NOW, source: 'sdk' }
    const [share] = ledger.limitsShare({ windows: { five_hour: window } })
    // The Assistant spent 0.1 of the 0.4 the window saw: a quarter of its 40 %, not all of it.
    expect(share?.share).toBeCloseTo(0.4 * (0.1 / 0.4))
    expect(share?.share).toBeLessThan(0.4)
  })
})

describe('the observer of the registry', () => {
  const resultEvent = (costUsd: number): AgentEvent => ({ type: 'result', subtype: 'success', isError: false, text: '', costUsd, usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, durationMs: 1, numTurns: 1, interrupted: false }) as unknown as AgentEvent
  const feed = (events: [string, AgentEvent][]): void => {
    const observe = turnCostObserver()
    for (const [sessionId, event] of events) observe(sessionId, event)
  }

  it('passes each result as its conversation\'s total and each new id of a Session, and keeps nothing across a new process', () => {
    feed([
      ['sdk-1', resultEvent(0.03)],
      ['sdk-1', { type: 'state', state: 'starting', error: null } as AgentEvent],
      ['sdk-1', resultEvent(0.05)],
      ['sdk-2', { type: 'renamed', from: 'sdk-1' } as AgentEvent],
    ])
    expect(noted).toEqual(['sdk-1=0.03', 'sdk-1=0.05', 'sdk-1->sdk-2'])
  })

  it('in the ledger: a new id in the same process goes on from the old one\'s total; a turn that cost nothing notes nothing', () => {
    const ledger = ledgerOf()
    into(ledger)
    feed([
      ['sdk-1', resultEvent(0.01)],
      ['sdk-2', { type: 'renamed', from: 'sdk-1' } as AgentEvent],
      ['sdk-2', resultEvent(0.03)],
      // An interrupted turn repeats the figure; a Codex Session reports 0.
      ['sdk-2', resultEvent(0.03)],
      ['codex', resultEvent(0)],
    ])
    expect(other(ledger)).toBe(0.03)
    expect(Object.keys(ledger.snapshot().otherTotals).sort()).toEqual(['sdk-1', 'sdk-2'])
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
    const fail = (): never => {
      throw new Error('the ledger could not be written')
    }
    setTurnCostSink({ turn: fail, conversationTotal: fail, renamed: fail })
    expect(() => noteOneTurnResult(result(0.5))).not.toThrow()
    expect(() => turnCostObserver()('sdk-1', { type: 'result', costUsd: 0.5 } as AgentEvent)).not.toThrow()
    expect(warn).toHaveBeenCalledWith('[agent] the cost of a turn was not noted', expect.any(Error))
    warn.mockRestore()
  })
})
