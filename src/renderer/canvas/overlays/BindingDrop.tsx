// The manual Binding on the Canvas (ticket 16): drag a Session's (or the Orchestrator's) Node or a
// Subagent's Node and drop it on a Ticket or on an Epic's frame — the agent is bound there by hand
// (bindings.json in the Project's data folder, src/main/layout/bindings.ts), and its Node goes back
// to where the drag started, so the gesture binds without moving anything. While the pointer is
// over a target, the target is outlined with "Bind to …". Right-clicking a Node bound by hand
// opens a menu with "Remove binding", after which its automatic Binding applies again.
//
// The overlay draws only the outline and the menu. It learns of drags from React Flow's store and
// of the pointer from the window: the Canvas still saves the move of a Layout Node as for any drag
// (Canvas.tsx), and the overlay moves it back right after. A Subagent's Node keeps no place of its
// own: the Canvas puts it back on the drop (ADR-0037).
//
// On a read-only screen (worfy-link ticket 25) no Node is dragged (overlays/ReadOnlyCanvas.tsx), so
// nothing is bound, and "Remove binding" is inactive, saying why.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow, useStoreApi, ViewportPortal, type InternalNode } from '@xyflow/react'
import { bindingTargetLabel } from '../../../shared/binding/resolve'
import type { BindingAgent } from '../../../shared/ipc/bindings'
import { EPIC_FRAME_KIND, TICKET_KIND } from '../../../shared/layout/derived'
import { agentOfNode, dropTargetAt, type DropCandidate } from '../../binding/drop'
import { bindManually, manualOf, removeManualBinding, useManualBindings } from '../../binding/store'
import { writeAction } from '../../projects/read-only'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import type { CanvasFlowNode } from '../nodes'
import type { SubagentNodeData } from '../sources/subagents'
import { applyLayoutOp } from '../useLayout'

export const order = 60

function candidateOf(node: InternalNode<CanvasFlowNode>): DropCandidate | null {
  if (node.hidden) return null
  const { x, y } = node.internals.positionAbsolute
  const rect = { x, y, w: node.measured.width ?? node.width ?? 0, h: node.measured.height ?? node.height ?? 0 }
  const data = node.data.node.data as { ticket?: { epic: string; num: number }; epic?: { epic: string } }
  if (node.type === TICKET_KIND && data.ticket) return { kind: 'ticket', target: { kind: 'ticket', epic: data.ticket.epic, num: data.ticket.num }, rect }
  if (node.type === EPIC_FRAME_KIND && data.epic) return { kind: 'epic', target: { kind: 'epic', epic: data.epic.epic }, rect }
  return null
}

interface Drag {
  nodeId: string
  agent: BindingAgent
  subagent: SubagentNodeData | null
  /** Where the Node was when the button went down (relative to its parent). */
  start: { x: number; y: number }
}

const styles = {
  outline: {
    position: 'absolute',
    boxSizing: 'border-box',
    border: '2px dashed var(--accent)',
    borderRadius: 'var(--radius-node)',
    pointerEvents: 'none',
    zIndex: 1000,
  },
  label: {
    position: 'absolute',
    top: -24,
    left: 0,
    padding: '2px 6px',
    borderRadius: 'var(--radius-chip)',
    background: 'var(--surface)',
    border: '1px solid var(--accent)',
    color: 'var(--text)',
    fontSize: 'var(--text-12)',
    whiteSpace: 'nowrap',
  },
  menu: {
    position: 'fixed',
    zIndex: 2000,
    minWidth: 160,
    padding: 4,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-popover)',
    background: 'var(--surface)',
    boxShadow: 'var(--shadow-node)',
  },
  item: {
    width: '100%',
    padding: '4px 10px',
    border: 0,
    borderRadius: 'var(--radius-button)',
    background: 'transparent',
    color: 'var(--text)',
    font: 'inherit',
    fontSize: 'var(--text-13)',
    textAlign: 'left',
  },
} satisfies Record<string, CSSProperties>

