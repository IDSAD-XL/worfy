// The Orchestrator's Modes menu in a window on a Linked machine (worfy-retry ticket 13; spec of worfy-retry,
// Q15–Q18) on two built worfy, each on the fake agent and over temporary folders. B owns Project beta; A
// opens it in its window. Full access: the menu in A's window shows B's modes, and choosing Eco mode and
// Auto-continue writes them on B — Eco mode into B's Profile through B's bin/profile-set, Auto-continue
// into B's app-settings.json — and nothing on A. A change made in B's own window shows in A's open menu
// without loading it again. Read only: the menu shows the states, every item is unavailable with the
// read-only hint, and nothing is written. Both apps run under Playwright's debugging port, so Auto-approval
// stays unavailable on both sides (src/main/ipc/linked.ts); test/contract/modes-linked.test.ts covers
// Auto-approval without a debugging port.
//
// The pictures of A's open menu with full and with read-only access, in both themes, go through
// captureScreenshot (evidence-capture.ts): into the test's output, or with WORFY_EVIDENCE into the
// Ticket's evidence. Only the menu is pictured: the read-only hint names the Machine, and the Machine's
// name is the host name of the computer the test runs on.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { captureScreenshot } from './evidence-capture'
import { canvasReady, chooseLevel, closeSettings, launchApp, linkThroughUi, machineIdOf, openMachinesSettings, PROJECTS_ACCESS_LABEL, type LaunchedApp } from './helpers'
import { ms } from '../time-scale'

test.setTimeout(ms(180_000))

const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'
const SIZE = { width: 1400, height: 900 }
const HINT = /^.+ gives this Machine read-only access$/u
const PROFILE_SET = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'profile-set')

function git(cwd: string, ...args: string[]): void {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv })
}

/** A data folder whose projects.json lists `projects`, the first one active. */
function dataFolder(path: string, projects: { id: string; name: string; path: string }[]): string {
  for (const project of projects) mkdirSync(join(path, project.id), { recursive: true })
  writeFileSync(join(path, 'projects.json'), JSON.stringify({ projects, activeId: projects[0]?.id ?? null }))
  return path
}

/** B: repository beta registered in a Harness home of its own, whose bin/profile-set the app runs from B's Claude home. */
function prepareB(scratch: string) {
  const repo = join(scratch, 'beta')
  const claudeHome = join(scratch, 'b-claude')
  const harnessHome = join(scratch, 'b-harness')
  const home = join(scratch, 'b-home')
  for (const dir of [repo, join(claudeHome, 'bin'), join(harnessHome, 'gate'), join(harnessHome, 'projects', 'beta'), home]) mkdirSync(dir, { recursive: true })
  git(repo, 'init', '-q')
  const realRepo = realpathSync.native(repo)
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'beta', match: realRepo, profile: 'beta' }] }))
  const profile = join(harnessHome, 'projects', 'beta', 'profile.json')
  writeFileSync(profile, `${JSON.stringify({ schema: 2, name: 'beta', mode: 'full', commands: { test: 'make test' }, workflow: { ci: 'pr' } }, null, 2)}\n`)
  writeFileSync(join(harnessHome, 'projects', 'beta', 'rules.md'), '# beta rules\n')
  git(harnessHome, 'init', '-q')
  git(harnessHome, 'add', '-A')
  git(harnessHome, 'commit', '-q', '-m', 'init')
  const env = { HARNESS_HOME: harnessHome, HOME: home, USERPROFILE: home }
  const runs = join(scratch, 'b-profile-set-runs.jsonl')
  writeFileSync(
    join(claudeHome, 'bin', 'profile-set'),
    [
      "const { spawnSync } = require('node:child_process')",
      `require('node:fs').appendFileSync(${JSON.stringify(runs)}, JSON.stringify(process.argv.slice(2)) + '\\n')`,
      `const env = { ...process.env, ...${JSON.stringify(env)} }`,
      'for (const name of ["CLAUDE_GATE_CONFIG", "CLAUDE_PROFILES_DIR", "EVAL_HARNESS_HOME"]) delete env[name]',
      `const run = spawnSync(process.execPath, [${JSON.stringify(PROFILE_SET)}, ...process.argv.slice(2)], { stdio: 'inherit', env })`,
      'process.exit(run.status ?? 1)',
      '',
    ].join('\n'),
  )
  const dataDir = dataFolder(join(scratch, 'b-data'), [{ id: BETA, name: 'beta', path: realRepo }])
  /** The writes B's worfy started through bin/profile-set so far, each by its arguments; a read is no write. */
  const profileWrites = (): string[][] =>
    existsSync(runs)
      ? readFileSync(runs, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as string[])
          .filter((args) => !args.includes('--read'))
      : []
  return { profile, profileWrites, dataDir, env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view' } }
}

