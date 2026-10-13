import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

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
const SECTIONS = ['ProjectsSection', 'MachinesSection', 'EpicsSection', 'SessionsSection', 'AdrSection']

/** The rows the height rules count in: the common row, and the two-line row of Epics. */
const ROW = 28
const EPIC_ROW = 48
/** The header of a section. */
const HEADER = 24
/** The smallest window worfy allows, and one that fits the owner's screen. */
const SMALLEST = { width: 800, height: 520 }
const TALL = { width: 1200, height: 900 }

let scratch: string
let dataDir: string
let claudeHome: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-sidebar-')))
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
  writeFileSync(script, `#!/bin/sh\ncat '${answer}'\n`)
  chmodSync(script, 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
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

async function setWindowSize(launched: LaunchedApp, size: { width: number; height: number }): Promise<void> {
  await launched.app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setSize(wanted.width, wanted.height), size)
  await expect
    .poll(() => launched.window.evaluate(() => [(globalThis as unknown as { innerWidth: number }).innerWidth, (globalThis as unknown as { innerHeight: number }).innerHeight]))
    .toStrictEqual([size.width, size.height])
}

/** The lists of the fixture are read and drawn. */
async function listsShown(window: Page): Promise<void> {
  await expect(window.getByTestId('sidebar-epic')).toHaveCount(EPICS.length)
  await expect(window.getByTestId('sidebar-adr')).toHaveCount(ADRS.length)
  await expect(window.getByTestId('project-row')).toHaveCount(1)
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
    expect(before.sections.map((section) => section.wrapper)).toStrictEqual(SECTIONS)
    expect(before.sections.map((section) => section.frame)).toStrictEqual(SECTIONS)
    for (const name of ['Projects', 'Machines', 'Epics', 'Sessions', 'ADR']) await expect(heading(window, name)).toHaveAttribute('aria-expanded', 'true')

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

    await expect.poll(savedCollapsed).toStrictEqual({ EpicsSection: true, AdrSection: true })
    await snapshotThemes(window, 'sidebar-collapsed')
  } finally {
    await launched.close()
  }

  // The same data folder: Epics and ADR are collapsed from the first frame the lists are in.
  launched = await launch()
  try {
    const { window } = launched
    await listsShown(window)
    await expect(heading(window, 'Epics')).toHaveAttribute('aria-expanded', 'false')
    await expect(heading(window, 'ADR')).toHaveAttribute('aria-expanded', 'false')
    await expect(window.getByTestId('sidebar-epic').first()).toBeHidden()
    await expect(window.getByTestId('sidebar-adr').first()).toBeHidden()
    for (const name of ['Projects', 'Machines', 'Sessions']) await expect(heading(window, name)).toHaveAttribute('aria-expanded', 'true')
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
  } finally {
    await launched.close()
  }
})

test('in the smallest window a long list keeps 3 of its rows and the column scrolls; in a tall one it grows to 15 rows and scrolls by itself', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await listsShown(window)

    // The rows the rules count in are the rows on screen.
    expect(await height(window.getByTestId('sidebar-epic').first())).toBe(EPIC_ROW)
    expect(await height(window.getByTestId('sidebar-adr').first())).toBe(ROW)
    expect(await height(window.getByTestId('project-row').first())).toBe(ROW)

    // 800×520, every section expanded: the floors of the sections do not fit the column.
    await setWindowSize(launched, SMALLEST)
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
    // A list of one row is as high as its row and is not squeezed.
    expect(sectionOf(small, 'ProjectsSection').body).toBe(ROW)
    expect(sectionOf(small, 'ProjectsSection').content).toBe(ROW)
    expectNoOverlap(small)

    // A notice is never higher than 3 rows, however long its text, so a section at its floor still
    // holds it: no section lies over the next one. The notice here is put into the page by hand.
    const notice = region(window, 'Projects').locator('.w-sidebar-section__notice')
    expect(await height(notice)).toBe(0)
    await notice.evaluate((node) => {
      ;(node as unknown as { innerHTML: string }).innerHTML = '<div style="height: 300px"></div>'
    })
    expect(await height(notice)).toBe(3 * ROW)
    expectNoOverlap(await measure(window))
    await notice.evaluate((node) => {
      ;(node as unknown as { innerHTML: string }).innerHTML = ''
    })
    expect(sectionOf(await measure(window), 'ProjectsSection').body).toBe(ROW)

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
    expect(sectionOf(tall, 'ProjectsSection').body).toBe(ROW)
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
