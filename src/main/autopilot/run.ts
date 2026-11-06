// An Autopilot run over one Epic of a Project (worfy-daily ticket 04, ADR-0024): Waves one after
// another, without a person, until no Wave is ready or something stops the run.
//
// - The Project's Orchestrator runs as an unattended Session for the time of the run (ADR-0022):
//   it is started again with the unattended launch, continuing its SDK session, and given back
//   attended when the run ends, continuing the SDK session of the run's last Wave. The Orchestrator
//   runs on the Project's defaultVendor (worfy-multi-vendor ticket 37): the run drives it only
//   through its Session (RunSession), the same for every Vendor, and run-started names the Vendor
//   the Orchestrator's view gives. A start is refused while that Vendor lacks the `harness`
//   capability (Orchestrators.unattendedRefusal): the workflow's guarantees are not proven there.
//   On Codex it is also refused while the Harness's hooks are not approved in /hooks, or Codex does
//   not say (the driver's check, worfy-multi-vendor ticket 39), with the driver's reason; the check
//   runs again before every later Wave, and a refusal there stops the run before a Session starts.
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
//   it takes none. A Session in error during a Wave (`session-error`, worfy-retry ticket 14) leaves
//   them `resumable` too, unless a graceful Stop came first: its implementers died with the
//   Orchestrator, and a Ticket one of them claimed would otherwise wait for a person (ADR-0050,
//   Amendments).
// - A run started while the Orchestrator is busy is accepted and waits for it (worfy-autopilot-queue
//   ticket 07, ADR-0099): a turn runs, messages wait in its queue or its background tasks live
//   (Orchestrators.busy, the conditions that refuse setUnattended). The checks that need no
//   Orchestrator, and a run elsewhere, refuse the start as before. The run exists from the click: its
//   journal opens with run-started and `orchestrator-busy`, its state is `waiting` with `waitingFor:
//   'orchestrator'`, and a second start is refused as for any run. Every change of what keeps the
//   Orchestrator busy is a new `orchestrator-busy` line; the wait ends, with `orchestrator-free`, once
//   nothing does — after the last task, once the grace time for its task-notification turn has passed
//   or that turn has ended. Then the checks run again and the run takes the Orchestrator as a start
//   does; a refusal there ends it with `start-refused` and the refusal in words (also told to the
//   start's own listener: the chat that asked). The Start window, the budget, the Limits and
//   keep-awake count from then, not from the click; while it waits the run holds nothing and sends
//   nothing. Cancel (and Stop, and Force stop) during the wait ends it with `start-cancelled` and
//   leaves the Orchestrator as it is. Start now takes it at once: Orchestrators.takeNow halts its
//   Session and starts it again unattended, the tasks that die with the old process go to
//   `tasks-killed` (`start-now`), and its queued messages wait for the person's Session after the run.
// - keep-awake (power.ts) is held from the start to the end of the run.
// - A turn of the Wave refused by the Limits does not end it (worfy-daily ticket 05): the run goes
//   `waiting` until the Limits reset, then sends the Orchestrator on (limits-wait.ts). Past the
//   wait's limit it stops with `limits-timeout`. On a Vendor other than Claude (Codex,
//   worfy-multi-vendor ticket 38) a refusal without a window that resets (`limit_reached` with
//   `reason: 'quota'`) stops the run at once with `vendor-quota` and the turn's error text; after a
//   wait for a window the run reads the Vendor's windows again and waits once more while one is
//   still used up.
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
// - The Run mode (worfy-resource-planner ticket 05, ADR-0093, src/shared/autopilot/run-mode.ts): a
//   start names it (`mode`), else the default of Settings → Autopilot at the start; run-started
//   carries it. It acts only before "Run wave", where the budget did, never inside a Wave:
//   `fastest` weighs neither the budget nor the window; `budget-aware` weighs the budget with its
//   reserve, whether the budget's switch in Settings is on or not; `start-window` asks the Start
//   window first (windowDecision, by the p90 of the Waves' duration in the same journals,
//   wave-duration.ts), then the budget when its switch is on. The window and the budget are read
//   anew before each Wave; the mode stays the run's. Outside the window, or with a Wave whose p90
//   would end after it, the Wave does not go: `start-window` and `waiting-until` go to the journal,
//   the run is `waiting` with the reason in words, and at the window's next start the step that
//   sends the Wave runs again (`resumed` first), the window and then the budget checked again. The
//   window's wait and the budget's are one wait before the Wave: one at a time, ended alike by a
//   Stop, a Force stop and the quit. A Wave that goes without enough samples of duration says so in
//   `message` while it runs. A Wave that started inside the window runs to its end after it.
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
// - The Epic forecast and the actual share (worfy-resource-planner ticket 07, ADR-0093): right after
//   `run-started` and `harness-behind` the run journals `forecast`, reckoned from the start's read
//   of the workflow, the journals of the Project's recent runs (deps.budget.runs; journals that
//   cannot be read give no samples, and the run goes on), the Limits and Settings. Each Wave's
//   `wave-started` and `wave-finished` are kept as written; `run-stopped` carries `actual`, the
//   growth of the 7-day share over the run's Waves by the rule of the samples (waveGrowth), once any
//   Wave has finished, on a Force stop and a quit too.
// - The Limits of the run's Vendor (worfy-multi-vendor ticket 38, src/shared/autopilot/budget-window.ts):
//   on Claude, as above; on another Vendor the Wave lines carry that Vendor's windows ({windows}, read
//   anew before a line when older than FRESH_USAGE_MS, deps.usage.refresh with the Vendor), and the budget, the
//   estimate, the forecast and `actual` read its longest window and the journals' numbers of runs on
//   the same Vendor.
// - The gate queue's turn is asked of the Vendor first, as every Wave after the first is (waveRefused):
//   refused, the run stops with `session-error` and the reason, and no gate-queue goes.
// - A run over a queue of Epics (worfy-autopilot-queue ticket 14, ADR-0100): a start may name `epics`
//   (1 to MAX_QUEUE_EPICS, the first is `epic`, an Epic named twice runs once); named Tickets only with
//   one Epic. The run goes through the queue in order, one Epic's cycle at a time (initialCycle anew for
//   each), and `epic` of the run, of its state and of each journal line is the Epic it is on. When an
//   Epic's cycle stops, the rule of the queue (epic-queue.ts, epicOutcome) on a fresh read decides: `next`
//   — the Epic's last statuses and narrow rounds, `epic-finished` with `done` or `waits-owner`, then the
//   next Epic with `epic-started` (`index` from 1, `of`); `stop` — the whole run stops as before. With
//   no Epic left, or after a Stop, a Force stop or the quit, the run stops with the reason of the Epic it
//   was on (the gate queue's turn first, as for one Epic). Every Epic of the queue is asked at the start
//   whether it runs elsewhere (one refusal, past which only "Start anyway" goes), and each later one again
//   when it is reached: running elsewhere then, it ends with `epic-finished` `elsewhere`, unless the start
//   went with "Start anyway", and the run goes on. A run of one Epic writes neither line, and run-started
//   names `epics` only for more than one: its journal is as before the ticket. Between Waves the queue
//   may be edited (editQueue): an Epic of the Project added at its end, one not started removed; never
//   reordered. An edit during a Wave waits for its end (`wave-finished`) and is applied there; while the
//   run waits for its Orchestrator, for the budget or for the Start window it is applied at once. An applied edit writes `queue-changed`, and each Epic removed
//   `epic-finished` `removed`. An edit not applied when the run stops is dropped.
//
// worfy still writes no Ticket status (ADR-0002): the agents do, through `ticket`.
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { AutopilotWaveResult } from '../actions/launch'
import { ticketNumber } from '../../shared/actions/render-template'
import { messageText } from '../../shared/agent/attachments'
import { isTaskEvent, type BackgroundTask } from '../../shared/agent/background-tasks'
import { MAX_RETRIES } from '../../shared/agent/continue-plan'
import type { AgentEvent, QueueSnapshot, SessionState } from '../../shared/agent/events'
import { turnFailureKind, type TurnFailure } from '../../shared/agent/turn-failure'
import { budgetWindows, listsWindows, STORED_LIMITS_VENDOR, type VendorLimits } from '../../shared/autopilot/budget-window'
import { autoApprovalChatLine, type Judged } from '../../shared/autopilot/auto-approval-summary'
import { clipLastText, clipRetryMessage, journalCommand, journalLimits, journalReason, journalTarget, journalVendorLimits, type JournalEventFields, type JournalLimits, type RunStartedBy, type TicketStatusState } from '../../shared/autopilot/journal'
import { BUDGET_FRESH_MS, budgetDecision, budgetStopText, type AutopilotBudget, type BudgetCause, type BudgetDecision } from '../../shared/autopilot/budget'
import { epicOutcome, MAX_QUEUE_EPICS, nextEpic, type EpicFinish } from '../../shared/autopilot/epic-queue'
import { epicForecast, remainingWaves, type RemainingWaves } from '../../shared/autopilot/forecast'
import { fitBeforeReset } from '../../shared/autopilot/forecast-lines'
import type { JournalEvent } from '../../shared/autopilot/journal'
import { waveEstimate, waveGrowth, waveSamples, type WaveLine } from '../../shared/autopilot/limits-estimate'
import { stillUsedUp, toMs, type LimitsHit } from '../../shared/autopilot/resume-at'
import { DEFAULT_START_WINDOW, unknownDurationText, windowDecision, windowNeverFitsText, windowWaitText, type RunMode, type WindowWait, type WindowWaitReason } from '../../shared/autopilot/run-mode'
import { waveDurationP90 } from '../../shared/autopilot/wave-duration'
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
import type { AutopilotQueueEdit, AutopilotState, HarnessBehind, QueueEpicStatus } from '../../shared/ipc/autopilot'
import type { HarnessKind } from '../../shared/projects/action-templates'
import type { PullRequest } from '../../shared/ipc/checks'
import type { OrchestratorView } from '../../shared/ipc/orchestrator'
import type { OrchestratorBusy } from '../agent/orchestrator'
import type { AutopilotRunSettings, AutoApprovalMode } from '../../shared/settings/app-settings'
import type { VendorId } from '../../shared/vendors/vendor'
import { PARK_STOPPED_HINT } from '../agent/auto-approve/park'
import { HINTS, type Decision } from '../agent/auto-approve/policy'
import type { LaunchApproval, RunApproval } from '../agent/auto-approve/run-approval'
import { parseTicketBranch } from '../../shared/workflow/ticket-ref'
import { readyWave } from '../../shared/workflow/waves'
import type { WorkflowModel } from '../../shared/workflow/types'
import { BASE_INTERVAL_MS } from '../github/prs'
import type { RunStart } from './journal'
import { LimitsWait, wallTimer, type LimitsWaitDeps } from './limits-wait'
import { TurnRetry, type RetryAction, type TurnRetryDeps } from './turn-retry'

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
  /**
   * The Session runs unattended (Session.unattended): false once a stopped run gave it back to a person as it runs
   * (worfy-autopilot-queue ticket 08). Absent: read as still unattended.
   */
  readonly unattended?: boolean
  queued(): QueueSnapshot
  removeQueued(id: string): boolean
  /** The Session's live background tasks, ambient ones left out (ADR-0029). */
  backgroundTasks(): BackgroundTask[]
  /** Force stop: holds the queue, interrupts a running turn and waits for it, `timeoutMs` at most (Session.halt). */
  halt(timeoutMs?: number): Promise<unknown>
  /** A message to the Orchestrator: starts a turn when idle, else waits in the queue (Session.send); throws when the Session is gone. */
  send(text: string): unknown
  /** Ends the requests parked for the owner (worfy-auto-approve ticket 07, Session.releaseParked). */
  releaseParked?(): void
  /** How many requests wait parked for the owner (Session.parkedRequests); a task with one is waiting, not stalled. */
  parkedRequests?(): number
  /** A notice of worfy's own in the Session's view (Session.notice): the Auto-approval line at the end of a run. */
  notice?(text: string): void
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
  /** `epic`: the Epic the line is about (worfy-autopilot-queue ticket 14); absent, the run's first. */
  append(fields: JournalEventFields, epic?: string): Promise<void>
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
    /**
     * `approval`: the policy the unattended Session is launched with (worfy-auto-approve ticket 04). Going attended
     * while a turn runs or tasks live gives the Session back as it runs; `waitForWork` (a graceful Stop), or a
     * failed change, waits for their end instead (Orchestrators.setUnattended, worfy-autopilot-queue ticket 08).
     */
    setUnattended(projectId: string, unattended: boolean, approval?: LaunchApproval, options?: { waitForWork?: boolean }): Promise<OrchestratorView | null>
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
    /**
     * Why the run may not take the Project's Orchestrator, or null: the Vendor it runs on lacks the
     * Harness's guarantees, or (Codex) the Harness's hooks are not approved there now
     * (Orchestrators.unattendedRefusal, worfy-multi-vendor tickets 37 and 39). Absent: nothing is
     * refused for it.
     */
    unattendedRefusal?(projectId: string): Promise<string | null>
    /**
     * What keeps the Orchestrator busy, or null when nothing does (Orchestrators.busy, worfy-autopilot-queue
     * ticket 07): a run started meanwhile waits. Absent: a start never waits, and a busy Orchestrator refuses it.
     */
    busy?(projectId: string): OrchestratorBusy | null
    /**
     * Start now: the Orchestrator unattended at once, its turn interrupted and its old process closed
     * with its background tasks; answers the view and the tasks that died (Orchestrators.takeNow).
     */
    takeNow?(projectId: string, approval?: LaunchApproval, haltMs?: number): Promise<{ view: OrchestratorView; killed: BackgroundTask[] }>
    /** The Vendor the Orchestrator runs on (Orchestrators.runsOn): run-started of a run that waits names it. */
    runsOn?(projectId: string): VendorId
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
   * Auto-continue (worfy-retry ticket 04, turn-retry.ts): with it on for the Project, a turn that
   * ended with a temporary API error waits and then gets a continuation instead of ending the run.
   * Without it a failed turn ends the run as `turn-error`, as it did before.
   */
  retry?: TurnRetryDeps
  /**
   * Asks the usage once when a Limits window is older than `olderThanMs` (LimitsRefresher.refreshIfOlder),
   * resolving once the answer is in `limits`; without it the Wave's lines carry what `limits` has.
   * `vendor`, a Vendor other than Claude (worfy-multi-vendor ticket 38): polls that Vendor's windows
   * instead, whatever is known when `olderThanMs` is 0.
   */
  usage?: { refresh(olderThanMs: number, vendor?: string): Promise<void> }
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
  /**
   * The Run settings in force (worfy-resource-planner ticket 05, Settings → Autopilot): the default
   * Run mode, read at a start that names none, and the Start window, read before each Wave of a run
   * in `start-window`. Without it a start that names no mode goes Budget-aware while the budget is
   * on and Fastest while it is off (as autopilotRunOf), and the window is DEFAULT_START_WINDOW.
   */
  runSettings?(): AutopilotRunSettings
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
  /**
   * Auto-approval (worfy-auto-approve ticket 04): the Project's mode, read at each permission request
   * of the run's Session and at the start for run-started; and the policy's side of one run
   * (openRunApproval), opened before the Orchestrator goes unattended — one that throws leaves the run
   * without a policy. Without it the Session is launched with no policy: every request is refused.
   */
  approval?: {
    mode(projectId: string): AutoApprovalMode
    open(projectId: string, root: string, epic: string): Promise<RunApproval>
  }
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

