// The first opening of a Project of a Linked machine (worfy-link ticket 33) on two built worfy: B
// has a Project of 20 Epics and 300 Tickets with a long Sessions history (test/e2e/many-epics.ts),
// A opens it and pans its Canvas while it loads. The loading line stands in place of the Canvas
// from the first frame of the window, counts the Epics laid out up to M/M, and goes once
// everything is loaded.
//
// What the opening costs is measured too, for the ticket's result rather than as a check — the
// numbers depend on the machine's load: every `linked.invoke` call of A's window with its time, the
// long tasks (over 50 ms) of A's renderer while it pans, and the steps of the Epics counter. They
// are attached to the test as `linked-opening.json`. With WORFY_LINKED_PROFILE=<folder> the run
// also writes A's renderer CPU profile there (`linked-opening.cpuprofile`, opened in Chrome
// DevTools, Performance) with the same numbers beside it. The renderer counts the updates of
// `useWorkflowStore` and `useElkAnswers` only because the recorder turns the count on.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, chooseLevel, closeSettings, launchApp, linkThroughUi, machineIdOf, openMachinesSettings, PROJECTS_ACCESS_LABEL, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { loginProfileWithNode } from '../harness-node'
import { MANY_EPICS, manyEpicsStatus, writeSessionHistory } from './many-epics'

test.setTimeout(240_000)

/** WORFY_EVIDENCE=1: the line in both themes (test-results/e2e/snapshots/33-loading-line/), with B's epic-status held for EVIDENCE_DELAY_MS so the line stays. */
const EVIDENCE = process.env.WORFY_EVIDENCE === '1'
const EVIDENCE_DELAY_MS = EVIDENCE ? 5000 : 0

const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'
const GAMMA = 'gamma-000000c'
const SIZE = { width: 1400, height: 900 }

function git(cwd: string, ...args: string[]): void {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv })
}

/** A committed repository at `path`. */
function repository(path: string): string {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'README.md'), '# A project\n')
  git(path, 'init', '-q')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'init')
  return realpathSync.native(path)
}

/** A data folder whose projects.json lists `projects`, the first one active. */
function dataFolder(path: string, projects: { id: string; name: string; path: string }[]): string {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'projects.json'), JSON.stringify({ projects, activeId: projects[0]?.id ?? null }))
  return path
}

/**
 * B: the small Project `gamma`, active in B's own window, and `beta` of many Epics with a long
 * Sessions history, which only A opens. B's epic-status answers by the folder it runs in.
 */
function prepareB(scratch: string) {
  const gamma = repository(join(scratch, 'gamma'))
  const beta = repository(join(scratch, 'beta'))
  const claudeHome = join(scratch, 'b-claude')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const many = join(claudeHome, 'many-epics.json')
  const none = join(claudeHome, 'no-epics.json')
  writeFileSync(many, JSON.stringify(manyEpicsStatus()))
  writeFileSync(none, JSON.stringify({ ref: 'main', epics: [], tickets: [] }))
  // Runs whether node takes it for CommonJS or for an ES module, like catScript (test/harness-node.ts).
  writeFileSync(
    join(claudeHome, 'bin', 'epic-status'),
    `import('node:fs').then((fs) => { const mine = process.cwd() === ${JSON.stringify(beta)}; setTimeout(() => process.stdout.write(fs.readFileSync(mine ? ${JSON.stringify(many)} : ${JSON.stringify(none)}, 'utf8')), mine ? ${EVIDENCE_DELAY_MS} : 0) })\n`,
  )
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  writeSessionHistory(claudeHome, beta)
  const dataDir = dataFolder(join(scratch, 'b-data'), [
    { id: GAMMA, name: 'gamma', path: gamma },
    { id: BETA, name: 'beta', path: beta },
  ])
  const home = join(scratch, 'b-home')
  mkdirSync(home, { recursive: true })
  // B's login shell is /bin/sh with this HOME: its .profile puts node on PATH, for the Node stubs.
  loginProfileWithNode(home)
  return { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, SHELL: '/bin/sh', HOME: home }
}

/**
 * What the window records from its first script on (a new document of the page): when the loading
 * line, the placeholder and the Canvas first show, each text of the Epics counter, when the line
 * goes, whether it ever went and came back, and the long tasks of the main thread.
 */
