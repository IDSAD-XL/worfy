// An Autopilot run over one Epic of a Project (worfy-daily ticket 04, ADR-0024): Waves one after
// another, without a person, until no Wave is ready or something stops the run.
//
// - The Project's Orchestrator runs as an unattended Session for the time of the run (ADR-0022):
//   it is started again with the unattended launch, continuing its SDK session, and given back
//   attended when the run ends.
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
//   journal says `run-stopped` with the Tickets of the interrupted Wave, `tasks-killed` when tasks
//   lived, and `orchestrator-returned`; forceStop() answers after that. The next run of the Epic
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
//   `run-stopped` (not on a Force stop or a quit, which do not wait). Each state of a Ticket is one
//   line, once per run; a failed read writes nothing, and the run goes on.
//
// worfy still writes no Ticket status (ADR-0002): the agents do, through `ticket`.
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AutopilotWaveResult } from '../actions/launch'
import { ticketNumber } from '../../shared/actions/render-template'
import { messageLabel } from '../../shared/agent/attachments'
import { isTaskEvent, type BackgroundTask } from '../../shared/agent/background-tasks'
import type { AgentEvent, QueueSnapshot, SessionState } from '../../shared/agent/events'
import { clipLastText, type JournalEventFields } from '../../shared/autopilot/journal'
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
import type { PullRequest } from '../../shared/ipc/checks'
import type { OrchestratorView } from '../../shared/ipc/orchestrator'
import { parseTicketBranch } from '../../shared/workflow/ticket-ref'
import type { WorkflowModel } from '../../shared/workflow/types'
import { BASE_INTERVAL_MS } from '../github/prs'
import { LimitsWait, type LimitsWaitDeps } from './limits-wait'

/** The run's Orchestrator Session, as far as the run needs it. */
export interface RunSession {
  readonly id: string
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
  'Autopilot остановлен человеком. Новые Ticket-ы не бери и новые Wave-ы не начинай. Ticket-ы текущей Wave, которые ещё не запущены, не запускай. Ticket-ы, уже взятые в работу, доведи до конца как обычно — merge или blocked, — потом закончи ход.'

/** STOP_TEXT as the Session's queue shows it. */
const STOP_LABEL = messageLabel(STOP_TEXT, [])

/** The timers of the wait for background tasks; a test passes a clock it moves by hand. */
export interface TasksClock {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realClock: TasksClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
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
    /** Stop by the user: the Orchestrator attended again at once, its old process closed (Orchestrators.giveBackNow). */
    giveBackNow(projectId: string): Promise<OrchestratorView | null>
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
   */
  waves: { autopilotWave(projectId: string, epic: string, resume: readonly number[]): Promise<AutopilotWaveResult>; autopilotRefusal(projectId: string): string | null }
  /** Opens the run's journal; writes its `run-started` line. */
  journal(start: { project: string; epic: string }): Promise<RunJournalLike>
  /** A new keep-awake for one run (power.ts, KeepAwake). */
  keepAwake(): { start(): void; stop(): void }
  /** Told every new state of any Project's run. */
  onChange?(state: AutopilotState): void
  /** How long a run settles before `wave-unfinished` (default SETTLE_MS). */
  settleMs?: number
  /** The Limits and the wait for them (limits-wait.ts); without it a refused turn ends the run as `turn-error`. */
  limits?: LimitsWaitDeps
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
  /** The clock of that read (default: the real timers). */
  prsClock?: TasksClock
}

/** A task as the journal writes it. */
const journalTasks = (tasks: readonly BackgroundTask[]) => tasks.map((task) => ({ id: task.taskId, type: task.taskType, description: task.description }))

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Whether a Session state is a running turn: the Orchestrator is not given back during one (orchestrator.ts). */
const inTurn = (state: SessionState): boolean => state === 'busy' || state === 'needs_permission'

/** What the start of a run is refused with while another run of the Project goes on. */
export const alreadyRunning = (epic: string): string => `Autopilot is already running in this Project (Epic ${epic}): stop it first`

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
  /** The Orchestrator's last answer in the turns of the current Wave, clipped; null before any. */
  lastText: string | null = null
  /** The Tickets of an interrupted Wave the next "Run wave" takes along; emptied once it is sent. */
  resume: readonly number[] = []
  /** Set at the click on Stop (Autopilot.stop), before its step runs: no new Wave goes from then on. */
  stopRequested = false
  /** Whether STOP_TEXT has gone to the Orchestrator: once per run. */
  stopSent = false
  /** After a Force stop: the Tickets of the Wave it interrupted (AutopilotState.resumable). */
  interrupted: number[] = []
  /** The `commits` of the last `harness-behind` line of the run; null before any, or once not behind. */
  harnessCommits: number | null = null
  /** Every Ticket of the run's Waves so far: the PRs of their branches are read for the narrow round. */
  readonly waveTickets = new Set<number>()
  /** The `<ticket>:<outcome>` pairs journaled as `narrow-round`: each once per run. */
  readonly narrowJournaled = new Set<string>()
  /** The next read of the PRs; null before the first Wave and once the run stops. */
  prsTimer: unknown = null
  /** Settles once the run has stopped and cleaned up. */
  readonly ended: Promise<void>
  finish!: () => void

