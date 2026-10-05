// The tools of the canvas MCP server `worfy-canvas` (ADR-0003): the only way an agent changes a
// Project's Layout. This is a public contract between the agent and the app; change it together
// with the agent instructions (src/main/mcp/agent-instructions.md).
//
// Schemas are zod raw shapes, as the SDK's tool() takes them. The server (src/main/mcp/canvas-server.ts)
// parses the arguments again with the same shapes, so keys a shape does not declare never reach
// the Layout whoever calls the handler. Descriptions are short on purpose: every Session carries
// them in its context next to the user's own MCP servers (ticket 06).
import { z } from 'zod'
import { nodeIdSchema } from '../layout/types'

export const CANVAS_SERVER_NAME = 'worfy-canvas'

/** Sizes an agent may give a Node, in canvas units. */
export const TOOL_SIZE_MIN = 40
export const TOOL_SIZE_MAX = 4000
/** How far from the origin an agent may put a Node. */
export const TOOL_COORDINATE_LIMIT = 100_000

export const CARD_KIND = 'card'
export const NOTE_KIND = 'note'
export const CARD_SIZE = { w: 360, h: 280 }
export const NOTE_SIZE = { w: 220, h: 120 }
/** Space left between a new Node and its neighbours. */
export const PLACEMENT_GAP = 40

const coordinate = z.number().min(-TOOL_COORDINATE_LIMIT).max(TOOL_COORDINATE_LIMIT)
const size = z.number().min(TOOL_SIZE_MIN).max(TOOL_SIZE_MAX)
const title = z.string().trim().min(1).max(200)
const noteText = z.string().max(20_000)

/** `<epic>` or `<epic>/<NN>`: the same Epic and number forms the workflow model uses. */
const TARGET = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\/(\d{1,6}))?$/u

export interface LinkTarget {
  epic: string
  /** null for a link to the Epic itself. */
  num: number | null
}

/** `worfy-mvp` → the Epic, `worfy-mvp/07` → its Ticket 7; anything else → null. */
export function parseLinkTarget(value: string): LinkTarget | null {
  const match = TARGET.exec(value.trim())
  if (!match) return null
  const [, epic, digits] = match
  return { epic: epic!, num: digits === undefined ? null : Number(digits) }
}

export const linkTargetSchema = z.object({ epic: z.string().min(1), num: z.number().int().nonnegative().nullable() })

export const canvasToolShapes = {
  list_nodes: {},
  create_card: { title, x: coordinate.optional(), y: coordinate.optional(), w: size.optional(), h: size.optional() },
  create_note: { text: noteText, x: coordinate.optional(), y: coordinate.optional(), w: size.optional(), h: size.optional() },
  update_node: { id: nodeIdSchema, title: title.optional(), text: noteText.optional() },
  move_node: { id: nodeIdSchema, x: coordinate, y: coordinate },
  resize_node: { id: nodeIdSchema, w: size, h: size },
  hide_node: { id: nodeIdSchema, hidden: z.boolean().default(true) },
  link_card: {
    id: nodeIdSchema,
    target: z.string().refine((value) => parseLinkTarget(value) !== null, 'expected <epic> or <epic>/<NN>'),
    remove: z.boolean().default(false),
  },
} satisfies Record<string, z.ZodRawShape>

export type CanvasToolName = keyof typeof canvasToolShapes
export const CANVAS_TOOL_NAMES = Object.keys(canvasToolShapes) as CanvasToolName[]

/** The parsed arguments of each tool. */
export type CanvasToolArgs = { [Name in CanvasToolName]: z.output<z.ZodObject<(typeof canvasToolShapes)[Name]>> }

/** Parses a tool's arguments: wrong types are refused, undeclared keys dropped. */
export function parseToolArgs<Name extends CanvasToolName>(name: Name, args: unknown): z.ZodSafeParseResult<CanvasToolArgs[Name]> {
  return z.object(canvasToolShapes[name]).safeParse(args) as z.ZodSafeParseResult<CanvasToolArgs[Name]>
}

export const canvasToolDescriptions: Record<CanvasToolName, string> = {
  list_nodes: 'List the Nodes on this Project\'s canvas: id, kind, title, position, size, hidden, locked.',
  create_card:
    'Create a Card: a folder for a self-contained HTML app. Returns its id, folder and index.html path; write the files there with Write. Placed next to your Session\'s Node unless x/y are given.',
  create_note: 'Create a text note on the canvas.',
  update_node: 'Change a Card\'s title or a note\'s text.',
  move_node: 'Move a Node to x/y (canvas units).',
  resize_node: 'Resize a Node.',
  hide_node: 'Hide a Node (hidden=false shows it again). Locked Nodes cannot be hidden. Nodes cannot be deleted.',
  link_card: 'Link a Card to an Epic ("<epic>") or a Ticket ("<epic>/<NN>"); remove=true unlinks.',
}

/** A Node as list_nodes reports it. */
export interface ListedNode {
  id: string
  kind: string
  title: string | null
  x: number
  y: number
  w: number
  h: number
  hidden: boolean
  locked: boolean
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w + PLACEMENT_GAP && b.x < a.x + a.w + PLACEMENT_GAP && a.y < b.y + b.h + PLACEMENT_GAP && b.y < a.y + a.h + PLACEMENT_GAP

/**
 * Where a new Node of size w×h goes when the agent gives no place: to the right of `anchor` (the
 * calling Session's Node), going down until it overlaps nothing; without an anchor, to the right
 * of everything visible. `others` are the visible Nodes.
 */
export function placeNear(others: readonly Rect[], anchor: Rect | null, w: number, h: number): { x: number; y: number } {
  if (anchor === null) {
    if (others.length === 0) return { x: 0, y: 0 }
    const right = Math.max(...others.map((node) => node.x + node.w))
    const top = Math.min(...others.map((node) => node.y))
    return { x: right + PLACEMENT_GAP, y: top }
  }
  const x = anchor.x + anchor.w + PLACEMENT_GAP
  for (let step = 0; step < 50; step += 1) {
    const candidate = { x, y: anchor.y + step * (h + PLACEMENT_GAP), w, h }
    if (!others.some((node) => overlaps(candidate, node))) return { x: candidate.x, y: candidate.y }
  }
  return { x, y: anchor.y }
}
