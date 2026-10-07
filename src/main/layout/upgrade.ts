// What a Layout read from `layout.json` loses once, because this version no longer keeps it
// (ADR-0037, decision 17 of the owner, 2026-10-07): the Tickets inside an Epic frame and the
// Subagent Nodes are laid out, never moved by hand, so
//
// - the `offset:<NN>` keys of each `epic-frame` Node (a Ticket's offset in its frame) go, while
//   the frame's own offset (`x`, `y`) and `collapsed` stay;
// - the `subagent-tree` Nodes (a Session's Subagent offsets) go.
//
// LayoutStore runs this on every read of the file; a Layout without such leftovers comes back as
// it is (null), so the second read writes nothing. Not an operation: it is not sent to the
// renderer as one and is not in the ⌘Z history.
import { EPIC_FRAME_KIND, SUBAGENT_TREE_KIND } from '../../shared/layout/derived'
import type { Layout, LayoutNode } from '../../shared/layout/types'

export interface LayoutUpgrade {
  layout: Layout
  /** `offset:*` keys removed from the Epic frames' Nodes. */
  ticketOffsets: number
  /** `subagent-tree` Nodes removed. */
  subagentTrees: number
}

const isOffsetKey = (key: string): boolean => key.startsWith('offset:')

/** The Layout without the leftovers above; null when it has none. */
export function upgradeLayout(layout: Layout): LayoutUpgrade | null {
  let ticketOffsets = 0
  let subagentTrees = 0
  const nodes: LayoutNode[] = []
  for (const node of layout.nodes) {
    if (node.kind === SUBAGENT_TREE_KIND) {
      subagentTrees += 1
      continue
    }
    if (node.kind === EPIC_FRAME_KIND && Object.keys(node.data).some(isOffsetKey)) {
      const data = Object.fromEntries(Object.entries(node.data).filter(([key]) => !isOffsetKey(key)))
      ticketOffsets += Object.keys(node.data).length - Object.keys(data).length
      nodes.push({ ...node, data })
      continue
    }
    nodes.push(node)
  }
  if (ticketOffsets === 0 && subagentTrees === 0) return null
  return { layout: { ...layout, nodes }, ticketOffsets, subagentTrees }
}

/** The one log line for a Project whose Layout lost something. */
export const upgradeMessage = (projectId: string, { ticketOffsets, subagentTrees }: LayoutUpgrade): string =>
  `[layout] ${projectId}: removed ${ticketOffsets} Ticket offset(s) from Epic frames and ${subagentTrees} Subagent tree Node(s); Tickets and Subagents are laid out, not moved by hand (ADR-0037)`