const RECORDER = `(() => {
  const w = window
  const record = { at: { placeholder: null, line: null, canvas: null, gone: null }, epics: [], gaps: 0, covers: [], longTasks: [] }
  w.__worfyOpening = record
  // Turns on the count of store updates (src/renderer/canvas/loading-steps.ts, countStoreUpdates).
  w.__worfyStoreUpdates = {}
  // The controls of the Canvas: the line must cover none of them.
  const CONTROLS = '.react-flow__panel button, .react-flow__panel input, .react-flow__panel [role="button"], .react-flow__minimap'
  let shown = false
  const look = () => {
    const now = performance.now()
    const line = document.querySelector('[data-testid="canvas-loading"]')
    if (record.at.placeholder === null && document.querySelector('[data-testid="canvas-loading-placeholder"]')) record.at.placeholder = now
    if (record.at.canvas === null && document.querySelector('[data-testid="canvas"]')) record.at.canvas = now
    if (line) {
      const box = line.getBoundingClientRect()
      for (const control of document.querySelectorAll(CONTROLS)) {
        const r = control.getBoundingClientRect()
        const name = String(control.getAttribute('aria-label') || control.textContent || control.getAttribute('class')).trim().slice(0, 40)
        if (r.width > 0 && r.height > 0 && r.left < box.right && box.left < r.right && r.top < box.bottom && box.top < r.bottom && !record.covers.includes(name)) record.covers.push(name)
      }
      if (record.at.line === null) record.at.line = now
      if (!shown && record.at.gone !== null) record.gaps += 1
      shown = true
      const epics = document.querySelector('[data-testid="canvas-loading-epics"]')
      const text = epics ? epics.textContent : null
      const last = record.epics[record.epics.length - 1]
      if (text !== null && (!last || last.text !== text)) record.epics.push({ at: now, text })
    } else if (shown) {
      shown = false
      record.at.gone = now
    }
  }
  new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true, attributes: true })
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record.longTasks.push({ start: entry.startTime, duration: entry.duration })
    }).observe({ type: 'longtask', buffered: true })
  } catch {}
})()`

interface Opening {
  at: { placeholder: number | null; line: number | null; canvas: number | null; gone: number | null }
  epics: { at: number; text: string }[]
  gaps: number
  /** The controls of the Canvas the line covered at some moment. */
  covers: string[]
  longTasks: { start: number; duration: number }[]
}

const opening = (window: Page): Promise<Opening | undefined> => window.evaluate(() => (globalThis as unknown as { __worfyOpening?: Opening }).__worfyOpening)

/**
 * Times every `linked.invoke` call of A's windows in A's main, by channel: the handler Electron
 * keeps for the channel is wrapped (`ipcMain._invokeHandlers`, not public API — measure only).
 */
async function timeLinkedCalls(launched: LaunchedApp): Promise<boolean> {
  return launched.app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers
    const original = handlers?.get('worfy:linked.invoke')
    if (handlers === undefined || original === undefined) return false
    const calls: { channel: string; input: string; start: number; ms: number; bytes: number }[] = []
    ;(globalThis as unknown as { __worfyLinkedCalls: typeof calls }).__worfyLinkedCalls = calls
    handlers.set('worfy:linked.invoke', async (event: unknown, payload: unknown) => {
      const start = Date.now()
      const result = await original(event, payload)
      const call = payload as { channel?: unknown; input?: unknown } | undefined
      calls.push({ channel: String(call?.channel), input: JSON.stringify(call?.input ?? null).slice(0, 160), start, ms: Date.now() - start, bytes: JSON.stringify(result)?.length ?? 0 })
      return result
    })
    return true
  })
}

const linkedCalls = (launched: LaunchedApp) =>
  launched.app.evaluate(() => (globalThis as unknown as { __worfyLinkedCalls?: { channel: string; input: string; start: number; ms: number; bytes: number }[] }).__worfyLinkedCalls ?? [])

