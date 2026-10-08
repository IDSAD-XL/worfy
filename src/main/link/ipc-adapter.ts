// IPC over a link connection (ADR-0052, point 5): the same handlers the windows use, registered by
// registerIpc on an IpcMainLike that is not Electron's ipcMain. A call frame {id, channel, input}
// is answered with the handler's IpcResult — {ok, value} or {ok:false, error} — as a window gets it.
//
// Trust: registerIpc's wrap() accepts a call only when isTrustedSender(event.senderFrame.url)
// holds. A network call has no frame, so the event this adapter builds carries the URL
// `worfy-link://<machineId>`, and the adapter registers with an isTrustedSender of its own that
// passes only a Machine on the list of Linked machines (option (a) of worfy-link ticket 01: the
// windows' check stays as it is; the token check before the handshake is what put the Machine id
// there).
//
// Access (worfy-link ticket 08; ADR-0052, point 6). Every channel carries an access mark
// (src/shared/ipc/channels.ts). Only `link` and `project` channels are registered here at all;
// `desktop`, `local` and any name the adapter does not know answer {ok:false} "not open to Linked
// machines" before the input is parsed, and no handler runs. `project` channels answer only while
// "Linked machines can work with my Projects" is on; while it is off every call but a `link` one is
// refused with "access is off".
//
// Who calls. Each connection has a LinkPeer with two clients without a window (src/main/clients.ts):
// - `link` — the sender of `link` calls, always there; it hears `link` events only;
// - `project` — the sender of `project` calls, made when access is switched on and added to main's
//   clients, so the broadcasts of `project` events reach the Linked machine; switching access off
//   destroys it, and every hub, Terminal and Session that held it lets go (its `destroyed`). A call
//   already running finishes; the next one is refused. The connection itself stays.
// A client sends on only the events of its own mark, looked up by name; a name no loaded module
// declares is not sent. So `view.changed`, `notify.open`, `limits.changed` or `link.changed` never
// leave over the connection, whoever broadcasts them.
import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { accessOf, IPC_CHANNEL_PREFIX, LINKED_MACHINE_ACCESS, type ChannelAccess, type InvokeChannel, type IpcResult } from '../../shared/ipc/channels'
import type { Client } from '../clients'
import { registerIpc, type IpcMainLike, type ModuleLoader } from '../ipc/index'

export const LINK_FRAME_SCHEME = 'worfy-link:'

/** The frame URL of a call from Machine `machineId`. */
export const linkFrameUrl = (machineId: string): string => `worfy-link://${machineId}`

/** What `link.ping` answers about this Machine. */
export interface LocalMachine {
  id: string
  name: string
  protocol: number
  build: string
}

/** The refusal of a channel a Linked machine may never call (ticket 01's text). */
export const notOpenRefusal = (channel: string): string => `${channel}: not open to Linked machines`

/** The refusal of every call but a `link` one while access is off. */
export const accessOffRefusal = (machineName: string): string => `Linked machines cannot work with the Projects of ${machineName}: access is off`

/**
 * The ids of link clients follow the rule for clients without a window (src/main/clients.ts):
 * "link:<machineId>/<n>", n counting up in this process, so a client made after another one —
 * access switched on again, a second connection — never takes an old id over.
 */
let nextClientNumber = 1

/** Which Machine answers for a link sender: one process may run several link services (tests). */
const localMachines = new WeakMap<object, () => LocalMachine>()

/** This Machine as seen by the handler of a call: set for link senders, undefined for windows. */
export function localMachineOf(event: { sender?: unknown }): LocalMachine | undefined {
  const sender = event.sender
  if (typeof sender !== 'object' || sender === null) return undefined
  return localMachines.get(sender)?.()
}

/**
 * The `event.sender` of a call over the link: what handlers take from a window's webContents —
 * `send`, `id`, `isDestroyed()` and the 'destroyed' event. `send` pushes an IPC event frame to
 * the Linked machine, for events of the sender's own mark only.
 */
export class LinkSender extends EventEmitter implements Client {
  readonly id: string
  private destroyed = false

  constructor(
    readonly machineId: string,
    /** The mark of the events this sender passes on: `link` or `project`. */
    readonly hears: ChannelAccess,
    private readonly push: (channel: string, payload: unknown) => void,
    local: () => LocalMachine,
  ) {
    super()
    this.id = `link:${machineId}/${nextClientNumber++}`
    localMachines.set(this, local)
  }

