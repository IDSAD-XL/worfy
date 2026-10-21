import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { endApp, exited, killThenClean } from './end-app'
import { launchEnv } from './launch-env'
import {
  DIAGNOSTIC_SAVE_MS,
  DIAGNOSTIC_STEP_MS,
  deadline,
  diagnosisBudget,
  diagnosisSummary,
  outputTail,
  shownLine,
  step,
  timeLeftOnClock,
  type WindowState,
} from './start-diagnosis'
import { clickMenuItem } from './menu'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mainEntry = join(repoRoot, 'out', 'main', 'index.js')
export { GH_STUB } from './launch-env'

/**
 * How long the app may take to open its first window and show it, both steps together. A start
 * takes about a second; a start that has not shown a window by then has hung, and waiting out the
 * whole test timeout would only hide where it hung.
 */
const FIRST_WINDOW_TIMEOUT_MS = 30_000
/** How long the app may take to quit. A quit takes well under a second; this bounds a quit that hangs. */
const QUIT_TIMEOUT_MS = 20_000
/** How long a kill waits for the app to name its PID (launchApp); an app that answers at all does in milliseconds. */
const PID_TIMEOUT_MS = 5_000

/**
 * Arguments every test start of the app passes. macOS remembers when Electron (one bundle id,
 * com.github.Electron, for every dev and test start) was killed while it reopened its windows, and
 * the next start then runs a modal "reopen windows?" alert before `ready`: no window ever appears
 * and every test times out in firstWindow. Tests kill the app on purpose, so this happens. The
 * argument turns window restoration off for that one process and changes nothing on the machine.
 */
export const NO_WINDOW_RESTORE = ['-ApplePersistenceIgnoreState', 'YES']

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

/**
 * Reports a kill that left the app running (endApp rejected; undefined: it did not). Soft inside a
 * test, so the test's own error stays the one shown. Outside a test it is thrown, together with
 * `original`, the error of a start that failed, when there is one.
 */
