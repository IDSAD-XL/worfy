/// <reference types="vite/client" />
// Registers every IPC handler of the main process.
//
// Each domain lives in its own file, src/main/ipc/<domain>.ts, whose default export is a list of
// handlers made with defineHandler(). This file finds those modules itself (import.meta.glob), so
// adding a domain never edits it (ADR-0006). The glob is lazy: modules are imported only by
// registerIpc(), which keeps this file importable in tests that run without Electron.
//
// Every handler is wrapped: the call is accepted only from the app's own window, the input is
// parsed with the channel's zod schema, an exception becomes {ok:false}, and the output is parsed
// too, so main never sends anything the contract does not describe.
import { pathToFileURL } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  handlerFailure,
  IPC_CHANNEL_PREFIX,
  type EventChannel,
  type EventName,
  type InvokeChannel,
  type InvokeName,
  type IpcContract,
  type IpcResult,
} from '../../shared/ipc/channels'

type MaybePromise<T> = T | Promise<T>

export interface HandlerContext {
  /** The raw Electron event, e.g. to reach `event.sender` for replies on event channels. */
  event: IpcMainInvokeEvent
}

/** One channel's handler, bound to its channel definition. */
export interface InvokeHandler<C extends InvokeChannel = InvokeChannel> {
  readonly channel: C
  readonly handle: (input: z.output<C['input']>, context: HandlerContext) => MaybePromise<z.input<C['output']>>
}

/** The default export of src/main/ipc/<domain>.ts. */
export type HandlerModule = readonly InvokeHandler[]

/** Binds a handler to a channel that is in the contract; the input and output types follow from it. */
export function defineHandler<C extends IpcContract[InvokeName]>(
  channel: C,
  handle: (input: z.output<C['input']>, context: HandlerContext) => MaybePromise<z.input<C['output']>>,
): InvokeHandler {
  return { channel, handle } as InvokeHandler
}

/**
 * The part of Electron's ipcMain this module uses; tests pass a fake. `definition` is the channel
 * the listener answers: Electron's ipcMain ignores it, the link adapter reads its access mark.
 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown, definition: InvokeChannel): void
}

/** Loads one handler module, as import.meta.glob returns it. */
export type ModuleLoader = () => Promise<unknown>

/** src/main/ipc/<domain>.ts, every file except this one. */
export const handlerModules: Record<string, ModuleLoader> = import.meta.glob(['./*.ts', '!./index.ts'], { import: 'default' })

export interface AppUrlOptions {
  /** Absolute path of the bundled renderer entry (out/renderer/index.html). */
  indexHtml: string
  /**
   * ELECTRON_RENDERER_URL in a dev run (`electron-vite dev`); the window then loads from this
   * origin. rendererEntry() in src/main/window.ts leaves it out of a packaged app.
   */
  devServerUrl?: string | undefined
}

/**
 * True for URLs of the app's own renderer: the dev server origin in development, the bundled
 * index.html otherwise. Query and hash are ignored, any other page is not the app.
 *
 * A dev server address that is not an http(s) URL throws: its origin would be "null" (a data: or
 * about: page has that origin too) or would not parse, and trusting either is no check at all.
 */
export function appUrlMatcher({ indexHtml, devServerUrl }: AppUrlOptions): (url: string) => boolean {
  if (devServerUrl) {
    const server = URL.canParse(devServerUrl) ? new URL(devServerUrl) : undefined
    if (server === undefined || (server.protocol !== 'http:' && server.protocol !== 'https:')) {
      throw new TypeError(`The dev server address is not an http(s) URL: ${JSON.stringify(devServerUrl)}`)
    }
    const { origin } = server
    return (url) => URL.canParse(url) && new URL(url).origin === origin
  }
  const expected = pathToFileURL(indexHtml).href
  return (url) => {
    if (!URL.canParse(url)) return false
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    return parsed.href === expected
  }
}

