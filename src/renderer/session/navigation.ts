// Which view the window shows (Canvas or Session) and which Session the Session view is on. The
// toolbar's switch and a double click on a Session's Node (OrchestratorNode.tsx) both go through
// here; main.tsx hands the view to AppShell.
//
// The Session view remembers the last Session opened in each Project, not one for the window
// (worfy-polish ticket 44): back in a Project, the Session tab shows that Project's last Session
// again, or its Orchestrator once that Session's Node is closed, archived or hidden. The memory
// lives as long as the window; nothing of it is saved.
import { useEffect } from 'react'
import { create } from 'zustand'
import { isSourceNodeId, shownOnCanvas } from '../../shared/layout/derived'
import type { LayoutNode } from '../../shared/layout/types'
import { currentLayout, useLayout } from '../canvas/useLayout'
import { readSessionNodeData, readWorfySessionNodeData, SESSION_KIND } from '../claude-home/session-nodes'
import { invoke } from '../ipc'
import { readOnlyNow } from '../projects/read-only-now'
import type { ShellView } from '../shell/Toolbar'

/** The Node whose Session the Session view shows, and the Project it belongs to. */
export interface OpenedSession {
  nodeId: string
  projectId: string
  /**
   * A transcript shown read-only from its file (ExternalSessionPanel.tsx): a Session started outside
   * worfy, or with `agentId` one Subagent of any Session (ticket 15).
   */
  external?: { sessionId: string; agentId?: string | undefined } | undefined
}

interface NavigationStore {
  view: ShellView
  /** The last Session opened in each Project, by Project id; none: the Session view shows the Project's Orchestrator. */
  opened: Readonly<Record<string, OpenedSession>>
  /**
   * Projects whose last Session was opened while the Layout had no Node of that id — a transcript
   * from the palette, or a Node main had not sent yet: such a Session is shown without a Node.
   * Cleared once its Node is in the Layout, from when on a closed Node means the Orchestrator.
   */
  withoutNode: Readonly<Record<string, true>>
}

export const useNavigation = create<NavigationStore>(() => ({ view: 'canvas', opened: {}, withoutNode: {} }))

export function setView(view: ShellView): void {
  useNavigation.setState({ view })
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const rest = { ...record }
  delete rest[key]
  return rest
}

/**
 * Shows the Session view on the Session behind a Node, the last one of its Project from now on,
 * and tells main the user opened it: a `touch` of the Node, so the automatic archive leaves it for
 * a while (ADR-0076, point 2). Not from a read-only screen, which writes nothing, and not for a
 * Subagent's Node, which the Layout does not keep. The touch is sent without a screen: it is no
 * step of the undo history.
 */
export function openSession(opened: OpenedSession): void {
  const placed = currentLayout(opened.projectId)?.nodes.some((node) => node.id === opened.nodeId) === true
  useNavigation.setState((state) => ({
    view: 'session',
    opened: { ...state.opened, [opened.projectId]: opened },
    withoutNode: placed ? without(state.withoutNode, opened.projectId) : { ...state.withoutNode, [opened.projectId]: true },
  }))
  if (readOnlyNow() !== null || isSourceNodeId(opened.nodeId)) return
  void invoke('layout.apply', { projectId: opened.projectId, op: { op: 'touch', id: opened.nodeId } }).catch(() => undefined)
}

/**
 * The Session the Session view shows in a Project: its last opened one while that Session's Node
 * is on the Canvas — for a Subagent's window and a transcript, the Node it was opened on — else
 * null, the Project's Orchestrator. A Node closed, archived or hidden since leads to the
 * Orchestrator; a Session opened without a Node (`withoutNode`) is shown until it gets one. Before
 * the Layout has come (`nodes` undefined) there is nothing to judge by, and the last Session shows.
 */
export function shownSession(opened: OpenedSession | undefined, nodes: readonly LayoutNode[] | undefined, withoutNode: boolean): OpenedSession | null {
  if (opened === undefined) return null
  if (nodes === undefined) return opened
  const node = nodes.find((each) => each.id === opened.nodeId)
  if (node === undefined) return withoutNode ? opened : null
  return shownOnCanvas(node) ? opened : null
}

