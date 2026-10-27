// Finding other worfy by Bonjour and reading an address typed by hand (worfy-link ticket 02;
// ADR-0052, point 4). mDNS is replaced by a fake backend: no socket is opened, and macOS never asks
// for the Local Network permission during a run.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bonjourBackend,
  dialAddress,
  instanceName,
  LinkDiscovery,
  MAX_FOUND,
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
  /** What reached the network, in order: announcements, goodbyes, the socket closing. */
  readonly wire: string[] = []
  browsers = 0
  destroyed = false
  refreshes = 0
  private events: { up(service: MdnsService): void; down(service: MdnsService): void; answered?(service: MdnsService): void } | undefined

  publish(announcement: { name: string; port: number; txt: Record<string, string> }) {
    const entry = { ...announcement, stopped: false }
    this.published.push(entry)
    this.wire.push(`announce ${announcement.port}`)
    // The goodbye goes out a moment later, as bonjour-service's callback does.
    return {
      stop: () =>
        new Promise<void>((done) =>
          setTimeout(() => {
            entry.stopped = true
            this.wire.push(`goodbye ${announcement.port}`)
            done()
          }, 5),
        ),
    }
  }

  browse(events: { up(service: MdnsService): void; down(service: MdnsService): void; answered?(service: MdnsService): void }) {
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
    this.wire.push('closed')
  }

  up(service: MdnsService): void {
    this.events?.up(service)
  }

  down(service: MdnsService): void {
    this.events?.down(service)
  }

  /** A known announcement answered the search again: bonjour-service says nothing, the backend says `answered`. */
  answered(service: MdnsService): void {
    this.events?.answered?.(service)
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

afterEach(async () => {
  await discovery?.stop()
  discovery = undefined
  vi.useRealTimers()
})

function makeDiscovery(linked: Set<string> = new Set(), options: { now?: () => number } = {}) {
  const mdns = new FakeMdns()
  discovery = new LinkDiscovery({ backend: mdns, self: () => SELF, isLinked: (id) => linked.has(id), protocol: 1, ...options })
  return { mdns, discovery, linked }
}

describe('the list of found worfy', () => {
  it('leaves out this Machine and the Machines already linked', () => {
    const { mdns, discovery, linked } = makeDiscovery(new Set([LINKED]))
    discovery.browse('linking', true)
    mdns.up(worfy(SELF.id, SELF.name))
    mdns.up(worfy(OTHER, 'Laptop'))
    mdns.up(worfy(LINKED, 'Office'))
    expect(discovery.list()).toEqual([{ id: OTHER, name: 'Laptop', host: '192.168.1.20', port: 52000, protocol: 1, compatible: true, conflict: false }])

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
      { id: OTHER, name: 'Laptop', host: '192.168.1.20', port: 52000, protocol: null, compatible: false, conflict: false },
      { id: OLD, name: 'Old Mac', host: '192.168.1.20', port: 52000, protocol: 2, compatible: false, conflict: false },
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

  it('ignores services without a Machine id', () => {
    const { mdns, discovery } = makeDiscovery()
    discovery.browse('linking', true)
    mdns.up({ name: 'printer', host: 'printer.local', port: 631, txt: {} })
    mdns.up({ name: 'bad', host: 'bad.local', port: 1, txt: { id: 'not-a-uuid' } })
    expect(discovery.list()).toEqual([])
  })

  it('lists both addresses when two announcements claim one Machine id, each marked as a conflict', () => {
    const { mdns, discovery } = makeDiscovery()
    discovery.browse('linking', true)
    mdns.up(worfy(OTHER, 'Laptop', { fqdn: 'a' }))
    // The same announcement on two interfaces is one entry, not a conflict.
    mdns.up(worfy(OTHER, 'Laptop', { fqdn: 'a2' }))
    expect(discovery.list()).toEqual([{ id: OTHER, name: 'Laptop', host: '192.168.1.20', port: 52000, protocol: 1, compatible: true, conflict: false }])
    mdns.up(worfy(OTHER, 'Laptop', { fqdn: 'b', addresses: ['10.0.0.5'] }))
    expect(discovery.list()).toEqual([
      { id: OTHER, name: 'Laptop', host: '10.0.0.5', port: 52000, protocol: 1, compatible: true, conflict: true },
      { id: OTHER, name: 'Laptop', host: '192.168.1.20', port: 52000, protocol: 1, compatible: true, conflict: true },
    ])
  })

  it('takes only local-network addresses, and a host name only under .local', () => {
    const { mdns, discovery } = makeDiscovery()
    discovery.browse('linking', true)
    mdns.up({ ...worfy(OTHER, 'Laptop'), host: 'evil.example.com', addresses: ['8.8.8.8', '2001:db8::5'] })
    expect(discovery.list()).toEqual([])
    mdns.up({ ...worfy(OTHER, 'Laptop'), host: 'laptop.local.', addresses: ['8.8.8.8'] })
    expect(discovery.list()).toMatchObject([{ id: OTHER, host: 'laptop.local' }])
  })

  it(`keeps at most ${MAX_FOUND} announcements and ignores more until some leave`, () => {
    const { mdns, discovery } = makeDiscovery()
    discovery.browse('linking', true)
    const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    for (let n = 0; n < MAX_FOUND + 10; n += 1) mdns.up(worfy(id(n), `M${n}`, { fqdn: `m${n}` }))
    expect(discovery.list()).toHaveLength(MAX_FOUND)
    expect(discovery.list().some((machine) => machine.id === id(MAX_FOUND))).toBe(false)
    mdns.down(worfy(id(0), 'M0', { fqdn: 'm0' }))
    mdns.up(worfy(id(MAX_FOUND), `M${MAX_FOUND}`, { fqdn: `m${MAX_FOUND}` }))
    expect(discovery.list().some((machine) => machine.id === id(MAX_FOUND))).toBe(true)
  })

  it('tells about a Linked machine it found (for reconnecting), without listing it, at most once per 10 s', () => {
    let now = 1_000_000
    const { mdns, discovery } = makeDiscovery(new Set([LINKED]), { now: () => now })
    const seen: FoundMachine[] = []
    discovery.on('seen', (machine) => seen.push(machine))
    discovery.browse('reconnect', true)
    mdns.up(worfy(LINKED, 'Office', { port: 53000, addresses: ['192.168.1.30'] }))
    mdns.up(worfy(OTHER, 'Laptop'))
    expect(seen).toEqual([{ id: LINKED, name: 'Office', host: '192.168.1.30', port: 53000, protocol: 1 }])
    expect(discovery.lastSeen(LINKED)).toEqual(seen[0])

    // A flood of announcements for the same id: still one sighting in 10 s.
    for (let n = 0; n < 20; n += 1) mdns.up(worfy(LINKED, 'Office', { port: 54000 + n, fqdn: `flood${n}`, addresses: ['192.168.1.66'] }))
    now += 9_999
    mdns.up(worfy(LINKED, 'Office', { port: 53001, addresses: ['192.168.1.30'] }))
    expect(seen).toHaveLength(1)
    now += 1
    mdns.up(worfy(LINKED, 'Office', { port: 53002, addresses: ['192.168.1.30'] }))
    expect(seen).toHaveLength(2)
    expect(seen[1]).toMatchObject({ port: 53002 })
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

  describe('whether a Linked machine answers the search (the Windows hint, worfy-link ticket 36)', () => {
    const office = worfy(LINKED, 'Office')
    const start = () => {
      vi.useFakeTimers()
      const mdns = new FakeMdns()
      const found = new LinkDiscovery({ backend: mdns, self: () => SELF, isLinked: (id) => id === LINKED, protocol: 1, refreshMs: 1000 })
      discovery = found
      let changes = 0
      found.on('changed', () => (changes += 1))
      found.browse('reconnect', true)
      mdns.up(office)
      return { mdns, found, changes: () => changes }
    }

    it('gone without a goodbye: it stops counting once no answer came for three refreshes, though its announcement is kept, and the row changes', () => {
      const { found, changes } = start()
      expect(found.answeredRecently(LINKED)).toBe(true)
      vi.advanceTimersByTime(2999)
      expect(found.answeredRecently(LINKED)).toBe(true)
      const before = changes()
      vi.advanceTimersByTime(1001)
      expect(found.answeredRecently(LINKED)).toBe(false)
      // Kept until its TTL runs out (bonjour-service), so lastSeen still has it.
      expect(found.lastSeen(LINKED)).toBeDefined()
      expect(changes()).toBe(before + 1)
    })

    it('answers keep coming: it keeps counting, and nothing changes', () => {
      const { mdns, found, changes } = start()
      const before = changes()
      for (let second = 0; second < 20; second += 1) {
        vi.advanceTimersByTime(1000)
        mdns.answered(office)
      }
      expect(found.answeredRecently(LINKED)).toBe(true)
      expect(changes()).toBe(before)
    })

    it('answers again after it stopped: it counts again, and the row changes', () => {
      const { mdns, found, changes } = start()
      vi.advanceTimersByTime(5000)
      expect(found.answeredRecently(LINKED)).toBe(false)
      const before = changes()
      mdns.answered(office)
      expect(found.answeredRecently(LINKED)).toBe(true)
      expect(changes()).toBe(before + 1)
    })

    it('a goodbye: it stops counting at once', () => {
      const { mdns, found } = start()
      mdns.down(office)
      expect(found.answeredRecently(LINKED)).toBe(false)
    })

    it('an answer of a Machine that is not Linked, or while nothing is searched for, does not count', () => {
      const { mdns, found } = start()
      mdns.answered(worfy(OTHER, 'Laptop'))
      expect(found.answeredRecently(OTHER)).toBe(false)
      found.browse('reconnect', false)
      expect(found.answeredRecently(LINKED)).toBe(false)
    })
  })

  it('announces this Machine with its id, protocol and name on the server port, and stops when the server does', async () => {
    const { mdns, discovery } = makeDiscovery()
    discovery.advertise(52000)
    discovery.advertise(52000)
    expect(mdns.published).toEqual([{ name: 'Studio (11111111)', port: 52000, txt: { id: SELF.id, proto: '1', name: 'Studio' }, stopped: false }])
    discovery.advertise(52001)
    await vi.waitFor(() => expect(mdns.published[0]?.stopped).toBe(true))
    expect(mdns.published.map((entry) => [entry.port, entry.stopped])).toEqual([
      [52000, true],
      [52001, false],
    ])
    discovery.advertise(null)
    await vi.waitFor(() => expect(mdns.published.every((entry) => entry.stopped)).toBe(true))
  })

  it('stop sends the goodbye before it closes the socket, and resolves once both are done', async () => {
    const { mdns, discovery } = makeDiscovery()
    discovery.advertise(52000)
    discovery.browse('linking', true)
    await discovery.stop()
    expect(mdns.wire).toEqual(['announce 52000', 'goodbye 52000', 'closed'])
    expect(mdns.browsers).toBe(0)
    // Stopped for good: nothing is announced again.
    discovery.advertise(52001)
    expect(mdns.wire).toHaveLength(3)
  })

  it('keeps the instance name within one DNS label', () => {
    const name = instanceName({ id: SELF.id, name: 'x'.repeat(100) })
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63)
    expect(name.endsWith(' (11111111)')).toBe(true)
  })

  it('dials a local IPv4 address first, then a local IPv6 address without a zone, then a .local name', () => {
    expect(dialAddress({ host: 'a.local', addresses: ['fe80::1', 'fd00::5', '192.168.1.9'] })).toBe('192.168.1.9')
    expect(dialAddress({ host: 'a.local', addresses: ['fe80::1', 'fd00::5'] })).toBe('fd00::5')
    expect(dialAddress({ host: 'a.local.', addresses: ['fe80::1', '2001:db8::5', '8.8.8.8'] })).toBe('a.local')
    expect(dialAddress({ host: 'a.example.com', addresses: ['8.8.8.8'] })).toBeUndefined()
  })
})

describe('bonjourBackend', () => {
  it('maps announcing and searching onto bonjour-service as _worfy._tcp, and opens nothing before the first use', async () => {
    // Each find() is a browser of its own, with its listeners.
    const browsers: { listeners: Map<string, (service: MdnsService) => void>; on: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; expire: ReturnType<typeof vi.fn> }[] = []
    const makeBrowser = () => {
      const listeners = new Map<string, (service: MdnsService) => void>()
      const made = { listeners, on: vi.fn((event: string, listener: (service: MdnsService) => void) => listeners.set(event, listener)), stop: vi.fn(), update: vi.fn(), expire: vi.fn() }
      browsers.push(made)
      return made
    }
    let goodbyeSent: (() => void) | undefined
    const service = { stop: vi.fn((callback: () => void) => (goodbyeSent = callback)), on: vi.fn() }
    const fake = { publish: vi.fn(() => service), find: vi.fn(makeBrowser), destroy: vi.fn() }
    const create = vi.fn(() => fake as unknown as BonjourLike)
    const backend = bonjourBackend({ create, interfaces: () => ['192.168.1.20'], warn: () => undefined })
    expect(create).not.toHaveBeenCalled()

    const handle = backend.publish({ name: 'Studio (11111111)', port: 52000, txt: { id: SELF.id, proto: '1', name: 'Studio' } })
    expect(create).toHaveBeenCalledWith({ interface: '192.168.1.20', bind: '0.0.0.0' })
    expect(fake.publish).toHaveBeenCalledWith({ name: 'Studio (11111111)', type: 'worfy', protocol: 'tcp', port: 52000, txt: { id: SELF.id, proto: '1', name: 'Studio' }, probe: false, host: 'worfy-11111111.local', disableIPv6: true })
    let stopped = false
    void handle.stop().then(() => (stopped = true))
    expect(service.stop).toHaveBeenCalled()
    await Promise.resolve()
    expect(stopped).toBe(false)
    goodbyeSent?.()
    await vi.waitFor(() => expect(stopped).toBe(true))

    const up = vi.fn()
    const down = vi.fn()
    const answered = vi.fn()
    const search = backend.browse({ up, down, answered })
    expect(fake.find).toHaveBeenCalledWith({ type: 'worfy', protocol: 'tcp' })
    const kept = browsers[0]!
    const found = worfy(OTHER, 'Laptop')
    kept.listeners.get('up')?.(found)
    kept.listeners.get('txt-update')?.(found)
    kept.listeners.get('down')?.(found)
    expect(up).toHaveBeenCalledTimes(2)
    expect(down).toHaveBeenCalledWith(found)
    expect(answered).not.toHaveBeenCalled()
    // A refresh drops what expired and asks again from a new browser, whose every answer is `answered`.
    search.refresh()
    expect(kept.expire).toHaveBeenCalled()
    expect(fake.find).toHaveBeenCalledTimes(2)
    const question = browsers[1]!
    question.listeners.get('up')?.(found)
    expect(answered).toHaveBeenCalledWith(found)
    expect(up).toHaveBeenCalledTimes(2)
    // The next refresh asks from another new one; the last one stops.
    search.refresh()
    expect(question.stop).toHaveBeenCalled()
    expect(browsers).toHaveLength(3)
    search.stop()
    expect(kept.stop).toHaveBeenCalled()
    expect(browsers[2]!.stop).toHaveBeenCalled()
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
