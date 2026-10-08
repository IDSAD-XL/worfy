// The note of a clicked notification that waits for its client's renderer (ticket 21). A click
// when no worfy window is open creates one (src/main/notify.ts); an event sent to it right away
// would arrive before its renderer subscribes, so main keeps the note here and the renderer takes
// it with `notify.pending` (src/main/ipc/notify.ts) once it can open a Session. A note not taken
// in PENDING_OPEN_MS is dropped, so a much later reload does not open a Session out of the blue.
// Notes are kept by client id (src/main/clients.ts): a window's webContents id, or the id of a
// client without a window.
import type { NotifyOpen } from '../shared/ipc/notify'
import type { Client, ClientId } from './clients'

export const PENDING_OPEN_MS = 30_000

export class PendingOpens {
  /** The latest note of each client, by its id. */
  private readonly notes = new Map<ClientId, { note: NotifyOpen; at: number }>()
  /** Clients whose `destroyed` already drops their note. */
  private readonly watched = new Set<ClientId>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Keeps `note` for the client; a later click replaces an earlier one. */
  hold(clientId: ClientId, note: NotifyOpen): void {
    this.notes.set(clientId, { note: { sessionId: note.sessionId, projectRoot: note.projectRoot }, at: this.now() })
  }

  /** Keeps `note` for `client` and forgets it when the client is destroyed. */
  holdFor(client: Pick<Client, 'id' | 'once'>, note: NotifyOpen): void {
    const id = client.id
    this.hold(id, note)
    if (this.watched.has(id)) return
    this.watched.add(id)
    client.once('destroyed', () => {
      this.watched.delete(id)
      this.drop(id)
    })
  }

  /** The client's note, once: null when there is none or it is older than PENDING_OPEN_MS. */
  take(clientId: ClientId): NotifyOpen | null {
    const held = this.notes.get(clientId)
    this.notes.delete(clientId)
    return held !== undefined && this.now() - held.at < PENDING_OPEN_MS ? held.note : null
  }

  /** Forgets the client's note: the client is gone. */
  drop(clientId: ClientId): void {
    this.notes.delete(clientId)
  }
}

/** The app's notes; src/main/notify.ts holds them, src/main/ipc/notify.ts hands them out. */
export const pendingOpens = new PendingOpens()
