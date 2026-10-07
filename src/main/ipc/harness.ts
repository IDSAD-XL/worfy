// The `harness` domain (worfy-harness ticket 13): the state of the Harness plugin and its install,
// with the user's consent in a native dialog. The installer is src/main/harness/install.ts.
//
// The Claude Code binary is the SDK's (bundledClaudeBinary), or WORFY_CLAUDE when set: tests point
// it at a stub, as WORFY_GH points `gh` at one (src/main/ipc/checks.ts). With WORFY_CLAUDE_HOME (a
// sandbox) `claude` gets CLAUDE_CONFIG_DIR set to the same folder, so worfy and Claude Code see one
// ~/.claude; without it the user's environment is left as it is.
import { app, BrowserWindow, dialog } from 'electron'
import { harnessInstall, harnessState } from '../../shared/ipc/harness'
import { bundledClaudeBinary } from '../agent/options'
import { bundledHarnessDir } from '../harness/bundled'
import { confirmationText, HarnessInstaller, installOffered, type InstallPlan } from '../harness/install'
import { claudeHome, harnessHome } from '../storage/paths'
import { defineHandler, type HandlerModule } from './index'

let installer: HarnessInstaller | null = null

function appInstaller(): HarnessInstaller {
  if (installer !== null) return installer
  const env = process.env
  const runtime = { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }
  installer = new HarnessInstaller({
    bundledDir: bundledHarnessDir(),
    harnessHome: harnessHome(env),
    claude: env.WORFY_CLAUDE || bundledClaudeBinary(runtime),
    env: env.WORFY_CLAUDE_HOME ? { ...env, CLAUDE_CONFIG_DIR: claudeHome(env) } : env,
    canInstall: installOffered({ packaged: app.isPackaged, env }),
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
