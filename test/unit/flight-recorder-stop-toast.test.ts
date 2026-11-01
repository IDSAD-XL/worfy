// The toast when an Autopilot Run stops (worfy-flight-recorder ticket 20, decision 06 Q1): over the
// real toast store (src/renderer/toast/toasts.ts), with the Run history screen's opener handed in by
// the test and the IPC subscription replaced, so the test sees what "Open history" asks and which
// handler is subscribed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOPILOT_STOP_REASONS } from '../../src/shared/autopilot/cycle'
import { autopilotStateSchema, type AutopilotState } from '../../src/shared/ipc/autopilot'
import { pressToastAction, resetToasts, setToastProject, shownToasts, toasts, TOAST_MS, type Toast } from '../../src/renderer/toast/toasts'

const subscribed = vi.hoisted(() => new Map<string, (payload: unknown) => void>())

vi.mock('../../src/renderer/ipc', () => ({
  subscribe: (channel: string, handler: (payload: unknown) => void) => {
    subscribed.set(channel, handler)
    return () => subscribed.delete(channel)
  },
  showSubscribeError: () => undefined,
}))

const { acceptStopState, installStopToasts, resetStopToasts, runDuration, STOP_TOAST_TEST_ID, stopToastKey } = await import('../../src/renderer/flight-recorder/stop-toast')

const PROJECT = 'demo-000000a4'
const RUN = '2026-10-17T22-29-32-707Z-58e783'
const INSTALLED = Date.parse('2026-10-18T00:00:00Z')
const STOPPED = INSTALLED + 4 * 3_600_000
const DURATION = (4 * 60 + 48) * 60_000

/** A state as main sends it; parsed, so a field the schema does not know fails here, not in the app. */
function state(over: Partial<AutopilotState> = {}): AutopilotState {
  return autopilotStateSchema.parse({
    projectId: PROJECT,
    epic: 'demo',
    status: 'stopped',
    wave: 3,
    backgroundTasks: 0,
    resumesAt: null,
    reason: 'blocked-tickets',
    message: null,
    resumable: [],
    stopping: false,
    ticketsInWork: 0,
    harnessBehind: null,
    run: RUN,
    ended: { at: STOPPED, duration: DURATION, done: 5, blocked: 1 },
    revision: 7,
    ...over,
  })
}

const all = (): readonly Toast[] => toasts.getState().toasts
let opened: unknown[][]

beforeEach(() => {
  vi.useFakeTimers()
  resetToasts()
  resetStopToasts()
  opened = []
  subscribed.clear()
  installStopToasts((...args) => void opened.push(args), INSTALLED)
  setToastProject(PROJECT)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the toast when a Run stops', () => {
  it('says the reason, the Tickets done and blocked and the duration, with "Open history"; it does not hide by itself', () => {
    acceptStopState(state())
    expect(all()).toHaveLength(1)
    const toast = all()[0]!
    expect(toast.text).toBe('Run stopped: blocked-tickets · 5 done, 1 blocked · 4 h 48 min')
    expect(toast.kind).toBe('action')
    expect(toast.id).toBe(stopToastKey(RUN))
    expect(toast.testId).toBe(STOP_TOAST_TEST_ID)
    expect(toast.actions?.map((action) => action.label)).toEqual(['Open history'])
    // A minute, and an hour, later it is still there: no timer of its own.
    vi.advanceTimersByTime(60_000)
    vi.advanceTimersByTime(3_600_000 + TOAST_MS)
    expect(shownToasts(toasts.getState()).map((each) => each.id)).toEqual([stopToastKey(RUN)])
  })

  it('"Open history" opens the Run history of its Project at this Run, and closes the toast', () => {
    acceptStopState(state())
    pressToastAction(stopToastKey(RUN), 0)
    expect(opened).toEqual([[PROJECT, RUN]])
    expect(all()).toHaveLength(0)
  })

  it('one toast per Run: a second state of the same Run neither adds a toast nor brings a closed one back', () => {
    acceptStopState(state())
    acceptStopState(state({ revision: 8, harnessBehind: { harness: '0.6.0+abc', main: 'origin/main', commits: 2 } }))
    expect(all()).toHaveLength(1)
    expect(all()[0]!.version).toBe(1)
    pressToastAction(stopToastKey(RUN), 0)
    acceptStopState(state({ revision: 9 }))
    expect(all()).toHaveLength(0)
  })

  it('another Run of the Project has a toast of its own', () => {
    const next = '2026-10-18T06-00-00-000Z-a1b2c3'
    acceptStopState(state())
    acceptStopState(state({ run: next, reason: 'user-stop', ended: { at: STOPPED + 60_000, duration: 45_000, done: 0, blocked: 0 }, revision: 9 }))
    expect(all().map((each) => [each.id, each.text])).toEqual([
      [stopToastKey(RUN), 'Run stopped: blocked-tickets · 5 done, 1 blocked · 4 h 48 min'],
      [stopToastKey(next), 'Run stopped: user-stop · 0 done, 0 blocked · 45 s'],
    ])
  })

  it.each(AUTOPILOT_STOP_REASONS)('a stop for %s has the toast too', (reason) => {
    acceptStopState(state({ reason }))
    expect(all().map((each) => each.text)).toEqual([`Run stopped: ${reason} · 5 done, 1 blocked · 4 h 48 min`])
  })

  it('belongs to its Project: shown only while that Project is the active one', () => {
    acceptStopState(state())
    setToastProject('other-00000001')
    expect(shownToasts(toasts.getState())).toHaveLength(0)
    setToastProject(PROJECT)
    expect(shownToasts(toasts.getState()).map((each) => each.id)).toEqual([stopToastKey(RUN)])
  })

  it('no toast while a run goes on, for a stop without a Journal, or for a Run that stopped before the window', () => {
    acceptStopState(state({ status: 'running', reason: null, ended: undefined }))
    acceptStopState(state({ status: 'waiting', reason: null, ended: undefined, resumesAt: STOPPED }))
    // A start that failed before its Journal opened: nothing to show in Run history.
    acceptStopState(state({ run: undefined }))
    // The state of a Run that ended before this window started, sent again (a refresh of the Harness mark).
    acceptStopState(state({ ended: { at: INSTALLED - 1, duration: DURATION, done: 5, blocked: 1 } }))
    expect(all()).toHaveLength(0)
    acceptStopState(state({ ended: { at: INSTALLED, duration: DURATION, done: 5, blocked: 1 } }))
    expect(all()).toHaveLength(1)
  })

  it('installStopToasts subscribes to autopilot.changed: a stop sent by main shows the toast', () => {
    subscribed.get('autopilot.changed')?.(state())
    expect(all().map((each) => each.id)).toEqual([stopToastKey(RUN)])
  })
})

describe('runDuration', () => {
  it('writes seconds under a minute, minutes under an hour, hours and minutes above', () => {
    expect(runDuration(0)).toBe('0 s')
    expect(runDuration(45_000)).toBe('45 s')
    expect(runDuration(59_999)).toBe('59 s')
    expect(runDuration(60_000)).toBe('1 min')
    expect(runDuration(12 * 60_000 + 30_000)).toBe('12 min')
    expect(runDuration(3_600_000)).toBe('1 h')
    expect(runDuration(3_600_000 + 5 * 60_000)).toBe('1 h 5 min')
    expect(runDuration(DURATION)).toBe('4 h 48 min')
    expect(runDuration(30 * 3_600_000)).toBe('30 h')
  })
})
