// The `layout` domain: a Project's Canvas Layout, written only by main (ADR-0003).
// Handled in src/main/ipc/layout.ts (ADR-0006).
import { z } from 'zod'
import { archiveBatchSchema, archiveRuleSchema, layoutOpSchema, layoutStateSchema, nodeIdSchema } from '../layout/types'
import { eventChannel, invokeChannel } from './channels'

const projectId = z.string().min(1)

/**
 * The screen a change comes from (src/renderer/canvas/screen.ts): a window of worfy with a Canvas,
 * here or on a Linked machine. Only the Canvas's recorded gestures and their undo and redo send
 * it; main, agents and the renderer's automatic writers change the Layout without one.
 */
export const screenIdSchema = z.string().min(1).max(100)

export const layoutGet = invokeChannel('layout.get', z.object({ projectId }), layoutStateSchema, 'project', 'read')

/**
 * Applies one operation and answers with the Layout after it. A refused operation (a locked Node
 * to remove, an id that is not there) comes back as {ok:false} with the reason. An `archive` takes
 * only the Nodes the archive rule may take at the write: not kept, not pinned, not live (ADR-0076).
 */
export const layoutApply = invokeChannel('layout.apply', z.object({ projectId, op: layoutOpSchema, screen: screenIdSchema.optional() }), layoutStateSchema, 'project', 'write')

/** A Session Node the automatic archive takes, its Session, and the rule that takes it (ADR-0076). */
export const archiveCandidateSchema = z.object({ id: nodeIdSchema, sessionId: z.string().min(1), rule: archiveRuleSchema })
export type ArchiveCandidate = z.output<typeof archiveCandidateSchema>

/**
 * The Session Nodes «Archive finished sessions now» takes (worfy-canvas ticket 08, ADR-0076,
 * point 9): main's archive rule with the threshold of Settings → Canvas, 24 h under «Never». A read:
 * the screen sends the `archive` itself through `layout.apply`, as one step of its undo history, and
 * main drops there whatever the rule no longer takes (src/main/layout/archive.ts, archiveFromScreen).
 */
export const layoutArchiveCandidates = invokeChannel('layout.archiveCandidates', z.object({ projectId }), z.array(archiveCandidateSchema), 'project', 'read')

/**
 * The Undo of a toast «Archived N finished sessions» (worfy-canvas ticket 10, ADR-0076, point 8):
 * main brings back the Nodes of this batch of its timer that are still archived, without a screen,
 * so it is no step of any screen's ⌘Z. A Node the user restored since, or that left the batch, is
 * not touched. A batch with nothing left changes nothing. A write: a read-only screen has no Undo.
 */
export const layoutRestoreBatch = invokeChannel('layout.restoreBatch', z.object({ projectId, batch: archiveBatchSchema }), layoutStateSchema, 'project', 'write')

/** One batch of main's archive timer: the Project, the batch id and how many Session Nodes it took. */
export const archiveBatchEventSchema = z.object({ projectId, batch: archiveBatchSchema, count: z.number().int().positive() })
export type ArchiveBatchEvent = z.output<typeof archiveBatchEventSchema>

/**
 * Sent to every window after each batch of main's archive timer (src/main/layout/archive.ts); the
 * windows of the Project show the toast with Undo (src/renderer/canvas/overlays/ArchiveToast.tsx).
 * A screen's own `archive` («Archive finished sessions now», a redo) sends none: it is a step of ⌘Z.
 */
export const layoutArchived = eventChannel('layout.archived', archiveBatchEventSchema, 'project', 'read')

/**
 * One change of a Project's Layout as every window hears of it: the Layout after it, the operation
 * that made it and the screen that sent the operation, null when it came without one (main, an
 * agent, an automatic writer). The undo history uses the last two (worfy-link ticket 07).
 */
export const layoutChangeSchema = layoutStateSchema.extend({ screen: screenIdSchema.nullable(), op: layoutOpSchema })
export type LayoutChangeEvent = z.output<typeof layoutChangeSchema>

/** Sent to every window after any change of any Project's Layout, whoever made it. */
export const layoutChanged = eventChannel('layout.changed', layoutChangeSchema, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'layout.get': typeof layoutGet
    'layout.apply': typeof layoutApply
    'layout.archiveCandidates': typeof layoutArchiveCandidates
    'layout.restoreBatch': typeof layoutRestoreBatch
    'layout.archived': typeof layoutArchived
    'layout.changed': typeof layoutChanged
  }
}
