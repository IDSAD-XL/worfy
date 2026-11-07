// The `autopilot` domain (worfy-daily ticket 04, ADR-0024): Autopilot over one Epic of a Project —
// start, stop, and the state of the run, sent to every window whenever it changes. Run by
// src/main/autopilot/run.ts, handled in src/main/ipc/autopilot.ts (ADR-0006).
import { z } from 'zod'
import { AUTOPILOT_STOP_REASONS } from '../autopilot/cycle'
import { MAX_QUEUE_EPICS } from '../autopilot/epic-queue'
import { ESTIMATE_WAVES } from '../autopilot/limits-estimate'
import { RUN_MODES, WINDOW_WAIT_REASONS } from '../autopilot/run-mode'
import { DURATION_WAVES } from '../autopilot/wave-duration'
import { epicNameSchema, ticketNumSchema } from '../binding/resolve'
import { eventChannel, invokeChannel } from './channels'
import { runIdSchema } from './runs'

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
 * What the state says of an Epic of a run's queue (worfy-autopilot-queue ticket 14): `done` — all its Tickets
 * done; `waits-owner` — passed, only Tickets for the owner were left; `elsewhere` — passed, it ran on another
 * Machine when the run reached it; `running` — the Epic the run is on (or stopped on); `next` — not started yet.
 */
export const QUEUE_EPIC_STATUSES = ['done', 'running', 'next', 'waits-owner', 'elsewhere'] as const
export type QueueEpicStatus = (typeof QUEUE_EPIC_STATUSES)[number]

/**
 * The Project's run: `running`; `waiting` for the Limits to reset (worfy-daily ticket 05), until
 * `resumesAt`; or `stopped` with the reason of the last run (null before any). `wave` counts the
 * Waves the run has sent in the Epic it is on (`epic`), from 1; in a run over a queue it starts at 1
 * again with each Epic (worfy-autopilot-queue ticket 14). `message` is what went wrong, in words, when a Session failed, a
 * Wave could not be sent or the wait for the Limits was given up. `revision` grows with every change
 * of any Project; a client keeps the state with the highest one.
 */
