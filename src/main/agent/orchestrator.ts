// The Orchestrator of each Project: its main Session (CONTEXT.md, «Оркестратор») and the locked
// Node that shows it on the Canvas.
//
// open() finds the Project's Orchestrator Node in the Layout or creates it, then starts the
// Session in the Project's root: a new one, or the SDK session saved in the Node's `data`, resumed.
//
// The Node's data keeps only the SDK session id and the summed cost (ADR-0010). The model, effort
// and permission mode the user picked (ticket 19) are kept under the Node id in worfy's data folder
// (session-settings.ts); the Session starts (and resumes) with them. Everything else the Node
// shows lives in memory, in the Orchestrator's view: the model and the last status block come from the saved session's transcript when the
// Orchestrator opens (orchestrator-transcript.ts) and then from the live Session's events; the
// state is the live Session's. Views go to the windows on `orchestrator.changed`.
//
// Autopilot (worfy-daily ticket 04, ADR-0024) runs the Orchestrator unattended for the time of a
// run (setUnattended): its Session is started again with the unattended launch (ADR-0022),
// continuing the same SDK session, and started again attended when the run ends — at once, or once
// a turn that still runs has ended and the Session has no live background task (ADR-0029: starting
// it again would kill them). The settings of an unattended Session are not saved: its forced
// bypassPermissions would overwrite the mode the user picked for the Node. Going unattended is
// refused while a turn runs (also the last turn of a run that was just stopped), while background
// tasks live and while messages wait in the queue; going back to attended carries the queue over
// to the new Session. Stop in Autopilot (worfy-week ticket 17, ADR-0050) gives the Orchestrator back
// at once instead (giveBackNow): its halted Session's process closes, and with it every background
// task and the turn the interrupt did not end.
//
// Every relaunch (worfy-week ticket 20, ADR-0064) starts the new Claude Code process only once the
// old one has exited (Session.exited: SIGKILL past the limit), so two processes never continue one
// SDK session. The new Session is live at once, `starting`, and holds what is sent to it meanwhile;
// setUnattended and giveBackNow answer once its process has started.
import type { AgentEvent } from '../../shared/agent/events'
import { DEFAULT_SETTINGS, sameSettings, type SessionSettings } from '../../shared/agent/settings'
import { findStatusBlock } from '../../shared/agent/status-block'
import {
  ORCHESTRATOR_HEIGHT,
  ORCHESTRATOR_KIND,
  ORCHESTRATOR_WIDTH,
  readOrchestratorData,
  type OrchestratorData,
  type OrchestratorView,
} from '../../shared/ipc/orchestrator'
import type { LayoutNode, LayoutOpInput, LayoutState } from '../../shared/layout/types'
import { placeNewNode } from '../layout/place'
import type { TranscriptFacts } from './orchestrator-transcript'
import { closeRefusal } from './resume'
import { EXIT_WAIT_MS, type EventSink, type Session, type SessionRegistry } from './session'
import { ATTENDED, type SessionLaunch } from './session-settings'

/**
 * What Claude Code answers when asked to resume a session it has no transcript for (it removes
 * transcripts older than `cleanupPeriodDays`, 30 by default).
 */
const NO_CONVERSATION = /No conversation found with session ID/i

/**
 * Where a new Orchestrator Node goes: the top-left corner of the Canvas when no Node there takes
 * it, otherwise under every Node, so it never covers one (src/main/layout/place.ts).
 */
export function orchestratorPlace(nodes: readonly LayoutNode[]): { x: number; y: number } {
  return placeNewNode(nodes, { w: ORCHESTRATOR_WIDTH, h: ORCHESTRATOR_HEIGHT })
}

/**
 * The cost of a Session across the Claude Code processes that ran it. Claude Code reports
 * `total_cost_usd` per process, growing with every turn (test/fixtures/sdk-messages/controls.jsonl);
 * a new process — after a crash, or after a restart of the app — counts from zero again.
 */
export class CostCounter {
  private run = 0

  /** `base`: what the earlier processes cost, as kept in the Node's data. */
  constructor(private base: number) {}

  get total(): number {
    return this.base + this.run
  }

  /** A turn's `result`; answers the new total. */
  result(costUsd: number): number {
    // A smaller figure than the last one can only come from a new process.
    if (costUsd < this.run) this.processEnded()
    this.run = costUsd
    return this.total
  }

