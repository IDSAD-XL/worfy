// "Tidy up" (worfy-week/07; owner's decisions 19, 25 and 28): the Nodes of the Layout on the plane
// are packed into rows by ELK's rectangle packing, in the Web Worker of elk/client.ts, and their new
// places go to main as one `moveMany`. main checks that operation like any other (ADR-0038), and
// the Canvas's LayoutOps record it as one step: one ⌘Z puts every Node back, ⇧⌘Z tidies again.
//
// What is laid out: every Layout Node on the plane (`onThePlane`) — Sessions, Cards, Notes,
// Terminals, the Orchestrator, HANDOFF. Pinned and hidden Nodes stay as they are; so do the Epic
// frames, whose column keeps clear of the Nodes on its own (ADR-0032). A Session and its Subagent
// tree are one rectangle: the tree is placed as it hangs right of the Session when nothing is in
// its way (sources/subagents.ts), and the rectangle around both is packed. After the packing the
// tree's own place is clear of every neighbour, so it does not move off them.
//
// How: the rectangles go in reading order of their places now (top to bottom, then left to
// right), TIDY_GAP apart, from the top-left corner of the rectangle around them now. Sizes do not
// change; the corners go on the GRID. A second "Tidy up" right after the first finds every Node
// in place and sends nothing; so does a Canvas with fewer than two such Nodes.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { onThePlane } from '../../shared/layout/derived'
import type { Layout, LayoutNode, LayoutOpInput } from '../../shared/layout/types'
import type { SubagentInfo } from '../../shared/transcript/subagents'
import { useSubagentTrees } from '../claude-home/subagents'
import { elkEngine } from './elk/client'
import type { ElkEngine } from './elk/layout'
import { packRects } from './elk/pack'
import type { Rect } from './epic-layout'
import { doneExpanded, placeSubagents, sessionParents, treeBlock } from './sources/subagents'
import { currentLayout, useLayout, useLayoutOps } from './useLayout'

/** Room between two tidied rectangles: three steps of the 8 px grid, more than the 16 px gap of ADR-0038. */
export const TIDY_GAP = 24
/** The grid the tidied corners go on. */
export const TIDY_GRID = 8

/** One rectangle of the packing: a Node, with its Subagent tree when it has one. */
export interface TidyItem {
  /** The Layout Node that moves. */
  id: string
  /** The rectangle around the Node and its tree, on the plane. */
  rect: Rect
  /** Where the Node's corner is inside `rect`. */
  dx: number
  dy: number
}

const onGrid = (value: number): number => Math.round(value / TIDY_GRID) * TIDY_GRID
const upToGrid = (value: number): number => Math.ceil(value / TIDY_GRID) * TIDY_GRID

/**
 * The rectangles "Tidy up" packs, in reading order of their places now: one per Layout Node on the
 * plane, the Subagent tree's block (relative to its Session's Node, as `treeBlock` gives it) inside
 * its Session's rectangle.
 */
