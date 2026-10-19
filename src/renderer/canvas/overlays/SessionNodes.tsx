// Keeps a Session Node on the Canvas for every live Session of the Project, wherever it was
// started (ticket 14; the plan is src/renderer/claude-home/session-nodes.ts): a Node appears when a
// Session starts and stays, finished, after its process is gone. The overlay draws nothing; it
// sends Layout operations to main and centers the Canvas on a Session's Node when the sidebar
// asks for it (claude-home/focus.ts). A new Session whose Binding is known when its Node is made
// gets its Node next to its Ticket or Epic, right of the strip of Epic frames (worfy-canvas
// ticket 11, session-spot.ts); a Node already made is not moved when the Binding shows up later.
import { useEffect, useRef } from 'react'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { ZOOM_MAX, ZOOM_MIN } from '../../../shared/layout/types'
import { useManualBindings } from '../../binding/store'
import { useSessionFocus } from '../../claude-home/focus'
import { planSessionNodes, worfySessionIds } from '../../claude-home/session-nodes'
import { useClaudeHome } from '../../claude-home/useClaudeHome'
import { invoke } from '../../ipc'
import { activeProject, useProjects } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import type { CanvasFlowNode } from '../nodes'
import { applyLayoutOp, useLayout } from '../useLayout'
import { bindingSpots } from './session-spots'

export const order = 50

/** Frames a focus request waits for its Node to reach React Flow, shown: about a second. */
const FOCUS_TRIES = 60

/** Session ids that had a Node in this run of the app, by Project: a Node the user removed stays removed. */
const seenByProject = new Map<string, Set<string>>()

function seenOf(projectId: string): Set<string> {
  let seen = seenByProject.get(projectId)
  if (seen === undefined) {
    seen = new Set()
    seenByProject.set(projectId, seen)
  }
  return seen
}

/** Session ids that worfy's own Sessions have now (`agent.list`); empty when main does not answer. */
async function runningIds(): Promise<string[]> {
  const result = await invoke('agent.list')
  if (result.ok) return result.value.map((session) => session.sessionId)
  console.error('agent.list failed:', result.error)
  return []
}

function useFocusRequests(projectId: string): void {
  const flow = useReactFlow()
  const store = useStoreApi()
  const request = useSessionFocus((state) => state.request)
  useEffect(() => {
    if (!request || request.projectId !== projectId) return
    // The sidebar shows a hidden Node and switches to the Canvas just before it asks: the Node may
    // reach React Flow, and the Canvas get its size, a few frames later. Wait for both, up to a second.
    let frame = 0
    let tries = 0
    const attempt = (): void => {
      const node = flow.getNode(request.nodeId)
      const { width, height } = store.getState()
      if (!node || node.hidden === true || !width || !height) {
        tries += 1
        if (tries < FOCUS_TRIES) frame = requestAnimationFrame(attempt)
        return
      }
      const w = node.width ?? node.measured?.width ?? 0
      const h = node.height ?? node.measured?.height ?? 0
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, flow.getZoom()))
      void flow.setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom, duration: 250 })
      // Select only this Node, from the Nodes the Canvas holds. Not resetSelectedElements() and
      // addSelectedNodes(): the second compares with React Flow's own copy, which still says
      // "selected" for a Node that was selected before (e.g. by the click on its Hide button), so
      // the Node would be deselected and never selected again.
      const { nodes, edges, triggerNodeChanges, triggerEdgeChanges } = store.getState()
      triggerNodeChanges(
        nodes.filter((each) => (each.selected ?? false) !== (each.id === node.id)).map((each) => ({ type: 'select' as const, id: each.id, selected: each.id === node.id })),
      )
      triggerEdgeChanges(edges.filter((edge) => edge.selected === true).map((edge) => ({ type: 'select' as const, id: edge.id, selected: false })))
    }
    attempt()
    return () => cancelAnimationFrame(frame)
    // Only a new request moves the Canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, projectId])
}

function SessionNodesSync({ projectId, root }: { projectId: string; root: string }) {
  const { live } = useClaudeHome(root)
  const { state } = useLayout(projectId)
  const { model } = useWorkflow(root)
  const manual = useManualBindings(projectId)
  const store = useStoreApi<CanvasFlowNode>()
  const busy = useRef(false)
  const again = useRef(false)
  const latest = useRef({ live, state, projectId, root, model, manual })
  useEffect(() => {
    latest.current = { live, state, projectId, root, model, manual }
  })

  useFocusRequests(projectId)

  useEffect(() => {
    if (live === undefined || state === undefined) return
    const sync = async (): Promise<void> => {
      if (busy.current) {
        again.current = true
        return
      }
      busy.current = true
      try {
        do {
          again.current = false
          const { live: current, state: layout } = latest.current
          if (current === undefined || layout === undefined) return
          const seen = seenOf(latest.current.projectId)
          const nodes = layout.layout.nodes
          for (const node of nodes) if (typeof node.data.sessionId === 'string') seen.add(node.data.sessionId)
          const first = planSessionNodes({ live: current, nodes, worfyIds: worfySessionIds(nodes, []), seen })
          if (first.create.length === 0 && first.remove.length === 0) continue
          // Only now ask main which Sessions it runs: a Session of worfy's whose Node does not name it yet.
          const worfyIds = worfySessionIds(nodes, await runningIds())
          // And what the new Sessions are bound to, at the moment their Nodes are made.
          const { near, keepOut } = await bindingSpots({
            root: latest.current.root,
            sessionIds: first.create.map((op) => String(op.node.data?.sessionId)).filter((id) => !worfyIds.has(id)),
            manual: latest.current.manual,
            model: latest.current.model,
            nodes: () => store.getState().nodeLookup.values(),
          })
          const plan = planSessionNodes({ live: current, nodes, worfyIds, seen, near, keepOut })
          // Not the user's gestures: sent without a step of the undo history (history.ts), as the other
          // automatic writers of the Layout do. The Canvas's LayoutOps would record them.
          const target = latest.current.projectId
          for (const id of plan.remove) await applyLayoutOp(target, { op: 'remove', id })
          for (const op of plan.create) {
            seen.add(String(op.node.data?.sessionId))
            await applyLayoutOp(target, op)
          }
        } while (again.current)
      } finally {
        busy.current = false
      }
    }
    void sync()
  }, [live, state, store])

  return null
}

export default function SessionNodes() {
  const project = activeProject(useProjects())
  return project ? <SessionNodesSync key={project.id} projectId={project.id} root={project.path} /> : null
}
