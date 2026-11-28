// The Health check row `harness` kept current between full runs (worfy-polish 172), so its item in Waits («Replace
// Harness») closes once the user did it:
//
// - after each install of the app's installer that answered `done` (Install, Update or Replace from the version
//   popover or First run; onHarnessInstalled of src/main/ipc/harness.ts), with the state that install answered;
// - on the focus of a worfy window, when the row is not `ok` and was checked over 5 minutes ago (the re-check
//   registered here; HealthReports.focus): a Replace made in a terminal.
//
// Each reads only the installer's local state and the Update state as last read (harnessCheck): no call to GitHub. The
// row `ok` closes its item by the path of every `ok` row (healthAttention of src/main/assistant/core/sources.ts). No
// Electron here: src/main/ipc/first-run.ts wires it to the app.
import type { HarnessStatus } from '../../shared/ipc/harness'
import { harnessCheck, type CheckDeps } from './checks'
import type { HealthReports } from './health-reports'

/** Registers the re-check of the row `harness` and follows the installs; answers the function that stops following them. */
export function followHarnessRow(
  health: Pick<HealthReports, 'registerRecheck' | 'recheckNow'>,
  deps: Pick<CheckDeps, 'harness' | 'update'>,
  onInstalled: (listener: (status: HarnessStatus) => void) => () => void,
): () => void {
  health.registerRecheck('harness', () => harnessCheck(deps))
  return onInstalled((status) => void health.recheckNow('harness', undefined, () => harnessCheck(deps, status)))
}
