// Two windows of one Machine on the same Project of a Linked machine (worfy-windows ticket 64). The
// windows of Machine A that show Projects of Linked machine B all call B over one connection, and B
// serves that connection with one `project` client (src/main/link/ipc-adapter.ts, LinkPeer). B keys
// the subscriptions of `claudeHome.sessions`, `workflow.open` and `pipeline.get` by client and root,
// so the close of one window ended the subscription of every window of A: the other window got no
// `claudeHome.changed`, `workflow.changed` or `pipeline.changed` any more.
//
// End to end over a real link connection (test/contract/link-bench.ts): the windows call
// `linked.invoke` on A's main (src/main/ipc/linked.ts), A's RemoteCalls passes the call to B, B's
// real handlers answer over stand-in hubs, and what B sends comes back to A's windows as
// `linked.event`. The hubs and the Claude home watcher are stand-ins the test drives by hand: no
// watcher of files, no git.
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeHomeRegistry } from '../../src/main/claude-home/registry'
import type { HandlerModule, ModuleLoader } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { LinkBench, type BenchMachine } from './link-bench'
import { removeTestTree } from '../remove'

const env = await vi.hoisted(async () => {
  // Before any module of main is imported: the workflow hub takes the Claude home at import.
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-64-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  process.env.WORFY_CLAUDE_HOME = path.join(scratch, 'claude-home')
  return { scratch }
})

/** The windows of Machine A: linked.ts sends each of them the events of a Linked machine. */
const screens = vi.hoisted(() => ({ windows: [] as { isDestroyed(): boolean; webContents: unknown }[] }))

vi.mock('electron', () => ({
  app: { on: () => undefined, getVersion: () => '0.2.0', isPackaged: false, getAppPath: () => '/' },
  BrowserWindow: { getAllWindows: () => screens.windows, fromWebContents: () => null },
}))
vi.mock('../../src/main/harness/script-env', () => ({ harnessScriptEnv: () => Promise.resolve(process.env) }))

/** A's RemoteCalls: over the bench service of A, made fresh for each test. */
const app = vi.hoisted(() => ({ calls: undefined as unknown }))
vi.mock('../../src/main/link/remote-calls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/link/remote-calls')>()),
  appRemoteCalls: () => app.calls,
}))

const { addClient } = await import('../../src/main/broadcast')
const { claudeHomeHandlers, ClaudeHomeSubscriptions } = await import('../../src/main/ipc/claude-home')
const { registerIpc } = await import('../../src/main/ipc/index')
const { pipelineHandlers } = await import('../../src/main/ipc/pipeline')
const { workflowHandlers } = await import('../../src/main/ipc/workflow')
const { RemoteCalls } = await import('../../src/main/link/remote-calls')

/** B's Project. */
const PROJECT = join(env.scratch, 'project')
mkdirSync(PROJECT, { recursive: true })
const projects = () => [{ path: PROJECT }]

// ---- B's side: the real handlers over stand-ins -----------------------------------------------

/** The Claude home watchers B opened, each with its change callback, open until closed. */
const homeWatchers: { onChange: (change: { sessions: boolean; transcripts: string[] }) => void; open: boolean }[] = []
const registry = {
  watch: async (_root: unknown, onChange: (change: { sessions: boolean; transcripts: string[] }) => void) => {
    const watcher = { onChange, open: true }
    homeWatchers.push(watcher)
    return {
      ready: Promise.resolve(),
      close: async () => {
        watcher.open = false
      },
    }
  },
  sessions: async () => ({ live: [], history: [] }),
  live: async () => [],
} as unknown as ClaudeHomeRegistry
const claudeHomeSubscriptions = new ClaudeHomeSubscriptions(registry, new Set())

interface Subscriber {
  readonly id: number | string
  send(payload: unknown): void
}

