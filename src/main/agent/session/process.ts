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

/** Settles once `process` has exited; at once for one that already has. */
export const exitOf = (child: ClaudeCodeProcess): Promise<void> =>
  new Promise((done) => {
    if (hasExited(child)) done()
    else child.once('exit', () => done())
  })

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
