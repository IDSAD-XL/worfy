// The `firstRun` domain (src/shared/ipc/first-run.ts, worfy-harness ticket 19): the checks of the
// first-run screen (src/main/first-run/checks.ts) and its actions (src/main/first-run/actions.ts)
// wired to the app — the login shell environment, a Claude Code process for the sign-in, the
// Harness installer the toolbar uses too, the move form's view of the old Harness, the Projects.
//
// Every action asks first in a native dialog whose buttons are "Confirm" and "Cancel". The mark
// that the screen was closed once is worfy's own state (ADR-0005): <data folder>/first-run.json,
// with the checks that failed at that moment. At start the screen opens by itself when there is no
// mark, or when a check fails now that did not fail then (decided without the owner, F-SPEC
// "First run"). WORFY_FIRST_RUN_AUTO=0 keeps it from opening by itself (e2e runs other than its own);
// the command palette opens it always.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { firstRunChecks, firstRunClose, firstRunRun, firstRunStartup, type CheckId, type FirstRunReport } from '../../shared/ipc/first-run'
import { DEFAULT_SETTINGS } from '../../shared/agent/settings'
import { queryFactoryFromEnv } from '../agent/app-registry'
import { agentEnv } from '../agent/env'
import type { AccountInfoLike } from '../agent/session'
import { FirstRunActions, type Confirmation } from '../first-run/actions'
import { ACCOUNT_TIMEOUT_MS, askAccount, ghOverride, oldHarnessPresent, runChecks, type Env, type ProjectProfile } from '../first-run/checks'
import { harnessScriptEnv, recaptureForCheckAgain } from '../harness/script-env'
import { bridgeFile } from '../harness/status-line'
import { projectStore } from '../projects/store'
import { claudeHome, dataRoot, harnessHome } from '../storage/paths'
import { profileRunner } from '../workflow/profile'
import { appInstaller } from './harness'
import { workflowHub } from './workflow'
import { planOptions } from './harness-migration'
import { defineHandler, type HandlerModule } from './index'

/** `claudeCodeVersion` of the Agent SDK this build carries (Q20); null when its package.json cannot be read. */
export function bundledClaudeCodeVersion(): string | null {
  try {
    const sdk = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk')
    const manifest = JSON.parse(readFileSync(join(dirname(sdk), 'package.json'), 'utf8')) as { claudeCodeVersion?: unknown }
    return typeof manifest.claudeCodeVersion === 'string' ? manifest.claudeCodeVersion : null
  } catch {
    return null
  }
}

/** A prompt that never sends anything: the process only answers accountInfo() and is closed. */
const silence = (): AsyncIterable<never> => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }) })

/**
 * accountInfo() of a Claude Code process started the way a Session starts it (the fake agent under
 * WORFY_AGENT=fake), in the home folder, with no prompt; the process is closed after the answer,
 * the error or ACCOUNT_TIMEOUT_MS (askAccount).
 */
function accountInfo(env: Env): Promise<AccountInfoLike> {
  const open = () =>
    queryFactoryFromEnv()({
      prompt: silence(),
      cwd: env.HOME ?? homedir(),
      resume: undefined,
      stderr: () => undefined,
      settings: { ...DEFAULT_SETTINGS, permissionMode: 'default' },
      canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'the first-run check runs no tools' }),
      unattended: false,
    })
  return askAccount(open, ACCOUNT_TIMEOUT_MS)
}

/** The connected Projects with their Profile's name and qmd collections, through `bin/profile`. */
async function projectProfiles(env: Env): Promise<ProjectProfile[]> {
  const run = profileRunner(claudeHome(), env)
  const field = async (root: string, args: string[]): Promise<string | null> => {
    try {
      const result = await run(root, ['-C', root, ...args])
      return result.code === 0 ? result.stdout.trim() : null
    } catch {
      return null
    }
  }
  return Promise.all(
    projectStore()
      .list()
      .map(async (project) => {
        const profile = await field(project.path, ['--name'])
        if (profile === null || profile === '') return { name: project.name, profile: null, collections: [] }
        let collections: string[] = []
        try {
          const parsed = JSON.parse((await field(project.path, ['--field', 'qmd.collections'])) ?? 'null') as unknown
          if (Array.isArray(parsed)) collections = parsed.filter((name): name is string => typeof name === 'string')
        } catch {
          // no list: no collections
        }
        return { name: project.name, profile, collections }
      }),
  )
}

const loginEnv = async (): Promise<Env> => (await agentEnv()).env

