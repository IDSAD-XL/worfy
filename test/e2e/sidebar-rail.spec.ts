import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, parkPointer, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes } from './snapshots'
import { nodeScript } from '../harness-node'

// The sidebar of variant C (worfy-polish ticket 94) against the built app over two Projects, «orchard» (open) and
// «harbor», whose epic-status answers Epics of their own. The rail shows one section at a time and remembers it; the
// Project switcher at the top mixes the Projects («All Projects») or shows one, which it opens; the Epics follow it,
// the Sessions say that they show the open Project only; both choices outlive a restart. The button that hides the
// sidebar is in the sidebar's strip, and in the toolbar only while the sidebar is hidden; ⌘B is unchanged.
// A third Project, «meadow», has no Epics and a long name, for the pill of the switcher.
// Under «All Projects» the Sessions and the ADRs of every Project show too, each under its name, and the Projects are
// cards with their live state (worfy-polish ticket 99): live Sessions of «orchard» and «harbor» in the registry of the
// Claude home, ADRs in both.
// WORFY_SNAPSHOT_DIR, when set, also gets the screenshots of the tickets, each dark and light: the Epics under «All» and
// under one Project, the Sessions, the Projects with the long name in the pill, the open menu (94); the Projects as
// cards, the Sessions and the ADRs of both Projects under «All» (99).

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const ORCHARD = 'orchard-0000000a'
const HARBOR = 'harbor-0000000b'
const MEADOW = 'meadow-0000000c'
const MEADOW_NAME = 'meadow-field-notebooks'
const HOUR = 60 * 60_000
const SIZE = { width: 1280, height: 800 }
const stamp = (ago: number): string => new Date(Date.now() - ago).toISOString().slice(0, 16) + 'Z'

/** The Epics of each Project, by the name of its folder. */
const EPICS: Record<string, string[]> = { orchard: ['orchard-billing', 'orchard-search'], harbor: ['harbor-docks'], meadow: [] }
/** The id and the name of each Project, by the name of its folder. */
const PROJECTS: Record<string, { id: string; name: string }> = { orchard: { id: ORCHARD, name: 'orchard' }, harbor: { id: HARBOR, name: 'harbor' }, meadow: { id: MEADOW, name: MEADOW_NAME } }

let scratch: string
let dataDir: string
let claudeHome: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-sidebar-rail-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const projects = []
  for (const [name, epics] of Object.entries(EPICS)) {
    const repo = join(scratch, name)
    for (const epic of epics) {
      mkdirSync(join(repo, '.scratch', epic, 'issues'), { recursive: true })
      writeFileSync(join(repo, '.scratch', epic, 'spec.md'), `# ${epic}\n`)
    }
    mkdirSync(repo, { recursive: true })
    git(repo, 'init', '-q')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
    // What epic-status answers in this Project's folder: its own Epics, each with a Ticket done an hour ago.
    writeFileSync(
      join(claudeHome, `${name}.json`),
      JSON.stringify({
        ref: 'main',
        epics: epics.map((epic) => ({ epic, hasSpec: true, hasMap: false })),
        tickets: epics.map((epic) => ({ epic, num: 1, slug: 't1', title: '01 — Ticket 1', statusRaw: `done ${stamp(HOUR)}`, state: 'done', statusAt: stamp(HOUR), blockedRaw: '—', blockedNums: [], blockedParsed: true })),
      }),
    )
    const { id, name: shown } = PROJECTS[name] ?? { id: '', name }
    mkdirSync(join(dataDir, id), { recursive: true })
    projects.push({ id, name: shown, path: repo })
  }
  // epic-status runs in the Project's folder: it answers the file named after that folder.
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, nodeScript(`const name = process.cwd().split(/[\\\\/]/).pop(); process.stdout.write(fs.readFileSync(${JSON.stringify(claudeHome)} + '/' + name + '.json', 'utf8'))`))
  chmodSync(script, 0o755)
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects, activeId: ORCHARD }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })

async function setWindowSize(launched: LaunchedApp, size: { width: number; height: number }): Promise<void> {
  await launched.app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted.width, wanted.height), size)
  await expect
    .poll(() => launched.window.evaluate(() => [(globalThis as unknown as { innerWidth: number }).innerWidth, (globalThis as unknown as { innerHeight: number }).innerHeight]))
    .toStrictEqual([size.width, size.height])
}

