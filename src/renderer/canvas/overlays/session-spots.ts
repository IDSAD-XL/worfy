// Where the new Session Nodes of SessionNodes.tsx go when their Sessions are bound (worfy-canvas
// ticket 11): each Session's Binding at the moment its Node is made, turned into a spot right of
// the strip of Epic frames (../session-spot.ts). A Binding that shows up later moves nothing.
import { bindingWorkflowOf } from '../../../shared/binding/resolve'
import type { ManualBinding, SessionBindingSignals } from '../../../shared/ipc/bindings'
import type { Rect } from '../../../shared/layout/free-place'
import type { WorkflowModel } from '../../../shared/workflow/types'
import { resolveAgentBindings } from '../../binding/store'
import { invoke } from '../../ipc'
import { sessionSpot, spotInputs, stripKeepOut, type DrawnNode } from '../session-spot'

export interface BindingSpotsInput {
  root: string
  /** The Sessions that get a new Node now. */
  sessionIds: readonly string[]
  manual: readonly ManualBinding[]
  model: WorkflowModel | undefined
  /** React Flow's Nodes, read after the signals arrived: where the frames and Tickets are drawn now. */
  nodes: () => Iterable<DrawnNode>
}

/**
 * Where the new Nodes of these Sessions go, by the Binding each has at this moment: its manual
 * Binding or what its transcript says (claim, `/epic-wave`, branch, …). Empty without a strip of
 * Epic frames on the Canvas; a Session whose signals cannot be read gets no spot.
 */
export async function bindingSpots({ root, sessionIds, manual, model, nodes }: BindingSpotsInput): Promise<{ near: Map<string, { x: number; y: number }>; keepOut: Rect[] }> {
  const near = new Map<string, { x: number; y: number }>()
  if (sessionIds.length === 0 || spotInputs(nodes()).strip === undefined) return { near, keepOut: [] }
  const signals = new Map<string, SessionBindingSignals>()
  for (const sessionId of sessionIds) {
    try {
      const result = await invoke('bindings.signals', { projectRoot: root, sessionId })
      if (result.ok) signals.set(sessionId, result.value)
      else console.error(`bindings.signals ${sessionId} failed:`, result.error)
    } catch (error) {
      // Without its signals the Session goes where every new Session Node goes.
      console.error(`bindings.signals ${sessionId} failed:`, error)
    }
  }
  const bindings = resolveAgentBindings({ sessionIds, signals, manual, workflow: bindingWorkflowOf(model) })
  const { frames, strip } = spotInputs(nodes())
  if (strip === undefined) return { near, keepOut: [] }
  for (const sessionId of sessionIds) {
    const spot = sessionSpot(bindings.get(sessionId)?.target, frames, strip)
    if (spot !== undefined) near.set(sessionId, spot)
  }
  return { near, keepOut: [stripKeepOut(strip)] }
}
