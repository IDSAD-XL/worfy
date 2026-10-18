// workflow.changed and pipeline.changed from main to the window, end to end (worfy-windows ticket
// 63). The window's bridge calls the real handlers of src/main/ipc/workflow.ts and
// src/main/ipc/pipeline.ts, and what main sends to the window goes to the bridge's listeners, so
// useWorkflow and usePipeline see the root exactly as main sent it. On Windows the window has git's
// `C:/…` from the Project list; the hubs key a Project by path.resolve, `C:\…`, and their models,
// deltas and snapshots carry that root: the window dropped every change. The hubs are stand-ins that
// carry path.resolve's root as the real ones do (src/main/workflow/watch.ts, stages.ts), and the
// test sends their changes by hand: no files, no watcher, no git.
//
// A Linked machine's client goes through the same handlers and gets its own spelling back too.
//
// Main's modules are imported by a path the type checker does not follow: this file belongs to
// tsconfig.test.web.json, which cannot list main's files (they need Node's types, the project has
// the DOM's). MainModules below is the part of their interface the test uses.
/// <reference types="node" />
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type WorfyBridge } from '../../src/shared/ipc/channels'
import type { PipelineSnapshot } from '../../src/shared/ipc/pipeline'
import type { WorkflowDelta, WorkflowModel } from '../../src/shared/workflow/types'

/** The root as the window has it: git's spelling on Windows; path.resolve spells it otherwise on every system. */
const ROOT = 'C:/p'
/** The renderer location that passes the frame check, as test/app-url.ts builds it. */
const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

type Listener = (event: unknown, ...args: unknown[]) => unknown
interface Subscriber {
  readonly id: number | string
  send(payload: unknown): void
}
interface Hub {
  open(root: string, subscriber: Subscriber): Promise<unknown>
  close(root: string, id: number | string): Promise<boolean>
  drop(id: number | string): Promise<void>
}
interface MainModules {
  workflowHandlers: (options: { hub: Hub; projects: () => readonly { path: string }[] }) => unknown
  pipelineHandlers: (options: { hub: Hub; projects: () => readonly { path: string }[] }) => unknown
  registerIpc: (ipc: { handle(channel: string, listener: Listener): void }, options: { modules: Record<string, () => Promise<unknown>>; isTrustedSender: unknown }) => Promise<void>
  appUrlMatcher: (options: { indexHtml: string }) => unknown
  removeTestTree: (path: string) => void
}

async function mainModules(): Promise<MainModules> {
  const workflow: string = '../../src/main/ipc/workflow'
  const pipeline: string = '../../src/main/ipc/pipeline'
  const ipcIndex: string = '../../src/main/ipc/index'
  const remove: string = '../remove'
  const [w, p, ipc, r] = (await Promise.all([workflow, pipeline, ipcIndex, remove].map((path) => import(/* @vite-ignore */ path)))) as MainModules[]
  return { workflowHandlers: w!.workflowHandlers, pipelineHandlers: p!.pipelineHandlers, registerIpc: ipc!.registerIpc, appUrlMatcher: ipc!.appUrlMatcher, removeTestTree: r!.removeTestTree }
}

const model = (root: string): WorkflowModel => ({ root, epics: [], tickets: [], error: null, branchErrors: [] })
const delta = (root: string): WorkflowDelta => ({ root, epics: [], tickets: [], removedEpics: [], removedTickets: [], error: null, branchErrors: [{ branch: 'demo/01', message: 'changed' }] })
const snapshot = (root: string, error: string | null = null): PipelineSnapshot => ({ root, pipeline: [], tickets: [], error })

/** A hub that keys a Project by path.resolve and answers and sends with that root, as the real hubs do. */
function standInHub(first: (root: string) => unknown) {
  const subscribers = new Map<string, Map<number | string, Subscriber>>()
  const hub: Hub = {
    open: async (asked, subscriber) => {
      const key = resolve(asked)
      subscribers.set(key, (subscribers.get(key) ?? new Map()).set(subscriber.id, subscriber))
      return first(key)
    },
    close: async (asked, id) => subscribers.get(resolve(asked))?.delete(id) ?? false,
    drop: async (id) => {
      for (const each of subscribers.values()) each.delete(id)
    },
  }
  /** Sends every subscriber of the Project what `change` makes of its resolved root. */
  const change = (asked: string, make: (root: string) => unknown): void => {
    const key = resolve(asked)
    for (const subscriber of subscribers.get(key)?.values() ?? []) subscriber.send(make(key))
  }
  return { hub, change, opened: () => [...subscribers.entries()].filter(([, each]) => each.size > 0).map(([key]) => key) }
}