function reportKillFailure(failure: unknown, original?: unknown): void {
  if (failure === undefined) return
  if (currentTest()) {
    expect.soft(failure, 'the app outlived the kill').toBeUndefined()
    return
  }
  throw original === undefined ? failure : new AggregateError([original, failure], 'the app did not start, and it outlived the kill')
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

// ── A start whose window did not show ───────────────────────────────────────

/** Name of the folder, in the test's output folder, that keeps what startDiagnostics found. */
export const START_DIAGNOSTICS = 'start-diagnostics'

/**
 * Keeps the last OUTPUT_LIMIT characters of the app's stdout and stderr, where main's console
 * lines go (src/main/window-show.ts names there the path that showed the window).
 * shortcut: lines the app printed before _electron.launch resolved are not kept, redo when a diagnosis needs the first lines of a start.
 */
function recordOutput(child: ChildProcess): () => string {
  const tail = outputTail()
  child.stdout?.on('data', tail.append)
  child.stderr?.on('data', tail.append)
  return tail.text
}

/** When the first launchApp of each running test began, by test id and retry: the start of the clock testTimeLeft reads. */
const firstLaunchOfTest = new Map<string, number>()

/** Marks the start of the test's clock at its first launchApp. */
function startTestClock(): void {
  const info = currentTest()
  if (info) timeLeftOnClock(firstLaunchOfTest, `${info.testId}:${info.retry}`, info.timeout, Date.now())
}

/**
 * How long the running test has left before its own timeout; undefined outside a test or for a
 * test without a timeout.
 * shortcut: the clock starts at the test's first launchApp, not at the test's start (Playwright gives no start time), so time a test spends before its first launch is not counted; redo when Playwright exposes the elapsed time or a test does long work before launching.
 */
function testTimeLeft(): number | undefined {
  const info = currentTest()
  if (!info || info.timeout === 0) return undefined
  return timeLeftOnClock(firstLaunchOfTest, `${info.testId}:${info.retry}`, info.timeout, Date.now())
}

/**
 * Collects, for a start whose window was not shown, what the gate log otherwise lacks: the state of
 * the window and its web contents, a capturePage() PNG, the page's document.readyState, the app's
 * output and the files of logs/ in its data folder. Runs before the app is killed and its data
 * folder removed. Every step is bounded, and all of them together keep to diagnosisBudget: what
 * the test has left before its timeout, less the time the kill and the cleanup after it need, so
 * the test timeout never cuts the cleanup off. With no time left nothing is asked.
 * Inside a test the files go to `<test output>/start-diagnostics-…/` and are attached; the returned
 * line sums them up for the error message, which the gate log keeps.
 */
async function startDiagnostics(app: ElectronApplication, dataDir: string, output: () => string): Promise<string> {
  const budget = diagnosisBudget(testTimeLeft())
  const left = deadline(budget)
  const state = await step(
    () =>
      app.evaluate(({ BrowserWindow }): WindowState => {
        const all = BrowserWindow.getAllWindows()
        const first = all[0]
        if (!first || first.isDestroyed()) return { windows: all.length }
        const contents = first.webContents
        return {
          windows: all.length,
          isVisible: first.isVisible(),
          isMinimized: first.isMinimized(),
          opacity: first.getOpacity(),
          bounds: first.getBounds(),
          isLoading: contents.isLoading(),
          isLoadingMainFrame: contents.isLoadingMainFrame(),
          isWaitingForResponse: contents.isWaitingForResponse(),
          isCrashed: contents.isCrashed(),
          url: contents.getURL(),
        }
      }),
    left(DIAGNOSTIC_STEP_MS),
  )
  const readyState = await step(
    () =>
      app.evaluate(({ BrowserWindow }) => {
        const first = BrowserWindow.getAllWindows()[0]
        return first ? (first.webContents.executeJavaScript('document.readyState') as Promise<string>) : 'no window'
      }),
    left(DIAGNOSTIC_STEP_MS),
  )
  const capture = await step(
    () =>
      app.evaluate(async ({ BrowserWindow }) => {
        const first = BrowserWindow.getAllWindows()[0]
        if (!first) return null
        const image = await first.webContents.capturePage()
        return image.isEmpty() ? '' : image.toPNG().toString('base64')
      }),
    left(DIAGNOSTIC_STEP_MS),
  )
  const appOutput = output()
  const shown = shownLine(appOutput)
  const report = { budgetMs: budget, state, readyState, capture: 'value' in capture ? (capture.value ? 'saved' : 'empty') : capture, shownLine: shown }
  let where = ''

  const info = currentTest()
  if (info) {
    const dir = info.outputPath(`${START_DIAGNOSTICS}-${info.retry}-${Date.now()}`)
    const saved = await step(async () => {
      await mkdir(dir, { recursive: true })
      const files: { name: string; path: string; contentType: string }[] = []
      const save = async (name: string, body: string | Buffer, contentType: string): Promise<void> => {
        const path = join(dir, name)
        await writeFile(path, body)
        files.push({ name, path, contentType })
      }
      await save('state.json', `${JSON.stringify(report, null, 2)}\n`, 'application/json')
      if ('value' in capture && capture.value) await save('capture.png', Buffer.from(capture.value, 'base64'), 'image/png')
      await save('app-output.txt', appOutput, 'text/plain')
      const logs = join(dataDir, 'logs')
      const names = await readdir(logs).catch(() => [] as string[])
      for (const name of names) {
        const path = join(dir, `data-logs-${name}`)
        if (await copyFile(join(logs, name), path).then(() => true, () => false)) files.push({ name: `data-logs-${name}`, path, contentType: 'text/plain' })
      }
      for (const file of files) await info.attach(`${START_DIAGNOSTICS}-${file.name}`, { path: file.path, contentType: file.contentType })
    }, left(DIAGNOSTIC_SAVE_MS))
    where = 'value' in saved ? `; diagnostics in ${dir}` : `; diagnostics not saved (${saved.problem})`
  }
  return diagnosisSummary(state, readyState, shown, where)
}

/**
 * Starts the app with isolated data and Claude directories and the fake agent: the built out/
 * bundle by default, or the packaged app when `executablePath` is given. Resolves once the window
 * is on screen.
 * Every e2e test launches the app through this helper, so a new isolation variable added to its
 * environment (launchEnv, launch-env.ts) covers the packaged-app tests too.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const { executablePath } = options
  if (executablePath === undefined && !existsSync(mainEntry)) {
    throw new Error(`The app is not built: ${mainEntry} is missing. Run \`pnpm test:e2e\`, which builds first.`)
  }
  startTestClock()
  const dataDir = await mkdtemp(join(tmpdir(), 'worfy-data-'))
  const claudeHome = await mkdtemp(join(tmpdir(), 'worfy-claude-'))
  const shellDir = await mkdtemp(join(tmpdir(), 'worfy-shell-'))
  const cleanDirs = async (): Promise<void> => {
    await removeDir(dataDir)
    await removeDir(claudeHome)
    await removeDir(shellDir)
  }

  let app: ElectronApplication
  try {
    const env = await launchEnv({ dataDir, claudeHome, shellDir, env: options.env })
    // Unpackaged, the app is started by its directory, as `electron .` and the packaged .app start
    // it: Electron then reads package.json (`main` points at out/main/index.js), and the app's name
    // and version are worfy's own, not Electron's.
    app = await _electron.launch(
      executablePath === undefined
        ? { args: [repoRoot, ...NO_WINDOW_RESTORE], cwd: repoRoot, env }
        : { executablePath, args: NO_WINDOW_RESTORE, env },
    )
  } catch (error) {
    await cleanDirs()
    throw error
  }
  // Taken now: once Playwright has closed its connection to the app, app.process() throws.
  const child = app.process()
  const output = recordOutput(child)
  // The PID of the app's main process, as the app names it. On Windows `child` is the cmd.exe
  // Playwright starts Electron through, and the app is its child (end-app.ts). Asked now, while the
  // app answers; a kill waits for the answer only briefly, since a hung app may never give it.
  const appPid: Promise<number | undefined> = app.evaluate(() => process.pid).catch(() => undefined)
  const kill = async (): Promise<void> => endApp(child, await Promise.race([appPid, timeout(PID_TIMEOUT_MS).then(() => undefined)]))
  const tracing = currentTest() !== undefined && (await app.context().tracing.start({ snapshots: true, screenshots: false }).then(() => true, () => false))
  const windowDeadline = Date.now() + FIRST_WINDOW_TIMEOUT_MS
  const windowLeft = (): number => Math.max(1, windowDeadline - Date.now())
  try {
    const window = await app.firstWindow({ timeout: windowLeft() })
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
    if ((await Promise.race([shown.then(() => 'shown' as const), timeout(windowLeft())])) === 'timeout') {
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
        const killFailure = await killThenClean(async () => {
          if (closed === 'timeout') await kill()
          await exited(child)
        }, cleanDirs)
        reportKillFailure(killFailure)
        if (closed === 'closed') return
        const problem = `the app did not quit within ${QUIT_TIMEOUT_MS / 1000} s and was killed`
        // Soft inside a test: a test that already failed keeps its own error, which a throw here would replace.
        if (currentTest()) expect.soft(closed, problem).toBe('closed')
        else throw new Error(problem)
      },
    }
  } catch (error) {
    // The window did not show, or firstWindow gave up: say why while the app and its data folder
    // are still there. A diagnosis that fails itself only adds its reason to the message.
    if (error instanceof Error) {
      const diagnosis = await startDiagnostics(app, dataDir, output).catch((failure: unknown) => `diagnostics failed: ${String(failure)}`)
      const before = error.message
      error.message = `${before}\n  ${diagnosis}`
      // A function, not a string: a $& or $' in a path or URL of the message must not be read as a pattern.
      if (error.stack?.includes(before)) error.stack = error.stack.replace(before, () => error.message)
    }
    reportKillFailure(await killThenClean(kill, cleanDirs), error)
    throw error
  }
}

// ── A second window ─────────────────────────────────────────────────────────

/** The preload of the built bundle, the one src/main/window.ts gives the app's window. */
const builtPreload = join(repoRoot, 'out', 'preload', 'index.cjs')

/**
 * Opens a second window of the running app on the page of the first one, the way the app opens
 * its own window (src/main/window.ts): the built preload, context isolation and the sandbox. The
 * app has no command for it yet (no "New Window" menu item), so the window is made from main
 * through app.evaluate. Its calls pass the IPC sender check like the first window's: both load
 * the same out/renderer/index.html. Resolves with the new window once its page has loaded; built
 * bundle only (`launchApp` without `executablePath`). `size` is the window's outer size (default
 * 1100×760); set it here, not with canvasReady(), whose `size` resizes the first window.
 */
export async function openSecondWindow(launched: Pick<LaunchedApp, 'app'>, options: { size?: { width: number; height: number } } = {}): Promise<Page> {
  const opened = launched.app.waitForEvent('window')
  const size = options.size ?? { width: 1100, height: 760 }
  await launched.app.evaluate(
    async ({ BrowserWindow }, { preload, size }) => {
      const first = BrowserWindow.getAllWindows().find((each) => !each.isDestroyed())
      if (!first) throw new Error('no window of the app is open')
      const second = new BrowserWindow({
        ...size,
        show: true,
        // The window's own webPreferences (src/main/window.ts), the <webview> tag of the Browsers too.
        webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: true },
      })
      await second.loadURL(first.webContents.getURL())
    },
    { preload: builtPreload, size },
  )
  const window = await opened
  await window.waitForLoadState('domcontentloaded')
  return window
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
 * given), the `visible` elements are there, and then for `frames` animation frames in a row the
 * viewport transform, the set of Node elements and every Node's box stay the same. A Node element
 * that is replaced by a new one counts as a change too, and a page without a React Flow viewport
 * never counts as at rest. This replaces fixed pauses: it waits as long as the app needs, and no
 * longer. The test "canvasReady waits for the viewport and the Nodes to stop moving" in
 * canvas-layout.spec.ts checks that it does notice movement.
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
        // Null while there is no viewport: a Canvas that is not there is not at rest, so the wait
        // fails at its timeout instead of passing as a plain pause. The same happens if React Flow
        // ever renames the class.
        const signature = (): string | null => {
          const viewport = dom.document.querySelector('.react-flow__viewport')
          if (!viewport) return null
          const parts = [dom.getComputedStyle(viewport).transform]
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
          still = current !== null && current === last ? still + 1 : 0
          last = current
          if (still >= wanted) return done({ ok: true, last: last ?? '' })
          if (now > until) return done({ ok: false, last: last ?? 'no .react-flow__viewport in the page' })
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

// ── Two linked worfy ────────────────────────────────────────────────────────

/** The bridge of the page, typed for this file: the e2e typecheck has no DOM library. */
interface PageBridge {
  worfy: { invoke(channel: string, input?: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> }
}

/** The id of the Machine of the worfy whose window this is (link.state). */
export async function machineIdOf(window: Page): Promise<string> {
  let id: string | null = null
  await expect
    .poll(async () => {
      const result = await window.evaluate(() => (globalThis as unknown as PageBridge).worfy.invoke('link.state'))
      id = result.ok ? ((result.value as { machine: { id: string } | null }).machine?.id ?? null) : null
      return id
    })
    .not.toBeNull()
  if (id === null) throw new Error('the link service of this worfy did not start')
  return id
}

/** The sidebar's Machines section. */
const machinesSection = (window: Page): Locator => window.getByRole('region', { name: 'Machines', exact: true })

/** The heading of the sidebar's Machines section: the button that collapses and expands it. */
const machinesHeading = (window: Page): Locator => machinesSection(window).getByRole('button', { name: 'Machines', exact: true })

/**
 * Sets the Machines section expanded or collapsed, and does nothing when it is so already.
 *
 * The section shows its default (collapsed) until the window has the app settings from main, and
 * then what they say: `aria-expanded` read before they arrive may change before the click, and the
 * click would then turn the section the wrong way. So first wait until the heading says what main
 * has saved for the section (`sidebar.collapsed[<section id>]`); with nothing saved the default
 * stays, whenever the settings arrive. Only then decide whether to click.
 */
async function setMachinesExpanded(window: Page, expanded: boolean): Promise<void> {
  const heading = machinesHeading(window)
  await expect(heading).toBeVisible()
  const id = await machinesSection(window).getAttribute('data-section-id')
  if (id === null) throw new Error('the Machines section has no data-section-id')
  const saved = await window.evaluate(async (sectionId) => {
    const result = await (globalThis as unknown as PageBridge).worfy.invoke('appSettings.get')
    if (!result.ok) throw new Error(`appSettings.get failed: ${result.error}`)
    const collapsed = (result.value as { sidebar: { collapsed: Record<string, boolean | undefined> } }).sidebar.collapsed[sectionId]
    return collapsed === undefined ? null : !collapsed
  }, id)
  if (saved !== null) await expect(heading).toHaveAttribute('aria-expanded', String(saved))
  if ((await heading.getAttribute('aria-expanded')) !== String(expanded)) await heading.click()
  await expect(heading).toHaveAttribute('aria-expanded', String(expanded))
}

/**
 * Expands the Machines section of the sidebar, which is collapsed until the user expands it: its
 * list and "Link a machine…" are in its body. worfy remembers it for the data folder. Does nothing
 * when the section is expanded already.
 */
export async function expandMachines(window: Page): Promise<void> {
  await setMachinesExpanded(window, true)
  await expect(window.getByTestId('link-machine-button')).toBeVisible()
}

/** Collapses the Machines section of the sidebar; does nothing when it is collapsed already. */
export async function collapseMachines(window: Page): Promise<void> {
  await setMachinesExpanded(window, false)
  await expect(window.getByTestId('link-machine-button')).toBeHidden()
}

/** SETTINGS_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SETTINGS_MENU_ITEM_ID = 'app.settings'

/** The labels of the two switches of Settings → Machines. */
export const PROJECTS_ACCESS_LABEL = 'Linked machines can work with my Projects'
export const KEEP_AWAKE_LABEL = 'Keep this computer awake while linked machines are connected'

/**
 * Opens Settings → Machines of this worfy the way a person does: "Settings…" of the app menu, then
 * the row "Machines" of the section list. Answers the Settings window, on that section.
 */
export async function openMachinesSettings(launched: Pick<LaunchedApp, 'app' | 'window'>): Promise<Locator> {
  await clickMenuItem(launched.app, SETTINGS_MENU_ITEM_ID)
  const dialog = launched.window.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Machines', exact: true }).click()
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Machines')
  return dialog
}

/** Closes the Settings window with its Close button. */
export async function closeSettings(window: Page): Promise<void> {
  const dialog = window.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
}

/** Sets the switch `label` of Settings → Machines to `on` with a click, and closes Settings. */
async function setMachinesSwitch(launched: Pick<LaunchedApp, 'app' | 'window'>, label: string, on: boolean): Promise<void> {
  const dialog = await openMachinesSettings(launched)
  const toggle = dialog.getByRole('switch', { name: label, exact: true })
  // Disabled until the link service of this worfy has started.
  await expect(toggle).toBeEnabled()
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(on))
  await closeSettings(launched.window)
}

/**
 * Sets "Linked machines can work with my Projects" of this worfy, in Settings → Machines. On also
 * gives every Machine linked now full access (worfy-link ticket 18: each Linked machine has its own
 * level, and a new one starts at Off), so "on" means what the one switch meant before; off leaves
 * the levels as they are.
 */
export async function setProjectsAccess(launched: Pick<LaunchedApp, 'app' | 'window'>, on: boolean): Promise<void> {
  if (!on) return setMachinesSwitch(launched, PROJECTS_ACCESS_LABEL, false)
  await setMachinesSwitch(launched, PROJECTS_ACCESS_LABEL, true)
  const dialog = await openMachinesSettings(launched)
  const levels = dialog.locator('[data-testid^="link-machine-access-"]')
  for (const level of await levels.all()) await chooseLevel(launched.window, level, 'all')
  await closeSettings(launched.window)
}

/** The labels of the levels of a Linked machine in Settings → Machines, by value. */
export const ACCESS_LEVEL_LABELS = { off: 'Off', read: 'Read only', all: 'Full access' } as const

/** Chooses `value` in the level field `level` of Settings → Machines, the way a person does. */
export async function chooseLevel(window: Page, level: Locator, value: keyof typeof ACCESS_LEVEL_LABELS): Promise<void> {
  await expect(level).toBeEnabled()
  if ((await level.getAttribute('data-value')) === value) return
  await level.click()
  await window.locator(`[role="option"][data-value="${value}"]`).click()
  // Main answers with the new state: the field shows the level once main has it.
  await expect(level).toHaveAttribute('data-value', value)
  await expect(level).toContainText(ACCESS_LEVEL_LABELS[value])
}

/** Sets "Keep this computer awake while linked machines are connected" of this worfy, in Settings → Machines. */
export const setKeepAwake = (launched: Pick<LaunchedApp, 'app' | 'window'>, on: boolean): Promise<void> => setMachinesSwitch(launched, KEEP_AWAKE_LABEL, on)

/** Opens "Link a machine" from the Machines section of the sidebar, expanding the section first. */
export async function openLinkDialog(window: Page): Promise<Locator> {
  await expandMachines(window)
  await window.getByTestId('link-machine-button').click()
  const dialog = window.getByTestId('link-machine-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

/** The code "Link a machine" shows on this window now. */
export async function shownCode(window: Page): Promise<string> {
  const code = window.getByTestId('link-code')
  await expect(code).toHaveText(/^\d{6}$/)
  return (await code.textContent())?.trim() ?? ''
}

/** On `a`, with "Link a machine" open on both: types the address `b` shows, then goes to the code field. */
export async function chooseByAddress(a: Page, b: Page): Promise<void> {
  const address = b.getByTestId('link-own-address').first()
  await expect(address).toHaveText(/^127\.0\.0\.1:\d+$/)
  await a.getByTestId('link-address-input').fill((await address.textContent()) ?? '')
  await a.getByRole('button', { name: 'Next' }).click()
  await expect(a.getByTestId('link-code-input')).toBeVisible()
}

/**
 * Links two running worfy through the UI, as a person does: "Link a machine" on both, the address
 * of `b` and the code `b` shows typed on `a`. Waits until both show the success, closes both
 * dialogs and waits until each lists the other as online. The Machines section of both is left
 * expanded, with the row of the other on screen.
 */
export async function linkThroughUi(a: Page, b: Page): Promise<void> {
  await openLinkDialog(a)
  await openLinkDialog(b)
  await chooseByAddress(a, b)
  await a.getByTestId('link-code-input').fill(await shownCode(b))
  await a.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(a.getByTestId('link-success')).toBeVisible()
  await expect(b.getByTestId('link-success')).toBeVisible()
  for (const window of [a, b]) {
    await window.getByTestId('link-machine-dialog').getByRole('button', { name: 'Done' }).click()
    await expect(window.getByTestId('link-machine-dialog')).toHaveCount(0)
  }
  const [aId, bId] = [await machineIdOf(a), await machineIdOf(b)]
  for (const [window, other] of [
    [a, bId],
    [b, aId],
  ] as const) {
    const row = window.locator(`[data-testid="machine-row"][data-machine-id="${other}"]`)
    // On screen: an attribute is there on a row of a collapsed section too.
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('data-state', 'online')
  }
}

export interface LinkedPair {
  a: LaunchedApp
  b: LaunchedApp
  /** The Machine id of `a` and of `b`. */
  aId: string
  bId: string
  /** Closes both worfy. */
  close: () => Promise<void>
}

/**
 * Two worfy linked with each other (worfy-link tickets 02, 09, 13, 14, 15): each its own data
 * folder and Machine, linked through "Link a machine" by the address 127.0.0.1:<port> of `b` and
 * the code `b` shows. Bonjour is off (launchApp). Both are online for each other when it resolves.
 */
export async function launchLinkedPair(options: { a?: LaunchOptions; b?: LaunchOptions } = {}): Promise<LinkedPair> {
  const a = await launchApp(options.a)
  let b: LaunchedApp | undefined
  try {
    b = await launchApp(options.b)
    await linkThroughUi(a.window, b.window)
    const second = b
    return {
      a,
      b: second,
      aId: await machineIdOf(a.window),
      bId: await machineIdOf(second.window),
      close: async () => {
        await a.close()
        await second.close()
      },
    }
  } catch (error) {
    await a.close()
    await b?.close()
    throw error
  }
}

/**
 * What is cut inside a Ticket card (worfy-canvas ticket 18: nothing is). For the card and every
 * element in it: content wider or taller than its box, text ending with "…" or clamped lines. And
 * by the drawn boxes, to a fraction of a pixel: an element or a piece of text that reaches past
 * the padding box of an ancestor that clips (the card is one). Empty when everything is whole.
 */
export async function ticketCardCuts(card: Locator): Promise<string[]> {
  return card.evaluate((node) => {
    // The e2e typecheck has no DOM library: the few page types used here.
    type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number }
    type Element = {
      scrollWidth?: number
      clientWidth: number
      scrollHeight: number
      clientHeight: number
      tagName: string
      className: unknown
      textContent: string | null
      parentElement: Element | null
      childNodes: ArrayLike<{ nodeType: number; textContent: string | null }>
      getBoundingClientRect(): Box
      querySelectorAll(selector: string): ArrayLike<Element>
    }
    type Style = {
      display: string
      textOverflow: string
      webkitLineClamp?: string
      overflowX: string
      overflowY: string
      borderLeftWidth: string
      borderTopWidth: string
      borderRightWidth: string
      borderBottomWidth: string
    }
    type Range = { selectNodeContents(element: Element): void; getBoundingClientRect(): Box }
    const page = globalThis as unknown as { getComputedStyle(element: Element): Style; document: { createRange(): Range } }
    const root = node as unknown as Element
    const name = (element: Element) => `<${element.tagName.toLowerCase()} class="${String(element.className)}"> «${(element.textContent ?? '').slice(0, 60)}»`
    // Rounding of the layout itself, far below what shows as a cut glyph.
    const EPSILON = 0.05
    /** The padding box of `element`: what it shows when it clips. */
    const paddingBox = (element: Element): Box => {
      const box = element.getBoundingClientRect()
      const style = page.getComputedStyle(element)
      const left = box.left + parseFloat(style.borderLeftWidth)
      const top = box.top + parseFloat(style.borderTopWidth)
      const right = box.right - parseFloat(style.borderRightWidth)
      const bottom = box.bottom - parseFloat(style.borderBottomWidth)
      return { left, top, right, bottom, width: right - left, height: bottom - top }
    }
    const clips = (element: Element) => {
      const style = page.getComputedStyle(element)
      return style.overflowX !== 'visible' || style.overflowY !== 'visible'
    }
    /** How far `box` reaches past `clip`, side by side; empty when it stays inside. */
    const past = (box: Box, clip: Box): string[] => {
      const sides: string[] = []
      if (box.left < clip.left - EPSILON) sides.push(`left by ${(clip.left - box.left).toFixed(2)} px`)
      if (box.top < clip.top - EPSILON) sides.push(`top by ${(clip.top - box.top).toFixed(2)} px`)
      if (box.right > clip.right + EPSILON) sides.push(`right by ${(box.right - clip.right).toFixed(2)} px`)
      if (box.bottom > clip.bottom + EPSILON) sides.push(`bottom by ${(box.bottom - clip.bottom).toFixed(2)} px`)
      return sides
    }
    /** The clipping ancestors of `element` up to the card, the card included, with `element` itself when it clips. */
    const clippers = (element: Element, self: boolean): Element[] => {
      const found: Element[] = []
      for (let at: Element | null = self ? element : element.parentElement; at; at = at.parentElement) {
        if (at === root || clips(at)) found.push(at)
        if (at === root) break
      }
      return found
    }
    const cuts: string[] = []
    for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
      // SVG elements have no scrollWidth; an element not drawn cuts nothing.
      if (typeof element.scrollWidth !== 'number') continue
      const style = page.getComputedStyle(element)
      if (style.display === 'none') continue
      if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth) cuts.push(`${name(element)}: ${element.scrollWidth} px wide in ${element.clientWidth} px`)
      if (element.clientHeight > 0 && element.scrollHeight > element.clientHeight) cuts.push(`${name(element)}: ${element.scrollHeight} px tall in ${element.clientHeight} px`)
      if (style.textOverflow === 'ellipsis') cuts.push(`${name(element)}: text-overflow: ellipsis`)
      if (style.webkitLineClamp !== undefined && style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '') cuts.push(`${name(element)}: -webkit-line-clamp: ${style.webkitLineClamp}`)
      const box = element.getBoundingClientRect()
      if (element !== root && box.width > 0 && box.height > 0) {
        for (const clip of clippers(element, false)) {
          const sides = past(box, paddingBox(clip))
          if (sides.length) cuts.push(`${name(element)}: past ${clip === root ? 'the card' : name(clip)}, ${sides.join(', ')}`)
        }
      }
      // The element's own text, measured as drawn, inside every box that clips it.
      const hasText = Array.from(element.childNodes).some((child) => child.nodeType === 3 && (child.textContent ?? '').trim() !== '')
      if (!hasText) continue
      const range = page.document.createRange()
      range.selectNodeContents(element)
      const text = range.getBoundingClientRect()
      if (text.width === 0 && text.height === 0) continue
      for (const clip of clippers(element, true)) {
        const sides = past(text, paddingBox(clip))
        if (sides.length) cuts.push(`${name(element)}: its text past ${clip === element ? 'its own box' : clip === root ? 'the card' : name(clip)}, ${sides.join(', ')}`)
      }
    }
    return cuts
  })
}

