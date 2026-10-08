// IPC over a link connection (ADR-0052, point 5): the same handlers the windows use, registered by
// registerIpc on an IpcMainLike that is not Electron's ipcMain. A call frame {id, channel, input}
// is answered with the handler's IpcResult — {ok, value} or {ok:false, error} — as a window gets it.
//
// Trust: registerIpc's wrap() accepts a call only when isTrustedSender(event.senderFrame.url)
// holds. A network call has no frame, so the event this adapter builds carries the URL
// `worfy-link://<machineId>`, and the adapter registers with an isTrustedSender of its own that
// passes only a Machine on the list of Linked machines (option (a) of the ticket: the windows'
// check and src/main/ipc/index.ts stay as they are; the token check before the handshake is what
// put the Machine id there).
//
// Only the channels in LINK_OPEN_CHANNELS answer; any other call gets {ok:false} "not open to
// Linked machines" and its handler is never called. worfy-link ticket 08 widens this list.
import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../shared/ipc/channels'
import { registerIpc, type IpcMainLike, type ModuleLoader } from '../ipc/index'

/** The one place that lists the IPC channels a Linked machine may call. */
export const LINK_OPEN_CHANNELS: ReadonlySet<string> = new Set(['link.ping'])

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

/**
 * Ids of link senders. Window webContents ids count up from 1 and the Autopilot's watch
 * subscribers count down from -1 (src/main/ipc/autopilot.ts), so link senders start far above
 * both. worfy-link ticket 03 brings one rule for all of them.
 */
let nextSenderId = 1_000_000_000

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
 * the Linked machine.
 */
export class LinkSender extends EventEmitter {
  readonly id = nextSenderId++
  private destroyed = false

  constructor(
    readonly machineId: string,
    private readonly push: (channel: string, payload: unknown) => void,
    local: () => LocalMachine,
  ) {
    super()
    localMachines.set(this, local)
  }

  send(channel: string, ...args: unknown[]): void {
    if (this.destroyed) return
    const name = channel.startsWith(IPC_CHANNEL_PREFIX) ? channel.slice(IPC_CHANNEL_PREFIX.length) : channel
    this.push(name, args[0])
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  /** The connection closed: subscribers holding this sender let go of it. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('destroyed')
  }
}

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/** An IpcMainLike that keeps the wrapped handlers and answers call frames with them. */
export class LinkIpcAdapter implements IpcMainLike {
  private readonly listeners = new Map<string, Listener>()

  handle(channel: string, listener: Listener): void {
    this.listeners.set(channel, listener)
  }

  /** Answers one call from `sender`'s Machine; a channel outside LINK_OPEN_CHANNELS is refused here. */
  async call(sender: LinkSender, channel: string, input: unknown): Promise<IpcResult<unknown>> {
    const listener = this.listeners.get(IPC_CHANNEL_PREFIX + channel)
    if (!LINK_OPEN_CHANNELS.has(channel) || listener === undefined) {
      return { ok: false, error: `${channel}: not open to Linked machines` }
    }
    const event = { senderFrame: { url: linkFrameUrl(sender.machineId) }, sender } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
}

/**
 * Registers the IPC handlers on a fresh adapter. `isLinked` decides trust: only a frame URL
 * `worfy-link://<id>` of a Machine that is linked right now passes.
 */
export async function createLinkIpc(options: { modules?: Record<string, ModuleLoader>; isLinked: (machineId: string) => boolean }): Promise<LinkIpcAdapter> {
  const adapter = new LinkIpcAdapter()
  await registerIpc(adapter, {
    ...(options.modules === undefined ? {} : { modules: options.modules }),
    isTrustedSender: (url) => {
      if (!URL.canParse(url)) return false
      const parsed = new URL(url)
      return parsed.protocol === LINK_FRAME_SCHEME && parsed.pathname === '' && options.isLinked(parsed.hostname)
    },
  })
  return adapter
}
