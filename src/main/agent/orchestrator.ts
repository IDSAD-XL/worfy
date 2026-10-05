// The Orchestrator of each Project: its main Session (CONTEXT.md, «Оркестратор») and the locked
// Node that shows it on the Canvas.
//
// open() finds the Project's Orchestrator Node in the Layout or creates it, then starts the
// Session in the Project's root: a new one, or the SDK session saved in the Node's `data`, resumed.
//
// The Node's data keeps only the SDK session id, the summed cost and the model, effort and
// permission mode the user picked (ticket 19): nothing else records them in a form worfy can read
// back. The Session starts (and resumes) with the saved picks. Everything else the Node shows lives in memory, in the Orchestrator's
// view: the model and the last status block come from the saved session's transcript when the
// Orchestrator opens (orchestrator-transcript.ts) and then from the live Session's events; the
// state is the live Session's. Views go to the windows on `orchestrator.changed`.
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
import type { EventSink, Session, SessionRegistry } from './session'

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
  /**
   * The model and the last status block of a saved SDK session, read from its transcript under
   * the Claude home; null when the Project has no transcript of that session.
   */
  transcript(projectRoot: string, sdkSessionId: string): Promise<TranscriptFacts | null>
  /** Gets every event of every Orchestrator, e.g. to send it to the windows. */
  broadcast: EventSink
  /** Gets every new view, e.g. to send it to the windows. */
  publish(view: OrchestratorView): void
}

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
  /** The settings last written to the Node's data (or the defaults); every Session of the Orchestrator starts with them. */
  settings: SessionSettings
}

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
      settings: saved.settings ?? DEFAULT_SETTINGS,
    }
    entry.ready = this.start(entry)
    return entry
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

  private launch(entry: Entry, resume: string | undefined, facts: TranscriptFacts): void {
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
      run.session = this.deps.registry.start(entry.path, resume, (sessionId, event) => this.onEvent(entry, run, sessionId, event), entry.settings)
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

  /** What one event of the current Session changes: the view, and the Node's data for the session id, cost and settings. */
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
        break
      case 'settings':
        if (!sameSettings(entry.settings, event.settings)) {
          entry.settings = event.settings
          this.patch(entry, { settings: event.settings })
        }
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
