// The renderer side of the IPC contract: src/renderer/ipc.ts over a fake window.worfy bridge.
// This file is .tsx so it is typechecked with the renderer's test project (tsconfig.test.web.json),
// which sees src/renderer/ipc.ts; main's side is in ipc.test.ts. The channels it declares below
// exist only in the test projects: tsconfig.web.json typechecks src/ without them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { eventChannel, invokeChannel, type IpcResult, type WorfyBridge } from '../../src/shared/ipc/channels'
import { createIpcClient } from '../../src/renderer/ipc'

// Test-only channels, added the same way a domain file adds its own.
export const clientEcho = invokeChannel('client.echo', z.object({ text: z.string() }), z.object({ echoed: z.string() }), 'project', 'write')
export const clientTicked = eventChannel('client.ticked', z.object({ n: z.number() }), 'project', 'write')

declare module '../../src/shared/ipc/channels' {
  interface IpcContract {
    'client.echo': typeof clientEcho
    'client.ticked': typeof clientTicked
  }
}

/** A bridge shaped like window.worfy from the preload. */
function fakeBridge(invoke: WorfyBridge['invoke']) {
  const listeners = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let next = 1
  const bridge: WorfyBridge = {
    invoke,
    on: (channel, handler) => {
      listeners.set(next, { channel, handler })
      return next++
    },
    off: (id) => {
      listeners.delete(id)
    },
  }
  const fire = (channel: string, payload: unknown) => {
    for (const listener of listeners.values()) if (listener.channel === channel) listener.handler(payload)
  }
  return { bridge, fire, listeners }
}

describe('renderer IPC client', () => {
  it('invokes a channel by name through the bridge and returns its result', async () => {
    const calls: [string, unknown][] = []
    const { bridge } = fakeBridge((channel, input) => {
      calls.push([channel, input])
      return Promise.resolve({ ok: true, value: { echoed: 'typed' } })
    })
    const client = createIpcClient(() => bridge)
    const result = await client.invoke('client.echo', { text: 'typed' })
    expect(calls).toEqual([['client.echo', { text: 'typed' }]])
    expect(result).toEqual({ ok: true, value: { echoed: 'typed' } })
    if (result.ok) expect(result.value.echoed).toBe('typed')
  })

  it('invokes a channel without input when its input accepts undefined', async () => {
    const calls: unknown[] = []
    const client = createIpcClient(
      () =>
        fakeBridge((channel, input) => {
          calls.push([channel, input])
          return Promise.resolve({ ok: true, value: { version: '1.2.3' } })
        }).bridge,
    )
    expect(await client.invoke('app.version')).toEqual({ ok: true, value: { version: '1.2.3' } })
    expect(calls).toEqual([['app.version', undefined]])
  })

  it('returns {ok:false} when the bridge itself fails', async () => {
    const client = createIpcClient(() => fakeBridge(() => Promise.reject(new Error('No handler registered'))).bridge)
    expect(await client.invoke('client.echo', { text: 'x' })).toEqual({ ok: false, error: 'No handler registered' })
    const noBridge = createIpcClient(() => {
      throw new Error('window.worfy is missing')
    })
    expect(await noBridge.invoke('app.version')).toEqual({ ok: false, error: 'window.worfy is missing' })
  })

  it('does not compile a call outside the contract', async () => {
    const unknown: IpcResult<unknown> = { ok: false, error: 'unknown' }
    const client = createIpcClient(() => fakeBridge(() => Promise.resolve(unknown)).bridge)
    // @ts-expect-error -- 'no.such.channel' is not a key of IpcContract
    await client.invoke('no.such.channel', {})
    // @ts-expect-error -- the input of client.echo is { text: string }, not a number
    await client.invoke('client.echo', { text: 42 })
    // @ts-expect-error -- client.echo needs an input
    await client.invoke('client.echo')
    // @ts-expect-error -- an event channel cannot be invoked
    await client.invoke('client.ticked', { n: 1 })
    // @ts-expect-error -- an invoke channel cannot be subscribed to
    client.subscribe('client.echo', () => undefined)
  })

  it('subscribes to an event channel and stops on unsubscribe', () => {
    const { bridge, fire, listeners } = fakeBridge(() => Promise.resolve({ ok: false, error: 'unused' }))
    const client = createIpcClient(() => bridge)
    const seen: number[] = []
    const unsubscribe = client.subscribe('client.ticked', (payload) => seen.push(payload.n))
    fire('client.ticked', { n: 1 })
    unsubscribe()
    fire('client.ticked', { n: 2 })
    expect(seen).toEqual([1])
    expect(listeners.size).toBe(0)
  })
})

