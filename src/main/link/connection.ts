// One established link connection to a Linked machine, whichever side opened it: frames in and out
// (messages.ts), IPC calls with their answers, and a ping/pong heartbeat. A connection that misses
// a pong within the interval is terminated, and 'close' tells the service it is gone.
import { EventEmitter } from 'node:events'
import type WebSocket from 'ws'
import type { IpcResult } from '../../shared/ipc/channels'
import { frameSchema, LINK_MAX_PAYLOAD, type Frame } from './messages'

/** How often a connection pings; a connection without a pong by the next ping is dropped. */
export const PING_INTERVAL_MS = 15_000

/** How long an IPC call over the link waits for its answer. */
export const CALL_TIMEOUT_MS = 30_000

/** Close codes the link uses on top of the WebSocket ones. */
export const CLOSE_REVOKED = 4003
export const CLOSE_UNLINKED = 4004

/** A size in MB, two decimals cut, as people read it in a message. */
const megabytes = (bytes: number): string => `${Math.floor((bytes / (1024 * 1024)) * 100) / 100} MB`

export interface LinkConnectionEvents {
  frame: [Frame]
  close: [code: number]
}

export class LinkConnection extends EventEmitter<LinkConnectionEvents> {
  private nextCallId = 0
  private readonly pending = new Map<number, { resolve: (result: IpcResult<unknown>) => void; timer: NodeJS.Timeout }>()
  private readonly heartbeat: NodeJS.Timeout
  private alive = true
  private closed = false
  private readonly warn: (message: string) => void

  constructor(
    private readonly ws: WebSocket,
    /** The Linked machine at the other end. */
    readonly machineId: string,
    /** Which side opened it: 'out' — this Machine connected, 'in' — the other one did. */
    readonly direction: 'in' | 'out',
    options: { pingIntervalMs?: number; warn: (message: string) => void },
  ) {
    super()
    this.warn = options.warn
    ws.on('message', (data) => {
      // Once either side started closing (a revoke, linking again), nothing more is acted on.
      if (ws.readyState !== ws.OPEN) return
      let frame: Frame
      try {
        const parsed = frameSchema.safeParse(JSON.parse(String(data)))
        if (!parsed.success) throw new Error('not a frame')
        frame = parsed.data
      } catch {
        options.warn(`[link] Machine ${machineId} sent a malformed frame; dropped`)
        return
      }
      if (frame.t === 'result') {
        const waiting = this.pending.get(frame.id)
        if (waiting === undefined) return
        this.pending.delete(frame.id)
        clearTimeout(waiting.timer)
        // JSON drops a `value` that is undefined (a void channel); the result still has one.
        waiting.resolve(frame.result.ok ? { ok: true, value: frame.result.value } : frame.result)
        return
      }
      this.emit('frame', frame)
    })
    ws.on('pong', () => {
      this.alive = true
    })
    ws.on('close', (code) => this.finish(code))
    ws.on('error', () => {
      // 'close' follows; the error itself may quote nothing secret, but there is nothing to add.
    })
    this.heartbeat = setInterval(() => {
      if (!this.alive) {
        ws.terminate()
        return
      }
      this.alive = false
      ws.ping()
    }, options.pingIntervalMs ?? PING_INTERVAL_MS)
    this.heartbeat.unref()
  }

  get isOpen(): boolean {
    return !this.closed && this.ws.readyState === this.ws.OPEN
  }

  send(frame: Frame): void {
    if (!this.isOpen) return
    this.ws.send(JSON.stringify(frame))
  }

  /**
   * Answers call `id` of `channel` with its result. The receiver closes a connection that sends it
   * a message over LINK_MAX_PAYLOAD bytes (code 1009), which would break every call on it; a result
   * that large goes out as an error of this one call instead, and the connection stays.
   */
  answer(id: number, channel: string, result: IpcResult<unknown>): void {
    if (!this.isOpen) return
    const text = JSON.stringify({ t: 'result', id, result } satisfies Frame)
    // The receiver counts the UTF-8 bytes of a text message, not its UTF-16 length.
    const bytes = Buffer.byteLength(text)
    if (bytes <= LINK_MAX_PAYLOAD) {
      this.ws.send(text)
      return
    }
    this.warn(`[link] the answer to ${channel} is ${bytes} bytes, more than the ${LINK_MAX_PAYLOAD} a link connection carries; Machine ${this.machineId} gets an error instead`)
    this.send({ t: 'result', id, result: { ok: false, error: `${channel}: the answer is too large to send over the link` } })
  }

  /**
   * Calls an IPC channel on the other Machine; resolves with its IpcResult, never rejects. A call
   * over LINK_MAX_PAYLOAD bytes (an image or an attachment of many megabytes) is refused here,
   * before it is sent: the receiver would close the connection (code 1009) and every call on it.
   */
  call(channel: string, input: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<IpcResult<unknown>> {
    if (!this.isOpen) return Promise.resolve({ ok: false, error: `${channel}: the Linked machine is not connected` })
    const id = this.nextCallId++
    const text = JSON.stringify({ t: 'call', id, channel, input } satisfies Frame)
    // The receiver counts the UTF-8 bytes of a text message, not its UTF-16 length.
    const bytes = Buffer.byteLength(text)
    if (bytes > LINK_MAX_PAYLOAD) {
      return Promise.resolve({ ok: false, error: `${channel}: the request is ${megabytes(bytes)}, more than the ${megabytes(LINK_MAX_PAYLOAD)} a link to another machine carries` })
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: `${channel}: the Linked machine did not answer in time` })
      }, timeoutMs)
      this.pending.set(id, { resolve, timer })
      this.ws.send(text)
    })
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return
    this.ws.close(code, reason)
    // A peer that never answers the close handshake is cut off after a second.
    setTimeout(() => this.ws.terminate(), 1000).unref()
  }

  /** Cuts the connection at once (service stop). */
  terminate(): void {
    this.ws.terminate()
  }

  private finish(code: number): void {
    if (this.closed) return
    this.closed = true
    clearInterval(this.heartbeat)
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer)
      waiting.resolve({ ok: false, error: `call ${id}: the connection to the Linked machine closed` })
    }
    this.pending.clear()
    this.emit('close', code)
  }
}
