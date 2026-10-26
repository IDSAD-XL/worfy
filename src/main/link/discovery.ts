// Finding other worfy in the local network by Bonjour (worfy-link ticket 02; ADR-0052, point 4).
// DNS-SD service type `_worfy._tcp`; the TXT record carries the Machine id (`id`), the link
// protocol (`proto`) and the Machine name (`name`).
//
// - Announcing: while the link server listens (LinkDiscovery.advertise with its port), and again
//   with the current addresses when this Machine wakes up or its network changes (announceAgain,
//   worfy-link ticket 36).
// - Searching: while "Link a machine" is open, and while a Linked machine is unavailable (a new
//   address found for it reconnects at once, connections.ts). The reasons are kept apart, so one
//   ending does not stop the search the other still needs.
// - The list shown in "Link a machine" leaves out this Machine (by its id in the TXT record) and the
//   Machines already linked; a worfy of another link protocol is listed and marked incompatible.
//
// An announcement is a claim, not a proof: anyone in the network can announce any Machine id at
// any address. So only local-network addresses are taken (checks.ts, as the server's own check),
// at most MAX_FOUND announcements are kept, two addresses for one id are both listed and marked
// as a conflict, a Linked machine's sighting (`seen`) goes out at most once per `seenIntervalMs`,
// and connections.ts dials such an address only to check the remembered certificate there.
//
// The mDNS library is behind MdnsBackend: bonjourBackend() wraps `bonjour-service` (plain
// JavaScript over UDP multicast, no native build — the same code runs on Windows), and the unit test
// (test/unit/link-discovery.test.ts) passes a fake. WORFY_LINK_BONJOUR=0 turns Bonjour off for the
// app (service.ts): e2e tests run with it, because macOS 15 asks for the Local Network permission
// the first time an app announces or searches (Apple TN3179), and that prompt would stop a run.
import { EventEmitter } from 'node:events'
import { isIP } from 'node:net'
import type { NetworkInterfaceInfo } from 'node:os'
import { Bonjour } from 'bonjour-service'
import { z } from 'zod'
import { isLocalNetworkAddress, isTailscaleAddress } from './checks'

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
  /** `stop` sends the goodbye (the records with TTL 0) and resolves once it is out. */
  publish(announcement: { name: string; port: number; txt: Record<string, string> }): { stop(): Promise<void> }
  browse(events: { up(service: MdnsService): void; down(service: MdnsService): void }): { stop(): void; refresh(): void }
  /** The machine's network changed: follow its interfaces (worfy-link ticket 36). Optional; a fake may leave it out. */
  refresh?(): void
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
  /** Another announcement claims the same Machine id at another address: one of them is not it. */
  conflict: boolean
}

/** At most this many announcements are kept; more are ignored until some leave. */
export const MAX_FOUND = 64

export type BrowseReason = 'linking' | 'reconnect'

export interface LinkDiscoveryOptions {
  backend: MdnsBackend
  /** This Machine. */
  self: () => { id: string; name: string }
  isLinked: (id: string) => boolean
  /** The link protocol this Machine speaks (messages.ts, LINK_PROTOCOL_VERSION). */
  protocol: number
  /** Whether an IPv4 address is on a network of this machine (onSameNetwork); an announced address that is goes first. */
  sameNetwork?: (address: string) => boolean
  /** How often the search asks again and drops what has expired; 10 s by default. */
  refreshMs?: number
  /** At most one `seen` per Machine id in this time; 10 s by default. */
  seenIntervalMs?: number
  now?: () => number
}

export interface LinkDiscoveryEvents {
  /** The list of found worfy changed. */
  changed: []
  /** A Linked machine announced itself (connections.ts reconnects to it at that address). */
  seen: [FoundMachine]
}

const machineId = z.uuid()

/**
 * The address to dial, from the local network only (checks.ts): IPv4 first, then an IPv6 address
 * that needs no zone (not fe80::/10), then the host name when it is an mDNS name (`*.local`).
 * Undefined when the announcement offers none of these.
 */
export function dialAddress(service: Pick<MdnsService, 'host' | 'addresses'>, sameNetwork?: (address: string) => boolean): string | undefined {
  const local = (service.addresses ?? []).filter((address) => isIP(address) !== 0 && isLocalNetworkAddress(address))
  // A worfy announces every interface it has (WSL and Hyper-V adapters on Windows too): an address
  // on a network this machine is on goes first (worfy-link ticket 36).
  const v4 = local.find((address) => isIP(address) === 4 && sameNetwork?.(address) === true) ?? local.find((address) => isIP(address) === 4)
  if (v4 !== undefined) return v4
  const v6 = local.find((address) => isIP(address) === 6 && !/^fe[89ab]/i.test(address))
  if (v6 !== undefined) return v6
  const host = service.host.replace(/\.$/, '')
  return /^[A-Za-z0-9-]{1,63}\.local$/i.test(host) ? host : undefined
}

