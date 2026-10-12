// Keeps the workflow model of a Project current and reports only what changed.
//
// Two kinds of change are watched (chokidar), both read-only:
// - the Tickets root (src/main/workflow/folder.ts: `.scratch/**` of the checkout in Full mode, the
//   Workflow folder's in Silent mode): Tickets, specs. After a 300 ms quiet period one full
//   `epic-status --json` runs; the result is compared with the previous snapshot. A steady stream
//   of events (an agent rewriting Tickets) does not postpone the read for good: it starts at the
//   latest 1 s after the first event of the series (max-wait).
// - in Full mode, the git refs of Ticket branches (`refs/heads/**`, `packed-refs`) and the worktree
//   list (`worktrees/<name>/HEAD`): only branches whose head moved are read again. In Silent mode
//   the status lives in the Workflow folder only (ADR-0042), so refs are not watched.
// Where the workflow lives is read once, when the watch starts.
// Reads never overlap: a change during a read leads to exactly one more read after it.
//
// On Windows the Tickets root is not watched by chokidar (worfy-windows ticket 20): chokidar calls
// realpath and stat on every link in a folder it watches, and a link to a share in a checked-out
// repository would make the system contact that host when the Project is opened. There
// link-safe-watch.ts watches it, and reads each link before anything follows it.
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { diffModels, type WorkflowDelta, type WorkflowModel } from '../../shared/workflow/types'
import { LinkSafeWatch, type WatchFs } from '../link-safe-watch'
import type { LinkFs, PathRules } from '../remote-links'
import { readProjectLayout, type ProjectLayout } from './folder'
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
  /** Where the workflow lives; read from the Harness (src/main/workflow/folder.ts) by default. */
  layout?: (root: string) => Promise<ProjectLayout>
  /**
   * How the Tickets root is watched: 'links-read-first' (link-safe-watch.ts) on Windows, 'chokidar'
   * elsewhere. Tests name one to run it on any system.
   */
  ticketsWatch?: 'links-read-first' | 'chokidar'
}

/**
 * What the watch of a Tickets root skips: everything `epic-status` does not read. It reads the Epic
 * folders right under the root, their `spec.md` and `map.md`, and `issues/*.md`. The rest of a
 * Tickets root can be anything — evidence, logs, a Python `.venv`, `node_modules` or links to one —
 * and chokidar holds one open file per file it watches: an Arbor `.scratch` with links to
 * `node_modules` reached 30 000 of them, and worfy hung at start on EMFILE.
 *
 * This function alone bounds the walk; the watch has no `depth` option. When the Tickets root does
 * not exist at the start (a new Project before its first Epic), chokidar watches the parent folder
 * and counts `depth` from there, so a limit that fits an existing root would cut off `issues` of a
 * root made later. For the same reason a path outside the root is never skipped: chokidar asks about
 * the parent folder too. Outside means `..` or `../…`; a folder inside the root named `..x` is an
 * Epic like any other.
 *
 * `spec.md`, `map.md` and `issues` are compared without regard to case: on a disk that ignores case
 * (the default on macOS and Windows) `epic-status` finds `Issues/` or `Spec.md` as well. On a disk
 * that keeps case apart this watches a few files more than needed; a save of one costs a read that
 * changes nothing. The `.md` ending of a Ticket is compared as written, as the glob of `epic-status`
 * compares it: it does not read `01-a.MD` on any disk.
 *
 * Right under the root only a folder is an Epic. A name alone does not say what a path is, so a
 * file there is skipped when the caller says it is one: chokidar asks about each path twice, the
 * second time with its stats. Without them the path is kept, as a folder would be.
 */
export function ticketsIgnored(
  ticketsRoot: string,
  paths: Pick<PathRules, 'relative' | 'isAbsolute' | 'sep'> = nativePath,
): (path: string, stats?: { isFile: () => boolean }) => boolean {
  return (path, stats) => {
    const rel = paths.relative(ticketsRoot, path)
    if (rel === '' || rel === '..' || rel.startsWith(`..${paths.sep}`) || paths.isAbsolute(rel)) return false
    const [, inEpic, inIssues, ...deeper] = rel.split(paths.sep)
    if (inEpic === undefined) return typeof stats?.isFile === 'function' && stats.isFile()
    const name = inEpic.toLowerCase()
    if (inIssues === undefined) return name !== 'spec.md' && name !== 'map.md' && name !== 'issues'
    return name !== 'issues' || !inIssues.endsWith('.md') || deeper.length > 0
  }
}

export interface TicketsWatchOptions {
  ticketsRoot: string
  /** The folders the paths may lead into though they lie on a share: the Project root, as written and as a real path. */
  allowed: readonly string[]
  onChange: () => void
  onError: (error: unknown) => void
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: PathRules
  links?: LinkFs
  fs?: WatchFs
  scanDelayMs?: number
}

/**
 * The watch of a Tickets root that reads every link before anything follows it (link-safe-watch.ts).
 * It cares about what `ticketsIgnored` does not skip: links are looked for in the root, in the
 * Epic folders and in their `issues`, and a change is reported for the same paths.
 */
