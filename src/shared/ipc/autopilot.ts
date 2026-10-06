// The `autopilot` domain (worfy-daily ticket 04, ADR-0024): Autopilot over one Epic of a Project —
// start, stop, and the state of the run, sent to every window whenever it changes. Run by
// src/main/autopilot/run.ts, handled in src/main/ipc/autopilot.ts (ADR-0006).
import { z } from 'zod'
import { AUTOPILOT_STOP_REASONS } from '../autopilot/cycle'
import { epicNameSchema } from '../binding/resolve'
import { eventChannel, invokeChannel } from './channels'

const projectId = z.string().min(1)

/**
 * The Project's run: `running`, or `stopped` with the reason of the last run (null before any).
 * `wave` counts the Waves the run has sent, from 1. `message` is what went wrong, in words, when a
 * Session failed or a Wave could not be sent. `revision` grows with every change of any Project; a
 * client keeps the state with the highest one.
 */
export const autopilotStateSchema = z.object({
  projectId,
  epic: epicNameSchema.nullable(),
  status: z.enum(['running', 'stopped']),
  wave: z.number().int().nonnegative(),
  reason: z.enum(AUTOPILOT_STOP_REASONS).nullable(),
  message: z.string().nullable(),
  revision: z.number().int().nonnegative(),
})
export type AutopilotState = z.infer<typeof autopilotStateSchema>

/**
 * Starts Autopilot over the Epic: the Orchestrator goes unattended, keep-awake is held, and the
 * ready Wave is sent. Refused while the Project has a run, while the Orchestrator is in a turn, and
 * on worfy's own repository in a development build.
 */
export const autopilotStart = invokeChannel('autopilot.start', z.object({ projectId, epic: epicNameSchema }), autopilotStateSchema)

/** Stops the Project's run (`user-stop`); answers its state once it has stopped. */
export const autopilotStop = invokeChannel('autopilot.stop', z.object({ projectId }), autopilotStateSchema)

/** The Project's run as it is now. */
export const autopilotState = invokeChannel('autopilot.state', z.object({ projectId }), autopilotStateSchema)

/** Sent to every window whenever a Project's run changes. */
export const autopilotChanged = eventChannel('autopilot.changed', autopilotStateSchema)

/** The status line of the Epic's Autopilot action: `Wave 3 · running`, `stopped: no ready wave`. */
export function autopilotStatusLine(state: Pick<AutopilotState, 'status' | 'wave' | 'reason'>): string | null {
  if (state.status === 'running') return state.wave === 0 ? 'starting' : `Wave ${state.wave} · running`
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
