import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { MIN_SIZE } from '../../src/shared/window/bounds'
import { expandMachines, launchApp, smallestWindow, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// The sidebar's sections against the built app, over a Project in a temporary git repository with
// long lists: 12 Epics and 20 ADRs. Each section collapses by its heading and stays collapsed after
// a restart over the same data folder; the lists share the height of the sidebar's column, each
// between 3 and 15 of its own rows (src/renderer/shell/sidebar-section.css). jsdom lays nothing
// out, so the heights, and Enter and Space on a heading, are checked only here.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const EPICS = Array.from({ length: 12 }, (_, index) => `epic-${String(index + 1).padStart(2, '0')}`)
const ADRS = Array.from({ length: 20 }, (_, index) => String(index + 1).padStart(4, '0'))
/** The sections in the order of the sidebar: the names of their files. */
const SECTIONS = ['ProjectsSection', 'MachinesSection', 'EpicsSection', 'PipelineSection', 'SessionsSection', 'AdrSection']

/** The rows the height rules count in: the common row, and the two-line row of Epics. */
const ROW = 28
const EPIC_ROW = 48
/** The header of a section. */
const HEADER = 24
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

/** Where the sections are in the sidebar's column, in px of the page. */
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

/** No section lies over the next one. */
function expectNoOverlap(column: ColumnBox): void {
  for (const [index, section] of column.sections.entries()) {
    const next = column.sections[index + 1]
    if (next !== undefined) expect(section.bottom, `${section.frame} ends above ${next.frame}`).toBeLessThanOrEqual(next.top)
  }
}

const region = (window: Page, name: string): Locator => window.getByRole('region', { name, exact: true })
const heading = (window: Page, name: string): Locator => region(window, name).getByRole('button', { name, exact: true })

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

/** The lists of the fixture are read and drawn. */
async function listsShown(window: Page, projects = 1): Promise<void> {
  await expect(window.getByTestId('sidebar-epic')).toHaveCount(EPICS.length)
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

/** What app-settings.json of the data folder says about the sections, once worfy has written it. */
function savedCollapsed(): Record<string, boolean> | null {
  // src/main/settings/store.ts, APP_SETTINGS_FILE.
  const file = join(dataDir, 'app-settings.json')
  if (!existsSync(file)) return null
  return (JSON.parse(readFileSync(file, 'utf8')) as { sidebar: { collapsed: Record<string, boolean> } }).sidebar.collapsed
}

test('a section collapses by a click, Enter and Space on its heading and stays collapsed after a restart; History opens over a collapsed Sessions', async () => {
  let launched = await launch()
  try {
    const { window } = launched
    await listsShown(window)

    // Every section is drawn in the frame, under the id of its file: the key of its saved state.
    const before = await measure(window)
    // Getting started is no section of the sidebar (worfy-onboarding ticket 13): a panel of its own.
    expect(before.sections.map((section) => section.wrapper)).toStrictEqual(SECTIONS)
    expect(before.sections.map((section) => section.frame)).toStrictEqual(SECTIONS)
    for (const name of ['Projects', 'Epics', 'Sessions', 'ADR']) await expect(heading(window, name)).toHaveAttribute('aria-expanded', 'true')
    // Machines alone is collapsed until the user expands it: nothing is saved about it yet, and
    // the section is its header.
    await expect(heading(window, 'Machines')).toHaveAttribute('aria-expanded', 'false')
    await expect(window.getByTestId('link-machine-button')).toBeHidden()
    expect(savedCollapsed()?.MachinesSection).toBeUndefined()
    const machines = sectionOf(before, 'MachinesSection')
    expect(machines.bottom - machines.top).toBe(HEADER)
    // The user expands it: "Link a machine…" is on screen, and worfy remembers the section expanded.
    await heading(window, 'Machines').click()
    await expect(heading(window, 'Machines')).toHaveAttribute('aria-expanded', 'true')
    await expect(window.getByTestId('link-machine-button')).toBeVisible()
    await expect.poll(savedCollapsed).toStrictEqual({ MachinesSection: false })

    // The chevron is drawn in the colour of the heading, the muted text (the count of ADR has it too).
    const colours = await region(window, 'ADR').evaluate((node) => {
      const style = (element: El | null): { color: string; stroke: string } => (globalThis as unknown as { getComputedStyle(element: El | null): { color: string; stroke: string } }).getComputedStyle(element)
      const section = node as unknown as El
      return { heading: style(section.querySelector('h2')).color, chevron: style(section.querySelector('h2 svg')).stroke, count: style(section.querySelector('[data-testid="adr-count"]')).color }
    })
    expect(colours.chevron).toBe(colours.heading)
    expect(colours.heading).toBe(colours.count)

    // A click collapses Epics: the rows stay in the DOM, hidden.
    await heading(window, 'Epics').click()
    await expect(heading(window, 'Epics')).toHaveAttribute('aria-expanded', 'false')
    await expect(window.getByTestId('sidebar-epic')).toHaveCount(EPICS.length)
    await expect(window.getByTestId('sidebar-epic').first()).toBeHidden()
    const collapsedEpics = sectionOf(await measure(window), 'EpicsSection')
    expect(collapsedEpics.bottom - collapsedEpics.top).toBe(HEADER)

    // Enter and Space on the heading: collapsed, expanded, collapsed again.
    await heading(window, 'ADR').focus()
    await window.keyboard.press('Enter')
    await expect(heading(window, 'ADR')).toHaveAttribute('aria-expanded', 'false')
    await expect(window.getByTestId('sidebar-adr').first()).toBeHidden()
    await window.keyboard.press('Space')
    await expect(heading(window, 'ADR')).toHaveAttribute('aria-expanded', 'true')
    await expect(window.getByTestId('sidebar-adr').first()).toBeVisible()
    await window.keyboard.press('Enter')
    await expect(heading(window, 'ADR')).toHaveAttribute('aria-expanded', 'false')

    // A button of a section does not collapse it: History opens and closes its popover.
    const history = region(window, 'Sessions').getByTestId('sidebar-history')
    await history.click()
    await expect(window.getByTestId('history-popover')).toBeVisible()
    await expect(heading(window, 'Sessions')).toHaveAttribute('aria-expanded', 'true')
    // The popover starts under the header and does not cover it: History closes it again.
    const headerBottom = sectionOf(await measure(window), 'SessionsSection').top + HEADER
    expect((await window.getByTestId('history-popover').boundingBox())!.y).toBe(headerBottom)
    await history.click()
    await expect(window.getByTestId('history-popover')).toHaveCount(0)
    await expect(heading(window, 'Sessions')).toHaveAttribute('aria-expanded', 'true')

    await expect.poll(savedCollapsed).toStrictEqual({ MachinesSection: false, EpicsSection: true, AdrSection: true })
    await snapshotThemes(window, 'sidebar-collapsed')
  } finally {
    await launched.close()
  }

  // The same data folder: Epics and ADR are collapsed from the first frame the lists are in, and
  // Machines, which the user expanded, is expanded.
  launched = await launch()
  try {
    const { window } = launched
    await listsShown(window)
    await expect(heading(window, 'Epics')).toHaveAttribute('aria-expanded', 'false')
    await expect(heading(window, 'ADR')).toHaveAttribute('aria-expanded', 'false')
    await expect(window.getByTestId('sidebar-epic').first()).toBeHidden()
    await expect(window.getByTestId('sidebar-adr').first()).toBeHidden()
    for (const name of ['Projects', 'Machines', 'Sessions']) await expect(heading(window, name)).toHaveAttribute('aria-expanded', 'true')
    await expect(window.getByTestId('link-machine-button')).toBeVisible()
    // The count of a collapsed ADR section is still in its header.
    await expect(region(window, 'ADR').getByTestId('adr-count')).toHaveText(String(ADRS.length))
    await expect(region(window, 'ADR').getByTestId('adr-count')).toBeVisible()

    // The header of Sessions holds the heading, the count and both buttons without cutting any.
    const sessions = region(window, 'Sessions')
    const history = sessions.getByTestId('sidebar-history')
    const frame = (await sessions.boundingBox())!
    const historyBox = (await history.boundingBox())!
    const liveBox = (await sessions.getByTestId('sidebar-sessions-live').boundingBox())!
    const newBox = (await sessions.getByTestId('sidebar-new-session').boundingBox())!
    // The buttons end at the header's padding, 4 px from the edge of the section…
    expect(frame.x + frame.width - (historyBox.x + historyBox.width)).toBe(4)
    // …and between the count and them there is the gap (4 px) and room for a second digit (6 px).
    await expect(sessions.getByTestId('sidebar-sessions-live')).toHaveText('0 live')
    expect(newBox.x - (liveBox.x + liveBox.width)).toBeGreaterThanOrEqual(10)

    // Sessions collapsed: History still opens its popover, inside the sidebar's column.
    await heading(window, 'Sessions').click()
    await expect(heading(window, 'Sessions')).toHaveAttribute('aria-expanded', 'false')
    await history.click()
    const popover = window.getByTestId('history-popover')
    await expect(popover).toBeVisible()
    await expect(popover).toBeInViewport({ ratio: 1 })
    const column = await measure(window)
    const popoverBox = (await popover.boundingBox())!
    expect(popoverBox.y).toBeGreaterThanOrEqual(sectionOf(column, 'SessionsSection').bottom)
    expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(column.bottom)
    expect(popoverBox.height).toBeGreaterThan(ROW)
    await expect(heading(window, 'Sessions')).toHaveAttribute('aria-expanded', 'false')
    await history.click()
    await expect(popover).toHaveCount(0)

    // A count too long for the header is what gets cut: both buttons stay whole, where they were.
    await sessions.getByTestId('sidebar-sessions-live').evaluate((node) => {
      ;(node as unknown as { textContent: string }).textContent = '1234567890123456789012345678901234567890 live'
    })
    const squeezed = {
      live: (await sessions.getByTestId('sidebar-sessions-live').boundingBox())!,
      newSession: (await sessions.getByTestId('sidebar-new-session').boundingBox())!,
      history: (await history.boundingBox())!,
    }
    expect(squeezed.history).toStrictEqual(historyBox)
    expect(squeezed.newSession).toStrictEqual(newBox)
    expect(squeezed.live.x + squeezed.live.width).toBeGreaterThan(squeezed.newSession.x)
    const cut = (await sessions.locator('.w-sidebar-section__meta').boundingBox())!
    expect(cut.x + cut.width).toBeLessThanOrEqual(squeezed.newSession.x)

    // Machines collapsed by the user this time: saved as collapsed, not left to the default.
    await heading(window, 'Machines').click()
    await expect(heading(window, 'Machines')).toHaveAttribute('aria-expanded', 'false')
    await expect(window.getByTestId('link-machine-button')).toBeHidden()
    await expect.poll(() => savedCollapsed()?.MachinesSection).toBe(true)
  } finally {
    await launched.close()
  }
})

test('an error of "Add project" stays above the list of Projects and takes no room from it, in the smallest window and in a tall one', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await listsShown(window)
    const page = await setWindowSize(launched, 'smallest')
    // The smallest window as a fresh worfy shows the sidebar, Machines collapsed to its header; the
    // long lists are squeezed.
    await expect.poll(async () => sectionOf(await measure(window), 'EpicsSection').body).toBeLessThan(EPICS.length * EPIC_ROW)
    const fresh = await measure(window)
    expect(sectionOf(fresh, 'MachinesSection').bottom - sectionOf(fresh, 'MachinesSection').top).toBe(HEADER)
    const freshEpics = sectionOf(fresh, 'EpicsSection').body
    const freshAdr = sectionOf(fresh, 'AdrSection').body
    // The column is the page less 60 px (toolbar 52, padding 8; shell.css, tokens.css), and the
    // sections need 442 px with both long lists at their floors. In a page of 800×520 (macOS, where
    // the window has no frame) the column is 460 px: it does not scroll and is used to its end, the
    // 18 px left over going to the long lists. On Windows the frame takes part of the smallest window:
    // the page is 786×458 (measured at 150 %), the column 398 px, so each long list is at its floor
    // and the column scrolls instead. The else branch is that frame; a page of 502 to 519 px would
    // fit without scrolling and needs a branch of its own.
    if (page.height >= MIN_SIZE.height) {
      expect(fresh.scrollHeight).toBe(fresh.clientHeight)
      expect(freshEpics).toBeGreaterThan(3 * EPIC_ROW)
      expect(freshAdr).toBeGreaterThan(3 * ROW)
      expect(Math.round(sectionOf(fresh, 'AdrSection').bottom)).toBe(Math.round(fresh.bottom))
    } else {
      expect(fresh.scrollHeight).toBeGreaterThan(fresh.clientHeight)
      expect(freshEpics).toBe(3 * EPIC_ROW)
      expect(freshAdr).toBe(3 * ROW)
    }
    expectNoOverlap(fresh)
    // Every section expanded: Machines is collapsed until the user expands it.
    await expandMachines(window)

    const projects = region(window, 'Projects')
    const error = await addProjectFails(launched)
    // With the message the floors of the sections do not fit the column of the smallest window.
    // (Without it they do in a page of 800×520, since the switches of Machines moved to Settings.)
    await expect.poll(async () => sectionOf(await measure(window), 'EpicsSection').body).toBe(3 * EPIC_ROW)
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
      // The list keeps its whole row, inside the body, under the message.
      expect(section.body, where).toBe(ROW)
      expect(section.content, where).toBe(ROW)
      expect(rowBox.y, where).toBeGreaterThanOrEqual(bodyBox.y)
      expect(rowBox.y + rowBox.height, where).toBeLessThanOrEqual(bodyBox.y + bodyBox.height)
      expect(bodyBox.y, where).toBeGreaterThanOrEqual(noticeBox.y + noticeBox.height)
      // The section is its header, the message and the row.
      expect(section.bottom - section.top, where).toBe(HEADER + 3 * ROW + ROW)
      expectNoOverlap(column)
      await expect(row, where).toBeInViewport({ ratio: 1 })
    }

    // The smallest window: every section is at its floor and the column scrolls.
    const small = await measure(window)
    expect(small.scrollHeight).toBeGreaterThan(small.clientHeight)
    expect(sectionOf(small, 'EpicsSection').body).toBe(3 * EPIC_ROW)
    expect(sectionOf(small, 'AdrSection').body).toBe(3 * ROW)
    await check('the smallest window')

    // 1200×900, Epics and ADR expanded and squeezed: the column has no room to spare either.
    await setWindowSize(launched, TALL)
    await expect.poll(async () => (await measure(window)).clientHeight).toBeGreaterThan(small.clientHeight)
    const tall = await measure(window)
    expect(tall.scrollHeight).toBe(tall.clientHeight)
    expect(sectionOf(tall, 'EpicsSection').body).toBeLessThan(EPICS.length * EPIC_ROW)
    expect(sectionOf(tall, 'AdrSection').body).toBeLessThan(15 * ROW)
    await check('1200×900')

    // A collapsed Projects still shows the message.
    await heading(window, 'Projects').click()
    await expect(row).toBeHidden()
    await expect(error).toBeVisible()
    expect(await height(notice)).toBe(3 * ROW)
  } finally {
    await launched.close()
  }
})

