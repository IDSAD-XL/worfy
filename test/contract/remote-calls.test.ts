// Calls from this Machine to the channels of a Linked machine (worfy-link ticket 09,
// src/main/link/remote-calls.ts): only `project` and `desktop` channels go, the Linked machine's own
// checks of ticket 08 answer, its `projects-access` message says whether it shares its Projects,
// and with two connections open its broadcasts arrive once, over the connection the calls use.
// Two Machines on the link bench (test/contract/link-bench.ts), 127.0.0.1 only.
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ClientRegistry, type Client } from '../../src/main/clients'
import { defineHandler, emit, type HandlerModule } from '../../src/main/ipc/index'
import { projectsAccessMessage, RemoteCalls, type RemoteEvent } from '../../src/main/link/remote-calls'
import { definitionOf, eventChannel, invokeChannel } from '../../src/shared/ipc/channels'
import { projectsSettingsChanged, projectsSettingsGet } from '../../src/shared/ipc/projects'
import { LinkBench, type BenchMachine } from './link-bench'

// Test-only channels of B, as a domain file declares them.
export const remoteEcho = invokeChannel('remote.echo', z.object({ text: z.string() }), z.object({ echoed: z.string(), by: z.string() }), 'project', 'write')
export const remoteHere = invokeChannel('remote.here', z.void(), z.object({ here: z.boolean() }), 'local')
export const remoteTicked = eventChannel('remote.ticked', z.object({ n: z.number() }), 'project', 'write')

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

