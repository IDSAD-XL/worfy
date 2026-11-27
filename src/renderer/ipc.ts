// Typed access to the main process for React code. The preload exposes an untyped bridge
// (window.worfy); the channel types come from IpcContract (src/shared/ipc/channels.ts).
//
// The Machine of a window (worfy-link ticket 09; ADR-0053). A window shows the Projects of one
// Machine: its own by default, or Linked machine M when its address says `?machine=<id of M>`
// (openProject in src/renderer/projects/useProjects.ts sets it and loads the window again). In a
// window on M each channel goes where its access mark says (src/shared/ipc/channels.ts), with no
// second list: `project` and `desktop` channels to M — through this Machine's main as
// `linked.invoke`, their events back as `linked.event` — and `local` and `link` ones to this
// Machine's main, as in any window. invokeOn and subscribeOn name the Machine explicitly, for what
// is not tied to the window's Machine (the sidebar lists the Projects of every Machine).
import {
  accessOf,
  type EventName,
  type EventPayload,
  type InvokeInput,
  type InvokeName,
  type InvokeOutput,
  type IpcResult,
  type WorfyBridge,
} from '../shared/ipc/channels'
import { showToast } from './toast/toasts'

// Every domain file declares its channels with their marks when it loads; loaded here, the marks
// are known before the first call, whichever modules of the renderer happen to import which file.
import.meta.glob('../shared/ipc/*.ts', { eager: true })

/** A channel whose input accepts `undefined` may be invoked without one. */
type InputArgs<K extends InvokeName> = undefined extends InvokeInput<K> ? [input?: InvokeInput<K>] : [input: InvokeInput<K>]

export interface IpcClient {
  /** Resolves to {ok:false} instead of rejecting, including when the bridge itself fails. */
  invoke<K extends InvokeName>(channel: K, ...args: InputArgs<K>): Promise<IpcResult<InvokeOutput<K>>>
  /** Returns the function that unsubscribes. */
  subscribe<K extends EventName>(channel: K, handler: (payload: EventPayload<K>) => void): () => void
}

