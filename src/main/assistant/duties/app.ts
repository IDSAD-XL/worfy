// The duties of the running app (worfy-assistant ticket 07): one Duties over the memory file in worfy's data folder and
// the rules of each Project's settings, and the rules of the Projects armed from the Sessions' events and the items the
// attention core takes. startAttentionCore (src/main/assistant/core/app.ts) starts them with the core.
import { sharedRegistry } from '../../agent/app-registry'
import { appNow } from '../../clock'
import { readProjectAssistantRules } from '../../projects/settings'
import { projectStore } from '../../projects/store'
import { dataRoot } from '../../storage/paths'
import type { AttentionCore } from '../core/attention-core'
import { projectOfPath } from '../core/sources'
import { Duties } from './duties'
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

/** Arms the rules of the Projects over `core`; answers the function that stops it. */
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
  return () => {
    for (const stop of stops) stop()
  }
}
