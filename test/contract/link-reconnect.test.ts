// Reconnecting after a change of address, a sleep or a change of network (worfy-link ticket 36):
// the limit on a dial, dialling at once on wake-up, a new network and `link.reconnect`, announcing
// again on Bonjour, the `.local` and MagicDNS names, and setting an address by hand. Real link
// services over temporary data folders on 127.0.0.1 (test/contract/link-bench.ts), except where the
// timing of retries is counted under fake timers.
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { firewallHint } from '../../src/main/ipc/link'
import { LinkConnections, networkSignature } from '../../src/main/link/connections'
import {
  bonjourBackend,
  dialAddress,
  LinkDiscovery,
  worfyHost,
  mdnsInterfaces,
  mdnsName,
  onSameNetwork,
  type BonjourLike,
  type BonjourSocketOptions,
  type MdnsBackend,
} from '../../src/main/link/discovery'
import { LinkLogFile, teeLinkConsole } from '../../src/main/link/log-file'
import { LinkService, stopLink, wireAppLink, type AppLink, type LinkServiceOptions } from '../../src/main/link/service'
import { accessOf } from '../../src/shared/ipc/channels'
import '../../src/shared/ipc/link'
import { LinkBench, type BenchMachine } from './link-bench'

let bench: LinkBench
const keepers: LinkConnections[] = []
const links: AppLink[] = []
const servers: Server[] = []

beforeEach(() => {
  bench = new LinkBench()
})

afterEach(async () => {
  vi.useRealTimers()
  for (const keeper of keepers.splice(0)) keeper.stop()
  for (const link of links.splice(0)) await stopLink(link)
  for (const server of servers.splice(0)) server.close()
  // No pairing code and no token in the console output.
  expect(bench.leakedSecrets()).toEqual([])
  await bench.close()
})

const until = (check: () => boolean, timeout = 5_000): Promise<void> => vi.waitFor(() => expect(check()).toBe(true), { timeout, interval: 10 })
const online = (from: BenchMachine, to: BenchMachine): boolean => from.service.isConnected(to.service.machine.id)
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
const recordOf = (from: BenchMachine, to: BenchMachine) => from.service.linkedMachines().find((machine) => machine.id === to.service.machine.id)

/** Keeps `machine`'s connections with a pause of a minute: no retry comes within a test. */
function keepSlowly(machine: BenchMachine): LinkConnections {
  const keeper = new LinkConnections(machine.service, { firstDelayMs: 60_000, maxDelayMs: 60_000 })
  keeper.start()
  keepers.push(keeper)
  return keeper
}

const LOOPBACK: NetworkInterfaceInfo = { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }

/** Starts `machine` again over its data folder with `extra` options (the bench's own, otherwise). */
async function restartWith(machine: BenchMachine, extra: Partial<LinkServiceOptions>): Promise<void> {
  await machine.service.stop()
  machine.service = await LinkService.start({
    dataDir: machine.dataDir,
    buildKind: 'packaged',
    buildVersion: '0.2.0+bench',
    listenHost: '127.0.0.1',
    hostname: () => `${machine.label}.local`,
    networkInterfaces: () => ({ lo0: [LOOPBACK] }),
    now: () => bench.now,
    ipcModules: { './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default) },
    ...extra,
  })
}

/** A TCP server on `port` that takes every connection and never says a word, TLS included. */
function silentServer(port: number): Promise<{ server: Server; sockets: Socket[] }> {
  const sockets: Socket[] = []
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      sockets.push(socket)
      socket.on('error', () => undefined)
      // Read and drop what comes (the ClientHello), so the client closing it is seen.
      socket.resume()
    })
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      servers.push(server)
      server.on('close', () => sockets.forEach((socket) => socket.destroy()))
      resolve({ server, sockets })
    })
  })
}

/** Rewrites `machine`'s record of `other` in link/linked.json; the service must be stopped. */
function editRecord(machine: BenchMachine, other: BenchMachine, change: Record<string, unknown>): void {
  const file = join(machine.dataDir, 'link', 'linked.json')
  const data = JSON.parse(readFileSync(file, 'utf8')) as { machines: Record<string, unknown>[] }
  for (const record of data.machines) if (record.id === other.service.machine.id) Object.assign(record, change)
  writeFileSync(file, JSON.stringify(data))
}

