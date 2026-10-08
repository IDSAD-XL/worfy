// The id of this screen (worfy-link ticket 07, ADR-0053): one renderer, that is one window of worfy
// with a Canvas, here or on a Linked machine. It is made when the renderer loads and lives as long
// as the window.
//
// The Canvas's recorded gestures and their undo and redo send it with their operations
// (`layout.apply`, `trash.put`, `trash.restore`), and main hands it on in `layout.changed`, so the
// undo history (history.ts) tells this screen's changes from another screen's. It is not the id of
// a client in main's registry (src/main/clients.ts): the registry tells connections apart, and every
// window of a Linked machine reaches the Project's machine through one connection. An id carried in
// the call's data survives any forwarding.

const id: string = crypto.randomUUID()

/** This screen's id. */
export function screenId(): string {
  return id
}