/** What a found service says about itself; undefined when it is not a worfy (no Machine id). */
export function readAnnouncement(service: MdnsService, sameNetwork?: (address: string) => boolean): FoundMachine | undefined {
  const txt = service.txt ?? {}
  const id = typeof txt.id === 'string' ? txt.id : undefined
  if (id === undefined || !machineId.safeParse(id).success) return undefined
  const protocol = typeof txt.proto === 'string' && /^\d{1,6}$/.test(txt.proto) ? Number(txt.proto) : null
  const name = typeof txt.name === 'string' && txt.name.trim() !== '' ? txt.name.trim() : service.name
  if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535) return undefined
  const host = dialAddress(service, sameNetwork)
  if (host === undefined) return undefined
  return { id, name, host, port: service.port, protocol: protocol !== null && protocol > 0 ? protocol : null }
}

/**
 * The mDNS name of an announcement's host, `<label>.local` in lower case; undefined when it is no
 * such name. A bare label counts too: `bonjour-service` announces os.hostname() as it is, which on
 * Windows is the computer name without `.local` (whether Windows answers for `<name>.local` is for
 * the check on the PC, worfy-link ticket 36).
 */
export function mdnsName(host: string): string | undefined {
  const name = host.replace(/\.$/, '').toLowerCase()
  if (/^[a-z0-9-]{1,63}\.local$/.test(name)) return name
  if (/^[a-z0-9-]{1,63}$/.test(name)) return `${name}.local`
  return undefined
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
  /** The mDNS name of each found announcement's host, by the same key as `found`. */
  private readonly names = new Map<string, string>()
  /** When `seen` last went out per Machine id. */
  private readonly lastSeenAt = new Map<string, number>()
  private readonly reasons = new Set<BrowseReason>()
  private announcement: { port: number; handle: { stop(): void } } | null = null
  /** The port advertise() was last asked for; null: not announcing. */
  private wanted: number | null = null
  private browser: { stop(): void; refresh(): void } | null = null
  private refreshTimer: NodeJS.Timeout | null = null
  private stopped = false

  constructor(private readonly options: LinkDiscoveryOptions) {
    super()
  }

  /** Announces this Machine on `port`; null stops announcing. */
  advertise(port: number | null): void {
    if (this.stopped) return
    this.wanted = port
    if (this.announcement !== null && this.announcement.port === port) return
    void this.withdraw()
    if (port === null) return
    this.publish(port)
  }

  private publish(port: number): void {
    const self = this.options.self()
    const handle = this.options.backend.publish({
      name: instanceName(self),
      port,
      txt: { id: self.id, proto: String(this.options.protocol), name: self.name },
    })
    this.announcement = { port, handle }
  }

  /**
   * Announces this Machine again, with the addresses its interfaces have now, and asks the network
   * again for the others: after a wake-up or a change of network (worfy-link ticket 36). The old
   * announcement's goodbye goes out first, so it cannot arrive after the new one. Nothing while
   * this Machine does not announce.
   */
  async announceAgain(): Promise<void> {
    if (this.stopped) return
    // The sockets follow the interfaces first (bonjourBackend): the new announcement goes out on them.
    this.options.backend.refresh?.()
    this.browser?.refresh()
    const current = this.announcement
    if (this.stopped || current === null) return
    await this.withdraw()
    // advertise() may have run meanwhile (another port, or none): that one stands.
    if (this.stopped || this.announcement !== null || this.wanted !== current.port) return
    this.publish(current.port)
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

  /**
   * The worfy "Link a machine" offers: not this Machine, not a Linked machine; one entry per id and
   * address. Two addresses for one id are both listed, each marked `conflict`.
   */
  list(): DiscoveredMachine[] {
    const self = this.options.self().id
    const entries = new Map<string, DiscoveredMachine>()
    const addressesOf = new Map<string, Set<string>>()
    for (const machine of this.found.values()) {
      if (machine.id === self || this.options.isLinked(machine.id)) continue
      const address = `${machine.host}|${machine.port}`
      entries.set(`${machine.id}|${address}`, { ...machine, compatible: machine.protocol === this.options.protocol, conflict: false })
      const addresses = addressesOf.get(machine.id) ?? new Set<string>()
      addresses.add(address)
      addressesOf.set(machine.id, addresses)
    }
    return [...entries.values()]
      .map((entry) => ({ ...entry, conflict: (addressesOf.get(entry.id)?.size ?? 0) > 1 }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id) || a.host.localeCompare(b.host) || a.port - b.port)
  }

  /** Where a Linked machine was last found, while the search runs. */
  lastSeen(id: string): FoundMachine | undefined {
    let last: FoundMachine | undefined
    for (const machine of this.found.values()) if (machine.id === id) last = machine
    return last
  }

  /** The mDNS name of the host Bonjour last found Linked machine `id` on, as lastSeen does; undefined when none. */
  lastSeenName(id: string): string | undefined {
    let name: string | undefined
    for (const [key, machine] of this.found) if (machine.id === id) name = this.names.get(key)
    return name
  }

  /**
   * Stops for good: the goodbye goes out first (other worfy drop this one at once, not when the
   * announcement's TTL of 8 hours runs out), then the socket closes. Resolves when both are done.
   */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.reasons.clear()
    this.stopBrowsing()
    try {
      await this.withdraw()
    } finally {
      this.options.backend.destroy()
    }
  }

  /** Stops announcing; resolves once the goodbye is out. */
  private async withdraw(): Promise<void> {
    const current = this.announcement
    this.announcement = null
    try {
      await current?.handle.stop()
    } catch {
      // The goodbye could not be sent; the announcement then expires with its TTL.
    }
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
    this.lastSeenAt.clear()
    this.names.clear()
    if (this.found.size === 0) return
    this.found.clear()
    this.emit('changed')
  }

  private up(service: MdnsService): void {
    if (this.browser === null) return
    const machine = readAnnouncement(service, this.options.sameNetwork)
    if (machine === undefined) return
    if (machine.id === this.options.self().id) return
    const key = service.fqdn ?? service.name
    if (!this.found.has(key) && this.found.size >= MAX_FOUND) return
    this.found.set(key, machine)
    const name = mdnsName(service.host)
    if (name === undefined) this.names.delete(key)
    else this.names.set(key, name)
    if (this.options.isLinked(machine.id)) this.sighted(machine)
    this.emit('changed')
  }

  /** A Linked machine announced itself: `seen`, at most once per seenIntervalMs per id. */
  private sighted(machine: FoundMachine): void {
    const now = (this.options.now ?? Date.now)()
    const last = this.lastSeenAt.get(machine.id)
    if (last !== undefined && now - last < (this.options.seenIntervalMs ?? 10_000)) return
    this.lastSeenAt.set(machine.id, now)
    this.emit('seen', machine)
  }

  private down(service: MdnsService): void {
    this.names.delete(service.fqdn ?? service.name)
    if (this.found.delete(service.fqdn ?? service.name)) this.emit('changed')
  }
}

