import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { formatJournalLine, makeRunId, type JournalEvent } from '../../src/shared/autopilot/journal'
import { launchApp } from './helpers'

// The Work track view (worfy-work-track ticket 09) in the built app: the Runs tab of the toolbar shows Run
// history, the switch shows Work track — the Week by default — a day of its axis opens the Day, the Month
// is cells of days and a cell opens its Day, and Run history still opens from the switch.
//
// The channel `workTrack.read` is a stub in main: its handler is replaced by one that answers made-up work
// for the period asked (several Sessions, a hidden, an archived and a Codex one, Subagents, Autopilot Runs
// with their Waves, gate runs, merged PRs, transcripts older than 30 days as «no data»), so the view is
// checked apart from the readers of the sources (their contract tests are test/contract/work-track-*.test.ts).
// The screen is kept in both themes with the test's output: the evidence of the ticket is chosen from it.
//
// The second test (ticket 10) has one Autopilot Run that is real: its Journal is in the data folder, and the stub
// answers its Run and Wave beside the made-up work. A click on the Wave opens the Span panel, «Open Run» opens
// Run history on that Run; the summary row and the panel are kept in both themes.

const PROJECT = 'CanvasForAI-0e2e0e2e'
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-work-track-')))
})
test.afterEach(async () => {
  await removeDir(scratch)
})

/** The real Run of the second test: yesterday 03:00–05:00 local, before any made-up work of that day. */
interface RealRun {
  id: string
  epic: string
  start: number
  end: number
}

function prepare(run?: RealRun): Record<string, string> {
  const root = join(scratch, 'CanvasForAI')
  const dataDir = join(scratch, 'data')
  mkdirSync(root, { recursive: true })
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  if (run !== undefined) {
    const iso = (time: number) => new Date(time).toISOString()
    const events: Record<string, unknown>[] = [
      { at: iso(run.start), kind: 'run-started', by: 'command' },
      { at: iso(run.start + 5 * 60_000), kind: 'wave-started', wave: 1, tickets: ['01', '02'] },
      { at: iso(run.end - 5 * 60_000), kind: 'wave-finished', wave: 1, tickets: ['01', '02'] },
      { at: iso(run.end), kind: 'run-stopped', reason: 'all-tickets-done' },
    ]
    mkdirSync(join(dataDir, 'autopilot'), { recursive: true })
    writeFileSync(join(dataDir, 'autopilot', `${run.id}.jsonl`), events.map((event) => formatJournalLine({ run: run.id, project: PROJECT, epic: run.epic, ...event } as JournalEvent)).join(''))
  }
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'CanvasForAI', path: root }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.8 } }))
  return { WORFY_DATA_DIR: dataDir }
}

/**
 * Replaces main's handler of `workTrack.read` with made-up work for the period asked, the same for the same
 * day whenever it is asked, and the Run `run` with its Wave as the service names them. Runs in main:
 * everything it needs is inside the function.
 */
