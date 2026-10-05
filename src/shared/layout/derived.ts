// Epic frames and Tickets on the Canvas are not Layout Nodes: the renderer computes them from the
// workflow model (src/renderer/canvas/sources/epics.ts, ticket 11). What the user changed by hand
// is kept in one Layout Node per Epic, of kind `epic-frame`, whose `x`/`y` are the frame's offset
// from its automatic place (not a position) and whose `w`/`h` are 1. Such a Node is a node
// source's saved state, not a Node on the Canvas, so the canvas tools (src/main/mcp, ADR-0003)
// neither list nor change it, and refuse the ids of frames and Tickets: those are laid out from
// the workflow and moved by the user only. An agent refers to an Epic or a Ticket through
// `link_card`.

export const EPIC_FRAME_KIND = 'epic-frame'
export const TICKET_KIND = 'ticket'
/**
 * The Subagent tree of a Session (ticket 15) is drawn the same way: its Nodes (`subagent`) are
 * computed from the Session's transcript (src/renderer/canvas/sources/subagents.ts), and one Layout
 * Node per Session, of kind `subagent-tree`, keeps the user's offsets.
 */
export const SUBAGENT_KIND = 'subagent'
export const SUBAGENT_TREE_KIND = 'subagent-tree'

export const epicNodeId = (epic: string): string => `epic:${epic}`
export const ticketNodeId = (epic: string, num: number): string => `ticket:${epic}/${num}`

export const subagentTreeNodeId = (sessionId: string): string => `subagents:${sessionId}`
export const subagentNodeId = (sessionId: string, key: string): string => `subagent:${sessionId}/${key}`

/** Kinds that only a node source draws; a Layout Node of such a kind is not a Node on the Canvas. */
export const SOURCE_NODE_KINDS: readonly string[] = [EPIC_FRAME_KIND, TICKET_KIND, SUBAGENT_KIND, SUBAGENT_TREE_KIND]

/** True for the id of an Epic frame, a Ticket or a Subagent on the Canvas, whether or not the Layout has a Node for it. */
export const isSourceNodeId = (id: string): boolean => id.startsWith('epic:') || id.startsWith('ticket:') || id.startsWith('subagent:') || id.startsWith('subagents:')