/** A hub that keys a Project by path.resolve, as the real ones do (src/main/workflow/watch.ts, stages.ts). */
function standInHub(first: (root: string) => unknown) {
  const subscribers = new Map<string, Map<number | string, Subscriber>>()
  return {
    hub: {
      open: async (asked: string, subscriber: Subscriber) => {
        const key = resolve(asked)
        subscribers.set(key, (subscribers.get(key) ?? new Map()).set(subscriber.id, subscriber))
        return first(key)
      },
      close: async (asked: string, id: number | string) => subscribers.get(resolve(asked))?.delete(id) ?? false,
      drop: async (id: number | string) => {
        for (const each of subscribers.values()) each.delete(id)
      },
    },
    /** How many subscribers the Project has. */
    subscribed: () => subscribers.get(resolve(PROJECT))?.size ?? 0,
    /** Sends every subscriber of the Project what `make` builds of its root. */
    change(make: (root: string) => unknown): void {
      const key = resolve(PROJECT)
      for (const subscriber of subscribers.get(key)?.values() ?? []) subscriber.send(make(key))
    },
  }
}

const workflow = standInHub((root) => ({ root, epics: [], tickets: [], error: null, branchErrors: [] }))
const pipeline = standInHub((root) => ({ root, pipeline: [], tickets: [], error: null }))

const asLoader =
  (module: HandlerModule): ModuleLoader =>
  async () =>
    module
const modules: Record<string, ModuleLoader> = {
  './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default),
  './claude-home.ts': asLoader(claudeHomeHandlers(registry, claudeHomeSubscriptions, undefined, projects)),
  './workflow.ts': asLoader(workflowHandlers({ hub: workflow.hub as never, projects })),
  './pipeline.ts': asLoader(pipelineHandlers({ hub: pipeline.hub as never, projects })),
}

// ---- A's side: the `linked` handlers and two windows -------------------------------------------

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown
const linkedHandlers = new Map<string, Listener>()
await registerIpc(
  { handle: (channel, listener) => linkedHandlers.set(channel, listener as Listener) },
  { modules: { './linked.ts': () => import('../../src/main/ipc/linked').then((module) => module.default) }, isTrustedSender: () => true },
)

/** A window's webContents: what linked.ts sends it is kept by channel. */
class Window extends EventEmitter {
  readonly sent: { channel: string; payload: unknown }[] = []
  constructor(readonly id: number) {
    super()
  }
  send(channel: string, payload: unknown): void {
    this.sent.push({ channel: channel.slice(IPC_CHANNEL_PREFIX.length), payload })
  }
  isDestroyed(): boolean {
    return false
  }
  /** The `channel` events of the Linked machine this window heard. */
  heard(channel: string): unknown[] {
    return this.sent
      .filter((entry) => entry.channel === 'linked.event' && (entry.payload as { channel: string }).channel === channel)
      .map((entry) => (entry.payload as { payload: unknown }).payload)
  }
}

let bench: LinkBench | undefined
let a: BenchMachine
let b: BenchMachine
let bId: string
let first: Window
let second: Window

/** `window` calls `channel` on B, as a window that shows B's Project does (src/renderer/ipc.ts). */
async function windowCall(window: Window, channel: string, input: unknown): Promise<IpcResult<unknown>> {
  const listener = linkedHandlers.get(`${IPC_CHANNEL_PREFIX}linked.invoke`)
  if (!listener) throw new Error('no handler for linked.invoke')
  const result = (await listener({ senderFrame: { url: 'file:///index.html' }, sender: window } as unknown as IpcMainInvokeEvent, { machine: bId, channel, input })) as IpcResult<IpcResult<unknown>>
  if (!result.ok) throw new Error(result.error)
  return result.value
}

/** Polls until `done` holds or five seconds pass. */
async function until(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!done() && Date.now() < deadline) await new Promise((wait) => setTimeout(wait, 20))
}

/** Waits for the frames in flight over the connection: a ping there and back. */
async function settle(): Promise<void> {
  expect(await a.service.call(bId, 'link.ping', undefined)).toMatchObject({ ok: true })
}

beforeEach(async () => {
  bench = new LinkBench({ ipcModules: modules, addClient })
  a = await bench.machine('alpha')
  b = await bench.machine('beta')
  await bench.link(a, b)
  bId = b.service.machine.id
  b.service.settings.set({ projectsAccess: true, machines: { [a.service.machine.id]: 'read' } })
  app.calls = new RemoteCalls(a.service, { warn: () => undefined })
  await a.service.connect(bId)
  homeWatchers.length = 0
  first = new Window(1)
  second = new Window(2)
  screens.windows = [first, second].map((window) => ({ isDestroyed: () => false, webContents: window }))
})

