// The app's attention core (worfy-assistant ticket 03): installAttentionCore over main's own sources, with the duties of
// ticket 07 (their duty of each item, the threshold of a silent Session, the rules of the Projects). src/main/index.ts
// starts it before the first window and stops it on `will-quit`.
import { sharedRegistry } from '../../agent/app-registry'
import { appLimits } from '../../agent/limits'
import { readRecentRuns, onJournalLine } from '../../autopilot/journal'
import { appNow } from '../../clock'
import { healthReports } from '../../first-run/health-reports'
import { appPrInboxSource } from '../../ipc/pr-inbox'
import { workflowHub } from '../../ipc/workflow'
import { projectStore } from '../../projects/store'
import { dataRoot } from '../../storage/paths'
import { appDuties, startDuties } from '../duties/app'
import type { AttentionCore } from './attention-core'
import { installAttentionCore } from './install'
import { attentionFileStore, attentionPaths } from './store'

/** How many of a Project's newest Autopilot runs the start reads back. */
const CATCH_UP_RUNS = 3

let current: AttentionCore | null = null

/** The running core; null before startAttentionCore. Tickets 06–09 and 14 read the items from it. */
export function appAttentionCore(): AttentionCore | null {
  return current
}

/** Starts the core of the app; answers the function that stops it. */
export function startAttentionCore(): () => void {
  const store = projectStore()
  const { core, stop } = installAttentionCore({
    now: appNow,
    store: attentionFileStore(attentionPaths((id) => store.dataDir(id), dataRoot())),
    projects: () => store.list(),
    sessions: sharedRegistry(),
    hub: workflowHub,
    prInbox: appPrInboxSource(),
    health: healthReports(),
    limits: appLimits(),
    journal: { onLine: onJournalLine, recent: (projectId) => readRecentRuns(projectId, { limit: CATCH_UP_RUNS }) },
    dutyOf: (event) => appDuties().dutyOf(event),
    sessionWaitMs: () => appDuties().thresholdMs('work-stalled'),
  })
  const stopDuties = startDuties(core)
  current = core
  return () => {
    stopDuties()
    stop()
    current = null
  }
}
