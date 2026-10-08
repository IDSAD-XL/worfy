// What travels over a link connection (main ↔ main), apart from the IPC contract of src/shared/ipc:
// the frame format, the version of the link protocol, and the link's own service messages.
//
// Service messages are the extension point other modules use (worfy-link tickets 13, 14, 15): a
// module registers its message by name with a zod schema and a handler on the link service
// (LinkService.registerMessage), and sends it to a Machine by id (LinkService.sendMessage). The
// receiving side parses the payload with its own schema; a payload outside it never reaches the
// handler. This ticket defines two: `hello` and `revoked`. Service messages are not IPC channels
// and are not in the list of channels open to Linked machines (ipc-adapter.ts).
import { z } from 'zod'

/** The version of the link protocol; a peer that speaks another one is refused before the handshake. */
export const LINK_PROTOCOL_VERSION = 1

/** The handshake header that carries the protocol version (an integer). */
export const LINK_PROTOCOL_HEADER = 'x-worfy-link-protocol'

/** The largest WebSocket message either side takes while pairing: the pairing frames are a few hundred bytes. */
export const PAIRING_MAX_PAYLOAD = 64 * 1024

/** The largest WebSocket message either side takes on an established connection (ws allows 100 MiB by default). */
export const LINK_MAX_PAYLOAD = 16 * 1024 * 1024

/** Paths of the two WebSocket endpoints. */
export const PAIR_PATH = '/link/pair'
export const CONNECT_PATH = '/link/connect'

const ipcResultSchema = z.union([z.object({ ok: z.literal(true), value: z.unknown().optional() }), z.object({ ok: z.literal(false), error: z.string() })])

/** One frame of an established connection (pairing has its own frames, pairing.ts). */
export const frameSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('msg'), name: z.string().min(1).max(200), payload: z.unknown().optional() }),
  z.object({ t: z.literal('call'), id: z.number().int().nonnegative(), channel: z.string().min(1).max(200), input: z.unknown().optional() }),
  z.object({ t: z.literal('result'), id: z.number().int().nonnegative(), result: ipcResultSchema }),
  z.object({ t: z.literal('event'), channel: z.string().min(1).max(200), payload: z.unknown().optional() }),
])

export type Frame = z.output<typeof frameSchema>

/** A service message: a name and the schema of its payload. */
export interface LinkMessage<S extends z.ZodType = z.ZodType> {
  readonly name: string
  readonly schema: S
}

export function defineLinkMessage<S extends z.ZodType>(name: string, schema: S): LinkMessage<S> {
  return { name, schema }
}

/** Who this Machine is, sent by both sides as the first frame of every connection. */
export const helloMessage = defineLinkMessage(
  'hello',
  z.object({
    id: z.uuid(),
    name: z.string().min(1).max(200),
    protocol: z.number().int().positive(),
    build: z.string().min(1).max(200),
    /** The port this Machine's server listens on; null when it is not listening. */
    port: z.number().int().min(1).max(65535).nullable(),
  }),
)

/** The sender has forgotten the receiver: the receiver forgets the sender too (ADR-0052, point 9). */
export const revokedMessage = defineLinkMessage('revoked', z.object({}))

export type MessageHandler<S extends z.ZodType> = (payload: z.output<S>, from: { machineId: string }) => void | Promise<void>

interface Registered {
  schema: z.ZodType
  handle: (payload: unknown, from: { machineId: string }) => void | Promise<void>
}

/** The service messages one link service knows; each name once. */
export class MessageRegistry {
  private readonly messages = new Map<string, Registered>()

  register<S extends z.ZodType>(message: LinkMessage<S>, handle: MessageHandler<S>): void {
    if (this.messages.has(message.name)) throw new Error(`link message ${message.name} is registered more than once`)
    this.messages.set(message.name, { schema: message.schema, handle: handle as Registered['handle'] })
  }

  /** The payload, parsed with the schema this side registered; throws when it is not. */
  outgoing<S extends z.ZodType>(message: LinkMessage<S>, payload: z.input<S>): z.output<S> {
    const parsed = message.schema.safeParse(payload)
    if (!parsed.success) throw new Error(`link message ${message.name}: the payload does not match its schema`)
    return parsed.data
  }

  /**
   * Runs the handler of an incoming message. An unknown name or a payload outside the schema is
   * dropped with a warning that names the message and the Machine, never the payload.
   */
  async dispatch(name: string, payload: unknown, from: { machineId: string }, warn: (message: string) => void): Promise<void> {
    const registered = this.messages.get(name)
    if (registered === undefined) {
      warn(`[link] Machine ${from.machineId} sent an unknown message ${name}; dropped`)
      return
    }
    const parsed = registered.schema.safeParse(payload)
    if (!parsed.success) {
      warn(`[link] Machine ${from.machineId} sent message ${name} outside its schema; dropped`)
      return
    }
    try {
      await registered.handle(parsed.data, from)
    } catch (error) {
      warn(`[link] the handler of message ${name} from Machine ${from.machineId} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
