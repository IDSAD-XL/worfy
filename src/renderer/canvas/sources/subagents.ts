// The Subagent tree of each Session on the Canvas (ticket 15): Nodes to the right of the
// Session's Node, one per Subagent, the Subagents a Subagent started to the right of it. A
// parent's done Subagents fold into one "N done" row under its running ones; a click on the row
// opens them (not saved). The tree comes from the Session's transcript and live events
// (claude-home/subagents.ts); none of these Nodes is a Layout Node, and nothing about them is
// saved. They are children of the Session's Node in React Flow, so they move with it. Their places
// are computed, never moved by hand (ADR-0037): a Subagent's Node can still be dragged onto a
// Ticket or an Epic frame to bind it (overlays/BindingDrop.tsx), and goes back to its place on the
// drop. Older Layouts kept offsets of these Nodes in a `subagent-tree` Node per Session; main
// removes those Nodes when it reads the file (src/main/layout/upgrade.ts). Each tree also has an
// invisible anchor Node at the Session Node's right edge: the Session's own Node has no handle,
// and the tree's edges (edges/subagents.ts) start there.
//
// The places keep clear of the Nodes of the Layout on the plane (worfy-daily ticket 28): the whole
// tree but its anchor shifts, right and down, to the nearest room where it covers none. The Epic
// frames are not counted: their column keeps clear of the tree (ADR-0032), and if the tree kept
// clear of the frames too, each would push the other.
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { onThePlane, SOURCE_NODE_KINDS, SUBAGENT_KIND, SUBAGENT_TREE_KIND, subagentNodeId } from '../../../shared/layout/derived'
import type { Layout, LayoutNode } from '../../../shared/layout/types'
import type { SubagentInfo } from '../../../shared/transcript/subagents'
import { useSubagentTrees } from '../../claude-home/subagents'
import { useProjects } from '../../projects/useProjects'
import type { Rect } from '../epic-layout'
import type { NodeSource, NodeSourceContext } from '../extensions'
import type { CanvasFlowNode } from '../nodes'
import { publishPlaneRects } from './epics'

export { SUBAGENT_KIND, SUBAGENT_TREE_KIND }

export const SUBAGENT_WIDTH = 260
export const SUBAGENT_HEIGHT = 84
export const FOLD_HEIGHT = 28
/** Room between a parent and its Subagents, and between two Subagents of one parent. */
const GAP_X = 56
const GAP_Y = 12
/** Room the automatic places keep from a Node of the Layout. */
const CLEARANCE = 24
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
  /** The Subagent's stable id, `done:<parent>` for a fold row, `anchor` for the anchor. */
  key: string
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

export interface PlacedSubagent {
  id: string
  key: string
  parentId: string | null
  /** Relative to the Session's Node. */
  x: number
  y: number
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
  /**
   * Nodes the automatic places keep clear of, relative to the Session's Node: the Layout's Nodes on
   * the plane (`clearOf`). None by default.
   */
  around?: readonly Rect[]
}

/** `session`: the key of the Session itself as a parent. */
export const SESSION_PARENT = 'session'
export const anchorNodeId = (sessionId: string): string => subagentNodeId(sessionId, 'anchor')

/**
 * Where each Subagent of a tree goes, relative to its Session's Node: a parent's running and
 * failed Subagents in a column to its right, in start order, each with its own Subagents to its
 * right, and under them one row for the done ones (all of them when the row is open). The whole
 * tree but the anchor then shifts off the Nodes `around` (`clearShift`). The first entry is the
 * anchor.
 */
