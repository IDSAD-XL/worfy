// The Layout of a Project's Canvas (CONTEXT.md, "Layout"): its Nodes. The camera of the Canvas
// is not part of it: each screen keeps its own (src/main/layout/viewports.ts, worfy-link ticket 06);
// the `viewport` left in layout.json is only read, as the camera of a first opening.
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
/** How many Nodes one `moveMany` may move. */
const MOVES_PER_OP_MAX = 5000
/** How many Nodes one `archive` or `restore` may name. */
const ARCHIVE_PER_OP_MAX = 5000
/** A free-form tag of a Node: trimmed, not empty. */
export const tagSchema = z.string().trim().min(1).max(TAG_LENGTH_MAX)

/** Which rule archived a Node (ADR-0076, point 1): idle past the threshold, or its Ticket done. */
export const archiveRuleSchema = z.enum(['idle', 'ticket-done'])
export type ArchiveRule = z.output<typeof archiveRuleSchema>

/** One batch of the automatic archive: the Nodes one run archived together, undone together (ticket 10). */
export const archiveBatchSchema = z.string().min(1).max(100)

/** How a Node was archived: when, by which rule, in which batch. */
export const archiveRecordSchema = z.object({ at: z.number().nonnegative(), rule: archiveRuleSchema, batch: archiveBatchSchema })
export type ArchiveRecord = z.output<typeof archiveRecordSchema>

/** True when the automatic archive took the Node off the Canvas. */
export const isArchived = (node: { archived?: ArchiveRecord | null | undefined }): boolean => node.archived != null

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
  /**
   * Set when the automatic archive took the Node off the Canvas (ADR-0076): an archived Node keeps
   * its place but is not on the plane (derived.ts, onThePlane), so the Canvas does not draw it and
   * nothing keeps clear of it. Not `hidden`: what the user hid and what the archive took are told
   * apart. Absent or null — not archived; a layout.json written before it reads as not archived.
   */
  archived: archiveRecordSchema.nullable().optional(),
  /** The user asked the automatic archive to leave this Node alone (Keep, ADR-0076). Absent — false. */
  keep: z.boolean().optional(),
  /**
   * When the user last worked with the Node, in ms since the epoch: main sets it on the user's
   * operations and on `touch` (store.ts). The automatic archive leaves a recently touched Node. Absent or null — never.
   */
  touchedAt: z.number().nonnegative().nullable().optional(),
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
    /**
     * The camera the Canvas was saved with before each screen kept its own (worfy-link ticket 06).
     * Read only, as the camera of a screen that has none of its own yet; no operation changes it,
     * so a file keeps the value it had.
     */
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

/** The operations that change a Layout. Each names one Node, except moveMany. */
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
  /**
   * Pins the Node to the screen or puts it back on the plane. The position and size come along:
   * while a Node is pinned, its x and y are screen coordinates of the Canvas (pixels from the
   * Canvas's top-left corner) and w and h its size on the screen, not canvas units; the caller
   * converts through the viewport (src/renderer/canvas/pinning.ts).
   */
  z.object({ op: z.literal('pin'), id: nodeIdSchema, pinned: z.boolean(), x: coordinate, y: coordinate, w: size, h: size }),
  /** Adds and removes tags of one Node; a tag both added and removed ends up removed. */
  z.object({ op: z.literal('tag'), id: nodeIdSchema, add: z.array(tagSchema).max(TAGS_PER_OP_MAX).default([]), remove: z.array(tagSchema).max(TAGS_PER_OP_MAX).default([]) }),
  /**
   * Moves several Nodes at once, as one drag of a selection does (ADR-0038): main checks the group
   * as a whole and shifts all of it when it lands on a Node outside it, so the Nodes keep their
   * places to each other. Refused, like `move`, when one of them is pinned; each Node once.
   */
  z.object({
    op: z.literal('moveMany'),
    moves: z
      .array(z.object({ id: nodeIdSchema, x: coordinate, y: coordinate }))
      .min(1)
      .max(MOVES_PER_OP_MAX)
      .refine((moves) => new Set(moves.map((move) => move.id)).size === moves.length, 'each Node may be moved once'),
  }),
  /**
   * Takes Nodes off the Canvas into the archive, each with the rule that took it, as one batch
   * (ADR-0076). Sent by main's automatic archive (src/main/layout/archive.ts), without a screen, so
   * no screen's undo history records it (ADR-0016), and by the undo of a user's Restore
   * (src/renderer/canvas/history.ts). A Node already archived keeps its record.
   */
  z.object({
    op: z.literal('archive'),
    batch: archiveBatchSchema,
    nodes: z
      // `at` — when the Node was archived the first time: the undo of a Restore sends it, so the
      // Node keeps its place in the archive's list (worfy-canvas 09). Absent — now.
      .array(z.object({ id: nodeIdSchema, rule: archiveRuleSchema, at: z.number().nonnegative().optional() }))
      .min(1)
      .max(ARCHIVE_PER_OP_MAX)
      .refine((nodes) => new Set(nodes.map((node) => node.id)).size === nodes.length, 'each Node may be archived once'),
  }),
  /**
   * Brings archived Nodes back onto the Canvas: at their old place when it is clear, else at the
   * nearest clear one (ADR-0038). A Node that is not archived is left as it is.
   */
  z.object({
    op: z.literal('restore'),
    ids: z
      .array(nodeIdSchema)
      .min(1)
      .max(ARCHIVE_PER_OP_MAX)
      .refine((ids) => new Set(ids).size === ids.length, 'each Node may be restored once'),
  }),
  /** Sets or clears the Node's Keep flag (ADR-0076): the automatic archive never takes it. */
  z.object({ op: z.literal('keep'), id: nodeIdSchema, keep: z.boolean() }),
  /** The user opened or otherwise worked with the Node: main sets its `touchedAt` to now. */
  z.object({ op: z.literal('touch'), id: nodeIdSchema }),
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
