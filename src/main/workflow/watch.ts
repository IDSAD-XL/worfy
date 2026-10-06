// Keeps the workflow model of a Project current and reports only what changed.
//
// Two kinds of change are watched (chokidar), both read-only:
// - `.scratch/**` of the checkout: Tickets, specs. After a 300 ms quiet period one full
//   `epic-status --json` runs; the result is compared with the previous snapshot. A steady stream
//   of events (an agent rewriting Tickets) does not postpone the read for good: it starts at the
//   latest 1 s after the first event of the series (max-wait).
// - the git refs of Ticket branches (`refs/heads/**`, `packed-refs`) and the worktree list
//   (`worktrees/<name>/HEAD`): only branches whose head moved are read again.
// Reads never overlap: a change during a read leads to exactly one more read after it.
import { execFile } from 'node:child_process'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { diffModels, type WorkflowDelta, type WorkflowModel } from '../../shared/workflow/types'
import {
  applyBranches,
  epicStatusRunner,
  readBranches,
  readCheckout,
  ticketWorktrees,
  type BranchCache,
  type CheckoutModel,
  type EpicStatusRunner,
} from './reader'

export interface WatchOptions {
  root: string
  claudeHome: string
  /** Quiet period after the last file event before a read (default 300 ms). */
  debounceMs?: number
  /**
   * Longest wait after the first file event of a series before a read, however often events keep
   * coming (default 1000 ms). Measured on Auction (682 Tickets): one checkout `epic-status --json`
   * takes about 0.8 s, so a stream of saves shows its first change within about 1.8 s. While the
   * stream lasts, a read starts about once a second; reads never overlap.
   */
  maxWaitMs?: number
  /** Called with what changed after every read that changed something. */
  onChange: (delta: WorkflowDelta) => void
  /** Replaces the real script, for tests. */
  run?: EpicStatusRunner
}

function gitCommonDir(root: string): Promise<string | null> {
  return new Promise((done) => {
    execFile('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }, (error, stdout) => {
      if (error) return done(null)
      const dir = stdout.trim()
      done(isAbsolute(dir) ? dir : resolve(root, dir))
    })
  })
}

/**
 * Calls `fire` once `quietMs` pass without a new `trigger`, but no later than `maxWaitMs` after the
 * first `trigger` of a series. Without the cap, events closer together than `quietMs` would put
 * the call off for as long as they keep coming. Timers are the global ones, so fake timers in
 * tests drive it.
 */
export class Debounce {
  private quiet: ReturnType<typeof setTimeout> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly quietMs: number,
    private readonly maxWaitMs: number,
    private readonly fire: () => void,
  ) {}

  /** Whether a call is scheduled. */
  get scheduled(): boolean {
    return this.quiet !== null
  }

  trigger(): void {
    if (this.quiet) clearTimeout(this.quiet)
    this.quiet = setTimeout(() => this.flush(), this.quietMs)
    this.deadline ??= setTimeout(() => this.flush(), this.maxWaitMs)
  }

  /** Drops the scheduled call, if any. */
  cancel(): void {
    if (this.quiet) clearTimeout(this.quiet)
    if (this.deadline) clearTimeout(this.deadline)
    this.quiet = null
    this.deadline = null
  }

  private flush(): void {
    this.cancel()
    this.fire()
  }
}

/** Watches one Project. Create with `WorkflowWatcher.start`, stop with `close`. */
export class WorkflowWatcher {
  private model: WorkflowModel | null = null
  private checkout: CheckoutModel | null = null
  private branches: BranchCache = new Map()
  private readonly watchers: FSWatcher[] = []
  private readonly debounce: Debounce
  private dirtyCheckout = false
  private dirtyBranches = false
  private running: Promise<void> | null = null
  private pending = false
  private starting = true
  private closed = false

  private constructor(private readonly options: WatchOptions & { root: string; run: EpicStatusRunner }) {
    this.debounce = new Debounce(options.debounceMs ?? 300, options.maxWaitMs ?? 1000, () => this.request())
  }

  /**
   * Starts watching, then reads the Project. The watchers are ready before the first read begins,
   * so a change made while it runs is seen and read again; `start` resolves once no read is left
   * running, and `current` then already holds such a change. No `onChange` is sent before that.
   */
  static async start(options: WatchOptions): Promise<WorkflowWatcher> {
    const root = resolve(options.root)
    const run = options.run ?? epicStatusRunner(options.claudeHome)
    const watcher = new WorkflowWatcher({ ...options, root, run })
    try {
      await watcher.watch()
      watcher.dirtyCheckout = true
      watcher.dirtyBranches = true
      watcher.request()
      while (watcher.running) await watcher.running
      if (!watcher.model) throw new Error(`workflow: the first read of ${root} failed`)
    } catch (error) {
      await watcher.close()
      throw error
    }
    watcher.starting = false
    return watcher
  }

  /** The latest model. */
  get current(): WorkflowModel {
    if (!this.model) throw new Error('workflow: the watcher has not read the Project yet')
    return this.model
  }

