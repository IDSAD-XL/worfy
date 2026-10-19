// The Epic frames and their Tickets on the Canvas, computed from the Project's workflow model
// (renderer/workflow/useWorkflow.ts): the places inside a frame by ELK in a Web Worker
// (elk/client.ts, ADR-0037), and by the synchronous epic-layout.ts until ELK's first answer for the
// Epic. None of them is a Layout Node: the Layout keeps, per Epic, one Node of kind `epic-frame`
// with what the user changed by hand —
//
//   id   `epic:<epic>`, locked, w = h = 1 (not drawn)
//   x, y           the frame's offset from its automatic place
//   data.collapsed the frame was collapsed or opened by the user (absent, or null after ⌘Z of the
//                  first collapse: the default, collapsed only when every Ticket is done)
//
// so a recomputed place keeps the user's shift, and nothing about the workflow is copied into the
// Layout. The Node is created the first time the user changes something about the Epic; each such
// change — a drag of the frame, its collapse button — is a step of the ⌘Z history. Tickets
// are not dragged (ADR-0037): the frame moves only as a whole, by its header. Older Layouts kept
// Tickets' offsets as `data["offset:<NN>"]`; main drops them when it reads the file
// (src/main/layout/upgrade.ts).
//
// The frames stand in a strip of K columns (ADR-0075, ../epic-arrangement.ts). Their order and K
// come from one more invisible Node, `epic-arrangement`, so every screen of the Project draws the
// same strip. A screen that may change the Layout writes it on its own, past the ⌘Z history
// (ADR-0016): on the first opening of the Project in a day (order "active first" and K afresh) and
// when the hysteresis lets K change. "Re-pack" writes it as the user's gesture, one step of ⌘Z. A
// read-only screen (ADR-0066) writes nothing and draws from the record as it is.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { create } from 'zustand'
import { EPIC_ARRANGEMENT_ID, EPIC_ARRANGEMENT_KIND, EPIC_FRAME_KIND, TICKET_KIND, epicNodeId, onThePlane, ticketNodeId } from '../../../shared/layout/derived'
import { ZOOM_MAX, ZOOM_MIN, type Layout, type LayoutNode, type LayoutOpInput } from '../../../shared/layout/types'
import type { Epic, Ticket, WorkflowModel } from '../../../shared/workflow/types'
import { invoke } from '../../ipc'
import { readOnlyNow } from '../../projects/read-only-now'
import { useProjects } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import { elkEngine, elkKey, requestEpicLayout, useElkAnswers, type ElkAnswer, type ElkRequest } from '../elk/client'
import { arrange, readArrangement, repack, sameDay, type ArrangedFrame, type ArrangementRecord } from '../epic-arrangement'
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
import type { NodeDrop, NodeSource, NodeSourceContext } from '../extensions'
import type { Group } from '../history'
import type { CanvasFlowNode } from '../nodes'
import { applyLayoutOp, currentLayout, useLayoutOps, type LayoutOps } from '../useLayout'
import { BINDING_ANCHOR_KIND, type BindingAnchorData } from './workflow-bindings'

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

interface OpenStack {
  projectId: string
  epic: string
}

interface EpicsUiStore {
  /** The Epics whose done stack is open, in the order they were opened: Esc folds the last one of a Project. */
  openStacks: readonly OpenStack[]
  /** The last request to center the Canvas on a frame; `seq` makes a repeat a new request. */
  focus: { projectId: string; epic: string; seq: number } | null
  /** The last "Re-pack" asked for from outside the Canvas (the palette); `seq` makes a repeat a new request. */
  repack: { projectId: string; seq: number } | null
}

const NO_STACKS: readonly OpenStack[] = []
const useEpicsUi = create<EpicsUiStore>(() => ({ openStacks: NO_STACKS, focus: null, repack: null }))
const uiKey = (projectId: string, epic: string) => `${projectId}|${epic}`

/**
 * Opens or folds the done stack of an Epic frame. Opening puts the stack last in the order Esc
 * folds them, also when it was open already. Neither is a step of the ⌘Z history (worfy-week
 * ticket 08): the stack is a state of the view, like the viewport.
 */