/** shownSession() of a Project, kept up with its Layout; what a click on the Session tab shows. */
export function useOpenedSession(projectId: string): OpenedSession | null {
  const opened = useNavigation((store) => store.opened[projectId])
  const withoutNode = useNavigation((store) => store.withoutNode[projectId] === true)
  const nodes = useLayout(projectId).state?.layout.nodes
  const placed = opened !== undefined && nodes?.some((node) => node.id === opened.nodeId) === true
  // The Node has come: from now on its closing leads to the Orchestrator.
  useEffect(() => {
    if (withoutNode && placed) useNavigation.setState((state) => ({ withoutNode: without(state.withoutNode, projectId) }))
  }, [withoutNode, placed, projectId])
  return shownSession(opened, nodes, withoutNode)
}

/**
 * What a double click on a Layout Node opens (OrchestratorNode.tsx, SessionNode.tsx), for the
 * Session picker and the sidebar's rows in the Session view: the Orchestrator; a Session worfy runs
 * on its Node live while it runs (`running`), else read-only from the transcript it saved; a
 * Session started outside worfy read-only. null for any other Node, and for a Session Node that
 * never had a Session.
 */
export function nodeSession(node: LayoutNode, projectId: string, running: boolean): OpenedSession | null {
  if (node.kind === 'orchestrator') return { nodeId: node.id, projectId }
  if (node.kind !== SESSION_KIND) return null
  const own = readWorfySessionNodeData(node.data)
  if (own !== null) {
    if (running) return { nodeId: node.id, projectId }
    return own.sessionId === undefined ? null : { nodeId: node.id, projectId, external: { sessionId: own.sessionId } }
  }
  const external = readSessionNodeData(node.data)
  return external === null ? null : { nodeId: node.id, projectId, external: { sessionId: external.sessionId } }
}

/**
 * The palette's "Go to Orchestrator": shows the Session view with nothing opened in the Project —
 * the view shows its Orchestrator — and asks main to open it. The Session view asks only when it mounts
 * or the Project changes, so an Orchestrator that failed to start or closed since would stay down;
 * `orchestrator.open` starts it again, and changes nothing while its Session runs or starts
 * (src/main/agent/orchestrator.ts, open). Resolves to the reason when main refuses.
 */
export async function openOrchestrator(projectId: string): Promise<string | undefined> {
  useNavigation.setState((state) => ({ view: 'session', opened: without(state.opened, projectId), withoutNode: without(state.withoutNode, projectId) }))
  // A read-only screen (worfy-link ticket 25) only shows the Orchestrator: starting it is a write.
  if (readOnlyNow() !== null) return undefined
  const result = await invoke('orchestrator.open', { projectId })
  return result.ok ? undefined : result.error
}

/** Where a Subagent's window is: the Node it was opened on, its Project and its Session. */
export interface SubagentPlace {
  nodeId: string
  projectId: string
  sessionId: string
}

/**
 * The Session a Subagent belongs to: live when worfy runs it on the Node (the Orchestrator, a
 * Session Node), else read-only from its transcript — a Session started outside worfy, or a worfy
 * one that no longer runs.
 */
export function subagentSession({ nodeId, projectId, sessionId }: SubagentPlace, live: boolean): OpenedSession {
  return live ? { nodeId, projectId } : { nodeId, projectId, external: { sessionId } }
}

/**
 * Where "Back" leads from a Subagent's window: its parent, not the place it was opened from. A
 * nested Subagent goes to the window of the Subagent that started it, any other to its Session.
 */
export function subagentParent(place: SubagentPlace, parentAgentId: string | null, live: boolean): OpenedSession {
  if (parentAgentId !== null) return { nodeId: place.nodeId, projectId: place.projectId, external: { sessionId: place.sessionId, agentId: parentAgentId } }
  return subagentSession(place, live)
}