describe('the limit on a dial', () => {
  it('a dial to an address that takes TCP and stays silent fails at the limit, and the next Bonjour announcement is dialled', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    await bench.link(a, b)
    const oldPort = bench.portOf(b)
    await b.service.stop()
    // Something else took B's old port: it takes TCP and never answers TLS.
    const silent = await silentServer(oldPort)
    await restartWith(a, { dialTimeoutMs: 300 })
    const keeper = keepSlowly(a)
    const id = b.service.machine.id

    const started = Date.now()
    await until(() => keeper.lastError(id) !== null, 3_000)
    expect(Date.now() - started).toBeLessThan(2_500)
    expect(keeper.lastError(id)).toContain('no answer within 0.3 s')
    expect(silent.sockets.length).toBeGreaterThan(0)
    await until(() => silent.sockets.every((socket) => socket.destroyed))

    // B is back elsewhere; its announcement is dialled: the failed dial is not "still dialling".
    await bench.restart(b)
    const newPort = bench.portOf(b)
    expect(newPort).not.toBe(oldPort)
    keeper.seen(id, '127.0.0.1', newPort)
    await until(() => online(a, b), 2_000)
    expect(recordOf(a, b)?.port).toBe(newPort)
  })
})

/** A power monitor for the test: suspend and resume are emitted by hand. */
class FakePower extends EventEmitter {}

/** A Bonjour backend that records what would reach the network. */
function recordingMdns(): MdnsBackend & { wire: string[] } {
  const wire: string[] = []
  return {
    wire,
    publish: ({ port }) => {
      wire.push(`announce ${port}`)
      return { stop: () => new Promise<void>((done) => setTimeout(() => (wire.push(`goodbye ${port}`), done()), 5)) }
    },
    browse: () => ({ stop: () => undefined, refresh: () => void wire.push('query') }),
    destroy: () => void wire.push('closed'),
  }
}

/** Interfaces the network watch reads; the test changes `address`. */
function fakeNetwork(): { address: string; read: () => Record<string, NetworkInterfaceInfo[]> } {
  const network = {
    address: '192.168.1.20',
    read: () => ({ lo0: [LOOPBACK], en0: [{ ...LOOPBACK, address: network.address, internal: false, cidr: `${network.address}/24` }] }),
  }
  return network
}

describe('dialling at once on wake-up and on a new network', () => {
  it('resume and a change of the machine addresses dial an unavailable Linked machine now, not after the pause', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    await bench.link(a, b)
    const power = new FakePower()
    const network = fakeNetwork()
    const link = wireAppLink(a.service, { bonjour: false, power, networkInterfaces: network.read, networkPollMs: 20, retry: { firstDelayMs: 60_000, maxDelayMs: 60_000 } })
    links.push(link)
    await until(() => online(a, b))

    for (const trigger of ['resume', 'network'] as const) {
      await b.service.stop()
      await until(() => !online(a, b))
      await bench.restart(b)
      // The next retry is a minute away.
      await pause(150)
      expect(online(a, b), trigger).toBe(false)
      if (trigger === 'resume') power.emit('resume')
      else network.address = '10.0.0.7'
      await until(() => online(a, b), 2_000)
    }
    expect(bench.captured.some((line) => line.startsWith('[link] this Machine woke up'))).toBe(true)
    expect(bench.captured.some((line) => line.startsWith('[link] the network of this Machine changed'))).toBe(true)
  })

  it('this Machine announces itself again after resume and after a change of network', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    const mdns = recordingMdns()
    const discovery = new LinkDiscovery({ backend: mdns, self: () => a.service.machine, isLinked: (id) => a.service.isLinked(id), protocol: 1 })
    const power = new FakePower()
    const network = fakeNetwork()
    const link = wireAppLink(a.service, { bonjour: true, discovery, power, networkInterfaces: network.read, networkPollMs: 20 })
    links.push(link)
    await bench.link(a, b)
    await until(() => online(a, b))
    const port = bench.portOf(a)
    expect(mdns.wire).toEqual([`announce ${port}`])

    power.emit('resume')
    await until(() => mdns.wire.length === 3)
    expect(mdns.wire).toEqual([`announce ${port}`, `goodbye ${port}`, `announce ${port}`])

    network.address = '10.0.0.7'
    await until(() => mdns.wire.length === 5)
    expect(mdns.wire.slice(3)).toEqual([`goodbye ${port}`, `announce ${port}`])
    // Nothing more while the network stays as it is.
    await pause(100)
    expect(mdns.wire).toHaveLength(5)
  })

  it('a network watch compares only the addresses outside loopback', () => {
    const one = { lo0: [LOOPBACK], en0: [{ ...LOOPBACK, address: '192.168.1.20', internal: false }] }
    expect(networkSignature(one)).toBe('en0 192.168.1.20')
    expect(networkSignature({ ...one, lo0: [{ ...LOOPBACK, address: '127.0.0.2' }] })).toBe(networkSignature(one))
    expect(networkSignature({ ...one, en0: [{ ...LOOPBACK, address: '10.0.0.7', internal: false }] })).not.toBe(networkSignature(one))
  })
})