export function setDoneStack(projectId: string, epic: string, open: boolean): void {
  useEpicsUi.setState((state) => {
    const others = state.openStacks.filter((stack) => stack.projectId !== projectId || stack.epic !== epic)
    const last = state.openStacks.at(-1)
    if (open && last?.projectId === projectId && last.epic === epic) return state
    if (!open && others.length === state.openStacks.length) return state
    return { openStacks: open ? [...others, { projectId, epic }] : others }
  })
}

/** Folds the done stack of the Project opened last; false when none of its stacks is open. */
export function foldLastDoneStack(projectId: string): boolean {
  const last = useEpicsUi.getState().openStacks.findLast((stack) => stack.projectId === projectId)
  if (last === undefined) return false
  setDoneStack(projectId, last.epic, false)
  return true
}

/** What the Esc check reads of a key press. */
export type EscapePress = Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'target'>

/**
 * True when a press of Esc on the Canvas may fold the last open done stack: a bare Esc nobody
 * took, outside a text field, with nothing selected on the Canvas — React Flow's Esc takes the
 * selection off first, and the active Node of worfy-week ticket 16 is always selected — and no
 * dialog or menu open, as each of them closes on the same press. The Canvas's key listener
 * (overlays/SelectionToolbar.tsx) adds that the Canvas is on screen and the press is on it.
 */
export function escapeFoldsDoneStack(event: EscapePress, selected: number, doc: Pick<Document, 'querySelector'>): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
  if (selected > 0) return false
  // A place to type, as the Canvas's other keys see it (isTextTarget in SelectionToolbar.tsx).
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null)) return false
  return doc.querySelector('[role="dialog"], [role="menu"]') === null
}

/** The Epics of the Project whose done stack is open, in the order they were opened. */
export function openDoneStacks(projectId: string): string[] {
  return useEpicsUi
    .getState()
    .openStacks.filter((stack) => stack.projectId === projectId)
    .map((stack) => stack.epic)
}

/**
 * Folds the open stacks nobody sees: their frame is collapsed (by its chevron, by ⌘Z, or by
 * default once every Ticket is done) or has no done Ticket left. Otherwise Esc would fold an
 * invisible stack and do nothing the user can see.
 */
export function foldHiddenDoneStacks(projectId: string, nodes: readonly CanvasFlowNode[]): void {
  for (const node of nodes) {
    if (node.type !== EPIC_FRAME_KIND) continue
    const frame = node.data.node.data as EpicFrameData
    if (frame.doneExpanded && (frame.collapsed || !frame.tickets.some((ticket) => ticket.state === 'done'))) setDoneStack(projectId, frame.epic.epic, false)
  }
}

/** Centers the Canvas of the Project on the Epic's frame (the sidebar's Epics section). */
export function focusEpic(projectId: string, epic: string): void {
  useEpicsUi.setState(({ focus }) => ({ focus: { projectId, epic, seq: (focus?.seq ?? 0) + 1 } }))
}

/**
 * Calls `listener` at every request of focusEpic from now on, a repeated one too. Returns the
 * function that unsubscribes. Focus mode leaves on such a request: the Canvas it covers is asked
 * to show something (overlays/FocusEntry.tsx).
 */
