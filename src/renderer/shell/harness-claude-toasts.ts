// The toast of a failed row "Harness on Claude Code" (worfy-harness-guarantees ticket 09; spec, the solution, point 4):
// the contract set of the Harness found that the Harness does not do its part on a Claude Code version — on worfy's
// copy or on the terminal's — so the guard or the gate may not hold in Sessions there. Like the toast of a Harness
// out of date (update/toasts.ts) it comes in the corner of the window with "Open Health"; the red row in Settings →
// Health names the case and copies the details.
//
// It follows the Health check report (`firstRun.health` at the start, then `firstRun.reportChanged`). One toast per
// failed answer per window load: the same row with the same text is not told again, a new failure (another case,
// another version) is. When no such row fails any more, the toast goes. A row that could not run the checks
// (`unknown`) says nothing about the Harness and brings no toast.
import type { FirstRunReport } from '../../shared/ipc/first-run'
import { invoke, subscribe } from '../ipc'
import { openSettings } from '../settings/settings-window'
import { dismissToast, showToast } from '../toast/toasts'

export const HARNESS_CLAUDE_TOAST_KEY = 'harness-claude-failed'

const ROWS: ReadonlySet<string> = new Set(['harness-claude', 'harness-claude-terminal'])

/** What follows the report; installHarnessClaudeToasts gives it the app's "Open Health", a test its own. */
export function createHarnessClaudeToasts(openHealth: () => void): (report: FirstRunReport) => void {
  const told = new Set<string>()
  return (report) => {
    const failed = report.checks.filter((check) => ROWS.has(check.id) && check.status === 'fail')
    if (failed.length === 0) {
      dismissToast(HARNESS_CLAUDE_TOAST_KEY)
      return
    }
    const fresh = failed.find((check) => !told.has(`${check.id}\u0000${check.detail}`))
    for (const check of failed) told.add(`${check.id}\u0000${check.detail}`)
    if (fresh === undefined) return
    showToast({
      kind: 'action',
      key: HARNESS_CLAUDE_TOAST_KEY,
      testId: HARNESS_CLAUDE_TOAST_KEY,
      text: `The Harness failed a check on Claude Code ${fresh.detail}`,
      actions: [{ label: 'Open Health', run: openHealth }],
    })
  }
}

let installed = false

/** Follows the Health check report of this window; once per window load (main.tsx, with the other toasts of the start). */
export function installHarnessClaudeToasts(): void {
  if (installed) return
  installed = true
  const follow = createHarnessClaudeToasts(() => openSettings('HealthSection'))
  let heard = false
  try {
    subscribe('firstRun.reportChanged', (report) => {
      heard = true
      follow(report)
    })
  } catch (error) {
    console.error('harness-claude toasts: cannot follow firstRun.reportChanged', error)
  }
  // The report main had before this window loaded; an event heard since is newer.
  void invoke('firstRun.health').then((result) => {
    if (!heard && result.ok && result.value !== null) follow(result.value)
  })
}