/** A link service that only counts dials, for the timing of retries under fake timers. */
class DialCounter extends EventEmitter {
  readonly id = '55555555-5555-4555-8555-555555555555'
  isStopped = false
  connected = false
  readonly dials: { at: number; via?: { host: string; port: number } }[] = []

  connect(_id: string, via?: { host: string; port: number }): Promise<void> {
    this.dials.push({ at: Date.now(), ...(via === undefined ? {} : { via }) })
    return Promise.reject(new Error('unreachable'))
  }

  isConnected(): boolean {
    return this.connected
  }

  linkedMachines(): { id: string; address: string; port: number }[] {
    return [{ id: this.id, address: '192.168.1.30', port: 53000 }]
  }
}

describe('link.reconnect and the count of failures', () => {
  const bonjour = { host: '192.168.1.40', port: 53001 }

  function counted(seen?: { host: string; port: number }): { service: DialCounter; keeper: LinkConnections } {
    vi.useFakeTimers({ now: 0 })
    const service = new DialCounter()
    const keeper = new LinkConnections(service as unknown as LinkService, { seenAt: () => seen })
    keepers.push(keeper)
    return { service, keeper }
  }

  it('reconnect dials at once, the remembered address and then where Bonjour sees the Machine, and the pauses start again from 1 s', async () => {
    const { service, keeper } = counted(bonjour)
    keeper.start()
    // Failures at 0, 1, 3, 7 and 15 s: the next pause would be 16 s.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(service.dials.filter((dial) => dial.via === undefined).map((dial) => dial.at)).toEqual([0, 1_000, 3_000, 7_000, 15_000])
    service.dials.length = 0

    keeper.reconnect(service.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.dials).toEqual([{ at: 20_000 }, { at: 20_000, via: bonjour }])
    expect(keeper.lastError(service.id)).toContain('where Bonjour sees it')
    // The count of failures started again: the next retry is 1 s away, not 30 s.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(service.dials.map((dial) => dial.at)).toEqual([20_000, 20_000, 21_000, 21_000])
  })

  it('reconnect with no id dials every unavailable Linked machine; one Bonjour sees at its remembered address is dialled once', async () => {
    const { service, keeper } = counted({ host: '192.168.1.30', port: 53000 })
    keeper.start()
    await vi.advanceTimersByTimeAsync(10_000)
    service.dials.length = 0
    keeper.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.dials).toEqual([{ at: 10_000 }])
  })

  it('a reconnect while a dial runs dials again at once when that one fails; nothing while connected', async () => {
    vi.useFakeTimers({ now: 0 })
    const service = new DialCounter()
    let fail: (() => void) | undefined
    service.connect = (_id, via) => {
      service.dials.push({ at: Date.now(), ...(via === undefined ? {} : { via }) })
      if (service.dials.length === 1) return new Promise((_resolve, reject) => (fail = () => reject(new Error('timed out'))))
      return Promise.reject(new Error('unreachable'))
    }
    const keeper = new LinkConnections(service as unknown as LinkService)
    keepers.push(keeper)
    keeper.start()
    await vi.advanceTimersByTimeAsync(5_000)
    keeper.reconnect(service.id)
    expect(service.dials).toHaveLength(1)
    fail?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.dials.map((dial) => dial.at)).toEqual([0, 5_000])

    service.connected = true
    keeper.reconnect(service.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.dials).toHaveLength(2)
  })
})