  /** Resolves once no read is running or scheduled; for tests and shutdown. */
  async idle(): Promise<void> {
    while (this.running || this.debounce.scheduled) {
      if (this.running) await this.running
      else await new Promise((done) => setTimeout(done, 10))
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.debounce.cancel()
    await Promise.all(this.watchers.map((w) => w.close()))
    if (this.running) await this.running
  }

  private async watch(): Promise<void> {
    const { root } = this.options
    // `ready` is awaited through a promise made right away: it may fire while git answers below.
    const ready: Promise<void>[] = []
    const add = (watcher: FSWatcher, what: 'checkout' | 'branches') => {
      ready.push(new Promise<void>((done) => watcher.once('ready', () => done())))
      watcher.on('all', () => this.schedule(what))
      this.watchers.push(watcher)
    }
    add(watch(join(root, '.scratch'), { ignoreInitial: true }), 'checkout')

    const common = await gitCommonDir(root)
    if (common) {
      const worktrees = join(common, 'worktrees')
      // Only the HEAD file of each linked worktree matters; index and logs change on every git call.
      const ignored = (path: string) => {
        const rel = relative(worktrees, path)
        if (rel.startsWith('..') || isAbsolute(rel) || rel === '') return false
        const parts = rel.split(sep)
        return parts.length > 2 || (parts.length === 2 && parts[1] !== 'HEAD')
      }
      add(watch([join(common, 'refs', 'heads'), join(common, 'packed-refs'), worktrees], { ignoreInitial: true, ignored }), 'branches')
    }
    await Promise.all(ready)
  }

  private schedule(what: 'checkout' | 'branches'): void {
    if (this.closed) return
    if (what === 'checkout') this.dirtyCheckout = true
    else this.dirtyBranches = true
    this.debounce.trigger()
  }

  /** Starts a read, or asks for one more after the read in progress. */
  private request(): void {
    if (this.running) {
      this.pending = true
      return
    }
    this.running = this.loop().finally(() => {
      this.running = null
    })
  }

  private async loop(): Promise<void> {
    do {
      this.pending = false
      await this.readOnce()
    } while (this.pending && !this.closed)
  }

  private async readOnce(): Promise<void> {
    const { root, run } = this.options
    const checkoutChanged = this.dirtyCheckout || !this.checkout
    const branchesChanged = this.dirtyBranches
    this.dirtyCheckout = false
    this.dirtyBranches = false

    try {
      let checkout = this.checkout
      if (checkoutChanged || !checkout) checkout = this.checkout = await readCheckout(root, run)
      if (checkout.error) this.branches = new Map()
      else if (checkoutChanged || branchesChanged) {
        this.branches = await readBranches(root, checkout, await ticketWorktrees(root), this.branches, run)
      }
      const previous = this.model
      const next = applyBranches(checkout, this.branches)
      this.model = next
      const delta = previous ? diffModels(previous, next) : null
      if (delta && !this.starting && !this.closed) this.options.onChange(delta)
    } catch (error) {
      // The reader never throws; a throw here is a bug in onChange. Keep watching.
      console.error('[workflow] read failed', error)
    }
  }
}

/** Something that receives `workflow.changed` events: a window's webContents in the app. */
export interface WorkflowSubscriber {
  readonly id: number
  send(delta: WorkflowDelta): void
}

/**
 * One watcher per Project root, shared by every subscriber of that root. The watcher stops when
 * its last subscriber leaves.
 */
export class WorkflowHub {
  private readonly projects = new Map<string, { watcher: Promise<WorkflowWatcher>; subscribers: Map<number, WorkflowSubscriber> }>()

  constructor(private readonly options: Omit<WatchOptions, 'root' | 'onChange'>) {}

  /** Starts watching `root` for `subscriber` (once per subscriber) and returns the current model. */
  async open(root: string, subscriber: WorkflowSubscriber): Promise<WorkflowModel> {
    const key = resolve(root)
    let project = this.projects.get(key)
    if (!project) {
      const subscribers = new Map<number, WorkflowSubscriber>()
      const watcher = WorkflowWatcher.start({
        ...this.options,
        root: key,
        onChange: (delta) => {
          for (const target of subscribers.values()) target.send(delta)
        },
      })
      project = { watcher, subscribers }
      this.projects.set(key, project)
      watcher.catch(() => this.projects.delete(key))
    }
    project.subscribers.set(subscriber.id, subscriber)
    return (await project.watcher).current
  }

  /** Stops `subscriber`'s interest in `root`; returns false when it was not subscribed. */
  async close(root: string, subscriberId: number): Promise<boolean> {
    const key = resolve(root)
    const project = this.projects.get(key)
    if (!project || !project.subscribers.delete(subscriberId)) return false
    if (project.subscribers.size === 0) {
      this.projects.delete(key)
      await (await project.watcher).close()
    }
    return true
  }

  /** Drops a subscriber from every Project, e.g. when its window is gone. */
  async drop(subscriberId: number): Promise<void> {
    await Promise.all([...this.projects.keys()].map((root) => this.close(root, subscriberId)))
  }

  /** The roots being watched; for tests. */
  get roots(): string[] {
    return [...this.projects.keys()]
  }

  async closeAll(): Promise<void> {
    const projects = [...this.projects.values()]
    this.projects.clear()
    await Promise.all(projects.map(async (project) => (await project.watcher).close()))
  }
}
