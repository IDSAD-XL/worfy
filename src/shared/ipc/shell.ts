// The `shell` domain: handing a file or an address to macOS. Handled in src/main/ipc/shell.ts
// (ADR-0006). Both channels refuse rather than guess: a path outside the Project and an address
// that is not https:// come back as {ok:false} with the reason.
import { z } from 'zod'
import { invokeChannel } from './channels'

/** The file manager a file was shown in, by its system: Finder, Explorer, any other. */
export const revealedIn = z.enum(['darwin', 'win32', 'other'])
export type RevealPlatform = z.infer<typeof revealedIn>

/**
 * Opens a file of a Project in the app macOS assigns to it (a Ticket in the default editor).
 * `path` is absolute or relative to the Project root. After symlinks are resolved it must lie
 * inside the Project root, one of its git worktrees, or — for a Ticket of a Silent Project — its
 * Workflow folder or Tickets root, the places `tickets.read` reads from; anything else is refused. `desktop`: the
 * file lies on the Project's Machine, so a window on a Linked machine does not call it and shows
 * "File is on <Machine>" instead (src/renderer/machines/useFileElsewhere.ts).
 *
 * A document — a regular file whose extension is on the short list of src/main/ipc/shell.ts (text,
 * markdown, data formats, images, PDF) — is opened at once. For anything else — an `.app` or other
 * folder, a `.command`, a `.term`, an `.exe`, a file without an extension — main first asks in a
 * message box: "Open", "Show in Finder" or "Cancel", Cancel the default (worfy-polish ticket 35; the
 * owner's decision on PR #692). A link in a document of the Project is written by agents and other
 * people, and one click on it must not start a program unasked. `outcome` says what happened.
 */
export const shellOpenInEditor = invokeChannel(
  'shell.openInEditor',
  z.object({ projectId: z.string().min(1), path: z.string().min(1).max(4096) }),
  z.object({
    /** The real path of the file. */
    path: z.string(),
    /** Opened (a document, or "Open" in the box), shown in the file manager, or left alone. */
    outcome: z.enum(['opened', 'revealed', 'cancelled']),
    /** Present when the file was shown in the file manager: the system's. */
    revealedIn: revealedIn.optional(),
  }),
  'desktop',
)

/**
 * Opens an https:// address in the default browser; any other scheme is refused. `local`: a link
 * opens on the Machine where it was clicked (worfy-link ticket 12; ADR-0053), so a window on a
 * Linked machine calls its own main, and no Linked machine opens an address on this one.
 */
export const shellOpenExternal = invokeChannel('shell.openExternal', z.object({ url: z.string().min(1).max(8192) }), z.object({ url: z.string() }), 'local')

declare module './channels' {
  interface IpcContract {
    'shell.openInEditor': typeof shellOpenInEditor
    'shell.openExternal': typeof shellOpenExternal
  }
}
