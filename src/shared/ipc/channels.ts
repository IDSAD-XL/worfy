// The IPC contract between the renderer and the main process.
//
// IpcContract is empty here on purpose. Each domain adds its channels in its own file,
// src/shared/ipc/<domain>.ts, by declaration merging:
//
//   export const appVersion = invokeChannel('app.version', z.void(), z.object({ version: z.string() }), 'local')
//   declare module './channels' {
//     interface IpcContract {
//       'app.version': typeof appVersion
//     }
//   }
//
// and handles them in src/main/ipc/<domain>.ts, which src/main/ipc/index.ts discovers on its own.
// Neither this file, src/main/ipc/index.ts nor the preload changes when a channel is added
// (ADR-0006). Runtime code here stays free of zod, so the preload bundle does not pull it in.
import type { z } from 'zod'

/** Every channel crosses Electron IPC under this prefix, so the bridge cannot reach other channels. */
export const IPC_CHANNEL_PREFIX = 'worfy:'

/**
 * Whether a Linked machine may use a channel (worfy-link ticket 08; ADR-0052, point 6). Every
 * channel carries one, in its own domain file:
 * - `link` — a service channel of the link (`link.ping`); open to a Linked machine always, also
 *   while access is off;
 * - `project` — work with the Projects of this Machine; open to a Linked machine while "Linked
 *   machines can work with my Projects" is on;
 * - `desktop` — needs the desktop of the Project machine (a native dialog, the OS shell); never
 *   open to a Linked machine;
 * - `local` — the state of the screen's own machine (the active Project, the menu, notifications,
 *   Limits, the link settings); never open to a Linked machine.
 * A channel the link adapter does not know counts as closed.
 */
export const CHANNEL_ACCESS = ['link', 'project', 'desktop', 'local'] as const
export type ChannelAccess = (typeof CHANNEL_ACCESS)[number]

/** The marks a Linked machine may reach at all; which of them it reaches now depends on the switch. */
export const LINKED_MACHINE_ACCESS: readonly ChannelAccess[] = ['link', 'project']

/** A request-response channel: the renderer sends `input`, main answers with `output`. */
export interface InvokeChannel<N extends string = string, I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  readonly kind: 'invoke'
  readonly name: N
  readonly input: I
  readonly output: O
  readonly access: ChannelAccess
}

/** A stream of events that main pushes to the renderer. */
export interface EventChannel<N extends string = string, P extends z.ZodType = z.ZodType> {
  readonly kind: 'event'
  readonly name: N
  readonly payload: P
  readonly access: ChannelAccess
}

/** The mark of every channel declared so far in this JavaScript realm, by name. */
const declaredAccess = new Map<string, ChannelAccess>()

function declare(name: string, access: ChannelAccess): void {
  const before = declaredAccess.get(name)
  // A name declared twice with two marks counts as closed: neither declaration may open the other.
  declaredAccess.set(name, before === undefined || before === access ? access : 'local')
}

/**
 * The mark of a declared channel; undefined for a name no loaded module declares. Whoever sends
 * an event by name alone (a client without a window, src/main/link/ipc-adapter.ts) reads it here,
 * and treats undefined as closed. Every event main sends goes through emit() with the channel's
 * definition, so its module is loaded by then.
 */
export function accessOf(name: string): ChannelAccess | undefined {
  return declaredAccess.get(name)
}

/** The access mark is required: a channel declared without one does not compile. */
export function invokeChannel<N extends string, I extends z.ZodType, O extends z.ZodType>(name: N, input: I, output: O, access: ChannelAccess): InvokeChannel<N, I, O> {
  declare(name, access)
  return { kind: 'invoke', name, input, output, access }
}

/** The access mark is required: a channel declared without one does not compile. */
export function eventChannel<N extends string, P extends z.ZodType>(name: N, payload: P, access: ChannelAccess): EventChannel<N, P> {
  declare(name, access)
  return { kind: 'event', name, payload, access }
}

/**
 * Channel name → channel definition. Filled by src/shared/ipc/<domain>.ts through declaration
 * merging; the key must equal the definition's `name`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- populated by declaration merging in each domain file
export interface IpcContract {}

export type InvokeName = { [K in keyof IpcContract]: IpcContract[K] extends InvokeChannel<K> ? K : never }[keyof IpcContract]
export type EventName = { [K in keyof IpcContract]: IpcContract[K] extends EventChannel<K> ? K : never }[keyof IpcContract]

type InvokeOf<K extends InvokeName> = Extract<IpcContract[K], InvokeChannel>
type EventOf<K extends EventName> = Extract<IpcContract[K], EventChannel>

/** What the renderer passes to `invoke` (before main parses it). */
export type InvokeInput<K extends InvokeName> = z.input<InvokeOf<K>['input']>
/** What the renderer gets back from `invoke` (after main parsed it). */
export type InvokeOutput<K extends InvokeName> = z.output<InvokeOf<K>['output']>
/** What a subscriber receives for an event channel. */
export type EventPayload<K extends EventName> = z.output<EventOf<K>['payload']>

/**
 * Keys whose definition carries a different `name` than the key: such a channel would type-check
 * in the renderer and be registered under another name in main.
 */
export type MisnamedChannel = {
  [K in keyof IpcContract]: IpcContract[K] extends InvokeChannel<K> | EventChannel<K> ? never : K
}[keyof IpcContract]

// Fails to compile, naming the key, when some domain file declares a channel under the wrong key.
export const contractNamesMatch: [MisnamedChannel] extends [never] ? true : MisnamedChannel = true

/** Every `invoke` resolves to this: main never throws across the boundary. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** The `error` of a handler that threw: the channel's name, then the handler's own message. */
export const handlerFailure = (channel: string, message: string): string => `${channel} failed: ${message}`

/**
 * The handler's own message out of a `handlerFailure` of `channel` (a refusal's reason, for a
 * button); any other error (invalid input, an untrusted frame, a broken bridge) stays whole.
 */
export function failureReason(channel: string, error: string): string {
  const prefix = handlerFailure(channel, '')
  return error.startsWith(prefix) ? error.slice(prefix.length) : error
}

/**
 * What the preload exposes as `window.worfy`. It is untyped by channel on purpose: the preload
 * does not know the channel list. Typed wrappers live in src/renderer/ipc.ts.
 */
export interface WorfyBridge {
  invoke(channel: string, input: unknown): Promise<IpcResult<unknown>>
  /** Returns a subscription id for `off`. */
  on(channel: string, handler: (payload: unknown) => void): number
  off(subscription: number): void
}
