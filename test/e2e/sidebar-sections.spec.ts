import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expandMachines, launchApp, showSidebarSection, smallestWindow, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// The sidebar's sections against the built app, over a Project in a temporary git repository with
// long lists: 12 Epics and 20 ADRs. The panel of the sidebar shows one section at a time, the one
// whose tab of the rail is chosen (worfy-polish ticket 94); the choice outlives a restart over the
// same data folder. The section shown fills the panel and its body scrolls by itself
// (src/renderer/shell/sidebar-section.css). jsdom lays nothing out, so the heights are checked only
// here.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const EPICS = Array.from({ length: 12 }, (_, index) => `epic-${String(index + 1).padStart(2, '0')}`)
const ADRS = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(4, '0'))
/** The sections in the order of the rail: the names of their files. Machines is at the foot of the rail. */
const SECTIONS = ['ProjectsSection', 'SessionsSection', 'PullRequestsSection', 'PipelineSection', 'EpicsSection', 'AdrSection', 'MachinesSection']

/** The common row, and the two-line row of Epics. */
const ROW = 28
const EPIC_ROW = 48
/** A Project's card in the Projects section once its live state is in: two lines (worfy-polish ticket 99, ProjectsSection.tsx). */
const CARD_ROW = 44
/** The header of a section. */
const HEADER = 32
/** The padding under the list, inside the body of a section (var(--space-2)). */
const BODY_PAD = 8
/** A window that fits the owner's screen. The smallest window worfy allows is set by smallestWindow. */
const TALL = { width: 1200, height: 900 }

let scratch: string
let dataDir: string
let claudeHome: string
let plainFolder: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-sidebar-')))
  dataDir = join(scratch, 'data')
  const repo = join(scratch, 'alpha')
  mkdirSync(join(repo, 'docs', 'adr'), { recursive: true })
  for (const number of ADRS) writeFileSync(join(repo, 'docs', 'adr', `${number}-decision.md`), `# Decision ${number}\n\nДата: 2026-10-05. Статус: принят.\n\nText.\n`)
  for (const epic of EPICS) {
    mkdirSync(join(repo, '.scratch', epic, 'issues'), { recursive: true })
    writeFileSync(join(repo, '.scratch', epic, 'spec.md'), `# ${epic}\n`)
    writeFileSync(join(repo, '.scratch', epic, 'issues', '01-first.md'), '# 01 — First\n\nType: task\nStatus: open\nBlocked by: —\n')
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  // A Claude home whose bin/epic-status answers with these Epics, one open Ticket in each.
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: EPICS.map((epic) => ({ epic, hasSpec: true, hasMap: false })),
      tickets: EPICS.map((epic) => ({ epic, num: 1, slug: 'first', title: '01 — First', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true })),
    }),
  )
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))

  // No git repository, and a path long enough for a message of "Add project" higher than 3 rows.
  plainFolder = join(scratch, 'a-plain-folder-that-is-not-a-repository', 'with-a-rather-long-name-inside-it', 'and-one-more-level')
  mkdirSync(plainFolder, { recursive: true })
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })

/** The page's DOM, typed for this file: the e2e typecheck has no DOM library. */
interface El {
  getAttribute(name: string): string | null
  hasAttribute(name: string): boolean
  querySelector(selector: string): El | null
  querySelectorAll(selector: string): ArrayLike<El>
  getBoundingClientRect(): { top: number; bottom: number; left: number; right: number; height: number }
  scrollHeight: number
  clientHeight: number
  scrollTop: number
}

interface SectionBox {
  /** `data-section` of the wrapper Sidebar.tsx draws, and `data-section-id` of the frame inside it. */
  wrapper: string | null
  frame: string | null
  /** Whether the wrapper is the one the panel shows (the others have `hidden`). */
  shown: boolean
  top: number
  bottom: number
  /** The body: its height on screen and the height of its whole content. */
  body: number
  content: number
}

interface ColumnBox {
  top: number
  bottom: number
  clientHeight: number
  scrollHeight: number
  sections: SectionBox[]
}

