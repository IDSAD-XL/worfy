// The pure parts of the diagnosis of a start whose first window was not shown (startDiagnostics in
// helpers.ts): the time bound of each step, the budget the test's own timeout leaves, the tail of
// the app's output and the line that sums it all up. No Electron and no Playwright here, so
// test/unit/start-diagnosis.test.ts checks them without starting an app.

/** How long each step that asks the app may take: the app may be hung, and the diagnosis must not hang with it. */
export const DIAGNOSTIC_STEP_MS = 3_000
/** How long saving and attaching the files may take. */
export const DIAGNOSTIC_SAVE_MS = 10_000
/** The longest whole diagnosis: three steps that ask the app, then saving the files. */
export const DIAGNOSIS_MAX_MS = 3 * DIAGNOSTIC_STEP_MS + DIAGNOSTIC_SAVE_MS
/**
 * What the diagnosis leaves of the test's time for the kill and the removal of the temporary
 * folders after it, about 14.5 s at worst. On Windows endApp (end-app.ts) waits up to 10 s
 * (GONE_TIMEOUT_MS) for the app's own process to exit after SIGKILL, then three folders are removed
 * one after another (cleanDirs in helpers.ts), each with up to 5 retries 100, 200 … 500 ms apart:
 * about 1.5 s per folder, 4.5 s in all (removeDir in helpers.ts). An app that never reported its
 * PID costs up to 5 s instead (PID_TIMEOUT_MS in helpers.ts) and skips that 10 s wait.
 */
export const CLEANUP_MARGIN_MS = 15_000
/** How much of the app's output (stdout and stderr together) a launch keeps for a diagnosis: the last 256 KB. */
export const OUTPUT_LIMIT = 256 * 1024
/** The problem of a step that did not run because the budget was spent. */
export const NO_TIME_LEFT = 'skipped: no time left before the test timeout'

/** A step's value, or what went wrong: an error, no answer in time, or no time to run at all. */
export type StepResult<T> = { value: T } | { problem: string }

/** Keeps the last `limit` characters of everything appended. */
export function outputTail(limit: number = OUTPUT_LIMIT): { append: (data: Buffer | string) => void; text: () => string } {
  let text = ''
  return {
    append: (data) => {
      text += String(data)
      if (text.length > limit) text = text.slice(-limit)
    },
    text: () => text,
  }
}

/**
 * Runs `work` and gives up waiting after `ms`; a step given no time (`ms` ≤ 0) does not run at all.
 * The work given up on is not stopped: the app is killed right after the diagnosis anyway.
 */
