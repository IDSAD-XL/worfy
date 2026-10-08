// The `harnessMigration` domain (worfy-harness ticket 14): the form that moves the old Harness out of
// ~/.claude, and the move itself after a native consent dialog. The plan and the move are
// src/main/harness/migrate/; the plugin state comes from the installer of ticket 13.
//
// The move is offered only where the installer is (installOffered): the packaged app, or a run with
// WORFY_CLAUDE_HOME (a sandbox). There `claude` and git get HOME and CLAUDE_CONFIG_DIR of the
// sandbox (claudeCommandEnv), and .claude.json is the sandbox's, so a test never reaches the real
// ~/.claude. A dev run on the real ~/.claude shows nothing to move.
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app, BrowserWindow, dialog } from 'electron'
import { harnessMigrationApply, harnessMigrationOffer, harnessMigrationPlan } from '../../shared/ipc/harness-migration'
import { bundledClaudeBinary } from '../agent/options'
import { bundledHarnessDir } from '../harness/bundled'
import { claudeCommandEnv, HarnessInstaller, installOffered } from '../harness/install'
import { applyMigration, type MigrationSummary } from '../harness/migrate/apply'
import { buildPlan, claudeJsonPath, hasLegacyHarness, type PlanOptions } from '../harness/migrate/plan'
import { claudeHome, harnessHome } from '../storage/paths'
import { defineHandler, type HandlerModule } from './index'

/** Where the move reads and writes, from the app's environment; the first-run screen (ticket 19) looks for the old Harness with it too. */
export function planOptions(): Omit<PlanOptions, 'pluginState'> {
  const env = process.env
  const commandEnv = claudeCommandEnv(env)
  const home = claudeHome(env)
  return {
    claudeHome: home,
    harnessHome: harnessHome(env),
    claudeJson: claudeJsonPath(env, home),
    userHome: commandEnv.HOME ?? homedir(),
    // The bridge of this build (ticket 15 puts it into the .app); a dev build has none of its own.
    bridgeScript: app.isPackaged ? join(process.resourcesPath, 'statusline-bridge.sh') : null,
    offered: installOffered({ packaged: app.isPackaged, env }),
    env: { ...commandEnv },
  }
}

/** The installer, only to read the plugin's state (`claude plugin list`). */
function pluginState(): ReturnType<HarnessInstaller['status']> {
  const env = process.env
  const runtime = { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }
  return new HarnessInstaller({
    bundledDir: bundledHarnessDir(),
    harnessHome: harnessHome(env),
    claude: env.WORFY_CLAUDE || bundledClaudeBinary(runtime),
    env: claudeCommandEnv(env),
    canInstall: installOffered({ packaged: app.isPackaged, env }),
  }).status()
}

/** The text of the consent dialog. */
export function migrationConfirmationText(summary: MigrationSummary): { message: string; detail: string } {
  const lines = [
    `${summary.removed} files and folders of the old Harness leave ~/.claude.`,
    summary.hooks > 0 ? `${summary.hooks} hook records leave settings.json.` : null,
    summary.sections > 0 ? `${summary.sections} sections leave CLAUDE.md.` : null,
    summary.statusLine ? 'The status line runs the bridge of this build.' : null,
    summary.qmd ? 'The qmd record leaves .claude.json.' : null,
    summary.moved > 0 ? `${summary.moved} Profiles and state folders move into the Harness home.` : null,
    '',
    `Everything is copied first to ${summary.backupDir}.`,
    `To undo the move: node ${join(summary.backupDir, 'restore.mjs')}`,
    '',
    'Claude Code sessions already running keep the old hooks: restart them afterwards.',
  ]
  return { message: 'Move the old Harness out of ~/.claude?', detail: lines.filter((line) => line !== null).join('\n') }
}

async function confirmMove(owner: BrowserWindow | null, summary: MigrationSummary): Promise<boolean> {
  const text = migrationConfirmationText(summary)
  const options = {
    type: 'question' as const,
    buttons: ['Move', 'Cancel'],
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
  defineHandler(harnessMigrationOffer, () => {
    const options = planOptions()
    return { offered: options.offered && hasLegacyHarness(options) }
  }),
  defineHandler(harnessMigrationPlan, async () => {
    const options = planOptions()
    // Without `offered` the plugin is not asked: a dev run on the real ~/.claude moves nothing.
    const state = options.offered ? (await pluginState()).state : undefined
    return buildPlan({ ...options, pluginState: state }).view
  }),
  defineHandler(harnessMigrationApply, (selection, { event }) =>
    applyMigration(selection, {
      ...planOptions(),
      pluginStatus: async () => (await pluginState()).state,
      confirm: (summary) => confirmMove(BrowserWindow.fromWebContents(event.sender), summary),
    }),
  ),
] satisfies HandlerModule
