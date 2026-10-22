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
import { posix } from 'node:path'
import { IPC_CHANNEL_PREFIX, type InvokeInput, type InvokeName, type IpcResult } from '../../shared/ipc/channels'
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
  isDestroyed?(): boolean
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
 * How a subscription's root is told apart on the Linked machine. `as-sent`: by the string the
 * window sent (claudeHome, src/main/ipc/claude-home.ts keys by client and root as sent; docs, whose
 * root is a Project id, not a path: src/main/docs/watch.ts keys by Project id and client). `resolved`:
 * by the folder it names (workflow and pipeline: their hubs key by client and path.resolve of the
 * real path, src/main/workflow/watch.ts, stages.ts), so `P` and `P/`, or `C:/p` and `C:\p`, are one
 * subscription there.
 */
type Spelling = 'as-sent' | 'resolved'

/** A subscribing call: the call that ends it, the input field naming the root in both, and how roots compare. */
type SubscribingRules = {
  [Open in InvokeName]?: { [Close in InvokeName]: { close: Close; key: keyof InvokeInput<Open> & keyof InvokeInput<Close> & string; spelling: Spelling } }[InvokeName]
}

/**
 * The calls that subscribe a window to the changes of a Project on a Linked machine. The Linked
 * machine serves every window of this Machine with one client (LinkPeer,
 * src/main/link/ipc-adapter.ts) and keys these subscriptions by client and root, so it cannot tell
 * two windows apart: the close of one window would end the subscription of every window
 * (worfy-windows tickets 64 and 69). So the windows are counted here, and a close goes to the Linked machine
 * only when the last window lets go.
 */
const SUBSCRIBING = {
  'claudeHome.sessions': { close: 'claudeHome.close', key: 'projectRoot', spelling: 'as-sent' },
  'workflow.open': { close: 'workflow.close', key: 'root', spelling: 'resolved' },
  'pipeline.get': { close: 'pipeline.close', key: 'root', spelling: 'resolved' },
  'docs.open': { close: 'docs.close', key: 'projectId', spelling: 'as-sent' },
} as const satisfies SubscribingRules

interface Rule {
  close: string
  key: string
  spelling: Spelling
}
const RULE_OF_OPEN: ReadonlyMap<string, Rule> = new Map(Object.entries(SUBSCRIBING))
const RULE_OF_CLOSE: ReadonlyMap<string, Rule> = new Map(Object.values(SUBSCRIBING).map((rule) => [rule.close, rule]))

/**
 * The root of a `resolved` subscription as one key, whatever system the Linked machine runs: `\`
 * read as `/`, `.`, `..`, doubled and trailing separators gone, and the case folded. It merges more
 * spellings than the Linked machine may: two of its roots that differ in case only, or in `\` in a
 * POSIX file name, count as one here. That errs the safe way: their close waits until every window
 * let go of both, and then goes for each spelling sent (closeOnMachine). Merging fewer would lose the
 * changes of a window. Links between folders are not seen from here.
 */
function resolvedKey(root: string): string {
  const normal = posix.normalize(root.replaceAll('\\', '/'))
  return (normal.length > 1 ? normal.replace(/\/+$/, '') : normal).toLowerCase()
}

interface Subscription {
  machine: string
  rule: Rule
  /** Every spelling of the root the windows sent; the Linked machine remembers each (OpenedRoots). */
  spellings: Set<string>
  /** The ids of the windows subscribed. */
  windows: Set<number | string>
}

/** The subscriptions of this Machine's windows on Linked machines, by Machine, close channel and root. */
const subscriptions = new Map<string, Subscription>()

/** The subscription a call names when it opens or closes one, by its rule and the root it sent. */
function subscriptionOf(machine: string, rule: Rule, input: unknown): { id: string; root: string } | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const root = (input as Record<string, unknown>)[rule.key]
  if (typeof root !== 'string') return undefined
  const key = rule.spelling === 'resolved' ? resolvedKey(root) : root
  return { id: `${machine}\0${rule.close}\0${key}`, root }
}

/** Ends a subscription on its Linked machine under each spelling but `sent`, which the window's own close carries. */
function closeOnMachine(subscription: Subscription, sent?: string): void {
  for (const root of subscription.spellings) {
    if (root === sent) continue
    void follow()
      ?.call(subscription.machine, subscription.rule.close, { [subscription.rule.key]: root })
      .then((result) => {
        if (!result.ok) console.warn(`[linked] Machine ${subscription.machine} did not end a subscription (${subscription.rule.close}): ${result.error}`)
      })
  }
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
 * What countWindow decided: `answer` when the call must not go to the Linked machine; `after`,
 * what to do once the Linked machine answered it.
 */
interface Counted {
  answer?: IpcResult<unknown>
  after?: () => void
}

/**
 * Counts the window in or out of the subscription that `channel` opens or closes. A close is
 * answered here while other windows still hold the subscription: `closed: true` for a window
 * counted in, `closed: false` for one that was not (it let go already, say on a navigation that was
 * then cancelled). The last close goes on, and after it the closes of the other spellings sent.
 */
function countWindow(screen: Screen | undefined, machine: string, channel: string, input: unknown): Counted {
  if (typeof screen?.once !== 'function') return {}
  const opens = RULE_OF_OPEN.get(channel)
  const rule = opens ?? RULE_OF_CLOSE.get(channel)
  const named = rule === undefined ? undefined : subscriptionOf(machine, rule, input)
  if (rule === undefined || named === undefined) return {}
  const known = subscriptions.get(named.id)
  if (opens !== undefined) {
    // A window destroyed before its call got here never emits 'destroyed' again: it would never
    // leave the count, and the subscription would outlive every window.
    if (screen.isDestroyed?.() === true) return { answer: { ok: false, error: `${channel}: the window is gone` } }
    // Counted before the call goes: a close of another window meanwhile keeps the subscription.
    if (known === undefined) subscriptions.set(named.id, { machine, rule, spellings: new Set([named.root]), windows: new Set([screen.id]) })
    else {
      known.spellings.add(named.root)
      known.windows.add(screen.id)
    }
    watch(screen)
    return {}
  }
  if (known === undefined) return {}
  if (!known.windows.delete(screen.id)) return { answer: { ok: true, value: { closed: false } } }
  if (known.windows.size > 0) return { answer: { ok: true, value: { closed: true } } }
  subscriptions.delete(named.id)
  // After the window's own close, so that one answers for the subscription it ends. A window that
  // subscribed again meanwhile holds it anew on the Linked machine: its other spellings stay.
  return {
    after: () => {
      if (!subscriptions.has(named.id)) closeOnMachine(known, named.root)
    },
  }
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
    const counted = countWindow(event.sender as unknown as Screen | undefined, machine, channel, input)
    if (counted.answer !== undefined) return counted.answer
    const result = await calls.call(machine, channel, input)
    counted.after?.()
    return result
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
