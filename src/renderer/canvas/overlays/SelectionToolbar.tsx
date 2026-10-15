// The toolbar above the selected Nodes (ticket 29). It is a row of sections; each section gets
// the selected Nodes' Layout entries and sends its own operations to main. Ticket 29 brings Pin
// and Tags, ticket 30 Delete: the selection goes to the Project's trash (src/shared/ipc/trash.ts),
// from where the Trash popover (TrashPopover.tsx) or ⌘Z brings it back.
//
// The Canvas's keys of ticket 30 live here too, active while the Canvas is on screen and the focus
// is on it (or nowhere), never in a text field: Delete and Backspace delete the selection to the
// trash, ⌘Z undoes and ⇧⌘Z redoes the user's last change to the Layout (history.ts). Esc with
// nothing selected folds the done stack of an Epic frame opened last (worfy-week ticket 15).
//
// The toolbar stands above the selection unless there it would cover an Epic frame's header or
// its column labels (a Ticket of the frame's top row); then it goes below the selection, under the
// Focus button (FocusEntry.tsx), which holds the place right below it.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import { useNodes, useReactFlow, useStore, useStoreApi, ViewportPortal, type ReactFlowState } from '@xyflow/react'
import { create } from 'zustand'
import type { LayoutNode } from '../../../shared/layout/types'
import { SHORTCUTS } from '../../../shared/shortcuts'
import { activeProject, useProjects } from '../../projects/useProjects'
import { isTextTarget, matches } from '../../shortcuts/match'
import { deletableNodes, deleteToTrash, grouped, historyOf } from '../history'
import type { CanvasFlowNode } from '../nodes'
import {
  canvasSizeOf,
  clearToolbarPlacement,
  epicHeaderBand,
  FOCUS_ENTRY_OFFSET,
  FOCUS_ENTRY_SIZE,
  pinOp,
  unpinOp,
  usePlaneToolbar,
  type PlaceToolbar,
  type PlaneRect,
  type ToolbarKeepOut,
  type ToolbarOffsets,
  type ToolbarSize,
} from '../pinning'
import { escapeFoldsDoneStack, foldLastDoneStack } from '../sources/epics'
import { BINDING_ANCHOR_KIND } from '../sources/workflow-bindings'
import { addTagOps, normalizeTag, removeTagOps, selectionTags } from '../tags'
import { useLayoutOps, type LayoutOps } from '../useLayout'
import './selection-toolbar.css'

export const order = 20

export interface SelectionSectionProps {
  /** The selected Nodes as the Layout has them, in Layout order; never empty. */
  nodes: readonly LayoutNode[]
}

/** Sends operations one after another, so main applies them in the order they were made; one step of the history. */
async function applyAll(ops: LayoutOps, list: readonly Parameters<LayoutOps['apply']>[0][]): Promise<void> {
  await grouped(async (group) => {
    for (const op of list) await ops.apply(op, group)
  })
}

/** Delete / Backspace, ⌘Z, ⇧⌘Z and Esc on the Canvas of `projectId`. */
function useCanvasKeys(projectId: string | undefined): void {
  const flow = useReactFlow<CanvasFlowNode>()
  const store = useStoreApi<CanvasFlowNode>()
  useEffect(() => {
    if (projectId === undefined) return
    /** The press is the Canvas's: the Canvas is the view on screen and the focus is on it or nowhere. */
    const onCanvas = (event: globalThis.KeyboardEvent): boolean => {
      // Only while this Canvas is the view on screen (the Session view hides it).
      const canvas = store.getState().domNode
      if (!(canvas instanceof HTMLElement) || canvas.offsetParent === null) return false
      // Keys typed elsewhere (the sidebar, the focus mode layer over the Canvas) are not the Canvas's.
      return event.target === document.body || (event.target instanceof Node && canvas.contains(event.target))
    }
    const selectedNodes = () => flow.getNodes().filter((node) => node.selected && !node.hidden)
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // In a place to type ⌘Z, Delete and Backspace belong to the text. The other modifier (Ctrl on
      // macOS, the Windows key on Windows) and Alt make another combination (matches).
      if (event.defaultPrevented || isTextTarget(event.target)) return
      if (!onCanvas(event)) return
      const undo = matches(event, SHORTCUTS.undo)
      if (undo || matches(event, SHORTCUTS.redo)) {
        event.preventDefault()
        void (undo ? historyOf(projectId).undo() : historyOf(projectId).redo())
      } else if (matches(event, SHORTCUTS.deleteSelection)) {
        const selected = selectedNodes()
        if (selected.length === 0) return
        event.preventDefault()
        deleteSelection(
          projectId,
          selected.map((node) => node.data.node),
        )
      }
    }
    // Esc folds the done stack opened last, one per press. Capture phase: React Flow takes the
    // selection off a focused Node on Esc without preventDefault, so in the bubble phase the
    // selection would already be empty and the same press would fold a stack too. The Esc of the
    // active Node (Canvas.tsx) and of Focus mode skip a press this one took (defaultPrevented).
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (!escapeFoldsDoneStack(event, selectedNodes().length, document) || !onCanvas(event)) return
      if (foldLastDoneStack(projectId)) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keydown', onEscape, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keydown', onEscape, true)
    }
  }, [flow, store, projectId])
}

