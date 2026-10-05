// The Epic frames and their Tickets on the Canvas, computed from the Project's workflow model
// (renderer/workflow/useWorkflow.ts) by epic-layout.ts. None of them is a Layout Node: the
// Layout keeps, per Epic, one Node of kind `epic-frame` with what the user changed by hand —
//
//   id   `epic:<epic>`, locked, w = h = 1 (not drawn)
//   x, y           the frame's offset from its automatic place
//   data.collapsed the frame was collapsed or opened by the user (absent: the default, collapsed
//                  only when every Ticket is done)
//   data["offset:<NN>"] = { dx, dy }  a Ticket's offset from its automatic place in the frame
//
// so a recomputed place keeps the user's shift, and nothing about the workflow is copied into the
// Layout. The Node is created the first time the user changes something about the Epic.
import { useEffect, useMemo } from 'react'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { create } from 'zustand'
import { EPIC_FRAME_KIND, TICKET_KIND, epicNodeId, ticketNodeId } from '../../../shared/layout/derived'
import { ZOOM_MAX, ZOOM_MIN, type Layout, type LayoutNode, type LayoutOpInput } from '../../../shared/layout/types'
import type { Epic, Ticket, WorkflowModel } from '../../../shared/workflow/types'
import { useProjects } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import {
  defaultCollapsed,
  layoutEpic,
  progressOf,
  stackFrames,
  TICKET_HEIGHT,
  TICKET_WIDTH,
  type EpicLayout,
  type Offset,
  type PlacedTicket,
  type Progress,
} from '../epic-layout'
import type { NodeSource, NodeSourceContext } from '../extensions'
import type { CanvasFlowNode } from '../nodes'
import { applyLayoutOp } from '../useLayout'

// The kinds and ids are shared with main: the canvas tools must not list or move these Nodes.
export { EPIC_FRAME_KIND, TICKET_KIND, epicNodeId, ticketNodeId }
const offsetKey = (num: number): string => `offset:${num}`

/** What an Epic frame Node carries in `data.node.data`. */
export interface EpicFrameData {
  [key: string]: unknown
  projectId: string
  root: string
  epic: Epic
  tickets: readonly Ticket[]
  layout: EpicLayout
  progress: Progress
  collapsed: boolean
  doneExpanded: boolean
  /** The frame's automatic place on the Canvas, without the manual offset. */
  auto: { x: number; y: number }
  /** The Layout already has the Epic's `epic-frame` Node. */
  saved: boolean
}

/** What a Ticket Node carries in `data.node.data`. */
export interface TicketNodeData {
  [key: string]: unknown
  projectId: string
  root: string
  ticket: Ticket
  placed: PlacedTicket
  /** Blockers that are not done yet. */
  waitingOn: number[]
  saved: boolean
}

// ── state of the view that is not saved ─────────────────────────────────────

interface EpicsUiStore {
  /** `<projectId>|<epic>` of the Epics whose done stack is open. */
  doneExpanded: Readonly<Record<string, boolean>>
  /** The last request to center the Canvas on a frame; `seq` makes a repeat a new request. */
  focus: { projectId: string; epic: string; seq: number } | null
}

const useEpicsUi = create<EpicsUiStore>(() => ({ doneExpanded: {}, focus: null }))
const uiKey = (projectId: string, epic: string) => `${projectId}|${epic}`

/** Opens or folds the done stack of an Epic frame. */
export function toggleDoneStack(projectId: string, epic: string): void {
  const key = uiKey(projectId, epic)
  useEpicsUi.setState(({ doneExpanded }) => ({ doneExpanded: { ...doneExpanded, [key]: !doneExpanded[key] } }))
}

/** Centers the Canvas of the Project on the Epic's frame (the sidebar's Epics section). */
export function focusEpic(projectId: string, epic: string): void {
  useEpicsUi.setState(({ focus }) => ({ focus: { projectId, epic, seq: (focus?.seq ?? 0) + 1 } }))
}

