import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, ipcMain } from 'electron'
import { bindingWorkflowOf } from '../shared/binding/resolve'
import { browserPartitions } from '../shared/browser/partition'
import { startOrchestrators } from './agent/app-orchestrators'
import { sharedRegistry } from './agent/app-registry'
import { installLimitsRefresh } from './agent/limits-usage'
import { appUserModelId } from './app-id'
import { installCardRuntime, registerCardScheme } from './cards/protocol'
import { cardStore } from './cards/store'
import { installProcessGone } from './diagnostics/process-gone'
import { BindingSignalReader } from './claude-home/binding-signals'
import { installDevDockIcon } from './dock-icon'
import { bundledHarnessVersion } from './harness/bundled'
import { liveSessionListeners, type LiveSessionsListener } from './ipc/claude-home'
import { sharedGateQueue } from './ipc/gate-queue'
import { appUrlMatcher, registerIpc } from './ipc/index'
import { appNoteLink } from './link/notes'
import { startAppLink, stopLinkOnQuit } from './link/service'
import { installAppMenu } from './menu'
import { workflowHub } from './ipc/workflow'
import { archiveRegistry, archiveSettings, AutoArchiver, sessionBindings } from './layout/archive'
import { bindingStore } from './layout/bindings'
import { layoutStore } from './layout/store'
import { appWaitsSources, electronNotifyDeps, installGateQueueNotifications, installNotifications } from './notify'
import { projectStore } from './projects/store'
import { quietWindows } from './quiet-windows'
import { checkDataFolder, inStep, reportStartupFailure } from './startup-failure'
import { claudeHome, dataRoot, setBuildKind } from './storage/paths'
import { createMainWindow, installWebPolicy, rendererEntry } from './window'

// A dev run keeps its state in a folder of its own, apart from the stable copy of worfy.app that
// runs Autopilot over worfy itself. Set before the first dataRoot() call.
setBuildKind(app.isPackaged ? 'packaged' : 'dev')

