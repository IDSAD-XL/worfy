// The clients of main (worfy-link ticket 03, ADR-0053): who hears main's events and whose
// subscriptions the hubs keep. A client is a window's webContents or a client without a window
// added to the registry (later: the connection of a Linked machine). Here the real broadcast
// (src/main/broadcast.ts), the real IPC modules of the hubs and the real stores run over a mocked
// `electron`, a temporary WORFY_DATA_DIR and a temporary WORFY_CLAUDE_HOME.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerModule } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { LayoutOpInput } from '../../src/shared/layout/types'

const PROJECT = 'demo-0a1b2c3d'
const CLAUDE_HOME_FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'claude-home')

const electron = vi.hoisted(() => ({ windows: [] as unknown[] }))

vi.mock('electron', () => ({
  app: { on: () => undefined },
  BrowserWindow: { getAllWindows: () => electron.windows, fromWebContents: () => null },
  dialog: { showOpenDialog: vi.fn() },
}))

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown
type Sent = { channel: string; payload: unknown }

/** A client as main sees it: what it was sent, and a `destroyed` it can emit. */
function fakeClient(id: number | string, options: { throws?: boolean } = {}) {
  const sent: Sent[] = []
  const onDestroyed: (() => void)[] = []
  let destroyed = false
  const client = {
    id,
    send: (channel: string, payload: unknown) => {
      if (options.throws) throw new Error(`client ${id} cannot take events`)
      sent.push({ channel, payload })
    },
    isDestroyed: () => destroyed,
    once: (event: string, listener: () => void) => {
      if (event === 'destroyed') onDestroyed.push(listener)
      return client
    },
  }
  const destroy = (): void => {
    destroyed = true
    for (const listener of onDestroyed.splice(0)) listener()
  }
  return { client, sent, destroy, onDestroyed }
}

/** A window of the app: a BrowserWindow whose webContents is the client. */
function fakeWindow(id: number, options: { throws?: boolean } = {}) {
  const contents = fakeClient(id, options)
  return { ...contents, window: { isDestroyed: () => contents.client.isDestroyed(), webContents: contents.client } }
}

const channelsOf = (sent: Sent[]): string[] => sent.map((each) => each.channel)

function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

let scratch: string
let dataDir: string
let repo: string
let cleanups: (() => Promise<unknown> | unknown)[]

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-clients-')))
  dataDir = join(scratch, 'data')
  repo = join(scratch, 'demo')
  mkdirSync(join(repo, '.scratch', 'demo', 'issues'), { recursive: true })
  writeFileSync(join(repo, '.scratch', 'demo', 'issues', '01-first.md'), '# 01 — first\n\nStatus: open\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  mkdirSync(join(scratch, 'claude-home'))
  process.env.WORFY_DATA_DIR = dataDir
  process.env.WORFY_CLAUDE_HOME = join(scratch, 'claude-home')
  electron.windows = []
  cleanups = []
  vi.resetModules()
})

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  delete process.env.WORFY_DATA_DIR
  delete process.env.WORFY_CLAUDE_HOME
  electron.windows = []
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** Registers `modules` through registerIpc, the wrapper the app uses; `call` passes `sender` as event.sender. */
async function ipcOver(modules: Record<string, () => Promise<HandlerModule>>) {
  const { registerIpc } = await import('../../src/main/ipc/index')
  const handlers = new Map<string, Listener>()
  await registerIpc({ handle: (channel, listener) => void handlers.set(channel, listener as Listener) }, { modules, isTrustedSender: () => true })
  return async (channel: string, input: unknown, sender?: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    const event = { senderFrame: { url: 'app://worfy' }, sender } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<unknown>
  }
}

const note = (id: string): LayoutOpInput => ({ op: 'create', node: { id, kind: 'note', x: 0, y: 0, w: 220, h: 120, data: { text: id } } }) as LayoutOpInput

/** Polls until `done` holds or five seconds pass. */
async function until(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
}

