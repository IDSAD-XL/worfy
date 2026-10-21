// The `shell` domain: handing a file or an address to macOS. Handled in src/main/ipc/shell.ts
// (ADR-0006). Both channels refuse rather than guess: a path outside the Project and an address
// that is not https:// come back as {ok:false} with the reason.
import { z } from 'zod'
import { invokeChannel } from './channels'

/**
 * Opens a file of a Project in the app macOS assigns to it (a Ticket in the default editor).
 * `path` is absolute or relative to the Project root. After symlinks are resolved it must lie
 * inside the Project root or one of its git worktrees; anything else is refused. `desktop`: the
 * file lies on the Project's Machine, so a window on a Linked machine does not call it and shows
 * "File is on <Machine>" instead (src/renderer/machines/useFileElsewhere.ts).
 *
 * A file the system would run rather than open — an `.app` or other folder, a `.command`, an
 * `.exe`, a file with the execute bit — is never handed over: it is shown selected in the file
 * manager, and the answer names that file manager in `revealedIn` (worfy-polish ticket 35). A link
 * in a document of the Project is written by agents and other people, and one click on it must not
 * start a program.
 */
export const shellOpenInEditor = invokeChannel(
  'shell.openInEditor',
  z.object({ projectId: z.string().min(1), path: z.string().min(1).max(4096) }),
  z.object({
    /** The real path that was opened or shown. */
    path: z.string(),
    /** Present when the file was shown in the file manager instead of opened, which one. */
    revealedIn: z.enum(['Finder', 'Explorer', 'the file manager']).optional(),
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