afterEach(async () => {
  const current = bench
  bench = undefined
  screens.windows = []
  await current?.close()
  await claudeHomeSubscriptions.closeAll()
})

afterAll(() => {
  removeTestTree(env.scratch)
})

/** Both windows have heard `channel` `times` times after `change`: B's events reach every window of A. */
async function bothHear(channel: string, change: () => void, times: number): Promise<void> {
  change()
  await until(() => first.heard(channel).length >= times && second.heard(channel).length >= times)
  expect([first.heard(channel).length, second.heard(channel).length]).toEqual([times, times])
}

describe('two windows of A on one Project of B', () => {
  it('claudeHome: one window closes, the other still gets claudeHome.changed; the last close ends the watcher', async () => {
    expect(await windowCall(first, 'claudeHome.sessions', { projectRoot: PROJECT })).toMatchObject({ ok: true })
    expect(await windowCall(second, 'claudeHome.sessions', { projectRoot: PROJECT })).toMatchObject({ ok: true })
    // Both windows share one client on B, so B opened one watcher, and its events reach both.
    expect(homeWatchers).toHaveLength(1)
    const fire = () => homeWatchers.filter((watcher) => watcher.open).forEach((watcher) => watcher.onChange({ sessions: true, transcripts: [] }))
    await bothHear('claudeHome.changed', fire, 1)

    expect(await windowCall(first, 'claudeHome.close', { projectRoot: PROJECT })).toEqual({ ok: true, value: { closed: true } })
    await settle()
    expect(homeWatchers.filter((watcher) => watcher.open)).toHaveLength(1)
    await bothHear('claudeHome.changed', fire, 2)
    expect(second.heard('claudeHome.changed').at(-1)).toEqual({ projectRoot: PROJECT, sessions: true, transcripts: [] })

    // The last window's close ends the watcher on B.
    expect(await windowCall(second, 'claudeHome.close', { projectRoot: PROJECT })).toEqual({ ok: true, value: { closed: true } })
    await settle()
    expect(homeWatchers.filter((watcher) => watcher.open)).toEqual([])
  })

  it('workflow: one window closes, the other still gets workflow.changed; the last close lets go on B', async () => {
    const fire = () => workflow.change((root) => ({ root, epics: [], tickets: [], removedEpics: [], removedTickets: [], error: null, branchErrors: [] }))
    expect(await windowCall(first, 'workflow.open', { root: PROJECT })).toMatchObject({ ok: true })
    expect(await windowCall(second, 'workflow.open', { root: PROJECT })).toMatchObject({ ok: true })
    await bothHear('workflow.changed', fire, 1)

    expect(await windowCall(first, 'workflow.close', { root: PROJECT })).toEqual({ ok: true, value: { closed: true } })
    await settle()
    await bothHear('workflow.changed', fire, 2)

    expect(await windowCall(second, 'workflow.close', { root: PROJECT })).toEqual({ ok: true, value: { closed: true } })
    await settle()
    expect(workflow.subscribed()).toBe(0)
  })

  it('pipeline: one window closes, the other still gets pipeline.changed; the last close lets go on B', async () => {
    const fire = () => pipeline.change((root) => ({ root, pipeline: [], tickets: [], error: 'changed' }))
    expect(await windowCall(first, 'pipeline.get', { root: PROJECT })).toMatchObject({ ok: true })
    expect(await windowCall(second, 'pipeline.get', { root: PROJECT })).toMatchObject({ ok: true })
    await bothHear('pipeline.changed', fire, 1)

    expect(await windowCall(first, 'pipeline.close', { root: PROJECT })).toEqual({ ok: true, value: { closed: true } })
    await settle()
    await bothHear('pipeline.changed', fire, 2)

    expect(await windowCall(second, 'pipeline.close', { root: PROJECT })).toEqual({ ok: true, value: { closed: true } })
    await settle()
    expect(pipeline.subscribed()).toBe(0)
  })
})
