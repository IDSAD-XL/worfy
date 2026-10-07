// Requests to the Canvas from outside React Flow (ticket 31). The command palette lives in the
// toolbar, outside the Canvas's React Flow provider, so it cannot move the viewport itself: it
// leaves a request here and the find overlay (CanvasFind.tsx), which is drawn inside React Flow,
// carries it out. `seq` makes a repeated request a new one.
//
// Nothing here is saved: the tag filter and the find bar belong to this window's view only. The
// requests that change the Layout (a new Node, "Tidy up") go through the Canvas's own LayoutOps,
// so they are recorded for ⌘Z like a click in the Canvas menu.
import { create } from 'zustand'

export interface NodeFocusRequest {
  projectId: string
  nodeId: string
  /** Centered instead when the Node is not on the Canvas (a Ticket inside a collapsed frame). */
  fallbackId?: string | undefined
  seq: number
}

export interface CreateRequest {
  projectId: string
  /** The Node type to create, as in the Canvas menu (createLabel, ADR-0014). */
  kind: string
  seq: number
}

/** "Tidy up" (worfy-week/07): lay out the Nodes of the Project's Canvas, as the Canvas menu item does. */
export interface TidyRequest {
  projectId: string
  seq: number
}

export interface TagFilter {
  projectId: string
  tag: string
}

/** A "New …" item of the Canvas menu: a Node type that exports `createLabel` (ADR-0014). */
export interface CreateItemInfo {
  label: string
  kind: string
}

export interface AdrRequest {
  projectId: string
  path: string
  seq: number
}

interface CanvasRequests {
  focus: NodeFocusRequest | null
  create: CreateRequest | null
  tidy: TidyRequest | null
  tagFilter: TagFilter | null
  /** The find bar is open; `findSeq` grows on every ⌘F, so a second ⌘F focuses the field again. */
  findOpen: boolean
  findSeq: number
  adr: AdrRequest | null
  /**
   * The `seq` of the last ADR request carried out. It lives here, not in the sidebar, so a sidebar
   * shown again does not carry the same request out twice, and `adr` keeps its `seq` growing.
   */
  adrHandled: number
  /**
   * The Canvas menu's "New …" items, published by the Canvas (CanvasFind.tsx) for the palette. The
   * palette does not import the Node type registry itself: the toolbar stays free of the Canvas's
   * modules, whose glob of Node type files is expanded once, when the Canvas is first imported.
   */
  createItems: readonly CreateItemInfo[]
}

export const useCanvasRequests = create<CanvasRequests>(() => ({ focus: null, create: null, tidy: null, tagFilter: null, findOpen: false, findSeq: 0, adr: null, adrHandled: 0, createItems: [] }))

/** Shows the Canvas centered on a Node; the selection stays as it is. */
export function focusCanvasNode(projectId: string, nodeId: string, fallbackId?: string): void {
  useCanvasRequests.setState(({ focus }) => ({ focus: { projectId, nodeId, fallbackId, seq: (focus?.seq ?? 0) + 1 } }))
}

/** Creates a Node of `kind` in the middle of the Canvas, as the Canvas menu does at the pointer. */
export function createCanvasNode(projectId: string, kind: string): void {
  useCanvasRequests.setState(({ create }) => ({ create: { projectId, kind, seq: (create?.seq ?? 0) + 1 } }))
}

/** Lays out the Nodes of the Project's Canvas ("Tidy up"), as the Canvas menu item does. */
export function requestTidyUp(projectId: string): void {
  useCanvasRequests.setState(({ tidy }) => ({ tidy: { projectId, seq: (tidy?.seq ?? 0) + 1 } }))
}

/** Shows only the Nodes that carry `tag`; null shows every Node again. */
export function setTagFilter(filter: TagFilter | null): void {
  useCanvasRequests.setState({ tagFilter: filter })
}

export function openFind(): void {
  useCanvasRequests.setState(({ findSeq }) => ({ findOpen: true, findSeq: findSeq + 1 }))
}

export function closeFind(): void {
  useCanvasRequests.setState({ findOpen: false })
}

/** Opens an ADR read-only, as a click on it in the sidebar's ADR section does. */
export function openAdr(projectId: string, path: string): void {
  useCanvasRequests.setState(({ adr }) => ({ adr: { projectId, path, seq: (adr?.seq ?? 0) + 1 } }))
}

/** Marks the ADR requests up to `seq` as carried out: none of them is answered again. */
export function markAdrHandled(seq: number): void {
  useCanvasRequests.setState({ adrHandled: seq })
}
