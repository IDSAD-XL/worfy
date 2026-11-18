// The `quitGrace` domain (worfy-continuity ticket 04): the window «Quitting worfy». When worfy quits, restarts for
// an Update or the system shuts down, the quit's coordinator (src/main/quit-grace.ts) waits up to 60 s for the
// external calls of the Sessions that have no result yet (`git push`, `gh pr merge`); while it waits, every window
// shows them with the time left and Quit now. The channels are `local`: the quit is this Machine's.
import { z } from 'zod'
import { eventChannel, invokeChannel } from './channels'

/** Longest list of calls the window gets: the rest are counted, not named. */
export const QUIT_GRACE_CALLS_MAX = 20

export const quitGraceViewSchema = z
  .object({
    /** `waiting`: for the calls below, Quit now cuts the wait; `stopping`: the wait is over, the agents are being stopped. */
    stage: z.enum(['waiting', 'stopping']),
    /** The calls without a result, at most QUIT_GRACE_CALLS_MAX: the call's id and what it does, in short. */
    calls: z.array(z.object({ id: z.string().min(1), description: z.string() })).max(QUIT_GRACE_CALLS_MAX),
    /** How many calls are without a result in all, those named included. */
    total: z.number().int().nonnegative(),
    /** How long the wait may still last, in ms, as of the moment main sent the view. */
    leftMs: z.number().int().nonnegative(),
  })
  .nullable()
/** What the window shows; null: no window (no quit, or a quit without external calls). */
export type QuitGraceView = z.infer<typeof quitGraceViewSchema>

/** The view now: a window loaded during the wait shows it too. */
export const quitGraceState = invokeChannel('quitGrace.state', z.void(), quitGraceViewSchema, 'local')

/** Quit now: the wait ends at once, and the quit goes on to stop the agents. */
export const quitGraceQuitNow = invokeChannel('quitGrace.quitNow', z.void(), z.void(), 'local')

/** The whole view after a change; null when the window closes. */
export const quitGraceChanged = eventChannel('quitGrace.changed', quitGraceViewSchema, 'local')

declare module './channels' {
  interface IpcContract {
    'quitGrace.state': typeof quitGraceState
    'quitGrace.quitNow': typeof quitGraceQuitNow
    'quitGrace.changed': typeof quitGraceChanged
  }
}
