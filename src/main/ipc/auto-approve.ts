// Handlers of the `autoApproval` domain (src/shared/ipc/auto-approve.ts, worfy-auto-approve ticket
// 06): the Auto-approval switch of the Orchestrator's input field. The mode lives in app-settings.json
// of worfy's data folder (src/main/settings/store.ts, ADR-0005) and is written only here; the driver
// of a Run reads it with autoApprovalMode() of the store. A Project id that is not one of this
// Machine's Projects is refused: the mode of a Project is set on the Machine it lives on.
import { autoApprovalRead, autoApprovalSet, type AutoApprovalState } from '../../shared/ipc/auto-approve'
import { projectStore } from '../projects/store'
import { appSettingsStore, type AppSettingsStore } from '../settings/store'
import { defineHandler, type HandlerModule } from './index'

export interface AutoApprovalHandlersOptions {
  /** This Machine's Projects; the app's (projectStore) when absent. */
  projects?: () => readonly { readonly id: string }[]
  /** The settings store; the app's (appSettingsStore) when absent. */
  store?: () => AppSettingsStore
}

export function autoApprovalHandlers(options: AutoApprovalHandlersOptions = {}): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  const store = options.store ?? appSettingsStore
  const known = (projectId: string): void => {
    if (!projects().some((project) => project.id === projectId)) throw new Error(`${projectId} is not a Project of this Machine; Auto-approval is set on the Machine of its Project`)
  }
  return [
    defineHandler(autoApprovalRead, ({ projectId }): AutoApprovalState => {
      known(projectId)
      return { mode: store().autoApproval(projectId) }
    }),
    defineHandler(autoApprovalSet, ({ projectId, mode }): AutoApprovalState => {
      known(projectId)
      store().setAutoApproval(projectId, mode)
      return { mode: store().autoApproval(projectId) }
    }),
  ]
}

export default autoApprovalHandlers()
