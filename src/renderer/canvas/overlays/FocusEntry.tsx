// The way into focus mode (../../focus/FocusMode.tsx): a "Focus" button below the selected Nodes,
// and ⌘↩ while the Canvas is on screen. Focus mode starts with the Even preset over the selected
// Nodes in their Layout order. Its tiling lives here, in memory only: leaving focus mode drops it.
//
// Focus mode covers the main area of the window and leaves the sidebar and the command palette
// working, and both can ask the main area for something else: the Session view, or the Canvas
// centered on an Epic, a Session's Node or a found Node, a new Node, "Tidy up", a tag filter, an
// ADR. Carried out under the layer, the request would look ignored, so focus mode leaves on it
// (useLeaveOnRequest). Another active Project needs no rule: the Canvas, and this file with it, is
// mounted anew for each Project (Canvas.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, ViewportPortal, type ReactFlowState } from '@xyflow/react'
import { SHORTCUTS } from '../../../shared/shortcuts'
import { useSessionFocus } from '../../claude-home/focus'
import { useCanvasRequests } from '../../find/canvas-requests'
import { FocusMode } from '../../focus/FocusMode'
import { buildPreset, type TileTree } from '../../focus/split-tree'
import { useNavigation } from '../../session/navigation'
import { ariaKeys, isTextTarget, label, matches } from '../../shortcuts/match'
import { usePlaneToolbar } from '../pinning'
import { onEpicFocusRequest } from '../sources/epics'
import '../../focus/focus.css'

export const order = 50

/** The ids of the selected, visible Nodes as one string, so the selector's result compares by value. */
const selectedKey = (state: ReactFlowState): string => JSON.stringify(state.nodes.filter((node) => node.selected === true && node.hidden !== true).map((node) => node.id))

/**
 * While `open`, calls `leave` when something asks the main area to show something else: the view
 * leaves the Canvas, or a request to the Canvas arrives — from the sidebar's Epics and Sessions
 * sections (focusEpic, focusSessionNode) or through find/canvas-requests.ts ("Go to", a new Node,
 * "Tidy up", a tag filter, an ADR). Only what happens from now on counts: a request made before
 * focus mode opened was carried out then. The find bar is not such a request.
 */
function useLeaveOnRequest(open: boolean, leave: () => void): void {
  useEffect(() => {
    if (!open) return undefined
    const stops = [
      useNavigation.subscribe((state) => {
        if (state.view !== 'canvas') leave()
      }),
      onEpicFocusRequest(leave),
      useSessionFocus.subscribe((state, previous) => {
        if (state.request !== previous.request) leave()
      }),
      useCanvasRequests.subscribe((state, previous) => {
        if (state.focus !== previous.focus || state.create !== previous.create || state.tidy !== previous.tidy || state.tagFilter !== previous.tagFilter || state.adr !== previous.adr) leave()
      }),
    ]
    return () => {
      for (const stop of stops) stop()
    }
  }, [open, leave])
}

export default function FocusEntry() {
  const key = useStore(selectedKey)
  const selected = useMemo(() => JSON.parse(key) as string[], [key])
  const domNode = useStore((state) => state.domNode)
  const [tree, setTree] = useState<TileTree | null>(null)
  const leave = useCallback(() => setTree(null), [])
  useLeaveOnRequest(tree !== null, leave)

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
      // ⌘↩ on macOS, Ctrl+Enter elsewhere; typing places keep it for themselves (a composer sends with it).
      if (!matches(event, SHORTCUTS.focusEnter) || isTextTarget(event.target)) return
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

  // Below the selection: the selection toolbar (SelectionToolbar.tsx, Pin and Tags) holds the top.
  // Among the Nodes, not over all of them: a pinned Node stays above it (pinning.ts).
  const style = usePlaneToolbar(selected, 'bottom', 12)

  if (tree !== null) return <FocusMode tree={tree} onChange={setTree} onExit={leave} />
  if (selected.length === 0 || style === null) return null
  return (
    <ViewportPortal>
      <div style={style} className="react-flow__node-toolbar">
        <button type="button" className="w-focus-entry nodrag" onClick={enter} aria-keyshortcuts={ariaKeys(SHORTCUTS.focusEnter)}>
          Focus <kbd>{label(SHORTCUTS.focusEnter)}</kbd>
        </button>
      </div>
    </ViewportPortal>
  )
}