function stubWorkTrack(app: ElectronApplication, run: RealRun | null = null): Promise<void> {
  return app.evaluate(({ ipcMain }, real) => {
    const MIN = 60_000
    const HOUR = 60 * MIN
    const DAY_MS = 24 * HOUR
    const addDays = (time: number, days: number): number => {
      const date = new Date(time)
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime()
    }
    /** A small seeded generator, so a day's work is the same on every read. */
    const random = (seed: string): (() => number) => {
      let state = 7
      for (const char of seed) state = (state * 31 + char.charCodeAt(0)) | 0
      return () => {
        state = (state + 0x6d2b79f5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }
    const union = (intervals: [number, number][]): number => {
      let total = 0
      let end = -Infinity
      for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0])) {
        if (to <= end) continue
        total += to - Math.max(from, end)
        end = to
      }
      return total
    }
    const two = (value: number): string => String(value).padStart(2, '0')
    const EPICS = ['worfy-work-track', 'worfy-autopilot-queue', 'worfy-evidence', 'worfy-polish']
    const sessions = [
      { id: 'orch-0001', name: 'Orchestrator', vendor: 'claude', hidden: false, archived: false },
      { id: 'bridge-0002', name: 'Bridge to the PC', vendor: 'claude', hidden: false, archived: false },
      { id: 'docs-0003', name: 'Docs pass', vendor: 'claude', hidden: true, archived: false },
      { id: 'old-0004', name: 'Session 0004 · polish-59', vendor: 'claude', hidden: false, archived: true },
      { id: 'codex-0005', name: 'Codex review', vendor: 'codex', hidden: false, archived: false },
    ]

    ipcMain.removeHandler('worfy:workTrack.read')
    ipcMain.handle('worfy:workTrack.read', (_event, input: { projectId: string; period: { kind: 'day' | 'week' | 'month'; start: string } }) => {
      const now = Date.now()
      // The transcripts of more than 30 days ago are deleted: no turns there, «no data» instead.
      const kept = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() - 30).getTime()
      const start = Date.parse(input.period.start)
      const first = new Date(start)
      const end = input.period.kind === 'day' ? addDays(start, 1) : input.period.kind === 'week' ? addDays(start, 7) : new Date(first.getFullYear(), first.getMonth() + 1, 1).getTime()
      const facts: Record<string, unknown>[] = []
      const fact = (over: Record<string, unknown> & { start: number; end: number | null }) => {
        if (over.start >= now) return
        const until = over.end === null ? null : Math.min(over.end, now)
        facts.push({ outcome: until === null ? null : 'ok', session: null, ...over, start: new Date(over.start).toISOString(), end: until === null ? null : new Date(until).toISOString() })
      }
      if (real !== null && real.start < end && real.end > start) {
        fact({ id: `run:${real.id}`, kind: 'run', start: real.start, end: real.end, epic: real.epic, source: 'journal', title: `Run · ${real.epic}` })
        fact({ id: `wave:${real.id}:1`, kind: 'wave', start: real.start + 5 * MIN, end: real.end - 5 * MIN, session: 'orch-0001', parent: `run:${real.id}`, epic: real.epic, source: 'journal', title: 'Wave 1 · tickets 01, 02' })
      }
      const days: { start: number; workMs: number; prsMerged: number }[] = []
      for (let day = start; day < end; day = addDays(day, 1)) {
        const key = new Date(day).toDateString()
        const rnd = random(key)
        const epics = [EPICS[Math.floor(rnd() * EPICS.length)]!, EPICS[Math.floor(rnd() * EPICS.length)]!]
        const work: [number, number][] = []
        // The Orchestrator works most of the day; the other Sessions now and then.
        for (const [index, session] of sessions.entries()) {
          if (day < kept || (index > 0 && rnd() > 0.45)) continue
          let at = day + (8 + index * 2 + rnd() * 2) * HOUR
          const stop = day + (index === 0 ? 23 : 12 + index * 2 + rnd() * 3) * HOUR
          let turn = 0
          while (at < stop) {
            const length = (4 + rnd() * 40) * MIN
            const epic = epics[Math.floor(rnd() * epics.length)]!
            const ticket = two(1 + Math.floor(rnd() * 14))
            fact({ id: `turn:${key}:${session.id}:${turn}`, kind: 'turn', start: at, end: at + length, session: session.id, epic, ticket, source: session.vendor === 'codex' ? 'codex' : 'transcript', title: 'Session turn' })
            work.push([at, at + length])
            if (index < 2 && rnd() < 0.5) {
              const name = `${rnd() < 0.6 ? 'impl' : 'verify'}-${ticket}`
              const subStart = at + 2 * MIN
              const subEnd = subStart + (15 + rnd() * 70) * MIN
              fact({ id: `sub:${key}:${session.id}:${turn}`, kind: 'subagent', start: subStart, end: subEnd, session: session.id, epic, ticket, source: 'transcript', title: name, outcome: name.startsWith('verify') && rnd() < 0.25 ? 'rejected' : 'ok' })
              work.push([subStart, subEnd])
            }
            at += length + (10 + rnd() * 50) * MIN
            turn += 1
          }
        }
        // An Autopilot Run on some days, with its Waves.
        if (rnd() < 0.55) {
          const runStart = day + (13 + rnd() * 4) * HOUR
          const runEnd = runStart + (2 + rnd() * 4) * HOUR
          const runId = `run:${key}`
          fact({ id: runId, kind: 'run', start: runStart, end: runEnd, epic: epics[0], source: 'journal', title: `Run ${key.slice(-4)}${two(new Date(day).getDate())} · ${epics[0]}` })
          let waveStart = runStart + 5 * MIN
          for (let wave = 1; waveStart < runEnd - 20 * MIN; wave += 1) {
            const waveEnd = Math.min(runEnd - 5 * MIN, waveStart + (50 + rnd() * 70) * MIN)
            fact({ id: `${runId}:wave:${wave}`, kind: 'wave', start: waveStart, end: waveEnd, parent: runId, source: 'journal', title: `Wave ${wave} · tickets ${two(wave * 2 - 1)}, ${two(wave * 2)}` })
            work.push([waveStart, waveEnd])
            waveStart = waveEnd + 10 * MIN
          }
        }
        // Gate runs and merged PRs.
        const gates = 4 + Math.floor(rnd() * 6)
        for (let gate = 0; gate < gates; gate += 1) {
          const at = day + (9 + rnd() * 14) * HOUR
          fact({ id: `gate:${key}:${gate}`, kind: 'gate', start: at, end: at + (3 + rnd() * 12) * MIN, source: 'gate-log', title: `gate ${rnd() < 0.3 ? 'full' : 'fast'}`, outcome: rnd() < 0.12 ? 'failed' : 'ok' })
        }
        let merged = 0
        const prs = 2 + Math.floor(rnd() * 5)
        for (let pr = 0; pr < prs; pr += 1) {
          const at = day + (9 + rnd() * 14) * HOUR
          if (at >= now) continue
          const number = 1400 + Math.floor((day / DAY_MS) % 100) * 5 + pr
          fact({ id: `pr:${number}`, kind: 'pr', start: at - 3 * HOUR, end: at, epic: epics[0], ticket: two(1 + pr), pr: number, source: 'github', title: `PR #${number}` })
          merged += 1
        }
        days.push({ start: day, workMs: union(work.map(([from, to]) => [from, Math.min(to, now)] as [number, number]).filter(([from, to]) => to > from)), prsMerged: merged })
      }
      const gaps = start < kept ? [{ source: 'transcript', start: new Date(start).toISOString(), end: new Date(Math.min(kept, end)).toISOString(), why: 'Transcripts are deleted after 30 days (cleanupPeriodDays of Claude Code).' }] : []
      const workMs = days.reduce((sum, day) => sum + day.workMs, 0)
      const prsMerged = days.reduce((sum, day) => sum + day.prsMerged, 0)
      const value = {
        projectId: input.projectId,
        period: input.period,
        now: new Date(now).toISOString(),
        facts,
        sessions,
        gaps,
        summary: { workMs, byEpic: EPICS.map((epic) => ({ epic, ms: Math.round(workMs / 4) })), prsMerged, runs: facts.filter((each) => each.kind === 'run').length, gaps: [], gapCount: gaps.length, days },
        loading: [],
      }
      return { ok: true, value }
    })
  }, run)
}