  /** The process died; the next one starts from zero. */
  processEnded(): void {
    this.base += this.run
    this.run = 0
  }
}

export interface OrchestratorDeps {
  layout: {
    get(projectId: string): LayoutState
    apply(projectId: string, op: LayoutOpInput): LayoutState
  }
  /** The Project's repository root; throws for a Project that is not in the list. */
  projectPath(projectId: string): string
  registry: Pick<SessionRegistry, 'start'>
  /** Where the picked model, effort and permission mode of a Node are kept (session-settings.ts). */
  settings: {
    read(projectId: string, nodeId: string): SessionSettings | undefined
    write(projectId: string, nodeId: string, settings: SessionSettings): void
  }
  /**
   * The model and the last status block of a saved SDK session, read from its transcript under
   * the Claude home; null when the Project has no transcript of that session.
   */
  transcript(projectRoot: string, sdkSessionId: string): Promise<TranscriptFacts | null>
  /** Gets every event of every Orchestrator, e.g. to send it to the windows. */
  broadcast: EventSink
  /** Gets every new view, e.g. to send it to the windows. */
  publish(view: OrchestratorView): void
  /**
   * How long a Session waiting to be given back waits, after its last background task ended, for
   * the turn the task-notification starts (default RETURN_GRACE_MS).
   */
  returnGraceMs?: number
  /**
   * How long a relaunch waits for the old Session's Claude Code process to exit before it sends
   * SIGKILL (default EXIT_WAIT_MS, Session.exited).
   */
  exitWaitMs?: number
}

/** After the last background task of a Session waiting to be given back ended: the wait for its task-notification turn. */
export const RETURN_GRACE_MS = 30_000

/** One Session started for an Orchestrator; `current` turns false when another replaces it. */
interface Run {
  current: boolean
  /** The SDK session it was asked to resume. */
  resume: string | undefined
  /** Claude Code has reported the session (system/init): the resume, if any, worked. */
  initSeen: boolean
  session: Session | null
}

interface Entry {
  projectId: string
  nodeId: string
  path: string
  /** Set when the Project left the list before or while the Orchestrator started. */
  cancelled: boolean
  /** Settles once the first Session is started, or the start was given up. */
  ready: Promise<void>
  run: Run | null
  cost: CostCounter
  /** The session id last written to the Node's data. */
  savedSessionId: string | null
  /** The settings last saved for the Node (or the defaults); every Session of the Orchestrator starts with them. */
  settings: SessionSettings
  /** How the current Session runs: unattended while Autopilot has the Orchestrator. */
  launch: SessionLaunch
  /** A launch to switch to once the running turn ends; null when none waits. */
  wanted: SessionLaunch | null
}

/** Why "New conversation" is refused while Autopilot runs the Orchestrator. */
export const AUTOPILOT_OWNS_ORCHESTRATOR = 'Autopilot runs this Orchestrator: stop Autopilot before starting a new conversation'

/** Why Autopilot cannot take the Orchestrator while a turn runs: starting its Session again would kill the turn. */
export const ORCHESTRATOR_IN_TURN = 'The Orchestrator is in a turn: wait for it to end, or Interrupt it, before starting Autopilot'

/** Why Autopilot cannot take the Orchestrator while messages wait in its queue: they were meant for a person's Session. */
export const ORCHESTRATOR_HAS_QUEUE = 'Messages wait in the Orchestrator\'s queue: send or remove them before starting Autopilot'

/** Why Autopilot cannot take the Orchestrator while its background tasks live: starting its Session again would kill them. */
export const ORCHESTRATOR_HAS_TASKS = 'The Orchestrator\'s background tasks are still running: wait for them to end before starting Autopilot'

/** Why the Orchestrator's Session cannot be started again now: a turn is running. */
const inTurn = (state: string): boolean => state === 'busy' || state === 'needs_permission'

/** The live background tasks of the Orchestrator's current Session (ADR-0029). */
const liveTasksOf = (entry: Entry): number => entry.run?.session?.backgroundTasks().length ?? 0

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The running Orchestrators of the app, one per Project at most. */
export class Orchestrators {
  private readonly entries = new Map<string, Entry>()
  /** The last view of each Orchestrator Node, also after its Session closed. */
  private readonly views = new Map<string, OrchestratorView>()
  private version = 0

