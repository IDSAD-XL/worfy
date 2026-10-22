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
    // A fragment or history change, or a navigation of a frame inside the page, is no new page.
    window.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    window.emit('did-navigate-in-page', {}, 'file:///index.html#x', true)
    window.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    window.emit('did-frame-navigate', {}, 'about:blank', -1, '', false, 1, 1)
    expect(holds()).toHaveLength(1)
    // The new document commits in the main frame: the old page is gone.
    window.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(holds()).toHaveLength(1)
    window.emit('did-navigate', {}, 'file:///index.html', -1, '')
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

  it('keeps the Project held when a navigation starts but never commits: the page stays', async () => {
    const window = new Contents(43)
    await call('linked.open', { machine: M, projectId: 'demo-1' }, window)
    // A refused URL (will-frame-navigate, src/main/window.ts), a 204, a download: the start comes,
    // the commit does not.
    window.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    window.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'worfy-card://refused', true)
    window.emit('did-stop-loading')
    expect(holds()).toEqual([{ screen: '43', projectId: 'demo-1' }])
    // The page that stayed is still the holder: its close lets go.
    window.emit('destroyed')
    expect(holds()).toEqual([
      { screen: '43', projectId: 'demo-1' },
      { screen: '43', projectId: null },
    ])
  })
})