/** Where the sections are in the panel of the sidebar, in px of the page. A hidden one measures 0. */
const measure = (window: Page): Promise<ColumnBox> =>
  window.locator('.w-sidebar__sections').evaluate((node) => {
    const column = node as unknown as El
    const sections = Array.from(column.querySelectorAll('[data-section]')).map((wrapper) => {
      const frame = wrapper.querySelector('.w-sidebar-section')
      const body = frame?.querySelector('.w-sidebar-section__body') ?? null
      const box = frame?.getBoundingClientRect()
      return {
        wrapper: wrapper.getAttribute('data-section'),
        frame: frame?.getAttribute('data-section-id') ?? null,
        shown: !wrapper.hasAttribute('hidden'),
        top: box?.top ?? 0,
        bottom: box?.bottom ?? 0,
        body: body?.getBoundingClientRect().height ?? 0,
        content: body?.scrollHeight ?? 0,
      }
    })
    const box = column.getBoundingClientRect()
    return { top: box.top, bottom: box.bottom, clientHeight: column.clientHeight, scrollHeight: column.scrollHeight, sections }
  })

const sectionOf = (column: ColumnBox, id: string): SectionBox => {
  const found = column.sections.find((section) => section.frame === id)
  if (found === undefined) throw new Error(`no section ${id} in the sidebar`)
  return found
}

/**
 * Section `id` is the one the panel shows, from its top to its bottom, and the panel itself does
 * not scroll: what is longer than the panel scrolls in the body of the section.
 */
function expectFills(column: ColumnBox, id: string, where = id): void {
  expect(column.sections.filter((section) => section.shown).map((section) => section.frame), where).toStrictEqual([id])
  const section = sectionOf(column, id)
  expect(Math.round(section.top), where).toBe(Math.round(column.top))
  expect(Math.round(section.bottom), where).toBe(Math.round(column.bottom))
  expect(column.scrollHeight, where).toBe(column.clientHeight)
}

const region = (window: Page, name: string): Locator => window.getByRole('region', { name, exact: true })
const railTab = (window: Page, name: string): Locator => window.getByRole('tablist', { name: 'Sidebar sections' }).getByRole('tab', { name, exact: true })

/**
 * Sets the page to `size`, or the window to the smallest worfy allows: 800×520 outside, so on
 * Windows the page is lower and narrower than that (smallestWindow). Returns the page's size.
 */
async function setWindowSize(launched: LaunchedApp, size: { width: number; height: number } | 'smallest'): Promise<{ width: number; height: number }> {
  if (size === 'smallest') return smallestWindow(launched)
  await launched.app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted.width, wanted.height), size)
  await expect
    .poll(() => launched.window.evaluate(() => [(globalThis as unknown as { innerWidth: number }).innerWidth, (globalThis as unknown as { innerHeight: number }).innerHeight]))
    .toStrictEqual([size.width, size.height])
  return size
}

/**
 * The lists of the fixture are read and drawn, shown or not. The Project switcher says «All Projects»:
 * Epics lists those of every Project (bin/epic-status of the fixture answers the same for each), ADR
 * those of the open one alone.
 */
async function listsShown(window: Page, projects = 1): Promise<void> {
  await expect(window.getByTestId('sidebar-epic')).toHaveCount(EPICS.length * projects)
  await expect(window.getByTestId('sidebar-adr')).toHaveCount(ADRS.length)
  await expect(window.getByTestId('project-row')).toHaveCount(projects)
}

/**
 * Makes "Add project" fail with a long message and returns the message. The system folder picker
 * is replaced in main before the click, so no system dialog opens: it answers with a folder that
 * is no git repository, which worfy refuses.
 */
async function addProjectFails(launched: LaunchedApp): Promise<Locator> {
  const stubbed = await launched.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    return String(dialog.showOpenDialog).includes('filePaths')
  }, plainFolder)
  expect(stubbed).toBe(true)
  const projects = region(launched.window, 'Projects')
  await projects.getByRole('button', { name: 'Add project' }).click()
  const error = projects.getByTestId('projects-error')
  await expect(error).toBeVisible()
  await expect(error).toContainText(plainFolder)
  // Higher than the 3 rows a notice may take.
  expect(await projects.locator('.w-sidebar-section__notice').evaluate((node) => (node as unknown as El).scrollHeight)).toBeGreaterThan(3 * ROW)
  return error
}