// ── the Machine of a window (worfy-link ticket 09) ──────────────────────────────────────────────

/** A Linked machine's id, as the window's address names it. */
const M = '0b7c4a52-3c1e-4f6e-9a4b-6d2f0c1e8a11'
/** Another Linked machine. */
const N = '5d0e9f13-8a7b-4c2d-b1e0-3f4a5b6c7d8e'

// The same schema as client.echo, marked `local`: the mark alone decides the route.
export const clientEchoHere = invokeChannel('client.echoHere', z.object({ text: z.string() }), z.object({ echoed: z.string() }), 'local')

declare module '../../src/shared/ipc/channels' {
  interface IpcContract {
    'client.echoHere': typeof clientEchoHere
  }
}

type RemoteCall = { machine: string; channel: string; input: unknown }

/** The preload of this Machine: what reached it, in order; `linked.invoke` answers what `remote` says. */
function preloadOfThisMachine(remote: (call: RemoteCall) => IpcResult<unknown> = () => ({ ok: true, value: 'from M' })) {
  const calls: [string, unknown][] = []
  const fake = fakeBridge((channel, input) => {
    calls.push([channel, input])
    if (channel === 'linked.invoke') return Promise.resolve({ ok: true, value: remote(input as RemoteCall) })
    return Promise.resolve({ ok: true, value: `here: ${channel}` })
  })
  return { ...fake, calls }
}

/** Shows the window on `machine` (null — this Machine), as its address does. */
function windowOn(machine: string | null): void {
  window.history.replaceState(null, '', machine === null ? '/' : `/?machine=${machine}&project=demo-0a1b2c3d`)
}

function install(preload: WorfyBridge): void {
  ;(globalThis as { worfy?: WorfyBridge }).worfy = preload
}