  constructor(private readonly deps: OrchestratorDeps) {}

  /**
   * Makes sure the Project has its Node and a running Session, and answers its view; a second call
   * while the Session runs (or starts) changes nothing. Rejects for a Project that is not in the
   * list, or that left it while the Orchestrator started.
   */
  async open(projectId: string): Promise<OrchestratorView> {
    const path = this.deps.projectPath(projectId)
    let entry = this.entries.get(projectId)
    if (entry === undefined) {
      entry = this.begin(projectId, path)
      this.entries.set(projectId, entry)
    }
    await entry.ready
    const view = this.views.get(entry.nodeId)
    if (entry.cancelled || view === undefined) throw new Error(`the Orchestrator of ${projectId} was stopped`)
    return view
  }

  /**
   * "New conversation" (ticket 18): the current Session closes and stays in the history as its
   * transcript; a new Session becomes the Project's Orchestrator, with its cost from zero. Refused
   * during a turn, like closing any Session (resume.ts).
   */
  async newConversation(projectId: string): Promise<OrchestratorView> {
    await this.open(projectId)
    const entry = this.entries.get(projectId)
    if (entry === undefined) throw new Error(`the Orchestrator of ${projectId} was stopped`)
    if (entry.launch.unattended) throw new Error(AUTOPILOT_OWNS_ORCHESTRATOR)
    const refusal = closeRefusal(this.current(entry).state)
    if (refusal !== null) throw new Error(refusal)
    const old = entry.run
    if (old) {
      old.current = false
      old.session?.close()
    }
    this.forgetSession(entry)
    this.launch(entry, undefined, { model: null, statusBlock: null })
    const view = this.views.get(entry.nodeId)
    if (view === undefined) throw new Error(`the Orchestrator of ${projectId} has no view`)
    return view
  }

  /**
   * Autopilot (worfy-daily ticket 04): starts the Orchestrator's Session again unattended, or
   * attended again, continuing the same SDK session. Going unattended opens the Orchestrator first
   * and is refused while a turn runs — also an unattended turn left over from a stopped run — and
   * while messages wait in the queue. Going back to attended while a turn runs waits for the turn's
   * end; the queue goes over to the attended Session. Answers the view, after a relaunch once the new
   * Session's process has started (ADR-0064); for an Orchestrator that is not open, going attended
   * does nothing.
   */
  async setUnattended(projectId: string, unattended: boolean): Promise<OrchestratorView | null> {
    if (!unattended) {
      const entry = this.entries.get(projectId)
      if (entry === undefined) return null
      await entry.ready
      if (this.entries.get(projectId) !== entry || entry.cancelled) return null
      if (!entry.launch.unattended) {
        entry.wanted = null
      } else if (inTurn(this.current(entry).state) || liveTasksOf(entry) > 0) {
        entry.wanted = ATTENDED
      } else {
        await this.relaunch(entry, ATTENDED)
      }
      return this.views.get(entry.nodeId) ?? null
    }
    await this.open(projectId)
    const entry = this.entries.get(projectId)
    if (entry === undefined) throw new Error(`the Orchestrator of ${projectId} was stopped`)
    if (inTurn(this.current(entry).state)) throw new Error(ORCHESTRATOR_IN_TURN)
    // Also while a stopped run's Session waits to be given back: for its tasks, or for the turn
    // the last one's task-notification starts.
    if (liveTasksOf(entry) > 0 || entry.wanted !== null) throw new Error(ORCHESTRATOR_HAS_TASKS)
    if ((entry.run?.session?.queued().items.length ?? 0) > 0) throw new Error(ORCHESTRATOR_HAS_QUEUE)
    entry.wanted = null
    if (!entry.launch.unattended) await this.relaunch(entry, { unattended: true })
    // The Project may have left the list while the old process was waited for.
    if (this.entries.get(projectId) !== entry || entry.cancelled) throw new Error(`the Orchestrator of ${projectId} was stopped`)
    const view = this.views.get(entry.nodeId)
    if (view === undefined) throw new Error(`the Orchestrator of ${projectId} has no view`)
    return view
  }