const height = async (locator: Locator): Promise<number> => (await locator.boundingBox())?.height ?? Number.NaN

/** What app-settings.json of the data folder keeps in `sidebar.collapsed`, once worfy has written it. */
function savedCollapsed(): Record<string, boolean> | null {
  // src/main/settings/store.ts, APP_SETTINGS_FILE.
  const file = join(dataDir, 'app-settings.json')
  if (!existsSync(file)) return null
  return (JSON.parse(readFileSync(file, 'utf8')) as { sidebar: { collapsed: Record<string, boolean> } }).sidebar.collapsed
}

/** The section the window saved as chosen (src/renderer/shell/sidebar-scope.ts, SIDEBAR_SECTION_KEY). */
const savedSection = (window: Page): Promise<string | null> =>
  window.evaluate(() => (globalThis as unknown as { localStorage: { getItem(key: string): string | null } }).localStorage.getItem('worfy.sidebar.section'))

test('one section at a time: each comes by its tab of the rail and fills the panel, and the one chosen is shown after a restart; History opens under the header of Sessions', async () => {
  let launched = await launch()
  try {
    const { window } = launched
    await listsShown(window)

    // Every section is drawn in the panel, under the id of its file, in the order of the rail.
    const before = await measure(window)
    // Getting started is no section of the sidebar (worfy-onboarding ticket 13): a panel of its own.
    expect(before.sections.map((section) => section.wrapper)).toStrictEqual(SECTIONS)
    expect(before.sections.map((section) => section.frame)).toStrictEqual(SECTIONS)
    // Projects is shown first; the others are mounted, hidden.
    expectFills(before, 'ProjectsSection')
    await expect(railTab(window, 'Projects')).toHaveAttribute('aria-selected', 'true')
    await expect(window.getByTestId('project-row')).toBeVisible()
    await expect(window.getByTestId('link-machine-button')).toBeHidden()
    // The user shows Machines: "Link a machine…" is on screen, and the window remembers the choice.
    await expandMachines(window)
    expectFills(await measure(window), 'MachinesSection')
    await expect.poll(() => savedSection(window)).toBe('MachinesSection')

    // A click on the tab of Epics: its rows are on screen, the rows of the other sections stay in the DOM, hidden.
    await showSidebarSection(window, 'Epics')
    await expect(window.getByTestId('sidebar-epic').first()).toBeVisible()
    await expect(window.getByTestId('sidebar-adr')).toHaveCount(ADRS.length)
    await expect(window.getByTestId('sidebar-adr').first()).toBeHidden()
    await expect(window.getByTestId('project-row')).toBeHidden()
    await expect(window.getByTestId('link-machine-button')).toBeHidden()
    expectFills(await measure(window), 'EpicsSection')

    // ↓ on the tab of Epics shows the next section, ADR; ↑ goes back.
    await railTab(window, 'Epics').focus()
    await window.keyboard.press('ArrowDown')
    await expect(railTab(window, 'ADR')).toHaveAttribute('aria-selected', 'true')
    await expect(window.getByTestId('sidebar-adr').first()).toBeVisible()
    await expect(window.getByTestId('sidebar-epic').first()).toBeHidden()
    await window.keyboard.press('ArrowUp')
    await expect(railTab(window, 'Epics')).toHaveAttribute('aria-selected', 'true')
    await expect(window.getByTestId('sidebar-epic').first()).toBeVisible()

    // A button of a section's header: History opens and closes its popover.
    await showSidebarSection(window, 'Sessions')
    const history = region(window, 'Sessions').getByTestId('sidebar-history')
    await history.click()
    await expect(window.getByTestId('history-popover')).toBeVisible()
    // The popover starts under the header and the row of New session and Product Session, and covers
    // neither: History closes it again.
    const actions = (await region(window, 'Sessions').locator('.w-sidebar-section__actions').boundingBox())!
    expect(actions.y).toBe(sectionOf(await measure(window), 'SessionsSection').top + HEADER)
    expect((await window.getByTestId('history-popover').boundingBox())!.y).toBe(actions.y + actions.height)
    await history.click()
    await expect(window.getByTestId('history-popover')).toHaveCount(0)

    await expect.poll(() => savedSection(window)).toBe('SessionsSection')
    // The sections no longer fold: nothing about them is saved in the app settings.
    expect(Object.keys(savedCollapsed() ?? {}).filter((key) => SECTIONS.includes(key))).toStrictEqual([])
    await snapshotThemes(window, 'sidebar-sessions')
  } finally {
    await launched.close()
  }

  // The same data folder: the section chosen last, Sessions, is the one shown.
  launched = await launch()
  try {
    const { window } = launched
    await listsShown(window)
    await expect(railTab(window, 'Sessions')).toHaveAttribute('aria-selected', 'true')
    await expect(region(window, 'Sessions')).toBeVisible()
    await expect(window.getByTestId('project-row')).toBeHidden()
    await expect(window.getByTestId('sidebar-epic').first()).toBeHidden()
    expectFills(await measure(window), 'SessionsSection')

    // The header of Sessions holds the heading, the count and History without cutting any; "New session" and
    // "Product Session" share the row under it, as in the sidebar prototype, both whole.
    const sessions = region(window, 'Sessions')
    const history = sessions.getByTestId('sidebar-history')
    const frame = (await sessions.boundingBox())!
    const historyBox = (await history.boundingBox())!
    const liveBox = (await sessions.getByTestId('sidebar-sessions-live').boundingBox())!
    // History ends at the header's padding, 6 px from the edge of the section…
    expect(frame.x + frame.width - (historyBox.x + historyBox.width)).toBeCloseTo(6, 0)
    // …and between the count and it there is the gap (6 px) and room for a second digit (6 px).
    await expect(sessions.getByTestId('sidebar-sessions-live')).toHaveText('0 live')
    expect(historyBox.x - (liveBox.x + liveBox.width)).toBeGreaterThanOrEqual(10)
    for (const id of ['sidebar-new-session', 'sidebar-new-product-session']) {
      const whole = await sessions.getByTestId(id).evaluate((button) => button.scrollWidth <= button.clientWidth)
      expect(whole, `${id} shows its whole label`).toBe(true)
      expect((await sessions.getByTestId(id).boundingBox())!.y).toBeGreaterThan(liveBox.y + liveBox.height)
    }

    // History's popover is whole on screen, under the header and inside the panel.
    await history.click()
    const popover = window.getByTestId('history-popover')
    await expect(popover).toBeVisible()
    await expect(popover).toBeInViewport({ ratio: 1 })
    const column = await measure(window)
    const popoverBox = (await popover.boundingBox())!
    expect(popoverBox.y).toBeGreaterThanOrEqual(sectionOf(column, 'SessionsSection').top + HEADER)
    expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(column.bottom)
    expect(popoverBox.height).toBeGreaterThan(ROW)
    await history.click()
    await expect(popover).toHaveCount(0)

    // A count too long for the header is what gets cut: History stays whole, where it was.
    await sessions.getByTestId('sidebar-sessions-live').evaluate((node) => {
      ;(node as unknown as { textContent: string }).textContent = '1234567890123456789012345678901234567890 live'
    })
    const squeezed = {
      live: (await sessions.getByTestId('sidebar-sessions-live').boundingBox())!,
      history: (await history.boundingBox())!,
    }
    expect(squeezed.history).toStrictEqual(historyBox)
    expect(squeezed.live.x + squeezed.live.width).toBeGreaterThan(squeezed.history.x)
    const cut = (await sessions.locator('.w-sidebar-section__meta').boundingBox())!
    expect(cut.x + cut.width).toBeLessThanOrEqual(squeezed.history.x)
  } finally {
    await launched.close()
  }
})

