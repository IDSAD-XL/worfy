// The Limits threshold of Terminal AI (src/main/terminal-ai/limits-gate.ts): which features the
// known Limits let through at a given moment.
import { describe, expect, it } from 'vitest'
import type { LimitWindowState, LimitsState } from '../../src/shared/agent/limits'
import { LIMITS_STATUS_TTL_MS, limitsGate } from '../../src/main/terminal-ai/limits-gate'
import { TERMINAL_AI_FEATURES } from '../../src/shared/terminal-ai/settings'

const NOW = Date.UTC(2026, 9, 10, 12, 0)
const IN_TWO_HOURS_S = NOW / 1000 + 2 * 60 * 60

function window(over: Partial<LimitWindowState> = {}): LimitWindowState {
  return { utilization: 0.1, resetsAt: IN_TWO_HOURS_S, status: 'allowed', receivedAt: NOW - 60_000, source: 'sdk', ...over }
}

const limits = (windows: Record<string, LimitWindowState>): LimitsState => ({ windows })

const allowedFeatures = (state: LimitsState, now = NOW): string[] => TERMINAL_AI_FEATURES.filter((feature) => limitsGate(state, feature, now).ok)

describe('limitsGate', () => {
  it('stops the automatic features above 80 % of the 5-hour window and lets the on-demand ones through', () => {
    const state = limits({ five_hour: window({ utilization: 0.81 }) })
    expect(allowedFeatures(state)).toEqual(['request', 'fix'])
    expect(limitsGate(state, 'suggest', NOW)).toEqual({ ok: false, window: 'five_hour', status: 'allowed', utilization: 0.81, until: IN_TWO_HOURS_S * 1000 })
  })

  it('lets everything through at 79 % with status allowed', () => {
    expect(allowedFeatures(limits({ five_hour: window({ utilization: 0.79 }) }))).toEqual(['suggest', 'next', 'request', 'fix'])
  })

  it('stops the automatic features on allowed_warning of any window, here the 7-day one', () => {
    const state = limits({ five_hour: window({ utilization: 0.2 }), seven_day: window({ utilization: 0.5, status: 'allowed_warning' }) })
    expect(allowedFeatures(state)).toEqual(['request', 'fix'])
    expect(limitsGate(state, 'next', NOW)).toMatchObject({ ok: false, window: 'seven_day', status: 'allowed_warning' })
  })

  it('stops every feature on rejected, with the reset time of the window', () => {
    const state = limits({ seven_day: window({ status: 'rejected', resetsAt: IN_TWO_HOURS_S + 3600 }) })
    expect(allowedFeatures(state)).toEqual([])
    expect(limitsGate(state, 'fix', NOW)).toEqual({ ok: false, window: 'seven_day', status: 'rejected', utilization: 0.1, until: (IN_TWO_HOURS_S + 3600) * 1000 })
  })

  it('does not count a window whose reset time has passed: neither its share nor its status', () => {
    const past = NOW / 1000 - 60
    const state = limits({ five_hour: window({ utilization: 0.9, status: 'rejected', resetsAt: past }) })
    expect(allowedFeatures(state)).toEqual(['suggest', 'next', 'request', 'fix'])
  })

  it('counts a status of a window without a reset time for an hour after it came, then not', () => {
    const fresh = limits({ five_hour: window({ utilization: null, status: 'rejected', resetsAt: null, receivedAt: NOW - 10 * 60_000 }) })
    expect(allowedFeatures(fresh)).toEqual([])
    expect(limitsGate(fresh, 'request', NOW)).toMatchObject({ ok: false, until: NOW - 10 * 60_000 + LIMITS_STATUS_TTL_MS })

    const old = limits({ five_hour: window({ utilization: null, status: 'rejected', resetsAt: null, receivedAt: NOW - LIMITS_STATUS_TTL_MS - 1 }) })
    expect(allowedFeatures(old)).toEqual(['suggest', 'next', 'request', 'fix'])
  })

  it('lets everything through when the Limits are unknown', () => {
    expect(allowedFeatures(limits({}))).toEqual(['suggest', 'next', 'request', 'fix'])
    expect(allowedFeatures(limits({ five_hour: window({ utilization: null, status: null }) }))).toEqual(['suggest', 'next', 'request', 'fix'])
  })

  it('holds the pause until the last blocking window lifts', () => {
    const state = limits({
      five_hour: window({ utilization: 0.95, resetsAt: IN_TWO_HOURS_S }),
      seven_day: window({ utilization: 0.4, status: 'allowed_warning', resetsAt: IN_TWO_HOURS_S + 7200 }),
    })
    expect(limitsGate(state, 'suggest', NOW)).toMatchObject({ ok: false, until: (IN_TWO_HOURS_S + 7200) * 1000 })
  })
})
