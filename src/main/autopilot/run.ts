// An Autopilot run over one Epic of a Project (worfy-daily ticket 04, ADR-0024): Waves one after
// another, without a person, until no Wave is ready or something stops the run.
//
// - The Project's Orchestrator runs as an unattended Session for the time of the run (ADR-0022):
//   it is started again with the unattended launch, continuing its SDK session, and given back
//   attended when the run ends, continuing the SDK session of the run's last Wave.
// - Every Wave after the run's first starts a new SDK session of the Orchestrator (worfy-throughput
//   ticket 52; Orchestrators.newUnattendedSession), so its context does not grow from Wave to Wave:
//   its first prompt asks for `wave-brief <epic>`, then has the Wave's text (launch.ts,
//   waveBriefText). Only with a Harness that has `wave-brief` (the plugin, also carried inline when
//   none is installed; not the old Harness, `legacy`), only while the Orchestrator is free — idle,
//   no live background task, nothing in its queue — and not after a Wave the wait for its tasks'
//   last turn ended (`tasks-timeout`: that turn may still come in the old session); otherwise the
//   Wave goes to the current Session as before. Within a Wave the session stays: the continuation
//   after a Limits wait, a Stop and the turns of background tasks go to it.
// - Waves go out as "Run wave" does (src/main/actions/launch.ts, the Project's template); when one
//   is finished and what comes next is the cycle's call (src/shared/autopilot/cycle.ts), over the
//   events of the Orchestrator's Session and fresh reads of the workflow model.
// - A Wave may wait in the Session's queue behind a person's message. Only a turn that started with
//   the Wave's prompt, or a later one, can end the Wave: the `result` of an earlier turn is not the
//   Wave's (an Interrupt of it still stops the run, as it holds the queue — also when the turn then
//   finishes normally and the Wave is left in the held queue). A Wave still in the
//   queue when the run stops is taken out of it, so no one's turn runs it untracked.
// - The run waits for the background tasks of its Orchestrator Session (worfy-daily ticket 29,
//   ADR-0029): a turn that ends while they live does not end the Wave; their task-notifications
//   start turns of the Wave. Every change of the set goes to the journal. Without any task event
//   for the limit the run stops with `background-stalled`. A run stopped by the cycle while tasks
//   live, or while a turn runs (it may start some), leaves the Orchestrator unattended, and keeps
//   keep-awake, until the turn and the tasks have ended (orchestrator.ts);
//   then the journal says `orchestrator-returned`, or, if the app quits first, `tasks-killed`.
// - Stop by the user is graceful (`user-stop`, worfy-week ticket 18, ADR-0051): no new Ticket, the
//   ones in work finish. During the Wave's turn or its tasks the run goes `stopping`: it journals
//   `run-stopping` and sends the Orchestrator STOP_TEXT through its Session (queued behind a running
//   turn; while the run waits for the Limits, together with the continuation after the reset). It
//   is not a protocol (ADR-0002): the run ends by the Session's events, with the first turn end that
//   leaves the Session idle and no task alive. A Wave still in the Session's queue leaves it, and the
//   run stops at once. The click is noted on the run at once (`stopRequested`): no Wave goes after
//   it, also from a step already under way. stop() answers as soon as the run is stopping or stopped.
// - Force stop (`user-force-stop`, worfy-week ticket 17, ADR-0050) does not wait: it halts the
//   Orchestrator's Session (interrupts its turn, HALT_TURN_MS at most, and holds its queue) and
//   gives the Orchestrator back at once; closing the old process kills its background tasks. The
//   give-back answers once the old process has exited (SIGKILL past its limit) and the attended one
//   has started (worfy-week ticket 20, ADR-0064). The journal says `run-stopped` with the Tickets of
//   the interrupted Wave, `tasks-killed` when tasks lived, and `orchestrator-returned`; forceStop()
//   answers after that. The next run of the Epic
//   takes those Tickets, if still in work, into its first Wave (`resumable`); after a graceful Stop
//   it takes none.
// - keep-awake (power.ts) is held from the start to the end of the run.
// - A turn of the Wave refused by the Limits does not end it (worfy-daily ticket 05): the run goes
//   `waiting` until the Limits reset, then sends the Orchestrator on (limits-wait.ts). Past the
//   wait's limit it stops with `limits-timeout`.
// - Every step goes to the run journal (src/main/autopilot/journal.ts): Waves with the text sent and
//   the Tickets left out for not being open, errors, refused dialogs of the unattended Session, the
//   reason the run stopped with the Orchestrator's last answer in the Wave (ADR-0033), and every
//   action a person takes on the run's Session through the UI as `human-input` with source "worfy".
// - A run does not start with a "Run wave" template that does not name the Wave's Tickets.
// - One run per Project at most. On a development build (not packaged), a run over worfy's own
//   repository is refused: its agents would rebuild the app the run lives in.
// - One run per Epic and origin across this Machine and its Linked machines (worfy-link ticket 15,
//   ADR-0053, Q13). A run is keyed by its Epic and the normalized address of remote `origin` of the
//   Project's root (origin.ts): one repository on two Machines is two Projects (Q9). After its own
//   checks, and before the Orchestrator goes unattended, a start looks at the other runs of this
//   Machine and asks every Linked machine for its runs (src/main/link/autopilot-runs.ts, at most
//   3 s); a run of the same key, or a start of it still under way, refuses it with
//   RunningElsewhere, which names the Machine. The start is counted among this Machine's runs from
//   before the question, so two starts of one key on two Machines at once may both be refused, but
//   never both go. The only way past is explicit: `override` (the button's "Start anyway"). It asks
//   again too: run-started records `override` only when the start did go past another run; once
//   that run has ended the start is a plain one. A Linked machine that is not connected or does not answer in time does not
//   block; the run's state and run-started name it (`unasked`). A Project without origin asks no one.
// - Whether the Harness in worfy's main is newer than this build's (worfy-harness ticket 21,
//   harness-drift.ts) is part of the Project's state, with or without a run (`harnessBehind`). A
//   run journals `harness-behind` right after `run-started` when it is, and again before a
//   `wave-started` when the count of commits has changed: a lesson merged during the run. The run
//   itself goes on as it is; the Stable copy is rebuilt between runs (ADR-0047).
// - The narrow fix round of a Ticket of the run's Waves (worfy-harness ticket 20, ADR-0046) goes to
//   the journal as `narrow-round`, read from the comments of the Ticket's PR that the /epic-wave
//   skill writes its verdicts with (`NARROW: …`): the run knows no protocol of the skill (ADR-0024),
//   it reads what the PR badges read, through the same PrTracker (gh at most once a minute). It
//   reads at each `wave-started`, then every minute while it runs, and once more before
//   `run-stopped`: that last read waits END_READ_MS at most, and not at all once a Force stop or the
//   app's quit has come (they do not wait for gh). Each state of a Ticket is one line, once per run;
//   a comment made before the run started is not journaled; a failed read writes nothing, and the
//   run goes on.
// - `wave-started` and `wave-finished` carry the share of the Limits windows (`limits`,
//   worfy-throughput ticket 40), for the estimate of what a Wave takes (limits-estimate.ts). Before
//   "Run wave" goes and before `wave-finished` is written, the run asks the usage once when the
//   number is older than FRESH_USAGE_MS (deps.usage, the app's LimitsRefresher: no model tokens).
//   `wave-started` has the number from before "Run wave" went; `wave-finished` the one at its
//   writing. A failed ask is logged, and the line goes with the number there is.
// - The budget of the Limits (worfy-throughput ticket 41, src/shared/autopilot/budget.ts, Settings →
//   Autopilot): before "Run wave" goes — never inside a Wave — the run weighs what is left of today's
//   share of the week against the estimate of the Wave (limits-estimate.ts), by the journals of the
//   Project's recent runs (deps.budget). When it does not fit, or the 5-hour window is full, the Wave
//   does not go: `budget-stop` and `waiting-until` go to the journal, the run is `waiting` with the
//   reason in words, and at the time the step that sends the Wave runs again (`resumed` first), with
//   the check again. A Stop during that wait ends the run at once with `user-stop` (no Wave is in
//   work); Force stop and the quit end it with their own reasons and no Tickets; every end cancels
//   the wait's timer.
//
// - A run may be over named Tickets (`tickets`, worfy-flight-recorder ticket 21, ADR-0091): each Wave
//   takes only the ready Tickets of the list (launch.ts, autopilotWave), and the run ends with
//   `tickets-done` once all of them are done (cycle.ts). A start names Tickets of the Epic only. Who
//   started the run (`by`: the button, a command typed in a chat, the Orchestrator's tool) is kept
//   on the run, and run-started carries it with the named list (worfy-flight-recorder ticket 11).
// - The history of a run (worfy-flight-recorder ticket 11, ADR-0092): on each change of the
//   workflow the watch reports, the run journals `ticket-status` for every Ticket of its Epic whose
//   `Status:` differs from the last read (statusChanges), and does so once more from a last read
//   right before `run-stopped` (endRead, not on a Force stop or a quit); the read at the start is
//   the first, so a status from before the run writes nothing. `wave-started` names the SDK session the Wave went
//   to, and the end of the gate queue's turn is `gate-queue-finished`, before `run-stopped`.
//
// worfy still writes no Ticket status (ADR-0002): the agents do, through `ticket`.
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { AutopilotWaveResult } from '../actions/launch'
import { ticketNumber } from '../../shared/actions/render-template'
import { messageText } from '../../shared/agent/attachments'
import { isTaskEvent, type BackgroundTask } from '../../shared/agent/background-tasks'
import type { AgentEvent, QueueSnapshot, SessionState } from '../../shared/agent/events'
import { clipLastText, journalLimits, journalReason, type JournalEventFields, type JournalLimits, type RunStartedBy, type TicketStatusState } from '../../shared/autopilot/journal'
import { budgetDecision, budgetStopText, type AutopilotBudget, type BudgetDecision } from '../../shared/autopilot/budget'
import type { JournalEvent } from '../../shared/autopilot/journal'
import { waveEstimate } from '../../shared/autopilot/limits-estimate'
import { toMs, type LimitsHit } from '../../shared/autopilot/resume-at'
import {
  BACKGROUND_STALL_MS,
  initialCycle,
  SETTLE_MS,
  step,
  TASKS_GRACE_MS,
  type AutopilotStopReason,
  type CycleEvent,
  type CycleState,
} from '../../shared/autopilot/cycle'
import type { AutopilotState, HarnessBehind } from '../../shared/ipc/autopilot'
import type { HarnessKind } from '../../shared/projects/action-templates'
import type { PullRequest } from '../../shared/ipc/checks'
import type { OrchestratorView } from '../../shared/ipc/orchestrator'
import { parseTicketBranch } from '../../shared/workflow/ticket-ref'
import { readyWave } from '../../shared/workflow/waves'
import type { WorkflowModel } from '../../shared/workflow/types'
import { BASE_INTERVAL_MS } from '../github/prs'
import type { RunStart } from './journal'
import { LimitsWait, wallTimer, type LimitsWaitDeps } from './limits-wait'

