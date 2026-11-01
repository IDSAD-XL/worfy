// The `autopilot` domain (worfy-daily ticket 04, ADR-0024): Autopilot over one Epic of a Project —
// start, stop, and the state of the run, sent to every window whenever it changes. Run by
// src/main/autopilot/run.ts, handled in src/main/ipc/autopilot.ts (ADR-0006).
import { z } from 'zod'
import { AUTOPILOT_STOP_REASONS } from '../autopilot/cycle'
import { RUN_MODES, WINDOW_WAIT_REASONS } from '../autopilot/run-mode'
import { epicNameSchema, ticketNumSchema } from '../binding/resolve'
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
  /**
   * While `waiting`: what for. `limits` — a turn of the Wave was refused by the Limits (worfy-daily
   * ticket 05); `daily-share` — today's share of the budget is used, and the next Wave waits;
   * `five-hour` — today's share is left but the 5-hour window is full, and the next Wave waits for
   * its reset (worfy-throughput ticket 41, src/shared/autopilot/budget.ts); `start-window` — the
   * Run mode Start window holds the next Wave back until the window's next start, `windowReason`
   * says why (worfy-resource-planner ticket 05, src/shared/autopilot/run-mode.ts). Then `message`
   * says it in words. Absent otherwise, and in states of builds before ticket 41.
   */
  waitingFor: z.enum(['limits', 'daily-share', 'five-hour', 'start-window']).optional(),
  /** While `waitingFor` is `start-window`: `outside` the window, or the next Wave `wave-too-long` for it. Absent otherwise. */
  windowReason: z.enum(WINDOW_WAIT_REASONS).optional(),
  reason: z.enum(AUTOPILOT_STOP_REASONS).nullable(),
  message: z.string().nullable(),
  /**
   * After a Force stop (`user-force-stop`, worfy-week tickets 17, 18): the Ticket numbers of the
   * Wave it interrupted, for `epic`. A new run of that Epic takes those still in work into its first
   * Wave, also when nothing else is ready; the button and main filter them by the Tickets they read.
   * A run over named Tickets takes only those of its list and leaves the others here when it stops,
   * whatever its reason (worfy-flight-recorder ticket 21, ADR-0091). Empty while running and after any
   * other stop, the graceful Stop (`user-stop`) included.
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
  /**
   * While the run goes on: the Machine that runs it (worfy-link ticket 15), the one whose Project it
   * is; null when the link service does not run. Absent when no run goes on.
   */
  machine: z.object({ id: z.string().min(1), name: z.string().min(1) }).nullable().optional(),
  /**
   * While the run goes on: the Linked machines its start could not ask whether they run the same
   * Epic of the same repository (not connected, or no answer within 3 s). Absent when no run goes on.
   */
  unasked: z.array(z.string().min(1)).optional(),
  revision: z.number().int().nonnegative(),
})
export type AutopilotState = z.infer<typeof autopilotStateSchema>

/**
 * The Epic a run works on now: running or waiting for the Limits. A stopped run's state keeps its
 * Epic (the last run's snapshot), which is no run at work.
 */
export const autopilotEpicAtWork = (state: Pick<AutopilotState, 'epic' | 'status'>): string | null => (state.status === 'stopped' ? null : state.epic)

/**
 * A start refused because a run of the same Epic and origin goes on, or starts, on another Machine
 * (worfy-link ticket 15, ADR-0053, Q13): `machine` names it, `message` says it in words. Its own
 * field of the answer, not an error, so the button tells it from other refusals and offers "Start
 * anyway".
 */
export const runningElsewhereSchema = z.object({ epic: epicNameSchema, machine: z.string().min(1), message: z.string().min(1) })
export type RunningElsewhereRefusal = z.infer<typeof runningElsewhereSchema>

/** What `autopilot.start` answers: the run's first state, or the refusal for a run elsewhere. */
export const autopilotStartAnswerSchema = z.union([autopilotStateSchema, z.object({ runningElsewhere: runningElsewhereSchema })])
export type AutopilotStartAnswer = z.infer<typeof autopilotStartAnswerSchema>

/** The most Tickets one start may name: more than any Epic has. */
export const MAX_NAMED_TICKETS = 500

/**
 * Starts Autopilot over the Epic: the Orchestrator goes unattended, keep-awake is held, and the
 * ready Wave is sent. Refused while the Project has a run, while the Orchestrator is in a turn, and
 * on worfy's own repository in a development build. A run of the same Epic and origin on a Linked
 * machine (or in another Project of this Machine) answers `runningElsewhere` instead (worfy-link
 * ticket 15); `override` ("Start anyway") starts anyway: it still asks, and the run journals the
 * override only when it went past such a run. `tickets` (worfy-flight-recorder ticket 21): a run over
 * these Tickets of the Epic only, ending with `tickets-done`; absent, the whole Epic, as the button.
 * `mode` (worfy-resource-planner ticket 05): the Run mode of this run; absent, the default mode of
 * Settings → Autopilot at the start.
 */