// ── what the Layout keeps ───────────────────────────────────────────────────

interface Saved {
  exists: boolean
  offset: Offset
  collapsed: boolean | undefined
  offsets: Map<number, Offset>
}

const isOffset = (value: unknown): value is Offset =>
  typeof value === 'object' &&
  value !== null &&
  Number.isFinite((value as Offset).dx) &&
  Number.isFinite((value as Offset).dy)

function readSaved(node: LayoutNode | undefined): Saved {
  if (!node) return { exists: false, offset: { dx: 0, dy: 0 }, collapsed: undefined, offsets: new Map() }
  const offsets = new Map<number, Offset>()
  for (const [key, value] of Object.entries(node.data)) {
    const match = /^offset:(\d+)$/.exec(key)
    if (match && isOffset(value)) offsets.set(Number(match[1]), { dx: value.dx, dy: value.dy })
  }
  const collapsed = typeof node.data.collapsed === 'boolean' ? node.data.collapsed : undefined
  return { exists: true, offset: { dx: node.x, dy: node.y }, collapsed, offsets }
}

const savedKey = (saved: Saved): string =>
  JSON.stringify([saved.exists, saved.offset, saved.collapsed, [...saved.offsets].sort(([a], [b]) => a - b)])

export interface EpicChange {
  /** The frame's new offset from its automatic place. */
  offset?: Offset
  collapsed?: boolean
  ticket?: { num: number; offset: Offset }
}

/**
 * Saves a manual change of an Epic into its `epic-frame` Node: creates the Node the first time,
 * then moves or patches it. A create that lost a race to another one falls back to the update.
 */
export async function saveEpicChange(projectId: string, epic: string, exists: boolean, change: EpicChange): Promise<void> {
  const id = epicNodeId(epic)
  const data: Record<string, unknown> = {}
  if (change.collapsed !== undefined) data.collapsed = change.collapsed
  if (change.ticket) data[offsetKey(change.ticket.num)] = change.ticket.offset

  if (!exists) {
    const op: LayoutOpInput = {
      op: 'create',
      node: { id, kind: EPIC_FRAME_KIND, x: change.offset?.dx ?? 0, y: change.offset?.dy ?? 0, w: 1, h: 1, locked: true, data },
    }
    if ((await applyLayoutOp(projectId, op)) === undefined) return
  }
  if (change.offset) await applyLayoutOp(projectId, { op: 'move', id, x: change.offset.dx, y: change.offset.dy })
  if (Object.keys(data).length) await applyLayoutOp(projectId, { op: 'patchData', id, data })
}

// ── Nodes ───────────────────────────────────────────────────────────────────

const syntheticNode = (id: string, kind: string, x: number, y: number, w: number, h: number, data: Record<string, unknown>): LayoutNode => ({
  id,
  kind,
  x,
  y,
  w,
  h,
  hidden: false,
  locked: true,
  pinned: false,
  tags: [],
  data,
})

interface EpicEntry {
  inputs: { root: string; epic: Epic; tickets: readonly Ticket[]; saved: string; collapsed: boolean; doneExpanded: boolean }
  layout: EpicLayout
  progress: Progress
  tickets: CanvasFlowNode[]
  frame: CanvasFlowNode | undefined
  frameData: EpicFrameData | undefined
}

/** Per Project and Epic, the last computed frame, so an Epic that did not change keeps its objects. */
const cache = new Map<string, EpicEntry>()
const lastNodes = new Map<string, readonly CanvasFlowNode[]>()
const EMPTY: readonly CanvasFlowNode[] = []

const sameArray = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((item, index) => item === b[index])