/** The run's Orchestrator Session, as far as the run needs it. */
export interface RunSession {
  readonly id: string
  /**
   * The SDK session it runs or resumes, once known (Session.sdkId): a resumed Session has an id of
   * worfy's own until Claude Code's init, and this names its transcript meanwhile. Absent or null:
   * the id is the SDK session's.
   */
  readonly sdkId?: string | null
  readonly state: SessionState
  queued(): QueueSnapshot
  removeQueued(id: string): boolean
  /** The Session's live background tasks, ambient ones left out (ADR-0029). */
  backgroundTasks(): BackgroundTask[]
  /** Force stop: holds the queue, interrupts a running turn and waits for it, `timeoutMs` at most (Session.halt). */
  halt(timeoutMs?: number): Promise<unknown>
  /** A message to the Orchestrator: starts a turn when idle, else waits in the queue (Session.send); throws when the Session is gone. */
  send(text: string): unknown
}

/**
 * What the Orchestrator gets on a graceful Stop (worfy-week ticket 18, ADR-0051). Not a protocol
 * (ADR-0002): the run does not check that the Orchestrator obeyed.
 */
export const STOP_TEXT =
  'A person stopped Autopilot. Do not take new Tickets and do not start new Waves. Do not start the Tickets of the current Wave that have not started yet. Finish the Tickets already in work as usual, to merge or blocked, then end the turn.'

/** STOP_TEXT as the Session's queue shows it. */
const STOP_LABEL = messageText(STOP_TEXT, [])

