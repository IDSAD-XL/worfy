// The Orchestrator of each Project: its main Session (CONTEXT.md, «Оркестратор») and the locked
// Node that shows it on the Canvas.
//
// open() finds the Project's Orchestrator Node in the Layout or creates it, then starts the
// Session in the Project's root: a new one, or the SDK session saved in the Node's `data`, resumed.
// While the Session runs, what the Node shows — state, model, cost, the last status block — is
// written into that `data` through the Layout store, the Layout's only writer (ADR-0003). So the
// renderer reads it like any Layout change, and it is still there after a restart.
import type { AgentEvent } from '../../shared/agent/events'
import { findStatusBlock } from '../../shared/agent/status-block'
import { ORCHESTRATOR_KIND, readOrchestratorData, type OrchestratorData, type OrchestratorInfo } from '../../shared/ipc/orchestrator'
import type { LayoutNode, LayoutOpInput, LayoutState } from '../../shared/layout/types'
import type { EventSink, Session, SessionRegistry } from './session'

export const ORCHESTRATOR_WIDTH = 360
export const ORCHESTRATOR_HEIGHT = 200
const MARGIN = 40

/**
 * Where a new Orchestrator Node goes: the top-left corner of the Canvas when no Node is there,
 * otherwise under every Node, so it never covers one.
 */
export function orchestratorPlace(nodes: readonly LayoutNode[]): { x: number; y: number } {
  const spot = { x: MARGIN, y: MARGIN }
  const covers = (node: LayoutNode) =>
    node.x < spot.x + ORCHESTRATOR_WIDTH && spot.x < node.x + node.w && node.y < spot.y + ORCHESTRATOR_HEIGHT && spot.y < node.y + node.h
  if (!nodes.some(covers)) return spot
  return { x: Math.min(...nodes.map((node) => node.x)), y: Math.max(...nodes.map((node) => node.y + node.h)) + MARGIN }
}

/**
 * The cost of a Session across the Claude Code processes that ran it. Claude Code reports
 * `total_cost_usd` per process, growing with every turn (test/fixtures/sdk-messages/controls.jsonl);
 * a new process — after a crash, or after a restart of the app — counts from zero again.
 */
export class CostCounter {
  private run = 0

  /** `saved`: what the earlier processes cost, as kept in the Node's data. */
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

/** What one event of the Orchestrator's Session changes in its Node's data; null when nothing. */
export function orchestratorUpdate(event: AgentEvent, cost: CostCounter): Partial<OrchestratorData> | null {
  switch (event.type) {
    case 'init':
      return { sessionId: event.sdkSessionId, model: event.model }
    case 'state':
      if (event.state === 'error') cost.processEnded()
      return { state: event.state, error: event.error }
    case 'result':
      return { costUsd: cost.result(event.costUsd) }
    case 'text': {
      // Only the Orchestrator's own answers: not a subagent's, and not text Claude Code wrote.
      if (event.parentToolUseId !== null || event.synthetic) return null
      const block = findStatusBlock(event.text)
      return block === null ? null : { statusBlock: block.text }
    }
    default:
      return null
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
  /** Gets every event of every Orchestrator, e.g. to send it to the windows. */
  broadcast: EventSink
}

interface Live {
  nodeId: string
  session: Session | null
}

/** The running Orchestrators of the app, one per Project at most. */
export class Orchestrators {
  private readonly live = new Map<string, Live>()

  constructor(private readonly deps: OrchestratorDeps) {}

  /**
   * Makes sure the Project has its Node and a running Session; a second call while the Session
   * runs changes nothing. Throws for a Project that is not in the list.
   */
  open(projectId: string): OrchestratorInfo {
    const path = this.deps.projectPath(projectId)
    const running = this.live.get(projectId)
    if (running?.session) return this.info(projectId, running.nodeId, running.session)

    const node = this.node(projectId)
    const saved = readOrchestratorData(node.data)
    const cost = new CostCounter(saved.costUsd ?? 0)
    const entry: Live = { nodeId: node.id, session: null }
    const session = this.deps.registry.start(path, saved.sessionId, (sessionId, event) => {
      const update = orchestratorUpdate(event, cost)
      if (update !== null) this.patch(projectId, entry.nodeId, update)
      if (event.type === 'state' && event.state === 'closed' && this.live.get(projectId) === entry) this.live.delete(projectId)
      try {
        this.deps.broadcast(sessionId, event)
      } catch (error) {
        console.warn('[orchestrator] could not send an event to the windows', error)
      }
    })
    entry.session = session
    this.live.set(projectId, entry)
    return this.info(projectId, entry.nodeId, session)
  }

  /** Stops the Orchestrators of Projects that are no longer in the list. */
  retain(projectIds: ReadonlySet<string>): void {
    for (const [projectId, entry] of [...this.live]) {
      if (projectIds.has(projectId)) continue
      this.live.delete(projectId)
      entry.session?.close()
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

  private patch(projectId: string, nodeId: string, data: Partial<OrchestratorData>): void {
    try {
      this.deps.layout.apply(projectId, { op: 'patchData', id: nodeId, data })
    } catch (error) {
      // The Project was removed from the list while its Session still reported.
      console.warn(`[orchestrator] could not update the Node of ${projectId}`, error)
    }
  }

  private info(projectId: string, nodeId: string, session: Session): OrchestratorInfo {
    return { projectId, nodeId, sessionId: session.id, state: session.state }
  }
}