export function onEpicFocusRequest(listener: () => void): () => void {
  return useEpicsUi.subscribe((state, previous) => {
    if (state.focus !== previous.focus || state.repack !== previous.repack) listener()
  })
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
 * Saves a change the user made to an Epic frame — a drop, the collapse button — into its
 * `epic-frame` Node. It is the user's gesture, so it goes through `ops` and is a step of the ⌘Z
 * history (history.ts), part of `group` when the frame was dropped with a selection (worfy-week
 * ticket 08). The change is a `move` or a `patchData` of the Node, which ⌘Z reverts: the offset it
 * had, the `collapsed` it had (null when it had none, which readSaved() takes as the default).
 *
 * The first change of an Epic creates the Node before that, at offset (0, 0) and without data: the
 * frame shows exactly as without the Node, so the create is no step of its own, and the Node stays
 * when the change is undone. A create that lost a race to another one leaves the change to the Node
 * already there.
 */
export async function saveEpicChange(projectId: string, epic: string, exists: boolean, change: EpicChange, ops: LayoutOps, group?: Group): Promise<void> {
  const id = epicNodeId(epic)
  if (!exists) {
    const create: LayoutOpInput = { op: 'create', node: { id, kind: EPIC_FRAME_KIND, x: 0, y: 0, w: 1, h: 1, locked: true, data: {} } }
    await applyLayoutOp(projectId, create)
  }
  if (change.offset) await ops.apply({ op: 'move', id, x: change.offset.dx, y: change.offset.dy }, group)
  if (change.collapsed !== undefined) await ops.apply({ op: 'patchData', id, data: { collapsed: change.collapsed } }, group, { data: true })
}

// ── the strip's arrangement (ADR-0075) ──────────────────────────────────────

/** What the last build of a Project's frames knew: what the record is written from. */
export interface ArrangementState {
  /** Every frame's size, by Epic. */
  frames: ReadonlyMap<string, ArrangedFrame>
  /** The Epics with a frame, in the workflow model's order. */
  epics: readonly string[]
  /** The record as the Layout has it; null when there is none or it is not whole. */
  record: ArrangementRecord | null
  /** K the frames are drawn with now. */
  columns: number
  tickets: readonly Pick<Ticket, 'epic' | 'state'>[]
  /**
   * True when every open frame with Tickets shows ELK's answer for its current inputs (or the
   * window has no ELK): the sizes are the ones drawn, not those of the synchronous layout before it.
   */
  settled: boolean
}

/** Per Project, the last build's arrangement. */
const arrangements = new Map<string, ArrangementState>()

/** What the Project's frames were last drawn from, or undefined before its workflow model was read. */
export function arrangementOf(projectId: string): ArrangementState | undefined {
  return arrangements.get(projectId)
}

/**
 * The Epics with work now (ADR-0075, point 4): a claimed Ticket (`work`), a live agent bound to the
 * Epic or to one of its Tickets, the Epic of the Project's running Autopilot.
 */
export function epicsWithWork(tickets: readonly Pick<Ticket, 'epic' | 'state'>[], liveBound: Iterable<string>, autopilot: string | null): Set<string> {
  const epics = new Set<string>(liveBound)
  for (const ticket of tickets) if (ticket.state === 'work') epics.add(ticket.epic)
  if (autopilot !== null) epics.add(autopilot)
  return epics
}

/** What the activity reads of React Flow's Nodes: the Binding anchors (sources/workflow-bindings.ts). */
type AnchorLookup = ReadonlyMap<string, { type?: string | undefined; data: Record<string, unknown> }>

/**
 * The Epics with work at this moment: the claimed Tickets, the live bound agents whose anchors are
 * on the Canvas, and the Project's Autopilot as main reports it.
 * shortcut: a live agent counts only once its Binding anchor is drawn. On the first opening of the
 * day the anchors are almost never there yet (they wait for the transcript signals and for the
 * Ticket Nodes this source draws), so live agents count only on "Re-pack"; redo when the Bindings
 * get a store that this source can read without React Flow.
 */
export async function activityNow(projectId: string, tickets: readonly Pick<Ticket, 'epic' | 'state'>[], nodes: AnchorLookup): Promise<Set<string>> {
  const live: string[] = []
  for (const node of nodes.values()) {
    if (node.type !== BINDING_ANCHOR_KIND) continue
    const data = (node.data as Partial<CanvasFlowNode['data']>).node?.data as BindingAnchorData | undefined
    if (data?.variant === 'agent' && data.live) live.push(data.binding.target.epic)
  }
  let autopilot: string | null = null
  try {
    const state = await invoke('autopilot.state', { projectId })
    if (state.ok && state.value.status !== 'stopped') autopilot = state.value.epic
  } catch (error) {
    // Without the Autopilot's state the order goes by the rest of the activity.
    console.error('autopilot.state failed:', error)
  }
  return epicsWithWork(tickets, live, autopilot)
}

/**
 * Writes the record. `ops` makes it the user's gesture ("Re-pack"): a `patchData` recorded as one
 * step of ⌘Z, after a `create` of an empty record that is no step of its own (as saveEpicChange
 * does). Without `ops` it is automatic and goes past the history (ADR-0016): a `create` with the
 * data, or a `patchData` when the record is there.
 */
export async function saveArrangement(projectId: string, record: ArrangementRecord, ops?: LayoutOps): Promise<void> {
  const exists = currentLayout(projectId)?.nodes.some((node) => node.id === EPIC_ARRANGEMENT_ID) ?? false
  const data = { order: record.order, columns: record.columns, at: record.at }
  if (!exists) {
    const node = { id: EPIC_ARRANGEMENT_ID, kind: EPIC_ARRANGEMENT_KIND, x: 0, y: 0, w: 1, h: 1, locked: true, data: ops === undefined ? data : {} }
    const refused = await applyLayoutOp(projectId, { op: 'create', node })
    // A create refused because another screen's came first: the data goes to that record below.
    if (ops === undefined && refused === undefined) return
  }
  if (ops !== undefined) await ops.apply({ op: 'patchData', id: EPIC_ARRANGEMENT_ID, data }, undefined, { data: true })
  else await applyLayoutOp(projectId, { op: 'patchData', id: EPIC_ARRANGEMENT_ID, data })
}

/** Asks the Canvas of the Project to run "Re-pack" (the palette's command); the Canvas menu runs it itself. */
export function requestRepack(projectId: string): void {
  useEpicsUi.setState(({ repack: last }) => ({ repack: { projectId, seq: (last?.seq ?? 0) + 1 } }))
}

/**
 * "Re-pack" for the Canvas of `projectId` (ADR-0075, point 4): the order "active first" and K
 * without hysteresis, written as one step of ⌘Z through the Canvas's LayoutOps. For a component
 * inside React Flow and the Canvas's LayoutOps (the Canvas menu). Nothing is sent on a read-only
 * screen.
 */
export function useRepack(projectId: string): () => Promise<void> {
  const ops = useLayoutOps()
  const store = useStoreApi()
  return useCallback(async () => {
    const state = arrangements.get(projectId)
    if (state === undefined || state.epics.length === 0 || readOnlyNow() !== null) return
    const activity = await activityNow(projectId, state.tickets, store.getState().nodeLookup)
    const now = arrangements.get(projectId) ?? state
    await saveArrangement(projectId, { ...repack(now.epics, now.frames, activity), at: new Date().toISOString() }, ops)
  }, [projectId, ops, store])
}

/** Carries out the palette's "Re-pack" for the Project with `run`, once per request. */
export function useRepackRequests(projectId: string, run: () => Promise<void>): void {
  const request = useEpicsUi((state) => state.repack)
  const handled = useRef(useEpicsUi.getState().repack?.seq ?? 0)
  useEffect(() => {
    if (!request || request.projectId !== projectId || request.seq <= handled.current) return
    handled.current = request.seq
    void run()
  }, [request, projectId, run])
}

/** Per Project, the K an automatic write has sent and the Layout does not show yet: it is not sent twice. */
const pendingColumns = new Map<string, number>()

/**
 * Keeps the record up to date on a screen that may change the Layout, past the ⌘Z history: once
 * per opening of the Project's Canvas, a record from another calendar day (or none) is computed
 * again, active first; afterwards, a K the hysteresis let change is written, so the next build
 * keeps it. Both wait until the frames show ELK's answers, so K is counted from the sizes drawn.
 * A frame whose ELK request failed counts as answered: elk/client.ts answers it with the
 * synchronous layout. A read-only screen writes nothing.
 */
export function useArrangementUpkeep(projectId: string, nodes: readonly CanvasFlowNode[]): void {
  const store = useStoreApi()
  const checkedDay = useRef(false)
  useEffect(() => {
    const state = arrangements.get(projectId)
    if (state === undefined || state.epics.length === 0 || !state.settled || readOnlyNow() !== null) return
    if (!checkedDay.current) {
      checkedDay.current = true
      if (state.record === null || !sameDay(state.record.at, new Date())) {
        void activityNow(projectId, state.tickets, store.getState().nodeLookup).then((activity) => {
          const now = arrangements.get(projectId) ?? state
          return saveArrangement(projectId, { ...repack(now.epics, now.frames, activity), at: new Date().toISOString() })
        })
        return
      }
    }
    if (state.record === null || state.record.columns === state.columns) {
      pendingColumns.delete(projectId)
      return
    }
    if (pendingColumns.get(projectId) === state.columns) return
    pendingColumns.set(projectId, state.columns)
    void applyLayoutOp(projectId, { op: 'patchData', id: EPIC_ARRANGEMENT_ID, data: { columns: state.columns } })
  }, [projectId, nodes, store])
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
    arrangements.delete(projectId)
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

  // The frames' strip keeps clear of the Nodes on the plane, the Layout's and other sources' (ADR-0032);
  // it is found again on every change of the Layout, the workflow model or those Nodes, so Tickets
  // that arrive after main placed a Node still keep off it.
  // A frame with an offset yields to the Nodes, the Subagent trees, the strip and the frames with an
  // offset before it, in the order of their `epic-frame` Nodes in the Layout (ADR-0038).
  // The order of the frames and K come from the Layout's `epic-arrangement` record (ADR-0075).
  const frames = new Map(entries.map(({ epic, entry }) => [epic.epic, { width: entry.layout.width, height: entry.layout.height, reserve: entry.reserve }]))
  const record = readArrangement(layout.nodes.find((node) => node.id === EPIC_ARRANGEMENT_ID))
  const names = entries.map(({ epic }) => epic.epic)
  const arrangement = arrange(names, frames, record)
  const settled = elkEngine() === null || entries.every(({ entry }) => entry.request === null || entry.inputs.answer?.key === entry.request.key)
  arrangements.set(projectId, { frames, epics: names, record, columns: arrangement.columns, tickets: model.tickets, settled })
  const byEpic = new Map(entries.map((item) => [item.epic.epic, item]))
  const plane = [...layout.nodes.filter(onThePlane), ...derived]
  const order = new Map(layout.nodes.map((node, index) => [node.id, index]))
  const places = stackFrames(
    arrangement.order.map((name) => {
      const { epic, saved, entry } = byEpic.get(name)!
      return {
        epic: epic.epic,
        width: entry.layout.width,
        height: entry.layout.height,
        reserve: entry.reserve,
        offset: saved.offset,
        order: order.get(epicNodeId(epic.epic)),
      }
    }),
    plane,
    arrangement.columns,
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
  const openStacks = useEpicsUi((state) => state.openStacks)
  const doneExpanded = useMemo(
    () => Object.fromEntries(openStacks.filter((stack) => stack.projectId === projectId).map((stack) => [uiKey(projectId, stack.epic), true])),
    [openStacks, projectId],
  )
  const derived = useDerivedRects(projectId)
  const answers = useElkAnswers((state) => state[projectId])
  const nodes = useMemo(
    () => buildEpicNodes(projectId, root, model, layout, doneExpanded, derived, answers),
    [projectId, root, model, layout, doneExpanded, derived, answers],
  )
  // After the build, so a request goes out for the inputs the Canvas shows.
  useEffect(() => requestEpicLayouts(projectId), [projectId, nodes])
  useEffect(() => foldHiddenDoneStacks(projectId, nodes), [projectId, nodes])
  useFocusRequests(projectId, nodes)
  useArrangementUpkeep(projectId, nodes)
  return nodes
}

/**
 * Only a frame is dragged (by its header); its offset from its automatic place is saved as part of
 * the drop's ⌘Z step. Tickets are not draggable. Without `drop` nothing records the gesture, so
 * nothing is saved and the frame goes back.
 */
function moved({ projectId, layout }: NodeSourceContext, node: CanvasFlowNode, drop?: NodeDrop): boolean | Promise<void> {
  if (node.type !== EPIC_FRAME_KIND || drop === undefined) return false
  const frame = node.data.node.data as EpicFrameData
  const offset = { dx: Math.round(node.position.x - frame.auto.x), dy: Math.round(node.position.y - frame.auto.y) }
  return saveEpicChange(projectId, frame.epic.epic, layout.nodes.some((n) => n.id === node.id), { offset }, drop.ops, drop.group)
}

// `ticket` is owned too though the Layout never holds one: a stray Layout Node of that kind (a
// hand edit, a future `create`) has no Ticket in its data, so it is not drawn rather than crash
// the Canvas in TicketNode. `epic-arrangement` is owned so the record is never drawn.
const source: NodeSource = { owns: [EPIC_FRAME_KIND, TICKET_KIND, EPIC_ARRANGEMENT_KIND], useNodes: useEpicNodes, moved }
export default source