const sidebar = (window: Page) => window.getByRole('navigation', { name: 'Sidebar' })
const rail = (window: Page) => sidebar(window).getByRole('tablist', { name: 'Sidebar sections' })
const tab = (window: Page, name: string) => rail(window).getByRole('tab', { name, exact: true })
const epics = (window: Page) => window.getByRole('region', { name: 'Epics', exact: true })
const epicNames = (window: Page): Promise<(string | null)[]> => epics(window).getByTestId('sidebar-epic').evaluateAll((all) => all.map((row) => row.getAttribute('data-epic')))
const switcher = (window: Page) => sidebar(window).getByTestId('project-switcher')
const pick = async (window: Page, name: string): Promise<void> => {
  await switcher(window).click()
  await window.getByRole('menu', { name: 'Sidebar shows' }).getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click()
}

/** The `-webkit-app-region` of an element: `drag` moves the window. */
const appRegion = (locator: Locator): Promise<string> =>
  locator.evaluate((node) => (globalThis as unknown as { getComputedStyle(of: unknown): { getPropertyValue(name: string): string } }).getComputedStyle(node).getPropertyValue('-webkit-app-region'))

/** The screenshots of a ticket (94 unless named), when the run asks for them: copied out of test-results under the ticket's names. */
async function ticketShots(window: Page, name: string, ticket = '94'): Promise<void> {
  // The pointer away from the sidebar: no hover on a row or a tab in the picture.
  await parkPointer(window)
  const shots = await snapshotThemes(window, `sidebar-rail-${ticket}-${name}`)
  const out = process.env.WORFY_SNAPSHOT_DIR
  if (out === undefined || out === '') return
  mkdirSync(out, { recursive: true })
  copyFileSync(shots.dark, join(out, `${ticket}-sidebar-${name}-dark.png`))
  copyFileSync(shots.light, join(out, `${ticket}-sidebar-${name}-light.png`))
}

test('one section at a time on the rail; the switcher mixes the Projects or shows the one it opens; both choices outlive a restart', async () => {
  const first = await launch()
  try {
    const { window } = first
    await setWindowSize(first, SIZE)
    expect(await rail(window).getByRole('tab').evaluateAll((all) => all.map((each) => each.getAttribute('aria-label')))).toEqual(['Projects', 'Sessions', 'Pull requests', 'Pipeline', 'Epics', 'ADR', 'Machines'])
    // The first section is shown, the others are hidden.
    await expect(tab(window, 'Projects')).toHaveAttribute('aria-selected', 'true')
    await expect(window.getByRole('region', { name: 'Projects', exact: true })).toBeVisible()
    await expect(epics(window)).toBeHidden()

    // «All Projects»: the Epics of both Projects, the open one's first, each under its name.
    await expect(switcher(window)).toHaveAccessibleName('Sidebar shows: All Projects')
    await tab(window, 'Epics').click()
    await expect(window.getByRole('region', { name: 'Projects', exact: true })).toBeHidden()
    await expect(epics(window).getByTestId('sidebar-epic')).toHaveCount(3)
    expect(await epicNames(window)).toEqual(['orchard-billing', 'orchard-search', 'harbor-docks'])
    await expect(epics(window).getByTestId('sidebar-scope-label')).toHaveText('All Projects')
    await ticketShots(window, 'all')

    // The keyboard walks the rail: ↓ from Epics shows ADR.
    await tab(window, 'Epics').focus()
    await window.keyboard.press('ArrowDown')
    await expect(tab(window, 'ADR')).toBeFocused()
    await expect(tab(window, 'ADR')).toHaveAttribute('aria-selected', 'true')
    await tab(window, 'Sessions').click()
    // The Sessions follow the switcher too (worfy-polish ticket 99): no line that they show the open Project only.
    await expect(window.getByRole('region', { name: 'Sessions', exact: true }).getByTestId('sidebar-scope-label')).toHaveText('All Projects')
    await expect(window.getByRole('region', { name: 'Sessions', exact: true }).getByTestId('sidebar-scope-note')).toHaveCount(0)
    await ticketShots(window, 'sessions-all')

    // One Project — the other one: it opens, and the Epics show it alone.
    await tab(window, 'Epics').click()
    await pick(window, 'harbor')
    await expect(switcher(window)).toHaveAccessibleName('Sidebar shows: harbor')
    await expect(window.locator('.w-toolbar__name')).toHaveText('harbor')
    await expect(epics(window).getByTestId('sidebar-epic')).toHaveCount(1)
    expect(await epicNames(window)).toEqual(['harbor-docks'])
    await expect(epics(window).getByTestId('sidebar-scope-label')).toHaveText('harbor')
    await ticketShots(window, 'one-project')
    await tab(window, 'Sessions').click()
    await expect(window.getByRole('region', { name: 'Sessions', exact: true }).getByTestId('sidebar-scope-note')).toHaveCount(0)
    await tab(window, 'Epics').click()
  } finally {
    await first.close()
  }

  // A restart comes back on the Epics and on one Project.
  const second = await launch()
  try {
    const { window } = second
    await expect(tab(window, 'Epics')).toHaveAttribute('aria-selected', 'true')
    await expect(switcher(window)).toHaveAccessibleName('Sidebar shows: harbor')
    await expect(epics(window).getByTestId('sidebar-epic')).toHaveCount(1)
    await pick(window, 'All Projects')
    await expect(epics(window).getByTestId('sidebar-epic')).toHaveCount(3)
  } finally {
    await second.close()
  }
})

