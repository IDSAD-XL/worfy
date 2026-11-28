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
//
// GitHub access (worfy-auth-check ticket 05): a row per Project of this Machine with its origin on
// github.com, among the network rows (checkNetwork) and with its own re-check (registerRecheck), which
// always answers: what could not be checked is `unknown`. gh runs as the PR inbox runs it — WORFY_GH (a
// stand-in in tests) with worfy's own environment, else gh with the login shell's — with the account of
// the Project's Profile. "Use <login>" writes that account through `bin/profile-set` (FirstRunActions),
// then the network rows are checked again.
//
// Harness on Claude Code (worfy-harness-guarantees ticket 09): the contract set of the Harness on worfy's copy of
// Claude Code and on the terminal's (src/main/first-run/harness-claude.ts). Its rows join the network rows: they take
// seconds when a pair of versions is new, and the start does not wait for them either. Each has its re-check (the
// focus) and "Run again" (`firstRun.harnessClaude`). Under WORFY_AGENT=fake the set is fakeSetRun of
// WORFY_HARNESS_CONTRACT, and without that variable there are no such rows: the e2e runs of other features count
// the rows of Health.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { firstRunChecks, firstRunClose, firstRunHarnessClaude, firstRunHealth, firstRunReportChanged, firstRunRun, firstRunStartup, type Check, type CheckId, type FirstRunReport } from '../../shared/ipc/first-run'
import { DEFAULT_SETTINGS } from '../../shared/agent/settings'
import { agentEnv } from '../agent/env'
import { toEveryWindow } from '../broadcast'
import type { AccountInfoLike } from '../agent/session'
import { FirstRunActions, type Confirmation } from '../first-run/actions'
import {
  ACCOUNT_TIMEOUT_MS,
  askAccount,
  ghOverride,
  githubAccessRow,
  githubAccessRows,
  githubAccessUnknown,
  oldHarnessPresent,
  runChecks,
  useLoginCandidate,
  type CheckDeps,
  type Env,
  type GithubAccessDeps,
  type GithubProject,
  type ProjectProfile,
} from '../first-run/checks'
import { followHarnessRow } from '../first-run/harness-row'
import { contractSetRun, copyOfRow, fakeSetRun, HARNESS_CLAUDE_CACHE, HARNESS_CLAUDE_ROWS, HarnessClaudeCheck, terminalClaude, type ClaudeFound } from '../first-run/harness-claude'
import { healthReports } from '../first-run/health-reports'
import { appVendorRows } from '../first-run/vendor-checks'
import { remoteRepos } from '../github/inbox'
import { ghRunner } from '../github/prs'
import { noteFirstRunReport } from '../getting-started/progress'
import { gettingStartedState } from '../getting-started/state'
import { bundledHarnessDir, bundledHarnessVersion } from '../harness/bundled'
import { harnessScriptEnv, recaptureForCheckAgain } from '../harness/script-env'
import { harnessHomes, locateHarness, scriptEnv } from '../harness/locate'
import { bridgeFile } from '../harness/status-line'
import { projectStore, runGit } from '../projects/store'
import { claudeHome, dataRoot, harnessHome } from '../storage/paths'
import { projectLayouts } from '../workflow/folder'
import { HARNESS_SCRIPT_TIMEOUT_MS, profileRunner, readGithubAccount, runHarnessScript, type ProfileRun } from '../workflow/profile'
import { appBuildNumber } from '../build-number'
import { bundledClaudeCodeVersion } from '../vendors/claude/account'
import { bundledClaudeBinary } from '../vendors/claude/options'
import { queryFactoryFromEnv } from '../vendors/claude/query'
import { appInstaller, onHarnessInstalled } from './harness'
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
  return (await remoteRepos(await repoFolders(root))).length > 0
}

/** The folders of the Project's repositories: those of its layout, or the root; a layout that cannot be read falls back to the root. */
async function repoFolders(root: string): Promise<string[]> {
  try {
    const layout = await projectLayouts().get(root)
    if (layout.repos.length > 0) return layout.repos.map((repo) => repo.path)
  } catch {
    // the root alone
  }
  return [root]
}

/** The Projects of this Machine with their GitHub repositories, as the GitHub access rows read them. */
async function githubProjects(): Promise<GithubProject[]> {
  return Promise.all(
    projectStore()
      .list()
      .map(async (project) => {
        const folders = await repoFolders(project.path)
        return { id: project.id, name: project.name, root: project.path, folders, repos: await remoteRepos(folders) }
      }),
  )
}

/**
 * gh of the GitHub access rows, as the PR inbox runs it (src/main/ipc/pr-inbox.ts, appGh): WORFY_GH with the
 * app's own environment, else `gh` with the login shell's. ghEnv is that same environment.
 */