/** The `orchestrator-busy` line of what keeps the Orchestrator busy (worfy-autopilot-queue ticket 07). */
const busyLine = (busy: OrchestratorBusy): JournalEventFields => ({ kind: 'orchestrator-busy', turn: busy.turn, queued: busy.queued, tasks: journalTasks(busy.tasks) })

/** Whether two reads of a busy Orchestrator say the same: the turn, the count of queued messages and the tasks by id. */
function sameBusy(a: OrchestratorBusy, b: OrchestratorBusy): boolean {
  return a.turn === b.turn && a.queued === b.queued && a.tasks.map((task) => task.taskId).join('\n') === b.tasks.map((task) => task.taskId).join('\n')
}

/** What run-started says of a start besides the run's own fields: whether it went past a run elsewhere, and the Auto-approval mode. */
interface RunFacts {
  override: boolean
  autoApproval: { autoApproval?: AutoApprovalMode }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** A share of the week rounded to millionths: the journal keeps 0.1, not the 0.09999999999999998 of a sum. */
const millionths = (share: number): number => Math.round(share * 1_000_000) / 1_000_000

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

/**
 * The journal line of a decision of the approval policy (worfy-auto-approve ticket 04): the command and
 * the targets cleaned (journalCommand, journalTarget: secrets as `***`, the home folder as `~`, clipped).
 */
function autoApprovalLine(event: Extract<AgentEvent, { type: 'auto_approval' }>, session: string | null, vendor: string): JournalEventFields {
  const home = homedir()
  return {
    kind: 'auto-approval',
    session,
    ...(event.agent === undefined ? {} : { agent: event.agent }),
    vendor: vendor as VendorId,
    mode: event.mode,
    outcome: event.outcome,
    rule: event.rule,
    tool: event.tool,
    targets: event.targets.map((target) => journalTarget(target, home)).filter((target) => target !== ''),
    ...(event.command === null ? {} : { command: journalCommand(event.command, home) }),
  }
}

/** What the run's Session gets when no run of the Project holds a policy now: nothing is approved. */
const NO_RUN_DECISION: Decision = { outcome: 'deny', rule: 'no-run', hint: HINTS.notJudged, targets: [] }

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
  /**
   * A run over a queue of Epics, in this order (worfy-autopilot-queue ticket 14): 1 to MAX_QUEUE_EPICS, the
   * first being the Epic started; an Epic named twice runs once. Not with `tickets` when more than one.
   * Absent: the Epic alone.
   */
  epics?: readonly string[]
  /** Who started the run; the button when absent. */
  by?: AutopilotStartedBy
  /** The Run mode of this run (worfy-resource-planner ticket 05); absent: the default mode at the start. */
  mode?: RunMode
  /**
   * Told the refusal when a run that waited for its Orchestrator is refused once it is free
   * (`start-refused`, worfy-autopilot-queue ticket 07): the start has answered by then. A start from a
   * chat shows it on the Session that asked (chat-start.ts).
   */
  onLateRefusal?: (message: string) => void
}

/** What a wait before a Wave is for: the budget's causes, or the Start window. */
type BoundaryCause = BudgetCause | 'start-window'

/** What the boundary of a Wave says (Autopilot.boundaryCheck): the Wave goes, or the budget or the window holds it back. */
type Boundary =
  | { kind: 'go'; unknownDuration: boolean }
  | { kind: 'budget'; decision: Extract<BudgetDecision, { kind: 'stop' }> }
  | { kind: 'window'; reason: WindowWaitReason; until: number; window: AutopilotRunSettings['window']; p90: number | null }
  | { kind: 'never'; window: AutopilotRunSettings['window']; p90: number }

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

/** What a start over a queue of more than one Epic that names Tickets is refused with (ticket 14). */
export const QUEUE_TICKETS_MESSAGE = 'Tickets are named only in a run of one Epic, not in a queue of Epics'

/** What a start whose queue is empty, or longer than MAX_QUEUE_EPICS, is refused with. */
export const QUEUE_SIZE_MESSAGE = `A queue holds 1 to ${MAX_QUEUE_EPICS} Epics`

/** What a start whose queue does not begin with the Epic started is refused with. */
export const queueFirstMessage = (epic: string, first: string): string => `The queue begins with Epic ${first}, not with Epic ${epic}`

/**
 * The queue of a start of `epic` (worfy-autopilot-queue ticket 14): `epics` in order without repeats, or
 * the Epic alone when absent. Throws the refusal: an empty queue or one of more than MAX_QUEUE_EPICS
 * Epics, a queue that does not begin with `epic`, and named Tickets with more than one Epic.
 */
export function startQueue(epic: string, epics: readonly string[] | undefined, tickets: readonly number[] | undefined): string[] {
  const queue = epics === undefined ? [epic] : [...new Set(epics)]
  if (queue.length === 0 || queue.length > MAX_QUEUE_EPICS) throw new Error(QUEUE_SIZE_MESSAGE)
  if (queue[0] !== epic) throw new Error(queueFirstMessage(epic, queue[0]!))
  if (tickets !== undefined && queue.length > 1) throw new Error(QUEUE_TICKETS_MESSAGE)
  return queue
}

/** What editQueue is refused with when the Project has no run that goes on. */
export const NO_RUN_MESSAGE = 'Autopilot is not running in this Project: there is no queue to change'

/** What editQueue is refused with when it names no Epic. */
export const NO_EDIT_MESSAGE = 'Name an Epic to add to the queue or to remove from it'

/** What adding an Epic to the queue of a run over named Tickets is refused with. */
export const NAMED_QUEUE_MESSAGE = 'A run over named Tickets runs one Epic: no Epic can be added to it'

/** The refusals of editQueue for one Epic. */
export const queueRefusals = {
  queued: (epic: string): string => `Epic ${epic} is in the queue already`,
  full: (): string => `The queue holds ${MAX_QUEUE_EPICS} Epics at most`,
  absent: (epic: string): string => `Epic ${epic} is not in the queue`,
  running: (epic: string): string => `Epic ${epic} is running: it cannot be removed from the queue`,
  finished: (epic: string): string => `Epic ${epic} has finished: it cannot be removed from the queue`,
}

/** What the state says of each Epic of the queue (AutopilotState.queue): its outcome, else running or next. */
const QUEUE_STATUS: Record<Exclude<EpicFinish, 'removed'>, QueueEpicStatus> = { done: 'done', 'waits-owner': 'waits-owner', elsewhere: 'elsewhere' }

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
 * Of the Tickets the run's Waves took, how many are `done` and how many `blocked` by the last read of
 * their statuses (Run.statuses): the count of the toast when the run stops (AutopilotState.ended,
 * worfy-flight-recorder ticket 20).
 */
function waveTicketCounts(run: Run): { done: number; blocked: number } {
  // The Epics of the queue the run has left are counted as they were left (Autopilot.beginEpic).
  const counts = { ...run.earlierCounts }
  for (const num of run.waveTickets) {
    const key = run.statuses.get(num)
    if (key === undefined) continue
    const [state] = JSON.parse(key) as [TicketStatusState | null]
    if (state === 'done') counts.done += 1
    else if (state === 'blocked') counts.blocked += 1
  }
  return counts
}

/**
 * What a stopped run leaves resumable (AutopilotState.resumable): after a Force stop or a Session in
 * error the Tickets of the Wave it interrupted, in a run over named Tickets those of the last Force stop it did not take,
 * and in a run that sent no Wave the Tickets it was given; in number order.
 */
function resumableOf(run: Run): number[] {
  // A run that sent no Wave took none of the Tickets it was given: they stay resumable, whatever
  // ended it (a Stop during the wait for the Start window, worfy-resource-planner ticket 05).
  const given = run.cycle.wave === 0 ? run.given : []
  return [...new Set([...given, ...run.interrupted, ...run.carried])].sort((a, b) => a - b)
}

/**
 * The Waves left in every Epic of the run's queue (worfy-autopilot-queue ticket 14), for the forecast at its start:
 * each Epic's remainingWaves one after another. Named Tickets come only with a queue of one Epic.
 */
function queueWaves(run: Run, tickets: WorkflowModel['tickets']): RemainingWaves {
  const parts = run.queue.map((epic) => remainingWaves(tickets, epic, run.cycle.named))
  return { waves: parts.flatMap((part) => part.waves), uncounted: parts.flatMap((part) => part.uncounted) }
}

/** One run of one Project. */
class Run {
  cycle: CycleState
  session: RunSession | null = null
  journal: RunJournalLike | null = null
  awake: { start(): void; stop(): void } | null = null
  /** keep-awake released for a far Limits wait (holdAwake, worfy-retry ticket 05). */
  asleep = false
  /** The run's wait for the Limits; null when the app gave no Limits (AutopilotDeps.limits). */
  limits: LimitsWait | null = null
  /** The run's retries after a temporary API error; null when the app gave no Auto-continue (AutopilotDeps.retry). */
  retry: TurnRetry | null = null
  /** The Vendor of the run's Orchestrator, as run-started names it (worfy-multi-vendor ticket 37); Claude without one. */
  vendor: string = STORED_LIMITS_VENDOR
  /** The policy's side of the run (worfy-auto-approve ticket 04); null without Auto-approval, or when it could not open. */
  approval: RunApproval | null = null
  /** The policy's decisions so far (`auto_approval` events): the line in the Orchestrator's chat at the end (worfy-auto-approve ticket 08). */
  readonly decisions: Judged[] = []
  message: string | null = null
  private chain: Promise<void> = Promise.resolve()
  readonly cleanups: (() => Promise<void> | void)[] = []
  /**
   * Drops the run's own observer of its Session's events (also one of `cleanups`): a stop that lingers drops it before
   * the linger observer comes, so no event reaches both (worfy-auto-approve ticket 08).
   */
  unobserveSession: () => void = () => undefined
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
  /** The Tickets the run was given at its start to take along (`resume` before any Wave): resumable again if no Wave goes. */
  given: readonly number[] = []
  /** Set at the click on Stop (Autopilot.stop, through requestStop), before its step runs: no new Wave goes from then on. */
  stopRequested = false
  /** Settles when `stopRequested` is set. */
  readonly stopAsked: Promise<void>
  private stopAskedDone!: () => void
  /** Whether STOP_TEXT has gone to the Orchestrator: once per run. */
  stopSent = false
  /** After a Force stop or a Session in error: the Tickets of the Wave it interrupted (AutopilotState.resumable). */
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
  /** When the run started (ms), the click: narrow-round comments made before it are not this run's. */
  readonly startedAt = Date.now()
  /**
   * The wait for the Orchestrator before the run takes it (worfy-autopilot-queue ticket 07): what keeps
   * it busy as last journaled, since when (ms), the unsubscribe of the Sessions' events, and the grace
   * timer after its last background task; null once the run has taken the Orchestrator, or never waited.
   */
  wait: { busy: OrchestratorBusy; since: number; unobserve: () => void; grace: unknown } | null = null
  /** The start went with "Start anyway": the checks made again when the Orchestrator is free go past a run elsewhere too. */
  override = false
  /** Told the refusal of the checks made again once the Orchestrator was free (AutopilotStartOptions.onLateRefusal). */
  onLateRefusal: ((message: string) => void) | null = null
  /** The Orchestrator went unattended for the run: its end gives it back. False while the run waits for it, and after a run that never took it. */
  taken = false
  /** When the run stopped (ms), for AutopilotState.ended; null while it goes on. */
  stoppedAt: number | null = null
  /**
   * The background tasks that still run in the Session a stopped run gave back to a person as it runs (worfy-autopilot-queue
   * ticket 08): the status line names them until they end. 0 otherwise.
   */
  returnedTasks = 0
  /**
   * The wait before the next Wave, of the budget (worfy-throughput ticket 41) or of the Start window
   * (worfy-resource-planner ticket 05), one at a time: its id, when the step that sends the Wave runs
   * again, why (`reason`: the window's), the reason in words and the cancel of its timer; null
   * otherwise.
   */
  boundary: { id: number; until: number; cause: BoundaryCause; reason?: WindowWaitReason; text: string; cancel: () => void } | null = null
  /** The id of the last wait before a Wave: a timer of an earlier one sends no Wave. */
  boundaryIds = 0
  /** The Run mode (worfy-resource-planner ticket 05): set at the start, the same for every Wave. */
  mode: RunMode = 'fastest'
  /** The words of `message` while a Wave goes without the check of its duration; null otherwise. */
  durationNote: string | null = null
  /** The `wave-started` of the Wave in work as the run wrote it, its `at` by the run's clock; null otherwise. */
  waveStart: WaveLine | null = null
  /**
   * What the run's finished Waves took of the week (worfy-resource-planner ticket 07): the sum of
   * their growths that count by the rule of the samples, the Waves finished, and how many counted;
   * `run-stopped.actual` once `waves` is above 0.
   */
  readonly actual = { share: 0, waves: 0, counted: 0 }
  /** Set once a Force stop or the app's quit has come: the end does not wait for gh any more. */
  rushed = false
  /** Settles when `rushed` is set. */
  readonly rushing: Promise<void>
  private rushDone!: () => void
  /** Settles once the run has stopped and cleaned up. */
  readonly ended: Promise<void>
  finish!: () => void

