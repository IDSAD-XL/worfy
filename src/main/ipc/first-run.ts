// The `firstRun` domain (src/shared/ipc/first-run.ts, worfy-harness ticket 19): the checks of the
// first-run screen (src/main/first-run/checks.ts) and its actions (src/main/first-run/actions.ts)
// wired to the app — the login shell environment, a Claude Code process for the sign-in, the
// Harness installer the toolbar uses too, the move form's view of the old Harness, the Projects.
//
// Every action asks first in a native dialog whose buttons are "Confirm" and "Cancel". The mark
// that the screen was closed once is worfy's own state (ADR-0005): <data folder>/first-run.json,
// with the checks that failed at that moment. At start the screen opens by itself when there is no
// mark, or when a check fails now that did not fail then (decided without the owner, F-SPEC
// "First run"); a row marked `opensFirstRun: false` (worfy version, the Harness behind this build;
// worfy-update spec R9) does not count, nor does a row of a Project (worfy-auth-check, Q7).
// WORFY_FIRST_RUN_AUTO=0 keeps it from opening by itself (e2e runs other than its own); the command
// palette opens it always.
//
// Health check (worfy-auth-check ticket 03): every report goes through the app's HealthReports
// (src/main/first-run/health-reports.ts), which merges in the features' messages of a failure or a
// success and the rows checked over the network. The start decides on the local rows alone and
// does not wait for the network rows: they come after, in `firstRun.reportChanged`, as every
// change of the report does. The focus of a worfy window checks again the rows not in `ok` whose
// last check is over 5 minutes old (Q8).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { firstRunChecks, firstRunClose, firstRunHealth, firstRunReportChanged, firstRunRun, firstRunStartup, type Check, type CheckId, type FirstRunReport } from '../../shared/ipc/first-run'
import { DEFAULT_SETTINGS } from '../../shared/agent/settings'
import { agentEnv } from '../agent/env'
import { toEveryWindow } from '../broadcast'
import type { AccountInfoLike } from '../agent/session'
import { FirstRunActions, type Confirmation } from '../first-run/actions'
import { ACCOUNT_TIMEOUT_MS, askAccount, ghOverride, oldHarnessPresent, runChecks, type Env, type ProjectProfile } from '../first-run/checks'
import { healthReports } from '../first-run/health-reports'
import { remoteRepos } from '../github/inbox'
import { noteFirstRunReport } from '../getting-started/progress'
import { gettingStartedState } from '../getting-started/state'
import { bundledHarnessVersion } from '../harness/bundled'
import { harnessScriptEnv, recaptureForCheckAgain } from '../harness/script-env'
import { bridgeFile } from '../harness/status-line'
import { projectStore } from '../projects/store'
import { claudeHome, dataRoot, harnessHome } from '../storage/paths'
import { projectLayouts } from '../workflow/folder'
import { profileRunner } from '../workflow/profile'
import { appBuildNumber } from '../build-number'
import { bundledClaudeCodeVersion } from '../vendors/claude/account'
import { queryFactoryFromEnv } from '../vendors/claude/query'
import { appInstaller } from './harness'
import { appUpdate } from './update'
import { workflowHub } from './workflow'
import { planOptions } from './harness-migration'
import { defineHandler, emit, type HandlerModule } from './index'

/** A prompt that never sends anything: the process only answers accountInfo() and is closed. */
const silence = (): AsyncIterable<never> => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }) })

/**
 * accountInfo() of a Claude Code process started the way a Session starts it (the fake agent under
 * WORFY_AGENT=fake), in the home folder, with no prompt; the process is closed after the answer,
 * the error or ACCOUNT_TIMEOUT_MS (askAccount).
 */
function accountInfo(env: Env, signal?: AbortSignal): Promise<AccountInfoLike> {
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
  return askAccount(open, ACCOUNT_TIMEOUT_MS, signal)
}

/**
 * Whether a repository of the Project at `root` has its `origin` on github.com: the folders of its
 * layout, or the root for a Project of one repository, as the PR inbox reads them (ipc/pr-inbox.ts).
 * git only, no network; a layout that cannot be read falls back to the root.
 */
async function onGithub(root: string): Promise<boolean> {
  let folders = [root]
  try {
    const layout = await projectLayouts().get(root)
    if (layout.repos.length > 0) folders = layout.repos.map((repo) => repo.path)
  } catch {
    // the root alone
  }
  return (await remoteRepos(folders)).length > 0
}

/** The connected Projects with their Profile's name and qmd collections, through `bin/profile`, and whether they are on GitHub. */
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
        const [profile, github] = await Promise.all([field(project.path, ['--name']), onGithub(project.path)])
        if (profile === null || profile === '') return { name: project.name, profile: null, collections: [], github }
        let collections: string[] = []
        try {
          const parsed = JSON.parse((await field(project.path, ['--field', 'qmd.collections'])) ?? 'null') as unknown
          if (Array.isArray(parsed)) collections = parsed.filter((name): name is string => typeof name === 'string')
        } catch {
          // no list: no collections
        }
        return { name: project.name, profile, collections, github }
      }),
  )
}

