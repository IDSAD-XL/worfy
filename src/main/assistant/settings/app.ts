// Settings → Assistant in the running app (worfy-assistant ticket 15): the view of panel.ts over the app's duties, the
// scheduler of checks, the usage ledger and the Limits, and what the section changes there. After a change the section of
// the rail is told (AssistantWindow.changed): the window asks the view again on each `assistant.changed`.
import type { CheckKind } from '../../../shared/assistant/schedule/settings'
import type { AssistantSettingsView, CheckNowRefusal } from '../../../shared/assistant/settings-view'
import type { DutyChoice } from '../duties/duties'
import { appLimits } from '../../agent/limits'
import { projectStore } from '../../projects/store'
import { appAssistantUsage } from '../budget/ledger'
import { appDuties } from '../duties/app'
import { checkScheduler } from '../schedule/app'
import { appAssistant } from '../session/app'
import { appAssistantWindow } from '../window/app'
import { assistantSettingsView, checkDutyProjects } from './panel'

/** What Settings → Assistant reads and changes in main; the IPC handlers (src/main/ipc/assistant.ts) call it. */
export interface AssistantSettingsPanel {
  view(): AssistantSettingsView
  configureDuty(id: string, choice: DutyChoice): void
  resumeDuty(id: string): void
  setPauseAfter(count: number): void
  /** Starts the check now; `refused` says why it did not start (CheckScheduler.whyNotNow). */
  checkNow(kind: CheckKind): { started: boolean; refused: CheckNowRefusal | null }
}

/** The panel of the running app. */
export function appAssistantSettings(): AssistantSettingsPanel {
  const duties = appDuties()
  const told = <T>(result: T): T => {
    appAssistantWindow().changed()
    return result
  }
  return {
    view: () => {
      const ledger = appAssistantUsage()
      return assistantSettingsView({
        running: () => appAssistant() !== null,
        duties,
        projects: () => projectStore().list(),
        checks: checkScheduler(),
        usage: () => ledger.summary(),
        shares: () => ledger.limitsShare(appLimits().snapshot()),
        wakesToday: () => ledger.automaticWakesToday(),
      })
    },
    configureDuty: (id, choice) => {
      // The Projects a duty covers are this Machine's (ticket 25): checked before anything changes.
      checkDutyProjects(id, choice, { duties, projects: () => projectStore().list() })
      told(duties.configure(id, choice))
    },
    resumeDuty: (id) => told(duties.resume(id)),
    setPauseAfter: (count) => told(duties.setPauseAfter(count)),
    checkNow: (kind) => {
      const scheduler = checkScheduler()
      const refused = scheduler.whyNotNow(kind)
      return told(refused === null ? { started: scheduler.runNow(kind), refused: null } : { started: false, refused })
    },
  }
}
