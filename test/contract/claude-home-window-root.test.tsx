// claudeHome.changed from main to the window, end to end (worfy-windows ticket 57). The window's
// bridge calls the real handlers of src/main/ipc/claude-home.ts, and what main sends to the window
// goes to the bridge's listeners, so useClaudeHome sees the root exactly as main sent it. On
// Windows the window has git's `C:/…` from the Project list; main used to send path.resolve's
// `C:\…`, and the window dropped every change. The registry is a stand-in whose watcher the test
// fires by hand: no files and no real watcher.
//
// Main's modules are imported by a path the type checker does not follow: this file belongs to
// tsconfig.test.web.json, which cannot list main's files (they need Node's types, the project has
// the DOM's). MainModules below is the part of their interface the test uses.
/// <reference types="node" />
import { pathToFileURL } from 'node:url'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type WorfyBridge } from '../../src/shared/ipc/channels'

/** The root as the window has it: git's spelling on Windows. */
const ROOT = 'C:/p'
/** The renderer location that passes the frame check, as test/app-url.ts builds it. */
const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'

type Change = { sessions: boolean; transcripts: string[] }
type Listener = (event: unknown, ...args: unknown[]) => unknown
interface Sender {
  readonly id: number
  send(channel: string, payload: unknown): void
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
}
interface MainModules {
  ClaudeHomeSubscriptions: new (registry: unknown, listeners: ReadonlySet<unknown>) => { closeAll(): Promise<void> }
  claudeHomeHandlers: (registry: unknown, subscriptions: unknown) => unknown
  registerIpc: (ipc: { handle(channel: string, listener: Listener): void }, options: { modules: Record<string, () => Promise<unknown>>; isTrustedSender: unknown }) => Promise<void>
  appUrlMatcher: (options: { indexHtml: string }) => unknown
}

async function mainModules(): Promise<MainModules> {
  const claudeHome: string = '../../src/main/ipc/claude-home'
  const ipcIndex: string = '../../src/main/ipc/index'
  const [home, ipc] = (await Promise.all([import(/* @vite-ignore */ claudeHome), import(/* @vite-ignore */ ipcIndex)])) as [MainModules, MainModules]
  return { ClaudeHomeSubscriptions: home.ClaudeHomeSubscriptions, claudeHomeHandlers: home.claudeHomeHandlers, registerIpc: ipc.registerIpc, appUrlMatcher: ipc.appUrlMatcher }
}

const watchers: ((change: Change) => void)[] = []
const asked: string[] = []
let closeAll: () => Promise<void> = async () => undefined

beforeEach(async () => {
  vi.resetModules()
  watchers.length = 0
  asked.length = 0
  const { ClaudeHomeSubscriptions, claudeHomeHandlers, registerIpc, appUrlMatcher } = await mainModules()
  const registry = {
    watch: async (_root: unknown, onChange: (change: Change) => void) => {
      watchers.push(onChange)
      return { ready: Promise.resolve(), close: async () => undefined }
    },
    sessions: async () => ({ live: [], history: [] }),
    live: async () => [],
  }
  const subscriptions = new ClaudeHomeSubscriptions(registry, new Set())
  closeAll = () => subscriptions.closeAll()
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    { modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
  )

  // The window: what main sends goes to the bridge's listeners, as the preload passes it on.
  const listeners = new Map<string, ((payload: unknown) => void)[]>()
  const sender: Sender = {
    id: 1,
    send: (channel, payload) => {
      for (const listener of listeners.get(channel.slice(IPC_CHANNEL_PREFIX.length)) ?? []) listener(payload)
    },
    isDestroyed: () => false,
    once: () => undefined,
  }
  const event = { senderFrame: { url: pathToFileURL(INDEX_HTML).href }, sender }
  const bridge = {
    invoke: async (channel: string, input: unknown) => {
      asked.push(channel)
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

afterEach(async () => {
  await closeAll()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('claudeHome.changed reaches the window that asked with C:/p', () => {
  it('a change in the registry makes useClaudeHome read the live Sessions again', async () => {
    const { useClaudeHome } = await import('../../src/renderer/claude-home/useClaudeHome')
    renderHook(() => useClaudeHome(ROOT))
    await vi.waitFor(() => expect(watchers).toHaveLength(1))
    await vi.waitFor(() => expect(asked).toEqual(['claudeHome.sessions']))

    await act(async () => {
      for (const watcher of watchers) watcher({ sessions: true, transcripts: [] })
    })
    await vi.waitFor(() => expect(asked).toEqual(['claudeHome.sessions', 'claudeHome.live']))
  })
})