const loginEnv = async (): Promise<Env> => (await agentEnv()).env

/** accountInfo() of a Claude Code process, as the sign-in check asks it, until `signal`: Settings → Plan asks the plan this way (src/main/ipc/plan-preset.ts). */
export const askSignedInAccount = async (signal?: AbortSignal): Promise<AccountInfoLike> => accountInfo(await loginEnv(), signal)

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
    // The build version that runs, as the Update check names it (src/main/ipc/update.ts, appRunning),
    // and its build number (worfy-update ticket 14).
    update: () => ({ snapshot: appUpdate().snapshot(), version: bundledHarnessVersion() ?? app.getVersion(), number: appBuildNumber() }),
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

/** The app's Health check report; every change of it goes to the windows. */
const health = healthReports()
health.subscribe((report) => toEveryWindow((client) => emit(client, firstRunReportChanged, report)))
// A window that gets the focus checks again the rows not in `ok`, last checked over 5 minutes ago (Q8).
app.on('browser-window-focus', () => void health.focus())

/**
 * Whether a row opens the screen at start: a `fail` not marked `opensFirstRun: false` and not a
 * row of a Project (Q7).
 */
const opensAtStart = (check: Check): boolean => check.status === 'fail' && check.opensFirstRun !== false && check.project === undefined

/** Runs the local checks (with the failures of the last actions) and hands them to the Health check report. */
async function localReport(): Promise<{ local: FirstRunReport; merged: FirstRunReport }> {
  const startedAt = Date.now()
  const local = await appActions().report()
  return { local, merged: health.setChecks(local, startedAt) }
}

/** The checks the screen showed last, for the mark. */
let lastReport: FirstRunReport | null = null
const remember = (report: FirstRunReport): FirstRunReport => {
  lastReport = report
  // Step 1 of Getting started (worfy-onboarding ticket 06): every report is heard, from the start,
  // "Check again" and an action alike. A state that cannot be written does not fail the checks.
  try {
    noteFirstRunReport(gettingStartedState(), report, process.platform)
  } catch (error) {
    console.warn('[getting-started] step 1 could not be marked', error)
  }
  return report
}

/**
 * Whether Getting started takes this user for new (decision 7): the page of the three concepts is
 * never shown to an existing user. A state that cannot be read counts as existing.
 */
function newUser(): boolean {
  try {
    return gettingStartedState().read().user === 'new'
  } catch (error) {
    console.warn('[getting-started] the state could not be read; no concepts page', error)
    return false
  }
}

export default [
  defineHandler(firstRunStartup, async () => {
    if (process.env.WORFY_FIRST_RUN_AUTO === '0') return { show: false, firstTime: false, report: null }
    const mark = readMark()
    if (mark === null) return { show: true, firstTime: newUser(), report: null }
    // A failed action counts here only while its row's check does not pass (FirstRunActions.report):
    // a cause fixed outside worfy does not open the screen. "worfy version" and the Harness behind
    // this build (opensFirstRun: false) do not either: their signal at the start is a toast
    // (worfy-update spec R9). Nor do the rows of a Project and of a feature's message (Q7); the
    // rows checked over the network are not even here: they are added after, and the start does
    // not wait for the network.
    const { local, merged } = await localReport()
    const report = remember(merged)
    const fresh = local.checks.some((check) => opensAtStart(check) && !mark.failing.includes(check.id))
    void health.checkNetwork()
    return { show: fresh, firstTime: false, report }
  }),
  // "Check again", and Settings → Health each time it shows: the login shell is captured again
  // first, so node added by an rc file since the start shows in these checks. Every Project of the
  // sidebar whose layout failed then asks it again at once with that environment, not at its retry
  // timer; the Harness scripts started after this and new Sessions get it too (worfy-harness
  // ticket 37). The hub is imported, not looked up, so this does not depend on the order in which
  // the IPC handlers are registered.
  // "Check again" waits for the network rows too: the user asked for every row.
  defineHandler(firstRunChecks, async () => {
    await recaptureForCheckAgain(workflowHub)
    const { merged } = await localReport()
    await health.checkNetwork()
    return remember(health.current() ?? merged)
  }),
  defineHandler(firstRunHealth, () => health.current()),
  defineHandler(firstRunRun, async ({ action, projectName }, { event }) => {
    asking = BrowserWindow.fromWebContents(event.sender)
    try {
      const result = await appActions().run(action, { projectName })
      const report = remember(health.setChecks(result.report))
      return { ...result, report }
    } finally {
      asking = null
    }
  }),
  defineHandler(firstRunClose, () => {
    // Only the fails that open the screen: a lagging Harness kept here would hide its later
    // not-installed or error from the start (review of PR #1129).
    writeMark({ closedAt: new Date().toISOString(), failing: (lastReport?.checks ?? []).filter(opensAtStart).map((check) => check.id) })
  }),
] satisfies HandlerModule
