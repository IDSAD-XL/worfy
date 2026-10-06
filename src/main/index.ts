import { app, BrowserWindow, ipcMain } from 'electron'
import { startOrchestrators } from './agent/app-orchestrators'
import { sharedRegistry } from './agent/app-registry'
import { installCardRuntime, registerCardScheme } from './cards/protocol'
import { cardStore } from './cards/store'
import { installDevDockIcon } from './dock-icon'
import { liveSessionListeners } from './ipc/claude-home'
import { appUrlMatcher, registerIpc } from './ipc/index'
import { installAppMenu } from './menu'
import { installNotifications } from './notify'
import { checkDataFolder, inStep, reportStartupFailure } from './startup-failure'
import { dataRoot, setBuildKind } from './storage/paths'
import { createMainWindow, installWebPolicy, rendererEntry } from './window'

// A dev run keeps its state in a folder of its own, apart from the stable copy of worfy.app that
// runs Autopilot over worfy itself. Set before the first dataRoot() call.
setBuildKind(app.isPackaged ? 'packaged' : 'dev')

// First of all, the data folder: when WORFY_DATA_DIR names a file, the single-instance lock below
// cannot be taken in it, and the start would end as "another worfy already runs" with exit code 0.
if (dataFolderUsable()) {
  // Electron's own files (caches, local storage) go under worfy's data root too, so a test run
  // with a temporary WORFY_DATA_DIR leaves nothing in the real Application Support folder.
  app.setPath('userData', dataRoot())

  // One process per data root: Electron keys the lock on userData, set just above. Two processes
  // over one folder would overwrite each other's limits.json and bindings.json, so a second start
  // (the dist/ build while the stable copy runs, or a second `pnpm dev`) hands over and quits.
  if (app.requestSingleInstanceLock()) {
    start()
  } else {
    console.error(`[worfy] another worfy already runs over ${app.getPath('userData')}; quitting`)
    app.quit()
  }
}

/** Whether the data folder is usable; when it is not, the start is reported as failed. */
function dataFolderUsable(): boolean {
  try {
    inStep('checkDataFolder', () => checkDataFolder(dataRoot()))
    return true
  } catch (error) {
    reportStartupFailure(error)
    return false
  }
}

function start(): void {
  // True once the startup below has created the first window.
  let started = false

  // The second process quits; the running one comes to the front instead.
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window !== undefined) {
      if (window.isMinimized()) window.restore()
      window.focus()
      return
    }
    // No window yet means startup is still on its way to the first one; after it, a start with
    // every window closed opens one, as clicking the Dock icon does.
    if (started) createMainWindow()
  })

  // Cards get their own origin on worfy-card:// (ticket 25); a scheme's privileges are set only before ready.
  registerCardScheme()

  void app
    .whenReady()
    .then(async () => {
      // Each step runs in inStep(), so a failure names the step it happened in (startup-failure.ts).
      inStep('installAppMenu', () => installAppMenu())
      // Before the first window, so a dev run never shows the Electron icon in the Dock with it.
      inStep('installDevDockIcon', () => installDevDockIcon())
      // Handlers go in before the first window, so its first call never finds a channel missing.
      // Calls are accepted only from the renderer location the window itself loads.
      const isAppUrl = appUrlMatcher(rendererEntry())
      await inStep('registerIpc', () => registerIpc(ipcMain, { isTrustedSender: isAppUrl }))
      // Navigation, new windows and permissions for every page, the window and its Cards alike.
      inStep('installWebPolicy', () => installWebPolicy(isAppUrl))
      inStep('installCardRuntime', () => installCardRuntime((host) => cardStore().locate(host)))
      // Before the first window: its creation is what opens the active Project's Orchestrator.
      inStep('startOrchestrators', () => startOrchestrators())
      // macOS notifications when a Session ends its turn or asks for permission (ticket 21).
      inStep('installNotifications', () => installNotifications(sharedRegistry(), liveSessionListeners))
      // A page that fails to load is reported by createMainWindow itself, as step loadURL or loadFile.
      inStep('createMainWindow', () => createMainWindow())
      started = true

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
      })
    })
    .catch((error: unknown) => {
      // A malformed handler module or a channel handled twice (ADR-0006) must stop the start, not
      // leave a Dock icon without a window: say which step broke and exit with a non-zero code.
      reportStartupFailure(error)
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
