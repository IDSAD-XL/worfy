// Keeping a connection to every Linked machine (worfy-link ticket 02; ADR-0052, point 5).
//
// - At the start, and when a Machine is linked, this side dials it (LinkService.connect).
// - After a failed dial or a dropped connection: the next dial after a pause that doubles from
//   `firstDelayMs` up to `maxDelayMs` (1 s → 30 s by default). An open connection resets it.
// - An address for it from Bonjour (discovery.ts) while it is not connected: one dial there at
//   once. An announcement proves nothing — anyone can announce any Machine id — so the address is
//   kept only when the remembered certificate answers there (LinkService.connect, `via`); another
//   certificate leaves the record and the "certificate changed" mark alone. While a connection is
//   open, in either direction, an announcement is ignored.
// - A revoked or forgotten Machine is not dialled again. A 401 from the other side makes the service
//   forget it (service.ts, connect), which ends the dials too.
//
// - At once, without the pause and with the count of failures reset (worfy-link ticket 36): when
//   this Machine wakes up, when its network changes (watchNetwork below), and on `link.reconnect`
//   (reconnect). A dial already running is followed by another one at once when it fails. Each dial
//   tries the remembered address (with its names, LinkService.connect), then the address Bonjour
//   sees the Machine at now, when it sees one elsewhere (`seenAt`).
//
// Both sides dial: each keeps its own connections, and a Machine counts as online while any
// connection to it, made by either side, is open (LinkService.isConnected). A refusal for another
// certificate is shown in the row ("certificate changed") and keeps being retried at the long pause:
// linking again on the other side clears it.
import { EventEmitter } from 'node:events'
import { networkInterfaces as osNetworkInterfaces } from 'node:os'
import type { LinkService } from './service'

/** Where Bonjour sees a Machine now. */
export interface SeenAddress {
  host: string
  port: number
}

export interface LinkConnectionsOptions {
  /** The pause before the first retry; 1 s by default. */
  firstDelayMs?: number
  /** The longest pause between retries; 30 s by default. */
  maxDelayMs?: number
  /** Where Bonjour sees Linked machine `id` now (discovery.ts, lastSeen); none by default. */
  seenAt?: (id: string) => SeenAddress | undefined
  /** Where a failed dial is told, once per new reason (the journal, log-file.ts); console.log by default. */
  log?: (message: string) => void
}

