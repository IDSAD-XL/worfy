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

/**
 * What a `project` channel does to the Projects of this Machine (worfy-link ticket 18; ADR-0066).
 * Every `project` channel carries one, and only `project` channels do:
 * - `read` — open to a Linked machine with read-only access. A call changes no file and no state
 *   of a Project or of worfy, starts or stops no process and sends nothing into a Session or a
 *   Terminal; subscribing to events and unsubscribing count as reading. An event is `read` when a
 *   Linked machine with read-only access receives it.
 * - `write` — everything else; open only with full access. `terminal.output` is a `write` event:
 *   the output of a Terminal stays out of read-only access (the owner's decision).
 * Read-only access still means trust: a transcript, a Session event or a notification may show a
 * secret.
 */
export const CHANNEL_USE = ['read', 'write'] as const
export type ChannelUse = (typeof CHANNEL_USE)[number]

/** A request-response channel: the renderer sends `input`, main answers with `output`. */
export interface InvokeChannel<N extends string = string, I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  readonly kind: 'invoke'
  readonly name: N
  readonly input: I
  readonly output: O
  readonly access: ChannelAccess
  /** Read or write, for a `project` channel; null for every other mark. */
  readonly use: ChannelUse | null
}

/** A stream of events that main pushes to the renderer. */
export interface EventChannel<N extends string = string, P extends z.ZodType = z.ZodType> {
  readonly kind: 'event'
  readonly name: N
  readonly payload: P
  readonly access: ChannelAccess
  /** Read or write, for a `project` channel; null for every other mark. */
  readonly use: ChannelUse | null
}

/** The mark of every channel declared so far in this JavaScript realm, by name. */
const declaredAccess = new Map<string, ChannelAccess>()
/** The read-or-write mark of every `project` channel declared so far, by name. */
const declaredUse = new Map<string, ChannelUse>()

/**
 * The definition of every channel declared so far, by name: the first one declared; null for a
 * name declared twice with two marks or two kinds, which no definition speaks for.
 */
const declaredChannels = new Map<string, InvokeChannel | EventChannel | null>()

function declare<C extends InvokeChannel | EventChannel>(channel: C): C {
  const { name, access, use } = channel
  const before = declaredAccess.get(name)
  // A name declared twice with two marks counts as closed: neither declaration may open the other.
  // Two read-or-write marks of one `project` name close it the same way.
  const agrees = before === undefined || (before === access && declaredUse.get(name) === (use ?? undefined))
  declaredAccess.set(name, agrees ? access : 'local')
  if (agrees && use !== null) declaredUse.set(name, use)
  else declaredUse.delete(name)
  // The first declaration speaks for the name: a later one with the same marks and kind cannot swap
  // its schema for another; one with another mark or kind closes the name.
  const previous = declaredChannels.get(name)
  if (previous === undefined) declaredChannels.set(name, channel)
  else if (previous !== null && (previous.kind !== channel.kind || previous.access !== access || previous.use !== use)) declaredChannels.set(name, null)
  return channel
}

/**
 * The definition of a declared channel, for whoever gets a call's answer or an event by name alone
 * and must hold it to the contract before passing it on (an answer or an event of a Linked machine,
 * src/main/link/remote-calls.ts). Undefined for a name no loaded module declares, or one declared
 * twice with two marks or kinds.
 */
export function definitionOf(name: string): InvokeChannel | EventChannel | undefined {
  return declaredChannels.get(name) ?? undefined
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

/**
 * The read-or-write mark of a declared `project` channel; undefined for any other mark, a name no
 * loaded module declares, or one declared twice with two marks. Whoever lets a Linked machine with
 * read-only access in (src/main/link/ipc-adapter.ts) treats undefined as write.
 */
export function useOf(name: string): ChannelUse | undefined {
  return declaredUse.get(name)
}

/**
 * The access mark is required: a channel declared without one does not compile. A `project`
 * channel needs its read-or-write mark too, and no other channel takes one.
 */
export function invokeChannel<N extends string, I extends z.ZodType, O extends z.ZodType>(name: N, input: I, output: O, access: 'project', use: ChannelUse): InvokeChannel<N, I, O>
export function invokeChannel<N extends string, I extends z.ZodType, O extends z.ZodType>(name: N, input: I, output: O, access: Exclude<ChannelAccess, 'project'>): InvokeChannel<N, I, O>
export function invokeChannel<N extends string, I extends z.ZodType, O extends z.ZodType>(name: N, input: I, output: O, access: ChannelAccess, use?: ChannelUse): InvokeChannel<N, I, O> {
  return declare({ kind: 'invoke', name, input, output, access, use: access === 'project' ? (use ?? 'write') : null })
}

/** The access mark is required, and the read-or-write mark of a `project` channel: see invokeChannel. */
export function eventChannel<N extends string, P extends z.ZodType>(name: N, payload: P, access: 'project', use: ChannelUse): EventChannel<N, P>
export function eventChannel<N extends string, P extends z.ZodType>(name: N, payload: P, access: Exclude<ChannelAccess, 'project'>): EventChannel<N, P>
export function eventChannel<N extends string, P extends z.ZodType>(name: N, payload: P, access: ChannelAccess, use?: ChannelUse): EventChannel<N, P> {
  return declare({ kind: 'event', name, payload, access, use: access === 'project' ? (use ?? 'write') : null })
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
