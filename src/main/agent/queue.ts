// The message queue of a Session (ticket 19). A message the user sends while a turn runs does not
// go to Claude Code: it waits here, and the Session takes the next one after each turn's `result`.
// Interrupt holds the queue (`paused`): its messages stay, and go only when the user asks for them
// ("Send queued"). Only messages already in the queue are held: an empty queue is never held, so
// what the user queues after the held messages are sent or removed goes on its own again. The
// queue lives in main, so switching the window between the Canvas and the
// Session view never loses it; it does not outlive the Session, except that the Orchestrator's
// Session hands it to the Session that replaces it when Autopilot gives the Orchestrator back.
//
// A queued message keeps its attachments (ticket 20); the snapshot the windows get shows the
// message as the transcript will (messageLabel), without the bytes of its images.
import { randomUUID } from 'node:crypto'
import { messageLabel, type Attachment } from '../../shared/agent/attachments'
import type { QueuedMessage, QueueSnapshot } from '../../shared/agent/events'

export type { QueuedMessage, QueueSnapshot }

/** A message in the queue, as it will be sent. */
export interface QueueEntry {
  id: string
  text: string
  attachments: readonly Attachment[]
}

export class MessageQueue {
  private items: QueueEntry[] = []
  private held = false

  /** `onChange` gets every new state of the queue, as a copy. */
  constructor(private readonly onChange: (snapshot: QueueSnapshot) => void) {}

  get size(): number {
    return this.items.length
  }

  get paused(): boolean {
    return this.held
  }

  snapshot(): QueueSnapshot {
    return { items: this.items.map((item) => ({ id: item.id, text: messageLabel(item.text, item.attachments) })), paused: this.held }
  }

  /** Puts a message at the end of the queue. */
  add(text: string, attachments: readonly Attachment[] = []): QueuedMessage {
    const item: QueueEntry = { id: randomUUID(), text, attachments: [...attachments] }
    this.items = [...this.items, item]
    this.changed()
    return { id: item.id, text: messageLabel(text, attachments) }
  }

  /** Takes a message out before it is sent; false when it is not (or no longer) in the queue. */
  remove(id: string): boolean {
    const rest = this.items.filter((item) => item.id !== id)
    if (rest.length === this.items.length) return false
    this.items = rest
    if (rest.length === 0) this.held = false
    this.changed()
    return true
  }

  /** The oldest message, taken out of the queue; nothing while the queue is held or empty. */
  take(): QueueEntry | undefined {
    if (this.held) return undefined
    const [first, ...rest] = this.items
    if (first === undefined) return undefined
    this.items = rest
    if (rest.length === 0) this.held = false
    this.changed()
    return first
  }

  /** Holds the messages in the queue: take() gives nothing until resume(). An empty queue is not held. */
  pause(): void {
    if (this.held || this.items.length === 0) return
    this.held = true
    this.changed()
  }

  /**
   * Takes every message out, with whether they were held: for a Session that replaces this one
   * (Autopilot hands the Orchestrator back, worfy-daily ticket 04). The queue is left empty.
   */
  takeAll(): { items: QueueEntry[]; paused: boolean } {
    const taken = { items: this.items, paused: this.held }
    if (this.items.length === 0) return taken
    this.items = []
    this.held = false
    this.changed()
    return taken
  }

  /** Puts messages taken from another queue (takeAll) before this one's, held as they were there. */
  adopt(taken: { items: readonly QueueEntry[]; paused: boolean }): void {
    if (taken.items.length === 0) return
    this.items = [...taken.items, ...this.items]
    this.held = this.held || taken.paused
    this.changed()
  }

  resume(): void {
    if (!this.held) return
    this.held = false
    this.changed()
  }

  private changed(): void {
    this.onChange(this.snapshot())
  }
}
