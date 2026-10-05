// Which view the window shows (Canvas or Session) and which Session the Session view is on. The
// toolbar's switch and a double click on a Session's Node (OrchestratorNode.tsx) both go through
// here; main.tsx hands the view to AppShell.
import { create } from 'zustand'
import type { ShellView } from '../shell/Toolbar'

/** The Node whose Session the Session view shows, and the Project it belongs to. */
export interface OpenedSession {
  nodeId: string
  projectId: string
  /** A Session started outside worfy, shown read-only from its transcript file (ExternalSessionPanel.tsx). */
  external?: { sessionId: string } | undefined
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
