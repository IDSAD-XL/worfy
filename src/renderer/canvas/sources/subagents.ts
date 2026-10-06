// The Subagent tree of each Session on the Canvas (ticket 15): Nodes to the right of the
// Session's Node, one per Subagent, the Subagents a Subagent started to the right of it. A
// parent's done Subagents fold into one "N done" row under its running ones; a click on the row
// opens them (not saved). The tree comes from the Session's transcript and live events
// (claude-home/subagents.ts); none of these Nodes is a Layout Node. They are children of the
// Session's Node in React Flow, so they move with it; what the user moved by hand is kept, per
// Session, in one Layout Node of kind `subagent-tree` —
//
//   id   `subagents:<sessionId>`, locked, w = h = 1 (not drawn)
//   data["offset:<key>"] = { dx, dy }  a Node's offset from its automatic place, by the Subagent's
//                                      stable id (or `done:<parent>` for a fold row)
//
// the way the Epic frames keep their Tickets' offsets (sources/epics.ts). Each tree also has an
// invisible anchor Node at the Session Node's right edge: the Session's own Node has no handle,
// and the tree's edges (edges/subagents.ts) start there.
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { SOURCE_NODE_KINDS, SUBAGENT_KIND, SUBAGENT_TREE_KIND, subagentNodeId, subagentTreeNodeId } from '../../../shared/layout/derived'
import type { Layout, LayoutNode, LayoutOpInput } from '../../../shared/layout/types'
import type { SubagentInfo } from '../../../shared/transcript/subagents'
import { useSubagentTrees } from '../../claude-home/subagents'
import { useProjects } from '../../projects/useProjects'
import type { Rect } from '../epic-layout'
import type { NodeSource, NodeSourceContext } from '../extensions'
import type { CanvasFlowNode } from '../nodes'
import { applyLayoutOp } from '../useLayout'
import { publishPlaneRects } from './epics'

export { SUBAGENT_KIND, SUBAGENT_TREE_KIND }

export const SUBAGENT_WIDTH = 260
export const SUBAGENT_HEIGHT = 84
export const FOLD_HEIGHT = 28
/** Room between a parent and its Subagents, and between two Subagents of one parent. */
const GAP_X = 56
const GAP_Y = 12
/** Where on the Session Node's right edge the tree's lines start (its header row). */
const ANCHOR_Y = 18

export interface Offset {
  dx: number
  dy: number
}

/** A Subagent as its Node shows it: the tree's facts without the children. */
export type SubagentSummary = Omit<SubagentInfo, 'children'> & { childCount: number }

/** What a Node of this source carries in `data.node.data`. */
export interface SubagentNodeData {
  [key: string]: unknown
  variant: 'agent' | 'fold' | 'anchor'
  projectId: string
  sessionId: string
  /** The Session's Node, which these Nodes hang from. */
  sessionNodeId: string
  /** The Node the tree's edge to this one starts from; null for the anchor. */
  parentNodeId: string | null
  /** Key of the offset in the `subagent-tree` Node. */
  key: string
  /** The automatic place, relative to the Session's Node. */
  auto: { x: number; y: number }
  agent: SubagentSummary | null
  fold: { parentKey: string; count: number; expanded: boolean } | null
}

// ── state of the view that is not saved ─────────────────────────────────────

interface SubagentsUi {
  /** `<projectId>|<sessionId>|<parentKey>` of the parents whose done Subagents are shown. */
  expanded: Readonly<Record<string, boolean>>
}

const useSubagentsUi = create<SubagentsUi>(() => ({ expanded: {} }))
const uiKey = (projectId: string, sessionId: string, parentKey: string): string => `${projectId}|${sessionId}|${parentKey}`

/** Whether the done Subagents of one parent are shown. */
export function doneExpanded(projectId: string, sessionId: string, parentKey: string): boolean {
  return useSubagentsUi.getState().expanded[uiKey(projectId, sessionId, parentKey)] === true
}

/** Opens or folds the done Subagents of one parent (a Session or a Subagent). */
export function toggleDoneSubagents(projectId: string, sessionId: string, parentKey: string): void {
  const key = uiKey(projectId, sessionId, parentKey)
  useSubagentsUi.setState(({ expanded }) => ({ expanded: { ...expanded, [key]: !expanded[key] } }))
}

// ── placement ───────────────────────────────────────────────────────────────

const offsetKey = (key: string): string => `offset:${key}`
const isOffset = (value: unknown): value is Offset =>
  typeof value === 'object' && value !== null && Number.isFinite((value as Offset).dx) && Number.isFinite((value as Offset).dy)

/** The offsets a `subagent-tree` Node keeps, by key. */
export function readOffsets(node: LayoutNode | undefined): Map<string, Offset> {
  const offsets = new Map<string, Offset>()
  if (!node) return offsets
  for (const [key, value] of Object.entries(node.data)) if (key.startsWith('offset:') && isOffset(value)) offsets.set(key.slice('offset:'.length), { dx: value.dx, dy: value.dy })
  return offsets
}

