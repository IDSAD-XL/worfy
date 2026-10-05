// The renderer side of the IPC contract: src/renderer/ipc.ts over a fake window.worfy bridge.
// This file is .tsx so it is typechecked with the renderer's test project (tsconfig.test.web.json),
// which sees src/renderer/ipc.ts; main's side is in ipc.test.ts. The channels it declares below
// exist only in the test projects: tsconfig.web.json typechecks src/ without them.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { eventChannel, invokeChannel, type IpcResult, type WorfyBridge } from '../../src/shared/ipc/channels'
import { createIpcClient } from '../../src/renderer/ipc'

// Test-only channels, added the same way a domain file adds its own.
export const clientEcho = invokeChannel('client.echo', z.object({ text: z.string() }), z.object({ echoed: z.string() }))
export const clientTicked = eventChannel('client.ticked', z.object({ n: z.number() }))

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