/** The timers of the wait for background tasks; a test passes a clock it moves by hand. */
export interface TasksClock {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realClock: TasksClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** A run as Linked machines are told about it: its Epic and the key of its origin (origin.ts). */
export interface RunKey {
  epic: string
  origin: string
}

/** What one Linked machine answered (src/main/link/autopilot-runs.ts): its runs, or null when it could not be asked. */
export interface LinkedRuns {
  /** The Machine's name, as this Machine knows it. */
  machine: string
  runs: readonly RunKey[] | null
}

/** One open journal (journal.ts, RunJournal). */
export interface RunJournalLike {
  readonly run: string
  append(fields: JournalEventFields): Promise<void>
}

export interface AutopilotDeps {
  /** The Project's repository root; throws for a Project that is not in the list. */
  projectRoot(projectId: string): string
  /** Why a run over this root is refused in this build (selfProjectRefusal), or null. */
  selfRefusal(root: string): Promise<string | null>
  /** A fresh read of the Project's workflow model. */
  workflow(root: string): Promise<WorkflowModel>
  /** Calls `onChange` on every `workflow.changed` of the root; answers the unsubscribe. */
  watchWorkflow(root: string, onChange: () => void): Promise<() => Promise<void> | void>
  orchestrators: {
    setUnattended(projectId: string, unattended: boolean): Promise<OrchestratorView | null>
    /**
     * Stop by the user: the Orchestrator attended again at once, its old process closed; answers once
     * that process has exited and the new one started (Orchestrators.giveBackNow, ADR-0064).
     */
    giveBackNow(projectId: string): Promise<OrchestratorView | null>
    /**
     * Before a Wave that is not the run's first (worfy-throughput ticket 52): a new SDK session of the
     * unattended Orchestrator, answered once its process has started; null when the Orchestrator is
     * not free for it, and nothing changed (Orchestrators.newUnattendedSession).
     */
    newUnattendedSession(projectId: string): Promise<OrchestratorView | null>
  }
  registry: {
    get(sessionId: string): RunSession
    observe(sink: (sessionId: string, event: AgentEvent) => void): () => void
    observeInput(listener: (session: RunSession, what: string) => void): () => void
  }
  /**
   * Sends "Run wave" to the Orchestrator (ActionLauncher.autopilotWave), with the Tickets of an
   * interrupted Wave to take along when still in work (`resume`); `autopilotRefusal` says why the
   * Project's template cannot drive a run, before it starts (ADR-0033), or null.
   * `autopilotGateQueue` (ActionLauncher.autopilotGateQueue) gives the text of "Process gate queue"
   * on the machine with the role `serve` of the cross-machine gate, else null: the run sends it once
   * before it stops for want of a Wave (worfy-windows ticket 17).
   */
  waves: {
    autopilotWave(projectId: string, epic: string, resume: readonly number[], brief: boolean, named?: readonly number[]): Promise<AutopilotWaveResult>
    autopilotRefusal(projectId: string): string | null
    autopilotGateQueue?(projectId: string): Promise<string | null>
  }
  /**
   * Opens the run's journal; writes its `run-started` line, with the run's origin key, `override`
   * when the start went past a run of another Machine, the Linked machines it could not ask, who
   * started the run and its named Tickets (worfy-flight-recorder ticket 11).
   */
  journal(start: RunStart): Promise<RunJournalLike>
  /**
   * The Harness on the machine (src/main/harness/locate.ts, currentHarness), read before each Wave
   * after the first: only one with `wave-brief` (not `legacy`) gets a new SDK session per Wave
   * (worfy-throughput ticket 52).
   */
  harness(): HarnessKind
  /** A new keep-awake for one run (power.ts, KeepAwake). */
  keepAwake(): { start(): void; stop(): void }
  /** Told every new state of any Project's run. */
  onChange?(state: AutopilotState): void
  /** How long a run settles before `wave-unfinished` (default SETTLE_MS). */
  settleMs?: number
  /**
   * The Limits and the wait for them (limits-wait.ts); without it a refused turn ends the run as
   * `turn-error`, and no Wave's line has `limits`.
   */
  limits?: LimitsWaitDeps
  /**
   * Asks the usage once when a Limits window is older than `olderThanMs` (LimitsRefresher.refreshIfOlder),
   * resolving once the answer is in `limits`; without it the Wave's lines carry what `limits` has.
   */
  usage?: { refresh(olderThanMs: number): Promise<void> }
  /**
   * The budget of the Limits (worfy-throughput ticket 41): the settings in force, read before each
   * Wave, and the events of the Project's recent runs, the current one included (readRecentRuns).
   * Without it, or without `limits`, no budget stops a Wave. The wait goes by `limits.now` and
   * `limits.schedule`, as the wait for the Limits does.
   */
  budget?: {
    settings(): AutopilotBudget
    runs(projectId: string): Promise<readonly (readonly JournalEvent[])[]>
  }
  /** How long a run waits for its background tasks without an event of theirs (default BACKGROUND_STALL_MS). */
  backgroundStallMs?: number
  /** How long a run waits for the task-notification turn after the last task ended (default TASKS_GRACE_MS). */
  tasksGraceMs?: number
  /** The clock of those two waits (default: the real timers). */
  tasksClock?: TasksClock
  /** How long Stop waits for the interrupted turn before the Orchestrator's process is closed (default HALT_TURN_MS of session.ts). */
  haltTurnMs?: number
  /**
   * Whether the Harness in the Project's main is newer than this build's (harnessDriftWatch of
   * harness-drift.ts), or null; never throws. Without it no Project has the mark.
   */
  harnessDrift?(projectId: string, root: string): Promise<HarnessBehind | null>
  /**
   * The PRs of the Project's Ticket branches: the app's PrTracker, the one of the PR badges
   * (src/main/ipc/checks.ts), so the run adds no gh call of its own. Read for the narrow fix round
   * (worfy-harness ticket 20); without it the run journals no `narrow-round`.
   */
  prs?: { read(root: string, branches: readonly string[]): Promise<{ pulls: readonly PullRequest[] }> }
  /** How often the run reads the PRs while it runs (default BASE_INTERVAL_MS, the tracker's own interval). */
  prsEveryMs?: number
  /** The clock of that read and of the last read's limit (default: the real timers). */
  prsClock?: TasksClock
  /** How long the last read of the PRs before `run-stopped` may take (default END_READ_MS). */
  endReadMs?: number
  /** The key of the origin of the Project's root (origin.ts, readOriginKey), null without one. Without it no start asks. */
  origin?(root: string): Promise<string | null>
  /** Asks every Linked machine for its runs (src/main/link/autopilot-runs.ts); without it no Linked machine is asked. */
  linkedRuns?(): Promise<readonly LinkedRuns[]>
  /** This Machine as the link knows it, for the state of its runs; null while it has no Linked machines or the link does not run. */
  machine?(): { id: string; name: string } | null
}


/** A Limits number older than this is asked anew before a Wave's line (worfy-throughput ticket 40). */
export const FRESH_USAGE_MS = 5 * 60 * 1000

/**
 * How long the last read of the PRs before `run-stopped` may take; its answer after that is not
 * journaled. Well under the 3 s the app's quit waits for the runs' end (src/main/ipc/autopilot.ts).
 */
export const END_READ_MS = 1000

/** A task as the journal writes it. */
const journalTasks = (tasks: readonly BackgroundTask[]) => tasks.map((task) => ({ id: task.taskId, type: task.taskType, description: task.description }))

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The journal line of a dialog the run's Session refused: which request, the Subagent that asked
 * and Claude Code's reason (journalReason: clipped, the home folder as `~`). The command it was
 * asked for is not written, and is not in the event either.
 */
function refusedDialogLine(event: Extract<AgentEvent, { type: 'refused_dialog' }>, session: string | null): JournalEventFields {
  return {
    kind: 'refused-dialog',
    session,
    what: `${event.dialog} ${event.subject}`,
    ...(event.agent === undefined ? {} : { agent: event.agent }),
    ...(event.reason === undefined ? {} : { reason: journalReason(event.reason, homedir()) }),
  }
}

/** Whether a Session state is a running turn: the Orchestrator is not given back during one (orchestrator.ts). */
const inTurn = (state: SessionState): boolean => state === 'busy' || state === 'needs_permission'

/** Who started a run: the Autopilot button, a command typed in a chat, or the Orchestrator's tool `autopilot_start`. */
export type AutopilotStartedBy = RunStartedBy

/** What `Autopilot.start` takes besides the Project and the Epic. */
export interface AutopilotStartOptions {
  /** "Start anyway": past a run of the same Epic and origin elsewhere. */
  override?: boolean
  /** A run over these Tickets of the Epic only (worfy-flight-recorder ticket 21); absent: the whole Epic. */
  tickets?: readonly number[]
  /** Who started the run; the button when absent. */
  by?: AutopilotStartedBy
}

/**
 * Why a start of `epic` (over `tickets`, when named) is refused by the workflow model: the Project
 * has no such Epic, no Ticket is named in an empty list, or a named Ticket is not one of the Epic's.
 * Null when it may start. Used again by chat-start.ts before it answers the chat.
 */
export function startRefusal(model: Pick<WorkflowModel, 'epics' | 'tickets'>, epic: string, tickets?: readonly number[]): string | null {
  if (!model.epics.some((each) => each.epic === epic) && !model.tickets.some((each) => each.epic === epic)) return `The Project has no Epic ${epic}`
  if (tickets === undefined) return null
  if (tickets.length === 0) return `Name at least one Ticket of Epic ${epic}`
  const missing = [...new Set(tickets)].filter((num) => !model.tickets.some((each) => each.epic === epic && each.num === num)).sort((a, b) => a - b)
  if (missing.length === 0) return null
  return `Epic ${epic} has no ${missing.length === 1 ? 'Ticket' : 'Tickets'} ${missing.map(ticketNumber).join(', ')}`
}

/** What the start of a run is refused with while another run of the Project goes on. */
export const alreadyRunning = (epic: string): string => `Autopilot is already running in this Project (Epic ${epic}): stop it first`

/** What a start is refused with while a run of the same Epic and origin goes on elsewhere. */
export const runningElsewhere = (epic: string, machine: string): string => `Autopilot is already running Epic ${epic} of this repository on ${machine}`

/**
 * The refusal of a start because a run of the same Epic and origin goes on, or starts, on another
 * Machine (or in another Project of this one): `machine` names where. The IPC handler answers it as
 * its own field (src/shared/ipc/autopilot.ts), so the button offers "Start anyway".
 */
export class RunningElsewhere extends Error {
  constructor(
    readonly epic: string,
    readonly machine: string,
  ) {
    super(runningElsewhere(epic, machine))
    this.name = 'RunningElsewhere'
  }
}

/** What a start is refused with once the app quits while the start asked the Linked machines. */
export const QUITTING_MESSAGE = 'worfy is quitting: Autopilot does not start'

/** What a run over worfy's own repository is refused with on a development build. */
export const SELF_PROJECT_MESSAGE =
  'Autopilot does not run on worfy itself from a development build: its agents would rebuild the app the run lives in. Run it from the stable copy (pnpm install:stable).'

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Why Autopilot may not run on `projectRoot` in this build: on a development build (not packaged),
 * a Project whose root is the running app's repository — its folder (`app.getAppPath()`), or any
 * checkout of the same repository, the main one included — is refused. Null when the run may go.
 * `gitCommonDir` answers the repository's common git folder of a folder, null outside git.
 */
export async function selfProjectRefusal(input: {
  packaged: boolean
  appPath: string
  projectRoot: string
  gitCommonDir(dir: string): Promise<string | null>
}): Promise<string | null> {
  if (input.packaged) return null
  const [app, project] = await Promise.all([canonical(input.appPath), canonical(input.projectRoot)])
  if (app === project) return SELF_PROJECT_MESSAGE
  const [appGit, projectGit] = await Promise.all([input.gitCommonDir(app), input.gitCommonDir(project)])
  if (appGit !== null && projectGit !== null && (await canonical(appGit)) === (await canonical(projectGit))) return SELF_PROJECT_MESSAGE
  return null
}

/** The journal's state of a Ticket's `Status:`; null for one it cannot read. */
const STATUS_STATES: Record<WorkflowModel['tickets'][number]['state'], TicketStatusState | null> = { work: 'claimed', blocked: 'blocked', done: 'done', open: 'open', none: null }

/**
 * The `ticket-status` lines for the Tickets of the run's Epic whose status differs from the last
 * read (Run.statuses), in the model's order; the read becomes the last one. A status is the state
 * with the header facts beside it (time, blocked reason, who it waits for), so a claim again with
 * a new time is a change too. A Ticket whose Status cannot be read (`none`) writes no line. A
 * Ticket whose file appeared during the run writes the status it is first seen with, `open` too
 * (ADR-0092); the start's read, whose lines are dropped, is what keeps those before the run out.
 */
function statusChanges(run: Run, tickets: WorkflowModel['tickets']): JournalEventFields[] {
  const lines: JournalEventFields[] = []
  for (const ticket of tickets) {
    if (ticket.epic !== run.epic) continue
    const state = STATUS_STATES[ticket.state]
    const fields = {
      ...(ticket.statusAt ? { statusAt: ticket.statusAt } : {}),
      ...(ticket.blockedReason ? { reason: ticket.blockedReason } : {}),
      ...(ticket.waits ? { waits: ticket.waits } : {}),
    }
    const key = JSON.stringify([state, fields])
    const before = run.statuses.get(ticket.num)
    run.statuses.set(ticket.num, key)
    if (before !== key && state !== null) lines.push({ kind: 'ticket-status', ticket: ticketNumber(ticket.num), state, ...fields })
  }
  return lines
}

/**
 * What a stopped run leaves resumable (AutopilotState.resumable): after a Force stop the Tickets of
 * the Wave it interrupted, and in a run over named Tickets those of the last Force stop it did not
 * take; in number order.
 */
function resumableOf(run: Run): number[] {
  const interrupted = run.cycle.reason === 'user-force-stop' ? run.interrupted : []
  return [...new Set([...interrupted, ...run.carried])].sort((a, b) => a - b)
}

/** One run of one Project. */
class Run {
  cycle: CycleState
  session: RunSession | null = null
  journal: RunJournalLike | null = null
  awake: { start(): void; stop(): void } | null = null
  /** The run's wait for the Limits; null when the app gave no Limits (AutopilotDeps.limits). */
  limits: LimitsWait | null = null
  message: string | null = null
  private chain: Promise<void> = Promise.resolve()
  readonly cleanups: (() => Promise<void> | void)[] = []
  settleTimer: ReturnType<typeof setTimeout> | null = null
  /** The wait for background tasks (phase `tasks`): their limit, or the grace time after the last one. */
  tasksTimer: unknown = null
  /** Turns of the Orchestrator's Session the run has seen start: one per `prompt` event. */
  turns = 0
  /**
   * The Wave was judged after the wait for its tasks' last turn ran out (`tasks-timeout`), not by a
   * turn's end: that turn may still come in the Session, so the next Wave keeps it (ticket 52).
   */
  turnMayCome = false
  /** True while "Run wave" is on its way to the Session (autopilotWave has not answered yet). */
  sending = false
  /** The prompts of the turns that started while "Run wave" was on its way, by turn number. */
  readonly promptsWhileSending = new Map<number, string>()
  /** The current Wave's prompt as the Session reports it; null before the first Wave. */
  wavePrompt: string | null = null
  /** The turn the current Wave's prompt started; null while the Wave waits in the Session's queue. */
  waveTurn: number | null = null
  /** What the current Wave's "Run wave" sent: its text and the skipped Tickets go to `wave-started`. */
  sent: AutopilotWaveResult | null = null
  /** The Limits right before that "Run wave" went: `limits` of its `wave-started`. */
  sentLimits: JournalLimits | undefined = undefined
  /** The Orchestrator's last answer in the turns of the current Wave, clipped; null before any. */
  lastText: string | null = null
  /** The Tickets of an interrupted Wave the next "Run wave" takes along; emptied once it is sent. */
  resume: readonly number[] = []
  /** Set at the click on Stop (Autopilot.stop, through requestStop), before its step runs: no new Wave goes from then on. */
  stopRequested = false
  /** Settles when `stopRequested` is set. */
  readonly stopAsked: Promise<void>
  private stopAskedDone!: () => void
  /** Whether STOP_TEXT has gone to the Orchestrator: once per run. */
  stopSent = false
  /** After a Force stop: the Tickets of the Wave it interrupted (AutopilotState.resumable). */
  interrupted: number[] = []
  /** The status of each Ticket of the Epic at the last read of the watch (statusChanges); the start's read is the first. */
  statuses = new Map<number, string>()
  /**
   * A run over named Tickets: the Tickets of the last Force stop's Wave that are not on its list. It
   * does not take them, so they stay resumable after it, for a later run of the whole Epic (ADR-0091).
   */
  carried: number[] = []
  /**
   * The gate queue's turn before the run stops for want of a Wave (worfy-windows ticket 17): the stop
   * it was sent instead of, while its turn goes on; null otherwise. Once per run: whatever ends the
   * turn ends the run (endGateQueue).
   */
  gateQueue: { reason: AutopilotStopReason; tickets: number[] | undefined; lastText: string | null } | null = null
  /** The key of the Project's origin (origin.ts); null without one: Linked machines are not told about the run. */
  origin: string | null = null
  /** The Linked machines the start could not ask (AutopilotState.unasked). */
  unasked: string[] = []
  /** The `commits` of the last `harness-behind` line of the run; null before any, or once not behind. */
  harnessCommits: number | null = null
  /** Every Ticket of the run's Waves so far: the PRs of their branches are read for the narrow round. */
  readonly waveTickets = new Set<number>()
  /** The `<ticket>:<outcome>` pairs journaled as `narrow-round`: each once per run. */
  readonly narrowJournaled = new Set<string>()
  /** The next read of the PRs; null before the first Wave and once the run stops. */
  prsTimer: unknown = null
  /** When the run started (ms): narrow-round comments made before it are not this run's. */
  readonly startedAt = Date.now()
  /**
   * The wait of the budget before the next Wave (worfy-throughput ticket 41): its id, when the step
   * that sends the Wave runs again, why, the reason in words and the cancel of its timer; null
   * otherwise.
   */
  budget: { id: number; until: number; cause: Extract<BudgetDecision, { kind: 'stop' }>['cause']; text: string; cancel: () => void } | null = null
  /** The id of the last budget wait: a timer of an earlier one sends no Wave. */
  budgetIds = 0
  /** Set once a Force stop or the app's quit has come: the end does not wait for gh any more. */
  rushed = false
  /** Settles when `rushed` is set. */
  readonly rushing: Promise<void>
  private rushDone!: () => void
  /** Settles once the run has stopped and cleaned up. */
  readonly ended: Promise<void>
  finish!: () => void

  constructor(
    readonly projectId: string,
    readonly epic: string,
    readonly root: string,
    /** The Tickets of a run over named Tickets; absent for the whole Epic. */
    named?: readonly number[],
    /** Who started the run (worfy-flight-recorder ticket 21); the journal gets it with ticket 11. */
    readonly by: AutopilotStartedBy = 'button',
  ) {
    this.cycle = initialCycle(epic, named)
    this.rushing = new Promise((done) => {
      this.rushDone = done
    })
    this.stopAsked = new Promise((done) => {
      this.stopAskedDone = done
    })
    this.ended = new Promise((done) => {
      this.finish = done
    })
  }

  /** Set once the run has stopped and cleaned up: its end is journaled, keep-awake released. */
  done = false