function githubAccessDeps(): GithubAccessDeps {
  const stub = process.env.WORFY_GH
  const ghEnv = async (): Promise<Env> => (stub ? process.env : await loginEnv())
  return {
    gh: ghRunner(stub ? { command: stub, env: ghEnv } : { env: ghEnv }),
    ghEnv,
    // The reason for none is the row's to say, not the log's.
    account: async (root) => readGithubAccount({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined }),
    git: runGit,
  }
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

/**
 * The Update of this copy as the checks read it: the build version that runs, as the Update check names it
 * (src/main/ipc/update.ts, appRunning), and its build number (worfy-update ticket 14).
 */
const updateDep: NonNullable<CheckDeps['update']> = () => ({ snapshot: appUpdate().snapshot(), version: bundledHarnessVersion() ?? app.getVersion(), number: appBuildNumber() })

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
    update: updateDep,
    // The Codex sign-in (worfy-auth-check ticket 08).
    vendorRows: appVendorRows,
  })
}

/**
 * `bin/profile-set` of the Harness found on the machine, with the Harness scripts' environment, as the
 * Profile's other writers run it (src/main/ipc/pipeline.ts, profileSetRunner); not imported from there,
 * which brings the whole workflow hub with it.
 */
async function profileSet(args: readonly string[]): Promise<ProfileRun> {
  const harness = locateHarness(harnessHomes(claudeHome()))
  return runHarnessScript(join(harness.binDir, 'profile-set'), args, scriptEnv(harness, await harnessScriptEnv()), { timeoutMs: HARNESS_SCRIPT_TIMEOUT_MS })
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
    githubAccount: {
      candidate: async (projectId) => {
        const project = (await githubProjects()).find((each) => each.id === projectId && each.repos.length > 0)
        return project === undefined ? null : { root: project.root, name: project.name, login: await useLoginCandidate(project, githubAccessDeps()) }
      },
      profileSet,
    },
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
// GitHub access of each Project on GitHub (worfy-auth-check ticket 05): after the local checks, and again
// after a feature's failure or on the focus. The re-check never rejects: a Project gone, or no longer on
// GitHub, drops its row (null); one whose repositories cannot be read is `unknown`.
health.registerNetworkRows(async () => githubAccessRows(await githubProjects(), githubAccessDeps()))
// The Harness row after each install and on the focus (worfy-polish 172): its «Replace Harness» item closes once it is
// done, by the installer's local state alone.
followHarnessRow(health, { harness: () => appInstaller().status(), update: updateDep }, onHarnessInstalled)
/**
 * worfy's copy of Claude Code: WORFY_CLAUDE (a stand-in in tests) or the SDK's binary, as the Harness installer runs
 * it (src/main/ipc/harness.ts); its version is the one the SDK names.
 */
function worfyClaude(): ClaudeFound {
  const binary = process.env.WORFY_CLAUDE || bundledClaudeBinary({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch })
  const version = bundledClaudeCodeVersion()
  if (binary === undefined) return { kind: 'unusable', reason: 'the Claude Code binary of this build was not found', ...(version === null ? {} : { version }) }
  return version === null ? { kind: 'unusable', reason: 'the version of the Claude Code of this build could not be read' } : { kind: 'found', binary, version }
}

const harnessClaudeSpec = process.env.WORFY_HARNESS_CONTRACT
const harnessClaude: HarnessClaudeCheck | null =
  process.env.WORFY_AGENT === 'fake' && harnessClaudeSpec === undefined
    ? null
    : new HarnessClaudeCheck({
        cacheFile: join(dataRoot(), HARNESS_CLAUDE_CACHE),
        harness: () => {
          const dir = bundledHarnessDir()
          return { dir, version: bundledHarnessVersion(dir) }
        },
        claude: async (copy) => (copy === 'worfy' ? worfyClaude() : terminalClaude(await loginEnv())),
        runSet: process.env.WORFY_AGENT === 'fake' ? fakeSetRun(harnessClaudeSpec ?? '') : contractSetRun(loginEnv),
      })
if (harnessClaude !== null) {
  health.registerNetworkRows(() => harnessClaude.rows())
  for (const copy of ['worfy', 'terminal'] as const) health.registerRecheck(HARNESS_CLAUDE_ROWS[copy], () => harnessClaude.row(copy))
}
health.registerRecheck('github-access', async (project) => {
  if (project === undefined) return null
  try {
    const found = (await githubProjects()).find((each) => each.id === project.id)
    return found === undefined ? null : await githubAccessRow(found, githubAccessDeps())
  } catch {
    return githubAccessUnknown(project, "the Project's repositories could not be read")
  }
})

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
  // "Run again" of a row "Harness on Claude Code": that row's copy runs the set anew, whatever the cache holds.
  defineHandler(firstRunHarnessClaude, async ({ id }) => {
    if (harnessClaude !== null) await health.recheckNow(id, undefined, () => harnessClaude.row(copyOfRow(id), { again: true }))
    return remember(health.current() ?? (await localReport()).merged)
  }),
  defineHandler(firstRunRun, async ({ action, projectName, projectId, login }, { event }) => {
    asking = BrowserWindow.fromWebContents(event.sender)
    try {
      const result = await appActions().run(action, { projectName, projectId, login })
      let report = remember(health.setChecks(result.report))
      // "Use <login>" changed what the GitHub access rows read: they are checked again before the answer.
      if (action === 'use-login' && result.outcome === 'done') {
        await health.checkNetwork()
        report = remember(health.current() ?? report)
      }
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
