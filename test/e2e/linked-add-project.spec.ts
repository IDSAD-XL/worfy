// "Add project" on a Linked machine (worfy-link ticket 11; ADR-0052, Q10): two linked built worfy
// A and B. In A: "Add project" asks for the Machine first, then B's folders are browsed inside
// worfy (projects.browse on B) from B's home folder — a temporary fixture folder, never the disk of
// the person running the test — down to a repository B's Harness knows (a stub bin/profile, as
// test/e2e/projects.spec.ts does), and "Choose" adds it on B: the Project is in B's projects.json
// and not in A's, B's active Project stays, A's window opens the new Project on B. The system folder
// picker is replaced in main of both apps by a counter and never called. With B's access off, B
// cannot be chosen in the Machine step, and says why.
//
// Bonjour is off and the link server listens on 127.0.0.1 (launchApp). No real Claude Code: the
// fake agent of launchApp; no gh but the stand-in of launchApp.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { canvasReady, icacls, launchApp, linkThroughUi, machineIdOf, repoRoot, setProjectsAccess, thisUser, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { windowsProfileEnv } from './terminal-shell'
import { loginProfileWithNode, printScript, profileJsonScript } from '../harness-node'

test.setTimeout(240_000)

const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'
const SIZE = { width: 1400, height: 900 }

/** Where the snapshots of ticket 11 are kept in the repository (rules: .scratch/<epic>/evidence/NN-what.png). */
const EVIDENCE = join(repoRoot, '.scratch', 'worfy-link', 'evidence')

/**
 * The light and dark snapshot of `window` (test-results/e2e/snapshots/11-<name>/). With WORFY_EVIDENCE=1
 * both are also kept as the ticket's evidence `11-<name>-{light,dark}.png`; an ordinary run (gate
 * full) leaves the repository's files alone.
 */
async function evidence(window: Page, name: string): Promise<void> {
  const shots = await snapshotThemes(window, `11-${name}`)
  if (process.env.WORFY_EVIDENCE !== '1') return
  await mkdir(EVIDENCE, { recursive: true })
  await copyFile(shots.light, join(EVIDENCE, `11-${name}-light.png`))
  await copyFile(shots.dark, join(EVIDENCE, `11-${name}-dark.png`))
}

function git(cwd: string, ...args: string[]): string {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv, encoding: 'utf8' })
}

function makeRepo(dir: string): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'README.md'), 'repo\n')
  git(dir, 'init', '-q')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return realpathSync(dir)
}

/** An `epic-status` stub with no Epics, so a Project's Canvas reads without an error. */
const NO_EPICS = printScript('{"ref":"main","epics":[],"tickets":[]}\n')
/** A `bin/profile` stub that knows every folder: "Add project" adds a repository at once (test/e2e/projects.spec.ts). */
const KNOWS_ALL = profileJsonScript('{"name":"stub","_resolved":{"workspace":null}}')

/** A Claude home with the two stubs. */
function claudeHomeAt(dir: string): string {
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'settings.json'), '{}\n')
  writeFileSync(join(dir, 'bin', 'epic-status'), NO_EPICS, { mode: 0o755 })
  writeFileSync(join(dir, 'bin', 'profile'), KNOWS_ALL, { mode: 0o755 })
  return dir
}

/** A data folder with one Project, active. */
function dataDirWith(dir: string, id: string, name: string, path: string): string {
  mkdirSync(join(dir, id), { recursive: true })
  writeFileSync(join(dir, 'projects.json'), JSON.stringify({ projects: [{ id, name, path }], activeId: id }))
  return dir
}

const projectsOf = (dataDir: string): { projects: { id: string; path: string }[]; activeId: string | null } =>
  JSON.parse(readFileSync(join(dataDir, 'projects.json'), 'utf8')) as { projects: { id: string; path: string }[]; activeId: string | null }

/** Replaces the system folder picker in main of `app` with a counter that cancels. */
async function countDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const seen = { dialogs: 0 }
    ;(globalThis as unknown as { pickerCalls: typeof seen }).pickerCalls = seen
    dialog.showOpenDialog = (() => {
      seen.dialogs += 1
      return Promise.resolve({ canceled: true, filePaths: [] })
    }) as typeof dialog.showOpenDialog
  })
}

/**
 * The variables that make `home` B's home folder. HOME everywhere, and B's login shell /bin/sh reads
 * its .profile there. On Windows the home folder node's os.homedir() gives, and so the folder the
 * browser starts in, is USERPROFILE, which launchEnv moves to a temporary profile of the launch: here
 * the whole profile is `home` (windowsProfileEnv). Its AppData folder is there as in every Windows
 * home folder (PROFILE_FOLDERS). APPDATA elsewhere would not keep it out: B's process made an empty
 * %USERPROFILE%\AppData\Roaming even with APPDATA in another folder (Windows PC, 2026-10-22).
 */
const homeEnv = (home: string): Record<string, string> => ({ HOME: home, ...windowsProfileEnv(home) })

