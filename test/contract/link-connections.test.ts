// Connections to Linked machines, revoking from either side and the access switch (worfy-link
// ticket 02; ADR-0052, points 5, 6 and 9). Real link services over temporary data folders on
// 127.0.0.1 (test/contract/link-bench.ts); each side keeps its connections with LinkConnections
// (src/main/link/connections.ts) at short pauses.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkConnections } from '../../src/main/link/connections'
import { LinkBench, type BenchMachine } from './link-bench'

let bench: LinkBench
const keepers: LinkConnections[] = []

beforeEach(() => {
  bench = new LinkBench()
})

afterEach(async () => {
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

  it('waits longer after each failed dial, from 1 s up to 30 s by default', async () => {
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
    expect(a.service.settings.get()).toEqual({ projectsAccess: false })
    expect(existsSync(file)).toBe(false)

    const events: unknown[] = []
    a.service.on('settings', (value) => events.push(value))
    a.service.settings.set({ projectsAccess: true })
    a.service.settings.set({ projectsAccess: true })
    expect(events).toEqual([{ projectsAccess: true }])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, projectsAccess: true })

    await bench.restart(a)
    expect(a.service.settings.get()).toEqual({ projectsAccess: true })
    const after: unknown[] = []
    a.service.on('settings', (value) => after.push(value))
    a.service.settings.set({ projectsAccess: false })
    expect(after).toEqual([{ projectsAccess: false }])
    await bench.restart(a)
    expect(a.service.settings.get()).toEqual({ projectsAccess: false })
  })

  it('stays off when its file cannot be read', async () => {
    const a = await bench.machine('a')
    a.service.settings.set({ projectsAccess: true })
    const file = join(a.dataDir, 'link', 'settings.json')
    writeFileSync(file, '{ not json')
    await bench.restart(a)
    expect(a.service.settings.get()).toEqual({ projectsAccess: false })
  })
})