/** The pairs of boxes that overlap, by name; boxes that only touch do not. */
export function overlaps(boxes: readonly { name: string; x: number; y: number; width: number; height: number }[]): string[] {
  const found: string[] = []
  boxes.forEach((a, i) => {
    for (const b of boxes.slice(i + 1)) {
      if (a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5) found.push(`${a.name} and ${b.name}`)
    }
  })
  return found
}

/** One element to measure: a name for the messages and a CSS selector that finds exactly it. */
export interface Measured {
  name: string
  selector: string
}

/**
 * The boxes of several elements read in one pass inside the page, with no await between two reads,
 * so a relayout cannot fall between them. A name whose selector finds nothing comes back as missing.
 */
export async function boxesInOnePass(page: Page, targets: readonly Measured[]): Promise<{ boxes: { name: string; x: number; y: number; width: number; height: number }[]; missing: string[] }> {
  return page.evaluate((list) => {
    type Rect = { x: number; y: number; width: number; height: number }
    const doc = (globalThis as unknown as { document: { querySelector(selector: string): { getBoundingClientRect(): Rect } | null } }).document
    const boxes: { name: string; x: number; y: number; width: number; height: number }[] = []
    const missing: string[] = []
    for (const { name, selector } of list) {
      const element = doc.querySelector(selector)
      if (element === null) {
        missing.push(name)
        continue
      }
      const { x, y, width, height } = element.getBoundingClientRect()
      boxes.push({ name, x, y, width, height })
    }
    return { boxes, missing }
  }, targets)
}

/**
 * Waits until the layout of `targets` settles — two passes in a row read the same boxes — with
 * every element there and no two of them overlapping, and fails with the last pass's overlaps
 * otherwise. Card heights change as data arrives (a card's repository chip, say) and every change
 * places the cards again, so boxes read one by one can mix two layouts; a real overlap stays in
 * every settled pass and fails the test.
 */
export async function expectSettledWithoutOverlaps(page: Page, targets: readonly Measured[], message: string, timeout = 10_000): Promise<void> {
  let previous: string | null = null
  await expect
    .poll(
      async () => {
        const { boxes, missing } = await boxesInOnePass(page, targets)
        const key = JSON.stringify(boxes)
        const settled = key === previous
        previous = key
        return { settled, missing, overlaps: overlaps(boxes) }
      },
      { message, timeout, intervals: [100, 250, 500] },
    )
    .toEqual({ settled: true, missing: [], overlaps: [] })
}
