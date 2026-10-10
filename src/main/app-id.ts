// The Application User Model ID of worfy on Windows (worfy-windows ticket 11). Windows shows a
// notification, with the app's name and icon, only for a process whose AppUserModelId is the one of
// a shortcut in the Start menu. No Electron at run time here: src/main/index.ts makes the call.

/** `appId` of electron-builder.yml: the id the installer writes into the Start menu shortcut. */
export const APP_ID = 'dev.worfy.app'

/**
 * The id to set before the first window and the first notification; null where there is none to
 * set (macOS takes the bundle id, Linux the desktop file). A dev run has no installer and no
 * shortcut of its own: Electron's documentation (Notifications, Windows) says to pin
 * node_modules\electron\dist\electron.exe to the Start menu and to use its path as the id.
 */
export function appUserModelId(platform: NodeJS.Platform, packaged: boolean, execPath: string): string | null {
  if (platform !== 'win32') return null
  return packaged ? APP_ID : execPath
}