test('under an error of "Add project" a list of 8 Projects keeps 3 rows at the floor of its section; a short error is shown whole and leaves the list the rest', async () => {
  // Seven more Projects, in plain folders: the list is longer than the floor of the section keeps.
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
    // Every section expanded: Machines is collapsed until the user expands it.
    await expandMachines(window)
    await setWindowSize(launched, 'smallest')
    await expect.poll(async () => sectionOf(await measure(window), 'EpicsSection').body).toBe(3 * EPIC_ROW)
    // The smallest window, every section at its floor. Without a message the floor is the header and 3 rows.
    const quiet = sectionOf(await measure(window), 'ProjectsSection')
    expect(quiet.content).toBe(8 * ROW)
    expect(quiet.body).toBe(3 * ROW)
    expect(quiet.bottom - quiet.top).toBe(HEADER + 3 * ROW)

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
    // The floor is the header and 6 rows: the list has what the message leaves of them, more than 3 rows.
    const withShort = sectionOf(await measure(window), 'ProjectsSection')
    expect(withShort.bottom - withShort.top).toBe(HEADER + 6 * ROW)
    expect(withShort.body).toBe(6 * ROW - shortNotice.whole)

    // A long error takes the place of the short one, 3 rows of it.
    await addProjectFails(launched)
    expect(await height(notice)).toBe(3 * ROW)

    // The header, the message and 3 rows of the list, which scrolls.
    const small = await measure(window)
    expect(small.scrollHeight).toBeGreaterThan(small.clientHeight)
    const squeezed = sectionOf(small, 'ProjectsSection')
    expect(squeezed.body).toBe(3 * ROW)
    expect(squeezed.content).toBe(8 * ROW)
    expect(squeezed.bottom - squeezed.top).toBe(HEADER + 3 * ROW + 3 * ROW)
    expectNoOverlap(small)
    const bodyBox = (await projects.locator('.w-sidebar-section__body').boundingBox())!
    const firstRow = (await window.getByTestId('project-row').first().boundingBox())!
    expect(firstRow.y).toBe(bodyBox.y)
    await expect(window.getByTestId('project-row').first()).toBeInViewport({ ratio: 1 })

    // 1200×900 with Epics and ADR collapsed: the column has room, the list is whole under the message.
    await heading(window, 'Epics').click()
    await heading(window, 'ADR').click()
    await setWindowSize(launched, TALL)
    await expect.poll(async () => sectionOf(await measure(window), 'ProjectsSection').body).toBe(8 * ROW)
    const tall = await measure(window)
    expect(tall.scrollHeight).toBe(tall.clientHeight)
    expectNoOverlap(tall)
  } finally {
    await launched.close()
  }
})