describe('link.reconnect on either side', () => {
  for (const side of ['A', 'B'] as const) {
    it(`reconnect on ${side} brings the link back at once, without the pause of the retries`, async () => {
      const a = await bench.machine('a')
      const b = await bench.machine('b')
      await bench.link(a, b)
      const [dialer, other] = side === 'A' ? [a, b] : [b, a]
      const keeper = keepSlowly(dialer)
      await until(() => online(a, b) && online(b, a))

      // The other side goes away and comes back where it was, dialling nobody itself.
      await bench.restart(other)
      await until(() => !online(dialer, other))
      await pause(150)
      expect(online(dialer, other)).toBe(false)

      keeper.reconnect(other.service.machine.id)
      await until(() => online(dialer, other) && online(other, dialer), 2_000)
    })
  }
})

describe('the names of a Linked machine', () => {
  it('the remembered address does not answer: the .local name is dialled, and the address it resolved to is kept', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    await bench.link(a, b)
    await a.service.stop()
    // The address B had is gone (nothing listens on ::1); its mDNS name points at it now.
    editRecord(a, b, { address: '::1', localName: 'localhost' })
    await bench.restart(a)

    await a.service.connect(b.service.machine.id)
    expect(online(a, b)).toBe(true)
    expect(recordOf(a, b)?.address).toBe('127.0.0.1')
    expect(JSON.parse(readFileSync(join(a.dataDir, 'link', 'linked.json'), 'utf8')).machines[0].localName).toBe('localhost')
  })

  it('the MagicDNS name is dialled only while "Link through Tailscale" is on', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    await bench.link(a, b)
    await a.service.stop()
    editRecord(a, b, { address: '::1', tailnetName: 'localhost' })
    await bench.restart(a)

    const off = await a.service.connect(b.service.machine.id).catch((error: unknown) => error as Error)
    expect(off).toBeInstanceOf(Error)
    expect(String(off)).not.toContain('also tried')
    expect(online(a, b)).toBe(false)

    a.service.settings.set({ tailscale: true })
    await a.service.connect(b.service.machine.id)
    expect(online(a, b)).toBe(true)
    expect(recordOf(a, b)?.address).toBe('127.0.0.1')
  })

  it('a name where another worfy answers changes nothing, and the "certificate changed" mark waits for the names', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    const impostor = await bench.machine('impostor')
    await bench.link(a, b)
    await bench.codeOf(impostor)
    await a.service.stop()
    // The remembered address and port now answer with the impostor; so does the name.
    editRecord(a, b, { port: bench.portOf(impostor), localName: 'localhost' })
    await bench.restart(a)
    const before = recordOf(a, b)

    const error = await a.service.connect(b.service.machine.id).catch((caught: unknown) => caught as Error)
    expect(String(error)).toContain('also tried localhost')
    expect(String(error)).toContain('is not Machine')
    expect(recordOf(a, b)).toEqual({ ...before, certificateChanged: true })
  })

  it('another worfy at the remembered address: no "certificate changed" before the names are tried, and the name where the remembered certificate answers connects', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    const impostor = await bench.machine('impostor')
    await bench.link(a, b)
    const port = bench.portOf(b)
    // B moves to ::1 on the same port; another worfy takes 127.0.0.1 with that port.
    await restartWith(b, { listenHost: '::1' })
    expect(b.service.status()).toMatchObject({ listening: true, port })
    await impostor.service.stop()
    const machineFile = join(impostor.dataDir, 'link', 'machine.json')
    writeFileSync(machineFile, JSON.stringify({ ...JSON.parse(readFileSync(machineFile, 'utf8')), port }))
    await bench.restart(impostor)
    await bench.codeOf(impostor)
    expect(bench.portOf(impostor)).toBe(port)
    await a.service.stop()
    editRecord(a, b, { address: '127.0.0.1', port, localName: '::1' })
    await bench.restart(a)
    const marks: string[] = []
    a.service.on('certificate-changed', ({ id }) => marks.push(id))

    await a.service.connect(b.service.machine.id)
    expect(marks).toEqual([])
    expect(online(a, b)).toBe(true)
    expect(recordOf(a, b)).toMatchObject({ address: '::1', port, certificateChanged: false })
  })

  it('a .local name from Bonjour is kept only when it was announced at the address of an open connection', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    await bench.link(a, b)
    await a.service.connect(b.service.machine.id)
    const id = b.service.machine.id
    const localName = (): unknown => (JSON.parse(readFileSync(join(a.dataDir, 'link', 'linked.json'), 'utf8')) as { machines: { localName?: string }[] }).machines[0]?.localName

    a.service.learnLocalName(id, '192.168.1.66', 'evil.local')
    expect(localName()).toBeUndefined()
    a.service.learnLocalName(id, '127.0.0.1', 'B-Mac.local')
    expect(localName()).toBe('b-mac.local')
    // What an announcement may name: a `.local` name, or a bare computer name (Windows).
    expect([mdnsName('B-Mac.local.'), mdnsName('DESKTOP-7Q'), mdnsName('evil.example.com')]).toEqual(['b-mac.local', 'desktop-7q.local', undefined])
  })
})

