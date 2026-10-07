// The Epic frames and their Tickets on the Canvas, computed from the Project's workflow model
// (renderer/workflow/useWorkflow.ts): the places inside a frame by ELK in a Web Worker
// (elk/client.ts, ADR-0037), and by the synchronous epic-layout.ts until ELK's first answer for the
// Epic. None of them is a Layout Node: the Layout keeps, per Epic, one Node of kind `epic-frame`
// with what the user changed by hand —
//
//   id   `epic:<epic>`, locked, w = h = 1 (not drawn)
//   x, y           the frame's offset from its automatic place
//   data.collapsed the frame was collapsed or opened by the user (absent: the default, collapsed
//                  only when every Ticket is done)
//
// so a recomputed place keeps the user's shift, and nothing about the workflow is copied into the
// Layout. The Node is created the first time the user changes something about the Epic. Tickets
// are not dragged (ADR-0037): the frame moves only as a whole, by its header. Older Layouts kept
// Tickets' offsets as `data["offset:<NN>"]`; main drops them when it reads the file
// (src/main/layout/upgrade.ts).
import { useEffect, useMemo } from 'react'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { create } from 'zustand'
import { EPIC_FRAME_KIND, TICKET_KIND, epicNodeId, onThePlane, ticketNodeId } from '../../../shared/layout/derived'
import { ZOOM_MAX, ZOOM_MIN, type Layout, type LayoutNode, type LayoutOpInput } from '../../../shared/layout/types'
import type { Epic, Ticket, WorkflowModel } from '../../../shared/workflow/types'
import { useProjects } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import { elkKey, requestEpicLayout, useElkAnswers, type ElkAnswer, type ElkRequest } from '../elk/client'
import {
  defaultCollapsed,
  epicColumns,
  layoutEpic,
  progressOf,
  stackFrames,
  TICKET_HEIGHT,
  TICKET_WIDTH,
  type EpicLayout,
  type Offset,
  type PlacedTicket,
  type Point,
  type Progress,
  type Rect,
} from '../epic-layout'
import type { NodeSource, NodeSourceContext } from '../extensions'
import type { CanvasFlowNode } from '../nodes'
import { applyLayoutOp } from '../useLayout'

// The kinds and ids are shared with main: the canvas tools must not list or move these Nodes.
export { EPIC_FRAME_KIND, TICKET_KIND, epicNodeId, ticketNodeId }

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

// ── Nodes of other sources on the plane ─────────────────────────────────────

/**
 * Per Project and node source, where that source's Nodes are on the plane, in absolute canvas
 * units. A source whose Nodes are not in the Layout (the Subagent tree, sources/subagents.ts)
 * publishes them here, so the frames' column keeps clear of them too (ADR-0032).
 */
const usePlaneRects = create<Readonly<Record<string, Readonly<Record<string, readonly Rect[]>>>>>(() => ({}))
const NO_RECTS: readonly Rect[] = []

const sameRects = (a: readonly Rect[], b: readonly Rect[]): boolean =>
  a.length === b.length && a.every((rect, index) => rect.x === b[index]!.x && rect.y === b[index]!.y && rect.w === b[index]!.w && rect.h === b[index]!.h)

/** Replaces what node source `sourceId` has on the plane of a Project; nothing changes when the rectangles are the same. */
export function publishPlaneRects(projectId: string, sourceId: string, rects: readonly Rect[]): void {
  const current = usePlaneRects.getState()[projectId]?.[sourceId] ?? NO_RECTS
  if (sameRects(current, rects)) return
  usePlaneRects.setState((state) => ({ ...state, [projectId]: { ...state[projectId], [sourceId]: rects } }))
}

/** Every rectangle the other node sources published for the Project; the same array while none changed. */
function useDerivedRects(projectId: string): readonly Rect[] {
  const bySource = usePlaneRects((state) => state[projectId])
  return useMemo(() => (bySource ? Object.values(bySource).flat() : NO_RECTS), [bySource])
}

// ── what the Layout keeps ───────────────────────────────────────────────────

interface Saved {
  exists: boolean
  offset: Offset
  collapsed: boolean | undefined
}

function readSaved(node: LayoutNode | undefined): Saved {
  if (!node) return { exists: false, offset: { dx: 0, dy: 0 }, collapsed: undefined }
  const collapsed = typeof node.data.collapsed === 'boolean' ? node.data.collapsed : undefined
  return { exists: true, offset: { dx: node.x, dy: node.y }, collapsed }
}