export const autopilotStateSchema = z.object({
  projectId,
  epic: epicNameSchema.nullable(),
  /**
   * The Epics of the run in order, each with its status (worfy-autopilot-queue ticket 14): one for a run of one
   * Epic; the Epics added between Waves at the end, those removed gone. `epic` is the one at `index`. Kept in the
   * stopped state. Absent before any run, and in states of builds before the ticket.
   */
  queue: z.array(z.object({ epic: epicNameSchema, status: z.enum(QUEUE_EPIC_STATUSES) })).optional(),
  /** Where in `queue` the run is, from 0; with `queue` only. */
  index: z.number().int().nonnegative().optional(),
  status: z.enum(['running', 'waiting', 'stopped']),
  wave: z.number().int().nonnegative(),
  /**
   * The live background tasks of the run's Orchestrator Session (ADR-0029), ambient ones left out;
   * for a stopped run, those still alive in the Session it gave back to a person as it runs
   * (worfy-autopilot-queue ticket 08), else 0.
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
   * says it in words; `retry` — a turn of the Wave ended with a temporary API error, and with
   * Auto-continue on the run sends the Orchestrator a continuation at `resumesAt`, `retry` says which
   * (worfy-retry ticket 04, src/main/autopilot/turn-retry.ts); `orchestrator` — the run was accepted
   * while the Project's Orchestrator was busy and has not taken it yet (worfy-autopilot-queue ticket
   * 07): `busy` says with what, `waitingSince` since when, `resumesAt` is null, `wave` 0. Absent
   * otherwise, and in states of builds before ticket 41.
   */
  waitingFor: z.enum(['limits', 'daily-share', 'five-hour', 'start-window', 'retry', 'orchestrator']).optional(),
  /**
   * While `waitingFor` is `orchestrator`: what keeps the Orchestrator busy now — a turn that runs,
   * how many messages wait in its queue, and its live background tasks ({id, type, description}, as
   * the journal names them). The run starts once none is left, or at Start now. Absent otherwise.
   */
  busy: z
    .object({
      turn: z.boolean(),
      queued: z.number().int().nonnegative(),
      tasks: z.array(z.object({ id: z.string().min(1), type: z.string().nullable(), description: z.string().nullable() })),
    })
    .optional(),
  /** While `waitingFor` is `orchestrator`: when the run was accepted, in milliseconds since the epoch. Absent otherwise. */
  waitingSince: z.number().int().nonnegative().optional(),
  /**
   * While `waitingFor` is `limits`: the window whose reset the run waits for (`five_hour`, `seven_day`,
   * `primary`…), or null when no reset time was reported and the run tries again every 30 minutes
   * (worfy-retry ticket 05). Absent otherwise.
   */
  limitsWindow: z.string().nullable().optional(),
  /** While `waitingFor` is `retry`: the retry the run waits to send, `attempt` of `of` at most in a row. Absent otherwise. */
  retry: z.object({ attempt: z.number().int().positive(), of: z.number().int().positive() }).optional(),
  /** While `waitingFor` is `start-window`: `outside` the window, or the next Wave `wave-too-long` for it. Absent otherwise. */
  windowReason: z.enum(WINDOW_WAIT_REASONS).optional(),
  reason: z.enum(AUTOPILOT_STOP_REASONS).nullable(),
  message: z.string().nullable(),
  /**
   * After a Force stop (`user-force-stop`, worfy-week tickets 17, 18) or a Session in error during a
   * Wave (`session-error`, worfy-retry ticket 14): the Ticket numbers of the Wave it interrupted, for
   * `epic`. A new run of that Epic takes those still in work into its first
   * Wave, also when nothing else is ready; the button and main filter them by the Tickets they read.
   * A run over named Tickets takes only those of its list and leaves the others here when it stops,
   * whatever its reason (worfy-flight-recorder ticket 21, ADR-0091). A run that sent no Wave (a Stop
   * during the wait for the Start window, worfy-resource-planner ticket 05) leaves the Tickets it was
   * given. Empty while running and after any other stop, the graceful Stop (`user-stop`) included.
   */
  resumable: z.array(ticketNumSchema),
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
  /**
   * The id of the run's Journal, which names its Run history (worfy-flight-recorder ticket 20): from
   * the moment the Journal opens, kept in the stopped state until the next run. Absent before any
   * run, for a start that failed before its Journal opened, and in states of builds before ticket 20.
   */
  run: runIdSchema.optional(),
  /**
   * Once a run has stopped (worfy-flight-recorder ticket 20): when, in milliseconds since the epoch
   * by the clock of the Machine that ran it; how long it took from its start, in ms; and of the
   * Tickets its Waves took, how many were `done` and how many `blocked` at the stop. The toast of
   * the stop reads it. Absent while a run goes on, before any, and in states of builds before 20.
   */
  ended: z
    .object({
      at: z.number().int().nonnegative(),
      duration: z.number().int().nonnegative(),
      done: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative(),
    })
    .optional(),
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
 * ready Wave is sent. Refused while the Project has a run (one that waits for its Orchestrator
 * included) and on worfy's own repository in a development build. While the Orchestrator is busy —
 * a turn, queued messages, background tasks — the run is accepted and waits for it
 * (`waitingFor: 'orchestrator'`, worfy-autopilot-queue ticket 07). A run of the same Epic and origin on a Linked
 * machine (or in another Project of this Machine) answers `runningElsewhere` instead (worfy-link
 * ticket 15); `override` ("Start anyway") starts anyway: it still asks, and the run journals the
 * override only when it went past such a run. `tickets` (worfy-flight-recorder ticket 21): a run over
 * these Tickets of the Epic only, ending with `tickets-done`; absent, the whole Epic, as the button.
 * `mode` (worfy-resource-planner ticket 05): the Run mode of this run; absent, the default mode of
 * Settings → Autopilot at the start. `epics` (worfy-autopilot-queue ticket 14): a run over this queue of
 * Epics, in order, `epic` its first; refused with `tickets` when it holds more than one Epic, and when an Epic
 * of it is not the Project's or runs elsewhere. Absent: `epic` alone, as before.
 */
export const autopilotStart = invokeChannel(
  'autopilot.start',
  z.object({
    projectId,
    epic: epicNameSchema,
    epics: z.array(epicNameSchema).min(1).max(MAX_QUEUE_EPICS).optional(),
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
 * Start now (worfy-autopilot-queue ticket 07): a run that waits for its Orchestrator takes it at once.
 * The Orchestrator's turn is interrupted and its background tasks end with its process, as at Force
 * stop (ADR-0050); its queued messages are not sent and wait for the person's Session after the run.
 * Answers the state once the run has taken the Orchestrator, or has stopped with `start-refused`;
 * the state as it is when the Project's run does not wait. On `autopilot.stop` a waiting run is
 * cancelled instead (`start-cancelled`), and its Orchestrator is not touched.
 */
export const autopilotStartNow = invokeChannel('autopilot.startNow', z.object({ projectId }), autopilotStateSchema, 'project', 'write')

/**
 * Force stop (`user-force-stop`): interrupts the Orchestrator's turn and its background tasks and
 * gives the Orchestrator back (worfy-week ticket 17, ADR-0050), also while a graceful Stop goes on.
 * Answers its state once it has stopped — up to HALT_TURN_MS (src/main/agent/session.ts) after the
 * click.
 */
export const autopilotForceStop = invokeChannel('autopilot.forceStop', z.object({ projectId }), autopilotStateSchema, 'project', 'write')

/** What `autopilot.queue` changes: an Epic to add at the end of the queue, one to remove from it, or both. */
export const autopilotQueueEditSchema = z.object({ add: epicNameSchema.optional(), remove: epicNameSchema.optional() })
export type AutopilotQueueEdit = z.infer<typeof autopilotQueueEditSchema>

/**
 * Changes the queue of the Project's run between Waves (worfy-autopilot-queue ticket 14, Autopilot.editQueue):
 * `add` an Epic of the Project at the end, `remove` one not started yet; no reordering. During a Wave the change
 * waits for its end. Answers the state; refused without a run, for the Epic running or finished, an Epic in the
 * queue already or not in it, and past MAX_QUEUE_EPICS.
 */
export const autopilotQueue = invokeChannel('autopilot.queue', autopilotQueueEditSchema.extend({ projectId }), autopilotStateSchema, 'project', 'write')

/** The Project's run as it is now. */
export const autopilotState = invokeChannel('autopilot.state', z.object({ projectId }), autopilotStateSchema, 'project', 'read')

/**
 * The estimate of what share of the week a Wave of the Project takes (worfy-throughput ticket 40,
 * src/shared/autopilot/limits-estimate.ts), from the journals of its past runs, with the 7-day
 * window as it is now. `estimate` is null with fewer than ESTIMATE_MIN_WAVES counted Waves (the budget
 * reads it); `sevenDay` null when nothing is known of it, with `receivedAt` (ms) for the freshness of
 * its number. The Epic forecast of the Autopilot button's hint (worfy-resource-planner ticket 06)
 * draws from `samples`, the per-Ticket samples of the last ESTIMATE_WAVES Waves, and its Start window
 * line reads `durations`, the p90 of the last DURATION_WAVES Waves' durations in ms.
 */
export const autopilotEstimateAnswerSchema = z.object({
  estimate: z.object({ perTicket: z.number().nonnegative(), waves: z.number().int().positive() }).nullable(),
  sevenDay: z.object({ utilization: z.number().nonnegative().nullable(), resetsAt: z.number().nullable(), receivedAt: z.number() }).nullable(),
  samples: z.array(z.number().nonnegative()).max(ESTIMATE_WAVES),
  durations: z.object({ p90: z.number().nonnegative().nullable(), samples: z.number().int().nonnegative().max(DURATION_WAVES) }),
  /**
   * The Vendor of the Project's Orchestrator when it is not Claude (worfy-multi-vendor ticket 38): the
   * estimate, `sevenDay` (its longest window) and `samples` are that Vendor's, and the hint reads its
   * live windows from limits.open. Absent: Claude, as in every answer of a build from before it.
   */
  vendor: z.string().min(1).optional(),
})
export type AutopilotEstimateAnswer = z.infer<typeof autopilotEstimateAnswerSchema>
export const autopilotEstimate = invokeChannel('autopilot.estimate', z.object({ projectId }), autopilotEstimateAnswerSchema, 'project', 'read')

/** Sent to every window whenever a Project's run changes. */
export const autopilotChanged = eventChannel('autopilot.changed', autopilotStateSchema, 'project', 'read')

export interface StatusLineOptions {
  /** IANA time zone of the times shown; the system's when omitted. Tests pass a fixed one. */
  timeZone?: string
  /** The clock of the minutes a run has waited for its Orchestrator; Date.now when omitted. Tests pass a fixed one. */
  now?: number
}

/**
 * The status line of the Epic's Autopilot action: `Wave 3 · running`, `Wave 3 · 4 background
 * tasks` (ADR-0029), `stopping · 2 tickets in work` and `stopping` (a graceful Stop, worfy-week
 * ticket 18), `waiting for limits · resumes 14:20`, `today's share used · resumes 00:00` and
 * `5-hour limits full · resumes 02:12` (the budget, worfy-throughput ticket 41), `outside start
 * window · resumes 23:00` and `wave too long for window · resumes 23:00` (the Start window,
 * worfy-resource-planner ticket 05), `API error · retry 2/5 · 14:20` (the continuation after a
 * temporary API error, worfy-retry ticket 04), `waiting for the Orchestrator · 4 min` (a run accepted
 * while its Orchestrator was busy, in whole minutes since `waitingSince`, none in the first one;
 * worfy-autopilot-queue ticket 07), `stopped: no ready wave`, `stopped: user force stop`, `stopped: turn error · 3 background
 * tasks still run` (the tasks that live on in the Session a stopped run gave back to a person, worfy-autopilot-queue ticket 08).
 * A run over a queue of more than one Epic puts the place of its Epic first: `Epic 2/3: checkout · Wave 1 · running`
 * (worfy-autopilot-queue ticket 17), also while it waits and after it stopped.
 */
export function autopilotStatusLine(
  state: Pick<AutopilotState, 'status' | 'wave' | 'reason'> &
    Partial<Pick<AutopilotState, 'resumesAt' | 'waitingFor' | 'waitingSince' | 'retry' | 'windowReason' | 'backgroundTasks' | 'stopping' | 'ticketsInWork' | 'epic' | 'queue' | 'index'>>,
  options: StatusLineOptions = {},
): string | null {
  const line = runLine(state, options)
  const { queue, index } = state
  if (line === null || queue === undefined || queue.length < 2 || index === undefined) return line
  return `Epic ${index + 1}/${queue.length}: ${queue[index]?.epic ?? state.epic ?? ''} · ${line}`
}

/** The status line without the place in the queue. */
function runLine(
  state: Pick<AutopilotState, 'status' | 'wave' | 'reason'> & Partial<Pick<AutopilotState, 'resumesAt' | 'waitingFor' | 'waitingSince' | 'retry' | 'windowReason' | 'backgroundTasks' | 'stopping' | 'ticketsInWork'>>,
  options: StatusLineOptions,
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
    const at = (resumesAt: number): string => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: options.timeZone }).format(resumesAt)
    if (state.waitingFor === 'orchestrator') {
      const minutes = state.waitingSince === undefined ? 0 : Math.floor(((options.now ?? Date.now()) - state.waitingSince) / 60_000)
      return minutes > 0 ? `waiting for the Orchestrator · ${minutes} min` : 'waiting for the Orchestrator'
    }
    if (state.waitingFor === 'retry') {
      const parts = ['API error', ...(state.retry === undefined ? [] : [`retry ${state.retry.attempt}/${state.retry.of}`])]
      if (state.resumesAt !== null && state.resumesAt !== undefined) parts.push(at(state.resumesAt))
      return parts.join(' · ')
    }
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
    return `${what} · resumes ${at(state.resumesAt)}`
  }
  if (state.reason === null) return null
  const stopped = `stopped: ${state.reason.replaceAll('-', ' ')}`
  // Tasks that live on in the Session the run gave back to a person as it runs (worfy-autopilot-queue ticket 08).
  const tasks = state.backgroundTasks ?? 0
  return tasks > 0 ? `${stopped} · ${tasks} background ${tasks === 1 ? 'task' : 'tasks'} still run${tasks === 1 ? 's' : ''}` : stopped
}

/**
 * The edits of a run's queue one window made during a Wave, which main applies at its end (Autopilot.editQueue):
 * Epics to add, Epics to remove. Main's state shows the queue as it is, not these; the window keeps them until
 * the state shows them made (worfy-autopilot-queue ticket 17).
 */
export interface QueueEdits {
  add: readonly string[]
  remove: readonly string[]
}

type QueueView = Pick<AutopilotState, 'status' | 'epic'> & Partial<Pick<AutopilotState, 'queue' | 'index' | 'stopping'>>

/** A chip on the frame of an Epic of a run's queue: its text, its colour (a `w-chip--<tone>` class) and its tooltip. */
export interface QueueChip {
  label: string
  tone: 'open' | 'blocked' | 'stopped'
  title: string
}

/** The words of each status of an Epic of the queue in the tooltip of the line. */
const QUEUE_STATUS_WORDS: Record<QueueEpicStatus, string> = {
  done: 'done',
  running: 'running',
  next: 'next',
  'waits-owner': 'skipped: waits for the owner',
  elsewhere: 'skipped: runs on another Machine',
}

/** The words of an edit that waits for the end of the Wave, in that tooltip. */
const JOINS = 'joins after this Wave'
const LEAVES = 'leaves after this Wave'

/**
 * The chip on the frame of `epic` while a run over a queue goes on (worfy-autopilot-queue ticket 17): `In queue 3/3`
 * for one not started, `Waits for owner` for one passed with only the owner's Tickets left, `Runs elsewhere` for
 * one passed because another Machine ran it; `Joins after this Wave` and `Leaves after this Wave` for an edit
 * that waits. None for the Epic the run is on (its frame has the line), a done one (its frame is on the done
 * shelf), an Epic outside the queue, and once the run has stopped.
 */
export function queueChip(state: QueueView, epic: string, edits: QueueEdits): QueueChip | null {
  if (state.status === 'stopped' || state.queue === undefined) return null
  if (edits.add.includes(epic)) return { label: 'Joins after this Wave', tone: 'open', title: `Autopilot adds ${epic} to the end of its queue once the Wave in work ends` }
  const at = state.queue.findIndex((each) => each.epic === epic)
  if (at === -1) return null
  if (edits.remove.includes(epic)) return { label: 'Leaves after this Wave', tone: 'stopped', title: `Autopilot takes ${epic} out of its queue once the Wave in work ends` }
  const of = state.queue.length
  switch (state.queue[at]?.status) {
    case 'next':
      return { label: `In queue ${at + 1}/${of}`, tone: 'open', title: `Autopilot runs ${epic} after ${state.epic ?? ''}: ${at + 1} of ${of} in its queue` }
    case 'waits-owner':
      return { label: 'Waits for owner', tone: 'blocked', title: `Autopilot passed ${epic}: only Tickets for the owner are left` }
    case 'elsewhere':
      return { label: 'Runs elsewhere', tone: 'stopped', title: `Autopilot passed ${epic}: another Machine ran it` }
    default:
      return null
  }
}

/**
 * The queue in the tooltip of the line (worfy-autopilot-queue ticket 17): each Epic with its status, in order, and
 * the edits that wait for the end of the Wave. Null for a run of one Epic with no edit waiting.
 */
export function queueTitle(state: QueueView, edits: QueueEdits): string | null {
  const queue = state.queue ?? []
  if (queue.length + edits.add.length < 2) return null
  const rows = [
    ...queue.map(({ epic, status }) => `${epic} — ${[QUEUE_STATUS_WORDS[status], ...(edits.remove.includes(epic) ? [LEAVES] : [])].join(', ')}`),
    ...edits.add.map((epic) => `${epic} — ${JOINS}`),
  ]
  return ['Queue of this run:', ...rows.map((row, at) => `${at + 1}. ${row}`)].join('\n')
}

/**
 * What "⋯" of the frame of `epic` offers for the queue of the Project's run (worfy-autopilot-queue ticket 17):
 * `add` for an Epic outside it, `remove` for one not started or whose adding waits; nothing for the Epic running
 * or finished, a removal that waits, without a run that goes on, and once a Stop was asked (main refuses then).
 */
export function queueAction(state: QueueView | undefined, epic: string, edits: QueueEdits): 'add' | 'remove' | null {
  if (state === undefined || state.status === 'stopped' || state.stopping === true) return null
  if (edits.add.includes(epic)) return 'remove'
  if (edits.remove.includes(epic)) return null
  const entry = (state.queue ?? []).find((each) => each.epic === epic)
  if (entry === undefined) return state.epic === epic ? null : 'add'
  return entry.status === 'next' ? 'remove' : null
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
    'autopilot.startNow': typeof autopilotStartNow
    'autopilot.forceStop': typeof autopilotForceStop
    'autopilot.queue': typeof autopilotQueue
    'autopilot.state': typeof autopilotState
    'autopilot.estimate': typeof autopilotEstimate
    'autopilot.changed': typeof autopilotChanged
  }
}