export function tidyItems(nodes: readonly LayoutNode[], trees: ReadonlyMap<string, Rect> = new Map()): TidyItem[] {
  const items = nodes.filter(onThePlane).map((node): TidyItem => {
    const tree = trees.get(node.id)
    if (tree === undefined || tree.w <= 0 || tree.h <= 0) return { id: node.id, rect: { x: node.x, y: node.y, w: node.w, h: node.h }, dx: 0, dy: 0 }
    const left = Math.min(0, tree.x)
    const top = Math.min(0, tree.y)
    const rect = { x: node.x + left, y: node.y + top, w: Math.max(node.w, tree.x + tree.w) - left, h: Math.max(node.h, tree.y + tree.h) - top }
    return { id: node.id, rect, dx: -left, dy: -top }
  })
  return items.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * The operation "Tidy up" sends for these Nodes: one `moveMany` with the new place of every Node on
 * the plane, or undefined when there are fewer than two of them or every one is in its place already.
 */
export async function tidyOperation(nodes: readonly LayoutNode[], trees: ReadonlyMap<string, Rect>, elk: ElkEngine): Promise<LayoutOpInput | undefined> {
  const items = tidyItems(nodes, trees)
  if (items.length < 2) return undefined
  // Sizes padded up to the grid, so that ELK's sums of sizes and gaps stay on it.
  const packed = await packRects(
    items.map(({ id, rect }) => ({ id, w: upToGrid(rect.w), h: upToGrid(rect.h) })),
    TIDY_GAP,
    elk,
  )
  const left = onGrid(Math.min(...items.map((item) => item.rect.x)))
  const top = onGrid(Math.min(...items.map((item) => item.rect.y)))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const moves = items.map((item, index) => {
    const place = packed[index]!
    // A Node whose corner is off the rectangle's corner (a tree reaching above or left of its
    // Session) is rounded onto the grid too: at most half a step, well inside the 8 px between
    // TIDY_GAP and the 16 px gap.
    return { id: item.id, x: onGrid(left + place.x + item.dx), y: onGrid(top + place.y + item.dy) }
  })
  if (moves.every((move) => byId.get(move.id)?.x === move.x && byId.get(move.id)?.y === move.y)) return undefined
  return { op: 'moveMany', moves }
}

/** The block of each Session's Subagent tree where it hangs with nothing in its way, by the Session's Node id. */
export function naturalTreeBlocks(projectId: string, layout: Layout, trees: ReadonlyMap<string, readonly SubagentInfo[]>): Map<string, Rect> {
  const blocks = new Map<string, Rect>()
  for (const session of sessionParents(layout)) {
    const sessionId = session.data.sessionId as string
    const tree = trees.get(sessionId)
    if (!tree || tree.length === 0) continue
    const block = treeBlock(placeSubagents({ sessionId, sessionWidth: session.w, tree, expanded: (parentKey) => doneExpanded(projectId, sessionId, parentKey) }))
    if (block) blocks.set(session.id, block)
  }
  return blocks
}

/** What the packing reads of the Layout's Nodes: a change of anything else (the viewport, data, tags) does not matter. */
const placesKey = (nodes: readonly LayoutNode[]): string => JSON.stringify(nodes.map((node) => [node.id, node.kind, node.x, node.y, node.w, node.h, node.hidden, node.pinned]))

/** "Tidy up" runs at most once at a time per Project: a second command while one runs is dropped. */
const running = new Set<string>()
/** How often the packing is computed again when the Nodes moved while ELK was at it. */
const TRIES = 3

/**
 * Packs the Nodes of the Project's Layout as it is now and sends the new places through `apply`.
 * When a Node moved, came or went while ELK was packing, the Layout is packed again as it is then;
 * after TRIES such changes in a row nothing is sent. Resolves to the operation sent, if any.
 */
export async function runTidyUp(
  projectId: string,
  trees: (layout: Layout) => ReadonlyMap<string, Rect>,
  apply: (op: LayoutOpInput) => Promise<void>,
  elk: ElkEngine | null = elkEngine(),
): Promise<LayoutOpInput | undefined> {
  if (running.has(projectId) || elk === null) return undefined
  running.add(projectId)
  try {
    for (let attempt = 0; attempt < TRIES; attempt += 1) {
      const before = currentLayout(projectId)
      if (before === undefined) return undefined
      const op = await tidyOperation(before.nodes, trees(before), elk)
      const now = currentLayout(projectId)
      if (now === undefined || placesKey(now.nodes) !== placesKey(before.nodes)) continue
      if (op !== undefined) await apply(op)
      return op
    }
    console.warn('Tidy up: the Nodes kept moving while they were laid out; nothing was moved')
    return undefined
  } catch (error) {
    // The Nodes keep their places.
    console.error('Tidy up failed', error)
    return undefined
  } finally {
    running.delete(projectId)
  }
}

/**
 * "Tidy up" for the Canvas of `projectId`: the command the Canvas menu and the palette's request
 * call. The new places go through the Canvas's LayoutOps, so the whole layout is one step of ⌘Z.
 */
export function useTidyUp(projectId: string, root: string | undefined): () => Promise<void> {
  const ops = useLayoutOps()
  const layout = useLayout(projectId).state?.layout
  const sessionIds = useMemo(() => (layout ? sessionParents(layout).map((node) => node.data.sessionId as string) : []), [layout])
  const trees = useSubagentTrees(root, sessionIds)
  const treesNow = useRef(trees)
  useEffect(() => {
    treesNow.current = trees
  }, [trees])

  return useCallback(async () => {
    await runTidyUp(
      projectId,
      (now) => naturalTreeBlocks(projectId, now, treesNow.current),
      (op) => ops.apply(op),
    )
  }, [projectId, ops])
}
