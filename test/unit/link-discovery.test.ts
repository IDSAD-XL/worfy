// Finding other worfy by Bonjour and reading an address typed by hand (worfy-link ticket 02;
// ADR-0052, point 4). mDNS is replaced by a fake backend: no socket is opened, and macOS never asks
// for the Local Network permission during a run.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bonjourBackend,
  dialAddress,
  instanceName,
  LinkDiscovery,
  type BonjourLike,
  type FoundMachine,
  type MdnsBackend,
  type MdnsService,
} from '../../src/main/link/discovery'
import { formatLinkAddress, parseLinkAddress } from '../../src/shared/ipc/link'

const SELF = { id: '11111111-1111-4111-8111-111111111111', name: 'Studio' }
const OTHER = '22222222-2222-4222-8222-222222222222'
const LINKED = '33333333-3333-4333-8333-333333333333'
const OLD = '44444444-4444-4444-8444-444444444444'

/** An mDNS backend that records what is announced and lets the test play the network. */
class FakeMdns implements MdnsBackend {
  readonly published: { name: string; port: number; txt: Record<string, string>; stopped: boolean }[] = []
  browsers = 0
  destroyed = false
  refreshes = 0
  private events: { up(service: MdnsService): void; down(service: MdnsService): void } | undefined

  publish(announcement: { name: string; port: number; txt: Record<string, string> }) {
    const entry = { ...announcement, stopped: false }
    this.published.push(entry)
    return { stop: () => (entry.stopped = true) }
  }

  browse(events: { up(service: MdnsService): void; down(service: MdnsService): void }) {
    this.browsers += 1
    this.events = events
    return {
      stop: () => {
        this.browsers -= 1
        this.events = undefined
      },
      refresh: () => (this.refreshes += 1),
    }
  }

  destroy(): void {
    this.destroyed = true
  }

  up(service: MdnsService): void {
    this.events?.up(service)
  }

  down(service: MdnsService): void {
    this.events?.down(service)
  }
}

const worfy = (id: string, name: string, options: { port?: number; proto?: string; addresses?: string[]; fqdn?: string } = {}): MdnsService => ({
  name: `${name} (${id.slice(0, 8)})`,
  fqdn: options.fqdn ?? `${name} (${id.slice(0, 8)})._worfy._tcp.local`,
  host: `${name.toLowerCase()}.local`,
  port: options.port ?? 52000,
  addresses: options.addresses ?? ['192.168.1.20', 'fe80::1'],
  txt: { id, proto: options.proto ?? '1', name },
})

let discovery: LinkDiscovery | undefined

afterEach(() => {
  discovery?.stop()
  discovery = undefined
  vi.useRealTimers()
})

function makeDiscovery(linked: Set<string> = new Set()) {
  const mdns = new FakeMdns()
  discovery = new LinkDiscovery({ backend: mdns, self: () => SELF, isLinked: (id) => linked.has(id), protocol: 1 })
  return { mdns, discovery, linked }
}