/** The folders of B's home folder that are not the test's: AppData on Windows (homeEnv). */
// Pins today's product: src/main/projects/browse.ts:131 hides only dot-folders, so Windows AppData shows.
const PROFILE_FOLDERS = process.platform === 'win32' ? ['AppData'] : []

/**
 * Takes away this user's right to list `folder` (`readable` false) or gives it back. Off Windows the
 * mode bits do it. On Windows they do not: NTFS keeps read access by the folder's ACL whatever the
 * mode, so an entry of the ACL denies this user listing the folder (icacls /deny, right RD), and
 * readdir fails with EPERM; removing the deny entry gives the right back. `folder` is always inside
 * the test's temporary folder.
 */
function setReadable(folder: string, readable: boolean): void {
  if (process.platform !== 'win32') return chmodSync(folder, readable ? 0o755 : 0o000)
  icacls(folder, readable ? '/remove:d' : '/deny', readable ? thisUser() : `${thisUser()}:(RD)`)
}

const dialogsOf = (app: ElectronApplication): Promise<number> => app.evaluate(() => (globalThis as unknown as { pickerCalls: { dialogs: number } }).pickerCalls.dialogs)

interface Pair {
  a: LaunchedApp
  b: LaunchedApp
  bId: string
  aData: string
  bData: string
  /** B's home folder: the start of the folder browser. */
  bHome: string
  shop: string
}

/** A with Project alpha, B with Project beta and a home folder of fixtures; linked, the pickers counted. */
async function launchPair(scratch: string, run: (pair: Pair) => Promise<void>): Promise<void> {
  const alpha = makeRepo(join(scratch, 'alpha'))
  const beta = makeRepo(join(scratch, 'beta'))
  const aData = dataDirWith(join(scratch, 'a-data'), ALPHA, 'alpha', alpha)
  const bData = dataDirWith(join(scratch, 'b-data'), BETA, 'beta', beta)
  // B's home: a repository two levels down, a hidden folder, a folder B cannot read, a file.
  const bHome = join(scratch, 'b-home')
  const shop = makeRepo(join(bHome, 'code', 'shop'))
  mkdirSync(join(bHome, 'code', 'notes'), { recursive: true })
  mkdirSync(join(bHome, '.config'), { recursive: true })
  mkdirSync(join(bHome, 'Documents'), { recursive: true })
  mkdirSync(join(bHome, 'locked'), { recursive: true })
  writeFileSync(join(bHome, 'todo.txt'), 'a file, not listed\n')
  // B's login shell is /bin/sh with this HOME: its .profile puts node on PATH, for the Node stubs.
  loginProfileWithNode(bHome)

  let a: LaunchedApp | undefined
  let b: LaunchedApp | undefined
  try {
    // Inside the try: the finally gives the right back whatever fails after this.
    setReadable(join(bHome, 'locked'), false)
    a = await launchApp({ env: { WORFY_DATA_DIR: aData, WORFY_CLAUDE_HOME: claudeHomeAt(join(scratch, 'a-claude')) } })
    b = await launchApp({ env: { WORFY_DATA_DIR: bData, WORFY_CLAUDE_HOME: claudeHomeAt(join(scratch, 'b-claude')), ...homeEnv(bHome), SHELL: '/bin/sh' } })
    await countDialogs(a.app)
    await countDialogs(b.app)
    await canvasReady(b, { size: SIZE })
    await canvasReady(a, { size: SIZE })
    await linkThroughUi(a.window, b.window)
    await run({ a, b, bId: await machineIdOf(b.window), aData, bData, bHome: realpathSync(bHome), shop })
  } finally {
    // First, so that a close that throws cannot leave the folder locked; and a give-back that throws
    // still closes both apps.
    try {
      setReadable(join(bHome, 'locked'), true)
    } finally {
      await a?.close()
      await b?.close()
    }
  }
}

const groupOf = (window: Page, machine: string) => window.locator(`[data-testid="machine-group"][data-machine-id="${machine}"]`)
const machineOption = (window: Page, machine: string | null) =>
  machine === null
    ? window.locator('[data-testid="add-project-machine-option"]:not([data-machine-id])')
    : window.locator(`[data-testid="add-project-machine-option"][data-machine-id="${machine}"]`)
const folderRow = (window: Page, name: string) => window.getByTestId('folder-row').filter({ has: window.getByText(name, { exact: true }) })

let scratch: string

test.beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), 'worfy-link-11-')))
})