/** Builds a client over a bridge; the bridge is looked up on each call, so tests can pass a fake. */
export function createIpcClient(bridge: () => WorfyBridge): IpcClient {
  return {
    async invoke(channel, ...args) {
      try {
        return (await bridge().invoke(channel, args[0])) as IpcResult<never>
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    subscribe(channel, handler) {
      const target = bridge()
      const id = target.on(channel, (payload) => handler(payload as never))
      return () => target.off(id)
    },
  }
}

/** Where a channel goes from a window on a Linked machine: to that Machine, or to this one. */
export type Route = 'window-machine' | 'this-machine'

/** The route of a channel, from its access mark; a name nobody declared stays on this Machine. */
export function routeOf(channel: string): Route {
  const access = accessOf(channel)
  return access === 'project' || access === 'desktop' ? 'window-machine' : 'this-machine'
}

/** `linked.event` as it arrives: one event of a Linked machine. */
interface LinkedEventPayload {
  machine: string
  channel: string
  payload: unknown
}

/**
 * The listeners of Linked machines' events over one preload bridge: one `linked.event`
 * subscription for all of them, dispatched by Machine and channel.
 */
class LinkedEvents {
  private readonly listeners = new Map<number, { machine: string; channel: string; handler: (payload: unknown) => void }>()
  private subscription: number | undefined
  private next = 1

  constructor(private readonly preload: WorfyBridge) {}

  on(machine: string, channel: string, handler: (payload: unknown) => void): number {
    if (this.subscription === undefined) {
      this.subscription = this.preload.on('linked.event', (payload) => this.dispatch(payload as LinkedEventPayload))
    }
    const id = this.next++
    this.listeners.set(id, { machine, channel, handler })
    return id
  }

  off(id: number): void {
    this.listeners.delete(id)
    if (this.listeners.size > 0 || this.subscription === undefined) return
    this.preload.off(this.subscription)
    this.subscription = undefined
  }

  private dispatch(event: LinkedEventPayload): void {
    for (const listener of [...this.listeners.values()]) {
      if (listener.machine !== event.machine || listener.channel !== event.channel) continue
      try {
        listener.handler(event.payload)
      } catch (error) {
        console.error(`${event.channel}: a listener of Machine ${event.machine} failed`, error)
      }
    }
  }
}

const linkedEvents = new WeakMap<WorfyBridge, LinkedEvents>()

function eventsOver(preload: WorfyBridge): LinkedEvents {
  let events = linkedEvents.get(preload)
  if (events === undefined) {
    events = new LinkedEvents(preload)
    linkedEvents.set(preload, events)
  }
  return events
}

/** A bridge whose every channel goes to Linked machine `machine`, through this Machine's main. */
export function machineBridge(preload: WorfyBridge, machine: string): WorfyBridge {
  const events = eventsOver(preload)
  return {
    async invoke(channel, input) {
      const result = await preload.invoke('linked.invoke', { machine, channel, input })
      // The outer result is this Machine's main; the inner one, the Linked machine's answer.
      return result.ok ? (result.value as IpcResult<unknown>) : result
    },
    on: (channel, handler) => events.on(machine, channel, handler),
    off: (id) => events.off(id),
  }
}

/**
 * The bridge of a window on Linked machine `machine`: each channel by its route (routeOf). Null
 * `machine` — a window on this Machine — is the preload bridge as it is.
 */
export function routedBridge(preload: WorfyBridge, machine: string | null): WorfyBridge {
  if (machine === null) return preload
  const remote = machineBridge(preload, machine)
  // Subscription ids of both bridges, told apart by sign: the remote ones are made negative.
  return {
    invoke: (channel, input) => (routeOf(channel) === 'window-machine' ? remote.invoke(channel, input) : preload.invoke(channel, input)),
    on: (channel, handler) => (routeOf(channel) === 'window-machine' ? -remote.on(channel, handler) : preload.on(channel, handler)),
    off: (id) => (id < 0 ? remote.off(-id) : preload.off(id)),
  }
}

/** The parameter of the window's address that names its Machine. */
export const MACHINE_PARAM = 'machine'

/** The Linked machine this window shows; null — this Machine. Read from the window's address. */
export function windowMachine(): string | null {
  const search = (globalThis as { location?: { search?: string } }).location?.search ?? ''
  const machine = new URLSearchParams(search).get(MACHINE_PARAM)
  return machine === null || machine === '' ? null : machine
}

/** The one lookup of the global object the preload exposes; undefined without the preload. */
function lookUpPreloadBridge(): WorfyBridge | undefined {
  return (globalThis as { worfy?: WorfyBridge }).worfy
}

/**
 * Whether the preload bridge is in place. It is not in a unit test of a component that sets none;
 * the modules that then do nothing (no subscription, no call to main) ask this instead of the global.
 */
export function hasPreloadBridge(): boolean {
  return lookUpPreloadBridge() !== undefined
}

function preloadBridge(): WorfyBridge {
  const bridge = lookUpPreloadBridge()
  if (!bridge) throw new Error('window.worfy is missing: the preload did not run')
  return bridge
}

const routed = new WeakMap<WorfyBridge, Map<string, WorfyBridge>>()

/** The bridge of this window: the preload's, routed when the window shows a Linked machine. */
function windowBridge(): WorfyBridge {
  const preload = preloadBridge()
  const machine = windowMachine()
  if (machine === null) return preload
  let byMachine = routed.get(preload)
  if (byMachine === undefined) {
    byMachine = new Map()
    routed.set(preload, byMachine)
  }
  let bridge = byMachine.get(machine)
  if (bridge === undefined) {
    bridge = routedBridge(preload, machine)
    byMachine.set(machine, bridge)
  }
  return bridge
}

export const { invoke, subscribe } = createIpcClient(windowBridge)

/** The client of one Machine: null — this Machine, else Linked machine `machine`; any window. */
function clientOn(machine: string | null): IpcClient {
  return createIpcClient(() => (machine === null ? preloadBridge() : machineBridge(preloadBridge(), machine)))
}

/** Calls `channel` on Machine `machine` (null — this Machine), whichever Machine the window shows. */
export function invokeOn<K extends InvokeName>(machine: string | null, channel: K, ...args: InputArgs<K>): Promise<IpcResult<InvokeOutput<K>>> {
  return clientOn(machine).invoke(channel, ...args)
}

/** Subscribes to `channel` of Machine `machine` (null — this Machine); returns the unsubscribe. */
export function subscribeOn<K extends EventName>(machine: string | null, channel: K, handler: (payload: EventPayload<K>) => void): () => void {
  return clientOn(machine).subscribe(channel, handler)
}

/**
 * The reason without the channel's name in front when a Linked machine cannot be reached
 * ("claudeHome.live: Mini is unreachable" reads as "Mini is unreachable"; worfy-link ticket 09);
 * any other reason as it is.
 */
export function readableReason(error: string): string {
  return error.replace(/^[\w.]+: (?=.+ (is unreachable|did not answer in time)$)/, '')
}

/**
 * A subscription of a renderer hook that failed (worfy-ui ticket 16): it is written to the console and
 * shown as an `error` toast, one per channel, so the same failure again does not stack toasts up.
 */
export function showSubscribeError(channel: string, error: unknown): void {
  console.error(`${channel}: cannot subscribe`, error)
  const reason = error instanceof Error ? error.message : String(error)
  showToast({ kind: 'error', key: `ipc:${channel}`, text: `Updates stopped: cannot subscribe to ${channel} (${reason})` })
}
