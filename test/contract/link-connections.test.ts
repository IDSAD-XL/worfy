// Connections to Linked machines, revoking from either side and the access switch (worfy-link
// ticket 02; ADR-0052, points 5, 6 and 9). Real link services over temporary data folders on
// 127.0.0.1 (test/contract/link-bench.ts); each side keeps its connections with LinkConnections
// (src/main/link/connections.ts) at short pauses.
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkingWindows } from '../../src/main/ipc/link'
import { LinkConnections } from '../../src/main/link/connections'
import { LinkDiscovery, type MdnsBackend } from '../../src/main/link/discovery'
import { stopLink, stopLinkOnQuit, wireAppLink, type LinkService } from '../../src/main/link/service'
import { LinkBench, type BenchMachine } from './link-bench'

let bench: LinkBench
const keepers: LinkConnections[] = []

beforeEach(() => {
  bench = new LinkBench()
})

afterEach(async () => {
  vi.useRealTimers()
  for (const keeper of keepers.splice(0)) keeper.stop()
  // No pairing code and no token in the console output.
  expect(bench.leakedSecrets()).toEqual([])
  await bench.close()
})

/** Keeps the connections of `machine`'s current service, retrying after 20 ms, at most 200 ms apart. */
function keep(machine: BenchMachine, options: { firstDelayMs?: number; maxDelayMs?: number } = {}): LinkConnections {
  const keeper = new LinkConnections(machine.service, { firstDelayMs: 20, maxDelayMs: 200, ...options })
  keeper.start()
  keepers.push(keeper)
  return keeper
}

const until = (check: () => boolean, timeout = 5_000): Promise<void> => vi.waitFor(() => expect(check()).toBe(true), { timeout, interval: 10 })

const online = (from: BenchMachine, to: BenchMachine): boolean => from.service.linkedMachines().find((machine) => machine.id === to.service.machine.id)?.connected === true

const linkedIds = (machine: BenchMachine): string[] => machine.service.linkedMachines().map((each) => each.id)

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

describe('keeping the connection', () => {
  it('a dropped connection is unavailable; when B comes back, it is online again with nobody acting', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    const keeper = keep(a)
    await bench.link(a, b)
    // Linked: A dials B by itself.
    await until(() => online(a, b))
    expect(keeper.anyUnavailable()).toBe(false)

    await b.service.stop()
    await until(() => !online(a, b))
    expect(a.service.linkedMachines()).toMatchObject([{ id: b.service.machine.id, connected: false }])
    expect(keeper.anyUnavailable()).toBe(true)
    // While B is down, A keeps trying and fails: unavailable, with the reason kept for a tooltip.
    await until(() => keeper.lastError(b.service.machine.id) !== null)

    await bench.restart(b)
    await until(() => online(a, b))
    expect(keeper.anyUnavailable()).toBe(false)
    expect(keeper.lastError(b.service.machine.id)).toBeNull()
  })

  it('connects at the start to every Linked machine', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    await bench.link(a, b)
    expect(online(a, b)).toBe(false)
    await bench.restart(a)
    keep(a)
    await until(() => online(a, b) && online(b, a))
  })

  it('a Linked machine found by Bonjour is dialled at once, not after the pause', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    const keeper = keep(a, { firstDelayMs: 60_000, maxDelayMs: 60_000 })
    await bench.link(a, b)
    await until(() => online(a, b))
    await bench.restart(b)
    await until(() => !online(a, b))
    // The next dial is a minute away; B is back, and Bonjour finds it.
    await pause(100)
    expect(online(a, b)).toBe(false)
    keeper.seen(b.service.machine.id, '127.0.0.1', bench.portOf(b))
    await until(() => online(a, b), 2_000)
  })

  it('the pause grows 1 → 30 s by default', async () => {
    const a = await bench.machine('a')
    const keeper = new LinkConnections(a.service)
    expect([1, 2, 3, 4, 5, 6, 7].map((failures) => keeper.delayFor(failures))).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
  })
})

