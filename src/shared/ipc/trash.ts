// The `trash` domain (ticket 30): Nodes the user deleted from the Canvas, kept for TRASH_KEEP_MS in
// <Project data folder>/trash/<label>/ — worfy's own data folder, never the Project's repository
// (ADR-0005). A deleted Card moves there with its files and its data; every entry keeps the
// Node's Layout entry, so Restore puts the Node back where it was. Handled in src/main/ipc/trash.ts
// (ADR-0006), the files are moved by src/main/layout/trash.ts.
import { z } from 'zod'
import type { LayoutNode } from '../layout/types'
import { eventChannel, invokeChannel } from './channels'
import { screenIdSchema } from './layout'

/** How long a trash entry is kept; older ones are deleted when the app starts. */
export const TRASH_KEEP_MS = 3 * 24 * 60 * 60 * 1000

/**
 * The name of an entry's folder: the time it was deleted (milliseconds since the epoch) and eight
 * hex digits. The pattern keeps a label from naming any other folder (no separators, no dots).
 */
export const TRASH_LABEL_PATTERN = /^[0-9]{1,16}-[0-9a-f]{8}$/
export const trashLabelSchema = z.string().regex(TRASH_LABEL_PATTERN, 'a trash label is <milliseconds>-<8 hex digits>')

/** The kinds of Nodes the user may delete: Cards, notes, Terminals and Session Nodes. */
export const TRASHABLE_KINDS: readonly string[] = ['card', 'note', 'terminal', 'session']

/**
 * Why the user may not delete this Node, or null when they may. main asks the same question
 * before it moves anything (src/main/layout/trash.ts) and adds what only it knows: whether a
 * Session runs on the Node.
 */
export function trashRefusal(node: Pick<LayoutNode, 'id' | 'kind' | 'locked'>): string | null {
  if (node.locked) return `Node ${node.id} (${node.kind}) is locked and cannot be deleted`
  if (!TRASHABLE_KINDS.includes(node.kind)) return `Nodes of kind ${node.kind} cannot be deleted`
  return null
}

const projectId = z.string().min(1)
const nodeId = z.string().min(1).max(200)

/** One entry of a Project's trash, as the popover lists it. */
export const trashEntrySchema = z.object({
  label: trashLabelSchema,
  /** When the Node was deleted, in milliseconds since the epoch. */
  trashedAt: z.number().int().nonnegative(),
  nodeId,
  kind: z.string().min(1),
  /** What the popover calls it: a Card's <title>, the first line of a note; null when there is nothing to show. */
  title: z.string().nullable(),
  /** True when the entry holds a Card's files or data, not only the Node. */
  hasFiles: z.boolean(),
})
export type TrashEntry = z.output<typeof trashEntrySchema>

/**
 * Moves a Node to the trash: its Layout entry, and for a Card its files and data. Refused for a Node
 * the user may not delete. `screen` is the screen whose recorded gesture or undo this is
 * (src/shared/ipc/layout.ts screenIdSchema); the Layout change carries it in `layout.changed`.
 */
export const trashPut = invokeChannel('trash.put', z.object({ projectId, nodeId, screen: screenIdSchema.optional() }), trashEntrySchema)

/**
 * Puts an entry back: the Card's files and data, then the Node at its old place. Refused when its id
 * or Card id is taken again. `screen` as for trash.put.
 */
export const trashRestore = invokeChannel('trash.restore', z.object({ projectId, label: trashLabelSchema, screen: screenIdSchema.optional() }), trashEntrySchema)

/** The Project's trash, newest first. */
export const trashList = invokeChannel('trash.list', z.object({ projectId }), z.object({ entries: z.array(trashEntrySchema) }))

/** Sent to every window after a Project's trash changed. */
export const trashChanged = eventChannel('trash.changed', z.object({ projectId }))

declare module './channels' {
  interface IpcContract {
    'trash.put': typeof trashPut
    'trash.restore': typeof trashRestore
    'trash.list': typeof trashList
    'trash.changed': typeof trashChanged
  }
}
