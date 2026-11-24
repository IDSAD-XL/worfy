// The `wait_release` lines of the fake agent's scripts (fake-script.ts) and what lets them pass.


/**
 * What a test lets through the `wait_release` lines of fake scripts. A release made before the wait
 * is kept: each one lets one wait of its name pass.
 */
export class FakeReleases {
  private readonly pending = new Map<string, number>()
  private readonly waiters = new Map<string, (() => void)[]>()

  release(name: string): void {
    const waiting = this.waiters.get(name)
    const next = waiting?.shift()
    if (next !== undefined) {
      next()
      return
    }
    this.pending.set(name, (this.pending.get(name) ?? 0) + 1)
  }

  /** Settles once `name` is released, or at once for a release made earlier; `cancel` gives up. */
  wait(name: string, cancel: { onCancel(stop: () => void): void }): Promise<void> {
    const kept = this.pending.get(name) ?? 0
    if (kept > 0) {
      this.pending.set(name, kept - 1)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const list = this.waiters.get(name) ?? []
      list.push(resolve)
      this.waiters.set(name, list)
      cancel.onCancel(() => {
        const at = list.indexOf(resolve)
        if (at >= 0) list.splice(at, 1)
        resolve()
      })
    })
  }
}