test.afterEach(async () => {
  try {
    // A test stopped by its timeout may not have reached launchPair's finally, and a folder under a
    // deny entry fails rm with EPERM: put back the inherited ACL of the whole scratch folder first.
    if (process.platform === 'win32') icacls(scratch, '/reset', '/t', '/c', '/q')
  } catch (error) {
    // With /c icacls goes on past a file it cannot reset (one an Electron child still holds) but
    // still exits non-zero: a cleanup step, so a warning, not a red test.
    console.warn(`icacls /reset of ${scratch} failed:`, error)
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('in A: Add project → Machine B → B\'s folders → a repository: the Project is added on B, B\'s active one stays, A opens it; no system picker anywhere', async () => {
  await launchPair(scratch, async ({ a, b, bId, aData, bData, bHome, shop }) => {
    await setProjectsAccess(b, true)
    // A sees B's Projects: B is online and shares.
    await expect(groupOf(a.window, bId).locator(`[data-testid="project-row"][data-project-id="${BETA}"]`)).toBeVisible()

    await a.window.getByRole('button', { name: 'Add project' }).click()
    const step = a.window.getByTestId('add-project-machine')
    await expect(step).toBeVisible()
    await expect(step.getByTestId('add-project-machine-option')).toHaveCount(2)
    await expect(machineOption(a.window, null)).toBeEnabled()
    await expect(machineOption(a.window, bId)).toBeEnabled()
    await evidence(a.window, 'machine-step')
    await machineOption(a.window, bId).click()

    // B's folders, from B's home folder.
    const browser = a.window.getByTestId('folder-browser')
    await expect(browser.getByTestId('folder-browser-path')).toHaveText(bHome)
    await expect(browser.getByTestId('folder-row')).toHaveText([...PROFILE_FOLDERS, 'code', 'Documents', 'locked'])
    await evidence(a.window, 'folder-browser')
    await browser.getByRole('checkbox', { name: 'Show hidden folders' }).check()
    await expect(browser.getByTestId('folder-row')).toHaveText(['.config', ...PROFILE_FOLDERS, 'code', 'Documents', 'locked'])
    await evidence(a.window, 'folder-browser-hidden')
    await browser.getByRole('checkbox', { name: 'Show hidden folders' }).uncheck()

    // A folder B cannot read: its reason where the list was.
    await folderRow(a.window, 'locked').getByRole('button').click()
    await expect(browser.getByTestId('folder-browser-error')).toHaveText(`No permission to read ${join(bHome, 'locked')}`)
    await expect(browser.getByRole('button', { name: 'Choose' })).toBeDisabled()
    await evidence(a.window, 'folder-browser-denied')
    await browser.getByRole('button', { name: 'Up' }).click()
    await expect(browser.getByTestId('folder-browser-path')).toHaveText(bHome)

    await folderRow(a.window, 'code').getByRole('button').click()
    await expect(browser.getByTestId('folder-browser-path')).toHaveText(join(bHome, 'code'))
    await expect(folderRow(a.window, 'shop').getByText('git', { exact: true })).toBeVisible()
    await folderRow(a.window, 'shop').getByRole('button').click()
    await expect(browser.getByTestId('folder-browser-path')).toHaveText(shop)
    await browser.getByRole('button', { name: 'Choose' }).click()

    // A's window opens the new Project on B.
    // The id hashes the root as git spells it (projectId, src/main/projects/store.ts): C:/… on Windows.
    const shopId = `shop-${createHash('sha256').update(git(shop, 'rev-parse', '--show-toplevel').trim()).digest('hex').slice(0, 8)}`
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}.*[?&]project=${shopId}|[?&]project=${shopId}.*[?&]machine=${bId}`), { timeout: 20_000 })
    await expect(a.window.getByTestId('canvas')).toHaveAttribute('data-project-id', shopId, { timeout: 20_000 })
    const shopRow = groupOf(a.window, bId).locator(`[data-testid="project-row"][data-project-id="${shopId}"]`)
    await expect(shopRow).toBeVisible()
    await expect(shopRow.getByRole('button')).toHaveAttribute('aria-current', 'true')

    // On B, not on A; B's active Project stays.
    expect(projectsOf(bData).projects.map((project) => project.path)).toContain(shop)
    expect(projectsOf(bData).activeId).toBe(BETA)
    expect(projectsOf(aData).projects.map((project) => project.path)).not.toContain(shop)
    expect(projectsOf(aData).activeId).toBe(ALPHA)
    await expect(b.window.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)
    // No system folder picker opened on either Machine.
    expect(await dialogsOf(a.app)).toBe(0)
    expect(await dialogsOf(b.app)).toBe(0)
  })
})

test('B with access off: B cannot be chosen in the Machine step, and says why', async () => {
  await launchPair(scratch, async ({ a, b, bId }) => {
    await setProjectsAccess(b, false)
    // A learns it from the refusal of B's list.
    await expect(groupOf(a.window, bId).getByTestId('machine-not-sharing')).toBeVisible()
    await a.window.getByRole('button', { name: 'Add project' }).click()
    await expect(a.window.getByTestId('add-project-machine')).toBeVisible()
    await expect(machineOption(a.window, bId)).toBeDisabled()
    await expect(machineOption(a.window, bId).getByTestId('add-project-machine-reason')).toHaveText(/doesn't let Linked machines work with its Projects$/)
    await expect(machineOption(a.window, null)).toBeEnabled()
    await evidence(a.window, 'machine-step-access-off')
    await machineOption(a.window, bId).click({ force: true })
    await expect(a.window.getByTestId('folder-browser')).toHaveCount(0)
    expect(await dialogsOf(a.app)).toBe(0)
    expect(await dialogsOf(b.app)).toBe(0)
  })
})