test('in the smallest window a long list keeps 3 of its rows and the column scrolls; in a tall one it grows to 15 rows and scrolls by itself', async () => {
  // Two more Projects, in plain folders: a list of 3 rows, as high as the floor of its section.
  // With one Project the floors of the sections fit the column of a page of 800×520, since the
  // switches of Machines moved to Settings; with three, and Machines expanded, they do not.
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

    // The rows the rules count in are the rows on screen.
    expect(await height(window.getByTestId('sidebar-epic').first())).toBe(EPIC_ROW)
    expect(await height(window.getByTestId('sidebar-adr').first())).toBe(ROW)
    expect(await height(window.getByTestId('project-row').first())).toBe(ROW)

    // The smallest window, every section expanded — Machines too, which is collapsed until the user expands
    // it: the floors of the sections do not fit the column.
    await expandMachines(window)
    await setWindowSize(launched, 'smallest')
    await expect.poll(async () => sectionOf(await measure(window), 'EpicsSection').body).toBe(3 * EPIC_ROW)
    const small = await measure(window)
    const epics = sectionOf(small, 'EpicsSection')
    const adr = sectionOf(small, 'AdrSection')
    expect(epics.body).toBe(3 * EPIC_ROW)
    expect(adr.body).toBe(3 * ROW)
    // Each long list scrolls by itself…
    expect(epics.content).toBe(EPICS.length * EPIC_ROW)
    expect(adr.content).toBe(ADRS.length * ROW)
    // …and the column scrolls as a whole instead of squeezing a list under its 3 rows.
    expect(small.scrollHeight).toBeGreaterThan(small.clientHeight)
    // A list of 3 rows is as high as its rows and is not squeezed; neither is the body of
    // Machines, which is "Link a machine…" alone.
    expect(sectionOf(small, 'ProjectsSection').body).toBe(3 * ROW)
    expect(sectionOf(small, 'ProjectsSection').content).toBe(3 * ROW)
    expect(sectionOf(small, 'MachinesSection').body).toBe(sectionOf(small, 'MachinesSection').content)
    expect(sectionOf(small, 'MachinesSection').body).toBeGreaterThan(0)
    expectNoOverlap(small)

    // 1200×900, both long lists expanded: they share what the column has, each above its floor,
    // and the column itself does not scroll.
    await setWindowSize(launched, TALL)
    await expect.poll(async () => (await measure(window)).clientHeight).toBeGreaterThan(small.clientHeight)
    const shared = await measure(window)
    expect(shared.scrollHeight).toBe(shared.clientHeight)
    expect(sectionOf(shared, 'EpicsSection').body).toBeGreaterThan(3 * EPIC_ROW)
    expect(sectionOf(shared, 'EpicsSection').body).toBeLessThan(EPICS.length * EPIC_ROW)
    expect(sectionOf(shared, 'AdrSection').body).toBeGreaterThan(3 * ROW)
    expect(sectionOf(shared, 'AdrSection').body).toBeLessThan(15 * ROW)
    // The column is used to its end.
    expect(Math.round(sectionOf(shared, 'AdrSection').bottom)).toBe(Math.round(shared.bottom))

    // Epics collapsed: the one long list left, ADR, is exactly 15 rows and scrolls by itself.
    await heading(window, 'Epics').click()
    await expect.poll(async () => sectionOf(await measure(window), 'AdrSection').body).toBe(15 * ROW)
    const tall = await measure(window)
    expect(sectionOf(tall, 'AdrSection').body).toBe(420)
    expect(sectionOf(tall, 'AdrSection').content).toBe(ADRS.length * ROW)
    expect(tall.scrollHeight).toBe(tall.clientHeight)
    // A short list does not grow into the room that is left.
    expect(sectionOf(tall, 'ProjectsSection').body).toBe(3 * ROW)
    expect(sectionOf(tall, 'MachinesSection').body).toBe(sectionOf(small, 'MachinesSection').body)
    expect(sectionOf(tall, 'AdrSection').bottom).toBeLessThan(tall.bottom)
    // The wheel over the list scrolls the list.
    const adrBody = region(window, 'ADR').locator('.w-sidebar-section__body')
    await window.getByTestId('sidebar-adr').first().hover()
    await window.mouse.wheel(0, 3 * ROW)
    await expect.poll(() => adrBody.evaluate((node) => (node as unknown as El).scrollTop)).toBeGreaterThan(0)
    // The last ADR is reached by scrolling the list, not the column.
    const last = window.getByTestId('sidebar-adr').last()
    await expect(last).not.toBeInViewport()
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport({ ratio: 1 })
    expect(await window.locator('.w-sidebar__sections').evaluate((node) => (node as unknown as El).scrollTop)).toBe(0)

    await snapshotThemes(window, 'sidebar-tall')
  } finally {
    await launched.close()
  }
})