describe('revoking from either side', () => {
  for (const side of ['A', 'B'] as const) {
    it(`revoked on ${side}: both lists are empty and the connection is closed, and nobody dials again`, async () => {
      const a = await bench.machine('a')
      const b = await bench.machine('b')
      keep(a)
      keep(b)
      await bench.link(a, b)
      await until(() => online(a, b) && online(b, a))

      const [revoker, other] = side === 'A' ? [a, b] : [b, a]
      revoker.service.revoke(other.service.machine.id)
      await until(() => linkedIds(a).length === 0 && linkedIds(b).length === 0)
      expect(a.service.isConnected(b.service.machine.id)).toBe(false)
      expect(b.service.isConnected(a.service.machine.id)).toBe(false)

      // Longer than several retry pauses: still nothing linked, nothing connected.
      await pause(400)
      expect(linkedIds(a)).toEqual([])
      expect(linkedIds(b)).toEqual([])
      expect(a.service.isConnected(b.service.machine.id) || b.service.isConnected(a.service.machine.id)).toBe(false)
    })
  }

  it('a Machine revoked while it was away learns it on its next connection, and forgets the other too', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    // A keeps listening after the revoke only while it has another Linked machine (service.ts).
    const c = await bench.machine('c')
    keep(a)
    await bench.link(a, c)
    await bench.link(a, b)
    await until(() => online(a, b))
    await b.service.stop()
    a.service.revoke(b.service.machine.id)
    expect(linkedIds(a)).toEqual([c.service.machine.id])

    await bench.restart(b)
    expect(linkedIds(b)).toEqual([a.service.machine.id])
    keep(b)
    await until(() => linkedIds(b).length === 0)
  })
})

describe('the access switch "Linked machines can work with my Projects"', () => {
  it('is off for a fresh data folder, survives a restart over the same folder, and its change is announced', async () => {
    const a = await bench.machine('a')
    const file = join(a.dataDir, 'link', 'settings.json')
    expect(a.service.settings.get()).toEqual({ projectsAccess: false, machines: {}, keepAwake: true })
    expect(existsSync(file)).toBe(false)

    const events: unknown[] = []
    a.service.on('settings', (value) => events.push(value))
    a.service.settings.set({ projectsAccess: true })
    a.service.settings.set({ projectsAccess: true })
    expect(events).toEqual([{ projectsAccess: true, machines: {}, keepAwake: true }])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 2, projectsAccess: true, machines: {}, keepAwake: true })

    await bench.restart(a)
    expect(a.service.settings.get()).toEqual({ projectsAccess: true, machines: {}, keepAwake: true })
    const after: unknown[] = []
    a.service.on('settings', (value) => after.push(value))
    a.service.settings.set({ projectsAccess: false })
    expect(after).toEqual([{ projectsAccess: false, machines: {}, keepAwake: true }])
    await bench.restart(a)
    expect(a.service.settings.get()).toEqual({ projectsAccess: false, machines: {}, keepAwake: true })
  })

  it('stays off when its file cannot be read', async () => {
    const a = await bench.machine('a')
    a.service.settings.set({ projectsAccess: true })
    const file = join(a.dataDir, 'link', 'settings.json')
    writeFileSync(file, '{ not json')
    await bench.restart(a)
    expect(a.service.settings.get()).toEqual({ projectsAccess: false, machines: {}, keepAwake: true })
  })
})

// worfy-link ticket 18 (ADR-0066): the level of each Linked machine, and the file of version 1.
describe('the access level of each Linked machine', () => {
  it('a file of version 1 with access on reads as "all" for the Machines linked then, and is written as version 2; one linked later is off', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    await bench.link(a, b)
    const bId = b.service.machine.id
    const file = join(a.dataDir, 'link', 'settings.json')
    writeFileSync(file, JSON.stringify({ version: 1, projectsAccess: true, keepAwake: false }))
    await bench.restart(a)
    expect(a.service.settings.get()).toEqual({ projectsAccess: true, machines: { [bId]: 'all' }, keepAwake: false })
    expect(a.service.settings.levelOf(bId)).toBe('all')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 2, projectsAccess: true, machines: { [bId]: 'all' }, keepAwake: false })

    const c = await bench.machine('c')
    await bench.link(a, c)
    await bench.restart(a)
    expect(a.service.settings.levelOf(bId)).toBe('all')
    expect(a.service.settings.levelOf(c.service.machine.id)).toBe('off')
  })

  it('a file of version 1 with access off reads as off for everyone; a file written before the keep-awake switch too', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    await bench.link(a, b)
    const file = join(a.dataDir, 'link', 'settings.json')
    writeFileSync(file, JSON.stringify({ version: 1, projectsAccess: false }))
    await bench.restart(a)
    expect(a.service.settings.get()).toEqual({ projectsAccess: false, machines: {}, keepAwake: true })
    expect(a.service.settings.levelOf(b.service.machine.id)).toBe('off')
    // On again, the switch alone gives nothing: the level of each Machine is its own.
    a.service.settings.set({ projectsAccess: true })
    expect(a.service.settings.levelOf(b.service.machine.id)).toBe('off')
  })

  it('a level is kept per Machine, applies only while the switch is on, survives a restart, and goes with a revoke; linked again it starts off', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    const c = await bench.machine('c')
    await bench.link(a, b)
    await bench.link(a, c)
    const bId = b.service.machine.id
    const cId = c.service.machine.id
    expect(a.service.settings.levelOf(bId)).toBe('off')
    a.service.settings.set({ projectsAccess: true })
    a.service.settings.setLevel(bId, 'read')
    a.service.settings.setLevel(cId, 'all')
    expect([a.service.settings.levelOf(bId), a.service.settings.levelOf(cId)]).toEqual(['read', 'all'])
    a.service.settings.set({ projectsAccess: false })
    expect([a.service.settings.levelOf(bId), a.service.settings.levelOf(cId)]).toEqual(['off', 'off'])
    a.service.settings.set({ projectsAccess: true })
    await bench.restart(a)
    expect([a.service.settings.levelOf(bId), a.service.settings.levelOf(cId)]).toEqual(['read', 'all'])

    a.service.revoke(cId)
    expect(a.service.settings.get().machines).toEqual({ [bId]: 'read' })
    await bench.link(a, b)
    expect(a.service.settings.levelOf(bId)).toBe('off')
    expect(a.service.settings.get().machines).toEqual({})
  })
})