// First of all, the data folder: when WORFY_DATA_DIR names a file, the single-instance lock below
// cannot be taken in it, and the start would end as "another worfy already runs" with exit code 0.
if (dataFolderUsable()) {
  // Electron's own files (caches, local storage) go under worfy's data root too, so a test run
  // with a temporary WORFY_DATA_DIR leaves nothing in the real data folder (Application Support on
  // macOS, %APPDATA% on Windows).
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

/**
 * Starts the link service in the background. A failure — a port that cannot be taken, a key that
 * cannot be read — never stops worfy: it is a warning in the log, and appLinkProblem() keeps it for
 * the UI of worfy-link ticket 02.
 *
 * Quitting stops it (worfy-link ticket 02) in `will-quit`, after every `before-quit` wait (the
 * Autopilot's included) is over: stopLinkOnQuit.
 */
function startLink(): void {
  const warn = (error: unknown): void => console.warn(`[link] the link service did not start: ${error instanceof Error ? error.message : String(error)}`)
  try {
    startAppLink({ buildKind: app.isPackaged ? 'packaged' : 'dev', buildVersion: bundledHarnessVersion() ?? app.getVersion() }).catch(warn)
  } catch (error) {
    warn(error)
  }
  stopLinkOnQuit(app)
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

  // WORFY_QUIET_WINDOWS=1, e2e tests only (quiet-windows.ts): worfy never comes to the front, has no
  // Dock icon, and Chromium keeps painting its transparent window; WORFY_KEEP_PAINTING=1, every e2e
  // start, keeps the painting switches alone. Switches count only before ready, and the activation
  // policy is set before anything can show the Dock icon.
  const quiet = quietWindows()
  for (const name of quiet.chromiumSwitches) app.commandLine.appendSwitch(name)
  if (quiet.activationPolicy !== null) app.setActivationPolicy(quiet.activationPolicy)

  // The second process quits; the running one comes to the front instead (not in quiet mode).
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window !== undefined) {
      if (window.isMinimized()) window.restore()
      if (quiet.takesFocus) window.focus()
      return
    }
    // No window yet means startup is still on its way to the first one; after it, a start with
    // every window closed opens one, as clicking the Dock icon does.
    if (started) createMainWindow()
  })

  // Cards get their own origin on worfy-card:// (ticket 25); a scheme's privileges are set only before ready.
  registerCardScheme()

  // Windows: before the first window and the first notification, or the notifications do not show
  // or carry no name and icon of worfy (app-id.ts, worfy-windows ticket 11).
  const appId = appUserModelId(process.platform, app.isPackaged, process.execPath)
  if (appId !== null) app.setAppUserModelId(appId)

  void app
    .whenReady()
    .then(async () => {
      // Each step runs in inStep(), so a failure names the step it happened in (startup-failure.ts).
      // First, so a renderer or helper process that ends during the start is recorded too.
      inStep('installProcessGone', () => installProcessGone())
      inStep('installAppMenu', () => installAppMenu())
      // Before the first window, so a dev run never shows the Electron icon in the Dock with it.
      // Not a step that can fail the start: it turns its own failures into a warning (dock-icon.ts).
      installDevDockIcon()
      // Handlers go in before the first window, so its first call never finds a channel missing.
      // Calls are accepted only from the renderer location the window itself loads. A dev run whose
      // ELECTRON_RENDERER_URL is not an http(s) URL fails here, named as the dev server load it is.
      const isAppUrl = inStep('loadURL', () => appUrlMatcher(rendererEntry()))
      await inStep('registerIpc', () => registerIpc(ipcMain, { isTrustedSender: isAppUrl }))
      // Navigation, new windows and permissions for every page, the window and its Cards alike.
      // A Browser's <webview> attaches on the partition of a Project of this Machine (ticket 10).
      inStep('installWebPolicy', () => installWebPolicy(isAppUrl, () => browserPartitions(projectStore().list().map((project) => project.id))))
      inStep('installCardRuntime', () => installCardRuntime((host) => cardStore().locate(host)))
      // Before the first window: its creation is what opens the active Project's Orchestrator.
      inStep('startOrchestrators', () => startOrchestrators())
      // Notifications when a Session ends its turn or asks for permission (ticket 21), here and on
      // the Linked machines once the link has started (worfy-link ticket 13).
      // With them, the notification of a PR in the cross-machine gate queue that has waited over an
      // hour (worfy-windows ticket 17), for the Projects in worfy's list; and the notification of a
      // Ticket of those Projects that comes to wait for the owner (worfy-pipeline tickets 06 and 09:
      // read from the workflow hub, which watches the Ticket files and polls no gh or git).
      inStep('installNotifications', () => {
        const stopNotifications = installNotifications(sharedRegistry(), liveSessionListeners, electronNotifyDeps, appNoteLink(), appWaitsSources())
        app.on('will-quit', stopNotifications)
        const stopGateQueueNotices = installGateQueueNotifications(sharedGateQueue(), () => projectStore().list())
        app.on('will-quit', stopGateQueueNotices)
      })
      // The automatic archive of finished Sessions (worfy-canvas ticket 07, ADR-0076): main runs it
      // for the Projects of this Machine, at start and every 10 minutes. Not a startup step: worfy
      // runs without it, as without the link.
      try {
        app.on('will-quit', installAutoArchive())
      } catch (error) {
        console.error('[archive] the automatic archive did not start', error)
      }
      // The Limits asked from Claude Code every 30 minutes, at zero model tokens, while the
      // Sessions and the status line bring nothing fresh (limits-usage.ts). Not a startup step:
      // without it the Limits keep their passive sources.
      installLimitsRefresh().then(
        (stop) => app.on('will-quit', stop),
        (error: unknown) => console.error('[limits] the usage refresh did not start', error),
      )
      // A page that fails to load is reported by createMainWindow itself, as step loadURL or
      // loadFile, and only for this first window; windows opened later only log such a failure.
      inStep('createMainWindow', () => createMainWindow({ firstOfStart: true }))
      started = true
      // The link with other Machines (worfy-link ticket 01), after the handlers it serves over the
      // network, and only once the start has succeeded: a start that failed opens nothing to the
      // network. Not a startup step: worfy runs without it (startLink).
      startLink()

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

/** The workflow subscriber of the automatic archive (src/main/workflow/watch.ts). */
const ARCHIVE_WORKFLOW_SUBSCRIBER = 'auto-archive'

/**
 * Starts the automatic archive (src/main/layout/archive.ts) over the app's stores: the Layouts, the
 * Projects of this Machine, the registry under the Claude home, the Sessions worfy runs, the
 * workflow models and the Bindings. The registry watchers' reads of live Sessions bring a resumed
 * Session back at once. Returns the function that stops it.
 */
function installAutoArchive(): () => void {
  const registry = archiveRegistry({ home: claudeHome() })
  const reader = new BindingSignalReader()
  // This Machine's own call (RegistryRoot): it sees what a window of the Project sees.
  const local = (path: string) => ({ path, local: true })
  const archiver = new AutoArchiver({
    store: layoutStore(),
    projects: () => projectStore().list(),
    live: (project) => registry.live(local(project.path)),
    history: async (project) => (await registry.sessions(local(project.path))).history,
    running: () => new Set(sharedRegistry().list().filter((session) => session.state !== 'closed').flatMap((session) => (session.sdkSessionId === null ? [session.sessionId] : [session.sessionId, session.sdkSessionId]))),
    workflow: async (project) => bindingWorkflowOf(await workflowHub.open(project.path, { id: ARCHIVE_WORKFLOW_SUBSCRIBER, send: () => undefined })),
    bindings: (project, sessionIds, workflow) =>
      sessionBindings(project, sessionIds, workflow, {
        stored: (projectId) => bindingStore().get(projectId).bindings,
        transcriptPath: (root, sessionId) => registry.transcriptPath(local(root), sessionId),
        signals: (path) => reader.file(path, false),
      }),
    settings: () => archiveSettings(),
    now: Date.now,
    batchId: randomUUID,
  })
  const onLive: LiveSessionsListener = (projectRoot, live) => archiver.noteLive(projectRoot, live)
  liveSessionListeners.add(onLive)
  const stop = archiver.start()
  return () => {
    stop()
    liveSessionListeners.delete(onLive)
    void workflowHub.drop(ARCHIVE_WORKFLOW_SUBSCRIBER)
  }
}
