// Calls to the channels of a Linked machine, for the windows of this Machine and for other parts of
// main (worfy-link ticket 09; ADR-0052, point 5; ADR-0053). One RemoteCalls per link service.
//
// What goes. Only `project` and `desktop` channels (their access mark, src/shared/ipc/channels.ts):
// the Linked machine applies its own checks of worfy-link ticket 08 — access on, `desktop` refused,
// paths inside its Projects — on its side; nothing here goes around them.
//
// One connection per Machine. Both sides dial each other, so two connections to one Machine may
// be open at once, and the Linked machine broadcasts its events over both. Calls go over one of
// them, the "current" one, and only the events that come over it are passed on: what a call
// subscribed to on the Linked machine (docs, workflow, a Terminal) is tied to the connection it
// came over. When the current connection closes and another one takes over, or a Machine is
// reached again, the `epoch` of the Machine changes: what was subscribed through the old one is
// gone, and a window that shows the Machine loads again.
//
// Sharing. Whether a Linked machine lets this one work with its Projects is its switch "Linked
// machines can work with my Projects", which only it knows. It says so in the service message
// `projects-access` when a connection opens and whenever the switch changes; a call refused with
// "access is off" says it too. Sharing coming back on changes the epoch as well: the Linked machine
// made a new client for this one (worfy-link ticket 08), and the old subscriptions are gone.
//
// Logs: no token, address or certificate of a Machine goes anywhere from here; the renderer gets
// Machine ids alone (src/shared/ipc/linked.ts).
import { EventEmitter } from 'node:events'
import { z } from 'zod'
import { accessOf, type IpcResult } from '../../shared/ipc/channels'
import type { LinkedMachineInfo } from '../../shared/ipc/linked'
import type { LinkConnection } from './connection'
import { defineLinkMessage } from './messages'
import { appLinkService, type LinkService } from './service'

/** A Linked machine tells this one whether it shares its Projects (see the top of this file). */
export const projectsAccessMessage = defineLinkMessage('projects-access', z.object({ on: z.boolean() }))

/** Whether `channel` is called on the Machine of a Project: a `project` or `desktop` channel. */
export function callsOnProjectMachine(channel: string): boolean {
  const access = accessOf(channel)
  return access === 'project' || access === 'desktop'
}

/** The refusal of ticket 08 while access is off (ipc-adapter.ts, accessOffRefusal). */
const ACCESS_OFF = /^Linked machines cannot work with the Projects of .+: access is off$/

/** "<Machine> is unreachable": what a call answers while no connection is open. */
export const unreachable = (channel: string, machineName: string): string => `${channel}: ${machineName} is unreachable`

export interface RemoteEvent {
  machine: string
  channel: string
  payload: unknown
}

interface Tracked {
  connection: LinkConnection | undefined
  sharing: LinkedMachineInfo['sharing']
  epoch: number
}

export interface RemoteCallsEvents {
  /** An event of a Linked machine's `project` channel, over its current connection. */
  event: [RemoteEvent]
  /** What machines() answers changed. */
  changed: []
}

export class RemoteCalls extends EventEmitter<RemoteCallsEvents> {
  private readonly tracked = new Map<string, Tracked>()
  /** One counter for every Machine, so an epoch never comes back. */
  private epochs = 0

  constructor(private readonly service: LinkService) {
    super()
    service.registerMessage(projectsAccessMessage, ({ on }, { machineId }) => this.setSharing(machineId, on ? 'yes' : 'no'))
    service.on('connected', ({ id }) => {
      this.follow(id)
      this.tellAccess(id)
    })
    service.on('disconnected', ({ id }) => this.follow(id))
    service.on('unlinked', ({ id }) => {
      if (this.tracked.delete(id)) this.emit('changed')
    })
    service.on('settings', () => {
      for (const machine of service.linkedMachines()) if (machine.connected) this.tellAccess(machine.id)
    })
    service.on('ipc-event', ({ machineId, channel, payload, connection }) => {
      if (connection !== this.current(machineId)) return
      // This side's own marks decide too: a name it does not know, or a channel of its own, stays out.
      if (accessOf(channel) !== 'project') return
      this.emit('event', { machine: machineId, channel, payload })
    })
    // Connections opened before this object was made heard nothing of this Machine's switch.
    for (const machine of service.linkedMachines()) {
      if (!machine.connected) continue
      this.follow(machine.id)
      this.tellAccess(machine.id)
    }
  }