const savedKey = (saved: Saved): string => JSON.stringify([saved.exists, saved.offset, saved.collapsed])

export interface EpicChange {
  /** The frame's new offset from its automatic place. */
  offset?: Offset
  collapsed?: boolean
}

/**
 * Saves a manual change of an Epic into its `epic-frame` Node: creates the Node the first time,
 * then moves or patches it. A create that lost a race to another one falls back to the update.
 */
export async function saveEpicChange(projectId: string, epic: string, exists: boolean, change: EpicChange): Promise<void> {
  const id = epicNodeId(epic)
  const data: Record<string, unknown> = {}
  if (change.collapsed !== undefined) data.collapsed = change.collapsed

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
  inputs: { root: string; epic: Epic; tickets: readonly Ticket[]; saved: string; collapsed: boolean; doneExpanded: boolean; answer: ElkAnswer | undefined }
  layout: EpicLayout
  /** The frame's height with the done stack open: what the frames' column keeps free for it (ADR-0032). */
  reserve: number
  progress: Progress
  tickets: CanvasFlowNode[]
  frame: CanvasFlowNode | undefined
  frameData: EpicFrameData | undefined
  /** What to ask ELK for this Epic; null for a collapsed frame or one without Tickets, which ELK does not lay out. */
  request: ElkRequest | null
}

/**
 * A layout ELK made for earlier inputs, shown until the answer for the current ones: the Tickets
 * keep its places (ADR-0037), the ready Wave and "Needs attention" are the current ones, and a
 * Ticket that is gone is dropped with its routes. A Ticket that is new has no place in it and
 * waits for the answer.
 */
function keepPlaces(stale: EpicLayout, tickets: readonly Ticket[]): EpicLayout {
  const nums = new Set(tickets.map((t) => t.num))
  const { ready, attention } = epicColumns(tickets)
  const kept = stale.tickets.filter((t) => nums.has(t.num)).map((t) => ({ ...t, ready: ready.has(t.num), attention: attention.get(t.num) ?? null }))
  const shown = new Set(kept.map((t) => t.num))
  const routes: Record<string, readonly Point[]> = {}
  for (const [key, route] of Object.entries(stale.routes)) {
    const [blocker, blocked] = key.split('->').map(Number)
    if (shown.has(blocker!) && shown.has(blocked!)) routes[key] = route
  }
  return { ...stale, tickets: kept, readyCount: kept.filter((t) => t.ready).length, routes }
}

/** The layout a frame shows, and the height the frames' column keeps free for it (ADR-0032). */
function frameLayout(tickets: readonly Ticket[], name: string, collapsed: boolean, doneExpanded: boolean, answer: ElkAnswer | undefined, key: string | null): { layout: EpicLayout; reserve: number } {
  if (collapsed || answer === undefined || key === null) {
    const layout = layoutEpic({ tickets, collapsed, doneExpanded, name })
    const reserve = collapsed || doneExpanded ? layout.height : layoutEpic({ tickets, collapsed: false, doneExpanded: true, name }).height
    return { layout, reserve }
  }
  const chosen = doneExpanded ? answer.open : answer.folded
  return { layout: answer.key === key ? chosen : keepPlaces(chosen, tickets), reserve: answer.open.height }
}

/** Per Project and Epic, the last computed frame, so an Epic that did not change keeps its objects. */
const cache = new Map<string, EpicEntry>()
const lastNodes = new Map<string, readonly CanvasFlowNode[]>()
const EMPTY: readonly CanvasFlowNode[] = []

const sameArray = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((item, index) => item === b[index])

function ticketNodes(projectId: string, root: string, epic: string, tickets: readonly Ticket[], layout: EpicLayout, saved: boolean): CanvasFlowNode[] {
  const byNum = new Map(tickets.map((t) => [t.num, t]))
  const parentId = epicNodeId(epic)
  return layout.tickets.flatMap((placed) => {
    const ticket = byNum.get(placed.num)
    if (ticket === undefined) return []
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
      // Its place is computed (ADR-0037); it can still be selected.
      draggable: false,
      data: { node: syntheticNode(id, TICKET_KIND, placed.x, placed.y, TICKET_WIDTH, TICKET_HEIGHT, data) },
    }
  })
}

/** Per Project, what to ask ELK for after the last build. */
const wanted = new Map<string, readonly { epic: string; request: ElkRequest }[]>()

/** Asks ELK for every Epic of the Project whose layout inputs changed since the last request (elk/client.ts). */
export function requestEpicLayouts(projectId: string): void {
  for (const { epic, request } of wanted.get(projectId) ?? []) requestEpicLayout(projectId, epic, request)
}