/** The Runs view in both themes, kept with the test's output as `<ticket>-<name>-<theme>.png`. */
async function snapshots(window: Page, name: string, ticket = '09'): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await window.locator('.w-shell__view[data-view="history"]').screenshot({ path: test.info().outputPath(`${ticket}-${name}-${scheme}.png`), animations: 'disabled' })
  }
  await window.emulateMedia({ colorScheme: null })
}

const pressed = (window: Page, group: string) => window.locator(`[role="group"][aria-label="${group}"] [aria-pressed="true"]`)

test('Runs → Work track: the Week, a day of it, the Month and a day of it; Run history still opens', async () => {
  const launched = await launchApp({ env: prepare() })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
    await stubWorkTrack(app)
    await expect(window.getByTestId('app-shell')).toBeVisible()

    // The Runs tab shows Run history first, with the switch above it.
    await window.locator('.w-toolbar [role="group"][aria-label="View"]').getByRole('button', { name: 'Runs' }).click()
    await expect(window.getByTestId('run-history')).toBeVisible()
    await expect(pressed(window, 'Runs view')).toHaveText('Run history')

    // Work track: the Week ending today, the lanes by Session.
    await window.getByRole('button', { name: 'Work track' }).click()
    const track = window.getByTestId('work-track')
    await expect(track).toBeVisible()
    await expect(window.getByTestId('run-history')).toBeHidden()
    await expect(pressed(window, 'Period')).toHaveText('Week')
    await expect(window.getByTestId('work-track-day')).toHaveCount(7)
    await expect(track.locator('[data-lane-id="runs"]')).toBeVisible()
    await expect(track.locator('[data-lane-id="session:orch-0001"]')).toBeVisible()
    await expect(track.locator('[data-lane-id="gate"]')).toBeVisible()
    await expect(window.getByTestId('work-track-span').first()).toBeVisible()
    await snapshots(window, 'week')

    // A day of the axis opens its Day: hours on the axis, the bars of that day.
    const yesterday = window.getByTestId('work-track-day').nth(5)
    const name = (await yesterday.getAttribute('aria-label'))!.replace(/^Open /u, '')
    await yesterday.click()
    await expect(pressed(window, 'Period')).toHaveText('Day')
    await expect(window.getByTestId('work-track-period')).toContainText(name)
    await expect(window.getByTestId('work-track-span').first()).toBeVisible()
    await window.getByRole('button', { name: 'Show the Subagents of Orchestrator' }).click()
    await expect(track.locator('[data-lane-id^="subagent:orch-0001"]').first()).toBeVisible()
    await window.locator('[role="group"][aria-label="Density"]').getByRole('button', { name: 'comfortable' }).click()
    await snapshots(window, 'day')
    await window.locator('[role="group"][aria-label="Density"]').getByRole('button', { name: 'compact' }).click()

    // The Month: cells of days; a cell opens its Day.
    await window.locator('[role="group"][aria-label="Period"]').getByRole('button', { name: 'Month' }).click()
    await expect(pressed(window, 'Period')).toHaveText('Month')
    await expect(window.getByTestId('work-track-month-day').first()).toBeVisible()
    await expect(window.getByTestId('work-track-span')).toHaveCount(0)
    const cell = track.locator('[data-lane-id="session:orch-0001"] [data-testid="work-track-day-cell"]').first()
    await expect(cell).toBeVisible()
    await snapshots(window, 'month')

    // The Month before reaches past the 30 days of the transcripts: «no data», hatched, with its reason.
    await window.getByRole('button', { name: 'Earlier' }).click()
    const gap = track.locator('[data-lane-id="session:orch-0001"] [data-testid="work-track-gap"]')
    await expect(gap).toBeVisible()
    await expect(gap).toHaveAttribute('title', /^No data · Claude Code transcripts\nTranscripts are deleted after 30 days/u)
    await snapshots(window, 'month-before')
    await window.getByRole('button', { name: 'Later' }).click()
    await expect(cell).toBeVisible()
    const day = await cell.getAttribute('data-day')
    await cell.click()
    await expect(pressed(window, 'Period')).toHaveText('Day')
    await expect(window.getByTestId('work-track-period')).toContainText(` ${day} `)

    // Run history is still there, one switch away.
    await window.getByRole('button', { name: 'Run history' }).click()
    await expect(window.getByTestId('run-history')).toBeVisible()
    await expect(window.getByTestId('run-history')).toContainText('This Project has no Autopilot Runs yet.')
    await expect(track).toBeHidden()
  } finally {
    await launched.close()
  }
})