  /** The Epic the run is on: the queue's at `index` (worfy-autopilot-queue ticket 14). */
  epic: string
  /** The Epics of the run, in order; edited between Waves (Autopilot.editQueue): added at the end, removed if not started. */
  queue: string[]
  /** Where in `queue` the run is: the Epic it is on. */
  index = 0
  /** How each Epic of the queue the run has left ended (epic-finished); an Epic removed leaves the queue instead. */
  readonly outcomes = new Map<string, Exclude<EpicFinish, 'removed'>>()
  /** Edits of the queue made during a Wave, applied at its end (applyEdits). */
  edits: { add: string[]; remove: string[] } = { add: [], remove: [] }
  /** Waves sent over the whole run, all its Epics: every Wave after the first goes to a new SDK session. */
  wavesSent = 0
  /** Of the Tickets of the Waves of the Epics the run has left, how many were done and blocked when it left them. */
  earlierCounts = { done: 0, blocked: 0 }

  constructor(
    readonly projectId: string,
    epic: string,
    readonly root: string,
    /** The Tickets of a run over named Tickets; absent for the whole Epic. */
    named?: readonly number[],
    /** Who started the run (worfy-flight-recorder ticket 21); the journal gets it with ticket 11. */
    readonly by: AutopilotStartedBy = 'button',
    /** The queue of Epics, `epic` first (startQueue); the Epic alone when absent. */
    queue: readonly string[] = [epic],
  ) {
    this.epic = epic
    this.queue = [...queue]
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
  /** The same stopped runs by Project: ends one's wait without a journal line, when a new run takes its Orchestrator over. */
  private readonly takeOvers = new Map<string, () => void>()
  /** The last stopped state of each Project, also after its run is gone. */
  private readonly last = new Map<string, AutopilotState>()
  /** The last answer of deps.harnessDrift for each Project (AutopilotState.harnessBehind). */
  private readonly harness = new Map<string, HarnessBehind | null>()
  private revision = 0

  /** The policy each Project's unattended Session is launched with: one per Project, it asks the Project's run of the moment. */
  private readonly launchApprovals = new Map<string, LaunchApproval>()
  /** The open policy of each Project's run, until the run lets its Session go (closeApproval). */
  private readonly activeApprovals = new Map<string, RunApproval>()
  /** The policies their runs have let go (closeApproval): none of them judges again. */
  private readonly letGo = new WeakSet<RunApproval>()

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
   * run (one that waits for its Orchestrator included), on worfy's own repository in a development
   * build, when the workflow cannot be read, has no such Epic or no such Ticket in it (startRefusal),
   * and by a run of the same Epic and origin elsewhere. While the Orchestrator is busy the run is
   * accepted and waits for it (worfy-autopilot-queue ticket 07). Answers the run's first state:
   * running, or waiting for the Orchestrator.
   */
  async start(projectId: string, epic: string, options: AutopilotStartOptions = {}): Promise<AutopilotState> {
    // Taken before the first await: two starts that arrive together do not both pass.
    const live = this.runs.get(projectId)
    if (this.starting.has(projectId) || live?.running === true) throw new Error(alreadyRunning(live?.epic ?? epic))
    const queue = startQueue(epic, options.epics, options.tickets)
    const starting = { epic, origin: null as string | null }
    this.starting.set(projectId, starting)
    try {
      const { root, model } = await this.ownChecks(projectId, queue, options.tickets)
      // Counted among this Machine's runs before anyone is asked: a Linked machine starting the same
      // key meanwhile hears of this start (runKeys), as this one hears of its. Every Epic of the queue
      // is asked about at once (worfy-autopilot-queue ticket 14).
      starting.origin = await this.originOf(projectId, root)
      const check = starting.origin === null ? { elsewhere: null, unasked: [] } : await this.checkElsewhere(projectId, queue, starting.origin)
      if (check.elsewhere !== null && options.override !== true) throw check.elsewhere
      // Asked again on "Start anyway" too: once the other run has ended, the start is a plain one.
      const override = check.elsewhere !== null
      if (this.quitting) throw new Error(QUITTING_MESSAGE)

      const run = new Run(projectId, epic, root, options.tickets, options.by, queue)
      run.mode = options.mode ?? this.defaultMode()
      run.origin = starting.origin
      run.unasked = check.unasked
      run.override = options.override === true
      run.onLateRefusal = options.onLateRefusal ?? null
      // The Wave the last Force stop of this Epic interrupted goes along with the first Wave (worfy-week tickets 17, 18).
      // A run over named Tickets takes only those of its list, and keeps the rest resumable (ADR-0091).
      const last = this.last.get(projectId)
      run.resume = last?.epic === epic ? [...last.resumable] : []
      run.given = run.resume
      const named = options.tickets
      if (named !== undefined) run.carried = run.resume.filter((num) => !named.includes(num))
      // The first read of the statuses: a status from before the run is not a change of it.
      statusChanges(run, model.tickets)
      if (this.deps.limits !== undefined) run.limits = new LimitsWait(this.deps.limits)
      if (this.deps.retry !== undefined) run.retry = new TurnRetry(this.deps.retry, projectId)
      // Opened before the Orchestrator goes unattended: its Session starts with the run's TMPDIR and git environment.
      const autoApproval = await this.openApproval(run)
      const facts: RunFacts = { override, autoApproval }

      // The Orchestrator is busy: the run is accepted and waits for it (worfy-autopilot-queue ticket 07).
      const busy = this.deps.orchestrators.busy?.(projectId) ?? null
      if (busy !== null) {
        await this.waitForOrchestrator(run, busy, facts)
        return this.snapshot(run)
      }

      const deactivate = this.activateApproval(run)
      let view: OrchestratorView | null
      try {
        view = await this.deps.orchestrators.setUnattended(projectId, true, this.runLaunchApproval(projectId))
      } catch (error) {
        // A message of the person landed between the read above and the Orchestrator's answer: the run
        // waits for it, as when the read saw it.
        const late = this.deps.orchestrators.busy?.(projectId) ?? null
        if (late !== null && !this.quitting) {
          deactivate()
          await this.waitForOrchestrator(run, late, facts)
          return this.snapshot(run)
        }
        await this.closeApproval(run)
        throw error
      }
      run.taken = true
      try {
        if (!(await this.take(run, model, view, facts))) {
          // The Session failed or closed while the watch opened: the run has ended (or is ending).
          await run.ended
          return this.snapshot(run)
        }
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

  /** The policy the run's unattended Session is launched with; none without Auto-approval in the app. */
  private runLaunchApproval(projectId: string): LaunchApproval | undefined {
    return this.deps.approval === undefined ? undefined : this.launchApproval(projectId)
  }

  /**
   * The run has the Orchestrator (`view`, unattended now) and begins: its journal (run-started, unless
   * the run opened it while it waited), harness-behind and forecast, keep-awake, the Session's events
   * and the workflow's watch; a stopped run that still waited for this Session's tasks hands them
   * over. Throws what fails, with the Orchestrator already the run's. Answers false when the Session
   * failed or closed while the watch opened: the run has ended then, or ends in its order.
   */
  private async take(run: Run, model: WorkflowModel, view: OrchestratorView | null, facts: RunFacts | null): Promise<boolean> {
    if (view === null || view.sessionId === null) throw new Error('The Orchestrator has no Session')
    run.session = this.deps.registry.get(view.sessionId)
    run.vendor = view.vendor ?? STORED_LIMITS_VENDOR
    if (run.journal === null && facts !== null) run.journal = await this.openJournal(run, facts, view.vendor)
    await this.journalHarness(run)
    await this.journalForecast(run, model.tickets)
    run.awake = this.deps.keepAwake()
    run.awake.start()
    this.subscribe(run)
    const unwatch = await this.deps.watchWorkflow(run.root, () => void run.enqueue(() => this.readAndFeed(run, 'ignore', (tickets) => ({ type: 'workflow', tickets }), true)))
    if (run.cycle.phase === 'stopped') {
      // The run released what it held without this watch, so it is closed here.
      await this.unwatch(run, unwatch)
      return false
    }
    run.cleanups.push(unwatch)
    // A stopped run of the Project may still have waited for this Session's tasks: they are
    // this run's now, which journals them and holds keep-awake (worfy-polish ticket 50). Only
    // here, past the last step that can fail: a start that fails leaves them to that run.
    this.takeOvers.get(run.projectId)?.()
    return true
  }

  /**
   * Opens the run's journal with its run-started line: the origin key, `override` when the start went
   * past a run of another Machine, the Linked machines it could not ask, who started it and its named
   * Tickets (worfy-flight-recorder ticket 11), the Run mode, the Vendor and the Auto-approval mode.
   */
  private openJournal(run: Run, facts: RunFacts, vendor: VendorId | undefined): Promise<RunJournalLike> {
    return this.deps.journal({
      // The run's folder for temporary files is named by the run id: the journal takes the same one.
      ...(run.approval === null ? {} : { run: run.approval.run }),
      project: run.projectId,
      epic: run.epic,
      // A queue of more than one Epic names them all (worfy-autopilot-queue ticket 14); one Epic, as before.
      ...(run.queue.length > 1 ? { epics: [...run.queue] } : {}),
      ...(run.origin === null ? {} : { origin: run.origin }),
      ...(facts.override ? { override: true as const } : {}),
      ...(run.unasked.length > 0 ? { unasked: run.unasked } : {}),
      by: run.by,
      ...(run.cycle.named === undefined ? {} : { tickets: run.cycle.named.map(ticketNumber) }),
      mode: run.mode,
      // Whose agent runs the Waves, as the Orchestrator's view names it (worfy-multi-vendor ticket 37).
      ...(vendor === undefined ? {} : { vendor }),
      ...facts.autoApproval,
    })
  }

  /**
   * The run waits for its busy Orchestrator (worfy-autopilot-queue ticket 07): its journal opens with
   * run-started (the Vendor the Orchestrator runs on) and `orchestrator-busy`, it counts as the
   * Project's run, and every state, queue or task change of any Session reads the Orchestrator again
   * (recheck). Throws when the journal cannot open; nothing is held then.
   */
  private async waitForOrchestrator(run: Run, busy: OrchestratorBusy, facts: RunFacts): Promise<void> {
    try {
      run.journal = await this.openJournal(run, facts, this.deps.orchestrators.runsOn?.(run.projectId))
    } catch (error) {
      await this.closeApproval(run)
      throw error
    }
    const unobserve = this.deps.registry.observe((_sessionId, event) => {
      if (event.type === 'state' || event.type === 'queue' || event.type === 'background_tasks') void run.enqueue(() => this.recheck(run))
    })
    run.wait = { busy, since: Date.now(), unobserve, grace: null }
    this.runs.set(run.projectId, run)
    this.starting.delete(run.projectId)
    await this.write(run, busyLine(busy))
    this.publish(run.projectId)
    // What changed between the read and the subscription.
    void run.enqueue(() => this.recheck(run))
  }

  /**
   * Reads the Orchestrator again for a run that waits: a change of what keeps it busy is a new
   * `orchestrator-busy` line; once nothing does, `orchestrator-free` and the run takes it (begin).
   * After the last background task the run waits the grace time for the turn its task-notification
   * starts (TASKS_GRACE_MS, as the run's own wait for its tasks): taking the Orchestrator then would
   * close that turn's process.
   */
  private async recheck(run: Run): Promise<void> {
    const wait = run.wait
    if (wait === null || run.done || run.cycle.phase === 'stopped') return
    const busy = this.deps.orchestrators.busy?.(run.projectId) ?? null
    const clock = this.deps.tasksClock ?? realClock
    if (busy !== null) {
      if (wait.grace !== null) clock.clearTimeout(wait.grace)
      wait.grace = null
      if (sameBusy(busy, wait.busy)) return
      wait.busy = busy
      await this.write(run, busyLine(busy))
      this.publish(run.projectId)
      return
    }
    if (wait.grace !== null) return
    if (wait.busy.tasks.length > 0) {
      // The tasks are over; the state says so, the journal waits for what comes next.
      wait.busy = { turn: false, queued: 0, tasks: [] }
      const timer = clock.setTimeout(() => {
        void run.enqueue(async () => {
          if (run.wait !== wait || wait.grace !== timer) return
          wait.grace = null
          await this.recheck(run)
        })
      }, this.deps.tasksGraceMs ?? TASKS_GRACE_MS)
      wait.grace = timer
      this.publish(run.projectId)
      return
    }
    await this.write(run, { kind: 'orchestrator-free' })
    await this.begin(run, false)
  }

  /**
   * A run that waited takes the Orchestrator: when it is free (`now` false), or at Start now. The
   * checks of the start run again first (startChecks); a refusal ends the run with `start-refused`.
   * Start now halts the Orchestrator's Session and starts it again unattended at once (takeNow): the
   * tasks that died with its process go to `tasks-killed` (`start-now`), then `orchestrator-free`.
   * When the Orchestrator was free but is busy again by the time it is asked (a person wrote
   * meanwhile), the run goes on waiting.
   */
  private async begin(run: Run, now: boolean): Promise<void> {
    let model: WorkflowModel
    try {
      model = await this.startChecks(run)
    } catch (error) {
      await this.refuse(run, error)
      return
    }
    // The quit ends the run in its order (stopAll), behind this step.
    if (this.quitting) return
    const deactivate = this.activateApproval(run)
    const approval = this.runLaunchApproval(run.projectId)
    let view: OrchestratorView | null
    if (now) {
      // A stopped run that still waited for this Session's tasks: its wait ends here, with no line of
      // its own, before the Session's process closes.
      this.takeOvers.get(run.projectId)?.()
      try {
        const taken = await this.deps.orchestrators.takeNow?.(run.projectId, approval, this.deps.haltTurnMs)
        if (taken === undefined) throw new Error('Start now is not available in this build')
        if (taken.killed.length > 0) await this.write(run, { kind: 'tasks-killed', reason: 'start-now', tasks: journalTasks(taken.killed) })
        view = taken.view
      } catch (error) {
        await this.refuse(run, error)
        return
      }
      await this.write(run, { kind: 'orchestrator-free' })
    } else {
      try {
        view = await this.deps.orchestrators.setUnattended(run.projectId, true, approval)
      } catch (error) {
        const busy = this.deps.orchestrators.busy?.(run.projectId) ?? null
        const wait = run.wait
        if (busy === null || wait === null) {
          await this.refuse(run, error)
          return
        }
        // Waiting again, the run's policy judges nothing until it takes the Orchestrator.
        deactivate()
        wait.busy = busy
        await this.write(run, busyLine(busy))
        this.publish(run.projectId)
        return
      }
    }
    run.taken = true
    this.leaveWait(run)
    // The statuses read now are the run's first: a change during the wait is not the run's.
    statusChanges(run, model.tickets)
    try {
      if (!(await this.take(run, model, view, null))) return
    } catch (error) {
      await this.refuse(run, error)
      return
    }
    this.publish(run.projectId)
    void run.enqueue(() => this.feed(run, { type: 'start', tickets: model.tickets, resume: run.resume }))
  }

  /**
   * The checks of a start, made again when a run that waited takes its Orchestrator: those that need
   * no Orchestrator (ownChecks), then a run of the same Epic and origin elsewhere, past which only
   * "Start anyway" goes. Throws the refusal; answers a fresh read of the workflow.
   */
  private async startChecks(run: Run): Promise<WorkflowModel> {
    const { model } = await this.ownChecks(run.projectId, run.queue, run.cycle.named)
    if (run.origin === null) return model
    const check = await this.checkElsewhere(run.projectId, run.queue, run.origin)
    if (check.elsewhere !== null && !run.override) throw check.elsewhere
    return model
  }

  /** A run that waited is refused when it takes its Orchestrator: `start-refused`, its words in the state, the journal and to the start's listener. */
  private async refuse(run: Run, error: unknown): Promise<void> {
    const message = messageOf(error)
    run.message = message
    console.warn(`[autopilot] ${run.projectId}: the run that waited for the Orchestrator did not start: ${message}`)
    try {
      run.onLateRefusal?.(message)
    } catch (failed) {
      console.warn(`[autopilot] ${run.projectId}: could not tell the start's listener that it was refused`, failed)
    }
    await this.feed(run, { type: 'stop', reason: 'start-refused' })
  }

  /** The run no longer waits for its Orchestrator: the Sessions' events and the grace timer go. */
  private leaveWait(run: Run): void {
    const wait = run.wait
    if (wait === null) return
    run.wait = null
    wait.unobserve()
    if (wait.grace !== null) (this.deps.tasksClock ?? realClock).clearTimeout(wait.grace)
  }

  /**
   * Start now (worfy-autopilot-queue ticket 07): a run that waits for its Orchestrator takes it at once
   * (begin). Answers the state once the run has taken it, or has stopped with `start-refused`; a run
   * that does not wait (any more) is left as it is.
   */
  async startNow(projectId: string): Promise<AutopilotState> {
    const run = this.runs.get(projectId)
    if (run === undefined) return this.state(projectId)
    await run.enqueue(async () => {
      if (run.wait === null || run.cycle.phase === 'stopped') return
      await this.begin(run, true)
    })
    return this.state(projectId)
  }

  /**
   * Changes the queue of the Project's run (worfy-autopilot-queue ticket 14): `add` an Epic of the Project at its
   * end, one not in it; `remove` an Epic not started yet (or one whose adding still waits). Never reorders.
   * Between Waves — while the run waits for its Orchestrator, for the budget or for the Start window, or before
   * its first Wave — the change applies at once; during a Wave it waits for the Wave's end (applyEdits). Throws
   * the refusal: no run, nothing named, the Epic in the queue already or not in it, the queue full, an Epic the
   * Project has not, the Epic running or finished, an Epic added to a run over named Tickets. Answers the state.
   */
  async editQueue(projectId: string, edit: AutopilotQueueEdit): Promise<AutopilotState> {
    const run = this.runs.get(projectId)
    if (run === undefined) throw new Error(NO_RUN_MESSAGE)
    let refusal: string | null = NO_RUN_MESSAGE
    await run.enqueue(async () => {
      refusal = await this.edit(run, edit)
    })
    if (refusal !== null) throw new Error(refusal)
    return this.state(projectId)
  }

  /** editQueue in the run's order: the refusal, or null once the change is made (or waits for the Wave's end). */
  private async edit(run: Run, edit: AutopilotQueueEdit): Promise<string | null> {
    if (run.cycle.phase === 'stopped') return NO_RUN_MESSAGE
    const { add, remove } = edit
    if (add === undefined && remove === undefined) return NO_EDIT_MESSAGE
    if (add !== undefined) {
      if (run.cycle.named !== undefined) return NAMED_QUEUE_MESSAGE
      if (run.queue.includes(add) || run.edits.add.includes(add)) return queueRefusals.queued(add)
      if (run.queue.length + run.edits.add.length >= MAX_QUEUE_EPICS) return queueRefusals.full()
      const model = await this.freshModel(run)
      if (typeof model === 'string') return model
      const unknown = startRefusal(model, add)
      if (unknown !== null) return unknown
    }
    // An Epic whose adding waits for the end of the Wave is taken back; any other must be in the queue, not started.
    const takenBack = remove !== undefined && run.edits.add.includes(remove)
    if (remove !== undefined && !takenBack) {
      const at = run.queue.indexOf(remove)
      if (at === -1) return queueRefusals.absent(remove)
      if (at === run.index) return queueRefusals.running(remove)
      if (at < run.index) return queueRefusals.finished(remove)
    }
    if (takenBack) run.edits.add = run.edits.add.filter((epic) => epic !== remove)
    else if (remove !== undefined && !run.edits.remove.includes(remove)) run.edits.remove.push(remove)
    if (add !== undefined) run.edits.add.push(add)
    // Between Waves — waiting for the Orchestrator, the budget or the Start window — the change is made now.
    if (run.wait !== null || run.boundary !== null) await this.applyEdits(run)
    return null
  }

  /** A fresh read of the workflow model, or the refusal in words when it cannot be read. */
  private async freshModel(run: Run): Promise<WorkflowModel | string> {
    let model: WorkflowModel
    try {
      model = await this.deps.workflow(run.root)
    } catch (error) {
      return `Cannot read the workflow: ${messageOf(error)}`
    }
    return model.error === null ? model : `Cannot read the workflow: ${model.error.message}`
  }

  /**
   * The edits of the queue that wait (Run.edits) are made: the Epics removed leave it, those added join its end;
   * `queue-changed` names both, and each Epic removed gets `epic-finished` `removed`, on a line of its own Epic.
   */
  private async applyEdits(run: Run): Promise<void> {
    const { add, remove } = run.edits
    if (add.length === 0 && remove.length === 0) return
    run.edits = { add: [], remove: [] }
    run.queue = [...run.queue.filter((epic) => !remove.includes(epic)), ...add]
    await this.write(run, { kind: 'queue-changed', ...(add.length === 0 ? {} : { added: add }), ...(remove.length === 0 ? {} : { removed: remove }) })
    for (const epic of remove) await this.write(run, { kind: 'epic-finished', outcome: 'removed' }, epic)
    this.publish(run.projectId)
  }

  /**
   * The cycle of the Epic the run is on has stopped with `effect` (worfy-autopilot-queue ticket 14). Unless a Stop,
   * a Force stop or the quit has come, and while an Epic of the queue is left, the rule of the queue judges the stop
   * on a fresh read (epicOutcome). `next`: the Epic's last narrow
   * rounds and statuses, `epic-finished` with its outcome, and the next Epic begins (beginEpic). Answers whether
   * the run goes on; false — no Epic left, the rule says stop, the workflow cannot be read — and the run stops
   * with `effect` as for one Epic.
   */
  private async moveOn(run: Run, effect: { reason: AutopilotStopReason }): Promise<boolean> {
    if (run.stopRequested || run.rushed || this.quitting) return false
    if (nextEpic(run.queue, run.index, run.outcomes) === null) return false
    const model = await this.freshModel(run)
    if (typeof model === 'string') {
      console.warn(`[autopilot] ${run.projectId}: the queue stops: ${model}`)
      return false
    }
    const outcome = epicOutcome(effect.reason, model.tickets, run.epic)
    if (outcome.kind === 'stop') return false
    await this.journalNarrow(run, await this.lastPrs(run))
    for (const fields of statusChanges(run, model.tickets)) await this.write(run, fields)
    run.outcomes.set(run.epic, outcome.outcome)
    await this.write(run, { kind: 'epic-finished', outcome: outcome.outcome, ...(outcome.outcome === 'waits-owner' ? { tickets: outcome.tickets.map(ticketNumber) } : {}) })
    return this.beginEpic(run, model)
  }

  /**
   * The run begins the next Epic of its queue: one that runs elsewhere now (a run of the same Epic and origin on
   * another Machine or in another Project) gets `epic-finished` `elsewhere` and is passed, unless the start went
   * with "Start anyway". The Epic begun: what was the last Epic's (its Wave Tickets, statuses, narrow rounds, the
   * Tickets to take along) is left behind with its counts kept, a new cycle, `epic-started` with its place in the
   * queue, the first read of its statuses, and the cycle's start. False when no Epic is left, or a stop has come.
   */
  private async beginEpic(run: Run, model: WorkflowModel): Promise<boolean> {
    for (;;) {
      const next = nextEpic(run.queue, run.index, run.outcomes)
      if (next === null) return false
      const elsewhere = run.origin === null || run.override ? null : (await this.checkElsewhere(run.projectId, [next.epic], run.origin)).elsewhere
      // A Stop, a Force stop or the quit meanwhile: the run stops on the Epic it was on.
      if (run.stopRequested || run.rushed || this.quitting) return false
      if (elsewhere !== null) {
        console.warn(`[autopilot] ${run.projectId}: ${elsewhere.message}; the queue goes on without it`)
        run.outcomes.set(next.epic, 'elsewhere')
        await this.write(run, { kind: 'epic-finished', outcome: 'elsewhere' }, next.epic)
        continue
      }
      run.earlierCounts = waveTicketCounts(run)
      run.waveTickets.clear()
      run.narrowJournaled.clear()
      run.resume = []
      run.given = []
      run.epic = next.epic
      run.index = next.index
      run.cycle = initialCycle(next.epic)
      await this.write(run, { kind: 'epic-started', index: next.index + 1, of: run.queue.length })
      // The Epic's first read of the statuses: a status from before the run reached it is not a change.
      statusChanges(run, model.tickets)
      await this.feed(run, { type: 'start', tickets: model.tickets, resume: [] })
      return true
    }
  }

  /**
   * The checks of a start that need no Orchestrator and no Linked machine: worfy's own repository in
   * a development build, the "Run wave" template, the Vendor of the Orchestrator (its `harness`
   * capability), the workflow, each Epic of the queue and the named Tickets (of a queue of one).
   * Throws the refusal; answers the root and the model read.
   */
  private async ownChecks(projectId: string, queue: readonly string[], tickets: readonly number[] | undefined): Promise<{ root: string; model: WorkflowModel }> {
    const root = this.deps.projectRoot(projectId)
    const refusal = (await this.deps.selfRefusal(root)) ?? this.deps.waves.autopilotRefusal(projectId) ?? (await this.deps.orchestrators.unattendedRefusal?.(projectId)) ?? null
    if (refusal !== null) throw new Error(refusal)
    const model = await this.deps.workflow(root)
    if (model.error !== null) throw new Error(`Cannot read the workflow: ${model.error.message}`)
    for (const epic of queue) {
      const unknown = startRefusal(model, epic, tickets)
      if (unknown !== null) throw new Error(unknown)
    }
    return { root, model }
  }

  /**
   * Why a start of `epic` would be refused now, without starting anything: a run of the Project,
   * the checks of start() that need no Orchestrator (ownChecks), and — without `override` — a run
   * of the same Epic and origin elsewhere. Null when start() would go past them. The Orchestrator's
   * own state is not asked here: a busy one refuses no start (worfy-autopilot-queue ticket 07). No
   * start of the app asks it since that ticket; test/contract/codex-orchestrator.test.ts (worfy-multi-vendor
   * ticket 39) does, to show a Run on Codex would start once its hooks are approved, without starting one.
   */
  async startCheck(projectId: string, epic: string, options: AutopilotStartOptions = {}): Promise<string | null> {
    const running = this.runningEpic(projectId)
    if (running !== null) return alreadyRunning(running)
    try {
      const queue = startQueue(epic, options.epics, options.tickets)
      const { root } = await this.ownChecks(projectId, queue, options.tickets)
      if (options.override === true) return null
      const origin = await this.originOf(projectId, root)
      if (origin === null) return null
      return (await this.checkElsewhere(projectId, queue, origin)).elsewhere?.message ?? null
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
   * Where else an Epic of `epics` of the same origin runs or starts: another Project of this Machine,
   * or a Linked machine (`elsewhere`, for the first such Epic in the order of `epics`, null when
   * nowhere); and the Linked machines that could not be asked. The Linked machines are asked once.
   */
  private async checkElsewhere(projectId: string, epics: readonly string[], origin: string): Promise<{ elsewhere: RunningElsewhere | null; unasked: string[] }> {
    const keys = this.keys()
    for (const epic of epics) {
      for (const [other, key] of keys) {
        if (other === projectId || key.epic !== epic || key.origin !== origin) continue
        const here = this.deps.machine?.()?.name
        return { elsewhere: new RunningElsewhere(epic, here === undefined ? `this Machine (Project ${other})` : `${here} (this Machine, Project ${other})`), unasked: [] }
      }
    }
    if (this.deps.linkedRuns === undefined) return { elsewhere: null, unasked: [] }
    let answers: readonly LinkedRuns[]
    try {
      answers = await this.deps.linkedRuns()
    } catch (error) {
      console.warn(`[autopilot] ${projectId}: could not ask the Linked machines for their runs`, error)
      return { elsewhere: null, unasked: [] }
    }
    const unasked = answers.filter((answer) => answer.runs === null).map((answer) => answer.machine)
    for (const epic of epics) {
      const hit = answers.find((answer) => answer.runs?.some((key) => key.epic === epic && key.origin === origin) === true)
      if (hit !== undefined) return { elsewhere: new RunningElsewhere(epic, hit.machine), unasked }
    }
    return { elsewhere: null, unasked }
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
   * stopped. A second Stop while stopping sends nothing and answers the state; during a wait to retry
   * after an API error it ends the run (worfy-retry ticket 04).
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
      if (run.cycle.phase === 'stopped') return
      // Waiting for its Orchestrator, the run has nothing to finish: Stop cancels it (worfy-autopilot-queue ticket 07).
      if (run.wait !== null) {
        await this.feed(run, { type: 'stop', reason: 'start-cancelled' })
        return
      }
      // Waiting to retry after an API error with no turn under way: nothing goes on that a graceful
      // Stop would wait for, also when an earlier Stop made the run stopping (worfy-retry ticket 04).
      if (run.retry?.until != null && !this.turnUnderWay(run)) {
        await this.feed(run, { type: 'stop', reason: 'user-stop' })
        return
      }
      // Likewise a Limits wait past 24 h that only Auto-continue keeps (worfy-retry ticket 05): the run
      // would otherwise stay unattended for days.
      if (run.limits?.until != null && run.limits.far && !this.turnUnderWay(run)) {
        await this.feed(run, { type: 'stop', reason: 'user-stop' })
        return
      }
      if (run.cycle.stopping) return
      // Waiting for the budget or the Start window before a Wave: no Wave is in work, the run ends
      // now (worfy-throughput ticket 41, worfy-resource-planner ticket 05).
      if (run.boundary !== null) {
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
    // A run that waits for its Orchestrator has not taken it: nothing of the person's is interrupted (worfy-autopilot-queue ticket 07).
    await run.enqueue(() => this.feed(run, { type: 'stop', reason: run.wait !== null ? 'start-cancelled' : 'user-force-stop' }))
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
    const unobserve = this.deps.retry?.observe?.(() => void run.enqueue(async () => void (await this.farWaitDropped(run))))
    if (unobserve !== undefined) run.cleanups.push(unobserve)
    run.unobserveSession = this.deps.registry.observe((sessionId, event) => {
      if (run.session === null || sessionId !== run.session.id) return
      this.onEvent(run, event)
      // During a far Limits wait (worfy-retry ticket 05): a turn or a task that starts takes keep-awake
      // back, and the end of the last task lets it go. The end of a turn decides in the run's order:
      // passed() keeps it, a refusal waits again (waitForLimits).
      if (run.asleep || (event.type === 'background_tasks' && run.limits?.until != null)) this.holdAwake(run)
    })
    run.cleanups.push(
      () => run.unobserveSession(),
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
        run.retry?.turnStarted()
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
        // And how the turn failed, with its external calls, for Auto-continue (worfy-retry ticket 04).
        const failure: TurnFailure = run.retry === null ? { kind: 'none' } : turnFailureKind({ vendor: run.vendor, isError: event.isError, interrupted: event.interrupted, error: message, terminalReason: event.terminalReason })
        const actions = failure.kind === 'transient' ? (run.retry?.actions() ?? []) : []
        // The background tasks the turn left alive, as of its end: a task that ends later starts a
        // turn of its own (its task-notification), and that turn's result judges the Wave.
        const tasks = this.liveTasks(run).length
        void run.enqueue(async () => {
          // A turn ahead of the Wave that finished normally after an Interrupt still leaves the
          // queue held: the Wave waits in it until a person resumes, so the run stops as interrupted.
          const interrupted = event.interrupted || (!run.endsWave(turn) && this.waveHeld(run))
          if (!run.endsWave(turn) && !interrupted) return
          // The answer of a turn of the Wave, for run-stopped (ADR-0033).
          if (run.endsWave(turn) && event.text !== null && event.text.trim() !== '') run.lastText = clipLastText(event.text)
          if (hit !== null && !interrupted) return this.limitsHit(run, hit, message)
          // A turn of the Wave that was not refused ends any wait (a person's turn during it, too).
          // A wait it ends gets its `resumed`, so the journal shows where the wait stopped and
          // the Wave's duration does not count the rest of the Wave as waiting (wave-duration.ts).
          const waiting = run.limits?.until != null
          run.limits?.passed()
          this.holdAwake(run)
          run.turnMayCome = false
          if (waiting) await this.write(run, { kind: 'resumed' })
          const retried = await this.retryTurn(run, { failure, actions, interrupted, message })
          if (retried.waits) return
          return this.readAndFeed(run, 'stop', (tickets) => ({
            type: 'turn-ended',
            isError: event.isError,
            interrupted,
            message: retried.message === '' ? null : retried.message,
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
      case 'auto_approval':
        // A decision is a sign of life of whoever asked: the limit of the tasks starts over at once, so a park
        // that just ended is not overtaken by that limit (worfy-auto-approve ticket 07).
        this.tasksTimer(run, true)
        run.decisions.push({ mode: event.mode, outcome: event.outcome })
        void run.enqueue(() => this.write(run, autoApprovalLine(event, run.session?.id ?? null, run.vendor)))
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
        run.retry?.observe(event)
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
          const tickets = effect.tickets.map(ticketNumber)
          // Their worktrees are the policy's roots from now on (worfy-auto-approve ticket 04).
          run.approval?.setWave(tickets, run.epic)
          run.waveStart = this.waveLine(run, { kind: 'wave-started', wave: effect.wave, tickets, ...(run.sentLimits === undefined ? {} : { limits: run.sentLimits }) })
          await this.write(run, {
            kind: 'wave-started',
            wave: effect.wave,
            tickets,
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
          this.noteDuration(run, null)
          const limits = await this.freshLimits(run)
          const fields = { kind: effect.kind, wave: effect.wave, tickets: effect.tickets.map(ticketNumber), ...(limits === undefined ? {} : { limits }) }
          this.countActual(run, this.waveLine(run, fields))
          await this.write(run, fields)
          // The end of a Wave: the edits of the queue made during it apply now (worfy-autopilot-queue ticket 14).
          await this.applyEdits(run)
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
          else if (await this.moveOn(run, effect)) break
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
    // The turn goes to the Orchestrator unattended, as a Wave does: the Vendor is asked first
    // (worfy-multi-vendor ticket 39). Refused: `session-error` with the reason, and the run stops with it.
    const refusal = await this.vendorRefusal(run)
    if (refusal === 'rushed' || run.stopRequested) return false
    if (refusal !== null) {
      run.message = refusal
      await this.write(run, { kind: 'session-error', session: run.session?.id ?? null, message: refusal })
      run.cycle = { ...run.cycle, phase: 'stopped', reason: 'session-error' }
      await this.end(run, 'session-error')
      return true
    }
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
    // The Run mode at the boundary: the window, the budget on the number just asked (ticket 41); not
    // weighed once a stop has come.
    const boundary = run.stopRequested || run.rushed ? null : await this.boundaryCheck(run)
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
    if (boundary?.kind === 'never') {
      // No night of this window fits the Wave: the run stops rather than waiting every night (ticket 05).
      run.message = windowNeverFitsText(boundary.window, run.cycle.wave + 1, boundary.p90)
      await this.feed(run, { type: 'stop', reason: 'window-too-short' })
      return
    }
    if (boundary?.kind === 'window') {
      await this.windowWait(run, boundary)
      return
    }
    if (boundary?.kind === 'budget') {
      await this.budgetWait(run, boundary.decision)
      return
    }
    // Before every Wave after the run's first the Vendor is asked again (worfy-multi-vendor ticket 39):
    // an update of the Harness since the start turns Codex's hooks off. Refused: no Session starts, and
    // the run stops with the reason (waveRefused). A Stop clicked meanwhile ends the run as above.
    if (run.wavesSent > 0 && (await this.waveRefused(run))) return
    if (run.stopRequested) {
      await this.feed(run, { type: 'stop', reason: 'user-stop' })
      return
    }
    // Every Wave after the run's first goes to a new SDK session (worfy-throughput ticket 52), the first
    // Wave of a later Epic of the queue too (worfy-autopilot-queue ticket 14).
    const fresh = run.wavesSent > 0 && !run.turnMayCome && this.deps.harness() !== 'legacy' ? await this.newSession(run) : 'same'
    if (fresh === 'gone') return
    // A Stop, a Force stop or the quit while the new session started: the Wave does not go, as above.
    if (run.stopRequested) {
      await this.feed(run, { type: 'stop', reason: 'user-stop' })
      return
    }
    if (run.rushed) return
    // A Wave the window let go without a duration to check says so while it runs (ticket 05).
    this.noteDuration(run, boundary?.kind === 'go' && boundary.unknownDuration ? unknownDurationText(run.cycle.wave + 1) : null)
    run.sending = true
    run.promptsWhileSending.clear()
    // Only the run's first Wave takes the interrupted Tickets along.
    const resume = run.resume
    run.resume = []
    try {
      sent = await this.deps.waves.autopilotWave(run.projectId, run.epic, resume, fresh === 'fresh', run.cycle.named)
      run.wavesSent += 1
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
   * Whether the Vendor of the Orchestrator refuses the next Wave now (Orchestrators.unattendedRefusal,
   * worfy-multi-vendor ticket 39): Codex while the Harness's hooks are not approved in /hooks, or Codex
   * does not say. Refused: the run stops with `session-error` and the reason, which the journal keeps,
   * before any Session starts; answers true. A check that throws refuses too. A Force stop or the quit
   * does not wait for the answer: true, and their stop step ends the run.
   */
  private async waveRefused(run: Run): Promise<boolean> {
    const refusal = await this.vendorRefusal(run)
    if (refusal === 'rushed') return true
    if (refusal === null) return false
    run.message = refusal
    await this.feed(run, { type: 'session-error', message: refusal })
    return true
  }

  /**
   * Why the Vendor of the Orchestrator refuses an unattended turn now (Orchestrators.unattendedRefusal),
   * or null; a check that throws refuses with its error. `rushed`: a Force stop or the quit came first,
   * and the answer is not waited for.
   */
  private async vendorRefusal(run: Run): Promise<string | null | 'rushed'> {
    const check = this.deps.orchestrators.unattendedRefusal
    if (check === undefined) return null
    const asked = check.call(this.deps.orchestrators, run.projectId).then(
      (refusal) => ({ refusal }),
      (error: unknown) => ({ refusal: `Cannot check the Orchestrator's Vendor: ${messageOf(error)}` }),
    )
    const answer = await Promise.race([asked, run.rushing.then(() => null)])
    return answer === null ? 'rushed' : answer.refusal
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
    if (listsWindows(run.vendor)) return this.freshVendorLimits(run, cutShort)
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
   * freshLimits on a Vendor other than Claude (worfy-multi-vendor ticket 38): its windows are read
   * anew first (deps.usage.refresh with the Vendor: one poll when none is known or one is older than
   * FRESH_USAGE_MS), cut short as the usage's ask is; a failed read is logged and the line takes what
   * there is.
   */
  private async freshVendorLimits(run: Run, cutShort?: Promise<void>): Promise<JournalLimits | undefined> {
    const wait = run.limits
    if (wait === null) return undefined
    if (this.deps.usage !== undefined && !run.rushed) {
      try {
        await Promise.race([this.deps.usage.refresh(FRESH_USAGE_MS, run.vendor), run.rushing, ...(cutShort === undefined ? [] : [cutShort])])
      } catch (error) {
        console.warn(`[autopilot] ${run.projectId}: could not read the Limits of ${run.vendor} before a Wave's line`, error)
      }
    }
    return journalVendorLimits(run.vendor, wait.windowsOf(run.vendor))
  }

  /** The windows of the run's Vendor when it is not Claude, for the budget and the forecast (budget-window.ts); undefined on Claude. */
  private vendorLimits(run: Run): VendorLimits | undefined {
    if (!listsWindows(run.vendor)) return undefined
    return { vendor: run.vendor, windows: run.limits?.windowsOf(run.vendor) ?? this.deps.limits?.windows?.(run.vendor) ?? [] }
  }

  /** The Run mode a start that names none goes in: the default of Settings → Autopilot (AutopilotDeps.runSettings). */
  private defaultMode(): RunMode {
    if (this.deps.runSettings !== undefined) return this.deps.runSettings().mode
    return this.deps.budget?.settings().enabled === true ? 'budget-aware' : 'fastest'
  }

  /** The clock of the waits before a Wave: the Limits' when given (the test's), else the real one. */
  private now(): number {
    return (this.deps.limits?.now ?? Date.now)()
  }

  /**
   * The boundary of the next Wave by the Run mode (worfy-resource-planner ticket 05): Fastest lets
   * it go; Budget-aware weighs the budget even with its switch off; Start window asks the window,
   * then the budget only with its switch on. The journals are read once, for the window's p90 and
   * the budget both; a failed read leaves the window no duration and lets the budget go.
   */
  private async boundaryCheck(run: Run): Promise<Boundary> {
    if (run.mode === 'fastest') return { kind: 'go', unknownDuration: false }
    const runs = await this.recentRuns(run)
    let unknownDuration = false
    if (run.mode === 'start-window') {
      const window = this.deps.runSettings?.().window ?? DEFAULT_START_WINDOW
      const { p90 } = waveDurationP90(runs ?? [])
      const decision = windowDecision({ window, now: this.now(), p90 })
      if (decision.kind === 'never') return { kind: 'never', window, p90: decision.p90 }
      if (decision.kind === 'wait') return { kind: 'window', reason: decision.reason, until: decision.until, window, p90 }
      unknownDuration = decision.unknownDuration
    }
    const budget = await this.budgetCheck(run, runs, run.mode === 'budget-aware')
    return budget.kind === 'stop' ? { kind: 'budget', decision: budget } : { kind: 'go', unknownDuration }
  }

  /** The events of the Project's recent runs (deps.budget.runs); null without the dep, or when they cannot be read. */
  private async recentRuns(run: Run): Promise<readonly (readonly JournalEvent[])[] | null> {
    const deps = this.deps.budget
    if (deps === undefined) return null
    try {
      return await deps.runs(run.projectId)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not read the journals for the boundary of the Wave; it is not held back by them`, error)
      return null
    }
  }

  /**
   * Whether the budget lets the next Wave go (budget.ts); `go` without deps.budget or deps.limits,
   * with the budget off unless `always` (Budget-aware), and when the journals could not be read
   * (`runs` null). The Tickets of the Wave are counted from a fresh read only when there is an
   * estimate to multiply.
   */
  private async budgetCheck(run: Run, runs: readonly (readonly JournalEvent[])[] | null, always: boolean): Promise<BudgetDecision> {
    const deps = this.deps.budget
    const limits = this.deps.limits
    if (deps === undefined || limits === undefined || runs === null) return { kind: 'go' }
    const settings = deps.settings()
    const budget = always ? { ...settings, enabled: true } : settings
    if (!budget.enabled) return { kind: 'go' }
    const estimate = waveEstimate(runs, run.vendor)
    const tickets = estimate === null ? 0 : readyWave(await this.freshTickets(run), run.epic, run.cycle.named).ready.length
    const vendor = this.vendorLimits(run)
    return budgetDecision({ budget, now: this.now(), limits: limits.state(), runs, estimate, tickets, ...(vendor === undefined ? {} : { vendor }) })
  }

  /** The budget stops the next Wave (ticket 41): `budget-stop` and `waiting-until` go to the journal, and the run waits (waitAtBoundary). */
  private async budgetWait(run: Run, decision: Extract<BudgetDecision, { kind: 'stop' }>): Promise<void> {
    const until = new Date(decision.until).toISOString()
    const text = budgetStopText(decision.cause, decision.until)
    await this.write(run, { kind: 'budget-stop', cause: decision.cause, share: decision.share, used: decision.used, need: decision.need, until, text })
    await this.write(run, { kind: 'waiting-until', until })
    this.waitAtBoundary(run, { until: decision.until, cause: decision.cause, text })
  }

  /**
   * The Start window holds the next Wave back (ticket 05): `start-window` and `waiting-until` go to
   * the journal, and the run waits until the window's next start (waitAtBoundary).
   */
  private async windowWait(run: Run, wait: Extract<Boundary, { kind: 'window' }>): Promise<void> {
    const until = new Date(wait.until).toISOString()
    const words: WindowWait =
      wait.reason === 'wave-too-long' && wait.p90 !== null
        ? { reason: 'wave-too-long', window: wait.window, until: wait.until, wave: run.cycle.wave + 1, p90: wait.p90 }
        : { reason: 'outside', window: wait.window, until: wait.until }
    const text = windowWaitText(words)
    await this.write(run, { kind: 'start-window', reason: wait.reason, until, text, ...(wait.p90 === null ? {} : { durationP90Ms: Math.round(wait.p90) }) })
    await this.write(run, { kind: 'waiting-until', until })
    this.waitAtBoundary(run, { until: wait.until, cause: 'start-window', reason: wait.reason, text })
  }

  /**
   * The run waits before the next Wave until `until`, and the step that sends the Wave runs again
   * then. The cycle stays `sending`; the finished Wave's Tickets leave it, so a Force stop during the
   * wait names none. A wait still set is replaced: one wait at a time.
   */
  private waitAtBoundary(run: Run, wait: { until: number; cause: BoundaryCause; reason?: WindowWaitReason; text: string }): void {
    run.cycle = { ...run.cycle, tickets: [] }
    this.cancelBoundary(run)
    run.boundaryIds += 1
    const id = run.boundaryIds
    const limits = this.deps.limits
    const schedule = limits?.schedule ?? wallTimer(limits?.now ?? Date.now)
    const cancel = schedule(wait.until, () => void run.enqueue(() => this.boundaryResume(run, id)))
    run.boundary = { id, ...wait, cancel }
    run.message = wait.text
    this.publish(run.projectId)
  }

  /** The wait `id` before a Wave is over: `resumed`, and the step that sends the Wave again. A wait cancelled or replaced since resumes nothing. */
  private async boundaryResume(run: Run, id: number): Promise<void> {
    // Every way out of phase `sending` is a stop, and every stop cancels the wait (stopTimers) in the
    // step that ends the run, ahead of this one: a wait still current is one in `sending`.
    if (run.boundary === null || run.boundary.id !== id) return
    this.cancelBoundary(run)
    await this.write(run, { kind: 'resumed' })
    this.publish(run.projectId)
    await this.sendWave(run)
  }

  /** Cancels the timer of the wait before a Wave, and its words in `message`. */
  private cancelBoundary(run: Run): void {
    const boundary = run.boundary
    if (boundary === null) return
    run.boundary = null
    boundary.cancel()
    if (run.message === boundary.text) run.message = null
  }

  /** Sets the words of a Wave that goes without the check of its duration (`text`), or clears them (null). */
  private noteDuration(run: Run, text: string | null): void {
    if (run.durationNote !== null && run.message === run.durationNote) run.message = null
    run.durationNote = text
    if (text !== null) run.message = text
  }

  /**
   * The run's `forecast` line (worfy-resource-planner ticket 07), right after run-started and
   * harness-behind: the Epic forecast from the start's read of the workflow (`tickets`), the samples
   * and durations of the Project's recent runs, the Limits and Settings. Written only with
   * deps.budget, the source of those journals; journals that cannot be read give no samples. Never
   * throws: the run goes on without the line.
   */
  private async journalForecast(run: Run, tickets: WorkflowModel['tickets']): Promise<void> {
    const budget = this.deps.budget
    if (budget === undefined) return
    try {
      let runs: readonly (readonly JournalEvent[])[] = []
      try {
        runs = await budget.runs(run.projectId)
      } catch (error) {
        console.warn(`[autopilot] ${run.projectId}: could not read the journals for the forecast; it goes without samples`, error)
      }
      const now = this.now()
      const limits = this.deps.limits?.state() ?? { windows: {} }
      const vendor = this.vendorLimits(run)
      const forecast = epicForecast({ samples: waveSamples(runs, run.vendor), waves: queueWaves(run, tickets) })
      const duration = waveDurationP90(runs)
      const settings = budget.settings()
      // The budget acts in Budget-aware whatever its switch says, in Start window only with it on
      // (boundaryCheck); only then has the Run a recommendation, and `fit` its K (the spec: null without one).
      const budgetActs = run.mode === 'budget-aware' || (run.mode === 'start-window' && settings.enabled)
      // The 7-day window on Claude; the longest window of another Vendor (budget-window.ts).
      const week = budgetWindows(limits, vendor).week
      const fresh = week !== null && week.utilization !== null && now - week.receivedAt <= BUDGET_FRESH_MS
      await this.write(run, {
        kind: 'forecast',
        mode: run.mode,
        waves: forecast.waves,
        tickets: forecast.tickets,
        uncounted: forecast.uncounted,
        samples: forecast.samples,
        low: forecast.range === null ? null : millionths(forecast.range.low),
        high: forecast.range === null ? null : millionths(forecast.range.high),
        fit: budgetActs ? fitBeforeReset({ forecast, limits, now, reserve: settings.reserve, ...(vendor === undefined ? {} : { vendor }) }) : null,
        week: fresh ? { utilization: week.utilization!, resetsAt: week.resetsAt === null ? null : new Date(toMs(week.resetsAt)).toISOString() } : null,
        durationP90Ms: duration.p90 === null ? null : Math.round(duration.p90),
        durationSamples: duration.samples,
        ...(run.mode === 'start-window' ? { window: { ...(this.deps.runSettings?.().window ?? DEFAULT_START_WINDOW) } } : {}),
      })
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not reckon the forecast; the run goes on without it`, error)
    }
  }

  /** A Wave's line as the journal gets it, with `at` by the run's clock (the Limits' in a test), for waveGrowth. */
  private waveLine(run: Run, fields: Omit<WaveLine, 'at' | 'run' | 'project' | 'epic'>): WaveLine {
    return { ...fields, at: new Date(this.now()).toISOString(), run: run.journal?.run ?? '', project: run.projectId, epic: run.epic } as WaveLine
  }

  /** A Wave has finished: it counts in `actual`, and its growth too when it gives one by the rule of the samples. */
  private countActual(run: Run, finished: WaveLine): void {
    const started = run.waveStart?.wave === finished.wave ? run.waveStart : null
    run.waveStart = null
    run.actual.waves += 1
    const growth = started === null ? null : waveGrowth(started, finished, run.vendor)
    if (growth === null) return
    run.actual.counted += 1
    run.actual.share += growth
  }

  /** Whether a turn of the run's Session is under way now. */
  private turnUnderWay(run: Run): boolean {
    return run.session !== null && inTurn(run.session.state)
  }

  /**
   * Auto-continue at the end of a turn (worfy-retry ticket 04): a temporary API error with the switch
   * on waits for a continuation (`turn-retry`, `waits`); any other failure with the switch on is
   * refused (`retry-refused`) and goes to the cycle as before, with the words of the give-up after
   * the last retry. A turn that ends any other way ends a wait and the count of retries.
   */
  private async retryTurn(run: Run, end: { failure: TurnFailure; actions: readonly RetryAction[]; interrupted: boolean; message: string | null }): Promise<{ waits: boolean; message: string | null }> {
    const retry = run.retry
    const { failure, message } = end
    if (retry === null) return { waits: false, message }
    // A wait this turn ends gets its `resumed`, as a Limits wait does (wave-duration.ts).
    const waited = retry.until !== null
    if (end.interrupted || failure.kind === 'none' || run.cycle.phase === 'stopped' || !retry.enabled()) {
      retry.passed()
      if (waited) await this.write(run, { kind: 'resumed' })
      return { waits: false, message }
    }
    const decision = retry.decide(failure, end.actions)
    if (decision.kind === 'retry' && failure.kind === 'transient') {
      retry.wait(decision, { error: failure.error, actions: end.actions, message }, (id) => void run.enqueue(() => this.retryResume(run, id)))
      await this.write(run, { kind: 'turn-retry', attempt: decision.attempt, of: decision.of, error: failure.error, message: clipRetryMessage(message ?? ''), until: new Date(retry.until ?? this.now()).toISOString() })
      this.publish(run.projectId)
      return { waits: true, message }
    }
    retry.passed()
    const reason = decision.kind === 'refused' ? decision.reason : 'not-transient'
    const inFlight = decision.kind === 'refused' ? decision.inFlight : []
    const home = homedir()
    // The command as the model wrote it is masked, not worfy's summary: the summary drops the option
    // names (`--token x` becomes `x`) that the masking goes by.
    const lines = new Map(end.actions.map((action) => [action.toolUseId, action.command]))
    const commands = inFlight.map((action) => journalCommand(lines.get(action.toolUseId) ?? action.description, home))
    await this.write(run, { kind: 'retry-refused', reason, ...(commands.length === 0 ? {} : { actions: commands }) })
    if (reason !== 'cap') return { waits: false, message }
    const gaveUp = `gave up after ${MAX_RETRIES} retries`
    return { waits: false, message: message === null || message === '' ? gaveUp : `${message} — ${gaveUp}` }
  }

  /**
   * The retry wait `id` is over: the Orchestrator gets the continuation, once. A wait cancelled or
   * replaced since its timer fired sends nothing; so does a Stop on its way (its step ends the run).
   * A turn under way ends the wait with `resumed`, and that turn's end decides. Auto-continue
   * switched off meanwhile: the wait is dropped and the failed turn's end goes to the cycle.
   */
  private async retryResume(run: Run, id: number): Promise<void> {
    const retry = run.retry
    if (retry === null || !retry.isCurrent(id) || run.cycle.phase === 'stopped' || run.session === null || run.rushed || this.quitting) return
    if (run.stopRequested && !run.cycle.stopping) return
    if (this.turnUnderWay(run)) {
      // That turn's end decides; the wait is over, so the Canvas shows the run running, not a retry due.
      retry.cancel()
      await this.write(run, { kind: 'resumed' })
      this.publish(run.projectId)
      return
    }
    if (!retry.enabled()) {
      const message = retry.failed?.message ?? null
      retry.passed()
      this.publish(run.projectId)
      return this.readAndFeed(run, 'stop', (tickets) => ({
        type: 'turn-ended',
        isError: true,
        interrupted: false,
        message,
        tickets,
        tasks: this.liveTasks(run).length,
        idle: run.session?.state === 'idle',
      }))
    }
    const text = retry.resume()
    await this.write(run, { kind: 'resumed' })
    this.publish(run.projectId)
    try {
      retry.send(run.session.id, text)
    } catch (error) {
      run.message = messageOf(error)
      await this.feed(run, { type: 'session-error', message: run.message })
    }
  }

  /**
   * The Limits refused a turn of the Wave: the run waits until they reset (resume-at.ts) and then
   * sends the Orchestrator on, or stops with `limits-timeout` when the wait would be too long. A
   * refusal by a quota (Codex, nothing resets) stops it at once with `vendor-quota` and the turn's
   * error text `message` (worfy-multi-vendor ticket 38).
   */
  private async limitsHit(run: Run, hit: LimitsHit, message: string | null): Promise<void> {
    const wait = run.limits
    if (wait === null || (run.cycle.phase !== 'turn' && run.cycle.phase !== 'settling')) return
    // The Limits wait takes over a wait to retry after an API error: one wait, one resumed (worfy-retry ticket 04).
    run.retry?.cancel()
    const said = message === null || message.trim() === '' ? null : clipLastText(message)
    await this.write(run, {
      kind: 'limits-hit',
      window: hit.window,
      resetsAt: hit.resetsAt === null ? null : new Date(toMs(hit.resetsAt)).toISOString(),
      ...(hit.quota === true ? { reason: 'quota' as const, ...(said === null ? {} : { message: said }) } : {}),
    })
    // Auto-continue on: a reset more than 24 h away is waited for (worfy-retry ticket 05).
    const plan = wait.plan(hit, run.retry?.enabled() === true)
    if (plan.kind === 'quota') {
      run.message = said ?? `${run.vendor} refused the turn by its Limits, and nothing resets`
      await this.feed(run, { type: 'stop', reason: 'vendor-quota' })
      return
    }
    if (plan.kind === 'give-up') {
      run.message = plan.reason
      await this.feed(run, { type: 'stop', reason: 'limits-timeout' })
      return
    }
    // A Stop came before a refusal whose wait passes 24 h (worfy-retry ticket 05): no wait of days for it.
    if (plan.kind === 'at' && plan.far === true && (run.cycle.stopping || run.stopRequested)) {
      await this.feed(run, { type: 'stop', reason: 'user-stop' })
      return
    }
    await this.waitForLimits(run, wait, plan.at)
  }

  /** The run sleeps until `at` (`waiting-until`), then resumes (resume). */
  private async waitForLimits(run: Run, wait: LimitsWait, at: number): Promise<void> {
    await this.write(run, { kind: 'waiting-until', until: new Date(at).toISOString() })
    const id = wait.wait(
      at,
      () => void run.enqueue(() => this.resume(run, id)),
      () => void run.enqueue(() => this.wake(run, id)),
    )
    this.holdAwake(run)
    this.publish(run.projectId)
  }

  /**
   * keep-awake during a Limits wait (worfy-retry ticket 05, spec Q8 (c), ADR-0097): released while the
   * continuation is more than 24 h away (LimitsWait.keepAwake), no turn is under way and no background
   * task lives (ADR-0029); held again as soon as one of them is no longer so.
   */
  private holdAwake(run: Run): void {
    if (run.awake === null || run.cycle.phase === 'stopped') return
    const asleep = run.limits !== null && !run.limits.keepAwake && !this.turnUnderWay(run) && this.liveTasks(run).length === 0
    if (asleep === run.asleep) return
    run.asleep = asleep
    try {
      if (asleep) run.awake.stop()
      else run.awake.start()
    } catch (error) {
      console.error(`[autopilot] ${run.projectId}: could not ${asleep ? 'release' : 'take'} keep-awake`, error)
    }
  }

  /** 24 h before the continuation of a far wait: keep-awake again, unless Auto-continue is off by now (farWaitDropped). */
  private async wake(run: Run, id: number): Promise<void> {
    const wait = run.limits
    if (wait === null || !wait.isCurrent(id) || run.cycle.phase === 'stopped') return
    if (await this.farWaitDropped(run)) return
    this.holdAwake(run)
  }

  /**
   * A Limits wait past 24 h exists only because Auto-continue is on (LimitsWait.far): with the switch
   * off by now, it is dropped and the run stops with `limits-timeout`, as it would have at the refusal
   * without the switch. Read when the switch changes (TurnRetryDeps.observe) and at the wait's timers.
   * Answers whether the run stopped.
   */
  private async farWaitDropped(run: Run): Promise<boolean> {
    const wait = run.limits
    if (wait === null || wait.until === null || !wait.far || run.cycle.phase === 'stopped' || run.retry?.enabled() === true) return false
    wait.cancel()
    run.message = 'Auto-continue was turned off while the run waited for a Limits reset more than 24 h away'
    await this.feed(run, { type: 'stop', reason: 'limits-timeout' })
    return true
  }

  /**
   * After a wait on a Vendor other than Claude: its windows read anew (deps.usage.refresh with the
   * Vendor and age 0, a poll whatever is known), then judged as known. A window still used up with its
   * reset ahead gives the time to wait until once more; null goes on — no window used up, or a read
   * that failed and left windows whose resets have passed (the turn then shows whether it is refused).
   * A Force stop or the quit does not wait for the read (Run.rush): the caller then sees `rushed` and
   * sends nothing, whatever this answers.
   */
  private async stillRefused(run: Run, wait: LimitsWait): Promise<LimitsHit | null> {
    if (!listsWindows(run.vendor)) return null
    if (this.deps.usage !== undefined && !run.rushed) {
      try {
        await Promise.race([this.deps.usage.refresh(0, run.vendor), run.rushing])
      } catch (error) {
        console.warn(`[autopilot] ${run.projectId}: could not read the Limits of ${run.vendor} after the wait; the windows known decide`, error)
      }
    }
    return stillUsedUp(wait.windowsOf(run.vendor), wait.clock())
  }

  /**
   * The wait `id` is over: the Orchestrator gets the continuation, once; a Session that is gone stops
   * the run. A wait cancelled or replaced since its timer fired resumes nothing.
   */
  private async resume(run: Run, id: number): Promise<void> {
    const wait = run.limits
    if (wait === null || !wait.isCurrent(id) || run.cycle.phase === 'stopped' || run.session === null) return
    // A far wait whose switch was turned off meanwhile continues nothing (worfy-retry ticket 05).
    if (await this.farWaitDropped(run)) return
    // On another Vendor, the windows are read again first: still used up, the run waits once more.
    const again = await this.stillRefused(run, wait)
    // Read anew after the read: a stop may have come meanwhile. A Force stop or the quit waits behind this
    // step in the run's order: no continuation (a paid turn) goes out before it.
    const phase = run.cycle.phase as CycleState['phase']
    if (!wait.isCurrent(id) || phase === 'stopped' || run.session === null || run.rushed || this.quitting) return
    if (again !== null) {
      const plan = wait.plan(again, run.retry?.enabled() === true)
      if (plan.kind === 'give-up') {
        wait.cancel()
        run.message = plan.reason
        await this.feed(run, { type: 'stop', reason: 'limits-timeout' })
        return
      }
      if (plan.kind === 'at') {
        await this.waitForLimits(run, wait, plan.at)
        return
      }
    }
    // A graceful Stop during the wait goes with the continuation, in one message (worfy-week ticket 18).
    // Also when Stop was clicked but its step still waits behind this one: the Session would hold
    // STOP_TEXT behind the continuation's turn, which then runs without it.
    const continuation = wait.resume()
    this.holdAwake(run)
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
    // A request parked for the owner would hold the turn or the task the stop waits for (worfy-auto-approve ticket 07).
    run.session?.releaseParked?.()
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
      // A task whose request waits parked for the owner is waiting, not stalled: the limit starts over.
      if ((run.session?.parkedRequests?.() ?? 0) > 0) return this.tasksTimer(run, false)
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
    // Force stop and a quit wait for neither read, and nor does a run that never took the Orchestrator
    // (it waited for it, worfy-autopilot-queue ticket 07): it sent nothing and watched nothing.
    this.leaveWait(run)
    if (run.taken && reason !== 'user-force-stop' && reason !== 'app-quit') {
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
      ...(run.actual.waves === 0 ? {} : { actual: { ...run.actual, share: millionths(run.actual.share) } }),
      ...(reason === 'start-refused' && run.message !== null ? { message: clipLastText(run.message) } : {}),
    })
    this.dropQueuedWave(run)
    if (reason === 'user-force-stop' || reason === 'session-error') run.interrupted = tickets ?? []
    if (reason === 'user-force-stop') {
      this.noticeDecisions(run)
      await this.interruptAndGiveBack(run, live)
    } else {
      // Live tasks, and a turn still running, are not killed (ADR-0029): /epic-wave starts the implementers inside the
      // Wave's turn, so a stop during it may come before any task has started. The Session is read again here, after
      // the journal write: its turn may have ended meanwhile. A stop of the run's own (an error, a limit, the cycle's
      // end) gives the Session back to a person as it runs, the tasks living on in it (worfy-autopilot-queue ticket 08);
      // a graceful Stop, or a give-back that did not change the Session, keeps it unattended, and the Mac awake, until
      // they end.
      let linger = reason !== 'app-quit' && run.session !== null && (this.liveTasks(run).length > 0 || inTurn(run.session.state))
      const asked = linger && run.taken && reason !== 'user-stop'
      const returned = asked && (await this.giveBackAsItRuns(run))
      if (returned) linger = false
      if (linger) {
        // keep-awake released for a far Limits wait comes back for that turn or those tasks (worfy-retry ticket 05).
        if (run.asleep) {
          try {
            run.awake?.start()
          } catch (error) {
            console.error(`[autopilot] ${run.projectId}: could not take keep-awake`, error)
          }
        }
        this.linger(run)
      } else if (!returned) {
        this.noticeDecisions(run)
      }
      // On quit the Orchestrator closes with every Session: starting it again would start Claude Code.
      // A run that never took it leaves it as it is, and one that asked for it as it runs already did. A
      // graceful Stop lets the turn and the tasks end unattended.
      await this.release(run, run.taken && reason !== 'app-quit' && !asked, !linger && !returned, { waitForWork: reason === 'user-stop' })
    }
    // A stopped run's state does not say a Wave goes unchecked.
    this.noteDuration(run, null)
    run.stoppedAt = Date.now()
    run.done = true
    if (this.runs.get(run.projectId) === run) this.runs.delete(run.projectId)
    this.last.set(run.projectId, this.snapshot(run))
    this.publish(run.projectId)
    run.finish()
  }

  /**
   * The one line of the policy's decisions in the Orchestrator's chat, once, when the run is over (worfy-auto-approve
   * ticket 08): at its stop when nothing lingers, else once its turn and tasks have ended, the app quits or the next
   * run takes the Session over (linger) — so the decisions of the tasks after run-stopped count too. None without a
   * decision.
   */
  private noticeDecisions(run: Run): void {
    const line = autoApprovalChatLine(run.decisions)
    if (line === null || run.session === null) return
    try {
      run.session.notice?.(line)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not show the Auto-approval line in the Orchestrator's chat`, error)
    }
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
   * `orchestrator-returned` is written and keep-awake released. The policy's decisions meanwhile are journaled
   * as during the run (worfy-auto-approve ticket 08). If the app quits first, the tasks
   * alive then are journaled as killed (none, when only the turn was running). A new run of the
   * Project may take the Session over meanwhile (worfy-polish ticket 50): the wait then ends with
   * no line of its own, and the tasks are the new run's.
   */
  private linger(run: Run): void {
    const session = run.session
    if (session === null) return
    let unsubscribe: () => void = () => undefined
    const end = (): boolean => {
      if (!this.lingering.delete(quit)) return false
      if (this.takeOvers.get(run.projectId) === takeOver) this.takeOvers.delete(run.projectId)
      unsubscribe()
      return true
    }
    const stopAwake = (): void => {
      try {
        run.awake?.stop()
      } catch (error) {
        console.error(`[autopilot] ${run.projectId}: could not release keep-awake`, error)
      }
    }
    const finish = async (last: JournalEventFields): Promise<void> => {
      if (!end()) return
      await this.write(run, last)
      stopAwake()
      this.noticeDecisions(run)
      await this.closeApproval(run)
    }
    const quit = (): Promise<void> => finish({ kind: 'tasks-killed', reason: 'app-quit', tasks: journalTasks(this.liveTasks(run)) })
    // A new run took the Session as it runs: the tasks go on in that run, and nothing more of this
    // one's journal follows its run-stopped.
    const takeOver = (): void => {
      if (!end()) return
      stopAwake()
      this.noticeDecisions(run)
      void this.closeApproval(run, false)
    }
    this.lingering.add(quit)
    this.takeOvers.set(run.projectId, takeOver)
    // The run's own observer goes first, at once rather than later in release(): an event that comes meanwhile would
    // reach both and be journaled twice.
    run.unobserveSession()
    unsubscribe = this.deps.registry.observe((sessionId, event) => {
      if (sessionId !== session.id) return
      if (event.type === 'background_tasks') void this.write(run, { kind: 'background-tasks', tasks: journalTasks(event.tasks) })
      else if (event.type === 'auto_approval') {
        // The Session is still under the run's policy (closeApproval waits for the end): its decisions are the run's.
        // The next run opens its own policy before it takes the Session over: a decision under that one is the next run's.
        if (this.activeApprovals.get(run.projectId) !== (run.approval ?? undefined)) return
        run.decisions.push({ mode: event.mode, outcome: event.outcome })
        void this.write(run, autoApprovalLine(event, session.id, run.vendor))
      } else if (event.type === 'state' && event.state === 'closed') void finish({ kind: 'orchestrator-returned' })
    })
    // Given back already, before the observer came (giveBackAsItRuns: its turn and tasks ended while the change was tried).
    if (session.state === 'closed') void finish({ kind: 'orchestrator-returned' })
  }

  /**
   * A stop of the run's own while its Session has a turn or background tasks (worfy-autopilot-queue ticket 08, ADR-0029
   * Amendments): the Session goes back to a person as it runs (Orchestrators.setUnattended, Session.becomeAttended), so
   * the tasks live on in the person's Session. Answers whether it did. Then the journal says `orchestrator-returned` with
   * the tasks still alive, the policy's line goes to the chat, the policy lets the Session go (its folder stays: the
   * process keeps it as TMPDIR, and the next start of the app removes it), and keep-awake stays until those tasks end
   * (watchReturned). False when the Session stayed unattended — the change failed and it waits for its turn and tasks,
   * or they ended meanwhile and it was started again — so the stop lingers as before; the give-back was asked for already.
   */
  private async giveBackAsItRuns(run: Run): Promise<boolean> {
    const session = run.session
    if (session === null) return false
    // Nothing of the run fires, and no event of the Session reaches the run's observer, during the change.
    this.stopTimers(run)
    run.unobserveSession()
    try {
      await this.deps.orchestrators.setUnattended(run.projectId, false)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not give the Orchestrator back`, error)
    }
    if (session.unattended !== false) return false
    const live = this.liveTasks(run)
    await this.write(run, { kind: 'orchestrator-returned', ...(live.length > 0 ? { tasks: journalTasks(live) } : {}) })
    this.noticeDecisions(run)
    await this.closeApproval(run, false)
    this.watchReturned(run, session, live.length)
    return true
  }

  /**
   * keep-awake and the status line of a run that gave its Session back as it runs (giveBackAsItRuns): the Mac stays awake
   * while the turn the run left, or the tasks alive at the give-back or started since, go on — so it does not sleep in the
   * middle of their work (ADR-0029) — and the stopped run's line counts the tasks. Both end once no turn runs and no task
   * lives, or the Session is closed. If the app quits first, the tasks alive then are journaled as killed (none, when only
   * a turn ran).
   */
  private watchReturned(run: Run, session: RunSession, tasks: number): void {
    const stopAwake = (): void => {
      try {
        run.awake?.stop()
      } catch (error) {
        console.error(`[autopilot] ${run.projectId}: could not release keep-awake`, error)
      }
    }
    const working = (): boolean => this.liveTasks(run).length > 0 || inTurn(session.state)
    run.returnedTasks = tasks
    if (!working()) {
      run.returnedTasks = 0
      stopAwake()
      return
    }
    // keep-awake released for a far Limits wait comes back for that turn or those tasks (worfy-retry ticket 05).
    if (run.asleep) {
      try {
        run.awake?.start()
      } catch (error) {
        console.error(`[autopilot] ${run.projectId}: could not take keep-awake`, error)
      }
    }
    let unsubscribe: () => void = () => undefined
    const end = (): boolean => {
      if (!this.lingering.delete(quit)) return false
      unsubscribe()
      stopAwake()
      return true
    }
    const count = (n: number): void => {
      if (run.returnedTasks === n) return
      run.returnedTasks = n
      // Only while the stopped run's state is the one shown: a later run of the Project shows its own.
      if (this.runs.has(run.projectId) || run.journal === null || this.last.get(run.projectId)?.run !== run.journal.run) return
      this.last.set(run.projectId, this.snapshot(run))
      this.publish(run.projectId)
    }
    const quit = async (): Promise<void> => {
      const live = this.liveTasks(run)
      if (!end()) return
      await this.write(run, { kind: 'tasks-killed', reason: 'app-quit', tasks: journalTasks(live) })
    }
    this.lingering.add(quit)
    unsubscribe = this.deps.registry.observe((sessionId, event) => {
      if (sessionId !== session.id) return
      if (event.type === 'background_tasks') count(event.tasks.length)
      else if (event.type !== 'state') return
      if (session.state === 'closed') count(0)
      if (session.state === 'closed' || !working()) end()
    })
    // The turn and the tasks may have ended between the give-back and the observer.
    if (!working()) {
      count(0)
      end()
    }
  }

  /**
   * Undoes what a run holds: subscriptions, the settle, tasks and Limits timers, keep-awake (unless
   * `stopAwake` is false: a stop with live tasks keeps it), the unattended Orchestrator.
   */
  private async release(run: Run, giveBack: boolean, stopAwake = true, how: { waitForWork?: boolean } = {}): Promise<void> {
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
    if (giveBack) {
      try {
        await this.deps.orchestrators.setUnattended(run.projectId, false, undefined, how.waitForWork === true ? { waitForWork: true } : {})
      } catch (error) {
        console.warn(`[autopilot] ${run.projectId}: could not give the Orchestrator back`, error)
      }
    }
    // A stop with live tasks keeps the policy and the run's folder until they end (linger).
    if (stopAwake) await this.closeApproval(run)
  }

  /**
   * The run's policy judges the Project's unattended Session from now on: right before the run takes
   * the Orchestrator. A run that waits for it opened its policy at the click, but the stopped run whose
   * Session may still linger keeps judging until then (worfy-autopilot-queue ticket 07). Answers the
   * undo, for a run that goes back to waiting: the policy active before judges again, unless it has
   * been let go meanwhile (closeApproval); else none does.
   */
  private activateApproval(run: Run): () => void {
    const approval = run.approval
    if (approval === null) return () => undefined
    const previous = this.activeApprovals.get(run.projectId)
    this.activeApprovals.set(run.projectId, approval)
    return () => {
      if (this.activeApprovals.get(run.projectId) !== approval) return
      if (previous === undefined || this.letGo.has(previous)) this.activeApprovals.delete(run.projectId)
      else this.activeApprovals.set(run.projectId, previous)
    }
  }

  /**
   * Opens the policy's side of the run (AutopilotDeps.approval, worfy-auto-approve ticket 04); answers
   * what run-started says of it: nothing at Off, the mode at Shadow and On, `off` at Shadow or On when it
   * could not open — the run then goes without a policy, as at Off.
   */
  private async openApproval(run: Run): Promise<{ autoApproval?: AutoApprovalMode }> {
    const approval = this.deps.approval
    if (approval === undefined) return {}
    const mode = this.approvalMode(run.projectId)
    try {
      run.approval = await approval.open(run.projectId, run.root, run.epic)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: Auto-approval is off for this run, its policy could not start: ${messageOf(error)}`)
    }
    if (mode === 'off') return {}
    return { autoApproval: run.approval === null ? 'off' : mode }
  }

  /** The Project's Auto-approval mode now; Off when it cannot be read. */
  private approvalMode(projectId: string): AutoApprovalMode {
    try {
      return this.deps.approval?.mode(projectId) ?? 'off'
    } catch (error) {
      console.warn(`[autopilot] ${projectId}: could not read the Auto-approval mode, Off is in force`, error)
      return 'off'
    }
  }

  /**
   * The policy the Project's unattended Session is launched with: the same object for every run of the
   * Project, since a Session a new run takes over as it runs keeps its launch. It asks the run that
   * holds the policy now: with none, the mode is Off and nothing is approved.
   */
  private launchApproval(projectId: string): LaunchApproval {
    const known = this.launchApprovals.get(projectId)
    if (known !== undefined) return known
    const parks = (): boolean => {
      const run = this.runs.get(projectId)
      // A run that waits for its Orchestrator has not taken it: what is judged now is not its own.
      return run !== undefined && run.wait === null && !run.cycle.stopping && run.cycle.phase !== 'stopped'
    }
    const made: LaunchApproval = {
      mode: () => (this.activeApprovals.has(projectId) ? this.approvalMode(projectId) : 'off'),
      // In Off the process starts as before the ticket: no TMPDIR and no git environment of the run.
      environment: () => {
        const active = this.activeApprovals.get(projectId)
        return active === undefined || this.approvalMode(projectId) === 'off' ? {} : active.environment
      },
      judge: async (request, at) => {
        const decision = await (this.activeApprovals.get(projectId)?.judge(request, at) ?? NO_RUN_DECISION)
        // No park while the run stops, or after it stopped (worfy-auto-approve ticket 07): nothing would wait for the owner.
        return decision.outcome === 'park' && !parks() ? { ...decision, outcome: 'deny', hint: PARK_STOPPED_HINT } : decision
      },
      // Asked again once a parked request is open on the gate: a Stop after the decision takes it off at once.
      parks: () => parks(),
    }
    this.launchApprovals.set(projectId, made)
    return made
  }

  /**
   * The run lets its policy go; with `remove`, its folder for temporary files is removed too. A Session
   * a new run took over keeps running with that folder as TMPDIR, so then it stays.
   */
  private async closeApproval(run: Run, remove = true): Promise<void> {
    const approval = run.approval
    if (approval === null) return
    run.approval = null
    this.letGo.add(approval)
    if (this.activeApprovals.get(run.projectId) === approval) this.activeApprovals.delete(run.projectId)
    if (!remove) return
    try {
      await approval.close()
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not remove the run's folder ${approval.runTemp}`, error)
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
    run.retry?.cancel()
    this.cancelBoundary(run)
  }

  /** One line of the run's journal; `epic`: the Epic it is about, the one the run is on when absent. */
  private async write(run: Run, fields: JournalEventFields, epic = run.epic): Promise<void> {
    if (run.journal === null) return
    try {
      await run.journal.append(fields, epic)
    } catch (error) {
      console.error(`[autopilot] ${run.projectId}: could not write ${fields.kind} to the journal`, error)
    }
  }

  private snapshot(run: Run): AutopilotState {
    const limitsUntil = run.running ? (run.limits?.until ?? null) : null
    const retryUntil = run.running ? (run.retry?.until ?? null) : null
    const retry = retryUntil === null ? null : (run.retry?.retry ?? null)
    const boundary = run.running ? run.boundary : null
    const resumesAt = limitsUntil ?? retryUntil ?? boundary?.until ?? null
    const wait = run.running ? run.wait : null
    const waitingFor = wait !== null ? 'orchestrator' : limitsUntil !== null ? 'limits' : retryUntil !== null ? 'retry' : boundary?.cause
    const windowReason = waitingFor === 'start-window' ? boundary?.reason : undefined
    // From the click on: the run's step for it may still wait behind another one.
    const stopping = run.running && (run.cycle.stopping || run.stopRequested)
    return {
      projectId: run.projectId,
      epic: run.epic,
      queue: run.queue.map((epic, at) => {
        const outcome = run.outcomes.get(epic)
        return { epic, status: outcome !== undefined ? QUEUE_STATUS[outcome] : at === run.index ? 'running' : 'next' }
      }),
      index: run.index,
      status: !run.running ? 'stopped' : resumesAt !== null || wait !== null ? 'waiting' : 'running',
      wave: run.cycle.wave,
      backgroundTasks: run.running ? this.liveTasks(run).length : run.returnedTasks,
      resumesAt,
      ...(waitingFor === undefined ? {} : { waitingFor }),
      ...(wait === null ? {} : { busy: { turn: wait.busy.turn, queued: wait.busy.queued, tasks: journalTasks(wait.busy.tasks) }, waitingSince: wait.since }),
      ...(limitsUntil === null ? {} : { limitsWindow: run.limits?.window ?? null }),
      ...(windowReason === undefined ? {} : { windowReason }),
      ...(retry === null ? {} : { retry }),
      reason: run.done ? run.cycle.reason : null,
      message: run.message,
      resumable: run.done ? resumableOf(run) : [],
      stopping,
      ticketsInWork: stopping ? run.cycle.inWork.length : 0,
      harnessBehind: this.harness.get(run.projectId) ?? null,
      ...(run.running ? { machine: this.deps.machine?.() ?? null, unasked: [...run.unasked] } : {}),
      ...(run.journal === null ? {} : { run: run.journal.run }),
      ...(run.done && run.stoppedAt !== null ? { ended: { at: run.stoppedAt, duration: Math.max(0, run.stoppedAt - run.startedAt), ...waveTicketCounts(run) } } : {}),
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