function ticketNodes(projectId: string, root: string, epic: string, tickets: readonly Ticket[], layout: EpicLayout, saved: boolean): CanvasFlowNode[] {
  const byNum = new Map(tickets.map((t) => [t.num, t]))
  const parentId = epicNodeId(epic)
  return layout.tickets.map((placed) => {
    const ticket = byNum.get(placed.num)!
    const id = ticketNodeId(epic, placed.num)
    const data: TicketNodeData = {
      projectId,
      root,
      ticket,
      placed,
      waitingOn: ticket.blockedNums.filter((blocker) => byNum.has(blocker) && byNum.get(blocker)!.state !== 'done'),
      saved,
    }
    return {
      id,
      type: TICKET_KIND,
      parentId,
      position: { x: placed.x, y: placed.y },
      width: TICKET_WIDTH,
      height: TICKET_HEIGHT,
      deletable: false,
      connectable: false,
      data: { node: syntheticNode(id, TICKET_KIND, placed.x, placed.y, TICKET_WIDTH, TICKET_HEIGHT, data) },
    }
  })
}

/** Every Epic frame and its Tickets for one Project; the same array while nothing changed. */
export function buildEpicNodes(
  projectId: string,
  root: string | undefined,
  model: WorkflowModel | undefined,
  layout: Layout,
  doneExpanded: Readonly<Record<string, boolean>>,
): readonly CanvasFlowNode[] {
  if (root === undefined || model === undefined || model.error !== null) {
    lastNodes.delete(projectId)
    return EMPTY
  }

  const savedNodes = new Map(layout.nodes.filter((node) => node.kind === EPIC_FRAME_KIND).map((node) => [node.id, node]))
  const ticketsByEpic = new Map<string, Ticket[]>()
  for (const ticket of model.tickets) {
    const list = ticketsByEpic.get(ticket.epic)
    if (list) list.push(ticket)
    else ticketsByEpic.set(ticket.epic, [ticket])
  }
  // Epics in the order epic-status reports them; one that only has Tickets still gets a frame.
  const epics: Epic[] = [...model.epics]
  for (const name of ticketsByEpic.keys()) {
    if (!epics.some((epic) => epic.epic === name)) epics.push({ epic: name, hasSpec: false, hasMap: false, title: null })
  }

  const entries = epics.map((epic) => {
    const key = uiKey(projectId, epic.epic)
    const tickets = ticketsByEpic.get(epic.epic) ?? []
    const saved = readSaved(savedNodes.get(epicNodeId(epic.epic)))
    const inputs = {
      root,
      epic,
      tickets,
      saved: savedKey(saved),
      collapsed: saved.collapsed ?? defaultCollapsed(tickets),
      doneExpanded: doneExpanded[key] === true,
    }
    let entry = cache.get(key)
    const same =
      entry !== undefined &&
      entry.inputs.root === inputs.root &&
      entry.inputs.epic === inputs.epic &&
      sameArray(entry.inputs.tickets, inputs.tickets) &&
      entry.inputs.saved === inputs.saved &&
      entry.inputs.collapsed === inputs.collapsed &&
      entry.inputs.doneExpanded === inputs.doneExpanded
    if (!same) {
      const epicLayout = layoutEpic({ tickets, collapsed: inputs.collapsed, doneExpanded: inputs.doneExpanded, offsets: saved.offsets })
      entry = {
        inputs,
        layout: epicLayout,
        progress: progressOf(tickets),
        tickets: ticketNodes(projectId, root, epic.epic, tickets, epicLayout, saved.exists),
        frame: undefined,
        frameData: undefined,
      }
      cache.set(key, entry)
    }
    return { epic, saved, entry: entry! }
  })

  const places = stackFrames(entries.map(({ epic, saved, entry }) => ({ epic: epic.epic, height: entry.layout.height, offset: saved.offset })))
  const nodes: CanvasFlowNode[] = []
  for (const { epic, saved, entry } of entries) {
    const place = places.get(epic.epic)!
    const previous = entry.frame
    const reuse =
      previous !== undefined &&
      entry.frameData !== undefined &&
      previous.position.x === place.x &&
      previous.position.y === place.y &&
      entry.frameData.auto.x === place.auto.x &&
      entry.frameData.auto.y === place.auto.y
    if (!reuse) {
      const id = epicNodeId(epic.epic)
      const data: EpicFrameData = {
        projectId,
        root,
        epic,
        tickets: entry.inputs.tickets,
        layout: entry.layout,
        progress: entry.progress,
        collapsed: entry.inputs.collapsed,
        doneExpanded: entry.inputs.doneExpanded,
        auto: place.auto,
        saved: saved.exists,
      }
      entry.frameData = data
      entry.frame = {
        id,
        type: EPIC_FRAME_KIND,
        position: { x: place.x, y: place.y },
        width: entry.layout.width,
        height: entry.layout.height,
        dragHandle: '.w-epic__drag',
        deletable: false,
        connectable: false,
        selectable: false,
        data: { node: syntheticNode(id, EPIC_FRAME_KIND, place.x, place.y, entry.layout.width, entry.layout.height, data) },
      }
    }
    nodes.push(entry.frame!, ...entry.tickets)
  }

  const before = lastNodes.get(projectId)
  if (before && sameArray(before, nodes)) return before
  lastNodes.set(projectId, nodes)
  return nodes
}