/** A plain TCP server on `port` that holds it; the link server then has to take another one. */
function holdPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy())
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

const recordOf = (from: BenchMachine, to: BenchMachine) => from.service.linkedMachines().find((machine) => machine.id === to.service.machine.id)

describe('an address announced by Bonjour', () => {
  it('is ignored while a connection is open, and a forged one changes nothing', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    // Another worfy, with another certificate, announcing itself as B.
    const impostor = await bench.machine('impostor')
    await bench.codeOf(impostor)
    const keeper = keep(a, { firstDelayMs: 60_000, maxDelayMs: 60_000 })
    await bench.link(a, b)
    await until(() => online(a, b))
    const before = recordOf(a, b)

    keeper.seen(b.service.machine.id, '127.0.0.1', bench.portOf(impostor))
    await pause(200)
    expect(online(a, b)).toBe(true)
    expect(recordOf(a, b)).toEqual(before)

    // B away: the forged address is tried once and proves not to be B.
    await b.service.stop()
    await until(() => !online(a, b))
    keeper.seen(b.service.machine.id, '127.0.0.1', bench.portOf(impostor))
    await until(() => keeper.lastError(b.service.machine.id)?.includes('is not Machine') === true)
    expect(recordOf(a, b)).toEqual({ ...before, connected: false })
    expect(recordOf(a, b)?.certificateChanged).toBe(false)
  })

  it('is kept once the remembered certificate answers there', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    const keeper = keep(a, { firstDelayMs: 60_000, maxDelayMs: 60_000 })
    await bench.link(a, b)
    await until(() => online(a, b))
    const oldPort = bench.portOf(b)
    await b.service.stop()
    await until(() => !online(a, b))
    // B comes back on another port: its old one is taken.
    const holder = await holdPort(oldPort)
    try {
      await bench.restart(b)
      const newPort = bench.portOf(b)
      expect(newPort).not.toBe(oldPort)
      expect(recordOf(a, b)?.port).toBe(oldPort)
      expect(recordOf(a, b)?.address).toBe('127.0.0.1')
      // Announced under another name of the same host: kept once B's certificate answered there.
      keeper.seen(b.service.machine.id, 'localhost', newPort)
      await until(() => online(a, b), 2_000)
      expect(recordOf(a, b)?.port).toBe(newPort)
      expect(recordOf(a, b)?.address).toBe('localhost')
      expect(recordOf(a, b)?.certificateChanged).toBe(false)
    } finally {
      holder.close()
    }
  })
})

/** A link service that only counts dials, for the timing of retries under fake timers. */
class DialCounter extends EventEmitter {
  readonly id = '55555555-5555-4555-8555-555555555555'
  isStopped = false
  connected = false
  linked = true
  /** When each dial started (fake clock), and where to. */
  readonly dials: { at: number; via?: { host: string; port: number } }[] = []
  /** The next dial resolves or rejects when the test says so; else it fails at once. */
  hold = false
  private pending: ((ok: boolean) => void)[] = []

