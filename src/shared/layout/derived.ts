// Epic frames and Tickets on the Canvas are not Layout Nodes: the renderer computes them from the
// workflow model (src/renderer/canvas/sources/epics.ts, ticket 11). What the user changed by hand
// is kept in one Layout Node per Epic, of kind `epic-frame`, whose `x`/`y` are the frame's offset
// from its automatic place (not a position), whose `w`/`h` are 1 and whose `data.collapsed` says
// whether the user collapsed the frame — nothing else (ADR-0037). Such a Node is a node source's
// saved state, not a Node on the Canvas, so the canvas tools (src/main/mcp, ADR-0003) neither list
// nor change it, and refuse the ids of frames and Tickets: those are laid out from the workflow,
// and only a whole frame is moved, by the user. An agent refers to an Epic or a Ticket through
// `link_card`.

export const EPIC_FRAME_KIND = 'epic-frame'
export const TICKET_KIND = 'ticket'
/**
 * The Subagent tree of a Session (ticket 15) is drawn the same way: its Nodes (`subagent`) are
 * computed from the Session's transcript (src/renderer/canvas/sources/subagents.ts), and nothing
 * about them is saved. A Layout Node of kind `subagent-tree` kept the user's offsets of a
 * Session's Subagent Nodes in older versions; it keeps nothing now, and main removes it when it
 * reads a Layout (src/main/layout/upgrade.ts, ADR-0037).
 */
export const SUBAGENT_KIND = 'subagent'
export const SUBAGENT_TREE_KIND = 'subagent-tree'
/**
 * The order of the Epic frames and their number of columns, one record per Project (ADR-0075,
 * src/renderer/canvas/epic-arrangement.ts): an invisible locked Node, not on the plane. It is an
 * internal layout record, not an Epic frame or a Ticket: the canvas tools of the MCP server say so
 * when an agent names it (src/main/mcp/canvas-server.ts).
 */
export const EPIC_ARRANGEMENT_KIND = 'epic-arrangement'
export const EPIC_ARRANGEMENT_ID = 'epic-arrangement'
/**
 * The shelf of done Epics under the frames' strip (ADR-0075, point 5): one Node per Project that
 * only the renderer draws, from the workflow model and the frames' `collapsed` flags. Nothing about
 * it is in the Layout.
 */
export const DONE_SHELF_KIND = 'done-shelf'
export const DONE_SHELF_ID = 'done-shelf'

export const epicNodeId = (epic: string): string => `epic:${epic}`
export const ticketNodeId = (epic: string, num: number): string => `ticket:${epic}/${num}`

export const subagentTreeNodeId = (sessionId: string): string => `subagents:${sessionId}`
export const subagentNodeId = (sessionId: string, key: string): string => `subagent:${sessionId}/${key}`

/** Kinds that only a node source draws; a Layout Node of such a kind is not a Node on the Canvas. */
export const SOURCE_NODE_KINDS: readonly string[] = [EPIC_FRAME_KIND, TICKET_KIND, SUBAGENT_KIND, SUBAGENT_TREE_KIND, EPIC_ARRANGEMENT_KIND, DONE_SHELF_KIND]

/**
 * A Layout Node that takes room on the plane: one rule for main, which places new Nodes
 * (src/main/layout/place.ts), and the renderer, which keeps the Epic frames clear of them
 * (ADR-0032). A source kind keeps an offset, not a place; a pinned Node keeps screen pixels, not
 * plane coordinates; a hidden Node is not drawn, and neither is an archived one (ADR-0076).
 */
export const onThePlane = (node: { kind: string; pinned: boolean; hidden: boolean; archived?: unknown }): boolean =>
  !node.pinned && !node.hidden && node.archived == null && !SOURCE_NODE_KINDS.includes(node.kind)

/** True for the id of a Subagent Node, or of the Layout Node that kept a Session's Subagent offsets in older versions. */
export const isSubagentNodeId = (id: string): boolean => id.startsWith('subagent:') || id.startsWith('subagents:')

/** True for the id of an Epic frame, a Ticket or a Subagent on the Canvas, whether or not the Layout has a Node for it. */
export const isSourceNodeId = (id: string): boolean => id.startsWith('epic:') || id.startsWith('ticket:') || isSubagentNodeId(id)