async function linkedPair(warn?: (message: string) => void): Promise<{ a: BenchMachine; b: BenchMachine; calls: RemoteCalls; callsOfB: RemoteCalls; bId: string; aId: string }> {
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
  // B gives A full access: B's switch "Linked machines can work with my Projects" decides.
  b.service.settings.setLevel(a.service.machine.id, 'all')
  return { a, b, calls: new RemoteCalls(a.service, warn === undefined ? {} : { warn }), callsOfB: new RemoteCalls(b.service), aId: a.service.machine.id, bId: b.service.machine.id }
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

  it('read-only (worfy-link ticket 18): this side learns the level from the message, a write is refused there, and read-only to all starts a new epoch', async () => {
    const { a, b, calls, aId, bId } = await linkedPair()
    const infoOf = () => calls.machines().find((machine) => machine.id === bId)
    b.service.settings.set({ projectsAccess: true, machines: { [aId]: 'read' } })
    await a.service.connect(bId)
    await until(calls, () => infoOf()?.sharing === 'yes' && infoOf()?.readOnly === true)
    const before = infoOf()!
    expect(await calls.call(bId, 'remote.echo', { text: 'hi' })).toEqual({ ok: false, error: 'Linked machines can only view the Projects of beta: access is read-only' })
    expect(reached).toEqual([])
    // The refusal's text changes nothing of what this side knows.
    expect(infoOf()).toEqual(before)

    b.service.settings.setLevel(aId, 'all')
    await until(calls, () => infoOf()?.readOnly === false)
    expect(infoOf()!.epoch).not.toBe(before.epoch)
    expect(infoOf()!.sharing).toBe('yes')
    expect(await calls.call(bId, 'remote.echo', { text: 'hi' })).toMatchObject({ ok: true, value: { echoed: 'hi' } })

    const all = infoOf()!
    b.service.settings.setLevel(aId, 'read')
    await until(calls, () => infoOf()?.readOnly === true)
    expect(infoOf()!.epoch).not.toBe(all.epoch)
  })

  it('a Linked machine of an older build says only `on`: on reads as all', async () => {
    const { a, b, calls, callsOfB, aId, bId } = await linkedPair()
    // B says nothing of its own; the message below is what a build before ticket 18 sends.
    ;(callsOfB as unknown as { tellAccess: () => void }).tellAccess = () => undefined
    b.service.settings.set({ projectsAccess: true })
    await a.service.connect(bId)
    b.service.sendMessage(aId, projectsAccessMessage, { on: true })
    await until(calls, () => calls.machines().find((machine) => machine.id === bId)?.sharing === 'yes')
    expect(calls.machines().find((machine) => machine.id === bId)).toMatchObject({ sharing: 'yes', readOnly: false })
    b.service.sendMessage(aId, projectsAccessMessage, { on: false })
    await until(calls, () => calls.machines().find((machine) => machine.id === bId)?.sharing === 'no')
    expect(calls.machines().find((machine) => machine.id === bId)).toMatchObject({ sharing: 'no', readOnly: false })
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

  it("names the Machine when the connection drops during a call or the answer is late, instead of the connection's own words", async () => {
    const { a, b, calls, bId } = await linkedPair()
    b.service.settings.set({ projectsAccess: true })
    await a.service.connect(bId)
    const connection = a.service.connectionTo(bId)
    if (connection === undefined) throw new Error('not connected')
    connection.call = () => Promise.resolve({ ok: false, error: 'call 63: the connection to the Linked machine closed' })
    expect(await calls.call(bId, 'remote.echo', { text: 'x' })).toEqual({ ok: false, error: 'remote.echo: beta is unreachable' })
    connection.call = () => Promise.resolve({ ok: false, error: 'remote.echo: the Linked machine did not answer in time' })
    expect(await calls.call(bId, 'remote.echo', { text: 'x' })).toEqual({ ok: false, error: 'remote.echo: beta did not answer in time' })
    // A refusal of the handler there is passed on as it is.
    connection.call = () => Promise.resolve({ ok: false, error: 'remote.echo failed: no such file' })
    expect(await calls.call(bId, 'remote.echo', { text: 'x' })).toEqual({ ok: false, error: 'remote.echo failed: no such file' })
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

describe('definitionOf', () => {
  it('answers the first declaration of a name; a later one with the same mark cannot loosen it, one with another mark closes the name', () => {
    const strict = invokeChannel('remote.twice', z.void(), z.object({ n: z.number() }), 'project', 'write')
    invokeChannel('remote.twice', z.void(), z.unknown(), 'project', 'write')
    expect(definitionOf('remote.twice')).toBe(strict)
    invokeChannel('remote.clash', z.void(), z.void(), 'project', 'write')
    eventChannel('remote.clash', z.void(), 'project', 'write')
    expect(definitionOf('remote.clash')).toBeUndefined()
    invokeChannel('remote.marks', z.void(), z.void(), 'project', 'write')
    invokeChannel('remote.marks', z.void(), z.void(), 'local')
    expect(definitionOf('remote.marks')).toBeUndefined()
    expect(definitionOf('no.such.channel')).toBeUndefined()
    expect(definitionOf('remote.echo')).toBe(remoteEcho)
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

  it('drops an event outside its schema with a warning that names the channel and not the content, and passes on the parsed one', async () => {
    const warnings: string[] = []
    const { a, b, calls, bId, aId } = await linkedPair((message) => warnings.push(message))
    b.service.settings.set({ projectsAccess: true })
    await a.service.connect(bId)
    const heard: RemoteEvent[] = []
    calls.on('event', (event) => heard.push(event))
    // A Machine that is not what it should be: frames written by hand, over the connection the calls use.
    const raw = b.service.connectionTo(aId)
    raw?.send({ t: 'event', channel: 'remote.ticked', payload: { n: 'SECRET-PAYLOAD' } })
    raw?.send({ t: 'event', channel: 'remote.ticked', payload: { n: 5, extra: 'stripped' } })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(heard).toEqual([{ machine: bId, channel: 'remote.ticked', payload: { n: 5 } }])
    expect(warnings).toEqual([`[link] Machine ${bId} sent event "remote.ticked" outside its schema; dropped`])
    expect(warnings.join('\n')).not.toContain('SECRET-PAYLOAD')
  })

  it('answers {ok:false} for an answer outside the output schema, and passes on the parsed one', async () => {
    const warnings: string[] = []
    const { a, b, calls, bId } = await linkedPair((message) => warnings.push(message))
    b.service.settings.set({ projectsAccess: true })
    await a.service.connect(bId)
    await until(calls, () => calls.machines()[0]?.sharing === 'yes')
    const connection = a.service.connectionTo(bId)
    if (connection === undefined) throw new Error('not connected')
    // What a forged Machine answers.
    connection.call = () => Promise.resolve({ ok: true, value: { echoed: 42, by: 'SECRET-ANSWER' } })
    expect(await calls.call(bId, 'remote.echo', { text: 'x' })).toEqual({ ok: false, error: 'remote.echo: beta answered outside the contract' })
    expect(warnings).toEqual([`[link] Machine ${bId} answered "remote.echo" outside its schema; refused`])
    connection.call = () => Promise.resolve({ ok: true, value: { echoed: 'x', by: 'b', extra: 'stripped' } })
    expect(await calls.call(bId, 'remote.echo', { text: 'x' })).toEqual({ ok: true, value: { echoed: 'x', by: 'b' } })
  })

  it('takes the settings of a Linked machine on a build from before "Process gate queue": no gateQueue reads as an empty template (worfy-windows ticket 17)', async () => {
    const warnings: string[] = []
    const { a, b, calls, bId, aId } = await linkedPair((message) => warnings.push(message))
    b.service.settings.set({ projectsAccess: true })
    await a.service.connect(bId)
    await until(calls, () => calls.machines()[0]?.sharing === 'yes')
    const connection = a.service.connectionTo(bId)
    if (connection === undefined) throw new Error('not connected')
    const older = { actionTemplates: { shipTicket: '/worfy:ship-ticket {epic} {NN}', runWave: '' } }
    const read = { actionTemplates: { ...older.actionTemplates, gateQueue: '' } }
    connection.call = () => Promise.resolve({ ok: true, value: older })
    expect(await calls.call(bId, projectsSettingsGet.name, { id: 'p1' })).toEqual({ ok: true, value: read })
    const heard: RemoteEvent[] = []
    calls.on('event', (event) => heard.push(event))
    b.service.connectionTo(aId)?.send({ t: 'event', channel: projectsSettingsChanged.name, payload: { id: 'p1', settings: older } })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(heard).toEqual([{ machine: bId, channel: projectsSettingsChanged.name, payload: { id: 'p1', settings: read } }])
    expect(warnings).toEqual([])
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
