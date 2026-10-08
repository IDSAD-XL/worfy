// Calls from this Machine to the channels of a Linked machine (worfy-link ticket 09,
// src/main/link/remote-calls.ts): only `project` and `desktop` channels go, the Linked machine's own
// checks of ticket 08 answer, its `projects-access` message says whether it shares its Projects,
// and with two connections open its broadcasts arrive once, over the connection the calls use.
// Two Machines on the link bench (test/contract/link-bench.ts), 127.0.0.1 only.
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ClientRegistry, type Client } from '../../src/main/clients'
import { defineHandler, emit, type HandlerModule } from '../../src/main/ipc/index'
import { RemoteCalls, type RemoteEvent } from '../../src/main/link/remote-calls'
import { eventChannel, invokeChannel } from '../../src/shared/ipc/channels'
import { LinkBench, type BenchMachine } from './link-bench'

// Test-only channels of B, as a domain file declares them.
export const remoteEcho = invokeChannel('remote.echo', z.object({ text: z.string() }), z.object({ echoed: z.string(), by: z.string() }), 'project')
export const remoteHere = invokeChannel('remote.here', z.void(), z.object({ here: z.boolean() }), 'local')
export const remoteTicked = eventChannel('remote.ticked', z.object({ n: z.number() }), 'project')

declare module '../../src/shared/ipc/channels' {
  interface IpcContract {
    'remote.echo': typeof remoteEcho
    'remote.here': typeof remoteHere
    'remote.ticked': typeof remoteTicked
  }
}

const reached: string[] = []
const testModule: HandlerModule = [
  defineHandler(remoteEcho, ({ text }, { event }) => {
    reached.push('remote.echo')
    return { echoed: text, by: String((event.sender as unknown as Client).id) }
  }),
  defineHandler(remoteHere, () => {
    reached.push('remote.here')
    return { here: true }
  }),
]

let bench: LinkBench | undefined
/** B's clients without a window: the connections of A while B shares its Projects. */
let clientsOfB: ClientRegistry

afterEach(async () => {
  expect(bench?.leakedSecrets() ?? []).toEqual([])
  await bench?.close()
  bench = undefined
  reached.length = 0
})

async function linkedPair(): Promise<{ a: BenchMachine; b: BenchMachine; calls: RemoteCalls; callsOfB: RemoteCalls; bId: string; aId: string }> {
  clientsOfB = new ClientRegistry(() => [])
  bench = new LinkBench({
    ipcModules: {
      './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default),
      './remote.ts': () => Promise.resolve(testModule),
    },
    // Only B's connections join this registry; A's would land there too, and stay unused.
    addClient: (client) => clientsOfB.add(client),
  })
  const a = await bench.machine('alpha')
  const b = await bench.machine('beta')
  await bench.link(a, b)
  return { a, b, calls: new RemoteCalls(a.service), callsOfB: new RemoteCalls(b.service), aId: a.service.machine.id, bId: b.service.machine.id }
}

/** Resolves once `calls` says what `check` waits for. */
async function until(calls: RemoteCalls, check: () => boolean): Promise<void> {
  if (check()) return
  await new Promise<void>((resolve) => {
    const listener = (): void => {
      if (!check()) return
      calls.off('changed', listener)
      resolve()
    }
    calls.on('changed', listener)
  })
}

