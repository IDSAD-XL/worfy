// What a Layout read from `layout.json` loses or changes once, because this version no longer
// keeps it (ADR-0037, ADR-0038; decisions 17 and 27 of the owner, 2026-10-07):
//
// - the Tickets inside an Epic frame and the Subagent Nodes are laid out, never moved by hand, so
//   the `offset:<NN>` keys of each `epic-frame` Node (a Ticket's offset in its frame) go, while the
//   frame's own offset (`x`, `y`) and `collapsed` stay, and the `subagent-tree` Nodes (a Session's
//   Subagent offsets) go;
// - Nodes never overlap: the Nodes on the plane are taken in the order of the Layout, the order
//   they were created in, and a Node closer than the gap to one before it goes to its nearest clear
//   place (shared/layout/free-place.ts). Each such move is one log line.
//
// LayoutStore runs this on every read of the file; a Layout without such leftovers or overlaps
// comes back as it is (null), so the second read writes nothing. Not an operation: it is not sent
// to the renderer as one and is not in the ⌘Z history.
import { EPIC_FRAME_KIND, SUBAGENT_TREE_KIND } from '../../shared/layout/derived'
import { removeOverlaps, type NodeMove } from '../../shared/layout/free-place'
import type { Layout, LayoutNode } from '../../shared/layout/types'

export interface LayoutUpgrade {
  layout: Layout
  /** `offset:*` keys removed from the Epic frames' Nodes. */
  ticketOffsets: number
  /** `subagent-tree` Nodes removed. */
  subagentTrees: number
  /** Nodes moved off the Nodes created before them, in the order they were moved. */
  moves: NodeMove[]
}

const isOffsetKey = (key: string): boolean => key.startsWith('offset:')

/** The Layout without the leftovers above and without overlaps; null when it has none. */
export function upgradeLayout(layout: Layout): LayoutUpgrade | null {
  let ticketOffsets = 0
  let subagentTrees = 0
  const kept: LayoutNode[] = []
  for (const node of layout.nodes) {
    if (node.kind === SUBAGENT_TREE_KIND) {
      subagentTrees += 1
      continue
    }
    if (node.kind === EPIC_FRAME_KIND && Object.keys(node.data).some(isOffsetKey)) {
      const data = Object.fromEntries(Object.entries(node.data).filter(([key]) => !isOffsetKey(key)))
      ticketOffsets += Object.keys(node.data).length - Object.keys(data).length
      kept.push({ ...node, data })
      continue
    }
    kept.push(node)
  }
  const { nodes, moves } = removeOverlaps(kept)
  if (ticketOffsets === 0 && subagentTrees === 0 && moves.length === 0) return null
  return { layout: { ...layout, nodes }, ticketOffsets, subagentTrees, moves }
}

const point = ({ x, y }: { x: number; y: number }): string => `(${x}, ${y})`

/** The log lines for a Project whose Layout changed: one for the leftovers, if any, and one per moved Node. */
export function upgradeMessages(projectId: string, { ticketOffsets, subagentTrees, moves }: LayoutUpgrade): string[] {
  const lines: string[] = []
  if (ticketOffsets > 0 || subagentTrees > 0) {
    lines.push(
      `[layout] ${projectId}: removed ${ticketOffsets} Ticket offset(s) from Epic frames and ${subagentTrees} Subagent tree Node(s); Tickets and Subagents are laid out, not moved by hand (ADR-0037)`,
    )
  }
  for (const move of moves) lines.push(`[layout] ${projectId}: moved Node ${move.id} from ${point(move.from)} to ${point(move.to)} off the Nodes created before it; Nodes never overlap (ADR-0038)`)
  return lines
}
