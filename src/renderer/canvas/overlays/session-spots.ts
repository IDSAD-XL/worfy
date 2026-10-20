// Where the new Session Nodes of SessionNodes.tsx go when their Sessions are bound (worfy-canvas
// ticket 11): each Session's Binding at the moment its Node is made, turned into a spot right of
// the strip of Epic frames (../session-spot.ts). A Binding that shows up later moves nothing.
import { bindingWorkflowOf } from '../../../shared/binding/resolve'
import type { ManualBinding, SessionBindingSignals } from '../../../shared/ipc/bindings'
import type { Rect } from '../../../shared/layout/free-place'
import type { WorkflowModel } from '../../../shared/workflow/types'
import { refreshSessionSignals, resolveAgentBindings, sessionSignalsOf } from '../../binding/store'
import { sessionSpot, spotInputs, spotKeepOut, type DrawnNode } from '../session-spot'
import { arrangementOf } from '../sources/epics'

export interface BindingSpotsInput {
  root: string
  /** The Sessions that get a new Node now. */
  sessionIds: readonly string[]
  manual: readonly ManualBinding[]
  model: WorkflowModel | undefined
  /** React Flow's Nodes, read after the signals arrived: where the frames and Tickets are drawn now. */
  nodes: () => Iterable<DrawnNode>
  /** The Project whose frames are drawn: the height the strip keeps for each of them comes from its last build (frameReserves). */
  projectId: string
}

/** The height the strip keeps for each frame of the Project's last build, by Epic; undefined before its first build. */
export function frameReserves(projectId: string): ReadonlyMap<string, number> | undefined {
  const frames = arrangementOf(projectId)?.frames
  return frames === undefined ? undefined : new Map([...frames].map(([epic, frame]) => [epic, Math.max(frame.height, frame.reserve ?? frame.height)]))
}

/**
 * Where the new Nodes of these Sessions go, by the Binding each has at this moment: its manual
 * Binding or what its transcript says (claim, `/epic-wave`, branch, …). Empty without a strip of
 * Epic frames on the Canvas; a Session whose signals cannot be read gets no spot.
 */
export async function bindingSpots({ projectId, root, sessionIds, manual, model, nodes }: BindingSpotsInput): Promise<{ near: Map<string, { x: number; y: number }>; keepOut: Rect[] }> {
  const near = new Map<string, { x: number; y: number }>()
  if (sessionIds.length === 0 || spotInputs(nodes()).strip === undefined) return { near, keepOut: [] }
  // Read through the Bindings' store: one read per Session at a time, shared with the Canvas's anchors.
  await Promise.all(
    sessionIds.map((sessionId) =>
      refreshSessionSignals(root, sessionId).catch((error: unknown) => {
        // Without its signals the Session goes where every new Session Node goes.
        console.error(`bindings.signals ${sessionId} failed:`, error)
      }),
    ),
  )
  const signals = new Map<string, SessionBindingSignals>()
  for (const sessionId of sessionIds) {
    const found = sessionSignalsOf(root, sessionId)
    if (found !== undefined) signals.set(sessionId, found)
  }
  const bindings = resolveAgentBindings({ sessionIds, signals, manual, workflow: bindingWorkflowOf(model) })
  const drawn = spotInputs(nodes(), frameReserves(projectId))
  if (drawn.strip === undefined) return { near, keepOut: [] }
  for (const sessionId of sessionIds) {
    const spot = sessionSpot(bindings.get(sessionId)?.target, drawn.frames, drawn.strip)
    if (spot !== undefined) near.set(sessionId, spot)
  }
  return { near, keepOut: spotKeepOut(drawn) }
}
