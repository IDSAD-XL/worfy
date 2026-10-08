// The `autopilot` domain (worfy-daily ticket 04, ADR-0024): Autopilot over one Epic of a Project —
// start, stop, and the state of the run, sent to every window whenever it changes. Run by
// src/main/autopilot/run.ts, handled in src/main/ipc/autopilot.ts (ADR-0006).
import { z } from 'zod'
import { AUTOPILOT_STOP_REASONS } from '../autopilot/cycle'
import { epicNameSchema } from '../binding/resolve'
import { eventChannel, invokeChannel } from './channels'

const projectId = z.string().min(1)

/**
 * The Harness in the main branch of worfy's own repository has changes in harness/ that this
 * build's Harness copy has not (worfy-harness ticket 21, ADR-0047): the Stable copy is due a
 * rebuild, `pnpm install:stable` between runs. `harness` is the build version (`<semver>+<SHA>`),
 * `main` the ref it was compared with (`origin/main`, or `main` without one), `commits` how many
 * commits of `main` change harness/ after the build commit.
 */
export const harnessBehindSchema = z.object({ harness: z.string().min(1), main: z.string().min(1), commits: z.number().int().positive() })
export type HarnessBehind = z.infer<typeof harnessBehindSchema>

/**
 * The Project's run: `running`; `waiting` for the Limits to reset (worfy-daily ticket 05), until
 * `resumesAt`; or `stopped` with the reason of the last run (null before any). `wave` counts the
 * Waves the run has sent, from 1. `message` is what went wrong, in words, when a Session failed, a
 * Wave could not be sent or the wait for the Limits was given up. `revision` grows with every change
 * of any Project; a client keeps the state with the highest one.
 */
export const autopilotStateSchema = z.object({
  projectId,
  epic: epicNameSchema.nullable(),
  status: z.enum(['running', 'waiting', 'stopped']),
  wave: z.number().int().nonnegative(),
  /**
   * The live background tasks of the run's Orchestrator Session (ADR-0029), ambient ones left out;
   * 0 when the run is stopped.
   */
  backgroundTasks: z.number().int().nonnegative(),
  /** While `waiting`: when the run sends the Orchestrator on, in milliseconds since the epoch; else null. */
  resumesAt: z.number().int().nonnegative().nullable(),
  reason: z.enum(AUTOPILOT_STOP_REASONS).nullable(),
  message: z.string().nullable(),
  /**
   * After a Force stop (`user-force-stop`, worfy-week tickets 17, 18): the Ticket numbers of the
   * Wave it interrupted, for `epic`. A new run of that Epic takes those still in work into its first
   * Wave, also when nothing else is ready; the button and main filter them by the Tickets they read.
   * Empty while running and after any other stop, the graceful Stop (`user-stop`) included.
   */
  resumable: z.array(z.number().int().positive()),
  /**
   * A graceful Stop came (worfy-week ticket 18): the run takes no new Ticket and ends once the
   * Orchestrator's turn and background tasks are over. A flag over `running` and `waiting`; false
   * once stopped.
   */
  stopping: z.boolean(),
  /** While `stopping`: how many Tickets of the current Wave are in work; 0 otherwise. */
  ticketsInWork: z.number().int().nonnegative(),
  /**
   * The Harness in worfy's main is newer than this build's (packaged builds over worfy's own
   * repository only, src/main/autopilot/harness-drift.ts); null otherwise, and when it cannot be
   * told. Kept whether a run goes on or not.
   */
  harnessBehind: harnessBehindSchema.nullable(),
  revision: z.number().int().nonnegative(),
})
export type AutopilotState = z.infer<typeof autopilotStateSchema>

/**
 * Starts Autopilot over the Epic: the Orchestrator goes unattended, keep-awake is held, and the
 * ready Wave is sent. Refused while the Project has a run, while the Orchestrator is in a turn, and
 * on worfy's own repository in a development build.
 */