  /** The Linked machines this Machine knows anything about beyond the link state. */
  machines(): LinkedMachineInfo[] {
    return this.service.linkedMachines().map((machine) => {
      const tracked = this.track(machine.id)
      return { id: machine.id, online: this.current(machine.id) !== undefined, sharing: tracked.sharing, epoch: tracked.epoch }
    })
  }

  /**
   * Calls `channel` on Linked machine `machine` over its current connection; resolves with its
   * IpcResult and never rejects. Only `project` and `desktop` channels go.
   */
  async call(machine: string, channel: string, input: unknown): Promise<IpcResult<unknown>> {
    if (!callsOnProjectMachine(channel)) return { ok: false, error: `${channel}: a channel of this Machine; it is not called on a Linked machine` }
    const record = this.service.linkedMachines().find((candidate) => candidate.id === machine)
    if (record === undefined) return { ok: false, error: `${channel}: Machine ${machine} is not linked` }
    const connection = this.current(machine)
    if (connection === undefined) return { ok: false, error: unreachable(channel, record.name) }
    const result = await connection.call(channel, input)
    if (!result.ok && ACCESS_OFF.test(result.error)) this.setSharing(machine, 'no')
    else if (result.ok) this.setSharing(machine, 'yes')
    return result
  }

  private track(id: string): Tracked {
    let tracked = this.tracked.get(id)
    if (tracked === undefined) {
      tracked = { connection: undefined, sharing: 'unknown', epoch: 0 }
      this.tracked.set(id, tracked)
    }
    return tracked
  }

  /** The connection calls to `id` go over; picks another one when it closed. */
  private current(id: string): LinkConnection | undefined {
    const tracked = this.track(id)
    if (tracked.connection?.isOpen === true) return tracked.connection
    const next = this.service.connectionTo(id)
    if (next === tracked.connection) return next
    tracked.connection = next
    if (next !== undefined) {
      tracked.epoch = ++this.epochs
      next.once('close', () => this.follow(id))
    }
    this.emit('changed')
    return next
  }

  /** A connection to `id` opened or closed. */
  private follow(id: string): void {
    if (!this.service.isLinked(id)) return
    this.current(id)
    this.emit('changed')
  }

  private setSharing(id: string, sharing: 'yes' | 'no'): void {
    if (!this.service.isLinked(id)) return
    const tracked = this.track(id)
    if (tracked.sharing === sharing) return
    // Back on after off: the Linked machine made a new client for this one; start afresh.
    if (tracked.sharing === 'no' && sharing === 'yes') tracked.epoch = ++this.epochs
    tracked.sharing = sharing
    this.emit('changed')
  }

  /** Tells Linked machine `id` whether this Machine shares its Projects. */
  private tellAccess(id: string): void {
    try {
      this.service.sendMessage(id, projectsAccessMessage, { on: this.service.settings.get().projectsAccess })
    } catch (error) {
      // Closed meanwhile: it hears it on the next connection.
      console.warn(`[link] could not tell Machine ${id} whether this one shares its Projects: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

let appCalls: { service: LinkService; calls: RemoteCalls } | undefined

/** The app's RemoteCalls over the app's link service; undefined while the link has not started. */
export function appRemoteCalls(): RemoteCalls | undefined {
  const service = appLinkService()
  if (service === undefined) return undefined
  if (appCalls?.service !== service) appCalls = { service, calls: new RemoteCalls(service) }
  return appCalls.calls
}

/**
 * Calls `channel` on Linked machine `machine` from main (worfy-link ticket 10 reads Card files this
 * way); `{ok:false}` while the link has not started.
 */
export function callOn(machine: string, channel: string, input?: unknown): Promise<IpcResult<unknown>> {
  const calls = appRemoteCalls()
  if (calls === undefined) return Promise.resolve({ ok: false, error: `${channel}: the link service has not started` })
  return calls.call(machine, channel, input)
}
