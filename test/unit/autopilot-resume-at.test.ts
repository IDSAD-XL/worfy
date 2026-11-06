// When an Autopilot run continues after a refusal by the Limits (worfy-daily ticket 05): reset times
// in seconds and milliseconds, the 5-hour and the 7-day window, no reset time, and the wait's limit.
import { describe, expect, it } from 'vitest'
import type { LimitsState, LimitWindowState } from '../../src/shared/agent/limits'
import { isLimitsMessage, MAX_WAIT_MS, RECHECK_MS, RESUME_MARGIN_MS, resumeAt, toMs } from '../../src/shared/autopilot/resume-at'

const NOW = Date.UTC(2026, 9, 6, 1, 0, 0)
const H = 3_600_000
const S = (ms: number): number => ms / 1000

const win = (resetsAtS: number | null, status: string | null = null): LimitWindowState => ({ utilization: null, resetsAt: resetsAtS, status, receivedAt: NOW - 1000, source: 'sdk' })
const limits = (windows: Record<string, LimitWindowState> = {}): LimitsState => ({ windows })

describe('toMs', () => {
  it('reads Unix seconds and milliseconds', () => {
    expect(toMs(1791184200)).toBe(1791184200000)
    expect(toMs(1791184200000)).toBe(1791184200000)
  })
})

describe('resumeAt', () => {
  it('continues at the reported reset of the 5-hour window, in seconds, plus the margin', () => {
    const reset = NOW + 2 * H
    expect(resumeAt({ hit: { window: 'five_hour', resetsAt: S(reset) }, limits: limits(), now: NOW, since: NOW })).toEqual({ kind: 'at', at: reset + RESUME_MARGIN_MS, resetsAt: reset, window: 'five_hour' })
  })

  it('takes a reset time in milliseconds as it is', () => {
    const reset = NOW + 2 * H
    expect(resumeAt({ hit: { window: 'five_hour', resetsAt: reset }, limits: limits(), now: NOW, since: NOW })).toMatchObject({ kind: 'at', at: reset + RESUME_MARGIN_MS })
  })

  it('waits for the 7-day window within the limit, and gives up past it', () => {
    const near = NOW + 20 * H
    expect(resumeAt({ hit: { window: 'seven_day', resetsAt: S(near) }, limits: limits(), now: NOW, since: NOW })).toMatchObject({ kind: 'at', at: near + RESUME_MARGIN_MS })
    const far = NOW + 3 * 24 * H
    const plan = resumeAt({ hit: { window: 'seven_day', resetsAt: S(far) }, limits: limits(), now: NOW, since: NOW })
    expect(plan).toEqual({ kind: 'give-up', reason: `The Limits reset at ${new Date(far).toISOString()}, more than 24 h after the wait began` })
  })

  it('without a reset time in the event takes the window\'s one from limits.json', () => {
    const reset = NOW + H
    const state = limits({ five_hour: win(S(reset)), seven_day: win(S(NOW + 5 * H)) })
    expect(resumeAt({ hit: { window: 'five_hour', resetsAt: null }, limits: state, now: NOW, since: NOW })).toMatchObject({ kind: 'at', at: reset + RESUME_MARGIN_MS })
    expect(resumeAt({ hit: { window: 'seven_day', resetsAt: null }, limits: state, now: NOW, since: NOW })).toMatchObject({ kind: 'at', at: NOW + 5 * H + RESUME_MARGIN_MS })
  })

  it('with no window known takes the latest reset of the rejected windows in limits.json', () => {
    const state = limits({ five_hour: win(S(NOW + H), 'rejected'), seven_day: win(S(NOW + 3 * H), 'rejected'), seven_day_opus: win(S(NOW + 9 * H), 'allowed') })
    expect(resumeAt({ hit: { window: null, resetsAt: null }, limits: state, now: NOW, since: NOW })).toMatchObject({ kind: 'at', at: NOW + 3 * H + RESUME_MARGIN_MS })
  })

  it('a reported reset time already past counts as missing', () => {
    const state = limits({ five_hour: win(S(NOW + H)) })
    expect(resumeAt({ hit: { window: 'five_hour', resetsAt: S(NOW - H) }, limits: state, now: NOW, since: NOW })).toMatchObject({ kind: 'at', at: NOW + H + RESUME_MARGIN_MS })
    expect(resumeAt({ hit: { window: 'five_hour', resetsAt: S(NOW - H) }, limits: limits(), now: NOW, since: NOW })).toEqual({ kind: 'recheck', at: NOW + RECHECK_MS })
  })

  it('with no reset time anywhere checks again after RECHECK_MS, never past the limit', () => {
    const state = limits({ five_hour: win(S(NOW - H), 'rejected') })
    expect(resumeAt({ hit: { window: null, resetsAt: null }, limits: state, now: NOW, since: NOW })).toEqual({ kind: 'recheck', at: NOW + RECHECK_MS })
    const since = NOW - MAX_WAIT_MS + 60_000
    expect(resumeAt({ hit: { window: null, resetsAt: null }, limits: limits(), now: NOW, since })).toEqual({ kind: 'recheck', at: since + MAX_WAIT_MS })
  })

  it('gives up once the wait has lasted MAX_WAIT_MS since its first refusal', () => {
    const since = NOW - MAX_WAIT_MS
    const plan = resumeAt({ hit: { window: 'five_hour', resetsAt: S(NOW + H) }, limits: limits(), now: NOW, since })
    expect(plan).toEqual({ kind: 'give-up', reason: `Waited for the Limits since ${new Date(since).toISOString()}, longer than 24 h` })
    // A millisecond before the limit the wait still goes on: it checks again at the limit.
    expect(resumeAt({ hit: { window: null, resetsAt: null }, limits: limits(), now: NOW, since: since + 1 })).toEqual({ kind: 'recheck', at: NOW + 1 })
  })

  it('a reset exactly at the limit still waits', () => {
    const since = NOW
    const reset = since + MAX_WAIT_MS - RESUME_MARGIN_MS
    expect(resumeAt({ hit: { window: 'seven_day', resetsAt: reset }, limits: limits(), now: NOW, since })).toMatchObject({ kind: 'at', at: since + MAX_WAIT_MS })
    expect(resumeAt({ hit: { window: 'seven_day', resetsAt: reset + 1 }, limits: limits(), now: NOW, since })).toMatchObject({ kind: 'give-up' })
  })
})

