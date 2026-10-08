// The clients of main (ADR-0053): who hears main's events and whose subscriptions the hubs keep.
// A client is a window's webContents, or a client without a window that main adds itself (the
// connection of a Linked machine, worfy-link ticket 08). Every window is a client by being open:
// the registry lists the windows anew on each use and does not track their creation.
//
// Ids. A window keeps its webContents id, a positive number. Autopilot's own workflow subscribers
// count down from -1 (src/main/ipc/autopilot.ts); main's own docs subscriber is 'main'
// (src/main/ipc/docs.ts). A client without a window takes a string "<kind>:<name>", e.g.
// "link:<connection>": never a number and never 'main', so no hub can mix it up with the others.
//
// Nothing here reaches Electron at run time: the hubs import this module in tests without a mocked
// `electron`. The windows come in through the registry's `windows` function (src/main/broadcast.ts).

/** A client's id: a window's webContents id, or the "<kind>:<name>" of a client without a window. */
export type ClientId = number | string

/** The part of a window's webContents main uses; a client without a window provides the same. */
export interface Client {
  readonly id: ClientId
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
}

/** The id rule of a client without a window: "<kind>:<name>", kind in lower case, no spaces. */
const WINDOWLESS_ID = /^[a-z][a-z0-9-]*:\S+$/

/** Whether `id` is a valid id of a client without a window. */
export function isWindowlessId(id: ClientId): id is string {
  return typeof id === 'string' && WINDOWLESS_ID.test(id)
}

/**
 * The client that made an IPC call: `event.sender`, a window's webContents in the app or a client
 * without a window whose calls main dispatches itself. Undefined when the event has no sender.
 */
export function clientOf(event: { readonly sender?: unknown }): Client | undefined {
  return (event.sender ?? undefined) as Client | undefined
}

/** The clients of the app: the open windows, then the clients without a window. */
export class ClientRegistry {
  private readonly windowless = new Map<string, Client>()

  /** `windows` lists the webContents of the live windows on each call. */
  constructor(private readonly windows: () => Iterable<Client>) {}

  /**
   * Adds a client without a window; it stays until it emits `destroyed`. A client already
   * destroyed is not added. Throws on an id outside the rule or the id of a live client.
   */
  add(client: Client): void {
    if (!isWindowlessId(client.id)) throw new Error(`a client without a window needs an id "<kind>:<name>", not ${JSON.stringify(client.id)}`)
    const id = client.id
    const present = this.windowless.get(id)
    if (present !== undefined && !present.isDestroyed()) throw new Error(`a client with id ${id} is already connected`)
    if (client.isDestroyed()) return
    this.windowless.set(id, client)
    client.once('destroyed', () => {
      if (this.windowless.get(id) === client) this.windowless.delete(id)
    })
  }

  /** Number of clients without a window the registry holds now, destroyed or not; for tests. */
  get held(): number {
    return this.windowless.size
  }

  /** Every live client now: the windows first, then the clients without a window. */
  list(): Client[] {
    const live = [...this.windows()]
    for (const client of this.windowless.values()) if (!client.isDestroyed()) live.push(client)
    return live
  }

  /** Sends one event to every live client; a client that fails does not stop the others. */
  broadcast(send: (client: Client) => void): void {
    for (const client of this.list()) {
      try {
        send(client)
      } catch (error) {
        console.warn(`[main] could not send to client ${String(client.id)}`, error)
      }
    }
  }
}