  connect(_id: string, via?: { host: string; port: number }): Promise<void> {
    this.dials.push({ at: Date.now(), ...(via === undefined ? {} : { via }) })
    if (!this.hold) return Promise.reject(new Error('unreachable'))
    return new Promise((resolve, reject) => this.pending.push((ok) => (ok ? resolve() : reject(new Error('unreachable')))))
  }

  settle(ok: boolean): void {
    for (const done of this.pending.splice(0)) done(ok)
  }

  isConnected(): boolean {
    return this.connected
  }

  isLinked(): boolean {
    return this.linked
  }

  linkedMachines(): { id: string }[] {
    return this.linked ? [{ id: this.id }] : []
  }
}

function counted(): { service: DialCounter; keeper: LinkConnections } {
  vi.useFakeTimers({ now: 0 })
  const service = new DialCounter()
  const keeper = new LinkConnections(service as unknown as LinkService)
  keepers.push(keeper)
  return { service, keeper }
}

describe('retry timing (fake timers)', () => {
  it('retries after 1, 2, 4, 8, 16 s, then every 30 s', async () => {
    const { service, keeper } = counted()
    keeper.start()
    await vi.advanceTimersByTimeAsync(130_000)
    expect(service.dials.map((dial) => dial.at)).toEqual([0, 1_000, 3_000, 7_000, 15_000, 31_000, 61_000, 91_000, 121_000])
  })

  it('a dropped connection is retried after 1 s, then the pause grows again', async () => {
    const { service, keeper } = counted()
    service.connected = true
    keeper.start()
    expect(service.dials).toEqual([])
    vi.setSystemTime(5_000)
    service.connected = false
    service.emit('disconnected', { id: service.id, name: 'B' })
    await vi.advanceTimersByTimeAsync(4_000)
    expect(service.dials.map((dial) => dial.at)).toEqual([6_000, 7_000, 9_000])
  })

  it('no dial after stop, nor after the service stopped, even with one in flight', async () => {
    const { service, keeper } = counted()
    keeper.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(service.dials).toHaveLength(2)
    service.hold = true
    await vi.advanceTimersByTimeAsync(2_000)
    expect(service.dials).toHaveLength(3)
    // Stopped while the third dial runs; it fails afterwards.
    keeper.stop()
    service.settle(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(service.dials).toHaveLength(3)

    const second = new LinkConnections(service as unknown as LinkService)
    keepers.push(second)
    service.hold = false
    second.start()
    expect(service.dials).toHaveLength(4)
    service.isStopped = true
    await vi.advanceTimersByTimeAsync(120_000)
    expect(service.dials).toHaveLength(4)
  })

  it('an announced address: ignored while connected or dialling, tried once otherwise, and its failure does not lengthen the pause', async () => {
    const { service, keeper } = counted()
    const via = { host: '192.168.1.30', port: 53000 }
    service.connected = true
    keeper.start()
    keeper.seen(service.id, via.host, via.port)
    expect(service.dials).toEqual([])

    service.connected = false
    service.hold = true
    keeper.seen(service.id, via.host, via.port)
    keeper.seen(service.id, via.host, via.port)
    expect(service.dials).toEqual([{ at: 0, via }])
    service.hold = false
    service.settle(false)
    // Failed at 0 without counting: the next regular dial is the first pause away.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(service.dials).toEqual([{ at: 0, via }, { at: 1_000 }])
    await vi.advanceTimersByTimeAsync(2_000)
    expect(service.dials.map((dial) => dial.at)).toEqual([0, 1_000, 2_000])
  })
})

/** A Bonjour backend that records what would reach the network. */
function recordingMdns(): MdnsBackend & { wire: string[] } {
  const wire: string[] = []
  return {
    wire,
    publish: ({ port }) => {
      wire.push(`announce ${port}`)
      return {
        stop: () =>
          new Promise<void>((done) =>
            setTimeout(() => {
              wire.push(`goodbye ${port}`)
              done()
            }, 5),
          ),
      }
    },
    browse: () => ({ stop: () => undefined, refresh: () => undefined }),
    destroy: () => void wire.push('closed'),
  }
}

describe('stopping the link on quit', () => {
  it('says goodbye on Bonjour before closing it, stops dialling and closes the connections', async () => {
    const a = await bench.machine('a')
    const b = await bench.machine('b')
    const mdns = recordingMdns()
    const discovery = new LinkDiscovery({ backend: mdns, self: () => a.service.machine, isLinked: (id) => a.service.isLinked(id), protocol: 1 })
    const link = wireAppLink(a.service, { bonjour: true, discovery })
    keepers.push(link.connections)
    keep(b)
    await bench.link(a, b)
    await until(() => online(a, b) && online(b, a))
    const port = bench.portOf(a)
    expect(mdns.wire).toEqual([`announce ${port}`])

    await stopLink(link)
    expect(mdns.wire).toEqual([`announce ${port}`, `goodbye ${port}`, 'closed'])
    expect(a.service.isStopped).toBe(true)
    await until(() => !online(b, a))
    expect(a.service.isConnected(b.service.machine.id)).toBe(false)
    // B keeps dialling a closed port; A dials nobody.
    await pause(300)
    expect(a.service.isConnected(b.service.machine.id)).toBe(false)
  })
})

describe('the windows with "Link a machine" open', () => {
  class FakeWindow extends EventEmitter {
    destroyed = false
    readonly onces = vi.fn()
    constructor(readonly id: number) {
      super()
    }

    isDestroyed(): boolean {
      return this.destroyed
    }

    override once(event: string, listener: (...args: unknown[]) => void): this {
      this.onces(event)
      return super.once(event, listener)
    }

    destroy(): void {
      this.destroyed = true
      this.emit('destroyed')
    }
  }

  it('listens to a window going away once, however often it opens the dialog', () => {
    const gone = vi.fn()
    const windows = new LinkingWindows(gone)
    const first = new FakeWindow(1)
    const second = new FakeWindow(2)
    expect(windows.add(first)).toBe('first')
    for (let n = 0; n < 5; n += 1) expect(windows.add(first)).toBe('again')
    expect(first.onces).toHaveBeenCalledTimes(1)
    expect(first.listenerCount('destroyed')).toBe(1)
    expect(windows.add(second)).toBe('added')

    // Closed by hand, then opened again: still one listener.
    expect(windows.close(first.id)).toBe(false)
    expect(windows.add(first)).toBe('added')
    expect(first.listenerCount('destroyed')).toBe(1)

    expect(windows.close(second.id)).toBe(false)
    first.destroy()
    expect(gone).toHaveBeenCalledTimes(1)
    expect(windows.size).toBe(0)
    expect(windows.add(first)).toBe('gone')
  })

  it('a window that goes away while another still has it open does not close linking', () => {
    const gone = vi.fn()
    const windows = new LinkingWindows(gone)
    const first = new FakeWindow(1)
    const second = new FakeWindow(2)
    windows.add(first)
    windows.add(second)
    first.destroy()
    expect(gone).not.toHaveBeenCalled()
    expect(windows.close(second.id)).toBe(true)
  })
})

/**
 * Electron's quit, as far as the quit handlers see it (Browser::Quit and NotifyAndShutdown in
 * Electron's browser.cc): app.quit() runs every `before-quit` handler; when none prevented it,
 * every `will-quit` handler; when none prevented that either, the app is gone. A handler that
 * prevented calls app.quit() again when its wait is over. While `will-quit` is being dispatched
 * the app counts as quitting, and app.quit() does nothing: the microtasks the handlers queued run
 * before Electron clears that, so the model clears it on the next timer turn.
 */
class QuitModel {
  private readonly handlers: Record<'before-quit' | 'will-quit', ((event: { preventDefault(): void }) => void)[]> = { 'before-quit': [], 'will-quit': [] }
  private quitting = false
  exitedAt: number | undefined
  /** app.quit() calls Electron ignored. */
  ignored = 0

  on(event: 'before-quit' | 'will-quit', listener: (event: { preventDefault(): void }) => void): this {
    this.handlers[event].push(listener)
    return this
  }

  quit(): void {
    if (this.exitedAt !== undefined) return
    if (this.quitting) {
      this.ignored += 1
      return
    }
    let prevented = false
    for (const listener of this.handlers['before-quit']) listener({ preventDefault: () => (prevented = true) })
    if (prevented) return
    this.quitting = true
    prevented = false
    for (const listener of this.handlers['will-quit']) listener({ preventDefault: () => (prevented = true) })
    if (!prevented) {
      this.exitedAt = Date.now()
      return
    }
    setTimeout(() => (this.quitting = false), 0)
  }
}

const after = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The Autopilot's quit handler (src/main/ipc/autopilot.ts): holds `before-quit` once, until its runs stopped. */
function autopilotOnQuit(app: QuitModel, stopMs: number): { stoppedAt: () => number | undefined } {
  let quitting = false
  let stoppedAt: number | undefined
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void after(stopMs).then(() => {
      stoppedAt = Date.now()
      app.quit()
    })
  })
  return { stoppedAt: () => stoppedAt }
}

