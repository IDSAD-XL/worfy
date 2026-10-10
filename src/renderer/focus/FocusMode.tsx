// Focus mode: the chosen Nodes fill the whole window as tiles, the rest of the Canvas is covered.
//
// The tiling is a split tree (split-tree.ts) kept only in memory by whoever opened focus mode
// (canvas/overlays/FocusEntry.tsx): it is never sent to main and never saved, and focus mode
// sends no Layout operation of its own. The Canvas under the layer is untouched, so leaving
// focus mode shows it exactly as it was, viewport included.
//
// Each tile draws the Node's own component, so the Node keeps working there: its data comes from
// the same React Flow store the Canvas uses, and what it changes goes to main as on the Canvas.
// The Canvas keeps its own copy of the Node mounted under the layer.
//
// Gestures: dragging a divider moves it, a double click on a divider evens out its split;
// dragging a tile's title bar onto another tile swaps the two, or, near an edge of that tile,
// divides it. Esc leaves.
//
// While the layer is open it holds the keyboard focus and the rest of the window is inert, so no
// key reaches a Canvas Node underneath (React Flow moves the selected Nodes on arrow keys and
// unselects on Esc). On leaving, the focus goes back to where it was.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNodes } from '@xyflow/react'
import { nodeTypes, type CanvasFlowNode, type CanvasNodeProps } from '../canvas/nodes'
import { UnknownNode } from '../canvas/UnknownNode'
import { isPrimary, isTerminalKey } from '../platform'
import {
  buildPreset,
  computeGeometry,
  dropZoneAt,
  equalize,
  leafIds,
  moveDivider,
  PRESETS,
  removeTile,
  splitTile,
  swapTiles,
  tileAt,
  type DividerRect,
  type DropZone,
  type TileTree,
} from './split-tree'
import './focus.css'

export interface FocusModeProps {
  tree: TileTree
  onChange: (tree: TileTree) => void
  onExit: () => void
}

/** How far the pointer must travel before a press on a title bar becomes a drag. */
const DRAG_THRESHOLD_PX = 4

/** Canvas zoom keys (Canvas.tsx), swallowed while the Canvas is covered: they would zoom it unseen. */
const ZOOM_KEYS = new Set(['=', '+', '-', '_', '0'])

const percent = (share: number): string => `${share * 100}%`

function titleOf(node: CanvasFlowNode): string {
  const title = node.data.node.data.title
  if (typeof title === 'string' && title.trim() !== '') return title
  const kind = node.data.node.kind
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** The props a Node component gets from React Flow, for a Node drawn in a tile. */
function tileProps(node: CanvasFlowNode): CanvasNodeProps {
  return {
    id: node.id,
    data: node.data,
    type: node.type ?? node.data.node.kind,
    selected: false,
    dragging: false,
    draggable: false,
    selectable: false,
    deletable: false,
    isConnectable: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  }
}

/**
 * Whether the focus may go back to this element when focus mode closes. A Canvas Node out of view
 * may not: React Flow pans the Canvas to a Node that gets the keyboard focus, and the Canvas must
 * come back exactly as it was.
 */
function canRefocus(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected || element === document.body) return false
  const pane = element.closest('.react-flow')
  if (pane === null) return true
  const own = element.getBoundingClientRect()
  const view = pane.getBoundingClientRect()
  return own.right > view.left && own.left < view.right && own.bottom > view.top && own.top < view.bottom
}

function TileNode({ node }: { node: CanvasFlowNode }) {
  const Component = nodeTypes.get(node.data.node.kind)?.Component ?? UnknownNode
  return <Component {...tileProps(node)} />
}

interface PointerHandlers {
  move: (event: PointerEvent) => void
  up: (event: PointerEvent) => void
  /** The gesture ends without a drop: the pointer was cancelled, or its release was missed. */
  cancel: () => void
}

/**
 * Follows one pointer on window, from a pointerdown until it is released or cancelled, and returns
 * the function that stops following it.
 *
 * Pointer capture alone does not carry the gesture. Chromium takes the capture away in the middle
 * of a drag, with no pointercancel, when a pointermove with no button pressed arrives: one the
 * window gets from the real cursor while another window appears under it (seen in the e2e test
 * with parallel workers: a move at a fixed point off the drag path, then lostpointercapture). The
 * rest of the drag then reaches whatever is under the pointer, never the title bar or the divider;
 * on window it still arrives. So a lost capture does not end the gesture, and a pointermove with
 * the primary button up is skipped rather than taken for a release. A release that focus mode
 * did miss (the button let go over another app) shows at the next press: that press cancels the
 * gesture, so the drop never lands where the user did not drop.
 */