  /**
   * A run is running until it is done, also while it ends: the cycle has stopped, but its last
   * line and the release of keep-awake and of the Orchestrator are still on their way.
   */
  get running(): boolean {
    return !this.done
  }

  /** Stop was clicked: no new Wave goes, and a usage ask before "Run wave" is not waited for. */
  requestStop(): void {
    this.stopRequested = true
    this.stopAskedDone()
  }

  /** A Force stop or the app's quit has come: an end waiting for gh goes on without it. */
  rush(): void {
    this.rushed = true
    this.rushDone()
  }

  /** Whether the turn `turn` can end the current Wave: the Wave's own turn, or a later one. */
  endsWave(turn: number): boolean {
    return this.waveTurn !== null && turn >= this.waveTurn
  }

  /** Runs tasks one after another, in the order they were queued; a failing task does not stop the next. */
  enqueue(task: () => Promise<void> | void): Promise<void> {
    const next = this.chain.then(task).catch((error: unknown) => console.error(`[autopilot] ${this.projectId}: a step failed`, error))
    this.chain = next
    return next
  }
}

/** The Autopilot runs of the app, one per Project at most. */
export class Autopilot {
  private readonly runs = new Map<string, Run>()
  /** Projects whose run is between the click and its first state, with the Epic and, once read, the origin key. */
  private readonly starting = new Map<string, { epic: string; origin: string | null }>()
  /** Set by stopAll(): a start still asking the Linked machines does not go. */
  private quitting = false
  /** Stopped runs whose Orchestrator still waits for its background tasks; each one's app-quit. */
  private readonly lingering = new Set<() => Promise<void>>()
  /** The last stopped state of each Project, also after its run is gone. */
  private readonly last = new Map<string, AutopilotState>()
  /** The last answer of deps.harnessDrift for each Project (AutopilotState.harnessBehind). */
  private readonly harness = new Map<string, HarnessBehind | null>()
  private revision = 0

  constructor(private readonly deps: AutopilotDeps) {}

  /** The Project's run as it is now. */
  state(projectId: string): AutopilotState {
    const run = this.runs.get(projectId)
    if (run === undefined) {
      const harnessBehind = this.harness.get(projectId) ?? null
      const last = this.last.get(projectId)
      if (last !== undefined) return { ...last, harnessBehind }
      return {
        projectId,
        epic: null,
        status: 'stopped',
        wave: 0,
        backgroundTasks: 0,
        resumesAt: null,
        reason: null,
        message: null,
        resumable: [],
        stopping: false,
        ticketsInWork: 0,
        harnessBehind,
        revision: this.revision,
      }
    }
    return this.snapshot(run)
  }

  /**
   * Asks again whether the Harness in the Project's main is newer than this build's; a changed
   * answer goes out as a new state. The answer is kept apart from any run, so it shows before the
   * first run and after the last one too.
   */
  async refreshHarness(projectId: string): Promise<void> {
    let root: string
    try {
      root = this.deps.projectRoot(projectId)
    } catch {
      return
    }
    if (await this.checkHarness(projectId, root)) this.publish(projectId)
  }

  /** deps.harnessDrift for the Project, kept; true when the answer differs from the one before. */
  private async checkHarness(projectId: string, root: string): Promise<boolean> {
    if (this.deps.harnessDrift === undefined) return false
    let behind: HarnessBehind | null
    try {
      behind = await this.deps.harnessDrift(projectId, root)
    } catch (error) {
      console.warn(`[autopilot] ${projectId}: could not compare the Harness with main`, error)
      behind = null
    }
    const before = this.harness.get(projectId) ?? null
    this.harness.set(projectId, behind)
    return JSON.stringify(before) !== JSON.stringify(behind)
  }

  /**
   * The run's `harness-behind` line: written when the Harness is behind and the count differs from
   * the run's last such line — right after `run-started`, then before a `wave-started`.
   */
  private async journalHarness(run: Run): Promise<void> {
    await this.checkHarness(run.projectId, run.root)
    const behind = this.harness.get(run.projectId) ?? null
    if (behind === null) {
      // Not behind any more (main was reset): a later lag is a change again.
      run.harnessCommits = null
      return
    }
    if (behind.commits === run.harnessCommits) return
    run.harnessCommits = behind.commits
    await this.write(run, { kind: 'harness-behind', harness: behind.harness, main: behind.main, commits: behind.commits })
  }

  /** Whether a run of the Project goes on (or is starting). */
  running(projectId: string): boolean {
    return this.starting.has(projectId) || this.runs.get(projectId)?.running === true
  }

  /** The Epic of the Project's run that goes on or is starting; null when none does. */
  runningEpic(projectId: string): string | null {
    const starting = this.starting.get(projectId)
    if (starting !== undefined) return starting.epic
    const run = this.runs.get(projectId)
    return run?.running === true ? run.epic : null
  }

  /**
   * Starts a run of `epic`, or of its Tickets `options.tickets` only. Refused while the Project has a
   * run, on worfy's own repository in a development build, when the workflow cannot be read, has no
   * such Epic or no such Ticket in it (startRefusal), and while the Orchestrator is in a turn.
   * Answers the run's first state.
   */
  async start(projectId: string, epic: string, options: AutopilotStartOptions = {}): Promise<AutopilotState> {
    // Taken before the first await: two starts that arrive together do not both pass.
    const live = this.runs.get(projectId)
    if (this.starting.has(projectId) || live?.running === true) throw new Error(alreadyRunning(live?.epic ?? epic))
    const starting = { epic, origin: null as string | null }
    this.starting.set(projectId, starting)
    try {
      const { root, model } = await this.ownChecks(projectId, epic, options.tickets)
      // Counted among this Machine's runs before anyone is asked: a Linked machine starting the same
      // key meanwhile hears of this start (runKeys), as this one hears of its.
      starting.origin = await this.originOf(projectId, root)
      const check = starting.origin === null ? { elsewhere: null, unasked: [] } : await this.checkElsewhere(projectId, epic, starting.origin)
      if (check.elsewhere !== null && options.override !== true) throw check.elsewhere
      // Asked again on "Start anyway" too: once the other run has ended, the start is a plain one.
      const override = check.elsewhere !== null
      const unasked = check.unasked
      if (this.quitting) throw new Error(QUITTING_MESSAGE)

      const run = new Run(projectId, epic, root, options.tickets, options.by)
      run.origin = starting.origin
      run.unasked = unasked
      // The Wave the last Force stop of this Epic interrupted goes along with the first Wave (worfy-week tickets 17, 18).
      // A run over named Tickets takes only those of its list, and keeps the rest resumable (ADR-0091).
      const last = this.last.get(projectId)
      run.resume = last?.epic === epic ? [...last.resumable] : []
      const named = options.tickets
      if (named !== undefined) run.carried = run.resume.filter((num) => !named.includes(num))
      // The first read of the statuses: a status from before the run is not a change of it.
      statusChanges(run, model.tickets)
      if (this.deps.limits !== undefined) run.limits = new LimitsWait(this.deps.limits)
      const view = await this.deps.orchestrators.setUnattended(projectId, true)
      try {
        if (view === null || view.sessionId === null) throw new Error('The Orchestrator has no Session')
        run.session = this.deps.registry.get(view.sessionId)
        run.journal = await this.deps.journal({
          project: projectId,
          epic,
          ...(run.origin === null ? {} : { origin: run.origin }),
          ...(override ? { override: true as const } : {}),
          ...(unasked.length > 0 ? { unasked } : {}),
          by: run.by,
          ...(run.cycle.named === undefined ? {} : { tickets: run.cycle.named.map(ticketNumber) }),
        })
        await this.journalHarness(run)
        run.awake = this.deps.keepAwake()
        run.awake.start()
        this.subscribe(run)
        const unwatch = await this.deps.watchWorkflow(root, () => void run.enqueue(() => this.readAndFeed(run, 'ignore', (tickets) => ({ type: 'workflow', tickets }), true)))
        if (run.cycle.phase === 'stopped') {
          // The Session failed or closed while the watch opened: the run has ended (or is ending)
          // and released what it held without this watch, so it is closed here.
          await this.unwatch(run, unwatch)
          await run.ended
          return this.snapshot(run)
        }
        run.cleanups.push(unwatch)
      } catch (error) {
        await this.release(run, true)
        throw error
      }
      this.runs.set(projectId, run)
      this.starting.delete(projectId)
      this.publish(projectId)
      void run.enqueue(() => this.feed(run, { type: 'start', tickets: model.tickets, resume: run.resume }))
      return this.snapshot(run)
    } finally {
      this.starting.delete(projectId)
    }
  }

  /**
   * The checks of a start that need no Orchestrator and no Linked machine: worfy's own repository in
   * a development build, the "Run wave" template, the workflow, the Epic and the named Tickets.
   * Throws the refusal; answers the root and the model read.
   */
  private async ownChecks(projectId: string, epic: string, tickets: readonly number[] | undefined): Promise<{ root: string; model: WorkflowModel }> {
    const root = this.deps.projectRoot(projectId)
    const refusal = (await this.deps.selfRefusal(root)) ?? this.deps.waves.autopilotRefusal(projectId)
    if (refusal !== null) throw new Error(refusal)
    const model = await this.deps.workflow(root)
    if (model.error !== null) throw new Error(`Cannot read the workflow: ${model.error.message}`)
    const unknown = startRefusal(model, epic, tickets)
    if (unknown !== null) throw new Error(unknown)
    return { root, model }
  }

  /**
   * Why a start of `epic` would be refused now, without starting anything: a run of the Project,
   * the checks of start() that need no Orchestrator (ownChecks), and — without `override` — a run
   * of the same Epic and origin elsewhere. Null when start() would go past them. The Orchestrator's
   * own state is not asked here (chat-start.ts asks it). Used by a start from a chat before it
   * promises to start after the Orchestrator's turn (ADR-0091).
   */
  async startCheck(projectId: string, epic: string, options: AutopilotStartOptions = {}): Promise<string | null> {
    const running = this.runningEpic(projectId)
    if (running !== null) return alreadyRunning(running)
    try {
      const { root } = await this.ownChecks(projectId, epic, options.tickets)
      if (options.override === true) return null
      const origin = await this.originOf(projectId, root)
      if (origin === null) return null
      return (await this.checkElsewhere(projectId, epic, origin)).elsewhere?.message ?? null
    } catch (error) {
      return messageOf(error)
    }
  }

  /** The key of the Project's origin; a read that throws counts as none. */
  private async originOf(projectId: string, root: string): Promise<string | null> {
    if (this.deps.origin === undefined) return null
    try {
      return await this.deps.origin(root)
    } catch (error) {
      console.warn(`[autopilot] ${projectId}: could not read the origin of the repository`, error)
      return null
    }
  }