/** The part of `bonjour-service` bonjourBackend uses; the unit test passes a fake. */
export interface BonjourLike {
  publish(options: { name: string; type: string; protocol: 'tcp'; port: number; txt: Record<string, string>; probe?: boolean }): {
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

/** Whether IPv4 `address` is on the network of one of `interfaces` (address and netmask). */
export function onSameNetwork(address: string, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): boolean {
  const value = (text: string): number => text.split('.').reduce((sum, octet) => sum * 256 + Number(octet), 0)
  if (isIP(address) !== 4) return false
  const target = value(address)
  for (const list of Object.values(interfaces)) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || isIP(entry.netmask) !== 4) continue
      const mask = value(entry.netmask)
      // Unsigned arithmetic: the bitwise operators of JavaScript are signed 32-bit.
      if (mask !== 0 && Math.floor(target / (2 ** 32 - mask)) === Math.floor(value(entry.address) / (2 ** 32 - mask))) return true
    }
  }
  return false
}

/** What bonjourBackend asks of `bonjour-service` for one socket: the interface it joins and sends on. */
export interface BonjourSocketOptions {
  /** The IPv4 address of the interface. */
  interface: string
  /** Where the socket binds: every address, so multicast still arrives on macOS and Linux. */
  bind: string
}

/**
 * The IPv4 addresses mDNS runs on (worfy-link ticket 36): this machine's addresses that may carry
 * the link, as the server's peer check accepts them (checks.ts) — local-network IPv4, not loopback,
 * not link-local 169.254/16, and Tailscale only while "Link through Tailscale" is on.
 */
export function mdnsInterfaces(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, tailscale: boolean): string[] {
  const found: string[] = []
  for (const list of Object.values(interfaces)) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue
      if (isTailscaleAddress(entry.address) ? tailscale : isLocalNetworkAddress(entry.address) && !entry.address.startsWith('127.')) found.push(entry.address)
    }
  }
  return [...new Set(found)]
}

/**
 * mDNS through `bonjour-service`, made on first use: an app that never announces nor searches
 * opens no socket.
 *
 * One `bonjour-service` instance — one socket — per address `interfaces` lists, bound to every
 * address and joined and sending on that interface; each announcement and each search runs on all
 * of them. An announcement does not probe for its name first: the sockets of one machine would
 * probe the same name at once, and where two interfaces share a network the loser hears the winner,
 * gives up the name and sends a goodbye, so peers drop the machine on every announcement. The name
 * cannot clash with another machine's: it carries the start of the Machine id (instanceName).
 * Why (worfy-link ticket 36, item 9): multicast-dns 7.2.5 sends on interface 0.0.0.0 everywhere but
 * macOS, so Windows picked one by itself — on the owner's PC the WSL adapter, not Ethernet — and the
 * Mac never heard the PC. `refresh()` (on a change of network) closes the sockets of addresses that
 * went, with the goodbye of their announcements, and opens the new ones with every announcement
 * and search there is.
 */