describe('link.setAddress', () => {
  it('an address where another certificate answers is refused and the record stays; the right one is kept without linking again', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    const impostor = await bench.machine('impostor')
    await bench.link(a, b)
    await bench.codeOf(impostor)
    await b.service.stop()
    const before = recordOf(a, b)
    const id = b.service.machine.id
    const linked: string[] = []
    a.service.on('linked', (info) => linked.push(info.id))

    await expect(a.service.setAddress(id, { host: '127.0.0.1', port: bench.portOf(impostor) })).rejects.toThrow(/is not Machine .*another certificate; nothing was changed/)
    expect(recordOf(a, b)).toEqual(before)
    await expect(a.service.setAddress(id, { host: '127.0.0.1', port: before?.port ?? 0 })).rejects.toThrow(/could not reach/)
    expect(recordOf(a, b)).toEqual(before)

    // B comes back on another port: its old one is taken.
    const holder = await silentServer(before?.port ?? 0)
    await bench.restart(b)
    const newPort = bench.portOf(b)
    holder.server.close()
    const info = await a.service.setAddress(id, { host: 'localhost', port: newPort })
    expect(info).toMatchObject({ id, address: 'localhost', port: newPort, fingerprint: before?.fingerprint, connected: true })
    expect(linked).toEqual([])
    expect(b.service.pairingCode()).toBeNull()
  })
})

describe('stopping the link', () => {
  it('stops the journal last, after the service, and gives console its own methods back', async () => {
    const a = await bench.machine('a')
    const before = { log: console.log, warn: console.warn }
    const undo = teeLinkConsole(new LinkLogFile({ dir: join(a.dataDir, 'link') }))
    expect(console.warn).not.toBe(before.warn)
    let serviceStopped: boolean | undefined
    const link = wireAppLink(a.service, {
      bonjour: false,
      journal: {
        stop: () => {
          serviceStopped = a.service.isStopped
          undo()
        },
      },
    })
    console.warn('[link] before the stop')
    await stopLink(link)
    expect(serviceStopped).toBe(true)
    expect({ log: console.log, warn: console.warn }).toEqual(before)
    console.warn('[link] after the stop')
    const text = readFileSync(join(a.dataDir, 'link', 'link.log'), 'utf8')
    expect(text).toContain('[link] before the stop')
    expect(text).not.toContain('after the stop')
  })
})

describe('the new channels', () => {
  it('link.reconnect and link.setAddress are for this Machine\'s windows only', () => {
    expect(accessOf('link.reconnect')).toBe('local')
    expect(accessOf('link.setAddress')).toBe('local')
  })
})

