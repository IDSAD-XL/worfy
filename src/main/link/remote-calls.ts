// Calls to the channels of a Linked machine, for the windows of this Machine and for other parts of
// main (worfy-link ticket 09; ADR-0052, point 5; ADR-0053). One RemoteCalls per link service.
//
// What goes. Only `project` and `desktop` channels (their access mark, src/shared/ipc/channels.ts):
// the Linked machine applies its own checks of worfy-link ticket 08 — access on, `desktop` refused,
// paths inside its Projects — on its side; nothing here goes around them.
//
// The contract holds both ways. What comes back from the Linked machine — the answer of a call and
// every event — is parsed with the schema of the channel as this Machine declares it
// (definitionOf, src/shared/ipc/channels.ts) before it goes on to a window, as main's own answers
// (wrap) and events (emit, src/main/ipc/index.ts) are: an answer outside the schema becomes
// {ok:false}, an event outside it is dropped with a warning that names the channel, never its
// content. A Linked machine that is not what it should be cannot hand a window anything else.
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
// machines can work with my Projects" and the level it set for this Machine (worfy-link ticket 18):
// off, read-only or all, which only it knows. It says so in the service message `projects-access`
// when a connection opens and whenever its settings change; a call refused with "access is off"
// says it is off too (a Linked machine of an older build sends no level). The level comes from the
// message only, never from the text of a refusal. Sharing coming back on, and a change between
// read-only and all, change the epoch as well: the Linked machine made a new client for this one
// (worfy-link ticket 08), and the old subscriptions are gone.
//
// Logs: no token, address or certificate of a Machine goes anywhere from here; the renderer gets
// Machine ids alone (src/shared/ipc/linked.ts).
import { EventEmitter } from 'node:events'
import { z } from 'zod'
import { accessOf, definitionOf, type IpcResult } from '../../shared/ipc/channels'
import { accessLevelSchema, type AccessLevel } from '../../shared/ipc/link'
import type { LinkedMachineInfo } from '../../shared/ipc/linked'
import type { LinkConnection } from './connection'
import { defineLinkMessage } from './messages'
import { appLinkService, type LinkService } from './service'

/**
 * A Linked machine tells this one whether it shares its Projects (see the top of this file): `on`
 * for a build before worfy-link ticket 18, and `level` since; a build that knows only `on` ignores
 * `level`, and one that gets no `level` reads `on` as all.
 */
export const projectsAccessMessage = defineLinkMessage('projects-access', z.object({ on: z.boolean(), level: accessLevelSchema.optional() }))

/** Whether `channel` is called on the Machine of a Project: a `project` or `desktop` channel. */
export function callsOnProjectMachine(channel: string): boolean {
  const access = accessOf(channel)
  return access === 'project' || access === 'desktop'
}

/** The refusal of ticket 08 while access is off (ipc-adapter.ts, accessOffRefusal). */
const ACCESS_OFF = /^Linked machines cannot work with the Projects of .+: access is off$/