test('an error of "Add project" stays above the list of Projects and takes no room from it, in the smallest window and in a tall one', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await listsShown(window)
    await setWindowSize(launched, 'smallest')
    // The smallest window as a fresh worfy shows the sidebar with Projects in its panel, from the top to the bottom.
    expectFills(await measure(window), 'ProjectsSection', 'a fresh smallest window')

    const projects = region(window, 'Projects')
    const error = await addProjectFails(launched)
    const notice = projects.locator('.w-sidebar-section__notice')
    const row = window.getByTestId('project-row')
    /** The notice, the body and the only row of Projects, in px of the page. */
    const projectsBoxes = async () => {
      const column = await measure(window)
      const section = sectionOf(column, 'ProjectsSection')
      const noticeBox = (await notice.boundingBox())!
      const rowBox = (await row.boundingBox())!
      const bodyBox = (await projects.locator('.w-sidebar-section__body').boundingBox())!
      return { column, section, noticeBox, rowBox, bodyBox, noticeContent: await notice.evaluate((node) => (node as unknown as El).scrollHeight) }
    }
    const check = async (where: string): Promise<void> => {
      const { column, section, noticeBox, rowBox, bodyBox, noticeContent } = await projectsBoxes()
      // The message is longer than 3 rows: it is cut at 3 rows and scrolls by itself.
      expect(noticeContent, where).toBeGreaterThan(3 * ROW)
      expect(noticeBox.height, where).toBe(3 * ROW)
      // The list keeps its whole row, inside the body, under the message; the body takes the rest of the panel.
      expect(rowBox.y, where).toBeGreaterThanOrEqual(bodyBox.y)
      expect(rowBox.y + rowBox.height, where).toBeLessThanOrEqual(bodyBox.y + bodyBox.height)
      expect(bodyBox.y, where).toBeGreaterThanOrEqual(noticeBox.y + noticeBox.height)
      expect(Math.round(bodyBox.y + bodyBox.height), where).toBe(Math.round(section.bottom))
      expect(section.content, where).toBe(section.body)
      expectFills(column, 'ProjectsSection', where)
      await expect(row, where).toBeInViewport({ ratio: 1 })
    }

    await check('the smallest window')

    // 1200×900: the panel is higher, the message keeps its 3 rows.
    const small = await measure(window)
    await setWindowSize(launched, TALL)
    await expect.poll(async () => (await measure(window)).clientHeight).toBeGreaterThan(small.clientHeight)
    await check('1200×900')

    // Another section and back: the message is still above the list.
    await showSidebarSection(window, 'Epics')
    await expect(error).toBeHidden()
    await showSidebarSection(window, 'Projects')
    await expect(error).toBeVisible()
    expect(await height(notice)).toBe(3 * ROW)
  } finally {
    await launched.close()
  }
})