  /**
   * Stop in Autopilot (worfy-week ticket 17, ADR-0050): starts the Orchestrator's Session again
   * attended at once, without waiting for a turn or background tasks — the Session has been halted
   * (Session.halt), and closing its process ends whatever outlived the interrupt. The queue goes
   * over held, as Session.halt left it. Answers the view once the new Session's process has started,
   * after the old one exited (ADR-0064); null for an Orchestrator that is not open.
   */
  async giveBackNow(projectId: string): Promise<OrchestratorView | null> {
    const entry = this.entries.get(projectId)
    if (entry === undefined) return null
    await entry.ready
    if (this.entries.get(projectId) !== entry || entry.cancelled) return null
    if (entry.launch.unattended) await this.relaunch(entry, ATTENDED)
    else entry.wanted = null
    return this.views.get(entry.nodeId) ?? null
  }

  /** Whether the Project's Orchestrator runs unattended now. */
  isUnattended(projectId: string): boolean {
    return this.entries.get(projectId)?.launch.unattended ?? false
  }

  /** The last view of the Orchestrator behind a Node, or null. */
  view(nodeId: string): OrchestratorView | null {
    return this.views.get(nodeId) ?? null
  }

  /** Stops the Orchestrators of Projects that are no longer in the list. */
  retain(projectIds: ReadonlySet<string>): void {
    for (const [projectId, entry] of [...this.entries]) {
      if (projectIds.has(projectId)) continue
      this.entries.delete(projectId)
      entry.cancelled = true
      this.views.delete(entry.nodeId)
      const run = entry.run
      if (run) run.current = false
      run?.session?.close()
    }
  }

  private begin(projectId: string, path: string): Entry {
    const node = this.node(projectId)
    const saved = readOrchestratorData(node.data)
    const entry: Entry = {
      projectId,
      nodeId: node.id,
      path,
      cancelled: false,
      ready: Promise.resolve(),
      run: null,
      cost: new CostCounter(saved.costUsd ?? 0),
      savedSessionId: saved.sessionId ?? null,
      settings: this.savedSettings(projectId, node.id),
      launch: ATTENDED,
      wanted: null,
    }
    entry.ready = this.start(entry)
    return entry
  }

  /** The Node's saved picks; the defaults when there are none or they cannot be read, so the start goes on. */
  private savedSettings(projectId: string, nodeId: string): SessionSettings {
    try {
      return this.deps.settings.read(projectId, nodeId) ?? DEFAULT_SETTINGS
    } catch (error) {
      console.warn(`[orchestrator] could not read the saved settings of ${projectId}; starting with the defaults`, error)
      return DEFAULT_SETTINGS
    }
  }

  /** Reads the saved session's transcript, then starts the Session: resumed, or new when it is gone. */
  private async start(entry: Entry): Promise<void> {
    let resume = entry.savedSessionId ?? undefined
    let facts: TranscriptFacts = { model: null, statusBlock: null }
    if (resume !== undefined) {
      try {
        const found = await this.deps.transcript(entry.path, resume)
        if (found === null) {
          // Claude Code would refuse the resume, and every message after it.
          if (!entry.cancelled) this.forgetSession(entry)
          resume = undefined
        } else {
          facts = found
        }
      } catch (error) {
        // A transcript that cannot be read is not a missing one: keep the session and resume it.
        console.warn(`[orchestrator] could not read the transcript of ${resume}`, error)
      }
    }
    if (entry.cancelled) return
    this.launch(entry, resume, facts)
  }

  /** Starts the Orchestrator's Session; with `after`, its Claude Code process waits for `after` (relaunch). */
  private launch(entry: Entry, resume: string | undefined, facts: TranscriptFacts, after?: Promise<void>): void {
    const run: Run = { current: true, resume, initSeen: false, session: null }
    entry.run = run
    // The view goes first: the registry reports `starting` before start() returns.
    this.setView(entry, {
      projectId: entry.projectId,
      nodeId: entry.nodeId,
      sessionId: null,
      state: 'starting',
      error: null,
      model: facts.model,
      costUsd: entry.cost.total,
      statusBlock: facts.statusBlock,
    })
    try {
      run.session = this.deps.registry.start(entry.path, resume, (sessionId, event) => this.onEvent(entry, run, sessionId, event), entry.settings, entry.launch, after)
    } catch (error) {
      // E.g. the session is already live in another Session; the next open tries again.
      run.current = false
      if (this.entries.get(entry.projectId) === entry) this.entries.delete(entry.projectId)
      this.setView(entry, { ...this.current(entry), state: 'error', error: messageOf(error) })
    }
  }

