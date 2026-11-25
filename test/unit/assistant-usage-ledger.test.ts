// The usage ledger of the Assistant (src/main/assistant/budget/ledger.ts, summaries in
// src/shared/assistant/budget.ts): the tokens of every call — the Assistant's Sessions and the
// checks of sources — for the day and the week, by source, by wake and for the conversation, and
// the estimate of the Assistant's share of the Limits windows.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { LimitWindowState, LimitsState } from '../../src/shared/agent/limits'
import type { UsageCallInput } from '../../src/shared/assistant/budget'
import { AssistantUsageLedger, USAGE_FILE } from '../../src/main/assistant/budget/ledger'

// 12:00 in Kyiv (UTC+2 in November).
const NOW = Date.UTC(2026, 10, 25, 10, 0)
const HOUR = 60 * 60_000
const DAY = 24 * HOUR

let zone: string | undefined
beforeAll(() => {
  zone = process.env.TZ
  process.env.TZ = 'Europe/Kyiv'
})
afterAll(() => {
  if (zone === undefined) delete process.env.TZ
  else process.env.TZ = zone
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-assistant-usage-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A call with `input` input tokens, a tenth of them as output, and a cost of input / 1000 USD. */
function call(over: Partial<UsageCallInput> & Pick<UsageCallInput, 'kind'>, input: number): UsageCallInput {
  return {
    source: null,
    wakeId: null,
    model: null,
    usage: { inputTokens: input, outputTokens: input / 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    costUsd: input / 1000,
    ...over,
  }
}

function files(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
}

describe('the token summary', () => {
  it('sums the day and the week, by source, by wake and for the conversation', () => {
    let clock = NOW - 10 * DAY
    const ledger = new AssistantUsageLedger({ dataDir: dir, now: () => clock })
    // Ten days ago: outside the week, and dropped from the file on the next write.
    ledger.noteCall(call({ kind: 'source-check', source: 'slack' }, 9000))
    // Five days ago and yesterday 23:30 in Kyiv: in the week, not in the day.
    clock = NOW - 5 * DAY
    ledger.noteCall(call({ kind: 'source-check', source: 'jira' }, 500))
    clock = Date.UTC(2026, 10, 24, 21, 30)
    ledger.noteWake('w0', false)
    ledger.noteCall(call({ kind: 'wake', wakeId: 'w0' }, 700))
    // Today.
    clock = NOW - 2 * HOUR
    ledger.noteCall(call({ kind: 'source-check', source: 'slack' }, 100))
    ledger.noteCall(call({ kind: 'source-check', source: 'slack' }, 200))
    ledger.noteCall(call({ kind: 'source-check', source: 'jira' }, 300))
    ledger.noteWake('w1', true)
    ledger.noteCall(call({ kind: 'wake', wakeId: 'w1' }, 1000))
    ledger.noteCall(call({ kind: 'wake', wakeId: 'w1' }, 2000))
    clock = NOW
    ledger.noteCall(call({ kind: 'conversation', model: 'claude-opus-5-5' }, 4000))

    const { day, week } = ledger.summary()

    expect(day.from).toBe(Date.UTC(2026, 10, 24, 22, 0))
    expect(day.total).toMatchObject({ calls: 6, inputTokens: 7600, outputTokens: 760, tokens: 8360 })
    expect(day.total.costUsd).toBeCloseTo(7.6)
    expect(day.sources).toEqual({
      slack: { calls: 2, inputTokens: 300, outputTokens: 30, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, tokens: 330, costUsd: expect.closeTo(0.3) },
      jira: { calls: 1, inputTokens: 300, outputTokens: 30, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, tokens: 330, costUsd: expect.closeTo(0.3) },
    })
    expect(day.wakes.count).toBe(1)
    expect(day.wakes.total).toMatchObject({ calls: 2, inputTokens: 3000 })
    expect(day.wakes.byWake).toEqual([{ id: 'w1', at: NOW - 2 * HOUR, urgent: true, total: expect.objectContaining({ calls: 2, tokens: 3300 }) }])
    expect(day.conversation).toMatchObject({ calls: 1, inputTokens: 4000, tokens: 4400 })

    // The week: today and the six local days before it.
    expect(week.from).toBe(Date.UTC(2026, 10, 18, 22, 0))
    expect(week.total).toMatchObject({ calls: 8, inputTokens: 8800 })
    expect(week.sources.jira).toMatchObject({ calls: 2, inputTokens: 800 })
    expect(week.sources.slack).toMatchObject({ calls: 2, inputTokens: 300 })
    expect(week.wakes.count).toBe(2)
    expect(week.wakes.byWake.map((wake) => wake.id)).toEqual(['w0', 'w1'])
  })

  it('keeps the calls in the data folder only, and a restart reads them back', () => {
    const ledger = new AssistantUsageLedger({ dataDir: dir, now: () => NOW })
    ledger.noteCall(call({ kind: 'source-check', source: 'slack' }, 100))
    ledger.noteOtherTurn(0.5)

    expect(files(dir)).toEqual([USAGE_FILE])
    const restarted = new AssistantUsageLedger({ dataDir: dir, now: () => NOW })
    expect(restarted.summary().day.sources.slack).toMatchObject({ calls: 1, inputTokens: 100 })
  })

  it('drops what is older than the week from the file', () => {
    let clock = NOW - 10 * DAY
    const ledger = new AssistantUsageLedger({ dataDir: dir, now: () => clock })
    ledger.noteWake('old', false)
    ledger.noteCall(call({ kind: 'wake', wakeId: 'old' }, 100))
    ledger.noteOtherTurn(1)
    clock = NOW
    ledger.noteCall(call({ kind: 'conversation' }, 100))

    const stored = ledger.snapshot()
    expect(stored.wakes).toEqual([])
    expect(stored.calls).toHaveLength(1)
    expect(stored.otherCost).toEqual({})
  })
})

describe('the share of the Limits windows, an estimate', () => {
  const resetsInTwoHours = (utilization: number | null): LimitWindowState => ({
    utilization,
    resetsAt: (NOW + 2 * HOUR) / 1000,
    status: 'allowed',
    receivedAt: NOW - 60_000,
    source: 'sdk',
  })
  const state = (windows: Record<string, LimitWindowState>): LimitsState => ({ windows })

  it('splits the window by the cost of the calls since the window began: the Assistant against every other turn worfy saw', () => {
    let clock = NOW - 4 * HOUR
    const ledger = new AssistantUsageLedger({ dataDir: dir, now: () => clock })
    // Before the 5-hour window began (it began 3 hours ago): only the 7-day window counts it.
    ledger.noteCall(call({ kind: 'source-check', source: 'slack' }, 1000))
    ledger.noteOtherTurn(9)
    clock = NOW - HOUR
    ledger.noteCall(call({ kind: 'conversation' }, 1000))
    ledger.noteOtherTurn(3)
    clock = NOW

    const shares = ledger.limitsShare(state({ five_hour: resetsInTwoHours(0.6), seven_day: { ...resetsInTwoHours(0.2), resetsAt: (NOW + 3 * DAY) / 1000 } }))

    expect(shares).toEqual([
      { window: 'five_hour', estimate: true, method: 'cost-share', utilization: 0.6, share: expect.closeTo(0.6 * (1 / 4)), since: NOW - 3 * HOUR },
      { window: 'seven_day', estimate: true, method: 'cost-share', utilization: 0.2, share: expect.closeTo(0.2 * (2 / 14)), since: NOW - 4 * DAY },
    ])
  })

  it('gives the whole window as the upper bound when no other turn was noted, and nothing for an unknown window', () => {
    const ledger = new AssistantUsageLedger({ dataDir: dir, now: () => NOW })
    ledger.noteCall(call({ kind: 'conversation' }, 1000))

    expect(ledger.limitsShare(state({ five_hour: resetsInTwoHours(0.4), seven_day: resetsInTwoHours(null) }))).toEqual([
      { window: 'five_hour', estimate: true, method: 'cost-share', utilization: 0.4, share: 0.4, since: NOW - 3 * HOUR },
    ])
  })

  it('gives a share of 0 when nothing was spent since the window began', () => {
    const ledger = new AssistantUsageLedger({ dataDir: dir, now: () => NOW })
    expect(ledger.limitsShare(state({ five_hour: resetsInTwoHours(0.4) }))).toEqual([
      { window: 'five_hour', estimate: true, method: 'cost-share', utilization: 0.4, share: 0, since: NOW - 3 * HOUR },
    ])
  })
})