/** Opens the Orchestrator's Session view with a double click on its Node. */
async function openSession(window: Page): Promise<Locator> {
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle', { timeout: ms(20_000) })
  await node.locator('.w-orchestrator__header').dblclick()
  const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
  await expect(view).toBeVisible()
  return view
}

/** The Modes button of the Orchestrator's bar in Session view `view`, its icons and its menu's items. */
function modesOf(view: Locator) {
  const button = view.locator('.w-composer__bar').getByRole('button', { name: /^Modes/u })
  const menu = view.page().getByRole('menu', { name: 'Modes' })
  return {
    button,
    icon: (item: 'eco' | 'auto-approval' | 'auto-continue') => button.locator(`[data-mode-item="${item}"]`),
    menu,
    eco: menu.getByRole('menuitemcheckbox', { name: /^Eco mode/u }),
    cont: menu.getByRole('menuitemcheckbox', { name: /^Auto-continue/u }),
    positions: menu.getByRole('menuitemradio'),
  }
}

const json = (file: string): Record<string, unknown> => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {})

test('Modes in a window on a Linked machine: full access changes the modes on the Machine of the Project, a change there shows at once, read-only access only shows them', async () => {
  const scratch = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-retry-13-')))
  const alpha = join(scratch, 'alpha')
  mkdirSync(alpha, { recursive: true })
  git(alpha, 'init', '-q')
  const aData = dataFolder(join(scratch, 'a-data'), [{ id: ALPHA, name: 'alpha', path: realpathSync.native(alpha) }])
  const bSetup = prepareB(scratch)
  const bSettings = join(bSetup.dataDir, 'app-settings.json')
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData, WORFY_AGENT_SCRIPT: 'session-view' } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: bSetup.env })
    await canvasReady(b, { size: SIZE })
    await canvasReady(a, { size: SIZE })
    await linkThroughUi(a.window, b.window)
    const aId = await machineIdOf(a.window)
    const bId = await machineIdOf(b.window)

    // On B: access on, A's level Full access.
    const settings = await openMachinesSettings(b)
    await settings.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true }).click()
    await chooseLevel(b.window, settings.getByTestId(`link-machine-access-${aId}`), 'all')
    await closeSettings(b.window)

    // B's own window shows its Orchestrator: the Session runs on B.
    const bModes = modesOf(await openSession(b.window))

    // A opens beta of B and its Orchestrator: the menu shows B's modes.
    const betaRow = a.window.locator(`[data-testid="machine-group"][data-machine-id="${bId}"] [data-testid="project-row"][data-project-id="${BETA}"]`)
    await expect(betaRow).toContainText('beta', { timeout: ms(20_000) })
    await betaRow.getByRole('button').click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`, 'u'))
    const aModes = modesOf(await openSession(a.window))
    await expect(aModes.icon('eco')).toHaveAttribute('data-state', 'off', { timeout: ms(20_000) })
    await expect(aModes.icon('auto-continue')).toHaveAttribute('data-state', 'off')
    await expect(aModes.button).not.toHaveAttribute('data-read-only', '')

    // Full access: Eco mode and Auto-continue change on B, and nothing is written on A.
    await aModes.button.click()
    await expect(aModes.eco).not.toHaveAttribute('aria-disabled', 'true')
    await aModes.eco.click()
    await expect(aModes.eco).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => (json(bSetup.profile).workflow as { agents?: unknown } | undefined)?.agents).toBe('eco')
    await aModes.cont.click()
    await expect(aModes.cont).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => json(bSettings).autoContinue).toEqual({ [BETA]: true })
    expect(json(join(aData, 'app-settings.json')).autoContinue).toBeUndefined()
    // Playwright's debugging port: Auto-approval stays unavailable from A, with why.
    for (const position of await aModes.positions.all()) {
      await expect(position).toHaveAttribute('aria-disabled', 'true')
      await expect(position).toHaveAttribute('title', /debugging port/u)
    }
    await captureScreenshot(aModes.menu, 'modes-linked-full-access')

    // Q18: a change made in B's own window shows in A's open menu at once.
    await bModes.button.click()
    await expect(bModes.cont).toHaveAttribute('aria-checked', 'true')
    await bModes.cont.click()
    await expect.poll(() => (json(bSettings).autoContinue as Record<string, unknown> | undefined)?.[BETA]).toBeUndefined()
    await expect(aModes.cont).toHaveAttribute('aria-checked', 'false', { timeout: ms(20_000) })
    await expect(aModes.icon('auto-continue')).toHaveAttribute('data-state', 'off')
    await expect(aModes.menu).toBeVisible()
    await b.window.keyboard.press('Escape')

    // Read only: A's window shows the states, every item unavailable with the hint; nothing is written.
    const again = await openMachinesSettings(b)
    await chooseLevel(b.window, again.getByTestId(`link-machine-access-${aId}`), 'read')
    await closeSettings(b.window)
    await expect(a.window.getByTestId('canvas-read-only')).toHaveText(HINT, { timeout: ms(20_000) })
    const readOnly = modesOf(await openSession(a.window))
    await expect(readOnly.icon('eco')).toHaveAttribute('data-state', 'on', { timeout: ms(20_000) })
    await expect(readOnly.icon('auto-continue')).toHaveAttribute('data-state', 'off')
    await expect(readOnly.button).toHaveAttribute('data-read-only', '')
    await readOnly.button.click()
    for (const item of [readOnly.eco, readOnly.cont, ...(await readOnly.positions.all())]) {
      await expect(item).toHaveAttribute('aria-disabled', 'true')
      await expect(item).toHaveAttribute('title', HINT)
    }
    await expect(readOnly.eco).toHaveAttribute('aria-checked', 'true')
    await captureScreenshot(readOnly.menu, 'modes-linked-read-only')
    // Playwright waits for an aria-disabled item to become enabled; the click is forced, as a person's would land.
    // "Nothing written" is checked once a write from B's own window has landed that goes no faster than the
    // write A's click would have sent. A's Eco mode would go link → B's main → bin/profile-set; the mark is an
    // Eco mode write in B's window, through the same bin/profile-set: once it shows in the Profile, B's
    // bin/profile-set has run for that write alone. (A's write would carry the fingerprint before the mark,
    // so arriving later it would be refused, but it would still have started bin/profile-set.)
    const agents = () => (json(bSetup.profile).workflow as { agents?: unknown } | undefined)?.agents
    const writesBefore = bSetup.profileWrites().length
    await readOnly.eco.click({ force: true })
    await bModes.button.click()
    await expect(bModes.eco).toHaveAttribute('aria-checked', 'true')
    await bModes.eco.click()
    await expect.poll(agents).toBeUndefined()
    await expect(bModes.eco).toHaveAttribute('aria-checked', 'false')
    expect(bSetup.profileWrites().slice(writesBefore)).toHaveLength(1)
    // A's Auto-continue would go link → B's main → app-settings.json, faster than any Profile write: B's next
    // Eco mode write is the mark. A shows B's Eco mode change first, so its menu is current.
    await expect(readOnly.eco).toHaveAttribute('aria-checked', 'false', { timeout: ms(20_000) })
    await expect(readOnly.cont).toHaveAttribute('aria-checked', 'false')
    await readOnly.cont.click({ force: true })
    await bModes.eco.click()
    await expect.poll(agents).toBe('eco')
    expect((json(bSettings).autoContinue as Record<string, unknown> | undefined)?.[BETA]).toBeUndefined()
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
