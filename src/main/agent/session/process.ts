// Waiting for a Session's Claude Code process to stop (session.ts, ADR-0064): the time limits and
// the helpers that wait for an exit.
import type { ClaudeCodeProcess } from './types'

/**
 * How long halt() waits for an interrupted turn to end. Past it the caller closes the process,
 * which ends the turn all the same (Orchestrators.giveBackNow).
 */
export const HALT_TURN_MS = 15_000

/**
 * How long exited() waits for a Claude Code process after the Session closed it, before it sends
 * SIGKILL (ADR-0064). The SDK's close() ends stdin, sends SIGTERM 2 s later and SIGKILL 5 s after
 * that (SDK 0.3.289): worfy's own SIGKILL comes after the SDK's, so the graceful path is not cut
 * short, and ends a process the SDK's did not.
 */
export const EXIT_WAIT_MS = 7_500

/** After SIGKILL: how long exited() still waits for the exit before it gives up on the process. */
export const KILL_EXIT_MS = 2_000

/** Whether a process has exited: by itself (an exit code) or by a signal. */
export const hasExited = (child: ClaudeCodeProcess): boolean => child.exitCode !== null || child.signalCode !== null

/** How often exitOf asks the system whether a process still runs, while it waits for its exit. */
const EXIT_POLL_MS = 50

interface Exit {
  readonly settled: Promise<void>
  /** Starts asking the system, once; nothing after the exit. */
  readonly poll: () => void
  /** Stops asking; a later poll() starts again. */
  readonly stop: () => void
}

const exits = new WeakMap<ClaudeCodeProcess, Exit>()

/**
 * Whether the system may still run a process with this pid: `kill(pid, 0)` sends nothing, it only
 * looks. Only ESRCH says that no process has it; any other failure (EPERM, or EINVAL, ENOSYS,
 * UNKNOWN of a failed OpenProcess on Windows) is taken for a running one.
 */
const running = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

function exitRecord(child: ClaudeCodeProcess): Exit {
  const known = exits.get(child)
  if (known !== undefined) return known
  let ended = hasExited(child)
  let timer: ReturnType<typeof setInterval> | undefined
  let done: () => void = () => undefined
  const settled = new Promise<void>((resolve) => {
    done = resolve
  })
  const exited = (): void => {
    ended = true
    clearInterval(timer)
    done()
  }
  if (ended) done()
  else child.once('exit', exited)
  const poll = (): void => {
    const pid = child.pid
    if (ended || timer !== undefined || pid === undefined) return
    timer = setInterval(() => {
      if (!running(pid)) exited()
    }, EXIT_POLL_MS)
    timer.unref()
  }
  const stop = (): void => {
    clearInterval(timer)
    timer = undefined
  }
  const record = { settled, poll, stop }
  exits.set(child, record)
  return record
}

/**
 * Settles once `child` has exited; at once for one that already has. A process has one such
 * promise, so whoever asks first hears of the exit first. It settles at Node's `exit` event, or
 * earlier while someone waits with waitForExit().
 */
export const exitOf = (child: ClaudeCodeProcess): Promise<void> => exitRecord(child).settled

/**
 * exitOf(), and until the exit it also asks the system every EXIT_POLL_MS whether the process still
 * runs. On Windows Node's `exit` event can come seconds after the system already reports an exit
 * code for the process: 20-40 ms after the kill against up to 1.7 s on the GitHub runner (CI run
 * 40651661632), more than 7 s in earlier runs. A pid already handed to another process only leaves
 * it waiting for the event, as before.
 */
export const waitForExit = (child: ClaudeCodeProcess): Promise<void> => {
  const record = exitRecord(child)
  record.poll()
  return record.settled
}

/** Ends the asking of waitForExit() for a process given up on; its exit event still settles exitOf(). */
export const stopWaiting = (child: ClaudeCodeProcess): void => exitRecord(child).stop()

/** Settles with true once `work` settles, or with false after `ms`, whichever comes first. */
export async function within(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<boolean>((done) => {
    timer = setTimeout(() => done(false), ms)
  })
  try {
    return await Promise.race([work.then(() => true), limit])
  } finally {
    clearTimeout(timer)
  }
}