export interface RegisterOptions {
  /** Handler modules to register; defaults to every src/main/ipc/<domain>.ts. */
  modules?: Record<string, ModuleLoader>
  /**
   * Decides whether a frame URL belongs to the app window. There is no default: the caller builds
   * it from the same renderer location the window loads (src/main/index.ts, rendererEntry()).
   */
  isTrustedSender: (url: string) => boolean
  /**
   * Which channels to register: every one by default (the app's windows). The link adapter passes
   * the access marks a Linked machine may reach (src/main/link/ipc-adapter.ts); a channel left out
   * has no listener there at all, so no call can reach its handler.
   */
  channels?: (channel: InvokeChannel) => boolean
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function isHandlerModule(value: unknown): value is HandlerModule {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'channel' in item &&
        'handle' in item &&
        typeof item.handle === 'function' &&
        typeof item.channel === 'object' &&
        item.channel !== null &&
        'kind' in item.channel &&
        item.channel.kind === 'invoke',
    )
  )
}

function wrap(handler: InvokeHandler, isTrustedSender: (url: string) => boolean) {
  const { channel, handle } = handler
  return async (event: IpcMainInvokeEvent, input: unknown): Promise<IpcResult<unknown>> => {
    const frameUrl = event.senderFrame?.url
    if (frameUrl === undefined || !isTrustedSender(frameUrl)) {
      return { ok: false, error: `${channel.name}: call rejected, it came from an untrusted frame (${frameUrl ?? 'no frame'})` }
    }

    const parsedInput = await channel.input.safeParseAsync(input)
    if (!parsedInput.success) {
      return { ok: false, error: `${channel.name}: invalid input\n${z.prettifyError(parsedInput.error)}` }
    }

    let output: unknown
    try {
      output = await handle(parsedInput.data, { event })
    } catch (error) {
      console.error(`[ipc] ${channel.name} threw`, error)
      return { ok: false, error: handlerFailure(channel.name, messageOf(error)) }
    }

    const parsedOutput = await channel.output.safeParseAsync(output)
    if (!parsedOutput.success) {
      // The handler broke the contract: log the detail here, send nothing of the value.
      console.error(`[ipc] ${channel.name} returned an invalid output\n${z.prettifyError(parsedOutput.error)}`)
      return { ok: false, error: `${channel.name}: invalid output from the handler` }
    }
    return { ok: true, value: parsedOutput.data }
  }
}

/**
 * Loads the handler modules and registers each handler that `options.channels` accepts on `ipc`
 * under `worfy:<channel>`. Returns the registered channel names. Throws on a malformed module or a channel handled twice:
 * both are programming errors that must stop the app at start, not surface later.
 */
export async function registerIpc(ipc: IpcMainLike, options: RegisterOptions): Promise<string[]> {
  const modules = options.modules ?? handlerModules
  const { isTrustedSender } = options

  const handlers: InvokeHandler[] = []
  for (const [path, load] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const loaded = await load()
    if (!isHandlerModule(loaded)) {
      throw new Error(`IPC handler module ${path} must default-export a list of defineHandler(...) results`)
    }
    handlers.push(...loaded)
  }

  const names: string[] = []
  for (const handler of handlers) {
    const { name } = handler.channel
    if (names.includes(name)) throw new Error(`IPC channel ${name} is handled more than once`)
    names.push(name)
  }
  const registered: string[] = []
  for (const handler of handlers) {
    if (options.channels !== undefined && !options.channels(handler.channel)) continue
    ipc.handle(IPC_CHANNEL_PREFIX + handler.channel.name, wrap(handler, isTrustedSender), handler.channel)
    registered.push(handler.channel.name)
  }
  return registered
}

/** Where an event goes: a window's webContents, or a fake in tests. */
export interface EventTarget {
  send(channel: string, ...args: unknown[]): void
}

/**
 * Sends an event to the renderer. The payload is parsed first; a payload outside the contract
 * is a bug in main and throws here instead of reaching the renderer.
 */
export function emit<C extends IpcContract[EventName]>(target: EventTarget, channel: C, payload: z.input<C['payload']>): void {
  // Widened on purpose: while no domain declares an event, IpcContract[EventName] is `never`.
  const definition = channel as EventChannel
  const parsed = definition.payload.safeParse(payload)
  if (!parsed.success) {
    throw new Error(`${definition.name}: invalid event payload\n${z.prettifyError(parsed.error)}`)
  }
  target.send(IPC_CHANNEL_PREFIX + definition.name, parsed.data)
}
