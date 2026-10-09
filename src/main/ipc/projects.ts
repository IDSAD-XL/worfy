import { BrowserWindow, dialog } from 'electron'
import {
  projectsAdd,
  projectsChanged,
  projectsHold,
  projectsList,
  projectsPickFolder,
  projectsRemove,
  projectsSelect,
  projectsSettingsChanged,
  projectsSettingsDefaults,
  projectsSettingsGet,
  projectsSettingsSet,
} from '../../shared/ipc/projects'
import { defaultProjectSettings } from '../../shared/projects/action-templates'
import { toEveryWindow } from '../broadcast'
import { clientOf } from '../clients'
import { currentHarness } from '../harness/locate'
import { isRemoteCall } from '../link/caller'
import { projectHolds } from '../projects/holds'
import { readProjectSettings, writeProjectSettings } from '../projects/settings'
import { projectStore } from '../projects/store'
import { defineHandler, emit, type HandlerModule } from './index'

const store = projectStore()

// Every client hears about every change, whoever made it: a select from one window, or a later
// part of main that switches the Project. A client keeps the state with the highest revision, so
// two broadcasts that finish out of order do not roll the list back.
store.onChange(() => {
  void store
    .state()
    .then((state) => {
      toEveryWindow((client) => emit(client, projectsChanged, state))
    })
    .catch((error: unknown) => console.error('[projects] could not broadcast the change', error))
})

export default [
  defineHandler(projectsPickFolder, async (_input, { event }) => {
    const options: Electron.OpenDialogOptions = {
      title: 'Add project',
      message: 'Choose the folder of a git repository',
      buttonLabel: 'Add project',
      properties: ['openDirectory', 'createDirectory'],
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  }),

  defineHandler(projectsList, () => store.state()),

  // A Linked machine adds and removes Projects without switching the active one: that is the state
  // of this Machine's screens (projects.select is not open to it at all).
  defineHandler(projectsAdd, async ({ path }, { event }) => {
    const result = await store.add(path, { keepActive: isRemoteCall(event) })
    if (result.status === 'rejected') return result
    const state = await store.state()
    const project = state.projects.find((item) => item.id === result.project.id)
    if (!project) throw new Error(`the added Project ${result.project.id} is not in the list`)
    return { status: 'added' as const, project, notice: result.notice, state }
  }),

  defineHandler(projectsSelect, ({ id }) => {
    store.select(id)
    return store.state()
  }),

  defineHandler(projectsRemove, ({ id }, { event }) => {
    store.remove(id, { keepActive: isRemoteCall(event) })
    return store.state()
  }),

  // A screen of a Linked machine shows a Project of this Machine (worfy-link ticket 09): its
  // Orchestrator and documents stay open (projects/holds.ts); the active Project stays as it is.
  defineHandler(projectsHold, ({ screen, projectId }, { event }) => {
    const client = clientOf(event)
    if (client === undefined) throw new Error('the call came from no client')
    // Only a Project of the list: an unknown id throws here.
    const id = projectId === null ? null : store.get(projectId).id
    if (!projectHolds().set(client, screen, id)) throw new Error('the client is gone')
    return { projectId: id }
  }),

  defineHandler(projectsSettingsGet, ({ id }) => readProjectSettings(store.dataDir(store.get(id).id))),

  // The defaults of the Harness on the machine now: the old one's or the plugin's (worfy-harness ticket 12).
  defineHandler(projectsSettingsDefaults, () => defaultProjectSettings(currentHarness().kind)),

  defineHandler(projectsSettingsSet, ({ id, settings }) => {
    const saved = writeProjectSettings(store.dataDir(store.get(id).id), settings)
    toEveryWindow((client) => emit(client, projectsSettingsChanged, { id, settings: saved }))
    return saved
  }),
] satisfies HandlerModule
