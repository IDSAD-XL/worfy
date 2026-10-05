import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { installCardRuntime, registerCardScheme } from './cards/protocol'
import { cardStore } from './cards/store'
import { appUrlMatcher, registerIpc } from './ipc/index'
import { installAppMenu } from './menu'
import { dataRoot } from './storage/paths'
import { createMainWindow, installWebPolicy, rendererEntry } from './window'

// Electron's own files (caches, local storage) go under worfy's data root too, so a test run
// with a temporary WORFY_DATA_DIR leaves nothing in the real Application Support folder.
app.setPath('userData', dataRoot())

// Cards get their own origin on worfy-card:// (ticket 25); a scheme's privileges are set only before ready.
registerCardScheme()

void app
  .whenReady()
  .then(async () => {
    installAppMenu()
    // Handlers go in before the first window, so its first call never finds a channel missing.
    // Calls are accepted only from the renderer location the window itself loads.
    const isAppUrl = appUrlMatcher(rendererEntry())
    await registerIpc(ipcMain, { isTrustedSender: isAppUrl })
    // Navigation, new windows and permissions for every page, the window and its Cards alike.
    installWebPolicy(isAppUrl)
    installCardRuntime((host) => cardStore().locate(host))
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
  .catch((error: unknown) => {
    // A malformed handler module or a channel handled twice (ADR-0006) must stop the start, not
    // leave a Dock icon without a window: say what broke and exit with a non-zero code.
    console.error('[worfy] could not start', error)
    dialog.showErrorBox('worfy could not start', error instanceof Error ? error.message : String(error))
    app.exit(1)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