test('the button that hides the sidebar is in its strip; while hidden, the toolbar has the one that shows it; ⌘B does both', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const toolbar = window.locator('.w-toolbar')
    await expect(sidebar(window).getByRole('button', { name: 'Hide sidebar' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: /sidebar/ })).toHaveCount(0)

    await sidebar(window).getByRole('button', { name: 'Hide sidebar' }).click()
    await expect(sidebar(window)).toHaveCount(0)
    // The focus was on the button that went away: it is on the one that brings the sidebar back.
    await expect(toolbar.getByRole('button', { name: 'Show sidebar' })).toBeFocused()

    await toolbar.getByRole('button', { name: 'Show sidebar' }).click()
    await expect(sidebar(window)).toBeVisible()
    await expect(toolbar.getByRole('button', { name: /sidebar/ })).toHaveCount(0)
    // The toolbar's button went away with the press: the focus is on the one in the sidebar's strip, not on <body>.
    await expect(sidebar(window).getByRole('button', { name: 'Hide sidebar' })).toBeFocused()
    // And the keyboard alone does both: Enter hides the sidebar and Enter brings it back.
    await window.keyboard.press('Enter')
    await expect(toolbar.getByRole('button', { name: 'Show sidebar' })).toBeFocused()
    await window.keyboard.press('Enter')
    await expect(sidebar(window).getByRole('button', { name: 'Hide sidebar' })).toBeFocused()

    // View ▸ Toggle Sidebar, the item behind ⌘B.
    await clickMenuItem(launched.app, 'view.sidebar')
    await expect(sidebar(window)).toHaveCount(0)
    await expect(toolbar.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
  } finally {
    await launched.close()
  }
})