export interface PlacedSubagent {
  id: string
  key: string
  parentId: string | null
  /** Relative to the Session's Node. */
  x: number
  y: number
  auto: { x: number; y: number }
  w: number
  h: number
  agent: SubagentInfo | null
  fold: { parentKey: string; count: number; expanded: boolean } | null
}

export interface PlaceInput {
  sessionId: string
  /** Width of the Session's Node. */
  sessionWidth: number
  tree: readonly SubagentInfo[]
  /** Whether the done Subagents of a parent (`session` or a Subagent's id) are shown. */
  expanded: (parentKey: string) => boolean
  offsets: ReadonlyMap<string, Offset>
}

/** `session`: the key of the Session itself as a parent. */
export const SESSION_PARENT = 'session'
export const anchorNodeId = (sessionId: string): string => subagentNodeId(sessionId, 'anchor')

/**
 * Where each Subagent of a tree goes, relative to its Session's Node: a parent's running and
 * failed Subagents in a column to its right, in start order, each with its own Subagents to its
 * right, and under them one row for the done ones (all of them when the row is open). The first
 * entry is the anchor.
 */
export function placeSubagents({ sessionId, sessionWidth, tree, expanded, offsets }: PlaceInput): PlacedSubagent[] {
  const anchor = anchorNodeId(sessionId)
  const placed: PlacedSubagent[] = [
    { id: anchor, key: 'anchor', parentId: null, x: sessionWidth, y: ANCHOR_Y, auto: { x: sessionWidth, y: ANCHOR_Y }, w: 1, h: 1, agent: null, fold: null },
  ]
  const at = (key: string, auto: { x: number; y: number }) => {
    const offset = offsets.get(key) ?? { dx: 0, dy: 0 }
    return { x: auto.x + offset.dx, y: auto.y + offset.dy }
  }
  /** Places `children` to the right of a parent whose right edge is at `right`; returns the lowest y used. */
  const column = (parentId: string, parentKey: string, right: number, top: number, children: readonly SubagentInfo[]): number => {
    const x = right + GAP_X
    let y = top
    const open = expanded(parentKey)
    const done = children.filter((child) => child.status === 'done')
    for (const child of open ? children : children.filter((each) => each.status !== 'done')) {
      const id = subagentNodeId(sessionId, child.id)
      const auto = { x, y }
      const where = at(child.id, auto)
      placed.push({ id, key: child.id, parentId, ...where, auto, w: SUBAGENT_WIDTH, h: SUBAGENT_HEIGHT, agent: child, fold: null })
      const bottom = child.children.length > 0 ? column(id, child.id, where.x + SUBAGENT_WIDTH, where.y, child.children) : where.y
      // The next sibling goes under this one's subtree, measured from where the subtree is drawn.
      y = auto.y + Math.max(SUBAGENT_HEIGHT + GAP_Y, bottom - where.y)
    }
    if (done.length > 0) {
      const key = `done:${parentKey}`
      const auto = { x, y }
      placed.push({ id: subagentNodeId(sessionId, key), key, parentId, ...at(key, auto), auto, w: SUBAGENT_WIDTH, h: FOLD_HEIGHT, agent: null, fold: { parentKey, count: done.length, expanded: open } })
      y += FOLD_HEIGHT + GAP_Y
    }
    return y
  }
  column(anchor, SESSION_PARENT, sessionWidth, 0, tree)
  return placed
}

// ── Nodes ───────────────────────────────────────────────────────────────────

const summaryOf = ({ children, ...info }: SubagentInfo): SubagentSummary => ({ ...info, childCount: children.length })

function flowNode(projectId: string, session: LayoutNode, sessionId: string, place: PlacedSubagent): CanvasFlowNode {
  const data: SubagentNodeData = {
    variant: place.agent ? 'agent' : place.fold ? 'fold' : 'anchor',
    projectId,
    sessionId,
    sessionNodeId: session.id,
    parentNodeId: place.parentId,
    key: place.key,
    auto: place.auto,
    agent: place.agent ? summaryOf(place.agent) : null,
    fold: place.fold,
  }
  const anchor = data.variant === 'anchor'
  return {
    id: place.id,
    type: SUBAGENT_KIND,
    parentId: session.id,
    position: { x: place.x, y: place.y },
    width: place.w,
    height: place.h,
    deletable: false,
    connectable: false,
    // Not selectable: the selection toolbar's Pin and tags are for Layout Nodes, and these are not.
    selectable: false,
    ...(anchor ? { draggable: false, focusable: false } : {}),
    data: {
      node: { id: place.id, kind: SUBAGENT_KIND, x: place.x, y: place.y, w: place.w, h: place.h, hidden: false, locked: true, pinned: false, tags: [], data },
    },
  }
}

/** The Session Nodes a tree can hang from: shown on the plane, naming a Session; one per Session. */
export function sessionParents(layout: Layout): LayoutNode[] {
  const seen = new Set<string>()
  return layout.nodes.filter((node) => {
    const sessionId = node.data.sessionId
    if (typeof sessionId !== 'string' || sessionId === '' || node.hidden || node.pinned || SOURCE_NODE_KINDS.includes(node.kind) || seen.has(sessionId)) return false
    seen.add(sessionId)
    return true
  })
}