export const autopilotStart = invokeChannel(
  'autopilot.start',
  z.object({
    projectId,
    epic: epicNameSchema,
    override: z.boolean().optional(),
    tickets: z.array(ticketNumSchema).min(1).max(MAX_NAMED_TICKETS).optional(),
    mode: z.enum(RUN_MODES).optional(),
  }),
  autopilotStartAnswerSchema,
  'project',
  'write',
)

/**
 * Stops the Project's run gracefully (`user-stop`, worfy-week ticket 18, ADR-0051): no new Ticket,
 * the Orchestrator is told so, and the Tickets in work finish. Answers as soon as the run is
 * `stopping` or already stopped, not at its end; again while stopping, it only answers the state.
 */
export const autopilotStop = invokeChannel('autopilot.stop', z.object({ projectId }), autopilotStateSchema, 'project', 'write')

/**
 * Force stop (`user-force-stop`): interrupts the Orchestrator's turn and its background tasks and
 * gives the Orchestrator back (worfy-week ticket 17, ADR-0050), also while a graceful Stop goes on.
 * Answers its state once it has stopped — up to HALT_TURN_MS (src/main/agent/session.ts) after the
 * click.
 */
export const autopilotForceStop = invokeChannel('autopilot.forceStop', z.object({ projectId }), autopilotStateSchema, 'project', 'write')

/** The Project's run as it is now. */
export const autopilotState = invokeChannel('autopilot.state', z.object({ projectId }), autopilotStateSchema, 'project', 'read')

/**
 * The estimate of what share of the week a Wave of the Project takes (worfy-throughput ticket 40,
 * src/shared/autopilot/limits-estimate.ts), from the journals of its past runs, with the 7-day
 * window as it is now: the hint of the Autopilot button says both (waveEstimateLine). `estimate` is
 * null with fewer than ESTIMATE_MIN_WAVES counted Waves; `sevenDay` null when nothing is known of it.
 */
export const autopilotEstimateAnswerSchema = z.object({
  estimate: z.object({ perTicket: z.number().nonnegative(), waves: z.number().int().positive() }).nullable(),
  sevenDay: z.object({ utilization: z.number().nonnegative().nullable(), resetsAt: z.number().nullable() }).nullable(),
})
export type AutopilotEstimateAnswer = z.infer<typeof autopilotEstimateAnswerSchema>
export const autopilotEstimate = invokeChannel('autopilot.estimate', z.object({ projectId }), autopilotEstimateAnswerSchema, 'project', 'read')

/** Sent to every window whenever a Project's run changes. */
export const autopilotChanged = eventChannel('autopilot.changed', autopilotStateSchema, 'project', 'read')

export interface StatusLineOptions {
  /** IANA time zone of the times shown; the system's when omitted. Tests pass a fixed one. */
  timeZone?: string
}

/**
 * The status line of the Epic's Autopilot action: `Wave 3 · running`, `Wave 3 · 4 background
 * tasks` (ADR-0029), `stopping · 2 tickets in work` and `stopping` (a graceful Stop, worfy-week
 * ticket 18), `waiting for limits · resumes 14:20`, `today's share used · resumes 00:00` and
 * `5-hour limits full · resumes 02:12` (the budget, worfy-throughput ticket 41), `outside start
 * window · resumes 23:00` and `wave too long for window · resumes 23:00` (the Start window,
 * worfy-resource-planner ticket 05), `stopped: no ready wave`, `stopped: user force stop`.
 */
export function autopilotStatusLine(
  state: Pick<AutopilotState, 'status' | 'wave' | 'reason'> & Partial<Pick<AutopilotState, 'resumesAt' | 'waitingFor' | 'windowReason' | 'backgroundTasks' | 'stopping' | 'ticketsInWork'>>,
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
    const what =
      state.waitingFor === 'daily-share'
        ? "today's share used"
        : state.waitingFor === 'five-hour'
          ? '5-hour limits full'
          : state.waitingFor === 'start-window'
            ? state.windowReason === 'wave-too-long'
              ? 'wave too long for window'
              : 'outside start window'
            : 'waiting for limits'
    if (state.resumesAt === null || state.resumesAt === undefined) return what
    const at = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: options.timeZone }).format(state.resumesAt)
    return `${what} · resumes ${at}`
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
    'autopilot.estimate': typeof autopilotEstimate
    'autopilot.changed': typeof autopilotChanged
  }
}