/** Pin: keeps the selection at its place on the screen; Unpin puts it back on the plane. */
export function PinSection({ nodes }: SelectionSectionProps) {
  const ops = useLayoutOps()
  const flow = useReactFlow()
  const store = useStoreApi()
  const allPinned = nodes.every((node) => node.pinned)
  return (
    <button
      type="button"
      className="w-selection-toolbar__button"
      aria-pressed={allPinned}
      title={allPinned ? 'Put the selection back on the canvas' : 'Keep the selection at its place on the screen'}
      onClick={() => {
        // Converted through the viewport and the Canvas size of this moment (pinning.ts).
        const viewport = flow.getViewport()
        const size = canvasSizeOf(store.getState())
        const list = allPinned
          ? nodes.map((node) => unpinOp(node, viewport, size))
          : nodes.filter((node) => !node.pinned).map((node) => pinOp(node, viewport, size))
        void applyAll(ops, list)
      }}
    >
      {allPinned ? 'Unpin' : 'Pin'}
    </button>
  )
}

/** The tags of the selection, each removable from all of it, and a field that adds one to all of it. */
export function TagsSection({ nodes }: SelectionSectionProps) {
  const ops = useLayoutOps()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const tags = selectionTags(nodes)

  const submit = () => {
    const tag = normalizeTag(draft)
    if (tag === undefined) return
    setDraft('')
    void applyAll(ops, addTagOps(nodes, tag))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft('')
      setAdding(false)
    }
  }

  return (
    <div className="w-selection-toolbar__tags" role="group" aria-label="Tags">
      {tags.map(({ tag, count }) => (
        <span key={tag} className="w-selection-toolbar__tag" title={`${count} of ${nodes.length} selected`}>
          {tag}
          {count < nodes.length ? <span className="w-selection-toolbar__tag-count">{count}</span> : null}
          <button type="button" className="w-selection-toolbar__tag-remove" aria-label={`Remove tag ${tag}`} onClick={() => void applyAll(ops, removeTagOps(nodes, tag))}>
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="w-selection-toolbar__tag-input"
          aria-label="New tag"
          placeholder="Tag…"
          maxLength={40}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            submit()
            setAdding(false)
          }}
        />
      ) : (
        <button type="button" className="w-selection-toolbar__button" onClick={() => setAdding(true)}>
          Add tag
        </button>
      )}
    </div>
  )
}

interface DeleteState {
  /** What main refused at the last delete, for the selection it was made on. */
  refusals: readonly string[]
  /** The selection those refusals belong to; another selection hides them. */
  key: string
}

/** The refusals of the last delete, shared by the Delete button and the Delete key. */
const useDeleteRefusals = create<DeleteState>(() => ({ refusals: [], key: '' }))

const selectionKey = (nodes: readonly LayoutNode[]): string => nodes.map((node) => node.id).join('\n')

/** Deletes and keeps main's refusals for the Delete section of this selection. */
function deleteSelection(projectId: string, nodes: readonly LayoutNode[]): void {
  const key = selectionKey(nodes)
  void deleteToTrash(projectId, nodes).then((refusals) => useDeleteRefusals.setState({ refusals, key }))
}

/**
 * Delete: sends what may be deleted of the selection to the trash. Unavailable when nothing of it
 * may be (the Orchestrator, HANDOFF, Tickets, Epic frames); a Session that runs is refused by main
 * and the reason is shown.
 */
export function DeleteSection({ nodes }: SelectionSectionProps) {
  const projectId = activeProject(useProjects())?.id
  const state = useDeleteRefusals()
  const deletable = deletableNodes(nodes)
  const key = selectionKey(nodes)
  const refusals = state.key === key ? state.refusals : []
  const unavailable = projectId === undefined || deletable.length === 0
  return (
    <>
      <button
        type="button"
        className="w-selection-toolbar__button w-selection-toolbar__delete"
        disabled={unavailable}
        title={unavailable ? 'This cannot be deleted' : 'Move to the trash (Delete)'}
        onClick={() => {
          if (projectId !== undefined) deleteSelection(projectId, nodes)
        }}
      >
        Delete
      </button>
      {refusals.length > 0 ? (
        <span className="w-selection-toolbar__refusal" role="alert">
          {refusals.join('; ')}
        </span>
      ) : null}
    </>
  )
}