  send(channel: string, ...args: unknown[]): void {
    if (this.destroyed) return
    const name = channel.startsWith(IPC_CHANNEL_PREFIX) ? channel.slice(IPC_CHANNEL_PREFIX.length) : channel
    // Unknown names are closed: only a channel declared with this sender's mark goes out.
    if (accessOf(name) !== this.hears) return
    this.push(name, args[0])
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  /** The connection closed or access went off: subscribers holding this sender let go of it. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('destroyed')
  }
}

export interface LinkPeerOptions {
  /** The Linked machine on the other end. */
  machineId: string
  /** Its id and name for the log, as the service names a Machine. */
  describe: () => string
  /** Sends an IPC event frame over the connection. */
  push: (channel: string, payload: unknown) => void
  local: () => LocalMachine
  /** Adds the `project` client to main's clients (src/main/broadcast.ts); none in tests that do not need broadcasts. */
  addClient?: (client: Client) => void
  warn: (message: string) => void
}

/** The clients of one connection: its `link` sender, and its `project` client while access is on. */
export class LinkPeer {
  readonly link: LinkSender
  private project: LinkSender | null = null
  private closed = false

  constructor(private readonly options: LinkPeerOptions) {
    this.link = new LinkSender(options.machineId, 'link', options.push, options.local)
  }

  get machineId(): string {
    return this.options.machineId
  }

  /** The `project` client; null while access is off. */
  get projectClient(): LinkSender | null {
    return this.project
  }

  /** Follows the access switch: on makes a fresh `project` client, off destroys it. */
  setAccess(on: boolean): void {
    if (this.closed) return
    if (!on) {
      this.dropProject()
      return
    }
    if (this.project !== null) return
    const client = new LinkSender(this.options.machineId, 'project', this.options.push, this.options.local)
    this.project = client
    try {
      this.options.addClient?.(client)
    } catch (error) {
      this.options.warn(`[link] the connection of Machine ${this.options.describe()} could not join main's clients: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** The connection closed: both clients go. */
  close(): void {
    this.closed = true
    this.dropProject()
    this.link.destroy()
  }

  private dropProject(): void {
    const project = this.project
    this.project = null
    project?.destroy()
  }

  /** Logs a refused call with the channel and the Machine; never the input. */
  refused(channel: string, why: string): void {
    // The name comes from the network: quoted and cut, so it cannot forge a line of the log.
    this.options.warn(`[link] ${JSON.stringify(channel.slice(0, 120))} from Machine ${this.options.describe()} refused: ${why}`)
  }
}

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/** An IpcMainLike that keeps the wrapped handlers and answers call frames with them. */
export class LinkIpcAdapter implements IpcMainLike {
  private readonly listeners = new Map<string, { listener: Listener; access: ChannelAccess }>()

  handle(channel: string, listener: Listener, definition: InvokeChannel): void {
    this.listeners.set(channel, { listener, access: definition.access })
  }

  /** The channel names registered here, for tests. */
  channels(): string[] {
    return [...this.listeners.keys()].map((channel) => channel.slice(IPC_CHANNEL_PREFIX.length))
  }

  /**
   * Answers one call from `peer`'s Machine. A `link` channel runs always; anything else needs
   * access on (else "access is off"), then a registered `project` channel (else "not open").
   */
  async call(peer: LinkPeer, channel: string, input: unknown, machineName: string): Promise<IpcResult<unknown>> {
    const entry = this.listeners.get(IPC_CHANNEL_PREFIX + channel)
    let sender: LinkSender | null
    if (entry?.access === 'link') {
      sender = peer.link
    } else {
      sender = peer.projectClient
      if (sender === null) {
        peer.refused(channel, 'access is off')
        return { ok: false, error: accessOffRefusal(machineName) }
      }
      if (entry?.access !== 'project') {
        peer.refused(channel, 'not open to Linked machines')
        return { ok: false, error: notOpenRefusal(channel) }
      }
    }
    const event = { senderFrame: { url: linkFrameUrl(peer.machineId) }, sender } as unknown as IpcMainInvokeEvent
    return (await entry.listener(event, input)) as IpcResult<unknown>
  }
}

/**
 * Registers the IPC handlers of `link` and `project` channels on a fresh adapter. `isLinked`
 * decides trust: only a frame URL `worfy-link://<id>` of a Machine that is linked right now passes.
 */
export async function createLinkIpc(options: { modules?: Record<string, ModuleLoader>; isLinked: (machineId: string) => boolean }): Promise<LinkIpcAdapter> {
  const adapter = new LinkIpcAdapter()
  await registerIpc(adapter, {
    ...(options.modules === undefined ? {} : { modules: options.modules }),
    channels: (channel) => LINKED_MACHINE_ACCESS.includes(channel.access),
    isTrustedSender: (url) => {
      if (!URL.canParse(url)) return false
      const parsed = new URL(url)
      return parsed.protocol === LINK_FRAME_SCHEME && parsed.pathname === '' && options.isLinked(parsed.hostname)
    },
  })
  return adapter
}
