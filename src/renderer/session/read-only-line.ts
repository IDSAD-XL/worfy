// What the read-only Session view (ExternalSessionPanel.tsx) says under its transcript, and which
// action it offers (worfy-polish ticket 75). A Session started outside worfy is read-only for good:
// the line says where it was started. A Session worfy started on a Session Node (`origin: 'worfy'`)
// is shown here only while it does not run — after a Close, or after worfy restarted — and that is
// not "read-only": the line says it is not running and offers Resume, as its Node on the Canvas does.
import type { LayoutNode } from '../../shared/layout/types'
import { readWorfySessionNodeData, SESSION_KIND } from '../claude-home/session-nodes'

/**
 * The Session Node worfy runs (or ran) this Session on: the Node the view was opened on when it is
 * a worfy Node naming the Session, else any worfy Session Node of the Layout naming it (the palette,
 * a notification and the Work track open a Session by the id `session:<sessionId>`). undefined for a
 * Session worfy did not start.
 */
export function worfyNodeOf(nodes: readonly LayoutNode[] | undefined, nodeId: string, sessionId: string): LayoutNode | undefined {
  const names = (node: LayoutNode) => node.kind === SESSION_KIND && readWorfySessionNodeData(node.data)?.sessionId === sessionId
  return nodes?.find((node) => node.id === nodeId && names(node)) ?? nodes?.find(names)
}

export interface ReadOnlyLine {
  text: string
  /** `resume`: continue the Session on its Node; `open`: worfy runs it, show its live view; null: none. */
  action: 'resume' | 'open' | null
}

export interface ReadOnlyLineInput {
  /** The view shows one Subagent's transcript. */
  subagent: boolean
  /** The Session's worfy Session Node: whether it runs the Session now; null when worfy did not start it. */
  worfy: { running: boolean } | null
  /** Started in Claude desktop (else in a terminal); counts only for a Session worfy did not start. */
  desktop: boolean
}

export function readOnlyLine({ subagent, worfy, desktop }: ReadOnlyLineInput): ReadOnlyLine {
  if (subagent) return { text: 'Read-only: Subagent transcript', action: null }
  if (worfy !== null) return worfy.running ? { text: 'Running in worfy', action: 'open' } : { text: 'Not running — Resume to continue', action: 'resume' }
  return { text: `Read-only: started in ${desktop ? 'Claude desktop' : 'terminal'}`, action: null }
}