test('the first opening of a Project of a Linked machine: the loading line from the first frame, Epics counted to M/M, gone at the end', async () => {
  const scratch = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-link-33-')))
  const alpha = repository(join(scratch, 'alpha'))
  const aData = dataFolder(join(scratch, 'a-data'), [{ id: ALPHA, name: 'alpha', path: alpha }])
  const bEnv = prepareB(scratch)
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: bEnv })
    await canvasReady(b, { size: SIZE })
    await canvasReady(a, { size: SIZE })
    await linkThroughUi(a.window, b.window)
    const aId = await machineIdOf(a.window)
    const bId = await machineIdOf(b.window)
    // On B: access on, and A's level Full access.
    const settings = await openMachinesSettings(b)
    await settings.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true }).click()
    await chooseLevel(b.window, settings.getByTestId(`link-machine-access-${aId}`), 'all')
    await closeSettings(b.window)
    const betaRow = a.window.locator(`[data-testid="machine-group"][data-machine-id="${bId}"] [data-testid="project-row"][data-project-id="${BETA}"]`)
    await expect(betaRow).toContainText('beta', { timeout: 20_000 })

    // The recorder runs in every new document of A's window, before the app's own scripts.
    const cdp = await a.app.context().newCDPSession(a.window)
    await cdp.send('Page.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER })
    const profileDir = process.env.WORFY_LINKED_PROFILE
    if (profileDir !== undefined) {
      await cdp.send('Profiler.enable')
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
      await cdp.send('Profiler.start')
    }
    const timed = await timeLinkedCalls(a)

    const clickedAt = Date.now()
    await betaRow.getByRole('button').click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`))
    await a.window.waitForFunction(() => (globalThis as unknown as { __worfyOpening?: unknown }).__worfyOpening !== undefined)

    // Pan while it loads, as the owner did: a wheel turn over the Canvas every 50 ms until the line goes.
    const area = { x: SIZE.width - 400, y: SIZE.height / 2 }
    await a.window.mouse.move(area.x, area.y)
    const deadline = Date.now() + 120_000
    let turn = 0
    while (Date.now() < deadline) {
      const now = await opening(a.window)
      if (now?.at.gone !== null && now?.at.gone !== undefined) break
      // A look at the line while it loads, beside the profile.
      if (profileDir !== undefined && turn === 0) await a.window.screenshot({ path: join(profileDir, 'linked-opening-loading.png') })
      // The line in both themes, for the review, while B's epic-status takes EVIDENCE_DELAY_MS.
      if (EVIDENCE && turn === 0) await snapshotThemes(a.window, '33-loading-line')
      await a.window.mouse.wheel(turn % 20 < 10 ? 40 : -40, turn % 10 < 5 ? 25 : -25)
      turn += 1
      await a.window.waitForTimeout(50)
    }
    const loadedAt = Date.now()
    // Nothing comes back after the end.
    await a.window.waitForTimeout(2000)
    const record = await opening(a.window)
    if (record === undefined) throw new Error('the recorder did not run in the new document')
    const updates = await a.window.evaluate(() => (globalThis as unknown as { __worfyStoreUpdates?: Record<string, number[]> }).__worfyStoreUpdates ?? {})
    const loading = (times: number[] | undefined) => (times ?? []).filter((time) => record.at.gone === null || time <= record.at.gone)

    let profile: unknown
    if (profileDir !== undefined) profile = (await cdp.send('Profiler.stop')).profile
    const calls = timed ? await linkedCalls(a) : []
    const loadingLongTasks = record.longTasks.filter((task) => record.at.gone === null || task.start <= record.at.gone)
    const measure = {
      fixture: { epics: MANY_EPICS, tickets: manyEpicsStatus().tickets.length, sessions: 60 },
      clickToLoadedMs: loadedAt - clickedAt,
      at: record.at,
      epicSteps: record.epics,
      gaps: record.gaps,
      covers: record.covers,
      // Every update of the two stores from the new document to the end of the line, with its time.
      storeUpdates: Object.fromEntries(['useWorkflowStore', 'useElkAnswers'].map((store) => [store, { count: loading(updates[store]).length, at: loading(updates[store]).map(Math.round) }])),
      wheelTurns: turn,
      longTasks: { count: loadingLongTasks.length, over100: loadingLongTasks.filter((task) => task.duration > 100).length, longest: Math.max(0, ...loadingLongTasks.map((task) => task.duration)), total: loadingLongTasks.reduce((sum, task) => sum + task.duration, 0), all: loadingLongTasks },
      linkedCalls: timed ? calls.filter((call) => call.start >= clickedAt) : 'not measured: ipcMain._invokeHandlers is not there',
    }
    await test.info().attach('linked-opening.json', { body: JSON.stringify(measure, null, 2), contentType: 'application/json' })
    if (profileDir !== undefined) {
      mkdirSync(profileDir, { recursive: true })
      writeFileSync(join(profileDir, 'linked-opening.cpuprofile'), JSON.stringify(profile))
      writeFileSync(join(profileDir, 'linked-opening.json'), JSON.stringify(measure, null, 2))
    }

    // The line was there from the first frame: before or with the Canvas, in the placeholder first.
    expect(record.at.placeholder, 'the placeholder showed before the Canvas').not.toBeNull()
    expect(record.at.line).not.toBeNull()
    expect(record.at.canvas).not.toBeNull()
    expect(record.at.line!).toBeLessThanOrEqual(record.at.placeholder!)
    expect(record.at.line!).toBeLessThanOrEqual(record.at.canvas!)
    // The counter grew to M/M, never down, and the line went once, for good.
    const counts = record.epics.map((step) => /(\d+)\/(\d+)$/.exec(step.text)).filter((match) => match !== null)
    expect(counts.length).toBeGreaterThan(0)
    expect(counts.at(-1)?.slice(1, 3)).toEqual([String(MANY_EPICS), String(MANY_EPICS)])
    const done = counts.map((match) => Number(match[1]))
    expect(done).toEqual([...done].sort((x, y) => x - y))
    expect(record.at.gone).not.toBeNull()
    expect(record.gaps).toBe(0)
    // It covers none of the Canvas's controls (the Trash button, the minimap…), and the stores were counted.
    expect(record.covers).toEqual([])
    expect(measure.storeUpdates.useElkAnswers?.count).toBeGreaterThanOrEqual(1)
    expect(measure.storeUpdates.useWorkflowStore?.count).toBeGreaterThanOrEqual(1)
    await expect(a.window.getByTestId('canvas-loading')).toHaveCount(0)
    await expect(a.window.getByTestId('canvas-loading-status')).toHaveText('Project loaded')
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