describe('subscriptions of several windows on one Linked machine (worfy-windows ticket 64)', () => {
  // The Linked machine serves all windows of this Machine with one client: a close goes there only
  // when the last window lets go (two windows end to end: linked-shared-subscriptions.test.ts).
  const closes = () => remote.calls.filter((entry) => entry.channel.endsWith('.close'))
  const invoke = (window: Contents, channel: string, input: unknown) => call('linked.invoke', { machine: M, channel, input }, window)

  it('answers the close of a window while another holds the subscription, and passes the last one on', async () => {
    const [first, second] = [new Contents(51), new Contents(52)]
    await invoke(first, 'claudeHome.sessions', { projectRoot: '/p' })
    await invoke(second, 'claudeHome.sessions', { projectRoot: '/p' })
    expect(await invoke(first, 'claudeHome.close', { projectRoot: '/p' })).toEqual({ ok: true, value: { ok: true, value: { closed: true } } })
    expect(closes()).toEqual([])
    await invoke(second, 'claudeHome.close', { projectRoot: '/p' })
    expect(closes()).toEqual([{ machine: M, channel: 'claudeHome.close', input: { projectRoot: '/p' } }])
  })

  it('counts a window once however often it subscribes, and each channel apart', async () => {
    const [first, second] = [new Contents(53), new Contents(54)]
    await invoke(first, 'workflow.open', { root: '/w' })
    await invoke(first, 'workflow.open', { root: '/w' })
    await invoke(second, 'pipeline.get', { root: '/w' })
    await invoke(first, 'workflow.close', { root: '/w' })
    expect(closes()).toEqual([{ machine: M, channel: 'workflow.close', input: { root: '/w' } }])
    await invoke(second, 'pipeline.close', { root: '/w' })
    expect(closes().map((entry) => entry.channel)).toEqual(['workflow.close', 'pipeline.close'])
  })

  it('workflow and pipeline: spellings of one folder are one subscription, as on the Linked machine; the last close goes for each spelling sent', async () => {
    const [first, second, third] = [new Contents(60), new Contents(61), new Contents(62)]
    await invoke(first, 'workflow.open', { root: 'C:/Work/p' })
    await invoke(second, 'workflow.open', { root: 'c:\\Work\\p\\' })
    await invoke(third, 'workflow.open', { root: 'C:/Work/./x/../p//' })
    await invoke(first, 'workflow.close', { root: 'C:/Work/p' })
    await invoke(second, 'workflow.close', { root: 'c:\\Work\\p\\' })
    expect(closes()).toEqual([])
    await invoke(third, 'workflow.close', { root: 'C:/Work/./x/../p//' })
    expect(closes().map((entry) => entry.input)).toEqual([{ root: 'C:/Work/./x/../p//' }, { root: 'C:/Work/p' }, { root: 'c:\\Work\\p\\' }])
  })

  it('a window that subscribes while the last close is on the way keeps the subscription: the other spellings are not closed after it', async () => {
    const [first, second, third] = [new Contents(71), new Contents(72), new Contents(73)]
    await invoke(first, 'pipeline.get', { root: '/r' })
    await invoke(second, 'pipeline.get', { root: '/r/' })
    await invoke(second, 'pipeline.close', { root: '/r/' })
    await Promise.all([invoke(first, 'pipeline.close', { root: '/r' }), invoke(third, 'pipeline.get', { root: '/r' })])
    expect(closes()).toEqual([{ machine: M, channel: 'pipeline.close', input: { root: '/r' } }])
    await invoke(third, 'pipeline.close', { root: '/r' })
    expect(closes()).toHaveLength(2)
  })

  it('docs: counts the windows on one Project id, and passes on the close of the last (worfy-windows ticket 69)', async () => {
    const [first, second] = [new Contents(74), new Contents(75)]
    await invoke(first, 'docs.open', { projectId: 'demo-1' })
    await invoke(second, 'docs.open', { projectId: 'demo-1' })
    expect(await invoke(first, 'docs.close', { projectId: 'demo-1' })).toEqual({ ok: true, value: { ok: true, value: { closed: true } } })
    expect(closes()).toEqual([])
    await invoke(second, 'docs.close', { projectId: 'demo-1' })
    expect(closes()).toEqual([{ machine: M, channel: 'docs.close', input: { projectId: 'demo-1' } }])
  })

  it('docs: a Project id is compared as sent: ids that differ in case are two subscriptions', async () => {
    const [first, second] = [new Contents(76), new Contents(77)]
    await invoke(first, 'docs.open', { projectId: 'Demo-2' })
    await invoke(second, 'docs.open', { projectId: 'demo-2' })
    await invoke(first, 'docs.close', { projectId: 'Demo-2' })
    expect(closes()).toEqual([{ machine: M, channel: 'docs.close', input: { projectId: 'Demo-2' } }])
  })

  it('claudeHome: each spelling is a subscription of its own, as on the Linked machine', async () => {
    const [first, second] = [new Contents(63), new Contents(64)]
    await invoke(first, 'claudeHome.sessions', { projectRoot: '/h' })
    await invoke(second, 'claudeHome.sessions', { projectRoot: '/h/' })
    await invoke(first, 'claudeHome.close', { projectRoot: '/h' })
    expect(closes()).toEqual([{ machine: M, channel: 'claudeHome.close', input: { projectRoot: '/h' } }])
  })

  it('a close from a window not counted in answers closed:false here while other windows hold the subscription', async () => {
    const [holder, stray] = [new Contents(65), new Contents(66)]
    await invoke(holder, 'pipeline.get', { root: '/s' })
    expect(await invoke(stray, 'pipeline.close', { root: '/s' })).toEqual({ ok: true, value: { ok: true, value: { closed: false } } })
    expect(closes()).toEqual([])
    await invoke(holder, 'pipeline.close', { root: '/s' })
    expect(closes()).toEqual([{ machine: M, channel: 'pipeline.close', input: { root: '/s' } }])
  })

  it('counts each Linked machine apart for one Project path', async () => {
    const OTHER = '5d0e2f4a-8b1c-4c3d-9e7f-1a2b3c4d5e6f'
    const [first, second] = [new Contents(67), new Contents(68)]
    await invoke(first, 'workflow.open', { root: '/m' })
    await call('linked.invoke', { machine: OTHER, channel: 'workflow.open', input: { root: '/m' } }, second)
    await invoke(first, 'workflow.close', { root: '/m' })
    expect(closes()).toEqual([{ machine: M, channel: 'workflow.close', input: { root: '/m' } }])
    second.emit('destroyed')
    expect(closes()).toEqual([
      { machine: M, channel: 'workflow.close', input: { root: '/m' } },
      { machine: OTHER, channel: 'workflow.close', input: { root: '/m' } },
    ])
  })

  it('does not count a window already destroyed, and does not pass its open on', async () => {
    const [gone, alive] = [Object.assign(new Contents(69), { isDestroyed: () => true }), new Contents(70)]
    expect(await invoke(gone, 'workflow.open', { root: '/d' })).toEqual({ ok: true, value: { ok: false, error: 'workflow.open: the window is gone' } })
    expect(remote.calls).toEqual([])
    await invoke(alive, 'workflow.open', { root: '/d' })
    await invoke(alive, 'workflow.close', { root: '/d' })
    expect(closes()).toEqual([{ machine: M, channel: 'workflow.close', input: { root: '/d' } }])
  })

  it('a window that closes or loads another page lets go; the close goes when it was the last', async () => {
    const [first, second] = [new Contents(55), new Contents(56)]
    await invoke(first, 'pipeline.get', { root: '/q' })
    await invoke(second, 'pipeline.get', { root: '/q' })
    first.emit('destroyed')
    expect(closes()).toEqual([])
    second.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    second.emit('did-navigate-in-page', {}, 'file:///index.html#x', true)
    expect(closes()).toEqual([])
    second.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    second.emit('did-navigate', {}, 'file:///index.html', -1, '')
    expect(closes()).toEqual([{ machine: M, channel: 'pipeline.close', input: { root: '/q' } }])
    // Let go once: a close the window sends after its page went passes on as before.
    await invoke(second, 'pipeline.close', { root: '/q' })
    expect(closes()).toHaveLength(2)
  })

  it('a navigation that starts but never commits keeps the window counted: its subscription and its events stay', async () => {
    const [first, second] = [new Contents(58), new Contents(59)]
    await invoke(first, 'workflow.open', { root: '/r' })
    await invoke(second, 'workflow.open', { root: '/r' })
    second.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    second.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'worfy-card://refused', true)
    second.emit('did-stop-loading')
    first.emit('destroyed')
    // The second window is still counted in: the subscription stays on the Linked machine.
    expect(closes()).toEqual([])
    expect(await invoke(second, 'workflow.close', { root: '/r' })).toEqual({ ok: true, value: { ok: true, value: { from: M } } })
    expect(closes()).toEqual([{ machine: M, channel: 'workflow.close', input: { root: '/r' } }])
  })

  it('a close without a subscription counted here passes on unchanged', async () => {
    const window = new Contents(57)
    await invoke(window, 'claudeHome.close', { projectRoot: '/never' })
    expect(closes()).toEqual([{ machine: M, channel: 'claudeHome.close', input: { projectRoot: '/never' } }])
  })
})