  /**
   * Where else `epic` of the same origin runs or starts: another Project of this Machine, or a
   * Linked machine (`elsewhere`, null when nowhere); and the Linked machines that could not be asked.
   */
  private async checkElsewhere(projectId: string, epic: string, origin: string): Promise<{ elsewhere: RunningElsewhere | null; unasked: string[] }> {
    for (const [other, key] of this.keys()) {
      if (other === projectId || key.epic !== epic || key.origin !== origin) continue
      const here = this.deps.machine?.()?.name
      return { elsewhere: new RunningElsewhere(epic, here === undefined ? `this Machine (Project ${other})` : `${here} (this Machine, Project ${other})`), unasked: [] }
    }
    if (this.deps.linkedRuns === undefined) return { elsewhere: null, unasked: [] }
    let answers: readonly LinkedRuns[]
    try {
      answers = await this.deps.linkedRuns()
    } catch (error) {
      console.warn(`[autopilot] ${projectId}: could not ask the Linked machines for their runs`, error)
      return { elsewhere: null, unasked: [] }
    }
    const hit = answers.find((answer) => answer.runs?.some((key) => key.epic === epic && key.origin === origin) === true)
    const unasked = answers.filter((answer) => answer.runs === null).map((answer) => answer.machine)
    return { elsewhere: hit === undefined ? null : new RunningElsewhere(epic, hit.machine), unasked }
  }

  /** Every run of this Machine with an origin, starting ones included, by Project. */
  private keys(): [string, RunKey][] {
    const keys: [string, RunKey][] = []
    for (const [projectId, { epic, origin }] of this.starting) if (origin !== null) keys.push([projectId, { epic, origin }])
    for (const run of this.runs.values()) if (run.running && run.origin !== null) keys.push([run.projectId, { epic: run.epic, origin: run.origin }])
    return keys
  }

  /**
   * What this Machine answers a Linked machine that asks for its runs (src/main/link/autopilot-runs.ts):
   * the Epic and origin key of every run that goes on — waiting for the Limits and stopping included
   * — and of every start under way whose origin is read. Runs without origin are left out.
   */
  runKeys(): RunKey[] {
    return this.keys().map(([, key]) => key)
  }

  /**
   * The graceful Stop (worfy-week ticket 18): answers the run's state as soon as it is stopping or
   * stopped. A second Stop while stopping sends nothing and answers the state.
   *
   * The Stop is noted on the run at once, before its step waits in the run's order: a step ahead of
   * it (the end of a turn, a workflow change, reading the workflow for hundreds of milliseconds)
   * must not send a new Wave after the click (sendWave checks it).
   */
  async stop(projectId: string): Promise<AutopilotState> {
    const run = this.runs.get(projectId)
    if (run === undefined) return this.state(projectId)
    run.requestStop()
    await run.enqueue(async () => {
      if (run.cycle.phase === 'stopped' || run.cycle.stopping) return
      // Waiting for the budget before a Wave: no Wave is in work, the run ends now (ticket 41).
      if (run.budget !== null) {
        await this.feed(run, { type: 'stop', reason: 'user-stop' })
        return
      }
      await this.feed(run, { type: 'graceful-stop', tickets: await this.freshTickets(run) })
    })
    if (run.cycle.phase === 'stopped') await run.ended
    return this.state(projectId)
  }

  /** Force stop: stops the Project's run with `user-force-stop`; answers its state once it has stopped. */
  async forceStop(projectId: string): Promise<AutopilotState> {
    const run = this.runs.get(projectId)
    if (run === undefined) return this.state(projectId)
    // Before its step waits in the run's order: an end that waits for gh there goes on now.
    run.rush()
    await run.enqueue(() => this.feed(run, { type: 'stop', reason: 'user-force-stop' }))
    await run.ended
    return this.state(projectId)
  }

  /**
   * Stops every run with `app-quit`; settles once they have all stopped. Stopped runs still waiting
   * for their Orchestrator's background tasks journal them as killed and release keep-awake.
   */
  async stopAll(): Promise<void> {
    this.quitting = true
    await Promise.all([
      ...[...this.runs.values()].map(async (run) => {
        run.rush()
        await run.enqueue(() => this.feed(run, { type: 'stop', reason: 'app-quit' }))
        await run.ended
      }),
      ...[...this.lingering].map((quit) => quit()),
    ])
  }

  private async unwatch(run: Run, unwatch: () => Promise<void> | void): Promise<void> {
    try {
      await unwatch()
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: a cleanup failed`, error)
    }
  }

  /**
   * Whether any run goes on, or a stopped one still waits for its Orchestrator's background tasks:
   * the app's quit waits for stopAll() then, so those tasks are journaled as killed.
   */
  anyRunning(): boolean {
    return this.starting.size > 0 || this.lingering.size > 0 || [...this.runs.values()].some((run) => run.running)
  }

  private subscribe(run: Run): void {
    if (run.limits !== null) run.cleanups.push(run.limits.watch((sessionId) => run.session !== null && sessionId === run.session.id))
    run.cleanups.push(
      this.deps.registry.observe((sessionId, event) => {
        if (run.session === null || sessionId !== run.session.id) return
        this.onEvent(run, event)
      }),
      this.deps.registry.observeInput((session, what) => {
        if (session !== run.session) return
        void run.enqueue(() => this.write(run, { kind: 'human-input', source: 'worfy', what }))
      }),
    )
  }

  private onEvent(run: Run, event: AgentEvent): void {
    switch (event.type) {
      case 'prompt':
        run.turns += 1
        run.limits?.turnStarted()
        if (run.sending) run.promptsWhileSending.set(run.turns, event.text)
        else if (run.waveTurn === null && run.wavePrompt !== null && event.text === run.wavePrompt) run.waveTurn = run.turns
        return
      case 'result': {
        // Which turn ended is known now, in the order of the Session's events; whether it is the
        // Wave's is decided in the run's order, once the Wave's own sending has been handled.
        const turn = run.turns
        const message = event.error ?? (event.isError ? event.text : null)
        // Whether the Limits refused the turn is known now, from the Limits status of this turn.
        const hit = run.limits?.hitOf({ isError: event.isError, interrupted: event.interrupted, message }) ?? null
        // The background tasks the turn left alive, as of its end: a task that ends later starts a
        // turn of its own (its task-notification), and that turn's result judges the Wave.
        const tasks = this.liveTasks(run).length
        void run.enqueue(() => {
          // A turn ahead of the Wave that finished normally after an Interrupt still leaves the
          // queue held: the Wave waits in it until a person resumes, so the run stops as interrupted.
          const interrupted = event.interrupted || (!run.endsWave(turn) && this.waveHeld(run))
          if (!run.endsWave(turn) && !interrupted) return
          // The answer of a turn of the Wave, for run-stopped (ADR-0033).
          if (run.endsWave(turn) && event.text !== null && event.text.trim() !== '') run.lastText = clipLastText(event.text)
          if (hit !== null && !interrupted) return this.limitsHit(run, hit)
          // A turn of the Wave that was not refused ends any wait (a person's turn during it, too).
          run.limits?.passed()
          run.turnMayCome = false
          return this.readAndFeed(run, 'stop', (tickets) => ({
            type: 'turn-ended',
            isError: event.isError,
            interrupted,
            message: message === '' ? null : message,
            tickets,
            tasks,
            // The Session as it is now, after the fresh read: a turn may have started since.
            idle: run.session?.state === 'idle',
          }))
        })
        return
      }
      case 'state':
        if (event.state === 'busy') void run.enqueue(() => this.feed(run, { type: 'busy' }))
        else if (event.state === 'error') void run.enqueue(() => this.feed(run, { type: 'session-error', message: event.error ?? 'The Session failed' }))
        else if (event.state === 'closed') void run.enqueue(() => this.feed(run, { type: 'session-closed' }))
        return
      case 'refused_dialog':
        void run.enqueue(() => this.write(run, refusedDialogLine(event, run.session?.id ?? null)))
        return
      case 'background_tasks': {
        const tasks = event.tasks.map((task) => ({ ...task }))
        void run.enqueue(async () => {
          if (run.cycle.phase === 'stopped') return
          await this.write(run, { kind: 'background-tasks', tasks: journalTasks(tasks) })
          this.tasksTimer(run, true)
          this.publish(run.projectId)
        })
        return
      }
      default:
        // Any other event of a task is a sign of life: the limit starts over.
        if (isTaskEvent(event)) void run.enqueue(() => this.tasksTimer(run, true))
        return
    }
  }

  /**
   * Reads the workflow model fresh and feeds the cycle an event made of its Tickets. A read that
   * fails after a turn stops the run (`onError: 'stop'`): without it the end of the Wave cannot be
   * told. After a workflow change it is skipped: the next change reads again. `statuses`: the read
   * of the watch, which journals the Tickets' changes of status first (ticket-status).
   */
  private async readAndFeed(run: Run, onError: 'stop' | 'ignore', make: (tickets: WorkflowModel['tickets']) => CycleEvent, statuses = false): Promise<void> {
    if (run.cycle.phase === 'stopped') return
    let model: WorkflowModel
    try {
      model = await this.deps.workflow(run.root)
    } catch (error) {
      model = { root: run.root, epics: [], tickets: [], error: { code: 'failed', message: messageOf(error) }, branchErrors: [] }
    }
    if (model.error !== null) {
      console.warn(`[autopilot] ${run.projectId}: cannot read the workflow: ${model.error.message}`)
      if (onError === 'stop') {
        run.message = `Cannot read the workflow: ${model.error.message}`
        await this.feed(run, { type: 'workflow-error', message: run.message })
      }
      return
    }
    if (statuses) for (const fields of statusChanges(run, model.tickets)) await this.write(run, fields)
    await this.feed(run, make(model.tickets))
  }

  /** The Tickets of a fresh read of the workflow model; none when it cannot be read (a Stop still goes). */
  private async freshTickets(run: Run): Promise<WorkflowModel['tickets']> {
    try {
      const model = await this.deps.workflow(run.root)
      if (model.error === null) return model.tickets
      console.warn(`[autopilot] ${run.projectId}: cannot read the workflow: ${model.error.message}`)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: cannot read the workflow`, error)
    }
    return []
  }