function BindingDropFor({ projectId }: { projectId: string }) {
  const flow = useReactFlow<CanvasFlowNode>()
  const store = useStoreApi<CanvasFlowNode>()
  const manual = useManualBindings(projectId)
  const readOnly = useReadOnly()
  const [hover, setHover] = useState<DropCandidate | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; agent: BindingAgent } | null>(null)
  const latest = useRef({ manual })
  useEffect(() => {
    latest.current = { manual }
  })

  useEffect(() => {
    let pressed: { nodeId: string; start: { x: number; y: number } } | null = null
    let drag: Drag | null = null
    let pointer: { x: number; y: number } | null = null
    let shown = ''

    const show = (next: DropCandidate | null) => {
      const key = next === null ? '' : `${bindingTargetLabel(next.target)}|${next.rect.x}|${next.rect.y}|${next.rect.w}|${next.rect.h}`
      if (key === shown) return
      shown = key
      setHover(next)
    }
    const targetUnderPointer = (): DropCandidate | null => {
      if (pointer === null || drag === null) return null
      const point = flow.screenToFlowPosition(pointer)
      const candidates: DropCandidate[] = []
      for (const node of store.getState().nodeLookup.values()) {
        if (node.id === drag.nodeId) continue
        const candidate = candidateOf(node)
        if (candidate) candidates.push(candidate)
      }
      return dropTargetAt(point, candidates)
    }

    const onDown = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest('.react-flow__node') : null
      const id = element?.getAttribute('data-id')
      const node = id ? flow.getNode(id) : undefined
      pressed = node ? { nodeId: node.id, start: { ...node.position } } : null
    }
    const onMove = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
      if (drag) show(targetUnderPointer())
    }

    const goBack = async (done: Drag) => {
      // A Subagent's Node keeps no place of its own: the Canvas has already put it back (ADR-0037).
      if (done.subagent) return
      await applyLayoutOp(projectId, { op: 'move', id: done.nodeId, x: done.start.x, y: done.start.y })
    }

    const unsubscribe = store.subscribe((state) => {
      const dragging = state.nodes.filter((node) => node.dragging === true)
      if (drag === null) {
        // One agent Node dragged alone; a selection dragged together does not bind.
        const [node] = dragging
        if (dragging.length !== 1 || !node || pressed?.nodeId !== node.id) return
        const found = agentOfNode(node)
        if (found) {
          drag = { nodeId: node.id, ...found, start: pressed.start }
          show(targetUnderPointer())
        }
        return
      }
      if (dragging.some((node) => node.id === drag!.nodeId)) return
      const done = drag
      const target = targetUnderPointer()
      drag = null
      show(null)
      if (!target) return
      void bindManually(projectId, done.agent, target.target).then((error) => {
        if (error !== undefined) console.error('bindings.set failed:', error)
      })
      // After the Canvas has sent its own save of the drop (Canvas.tsx, onNodeDragStop).
      setTimeout(() => void goBack(done), 0)
    })

    const onContextMenu = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest('.react-flow__node') : null
      const id = element?.getAttribute('data-id')
      const node = id ? flow.getNode(id) : undefined
      const found = node ? agentOfNode(node) : null
      if (!found || !manualOf(latest.current.manual, found.agent)) return
      event.preventDefault()
      setMenu({ x: event.clientX, y: event.clientY, agent: found.agent })
    }

    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      unsubscribe()
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [flow, store, projectId])

  // The menu closes on Escape and on a press anywhere outside it.
  useEffect(() => {
    if (menu === null) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event.target instanceof Element && event.target.closest('[data-testid="binding-menu"]')) return
      // The press that closes the menu does nothing else (the Esc of an active Node, of Focus mode).
      if (event instanceof KeyboardEvent) event.preventDefault()
      setMenu(null)
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('keydown', close, true)
    window.addEventListener('wheel', close, true)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('keydown', close, true)
      window.removeEventListener('wheel', close, true)
    }
  }, [menu])

  return (
    <>
      {hover ? (
        <ViewportPortal>
          <div style={{ ...styles.outline, left: hover.rect.x, top: hover.rect.y, width: hover.rect.w, height: hover.rect.h }} data-testid="binding-drop-target" data-target={bindingTargetLabel(hover.target)}>
            <span style={styles.label}>Bind to {bindingTargetLabel(hover.target)}</span>
          </div>
        </ViewportPortal>
      ) : null}
      {menu
        ? createPortal(
            <div role="menu" style={{ ...styles.menu, left: menu.x, top: menu.y }} data-testid="binding-menu">
              <button
                type="button"
                role="menuitem"
                style={styles.item}
                {...writeAction(readOnly, () => {
                  const { agent } = menu
                  setMenu(null)
                  void removeManualBinding(projectId, agent).then((error) => {
                    if (error !== undefined) console.error('bindings.remove failed:', error)
                  })
                })}
              >
                Remove binding
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

export default function BindingDrop() {
  const project = activeProject(useProjects())
  return project ? <BindingDropFor key={project.id} projectId={project.id} /> : null
}
