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
import { mkdtempSync } from 'node:fs'
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
let project = ''

beforeEach(async () => {
  vi.resetModules()
  modules = await mainModules()
  project = mkdtempSync(join(tmpdir(), 'worfy-63-'))
  workflow = standInHub(model)
  pipeline = standInHub((root) => snapshot(root))
  handlers = new Map()
  const projects = () => [{ path: project }]
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
  modules.removeTestTree(project)
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

describe('a Linked machine gets its own spelling of the root back', () => {
  /** The Project folder spelled otherwise than path.resolve does: git's `C:/…` on Windows, a trailing separator elsewhere. */
  const otherSpelling = (): string => (sep === '\\' ? project.replaceAll('\\', '/') : `${project}/`)

  async function callFromLink(channel: string, root: string, sent: { channel: string; payload: unknown }[]): Promise<{ ok: boolean; value?: { root: string } }> {
    const sender = { id: 'link:machine/1', send: (name: string, payload: unknown) => void sent.push({ channel: name, payload }), isDestroyed: () => false, once: () => sender }
    const event = { senderFrame: { url: pathToFileURL(INDEX_HTML).href }, sender }
    return (await handlers.get(IPC_CHANNEL_PREFIX + channel)!(event, { root })) as { ok: boolean; value?: { root: string } }
  }

  it('workflow.open answers, and workflow.changed comes, with the root as the Linked machine sent it', async () => {
    const root = otherSpelling()
    expect(resolve(root)).not.toBe(root)
    const sent: { channel: string; payload: unknown }[] = []
    const answer = await callFromLink('workflow.open', root, sent)
    expect(answer).toMatchObject({ ok: true, value: { root } })
    workflow.change(root, delta)
    expect(sent).toEqual([{ channel: `${IPC_CHANNEL_PREFIX}workflow.changed`, payload: delta(root) }])
  })

  it('pipeline.get answers, and pipeline.changed comes, with the root as the Linked machine sent it', async () => {
    const root = otherSpelling()
    const sent: { channel: string; payload: unknown }[] = []
    const answer = await callFromLink('pipeline.get', root, sent)
    expect(answer).toMatchObject({ ok: true, value: { root } })
    // The hub computes the Project under the real path the check answered.
    const [opened] = pipeline.opened()
    expect(opened).toBeDefined()
    pipeline.change(opened!, (key) => snapshot(key, 'gh is unavailable'))
    expect(sent).toEqual([{ channel: `${IPC_CHANNEL_PREFIX}pipeline.changed`, payload: snapshot(root, 'gh is unavailable') }])
  })
})
