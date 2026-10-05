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

export const epicNodeId = (epic: string): string => `epic:${epic}`
export const ticketNodeId = (epic: string, num: number): string => `ticket:${epic}/${num}`

/** Kinds that only a node source draws; a Layout Node of such a kind is not a Node on the Canvas. */
export const SOURCE_NODE_KINDS: readonly string[] = [EPIC_FRAME_KIND, TICKET_KIND]

/** True for the id of an Epic frame or a Ticket on the Canvas, whether or not the Layout has a Node for it. */
export const isSourceNodeId = (id: string): boolean => id.startsWith('epic:') || id.startsWith('ticket:')