export function bonjourBackend(
  options: { create?: (socket: BonjourSocketOptions) => BonjourLike; interfaces: () => string[]; warn?: (message: string) => void },
): MdnsBackend {
  const warn = options.warn ?? ((message: string) => console.warn(message))
  const create =
    options.create ??
    ((socket: BonjourSocketOptions): BonjourLike =>
      // The first argument goes to multicast-dns as it is; bonjour-service types it as a service's options.
      new Bonjour(socket as never, (error: unknown) => warn(`[link] Bonjour on ${socket.interface}: ${error instanceof Error ? error.message : String(error)}`)) as unknown as BonjourLike)
  type Published = ReturnType<BonjourLike['publish']>
  type Browser = ReturnType<BonjourLike['find']>
  type Announcement = { name: string; port: number; txt: Record<string, string> }
  type Search = { up(service: MdnsService): void; down(service: MdnsService): void }
  interface Instance {
    bonjour: BonjourLike
    published: Map<Announcement, Published>
    browsers: Map<Search, Browser>
  }
  const instances = new Map<string, Instance>()
  const announcements = new Set<Announcement>()
  const searches = new Set<Search>()
  let opened = false

  const goodbye = (service: Published): Promise<void> =>
    new Promise<void>((done) => {
      if (service.stop === undefined) return done()
      // bonjour-service calls back once the goodbye (the records with TTL 0) is sent.
      service.stop(() => done())
    })
  const announce = (instance: Instance, key: string, announcement: Announcement): void => {
    const service = instance.bonjour.publish({ name: announcement.name, type: LINK_SERVICE_TYPE, protocol: 'tcp', port: announcement.port, txt: announcement.txt, probe: false })
    service.on?.('error', (error) => warn(`[link] Bonjour could not announce this Machine on ${key}: ${error.message}`))
    instance.published.set(announcement, service)
  }
  const search = (instance: Instance, events: Search): void => {
    const browser = instance.bonjour.find({ type: LINK_SERVICE_TYPE, protocol: 'tcp' })
    browser.on('up', events.up)
    browser.on('srv-update', events.up)
    browser.on('txt-update', events.up)
    browser.on('down', events.down)
    instance.browsers.set(events, browser)
  }
  const wanted = (): string[] => options.interfaces()
  /** Opens the instances of the addresses there are now and closes those of the addresses that went. */
  const sync = (): void => {
    opened = true
    const keys = new Set(wanted())
    for (const [key, instance] of instances) {
      if (keys.has(key)) continue
      instances.delete(key)
      for (const browser of instance.browsers.values()) browser.stop()
      void Promise.all([...instance.published.values()].map(goodbye)).finally(() => instance.bonjour.destroy())
    }
    for (const key of keys) {
      if (instances.has(key)) continue
      const instance: Instance = { bonjour: create({ interface: key, bind: '0.0.0.0' }), published: new Map(), browsers: new Map() }
      instances.set(key, instance)
      for (const announcement of announcements) announce(instance, key, announcement)
      for (const events of searches) search(instance, events)
    }
  }
  const ensure = (): void => {
    if (!opened) sync()
  }
  return {
    publish: (announcement) => {
      ensure()
      const entry = { ...announcement }
      announcements.add(entry)
      for (const [key, instance] of instances) announce(instance, key, entry)
      return {
        stop: async () => {
          announcements.delete(entry)
          const services: Published[] = []
          for (const instance of instances.values()) {
            const service = instance.published.get(entry)
            instance.published.delete(entry)
            if (service !== undefined) services.push(service)
          }
          await Promise.all(services.map(goodbye))
        },
      }
    },
    browse: (events) => {
      ensure()
      const entry = { up: events.up, down: events.down }
      searches.add(entry)
      for (const instance of instances.values()) search(instance, entry)
      return {
        stop: () => {
          searches.delete(entry)
          for (const instance of instances.values()) {
            instance.browsers.get(entry)?.stop()
            instance.browsers.delete(entry)
          }
        },
        refresh: () => {
          for (const instance of instances.values()) {
            const browser = instance.browsers.get(entry)
            browser?.expire()
            browser?.update()
          }
        },
      }
    },
    refresh: () => {
      if (opened) sync()
    },
    destroy: () => {
      for (const instance of instances.values()) instance.bonjour.destroy()
      instances.clear()
      opened = false
    },
  }
}
