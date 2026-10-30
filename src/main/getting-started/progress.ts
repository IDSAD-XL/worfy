// The steps of Getting started that mark themselves (worfy-onboarding ticket 06; spec, "How it
// works", decisions 2 and 3). Main marks them, not the window: the review may run while the window
// shows another Project or is closed. A marked step is never taken back, and steps mark in any order.
//
//   1 Check your setup     — a First run report with no `fail` among the checks the demo needs;
//   2 Open the demo project — the demo record is there and its Project is in the list;
//   3 Meet the Orchestrator — the first `result` of a Session of the demo's Orchestrator;
//   4 Ship the ticket      — the demo Ticket past Implementing in a Stage snapshot;
//   5 See the review       — the demo Ticket past Agent review; `rework` seen once sets reworkSeen;
//   6 Merge                — the demo Ticket's Status `done` in the workflow model.
//
// The Stages of the demo are subscribed to while the demo record is there and its Project is in the
// list; the Project leaving the list closes the subscription, and the steps stay. The sources come
// in as parameters (src/main/ipc/getting-started.ts wires the app's), so tests substitute them.
import type { AgentEvent } from '../../shared/agent/events'
import type { CheckId, CheckStatus } from '../../shared/ipc/first-run'
import type { PipelineSnapshot } from '../../shared/ipc/pipeline'
import type { WorkflowModel } from '../../shared/workflow/types'
import type { StageSubscriber } from '../workflow/stages'
import type { GettingStartedState } from './state'

/** The demo's Epic and its one Ticket (spec, decision 14; src/main/getting-started/demo-template.ts). */
export const DEMO_EPIC = 'todo'
export const DEMO_TICKET = 1

/** The checks the demo cannot do without (decision 2); `gh`, `gh-auth`, `qmd*`, `legacy-harness`, `claude-version`, `limits` are not among them. */
const NEEDED: readonly CheckId[] = ['claude-login', 'git', 'git-identity', 'node', 'jq', 'harness', 'harness-dependencies', 'harness-scripts']
/** On Windows, also these. */
const NEEDED_ON_WINDOWS: readonly CheckId[] = ['windows', 'arch', 'powershell', 'git-bash']

/** Whether a First run report lets step 1 be marked: no `fail` among the checks the demo needs on `platform`; a `warn` does not count. */
export function firstRunPasses(checks: readonly { readonly id: CheckId; readonly status: CheckStatus }[], platform: NodeJS.Platform): boolean {
  const needed = platform === 'win32' ? [...NEEDED, ...NEEDED_ON_WINDOWS] : NEEDED
  return !checks.some((check) => check.status === 'fail' && needed.includes(check.id))
}

/** Marks step 1 when `report` passes (firstRunPasses); a report that does not pass takes nothing back. */
export function noteFirstRunReport(state: Pick<GettingStartedState, 'markStep'>, report: { readonly checks: readonly { readonly id: CheckId; readonly status: CheckStatus }[] }, platform: NodeJS.Platform): void {
  if (firstRunPasses(report.checks, platform)) state.markStep('1')
}

export interface ProgressSources {
  state: Pick<GettingStartedState, 'demo' | 'markStep' | 'markReworkSeen' | 'onChange'>
  /** The Project list and its changes. */
  projects: {
    list(): readonly { readonly id: string; readonly path: string }[]
    onChange(listener: () => void): () => void
  }
  /** The app's StageHub (src/main/workflow/stages.ts). */
  stages: {
    open(root: string, subscriber: StageSubscriber): Promise<PipelineSnapshot>
    close(root: string, subscriberId: number | string): Promise<boolean>
  }
  /** The workflow hub: the model of a root it watches (the StageHub watches the demo's), else null. */
  workflow: { model(root: string): Promise<WorkflowModel | null> }
  /** Every event of every Session of the app (SessionRegistry.observe). */
  sessions: { observe(listener: (sessionId: string, event: AgentEvent) => void): () => void }
  /** Whether `sessionId` is the Session of `projectId`'s Orchestrator. */
  isOrchestratorOf(projectId: string, sessionId: string): boolean
}

