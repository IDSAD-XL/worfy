// An async queue: the prompt the Claude driver gives its query (user messages pushed one by one), and
// the events a driver's SessionHandle gives its Session (src/main/vendors/claude/session.ts).

/** An async iterable that yields what is pushed into it, until it is ended or failed. */
export class InputQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private waiting: { resolve: (result: IteratorResult<T>) => void; reject: (error: unknown) => void } | null = null
  private ended = false
  /** Set by fail(): what the iteration throws once the items before it are taken. */
  private failure: { error: unknown } | null = null

  push(item: T): void {
    if (this.ended) return
    if (this.waiting) {
      const { resolve } = this.waiting
      this.waiting = null
      resolve({ value: item, done: false })
    } else {
      this.items.push(item)
    }
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    if (this.waiting) {
      const { resolve } = this.waiting
      this.waiting = null
      resolve({ value: undefined, done: true })
    }
  }

  /** Ends the queue with an error: the iteration throws it after the items pushed before. */
  fail(error: unknown): void {
    if (this.ended) return
    this.ended = true
    this.failure = { error }
    if (this.waiting) {
      const { reject } = this.waiting
      this.waiting = null
      reject(error)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift() as T, done: false })
        if (this.failure !== null) return Promise.reject(this.failure.error)
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve, reject) => {
          this.waiting = { resolve, reject }
        })
      },
    }
  }
}
