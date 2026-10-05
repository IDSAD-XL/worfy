// Keeps a Session Node on the Canvas for every live Session of the Project, wherever it was
// started (ticket 14; the plan is src/renderer/claude-home/session-nodes.ts): a Node appears when a
// Session starts and stays, finished, after its process is gone. The overlay draws nothing; it
// sends Layout operations to main and centers the Canvas on a Session's Node when the sidebar
// asks for it (claude-home/focus.ts).
import { useEffect, useRef } from 'react'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { ZOOM_MAX, ZOOM_MIN } from '../../../shared/layout/types'
import { useSessionFocus } from '../../claude-home/focus'
import { planSessionNodes, worfySessionIds } from '../../claude-home/session-nodes'
import { useClaudeHome } from '../../claude-home/useClaudeHome'
import { invoke } from '../../ipc'
import { activeProject, useProjects } from '../../projects/useProjects'
import { useLayout, useLayoutOps } from '../useLayout'

export const order = 50

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
    const node = flow.getNode(request.nodeId)
    const { width, height } = store.getState()
    if (!node || !width || !height) return
    const w = node.width ?? node.measured?.width ?? 0
    const h = node.height ?? node.measured?.height ?? 0
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, flow.getZoom()))
    void flow.setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom, duration: 250 })
    const { resetSelectedElements, addSelectedNodes } = store.getState()
    resetSelectedElements()
    addSelectedNodes([node.id])
    // Only a new request moves the Canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, projectId])
}

function SessionNodesSync({ projectId, root }: { projectId: string; root: string }) {
  const { live } = useClaudeHome(root)
  const { state } = useLayout(projectId)
  const ops = useLayoutOps()
  const busy = useRef(false)
  const again = useRef(false)
  const latest = useRef({ live, state, projectId })
  useEffect(() => {
    latest.current = { live, state, projectId }
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
          const plan = planSessionNodes({ live: current, nodes, worfyIds: worfySessionIds(nodes, await runningIds()), seen })
          for (const id of plan.remove) await ops.apply({ op: 'remove', id })
          for (const op of plan.create) {
            seen.add(String(op.node.data?.sessionId))
            await ops.apply(op)
          }
        } while (again.current)
      } finally {
        busy.current = false
      }
    }
    void sync()
  }, [live, state, ops])

  return null
}

export default function SessionNodes() {
  const project = activeProject(useProjects())
  return project ? <SessionNodesSync key={project.id} projectId={project.id} root={project.path} /> : null
}