/** The sections of the toolbar, left to right. */
const SELECTION_SECTIONS: readonly ComponentType<SelectionSectionProps>[] = [PinSection, TagsSection, DeleteSection]

/** Screen pixels between the selection and the toolbar above it or beside it. */
const TOP_OFFSET = 12
/**
 * Screen pixels between the selection and the toolbar below it: the Focus button stands 12 px
 * below the selection and is --row-height (28 px) tall, then a gap of --space-2 (8 px).
 */
const BOTTOM_OFFSET = FOCUS_ENTRY_OFFSET + FOCUS_ENTRY_SIZE.height + 8
const OFFSETS: ToolbarOffsets = { top: TOP_OFFSET, side: TOP_OFFSET, bottom: BOTTOM_OFFSET }
/** The toolbar's size until it is measured: Pin, Add tag and Delete in a row. */
const DEFAULT_SIZE: ToolbarSize = { width: 200, height: 34 }

/**
 * What the toolbar keeps off besides the Focus button, as one string so the selector compares by
 * value: the header bands of the visible, measured Epic frames and the rectangles of the other
 * visible, measured Nodes that are not selected. Empty while nothing is selected.
 *
 * Not the invisible Binding anchors, and not the pinned Nodes: a pinned Node stays at its place on
 * the screen while the plane under it pans, so the toolbar would change sides as the Canvas moves;
 * it is drawn above the toolbar instead (pinning.ts).
 */
function keepOutKey(state: ReactFlowState): string {
  const bands: PlaneRect[] = []
  const nodes: PlaneRect[] = []
  let selected = false
  for (const node of state.nodeLookup.values()) {
    if (node.hidden === true || node.type === BINDING_ANCHOR_KIND) continue
    if (node.selected === true) {
      selected = true
      continue
    }
    if ((node.internals.userNode.data as { node?: Pick<LayoutNode, 'pinned'> } | undefined)?.node?.pinned === true) continue
    const width = node.measured.width ?? node.width
    const height = node.measured.height ?? node.height
    if (width === undefined || height === undefined) continue
    const { x, y } = node.internals.positionAbsolute
    if (node.type === 'epic-frame') bands.push(epicHeaderBand({ x, y, width, height }))
    else nodes.push({ x, y, width, height })
  }
  return selected ? JSON.stringify({ bands, nodes }) : ''
}

/** The toolbar element's size on the screen, followed while it changes (tags added, a refusal shown); DEFAULT_SIZE until measured. */
function useToolbarSize(): [ToolbarSize, (element: HTMLDivElement | null) => void] {
  const [size, setSize] = useState<ToolbarSize>(DEFAULT_SIZE)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (element === null || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      // Layout sizes ignore the toolbar's scale(1 / zoom), which cancels the viewport's zoom: screen pixels.
      const width = element.offsetWidth
      const height = element.offsetHeight
      if (width > 0 && height > 0) setSize((old) => (old.width === width && old.height === height ? old : { width, height }))
    }
    observer.current = new ResizeObserver(measure)
    observer.current.observe(element)
  }, [])
  return [size, ref]
}

export default function SelectionToolbar() {
  const projectId = activeProject(useProjects())?.id
  const selected = useNodes<CanvasFlowNode>().filter((node) => node.selected && !node.hidden)
  useCanvasKeys(projectId)
  const zonesKey = useStore(keepOutKey)
  const keepOut = useMemo<ToolbarKeepOut>(() => {
    const zones = zonesKey === '' ? { bands: [], nodes: [] } : (JSON.parse(zonesKey) as Omit<ToolbarKeepOut, 'focus'>)
    return { ...zones, focus: { size: FOCUS_ENTRY_SIZE, offset: FOCUS_ENTRY_OFFSET } }
  }, [zonesKey])
  const [size, measure] = useToolbarSize()
  const place = useCallback<PlaceToolbar>((nodes, zoom) => clearToolbarPlacement(nodes, keepOut, zoom, size, OFFSETS), [keepOut, size])
  // Among the Nodes, not over all of them: a pinned Node stays above another Node's toolbar (pinning.ts).
  const style = usePlaneToolbar(
    selected.map((node) => node.id),
    place,
    TOP_OFFSET,
  )
  if (selected.length === 0 || style === null) return null
  const nodes = selected.map((node) => node.data.node)
  return (
    <ViewportPortal>
      <div style={style} className="react-flow__node-toolbar">
        <div ref={measure} className="w-selection-toolbar nodrag nopan nowheel" role="toolbar" aria-label="Selection" data-testid="selection-toolbar">
          {SELECTION_SECTIONS.map((Section, index) => (
            <Section key={Section.displayName ?? Section.name ?? index} nodes={nodes} />
          ))}
        </div>
      </div>
    </ViewportPortal>
  )
}