export async function step<T>(work: () => Promise<T>, ms: number): Promise<StepResult<T>> {
  if (ms <= 0) return { problem: NO_TIME_LEFT }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<StepResult<T>>((done) => {
    timer = setTimeout(() => done({ problem: `no answer within ${ms} ms` }), ms)
    timer.unref?.()
  })
  const settled = Promise.resolve()
    .then(work)
    .then(
      (value): StepResult<T> => ({ value }),
      (error: unknown): StepResult<T> => ({ problem: error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error) }),
    )
  try {
    return await Promise.race([settled, late])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The whole time the diagnosis may take: DIAGNOSIS_MAX_MS, cut to what the test has left before
 * its timeout less CLEANUP_MARGIN_MS, and 0 when that is nothing. `testLeftMs` undefined: no
 * timeout to keep to (no running test, or a test with timeout 0).
 */
export function diagnosisBudget(testLeftMs: number | undefined, margin: number = CLEANUP_MARGIN_MS): number {
  if (testLeftMs === undefined) return DIAGNOSIS_MAX_MS
  return Math.max(0, Math.min(DIAGNOSIS_MAX_MS, testLeftMs - margin))
}

/**
 * The clock of a running test, read when the diagnosis sizes its budget: the first call for `key`
 * (test id and retry) records `now` as the start in `starts`; every call returns what is left of
 * `timeoutMs` since that start, and 0 once the timeout has passed. A retry has its own key, so its
 * clock starts fresh.
 */
export function timeLeftOnClock(starts: Map<string, number>, key: string, timeoutMs: number, now: number): number {
  const start = starts.get(key) ?? now
  if (!starts.has(key)) starts.set(key, now)
  return Math.max(0, timeoutMs - (now - start))
}

/** Hands out a budget of `totalMs` from now: each call gets what it asks for, or what is left of the budget. */
export function deadline(totalMs: number, now: () => number = Date.now): (wantedMs: number) => number {
  const end = now() + totalMs
  return (wantedMs) => Math.max(0, Math.min(wantedMs, end - now()))
}

/** What main says about its first window and the window's web contents. */
export interface WindowState {
  windows: number
  isVisible?: boolean
  isMinimized?: boolean
  opacity?: number
  bounds?: { x: number; y: number; width: number; height: number }
  isLoading?: boolean
  isLoadingMainFrame?: boolean
  isWaitingForResponse?: boolean
  isCrashed?: boolean
  url?: string
  /** Signs of a window hidden behind something, as main can read them cheaply (it has no occlusion state). */
  isFocused?: boolean
  /** app.isHidden(), macOS only. */
  appHidden?: boolean
  /** powerMonitor.getSystemIdleState(): 'locked' while the screen is locked, which hides every window. */
  idleState?: string
}

/** How the app says it showed its window (src/main/window-show.ts). */
export type AppShowPath = 'ready-to-show' | 'fallback'

/** The app's line that it showed the window: the path, and when the test process read the line (Date.now()). */
export interface AppShow {
  path: AppShowPath
  atMs: number
}

/** The path a line of the app's output names, or null for any other line. */
export function appShowPathOf(line: string): AppShowPath | null {
  if (line.includes('[worfy] the window was shown on ready-to-show')) return 'ready-to-show'
  if (line.includes('[worfy] the window was shown by the fallback')) return 'fallback'
  return null
}

/** How much of a line without its newline yet the watcher keeps: the line it looks for is under 120 characters. */
export const PARTIAL_LINE_LIMIT = 4_096

/**
 * Reads the app's output chunk by chunk for the first line that says the window was shown: a line
 * split across chunks is joined first, and `now` is read when the line is complete. Diagnosis
 * only: the line comes right after show(), before macOS reports the window visible, so launchApp
 * does not take it as the window being on screen.
 */
export function appShowWatcher(now: () => number = Date.now): { append: (data: Buffer | string) => void; shown: () => AppShow | null } {
  let partial = ''
  let shown: AppShow | null = null
  return {
    append: (data) => {
      if (shown !== null) return
      const lines = (partial + String(data)).split('\n')
      partial = (lines.pop() ?? '').slice(-PARTIAL_LINE_LIMIT)
      for (const line of lines) {
        const path = appShowPathOf(line)
        if (path === null) continue
        shown = { path, atMs: now() }
        return
      }
    },
    shown: () => shown,
  }
}

/** Whether and when, from the launch, the app said it showed the window: the summary's part on the app's own show. */
export function appShowSummary(shown: AppShow | null, launchedAtMs: number): string {
  if (shown === null) return 'the app did not say it showed the window'
  const after = ((shown.atMs - launchedAtMs) / 1000).toFixed(2)
  return `the app showed the window ${shown.path === 'ready-to-show' ? 'on ready-to-show' : 'by the fallback'} ${after} s after launch`
}

/** The last line of the app's output that names how the window was shown (src/main/window-show.ts). */
export function shownLine(output: string): string {
  return output.split('\n').findLast((line) => line.includes('[worfy] the window was shown')) ?? 'no line of the app says the window was shown'
}

/**
 * The one line the error message gets: the window, the page's readyState, `shown` (whether and when
 * the app showed the window, appShowSummary) and where the files went.
 */
export function diagnosisSummary(state: StepResult<WindowState>, readyState: StepResult<string>, shown: string, where: string): string {
  const window = 'value' in state ? state.value : undefined
  const head =
    window === undefined
      ? `window: (${'problem' in state ? state.problem : ''})`
      : window.windows === 0
        ? 'window: none'
        : `window: visible ${window.isVisible}, focused ${window.isFocused}, app hidden ${window.appHidden}, system ${window.idleState}, loading ${window.isLoading}, crashed ${window.isCrashed}, url ${window.url}`
  const ready = 'value' in readyState ? readyState.value : `(${readyState.problem})`
  return `${head}, document.readyState ${ready}; ${shown}${where}`
}