/** Centers the Canvas on a frame, zoomed out far enough for the whole frame when it is bigger than the view. */
function useFocusRequests(projectId: string, nodes: readonly CanvasFlowNode[]): void {
  const flow = useReactFlow()
  const store = useStoreApi()
  const focus = useEpicsUi((state) => state.focus)
  useEffect(() => {
    if (!focus || focus.projectId !== projectId) return
    const frame = nodes.find((node) => node.id === epicNodeId(focus.epic))
    const { width, height } = store.getState()
    if (!frame || !width || !height) return
    const w = frame.width ?? 0
    const h = frame.height ?? 0
    const fit = Math.min(width / (w + 64), height / (h + 64))
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(flow.getZoom(), fit)))
    void flow.setCenter(frame.position.x + w / 2, frame.position.y + h / 2, { zoom, duration: 250 })
    // Only a new request moves the Canvas; Nodes that change later must not pull it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, projectId])
}

function useEpicNodes({ projectId, layout }: NodeSourceContext): readonly CanvasFlowNode[] {
  const projects = useProjects()
  const root = projects?.projects.find((project) => project.id === projectId)?.path
  const { model } = useWorkflow(root)
  const doneExpanded = useEpicsUi((state) => state.doneExpanded)
  const nodes = useMemo(() => buildEpicNodes(projectId, root, model, layout, doneExpanded), [projectId, root, model, layout, doneExpanded])
  useFocusRequests(projectId, nodes)
  return nodes
}

function moved({ projectId, layout }: NodeSourceContext, node: CanvasFlowNode): void {
  const data = node.data.node.data
  if (node.type === EPIC_FRAME_KIND) {
    const frame = data as EpicFrameData
    const offset = { dx: Math.round(node.position.x - frame.auto.x), dy: Math.round(node.position.y - frame.auto.y) }
    void saveEpicChange(projectId, frame.epic.epic, layout.nodes.some((n) => n.id === node.id), { offset })
  } else if (node.type === TICKET_KIND) {
    const { ticket, placed } = data as TicketNodeData
    const offset = { dx: Math.round(node.position.x - placed.auto.x), dy: Math.round(node.position.y - placed.auto.y) }
    const exists = layout.nodes.some((n) => n.id === epicNodeId(ticket.epic))
    void saveEpicChange(projectId, ticket.epic, exists, { ticket: { num: ticket.num, offset } })
  }
}

// `ticket` is owned too though the Layout never holds one: a stray Layout Node of that kind (a
// hand edit, a future `create`) has no Ticket in its data, so it is not drawn rather than crash
// the Canvas in TicketNode.
const source: NodeSource = { owns: [EPIC_FRAME_KIND, TICKET_KIND], useNodes: useEpicNodes, moved }
export default source
