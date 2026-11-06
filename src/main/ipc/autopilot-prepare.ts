// The handler of `autopilot.prepare` (src/shared/ipc/autopilot-prepare.ts, worfy-autopilot-queue ticket
// 09): the facts of the Start Autopilot window, built by src/main/autopilot/prepare.ts over the app's
// sources — the same as the autopilot_start dialog's (appAutopilotStarter) and the Autopilot button's
// estimate (autopilot.estimate): the Project list, a fresh workflow read, the run journals, the app's
// Limits and the windows of the Orchestrator's Vendor, Settings → Autopilot; and the Orchestrator's
// saved Session (its Node's data in the Layout) and what keeps it busy (Orchestrators.busy).
import { budgetFromSettings } from '../../shared/autopilot/budget'
import { vendorLimitsOf } from '../../shared/autopilot/budget-window'
import { autopilotPrepare } from '../../shared/ipc/autopilot-prepare'
import { ORCHESTRATOR_KIND, readOrchestratorData } from '../../shared/ipc/orchestrator'
import { autopilotRunOf } from '../../shared/settings/app-settings'
import { sharedOrchestrators } from '../agent/app-orchestrators'
import { appLimits } from '../agent/limits'
import { readRecentRuns } from '../autopilot/journal'
import { prepareAutopilot, type PrepareSources } from '../autopilot/prepare'
import { harnessScriptEnv } from '../harness/script-env'
import { layoutStore } from '../layout/store'
import { projectStore } from '../projects/store'
import { appSettingsStore } from '../settings/store'
import { claudeHome } from '../storage/paths'
import { readWorkflow } from '../workflow/reader'
import { defineHandler, type HandlerModule } from './index'

/** The Orchestrator's saved Session id, from its Node in the Project's Layout; null without one. */
function savedSession(projectId: string): string | null {
  const node = layoutStore()
    .get(projectId)
    .layout.nodes.find((each) => each.kind === ORCHESTRATOR_KIND)
  return node === undefined ? null : (readOrchestratorData(node.data).sessionId ?? null)
}

const appSources: PrepareSources = {
  projectName: (projectId) => projectStore().get(projectId).name,
  workflow: async (projectId) => (await readWorkflow({ root: projectStore().get(projectId).path, claudeHome: claudeHome(), env: harnessScriptEnv })).model,
  runs: (projectId) => readRecentRuns(projectId),
  limits: () => appLimits().snapshot(),
  settings: () => {
    const settings = appSettingsStore().get()
    return { run: autopilotRunOf(settings), budget: budgetFromSettings(settings) }
  },
  now: () => Date.now(),
  vendor: (projectId) => sharedOrchestrators().runsOn(projectId),
  // As appVendorLimits of the button's estimate (ipc/autopilot.ts), not imported: that module starts the link question on load.
  vendorLimits: (projectId) => {
    const vendor = sharedOrchestrators().runsOn(projectId)
    return vendorLimitsOf(vendor, appLimits().windowsOf(vendor))
  },
  session: savedSession,
  busy: (projectId) => sharedOrchestrators().busy(projectId),
}

/** The handler over `sources`; tests pass their own. */
export function autopilotPrepareHandlers(sources: PrepareSources = appSources): HandlerModule {
  return [defineHandler(autopilotPrepare, (input) => prepareAutopilot(sources, input))]
}

export default autopilotPrepareHandlers() satisfies HandlerModule
