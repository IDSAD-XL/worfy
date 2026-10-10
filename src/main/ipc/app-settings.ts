// The `appSettings` IPC domain: the app settings of this Machine (src/main/settings/store.ts).
// `appSettings.get` answers with them, `appSettings.set` changes them in parts. Every change, made
// from a window or from main itself (a menu item), reaches every window as `appSettings.changed`,
// as `view.changed` does; the clients of Linked machines drop it, the channel being `local`.
import { toEveryWindow } from '../broadcast'
import { appSettingsChanged, appSettingsGet, appSettingsSet } from '../../shared/ipc/app-settings'
import { appSettingsStore } from '../settings/store'
import { defineHandler, emit, type HandlerModule } from './index'

// Creating the store reads nothing; the file is read on the first call.
appSettingsStore().on('changed', (state) => toEveryWindow((client) => emit(client, appSettingsChanged, state)))

export default [
  defineHandler(appSettingsGet, () => appSettingsStore().get()),
  defineHandler(appSettingsSet, (patch) => appSettingsStore().set(patch)),
] satisfies HandlerModule