/** The id the progress subscribes to the Stages under: a string, never a window's number. */
export const PROGRESS_SUBSCRIBER = 'getting-started'

export class GettingStartedProgress {
  /** The demo root the Stages are subscribed for, or null. */
  private root: string | null = null
  /** The work started by the snapshots, in order; tests wait for it (settled). */
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly sources: ProgressSources) {}

  /** Subscribes to the sources and opens the Stages when the demo is there; answers the stop. */
  start(): () => void {
    const stops = [
      this.sources.state.onChange(() => this.sync()),
      this.sources.projects.onChange(() => this.sync()),
      this.sources.sessions.observe((sessionId, event) => this.sessionEvent(sessionId, event)),
    ]
    this.sync()
    return () => {
      for (const stop of stops) stop()
      this.subscribe(null)
    }
  }

  /** Resolves once the snapshots received so far are taken in. */
  settled(): Promise<void> {
    return this.queue
  }

  /** The demo's root when its record is there and its Project is in the list. */
  private demoRoot(): string | null {
    const demo = this.sources.state.demo()
    if (demo === null) return null
    return this.sources.projects.list().find((project) => project.id === demo.projectId)?.path ?? null
  }

  /** Step 2, and the subscription to the Stages of the demo as the record and the list are now. */
  private sync(): void {
    const root = this.demoRoot()
    if (root !== null) this.sources.state.markStep('2')
    this.subscribe(root)
  }

  private subscribe(root: string | null): void {
    if (root === this.root) return
    const old = this.root
    this.root = root
    // Both start now, not in the queue: the hub takes the subscriber in before its first await, so
    // a close that follows an open still finds it.
    if (old !== null) {
      const closing = this.sources.stages.close(old, PROGRESS_SUBSCRIBER)
      closing.catch(() => undefined)
      this.enqueue(async () => void (await closing))
    }
    if (root === null) return
    const subscriber: StageSubscriber = { id: PROGRESS_SUBSCRIBER, send: (snapshot) => this.enqueue(() => this.snapshot(root, snapshot)) }
    const opening = this.sources.stages.open(root, subscriber)
    // Handled here too, so it is not reported unhandled while the queue is still busy; the queue reports it.
    opening.catch(() => undefined)
    this.enqueue(async () => {
      try {
        await this.snapshot(root, await opening)
      } catch (error) {
        // Opened again at the next change of the record or the list.
        if (this.root === root) this.root = null
        throw error
      }
    })
  }

  /** Runs `work` after the work queued before it; a failure is logged and does not stop the queue. */
  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work).catch((error: unknown) => {
      console.warn('[getting-started] the Stages of the demo could not be read', error)
    })
  }

  /**
   * Steps 4–6 and reworkSeen from one snapshot of the demo's Stages. A snapshot that comes after the
   * subscription closed (the Project left the list) marks nothing. Step 6 reads the Status from the
   * workflow model: the StageHub sends a snapshot after each change of the model it watches.
   */
  private async snapshot(root: string, snapshot: PipelineSnapshot): Promise<void> {
    if (this.root !== root) return
    const ticket = snapshot.tickets.find((each) => each.epic === DEMO_EPIC && each.num === DEMO_TICKET)
    if (ticket === undefined) return
    const { state } = this.sources
    if (ticket.passed.includes('implementing')) state.markStep('4')
    if (ticket.passed.includes('agent-review')) state.markStep('5')
    if (ticket.rework) state.markReworkSeen()
    const model = await this.sources.workflow.model(root)
    if (this.root !== root) return
    const status = model?.tickets.find((each) => each.epic === DEMO_EPIC && each.num === DEMO_TICKET)?.state
    if (status === 'done') state.markStep('6')
  }

  /** Step 3: the end of a turn of the demo's Orchestrator. */
  private sessionEvent(sessionId: string, event: AgentEvent): void {
    if (event.type !== 'result') return
    const demo = this.sources.state.demo()
    if (demo !== null && this.sources.isOrchestratorOf(demo.projectId, sessionId)) this.sources.state.markStep('3')
  }
}