describe('the broadcast goes to every client', () => {
  async function layout() {
    const call = await ipcOver({ './layout.ts': () => import('../../src/main/ipc/layout').then((module) => module.default) })
    const { addClient } = await import('../../src/main/broadcast')
    return { call, addClient }
  }

  it('reaches two windows and a client without a window with layout.changed', async () => {
    const one = fakeWindow(1)
    const two = fakeWindow(2)
    electron.windows = [one.window, two.window]
    const { call, addClient } = await layout()
    const linked = fakeClient('link:machine-b')
    addClient(linked.client)

    expect((await call('layout.apply', { projectId: PROJECT, op: note('n1') })).ok).toBe(true)
    for (const each of [one, two, linked]) {
      expect(channelsOf(each.sent)).toEqual(['worfy:layout.changed'])
      expect(each.sent[0]?.payload).toMatchObject({ projectId: PROJECT, layout: { nodes: expect.arrayContaining([expect.objectContaining({ id: 'n1' })]) } })
    }
  })

  it('skips a destroyed client; one that throws on send does not stop the others', async () => {
    const throwing = fakeWindow(1, { throws: true })
    const closed = fakeWindow(2)
    const open = fakeWindow(3)
    electron.windows = [throwing.window, closed.window, open.window]
    const { call, addClient } = await layout()
    const broken = fakeClient('link:broken', { throws: true })
    const gone = fakeClient('link:gone')
    const linked = fakeClient('link:machine-b')
    for (const each of [broken, gone, linked]) addClient(each.client)
    closed.destroy()
    gone.destroy()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    cleanups.push(() => warn.mockRestore())
    expect((await call('layout.apply', { projectId: PROJECT, op: note('n1') })).ok).toBe(true)
    expect(channelsOf(open.sent)).toEqual(['worfy:layout.changed'])
    expect(channelsOf(linked.sent)).toEqual(['worfy:layout.changed'])
    expect(closed.sent).toEqual([])
    expect(gone.sent).toEqual([])
    // Each failure is reported once, for the client that failed.
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('forgets a client without a window when it is destroyed, and lets its id be used again', async () => {
    const { clients, addClient } = await import('../../src/main/broadcast')
    const first = fakeClient('link:machine-b')
    addClient(first.client)
    expect(clients.list().map((each) => each.id)).toEqual(['link:machine-b'])
    // The same id twice while the first is live is a bug in the caller.
    expect(() => addClient(fakeClient('link:machine-b').client)).toThrow(/link:machine-b/)
    first.destroy()
    expect(clients.list()).toEqual([])
    // Not only hidden: the registry lets go of it.
    expect(clients.held).toBe(0)
    const second = fakeClient('link:machine-b')
    addClient(second.client)
    expect(clients.list()).toEqual([second.client])
    // A client destroyed before it was added never joins.
    const late = fakeClient('link:late')
    late.destroy()
    addClient(late.client)
    expect(clients.list()).toEqual([second.client])
    expect(clients.held).toBe(1)
  })

  it('a late destroyed of an old client does not take away the new client with its id', async () => {
    const { clients, addClient } = await import('../../src/main/broadcast')
    const old = fakeClient('link:machine-b')
    addClient(old.client)
    // The old connection is closed but has not emitted destroyed yet; a new one comes under the same id.
    old.client.isDestroyed = () => true
    const fresh = fakeClient('link:machine-b')
    addClient(fresh.client)
    old.destroy()
    expect(clients.list()).toEqual([fresh.client])
  })

  it('lists the live windows first and the clients without a window after them', async () => {
    const one = fakeWindow(1)
    const closed = fakeWindow(2)
    electron.windows = [one.window, closed.window]
    closed.destroy()
    const { clients, addClient } = await import('../../src/main/broadcast')
    const linked = fakeClient('link:machine-b')
    addClient(linked.client)
    expect(clients.list()).toEqual([one.client, linked.client])
  })
})

describe('the id of a client', () => {
  it('a client without a window takes a "<kind>:<name>" id; a window id, an Autopilot id or "main" is refused', async () => {
    const { isWindowlessId } = await import('../../src/main/clients')
    const { addClient } = await import('../../src/main/broadcast')
    for (const id of ['link:machine-b', 'link:7f3a-01', 'test:x']) expect(isWindowlessId(id), id).toBe(true)
    // A window keeps its webContents id (a positive number), Autopilot's own workflow subscribers
    // count down from -1 (src/main/ipc/autopilot.ts), main's docs subscriber is 'main'
    // (src/main/ipc/docs.ts): none of them can be the id of a client without a window.
    for (const id of [1, 7, -1, 0, 'main', '7', '', 'link:', ':x', 'Link:x', 'link: x']) {
      expect(isWindowlessId(id), String(id)).toBe(false)
      expect(() => addClient(fakeClient(id).client), String(id)).toThrow(/id/)
    }
  })

  it('a window, a client without a window and an Autopilot subscriber share one workflow watcher; closing one keeps the others', async () => {
    const call = await ipcOver({ './workflow.ts': () => import('../../src/main/ipc/workflow').then((module) => module.default) })
    const { workflowHub } = await import('../../src/main/ipc/workflow')
    cleanups.push(() => workflowHub.closeAll())
    const window = fakeWindow(1)
    const linked = fakeClient('link:machine-b')
    // Autopilot's own subscriber, as src/main/ipc/autopilot.ts opens it: a negative id.
    const autopilot: unknown[] = []
    await workflowHub.open(repo, { id: -1, send: (delta) => autopilot.push(delta) })
    expect((await call('workflow.open', { root: repo }, window.client)).ok).toBe(true)
    expect((await call('workflow.open', { root: repo }, linked.client)).ok).toBe(true)

    expect(await call('workflow.close', { root: repo }, window.client)).toEqual({ ok: true, value: { closed: true } })
    expect(workflowHub.roots).toEqual([repo])
    // The windowless client is still subscribed: closing it answers true, once.
    expect(await call('workflow.close', { root: repo }, linked.client)).toEqual({ ok: true, value: { closed: true } })
    expect(await call('workflow.close', { root: repo }, linked.client)).toEqual({ ok: true, value: { closed: false } })
    expect(workflowHub.roots).toEqual([repo])
    expect(await workflowHub.close(repo, -1)).toBe(true)
    expect(workflowHub.roots).toEqual([])
  })
})

describe('the hubs keep a client without a window until it is destroyed', () => {
  it('workflow, docs, claude-home, bindings and limits subscribe it, and let go of it on destroyed', async () => {
    const { workflowHub } = await import('../../src/main/ipc/workflow')
    const { docsHub } = await import('../../src/main/ipc/docs')
    const { ClaudeHomeRegistry } = await import('../../src/main/claude-home/registry')
    const { ClaudeHomeSubscriptions, claudeHomeHandlers } = await import('../../src/main/ipc/claude-home')
    const { BindingStore } = await import('../../src/main/layout/bindings')
    const { bindingsHandlers } = await import('../../src/main/ipc/bindings')
    const { LimitsTracker } = await import('../../src/main/agent/limits')
    const { limitsHandlers } = await import('../../src/main/ipc/limits')
    cleanups.push(() => workflowHub.closeAll(), () => docsHub.closeAll())

    const registry = new ClaudeHomeRegistry({ home: CLAUDE_HOME_FIXTURE, listWorktrees: async () => [], isAlive: async () => false })
    const subscriptions = new ClaudeHomeSubscriptions(registry, new Set())
    cleanups.push(() => subscriptions.closeAll())

    // The stores count who listens to them.
    const bindings = new BindingStore((projectId) => join(dataDir, projectId))
    let bindingListeners = 0
    const bindingsOnChange = bindings.onChange.bind(bindings)
    vi.spyOn(bindings, 'onChange').mockImplementation((listener) => {
      bindingListeners += 1
      const off = bindingsOnChange(listener)
      return () => {
        bindingListeners -= 1
        off()
      }
    })
    const limits = new LimitsTracker({ dataDir, now: () => 0 })
    let limitsListeners = 0
    const limitsSubscribe = limits.subscribe.bind(limits)
    vi.spyOn(limits, 'subscribe').mockImplementation((listener) => {
      limitsListeners += 1
      const off = limitsSubscribe(listener)
      return () => {
        limitsListeners -= 1
        off()
      }
    })

    const call = await ipcOver({
      './workflow.ts': () => import('../../src/main/ipc/workflow').then((module) => module.default),
      './docs.ts': () => import('../../src/main/ipc/docs').then((module) => module.default),
      './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions),
      './bindings.ts': async () => bindingsHandlers(() => bindings, () => registry),
      './limits.ts': async () => limitsHandlers(() => limits),
    })
    const linked = fakeClient('link:machine-b')
    const { addClient } = await import('../../src/main/broadcast')
    addClient(linked.client)

    expect((await call('workflow.open', { root: repo }, linked.client)).ok).toBe(true)
    expect((await call('docs.open', { projectId: PROJECT }, linked.client)).ok).toBe(true)
    expect((await call('claudeHome.sessions', { projectRoot: '/Users/test/projects/demo' }, linked.client)).ok).toBe(true)
    expect((await call('bindings.get', { projectId: PROJECT }, linked.client)).ok).toBe(true)
    expect((await call('limits.open', undefined, linked.client)).ok).toBe(true)
    expect(workflowHub.roots).toEqual([repo])
    expect(docsHub.projects).toEqual([PROJECT])
    expect(subscriptions.size).toBe(1)
    expect(bindingListeners).toBe(1)
    expect(limitsListeners).toBe(1)
    // A change reaches the subscribed client.
    bindings.set(PROJECT, { sessionId: 's1', agentId: null }, { kind: 'ticket', epic: 'demo', num: 1 })
    expect(channelsOf(linked.sent)).toContain('worfy:bindings.changed')

    linked.destroy()
    await until(() => workflowHub.roots.length === 0 && docsHub.projects.length === 0 && subscriptions.size === 0)
    expect(workflowHub.roots).toEqual([])
    expect(docsHub.projects).toEqual([])
    expect(subscriptions.size).toBe(0)
    expect(bindingListeners).toBe(0)
    expect(limitsListeners).toBe(0)
    // Nothing reaches it any more.
    const before = linked.sent.length
    bindings.set(PROJECT, { sessionId: 's1', agentId: null }, { kind: 'ticket', epic: 'demo', num: 2 })
    expect(linked.sent).toHaveLength(before)
  })
})
