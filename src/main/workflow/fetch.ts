// The periodic `git fetch` that keeps the Project's main branch current (ADR-0107; worfy-polish ticket 118).
//
// worfy reads the workflow from `refs/remotes/origin/<main>` (main-ref.ts), so that ref is fetched: when the watch of
// the Project starts, every 2 minutes while it runs, and when a window of the app gets the focus, no more than once in
// 30 s. One fetch at a time. A fetch that fails never breaks a read: the list stays at the commit last fetched, and
// after 10 minutes of failures the window says so (main-ref.ts, sourceView).
//
// The fetch is `git fetch --prune origin <main>` in the Project root, with the login shell's environment (the one the
// Harness scripts get: the user's ssh agent and credential helpers), no password prompt, a timeout, and no automatic
// maintenance. It writes only what any fetch writes: objects and `refs/remotes/origin/<main>`. It touches no working
// tree, index, HEAD or local branch, and it writes no FETCH_HEAD (ADR-0107 on ADR-0005).
import { execFile } from 'node:child_process'
import type { HarnessScriptEnvSource } from '../harness/script-env'
import { gitEnv, type FetchStatus } from './main-ref'

/** How often the main branch is fetched while the Project is watched. */
export const FETCH_EVERY_MS = 2 * 60_000
/** The least time between the start of a fetch and a fetch that a window's focus asks for. */
export const FETCH_FOCUS_MIN_MS = 30_000
/** How long one fetch may run. */
export const FETCH_TIMEOUT_MS = 60_000

/** Fetches `branch` of `origin` in the repository at `root`; rejects with the reason when it fails. Tests replace it. */
export type FetchRunner = (root: string, branch: string, signal: AbortSignal) => Promise<void>

/** The first line git wrote to stderr that says something, or the error's message. */
function failureLine(stderr: string, error: Error & { killed?: boolean }): string {
  if (error.killed) return `git fetch did not end within ${FETCH_TIMEOUT_MS / 1000} s`
  const line = stderr
    .split(/\r?\n/u)
    .map((each) => each.trim())
    .find((each) => each !== '')
  return line ?? error.message
}

/** The real fetch: git with the scripts' environment (`env`, the login shell's), no prompt, a timeout. */
export function gitFetch(env: HarnessScriptEnvSource, timeoutMs: number = FETCH_TIMEOUT_MS): FetchRunner {
  return async (root, branch, signal) => {
    const base = await env()
    // A branch name is passed to git only when it reads as one: never an option, never a refspec.
    if (!/^[\w.][\w./-]*$/u.test(branch) || branch.includes('..')) throw new Error(`not a branch name: ${JSON.stringify(branch)}`)
    await new Promise<void>((resolvePromise, reject) => {
      execFile(
        'git',
        ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'fetch', '--quiet', '--prune', '--no-write-fetch-head', 'origin', branch],
        { cwd: root, env: gitEnv(base), timeout: timeoutMs, signal, encoding: 'utf8', windowsHide: true },
        (error, _stdout, stderr) => (error ? reject(new Error(failureLine(stderr, error))) : resolvePromise()),
      )
    })
  }
}

export interface FetchScheduleOptions {
  /** One fetch; the signal stops it at `close`. */
  fetch: (signal: AbortSignal) => Promise<void>
  /** Called after each fetch ends, with the status then. */
  onDone: (status: FetchStatus) => void
  everyMs?: number
  focusMinMs?: number
  now?: () => number
}

/**
 * When the fetches run: at `start`, every `everyMs` after that, and at `focus` when the last one began at least
 * `focusMinMs` ago. One at a time: an ask while one runs is dropped. Timers are the global ones, so fake timers
 * drive it in tests. `close` stops the timer and the fetch that runs, and resolves once it has ended.
 */
export class FetchSchedule {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private readonly abort = new AbortController()
  private lastStart: number | null = null
  private closed = false
  private readonly state: FetchStatus = { lastOk: null, failingSince: null, error: null }

  constructor(private readonly options: FetchScheduleOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  /** What the fetches so far say. */
  get status(): FetchStatus {
    return { ...this.state }
  }

  /** Fetches now and every `everyMs` after that. Calling it again does nothing. */
  start(): void {
    if (this.closed || this.lastStart !== null || this.running) return
    this.run()
  }

  /** A window got the focus: fetches now unless one runs or began less than `focusMinMs` ago. */
  focus(): void {
    if (this.closed || this.running) return
    if (this.lastStart !== null && this.now() - this.lastStart < (this.options.focusMinMs ?? FETCH_FOCUS_MIN_MS)) return
    this.run()
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.abort.abort()
    await this.running
  }

  private run(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.lastStart = this.now()
    this.running = this.options
      .fetch(this.abort.signal)
      .then(
        () => {
          this.state.lastOk = this.now()
          this.state.failingSince = null
          this.state.error = null
        },
        (error: unknown) => {
          this.state.failingSince ??= this.lastStart
          this.state.error = error instanceof Error ? error.message : String(error)
        },
      )
      .then(() => {
        this.running = null
        if (this.closed) return
        this.schedule()
        try {
          this.options.onDone(this.status)
        } catch (error) {
          console.error('[workflow] after a fetch', error)
        }
      })
  }

  private schedule(): void {
    if (this.closed) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.running) this.run()
    }, this.options.everyMs ?? FETCH_EVERY_MS)
    this.timer.unref?.()
  }
}
