// The Project machine stays awake while Linked machines are connected, and says "going to sleep"
// before it sleeps (worfy-link ticket 14; src/main/link/keep-awake.ts, src/main/link/sleep-notice.ts).
//
// Electron's powerSaveBlocker and the app's will-quit are replaced, as in autopilot-power.test.ts,
// so nothing here keeps the real Mac awake; powerMonitor is a plain EventEmitter. The Machines are
// link services of the bench of worfy-link ticket 01 (test/contract/link-bench.ts): real
// connections over 127.0.0.1 in this vitest process.
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const started = new Map<number, string>()
  const quit = new Set<() => void>()
  let next = 1
  return {
    started,
    quit,
    calls: [] as unknown[][],
    powerSaveBlocker: {
      start: (type: string) => {
        const id = next++
        started.set(id, type)
        electron.calls.push(['start', type, id])
        return id
      },
      stop: (id: number) => {
        started.delete(id)
        electron.calls.push(['stop', id])
      },
      isStarted: (id: number) => started.has(id),
    },
    app: {
      on: (event: string, listener: () => void) => {
        if (event === 'will-quit') quit.add(listener)
      },
      removeListener: (event: string, listener: () => void) => {
        if (event === 'will-quit') quit.delete(listener)
      },
    },
  }
})

vi.mock('electron', () => ({ app: electron.app, powerSaveBlocker: electron.powerSaveBlocker }))

const { KeepAwake } = await import('../../src/main/autopilot/power')
const { LINK_KEEP_AWAKE_TYPE, LinkKeepAwake } = await import('../../src/main/link/keep-awake')
const { SleepNotice } = await import('../../src/main/link/sleep-notice')
const { LinkBench } = await import('../contract/link-bench')
const { accessOf } = await import('../../src/shared/ipc/channels')
const { linkSetKeepAwake } = await import('../../src/shared/ipc/link')

type Bench = InstanceType<typeof LinkBench>
type Machine = Awaited<ReturnType<Bench['machine']>>

let bench: Bench
const disposers: (() => void)[] = []

beforeEach(() => {
  bench = new LinkBench()
})

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  await bench.close()
  for (const listener of [...electron.quit]) listener()
  for (const id of [...electron.started.keys()]) electron.powerSaveBlocker.stop(id)
  electron.calls.length = 0
})

const until = (check: () => boolean): Promise<void> =>
  vi.waitFor(
    () => {
      if (!check()) throw new Error('not yet')
    },
    { timeout: 5_000, interval: 10 },
  )

const linkBlockers = (): number => [...electron.started.values()].filter((type) => type === 'prevent-app-suspension').length
const starts = (type: string): number => electron.calls.filter((call) => call[0] === 'start' && call[1] === type).length

/** Links `from` to `to` and opens one connection, dialled by `from`; resolves once both sides see it. */
async function connect(from: Machine, to: Machine): Promise<void> {
  if (!from.service.isLinked(to.service.machine.id)) {
    await bench.link(from, to)
    // Each side gives the other full access: the switch "Linked machines can work with my Projects" decides.
    from.service.settings.setLevel(to.service.machine.id, 'all')
    to.service.settings.setLevel(from.service.machine.id, 'all')
  }
  await from.service.connect(to.service.machine.id)
  await until(() => to.service.isConnected(from.service.machine.id) && from.service.isConnected(to.service.machine.id))
}

/** A Project machine `a` with access on and the keep-awake of the link watching it. */
async function projectMachine(): Promise<{ a: Machine; awake: InstanceType<typeof LinkKeepAwake> }> {
  const a = await bench.machine('a')
  a.service.settings.set({ projectsAccess: true })
  const awake = new LinkKeepAwake(a.service)
  disposers.push(() => awake.stop())
  return { a, awake }
}

