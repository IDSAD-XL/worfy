// Handlers of the `autoContinue` domain (src/shared/ipc/auto-continue.ts, worfy-retry ticket 02): the
// Auto-continue item of the Orchestrator's Modes menu. The setting lives in app-settings.json of worfy's
// data folder (src/main/settings/store.ts, ADR-0005) and is written only here; the retry of the
// Orchestrator's turn reads it with autoContinueOn() of the store. A Project id that is not one of this
// Machine's Projects is refused: the setting of a Project is set on the Machine it lives on — from a
// window of a Linked machine too, through the link (worfy-retry ticket 13). A write that changes the
// setting reaches every client as `autoContinue.changed` — the windows of this Machine and the Linked
// machines with access — so a menu open anywhere shows it at once.
import { toEveryWindow } from '../broadcast'
import { autoContinueChanged, autoContinueRead, autoContinueSet, type AutoContinueState } from '../../shared/ipc/auto-continue'
import { projectStore } from '../projects/store'
import { appSettingsStore, type AppSettingsStore } from '../settings/store'
import { defineHandler, emit, type HandlerModule } from './index'

export interface AutoContinueHandlersOptions {
  /** This Machine's Projects; the app's (projectStore) when absent. */
  projects?: () => readonly { readonly id: string }[]
  /** The settings store; the app's (appSettingsStore) when absent. */
  store?: () => AppSettingsStore
}

export function autoContinueHandlers(options: AutoContinueHandlersOptions = {}): HandlerModule {
  const projects = options.projects ?? (() => projectStore().list())
  const store = options.store ?? appSettingsStore
  const known = (projectId: string): void => {
    if (!projects().some((project) => project.id === projectId)) throw new Error(`${projectId} is not a Project of this Machine; Auto-continue is set on the Machine of its Project`)
  }
  return [
    defineHandler(autoContinueRead, ({ projectId }): AutoContinueState => {
      known(projectId)
      return { on: store().autoContinue(projectId) }
    }),
    defineHandler(autoContinueSet, ({ projectId, on }): AutoContinueState => {
      known(projectId)
      const before = store().autoContinue(projectId)
      store().setAutoContinue(projectId, on)
      const after = store().autoContinue(projectId)
      if (after !== before) toEveryWindow((client) => emit(client, autoContinueChanged, { projectId, on: after }))
      return { on: after }
    }),
  ]
}

export default autoContinueHandlers()