  /** One cycle step and its effects, in order. */
  private async feed(run: Run, event: CycleEvent): Promise<void> {
    const before = run.cycle.phase
    const { state, effects } = step(run.cycle, event)
    run.cycle = state
    this.settleTimer(run, before)
    this.tasksTimer(run, false)
    for (const effect of effects) {
      switch (effect.kind) {
        case 'send-wave':
          // The gate queue's turn ended and the Tickets changed meanwhile: the run still stops as it was going to.
          if (run.gateQueue !== null) await this.endGateQueue(run, null)
          else await this.sendWave(run)
          break
        case 'wave-started': {
          const sent = run.sent
          await this.journalHarness(run)
          await this.write(run, {
            kind: 'wave-started',
            wave: effect.wave,
            tickets: effect.tickets.map(ticketNumber),
            ...(sent === null ? {} : { text: sent.text, skipped: sent.skipped.map((each) => ({ num: ticketNumber(each.num), state: each.state })) }),
            ...(run.sentLimits === undefined ? {} : { limits: run.sentLimits }),
            ...(run.session === null ? {} : { session: run.session.sdkId ?? run.session.id }),
          })
          for (const num of effect.tickets) run.waveTickets.add(num)
          this.pollPrs(run)
          break
        }
        case 'wave-finished': {
          // The end of the gate queue's turn is not a Wave's.
          if (run.gateQueue !== null) break
          const limits = await this.freshLimits(run)
          await this.write(run, { kind: effect.kind, wave: effect.wave, tickets: effect.tickets.map(ticketNumber), ...(limits === undefined ? {} : { limits }) })
          break
        }
        case 'stopping':
          await this.beginStopping(run, effect)
          break
        case 'session-error':
          run.message = effect.message
          await this.write(run, { kind: 'session-error', session: run.session?.id ?? null, message: effect.message })
          break
        case 'stopped':
          if (run.gateQueue !== null) await this.endGateQueue(run, effect)
          else if (!(await this.gateQueueTurn(run, effect))) await this.end(run, effect.reason, effect.tickets)
          break
      }
    }
    if (run.cycle.phase !== 'stopped') this.publish(run.projectId)
  }

  /**
   * The run has no Wave to send (`no-ready-wave`, `blocked-tickets`): on the machine with `serve`
   * the Orchestrator first gets "Process gate queue", once per run, and `gate-queue` goes to the
   * journal (worfy-windows ticket 17). Its turn is followed as a Wave's without Tickets: the end of
   * the turn, background tasks, a Limits wait, a graceful Stop. Not after a Stop or on quit. Answers
   * whether the turn went; when it did not, the run stops now.
   */
  private async gateQueueTurn(run: Run, effect: { reason: AutopilotStopReason; tickets?: number[] }): Promise<boolean> {
    const gateQueue = this.deps.waves.autopilotGateQueue
    if (effect.reason !== 'no-ready-wave' && effect.reason !== 'blocked-tickets') return false
    if (gateQueue === undefined) return false
    const text = await gateQueue.call(this.deps.waves, run.projectId)
    // A Stop, a Force stop or the quit before the step, or while the role and the template were read.
    if (text === null || run.stopRequested || run.rushed || this.quitting || run.session === null) return false
    const saved = { reason: effect.reason, tickets: effect.tickets, lastText: run.lastText }
    run.cycle = { ...run.cycle, phase: 'turn', tickets: [], reason: null, inWork: [] }
    run.gateQueue = saved
    run.lastText = null
    run.wavePrompt = messageText(text, [])
    run.waveTurn = null
    run.sending = true
    run.promptsWhileSending.clear()
    try {
      await this.write(run, { kind: 'gate-queue', text })
      run.session.send(text)
    } catch (error) {
      // The Session is gone: the run stops as it was going to.
      console.warn(`[autopilot] ${run.projectId}: could not send the gate queue to the Orchestrator`, error)
      await this.endGateQueue(run, null)
      return true
    } finally {
      run.sending = false
    }
    for (const [turn, prompt] of run.promptsWhileSending) {
      if (prompt !== run.wavePrompt) continue
      run.waveTurn = turn
      break
    }
    run.promptsWhileSending.clear()
    return true
  }

  /**
   * The gate queue's turn is over: the run stops with the reason it had before it (`stopped` null,
   * or another stop for want of a Wave), with the Wave's last answer; any other stop — a Stop, a
   * Force stop, an error, the Limits — stops it with its own reason.
   */
  private async endGateQueue(run: Run, stopped: { reason: AutopilotStopReason; tickets?: number[] } | null): Promise<void> {
    const saved = run.gateQueue
    if (saved === null) return
    run.gateQueue = null
    await this.write(run, { kind: 'gate-queue-finished' })
    const own = stopped !== null && stopped.reason !== 'no-ready-wave' && stopped.reason !== 'blocked-tickets' && stopped.reason !== 'no-progress'
    const reason = own ? stopped.reason : saved.reason
    const tickets = own ? stopped.tickets : saved.tickets
    if (!own) run.lastText = saved.lastText
    run.cycle = { ...run.cycle, phase: 'stopped', reason }
    await this.end(run, reason, tickets)
  }

  private async sendWave(run: Run): Promise<void> {
    let sent: AutopilotWaveResult
    // First: a Stop clicked while the usage is asked ends that wait at once and is seen below, and
    // the Wave does not go. A Stop clicked before asks nothing: no Wave line needs the answer.
    if (!run.stopRequested) run.sentLimits = await this.freshLimits(run, run.stopAsked)
    // The budget, on the number just asked (ticket 41); not weighed once a stop has come.
    const budget = run.stopRequested || run.rushed ? null : await this.budgetCheck(run)
    // Stop was clicked while the step that decided on this Wave ran (worfy-week ticket 18): the
    // Wave has not gone, so no Ticket was taken, and the run ends here. Checked before a Force stop
    // or the app's quit: a Stop clicked first ends the run with its own reason, and the stop step
    // queued behind this one finds it stopped.
    if (run.stopRequested) {
      await this.feed(run, { type: 'stop', reason: 'user-stop' })
      return
    }
    // A Force stop or the app's quit came meanwhile, without a Stop: its stop step waits behind this
    // one and stops the run with its own reason; the Wave does not go.
    if (run.rushed) return
    if (budget !== null && budget.kind === 'stop') {
      await this.budgetWait(run, budget)
      return
    }
    // Every Wave after the run's first goes to a new SDK session (worfy-throughput ticket 52).
    const fresh = run.cycle.wave > 0 && !run.turnMayCome && this.deps.harness() !== 'legacy' ? await this.newSession(run) : 'same'
    if (fresh === 'gone') return
    // A Stop, a Force stop or the quit while the new session started: the Wave does not go, as above.
    if (run.stopRequested) {
      await this.feed(run, { type: 'stop', reason: 'user-stop' })
      return
    }
    if (run.rushed) return
    run.sending = true
    run.promptsWhileSending.clear()
    // Only the run's first Wave takes the interrupted Tickets along.
    const resume = run.resume
    run.resume = []
    try {
      sent = await this.deps.waves.autopilotWave(run.projectId, run.epic, resume, fresh === 'fresh', run.cycle.named)
    } catch (error) {
      run.message = messageOf(error)
      await this.feed(run, { type: 'send-failed', message: run.message })
      return
    } finally {
      run.sending = false
    }
    run.sent = sent
    run.lastText = null
    // Sent at once, its turn has started by now; queued, it starts with a later `prompt`.
    run.wavePrompt = messageText(sent.text, [])
    run.waveTurn = null
    for (const [turn, text] of run.promptsWhileSending) {
      if (text !== run.wavePrompt) continue
      run.waveTurn = turn
      break
    }
    run.promptsWhileSending.clear()
    // Stop was clicked while "Run wave" was on its way: the cycle notes it now (phase `sending`), so
    // the Wave goes out stopping, ahead of any step queued behind this one.
    if (run.stopRequested && !run.cycle.stopping) await this.feed(run, { type: 'graceful-stop', tickets: await this.freshTickets(run) })
    await this.feed(run, { type: 'wave-sent', tickets: sent.tickets })
  }

  /**
   * A new SDK session of the Orchestrator for the next Wave (worfy-throughput ticket 52). The run
   * follows no Session while the old one closes, so its end does not stop the run, then follows the
   * new one. Answers `fresh` when the Wave goes to a new session; `same` when the Orchestrator was not
   * free for it and the Wave goes to the current one; `gone` when the run has no Session left to
   * send to, and the cycle has been told. A Force stop or the quit does not wait for the new process
   * (as freshLimits): `gone`, with no Session followed, and their stop step ends the run.
   */
  private async newSession(run: Run): Promise<'fresh' | 'same' | 'gone'> {
    const old = run.session
    run.session = null
    const asked = this.deps.orchestrators.newUnattendedSession(run.projectId).catch((error: unknown) => {
      console.warn(`[autopilot] ${run.projectId}: could not start a new session of the Orchestrator`, error)
      return null
    })
    const view = await Promise.race([asked, run.rushing.then(() => 'rushed' as const)])
    if (view === 'rushed') return 'gone'
    if (view === null || view.sessionId === null) {
      run.session = old
      if (old !== null && old.state !== 'closed') return 'same'
      await this.feed(run, { type: 'session-closed' })
      return 'gone'
    }
    run.session = this.deps.registry.get(view.sessionId)
    // What the new Session did before the run followed it: a start that failed or closed.
    if (run.session.state === 'error') {
      await this.feed(run, { type: 'session-error', message: view.error ?? 'The Session failed' })
      return 'gone'
    }
    if (run.session.state === 'closed') {
      await this.feed(run, { type: 'session-closed' })
      return 'gone'
    }
    return 'fresh'
  }

  /**
   * The Limits for a Wave's line: asked anew first when older than FRESH_USAGE_MS (deps.usage).
   * A failed ask is logged and the line takes what there is; undefined without deps.limits. Not
   * waited for once a Force stop or the app's quit has come (Run.rush), as the last PR read, nor
   * once `cutShort` settles (before "Run wave": the click on Stop). The ask cut short goes on, and
   * its answer reaches the Limits when it comes.
   */
  private async freshLimits(run: Run, cutShort?: Promise<void>): Promise<JournalLimits | undefined> {
    if (this.deps.limits === undefined) return undefined
    if (this.deps.usage !== undefined && !run.rushed) {
      try {
        await Promise.race([this.deps.usage.refresh(FRESH_USAGE_MS), run.rushing, ...(cutShort === undefined ? [] : [cutShort])])
      } catch (error) {
        console.warn(`[autopilot] ${run.projectId}: could not ask the usage before a Wave's line`, error)
      }
    }
    return journalLimits(this.deps.limits.state())
  }

