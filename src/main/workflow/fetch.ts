// The periodic `git fetch` that keeps the Project's main branch current (ADR-0107; worfy-polish ticket 118).
//
// worfy reads the workflow from `refs/remotes/origin/<main>` (main-ref.ts), so that ref is fetched while a window of
// the app shows the Project (WorkflowHub in watch.ts): when the window opens it, every 2 minutes while one shows it,
// and when a window of the app gets the focus, no more than once in 30 s. A Project only Autopilot or the notices
// follow is not fetched. One fetch at a time. A fetch that fails never breaks a read: the list stays at the commit last fetched, and
// after 10 minutes of failures the window says so (main-ref.ts, sourceView).
//
// The fetch is `git fetch --prune origin <main>` in the Project root, with the login shell's environment (the one the
// Harness scripts get: the user's ssh agent and credential helpers), a timeout, and no automatic maintenance. Nothing
// may ask the user anything: no terminal prompt, no credential helper's window (Git Credential Manager), no ssh
// passphrase or host-key question — a fetch that would need one fails, and the list says so after 10 minutes. It writes only what any fetch writes: objects and `refs/remotes/origin/<main>`. It touches no working
// tree, index, HEAD or local branch, and it writes no FETCH_HEAD (ADR-0107 on ADR-0005).
import { execFile } from 'node:child_process'
import { posix, win32 } from 'node:path'
import type { HarnessScriptEnvSource } from '../harness/script-env'
import { gitEnv } from './main-ref'

/** How often the main branch is fetched while the Project is watched. */
export const FETCH_EVERY_MS = 2 * 60_000
/** The least time between the start of a fetch and a fetch that a window's focus asks for. */
export const FETCH_FOCUS_MIN_MS = 30_000
/** How long one fetch may run. */
export const FETCH_TIMEOUT_MS = 60_000

/** What the periodic fetch knows: the last one that worked, and since when it fails (main-ref.ts, sourceView). */
export interface FetchStatus {
  /** When the last fetch that worked ended, in ms; null before one has. */
  lastOk: number | null
  /** When the fetches began to fail, in ms; null while the last one worked or none ended yet. */
  failingSince: number | null
  /** The first line of the last failure; null when the last fetch worked. */
  error: string | null
}

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

/** The settings of one fetch: no automatic maintenance, no credential helper that opens a window. */
export const FETCH_CONFIG = ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'credential.interactive=false'] as const

/**
 * The environment of a fetch: `gitEnv`, Git Credential Manager told never to ask, and ssh in batch mode — no passphrase,
 * password or host-key question. The ssh command is the one git would run (`GIT_SSH_COMMAND`, else `core.sshCommand`
 * as `sshCommand` gives it, else `ssh`) with `-o BatchMode=yes` added. A program in `GIT_SSH` alone (PuTTY's plink, say)
 * takes no ssh options and is left as it is.
 */
export function fetchEnv(env: Readonly<Record<string, string | undefined>>, sshCommand: string | null): Record<string, string | undefined> {
  const base = gitEnv(env)
  const command = nonEmpty(env.GIT_SSH_COMMAND) ?? nonEmpty(sshCommand) ?? (nonEmpty(env.GIT_SSH) === null ? 'ssh' : null)
  return { ...base, GCM_INTERACTIVE: 'never', ...(command === null ? {} : { GIT_SSH_COMMAND: `${command} -o BatchMode=yes` }) }
}

function nonEmpty(value: string | undefined | null): string | null {
  return value === undefined || value === null || value.trim() === '' ? null : value.trim()
}

/** The URL of `origin` and `core.sshCommand` of the repository at `root`, from one `git config`; null for what is not set. */
function remoteOf(root: string, env: Record<string, string | undefined>, signal: AbortSignal): Promise<{ url: string | null; sshCommand: string | null }> {
  return new Promise((resolvePromise) => {
    execFile(
      'git',
      ['config', '--get-regexp', '^(remote\\.origin\\.url|core\\.sshcommand)$'],
      { cwd: root, env, timeout: 10_000, signal, encoding: 'utf8', windowsHide: true },
      (error, stdout) => {
        const value = (key: string): string | null => {
          const line = error ? undefined : stdout.split(/\r?\n/u).find((each) => each.toLowerCase().startsWith(`${key} `))
          return line === undefined ? null : nonEmpty(line.slice(key.length + 1))
        }
        resolvePromise({ url: value('remote.origin.url'), sshCommand: value('core.sshcommand') })
      },
    )
  })
}

/** Whether a remote URL names a repository on the disk: a path, absolute or relative, or a `file://` URL. */
export function isLocalRemote(url: string): boolean {
  if (/^file:\/\//iu.test(url)) return true
  if (posix.isAbsolute(url) || win32.isAbsolute(url)) return true
  // `scheme://…` and ssh's `host:path` are on another machine.
  return !/^[a-z][\w+.-]*:\/\//iu.test(url) && !/^[^/\\]+:/u.test(url)
}

/**
 * Called with the remote's URL before each fetch; a throw refuses the fetch. None in the app. The test setup
 * (test/setup-no-remote-fetch.ts) sets one that refuses every remote not on the disk, and fails the test that ran it.
 */
type FetchGuard = (root: string, url: string | null) => void
let guard: FetchGuard | null = null

/** Sets the guard of every fetch (see FetchGuard); answers the one it replaces. */
export function setFetchGuard(next: FetchGuard | null): FetchGuard | null {
  const previous = guard
  guard = next
  return previous
}

/** The real fetch: git with the scripts' environment (`env`, the login shell's), nothing interactive, a timeout. */
export function gitFetch(env: HarnessScriptEnvSource, timeoutMs: number = FETCH_TIMEOUT_MS): FetchRunner {
  return async (root, branch, signal) => {
    const base = await env()
    // A branch name is passed to git only when it reads as one: never an option, never a refspec.
    if (!/^[\w.][\w./-]*$/u.test(branch) || branch.includes('..')) throw new Error(`not a branch name: ${JSON.stringify(branch)}`)
    const remote = await remoteOf(root, gitEnv(base), signal)
    guard?.(root, remote.url)
    const sshCommand = nonEmpty(base.GIT_SSH_COMMAND) === null ? remote.sshCommand : null
    await new Promise<void>((resolvePromise, reject) => {
      execFile(
        'git',
        [...FETCH_CONFIG, 'fetch', '--quiet', '--prune', '--no-write-fetch-head', 'origin', branch],
        { cwd: root, env: fetchEnv(base, sshCommand), timeout: timeoutMs, signal, encoding: 'utf8', windowsHide: true },
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