test('under an error of "Add project" a list of 8 Projects keeps the rest of the panel; a short error is shown whole and leaves the list the rest', async () => {
  // Seven more Projects, in plain folders.
  const more = ['beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'].map((name, index) => {
    mkdirSync(join(scratch, name))
    mkdirSync(join(dataDir, `${name}-000000${index}b`), { recursive: true })
    return { id: `${name}-000000${index}b`, name, path: join(scratch, name) }
  })
  const file = join(dataDir, 'projects.json')
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { projects: unknown[]; activeId: string }
  writeFileSync(file, JSON.stringify({ ...saved, projects: [...saved.projects, ...more] }))

  const launched = await launch()
  try {
    const { window } = launched
    const { app } = launched
    await listsShown(window, 8)
    // Each row is a card of two lines once the live state of the Projects is in.
    await expect(window.getByTestId('project-pulse')).toHaveCount(8)
    await setWindowSize(launched, 'smallest')
    // The smallest window. Without a message the list has the panel under the header, and its 8 cards fit.
    const quietColumn = await measure(window)
    expectFills(quietColumn, 'ProjectsSection', 'without a message')
    const quiet = sectionOf(quietColumn, 'ProjectsSection')
    expect(quiet.content).toBe(quiet.body)
    expect(quiet.body).toBeGreaterThanOrEqual(8 * CARD_ROW)
    expect(Math.round(quiet.body)).toBe(Math.round(quiet.bottom - quiet.top - HEADER))

    // A short error: the folder picker, replaced in main, fails. No system dialog opens.
    const projects = region(window, 'Projects')
    const notice = projects.locator('.w-sidebar-section__notice')
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (() => Promise.reject(new Error('no'))) as typeof dialog.showOpenDialog
    })
    await projects.getByRole('button', { name: 'Add project' }).click()
    await expect(projects.getByTestId('projects-error')).toBeVisible()
    const shortNotice = await notice.evaluate((node) => ({ shown: (node as unknown as El).clientHeight, whole: (node as unknown as El).scrollHeight }))
    // Lower than the 3 rows a notice may take, and not squeezed: all of it is shown.
    expect(shortNotice.whole).toBeLessThan(3 * ROW)
    expect(shortNotice.whole).toBeGreaterThan(0)
    expect(shortNotice.shown).toBe(shortNotice.whole)
    // The list has what the message leaves of the panel.
    const withShort = sectionOf(await measure(window), 'ProjectsSection')
    expect(Math.round(withShort.body)).toBe(Math.round(quiet.body - shortNotice.whole))

    // A long error takes the place of the short one, 3 rows of it.
    await addProjectFails(launched)
    expect(await height(notice)).toBe(3 * ROW)

    // The header, the message and the rest of the panel for the list, which scrolls by itself.
    const small = await measure(window)
    expectFills(small, 'ProjectsSection', 'a long message')
    const squeezed = sectionOf(small, 'ProjectsSection')
    expect(Math.round(squeezed.body)).toBe(Math.round(quiet.body - 3 * ROW))
    expect(squeezed.content).toBeGreaterThanOrEqual(8 * CARD_ROW)
    const bodyBox = (await projects.locator('.w-sidebar-section__body').boundingBox())!
    const firstRow = (await window.getByTestId('project-row').first().boundingBox())!
    expect(firstRow.y).toBe(bodyBox.y)
    await expect(window.getByTestId('project-row').first()).toBeInViewport({ ratio: 1 })

    // 1200×900: the list is whole under the message.
    await setWindowSize(launched, TALL)
    await expect.poll(async () => sectionOf(await measure(window), 'ProjectsSection').body).toBeGreaterThan(squeezed.body)
    const tall = await measure(window)
    expectFills(tall, 'ProjectsSection', '1200×900')
    expect(sectionOf(tall, 'ProjectsSection').content).toBe(sectionOf(tall, 'ProjectsSection').body)
    await expect(window.getByTestId('project-row').last()).toBeInViewport({ ratio: 1 })
  } finally {
    await launched.close()
  }
})

