// Which view the window shows (Canvas or Session) and which Session the Session view is on. The
// toolbar's switch and a double click on a Session's Node (OrchestratorNode.tsx) both go through
// here; main.tsx hands the view to AppShell.
import { create } from 'zustand'
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
  /** null: the Session view shows the active Project's Orchestrator. */
  opened: OpenedSession | null
}

export const useNavigation = create<NavigationStore>(() => ({ view: 'canvas', opened: null }))

export function setView(view: ShellView): void {
  useNavigation.setState({ view })
}

/** Shows the Session view on the Session behind a Node. */
export function openSession(opened: OpenedSession): void {
  useNavigation.setState({ view: 'session', opened })
}

/**
 * The palette's "Go to Orchestrator": shows the Session view with nothing opened — the view shows
 * the Project's Orchestrator — and asks main to open it. The Session view asks only when it mounts
 * or the Project changes, so an Orchestrator that failed to start or closed since would stay down;
 * `orchestrator.open` starts it again, and changes nothing while its Session runs or starts
 * (src/main/agent/orchestrator.ts, open). Resolves to the reason when main refuses.
 */
export async function openOrchestrator(projectId: string): Promise<string | undefined> {
  useNavigation.setState({ view: 'session', opened: null })
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
