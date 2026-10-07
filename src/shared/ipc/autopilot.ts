// The `autopilot` domain (worfy-daily ticket 04, ADR-0024): Autopilot over one Epic of a Project —
// start, stop, and the state of the run, sent to every window whenever it changes. Run by
// src/main/autopilot/run.ts, handled in src/main/ipc/autopilot.ts (ADR-0006).
import { z } from 'zod'
import { AUTOPILOT_STOP_REASONS } from '../autopilot/cycle'
import { epicNameSchema } from '../binding/resolve'
import { eventChannel, invokeChannel } from './channels'

const projectId = z.string().min(1)

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
   * After a Stop by the user (`user-stop`, worfy-week ticket 17): the Ticket numbers of the Wave it
   * interrupted, for `epic`. A new run of that Epic takes those still in work into its first Wave,
   * also when nothing else is ready; the button and main filter them by the Tickets they read.
   * Empty while running and after any other stop.
   */
  resumable: z.array(z.number().int().positive()),
  revision: z.number().int().nonnegative(),
})
export type AutopilotState = z.infer<typeof autopilotStateSchema>

/**
 * Starts Autopilot over the Epic: the Orchestrator goes unattended, keep-awake is held, and the
 * ready Wave is sent. Refused while the Project has a run, while the Orchestrator is in a turn, and
 * on worfy's own repository in a development build.
 */
export const autopilotStart = invokeChannel('autopilot.start', z.object({ projectId, epic: epicNameSchema }), autopilotStateSchema)

/**
 * Stops the Project's run (`user-stop`): interrupts the Orchestrator's turn and its background
 * tasks and gives the Orchestrator back (worfy-week ticket 17, ADR-0050). Answers its state once it
 * has stopped — up to HALT_TURN_MS (src/main/agent/session.ts) after the click.
 */
export const autopilotStop = invokeChannel('autopilot.stop', z.object({ projectId }), autopilotStateSchema)

/** The Project's run as it is now. */
export const autopilotState = invokeChannel('autopilot.state', z.object({ projectId }), autopilotStateSchema)

/** Sent to every window whenever a Project's run changes. */
export const autopilotChanged = eventChannel('autopilot.changed', autopilotStateSchema)

export interface StatusLineOptions {
  /** IANA time zone of the times shown; the system's when omitted. Tests pass a fixed one. */
  timeZone?: string
}

/**
 * The status line of the Epic's Autopilot action: `Wave 3 · running`, `Wave 3 · 4 background
 * tasks` (ADR-0029), `waiting for limits · resumes 14:20`, `stopped: no ready wave`.
 */
export function autopilotStatusLine(
  state: Pick<AutopilotState, 'status' | 'wave' | 'reason'> & Partial<Pick<AutopilotState, 'resumesAt' | 'backgroundTasks'>>,
  options: StatusLineOptions = {},
): string | null {
  if (state.status === 'running') {
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

declare module './channels' {
  interface IpcContract {
    'autopilot.start': typeof autopilotStart
    'autopilot.stop': typeof autopilotStop
    'autopilot.state': typeof autopilotState
    'autopilot.changed': typeof autopilotChanged
  }
}