test('a long list fills the panel and scrolls by itself, not the panel, in the smallest window; in a tall one the list of ADR is whole', async () => {
  // Two more Projects, in plain folders: a list of 3 rows.
  const more = ['beta', 'gamma'].map((name, index) => {
    mkdirSync(join(scratch, name))
    mkdirSync(join(dataDir, `${name}-000000${index}b`), { recursive: true })
    return { id: `${name}-000000${index}b`, name, path: join(scratch, name) }
  })
  const file = join(dataDir, 'projects.json')
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { projects: unknown[]; activeId: string }
  writeFileSync(file, JSON.stringify({ ...saved, projects: [...saved.projects, ...more] }))

  const launched = await launch()
  try {
    const { window } = launched
    await listsShown(window, 3)

    // The rows of the lists are the rows on screen; a Project's row is a card of two lines with its live state.
    await expect.poll(() => height(window.getByTestId('project-row').first())).toBe(CARD_ROW)
    await showSidebarSection(window, 'Epics')
    expect(await height(window.getByTestId('sidebar-epic').first())).toBe(EPIC_ROW)
    await showSidebarSection(window, 'ADR')
    expect(await height(window.getByTestId('sidebar-adr').first())).toBe(ROW)

    // The smallest window: each long list fills the panel and scrolls by itself; the panel does not scroll.
    await setWindowSize(launched, 'smallest')
    await expect
      .poll(async () => {
        const shown = sectionOf(await measure(window), 'AdrSection')
        return shown.content - shown.body
      })
      .toBeGreaterThan(0)
    const smallAdr = await measure(window)
    expectFills(smallAdr, 'AdrSection', 'ADR in the smallest window')
    const adr = sectionOf(smallAdr, 'AdrSection')
    expect(adr.content).toBe(ADRS.length * ROW + BODY_PAD)
    expect(adr.body).toBeLessThan(adr.content)
    await showSidebarSection(window, 'Epics')
    const smallEpics = await measure(window)
    expectFills(smallEpics, 'EpicsSection', 'Epics in the smallest window')
    const epics = sectionOf(smallEpics, 'EpicsSection')
    // The Epics of the 3 Projects, under «All Projects».
    expect(epics.content).toBeGreaterThanOrEqual(3 * EPICS.length * EPIC_ROW)
    expect(epics.body).toBeLessThan(epics.content)
    // A list of 3 rows does not scroll: the body is the rest of the panel; so is the body of Machines,
    // which is "Link a machine…" alone.
    await showSidebarSection(window, 'Projects')
    const smallProjects = await measure(window)
    expectFills(smallProjects, 'ProjectsSection', 'Projects in the smallest window')
    expect(sectionOf(smallProjects, 'ProjectsSection').content).toBe(sectionOf(smallProjects, 'ProjectsSection').body)
    await expandMachines(window)
    const smallMachines = await measure(window)
    expectFills(smallMachines, 'MachinesSection', 'Machines in the smallest window')
    expect(sectionOf(smallMachines, 'MachinesSection').body).toBe(sectionOf(smallMachines, 'MachinesSection').content)
    expect(sectionOf(smallMachines, 'MachinesSection').body).toBeGreaterThan(0)

    // The wheel over the list of ADR scrolls the list.
    await showSidebarSection(window, 'ADR')
    const adrBody = region(window, 'ADR').locator('.w-sidebar-section__body')
    await window.getByTestId('sidebar-adr').first().hover()
    await window.mouse.wheel(0, 3 * ROW)
    await expect.poll(() => adrBody.evaluate((node) => (node as unknown as El).scrollTop)).toBeGreaterThan(0)
    // The last ADR is reached by scrolling the list, not the panel.
    const last = window.getByTestId('sidebar-adr').last()
    await expect(last).not.toBeInViewport()
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport({ ratio: 1 })
    expect(await window.locator('.w-sidebar__sections').evaluate((node) => (node as unknown as El).scrollTop)).toBe(0)

    // 1200×900: the panel is higher; ADR is whole in it, the Epics of 3 Projects still scroll by themselves.
    await setWindowSize(launched, TALL)
    await expect.poll(async () => sectionOf(await measure(window), 'AdrSection').body).toBeGreaterThan(adr.body)
    const tallAdr = await measure(window)
    expectFills(tallAdr, 'AdrSection', 'ADR in 1200×900')
    expect(sectionOf(tallAdr, 'AdrSection').content).toBe(sectionOf(tallAdr, 'AdrSection').body)
    await expect(last).toBeInViewport({ ratio: 1 })
    await showSidebarSection(window, 'Epics')
    const tallEpics = await measure(window)
    expectFills(tallEpics, 'EpicsSection', 'Epics in 1200×900')
    expect(sectionOf(tallEpics, 'EpicsSection').body).toBeGreaterThan(epics.body)
    expect(sectionOf(tallEpics, 'EpicsSection').content).toBeGreaterThan(sectionOf(tallEpics, 'EpicsSection').body)
    await expect(window.getByTestId('sidebar-epic').first()).toBeInViewport({ ratio: 1 })

    await snapshotThemes(window, 'sidebar-tall')
  } finally {
    await launched.close()
  }
})
