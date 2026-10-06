import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mainEntry = join(repoRoot, 'out', 'main', 'index.js')

/**
 * How long the app may take to open its first window. A start takes about a second; a start that
 * has not shown a window by then has hung, and waiting out the whole test timeout would only hide
 * where it hung.
 */
const FIRST_WINDOW_TIMEOUT_MS = 30_000
/** How long the app may take to quit. A quit takes well under a second; this bounds a quit that hangs. */
const QUIT_TIMEOUT_MS = 20_000

/** Names of the attachments a failing test keeps (see FailureArtifactsReporter below). */
export const APP_TRACE = 'app-trace'
export const APP_SCREENSHOT = 'app-screenshot'

export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  /** Temporary WORFY_DATA_DIR: the app's own state for this run. */
  dataDir: string
  /** Temporary WORFY_CLAUDE_HOME: stands in for ~/.claude. */
  claudeHome: string
  /**
   * Saves the app's trace and a screenshot of the window as attachments of the test (kept only
   * when the test fails), quits the app, waits for its process to exit and removes both temporary
   * directories. A quit that hangs is ended with SIGKILL and reported as a failure of the test.
   */
  close: () => Promise<void>
}

export interface LaunchOptions {
  /** Extra environment for the app process. */
  env?: Record<string, string>
  /**
   * Executable of a packaged app (worfy.app/Contents/MacOS/worfy) to launch instead of the
   * built out/ bundle. The isolation below applies to it the same way.
   */
  executablePath?: string
}

/** Electron helper processes may still hold files in a directory for a moment after the app exits. */
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** The running test, or undefined when called outside one (a hook of another runner, a script). */
function currentTest(): ReturnType<typeof test.info> | undefined {
  try {
    return test.info()
  } catch {
    return undefined
  }
}

/** Resolves once the app's main process has exited; at once when it already has. */
function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((done) => child.once('exit', () => done()))
}

/** Ends the app's main process with SIGKILL and waits until it has exited. */
async function kill(child: ChildProcess): Promise<void> {
  const gone = exited(child)
  child.kill('SIGKILL')
  await gone
}

const timeout = (ms: number): Promise<'timeout'> => new Promise((done) => setTimeout(() => done('timeout'), ms).unref())

/** Whether `work` settled successfully within `ms`; a step that hangs on a hung app is given up. */
const within = (work: Promise<unknown>, ms: number): Promise<boolean> =>
  Promise.race([work.then(() => true, () => false), timeout(ms).then(() => false)])

/**
 * Keeps the app's trace (DOM snapshots of every step) and a screenshot of the window as
 * attachments of the running test. Playwright's own `trace` and `screenshot` options cover only
 * the pages of its browser fixtures, not an Electron app launched by the test, hence this; the
 * reporter at the end of this file drops both again when the test passes.
 */
async function saveArtifacts(app: ElectronApplication, window: Page, tracing: boolean): Promise<void> {
  const info = currentTest()
  if (!info) return
  const screenshot = info.outputPath(`${APP_SCREENSHOT}-${info.retry}-${Date.now()}.png`)
  if (await within(window.screenshot({ path: screenshot, timeout: 5_000 }), 6_000)) {
    await info.attach(APP_SCREENSHOT, { path: screenshot, contentType: 'image/png' })
    await removeDir(screenshot)
  }
  if (!tracing) return
  const trace = info.outputPath(`${APP_TRACE}-${info.retry}-${Date.now()}.zip`)
  if (await within(app.context().tracing.stop({ path: trace }), 15_000)) {
    await info.attach(APP_TRACE, { path: trace, contentType: 'application/zip' })
    await removeDir(trace)
  }
}

