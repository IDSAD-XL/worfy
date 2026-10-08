// Finding other worfy in the local network by Bonjour (worfy-link ticket 02; ADR-0052, point 4).
// DNS-SD service type `_worfy._tcp`; the TXT record carries the Machine id (`id`), the link
// protocol (`proto`) and the Machine name (`name`).
//
// - Announcing: while the link server listens (LinkDiscovery.advertise with its port).
// - Searching: while "Link a machine" is open, and while a Linked machine is unavailable (a new
//   address found for it reconnects at once, connections.ts). The reasons are kept apart, so one
//   ending does not stop the search the other still needs.
// - The list shown in "Link a machine" leaves out this Machine (by its id in the TXT record) and the
//   Machines already linked; a worfy of another link protocol is listed and marked incompatible.
//
// The mDNS library is behind MdnsBackend: bonjourBackend() wraps `bonjour-service` (plain
// JavaScript over UDP multicast, no native build — the same code runs on Windows), and the unit test
// (test/unit/link-discovery.test.ts) passes a fake. WORFY_LINK_BONJOUR=0 turns Bonjour off for the
// app (service.ts): e2e tests run with it, because macOS 15 asks for the Local Network permission
// the first time an app announces or searches (Apple TN3179), and that prompt would stop a run.
import { EventEmitter } from 'node:events'
import { isIP } from 'node:net'
import { Bonjour } from 'bonjour-service'
import { z } from 'zod'

/** The DNS-SD service type without underscores: `_worfy._tcp`. */
export const LINK_SERVICE_TYPE = 'worfy'

/** A worfy as an mDNS browser reports it. */
export interface MdnsService {
  /** The instance name. */
  name: string
  /** The full name, unique per announcement; `name` when the backend gives none. */
  fqdn?: string
  /** The target host name (`<host>.local`). */
  host: string
  port: number
  addresses?: string[]
  txt?: Record<string, unknown>
}

export interface MdnsBackend {
  publish(announcement: { name: string; port: number; txt: Record<string, string> }): { stop(): void }
  browse(events: { up(service: MdnsService): void; down(service: MdnsService): void }): { stop(): void; refresh(): void }
  destroy(): void
}

/** A worfy found by Bonjour, this Machine and Linked machines included (list() leaves them out). */
export interface FoundMachine {
  id: string
  name: string
  host: string
  port: number
  protocol: number | null
}

export interface DiscoveredMachine extends FoundMachine {
  compatible: boolean
}

export type BrowseReason = 'linking' | 'reconnect'

export interface LinkDiscoveryOptions {
  backend: MdnsBackend
  /** This Machine. */
  self: () => { id: string; name: string }
  isLinked: (id: string) => boolean
  /** The link protocol this Machine speaks (messages.ts, LINK_PROTOCOL_VERSION). */
  protocol: number
  /** How often the search asks again and drops what has expired; 10 s by default. */
  refreshMs?: number
}

export interface LinkDiscoveryEvents {
  /** The list of found worfy changed. */
  changed: []
  /** A Linked machine announced itself (connections.ts reconnects to it at that address). */
  seen: [FoundMachine]
}

const machineId = z.uuid()

/** The address to dial: IPv4 first, then an IPv6 address that needs no zone, then the host name. */
export function dialAddress(service: Pick<MdnsService, 'host' | 'addresses'>): string {
  const addresses = service.addresses ?? []
  const v4 = addresses.find((address) => isIP(address) === 4)
  if (v4 !== undefined) return v4
  const v6 = addresses.find((address) => isIP(address) === 6 && !/^fe[89ab]/i.test(address))
  if (v6 !== undefined) return v6
  return service.host.replace(/\.$/, '')
}

/** What a found service says about itself; undefined when it is not a worfy (no Machine id). */
export function readAnnouncement(service: MdnsService): FoundMachine | undefined {
  const txt = service.txt ?? {}
  const id = typeof txt.id === 'string' ? txt.id : undefined
  if (id === undefined || !machineId.safeParse(id).success) return undefined
  const protocol = typeof txt.proto === 'string' && /^\d{1,6}$/.test(txt.proto) ? Number(txt.proto) : null
  const name = typeof txt.name === 'string' && txt.name.trim() !== '' ? txt.name.trim() : service.name
  if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535) return undefined
  return { id, name, host: dialAddress(service), port: service.port, protocol: protocol !== null && protocol > 0 ? protocol : null }
}

/** The instance name: the Machine name and the start of its id, so two worfy on one Mac differ. */
export function instanceName(machine: { id: string; name: string }): string {
  const suffix = ` (${machine.id.slice(0, 8)})`
  // A DNS label is at most 63 bytes.
  let name = machine.name
  while (Buffer.byteLength(name + suffix) > 63) name = name.slice(0, -1)
  return name + suffix
}

export class LinkDiscovery extends EventEmitter<LinkDiscoveryEvents> {
  private readonly found = new Map<string, FoundMachine>()
  private readonly reasons = new Set<BrowseReason>()
  private announcement: { port: number; handle: { stop(): void } } | null = null
  private browser: { stop(): void; refresh(): void } | null = null
  private refreshTimer: NodeJS.Timeout | null = null
  private stopped = false