let workflow = standInHub(model)
let pipeline = standInHub((root) => snapshot(root))
let handlers = new Map<string, Listener>()
let modules: MainModules
/** The temporary folder: the Project folder `p` and a link `l` to it, the Project's path in the list. */
let base = ''
let project = ''
let link = ''

beforeEach(async () => {
  vi.resetModules()
  modules = await mainModules()
  base = mkdtempSync(join(tmpdir(), 'worfy-63-'))
  project = join(base, 'p')
  mkdirSync(project)
  link = join(base, 'l')
  // A junction on Windows needs no rights; elsewhere the type is ignored and it is a symbolic link.
  symlinkSync(project, link, 'junction')
  workflow = standInHub(model)
  pipeline = standInHub((root) => snapshot(root))
  handlers = new Map()
  const projects = () => [{ path: link }]
  await modules.registerIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    {
      modules: {
        './workflow.ts': async () => modules.workflowHandlers({ hub: workflow.hub, projects }),
        './pipeline.ts': async () => modules.pipelineHandlers({ hub: pipeline.hub, projects }),
      },
      isTrustedSender: modules.appUrlMatcher({ indexHtml: INDEX_HTML }),
    },
  )

  // The window: what main sends goes to the bridge's listeners, as the preload passes it on.
  const listeners = new Map<string, ((payload: unknown) => void)[]>()
  const sender = {
    id: 1,
    send: (channel: string, payload: unknown) => {
      for (const listener of listeners.get(channel.slice(IPC_CHANNEL_PREFIX.length)) ?? []) listener(payload)
    },
    isDestroyed: () => false,
    once: () => undefined,
  }
  const event = { senderFrame: { url: pathToFileURL(INDEX_HTML).href }, sender }
  const bridge = {
    invoke: async (channel: string, input: unknown) => {
      const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
      if (!listener) throw new Error(`no handler for ${channel}`)
      return listener(event, input)
    },
    on: (channel: string, listener: (payload: unknown) => void) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
      return listeners.size
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  modules.removeTestTree(base)
})

describe('the window that asked with C:/p gets the changes', () => {
  it('workflow.changed reaches useWorkflow', async () => {
    const { useWorkflow } = await import('../../src/renderer/workflow/useWorkflow')
    const { result } = renderHook(() => useWorkflow(ROOT))
    await vi.waitFor(() => expect(result.current.model).toBeDefined())
    expect(workflow.opened()).toEqual([resolve(ROOT)])

    await act(async () => workflow.change(ROOT, delta))
    await vi.waitFor(() => expect(result.current.model?.branchErrors).toEqual([{ branch: 'demo/01', message: 'changed' }]))
    // The model the window keeps names the root as the window does, from the answer on.
    expect(result.current.model?.root).toBe(ROOT)
  })

  it('pipeline.changed reaches usePipeline', async () => {
    const { usePipeline } = await import('../../src/renderer/pipeline/usePipeline')
    const { result } = renderHook(() => usePipeline(ROOT))
    await vi.waitFor(() => expect(result.current.snapshot).toBeDefined())
    expect(pipeline.opened()).toEqual([resolve(ROOT)])
    // The board is keyed by the snapshot's root (PipelineBoard.tsx): one spelling from the answer on.
    const answered = result.current.snapshot?.root

    await act(async () => pipeline.change(ROOT, (root) => snapshot(root, 'gh is unavailable')))
    await vi.waitFor(() => expect(result.current.snapshot?.error).toBe('gh is unavailable'))
    expect(answered).toBe(ROOT)
    expect(result.current.snapshot?.root).toBe(ROOT)
  })
})