export const autopilotStart = invokeChannel('autopilot.start', z.object({ projectId, epic: epicNameSchema }), autopilotStateSchema, 'project')

/**
 * Stops the Project's run gracefully (`user-stop`, worfy-week ticket 18, ADR-0051): no new Ticket,
 * the Orchestrator is told so, and the Tickets in work finish. Answers as soon as the run is
 * `stopping` or already stopped, not at its end; again while stopping, it only answers the state.
 */
export const autopilotStop = invokeChannel('autopilot.stop', z.object({ projectId }), autopilotStateSchema, 'project')

/**
 * Force stop (`user-force-stop`): interrupts the Orchestrator's turn and its background tasks and
 * gives the Orchestrator back (worfy-week ticket 17, ADR-0050), also while a graceful Stop goes on.
 * Answers its state once it has stopped — up to HALT_TURN_MS (src/main/agent/session.ts) after the
 * click.
 */
export const autopilotForceStop = invokeChannel('autopilot.forceStop', z.object({ projectId }), autopilotStateSchema, 'project')

/** The Project's run as it is now. */
export const autopilotState = invokeChannel('autopilot.state', z.object({ projectId }), autopilotStateSchema, 'project')

/** Sent to every window whenever a Project's run changes. */
export const autopilotChanged = eventChannel('autopilot.changed', autopilotStateSchema, 'project')

export interface StatusLineOptions {
  /** IANA time zone of the times shown; the system's when omitted. Tests pass a fixed one. */
  timeZone?: string
}

/**
 * The status line of the Epic's Autopilot action: `Wave 3 · running`, `Wave 3 · 4 background
 * tasks` (ADR-0029), `stopping · 2 tickets in work` and `stopping` (a graceful Stop, worfy-week
 * ticket 18), `waiting for limits · resumes 14:20`, `stopped: no ready wave`, `stopped: user force
 * stop`.
 */
export function autopilotStatusLine(
  state: Pick<AutopilotState, 'status' | 'wave' | 'reason'> & Partial<Pick<AutopilotState, 'resumesAt' | 'backgroundTasks' | 'stopping' | 'ticketsInWork'>>,
  options: StatusLineOptions = {},
): string | null {
  if (state.status === 'running') {
    if (state.stopping === true) {
      const inWork = state.ticketsInWork ?? 0
      return inWork > 0 ? `stopping · ${inWork} ${inWork === 1 ? 'ticket' : 'tickets'} in work` : 'stopping'
    }
    if (state.wave === 0) return 'starting'
    const tasks = state.backgroundTasks ?? 0
    if (tasks > 0) return `Wave ${state.wave} · ${tasks} background ${tasks === 1 ? 'task' : 'tasks'}`
    return `Wave ${state.wave} · running`
  }
  if (state.status === 'waiting') {
    if (state.resumesAt === null || state.resumesAt === undefined) return 'waiting for limits'
    const at = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: options.timeZone }).format(state.resumesAt)
    return `waiting for limits · resumes ${at}`
  }
  if (state.reason === null) return null
  return `stopped: ${state.reason.replaceAll('-', ' ')}`
}

/** The chip of the Autopilot action while the Harness in main is newer than this build's (worfy-harness ticket 21). */
export const HARNESS_BEHIND_LABEL = 'Harness in main is newer than the Stable copy'

/** The hint of that chip: how far behind, and how to catch up. */
export function harnessBehindTitle(behind: HarnessBehind): string {
  const commits = `${behind.commits} ${behind.commits === 1 ? 'commit' : 'commits'}`
  return `${behind.main} has ${commits} in harness/ that this build (${behind.harness}) has not. Rebuild the Stable copy with pnpm install:stable between runs`
}

declare module './channels' {
  interface IpcContract {
    'autopilot.start': typeof autopilotStart
    'autopilot.stop': typeof autopilotStop
    'autopilot.forceStop': typeof autopilotForceStop
    'autopilot.state': typeof autopilotState
    'autopilot.changed': typeof autopilotChanged
  }
}
