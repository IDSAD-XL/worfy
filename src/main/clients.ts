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

/**
 * A client that may report the documents its main frame commits: a window's webContents does, a
 * client without a window has no `on`. Electron emits 'did-navigate' for the main frame only, and
 * never for a navigation inside the document ('did-navigate-in-page'). 'did-fail-load' is typed as
 * Electron 44's webContents emits it; the frame ids after `isMainFrame` are not used.
 */
export type NavigatingClient = Client & {
  on?(event: 'did-navigate', listener: () => void): unknown
  on?(event: 'did-fail-load', listener: (event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => void): unknown
}

/** Chromium's net::ERR_ABORTED: the load stopped and no error page replaced the document. */
const ERR_ABORTED = -3

/**
 * Calls `reset` each time a new document commits in the main frame of `client` (View ▸ Reload, a
 * dev server reload, another page): what main keeps for the old page is then stale. A reload keeps
 * the webContents, so `destroyed` does not fire, and the old page's cleanup does not reach main.
 *
 * The reset waits for the commit, not the start of the navigation: a navigation that never commits
 * (a URL main refuses in 'will-frame-navigate', src/main/window.ts; a 204; a download) leaves the
 * old page up, and it keeps what main holds for it. Those end in no 'did-fail-load' or in one with
 * ERR_ABORTED. A load of the main frame that fails otherwise commits an error page (View ▸ Reload
 * with the dev server down: ERR_CONNECTION_REFUSED), and Electron reports it with 'did-fail-load'
 * and no 'did-navigate': the old page is gone then too. A call the old page sends during a reload
 * arrives before the commit, so the commit clears it too. Nothing happens for a client without a
 * window. Call it once per client object: each call adds listeners. `reset` may run twice for one
 * navigation and must not mind.
 */
export function onNewDocument(client: Pick<NavigatingClient, 'on'>, reset: () => void): void {
  client.on?.('did-navigate', () => reset())
  client.on?.('did-fail-load', (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== ERR_ABORTED) reset()
  })
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

/**
 * Which client object holds each id in one hub. A client without a window may come back under the
 * id of an old one whose `destroyed` has not arrived yet (the old connection is closed, its event is
 * on the way); the old one's late `destroyed` must not end the new one's subscriptions.
 *
 * `leave(id)` ends every subscription the hub keeps under an id. It runs on the holder's own
 * `destroyed`, and when another client object takes the id over: what is under the id then belongs
 * to the old object. Call `hold` before subscribing; `leave` must remove the subscriptions before it
 * returns (closing them may finish later). A window's webContents id is never reused, so a window
 * is held from its first subscription to its `destroyed`, with one listener.
 */
export class ClientHolders {
  private readonly holders = new Map<ClientId, Pick<Client, 'id' | 'once' | 'isDestroyed'>>()

  constructor(private readonly leave: (id: ClientId) => void) {}

  /**
   * Makes `client` the holder of its id, once per client object. False for a client already
   * destroyed — a late call of an old client must not take the id back from a new one — and then
   * the caller does not subscribe it.
   */
  hold(client: Pick<Client, 'id' | 'once' | 'isDestroyed'>): boolean {
    if (client.isDestroyed()) return false
    const id = client.id
    const held = this.holders.get(id)
    if (held === client) return true
    if (held !== undefined) this.leave(id)
    this.holders.set(id, client)
    client.once('destroyed', () => {
      if (this.holders.get(id) !== client) return
      this.holders.delete(id)
      this.leave(id)
    })
    return true
  }

  /** The ids held now. */
  ids(): ClientId[] {
    return [...this.holders.keys()]
  }
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
