import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, showSidebarSection, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// The sidebar's Epics section by last work (worfy-polish ticket 98), against the built app over a Project whose
// epic-status answers four Epics: one in work since a claim 20 days ago, a fresh one, a closed one and an open one,
// both 8 days without a status change. The Epic in work comes first, then the fresh one; the two old ones wait in
// the folded «Older · 2», one click opens it, and the fold outlives a restart. The threshold «Never» shows every Epic.
// Every time is built from Date.now() — a fixed date ages past the threshold and turns the test red one day.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
/** The width of the owner's screenshots of the section. */
const SIZE = { width: 1280, height: 800 }

/** A `Status:` time as the Harness writes it, `ago` ms before now. */
const stamp = (ago: number): string => new Date(Date.now() - ago).toISOString().slice(0, 16) + 'Z'

let scratch: string
let dataDir: string
let claudeHome: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

interface FixtureTicket {
  num: number
  state: 'open' | 'work' | 'done'
  /** How long ago the status changed; null — never (an open Ticket). */
  ago: number | null
}

const EPICS: Record<string, FixtureTicket[]> = {
  'closed-old': [
    { num: 1, state: 'done', ago: 9 * DAY },
    { num: 2, state: 'done', ago: 8 * DAY },
  ],
  fresh: [
    { num: 1, state: 'done', ago: 2 * HOUR },
    { num: 2, state: 'open', ago: null },
  ],
  'in-work': [
    { num: 1, state: 'work', ago: 20 * DAY },
    { num: 2, state: 'open', ago: null },
  ],
  'open-old': [
    { num: 1, state: 'done', ago: 8 * DAY + HOUR },
    { num: 2, state: 'open', ago: null },
  ],
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-epics-older-')))
  dataDir = join(scratch, 'data')
  const repo = join(scratch, 'alpha')
  for (const epic of Object.keys(EPICS)) {
    mkdirSync(join(repo, '.scratch', epic, 'issues'), { recursive: true })
    writeFileSync(join(repo, '.scratch', epic, 'spec.md'), `# ${epic}\n`)
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  // A Claude home whose bin/epic-status answers with these Epics and the times of their status changes.
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const word = { open: 'open', work: 'claimed', done: 'done' } as const
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: Object.keys(EPICS).map((epic) => ({ epic, hasSpec: true, hasMap: false })),
      tickets: Object.entries(EPICS).flatMap(([epic, tickets]) =>
        tickets.map(({ num, state, ago }) => {
          const statusAt = ago === null ? null : stamp(ago)
          return { epic, num, slug: `t${num}`, title: `0${num} — Ticket ${num}`, statusRaw: statusAt === null ? word[state] : `${word[state]} ${statusAt}`, state, statusAt, blockedRaw: '—', blockedNums: [], blockedParsed: true }
        }),
      ),
    }),
  )
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
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

const section = (window: Page) => window.getByRole('region', { name: 'Epics' })
const rows = (window: Page) => section(window).getByTestId('sidebar-epic')
const order = (window: Page): Promise<(string | null)[]> => rows(window).evaluateAll((all) => all.map((row) => row.getAttribute('data-epic')))
const ageOf = (window: Page, epic: string) => section(window).locator(`[data-testid="sidebar-epic"][data-epic="${epic}"] [data-testid="sidebar-epic-age"]`)

test('the Epic in work first, then by last work; the 8-day-old Epics, closed and open, fold into «Older · 2», which opens with a click and stays open after a restart', async () => {
  const first = await launch()
  try {
    const { window } = first
    await setWindowSize(first, SIZE)
    await showSidebarSection(window, 'Epics')
    await expect(rows(window)).toHaveCount(2)
    expect(await order(window)).toEqual(['in-work', 'fresh'])
    await expect(ageOf(window, 'in-work')).toHaveText('20d')
    await expect(ageOf(window, 'fresh')).toHaveText('2h')
    const older = section(window).getByTestId('sidebar-epics-older')
    await expect(older).toHaveText('Older · 2')
    await expect(older).toHaveAttribute('aria-expanded', 'false')
    await snapshotThemes(window, 'epics-older-folded')

    await older.click()
    await expect(rows(window)).toHaveCount(4)
    expect(await order(window)).toEqual(['in-work', 'fresh', 'closed-old', 'open-old'])
    await expect(older).toHaveAttribute('aria-expanded', 'true')
    await expect(ageOf(window, 'closed-old')).toHaveText('8d')
    await expect(ageOf(window, 'open-old')).toHaveText('8d')
    await snapshotThemes(window, 'epics-older-open')
  } finally {
    await first.close()
  }

  // The fold is kept for this Project in the app settings: a restart over the same data folder opens it as left.
  const second = await launch()
  try {
    await showSidebarSection(second.window, 'Epics')
    await expect(rows(second.window)).toHaveCount(4)
    await expect(section(second.window).getByTestId('sidebar-epics-older')).toHaveAttribute('aria-expanded', 'true')
  } finally {
    await second.close()
  }
})

test('with the threshold Never every Epic stays in the list, in the same order, and there is no «Older»', async () => {
  writeFileSync(join(dataDir, 'app-settings.json'), JSON.stringify({ epicsOlderAfter: 'never' }))
  const launched = await launch()
  try {
    const { window } = launched
    await showSidebarSection(window, 'Epics')
    await expect(rows(window)).toHaveCount(4)
    expect(await order(window)).toEqual(['in-work', 'fresh', 'closed-old', 'open-old'])
    await expect(section(window).getByTestId('sidebar-epics-older')).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