  constructor(
    readonly projectId: string,
    readonly epic: string,
    readonly root: string,
  ) {
    this.cycle = initialCycle(epic)
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
  /** Projects whose run is between the click and its first state. */
  private readonly starting = new Set<string>()
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

  /**
   * Starts a run of `epic`. Refused while the Project has a run, on worfy's own repository in a
   * development build, when the workflow cannot be read or has no such Epic, and while the
   * Orchestrator is in a turn. Answers the run's first state.
   */
  async start(projectId: string, epic: string): Promise<AutopilotState> {
    // Taken before the first await: two starts that arrive together do not both pass.
    const live = this.runs.get(projectId)
    if (this.starting.has(projectId) || live?.running === true) throw new Error(alreadyRunning(live?.epic ?? epic))
    this.starting.add(projectId)
    try {
      const root = this.deps.projectRoot(projectId)
      const refusal = (await this.deps.selfRefusal(root)) ?? this.deps.waves.autopilotRefusal(projectId)
      if (refusal !== null) throw new Error(refusal)
      const model = await this.deps.workflow(root)
      if (model.error !== null) throw new Error(`Cannot read the workflow: ${model.error.message}`)
      if (!model.epics.some((each) => each.epic === epic) && !model.tickets.some((each) => each.epic === epic)) throw new Error(`The Project has no Epic ${epic}`)

      const run = new Run(projectId, epic, root)
      // The Wave the last Force stop of this Epic interrupted goes along with the first Wave (worfy-week tickets 17, 18).
      const last = this.last.get(projectId)
      run.resume = last?.epic === epic ? [...last.resumable] : []
      if (this.deps.limits !== undefined) run.limits = new LimitsWait(this.deps.limits)
      const view = await this.deps.orchestrators.setUnattended(projectId, true)
      try {
        if (view === null || view.sessionId === null) throw new Error('The Orchestrator has no Session')
        run.session = this.deps.registry.get(view.sessionId)
        run.journal = await this.deps.journal({ project: projectId, epic })
        await this.journalHarness(run)
        run.awake = this.deps.keepAwake()
        run.awake.start()
        this.subscribe(run)
        const unwatch = await this.deps.watchWorkflow(root, () => void run.enqueue(() => this.readAndFeed(run, 'ignore', (tickets) => ({ type: 'workflow', tickets }))))
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
    run.stopRequested = true
    await run.enqueue(async () => {
      if (run.cycle.phase === 'stopped' || run.cycle.stopping) return
      await this.feed(run, { type: 'graceful-stop', tickets: await this.freshTickets(run) })
    })
    if (run.cycle.phase === 'stopped') await run.ended
    return this.state(projectId)
  }

  /** Force stop: stops the Project's run with `user-force-stop`; answers its state once it has stopped. */
  async forceStop(projectId: string): Promise<AutopilotState> {
    const run = this.runs.get(projectId)
    if (run === undefined) return this.state(projectId)
    await run.enqueue(() => this.feed(run, { type: 'stop', reason: 'user-force-stop' }))
    await run.ended
    return this.state(projectId)
  }

  /**
   * Stops every run with `app-quit`; settles once they have all stopped. Stopped runs still waiting
   * for their Orchestrator's background tasks journal them as killed and release keep-awake.
   */
  async stopAll(): Promise<void> {
    await Promise.all([
      ...[...this.runs.values()].map(async (run) => {
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
        void run.enqueue(() => this.write(run, { kind: 'refused-dialog', session: run.session?.id ?? null, what: `${event.dialog} ${event.subject}` }))
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
   * told. After a workflow change it is skipped: the next change reads again.
   */
  private async readAndFeed(run: Run, onError: 'stop' | 'ignore', make: (tickets: WorkflowModel['tickets']) => CycleEvent): Promise<void> {
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
          await this.sendWave(run)
          break
        case 'wave-started': {
          const sent = run.sent
          await this.journalHarness(run)
          await this.write(run, {
            kind: 'wave-started',
            wave: effect.wave,
            tickets: effect.tickets.map(ticketNumber),
            ...(sent === null ? {} : { text: sent.text, skipped: sent.skipped.map((each) => ({ num: ticketNumber(each.num), state: each.state })) }),
          })
          for (const num of effect.tickets) run.waveTickets.add(num)
          this.pollPrs(run)
          break
        }
        case 'wave-finished':
          await this.write(run, { kind: effect.kind, wave: effect.wave, tickets: effect.tickets.map(ticketNumber) })
          break
        case 'stopping':
          await this.beginStopping(run, effect)
          break
        case 'session-error':
          run.message = effect.message
          await this.write(run, { kind: 'session-error', session: run.session?.id ?? null, message: effect.message })
          break
        case 'stopped':
          await this.end(run, effect.reason, effect.tickets)
          break
      }
    }
    if (run.cycle.phase !== 'stopped') this.publish(run.projectId)
  }

  private async sendWave(run: Run): Promise<void> {
    let sent: AutopilotWaveResult
    // Stop was clicked while the step that decided on this Wave ran (worfy-week ticket 18): the
    // Wave has not gone, so no Ticket was taken, and the run ends here.
    if (run.stopRequested) {
      await this.feed(run, { type: 'stop', reason: 'user-stop' })
      return
    }
    run.sending = true
    run.promptsWhileSending.clear()
    // Only the run's first Wave takes the interrupted Tickets along.
    const resume = run.resume
    run.resume = []
    try {
      sent = await this.deps.waves.autopilotWave(run.projectId, run.epic, resume)
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
    run.wavePrompt = messageLabel(sent.text, [])
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
    await this.write(run, { kind: 'run-stopping', reason: 'user-stop', wave: effect.wave, tickets: effect.tickets.map(ticketNumber), inWork: effect.inWork.map(ticketNumber) })
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
      void run.enqueue(() => this.readAndFeed(run, 'stop', (tickets) => ({ type: 'tasks-timeout', tasks: this.liveTasks(run).length, tickets })))
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
   * A stop for want of a Wave carries the Orchestrator's last answer in the Wave (ADR-0033), and
   * `blocked-tickets` the Tickets it stopped on.
   */
  private async end(run: Run, reason: AutopilotStopReason, tickets?: number[]): Promise<void> {
    // The narrow round's last states before the end: a Ticket blocked on `NARROW: REJECTED` is
    // journaled ahead of the run-stopped that names it. A Force stop and a quit do not wait for gh.
    if (reason !== 'user-force-stop' && reason !== 'app-quit') await this.journalNarrow(run, await this.readPrs(run))
    const live = this.liveTasks(run)
    const lastText = reason === 'no-progress' || reason === 'no-ready-wave' || reason === 'blocked-tickets' ? run.lastText : null
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

  /**
   * One `narrow-round` line for each narrow-round state on the PRs of the run's Wave Tickets not
   * journaled yet in this run, in comment order (worfy-harness ticket 20). Nothing once the run is
   * done: a read that answers after run-stopped writes nothing.
   */
  private async journalNarrow(run: Run, pulls: readonly PullRequest[]): Promise<void> {
    if (run.done) return
    for (const pull of [...pulls].sort((a, b) => a.number - b.number)) {
      const ref = parseTicketBranch(pull.branch)
      if (ref === null || ref.epic !== run.epic || !run.waveTickets.has(ref.num)) continue
      for (const state of pull.narrow ?? []) {
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
    const resumesAt = run.running ? (run.limits?.until ?? null) : null
    // From the click on: the run's step for it may still wait behind another one.
    const stopping = run.running && (run.cycle.stopping || run.stopRequested)
    return {
      projectId: run.projectId,
      epic: run.epic,
      status: !run.running ? 'stopped' : resumesAt !== null ? 'waiting' : 'running',
      wave: run.cycle.wave,
      backgroundTasks: run.running ? this.liveTasks(run).length : 0,
      resumesAt,
      reason: run.done ? run.cycle.reason : null,
      message: run.message,
      resumable: run.done && run.cycle.reason === 'user-force-stop' ? [...run.interrupted] : [],
      stopping,
      ticketsInWork: stopping ? run.cycle.inWork.length : 0,
      harnessBehind: this.harness.get(run.projectId) ?? null,
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
