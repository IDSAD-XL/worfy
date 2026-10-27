import type { LiveSession } from '../../shared/ipc/claude-home'
import type { OrchestratorView } from '../../shared/ipc/orchestrator'
import type { SessionNodeView } from '../../shared/ipc/sessions'
import { shownOnCanvas } from '../../shared/layout/derived'
import type { LayoutNode } from '../../shared/layout/types'
import { readSessionNodeData, readWorfySessionNodeData, sessionStatus, worfySessionTitle, type HistoryTitle } from '../claude-home/session-nodes'
import type { Status } from '../theme/primitives'
import { STATE_CHIPS } from './format'
import { nodeSession, type OpenedSession } from './navigation'
import { isRunning } from './node-sessions'

// The rows of the Session picker in the header of the Session view (SessionPicker.tsx, worfy-polish
// ticket 44): every Session of the Project that has a Node on the Canvas — the Orchestrator first,
// then the ones whose process runs (worfy's own, or one of Claude Code's registry), then the rest —
// each with its title and status as its Node shows them. Choosing one opens it as a double click on
// its Node does. The Subagents are not here: they are in the rail. A Session shown without such a
// Node (a transcript from the palette, a Subagent's window) stands at the top while it is shown,
// and cannot be chosen.

export interface PickerSession {
  nodeId: string
  orchestrator: boolean
  title: string
  chip: { status: Status; label: string }
  /** Its process runs: worfy runs it, or Claude Code's registry lists it. */
  running: boolean
  /** What choosing it opens (navigation.ts, nodeSession). */
  opens: OpenedSession
}

export interface PickerInput {
  projectId: string
  nodes: readonly LayoutNode[]
  orchestrators: Readonly<Record<string, OrchestratorView>>
  sessionNodes: Readonly<Record<string, SessionNodeView>>
  /** Claude Code's registry of live Sessions; undefined until it is read. */
  live: readonly LiveSession[] | undefined
  history: readonly HistoryTitle[]
}

const UNREAD = { status: 'ready', label: '…' } as const

function entryOf(node: LayoutNode, { projectId, orchestrators, sessionNodes, live, history }: PickerInput): PickerSession | null {
  const inRegistry = (sessionId: string | null | undefined): boolean => sessionId != null && live?.some((each) => each.sessionId === sessionId) === true
  if (node.kind === 'orchestrator') {
    const view = orchestrators[node.id]
    return { nodeId: node.id, orchestrator: true, title: 'Orchestrator', chip: STATE_CHIPS[view?.state ?? 'starting'], running: true, opens: { nodeId: node.id, projectId } }
  }
  const own = readWorfySessionNodeData(node.data)
  if (own !== null) {
    const view = sessionNodes[node.id]
    const runs = isRunning(view)
    const opens = nodeSession(node, projectId, runs)
    if (opens === null) return null
    // The chip of its Node (SessionNode.tsx, LiveSessionNode).
    const chip = runs ? STATE_CHIPS[view.state] : own.sessionId !== undefined ? { status: 'done' as const, label: 'finished' } : { status: 'ready' as const, label: 'new' }
    return { nodeId: node.id, orchestrator: false, title: worfySessionTitle(own.sessionId, history), chip, running: runs || inRegistry(own.sessionId), opens }
  }
  const data = readSessionNodeData(node.data)
  const opens = nodeSession(node, projectId, false)
  if (data === null || opens === null) return null
  const session = live?.find((each) => each.sessionId === data.sessionId)
  const title = session?.name ?? history.find((each) => each.sessionId === data.sessionId)?.title ?? data.name ?? `Session ${data.sessionId.slice(0, 8)}`
  return { nodeId: node.id, orchestrator: false, title, chip: live === undefined ? UNREAD : sessionStatus(session), running: session !== undefined, opens }
}

/** The picker's rows: the Sessions of the Project's Nodes on the Canvas, the Orchestrator first, then the running ones, then the rest, each group in Layout order. */
export function pickerSessions(input: PickerInput): PickerSession[] {
  const entries = input.nodes.filter(shownOnCanvas).flatMap((node) => entryOf(node, input) ?? [])
  const rank = (entry: PickerSession): number => (entry.orchestrator ? 0 : entry.running ? 1 : 2)
  return entries.map((entry, index) => ({ entry, index, rank: rank(entry) })).sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ entry }) => entry)
}

/** The picker's value for what the Session view shows: a Subagent's window is none of the rows. */
export const pickerValue = (shown: OpenedSession): string => (shown.external?.agentId === undefined ? shown.nodeId : `agent:${shown.nodeId}/${shown.external.agentId}`)