describe('the list of found worfy', () => {
  it('leaves out this Machine and the Machines already linked', () => {
    const { mdns, discovery, linked } = makeDiscovery(new Set([LINKED]))
    discovery.browse('linking', true)
    mdns.up(worfy(SELF.id, SELF.name))
    mdns.up(worfy(OTHER, 'Laptop'))
    mdns.up(worfy(LINKED, 'Office'))
    expect(discovery.list()).toEqual([{ id: OTHER, name: 'Laptop', host: '192.168.1.20', port: 52000, protocol: 1, compatible: true }])

    // Linked meanwhile: it leaves the list.
    linked.add(OTHER)
    expect(discovery.list()).toEqual([])
  })

  it('shows a worfy of another link protocol, marked incompatible', () => {
    const { mdns, discovery } = makeDiscovery()
    discovery.browse('linking', true)
    mdns.up(worfy(OLD, 'Old Mac', { proto: '2' }))
    mdns.up(worfy(OTHER, 'Laptop', { proto: 'x' }))
    expect(discovery.list()).toEqual([
      { id: OTHER, name: 'Laptop', host: '192.168.1.20', port: 52000, protocol: null, compatible: false },
      { id: OLD, name: 'Old Mac', host: '192.168.1.20', port: 52000, protocol: 2, compatible: false },
    ])
  })

  it('drops a worfy that left the network, and says the list changed', () => {
    const { mdns, discovery } = makeDiscovery()
    const changes = vi.fn()
    discovery.on('changed', changes)
    discovery.browse('linking', true)
    const laptop = worfy(OTHER, 'Laptop')
    mdns.up(laptop)
    expect(discovery.list()).toHaveLength(1)
    mdns.down(laptop)
    expect(discovery.list()).toEqual([])
    expect(changes).toHaveBeenCalledTimes(2)
    // A goodbye for something never found changes nothing.
    mdns.down(worfy(OLD, 'Old Mac'))
    expect(changes).toHaveBeenCalledTimes(2)
  })

  it('ignores services without a Machine id, and lists one entry per Machine', () => {
    const { mdns, discovery } = makeDiscovery()
    discovery.browse('linking', true)
    mdns.up({ name: 'printer', host: 'printer.local', port: 631, txt: {} })
    mdns.up({ name: 'bad', host: 'bad.local', port: 1, txt: { id: 'not-a-uuid' } })
    mdns.up(worfy(OTHER, 'Laptop', { fqdn: 'a' }))
    mdns.up(worfy(OTHER, 'Laptop', { fqdn: 'b', addresses: ['10.0.0.5'] }))
    expect(discovery.list()).toEqual([{ id: OTHER, name: 'Laptop', host: '10.0.0.5', port: 52000, protocol: 1, compatible: true }])
  })

  it('tells about a Linked machine it found (for reconnecting), without listing it', () => {
    const { mdns, discovery } = makeDiscovery(new Set([LINKED]))
    const seen: FoundMachine[] = []
    discovery.on('seen', (machine) => seen.push(machine))
    discovery.browse('reconnect', true)
    mdns.up(worfy(LINKED, 'Office', { port: 53000, addresses: ['192.168.1.30'] }))
    mdns.up(worfy(OTHER, 'Laptop'))
    expect(seen).toEqual([{ id: LINKED, name: 'Office', host: '192.168.1.30', port: 53000, protocol: 1 }])
    expect(discovery.lastSeen(LINKED)).toEqual(seen[0])
  })
})

describe('searching and announcing', () => {
  it('searches while any reason holds, and forgets what it found when it stops', () => {
    const { mdns, discovery } = makeDiscovery()
    discovery.browse('linking', true)
    discovery.browse('reconnect', true)
    expect(mdns.browsers).toBe(1)
    mdns.up(worfy(OTHER, 'Laptop'))
    discovery.browse('linking', false)
    expect(discovery.browsing).toBe(true)
    expect(discovery.list()).toHaveLength(1)
    discovery.browse('reconnect', false)
    expect(mdns.browsers).toBe(0)
    expect(discovery.list()).toEqual([])
    // Nothing comes in while it does not search.
    mdns.up(worfy(OTHER, 'Laptop'))
    expect(discovery.list()).toEqual([])
  })

  it('asks the network again while it searches', () => {
    vi.useFakeTimers()
    const mdns = new FakeMdns()
    discovery = new LinkDiscovery({ backend: mdns, self: () => SELF, isLinked: () => false, protocol: 1, refreshMs: 1000 })
    discovery.browse('linking', true)
    vi.advanceTimersByTime(3500)
    expect(mdns.refreshes).toBe(3)
    discovery.browse('linking', false)
    vi.advanceTimersByTime(3000)
    expect(mdns.refreshes).toBe(3)
  })

  it('announces this Machine with its id, protocol and name on the server port, and stops when the server does', () => {
    const { mdns, discovery } = makeDiscovery()
    discovery.advertise(52000)
    discovery.advertise(52000)
    expect(mdns.published).toEqual([{ name: 'Studio (11111111)', port: 52000, txt: { id: SELF.id, proto: '1', name: 'Studio' }, stopped: false }])
    discovery.advertise(52001)
    expect(mdns.published.map((entry) => [entry.port, entry.stopped])).toEqual([
      [52000, true],
      [52001, false],
    ])
    discovery.advertise(null)
    expect(mdns.published.every((entry) => entry.stopped)).toBe(true)
    discovery.stop()
    expect(mdns.destroyed).toBe(true)
  })

  it('keeps the instance name within one DNS label', () => {
    const name = instanceName({ id: SELF.id, name: 'x'.repeat(100) })
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63)
    expect(name.endsWith(' (11111111)')).toBe(true)
  })

  it('dials IPv4 first, then an IPv6 address without a zone, then the host name', () => {
    expect(dialAddress({ host: 'a.local', addresses: ['fe80::1', '2001:db8::5', '192.168.1.9'] })).toBe('192.168.1.9')
    expect(dialAddress({ host: 'a.local', addresses: ['fe80::1', '2001:db8::5'] })).toBe('2001:db8::5')
    expect(dialAddress({ host: 'a.local.', addresses: ['fe80::1'] })).toBe('a.local')
  })
})

