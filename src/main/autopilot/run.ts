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
// - keep-awake (power.ts) is held from the start to the end of the run.
// - A turn of the Wave refused by the Limits does not end it (worfy-daily ticket 05): the run goes
//   `waiting` until the Limits reset, then sends the Orchestrator on (limits-wait.ts). Past the
//   wait's limit it stops with `limits-timeout`.
// - Every step goes to the run journal (src/main/autopilot/journal.ts): Waves, errors, refused
//   dialogs of the unattended Session, the reason the run stopped, and every action a person takes
//   on the run's Session through the UI as `human-input` with source "worfy".
// - One run per Project at most. On a development build (not packaged), a run over worfy's own
//   repository is refused: its agents would rebuild the app the run lives in.
//
// worfy still writes no Ticket status (ADR-0002): the agents do, through `ticket`.
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AutopilotWaveResult } from '../actions/launch'
import { ticketNumber } from '../../shared/actions/render-template'
import { messageLabel } from '../../shared/agent/attachments'
import type { AgentEvent, QueueSnapshot, SessionState } from '../../shared/agent/events'
import type { JournalEventFields } from '../../shared/autopilot/journal'
import { toMs, type LimitsHit } from '../../shared/autopilot/resume-at'
import { initialCycle, SETTLE_MS, step, type AutopilotStopReason, type CycleEvent, type CycleState } from '../../shared/autopilot/cycle'
import type { AutopilotState } from '../../shared/ipc/autopilot'
import type { OrchestratorView } from '../../shared/ipc/orchestrator'
import type { WorkflowModel } from '../../shared/workflow/types'
import { LimitsWait, type LimitsWaitDeps } from './limits-wait'

/** The run's Orchestrator Session, as far as the run needs it. */
export interface RunSession {
  readonly id: string
  readonly state: SessionState
  queued(): QueueSnapshot
  removeQueued(id: string): boolean
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
  orchestrators: { setUnattended(projectId: string, unattended: boolean): Promise<OrchestratorView | null> }
  registry: {
    get(sessionId: string): RunSession
    observe(sink: (sessionId: string, event: AgentEvent) => void): () => void
    observeInput(listener: (session: RunSession, what: string) => void): () => void
  }
  /** Sends "Run wave" to the Orchestrator (ActionLauncher.autopilotWave). */
  waves: { autopilotWave(projectId: string, epic: string): Promise<AutopilotWaveResult> }
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
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

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
  /** The last stopped state of each Project, also after its run is gone. */
  private readonly last = new Map<string, AutopilotState>()
  private revision = 0

  constructor(private readonly deps: AutopilotDeps) {}

  /** The Project's run as it is now. */
  state(projectId: string): AutopilotState {
    const run = this.runs.get(projectId)
    if (run === undefined) return this.last.get(projectId) ?? { projectId, epic: null, status: 'stopped', wave: 0, resumesAt: null, reason: null, message: null, revision: this.revision }
    return this.snapshot(run)
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
      const refusal = await this.deps.selfRefusal(root)
      if (refusal !== null) throw new Error(refusal)
      const model = await this.deps.workflow(root)
      if (model.error !== null) throw new Error(`Cannot read the workflow: ${model.error.message}`)
      if (!model.epics.some((each) => each.epic === epic) && !model.tickets.some((each) => each.epic === epic)) throw new Error(`The Project has no Epic ${epic}`)

      const run = new Run(projectId, epic, root)
      if (this.deps.limits !== undefined) run.limits = new LimitsWait(this.deps.limits)
      const view = await this.deps.orchestrators.setUnattended(projectId, true)
      try {
        if (view === null || view.sessionId === null) throw new Error('The Orchestrator has no Session')
        run.session = this.deps.registry.get(view.sessionId)
        run.journal = await this.deps.journal({ project: projectId, epic })
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
      void run.enqueue(() => this.feed(run, { type: 'start', tickets: model.tickets }))
      return this.snapshot(run)
    } finally {
      this.starting.delete(projectId)
    }
  }

  /** Stops the Project's run with `user-stop`; answers its state once it has stopped. */
  async stop(projectId: string): Promise<AutopilotState> {
    const run = this.runs.get(projectId)
    if (run === undefined) return this.state(projectId)
    await run.enqueue(() => this.feed(run, { type: 'stop', reason: 'user-stop' }))
    await run.ended
    return this.state(projectId)
  }

