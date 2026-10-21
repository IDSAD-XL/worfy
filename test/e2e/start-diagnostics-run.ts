// The side of launchApp (helpers.ts) that diagnoses a start whose first window was not shown: the
// test clock that bounds the diagnosis, the recording of the app's output, and the steps that ask the
// hung app and save what they find as start-diagnostics-* attachments of the test. The pure parts are
// in start-diagnosis.ts. This module does not import helpers.ts, so the two never import each other.
import type { ChildProcess } from 'node:child_process'
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type ElectronApplication } from '@playwright/test'
import {
  DIAGNOSTIC_SAVE_MS,
  DIAGNOSTIC_STEP_MS,
  appShowSummary,
  appShowWatcher,
  deadline,
  diagnosisBudget,
  diagnosisSummary,
  outputTail,
  shownLine,
  step,
  timeLeftOnClock,
  type AppShow,
  type WindowState,
} from './start-diagnosis'

/** The running test, or undefined when called outside one (a hook of another runner, a script). */
export function currentTest(): ReturnType<typeof test.info> | undefined {
  try {
    return test.info()
  } catch {
    return undefined
  }
}

/** Name of the folder, in the test's output folder, that keeps what startDiagnostics found. */
export const START_DIAGNOSTICS = 'start-diagnostics'

/**
 * Keeps the last OUTPUT_LIMIT characters of the app's stdout and stderr, where main's console
 * lines go, and watches stdout for the console.info line in which src/main/window-show.ts names
 * the path that showed the window (stdout alone: a chunk of stderr cannot split that line).
 * shortcut: lines the app printed before _electron.launch resolved are not kept, redo when a diagnosis needs the first lines of a start.
 */
export function recordOutput(child: ChildProcess): { text: () => string; appShow: ReturnType<typeof appShowWatcher> } {
  const tail = outputTail()
  const appShow = appShowWatcher()
  child.stdout?.on('data', tail.append)
  child.stdout?.on('data', appShow.append)
  child.stderr?.on('data', tail.append)
  return { text: tail.text, appShow }
}

/** When the first launchApp of each running test began, by test id and retry: the start of the clock testTimeLeft reads. */
const firstLaunchOfTest = new Map<string, number>()

/** Marks the start of the test's clock at its first launchApp. */
export function startTestClock(): void {
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
 * the window and its web contents, a capturePage() PNG, the page's document.readyState, whether and
 * when (from `launchedAtMs`) the app said it showed the window, the app's output and the files of
 * logs/ in its data folder. Runs before the app is killed and its data
 * folder removed. Every step is bounded, and all of them together keep to diagnosisBudget: what
 * the test has left before its timeout, less the time the kill and the cleanup after it need, so
 * the test timeout never cuts the cleanup off. With no time left nothing is asked.
 * Inside a test the files go to `<test output>/start-diagnostics-…/` and are attached; the returned
 * line sums them up for the error message, which the gate log keeps.
 */
export async function startDiagnostics(
  app: ElectronApplication,
  dataDir: string,
  output: () => string,
  start: { launchedAtMs: number; appShow: AppShow | null },
): Promise<string> {
  const budget = diagnosisBudget(testTimeLeft())
  const left = deadline(budget)
  const state = await step(
    () =>
      app.evaluate(({ app: electronApp, BrowserWindow, powerMonitor }): WindowState => {
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
          isFocused: first.isFocused(),
          // macOS only; elsewhere the method is missing.
          ...(typeof electronApp.isHidden === 'function' ? { appHidden: electronApp.isHidden() } : {}),
          idleState: powerMonitor.getSystemIdleState(60),
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
  const appShow = start.appShow === null ? null : { path: start.appShow.path, afterLaunchMs: start.appShow.atMs - start.launchedAtMs }
  const report = {
    budgetMs: budget,
    state,
    readyState,
    capture: 'value' in capture ? (capture.value ? 'saved' : 'empty') : capture,
    appShow,
    shownLine: shownLine(appOutput),
  }
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
  return diagnosisSummary(state, readyState, appShowSummary(start.appShow, start.launchedAtMs), where)
}