describe('keep-awake while Linked machines are connected', () => {
  it('the first connected Linked machine starts one prevent-app-suspension blocker; a second does not start another', async () => {
    const { a, awake } = await projectMachine()
    const b = await bench.machine('b')
    const c = await bench.machine('c')
    expect(LINK_KEEP_AWAKE_TYPE).toBe('prevent-app-suspension')
    expect(electron.calls).toEqual([])

    await connect(b, a)
    expect(awake.held).toBe(true)
    expect(electron.calls).toEqual([['start', 'prevent-app-suspension', expect.any(Number)]])

    await connect(c, a)
    expect(starts('prevent-app-suspension')).toBe(1)
    expect(electron.started.size).toBe(1)
  })

  it('is released at once when the last Linked machine disconnects, not before', async () => {
    const { a, awake } = await projectMachine()
    const b = await bench.machine('b')
    const c = await bench.machine('c')
    await connect(b, a)
    await connect(c, a)

    await b.service.stop()
    await until(() => !a.service.isConnected(b.service.machine.id))
    expect(awake.held).toBe(true)
    expect(linkBlockers()).toBe(1)

    // The 'disconnected' of the last one releases it in the same turn.
    let heldAtDisconnect: boolean | undefined
    a.service.once('disconnected', () => {
      heldAtDisconnect = linkBlockers() > 0
    })
    await c.service.stop()
    await until(() => heldAtDisconnect !== undefined)
    expect(heldAtDisconnect).toBe(false)
    expect(awake.held).toBe(false)
  })

  it('is released at once when the connected Linked machine is revoked', async () => {
    const { a, awake } = await projectMachine()
    const b = await bench.machine('b')
    await connect(b, a)
    a.service.revoke(b.service.machine.id)
    expect(awake.held).toBe(false)
    expect(electron.started.size).toBe(0)
  })

  it('is released at once when either switch goes off, and taken again when both are on', async () => {
    const { a, awake } = await projectMachine()
    const b = await bench.machine('b')
    await connect(b, a)

    a.service.settings.set({ projectsAccess: false })
    expect(awake.held).toBe(false)
    a.service.settings.set({ projectsAccess: true })
    expect(awake.held).toBe(true)

    a.service.settings.set({ keepAwake: false })
    expect(awake.held).toBe(false)
    expect(electron.started.size).toBe(0)
    a.service.settings.set({ keepAwake: true })
    expect(awake.held).toBe(true)
    expect(linkBlockers()).toBe(1)
  })

  it('with the keep-awake switch off a connection starts no blocker; with access off neither', async () => {
    const a = await bench.machine('a')
    expect(a.service.settings.get().keepAwake).toBe(true)
    a.service.settings.set({ projectsAccess: true, keepAwake: false })
    const awake = new LinkKeepAwake(a.service)
    disposers.push(() => awake.stop())
    const b = await bench.machine('b')
    await connect(b, a)
    expect(electron.calls).toEqual([])

    a.service.settings.set({ projectsAccess: false, keepAwake: true })
    expect(electron.calls).toEqual([])
    expect(awake.held).toBe(false)
  })

  it('a Linked machine with read-only access counts; one whose own level is off does not (worfy-link ticket 18)', async () => {
    const { a, awake } = await projectMachine()
    const b = await bench.machine('b')
    await connect(b, a)
    const bId = b.service.machine.id
    a.service.settings.setLevel(bId, 'read')
    expect(awake.held).toBe(true)
    a.service.settings.setLevel(bId, 'off')
    expect(awake.held).toBe(false)
    expect(electron.started.size).toBe(0)
    a.service.settings.setLevel(bId, 'read')
    expect(awake.held).toBe(true)
  })

  it('a connection dialled by the Project machine itself counts too', async () => {
    const { a, awake } = await projectMachine()
    const b = await bench.machine('b')
    await connect(a, b)
    expect(awake.held).toBe(true)
  })

  it('is released on will-quit', async () => {
    const { a, awake } = await projectMachine()
    const b = await bench.machine('b')
    await connect(b, a)
    expect(electron.quit.size).toBe(1)
    for (const listener of [...electron.quit]) listener()
    expect(electron.started.size).toBe(0)
    expect(awake.held).toBe(false)
  })

  it('stop() releases the blocker and follows the service no more', async () => {
    const { a, awake } = await projectMachine()
    const b = await bench.machine('b')
    await connect(b, a)
    awake.stop()
    expect(awake.held).toBe(false)
    a.service.settings.set({ keepAwake: false })
    a.service.settings.set({ keepAwake: true })
    expect(electron.started.size).toBe(0)
  })

  it('an Autopilot run and the link hold a blocker each; the end of one leaves the other', async () => {
    const { a, awake } = await projectMachine()
    const b = await bench.machine('b')
    const run = new KeepAwake()
    run.start()
    await connect(b, a)
    expect([...electron.started.values()].sort()).toEqual(['prevent-app-suspension', 'prevent-display-sleep'])

    run.stop()
    expect(awake.held).toBe(true)
    expect([...electron.started.values()]).toEqual(['prevent-app-suspension'])

    const second = new KeepAwake()
    second.start()
    a.service.revoke(b.service.machine.id)
    expect(second.held).toBe(true)
    expect([...electron.started.values()]).toEqual(['prevent-display-sleep'])
    second.stop()
  })

  it('the keep-awake switch is on for a fresh data folder and survives a restart', async () => {
    const a = await bench.machine('a')
    expect(a.service.settings.get()).toEqual({ projectsAccess: false, machines: {}, keepAwake: true })
    a.service.settings.set({ keepAwake: false })
    await bench.restart(a)
    expect(a.service.settings.get()).toEqual({ projectsAccess: false, machines: {}, keepAwake: false })
  })

  it('its IPC channel is open to this Machine\'s windows only', () => {
    expect(linkSetKeepAwake.access).toBe('local')
    expect(accessOf('link.setKeepAwake')).toBe('local')
  })
})

