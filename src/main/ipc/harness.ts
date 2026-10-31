// The `harness` domain (worfy-harness ticket 13): the state of the Harness plugin and its install,
// with the user's consent in a native dialog. The installer is src/main/harness/install.ts.
//
// The Claude Code binary is the SDK's (bundledClaudeBinary), or WORFY_CLAUDE when set: tests point
// it at a stub, as WORFY_GH points `gh` at one (src/main/ipc/checks.ts); a stub that is a `.mjs` runs
// under worfy's own Node on every system (src/main/program.ts). With WORFY_CLAUDE_HOME (a
// sandbox) `claude` gets CLAUDE_CONFIG_DIR and HOME inside the same folder (claudeCommandEnv), so
// worfy and Claude Code see one ~/.claude; without it the user's environment is left as it is.
//
// Every install whose answer is `done` reaches every window as `harness.changed` (ticket 40). It is
// sent from the app's one installer, not from the `harness.install` handler: the first-run screen
// installs through `firstRun.run` (src/main/ipc/first-run.ts), and every caller of appInstaller()
// is covered without remembering to announce.
import { app, BrowserWindow, dialog } from 'electron'
import { harnessChanged, harnessInstall, harnessState } from '../../shared/ipc/harness'
import { bundledClaudeBinary } from '../agent/options'
import { toEveryWindow } from '../broadcast'
import { bundledHarnessDir } from '../harness/bundled'
import { claudeCommandEnv, confirmationText, HarnessInstaller, installOffered, type InstallPlan } from '../harness/install'
import { claudeHome, harnessHome } from '../storage/paths'
import { defineHandler, emit, type HandlerModule } from './index'

type InstallResult = Awaited<ReturnType<HarnessInstaller['install']>>

/** Hear each install of the app's installer that answers `done` (worfy-update ticket 05: the Harness lag is checked again). */
const installListeners = new Set<(status: InstallResult['status']) => void>()

/** Calls `listener` after each install that answers `done`; the function returned stops it. */
export function onHarnessInstalled(listener: (status: InstallResult['status']) => void): () => void {
  installListeners.add(listener)
  return () => {
    installListeners.delete(listener)
  }
}

/** The installer that tells every window what each install ended with. */
class AnnouncingInstaller extends HarnessInstaller {
  /** The runs already announced: a second call during a run gets the same promise, and the run is announced once. */
  private readonly announced = new WeakSet<Promise<InstallResult>>()

  override install(confirm: (plan: InstallPlan) => Promise<boolean>): Promise<InstallResult> {
    const run = super.install(confirm)
    if (!this.announced.has(run)) {
      this.announced.add(run)
      // `done` is every answer that may have changed the state, a failed step included; `declined`
      // and `nothing-to-do` changed nothing. A run that throws reaches its caller, not the windows.
      run.then(
        (result) => {
          if (result.outcome !== 'done') return
          toEveryWindow((client) => emit(client, harnessChanged, result.status))
          for (const listener of installListeners) {
            try {
              listener(result.status)
            } catch (error) {
              console.error('[harness] a listener of the install failed', error)
            }
          }
        },
        () => undefined,
      )
    }
    return run
  }
}

let installer: HarnessInstaller | null = null

/**
 * The app's one installer: the toolbar and the first-run screen (ticket 19) share it, so two installs
 * never run at once, and each install that answers `done` reaches every window as `harness.changed`.
 */
export function appInstaller(): HarnessInstaller {
  if (installer !== null) return installer
  const env = process.env
  const runtime = { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }
  installer = new AnnouncingInstaller({
    bundledDir: bundledHarnessDir(),
    harnessHome: harnessHome(env),
    claude: env.WORFY_CLAUDE || bundledClaudeBinary(runtime),
    env: claudeCommandEnv(env),
    canInstall: installOffered({ packaged: app.isPackaged, env }),
    claudeHome: claudeHome(env),
  })
  return installer
}

/** The consent dialog on the window that asked; button 0 installs. */
async function confirmInstall(owner: BrowserWindow | null, plan: InstallPlan): Promise<boolean> {
  const text = confirmationText(plan)
  const options = {
    type: 'question' as const,
    buttons: [text.button, 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'worfy Harness',
    message: text.message,
    detail: text.detail,
    noLink: true,
  }
  const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
  return response === 0
}

export default [
  defineHandler(harnessState, () => appInstaller().status()),
  defineHandler(harnessInstall, (_input, { event }) => appInstaller().install((plan) => confirmInstall(BrowserWindow.fromWebContents(event.sender), plan))),
] satisfies HandlerModule