/** Per Node id, the last Node and the facts it was made from, so a Node that did not change keeps its object. */
const made = new Map<string, { signature: string; node: CanvasFlowNode }>()
const lastNodes = new Map<string, readonly CanvasFlowNode[]>()
const EMPTY: readonly CanvasFlowNode[] = []

/** Every Subagent Node of a Project; the same array while nothing changed. */
export function buildSubagentNodes(
  projectId: string,
  layout: Layout,
  trees: ReadonlyMap<string, readonly SubagentInfo[]>,
  expanded: Readonly<Record<string, boolean>>,
): readonly CanvasFlowNode[] {
  const nodes: CanvasFlowNode[] = []
  for (const session of sessionParents(layout)) {
    const sessionId = session.data.sessionId as string
    const tree = trees.get(sessionId)
    if (!tree || tree.length === 0) continue
    const offsets = readOffsets(layout.nodes.find((node) => node.id === subagentTreeNodeId(sessionId)))
    const places = placeSubagents({ sessionId, sessionWidth: session.w, tree, offsets, expanded: (parentKey) => expanded[uiKey(projectId, sessionId, parentKey)] === true })
    for (const place of places) {
      const node = flowNode(projectId, session, sessionId, place)
      const signature = JSON.stringify([node.parentId, node.position, node.width, node.height, node.data.node.data])
      const before = made.get(`${projectId}|${node.id}`)
      if (before && before.signature === signature) nodes.push(before.node)
      else {
        made.set(`${projectId}|${node.id}`, { signature, node })
        nodes.push(node)
      }
    }
  }
  const before = lastNodes.get(projectId)
  if (before && before.length === nodes.length && before.every((node, index) => node === nodes[index])) return before
  if (nodes.length === 0) {
    lastNodes.delete(projectId)
    return EMPTY
  }
  lastNodes.set(projectId, nodes)
  return nodes
}

/**
 * Where the Subagent Nodes are on the plane, in absolute canvas units: a Subagent Node's position is
 * relative to its Session's Node. The anchor (1×1, not drawn) takes no room.
 */
export function subagentPlaneRects(layout: Layout, nodes: readonly CanvasFlowNode[]): Rect[] {
  const sessions = new Map(layout.nodes.map((node) => [node.id, node]))
  return nodes.flatMap((node) => {
    const session = node.parentId === undefined ? undefined : sessions.get(node.parentId)
    if (!session || (node.data.node.data as SubagentNodeData).variant === 'anchor') return []
    return [{ x: session.x + node.position.x, y: session.y + node.position.y, w: node.width ?? 0, h: node.height ?? 0 }]
  })
}

function useSubagentNodes({ projectId, layout }: NodeSourceContext): readonly CanvasFlowNode[] {
  const root = useProjects()?.projects.find((project) => project.id === projectId)?.path
  const sessionIds = useMemo(() => sessionParents(layout).map((node) => node.data.sessionId as string), [layout])
  const trees = useSubagentTrees(root, sessionIds)
  const expanded = useSubagentsUi((state) => state.expanded)
  const nodes = useMemo(() => buildSubagentNodes(projectId, layout, trees, expanded), [projectId, layout, trees, expanded])
  // The Epic frames' column keeps clear of the Subagent Nodes too (ADR-0032).
  useEffect(() => publishPlaneRects(projectId, 'subagents', subagentPlaneRects(layout, nodes)), [projectId, layout, nodes])
  return nodes
}

/**
 * Saves a Node's offset from its automatic place into the Session's `subagent-tree` Node: creates
 * it the first time, then patches it. A create that lost a race falls back to the patch.
 */
export async function saveSubagentOffset(projectId: string, sessionId: string, exists: boolean, key: string, offset: Offset): Promise<void> {
  const id = subagentTreeNodeId(sessionId)
  const data = { [offsetKey(key)]: offset }
  if (!exists) {
    const op: LayoutOpInput = { op: 'create', node: { id, kind: SUBAGENT_TREE_KIND, x: 0, y: 0, w: 1, h: 1, locked: true, data } }
    if ((await applyLayoutOp(projectId, op)) === undefined) return
  }
  await applyLayoutOp(projectId, { op: 'patchData', id, data })
}

function moved({ projectId, layout }: NodeSourceContext, node: CanvasFlowNode): void {
  const data = node.data.node.data as SubagentNodeData
  if (node.type !== SUBAGENT_KIND || data.variant === 'anchor') return
  const offset = { dx: Math.round(node.position.x - data.auto.x), dy: Math.round(node.position.y - data.auto.y) }
  const exists = layout.nodes.some((each) => each.id === subagentTreeNodeId(data.sessionId))
  void saveSubagentOffset(projectId, data.sessionId, exists, data.key, offset)
}

// `subagent` is owned too though the Layout never holds one: a stray Layout Node of that kind is
// not drawn rather than drawn without a Subagent.
const source: NodeSource = { owns: [SUBAGENT_KIND, SUBAGENT_TREE_KIND], useNodes: useSubagentNodes, moved }
export default source