  constructor(private readonly options: LinkDiscoveryOptions) {
    super()
  }

  /** Announces this Machine on `port`; null stops announcing. */
  advertise(port: number | null): void {
    if (this.stopped) return
    if (this.announcement !== null && this.announcement.port === port) return
    this.announcement?.handle.stop()
    this.announcement = null
    if (port === null) return
    const self = this.options.self()
    const handle = this.options.backend.publish({
      name: instanceName(self),
      port,
      txt: { id: self.id, proto: String(this.options.protocol), name: self.name },
    })
    this.announcement = { port, handle }
  }

  /** Starts or ends the search for one reason; the search runs while any reason holds. */
  browse(reason: BrowseReason, on: boolean): void {
    if (this.stopped) return
    if (on) this.reasons.add(reason)
    else this.reasons.delete(reason)
    if (this.reasons.size > 0 && this.browser === null) this.startBrowsing()
    else if (this.reasons.size === 0 && this.browser !== null) this.stopBrowsing()
  }

  get browsing(): boolean {
    return this.browser !== null
  }

  /** The worfy "Link a machine" offers: not this Machine, not a Linked machine; one entry per Machine. */
  list(): DiscoveredMachine[] {
    const self = this.options.self().id
    const byId = new Map<string, DiscoveredMachine>()
    for (const machine of this.found.values()) {
      if (machine.id === self || this.options.isLinked(machine.id)) continue
      byId.set(machine.id, { ...machine, compatible: machine.protocol === this.options.protocol })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }

  /** Where a Linked machine was last found, while the search runs. */
  lastSeen(id: string): FoundMachine | undefined {
    let last: FoundMachine | undefined
    for (const machine of this.found.values()) if (machine.id === id) last = machine
    return last
  }

  stop(): void {
    if (this.stopped) return
    this.advertise(null)
    this.reasons.clear()
    this.stopBrowsing()
    this.stopped = true
    this.options.backend.destroy()
  }

  private startBrowsing(): void {
    this.browser = this.options.backend.browse({
      up: (service) => this.up(service),
      down: (service) => this.down(service),
    })
    this.refreshTimer = setInterval(() => this.browser?.refresh(), this.options.refreshMs ?? 10_000)
    this.refreshTimer.unref()
  }

  private stopBrowsing(): void {
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer)
    this.refreshTimer = null
    this.browser?.stop()
    this.browser = null
    if (this.found.size === 0) return
    this.found.clear()
    this.emit('changed')
  }

  private up(service: MdnsService): void {
    if (this.browser === null) return
    const machine = readAnnouncement(service)
    if (machine === undefined) return
    if (machine.id === this.options.self().id) return
    this.found.set(service.fqdn ?? service.name, machine)
    if (this.options.isLinked(machine.id)) this.emit('seen', machine)
    this.emit('changed')
  }

  private down(service: MdnsService): void {
    if (this.found.delete(service.fqdn ?? service.name)) this.emit('changed')
  }
}

/** The part of `bonjour-service` bonjourBackend uses; the unit test passes a fake. */
export interface BonjourLike {
  publish(options: { name: string; type: string; protocol: 'tcp'; port: number; txt: Record<string, string> }): {
    stop?: (callback?: () => void) => void
    on?: (event: 'error', listener: (error: Error) => void) => unknown
  }
  find(options: { type: string; protocol: 'tcp' }): {
    on(event: 'up' | 'down' | 'srv-update' | 'txt-update', listener: (service: MdnsService) => void): unknown
    stop(): void
    update(): void
    expire(): void
  }
  destroy(callback?: () => void): void
}

/** mDNS through `bonjour-service`, made on first use: an app that never announces nor searches opens no socket. */
export function bonjourBackend(options: { create?: () => BonjourLike; warn?: (message: string) => void } = {}): MdnsBackend {
  const warn = options.warn ?? ((message: string) => console.warn(message))
  const create =
    options.create ?? ((): BonjourLike => new Bonjour({}, (error: unknown) => warn(`[link] Bonjour: ${error instanceof Error ? error.message : String(error)}`)) as unknown as BonjourLike)
  let bonjour: BonjourLike | undefined
  const instance = (): BonjourLike => (bonjour ??= create())
  return {
    publish: (announcement) => {
      const service = instance().publish({ name: announcement.name, type: LINK_SERVICE_TYPE, protocol: 'tcp', port: announcement.port, txt: announcement.txt })
      service.on?.('error', (error) => warn(`[link] Bonjour could not announce this Machine: ${error.message}`))
      return { stop: () => service.stop?.() }
    },
    browse: (events) => {
      const browser = instance().find({ type: LINK_SERVICE_TYPE, protocol: 'tcp' })
      browser.on('up', events.up)
      browser.on('srv-update', events.up)
      browser.on('txt-update', events.up)
      browser.on('down', events.down)
      return {
        stop: () => browser.stop(),
        refresh: () => {
          browser.expire()
          browser.update()
        },
      }
    },
    destroy: () => {
      bonjour?.destroy()
      bonjour = undefined
    },
  }
}