/** The Limits bridge of this build (worfy-windows ticket 13); a dev build has none of its own. */
const limitsBridge = (): string | null => (app.isPackaged ? bridgeFile(process.platform, process.resourcesPath) : null)

async function checks(): Promise<FirstRunReport> {
  const env = await loginEnv()
  return runChecks({
    env,
    gh: ghOverride(process.env),
    scriptEnv: harnessScriptEnv,
    bundledClaudeCodeVersion: bundledClaudeCodeVersion(),
    accountInfo: () => accountInfo(env),
    harness: () => appInstaller().status(),
    legacyHarness: () => oldHarnessPresent(planOptions()),
    homes: { harnessHome: harnessHome(), claudeHome: claudeHome() },
    projects: () => projectProfiles(env),
    limitsBridge: limitsBridge(),
  })
}

/** The dialog of an action, on the window that asked; only "Confirm" (button 0) runs it. */
async function confirmIn(owner: BrowserWindow | null, confirmation: Confirmation): Promise<boolean> {
  const options = {
    type: 'question' as const,
    buttons: ['Confirm', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'worfy first run',
    message: confirmation.message,
    detail: confirmation.detail,
    noLink: true,
  }
  const { response } = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
  return response === 0
}

/** The window the current action asks in; set per call, as the actions run one at a time. */
let asking: BrowserWindow | null = null
let actions: FirstRunActions | null = null

function appActions(): FirstRunActions {
  actions ??= new FirstRunActions({
    checks,
    confirm: (confirmation) => confirmIn(asking, confirmation),
    env: loginEnv,
    homes: { harnessHome: harnessHome(), claudeHome: claudeHome() },
    installHarness: (confirm) => appInstaller().install(confirm),
    projects: async () => projectProfiles(await loginEnv()),
    binDir: join(harnessHome(), 'plugin', 'bin'),
    limits: { settingsFile: join(claudeHome(), 'settings.json'), bridge: limitsBridge(), platform: process.platform },
  })
  return actions
}

/** The mark that the screen was closed once: when, and which checks failed then. */
interface Mark {
  closedAt: string
  failing: CheckId[]
}

export const FIRST_RUN_MARK = 'first-run.json'

function readMark(): Mark | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dataRoot(), FIRST_RUN_MARK), 'utf8')) as Partial<Mark>
    return { closedAt: String(parsed.closedAt ?? ''), failing: Array.isArray(parsed.failing) ? parsed.failing : [] }
  } catch {
    return null
  }
}

function writeMark(mark: Mark): void {
  const dir = dataRoot()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, FIRST_RUN_MARK)
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(mark, null, 2)}\n`)
  renameSync(tmp, file)
}

/** The checks the screen showed last, for the mark. */
let lastReport: FirstRunReport | null = null
const remember = (report: FirstRunReport): FirstRunReport => {
  lastReport = report
  return report
}

export default [
  defineHandler(firstRunStartup, async () => {
    if (process.env.WORFY_FIRST_RUN_AUTO === '0') return { show: false, report: null }
    const mark = readMark()
    if (mark === null) return { show: true, report: null }
    // A failed action counts here only while its row's check does not pass (FirstRunActions.report):
    // a cause fixed outside worfy does not open the screen.
    const report = remember(await appActions().report())
    const fresh = report.checks.some((check) => check.status === 'fail' && !mark.failing.includes(check.id))
    return { show: fresh, report }
  }),
  // "Check again", and Settings → Health each time it shows: the login shell is captured again
  // first, so node added by an rc file since the start shows in these checks. Every Project of the
  // sidebar whose layout failed then asks it again at once with that environment, not at its retry
  // timer; the Harness scripts started after this and new Sessions get it too (worfy-harness
  // ticket 37). The hub is imported, not looked up, so this does not depend on the order in which
  // the IPC handlers are registered.
  defineHandler(firstRunChecks, async () => {
    await recaptureForCheckAgain(workflowHub)
    return remember(await appActions().report())
  }),
  defineHandler(firstRunRun, async ({ action, projectName }, { event }) => {
    asking = BrowserWindow.fromWebContents(event.sender)
    try {
      const result = await appActions().run(action, { projectName })
      remember(result.report)
      return result
    } finally {
      asking = null
    }
  }),
  defineHandler(firstRunClose, () => {
    writeMark({ closedAt: new Date().toISOString(), failing: (lastReport?.checks ?? []).filter((check) => check.status === 'fail').map((check) => check.id) })
  }),
] satisfies HandlerModule