describe('the route of a call from a window on a Linked machine', () => {
  // One instance with the test's own channels: the routes come from the marks this realm declared.
  // Its state is kept per preload bridge, and each test installs a fresh one.
  let renderer: typeof import('../../src/renderer/ipc')

  beforeEach(async () => {
    renderer = await import('../../src/renderer/ipc')
  })

  afterEach(() => {
    windowOn(null)
    delete (globalThis as { worfy?: WorfyBridge }).worfy
  })

  it('sends layout.get of a window on M to its own main, as one linked.invoke naming M', async () => {
    const preload = preloadOfThisMachine(() => ({ ok: true, value: { layout: 'of M' } }))
    install(preload.bridge)
    windowOn(M)
    const result = await renderer.invoke('layout.get', { projectId: 'demo-0a1b2c3d' })
    expect(preload.calls).toEqual([['linked.invoke', { machine: M, channel: 'layout.get', input: { projectId: 'demo-0a1b2c3d' } }]])
    // The Linked machine's own answer, not main's envelope around it.
    expect(result).toEqual({ ok: true, value: { layout: 'of M' } })
  })

  it("passes M's refusal on as the answer of the call, and a failure of this Machine's main as it is", async () => {
    install(preloadOfThisMachine(() => ({ ok: false, error: 'shell.openInEditor: not open to Linked machines' })).bridge)
    windowOn(M)
    expect(await renderer.invoke('shell.openInEditor', { projectId: 'demo-0a1b2c3d', path: 'HANDOFF.md' })).toEqual({ ok: false, error: 'shell.openInEditor: not open to Linked machines' })
    install(fakeBridge(() => Promise.resolve({ ok: false, error: 'linked.invoke: invalid input' })).bridge)
    expect(await renderer.invoke('layout.get', { projectId: 'x' })).toEqual({ ok: false, error: 'linked.invoke: invalid input' })
  })

  it('keeps shell.openExternal of a window on M on this Machine: a link opens where it was clicked', async () => {
    const preload = preloadOfThisMachine()
    install(preload.bridge)
    windowOn(M)
    expect(await renderer.invoke('shell.openExternal', { url: 'https://example.com' })).toEqual({ ok: true, value: 'here: shell.openExternal' })
    expect(preload.calls).toEqual([['shell.openExternal', { url: 'https://example.com' }]])
  })

  it('keeps app.version and view.changed of a window on M on this Machine', async () => {
    const preload = preloadOfThisMachine()
    install(preload.bridge)
    windowOn(M)
    expect(await renderer.invoke('app.version')).toEqual({ ok: true, value: 'here: app.version' })
    const seen: unknown[] = []
    renderer.subscribe('view.changed', (payload) => seen.push(payload))
    expect([...preload.listeners.values()].map((listener) => listener.channel)).toEqual(['view.changed'])
    preload.fire('view.changed', { sidebar: true })
    expect(seen).toEqual([{ sidebar: true }])
    expect(preload.calls).toEqual([['app.version', undefined]])
  })

  it('sends every call of a window on this Machine straight to the preload, as before', async () => {
    const preload = preloadOfThisMachine()
    install(preload.bridge)
    windowOn(null)
    await renderer.invoke('layout.get', { projectId: 'demo-0a1b2c3d' })
    await renderer.invoke('app.version')
    await renderer.invoke('shell.openExternal', { url: 'https://example.com' })
    renderer.subscribe('layout.changed', () => undefined)
    expect(preload.calls).toEqual([
      ['layout.get', { projectId: 'demo-0a1b2c3d' }],
      ['app.version', undefined],
      ['shell.openExternal', { url: 'https://example.com' }],
    ])
    expect([...preload.listeners.values()].map((listener) => listener.channel)).toEqual(['layout.changed'])
  })

  it('sends invokeOn(M, projects.list) to M from a window on any Machine, and invokeOn(null, …) to this one', async () => {
    for (const shown of [null, M, N]) {
      const preload = preloadOfThisMachine()
      install(preload.bridge)
      windowOn(shown)
      await renderer.invokeOn(M, 'projects.list')
      await renderer.invokeOn(null, 'projects.list')
      expect(preload.calls).toEqual([
        ['linked.invoke', { machine: M, channel: 'projects.list', input: undefined }],
        ['projects.list', undefined],
      ])
    }
  })

  it("hands an event of M to a subscriber in a window on M, and never an event of this Machine's project channels", () => {
    const preload = preloadOfThisMachine()
    install(preload.bridge)
    windowOn(M)
    const seen: unknown[] = []
    const unsubscribe = renderer.subscribe('layout.changed', (payload) => seen.push(payload))
    // This Machine's own Layout event: another Project, maybe under the same id.
    preload.fire('layout.changed', { from: 'this Machine' })
    preload.fire('linked.event', { machine: N, channel: 'layout.changed', payload: { from: 'N' } })
    preload.fire('linked.event', { machine: M, channel: 'projects.changed', payload: { from: 'M, another channel' } })
    preload.fire('linked.event', { machine: M, channel: 'layout.changed', payload: { from: 'M' } })
    expect(seen).toEqual([{ from: 'M' }])
    unsubscribe()
    preload.fire('linked.event', { machine: M, channel: 'layout.changed', payload: { from: 'M again' } })
    expect(seen).toEqual([{ from: 'M' }])
    // The one linked.event subscription goes with the last listener.
    expect(preload.listeners.size).toBe(0)
  })

  it('never hands an event of M to a subscriber in a window on this Machine', () => {
    const preload = preloadOfThisMachine()
    install(preload.bridge)
    windowOn(null)
    const seen: unknown[] = []
    renderer.subscribe('layout.changed', (payload) => seen.push(payload))
    preload.fire('linked.event', { machine: M, channel: 'layout.changed', payload: { from: 'M' } })
    preload.fire('layout.changed', { from: 'this Machine' })
    expect(seen).toEqual([{ from: 'this Machine' }])
  })

  it('subscribeOn(M, …) hears M in a window on this Machine', () => {
    const preload = preloadOfThisMachine()
    install(preload.bridge)
    windowOn(null)
    const seen: unknown[] = []
    renderer.subscribeOn(M, 'projects.changed', (payload) => seen.push(payload))
    preload.fire('projects.changed', { from: 'this Machine' })
    preload.fire('linked.event', { machine: M, channel: 'projects.changed', payload: { from: 'M' } })
    expect(seen).toEqual([{ from: 'M' }])
  })

  it('takes the route from the mark: one schema goes to M marked project and stays here marked local', async () => {
    const preload = preloadOfThisMachine()
    install(preload.bridge)
    windowOn(M)
    await renderer.invoke('client.echo', { text: 'a' })
    await renderer.invoke('client.echoHere', { text: 'b' })
    expect(preload.calls).toEqual([
      ['linked.invoke', { machine: M, channel: 'client.echo', input: { text: 'a' } }],
      ['client.echoHere', { text: 'b' }],
    ])
  })

  it('routes every channel of src/shared/ipc/*.ts by its mark: project and desktop to M, local and link here', () => {
    const domains = import.meta.glob<Record<string, unknown>>('../../src/shared/ipc/*.ts', { eager: true })
    const channels = Object.values(domains).flatMap((module) =>
      Object.values(module).filter(
        (value): value is { kind: string; name: string; access: string } => typeof value === 'object' && value !== null && 'kind' in value && 'name' in value && 'access' in value,
      ),
    )
    // A guard for the test itself: an empty glob would pass the check below.
    expect(channels.length).toBeGreaterThanOrEqual(100)
    for (const access of ['project', 'desktop', 'local', 'link']) expect(channels.some((channel) => channel.access === access)).toBe(true)
    const expected = (access: string): string => (access === 'project' || access === 'desktop' ? 'window-machine' : 'this-machine')
    const wrong = channels.filter((channel) => renderer.routeOf(channel.name) !== expected(channel.access))
    expect(wrong.map((channel) => `${channel.name} (${channel.access})`)).toEqual([])
    // The channels of this ticket are this Machine's own.
    for (const name of ['linked.invoke', 'linked.event', 'linked.state', 'linked.changed', 'linked.open']) expect(renderer.routeOf(name)).toBe('this-machine')
  })
})

