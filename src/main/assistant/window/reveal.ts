// The click on a system notification of the Assistant (worfy-assistant ticket 14): the window shows the Assistant's
// section. The windows that follow the section — they opened it through `assistant.open` — get `assistant.reveal` at
// once. When none follows it (no window yet, or one still loading), the reveal waits for the first window that opens the
// section, and for that one alone: a later window or a reload starts where it would have.

/** A window as the reveal sees it: whether it is gone. */
export interface RevealClient {
  isDestroyed(): boolean
}

export class AssistantReveal<C extends RevealClient = RevealClient> {
  private readonly followers = new Set<C>()
  private pending = false

  /** A window that opened the section; answers the function that drops it. */
  follow(client: C): () => void {
    this.followers.add(client)
    return () => void this.followers.delete(client)
  }

  /** A notification was clicked: `send` tells each live follower; with none, the reveal waits. */
  request(send: (client: C) => void): void {
    const live = [...this.followers].filter((client) => !client.isDestroyed())
    this.pending = live.length === 0
    for (const client of live) {
      try {
        send(client)
      } catch (error) {
        console.warn('[assistant] a window did not get the reveal', error)
      }
    }
  }

  /** Whether a reveal waits for the window that asks; asking takes it. */
  take(): boolean {
    const pending = this.pending
    this.pending = false
    return pending
  }
}