describe('the Windows firewall hint', () => {
  const base = { platform: 'win32' as const, bonjour: true, connected: false, seen: false, port: 52000, program: 'C:\\dev\\electron.exe' }

  it('names the likely reasons and the firewall check for this program on Windows when Bonjour does not see an unavailable Machine; nothing otherwise', () => {
    expect(firewallHint(base)).toContain('off, asleep or on another network')
    expect(firewallHint(base)).toContain('lets C:\\dev\\electron.exe receive connections')
    expect(firewallHint(base)).toContain('UDP 5353')
    expect(firewallHint(base)).toContain('TCP 52000')
    expect(firewallHint(base)).not.toContain('Private')
    expect(firewallHint({ ...base, port: null })).toContain('its link port')
    expect(firewallHint({ ...base, platform: 'darwin' })).toBeUndefined()
    expect(firewallHint({ ...base, bonjour: false })).toBeUndefined()
    expect(firewallHint({ ...base, connected: true })).toBeUndefined()
    expect(firewallHint({ ...base, seen: true })).toBeUndefined()
  })
})

/** bonjour-service instances made by bonjourBackend, one per mDNS socket, with what each did. */
function fakeBonjour(): { create: (socket: BonjourSocketOptions) => BonjourLike; made: FakeInstance[] } {
  const made: FakeInstance[] = []
  return {
    made,
    create: (socket) => {
      const instance: FakeInstance = { socket, published: [], probes: [], hosts: [], goodbyes: [], browsers: 0, browsersStopped: 0, destroyed: false }
      made.push(instance)
      return {
        publish: ({ port, probe, host }) => {
          instance.published.push(port)
          instance.probes.push(probe)
          instance.hosts.push(host)
          return { stop: (done?: () => void) => (instance.goodbyes.push(port), done?.()), on: () => undefined }
        },
        find: () => {
          instance.browsers += 1
          return { on: () => undefined, stop: () => void (instance.browsersStopped += 1), update: () => undefined, expire: () => undefined }
        },
        destroy: () => void (instance.destroyed = true),
      }
    },
  }
}

/** A service as bonjour-service's Registry returns it. */
type BonjourLikeService = ReturnType<BonjourLike['publish']>

interface FakeInstance {
  socket: BonjourSocketOptions
  published: number[]
  /** The `probe` option of each announcement. */
  probes: (boolean | undefined)[]
  /** The `host` of each announcement: its SRV target. */
  hosts: (string | undefined)[]
  goodbyes: number[]
  browsers: number
  browsersStopped: number
  destroyed: boolean
}

const ipv4 = (address: string, netmask = '255.255.255.0', internal = false): NetworkInterfaceInfo => ({ address, netmask, family: 'IPv4', mac: '00:00:00:00:00:01', internal, cidr: `${address}/24` })

