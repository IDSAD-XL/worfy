// The duties of the running app (worfy-assistant ticket 07): one Duties over the memory file in worfy's data folder and
// the rules of each Project's settings, and the rules of the Projects armed from the Sessions' events and the items the
// attention core takes; the check of the CI of the main branches (ticket 21) in the scheduler of checks while its duty
// is enabled. startAttentionCore (src/main/assistant/core/app.ts) starts them with the core.
import { sharedRegistry } from '../../agent/app-registry'
import { appNow } from '../../clock'
import { remoteRepos } from '../../github/inbox'
import { sharedPrTracker } from '../../ipc/checks'
import { readProjectAssistantRules } from '../../projects/settings'
import { projectStore } from '../../projects/store'
import { dataRoot } from '../../storage/paths'
import { projectLayouts } from '../../workflow/folder'
import type { AttentionCore } from '../core/attention-core'
import { projectOfPath } from '../core/sources'
import { checkScheduler } from '../schedule/app'
import { Duties } from './duties'
import { followMainCiDuty, MAIN_CI_DUTY, mainCiCheck } from './main-ci-check'
import { assistantMemoryPath, memoryFileStore } from './memory'
import { projectRuleAttention } from './rules'

let shared: Duties | undefined

/** The duties of the running app; creating them reads no disk. Tickets 09, 14 and 15 read and change them here. */
export function appDuties(): Duties {
  shared ??= new Duties({
    now: appNow,
    store: memoryFileStore(assistantMemoryPath(dataRoot())),
    projects: () => projectStore().list().map((project) => project.id),
    projectRules: (projectId) => readProjectAssistantRules(projectStore().dataDir(projectId)),
  })
  return shared
}

/** The folders of a Project's repositories: those of its layout, or its root for a Project of one repository. */
async function repoFolders(root: string): Promise<string[]> {
  const layout = await projectLayouts().get(root)
  return layout.repos.length > 0 ? layout.repos.map((repo) => repo.path) : [root]
}

/**
 * The check of the CI of the main branches (ticket 21) in the scheduler of checks of the app, while its duty is
 * enabled. gh goes through the app's PR tracker, as the account the Project's PR badges are read with.
 */
function startMainCiCheck(core: AttentionCore, duties: Duties): () => void {
  const run = mainCiCheck({
    projects: () => projectStore().list().map((project) => ({ id: project.id, root: project.path })),
    repos: async (root) => remoteRepos(await repoFolders(root)),
    gh: (root, args) => sharedPrTracker().gh(root, args),
    core,
    thresholdMs: () => duties.thresholdMs(MAIN_CI_DUTY),
    now: appNow,
  })
  return followMainCiDuty(checkScheduler(), duties, run)
}

/** Arms the rules of the Projects and the check of the main branches' CI over `core`; answers the function that stops it. */
export function startDuties(core: AttentionCore, log: (message: string, error: unknown) => void = (message, error) => console.warn(message, error)): () => void {
  const duties = appDuties()
  const rules = projectRuleAttention(core, (projectId) => duties.projectRules(projectId), (cwd) => projectOfPath(projectStore().list(), cwd), appNow)
  // A rule that fails (an unreadable settings file) is logged and costs that event only.
  const guard =
    <A extends unknown[]>(take: (...args: A) => void) =>
    (...args: A): void => {
      try {
        take(...args)
      } catch (error) {
        log('[assistant] a rule of a Project could not be armed', error)
      }
    }
  const stops = [sharedRegistry().observe(guard(rules.session)), core.onItem(guard(rules.item))]
  // A memory file that cannot be read costs the check of the main branches only, not the core.
  try {
    stops.push(startMainCiCheck(core, duties))
  } catch (error) {
    log('[assistant] the check of the CI of the main branches did not start', error)
  }
  return () => {
    for (const stop of stops) stop()
  }
}
