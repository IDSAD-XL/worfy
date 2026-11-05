// Handlers of the `autoApproval` domain (src/shared/ipc/auto-approve.ts, worfy-auto-approve ticket
// 06): the Auto-approval switch of the Orchestrator's input field. The mode lives in app-settings.json
// of worfy's data folder (src/main/settings/store.ts, ADR-0005) and is written only here; the driver
// of a Run reads it with autoApprovalMode() of the store. A Project id that is not one of this
// Machine's Projects is refused: the mode of a Project is set on the Machine it lives on.
//
// The sender check of src/main/ipc/index.ts passes any call that comes from worfy's window. While
// worfy runs with a debugging port or the Node inspector open (debugAccess()), a call from the window
// may be any local process scripting it — an agent's shell command included, which could also start
// worfy with such a flag itself. Then Shadow and On are refused, Off goes through (it only takes
// approval away), and the read says that Off is in force and why.
//
// A Linked machine with full access reads and sets the mode through the link (worfy-retry ticket 13):
// the handlers run here, on the Machine of the Project, and the check of its own debugging port is
// that Machine's `linked.invoke` (src/main/ipc/linked.ts); `autoApproval.blockedHere` tells its window
// why. A write that changed the saved mode reaches every client as `autoApproval.changed`.
import {
  autoApprovalBlockedHere,
  autoApprovalChanged,
  autoApprovalDebugRefusal,
  autoApprovalRead,
  autoApprovalSet,
  type AutoApprovalState,
} from '../../shared/ipc/auto-approve'
import { toEveryWindow } from '../broadcast'
import { projectStore } from '../projects/store'
import { appSettingsStore, debugAccess as runningDebugAccess, type AppSettingsStore } from '../settings/store'
import { defineHandler, emit, type HandlerModule } from './index'

export interface AutoApprovalHandlersOptions {
  /** This Machine's Projects; the app's (projectStore) when absent. */
  projects?: () => readonly { readonly id: string }[]
  /** The settings store; the app's (appSettingsStore) when absent. */
  store?: () => AppSettingsStore
  /** Why Shadow and On cannot be trusted now, or null; the running app's check (debugAccess) when absent. */
  debugAccess?: () => string | null
}

export function autoApprovalHandlers(options: AutoApprovalHandlersOptions = {}): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  const store = options.store ?? appSettingsStore
  const debugAccess = options.debugAccess ?? runningDebugAccess
  const known = (projectId: string): void => {
    if (!projects().some((project) => project.id === projectId)) throw new Error(`${projectId} is not a Project of this Machine; Auto-approval is set on the Machine of its Project`)
  }
  const stateOf = (projectId: string): AutoApprovalState => {
    const saved = store().autoApproval(projectId)
    const blocked = debugAccess()
    return { mode: blocked === null ? saved : 'off', saved, blocked }
  }
  return [
    defineHandler(autoApprovalRead, ({ projectId }): AutoApprovalState => {
      known(projectId)
      return stateOf(projectId)
    }),
    defineHandler(autoApprovalSet, ({ projectId, mode }): AutoApprovalState => {
      known(projectId)
      const blocked = debugAccess()
      if (blocked !== null && mode !== 'off') throw new Error(autoApprovalDebugRefusal(blocked))
      const before = store().autoApproval(projectId)
      store().setAutoApproval(projectId, mode)
      const state = stateOf(projectId)
      if (state.saved !== before) toEveryWindow((client) => emit(client, autoApprovalChanged, { projectId, state }))
      return state
    }),
    defineHandler(autoApprovalBlockedHere, () => ({ blocked: debugAccess() })),
  ]
}

export default autoApprovalHandlers()