  /**
   * Whether the budget lets the next Wave go (budget.ts); `go` without deps.budget or deps.limits,
   * with the budget off, and when the journals cannot be read. The Tickets of the Wave are counted
   * from a fresh read only when there is an estimate to multiply.
   */
  private async budgetCheck(run: Run): Promise<BudgetDecision> {
    const deps = this.deps.budget
    const limits = this.deps.limits
    if (deps === undefined || limits === undefined) return { kind: 'go' }
    const budget = deps.settings()
    if (!budget.enabled) return { kind: 'go' }
    let runs: readonly (readonly JournalEvent[])[]
    try {
      runs = await deps.runs(run.projectId)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not read the journals for the budget; the Wave goes`, error)
      return { kind: 'go' }
    }
    const estimate = waveEstimate(runs)
    const tickets = estimate === null ? 0 : readyWave(await this.freshTickets(run), run.epic, run.cycle.named).ready.length
    return budgetDecision({ budget, now: (limits.now ?? Date.now)(), limits: limits.state(), runs, estimate, tickets })
  }

  /**
   * The budget stops the next Wave (ticket 41): `budget-stop` and `waiting-until` go to the journal,
   * the run waits until `until`, and the step that sends the Wave runs again then. The cycle stays
   * `sending`; the finished Wave's Tickets leave it, so a Force stop during the wait names none.
   */
  private async budgetWait(run: Run, decision: Extract<BudgetDecision, { kind: 'stop' }>): Promise<void> {
    const until = new Date(decision.until).toISOString()
    const text = budgetStopText(decision.cause, decision.until)
    await this.write(run, { kind: 'budget-stop', cause: decision.cause, share: decision.share, used: decision.used, need: decision.need, until, text })
    await this.write(run, { kind: 'waiting-until', until })
    run.cycle = { ...run.cycle, tickets: [] }
    this.cancelBudget(run)
    run.budgetIds += 1
    const id = run.budgetIds
    const limits = this.deps.limits
    const schedule = limits?.schedule ?? wallTimer(limits?.now ?? Date.now)
    const cancel = schedule(decision.until, () => void run.enqueue(() => this.budgetResume(run, id)))
    run.budget = { id, until: decision.until, cause: decision.cause, text, cancel }
    run.message = text
    this.publish(run.projectId)
  }

  /** The budget wait `id` is over: `resumed`, and the step that sends the Wave again. A wait cancelled or replaced since resumes nothing. */
  private async budgetResume(run: Run, id: number): Promise<void> {
    if (run.budget === null || run.budget.id !== id || run.cycle.phase !== 'sending') return
    this.cancelBudget(run)
    await this.write(run, { kind: 'resumed' })
    this.publish(run.projectId)
    await this.sendWave(run)
  }

  /** Cancels the budget wait's timer, and its words in `message`. */
  private cancelBudget(run: Run): void {
    const budget = run.budget
    if (budget === null) return
    run.budget = null
    budget.cancel()
    if (run.message === budget.text) run.message = null
  }

  /**
   * The Limits refused a turn of the Wave: the run waits until they reset (resume-at.ts) and then
   * sends the Orchestrator on, or stops with `limits-timeout` when the wait would be too long.
   */
  private async limitsHit(run: Run, hit: LimitsHit): Promise<void> {
    const wait = run.limits
    if (wait === null || (run.cycle.phase !== 'turn' && run.cycle.phase !== 'settling')) return
    await this.write(run, { kind: 'limits-hit', window: hit.window, resetsAt: hit.resetsAt === null ? null : new Date(toMs(hit.resetsAt)).toISOString() })
    const plan = wait.plan(hit)
    if (plan.kind === 'give-up') {
      run.message = plan.reason
      await this.feed(run, { type: 'stop', reason: 'limits-timeout' })
      return
    }
    await this.write(run, { kind: 'waiting-until', until: new Date(plan.at).toISOString() })
    const id = wait.wait(plan.at, () => void run.enqueue(() => this.resume(run, id)))
    this.publish(run.projectId)
  }

  /**
   * The wait `id` is over: the Orchestrator gets the continuation, once; a Session that is gone stops
   * the run. A wait cancelled or replaced since its timer fired resumes nothing.
   */
  private async resume(run: Run, id: number): Promise<void> {
    const wait = run.limits
    if (wait === null || !wait.isCurrent(id) || run.cycle.phase === 'stopped' || run.session === null) return
    // A graceful Stop during the wait goes with the continuation, in one message (worfy-week ticket 18).
    // Also when Stop was clicked but its step still waits behind this one: the Session would hold
    // STOP_TEXT behind the continuation's turn, which then runs without it.
    const continuation = wait.resume()
    const withStop = run.cycle.stopping || run.stopRequested
    const text = withStop ? `${continuation}\n\n${STOP_TEXT}` : continuation
    if (withStop) run.stopSent = true
    await this.write(run, { kind: 'resumed' })
    this.publish(run.projectId)
    try {
      wait.send(run.session.id, text)
    } catch (error) {
      run.message = messageOf(error)
      await this.feed(run, { type: 'session-error', message: run.message })
    }
  }

  /**
   * The graceful Stop came during the Wave's turn or its tasks (worfy-week ticket 18). A Wave that
   * still waits in the Session's queue has had no Ticket taken: the run stops at once with
   * `user-stop`, and end() takes the Wave out of the queue. Otherwise `run-stopping` goes to the
   * journal and STOP_TEXT to the Orchestrator: at once when it is idle (phase `tasks`), behind the
   * running turn otherwise. While the run waits for the Limits the Session would refuse the turn,
   * so the text goes with the continuation (resume).
   */
  private async beginStopping(run: Run, effect: { wave: number; tickets: number[]; inWork: number[] }): Promise<void> {
    if (run.waveTurn === null) {
      await this.feed(run, { type: 'stop', reason: 'user-stop' })
      return
    }
    // The gate queue's turn has no Wave and no Tickets: no run-stopping, run-stopped (`user-stop`) follows the turn.
    if (run.gateQueue === null) await this.write(run, { kind: 'run-stopping', reason: 'user-stop', wave: effect.wave, tickets: effect.tickets.map(ticketNumber), inWork: effect.inWork.map(ticketNumber) })
    // Gone already with the continuation after a Limits wait (resume), or to go with it.
    if (run.stopSent || run.limits?.until != null || run.session === null) return
    try {
      run.stopSent = true
      run.session.send(STOP_TEXT)
    } catch (error) {
      // The Session is gone: its own events end the run.
      console.warn(`[autopilot] ${run.projectId}: could not tell the Orchestrator to stop`, error)
    }
  }

  /** Whether the current Wave waits in the Session's queue while the queue is held (after an Interrupt). */
  private waveHeld(run: Run): boolean {
    const prompt = run.wavePrompt
    if (prompt === null || run.waveTurn !== null || run.session === null) return false
    try {
      const queue = run.session.queued()
      return queue.paused && queue.items.some((item) => item.text === prompt)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not read the Session's queue`, error)
      return false
    }
  }

  /**
   * A Wave still in the Session's queue when the run stops is taken out: no one would follow its
   * turn. So is STOP_TEXT of a graceful Stop that has not gone yet: a Force stop or another stop
   * came first, and the person who gets the Orchestrator back should not find it in the queue.
   */
  private dropQueuedWave(run: Run): void {
    const session = run.session
    if (session === null) return
    const prompt = run.wavePrompt !== null && run.waveTurn === null ? run.wavePrompt : null
    const stop = run.cycle.stopping ? STOP_LABEL : null
    if (prompt === null && stop === null) return
    try {
      for (const item of session.queued().items) if (item.text === prompt || item.text === stop) session.removeQueued(item.id)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not take the run's messages out of the queue`, error)
    }
  }

  /** Starts the settle time-out when the run begins settling, clears it when it stops. */
  private settleTimer(run: Run, before: CycleState['phase']): void {
    const now = run.cycle.phase
    if (now === 'settling' && before !== 'settling') {
      run.settleTimer = setTimeout(() => {
        run.settleTimer = null
        void run.enqueue(() => this.feed(run, { type: 'settle-timeout' }))
      }, this.deps.settleMs ?? SETTLE_MS)
    } else if (now !== 'settling' && run.settleTimer !== null) {
      clearTimeout(run.settleTimer)
      run.settleTimer = null
    }
  }

  /**
   * In phase `tasks`, the wait for the background tasks: their limit while any lives, the grace
   * time for the task-notification turn once none does. Set when the phase begins and, with
   * `restart`, set again on every task event; cleared in every other phase.
   */
  private tasksTimer(run: Run, restart: boolean): void {
    const clock = this.deps.tasksClock ?? realClock
    if (run.cycle.phase !== 'tasks' || restart) {
      if (run.tasksTimer !== null) clock.clearTimeout(run.tasksTimer)
      run.tasksTimer = null
    }
    if (run.cycle.phase !== 'tasks' || run.tasksTimer !== null) return
    const ms = this.liveTasks(run).length > 0 ? (this.deps.backgroundStallMs ?? BACKGROUND_STALL_MS) : (this.deps.tasksGraceMs ?? TASKS_GRACE_MS)
    const timer = clock.setTimeout(() => {
      if (run.tasksTimer !== timer) return
      run.tasksTimer = null
      void run.enqueue(() =>
        this.readAndFeed(run, 'stop', (tickets) => {
          run.turnMayCome = true
          return { type: 'tasks-timeout', tasks: this.liveTasks(run).length, tickets }
        }),
      )
    }, ms)
    run.tasksTimer = timer
  }

  /** The live background tasks of the run's Session; none when it cannot tell. */
  private liveTasks(run: Run): BackgroundTask[] {
    try {
      return run.session?.backgroundTasks() ?? []
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not read the Session's background tasks`, error)
      return []
    }
  }

  /**
   * The run is over: its reason in the journal, keep-awake released, the Orchestrator given back.
   * A stop for want of a Wave, and `tickets-done`, carry the Orchestrator's last answer in the Wave (ADR-0033), and
   * `blocked-tickets` the Tickets it stopped on.
   */
  private async end(run: Run, reason: AutopilotStopReason, tickets?: number[]): Promise<void> {
    // The narrow round's last states before the end: a Ticket blocked on `NARROW: REJECTED` is
    // journaled ahead of the run-stopped that names it. So are the Tickets' last changes of status:
    // the read after the turn that stopped the run may have seen a `done` before the watch reported
    // it, and the watch's read after the stop writes nothing (worfy-flight-recorder ticket 11). A
    // Force stop and a quit wait for neither read.
    if (reason !== 'user-force-stop' && reason !== 'app-quit') {
      const [pulls, tickets] = await Promise.all([this.lastPrs(run), this.endRead(run, () => this.freshTickets(run), [])])
      await this.journalNarrow(run, pulls)
      for (const fields of statusChanges(run, tickets)) await this.write(run, fields)
    }
    const live = this.liveTasks(run)
    const lastText = reason === 'no-progress' || reason === 'no-ready-wave' || reason === 'blocked-tickets' || reason === 'tickets-done' ? run.lastText : null
    await this.write(run, {
      kind: 'run-stopped',
      reason,
      ...(live.length > 0 ? { tasks: journalTasks(live) } : {}),
      ...(tickets === undefined ? {} : { tickets: tickets.map(ticketNumber) }),
      ...(lastText === null ? {} : { lastText }),
    })
    this.dropQueuedWave(run)
    if (reason === 'user-force-stop') {
      run.interrupted = tickets ?? []
      await this.interruptAndGiveBack(run, live)
    } else {
      // Live tasks keep the Orchestrator unattended, and the Mac awake, until they end (ADR-0029).
      // So does a turn still running: /epic-wave starts the implementers inside the Wave's turn, so
      // a stop during it may come before any task has started. The Session is read again here, after
      // the journal write: its turn may have ended meanwhile.
      const linger = reason !== 'app-quit' && run.session !== null && (this.liveTasks(run).length > 0 || inTurn(run.session.state))
      if (linger) this.linger(run)
      // On quit the Orchestrator closes with every Session: starting it again would start Claude Code.
      await this.release(run, reason !== 'app-quit', !linger)
    }
    run.done = true
    if (this.runs.get(run.projectId) === run) this.runs.delete(run.projectId)
    this.last.set(run.projectId, this.snapshot(run))
    this.publish(run.projectId)
    run.finish()
  }

  /**
   * Force stop (worfy-week tickets 17, 18, ADR-0050): no wait for the turn or the tasks. The
   * run's timers go first, so nothing of the run fires during the halt; then the Session is halted
   * (its turn interrupted, HALT_TURN_MS at most) and the Orchestrator given back at once, which
   * closes the old process and every task in it. The tasks alive at the stop, and any the turn
   * started before the interrupt reached it, are journaled as killed. Should the give-back fail,
   * the Orchestrator goes back the usual way (setUnattended), once its turn and tasks have ended.
   */
  private async interruptAndGiveBack(run: Run, atStop: readonly BackgroundTask[]): Promise<void> {
    this.stopTimers(run)
    const session = run.session
    let returned = false
    if (session !== null) {
      try {
        await session.halt(this.deps.haltTurnMs)
      } catch (error) {
        console.warn(`[autopilot] ${run.projectId}: could not halt the Orchestrator's Session`, error)
      }
      const killed = new Map(atStop.map((task) => [task.taskId, task]))
      for (const task of this.liveTasks(run)) killed.set(task.taskId, task)
      if (killed.size > 0) await this.write(run, { kind: 'tasks-killed', reason: 'user-force-stop', tasks: journalTasks([...killed.values()]) })
      try {
        returned = (await this.deps.orchestrators.giveBackNow(run.projectId)) !== null
      } catch (error) {
        console.warn(`[autopilot] ${run.projectId}: could not give the Orchestrator back at once`, error)
      }
      if (returned) await this.write(run, { kind: 'orchestrator-returned' })
    }
    await this.release(run, !returned)
  }

  /**
   * After a stop with live background tasks, or during a turn: the run's Session stays unattended
   * until the turn and the tasks have ended (orchestrator.ts gives it back then). Meanwhile every
   * change of the set goes to the journal; once the Session is closed — given back —
   * `orchestrator-returned` is written and keep-awake released. If the app quits first, the tasks
   * alive then are journaled as killed (none, when only the turn was running).
   */
  private linger(run: Run): void {
    const session = run.session
    if (session === null) return
    let unsubscribe: () => void = () => undefined
    const finish = async (last: JournalEventFields): Promise<void> => {
      if (!this.lingering.delete(quit)) return
      unsubscribe()
      await this.write(run, last)
      try {
        run.awake?.stop()
      } catch (error) {
        console.error(`[autopilot] ${run.projectId}: could not release keep-awake`, error)
      }
    }
    const quit = (): Promise<void> => finish({ kind: 'tasks-killed', reason: 'app-quit', tasks: journalTasks(this.liveTasks(run)) })
    this.lingering.add(quit)
    unsubscribe = this.deps.registry.observe((sessionId, event) => {
      if (sessionId !== session.id) return
      if (event.type === 'background_tasks') void this.write(run, { kind: 'background-tasks', tasks: journalTasks(event.tasks) })
      else if (event.type === 'state' && event.state === 'closed') void finish({ kind: 'orchestrator-returned' })
    })
  }

  /**
   * Undoes what a run holds: subscriptions, the settle, tasks and Limits timers, keep-awake (unless
   * `stopAwake` is false: a stop with live tasks keeps it), the unattended Orchestrator.
   */
  private async release(run: Run, giveBack: boolean, stopAwake = true): Promise<void> {
    this.stopTimers(run)
    for (const cleanup of run.cleanups.splice(0)) {
      try {
        await cleanup()
      } catch (error) {
        console.warn(`[autopilot] ${run.projectId}: a cleanup failed`, error)
      }
    }
    if (stopAwake) {
      try {
        run.awake?.stop()
      } catch (error) {
        console.error(`[autopilot] ${run.projectId}: could not release keep-awake`, error)
      }
    }
    if (!giveBack) return
    try {
      await this.deps.orchestrators.setUnattended(run.projectId, false)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not give the Orchestrator back`, error)
    }
  }

  /**
   * Reads the PRs of the Tickets of the run's Waves now, in the background, journals what is new
   * in the run's order, and reads again after prsEveryMs. The tracker runs gh at most once per its
   * own interval, however often it is asked.
   */
  private pollPrs(run: Run): void {
    if (this.deps.prs === undefined || run.done || run.cycle.phase === 'stopped') return
    const clock = this.deps.prsClock ?? realClock
    if (run.prsTimer !== null) clock.clearTimeout(run.prsTimer)
    const timer = clock.setTimeout(() => {
      if (run.prsTimer !== timer) return
      run.prsTimer = null
      this.pollPrs(run)
    }, this.deps.prsEveryMs ?? BASE_INTERVAL_MS)
    run.prsTimer = timer
    void this.readPrs(run).then((pulls) => run.enqueue(() => this.journalNarrow(run, pulls)))
  }

  /** The PRs of the branches of the Tickets of the run's Waves; none when there is no reader or it fails. */
  private async readPrs(run: Run): Promise<readonly PullRequest[]> {
    const prs = this.deps.prs
    if (prs === undefined || run.waveTickets.size === 0) return []
    const branches = [...run.waveTickets].map((num) => `${run.epic}/${ticketNumber(num)}`)
    try {
      return (await prs.read(run.root, branches)).pulls
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not read the pull requests`, error)
      return []
    }
  }

  /** The read of the PRs before `run-stopped` (endRead). */
  private lastPrs(run: Run): Promise<readonly PullRequest[]> {
    return this.endRead(run, () => this.readPrs(run), [])
  }

  /**
   * A read before `run-stopped`: END_READ_MS at most, and over as soon as a Force stop or the app's
   * quit comes (Run.rush); `none` when one has come already or the time is up. An answer after that is dropped.
   */
  private async endRead<T>(run: Run, read: () => Promise<T>, none: T): Promise<T> {
    if (run.rushed) return none
    const clock = this.deps.prsClock ?? realClock
    let timer: unknown = null
    const limit = new Promise<T>((done) => {
      timer = clock.setTimeout(() => done(none), this.deps.endReadMs ?? END_READ_MS)
    })
    try {
      return await Promise.race([read(), limit, run.rushing.then(() => none)])
    } finally {
      clock.clearTimeout(timer)
    }
  }

  /**
   * One `narrow-round` line for each narrow-round state on the PRs of the run's Wave Tickets not
   * journaled yet in this run, in comment order (worfy-harness ticket 20). A comment made before the
   * run started (gh's `createdAt`) belongs to an earlier run or a closed PR and is skipped; one whose
   * time gh did not give is taken. Nothing once the run is done: a read that answers after
   * run-stopped writes nothing.
   */
  private async journalNarrow(run: Run, pulls: readonly PullRequest[]): Promise<void> {
    if (run.done) return
    for (const pull of [...pulls].sort((a, b) => a.number - b.number)) {
      const ref = parseTicketBranch(pull.branch)
      if (ref === null || ref.epic !== run.epic || !run.waveTickets.has(ref.num)) continue
      for (const state of pull.narrow ?? []) {
        if (state.at !== null && Date.parse(state.at) < run.startedAt) continue
        const key = `${ref.num}:${state.outcome}`
        if (run.narrowJournaled.has(key)) continue
        run.narrowJournaled.add(key)
        await this.write(run, { kind: 'narrow-round', ticket: ticketNumber(ref.num), outcome: state.outcome, text: state.text })
      }
    }
  }

  /** Clears the settle, tasks, PR and Limits timers of the run. */
  private stopTimers(run: Run): void {
    if (run.prsTimer !== null) (this.deps.prsClock ?? realClock).clearTimeout(run.prsTimer)
    run.prsTimer = null
    if (run.settleTimer !== null) clearTimeout(run.settleTimer)
    run.settleTimer = null
    if (run.tasksTimer !== null) (this.deps.tasksClock ?? realClock).clearTimeout(run.tasksTimer)
    run.tasksTimer = null
    run.limits?.cancel()
    this.cancelBudget(run)
  }

  private async write(run: Run, fields: JournalEventFields): Promise<void> {
    if (run.journal === null) return
    try {
      await run.journal.append(fields)
    } catch (error) {
      console.error(`[autopilot] ${run.projectId}: could not write ${fields.kind} to the journal`, error)
    }
  }

  private snapshot(run: Run): AutopilotState {
    const limitsUntil = run.running ? (run.limits?.until ?? null) : null
    const budget = run.running ? run.budget : null
    const resumesAt = limitsUntil ?? budget?.until ?? null
    const waitingFor = limitsUntil !== null ? 'limits' : budget?.cause
    // From the click on: the run's step for it may still wait behind another one.
    const stopping = run.running && (run.cycle.stopping || run.stopRequested)
    return {
      projectId: run.projectId,
      epic: run.epic,
      status: !run.running ? 'stopped' : resumesAt !== null ? 'waiting' : 'running',
      wave: run.cycle.wave,
      backgroundTasks: run.running ? this.liveTasks(run).length : 0,
      resumesAt,
      ...(waitingFor === undefined ? {} : { waitingFor }),
      reason: run.done ? run.cycle.reason : null,
      message: run.message,
      resumable: run.done ? resumableOf(run) : [],
      stopping,
      ticketsInWork: stopping ? run.cycle.inWork.length : 0,
      harnessBehind: this.harness.get(run.projectId) ?? null,
      ...(run.running ? { machine: this.deps.machine?.() ?? null, unasked: [...run.unasked] } : {}),
      revision: this.revision,
    }
  }

  private publish(projectId: string): void {
    this.revision += 1
    const state = { ...this.state(projectId), revision: this.revision }
    if (!this.runs.has(projectId)) this.last.set(projectId, state)
    try {
      this.deps.onChange?.(state)
    } catch (error) {
      console.warn('[autopilot] could not report a state', error)
    }
  }
}