  private onEvent(entry: Entry, run: Run, sessionId: string, event: AgentEvent): void {
    if (run.current) this.apply(entry, run, sessionId, event)
    try {
      this.deps.broadcast(sessionId, event)
    } catch (error) {
      console.warn('[orchestrator] could not send an event to the windows', error)
    }
  }

  /** What one event of the current Session changes: the view, the Node's data for the session id and cost, and the saved settings. */
  private apply(entry: Entry, run: Run, sessionId: string, event: AgentEvent): void {
    const next = { ...this.current(entry), sessionId }
    switch (event.type) {
      case 'init':
        run.initSeen = true
        next.model = event.model
        if (event.sdkSessionId !== entry.savedSessionId) {
          entry.savedSessionId = event.sdkSessionId
          this.patch(entry, { sessionId: event.sdkSessionId })
        }
        break
      case 'state':
        next.state = event.state
        next.error = event.error
        if (event.state === 'error') {
          entry.cost.processEnded()
          if (run.resume !== undefined && !run.initSeen && NO_CONVERSATION.test(event.error ?? '')) {
            this.startOver(entry, run)
            return
          }
        }
        if (event.state === 'closed' && this.entries.get(entry.projectId) === entry) this.entries.delete(entry.projectId)
        if ((event.state === 'idle' || event.state === 'error') && entry.wanted !== null) this.relaunchLater(entry, run)
        break
      case 'settings':
        // The forced bypassPermissions of an unattended Session is not the user's pick (ADR-0022).
        if (entry.launch.unattended) break
        if (!sameSettings(entry.settings, event.settings)) {
          entry.settings = event.settings
          this.saveSettings(entry, event.settings)
        }
        break
      case 'background_tasks':
        // The last task ended: its task-notification starts a turn, which the relaunch waits for;
        // when none comes within the grace time, the relaunch goes on without it.
        if (event.tasks.length === 0 && entry.wanted !== null) this.relaunchAfterGrace(entry, run)
        break
      case 'result':
        next.costUsd = entry.cost.result(event.costUsd)
        this.patch(entry, { costUsd: next.costUsd })
        break
      case 'text': {
        // Only the Orchestrator's own answers: not a subagent's, and not text Claude Code wrote.
        if (event.parentToolUseId !== null || event.synthetic) break
        const block = findStatusBlock(event.text)
        if (block !== null) next.statusBlock = block.text
        break
      }
      default:
        // Nothing to show, but a `renamed` event carries the Session's final id.
        break
    }
    this.setView(entry, next)
  }

  /**
   * Claude Code refused to resume the saved session: its transcript is gone. The Orchestrator
   * starts a new session in a new Session, rather than failing every message the same way.
   */
  private startOver(entry: Entry, failed: Run): void {
    console.warn(`[orchestrator] ${failed.resume ?? ''} cannot be resumed; ${entry.projectId} starts a new session`)
    failed.current = false
    failed.session?.close()
    this.forgetSession(entry)
    this.launch(entry, undefined, { model: null, statusBlock: null })
  }

  /**
   * Starts the Orchestrator's Session again with `launch`, continuing the saved SDK session. What
   * waits in the old Session's queue goes over to the new one, held as it was. The old Session's
   * error is not carried: the new Session starts a new Claude Code process — once the old one has
   * exited (ADR-0064). The new Session is live at once and holds what is sent to it until then; a
   * second relaunch meanwhile closes it before it started, so it waits for the same old process.
   * Settles once the new process has started (or the new Session was closed first); never rejects.
   */
  private relaunch(entry: Entry, launch: SessionLaunch): Promise<void> {
    entry.wanted = null
    entry.launch = launch
    const old = entry.run
    const queue = old?.session?.handOverQueue() ?? { items: [], paused: false }
    let oldExit: Promise<void> | undefined
    if (old) {
      old.current = false
      old.session?.close()
      oldExit = old.session?.exited(this.deps.exitWaitMs ?? EXIT_WAIT_MS)
    }
    // A new Claude Code process reports its cost from zero.
    entry.cost.processEnded()
    const view = this.current(entry)
    this.launch(entry, entry.savedSessionId ?? undefined, { model: view.model, statusBlock: view.statusBlock }, oldExit)
    const next = entry.run
    if (next === null || next === old || next.session === null) return oldExit ?? Promise.resolve()
    if (queue.items.length > 0) {
      try {
        next.session.adoptQueue(queue)
      } catch (error) {
        console.warn(`[orchestrator] could not carry the queue of ${entry.projectId} over`, error)
      }
    }
    return next.session.started()
  }