/**
 * Starts the app with isolated data and Claude directories and the fake agent: the built out/
 * bundle by default, or the packaged app when `executablePath` is given. Resolves once the window
 * is on screen.
 * Every e2e test launches the app through this helper, so a new isolation variable added here
 * covers the packaged-app tests too.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const { executablePath } = options
  if (executablePath === undefined && !existsSync(mainEntry)) {
    throw new Error(`The app is not built: ${mainEntry} is missing. Run \`pnpm test:e2e\`, which builds first.`)
  }
  const dataDir = await mkdtemp(join(tmpdir(), 'worfy-data-'))
  const claudeHome = await mkdtemp(join(tmpdir(), 'worfy-claude-'))
  const cleanDirs = async (): Promise<void> => {
    await removeDir(dataDir)
    await removeDir(claudeHome)
  }

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  Object.assign(env, {
    WORFY_DATA_DIR: dataDir,
    WORFY_CLAUDE_HOME: claudeHome,
    WORFY_AGENT: 'fake',
    // A gh that never reaches GitHub (test/fixtures/gh/gh-stub.mjs): no PRs unless GH_STUB_DIR says otherwise.
    WORFY_GH: join(repoRoot, 'test', 'fixtures', 'gh', 'gh'),
    ...options.env,
  })

  let app: ElectronApplication
  try {
    // Unpackaged, the app is started by its directory, as `electron .` and the packaged .app start
    // it: Electron then reads package.json (`main` points at out/main/index.js), and the app's name
    // and version are worfy's own, not Electron's.
    app = await _electron.launch(
      executablePath === undefined ? { args: [repoRoot], cwd: repoRoot, env } : { executablePath, env },
    )
  } catch (error) {
    await cleanDirs()
    throw error
  }
  // Taken now: once Playwright has closed its connection to the app, app.process() throws.
  const child = app.process()
  const tracing = currentTest() !== undefined && (await app.context().tracing.start({ snapshots: true, screenshots: false }).then(() => true, () => false))
  try {
    const window = await app.firstWindow({ timeout: FIRST_WINDOW_TIMEOUT_MS })
    // Returned only once the window is on screen. The app creates it hidden and shows it when the
    // page has painted; macOS then fits it into the display. A size or position a test sets before
    // that is undone on a display smaller than the window (a CI runner's is 1024 × 768).
    const shown = app.evaluate(
      ({ BrowserWindow }) =>
        new Promise<void>((done) => {
          const first = BrowserWindow.getAllWindows()[0]
          if (!first || first.isVisible()) return done()
          first.once('show', () => done())
        }),
    )
    if ((await Promise.race([shown.then(() => 'shown' as const), timeout(FIRST_WINDOW_TIMEOUT_MS)])) === 'timeout') {
      throw new Error(`the window was not shown within ${FIRST_WINDOW_TIMEOUT_MS / 1000} s`)
    }
    return {
      app,
      window,
      dataDir,
      claudeHome,
      close: async () => {
        await saveArtifacts(app, window, tracing)
        const closed = await Promise.race([app.close().then(() => 'closed' as const), timeout(QUIT_TIMEOUT_MS)])
        if (closed === 'timeout') await kill(child)
        await exited(child)
        await cleanDirs()
        if (closed === 'closed') return
        const problem = `the app did not quit within ${QUIT_TIMEOUT_MS / 1000} s and was killed`
        // Soft inside a test: a test that already failed keeps its own error, which a throw here would replace.
        if (currentTest()) expect.soft(closed, problem).toBe('closed')
        else throw new Error(problem)
      },
    }
  } catch (error) {
    await kill(child)
    await cleanDirs()
    throw error
  }
}

// ── The Canvas at rest ──────────────────────────────────────────────────────

/** The page's DOM, typed for this file: the e2e typecheck has no DOM library. */
interface PageDom {
  document: { querySelector(selector: string): PageElement | null; querySelectorAll(selector: string): ArrayLike<PageElement> }
  getComputedStyle(element: PageElement): { transform: string }
  requestAnimationFrame(callback: (now: number) => void): number
  performance: { now(): number }
  innerWidth: number
}
interface PageElement {
  getAttribute(name: string): string | null
  getBoundingClientRect(): { x: number; y: number; width: number; height: number }
}

export interface CanvasReadyOptions {
  /**
   * Window size to set. It is set only once the window is on screen: macOS fits a window that is
   * shown after its size was set into the display, so on a display narrower than the size asked
   * for (a CI runner's) the window would stay narrower and Nodes the test needs would be off the
   * Canvas, where React Flow does not draw them at all.
   */
  size?: { width: number; height: number }
  /** Elements that must be visible before the Canvas is waited on. */
  visible?: Locator[]
  /** Animation frames in a row in which nothing on the Canvas may move (default 10). */
  frames?: number
  /** Timeout of the whole wait, in milliseconds (default 10 000). */
  timeout?: number
}

/**
 * Waits until the Canvas is at rest: the window is on screen (when `app` is given; at `size` when
 * given), the
 * `visible` elements are there, and then for `frames` animation frames in a row the viewport
 * transform, the set of Node elements and every Node's box stay the same. A Node element that is
 * replaced by a new one counts as a change too. This replaces fixed pauses: it waits as long as
 * the app needs, and no longer.
 */