describe('isLimitsMessage', () => {
  it('tells the error texts of a refusal by the Limits', () => {
    expect(isLimitsMessage("You've hit your limit · resets 3pm (Europe/Berlin)")).toBe(true)
    expect(isLimitsMessage("You've hit your weekly limit · resets Thu 9am")).toBe(true)
    expect(isLimitsMessage('Claude AI usage limit reached|1791184200')).toBe(true)
    expect(isLimitsMessage('API Error: rate_limit')).toBe(true)
  })

  it('does not take other errors for one', () => {
    expect(isLimitsMessage(null)).toBe(false)
    expect(isLimitsMessage('Not logged in · Please run /login')).toBe(false)
    expect(isLimitsMessage('Prompt is too long')).toBe(false)
    expect(isLimitsMessage('error_during_execution')).toBe(false)
  })
})

// worfy-retry ticket 05: the windows differ by plan (the owner's top plan has no `five_hour`, only
// `seven_day` or no window at all), and the Auto-continue switch decides a reset more than 24 h away.
describe('resumeAt with the Auto-continue switch (worfy-retry ticket 05)', () => {
  const SWITCH = [{ name: 'off', farReset: undefined }, { name: 'on', farReset: 'wait' as const }]

  it.each(SWITCH)('switch $name: the Limits have five_hour and seven_day, the five_hour refused → its reset plus the margin', ({ farReset }) => {
    const reset = NOW + 2 * H
    const state = limits({ five_hour: win(S(reset), 'rejected'), seven_day: win(S(NOW + 4 * 24 * H), 'allowed') })
    expect(resumeAt({ hit: { window: 'five_hour', resetsAt: S(reset) }, limits: state, now: NOW, since: NOW, farReset })).toEqual({ kind: 'at', at: reset + RESUME_MARGIN_MS, resetsAt: reset, window: 'five_hour' })
    // The event without a time: the five_hour of limits.json, not the later seven_day.
    expect(resumeAt({ hit: { window: 'five_hour', resetsAt: null }, limits: state, now: NOW, since: NOW, farReset })).toEqual({ kind: 'at', at: reset + RESUME_MARGIN_MS, resetsAt: reset, window: 'five_hour' })
  })

  it.each(SWITCH)('switch $name: only seven_day (the top plan) → the seven_day reset; five_hour is needed nowhere', ({ farReset }) => {
    const reset = NOW + 6 * H
    const state = limits({ seven_day: win(S(reset), 'rejected') })
    expect(resumeAt({ hit: { window: 'seven_day', resetsAt: S(reset) }, limits: state, now: NOW, since: NOW, farReset })).toEqual({ kind: 'at', at: reset + RESUME_MARGIN_MS, resetsAt: reset, window: 'seven_day' })
    // Neither the event's window nor its time: the rejected seven_day of limits.json names both.
    expect(resumeAt({ hit: { window: null, resetsAt: null }, limits: state, now: NOW, since: NOW, farReset })).toEqual({ kind: 'at', at: reset + RESUME_MARGIN_MS, resetsAt: reset, window: 'seven_day' })
  })

  it.each(SWITCH)('switch $name: no window at all → recheck after 30 minutes', ({ farReset }) => {
    expect(RECHECK_MS).toBe(30 * 60_000)
    expect(resumeAt({ hit: { window: null, resetsAt: null }, limits: limits(), now: NOW, since: NOW, farReset })).toEqual({ kind: 'recheck', at: NOW + RECHECK_MS })
    // The rechecks stay within the 24 h of the wait, whatever the switch.
    expect(resumeAt({ hit: { window: null, resetsAt: null }, limits: limits(), now: NOW, since: NOW - MAX_WAIT_MS, farReset })).toMatchObject({ kind: 'give-up' })
  })

  it.each(SWITCH)('switch $name: a quota without a reset → no wait, the run stops with the reason', ({ farReset }) => {
    const state = limits({ seven_day: win(S(NOW + 6 * H), 'rejected') })
    expect(resumeAt({ hit: { window: null, resetsAt: null, quota: true }, limits: state, now: NOW, since: NOW, farReset })).toEqual({ kind: 'quota' })
  })

  it('a reset in 3 days: off → give-up (as before the switch), on → at the reset', () => {
    const far = NOW + 3 * 24 * H
    const hit = { window: 'seven_day', resetsAt: S(far) }
    expect(resumeAt({ hit, limits: limits(), now: NOW, since: NOW })).toEqual({ kind: 'give-up', reason: `The Limits reset at ${new Date(far).toISOString()}, more than 24 h after the wait began` })
    expect(resumeAt({ hit, limits: limits(), now: NOW, since: NOW, farReset: 'wait' })).toEqual({ kind: 'at', at: far + RESUME_MARGIN_MS, resetsAt: far, window: 'seven_day' })
    // On, a wait that has already lasted a day still waits for a known reset.
    expect(resumeAt({ hit, limits: limits(), now: NOW, since: NOW - MAX_WAIT_MS, farReset: 'wait' })).toMatchObject({ kind: 'at', at: far + RESUME_MARGIN_MS })
    expect(resumeAt({ hit, limits: limits(), now: NOW, since: NOW - MAX_WAIT_MS })).toMatchObject({ kind: 'give-up' })
  })
})