/** How LinkConnection.call fails when the connection is gone (connection.ts). */
const CONNECTION_LOST = /^(call \d+: the connection to the Linked machine closed|.+: the Linked machine is not connected)$/
/** How LinkConnection.call fails when the answer does not come in time. */
const NO_ANSWER = /^.+: the Linked machine did not answer in time$/

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
  /** The level the Linked machine last said; null until it said one. */
  level: AccessLevel | null
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

  private readonly warn: (message: string) => void

  constructor(
    private readonly service: LinkService,
    /** Warnings for the worfy log, never with a payload; console.warn by default. */
    options: { warn?: (message: string) => void } = {},
  ) {
    super()
    this.warn = options.warn ?? ((message) => console.warn(message))
    service.registerMessage(projectsAccessMessage, ({ on, level }, { machineId }) => this.setLevel(machineId, level ?? (on ? 'all' : 'off')))
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
      // This side's own declaration decides: a name it does not know, or a channel of its own, stays
      // out; the payload must fit the channel's schema, as emit() holds main's own events to it.
      const definition = definitionOf(channel)
      if (definition?.kind !== 'event' || definition.access !== 'project') return
      const parsed = definition.payload.safeParse(payload)
      if (!parsed.success) {
        this.warn(`[link] Machine ${machineId} sent event ${JSON.stringify(channel)} outside its schema; dropped`)
        return
      }
      this.emit('event', { machine: machineId, channel, payload: parsed.data })
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
      return {
        id: machine.id,
        online: this.current(machine.id) !== undefined,
        sharing: tracked.sharing,
        readOnly: tracked.sharing === 'yes' && tracked.level === 'read',
        epoch: tracked.epoch,
      }
    })
  }

  /**
   * Calls `channel` on Linked machine `machine` over its current connection; resolves with its
   * IpcResult and never rejects. Only `project` and `desktop` channels go.
   */
  async call(machine: string, channel: string, input: unknown): Promise<IpcResult<unknown>> {
    const definition = definitionOf(channel)
    if (definition?.kind !== 'invoke' || !callsOnProjectMachine(channel)) {
      return { ok: false, error: `${channel}: a channel of this Machine; it is not called on a Linked machine` }
    }
    const record = this.service.linkedMachines().find((candidate) => candidate.id === machine)
    if (record === undefined) return { ok: false, error: `${channel}: Machine ${machine} is not linked` }
    const connection = this.current(machine)
    if (connection === undefined) return { ok: false, error: unreachable(channel, record.name) }
    const result = await connection.call(channel, input)
    if (!result.ok) {
      if (ACCESS_OFF.test(result.error)) this.setSharing(machine, 'no')
      // The connection's own words name no Machine and a call number (connection.ts); a window
      // shows these, so they say which Machine is gone, the way a call with no connection does.
      if (CONNECTION_LOST.test(result.error)) return { ok: false, error: unreachable(channel, record.name) }
      if (NO_ANSWER.test(result.error)) return { ok: false, error: `${channel}: ${record.name} did not answer in time` }
      return result
    }
    this.setSharing(machine, 'yes')
    // The answer must fit the channel's output schema, as wrap() holds main's own answers to it.
    const parsed = await definition.output.safeParseAsync(result.value)
    if (!parsed.success) {
      this.warn(`[link] Machine ${machine} answered ${JSON.stringify(channel)} outside its schema; refused`)
      return { ok: false, error: `${channel}: ${record.name} answered outside the contract` }
    }
    return { ok: true, value: parsed.data }
  }

  private track(id: string): Tracked {
    let tracked = this.tracked.get(id)
    if (tracked === undefined) {
      tracked = { connection: undefined, sharing: 'unknown', level: null, epoch: 0 }
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
    if (sharing === 'no') tracked.level = 'off'
    this.emit('changed')
  }

  /** The level Linked machine `id` said it gives this one. */
  private setLevel(id: string, level: AccessLevel): void {
    if (!this.service.isLinked(id)) return
    const tracked = this.track(id)
    const before = tracked.level
    if (before === level) return
    tracked.level = level
    // Read-only to all or back: the Linked machine made a new client for this one; start afresh.
    // From off, setSharing below starts afresh itself.
    if ((before === 'read' && level === 'all') || (before === 'all' && level === 'read')) tracked.epoch = ++this.epochs
    if (level === 'off') this.setSharing(id, 'no')
    else if (tracked.sharing !== 'yes') this.setSharing(id, 'yes')
    // setSharing announces only when sharing itself changed.
    else this.emit('changed')
  }

  /** Tells Linked machine `id` whether, and how far, this Machine shares its Projects with it. */
  private tellAccess(id: string): void {
    const level = this.service.settings.levelOf(id)
    try {
      this.service.sendMessage(id, projectsAccessMessage, { on: level !== 'off', level })
    } catch (error) {
      // Closed meanwhile: it hears it on the next connection.
      this.warn(`[link] could not tell Machine ${id} whether this one shares its Projects: ${error instanceof Error ? error.message : String(error)}`)
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
