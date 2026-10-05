// The Layout of a Project's Canvas (CONTEXT.md, «Раскладка»): its Nodes and the viewport.
// main is its only writer (ADR-0003): the renderer and, later, the MCP tools send the operations
// below, main checks them with these schemas, applies them and saves layout.json
// (src/main/layout/store.ts).
import { z } from 'zod'

/** The zoom range of the Canvas. */
export const ZOOM_MIN = 0.2
export const ZOOM_MAX = 2.5

/**
 * Coordinates and sizes are canvas units, except for a pinned Node: while `pinned` is true, its x, y,
 * w and h are pixels of the Canvas on the screen (see the `pin` operation). The bound only keeps
 * garbage out of the file.
 */
const COORDINATE_LIMIT = 10_000_000
const coordinate = z.number().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT)
const size = z.number().positive().max(COORDINATE_LIMIT)

export const nodeIdSchema = z.string().min(1).max(200)
/**
 * Any string is accepted here, not only the kinds the renderer knows: a Node of a kind this build
 * does not have (written by a newer worfy, or by a tool) stays in the Layout and is shown as a
 * placeholder.
 */
export const nodeKindSchema = z.string().min(1).max(100)
/** Whatever the Node's kind keeps about itself, as a JSON object. */
export const nodeDataSchema = z.record(z.string(), z.unknown())

/** The longest tag a `tag` operation accepts, and how many tags one operation may name. */
export const TAG_LENGTH_MAX = 40
const TAGS_PER_OP_MAX = 50
/** A free-form tag of a Node: trimmed, not empty. */
export const tagSchema = z.string().trim().min(1).max(TAG_LENGTH_MAX)

export const layoutNodeSchema = z.object({
  id: nodeIdSchema,
  kind: nodeKindSchema,
  x: coordinate,
  y: coordinate,
  w: size,
  h: size,
  hidden: z.boolean().default(false),
  /** The Node cannot be removed; it can still be moved and resized. */
  locked: z.boolean().default(false),
  /**
   * The Node stays at its place on the screen while the Canvas pans and zooms (UI: ticket 29).
   * While it is true, x and y are screen coordinates of the Canvas and w and h its size on the
   * screen, not canvas units; they change only with the `pin` operation (main refuses `move` and
   * `resize`). A reader that wants the Node's place on the plane converts through the viewport.
   */
  pinned: z.boolean().default(false),
  tags: z.array(z.string().min(1)).default([]),
  data: nodeDataSchema.default({}),
})
export type LayoutNode = z.output<typeof layoutNodeSchema>

export const viewportSchema = z.object({
  x: coordinate,
  y: coordinate,
  zoom: z.number().min(ZOOM_MIN).max(ZOOM_MAX),
})
export type Viewport = z.output<typeof viewportSchema>

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

/** The content of `<Project data folder>/layout.json`. */
export const layoutSchema = z
  .object({
    nodes: z.array(layoutNodeSchema),
    viewport: viewportSchema.default(DEFAULT_VIEWPORT),
  })
  .superRefine((layout, context) => {
    const seen = new Set<string>()
    for (const [index, node] of layout.nodes.entries()) {
      if (seen.has(node.id)) context.addIssue({ code: 'custom', path: ['nodes', index, 'id'], message: `duplicate Node id ${node.id}` })
      seen.add(node.id)
    }
  })
export type Layout = z.output<typeof layoutSchema>

export const EMPTY_LAYOUT: Layout = { nodes: [], viewport: DEFAULT_VIEWPORT }

/** The operations that change a Layout. Each names one Node, except setViewport. */
export const layoutOpSchema = z.discriminatedUnion('op', [
  /** Adds a Node; main makes up the id when there is none. A taken id is refused. */
  z.object({ op: z.literal('create'), node: layoutNodeSchema.extend({ id: nodeIdSchema.optional() }) }),
  /** Refused for a pinned Node: its x and y are screen pixels and change only with `pin`. */
  z.object({ op: z.literal('move'), id: nodeIdSchema, x: coordinate, y: coordinate }),
  /**
   * Resizing from a left or top edge moves the Node too, so the position may come along. Refused
   * for a pinned Node, like `move`.
   */
  z.object({ op: z.literal('resize'), id: nodeIdSchema, w: size, h: size, x: coordinate.optional(), y: coordinate.optional() }),
  z.object({ op: z.literal('hide'), id: nodeIdSchema, hidden: z.boolean() }),
  /** Refused for a locked Node. */
  z.object({ op: z.literal('remove'), id: nodeIdSchema }),
  /** Merges the given keys into the Node's data, one level deep. */
  z.object({ op: z.literal('patchData'), id: nodeIdSchema, data: nodeDataSchema }),
  z.object({ op: z.literal('setViewport'), viewport: viewportSchema }),
  /**
   * Pins the Node to the screen or puts it back on the plane. The position and size come along:
   * while a Node is pinned, its x and y are screen coordinates of the Canvas (pixels from the
   * Canvas's top-left corner) and w and h its size on the screen, not canvas units; the caller
   * converts through the viewport (src/renderer/canvas/pinning.ts).
   */
  z.object({ op: z.literal('pin'), id: nodeIdSchema, pinned: z.boolean(), x: coordinate, y: coordinate, w: size, h: size }),
  /** Adds and removes tags of one Node; a tag both added and removed ends up removed. */
  z.object({ op: z.literal('tag'), id: nodeIdSchema, add: z.array(tagSchema).max(TAGS_PER_OP_MAX).default([]), remove: z.array(tagSchema).max(TAGS_PER_OP_MAX).default([]) }),
])
/** An operation as a caller writes it (defaults may be left out). */
export type LayoutOpInput = z.input<typeof layoutOpSchema>
/** An operation after parsing. */
export type LayoutOp = z.output<typeof layoutOpSchema>

/** A Project's Layout as main sends it. */
export const layoutStateSchema = z.object({
  projectId: z.string().min(1),
  layout: layoutSchema,
  /** Grows with every change of this Project's Layout in main; a client keeps the highest. */
  revision: z.number().int().nonnegative(),
})
export type LayoutState = z.output<typeof layoutStateSchema>
