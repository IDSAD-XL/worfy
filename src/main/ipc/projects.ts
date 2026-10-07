import { BrowserWindow, dialog } from 'electron'
import {
  projectsAdd,
  projectsChanged,
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
import { currentHarness } from '../harness/locate'
import { readProjectSettings, writeProjectSettings } from '../projects/settings'
import { projectStore } from '../projects/store'
import { defineHandler, emit, type HandlerModule } from './index'

const store = projectStore()

// Every window hears about every change, whoever made it: a select from one window, or a later
// part of main that switches the Project. A client keeps the state with the highest revision, so
// two broadcasts that finish out of order do not roll the list back.
store.onChange(() => {
  void store
    .state()
    .then((state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) emit(window.webContents, projectsChanged, state)
      }
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

  defineHandler(projectsAdd, async ({ path }) => {
    const result = await store.add(path)
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

  defineHandler(projectsRemove, ({ id }) => {
    store.remove(id)
    return store.state()
  }),

  defineHandler(projectsSettingsGet, ({ id }) => readProjectSettings(store.dataDir(store.get(id).id))),

  // The defaults of the Harness on the machine now: the old one's or the plugin's (worfy-harness ticket 12).
  defineHandler(projectsSettingsDefaults, () => defaultProjectSettings(currentHarness().kind)),

  defineHandler(projectsSettingsSet, ({ id, settings }) => {
    const saved = writeProjectSettings(store.dataDir(store.get(id).id), settings)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) emit(window.webContents, projectsSettingsChanged, { id, settings: saved })
    }
    return saved
  }),
] satisfies HandlerModule