test('the top as the owner chose: the wordmark after the traffic lights, the button at the right edge, the switcher across the sidebar with a long name whole; the open menu lists every Project', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await setWindowSize(launched, SIZE)
    await pick(window, MEADOW_NAME)
    await expect(switcher(window)).toHaveAccessibleName(`Sidebar shows: ${MEADOW_NAME}`)
    // Next to the wordmark the toolbar names the Project alone.
    await expect(window.locator('.w-toolbar__name')).toHaveText(MEADOW_NAME)
    const box = async (locator: Locator) => {
      const found = await locator.boundingBox()
      if (found === null) throw new Error('no box')
      return found
    }
    const nav = await box(sidebar(window))
    const strip = await box(sidebar(window).locator('.w-sidebar__titlebar'))
    const wordmark = await box(sidebar(window).getByTestId('sidebar-wordmark'))
    const hide = await box(sidebar(window).getByRole('button', { name: 'Hide sidebar' }))
    const pill = await box(switcher(window))
    await expect(sidebar(window).getByTestId('sidebar-wordmark')).toHaveText('worfy')
    // Row 1: 80 px for the traffic lights (macOS), the wordmark, the button 8 px from the right edge.
    if (process.platform === 'darwin') expect(wordmark.x - nav.x).toBeCloseTo(80, 0)
    expect(nav.x + nav.width - 1 - (hide.x + hide.width)).toBeCloseTo(8, 0)
    expect(hide.y + hide.height).toBeLessThanOrEqual(strip.y + strip.height)
    // Row 2: the switcher under the strip, as wide as the sidebar less its padding; the long name whole, the chevron at the end.
    expect(pill.y).toBeGreaterThanOrEqual(strip.y + strip.height)
    expect(pill.width).toBeCloseTo(nav.width - 1 - 16, 0)
    // Whole, and long: wider than the room for a name in the pill of round 1 (150 px less its icon, chevron and padding).
    const name = await switcher(window).locator('.w-project-switcher__name').evaluate((each) => ({ scroll: each.scrollWidth, client: each.clientWidth }))
    expect(name.scroll).toBeLessThanOrEqual(name.client)
    expect(name.scroll).toBeGreaterThan(110)
    const chevron = await box(switcher(window).locator('.w-project-switcher__chevron'))
    expect(chevron.width).toBeCloseTo(9, 0)
    expect(pill.x + pill.width - (chevron.x + chevron.width)).toBeLessThan(12)
    // The strip drags the window, its button does not; the switcher's row is no drag area.
    expect(await appRegion(sidebar(window).locator('.w-sidebar__titlebar'))).toBe('drag')
    expect(await appRegion(sidebar(window).getByRole('button', { name: 'Hide sidebar' }))).toBe('no-drag')
    expect(await appRegion(switcher(window))).not.toBe('drag')
    await tab(window, 'Projects').click()
    await expect(window.getByRole('region', { name: 'Projects', exact: true })).toBeVisible()
    await ticketShots(window, 'projects-long-name')

    await switcher(window).click()
    const menu = window.getByRole('menu', { name: 'Sidebar shows' })
    await expect(menu.getByRole('menuitemradio')).toHaveCount(4)
    await expect(menu.getByRole('menuitemradio', { name: new RegExp(`^${MEADOW_NAME}`) })).toHaveAttribute('aria-checked', 'true')
    await ticketShots(window, 'menu-open')
    await expect(menu).toBeVisible()
  } finally {
    await launched.close()
  }
})

/** A live Session in the registry of the Claude home: the test runner's own process, so it counts as running. */
function writeLiveSession(file: number, sessionId: string, cwd: string, status: 'busy' | 'idle', name: string): void {
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  writeFileSync(join(claudeHome, 'sessions', `${file}.json`), JSON.stringify({ pid: process.pid, sessionId, cwd, status, name, entrypoint: 'cli', kind: 'interactive' }))
}

/** An ADR of the Project in folder `name`. */
function writeAdr(name: string, file: string, title: string): void {
  mkdirSync(join(scratch, name, 'docs', 'adr'), { recursive: true })
  writeFileSync(join(scratch, name, 'docs', 'adr', file), `# ${title}\n\nDate: 2026-11-10. Status: accepted.\n`)
}

const ORCHARD_SESSION = '0a0a0a0a-1111-4111-8111-000000000001'
const HARBOR_BUSY = '0b0b0b0b-2222-4222-8222-000000000002'
const HARBOR_IDLE = '0b0b0b0b-3333-4333-8333-000000000003'