describe('bonjourBackend', () => {
  it('maps announcing and searching onto bonjour-service as _worfy._tcp, and opens nothing before the first use', () => {
    const listeners = new Map<string, (service: MdnsService) => void>()
    const browser = { on: vi.fn((event: string, listener: (service: MdnsService) => void) => listeners.set(event, listener)), stop: vi.fn(), update: vi.fn(), expire: vi.fn() }
    const service = { stop: vi.fn(), on: vi.fn() }
    const fake = { publish: vi.fn(() => service), find: vi.fn(() => browser), destroy: vi.fn() }
    const create = vi.fn(() => fake as unknown as BonjourLike)
    const backend = bonjourBackend({ create, warn: () => undefined })
    expect(create).not.toHaveBeenCalled()

    const handle = backend.publish({ name: 'Studio (11111111)', port: 52000, txt: { id: SELF.id, proto: '1', name: 'Studio' } })
    expect(fake.publish).toHaveBeenCalledWith({ name: 'Studio (11111111)', type: 'worfy', protocol: 'tcp', port: 52000, txt: { id: SELF.id, proto: '1', name: 'Studio' } })
    handle.stop()
    expect(service.stop).toHaveBeenCalled()

    const up = vi.fn()
    const down = vi.fn()
    const search = backend.browse({ up, down })
    expect(fake.find).toHaveBeenCalledWith({ type: 'worfy', protocol: 'tcp' })
    const found = worfy(OTHER, 'Laptop')
    listeners.get('up')?.(found)
    listeners.get('txt-update')?.(found)
    listeners.get('down')?.(found)
    expect(up).toHaveBeenCalledTimes(2)
    expect(down).toHaveBeenCalledWith(found)
    search.refresh()
    expect(browser.expire).toHaveBeenCalled()
    expect(browser.update).toHaveBeenCalled()
    search.stop()
    expect(browser.stop).toHaveBeenCalled()
    backend.destroy()
    expect(fake.destroy).toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('an address typed by hand', () => {
  it.each([
    ['192.168.1.20:52000', { host: '192.168.1.20', port: 52000 }],
    ['  studio.local:4000 ', { host: 'studio.local', port: 4000 }],
    ['localhost:1', { host: 'localhost', port: 1 }],
    ['[::1]:52000', { host: '::1', port: 52000 }],
    ['[fe80::1%en0]:52000', { host: 'fe80::1%en0', port: 52000 }],
    ['127.0.0.1:65535', { host: '127.0.0.1', port: 65535 }],
  ])('reads %s', (text, address) => {
    expect(parseLinkAddress(text)).toEqual({ ok: true, address })
  })

  it.each([
    ['', 'Type the address as host:port'],
    ['192.168.1.20', 'Add the port: host:port'],
    ['[::1]', 'Add the port: host:port'],
    ['::1:52000', 'Put an IPv6 address in brackets: [::1]:port'],
    ['[::1:52000', 'An IPv6 address needs its closing bracket: [::1]:port'],
    ['[::1]52000', 'Write the port after the bracket: [::1]:port'],
    ['[studio]:52000', 'Not an IPv6 address: studio'],
    ['host:', 'Not a port: (empty)'],
    [':52000', 'Not a host name or address: (empty)'],
    ['host:port', 'Not a port: port'],
    ['host:70000', 'The port is 1 to 65535, not 70000'],
    ['host:0', 'The port is 1 to 65535, not 0'],
    ['http://host:52000', 'Type only host:port, without http:// or another scheme'],
    ['two words:52000', 'Not a host name or address: two words'],
    ['-bad-:52000', 'Not a host name or address: -bad-'],
  ])('refuses %j with a reason for the field', (text, error) => {
    expect(parseLinkAddress(text)).toEqual({ ok: false, error })
  })

  it('writes an IPv6 address back in brackets', () => {
    expect(formatLinkAddress({ host: '::1', port: 52000 })).toBe('[::1]:52000')
    expect(formatLinkAddress({ host: '10.0.0.5', port: 52000 })).toBe('10.0.0.5:52000')
  })
})
