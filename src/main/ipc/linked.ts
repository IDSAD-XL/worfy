// The `linked` domain's handlers (worfy-link ticket 09): a window of this Machine calls a channel of
// a Linked machine, hears its events, learns whether it shares its Projects, and tells it which of
// its Projects the window shows. The calls themselves go through src/main/link/remote-calls.ts.
//
// `linked.event` and `linked.changed` go to this Machine's windows only (like `link.changed`,
// src/main/ipc/link.ts): they are `local`, and a client without a window — the connection of a
// Linked machine — has no use for them.
//
// This module is also loaded by the IPC adapter of every link service (ipc-adapter.ts), in tests
// without Electron: it imports Electron only when it sends to the windows.
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../shared/ipc/channels'
import { linkedChanged, linkedEvent, linkedInvoke, linkedOpen, linkedState, type LinkedState } from '../../shared/ipc/linked'
import type { Client } from '../clients'
import { appRemoteCalls, type RemoteCalls } from '../link/remote-calls'
import { appLinkProblem, onAppLinkStart } from '../link/service'
import { defineHandler, emit, type HandlerModule } from './index'

let revision = 0
let followed: RemoteCalls | undefined
let broadcastQueued = false

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The app's RemoteCalls, followed from the first use on: its events go to the windows. */
function follow(): RemoteCalls | undefined {
  const calls = appRemoteCalls()
  if (calls === undefined || calls === followed) return calls
  followed = calls
  calls.on('event', (event) => void toWindows((target) => emit(target, linkedEvent, event)))
  calls.on('changed', changed)
  return calls
}

// Made as soon as the link starts, so a Linked machine's `projects-access` finds its receiver.
onAppLinkStart(() => {
  follow()
  changed()
})

function requireCalls(): RemoteCalls {
  const calls = follow()
  if (calls === undefined) throw new Error(appLinkProblem() ?? 'the link service has not started yet')
  return calls
}

function buildState(): LinkedState {
  return { revision, machines: follow()?.machines() ?? [] }
}

/** Something changed: one broadcast per turn of the event loop, however many changes came. */
function changed(): void {
  revision += 1
  if (broadcastQueued) return
  broadcastQueued = true
  setImmediate(() => {
    broadcastQueued = false
    const state = buildState()
    void toWindows((target) => emit(target, linkedChanged, state))
  })
}

async function toWindows(send: (target: Client) => void): Promise<void> {
  try {
    const { BrowserWindow } = await import('electron')
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      send(window.webContents)
    }
  } catch (error) {
    console.error(`[linked] could not send to the windows: ${messageOf(error)}`)
  }
}

/** What a window that shows a Project of a Linked machine needs from Electron's webContents. */
interface Screen {
  id: number | string
  once(event: 'destroyed', listener: () => void): unknown
  on?(event: 'did-start-navigation', listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void): unknown
}

/** The Linked machine each window holds a Project on, by window id. */
const holding = new Map<number | string, string>()

/** Lets go of what window `screen` held: it closed, or loads another page (another Machine, a reload). */
function release(screen: Screen): void {
  const machine = holding.get(screen.id)
  if (machine === undefined) return
  holding.delete(screen.id)
  void follow()
    ?.call(machine, 'projects.hold', { screen: String(screen.id), projectId: null })
    .then((result) => {
      if (!result.ok) console.warn(`[linked] Machine ${machine} did not let go of the Project of window ${String(screen.id)}: ${result.error}`)
    })
}

/**
 * The calls that subscribe a window to the changes of a Project on a Linked machine, with the call
 * that ends the subscription and the input field that names what it is for. The Linked machine
 * serves every window of this Machine with one client (LinkPeer, src/main/link/ipc-adapter.ts) and
 * keys these subscriptions by client and that field, so it cannot tell two windows apart: the close
 * of one window would end the subscription of every window (worfy-windows ticket 64). So the windows
 * are counted here, and a close goes to the Linked machine only when the last window lets go.
 */
const SUBSCRIBING: Readonly<Record<string, { close: string; key: string }>> = {
  'claudeHome.sessions': { close: 'claudeHome.close', key: 'projectRoot' },
  'workflow.open': { close: 'workflow.close', key: 'root' },
  'pipeline.get': { close: 'pipeline.close', key: 'root' },
}
const KEY_OF_CLOSE = new Map(Object.values(SUBSCRIBING).map(({ close, key }) => [close, key]))

