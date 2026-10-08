// The `shell` domain: handing a file or an address to macOS. Handled in src/main/ipc/shell.ts
// (ADR-0006). Both channels refuse rather than guess: a path outside the Project and an address
// that is not https:// come back as {ok:false} with the reason.
import { z } from 'zod'
import { invokeChannel } from './channels'

/**
 * Opens a file of a Project in the app macOS assigns to it (a Ticket in the default editor).
 * `path` is absolute or relative to the Project root. After symlinks are resolved it must lie
 * inside the Project root or one of its git worktrees; anything else is refused.
 */
export const shellOpenInEditor = invokeChannel(
  'shell.openInEditor',
  z.object({ projectId: z.string().min(1), path: z.string().min(1).max(4096) }),
  /** The real path that was opened. */
  z.object({ path: z.string() }),
  'desktop',
)

/** Opens an https:// address in the default browser; any other scheme is refused. */
export const shellOpenExternal = invokeChannel('shell.openExternal', z.object({ url: z.string().min(1).max(8192) }), z.object({ url: z.string() }), 'desktop')

declare module './channels' {
  interface IpcContract {
    'shell.openInEditor': typeof shellOpenInEditor
    'shell.openExternal': typeof shellOpenExternal
  }
}