  /** Stops every run with `app-quit`; settles once they have all stopped. */
  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.runs.values()].map(async (run) => {
        await run.enqueue(() => this.feed(run, { type: 'stop', reason: 'app-quit' }))
        await run.ended
      }),
    )
  }

  private async unwatch(run: Run, unwatch: () => Promise<void> | void): Promise<void> {
    try {
      await unwatch()
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: a cleanup failed`, error)
    }
  }

  /** Whether any run goes on. */
  anyRunning(): boolean {
    return this.starting.size > 0 || [...this.runs.values()].some((run) => run.running)
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
        if (run.sending) run.promptsWhileSending.set(run.turns, event.text)
        else if (run.waveTurn === null && run.wavePrompt !== null && event.text === run.wavePrompt) run.waveTurn = run.turns
        return
      case 'result': {
        // Which turn ended is known now, in the order of the Session's events; whether it is the
        // Wave's is decided in the run's order, once the Wave's own sending has been handled.
        const turn = run.turns
        const message = event.error ?? (event.isError ? event.text : null)
        // Whether the Limits refused the turn is known now, from the Session's last Limits status.
        const hit = run.limits?.hitOf({ isError: event.isError, interrupted: event.interrupted, message }) ?? null
        void run.enqueue(() => {
          // A turn ahead of the Wave that finished normally after an Interrupt still leaves the
          // queue held: the Wave waits in it until a person resumes, so the run stops as interrupted.
          const interrupted = event.interrupted || (!run.endsWave(turn) && this.waveHeld(run))
          if (!run.endsWave(turn) && !interrupted) return
          if (hit !== null && !interrupted) return this.limitsHit(run, hit)
          // A turn of the Wave that was not refused ends any wait (a person's turn during it, too).
          run.limits?.passed()
          return this.readAndFeed(run, 'stop', (tickets) => ({ type: 'turn-ended', isError: event.isError, interrupted, message: message === '' ? null : message, tickets }))
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
      default:
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

  /** One cycle step and its effects, in order. */
  private async feed(run: Run, event: CycleEvent): Promise<void> {
    const before = run.cycle.phase
    const { state, effects } = step(run.cycle, event)
    run.cycle = state
    this.settleTimer(run, before)
    for (const effect of effects) {
      switch (effect.kind) {
        case 'send-wave':
          await this.sendWave(run)
          break
        case 'wave-started':
        case 'wave-finished':
          await this.write(run, { kind: effect.kind, wave: effect.wave, tickets: effect.tickets.map(ticketNumber) })
          break
        case 'session-error':
          run.message = effect.message
          await this.write(run, { kind: 'session-error', session: run.session?.id ?? null, message: effect.message })
          break
        case 'stopped':
          await this.end(run, effect.reason)
          break
      }
    }
    if (run.cycle.phase !== 'stopped') this.publish(run.projectId)
  }

  private async sendWave(run: Run): Promise<void> {
    let sent: AutopilotWaveResult
    run.sending = true
    run.promptsWhileSending.clear()
    try {
      sent = await this.deps.waves.autopilotWave(run.projectId, run.epic)
    } catch (error) {
      run.message = messageOf(error)
      await this.feed(run, { type: 'send-failed', message: run.message })
      return
    } finally {
      run.sending = false
    }
    // Sent at once, its turn has started by now; queued, it starts with a later `prompt`.
    run.wavePrompt = messageLabel(sent.text, [])
    run.waveTurn = null
    for (const [turn, text] of run.promptsWhileSending) {
      if (text !== run.wavePrompt) continue
      run.waveTurn = turn
      break
    }
    run.promptsWhileSending.clear()
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
    wait.wait(plan.at, () => void run.enqueue(() => this.resume(run)))
    this.publish(run.projectId)
  }

  /** The wait is over: the Orchestrator gets the continuation, once; a Session that is gone stops the run. */
  private async resume(run: Run): Promise<void> {
    const wait = run.limits
    if (wait === null || wait.until === null || run.cycle.phase === 'stopped' || run.session === null) return
    const text = wait.resume()
    await this.write(run, { kind: 'resumed' })
    this.publish(run.projectId)
    try {
      wait.send(run.session.id, text)
    } catch (error) {
      run.message = messageOf(error)
      await this.feed(run, { type: 'session-error', message: run.message })
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

  /** A Wave still in the Session's queue when the run stops is taken out: no one would follow its turn. */
  private dropQueuedWave(run: Run): void {
    const prompt = run.wavePrompt
    if (prompt === null || run.waveTurn !== null || run.session === null) return
    try {
      const queued = run.session.queued().items.find((item) => item.text === prompt)
      if (queued !== undefined) run.session.removeQueued(queued.id)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not take the Wave out of the queue`, error)
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

  /** The run is over: its reason in the journal, keep-awake released, the Orchestrator given back. */
  private async end(run: Run, reason: AutopilotStopReason): Promise<void> {
    await this.write(run, { kind: 'run-stopped', reason })
    this.dropQueuedWave(run)
    // On quit the Orchestrator closes with every Session: starting it again would start Claude Code.
    await this.release(run, reason !== 'app-quit')
    run.done = true
    if (this.runs.get(run.projectId) === run) this.runs.delete(run.projectId)
    this.last.set(run.projectId, this.snapshot(run))
    this.publish(run.projectId)
    run.finish()
  }

  /** Undoes what a run holds: subscriptions, the settle and Limits timers, keep-awake, the unattended Orchestrator. */
  private async release(run: Run, giveBack: boolean): Promise<void> {
    if (run.settleTimer !== null) clearTimeout(run.settleTimer)
    run.settleTimer = null
    run.limits?.cancel()
    for (const cleanup of run.cleanups.splice(0)) {
      try {
        await cleanup()
      } catch (error) {
        console.warn(`[autopilot] ${run.projectId}: a cleanup failed`, error)
      }
    }
    try {
      run.awake?.stop()
    } catch (error) {
      console.error(`[autopilot] ${run.projectId}: could not release keep-awake`, error)
    }
    if (!giveBack) return
    try {
      await this.deps.orchestrators.setUnattended(run.projectId, false)
    } catch (error) {
      console.warn(`[autopilot] ${run.projectId}: could not give the Orchestrator back`, error)
    }
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
    return {
      projectId: run.projectId,
      epic: run.epic,
      status: !run.running ? 'stopped' : resumesAt !== null ? 'waiting' : 'running',
      wave: run.cycle.wave,
      resumesAt,
      reason: run.done ? run.cycle.reason : null,
      message: run.message,
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
