// The note of a clicked notification that waits for its window's renderer (ticket 21). A click
// when no worfy window is open creates one (src/main/notify.ts); an event sent to it right away
// would arrive before its renderer subscribes, so main keeps the note here and the renderer takes
// it with `notify.pending` (src/main/ipc/notify.ts) once it can open a Session. A note not taken
// in PENDING_OPEN_MS is dropped, so a much later reload does not open a Session out of the blue.
import type { NotifyOpen } from '../shared/ipc/notify'

export const PENDING_OPEN_MS = 30_000

export class PendingOpens {
  /** The latest note of each window, by its webContents id. */
  private readonly notes = new Map<number, { note: NotifyOpen; at: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Keeps `note` for the window; a later click replaces an earlier one. */
  hold(webContentsId: number, note: NotifyOpen): void {
    this.notes.set(webContentsId, { note: { sessionId: note.sessionId, projectRoot: note.projectRoot }, at: this.now() })
  }

  /** The window's note, once: null when there is none or it is older than PENDING_OPEN_MS. */
  take(webContentsId: number): NotifyOpen | null {
    const held = this.notes.get(webContentsId)
    this.notes.delete(webContentsId)
    return held !== undefined && this.now() - held.at < PENDING_OPEN_MS ? held.note : null
  }

  /** Forgets the window's note: the window is gone. */
  drop(webContentsId: number): void {
    this.notes.delete(webContentsId)
  }
}

/** The app's notes; src/main/notify.ts holds them, src/main/ipc/notify.ts hands them out. */
export const pendingOpens = new PendingOpens()
