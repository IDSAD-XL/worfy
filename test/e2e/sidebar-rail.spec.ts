import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
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
// WORFY_SNAPSHOT_DIR, when set, also gets the screenshots of the ticket, each dark and light: the Epics under «All» and
// under one Project, the Sessions with their «… only» line, the Projects with the long name in the pill, the open menu.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const ORCHARD = 'orchard-0000000a'
const HARBOR = 'harbor-0000000b'
const MEADOW = 'meadow-0000000c'
const MEADOW_NAME = 'meadow-field-research-notebooks'
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

/** The screenshots of the ticket, when the run asks for them: copied out of test-results under the ticket's names. */
async function ticketShots(window: Page, name: string): Promise<void> {
  // The pointer away from the sidebar: no hover on a row or a tab in the picture.
  await parkPointer(window)
  const shots = await snapshotThemes(window, `sidebar-rail-${name}`)
  const out = process.env.WORFY_SNAPSHOT_DIR
  if (out === undefined || out === '') return
  mkdirSync(out, { recursive: true })
  copyFileSync(shots.dark, join(out, `94-sidebar-${name}-dark.png`))
  copyFileSync(shots.light, join(out, `94-sidebar-${name}-light.png`))
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
    await expect(window.getByRole('region', { name: 'Sessions', exact: true }).getByTestId('sidebar-scope-note')).toHaveText('orchard only: this list does not show other Projects.')
    await ticketShots(window, 'sessions-all')

    // One Project — the other one: it opens, and the Epics show it alone.
    await tab(window, 'Epics').click()
    await pick(window, 'harbor')
    await expect(switcher(window)).toHaveAccessibleName('Sidebar shows: harbor')
    await expect(window.locator('.w-toolbar__name')).toHaveText('worfy — harbor')
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

test('a long Project name stays inside the pill; the open menu lists «All Projects» and every Project', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await setWindowSize(launched, SIZE)
    await pick(window, MEADOW_NAME)
    await expect(switcher(window)).toHaveAccessibleName(`Sidebar shows: ${MEADOW_NAME}`)
    await expect(window.locator('.w-toolbar__name')).toHaveText(`worfy — ${MEADOW_NAME}`)
    // The pill keeps its width and cuts the name: the sidebar's strip does not grow.
    const pill = await switcher(window).boundingBox()
    const strip = await sidebar(window).locator('.w-sidebar__titlebar').boundingBox()
    expect(pill).not.toBeNull()
    expect(strip).not.toBeNull()
    if (pill === null || strip === null) return
    expect(pill.x + pill.width).toBeLessThanOrEqual(strip.x + strip.width)
    // The name is cut with an ellipsis, not pushed out of the pill.
    expect(await switcher(window).locator('.w-project-switcher__name').evaluate((name) => name.scrollWidth > name.clientWidth)).toBe(true)
    // The chevron keeps its 9 px.
    expect((await switcher(window).locator('.w-project-switcher__chevron').boundingBox())?.width).toBeCloseTo(9, 0)
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
