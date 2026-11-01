// Opening the Run history screen (worfy-flight-recorder ticket 18): the entries of ticket 20 — the toast
// when a Run stops, «History» in the Autopilot status line, «Run history» in an Epic's menu and the
// palette command — all come through here.
import { setView } from '../session/navigation'
import { askFocus, showRuns } from './store'

/**
 * Shows the Run history of a Project over the whole main area, instead of the Canvas: `run` when given,
 * else its newest Run; with `epic`, the list of Runs keeps to that Epic (decision 06, Q2). The focus
 * goes to the Run picker once the list is there, so Esc and the keyboard work on the screen at once.
 */
export function openRunHistory(projectId: string, run?: string, epic?: string): Promise<void> {
  setView('history')
  const showing = showRuns(projectId, run, epic)
  askFocus()
  return showing
}

// The e2e test opens the screen through this until the entries exist: on only when the page defined
// `__worfyRunHistory` before the app's scripts ran (an init script of the test); the app never does.
const hook = (globalThis as { __worfyRunHistory?: { open?: typeof openRunHistory } }).__worfyRunHistory
if (hook !== undefined) hook.open = openRunHistory
