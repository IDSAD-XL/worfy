// The `appSettings` domain: the app settings of this Machine (src/shared/settings/app-settings.ts).
// Main keeps them in app-settings.json (src/main/settings/store.ts) and answers here
// (src/main/ipc/app-settings.ts); the renderer asks once and follows `appSettings.changed`
// (src/renderer/settings/useAppSettings.ts). Every channel is `local`: the settings belong to the
// screen's own Machine, so a window on a Linked machine's Project reads and writes those of its own
// Machine, and a Linked machine never reaches them.
import { z } from 'zod'
import { appSettingsPatchSchema, appSettingsSchema } from '../settings/app-settings'
import { eventChannel, invokeChannel } from './channels'

/** The settings as a whole. */
export const appSettingsGet = invokeChannel('appSettings.get', z.void(), appSettingsSchema, 'local')

/** Changes the settings in parts and answers with the new state. */
export const appSettingsSet = invokeChannel('appSettings.set', appSettingsPatchSchema, appSettingsSchema, 'local')

/** Sent to every window of this Machine when the settings change, from a window or from main. */
export const appSettingsChanged = eventChannel('appSettings.changed', appSettingsSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'appSettings.get': typeof appSettingsGet
    'appSettings.set': typeof appSettingsSet
    'appSettings.changed': typeof appSettingsChanged
  }
}