/** The shells' quit handler (src/main/ipc/terminal.ts): holds `will-quit` while a shell is left. */
function shellsOnQuit(app: QuitModel, exitMs: number): { closedAt: () => number | undefined } {
  let left = 1
  let closedAt: number | undefined
  const closing = after(exitMs).then(() => {
    left = 0
    closedAt = Date.now()
  })
  app.on('will-quit', (event) => {
    if (left === 0) return
    event.preventDefault()
    void closing.finally(() => app.quit())
  })
  return { closedAt: () => closedAt }
}

/** A link whose stop takes `ms`; the second call finds nothing to stop, as stopAppLink does. */
function linkStop(ms: number): { stop: () => Promise<void> | undefined; stoppedAt: () => number | undefined } {
  let running = true
  let stoppedAt: number | undefined
  return {
    stop: () => {
      if (!running) return undefined
      running = false
      return after(ms).then(() => {
        stoppedAt = Date.now()
      })
    },
    stoppedAt: () => stoppedAt,
  }
}

describe('stopping the link when worfy quits', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 })
  })

  it('waits for the Autopilot that stops longer than the link: the app quits only after both', async () => {
    const app = new QuitModel()
    const autopilot = autopilotOnQuit(app, 300)
    const link = linkStop(20)
    stopLinkOnQuit(app, link.stop, 1_500)
    app.quit()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(autopilot.stoppedAt()).toBe(300)
    expect(link.stoppedAt()).toBeDefined()
    expect(app.exitedAt).toBeGreaterThanOrEqual(300)
    expect(app.exitedAt).toBeGreaterThanOrEqual(link.stoppedAt() ?? Infinity)
  })

  it('the same with the link handler registered first', async () => {
    const app = new QuitModel()
    const link = linkStop(20)
    stopLinkOnQuit(app, link.stop, 1_500)
    const autopilot = autopilotOnQuit(app, 300)
    app.quit()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(app.exitedAt).toBeGreaterThanOrEqual(autopilot.stoppedAt() ?? Infinity)
    expect(app.exitedAt).toBeGreaterThanOrEqual(link.stoppedAt() ?? Infinity)
  })

  it('a link slower than the shells still holds the quit after the shells quit again', async () => {
    const app = new QuitModel()
    const shells = shellsOnQuit(app, 50)
    const link = linkStop(200)
    stopLinkOnQuit(app, link.stop, 1_500)
    app.quit()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(shells.closedAt()).toBe(50)
    expect(link.stoppedAt()).toBe(200)
    // The link's last app.quit() goes on the next timer turn.
    expect(app.exitedAt).toBeGreaterThanOrEqual(200)
    expect(app.exitedAt).toBeLessThan(210)
  })

  it('shells slower than the link keep the quit, the link does not cut them short', async () => {
    const app = new QuitModel()
    const link = linkStop(20)
    stopLinkOnQuit(app, link.stop, 1_500)
    const shells = shellsOnQuit(app, 100)
    app.quit()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(app.exitedAt).toBe(100)
    expect(shells.closedAt()).toBe(100)
  })

  it('a link stop with nothing to wait for still quits: app.quit() is not called inside the will-quit dispatch', async () => {
    const app = new QuitModel()
    // One-shot, as stopAppLink: the second call finds nothing to stop.
    let running = true
    stopLinkOnQuit(app, () => (running ? ((running = false), Promise.resolve()) : undefined), 1_500)
    app.quit()
    await vi.advanceTimersByTimeAsync(100)
    expect(app.ignored).toBe(0)
    expect(app.exitedAt).toBeLessThan(10)
  })

  it('a link stop that hangs holds the quit for the wait only; no link running holds nothing', async () => {
    const hung = new QuitModel()
    let running = true
    stopLinkOnQuit(hung, () => (running ? ((running = false), new Promise<void>(() => undefined)) : undefined), 1_500)
    hung.quit()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(hung.exitedAt).toBeGreaterThanOrEqual(1_500)
    expect(hung.exitedAt).toBeLessThan(1_510)

    const idle = new QuitModel()
    stopLinkOnQuit(idle, () => undefined, 1_500)
    const now = Date.now()
    idle.quit()
    expect(idle.exitedAt).toBe(now)
  })
})
