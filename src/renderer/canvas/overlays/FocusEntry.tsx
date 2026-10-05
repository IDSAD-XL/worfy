// The way into focus mode (../../focus/FocusMode.tsx): a "Focus" button below the selected Nodes,
// and ⌘↩ while the Canvas is on screen. Focus mode starts with the Even preset over the selected
// Nodes in their Layout order. Its tiling lives here, in memory only: leaving focus mode drops it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeToolbar, Position, useStore, type ReactFlowState } from '@xyflow/react'
import { FocusMode } from '../../focus/FocusMode'
import { buildPreset, type TileTree } from '../../focus/split-tree'
import '../../focus/focus.css'

export const order = 50

/** The ids of the selected, visible Nodes as one string, so the selector's result compares by value. */
const selectedKey = (state: ReactFlowState): string => JSON.stringify(state.nodes.filter((node) => node.selected === true && node.hidden !== true).map((node) => node.id))

/** Typing places keep ⌘↩ for themselves (a composer sends with it). */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

export default function FocusEntry() {
  const key = useStore(selectedKey)
  const selected = useMemo(() => JSON.parse(key) as string[], [key])
  const domNode = useStore((state) => state.domNode)
  const [tree, setTree] = useState<TileTree | null>(null)

  // The selection for the key handler, which outlives the render it was made in.
  const latestSelected = useRef(selected)
  useEffect(() => {
    latestSelected.current = selected
  }, [selected])
  const enter = useCallback(() => {
    const start = buildPreset('even', latestSelected.current)
    if (start !== null) setTree(start)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (isEditable(event.target)) return
      // Only while this Canvas is the view on screen (the Session view hides it).
      if (domNode === null || domNode.offsetParent === null || latestSelected.current.length === 0) return
      // A focused Node takes Enter as "toggle my selection" (⌘ held: unselect), so the key must
      // not reach it: the selection is what focus mode opens on.
      event.preventDefault()
      event.stopPropagation()
      enter()
    }
    if (tree !== null) return undefined
    // Capture phase: before React Flow's own handler on the focused Node.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [domNode, tree, enter])

  if (tree !== null) return <FocusMode tree={tree} onChange={setTree} onExit={() => setTree(null)} />
  if (selected.length === 0) return null
  return (
    // Below the selection: the selection toolbar (SelectionToolbar.tsx, Pin and Tags) holds the top.
    <NodeToolbar nodeId={selected} isVisible position={Position.Bottom} offset={12}>
      <button type="button" className="w-focus-entry nodrag" onClick={enter} aria-keyshortcuts="Meta+Enter">
        Focus <kbd>⌘↩</kbd>
      </button>
    </NodeToolbar>
  )
}