/** A client of a link connection: a string id makes its calls remote (src/main/link/caller.ts). */
function linkClient(id: string) {
  const sent: { channel: string; payload: unknown }[] = []
  let destroyed = false
  const sender = {
    id,
    send: (channel: string, payload: unknown) => {
      // As Electron's webContents does once it is gone.
      if (destroyed) throw new Error('Object has been destroyed')
      sent.push({ channel, payload })
    },
    isDestroyed: () => destroyed,
    once: () => sender,
  }
  const event = { senderFrame: { url: pathToFileURL(INDEX_HTML).href }, sender }
  return {
    sent,
    destroy: () => void (destroyed = true),
    call: async (channel: string, root: string) => (await handlers.get(IPC_CHANNEL_PREFIX + channel)!(event, { root })) as { ok: boolean; value?: { root: string } },
  }
}

describe('a Linked machine: the hub opens the real path, the answer and the changes keep its spelling', () => {
  /**
   * The Project's path in the list, through its link and spelled otherwise than path.resolve does:
   * git's `C:/…` on Windows, a trailing separator elsewhere. Its real path is the folder behind the link.
   */
  const linkSpelling = (): string => (sep === '\\' ? link.replaceAll('\\', '/') : `${link}/`)

  it('workflow.open: the watch is opened under the real path the check answered, the answer and workflow.changed carry the root as sent', async () => {
    const root = linkSpelling()
    const real = realpathSync.native(project)
    expect(resolve(root)).not.toBe(root)
    expect(resolve(root)).not.toBe(real)
    const client = linkClient('link:machine/1')
    expect(await client.call('workflow.open', root)).toMatchObject({ ok: true, value: { root } })
    expect(workflow.opened()).toEqual([real])
    workflow.change(real, delta)
    expect(client.sent).toEqual([{ channel: `${IPC_CHANNEL_PREFIX}workflow.changed`, payload: delta(root) }])
    expect(await client.call('workflow.close', root)).toEqual({ ok: true, value: { closed: true } })
    expect(workflow.opened()).toEqual([])
  })

  it('pipeline.get: the Stages are computed under the real path the check answered, the answer and pipeline.changed carry the root as sent', async () => {
    const root = linkSpelling()
    const real = realpathSync.native(project)
    const client = linkClient('link:machine/1')
    expect(await client.call('pipeline.get', root)).toMatchObject({ ok: true, value: { root } })
    expect(pipeline.opened()).toEqual([real])
    pipeline.change(real, (key) => snapshot(key, 'gh is unavailable'))
    expect(client.sent).toEqual([{ channel: `${IPC_CHANNEL_PREFIX}pipeline.changed`, payload: snapshot(root, 'gh is unavailable') }])
    expect(await client.call('pipeline.close', root)).toEqual({ ok: true, value: { closed: true } })
    expect(pipeline.opened()).toEqual([])
  })
})

describe('a client gone before a change is skipped; the others still get it', () => {
  it('workflow.changed', async () => {
    const [gone, kept] = [linkClient('link:machine/1'), linkClient('link:machine/2')]
    expect(await gone.call('workflow.open', link)).toMatchObject({ ok: true })
    expect(await kept.call('workflow.open', link)).toMatchObject({ ok: true })
    gone.destroy()
    expect(() => workflow.change(realpathSync.native(project), delta)).not.toThrow()
    expect(gone.sent).toEqual([])
    expect(kept.sent).toEqual([{ channel: `${IPC_CHANNEL_PREFIX}workflow.changed`, payload: delta(link) }])
  })

  it('pipeline.changed', async () => {
    const [gone, kept] = [linkClient('link:machine/1'), linkClient('link:machine/2')]
    expect(await gone.call('pipeline.get', link)).toMatchObject({ ok: true })
    expect(await kept.call('pipeline.get', link)).toMatchObject({ ok: true })
    gone.destroy()
    expect(() => pipeline.change(realpathSync.native(project), (key) => snapshot(key, 'gh is unavailable'))).not.toThrow()
    expect(gone.sent).toEqual([])
    expect(kept.sent).toEqual([{ channel: `${IPC_CHANNEL_PREFIX}pipeline.changed`, payload: snapshot(link, 'gh is unavailable') }])
  })
})
