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
//
// The same installer installs the Harness into Codex too (worfy-multi-vendor ticket 35,
// src/main/harness/codex-install.ts), with the Codex binary this build pins, or WORFY_CODEX_CLI when
// set (a stand-in in tests); under WORFY_CODEX=fake or absent and under vitest there is none.
//
// After an install or update in Codex the toolbar shows the step "Approve the Harness hooks in Codex"
// (worfy-multi-vendor ticket 39). Its "Check again" is `harness.codexHooks`: Codex's `hooks/list`
// through the `harnessHooks` part of the Codex driver (src/main/vendors/codex/harness-hooks.ts), the fake
// under WORFY_CODEX=fake. Once the hooks are approved the Codex part no longer has hooks to approve, and every
// window gets the status as `harness.changed`, as after an install.
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { harnessChanged, harnessCodexHooks, harnessInstall, harnessState, type HarnessHooksTrust, type HarnessStatus } from '../../shared/ipc/harness'
import { toEveryWindow } from '../broadcast'
import { bundledHarnessDir } from '../harness/bundled'
import { CodexHarness, codexInstallBinary } from '../harness/codex-install'
import { claudeCommandEnv, confirmationText, HarnessInstaller, installOffered, type InstallPlan } from '../harness/install'
import { claudeHome, dataRoot, harnessHome } from '../storage/paths'
import { bundledClaudeBinary } from '../vendors/claude/options'
import { codexHomeOf } from '../vendors/codex/account'
import { vendorDriver } from '../vendors/registry'
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
/** The Codex part of the app's installer; null when this build installs nothing into Codex. */
let codexHarness: CodexHarness | null = null

/**
 * The app's one installer: the toolbar and the first-run screen (ticket 19) share it, so two installs
 * never run at once, and each install that answers `done` reaches every window as `harness.changed`.
 */
export function appInstaller(): HarnessInstaller {
  if (installer !== null) return installer
  const env = process.env
  const runtime = { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }
  const bundledDir = bundledHarnessDir()
  const home = harnessHome(env)
  const codex = codexInstallBinary(env, runtime)
  codexHarness =
    codex === undefined
      ? null
      : new CodexHarness({
          bundledDir,
          pluginDir: join(home, 'plugin'),
          codex,
          env,
          codexHome: codexHomeOf(env),
          recordFile: join(dataRoot(env), 'harness-codex.json'),
        })
  installer = new AnnouncingInstaller({
    bundledDir,
    harnessHome: home,
    claude: env.WORFY_CLAUDE || bundledClaudeBinary(runtime),
    env: claudeCommandEnv(env),
    canInstall: installOffered({ packaged: app.isPackaged, env }),
    claudeHome: claudeHome(env),
    ...(codexHarness === null ? {} : { codex: codexHarness }),
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

/**
 * "Check again" of the step "Approve the Harness hooks in Codex": asks Codex whether the hooks of the
 * Harness are approved. Once they are, the status asks no more, and every window hears it.
 */
async function checkCodexHooks(): Promise<{ trust: HarnessHooksTrust; status: HarnessStatus }> {
  const states = appInstaller()
  // A driver without the part cannot tell: unknown, never approved.
  const trust: HarnessHooksTrust = (await vendorDriver('codex').harnessHooks?.trust()) ?? 'unknown'
  const approved = trust === 'approved' && codexHarness !== null
  if (approved) codexHarness?.hooksApproved()
  const status = await states.status()
  if (approved) toEveryWindow((client) => emit(client, harnessChanged, status))
  return { trust, status }
}

export default [
  defineHandler(harnessState, () => appInstaller().status()),
  defineHandler(harnessCodexHooks, () => checkCodexHooks()),
  defineHandler(harnessInstall, (_input, { event }) => appInstaller().install((plan) => confirmInstall(BrowserWindow.fromWebContents(event.sender), plan))),
] satisfies HandlerModule