describe('one mDNS socket per interface that may carry the link', () => {
  it('lists local-network IPv4 interfaces only: no loopback, link-local, IPv6 or public address; Tailscale only with the setting on', () => {
    const pc: Record<string, NetworkInterfaceInfo[]> = {
      lo: [ipv4('127.0.0.1', '255.0.0.0', true)],
      'Radmin VPN': [ipv4('26.204.152.2', '255.0.0.0')],
      'vEthernet (WSL)': [ipv4('172.30.16.1', '255.255.240.0')],
      Ethernet: [ipv4('192.168.0.193'), { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '00:00:00:00:00:01', internal: false, cidr: 'fe80::1/64', scopeid: 4 }],
      APIPA: [ipv4('169.254.10.2', '255.255.0.0')],
      Tailscale: [ipv4('100.101.102.103', '255.255.255.255')],
    }
    expect(mdnsInterfaces(pc, false)).toEqual(['172.30.16.1', '192.168.0.193'])
    expect(mdnsInterfaces(pc, true)).toEqual(['172.30.16.1', '192.168.0.193', '100.101.102.103'])
  })

  it('announces and searches on every interface, each socket joined and sending on its own; follows a change; closes all on destroy', async () => {
    const fake = fakeBonjour()
    let addresses = ['192.168.0.193', '172.30.16.1']
    const backend = bonjourBackend({ create: fake.create, interfaces: () => addresses, warn: () => undefined })
    expect(fake.made).toEqual([])

    const announcement = backend.publish({ name: 'PC (11111111)', port: 52000, txt: { id: '11111111-1111-4111-8111-111111111111' } })
    const search = backend.browse({ up: () => undefined, down: () => undefined })
    expect(fake.made.map((instance) => instance.socket)).toEqual([
      { interface: '192.168.0.193', bind: '0.0.0.0' },
      { interface: '172.30.16.1', bind: '0.0.0.0' },
    ])
    expect(fake.made.map((instance) => [instance.published, instance.browsers])).toEqual([
      [[52000], 1],
      [[52000], 1],
    ])
    // No probe for the name: the sockets of one machine would take each other for a rival.
    expect(fake.made.map((instance) => instance.probes)).toEqual([[false], [false]])
    // The SRV target is worfy's own name, not the computer's: the OS answers for that one itself.
    expect(fake.made.map((instance) => instance.hosts)).toEqual([['worfy-11111111.local'], ['worfy-11111111.local']])
    expect(worfyHost('ABCDEF12-1111-4111-8111-111111111111')).toBe('worfy-abcdef12.local')

    // WSL goes, Wi-Fi comes: the WSL socket says goodbye and closes, the new one announces and searches.
    addresses = ['192.168.0.193', '192.168.1.40']
    backend.refresh?.()
    await vi.waitFor(() => expect(fake.made[1]?.destroyed).toBe(true))
    expect(fake.made[1]).toMatchObject({ goodbyes: [52000], browsersStopped: 1 })
    expect(fake.made[0]).toMatchObject({ destroyed: false, published: [52000], browsers: 1 })
    expect(fake.made[2]).toMatchObject({ socket: { interface: '192.168.1.40', bind: '0.0.0.0' }, published: [52000], browsers: 1 })

    await announcement.stop()
    search.stop()
    expect([fake.made[0]?.goodbyes, fake.made[2]?.goodbyes]).toEqual([[52000], [52000]])
    backend.destroy()
    expect(fake.made.every((instance) => instance.destroyed)).toBe(true)
  })

  it('each socket announces and withdraws A records of its own interface only, for worfy\'s own name (the real records of bonjour-service)', async () => {
    type Record = { name: string; type: string; data: unknown; ttl: number }
    const { Registry } = (await import('bonjour-service/dist/lib/registry')) as unknown as { Registry: new (server: unknown) => { publish(config: object): BonjourLikeService } }
    const sent: { [address: string]: Record[][] } = {}
    const create = (socket: BonjourSocketOptions): BonjourLike => {
      const packets: Record[][] = (sent[socket.interface] = [])
      const server = {
        register: () => undefined,
        unregister: () => undefined,
        mdns: { respond: (records: Record[], done: () => void) => (packets.push(records.map((record) => ({ ...record }))), done()) },
      }
      const registry = new Registry(server)
      return { publish: (config) => registry.publish(config), find: () => ({ on: () => undefined, stop: () => undefined, update: () => undefined, expire: () => undefined }), destroy: () => undefined }
    }
    const backend = bonjourBackend({ create, interfaces: () => ['192.168.0.193', '172.30.16.1'], warn: () => undefined })
    const handle = backend.publish({ name: 'PC (83a67a58)', port: 62057, txt: { id: '83a67a58-1111-4111-8111-111111111111' } })
    await handle.stop()
    const hostRecords = (records: Record[]): Record[] => records.filter((record) => record.type === 'A' || record.type === 'AAAA')
    expect(Object.keys(sent)).toEqual(['192.168.0.193', '172.30.16.1'])
    for (const [address, packets] of Object.entries(sent)) {
      expect(packets.length, address).toBe(2)
      const [announced = [], goodbye = []] = packets
      expect(hostRecords(announced), address).toEqual([{ name: 'worfy-83a67a58.local', type: 'A', ttl: 120, data: address }])
      expect(hostRecords(goodbye), address).toEqual([{ name: 'worfy-83a67a58.local', type: 'A', ttl: 0, data: address }])
      expect(announced.find((record) => record.type === 'SRV')?.data).toMatchObject({ target: 'worfy-83a67a58.local', port: 62057 })
    }
    // The view of the interfaces is gone once the calls return.
    expect(Object.values(networkInterfaces()).flat().some((entry) => entry?.address === '172.30.16.1' && entry.mac === '02:00:00:00:00:01')).toBe(false)
    backend.destroy()
  })

  it('stopping the link sends the goodbye on every socket before closing them all; a goodbye that never goes out holds it for the wait only', async () => {
    for (const silent of [false, true]) {
      const fake = fakeBonjour()
      const events: string[] = []
      const create = (socket: BonjourSocketOptions): BonjourLike => {
        const made = fake.create(socket)
        return {
          ...made,
          publish: (announcement) => {
            const service = made.publish(announcement)
            return {
              ...service,
              stop: (done?: () => void) => {
                events.push(`goodbye ${socket.interface}`)
                if (!silent) service.stop?.(done)
              },
            }
          },
          destroy: () => (events.push(`close ${socket.interface}`), made.destroy()),
        }
      }
      const backend = bonjourBackend({ create, interfaces: () => ['192.168.0.193', '172.30.16.1'], goodbyeWaitMs: 200, warn: () => undefined })
      const discovery = new LinkDiscovery({ backend, self: () => ({ id: '11111111-1111-4111-8111-111111111111', name: 'PC' }), isLinked: () => false, protocol: 1 })
      discovery.advertise(52000)
      discovery.browse('reconnect', true)
      const started = Date.now()
      await discovery.stop()
      expect(events, String(silent)).toEqual(['goodbye 192.168.0.193', 'goodbye 172.30.16.1', 'close 192.168.0.193', 'close 172.30.16.1'])
      expect(fake.made.every((instance) => instance.destroyed && instance.browsersStopped === 1)).toBe(true)
      if (silent) expect(Date.now() - started).toBeGreaterThanOrEqual(150)
      else expect(Date.now() - started).toBeLessThan(150)
    }
  })

  it('the app link: sockets on the machine interfaces, rebuilt when the network changes and when Tailscale is turned on, closed on stop', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    await bench.link(a, b)
    const fake = fakeBonjour()
    const network = { address: '192.168.0.193' }
    const read = (): Record<string, NetworkInterfaceInfo[]> => ({ lo0: [LOOPBACK], en0: [ipv4(network.address)], utun4: [ipv4('100.101.102.103', '255.255.255.255')] })
    const link = wireAppLink(a.service, { bonjour: true, mdnsCreate: fake.create, networkInterfaces: read, networkPollMs: 20 })
    const port = bench.portOf(a)
    const live = (): (string | undefined)[] => fake.made.filter((instance) => !instance.destroyed).map((instance) => instance.socket.interface)
    expect(live()).toEqual(['192.168.0.193'])
    expect(fake.made[0]?.published).toEqual([port])

    network.address = '10.0.0.7'
    await until(() => live().join() === '10.0.0.7')
    expect(fake.made.find((instance) => instance.socket.interface === '10.0.0.7')?.published.at(-1)).toBe(port)

    // Settings other than Tailscale leave the announcements alone: no goodbye, no new announcement.
    const announcements = (): number => fake.made.reduce((sum, instance) => sum + instance.published.length + instance.goodbyes.length, 0)
    const before = announcements()
    a.service.settings.set({ projectsAccess: true, keepAwake: false })
    a.service.settings.setLevel(b.service.machine.id, 'read')
    await pause(100)
    expect(announcements()).toBe(before)

    a.service.settings.set({ tailscale: true })
    await until(() => live().join() === '10.0.0.7,100.101.102.103')

    await stopLink(link)
    expect(live()).toEqual([])
  })

  it('of the addresses a worfy announces, one on a network of this machine is dialled first', () => {
    const interfaces = { en0: [ipv4('192.168.0.137')] }
    expect(onSameNetwork('192.168.0.193', interfaces)).toBe(true)
    expect(onSameNetwork('172.30.16.1', interfaces)).toBe(false)
    expect(onSameNetwork('192.168.1.193', interfaces)).toBe(false)
    const service = { host: 'DESKTOP-VFHQL1V', addresses: ['172.30.16.1', '172.19.208.1', '192.168.0.193'] }
    expect(dialAddress(service, (address) => onSameNetwork(address, interfaces))).toBe('192.168.0.193')
    expect(dialAddress(service)).toBe('172.30.16.1')
  })
})