function followPointer(pointerId: number, handlers: PointerHandlers): () => void {
  const stop = () => {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onEnd, true)
    window.removeEventListener('pointerdown', onEnd, true)
  }
  function onMove(event: PointerEvent) {
    if (event.pointerId !== pointerId || (event.buttons & 1) === 0) return
    handlers.move(event)
  }
  function onUp(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    stop()
    handlers.up(event)
  }
  function onEnd(event: PointerEvent) {
    if (event.pointerId !== pointerId) return
    stop()
    handlers.cancel()
  }
  // Capture phase: a Node inside a tile that stops a pointer event must not stall the gesture.
  // Added during the pointerdown that starts the gesture, the pointerdown listener does not see it.
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onEnd, true)
  window.addEventListener('pointerdown', onEnd, true)
  return stop
}

interface TileDrag {
  id: string
  startX: number
  startY: number
  moving: boolean
  /** The tile under the pointer and where on it the drop would go. */
  target?: { id: string; zone: DropZone }
}

export function FocusMode({ tree, onChange, onExit }: FocusModeProps) {
  const nodes = useNodes<CanvasFlowNode>()
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const layer = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const geometry = useMemo(() => computeGeometry(tree), [tree])
  // The title-bar drag lives in a ref: a pointerup can arrive before React has rendered the
  // pointermove before it, and a handler reading state would then see a drag that never moved.
  // The state copy only draws the drag.
  const titleDrag = useRef<TileDrag>(undefined)
  const [drag, setDrag] = useState<TileDrag>()
  const dividerDrag = useRef<{ base: TileTree; divider: DividerRect; start: number; extentPx: number }>(undefined)
  /** Stops following the pointer of the gesture in progress, title bar or divider. */
  const stopGesture = useRef<() => void>(undefined)
  /** Ends the gesture in progress, if any, without a drop. */
  const endGesture = () => {
    stopGesture.current?.()
    stopGesture.current = undefined
    dividerDrag.current = undefined
    if (titleDrag.current !== undefined) {
      titleDrag.current = undefined
      setDrag(undefined)
    }
  }
  // A gesture still in progress when the layer closes stops there: no drop after the layer is gone.
  useEffect(() => {
    const gesture = stopGesture
    return () => gesture.current?.()
  }, [])

  // The callbacks below outlive the render they were made in.
  const latest = useRef({ tree, onChange, onExit })
  useEffect(() => {
    latest.current = { tree, onChange, onExit }
  })

  // Keyboard focus: into the layer, the rest of the window inert, and back when the layer closes.
  useLayoutEffect(() => {
    const root = layer.current
    if (root === null) return undefined
    const previous = document.activeElement
    const inerted = Array.from(document.body.children).filter((element) => element !== root && !element.hasAttribute('inert'))
    for (const element of inerted) element.setAttribute('inert', '')
    root.focus({ preventScroll: true })
    return () => {
      for (const element of inerted) element.removeAttribute('inert')
      if (canRefocus(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  // A Node that left the Canvas (removed or hidden) leaves its tile; with none left, focus mode ends.
  const ids = useMemo(() => leafIds(tree), [tree])
  useEffect(() => {
    const gone = ids.filter((id) => {
      const node = byId.get(id)
      return node === undefined || node.hidden === true
    })
    if (gone.length === 0) return
    let next: TileTree | null = tree
    for (const id of gone) next = next === null ? null : removeTile(next, id)
    if (next === null) onExit()
    else onChange(next)
  }, [ids, byId, tree, onChange, onExit])

  useEffect(() => {
    // Capture phase: the Canvas listens on window too, and must not zoom while it is covered.
    const swallowZoom = (event: KeyboardEvent) => {
      // On Windows Ctrl+_ in a Terminal tile is the shell's undo (readline): it goes to the terminal,
      // which keeps it from the Canvas itself.
      if (event.key === '_' && isTerminalKey(event)) return
      if (isPrimary(event) && ZOOM_KEYS.has(event.key)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    // Bubble phase: a Node that handles Esc itself (closing a popup) calls preventDefault first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        latest.current.onExit()
      }
    }
    window.addEventListener('keydown', swallowZoom, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', swallowZoom, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const areaRect = (): DOMRect | undefined => area.current?.getBoundingClientRect()

  // Dividers and title bars: a press starts a gesture that follows the pointer on window
  // (followPointer); the pointer capture only keeps hover effects off the rest of the layer.
  const startGesture = (event: ReactPointerEvent<HTMLDivElement>, handlers: PointerHandlers) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    stopGesture.current = followPointer(event.pointerId, handlers)
  }

  // Dividers
  const onDividerDown = (divider: DividerRect) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const rect = areaRect()
    if (rect === undefined) return
    endGesture()
    const row = divider.direction === 'row'
    dividerDrag.current = {
      base: latest.current.tree,
      divider,
      start: row ? event.clientX : event.clientY,
      extentPx: divider.extent * (row ? rect.width : rect.height),
    }
    startGesture(event, { move: onDividerMove, up: endGesture, cancel: endGesture })
  }
  const onDividerMove = (event: PointerEvent) => {
    const current = dividerDrag.current
    if (current === undefined || current.extentPx <= 0) return
    const position = current.divider.direction === 'row' ? event.clientX : event.clientY
    latest.current.onChange(moveDivider(current.base, current.divider.path, current.divider.index, (position - current.start) / current.extentPx))
  }

  // Title bars
  const dropTarget = (draggedId: string, clientX: number, clientY: number): TileDrag['target'] => {
    const rect = areaRect()
    if (rect === undefined || rect.width <= 0 || rect.height <= 0) return undefined
    const tile = tileAt(computeGeometry(latest.current.tree), (clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height)
    if (tile === undefined || tile.id === draggedId) return undefined
    const zone = dropZoneAt(tile.w * rect.width, tile.h * rect.height, clientX - rect.left - tile.x * rect.width, clientY - rect.top - tile.y * rect.height)
    return { id: tile.id, zone }
  }
  const onTitleDown = (id: string) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    endGesture()
    titleDrag.current = { id, startX: event.clientX, startY: event.clientY, moving: false }
    setDrag(titleDrag.current)
    startGesture(event, { move: onTitleMove, up: onTitleUp, cancel: endGesture })
  }
  const onTitleMove = (event: PointerEvent) => {
    const drag = titleDrag.current
    if (drag === undefined) return
    const moving = drag.moving || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= DRAG_THRESHOLD_PX
    if (!moving) return
    const target = dropTarget(drag.id, event.clientX, event.clientY)
    if (drag.moving && drag.target?.id === target?.id && drag.target?.zone === target?.zone) return
    titleDrag.current = { ...drag, moving, target }
    setDrag(titleDrag.current)
  }
  const onTitleUp = (event: PointerEvent) => {
    const drag = titleDrag.current
    endGesture()
    if (drag === undefined || !drag.moving) return
    const target = dropTarget(drag.id, event.clientX, event.clientY)
    if (target === undefined) return
    const current = latest.current.tree
    latest.current.onChange(target.zone === 'center' ? swapTiles(current, drag.id, target.id) : splitTile(current, target.id, drag.id, target.zone))
  }

  const applyPreset = (preset: (typeof PRESETS)[number]['value']) => {
    const next = buildPreset(preset, leafIds(latest.current.tree))
    if (next !== null) latest.current.onChange(next)
  }

  return createPortal(
    <div ref={layer} tabIndex={-1} className="w-focus" role="dialog" aria-modal="true" aria-label="Focus mode" data-testid="focus-mode">
      <div className="w-focus__bar">
        <span className="w-focus__title">Focus · {ids.length === 1 ? '1 node' : `${ids.length} nodes`}</span>
        <div role="group" aria-label="Layout presets" className="w-focus__presets">
          {PRESETS.map(({ value, label }) => (
            <button key={value} type="button" className="w-focus__button" onClick={() => applyPreset(value)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="w-focus__button w-focus__exit" onClick={() => latest.current.onExit()}>
          Exit focus <kbd>Esc</kbd>
        </button>
      </div>
      <div ref={area} className="w-focus__area" data-dragging={drag?.moving === true ? 'true' : undefined}>
        {/* Tiles are keyed by Node id and only positioned: swapping or dividing never remounts a Node. */}
        {geometry.tiles.map((tile) => {
          const node = byId.get(tile.id)
          const zone = drag?.moving === true && drag.target?.id === tile.id ? drag.target.zone : undefined
          return (
            <section
              key={tile.id}
              className="w-focus__tile"
              data-testid="focus-tile"
              data-node-id={tile.id}
              data-drop-zone={zone}
              aria-label={node ? titleOf(node) : tile.id}
              style={{ left: percent(tile.x), top: percent(tile.y), width: percent(tile.w), height: percent(tile.h) }}
            >
              <div className="w-focus__frame" data-dragged={drag?.moving === true && drag.id === tile.id ? 'true' : undefined}>
                <div
                  className="w-focus__tile-title"
                  data-testid="focus-tile-title"
                  onPointerDown={onTitleDown(tile.id)}
                >
                  <span aria-hidden="true">⠿</span>
                  {node ? titleOf(node) : tile.id}
                </div>
                <div className="w-focus__node">{node ? <TileNode node={node} /> : null}</div>
              </div>
            </section>
          )
        })}
        {geometry.dividers.map((divider) => (
          <div
            key={`${divider.path.join('.')}:${divider.index}`}
            className="w-focus__divider"
            role="separator"
            aria-orientation={divider.direction === 'row' ? 'vertical' : 'horizontal'}
            data-testid="focus-divider"
            data-direction={divider.direction}
            style={
              divider.direction === 'row'
                ? { left: percent(divider.x), top: percent(divider.y), height: percent(divider.length) }
                : { left: percent(divider.x), top: percent(divider.y), width: percent(divider.length) }
            }
            onPointerDown={onDividerDown(divider)}
            onDoubleClick={() => latest.current.onChange(equalize(latest.current.tree, divider.path))}
          />
        ))}
      </div>
    </div>,
    document.body,
  )
}