test('Work track: the summary of the period; a Wave of a Run → its panel → «Open Run» → Run history of that Run', async () => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 3).getTime()
  const run: RealRun = { id: makeRunId(new Date(start), 'a10b10'), epic: 'worfy-work-track', start, end: start + 2 * 3_600_000 }
  const launched = await launchApp({ env: prepare(run) })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
    await stubWorkTrack(app, run)
    await expect(window.getByTestId('app-shell')).toBeVisible()

    await window.locator('.w-toolbar [role="group"][aria-label="View"]').getByRole('button', { name: 'Runs' }).click()
    await window.getByRole('button', { name: 'Work track' }).click()
    const track = window.getByTestId('work-track')
    await expect(track).toBeVisible()

    // The summary of the Week: hours by Epic and the four numbers.
    const summary = window.getByTestId('work-track-summary')
    await expect(summary).toBeVisible()
    await expect(summary.getByTestId('work-track-epic-hours')).toHaveCount(4)
    await expect(summary.getByTestId('work-track-total')).toHaveText(/^\d+\.\d h$/u)
    await expect(summary.getByTestId('work-track-runs')).not.toHaveText('0')

    // Yesterday's Day, the Wave of the Run: the panel says what it is and where it comes from.
    await window.getByTestId('work-track-day').nth(5).click()
    await expect(window.getByTestId('work-track-span').first()).toBeVisible()
    await expect(window.getByTestId('work-track-panel')).toHaveCount(0)
    await track.locator(`[data-span-id="wave:${run.id}:1"]`).click()
    const panel = window.getByTestId('work-track-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('heading')).toHaveText('Wave 1 · tickets 01, 02')
    await expect(panel.getByTestId('work-track-panel-source')).toContainText('Source: Run journals.')
    await expect(panel.getByRole('button', { name: 'Open PR' })).toBeDisabled()
    await snapshots(window, 'panel', '10')
    await window.emulateMedia({ colorScheme: 'light' })
    await summary.screenshot({ path: test.info().outputPath('10-summary-light.png'), animations: 'disabled' })
    await window.emulateMedia({ colorScheme: 'dark' })
    await summary.screenshot({ path: test.info().outputPath('10-summary-dark.png'), animations: 'disabled' })
    await window.emulateMedia({ colorScheme: null })

    // Esc closes the panel and leaves the Runs tab on screen; the Wave opens it again.
    await window.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(track).toBeVisible()
    await track.locator(`[data-span-id="wave:${run.id}:1"]`).click()

    // «Open Run»: Run history on that Run, read from its Journal.
    await panel.getByRole('button', { name: 'Open Run' }).click()
    await expect(window.getByTestId('run-history')).toBeVisible()
    await expect(track).toBeHidden()
    await expect(window.getByTestId('run-history-choose')).toHaveValue(run.id)
    await expect(window.getByTestId('run-history-epic')).toHaveText(run.epic)
  } finally {
    await launched.close()
  }
})
