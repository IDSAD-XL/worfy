// The `tickets` domain: the text of one Ticket file, read-only (ADR-0002, ADR-0005). Handled in
// src/main/ipc/tickets.ts. The focused Ticket (src/renderer/canvas/nodes/TicketBody.tsx) shows it
// as markdown; the canvas card never reads it.
import { z } from 'zod'
import { invokeChannel } from './channels'

/**
 * An Epic name as it may appear in a path: one folder name, never `.` or `..`, no separator. The
 * Tickets root's folders are named so; anything else would leave the Epic's own folder.
 */
export const EPIC_NAME = /^(?!\.\.?$)[^/\\\0]+$/

/**
 * The text of a Ticket file, found the way the workflow reader finds it: in `<epic>/issues/` of
 * the Project's Tickets root (the Workflow folder's in Silent mode), by number and slug. After
 * symlinks are resolved the file must lie inside the Project root, its Tickets root or its
 * Workflow folder; a file over 1 MB is refused. `path` in the answer is the real file, absolute: the
 * renderer opens it in the editor. `relative` is the same file relative to the Project root, `/`
 * between the parts (`../workflow/.scratch/…` for a Silent Project's Workflow folder next to it), as
 * `docs.read` answers: the file's relative links resolve against its folder, and main resolves them
 * against the root (worfy-polish ticket 36: an absolute folder lost the leading `\\` of a UNC path).
 * Null when the file has no path relative to the root: another drive or share on Windows.
 * `project`, `read`: a window on a Linked machine reads the file on that Machine.
 */
export const ticketsRead = invokeChannel(
  'tickets.read',
  z.object({
    projectId: z.string().min(1),
    epic: z.string().min(1).max(255).regex(EPIC_NAME),
    num: z.number().int().nonnegative(),
    slug: z.string().max(1024),
  }),
  z.object({ path: z.string(), relative: z.string().nullable(), text: z.string() }),
  'project',
  'read',
)

declare module './channels' {
  interface IpcContract {
    'tickets.read': typeof ticketsRead
  }
}