interface Subscription {
  machine: string
  close: string
  /** The input of the close, as a window sends it. */
  input: Record<string, string>
  /** The ids of the windows subscribed. */
  windows: Set<number | string>
}

/** The subscriptions of this Machine's windows on Linked machines, by Machine, close channel and key. */
const subscriptions = new Map<string, Subscription>()

/** The subscription a call of `channel` with `input` names, when it opens or closes one. */
function subscriptionOf(machine: string, channel: string, input: unknown): { id: string; close: string; input: Record<string, string> } | undefined {
  const close = SUBSCRIBING[channel]?.close ?? (KEY_OF_CLOSE.has(channel) ? channel : undefined)
  const key = close === undefined ? undefined : KEY_OF_CLOSE.get(close)
  if (close === undefined || key === undefined || typeof input !== 'object' || input === null) return undefined
  const value = (input as Record<string, unknown>)[key]
  if (typeof value !== 'string') return undefined
  return { id: `${machine}\0${close}\0${value}`, close, input: { [key]: value } }
}

/** Ends a subscription on its Linked machine: the last window let go of it. */
function closeOnMachine(subscription: Subscription): void {
  void follow()
    ?.call(subscription.machine, subscription.close, subscription.input)
    .then((result) => {
      if (!result.ok) console.warn(`[linked] Machine ${subscription.machine} did not end a subscription (${subscription.close}): ${result.error}`)
    })
}

/** Window `screen` closed or loads another page: it lets go of its subscriptions. */
function unsubscribe(screen: Screen): void {
  for (const [id, subscription] of subscriptions) {
    if (!subscription.windows.delete(screen.id) || subscription.windows.size > 0) continue
    subscriptions.delete(id)
    closeOnMachine(subscription)
  }
}

/**
 * Counts the window in or out of the subscription that `channel` opens or closes. A close of a
 * subscription other windows still hold is answered here, `closed: true` for the window that sent it,
 * and never reaches the Linked machine.
 */
function countWindow(screen: Screen | undefined, machine: string, channel: string, input: unknown): IpcResult<unknown> | undefined {
  if (typeof screen?.once !== 'function') return undefined
  const named = subscriptionOf(machine, channel, input)
  if (named === undefined) return undefined
  const known = subscriptions.get(named.id)
  if (SUBSCRIBING[channel] !== undefined) {
    // Counted before the call goes: a close of another window meanwhile keeps the subscription.
    if (known === undefined) subscriptions.set(named.id, { machine, close: named.close, input: named.input, windows: new Set([screen.id]) })
    else known.windows.add(screen.id)
    watch(screen)
    return undefined
  }
  if (known === undefined || !known.windows.delete(screen.id)) return undefined
  if (known.windows.size > 0) return { ok: true, value: { closed: true } }
  subscriptions.delete(named.id)
  return undefined
}

const watched = new WeakSet<object>()

function watch(screen: Screen): void {
  if (watched.has(screen)) return
  watched.add(screen)
  screen.once('destroyed', () => {
    release(screen)
    unsubscribe(screen)
  })
  screen.on?.('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    release(screen)
    unsubscribe(screen)
  })
}

export default [
  defineHandler(linkedInvoke, async ({ machine, channel, input }, { event }) => {
    const calls = follow()
    if (calls === undefined) return { ok: false as const, error: `${channel}: ${appLinkProblem() ?? 'the link service has not started yet'}` }
    // A name with the prefix would read as another channel on the other side.
    if (channel.startsWith(IPC_CHANNEL_PREFIX)) return { ok: false as const, error: `${channel}: not a channel name` }
    const answered = countWindow(event.sender as unknown as Screen | undefined, machine, channel, input)
    if (answered !== undefined) return answered
    return calls.call(machine, channel, input)
  }),

  defineHandler(linkedState, () => buildState()),

  defineHandler(linkedOpen, async ({ machine, projectId }, { event }) => {
    const calls = requireCalls()
    const screen = event.sender as unknown as Screen | undefined
    if (screen === undefined) throw new Error('the call came from no window')
    const before = holding.get(screen.id)
    if (before !== undefined && before !== machine) release(screen)
    watch(screen)
    if (projectId !== null) holding.set(screen.id, machine)
    else holding.delete(screen.id)
    const result = await calls.call(machine, 'projects.hold', { screen: String(screen.id), projectId })
    if (!result.ok) throw new Error(result.error)
    return { projectId }
  }),
] satisfies HandlerModule