  /**
   * The launch that waited for the turn's end: applied after the Session has finished handling
   * the event that ended the turn (it may start a queued turn right after, which waits again).
   */
  private relaunchLater(entry: Entry, run: Run): void {
    queueMicrotask(() => this.relaunchIfFree(entry, run))
  }

  /** The waiting launch, once the Session has neither a turn nor a live background task. */
  private relaunchIfFree(entry: Entry, run: Run): void {
    const wanted = entry.wanted
    if (wanted === null || entry.run !== run || !run.current || entry.cancelled) return
    if (inTurn(this.current(entry).state) || liveTasksOf(entry) > 0) return
    void this.relaunch(entry, wanted)
  }

  private relaunchAfterGrace(entry: Entry, run: Run): void {
    const timer = setTimeout(() => this.relaunchIfFree(entry, run), this.deps.returnGraceMs ?? RETURN_GRACE_MS)
    // A relaunch that never comes due must not keep the app (or a test) alive.
    ;(timer as { unref?: () => void }).unref?.()
  }

  /** A new session: no id to resume, and its cost starts from zero. */
  private forgetSession(entry: Entry): void {
    entry.savedSessionId = null
    entry.cost = new CostCounter(0)
    this.patch(entry, { sessionId: null, costUsd: 0 })
  }

  private current(entry: Entry): Omit<OrchestratorView, 'version'> {
    const view = this.views.get(entry.nodeId)
    if (view === undefined) throw new Error(`the Orchestrator of ${entry.projectId} has no view`)
    return view
  }

  private setView(entry: Entry, view: Omit<OrchestratorView, 'version'>): void {
    if (entry.cancelled) return
    const before = this.views.get(entry.nodeId)
    if (before !== undefined && sameView(before, view)) return
    this.version += 1
    const next: OrchestratorView = { ...view, version: this.version }
    this.views.set(entry.nodeId, next)
    try {
      this.deps.publish(next)
    } catch (error) {
      console.warn('[orchestrator] could not send a view to the windows', error)
    }
  }

  /** The Project's Orchestrator Node: the first Node of the kind, or a new locked one. */
  private node(projectId: string): LayoutNode {
    const { layout } = this.deps.layout.get(projectId)
    const existing = layout.nodes.find((node) => node.kind === ORCHESTRATOR_KIND)
    if (existing) return existing
    const { x, y } = orchestratorPlace(layout.nodes)
    const after = this.deps.layout.apply(projectId, {
      op: 'create',
      node: { kind: ORCHESTRATOR_KIND, x, y, w: ORCHESTRATOR_WIDTH, h: ORCHESTRATOR_HEIGHT, locked: true, data: {} },
    })
    const created = after.layout.nodes.find((node) => node.kind === ORCHESTRATOR_KIND)
    if (!created) throw new Error(`the Orchestrator Node of ${projectId} was not created`)
    return created
  }

  private saveSettings(entry: Entry, settings: SessionSettings): void {
    try {
      this.deps.settings.write(entry.projectId, entry.nodeId, settings)
    } catch (error) {
      // The live Session keeps the picks; only the next start of the app loses them.
      console.warn(`[orchestrator] could not save the settings of ${entry.projectId}`, error)
    }
  }

  private patch(entry: Entry, data: Partial<OrchestratorData>): void {
    try {
      this.deps.layout.apply(entry.projectId, { op: 'patchData', id: entry.nodeId, data })
    } catch (error) {
      // The Project was removed from the list while its Session still reported.
      console.warn(`[orchestrator] could not update the Node of ${entry.projectId}`, error)
    }
  }
}

function sameView(a: Omit<OrchestratorView, 'version'>, b: Omit<OrchestratorView, 'version'>): boolean {
  return (
    a.projectId === b.projectId &&
    a.nodeId === b.nodeId &&
    a.sessionId === b.sessionId &&
    a.state === b.state &&
    a.error === b.error &&
    a.model === b.model &&
    a.costUsd === b.costUsd &&
    a.statusBlock === b.statusBlock
  )
}
