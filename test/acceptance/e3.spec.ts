import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { _electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { NO_WINDOW_RESTORE, repoRoot } from '../e2e/helpers'

// The acceptance run of the worfy-harness Epic (ticket 26): the packaged worfy.app with the real
// agent, on a machine whose Claude home is empty — the sandbox of scripts/e3-sandbox.sh (HOME,
// CLAUDE_CONFIG_DIR and npm_config_prefix in one folder of its own, ~/Library/Application
// Support/worfy-e3-sandbox; gh accounts and the keychain are the machine's). Two tests:
//
//   sandbox  the first-run screen shows every check; Install puts the Harness of this build into the
//            sandbox and `claude plugin list` there names it enabled; qmd installs with consent; its
//            models are skipped (downloaded only with E3_QMD_MODELS=1)
//   silent   a Silent Project over a fresh repository pushed to E3_SILENT_REPO (an empty private
//            GitHub repository the owner made) connects through "Add project"; the Epic of
//            fixtures/silent-epic/ goes into its Workflow folder; Autopilot runs its one Wave until
//            epic-status says the Ticket is done; then no workflow trace is in the repository, its
//            branches, commits or PRs
//
// Both start by reading the sign-in row of the first-run screen: without the owner's /login in the
// sandbox they stop with NO_LOGIN, as a failure — a skip would let the command exit 0. Until that
// row is ok nothing leaves the machine: `silent` reads the gh token and pushes only after it.
// Run: `pnpm package`, then `pnpm test:acceptance -g sandbox` and
// `E3_SILENT_REPO=<owner>/<name> pnpm test:acceptance -g silent`. The command holds the shared
// Electron lock /tmp/worfy-e2e.lock (scripts/e3-sandbox.sh lock-run); a test that starts the app
// refuses to run without it. What a failed test keeps (the trace, the page as it was) is in
// test-results-acceptance/<start time>/, which no other run cleans.
//
// Running `sandbox` again: `bash scripts/e3-sandbox.sh reset-harness` first (it keeps the sign-in).
// Running `silent` again: it pushes its `main` into E3_SILENT_REPO once the sign-in row is ok, so
// after any run that got that far the repository is no longer empty and the next run stops with
// REPO_NOT_EMPTY. The owner then deletes the repository and makes it again, empty and private
// (`gh repo delete <owner>/<name> --yes`, `gh repo create <owner>/<name> --private`), or names
// another empty one in E3_SILENT_REPO. Agents create and delete no repositories.

const SANDBOX_SCRIPT = join(repoRoot, 'scripts', 'e3-sandbox.sh')
const FIXTURES = join(repoRoot, 'test', 'acceptance', 'fixtures')
const EPIC = 'e3-acceptance'
const TICKET_SLUG = 'first-task'
const ACCOUNT = process.env.E3_GH_ACCOUNT ?? 'IDSAD-XL'
const NO_LOGIN = 'не проверено: нет входа в песочнице — шаг владельца'
const NO_REPO = 'не проверено: нет E3_SILENT_REPO (пустой private-репозиторий на GitHub) — шаг владельца'
const REPO_NOT_EMPTY = 'is not empty: this run pushes its own main there. The owner deletes it and makes it again, empty and private, or names another empty repository in E3_SILENT_REPO'
const WAVE_TIMEOUT_MS = 90 * 60_000
/** The checks of the first-run screen (Q22), in the order the screen shows them. */
const CHECK_IDS = ['claude-login', 'claude-version', 'git', 'git-identity', 'gh', 'node', 'jq', 'gh-auth', 'harness', 'harness-dependencies', 'harness-scripts', 'legacy-harness', 'qmd', 'qmd-models', 'qmd-collections']
/** Files of the workflow that must never reach a Silent Project's repository. */
const WORKFLOW_FILES = [/(^|\/)\.scratch(\/|$)/, /(^|\/)HANDOFF(\.md)?$/i, /(^|\/)docs\/adr\//, /(^|\/)adr\/\d{4}-/, /(^|\/)CONTEXT\.md$/, /(^|\/)lessons\//]
/**
 * The Claude attribution lines, as bin/silent-check knows them: the trailer in either letter case
 * ("Co-Authored-By", and the "Co-authored-by" GitHub writes on a squash merge) and the PR line with or
 * without its link.
 */
const ATTRIBUTION = [/Co-Authored-By:[ \t]*Claude[^\n]*/gi, /Generated with \[?Claude Code[^\n]*/gi]

// ── The search for this run's own values ────────────────────────────────────

/**
 * What no text of the run may contain: the Epic's name, the Ticket's slug, `<epic>/01`, the path of
 * the Workflow folder, `.scratch` and `worfy-harness`. It is searched for apart from silent-check,
 * so a trace that slipped past the guard and silent-check (one code) is still found.
 */
function runValues(workflowFolder: string): string[] {
  // macOS temp paths have two spellings, /var/folders/… and /private/var/folders/…: both count.
  const folders = existsSync(workflowFolder) ? [workflowFolder, realpathSync(workflowFolder)] : [workflowFolder]
  return [...new Set([EPIC, TICKET_SLUG, `${EPIC}/01`, ...folders, '.scratch', 'worfy-harness'])]
}

/** A text with every value of this run in it: what the control step plants. */
const plantedTrace = (workflowFolder: string): string => `Merge ${EPIC}/01 (${TICKET_SLUG}): see ${workflowFolder}/x.md, .scratch/${EPIC} and worfy-harness`

/** The values of `values` that `text` contains, case-insensitively, in the order of `values`. */
function tracesIn(text: string, values: readonly string[]): string[] {
  const lower = text.toLowerCase()
  return values.filter((value) => value !== '' && lower.includes(value.toLowerCase()))
}

/** The Claude attribution lines `text` carries, each from its first word to the end of its line. */
function attributionIn(text: string): string[] {
  return ATTRIBUTION.flatMap((pattern) => text.match(pattern) ?? []).map((line) => line.trim())
}

/**
 * The lines of `text` with the address Claude signs commits with. ATTRIBUTION repeats the patterns of
 * bin/silent-check, so it misses what silent-check misses — a trailer without the word "Claude"
 * (`Co-authored-by: Opus 5.5 <noreply@anthropic.com>`). This sign does not depend on those patterns.
 */
function anthropicAddressIn(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => /noreply@anthropic\.com/i.test(line))
    .map((line) => line.trim())
}

/**
 * What is wrong with one text the repository or GitHub shows to people: what silent-check says of it,
 * the values of this run, and the Claude attribution lines. The lines count whatever the Profile and
 * silent-check say: a Silent Project is connected with attribution off, and a Profile that came out
 * with `on` must fail the run rather than switch this search off.
 */
function textProblems(what: string, text: string, values: readonly string[], check: Run): string[] {
  const problems: string[] = []
  if (check.status !== 0) problems.push(`silent-check, ${what}: exit ${check.status} ${check.stdout.trim()} ${check.stderr.trim()}`)
  const found = tracesIn(text, values)
  if (found.length > 0) problems.push(`${what}: ${found.join(', ')}`)
  const attributed = attributionIn(text)
  for (const line of attributed) problems.push(`${what}: Claude attribution "${line}"`)
  // A line the patterns above already reported is not reported twice.
  for (const line of anthropicAddressIn(text)) if (!attributed.some((found) => line.includes(found))) problems.push(`${what}: a line with noreply@anthropic.com "${line}"`)
  return problems
}

// ── Processes ───────────────────────────────────────────────────────────────

type Env = Record<string, string>
interface Run {
  status: number | null
  stdout: string
  stderr: string
}

function run(command: string, args: readonly string[], options: { cwd?: string; env?: Env; input?: string } = {}): Run {
  const result = spawnSync(command, args, { cwd: options.cwd, env: options.env, input: options.input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** A command that must exit 0; its output and the command line (never the environment) on failure. */
function ok(command: string, args: readonly string[], options: { cwd?: string; env?: Env; input?: string } = {}): string {
  const result = run(command, args, options)
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}: ${result.stderr.trim() || result.stdout.trim()}`)
  return result.stdout.trim()
}

function requireLock(): void {
  if (process.env.E3_LOCK_HELD !== '1') {
    throw new Error('Run through `pnpm test:acceptance`: it holds the shared Electron lock /tmp/worfy-e2e.lock (scripts/e3-sandbox.sh lock-run).')
  }
}

// ── The sandbox ─────────────────────────────────────────────────────────────

interface Sandbox {
  root: string
  env: Env
  /** CLAUDE_CONFIG_DIR of the sandbox. */
  claude: string
  /** The Harness plugin the app installs there. */
  plugin: string
  /** Whether `gh auth token -u <account>` answered in the sandbox environment. */
  gh: boolean
}

/** Creates the sandbox (or keeps it) and reads its environment from scripts/e3-sandbox.sh. */
function sandbox(): Sandbox {
  const init = run('bash', [SANDBOX_SCRIPT, 'init'], { env: { ...process.env, E3_GH_ACCOUNT: ACCOUNT } as Env })
  if (init.status !== 0 && init.status !== 3) throw new Error(`e3-sandbox.sh init exited ${init.status}: ${init.stderr.trim()}`)
  const env: Env = {}
  for (const line of ok('bash', [SANDBOX_SCRIPT, 'env'], { env: process.env as Env }).split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1)
  }
  const claude = env.CLAUDE_CONFIG_DIR
  if (!claude || !env.HOME) throw new Error('e3-sandbox.sh env printed no HOME or CLAUDE_CONFIG_DIR')
  return {
    root: ok('bash', [SANDBOX_SCRIPT, 'path'], { env: process.env as Env }),
    env,
    claude,
    plugin: join(claude, 'worfy-harness', 'plugin'),
    gh: init.status === 0,
  }
}

/** A new working folder of this run inside the sandbox. */
function runDir(box: Sandbox, name: string): string {
  const dir = join(box.root, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** A command in the sandbox environment only. */
const inSandbox = (box: Sandbox, command: string, args: readonly string[], options: { cwd?: string; env?: Env; input?: string } = {}): Run =>
  run(command, args, { ...options, env: { ...box.env, ...options.env } })

/** `claude plugin list --json` in the sandbox: the entry of the worfy plugin, if any. */
function worfyPlugin(box: Sandbox): { status: number | null; entry?: { id: string; version?: string; enabled?: boolean } } {
  const result = inSandbox(box, 'claude', ['plugin', 'list', '--json'], { cwd: box.env.HOME })
  if (result.status !== 0) return { status: result.status }
  const list = JSON.parse(result.stdout) as { id: string; version?: string; enabled?: boolean }[]
  return { status: 0, entry: list.find((plugin) => plugin.id.startsWith('worfy@')) }
}

// ── The app ─────────────────────────────────────────────────────────────────

/** dist/mac*\/worfy.app of `pnpm package`, or WORFY_PACKAGED_APP. */
function packagedApp(): string {
  if (process.env.WORFY_PACKAGED_APP) return process.env.WORFY_PACKAGED_APP
  const dist = join(repoRoot, 'dist')
  const apps = existsSync(dist)
    ? readdirSync(dist)
        .filter((name) => name.startsWith('mac'))
        .map((name) => join(dist, name, 'worfy.app'))
        .filter((app) => existsSync(app))
    : []
  if (apps.length !== 1) throw new Error(`Expected exactly one dist/mac*/worfy.app, found ${apps.length}: run \`pnpm package\`, or set WORFY_PACKAGED_APP.`)
  return apps[0] as string
}

/** The build version of the app, `<semver>+<SHA>`: the version of the Harness copy it carries. */
const appVersion = (app: string): string =>
  (JSON.parse(readFileSync(join(app, 'Contents', 'Resources', 'harness', '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version

interface Launched {
  app: ElectronApplication
  window: Page
  close: () => Promise<void>
}

/** What launchd gives an app started from Finder (worfy-harness ticket 37): no node, no gh, no claude on it. */
const FINDER_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

/**
 * Starts the packaged app in the sandbox environment with a data folder of its own: the real agent,
 * the real gh and claude, the first-run screen opening by itself. Only the link server is kept on
 * loopback without Bonjour, so no macOS network prompt stops the run. The app gets the PATH of
 * Finder, as on the user's Mac: it finds the tools through the sandbox's login shell, whose
 * `.zshenv` and `.profile` set the sandbox PATH (scripts/e3-sandbox.sh). This test's own commands
 * keep the sandbox environment.
 */
async function launch(box: Sandbox, app: string, dataDir: string): Promise<Launched> {
  const env: Env = { ...box.env, PATH: FINDER_PATH, WORFY_DATA_DIR: dataDir, WORFY_LINK_HOST: '127.0.0.1', WORFY_LINK_BONJOUR: '0' }
  const electron = await _electron.launch({ executablePath: join(app, 'Contents', 'MacOS', 'worfy'), args: NO_WINDOW_RESTORE, env, cwd: box.env.HOME })
  const child = electron.process()
  try {
    const window = await electron.firstWindow({ timeout: 60_000 })
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900))
    return {
      app: electron,
      window,
      close: async () => {
        const closed = await Promise.race([electron.close().then(() => true), new Promise<false>((done) => setTimeout(() => done(false), 30_000))])
        if (!closed) child.kill('SIGKILL')
      },
    }
  } catch (error) {
    child.kill('SIGKILL')
    throw error
  }
}

/** Replaces the message box in main: every dialog of an action is answered with Confirm. */
async function confirmDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (() => Promise.resolve({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
}

/** "Add project" picks `folder` instead of opening the system folder dialog. */
async function pickFolder(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, folder)
}

/** The first-run screen once its checks are in. */
async function firstRunScreen(window: Page): Promise<Locator> {
  const screen = window.getByTestId('first-run')
  await expect(screen, 'the first-run screen opens by itself on a fresh data folder').toBeVisible({ timeout: 60_000 })
  await expect(screen.locator('[data-check]')).toHaveCount(CHECK_IDS.length, { timeout: 120_000 })
  await expect(screen.getByTestId('first-run-summary')).not.toHaveText('Checking…', { timeout: 120_000 })
  return screen
}

const checkRow = (screen: Locator, id: string): Locator => screen.locator(`[data-check="${id}"]`)

/** What a row of the screen says, on one line. */
const rowText = async (row: Pick<Locator, 'innerText'>): Promise<string> => (await row.innerText()).replace(/\s+/g, ' ').trim()

/** The first step of both tests: the sign-in row. Without the owner's /login the run stops here. */
async function expectSignedIn(screen: Locator): Promise<void> {
  const row = checkRow(screen, 'claude-login')
  const status = await row.getAttribute('data-status')
  if (status !== 'ok') throw new Error(`${NO_LOGIN} (the Sign-in row: ${status}, "${await rowText(row)}")`)
}

/**
 * Waits until a row of the first-run screen has `status`. When it does not within `timeoutMs`, the
 * error carries what the row says: the reason of a failed install is on the screen and nowhere
 * else, and the log of the run is what stays of it.
 */
async function expectRowStatus(row: Pick<Locator, 'getAttribute' | 'innerText'>, what: string, status: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let seen: string | null
  for (;;) {
    seen = await row.getAttribute('data-status')
    if (seen === status) return
    if (Date.now() >= deadline) break
    await new Promise((done) => setTimeout(done, Math.min(500, Math.max(1, deadline - Date.now()))))
  }
  throw new Error(`${what}: the row is "${String(seen)}", not "${status}", after ${Math.round(timeoutMs / 1000)} s. The row says: "${await rowText(row)}"`)
}

/** The least time one read of the "Add project" dialog gets: enough to read a dialog that is there, also when the wait is over. */
const DIALOG_READ_GRACE_MS = 5_000

/**
 * Waits until the "Add project" dialog shows the form of the draft (`data-step="form"`). A draft
 * that failed stops the wait at once: no form follows `failed`, and the reason — what Claude Code
 * said when it exited — is in the dialog and nowhere else. Either way the error carries what the
 * dialog says.
 *
 * Every read of the dialog gets what is left of `timeoutMs` as its own timeout (never less than
 * DIALOG_READ_GRACE_MS): a read of a dialog that is gone — closed while the draft was written —
 * would otherwise wait until the timeout of the whole test. A read that is refused ends the wait
 * with the same error, with the refusal where the dialog's text would be.
 */
async function expectDraftForm(dialog: Pick<Locator, 'getAttribute' | 'innerText'>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const left = (): number => Math.max(DIALOG_READ_GRACE_MS, deadline - Date.now())
  const unread = (error: unknown): string => `The dialog could not be read: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`
  const says = (): Promise<string> => dialog.innerText({ timeout: left() }).then((text) => `The dialog says: "${text.replace(/\s+/g, ' ').trim()}"`, unread)
  let seen: string | null = null
  for (;;) {
    try {
      seen = await dialog.getAttribute('data-step', { timeout: left() })
    } catch (error) {
      throw new Error(`The draft of the real agent: the dialog is at "${String(seen)}", not "form". ${unread(error)}`, { cause: error })
    }
    if (seen === 'form') return
    if (seen === 'failed') throw new Error(`The draft of the real agent failed. ${await says()}`)
    if (Date.now() >= deadline) break
    await new Promise((done) => setTimeout(done, Math.min(500, Math.max(1, deadline - Date.now()))))
  }
  throw new Error(`The draft of the real agent: the dialog is at "${String(seen)}", not "form", after ${Math.round(timeoutMs / 1000)} s. ${await says()}`)
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('silent: control — the search for this run’s values finds a planted trace (no app)', () => {
  const folder = '/tmp/sandbox/home/.claude/harness-home/projects/silent-app/workflow'
  const values = runValues(folder)
  // Every value, written out here and not taken from runValues: a value dropped there fails this.
  expect(tracesIn(plantedTrace(folder), values)).toEqual(['e3-acceptance', 'first-task', 'e3-acceptance/01', folder, '.scratch', 'worfy-harness'])
  expect(tracesIn(`Merge ${EPIC}/01: start ${EPIC}`, values)).toEqual([EPIC, `${EPIC}/01`])
  expect(tracesIn('Add greet(name) with a node:test test', values)).toEqual([])
  expect(tracesIn(`see ${folder.toUpperCase()}/x.md`, values)).toEqual([folder])
})

test('silent: control — a text with a Claude attribution line is a problem, whatever silent-check said of it (no app)', () => {
  const values = runValues('/tmp/sandbox/home/.claude/harness-home/projects/silent-app/workflow')
  // silent-check passed the text: what a Profile with attribution on would make it answer.
  const passed = { status: 0, stdout: 'silent-check: clean (Silent mode)\n', stderr: '' }
  // The commit trailer of the run of 2026-10-12, its other letter case, and the PR line with and without the link.
  const lines = [
    'Co-authored-by: Claude Opus 5.5 <noreply@anthropic.com>',
    'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
    'Generated with Claude Code',
  ]
  for (const line of lines) {
    const found = line.replace('🤖 ', '')
    expect(attributionIn(`Add greet(name)\n\n${line}\n`), line).toEqual([found])
    expect(textProblems('a commit message on refs/heads/main', `Add greet(name)\n\n${line}`, values, passed), line).toEqual([`a commit message on refs/heads/main: Claude attribution "${found}"`])
  }
  // Both lines in one PR body: one problem each.
  expect(textProblems('PR body (add-greet)', `Adds greet(name).\n\n${lines[2]}\n\n${lines[0]}`, values, passed)).toEqual([
    `PR body (add-greet): Claude attribution "${lines[0]}"`,
    'PR body (add-greet): Claude attribution "Generated with [Claude Code](https://claude.com/claude-code)"',
  ])
  // The address alone is a problem: a trailer silent-check and the patterns above do not know, in either letter case.
  for (const line of ['Co-authored-by: Opus 5.5 <noreply@anthropic.com>', 'Signed-off-by: Assistant <NoReply@Anthropic.com>']) {
    expect(attributionIn(`Add greet(name)\n\n${line}`), line).toEqual([])
    expect(anthropicAddressIn(`Add greet(name)\n\n  ${line}  \n`), line).toEqual([line])
    expect(textProblems('a commit message on refs/heads/main', `Add greet(name)\n\n${line}`, values, passed), line).toEqual([`a commit message on refs/heads/main: a line with noreply@anthropic.com "${line}"`])
    expect(textProblems('PR body (add-greet)', `Adds greet(name).\n\n${line}`, values, passed), line).toEqual([`PR body (add-greet): a line with noreply@anthropic.com "${line}"`])
  }
  // One text with a line the patterns know and another that carries only the address: both are named, each once.
  expect(textProblems('PR body (add-greet)', `Adds greet(name).\n\n${lines[2]}\n\nCo-authored-by: Opus 5.5 <noreply@anthropic.com>\n${lines[0]}`, values, passed)).toEqual([
    `PR body (add-greet): Claude attribution "${lines[0]}"`,
    'PR body (add-greet): Claude attribution "Generated with [Claude Code](https://claude.com/claude-code)"',
    'PR body (add-greet): a line with noreply@anthropic.com "Co-authored-by: Opus 5.5 <noreply@anthropic.com>"',
  ])
  // A clean text, another person as a co-author and the words in a sentence are not attribution.
  for (const clean of ['Add greet(name) with a node:test test', 'Add greet(name)\n\nCo-authored-by: Ann Lee <ann@example.com>', 'Describe how a Claude Code session starts']) {
    expect(attributionIn(clean), clean).toEqual([])
    expect(anthropicAddressIn(clean), clean).toEqual([])
    expect(textProblems('PR title (add-greet)', clean, values, passed), clean).toEqual([])
  }
  // The other two searches still report through the same function.
  const refused = { status: 1, stdout: 'stdin:1: ticket number "Ticket 05"\n', stderr: '' }
  expect(textProblems('PR title (x)', `Ticket 05 of ${EPIC}`, values, refused)).toEqual(['silent-check, PR title (x): exit 1 stdin:1: ticket number "Ticket 05" ', `PR title (x): ${EPIC}`])
})

test('sandbox: control — a row that does not turn ok fails with what the row says (no app)', async () => {
  const stuck = { getAttribute: () => Promise.resolve('fail'), innerText: () => Promise.resolve('Failed  Harness plugin\nerror at install\nRetry') }
  await expect(expectRowStatus(stuck, 'Install the Harness', 'ok', 50)).rejects.toThrow('Install the Harness: the row is "fail", not "ok", after 0 s. The row says: "Failed Harness plugin error at install Retry"')
  let reads = 0
  const turns = { getAttribute: () => Promise.resolve(++reads < 3 ? 'fail' : 'ok'), innerText: () => Promise.resolve('') }
  await expectRowStatus(turns, 'Install the Harness', 'ok', 5_000)
  expect(reads).toBe(3)
})

test('silent: control — a draft that failed stops the wait at once with what the dialog says (no app)', async () => {
  const says = 'Add project\nDraft\nFailed  The draft Session failed: Claude Code process exited with code 1. stderr: Error: --json-schema is not a valid JSON Schema'
  let reads = 0
  const failed = { getAttribute: () => Promise.resolve(++reads < 2 ? 'drafting' : 'failed'), innerText: () => Promise.resolve(says) }
  const started = Date.now()
  await expect(expectDraftForm(failed, 30_000)).rejects.toThrow(
    'The draft of the real agent failed. The dialog says: "Add project Draft Failed The draft Session failed: Claude Code process exited with code 1. stderr: Error: --json-schema is not a valid JSON Schema"',
  )
  expect(reads).toBe(2)
  expect(Date.now() - started).toBeLessThan(10_000)
  const stuck = { getAttribute: () => Promise.resolve('drafting'), innerText: () => Promise.resolve('Add project\nDraft\nReading the repositories') }
  await expect(expectDraftForm(stuck, 50)).rejects.toThrow('The draft of the real agent: the dialog is at "drafting", not "form", after 0 s. The dialog says: "Add project Draft Reading the repositories"')
  reads = 0
  const turns = { getAttribute: () => Promise.resolve(++reads < 3 ? 'drafting' : 'form'), innerText: () => Promise.resolve('') }
  await expectDraftForm(turns, 5_000)
  expect(reads).toBe(3)
  // A step that is neither the form nor a failure is not the form: the Harness check stopped the draft.
  const harness = { getAttribute: () => Promise.resolve('harness'), innerText: () => Promise.resolve('Add project\nHarness\nThe Harness plugin is not installed') }
  await expect(expectDraftForm(harness, 50)).rejects.toThrow('The draft of the real agent: the dialog is at "harness", not "form", after 0 s. The dialog says: "Add project Harness The Harness plugin is not installed"')
})

test('silent: control — a read of the draft dialog gets what is left of the wait, and a refused read ends it (no app)', async () => {
  // Playwright refuses a read of an element that is not there when the timeout of the read is over.
  const refusal = (): Promise<never> => Promise.reject(new Error('locator.getAttribute: Timeout 29500ms exceeded.\nCall log:\n  - waiting for getByTestId(\'connect-project\')'))
  const timeouts: unknown[] = []
  let reads = 0
  const gone = {
    getAttribute: (_name: string, options?: { timeout?: number }) => (timeouts.push(options?.timeout), ++reads < 2 ? Promise.resolve('drafting') : refusal()),
    innerText: () => Promise.resolve('never read'),
  }
  await expect(expectDraftForm(gone, 30_000)).rejects.toThrow('The draft of the real agent: the dialog is at "drafting", not "form". The dialog could not be read: locator.getAttribute: Timeout 29500ms exceeded.')
  expect(reads).toBe(2)
  // What is left of the 30 s, not a constant and not "no timeout": the first read starts with all of it.
  expect(timeouts).toEqual([expect.any(Number), expect.any(Number)])
  expect(timeouts[0]).toBeGreaterThan(25_000)
  expect(timeouts[0]).toBeLessThanOrEqual(30_000)
  expect(timeouts[1]).toBeLessThanOrEqual(timeouts[0] as number)
  // The text of a failed draft is read with a timeout too; when that read is refused the error still names the failure.
  const textTimeouts: unknown[] = []
  const closing = {
    getAttribute: () => Promise.resolve('failed'),
    innerText: (options?: { timeout?: number }) => (textTimeouts.push(options?.timeout), Promise.reject(new Error('locator.innerText: Target page, context or browser has been closed'))),
  }
  await expect(expectDraftForm(closing, 30_000)).rejects.toThrow('The draft of the real agent failed. The dialog could not be read: locator.innerText: Target page, context or browser has been closed')
  expect(textTimeouts).toEqual([expect.any(Number)])
  expect(textTimeouts[0]).toBeGreaterThan(25_000)
  expect(textTimeouts[0]).toBeLessThanOrEqual(30_000)
  // When the wait is over a read still gets the least time, not zero: zero would mean "no timeout" to Playwright.
  const late: unknown[] = []
  const stuck = {
    getAttribute: (_name: string, options?: { timeout?: number }) => (late.push(options?.timeout), Promise.resolve('drafting')),
    innerText: (options?: { timeout?: number }) => (late.push(options?.timeout), Promise.resolve('Add project')),
  }
  await expect(expectDraftForm(stuck, 0)).rejects.toThrow('The draft of the real agent: the dialog is at "drafting", not "form", after 0 s. The dialog says: "Add project"')
  expect(late).toEqual([5_000, 5_000])
})

test('sandbox: the packaged app installs its Harness and qmd into an empty Claude home', async () => {
  test.setTimeout(process.env.E3_QMD_MODELS === '1' ? 90 * 60_000 : 20 * 60_000)
  requireLock()
  const app = packagedApp()
  const version = appVersion(app)
  const box = sandbox()
  // Before the start, read now and asserted after the sign-in step.
  const harnessBefore = existsSync(join(box.claude, 'worfy-harness'))
  const pluginBefore = worfyPlugin(box)
  const launched = await launch(box, app, join(runDir(box, 'sandbox'), 'data'))
  try {
    const { window } = launched
    const screen = await firstRunScreen(window)
    await expectSignedIn(screen)
    expect(harnessBefore, `before the start: no worfy-harness/ in ${box.claude}`).toBe(false)
    expect(pluginBefore.status, 'claude plugin list --json in the sandbox before the start').toBe(0)
    expect(pluginBefore.entry, 'before the start: no worfy plugin in the sandbox').toBeUndefined()

    expect(await screen.locator('[data-check]').evaluateAll((rows) => rows.map((each) => each.getAttribute('data-check')))).toEqual(CHECK_IDS)
    await expect(checkRow(screen, 'harness')).toHaveAttribute('data-status', 'fail')

    // Install → Confirm → the Harness of this build in the sandbox, enabled in Claude Code.
    await confirmDialogs(launched.app)
    await checkRow(screen, 'harness').getByRole('button', { name: /^Install/ }).click()
    await expectRowStatus(checkRow(screen, 'harness'), 'Install the Harness', 'ok', 5 * 60_000)
    await expect(checkRow(screen, 'harness')).toContainText(version)
    expect(version).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{7,}/)
    const installed = JSON.parse(readFileSync(join(box.plugin, '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }
    expect(installed.version, 'the installed plugin.json carries the build version of the .app').toBe(version)
    const plugin = worfyPlugin(box)
    expect(plugin.status, 'claude plugin list --json in the sandbox').toBe(0)
    expect(plugin.entry).toMatchObject({ id: 'worfy@worfy-harness', enabled: true, version })
    // The same Install puts in the plugin's dependency (mattpocock-skills): its own row says so.
    await expectRowStatus(checkRow(screen, 'harness-dependencies'), 'Install the plugin dependencies', 'ok', 60_000)
    // The installed Harness's scripts run as the Epics read runs them: node from the login shell.
    await expectRowStatus(checkRow(screen, 'harness-scripts'), 'Run the Harness scripts', 'ok', 60_000)

    // qmd with consent: npm installs it under npm_config_prefix of the sandbox.
    await checkRow(screen, 'qmd').getByRole('button', { name: 'Install…' }).click()
    await expectRowStatus(checkRow(screen, 'qmd'), 'Install qmd', 'ok', 10 * 60_000)
    const qmd = join(box.root, 'npm', 'bin', 'qmd')
    const qmdVersion = inSandbox(box, qmd, ['--version'])
    expect(qmdVersion.status, `${qmd} --version: ${qmdVersion.stderr}`).toBe(0)

    // The models (about 2 GB): skipped, so search goes through qmd.fallback_grep; downloaded only on request.
    const models = checkRow(screen, 'qmd-models')
    if (process.env.E3_QMD_MODELS === '1') {
      await models.getByRole('button', { name: 'Download…' }).click()
      await expectRowStatus(models, 'Download the qmd models', 'ok', 80 * 60_000)
      await expect(models).toContainText('downloaded')
      const search = inSandbox(box, qmd, ['query', 'worfy'])
      expect(search.status, `qmd query in the sandbox: ${search.stderr}`).toBe(0)
    } else {
      await models.getByRole('button', { name: 'Skip…' }).click()
      await expectRowStatus(models, 'Skip the qmd models', 'ok', 60_000)
      await expect(models).toContainText('skipped')
    }
  } finally {
    await launched.close()
  }
})

test('silent: a Silent Project connects, one Wave runs, and no workflow trace reaches the repository or GitHub', async () => {
  test.setTimeout(WAVE_TIMEOUT_MS + 30 * 60_000)
  requireLock()
  const remote = process.env.E3_SILENT_REPO
  if (!remote) throw new Error(NO_REPO)
  if (!/^[\w.-]+\/[\w.-]+$/.test(remote)) throw new Error(`E3_SILENT_REPO is <owner>/<name>, not ${remote}`)
  const app = packagedApp()
  const box = sandbox()
  const bin = join(box.plugin, 'bin')
  // GH_TOKEN of the account, once the sandbox is known to be signed in. It stays in this process's
  // memory and is never printed. git authenticates through `gh auth git-credential` (the sandbox
  // .gitconfig), which takes GH_TOKEN before gh's active account: the active account of the
  // machine may not reach E3_SILENT_REPO.
  const ghEnv: Env = {}
  const url = `https://github.com/${remote}.git`

  // The repository: fresh, from the fixture. Nothing of it leaves the machine yet.
  const work = runDir(box, 'silent')
  const repo = join(work, 'silent-app')
  cpSync(join(FIXTURES, 'silent-repo'), repo, { recursive: true })
  const git = (...args: string[]): string => ok('git', args, { cwd: repo, env: { ...box.env, ...ghEnv } })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'Initial commit')
  const base = git('rev-parse', 'HEAD')

  const dataDir = join(work, 'data')
  const launched = await launch(box, app, dataDir)
  let workflowFolder: string | undefined
  try {
    const { window } = launched
    const screen = await firstRunScreen(window)
    await expectSignedIn(screen)

    // Signed in: only now the token is read and `main` is pushed to the empty GitHub repository. A
    // push before this step would leave the repository not empty for a run that then stops.
    if (!box.gh) throw new Error(`не проверено: gh auth token -u ${ACCOUNT} в env песочницы не ответил (bash scripts/e3-sandbox.sh check-gh)`)
    if (!existsSync(join(bin, 'profile'))) throw new Error(`no Harness in the sandbox (${box.plugin}): run \`pnpm test:acceptance -g sandbox\` first`)
    ghEnv.GH_TOKEN = ok('gh', ['auth', 'token', '--hostname', 'github.com', '-u', ACCOUNT], { env: box.env })
    expect(git('ls-remote', url), `${remote} ${REPO_NOT_EMPTY}`).toBe('')
    git('remote', 'add', 'origin', url)
    git('push', '-q', '-u', 'origin', 'main')

    await screen.getByRole('button', { name: 'Close' }).click()
    await expect(screen).toBeHidden()

    // Connect through "Add project": Silent mode, the default Workflow folder, the account with access.
    await pickFolder(launched.app, repo)
    await window.getByRole('button', { name: 'Add project' }).click()
    const dialog = window.getByTestId('connect-project')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('connect-mode-silent').getByRole('radio')).toBeChecked()
    await dialog.getByRole('button', { name: 'Write draft' }).click()
    await expectDraftForm(dialog, 15 * 60_000)
    const account = dialog.getByTestId('connect-github').locator(`[data-testid="connect-github-account"][data-login="${ACCOUNT}"]`)
    await expect(account).toBeVisible({ timeout: 60_000 })
    await account.getByRole('radio').check()
    const connect = dialog.getByRole('button', { name: 'Connect' })
    await expect(connect).toBeEnabled({ timeout: 60_000 })
    await connect.click()
    await expect(dialog).toHaveCount(0, { timeout: 60_000 })

    const profile = (field: string): Run => inSandbox(box, join(bin, 'profile'), ['-C', repo, '--field', field])
    expect(profile('mode').stdout.trim()).toBe('silent')
    expect(profile('workflow.finish').stdout.trim(), 'an account with write access: the finish is a PR with green CI').toBe('pr-green-ci')
    expect(profile('attribution').stdout.trim(), 'a Silent Project is connected with attribution off').toBe('off')
    workflowFolder = profile('_resolved.workflow_folder').stdout.trim()
    expect(workflowFolder).not.toBe('')
    const ticketsRoot = ok(join(bin, 'ticket'), ['root'], { cwd: repo, env: box.env })
    const values = runValues(workflowFolder)

    // The Epic of the fixture, committed in the Workflow folder's own git.
    cpSync(join(FIXTURES, 'silent-epic'), join(ticketsRoot, EPIC), { recursive: true })
    ok('git', ['add', '-A'], { cwd: workflowFolder, env: box.env })
    ok('git', ['commit', '-q', '-m', `Add the ${EPIC} Epic`], { cwd: workflowFolder, env: box.env })

    // The control step: both searches find a planted trace. A check that cannot fail does not count.
    const planted = plantedTrace(workflowFolder)
    const plantedCheck = inSandbox(box, join(bin, 'silent-check'), ['-C', repo, '--file', '-'], { input: planted })
    expect(plantedCheck.status, `silent-check on a planted trace: ${plantedCheck.stdout}${plantedCheck.stderr}`).toBe(1)
    expect(tracesIn(planted, values)).toEqual(expect.arrayContaining([EPIC, TICKET_SLUG, `${EPIC}/01`, workflowFolder, '.scratch', 'worfy-harness']))
    const plantedLine = inSandbox(box, join(bin, 'silent-check'), ['-C', repo, '--file', '-'], { input: 'Add greet(name)\n\nCo-authored-by: Claude Opus 5.5 <noreply@anthropic.com>\n' })
    expect(plantedLine.status, `silent-check on a planted attribution line: ${plantedLine.stdout}${plantedLine.stderr}`).toBe(1)

    // One Wave, unattended: Autopilot runs the Wave without a person ("Run wave" would hand it to an
    // attended Orchestrator, whose permission prompts nobody answers here).
    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    await expect(frame).toBeVisible({ timeout: 120_000 })
    const autopilot = frame.getByTestId('action-autopilot')
    await expect(autopilot).toHaveAttribute('aria-disabled', 'false', { timeout: 60_000 })
    await autopilot.click()
    await expect(frame.getByTestId('autopilot-status')).toBeVisible({ timeout: 60_000 })

    const ticketState = (): string => {
      const status = inSandbox(box, join(bin, 'epic-status'), ['--json'], { cwd: repo })
      if (status.status !== 0) return `epic-status exited ${status.status}`
      const parsed = JSON.parse(status.stdout) as { tickets: { epic: string; num: number; state: string }[] }
      return parsed.tickets.find((ticket) => ticket.epic === EPIC && ticket.num === 1)?.state ?? 'missing'
    }
    await expect.poll(ticketState, { timeout: WAVE_TIMEOUT_MS, intervals: [30_000] }).toBe('done')
    // The line stays after the run and names why it stopped (F-SPEC, "Status line text" and "Visible when").
    await expect(frame.getByTestId('autopilot-status'), 'the run stops once no Wave is left').toHaveText('stopped: no ready wave', { timeout: 15 * 60_000 })

    // The run's journal: no point where it asked for a person, and no person stepped in.
    const journals = join(dataDir, 'autopilot')
    const lines = readdirSync(journals)
      .filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) => readFileSync(join(journals, name), 'utf8').split('\n').filter(Boolean))
      .map((line) => JSON.parse(line) as { kind: string })
    expect(lines.filter((line) => line.kind === 'refused-dialog' || line.kind === 'human-input')).toEqual([])
    // The run ended; after run-stopped it may only give the Orchestrator back.
    const stopped = lines.findLastIndex((line) => line.kind === 'run-stopped')
    expect(stopped, 'the journal has a run-stopped line').toBeGreaterThanOrEqual(0)
    expect(lines.slice(stopped + 1).filter((line) => !['background-tasks', 'orchestrator-returned', 'tasks-killed'].includes(line.kind))).toEqual([])
  } finally {
    await launched.close()
  }

  // ── Traces: what the repository and GitHub show to people ──
  if (workflowFolder === undefined) throw new Error('the Workflow folder of the Project was not read')
  const values = runValues(workflowFolder)
  git('fetch', '-q', '--prune', 'origin')
  const localBranches = git('for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean)
  const remoteBranches = git('for-each-ref', '--format=%(refname:lstrip=3)', 'refs/remotes/origin')
    .split('\n')
    .filter((name) => name !== '' && name !== 'HEAD')
  const texts: { what: string; text: string }[] = []
  for (const branch of localBranches) texts.push({ what: `local branch ${branch}`, text: branch })
  for (const branch of remoteBranches) texts.push({ what: `branch ${branch} in origin`, text: branch })
  const refs = [...localBranches.map((name) => `refs/heads/${name}`), ...remoteBranches.map((name) => `refs/remotes/origin/${name}`)]
  for (const ref of refs) {
    for (const message of git('log', '--format=%B%x1e', `${base}..${ref}`).split('\x1e')) {
      if (message.trim() !== '') texts.push({ what: `a commit message on ${ref}`, text: message.trim() })
    }
  }
  const prs = JSON.parse(
    ok('gh', ['pr', 'list', '-R', remote, '--state', 'all', '--limit', '100', '--json', 'title,body,headRefName'], { cwd: repo, env: { ...box.env, ...ghEnv } }),
  ) as { title: string; body: string; headRefName: string }[]
  expect(prs.length, 'the Ticket finished with a PR').toBeGreaterThan(0)
  for (const pr of prs) {
    texts.push({ what: `PR title (${pr.headRefName})`, text: pr.title })
    texts.push({ what: `PR body (${pr.headRefName})`, text: pr.body })
    texts.push({ what: 'PR branch', text: pr.headRefName })
  }

  const silentCheck = (text: string): Run => inSandbox(box, join(bin, 'silent-check'), ['-C', repo, '--file', '-'], { input: text })
  // Attribution lines are searched for in every text, not only when the Profile says off (textProblems).
  const problems: string[] = []
  for (const { what, text } of texts) problems.push(...textProblems(what, text, values, silentCheck(text)))

  // Files: tracked and untracked in the checkout (the Sessions' worktrees aside: their branches are
  // checked above), and every file of every branch in origin.
  const files = [
    ...git('ls-files').split('\n'),
    ...git('ls-files', '--others')
      .split('\n')
      .filter((path) => !path.startsWith('.claude/worktrees/')),
    ...remoteBranches.flatMap((branch) => git('ls-tree', '-r', '--name-only', `refs/remotes/origin/${branch}`).split('\n')),
  ].filter(Boolean)
  for (const file of new Set(files)) if (WORKFLOW_FILES.some((pattern) => pattern.test(file))) problems.push(`a workflow file in the repository: ${file}`)
  expect(problems).toEqual([])
})