describe('what the renderer hears of Linked machines', () => {
  /** Every key of every object anywhere in a zod schema, with its path. */
  function keysOf(schema: unknown, path = ''): string[] {
    const def = (schema as { _zod?: { def?: Record<string, unknown> } })._zod?.def
    if (def === undefined) return []
    const keys: string[] = []
    const shape = def.shape as Record<string, unknown> | undefined
    if (shape !== undefined) {
      for (const [key, value] of Object.entries(shape)) keys.push(`${path}${key}`, ...keysOf(value, `${path}${key}.`))
    }
    for (const field of ['element', 'innerType', 'in', 'out']) if (def[field] !== undefined) keys.push(...keysOf(def[field], path))
    for (const option of (def.options as unknown[] | undefined) ?? []) keys.push(...keysOf(option, path))
    return keys
  }

  it('no channel of the link or linked domains carries a token or a certificate, and none the address of a Linked machine', async () => {
    const domains = [await import('../../src/shared/ipc/link'), await import('../../src/shared/ipc/linked')]
    type Declared = { kind: 'invoke' | 'event'; name: string; output?: unknown; payload?: unknown }
    const channels = domains.flatMap((module) =>
      Object.values(module).filter((value): value is Declared => typeof value === 'object' && value !== null && 'kind' in value && 'name' in value),
    )
    expect(channels.map((channel) => channel.name)).toEqual(
      expect.arrayContaining(['link.state', 'link.changed', 'linked.invoke', 'linked.event', 'linked.state', 'linked.changed', 'linked.open']),
    )
    // What the renderer hears: the output of a call and the payload of an event.
    const heard = channels.flatMap((channel) => keysOf(channel.kind === 'invoke' ? channel.output : channel.payload).map((key) => `${channel.name}: ${key}`))
    expect(heard.length).toBeGreaterThan(20)
    expect(heard.filter((key) => /token|secret|fingerprint|certificate(?!Changed)|cert\b/i.test(key))).toEqual([])
    // Addresses: only this Machine's own, and those of worfy found by Bonjour, which are not linked.
    const ownOrFound = /^link\.\w+: (state\.)?(addresses|discovered\.(host|port))$/
    expect(heard.filter((key) => /address|host|port/i.test(key) && !ownOrFound.test(key))).toEqual([])
    // A Linked machine is named by its id and name alone; its access level is this Machine's own setting.
    const linkedFields = new Set(heard.filter((key) => /^link\.\w+: (state\.)?linked\./.test(key)).map((key) => key.replace(/^.*linked\./, '')))
    expect(linkedFields).toEqual(new Set(['access', 'certificateChanged', 'id', 'name', 'state']))
  })
})