// ---- "going to sleep" ------------------------------------------------------------------------------

class FakePowerMonitor extends EventEmitter {}

interface Sleeper {
  machine: Machine
  power: FakePowerMonitor
  notice: InstanceType<typeof SleepNotice>
  logs: string[]
}

function withNotice(machine: Machine): Sleeper {
  const power = new FakePowerMonitor()
  const logs: string[] = []
  const notice = new SleepNotice(machine.service, { power, log: (message) => logs.push(message), now: () => bench.now })
  disposers.push(() => notice.stop())
  return { machine, power, notice, logs }
}

const stateOn = (viewer: Sleeper, of: Machine): string | undefined => {
  const info = viewer.machine.service.linkedMachines().find((machine) => machine.id === of.service.machine.id)
  return info === undefined ? undefined : viewer.notice.stateOf(info)
}

describe('"going to sleep" and the state "sleeping"', () => {
  it('suspend on A: B shows A sleeping; a drop afterwards keeps it; a new connection makes it online', async () => {
    const a = withNotice(await bench.machine('a'))
    const b = withNotice(await bench.machine('b'))
    await connect(b.machine, a.machine)
    expect(stateOn(b, a.machine)).toBe('online')

    a.power.emit('suspend')
    await until(() => stateOn(b, a.machine) === 'sleeping')
    // The receiver logs the Machine and the time, never a token or an address.
    const { id, name } = a.machine.service.machine
    expect(b.logs).toEqual([`[link] Machine ${id} (${name}) is going to sleep (2026-10-08T10:00:00.000Z)`])

    await a.machine.service.stop()
    await until(() => !b.machine.service.isConnected(a.machine.service.machine.id))
    expect(stateOn(b, a.machine)).toBe('sleeping')

    await bench.restart(a.machine)
    const again = withNotice(a.machine)
    await b.machine.service.connect(a.machine.service.machine.id)
    await until(() => stateOn(b, a.machine) === 'online')
    expect(stateOn(again, b.machine)).toBe('online')
    expect(bench.leakedSecrets(b.logs)).toEqual([])
    expect(b.logs.join('\n')).not.toContain('127.0.0.1')
  })

  it('a drop without the message shows unavailable', async () => {
    const a = withNotice(await bench.machine('a'))
    const b = withNotice(await bench.machine('b'))
    await connect(b.machine, a.machine)
    await a.machine.service.stop()
    await until(() => !b.machine.service.isConnected(a.machine.service.machine.id))
    expect(stateOn(b, a.machine)).toBe('unavailable')
  })

  it('resume over a connection that survived the sleep makes A online again', async () => {
    const a = withNotice(await bench.machine('a'))
    const b = withNotice(await bench.machine('b'))
    await connect(b.machine, a.machine)
    const changes: string[] = []
    b.notice.on('changed', () => changes.push(stateOn(b, a.machine) ?? 'gone'))

    a.power.emit('suspend')
    await until(() => stateOn(b, a.machine) === 'sleeping')
    a.power.emit('resume')
    await until(() => stateOn(b, a.machine) === 'online')
    expect(changes).toEqual(['sleeping', 'online'])
  })

  it('is told to every connected Linked machine, and to none that is not connected', async () => {
    const a = withNotice(await bench.machine('a'))
    const b = withNotice(await bench.machine('b'))
    const c = withNotice(await bench.machine('c'))
    const d = withNotice(await bench.machine('d'))
    await connect(b.machine, a.machine)
    await connect(a.machine, c.machine)
    await bench.link(d.machine, a.machine)

    a.power.emit('suspend')
    await until(() => stateOn(b, a.machine) === 'sleeping' && stateOn(c, a.machine) === 'sleeping')
    expect(stateOn(d, a.machine)).toBe('unavailable')
    expect(d.logs).toEqual([])
  })

  it('a revoked Machine loses its "sleeping" with its record', async () => {
    const a = withNotice(await bench.machine('a'))
    const b = withNotice(await bench.machine('b'))
    await connect(b.machine, a.machine)
    a.power.emit('suspend')
    await until(() => stateOn(b, a.machine) === 'sleeping')
    b.machine.service.revoke(a.machine.service.machine.id)
    expect(b.notice.isSleeping(a.machine.service.machine.id)).toBe(false)
  })

  it('stop() unsubscribes from the power monitor', async () => {
    const a = withNotice(await bench.machine('a'))
    a.notice.stop()
    expect(a.power.listenerCount('suspend')).toBe(0)
    expect(a.power.listenerCount('resume')).toBe(0)
  })
})