test('«All Projects» lists the Sessions and the ADRs of both Projects, each under its name; the Projects are cards with their live state; a click in the other Project opens it', async () => {
  writeLiveSession(9001, ORCHARD_SESSION, join(scratch, 'orchard'), 'busy', 'Billing review')
  writeLiveSession(9002, HARBOR_BUSY, join(scratch, 'harbor'), 'busy', 'Dock schedule')
  writeLiveSession(9003, HARBOR_IDLE, join(scratch, 'harbor'), 'idle', 'Crane notes')
  writeAdr('orchard', '0001-billing-in-cents.md', 'Billing in cents')
  writeAdr('harbor', '0001-one-queue-per-dock.md', 'One queue per dock')
  writeAdr('harbor', '0002-tides-from-a-file.md', 'Tides from a file')
  const launched = await launch()
  try {
    const { window } = launched
    await setWindowSize(launched, SIZE)
    const card = (id: string) => window.locator(`[data-testid="project-row"][data-project-id="${id}"] [data-testid="project-pulse"]`)

    // The Projects: a card of two lines each, the live state under the name and the branch.
    await expect(card(ORCHARD)).toHaveText('1 busy')
    await expect(card(HARBOR)).toHaveText('1 busy')
    await expect(card(MEADOW)).toHaveText('quiet')
    await ticketShots(window, 'projects-cards', '99')

    // The rail button of the Sessions counts the busy Sessions of both Projects, in the tone of work.
    const badge = tab(window, 'Sessions').getByTestId('sidebar-rail-badge')
    await expect(badge).toHaveText('2')
    await expect(badge).toHaveAttribute('data-tone', 'working')

    // The Sessions: the open Project's first, then harbor's, each under its name.
    await tab(window, 'Sessions').click()
    const sessions = window.getByRole('region', { name: 'Sessions', exact: true })
    await expect(sessions.getByTestId('sidebar-session')).toHaveCount(3)
    expect(await sessions.getByTestId('sidebar-sessions-project').evaluateAll((all) => all.map((group) => group.getAttribute('data-project')))).toEqual([ORCHARD, HARBOR])
    // Both harbor Sessions share the test's pid, so their order follows the folder listing: compared without it.
    const harborNames = sessions.locator(`[data-testid="sidebar-session"][data-project="${HARBOR}"] [data-testid="sidebar-session-name"]`)
    await expect.poll(async () => (await harborNames.allTextContents()).sort()).toEqual(['Crane notes', 'Dock schedule'])
    await expect(sessions.getByTestId('sidebar-sessions-live')).toHaveText('3 live')
    await expect(sessions.getByTestId('sidebar-scope-note')).toHaveCount(0)
    await ticketShots(window, 'sessions-all', '99')

    // The ADRs: orchard's, then harbor's, read once for the other Project.
    await tab(window, 'ADR').click()
    const adrs = window.getByRole('region', { name: 'ADR', exact: true })
    await expect(adrs.getByTestId('sidebar-adr')).toHaveCount(3)
    expect(await adrs.getByTestId('sidebar-adr-project').evaluateAll((all) => all.map((group) => group.getAttribute('data-project')))).toEqual([ORCHARD, HARBOR])
    await expect(adrs.getByTestId('adr-count')).toHaveText('3')
    await ticketShots(window, 'adr-all', '99')

    // A click on an ADR of harbor opens harbor, then the ADR.
    await adrs.locator(`[data-testid="sidebar-adr"][data-project="${HARBOR}"][data-path="docs/adr/0002-tides-from-a-file.md"]`).click()
    await expect(window.locator('.w-toolbar__name')).toHaveText('harbor')
    await expect(window.getByTestId('adr-panel')).toHaveAttribute('data-path', 'docs/adr/0002-tides-from-a-file.md')
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('adr-panel')).toHaveCount(0)
    // harbor is open now: its ADRs first.
    await expect.poll(() => adrs.getByTestId('sidebar-adr-project').evaluateAll((all) => all.map((group) => group.getAttribute('data-project')))).toEqual([HARBOR, ORCHARD])

    // A click on the Session of orchard, another Project now, opens orchard.
    await tab(window, 'Sessions').click()
    await expect.poll(() => sessions.getByTestId('sidebar-sessions-project').evaluateAll((all) => all.map((group) => group.getAttribute('data-project')))).toEqual([HARBOR, ORCHARD])
    await sessions.locator(`[data-testid="sidebar-session"][data-project="${ORCHARD}"]`).click()
    await expect(window.locator('.w-toolbar__name')).toHaveText('orchard')

    // Under one Project the Sessions show the open one alone, and the badge counts its own.
    await pick(window, 'orchard')
    await expect(sessions.getByTestId('sidebar-session')).toHaveCount(1)
    await expect(badge).toHaveText('1')
  } finally {
    await launched.close()
  }
})
