// The check before an automatic wake of the Assistant (src/main/assistant/budget/wake-gate.ts): the
// Limits, by the check Terminal AI uses (src/main/agent/limits-gate.ts), and the daily limit of
// automatic wakes, counted by the usage ledger (src/main/assistant/budget/ledger.ts) per local day.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { LimitWindowState, LimitsState } from '../../src/shared/agent/limits'
import { ASSISTANT_DAILY_WAKE_LIMIT } from '../../src/shared/assistant/budget'
import { removeTestTree } from '../remove'
import { AssistantUsageLedger } from '../../src/main/assistant/budget/ledger'
import { assistantWakeGate } from '../../src/main/assistant/budget/wake-gate'

// 12:00 in Kyiv (UTC+2 in November).
const NOW = Date.UTC(2026, 10, 25, 10, 0)
const IN_TWO_HOURS_S = NOW / 1000 + 2 * 60 * 60
/** The next local midnight in Kyiv: 26 November 00:00, which is 25 November 22:00 UTC. */
const MIDNIGHT = Date.UTC(2026, 10, 25, 22, 0)

function window(over: Partial<LimitWindowState> = {}): LimitWindowState {
  return { utilization: 0.1, resetsAt: IN_TWO_HOURS_S, status: 'allowed', receivedAt: NOW - 60_000, source: 'sdk', ...over }
}

const limits = (windows: Record<string, LimitWindowState>): LimitsState => ({ windows })

let zone: string | undefined
beforeAll(() => {
  zone = process.env.TZ
  process.env.TZ = 'Europe/Kyiv'
})
afterAll(() => {
  if (zone === undefined) delete process.env.TZ
  else process.env.TZ = zone
})

describe('assistantWakeGate: the Limits', () => {
  const gate = (state: LimitsState, urgent: boolean) => assistantWakeGate({ limits: state, urgent, wakesToday: 0, now: NOW })

  it('holds a non-urgent wake while the 5-hour window is used above 80 %, until the window resets', () => {
    expect(gate(limits({ five_hour: window({ utilization: 0.81 }) }), false)).toEqual({
      ok: false,
      reason: 'limits',
      window: 'five_hour',
      status: 'allowed',
      utilization: 0.81,
      until: IN_TWO_HOURS_S * 1000,
    })
  })

  it('lets a non-urgent wake through at 80 % and below', () => {
    expect(gate(limits({ five_hour: window({ utilization: 0.8 }) }), false)).toEqual({ ok: true })
    expect(gate(limits({ five_hour: window({ utilization: 0.35 }) }), false)).toEqual({ ok: true })
  })

  it('holds a non-urgent wake on allowed_warning of any window, as Terminal AI does', () => {
    expect(gate(limits({ seven_day: window({ utilization: 0.5, status: 'allowed_warning' }) }), false)).toMatchObject({ ok: false, reason: 'limits', window: 'seven_day' })
  })

  it('lets an urgent wake through above 80 % and holds it only on rejected', () => {
    expect(gate(limits({ five_hour: window({ utilization: 0.95, status: 'allowed_warning' }) }), true)).toEqual({ ok: true })
    expect(gate(limits({ five_hour: window({ utilization: 1, status: 'rejected' }) }), true)).toMatchObject({ ok: false, reason: 'limits', status: 'rejected' })
  })

  it('lets everything through when the Limits are unknown', () => {
    expect(gate(limits({}), false)).toEqual({ ok: true })
  })
})

describe('assistantWakeGate: the daily limit of automatic wakes', () => {
  it('lets the wakes up to the limit through and holds the next one until the local midnight', () => {
    const gate = (wakesToday: number, urgent: boolean) => assistantWakeGate({ limits: limits({}), urgent, wakesToday, now: NOW })
    expect(gate(ASSISTANT_DAILY_WAKE_LIMIT - 1, false)).toEqual({ ok: true })
    const held = { ok: false, reason: 'daily-limit', wakes: ASSISTANT_DAILY_WAKE_LIMIT, limit: ASSISTANT_DAILY_WAKE_LIMIT, until: MIDNIGHT }
    expect(gate(ASSISTANT_DAILY_WAKE_LIMIT, false)).toEqual(held)
    // The limit is the guard against a loop of urgent wakes too.
    expect(gate(ASSISTANT_DAILY_WAKE_LIMIT, true)).toEqual(held)
  })

  it('takes a limit other than the default', () => {
    expect(assistantWakeGate({ limits: limits({}), urgent: false, wakesToday: 3, limit: 3, now: NOW })).toMatchObject({ ok: false, reason: 'daily-limit', limit: 3 })
  })

  it('names the Limits first when both hold the wake', () => {
    const state = limits({ five_hour: window({ utilization: 0.9 }) })
    expect(assistantWakeGate({ limits: state, urgent: false, wakesToday: ASSISTANT_DAILY_WAKE_LIMIT, now: NOW })).toMatchObject({ reason: 'limits' })
  })
})

describe('the daily count of the usage ledger', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'worfy-assistant-wakes-'))
  })
  afterEach(() => {
    removeTestTree(dir)
  })

  it('counts the automatic wakes of the local day, survives a restart and starts anew after midnight', () => {
    let clock = NOW
    const ledger = new AssistantUsageLedger({ dataDir: dir, now: () => clock })
    // Yesterday 23:59 in Kyiv: not today's.
    clock = Date.UTC(2026, 10, 24, 21, 59)
    ledger.noteWake('wake-yesterday', false)
    clock = NOW
    for (let n = 0; n < ASSISTANT_DAILY_WAKE_LIMIT; n++) ledger.noteWake(`wake-${n}`, n % 5 === 0)
    expect(ledger.automaticWakesToday()).toBe(ASSISTANT_DAILY_WAKE_LIMIT)

    const gate = (counted: AssistantUsageLedger) => assistantWakeGate({ limits: limits({}), urgent: false, wakesToday: counted.automaticWakesToday(), now: clock })
    expect(gate(ledger)).toMatchObject({ ok: false, reason: 'daily-limit' })

    // A restart of worfy reads the same count from the data folder.
    const restarted = new AssistantUsageLedger({ dataDir: dir, now: () => clock })
    expect(restarted.automaticWakesToday()).toBe(ASSISTANT_DAILY_WAKE_LIMIT)

    // One minute before the local midnight the day is still full; at midnight the count starts anew.
    clock = MIDNIGHT - 60_000
    expect(gate(restarted)).toMatchObject({ ok: false, reason: 'daily-limit' })
    clock = MIDNIGHT
    expect(restarted.automaticWakesToday()).toBe(0)
    expect(gate(restarted)).toEqual({ ok: true })
  })
})