export async function canvasReady(launched: { window: Page; app?: ElectronApplication }, options: CanvasReadyOptions = {}): Promise<void> {
  const { app, window } = launched
  const limit = options.timeout ?? 10_000
  const deadline = Date.now() + limit
  const left = (): number => Math.max(1, deadline - Date.now())

  if (app) {
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false), { timeout: left(), message: 'the window is on screen' })
      .toBe(true)
  }
  const size = options.size
  if (size) {
    if (!app) throw new Error('canvasReady: setting the window size needs the app')
    await expect
      .poll(
        async () => {
          const width = await window.evaluate(() => (globalThis as unknown as PageDom).innerWidth)
          if (width !== size.width) await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setSize(wanted.width, wanted.height), size)
          return width
        },
        { timeout: left(), message: `the window is ${size.width} px wide` },
      )
      .toBe(size.width)
  }
  for (const locator of options.visible ?? []) await expect(locator).toBeVisible({ timeout: left() })

  const frames = options.frames ?? 10
  const settled = await window.evaluate(
    ({ frames: wanted, timeout: ms }) =>
      new Promise<{ ok: boolean; last: string }>((done) => {
        const dom = globalThis as unknown as PageDom
        const ids = new WeakMap<PageElement, number>()
        let next = 0
        const signature = (): string => {
          const viewport = dom.document.querySelector('.react-flow__viewport')
          const parts = [viewport ? dom.getComputedStyle(viewport).transform : 'no viewport']
          const nodes = Array.from(dom.document.querySelectorAll('.react-flow__node'))
          for (const node of nodes) {
            if (!ids.has(node)) ids.set(node, (next += 1))
            const r = node.getBoundingClientRect()
            parts.push(`${node.getAttribute('data-id')}#${ids.get(node)}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`)
          }
          return parts.join(' ')
        }
        const until = dom.performance.now() + ms
        let last = signature()
        let still = 0
        const tick = (now: number): void => {
          const current = signature()
          still = current === last ? still + 1 : 0
          last = current
          if (still >= wanted) return done({ ok: true, last })
          if (now > until) return done({ ok: false, last })
          dom.requestAnimationFrame(tick)
        }
        dom.requestAnimationFrame(tick)
      }),
    { frames, timeout: left() },
  )
  if (!settled.ok) throw new Error(`the Canvas did not come to rest within ${limit} ms; last state: ${settled.last.slice(0, 600)}`)
}

// ── Times measured inside the app ───────────────────────────────────────────

/** What to time: a selector whose first match (or `count` matches) is recorded, or a DOM event. */
export type TimelineMark = { selector: string; count?: number } | { event: string }

interface TimelineGlobals {
  __worfyTimeline?: { marks: Record<string, number>; mark(name: string): void }
  document: {
    querySelectorAll(selector: string): ArrayLike<unknown>
    addEventListener(type: string, listener: () => void, options: { capture: boolean }): void
  }
  performance: { now(): number }
  MutationObserver: new (callback: () => void) => { observe(target: unknown, options: Record<string, boolean>): void }
}

/**
 * Starts recording, inside the renderer, the moment (`performance.now()`) each mark first happens:
 * an element matching a selector is in the page, or an event reaches the document. The page code
 * may add its own marks with `globalThis.__worfyTimeline.mark(name)`, as a test does just before it
 * sends something to main. Times taken this way measure the app, not the round trips of
 * Playwright's polling or the actionability checks of a click, which on a loaded machine take
 * longer than the app itself.
 */
export async function startTimeline(window: Page, marks: Record<string, TimelineMark>): Promise<void> {
  await window.evaluate((wanted) => {
    const page = globalThis as unknown as TimelineGlobals
    const recorded: Record<string, number> = {}
    const mark = (name: string): void => {
      if (recorded[name] === undefined) recorded[name] = page.performance.now()
    }
    page.__worfyTimeline = { marks: recorded, mark }
    const watched = Object.entries(wanted).flatMap(([name, what]) => ('selector' in what ? [{ name, selector: what.selector, count: what.count ?? 1 }] : []))
    const check = (): void => {
      for (const { name, selector, count } of watched) if (recorded[name] === undefined && page.document.querySelectorAll(selector).length >= count) mark(name)
    }
    for (const [name, what] of Object.entries(wanted)) if ('event' in what) page.document.addEventListener(what.event, () => mark(name), { capture: true })
    new page.MutationObserver(check).observe(page.document, { childList: true, subtree: true })
    check()
  }, marks)
}

/** The marks recorded so far, in milliseconds of the renderer's clock. */
export async function timeline(window: Page): Promise<Record<string, number>> {
  return window.evaluate(() => ({ ...((globalThis as unknown as TimelineGlobals).__worfyTimeline?.marks ?? {}) }))
}

/** Waits until every mark in `names` has been recorded, and returns all marks. */
export async function marksOf(window: Page, names: string[], options: { timeout?: number } = {}): Promise<Record<string, number>> {
  await expect
    .poll(
      async () => {
        const marks = await timeline(window)
        return names.filter((name) => marks[name] === undefined)
      },
      { timeout: options.timeout, message: `marks ${names.join(', ')}` },
    )
    .toEqual([])
  return timeline(window)
}

// ── Failure artifacts ───────────────────────────────────────────────────────

/**
 * Reporter (playwright.config.ts) that keeps the app's trace and screenshot only for a test that
 * did not end as expected: for every other test it removes them from the test's output folder.
 * Screenshots a test saves itself for review are not touched.
 */
export default class FailureArtifactsReporter implements Reporter {
  private readonly removals: Promise<void>[] = []

  onTestEnd(_test: TestCase, result: TestResult): void {
    if (result.status !== 'passed' && result.status !== 'skipped') return
    for (const attachment of result.attachments) {
      if ((attachment.name === APP_TRACE || attachment.name === APP_SCREENSHOT) && attachment.path) this.removals.push(removeDir(attachment.path))
    }
  }

  async onEnd(): Promise<void> {
    await Promise.all(this.removals)
  }

  printsToStdio(): boolean {
    return false
  }
}
