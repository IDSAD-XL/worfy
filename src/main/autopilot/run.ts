// An Autopilot run over one Epic of a Project (worfy-daily ticket 04, ADR-0024): Waves one after
// another, without a person, until no Wave is ready or something stops the run.
//
// - The Project's Orchestrator runs as an unattended Session for the time of the run (ADR-0022):
//   it is started again with the unattended launch, continuing its SDK session, and given back
//   attended when the run ends.
// - Waves go out as "Run wave" does (src/main/actions/launch.ts, the Project's template); when one
//   is finished and what comes next is the cycle's call (src/shared/autopilot/cycle.ts), over the
//   events of the Orchestrator's Session and fresh reads of the workflow model.
// - keep-awake (power.ts) is held from the start to the end of the run.
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
import type { AgentEvent, SessionState } from '../../shared/agent/events'
import type { JournalEventFields } from '../../shared/autopilot/journal'
import { initialCycle, SETTLE_MS, step, type AutopilotStopReason, type CycleEvent, type CycleState } from '../../shared/autopilot/cycle'
import type { AutopilotState } from '../../shared/ipc/autopilot'
import type { OrchestratorView } from '../../shared/ipc/orchestrator'
import type { WorkflowModel } from '../../shared/workflow/types'

/** The run's Orchestrator Session, as far as the run needs it. */
export interface RunSession {
  readonly id: string
  readonly state: SessionState
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
  message: string | null = null
  private chain: Promise<void> = Promise.resolve()
  readonly cleanups: (() => Promise<void> | void)[] = []
  settleTimer: ReturnType<typeof setTimeout> | null = null
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
    if (run === undefined) return this.last.get(projectId) ?? { projectId, epic: null, status: 'stopped', wave: 0, reason: null, message: null, revision: this.revision }
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
      const view = await this.deps.orchestrators.setUnattended(projectId, true)
      try {
        if (view === null || view.sessionId === null) throw new Error('The Orchestrator has no Session')
        run.session = this.deps.registry.get(view.sessionId)
        run.journal = await this.deps.journal({ project: projectId, epic })
        run.awake = this.deps.keepAwake()
        run.awake.start()
        this.subscribe(run)
        run.cleanups.push(await this.deps.watchWorkflow(root, () => void run.enqueue(() => this.readAndFeed(run, 'ignore', (tickets) => ({ type: 'workflow', tickets })))))
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

  /** Whether any run goes on. */
  anyRunning(): boolean {
    return this.starting.size > 0 || [...this.runs.values()].some((run) => run.running)
  }

  private subscribe(run: Run): void {
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
      case 'result': {
        const message = event.error ?? (event.isError ? event.text : null)
        void run.enqueue(() =>
          this.readAndFeed(run, 'stop', (tickets) => ({ type: 'turn-ended', isError: event.isError, interrupted: event.interrupted, message: message === '' ? null : message, tickets })),
        )
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
    let tickets: number[]
    try {
      tickets = (await this.deps.waves.autopilotWave(run.projectId, run.epic)).tickets
    } catch (error) {
      run.message = messageOf(error)
      await this.feed(run, { type: 'send-failed', message: run.message })
      return
    }
    await this.feed(run, { type: 'wave-sent', tickets })
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
    // On quit the Orchestrator closes with every Session: starting it again would start Claude Code.
    await this.release(run, reason !== 'app-quit')
    run.done = true
    if (this.runs.get(run.projectId) === run) this.runs.delete(run.projectId)
    this.last.set(run.projectId, this.snapshot(run))
    this.publish(run.projectId)
    run.finish()
  }

  /** Undoes what a run holds: subscriptions, the settle timer, keep-awake, the unattended Orchestrator. */
  private async release(run: Run, giveBack: boolean): Promise<void> {
    if (run.settleTimer !== null) clearTimeout(run.settleTimer)
    run.settleTimer = null
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
    return {
      projectId: run.projectId,
      epic: run.epic,
      status: run.running ? 'running' : 'stopped',
      wave: run.cycle.wave,
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
