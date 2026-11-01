// The toast when an Autopilot Run stops (worfy-flight-recorder ticket 20, decision 06 Q1): "Run
// stopped: <reason> · N done, M blocked · <duration>" with "Open history", which opens the Run
// history screen at that Run (open.ts). One per Run, keyed by its run id; an `action` toast, so it
// stays until it is closed. It comes for every stop reason, and the same for a Run started with the
// button or from a chat (ticket 21: one Autopilot.start, one stop). No notification of the OS (Q3).
//
// The window takes the stops from `autopilot.changed`, not from the state it asks: a stopped state it
// reads at its start is an old one. Main sends a stopped state again later too (a new answer of the
// Harness mark), so a Run gets its toast once per window, and not at all when it stopped before the
// window started listening.
import type { AutopilotState } from '../../shared/ipc/autopilot'
import { showSubscribeError, subscribe } from '../ipc'
import { showToast } from '../toast/toasts'
import { openRunHistory } from './open'

/** `data-testid` of the toast. */
export const STOP_TOAST_TEST_ID = 'run-stopped-toast'

/** The toast's key: one per Run. */
export const stopToastKey = (run: string): string => `run-stopped:${run}`

/** A Run's duration as the toast writes it: `45 s`, `12 min`, `4 h 48 min`, `30 h`. */
export function runDuration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60) % 60
  const hours = Math.floor(seconds / 3600)
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

/** When this window began to listen (ms); before installStopToasts no stop is new. */
let since = Number.POSITIVE_INFINITY
/** The Runs this window has shown the toast of. */
const toasted = new Set<string>()

/**
 * Shows the toast of a Run that stopped, once per Run: a state of a stopped run with its Journal
 * (`run`) and its end (`ended`) at or after the window began to listen.
 * shortcut: compares main's clock with this window's, which only a window on a Linked machine with a
 * clock behind by more than the window's age gets wrong (no toast); redo with a stop counter of main
 * if that ever matters.
 */
export function acceptStopState(state: AutopilotState): void {
  const { projectId, run, ended, reason } = state
  if (state.status !== 'stopped' || run === undefined || ended === undefined || reason === null) return
  if (ended.at < since || toasted.has(run)) return
  toasted.add(run)
  showToast({
    kind: 'action',
    key: stopToastKey(run),
    projectId,
    testId: STOP_TOAST_TEST_ID,
    text: `Run stopped: ${reason} · ${ended.done} done, ${ended.blocked} blocked · ${runDuration(ended.duration)}`,
    actions: [{ label: 'Open history', run: () => void openRunHistory(projectId, run) }],
  })
}

/** Subscribes the window to the stops of Autopilot runs; `now` is when it begins to listen. Returns the unsubscribe. */
export function installStopToasts(now = Date.now()): () => void {
  since = now
  try {
    return subscribe('autopilot.changed', acceptStopState)
  } catch (error) {
    showSubscribeError('autopilot.changed', error)
    return () => undefined
  }
}

/** Forgets the Runs shown and stops listening for new stops; tests start from here. */
export function resetStopToasts(): void {
  since = Number.POSITIVE_INFINITY
  toasted.clear()
}