interface Peer {
  timer: NodeJS.Timeout | null
  /** Failed dials in a row: the next pause is delayFor(failures), at least the first one. */
  failures: number
  dialing: boolean
  /** A dial at once was asked for while one ran: when that one fails, the next starts without the pause. */
  again: boolean
  /** The last reason a dial failed; for a tooltip, never a token. */
  lastError: string | null
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class LinkConnections extends EventEmitter<{ changed: [] }> {
  private readonly peers = new Map<string, Peer>()
  private readonly firstDelayMs: number
  private readonly maxDelayMs: number
  private readonly seenAt: (id: string) => SeenAddress | undefined
  private readonly log: (message: string) => void
  private readonly subscriptions: [string, (...args: never[]) => void][] = []
  private started = false
  private stopped = false

  constructor(
    private readonly service: LinkService,
    options: LinkConnectionsOptions = {},
  ) {
    super()
    this.firstDelayMs = options.firstDelayMs ?? 1_000
    this.maxDelayMs = options.maxDelayMs ?? 30_000
    this.seenAt = options.seenAt ?? (() => undefined)
    this.log = options.log ?? ((message) => console.log(message))
  }

  /** Dials every Linked machine and follows the service from now on. */
  start(): void {
    if (this.started) return
    this.started = true
    this.listen('linked', ({ id }: { id: string }) => this.dial(id))
    this.listen('connected', ({ id }: { id: string }) => {
      const peer = this.peer(id)
      peer.failures = 0
      peer.lastError = null
      this.clearTimer(peer)
      this.emit('changed')
    })
    this.listen('disconnected', ({ id }: { id: string }) => {
      if (this.isLinked(id)) this.schedule(id)
      this.emit('changed')
    })
    this.listen('unlinked', ({ id }: { id: string }) => this.drop(id))
    this.listen('certificate-changed', () => this.emit('changed'))
    for (const machine of this.service.linkedMachines()) this.dial(machine.id)
  }

  /** Stops dialling; open connections stay with the service. */
  stop(): void {
    this.stopped = true
    for (const [event, listener] of this.subscriptions) this.service.off(event as 'linked', listener as never)
    this.subscriptions.length = 0
    for (const peer of this.peers.values()) this.clearTimer(peer)
    this.peers.clear()
  }

  /** Bonjour announced Linked machine `id` at host:port: when it is not connected, one dial there at once. */
  seen(id: string, host: string, port: number): void {
    if (this.stopped || this.service.isStopped || !this.isLinked(id) || this.service.isConnected(id)) return
    if (this.peers.get(id)?.dialing === true) return
    this.dial(id, { host, port })
  }

  /**
   * Dials Linked machine `id` now, or every one that is not connected when `id` is absent: the pause
   * is skipped and the count of failures starts again (wake-up, a new network, `link.reconnect`).
   */
  reconnect(id?: string): void {
    if (this.stopped || this.service.isStopped) return
    const ids = id === undefined ? this.service.linkedMachines().map((machine) => machine.id) : [id]
    for (const each of ids) {
      if (!this.isLinked(each) || this.service.isConnected(each)) continue
      const peer = this.peer(each)
      peer.failures = 0
      this.clearTimer(peer)
      if (peer.dialing) peer.again = true
      else this.dial(each)
    }
  }

  /** Whether any Linked machine is not connected (Bonjour then keeps searching for it). */
  anyUnavailable(): boolean {
    return this.service.linkedMachines().some((machine) => !this.service.isConnected(machine.id))
  }

  /** Whether a dial to `id` runs now; the row's "Reconnect" waits for it (worfy-link ticket 37). */
  isDialing(id: string): boolean {
    return this.peers.get(id)?.dialing === true
  }

  /** Why the last dial to `id` failed; null when it did not, or it is connected. */
  lastError(id: string): string | null {
    return this.service.isConnected(id) ? null : (this.peers.get(id)?.lastError ?? null)
  }

  /** The pause after `failures` failed dials in a row (1-based): firstDelayMs · 2^(failures − 1), at most maxDelayMs. */
  delayFor(failures: number): number {
    return Math.min(this.maxDelayMs, this.firstDelayMs * 2 ** Math.max(0, failures - 1))
  }

  private listen(event: string, listener: (payload: never) => void): void {
    this.service.on(event as 'linked', listener as never)
    this.subscriptions.push([event, listener])
  }

  private isLinked(id: string): boolean {
    return this.service.linkedMachines().some((machine) => machine.id === id)
  }

  private peer(id: string): Peer {
    let peer = this.peers.get(id)
    if (peer === undefined) {
      peer = { timer: null, failures: 0, dialing: false, again: false, lastError: null }
      this.peers.set(id, peer)
    }
    return peer
  }

  private clearTimer(peer: Peer): void {
    if (peer.timer !== null) clearTimeout(peer.timer)
    peer.timer = null
  }

  private drop(id: string): void {
    const peer = this.peers.get(id)
    if (peer !== undefined) this.clearTimer(peer)
    this.peers.delete(id)
    this.emit('changed')
  }

  private schedule(id: string): void {
    if (this.stopped || this.service.isStopped) return
    const peer = this.peer(id)
    if (peer.timer !== null || peer.dialing) return
    peer.timer = setTimeout(() => {
      peer.timer = null
      this.dial(id)
    }, this.delayFor(Math.max(1, peer.failures)))
    peer.timer.unref()
  }

  /**
   * Dials `id` at its remembered address and names, then where Bonjour sees it now when that is
   * elsewhere; or once at `via` (an address from Bonjour).
   */
  private dial(id: string, via?: SeenAddress): void {
    if (this.stopped || this.service.isStopped || !this.isLinked(id) || this.service.isConnected(id)) return
    const peer = this.peer(id)
    if (peer.dialing) return
    this.clearTimer(peer)
    peer.dialing = true
    peer.again = false
    // The windows show the dial (isDialing); its end announces itself below.
    this.emit('changed')
    this.attempt(id, via).then(
      () => {
        peer.dialing = false
        peer.again = false
        peer.failures = 0
        peer.lastError = null
        // Closed again right after opening: the 'disconnected' came while dialing, schedule now.
        if (!this.service.isConnected(id) && this.isLinked(id)) this.schedule(id)
        this.emit('changed')
      },
      (error: unknown) => {
        peer.dialing = false
        // Forgotten meanwhile (a 401 makes the service forget it): no more dials.
        if (!this.isLinked(id)) {
          this.peers.delete(id)
          this.emit('changed')
          return
        }
        // A failed try at an announced address does not lengthen the pause: the announcement may be forged.
        if (via === undefined) peer.failures += 1
        // Once per reason, not once per retry: a Machine that is off fails every 30 s for hours.
        const reason = messageOf(error)
        if (reason !== peer.lastError) {
          const name = this.service.linkedMachines().find((machine) => machine.id === id)?.name
          this.log(`[link] a dial to Machine ${id}${name === undefined ? '' : ` (${name})`} failed: ${reason}`)
        }
        peer.lastError = reason
        if (peer.again) {
          peer.again = false
          peer.failures = 0
          this.dial(id)
        } else if (!this.service.isConnected(id)) this.schedule(id)
        this.emit('changed')
      },
    )
  }

  /** One dial: `via`, or the remembered address and names, then the address Bonjour sees now. */
  private async attempt(id: string, via?: SeenAddress): Promise<void> {
    if (via !== undefined) return this.service.connect(id, via)
    try {
      await this.service.connect(id)
    } catch (error) {
      const seen = this.seenAt(id)
      const record = this.service.linkedMachines().find((machine) => machine.id === id)
      if (seen === undefined || record === undefined || this.stopped || this.service.isStopped || this.service.isConnected(id)) throw error
      if (seen.host === record.address && seen.port === record.port) throw error
      try {
        await this.service.connect(id, seen)
      } catch (second) {
        throw new Error(`${messageOf(error)}; at ${seen.host}:${seen.port}, where Bonjour sees it: ${messageOf(second)}`, { cause: second })
      }
    }
  }
}

/** What watchNetwork compares: every non-internal address, by interface, sorted. */
export function networkSignature(interfaces: ReturnType<typeof osNetworkInterfaces>): string {
  const entries: string[] = []
  for (const [name, list] of Object.entries(interfaces)) for (const entry of list ?? []) if (!entry.internal) entries.push(`${name} ${entry.address}`)
  return entries.sort().join('\n')
}

/**
 * Calls `changed` when the machine's addresses change: another network, a new DHCP address, the
 * Tailscale adapter up or down. Node and Electron have no event for it, so the interfaces are read
 * every `intervalMs` (5 s by default). Returns the stop.
 */
export function watchNetwork(
  changed: () => void,
  options: { interfaces?: () => ReturnType<typeof osNetworkInterfaces>; intervalMs?: number } = {},
): () => void {
  const read = options.interfaces ?? osNetworkInterfaces
  const signature = (): string | undefined => {
    try {
      return networkSignature(read())
    } catch {
      // Unreadable this time (it throws on some systems while an adapter goes away): the next read decides.
      return undefined
    }
  }
  let last = signature()
  const timer = setInterval(() => {
    const now = signature()
    if (now === undefined || now === last) return
    const first = last === undefined
    last = now
    if (!first) changed()
  }, options.intervalMs ?? 5_000)
  timer.unref()
  return () => clearInterval(timer)
}