/** Every Epic frame and its Tickets for one Project; the same array while nothing changed. */
export function buildEpicNodes(
  projectId: string,
  root: string | undefined,
  model: WorkflowModel | undefined,
  layout: Layout,
  doneExpanded: Readonly<Record<string, boolean>>,
  /** Nodes of other node sources on the plane, in absolute canvas units (`publishPlaneRects`). */
  derived: readonly Rect[] = [],
  /** ELK's last answer per Epic of this Project (elk/client.ts). */
  answers: Readonly<Record<string, ElkAnswer>> = {},
): readonly CanvasFlowNode[] {
  if (root === undefined || model === undefined || model.error !== null) {
    lastNodes.delete(projectId)
    wanted.delete(projectId)
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
      answer: answers[epic.epic],
    }
    let entry = cache.get(key)
    const sameTickets = entry !== undefined && entry.inputs.epic === inputs.epic && sameArray(entry.inputs.tickets, inputs.tickets)
    const same =
      entry !== undefined &&
      sameTickets &&
      entry.inputs.root === inputs.root &&
      entry.inputs.saved === inputs.saved &&
      entry.inputs.collapsed === inputs.collapsed &&
      entry.inputs.doneExpanded === inputs.doneExpanded &&
      entry.inputs.answer === inputs.answer
    if (!same) {
      // ELK lays out an open frame with Tickets; the key is computed again only when they changed.
      const request =
        inputs.collapsed || tickets.length === 0
          ? null
          : sameTickets && entry!.request !== null
            ? entry!.request
            : { key: elkKey(tickets, epic.epic), tickets, name: epic.epic }
      const { layout: epicLayout, reserve } = frameLayout(tickets, epic.epic, inputs.collapsed, inputs.doneExpanded, inputs.answer, request?.key ?? null)
      entry = {
        inputs,
        layout: epicLayout,
        reserve,
        progress: progressOf(tickets),
        tickets: ticketNodes(projectId, root, epic.epic, tickets, epicLayout, saved.exists),
        frame: undefined,
        frameData: undefined,
        request,
      }
      cache.set(key, entry)
    }
    return { epic, saved, entry: entry! }
  })
  wanted.set(
    projectId,
    entries.flatMap(({ epic, entry }) => (entry.request ? [{ epic: epic.epic, request: entry.request }] : [])),
  )

  // The frames' column keeps clear of the Nodes on the plane, the Layout's and other sources' (ADR-0032);
  // it is found again on every change of the Layout, the workflow model or those Nodes, so Tickets
  // that arrive after main placed a Node still keep off it.
  const plane = [...layout.nodes.filter(onThePlane), ...derived]
  const places = stackFrames(
    entries.map(({ epic, saved, entry }) => ({
      epic: epic.epic,
      width: entry.layout.width,
      height: entry.layout.height,
      reserve: entry.reserve,
      offset: saved.offset,
    })),
    plane,
  )
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
  const derived = useDerivedRects(projectId)
  const answers = useElkAnswers((state) => state[projectId])
  const nodes = useMemo(
    () => buildEpicNodes(projectId, root, model, layout, doneExpanded, derived, answers),
    [projectId, root, model, layout, doneExpanded, derived, answers],
  )
  // After the build, so a request goes out for the inputs the Canvas shows.
  useEffect(() => requestEpicLayouts(projectId), [projectId, nodes])
  useFocusRequests(projectId, nodes)
  return nodes
}

/** Only a frame is dragged (by its header); its offset from its automatic place is saved. Tickets are not draggable. */
function moved({ projectId, layout }: NodeSourceContext, node: CanvasFlowNode): boolean {
  if (node.type !== EPIC_FRAME_KIND) return false
  const frame = node.data.node.data as EpicFrameData
  const offset = { dx: Math.round(node.position.x - frame.auto.x), dy: Math.round(node.position.y - frame.auto.y) }
  void saveEpicChange(projectId, frame.epic.epic, layout.nodes.some((n) => n.id === node.id), { offset })
  return true
}

// `ticket` is owned too though the Layout never holds one: a stray Layout Node of that kind (a
// hand edit, a future `create`) has no Ticket in its data, so it is not drawn rather than crash
// the Canvas in TicketNode.
const source: NodeSource = { owns: [EPIC_FRAME_KIND, TICKET_KIND], useNodes: useEpicNodes, moved }
export default source