export function ticketsWatch(options: TicketsWatchOptions): LinkSafeWatch {
  const paths = options.paths ?? nativePath
  const ignored = ticketsIgnored(options.ticketsRoot, paths)
  const cares = (path: string): boolean => !ignored(path)
  return new LinkSafeWatch({
    root: options.ticketsRoot,
    allowed: [...options.allowed, options.ticketsRoot],
    paths,
    links: options.links,
    fs: options.fs,
    enter: cares,
    wanted: cares,
    onChange: () => options.onChange(),
    onError: options.onError,
    scanDelayMs: options.scanDelayMs,
  })
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
  /** The watch of the Tickets root when it is not chokidar's. */
  private tickets: LinkSafeWatch | null = null
  private readonly debounce: Debounce
  private layout: ProjectLayout | null = null
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
      watcher.layout = await (options.layout ?? ((at: string) => readProjectLayout({ root: at, claudeHome: options.claudeHome })))(root)
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
    this.tickets?.close()
    await Promise.all(this.watchers.map((w) => w.close()))
    if (this.running) await this.running
  }

  private async watch(): Promise<void> {
    const { root } = this.options
    const layout = this.layout!
    // `ready` is awaited through a promise made right away: it may fire while git answers below.
    const ready: Promise<void>[] = []
    const add = (watcher: FSWatcher, what: 'checkout' | 'branches') => {
      ready.push(new Promise<void>((done) => watcher.once('ready', () => done())))
      watcher.on('all', () => this.schedule(what))
      // Without a listener chokidar's 'error' event throws, and every failed watch became an
      // unhandled rejection.
      watcher.on('error', (error) => console.error(`[workflow] ${what} watch error`, error))
      this.watchers.push(watcher)
    }
    if ((this.options.ticketsWatch ?? (sep === '\\' ? 'links-read-first' : 'chokidar')) === 'links-read-first') {
      // The Project root is the user's own folder, also when it is a link to a share of theirs.
      const real = await realpath(root).catch(() => null)
      const tickets = ticketsWatch({
        ticketsRoot: layout.ticketsRoot,
        allowed: real === null ? [root] : [root, real],
        onChange: () => this.schedule('checkout'),
        onError: (error) => console.error('[workflow] checkout watch error', error),
      })
      this.tickets = tickets
      ready.push(
        tickets.start().then((state) => {
          if (state === 'refused') console.error(`[workflow] the Tickets root ${layout.ticketsRoot} leads off this machine, or cannot be checked: it is not watched`)
        }),
      )
    } else {
      // No `depth`: see `ticketsIgnored`.
      add(watch(layout.ticketsRoot, { ignoreInitial: true, ignored: ticketsIgnored(layout.ticketsRoot) }), 'checkout')
    }

    const common = layout.mode === 'silent' ? null : await gitCommonDir(root)
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
    const layout = this.layout!
    const checkoutChanged = this.dirtyCheckout || !this.checkout
    const branchesChanged = this.dirtyBranches
    this.dirtyCheckout = false
    this.dirtyBranches = false

    try {
      let checkout = this.checkout
      if (checkoutChanged || !checkout) checkout = this.checkout = await readCheckout(root, run, layout.ticketsRoot)
      if (checkout.error || layout.mode === 'silent') this.branches = new Map()
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

/**
 * Something that receives `workflow.changed` events: a client of the app (src/main/clients.ts) or
 * Autopilot's own subscriber. The id rule there keeps their ids apart.
 */
export interface WorkflowSubscriber {
  readonly id: number | string
  send(delta: WorkflowDelta): void
}

/**
 * One watcher per Project root, shared by every subscriber of that root. The watcher stops when
 * its last subscriber leaves.
 */
export class WorkflowHub {
  private readonly projects = new Map<string, { watcher: Promise<WorkflowWatcher>; subscribers: Map<number | string, WorkflowSubscriber> }>()

  constructor(private readonly options: Omit<WatchOptions, 'root' | 'onChange'>) {}

  /** Starts watching `root` for `subscriber` (once per subscriber) and returns the current model. */
  async open(root: string, subscriber: WorkflowSubscriber): Promise<WorkflowModel> {
    const key = resolve(root)
    let project = this.projects.get(key)
    if (!project) {
      const subscribers = new Map<number | string, WorkflowSubscriber>()
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

  /**
   * The current model of `root` when it is being watched (src/main/ipc/checks.ts asks which branches
   * the model names); null when it is not, or its first read failed. Starts nothing.
   */
  async model(root: string): Promise<WorkflowModel | null> {
    const project = this.projects.get(resolve(root))
    if (!project) return null
    return project.watcher.then(
      (watcher) => watcher.current,
      () => null,
    )
  }

  /** Stops `subscriber`'s interest in `root`; returns false when it was not subscribed. */
  async close(root: string, subscriberId: number | string): Promise<boolean> {
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
  async drop(subscriberId: number | string): Promise<void> {
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