describe('calls on a Linked machine', () => {
  it("are refused there while it does not share its Projects, and this side learns so from its message; sharing on starts a new epoch", async () => {
    const { a, b, calls, bId } = await linkedPair()
    const infoOf = () => calls.machines().find((machine) => machine.id === bId)
    expect(infoOf()).toMatchObject({ online: false, sharing: 'unknown' })
    await a.service.connect(bId)
    await until(calls, () => infoOf()?.sharing === 'no')
    const before = infoOf()!
    expect(before.online).toBe(true)
    const refused = await calls.call(bId, 'remote.echo', { text: 'hi' })
    expect(refused).toEqual({ ok: false, error: 'Linked machines cannot work with the Projects of beta: access is off' })
    expect(reached).toEqual([])

    b.service.settings.set({ projectsAccess: true })
    await until(calls, () => infoOf()?.sharing === 'yes')
    expect(infoOf()!.epoch).not.toBe(before.epoch)
    expect(await calls.call(bId, 'remote.echo', { text: 'hi' })).toMatchObject({ ok: true, value: { echoed: 'hi' } })
    expect(reached).toEqual(['remote.echo'])
  })

  it('a refusal "access is off" marks the Machine as not sharing, even without its message', async () => {
    const { a, calls, callsOfB, bId } = await linkedPair()
    // B says nothing of its switch this time.
    ;(callsOfB as unknown as { tellAccess: () => void }).tellAccess = () => undefined
    await a.service.connect(bId)
    const result = await calls.call(bId, 'remote.echo', { text: 'x' })
    expect(result.ok).toBe(false)
    expect(calls.machines().find((machine) => machine.id === bId)?.sharing).toBe('no')
  })

  it("never sends a channel of this Machine (local, link, unknown) to the Linked machine", async () => {
    const { a, b, calls, bId } = await linkedPair()
    b.service.settings.set({ projectsAccess: true })
    await a.service.connect(bId)
    for (const channel of ['remote.here', 'link.ping', 'link.state', 'no.such.channel']) {
      expect(await calls.call(bId, channel, undefined)).toEqual({ ok: false, error: `${channel}: a channel of this Machine; it is not called on a Linked machine` })
    }
    expect(reached).toEqual([])
  })

  it('answers "<Machine> is unreachable" while no connection is open, and "not linked" for a Machine that is not', async () => {
    const { calls, bId } = await linkedPair()
    expect(await calls.call(bId, 'remote.echo', { text: 'x' })).toEqual({ ok: false, error: 'remote.echo: beta is unreachable' })
    expect(await calls.call('9d0e9f13-8a7b-4c2d-b1e0-3f4a5b6c7d8e', 'remote.echo', { text: 'x' })).toEqual({
      ok: false,
      error: 'remote.echo: Machine 9d0e9f13-8a7b-4c2d-b1e0-3f4a5b6c7d8e is not linked',
    })
  })
})

describe('events of a Linked machine', () => {
  it('arrive once with two connections open, over the one the calls use; when it closes the other takes over with a new epoch', async () => {
    const { a, b, calls, aId, bId } = await linkedPair()
    b.service.settings.set({ projectsAccess: true })
    await a.service.connect(bId)
    await b.service.connect(aId)
    // Two connections, so B has two clients of A, and its broadcast goes over both.
    expect(clientsOfB.list()).toHaveLength(2)
    const heard: RemoteEvent[] = []
    calls.on('event', (event) => heard.push(event))
    const tick = async (n: number): Promise<void> => {
      const count = heard.length
      clientsOfB.broadcast((client) => emit(client, remoteTicked, { n }))
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(heard.length - count).toBe(1)
    }
    await until(calls, () => calls.machines()[0]?.sharing === 'yes')
    await tick(1)
    expect(heard).toEqual([{ machine: bId, channel: 'remote.ticked', payload: { n: 1 } }])
    // The call goes over the same connection: B names the client of that connection.
    const first = await calls.call(bId, 'remote.echo', { text: 'x' })
    const epoch = calls.machines()[0]!.epoch

    a.service.connectionTo(bId)?.close()
    await until(calls, () => calls.machines()[0]!.epoch !== epoch)
    expect(calls.machines()[0]!.online).toBe(true)
    await tick(2)
    const second = await calls.call(bId, 'remote.echo', { text: 'x' })
    expect(first.ok && second.ok && (first.value as { by: string }).by !== (second.value as { by: string }).by).toBe(true)
  })

  it("does not pass on B's broadcast of a channel this side does not call on a Linked machine", async () => {
    const { a, b, calls, bId } = await linkedPair()
    b.service.settings.set({ projectsAccess: true })
    await a.service.connect(bId)
    await until(calls, () => calls.machines()[0]?.sharing === 'yes')
    const heard: RemoteEvent[] = []
    calls.on('event', (event) => heard.push(event))
    // B sends a raw frame of a channel A does not know.
    b.service.connectionTo(a.service.machine.id)?.send({ t: 'event', channel: 'no.such.event', payload: {} })
    clientsOfB.broadcast((client) => emit(client, remoteTicked, { n: 3 }))
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(heard.map((event) => event.channel)).toEqual(['remote.ticked'])
  })
})
