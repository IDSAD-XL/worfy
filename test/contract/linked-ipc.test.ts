// The `linked` handlers of this Machine's main (worfy-link ticket 09, src/main/ipc/linked.ts): a
// window's call to a Linked machine goes through the app's RemoteCalls, and a window that showed a
// Project of a Linked machine lets go of it when it closes or loads another page. RemoteCalls is
// replaced by a recorder (its own test: remote-calls.test.ts).
import { EventEmitter } from 'node:events'
import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'

const M = '0b7c4a52-3c1e-4f6e-9a4b-6d2f0c1e8a11'

const remote = vi.hoisted(() => ({
  started: true,
  calls: [] as { machine: string; channel: string; input: unknown }[],
}))

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

vi.mock('../../src/main/link/remote-calls', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  const calls = new (class extends Emitter {
    machines() {
      return []
    }
    call(machine: string, channel: string, input: unknown): Promise<IpcResult<unknown>> {
      remote.calls.push({ machine, channel, input })
      return Promise.resolve({ ok: true, value: { from: machine } })
    }
  })()
  return { appRemoteCalls: () => (remote.started ? calls : undefined) }
})

const { registerIpc } = await import('../../src/main/ipc/index')
type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown
const handlers = new Map<string, Listener>()
await registerIpc(
  { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
  { modules: { './linked.ts': () => import('../../src/main/ipc/linked').then((module) => module.default) }, isTrustedSender: () => true },
)

/** A window's webContents, as far as the handlers use it. */
class Contents extends EventEmitter {
  constructor(readonly id: number) {
    super()
  }
}

async function call(channel: string, input: unknown, sender: unknown = new Contents(1)): Promise<IpcResult<unknown>> {
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  return (await listener({ senderFrame: { url: 'file:///index.html' }, sender } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
}

const holds = () => remote.calls.filter((entry) => entry.channel === 'projects.hold').map((entry) => entry.input)

beforeEach(() => {
  remote.started = true
  remote.calls.length = 0
})

describe('linked.invoke', () => {
  it("passes a window's call on to the Linked machine and answers with its result", async () => {
    expect(await call('linked.invoke', { machine: M, channel: 'layout.get', input: { projectId: 'p' } })).toEqual({ ok: true, value: { ok: true, value: { from: M } } })
    expect(remote.calls).toEqual([{ machine: M, channel: 'layout.get', input: { projectId: 'p' } }])
  })

  it('answers {ok:false} inside the value while the link has not started', async () => {
    remote.started = false
    const result = await call('linked.invoke', { machine: M, channel: 'layout.get', input: {} })
    expect(result).toMatchObject({ ok: true, value: { ok: false } })
    expect(remote.calls).toEqual([])
  })

  it('refuses a channel name with the IPC prefix', async () => {
    const result = await call('linked.invoke', { machine: M, channel: `${IPC_CHANNEL_PREFIX}layout.get`, input: {} })
    expect(result).toMatchObject({ ok: true, value: { ok: false } })
    expect(remote.calls).toEqual([])
  })
})

describe('linked.open', () => {
  it('holds the Project on the Linked machine under the window id, and lets go when the window loads another page', async () => {
    const window = new Contents(41)
    expect(await call('linked.open', { machine: M, projectId: 'demo-1' }, window)).toEqual({ ok: true, value: { projectId: 'demo-1' } })
    expect(holds()).toEqual([{ screen: '41', projectId: 'demo-1' }])
    // A fragment or history change is no new page.
    window.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    window.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    expect(holds()).toHaveLength(1)
    window.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(holds()).toEqual([
      { screen: '41', projectId: 'demo-1' },
      { screen: '41', projectId: null },
    ])
    // Let go once: the next page holds afresh.
    window.emit('destroyed')
    expect(holds()).toHaveLength(2)
  })

  it('lets go when the window closes, and listens to a window once however often it opens', async () => {
    const window = new Contents(42)
    await call('linked.open', { machine: M, projectId: 'demo-1' }, window)
    await call('linked.open', { machine: M, projectId: 'demo-2' }, window)
    expect(window.listenerCount('destroyed')).toBe(1)
    window.emit('destroyed')
    expect(holds()).toEqual([
      { screen: '42', projectId: 'demo-1' },
      { screen: '42', projectId: 'demo-2' },
      { screen: '42', projectId: null },
    ])
  })
})
