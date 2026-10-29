import { execFile, type ChildProcess } from 'node:child_process'
import { ms } from '../time-scale'

/**
 * How long the app's own process may outlive the exit of the process Playwright started, once both
 * were sent SIGKILL. A killed process is gone within milliseconds; one still there after this has
 * survived the kill.
 */
const GONE_TIMEOUT_MS = ms(10_000)

/** Resolves once `child` has exited; at once when it already has. */
export function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((done) => child.once('exit', () => done()))
}

/** Whether a process with this PID runs (EPERM: it runs under another user, so it exists). */
export function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** `taskkill /T /F`: ends the process and every process it started, as Playwright's own kill does on Windows. */
function taskkillTree(pid: number): Promise<void> {
  return new Promise((done) => execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => done()))
}

export interface EndAppOptions {
  /** The platform whose way of killing applies; the running one by default. */
  platform?: NodeJS.Platform
  /** Ends a process and its descendants; taskkill /T /F by default. Used on Windows only. */
  killTree?: (pid: number) => Promise<void>
  /** How long the app's process may outlive the exit of `child`; GONE_TIMEOUT_MS by default. */
  goneTimeoutMs?: number
}

/**
 * Ends the app with SIGKILL and waits until it is gone.
 *
 * `child` is the process Playwright started, `appPid` the PID the app's main process reported
 * itself (undefined when it never answered). On macOS and Linux they are one process. On Windows
 * Playwright starts Electron through a shell, so `child` is cmd.exe and the app is its child:
 * killing `child` alone left the app running and holding its data directory. So the app's own PID
 * is killed first, then `child`. Without that PID, on Windows the whole tree under `child` is
 * killed instead; elsewhere `child` is the app.
 *
 * Rejects when the app's process still runs after `child` has exited and `goneTimeoutMs` more.
 */
export async function endApp(child: ChildProcess, appPid: number | undefined, options: EndAppOptions = {}): Promise<void> {
  const { platform = process.platform, killTree = taskkillTree, goneTimeoutMs = GONE_TIMEOUT_MS } = options
  const gone = exited(child)
  if (appPid !== undefined) {
    try {
      process.kill(appPid, 'SIGKILL')
    } catch {
      // Gone already.
    }
  } else if (platform === 'win32' && child.pid !== undefined) {
    await killTree(child.pid)
  }
  child.kill('SIGKILL')
  await gone
  if (appPid === undefined || appPid === child.pid) return
  const deadline = Date.now() + goneTimeoutMs
  while (running(appPid)) {
    if (Date.now() > deadline) throw new Error(`the app's process ${appPid} still runs ${goneTimeoutMs / 1000} s after SIGKILL`)
    await new Promise((done) => setTimeout(done, 50))
  }
}

/**
 * Runs `kill`, then `clean` whether or not the kill failed, so a kill that throws does not leave
 * the temporary directories behind. Resolves with the kill's failure (undefined when it succeeded)
 * for the caller to report next to its own error; rejects only when `clean` does.
 */
export async function killThenClean(kill: () => Promise<void>, clean: () => Promise<void>): Promise<unknown> {
  let failure: unknown
  try {
    await kill()
  } catch (error) {
    failure = error ?? new Error('the kill failed')
  }
  await clean()
  return failure
}