export function placeSubagents({ sessionId, sessionWidth, tree, expanded, around = [] }: PlaceInput): PlacedSubagent[] {
  const anchor = anchorNodeId(sessionId)
  const placed: PlacedSubagent[] = [{ id: anchor, key: 'anchor', parentId: null, x: sessionWidth, y: ANCHOR_Y, w: 1, h: 1, agent: null, fold: null }]
  /** Places `children` to the right of a parent whose right edge is at `right`; returns the lowest y used. */
  const column = (parentId: string, parentKey: string, right: number, top: number, children: readonly SubagentInfo[]): number => {
    const x = right + GAP_X
    let y = top
    const open = expanded(parentKey)
    const done = children.filter((child) => child.status === 'done')
    for (const child of open ? children : children.filter((each) => each.status !== 'done')) {
      const id = subagentNodeId(sessionId, child.id)
      placed.push({ id, key: child.id, parentId, x, y, w: SUBAGENT_WIDTH, h: SUBAGENT_HEIGHT, agent: child, fold: null })
      const bottom = child.children.length > 0 ? column(id, child.id, x + SUBAGENT_WIDTH, y, child.children) : y
      // The next sibling goes under this one's subtree.
      y += Math.max(SUBAGENT_HEIGHT + GAP_Y, bottom - y)
    }
    if (done.length > 0) {
      const key = `done:${parentKey}`
      placed.push({ id: subagentNodeId(sessionId, key), key, parentId, x, y, w: SUBAGENT_WIDTH, h: FOLD_HEIGHT, agent: null, fold: { parentKey, count: done.length, expanded: open } })
      y += FOLD_HEIGHT + GAP_Y
    }
    return y
  }
  column(anchor, SESSION_PARENT, sessionWidth, 0, tree)
  // The anchor stays on the Session Node's edge: the tree's lines start there.
  const shifts = (place: PlacedSubagent) => place.id !== anchor
  const shift = clearShift(placed.filter(shifts), around)
  if (shift.dx === 0 && shift.dy === 0) return placed
  return placed.map((place) => (shifts(place) ? { ...place, x: place.x + shift.dx, y: place.y + shift.dy } : place))
}

/**
 * The smallest shift, right and down only, that keeps every rect of `moving` CLEARANCE away from
 * every rect of `around`; the nearest one by distance, then the one less to the right. Candidates
 * are no shift and the shifts that put the moving rects right of or under a rect of `around`; the
 * one right of all of them is always clear.
 */
export function clearShift(moving: readonly Rect[], around: readonly Rect[]): Offset {
  const none = { dx: 0, dy: 0 }
  if (moving.length === 0 || around.length === 0) return none
  const covers = ({ dx, dy }: Offset) =>
    moving.some((rect) =>
      around.some(
        (other) =>
          rect.x + dx < other.x + other.w + CLEARANCE &&
          other.x < rect.x + dx + rect.w + CLEARANCE &&
          rect.y + dy < other.y + other.h + CLEARANCE &&
          other.y < rect.y + dy + rect.h + CLEARANCE,
      ),
    )
  if (!covers(none)) return none
  const left = Math.min(...moving.map((rect) => rect.x))
  const top = Math.min(...moving.map((rect) => rect.y))
  const xs = [0, ...around.map((other) => other.x + other.w + CLEARANCE - left).filter((dx) => dx > 0)]
  const ys = [0, ...around.map((other) => other.y + other.h + CLEARANCE - top).filter((dy) => dy > 0)]
  const shifts = xs.flatMap((dx) => ys.map((dy) => ({ dx, dy }))).sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy) || a.dx - b.dx)
  return shifts.find((shift) => !covers(shift)) ?? { dx: Math.max(...xs), dy: 0 }
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
    agent: place.agent ? summaryOf(place.agent) : null,
    fold: place.fold,
  }
  const anchor = data.variant === 'anchor'
  // Only a Subagent's own Node is dragged, and only to bind it (overlays/BindingDrop.tsx): it goes
  // back to its place on the drop (`moved`). A fold row and the anchor do not move at all.
  const draggable = data.variant === 'agent'
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
    draggable,
    // React Flow lets the pointer through a Node that can be neither dragged nor selected; a fold
    // row is still clicked to open it.
    ...(anchor ? { focusable: false } : draggable ? {} : { style: { pointerEvents: 'all' as const } }),
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
  // The Layout's Nodes on the plane; the frames and Tickets are not among them (ADR-0032).
  const plane = layout.nodes.filter(onThePlane)
  for (const session of sessionParents(layout)) {
    const sessionId = session.data.sessionId as string
    const tree = trees.get(sessionId)
    if (!tree || tree.length === 0) continue
    const around = plane.map((node) => ({ x: node.x - session.x, y: node.y - session.y, w: node.w, h: node.h }))
    const places = placeSubagents({ sessionId, sessionWidth: session.w, tree, around, expanded: (parentKey) => expanded[uiKey(projectId, sessionId, parentKey)] === true })
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

/** Nothing is saved for a dropped Subagent Node: the Canvas puts it back at its place (ADR-0037). */
const moved = (): boolean => false

// `subagent` is owned too though the Layout never holds one: a stray Layout Node of that kind is
// not drawn rather than drawn without a Subagent. So is `subagent-tree`, which older versions
// wrote and main removes when it reads the Layout (src/main/layout/upgrade.ts).
const source: NodeSource = { owns: [SUBAGENT_KIND, SUBAGENT_TREE_KIND], useNodes: useSubagentNodes, moved }
export default source
