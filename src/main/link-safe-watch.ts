// A watch of a folder that never calls through a link it has not read (worfy-windows ticket 20).
//
// Why. On Windows a call through a symlink to `\\host\share\…` — realpath, stat, readdir, a watch —
// makes the system contact that host over SMB with the user's credentials (remote-links.ts).
// chokidar calls realpath and stat on every link it meets in a folder it watches, before any
// `ignored` filter and with `followSymlinks` off too. So on Windows the Tickets root and the Cards
// folder are watched by this module instead. Elsewhere chokidar stays as it was.
//
// How. One recursive fs.watch on the folder: Windows reports a change anywhere below it from one
// handle, and does not go through a link to do so — measured on the owner's PC with a link to an
// unreachable host in the folder: the watch starts in under 5 ms and reports as usual. A change
// behind a link is not reported by that handle, whatever the link leads to. To keep what chokidar
// gave — a local link is followed — the folders named by `enter` are listed (never through a link),
// and every link in them is read with walkLinks first: one that leads off the machine, or cannot
// be checked, is left alone; one that stays on the machine gets a watch of its own, on the real
// path of what it leads to.
//
// A folder that is not there yet is waited for at the nearest folder above it that is. A watched
// folder that is removed is waited for again: Windows then sends an endless run of events that
// name the folder itself by its `\\?\` path, so the handle is closed at the first of them.
//
// A look at the root that fails is not the end: the root is looked at again every RETRY_DELAY_MS
// until it is watched or properly waited for, and every SLOW_RETRY_DELAY_MS once RETRY_SLOW_AFTER
// looks in a row have failed. That covers a root that is a link to a folder of this machine which
// is not there (there is no folder above to wait at: the link is in place; the log says so once),
// a root that goes between two calls, and a watch the system refuses. Whenever the root is watched
// again after the start it is reported: anything may have changed while nothing was watched. So is
// a root that was not there at the first look and is watched by the time start() answers.
//
// An error of the watch of the root is said and the root is looked at again at once, up to
// ROOT_ERRORS_BEFORE_PAUSE times in a row with no event in between; after that the watch is made
// again with the pauses of a failed look, and nothing more is said until it reports an event
// (worfy-windows ticket 33: an error that comes after every new watch filled the log).
//
// Links below the root are read with the real path of the root among the allowed folders: under a
// root on a mapped network drive realpath answers the share's UNC path, and the walk would take
// every link there for one that leads off the machine.
//
// What it cannot see: a link put in place between the walk and the watch (the same gap as in
// remote-links.ts); and a link deeper than the folders `enter` names.
import { watch as watchNode } from 'node:fs'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { UNCHECKED, walkLinks, type LinkFs, type PathRules } from './remote-links'

/** What a path is, by lstat: a link is a link whatever it leads to. */
export type EntryKind = 'folder' | 'file' | 'link'

/** One watch of the system; `close` ends it. */
export interface WatchHandle {
  close: () => void
}

/**
 * What the watch asks of the file system. `kind` and `list` never follow a link. `realpath`,
 * `isFolder` and `watch` do: they are called only on a path walkLinks has answered 'local' for,
 * or on a real path.
 */
export interface WatchFs {
  /** What is at the path; null when nothing is. */
  kind: (path: string) => Promise<EntryKind | null>
  /** The entries of a folder. */
  list: (path: string) => Promise<{ name: string; kind: EntryKind }[]>
  realpath: (path: string) => Promise<string>
  isFolder: (path: string) => Promise<boolean>
  /**
   * Watches a folder (with everything below it when `recursive`) or a file. `onEvent` gets the
   * name the system reports, relative to the path, or null when it reports none.
   */
  watch: (path: string, recursive: boolean, onEvent: (name: string | null) => void, onError: (error: unknown) => void) => WatchHandle
}

const kindOf = (entry: { isSymbolicLink: () => boolean; isDirectory: () => boolean }): EntryKind => (entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'folder' : 'file')

export const nodeWatchFs: WatchFs = {
  kind: (path) =>
    lstat(path).then(kindOf, (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null
      throw error
    }),
  list: async (path) => (await readdir(path, { withFileTypes: true })).map((entry) => ({ name: entry.name, kind: kindOf(entry) })),
  realpath: (path) => realpath(path),
  isFolder: (path) =>
    stat(path).then(
      (stats) => stats.isDirectory(),
      () => false,
    ),
  watch: (path, recursive, onEvent, onError) => {
    const watcher = watchNode(path, { recursive }, (_event, name) => onEvent(name === null ? null : String(name)))
    watcher.on('error', onError)
    return { close: () => watcher.close() }
  },
}

export interface LinkSafeWatchOptions {
  /** The folder to watch; it need not be there yet. */
  root: string
  /** The folders a path may lead into though they lie on a share (walkLinks). */
  allowed: readonly string[]
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths: PathRules
  /** lstat and readlink of the walk; replaced in tests. */
  links?: LinkFs
  fs?: WatchFs
  /** Whether links are looked for in this folder, named by its path under the root. The root always is. */
  enter: (path: string) => boolean
  /** Whether a change of this path, named under the root, is reported. */
  wanted: (path: string) => boolean
  /**
   * A change of a path under the root. The root itself: when it went, when it is watched again
   * after the start (it came, or its watch was made anew), and when the system reports a change
   * without a name — each time anything below it may have changed unseen.
   */
  onChange: (path: string) => void
  /**
   * A failure to watch; the watch goes on with what it has. A root that stops being watched after
   * the start — it now leads off the machine, or cannot be looked at — is said here once.
   */
  onError: (error: unknown) => void
  /** The quiet time before the links are looked for again after a change (default 100 ms). */
  scanDelayMs?: number
  /** The time until a root that could not be watched is looked at again (default 2 s). */
  retryDelayMs?: number
  /** The same time once RETRY_SLOW_AFTER looks in a row have failed (default 30 s). */
  slowRetryDelayMs?: number
}

/** What the watch does about its root. */
export type WatchState = 'watching' | 'waiting' | 'refused' | 'closed'

/** The quiet time before the links are looked for again after a change. */
export const SCAN_DELAY_MS = 100

/** The time until a root that could not be watched is looked at again. */
export const RETRY_DELAY_MS = 2000

/** The time until the root is looked at again once RETRY_SLOW_AFTER looks in a row have failed. */
export const SLOW_RETRY_DELAY_MS = 30_000

/** How many looks in a row may fail before the time between two looks grows. */
export const RETRY_SLOW_AFTER = 5

/** How many errors of the root watch in a row, with no event in between, make it again at once. */
export const ROOT_ERRORS_BEFORE_PAUSE = 3

/** How deep below the root links are looked for at most, whatever `enter` says: a loop of links ends there. */
export const MAX_SCAN_DEPTH = 8

interface LinkWatch {
  target: string
  handle: WatchHandle
}

/** What one look for links has found so far, and whether it still has a watch to work for. */
interface Found {
  seen: Set<string>
  left: Set<string>
  visited: Set<string>
  stale: () => boolean
}

/** Whether a failed call says that nothing is at the path. */
const notThere = (error: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException | null)?.code ?? '')

export class LinkSafeWatch {
  private readonly fs: WatchFs
  private readonly paths: PathRules
  private current: WatchState = 'waiting'
  private rootWatch: WatchHandle | null = null
  /** The root by a path with no link in it; what the system watches. */
  private rootReal = ''
  private waitWatch: WatchHandle | null = null
  private waitingAt = ''
  private readonly linkWatches = new Map<string, LinkWatch>()
  private readonly leftAlone = new Set<string>()
  private queue: Promise<void> = Promise.resolve()
  private scanTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  /** Whether start() has given its answer: what a look finds from then on comes "after the start". */
  private started = false
  /** Whether the failure of the looks that are being repeated has been said. */
  private said = false
  /** The looks in a row that failed: past RETRY_SLOW_AFTER the next one waits longer. */
  private failures = 0
  /** The errors of the root watch in a row with no event of it in between. */
  private rootErrors = 0
  /** Whether the first look found no root: start() then reports it when it answers 'watching'. */
  private absentAtStart = false
  private closed = false

  constructor(private readonly options: LinkSafeWatchOptions) {
    this.fs = options.fs ?? nodeWatchFs
    this.paths = options.paths
  }

  /** Starts the watch; resolves once the root is watched with its links, waited for, or refused. */
  async start(): Promise<WatchState> {
    await this.enqueue(() => this.attach())
    this.started = true
    // The root came during the start — the wait found it by its second look — and its watch
    // began after what was written there: no event names it, and the caller may have read the
    // root before it came.
    if (this.absentAtStart && this.current === 'watching') this.options.onChange(this.options.root)
    return this.current
  }

  get state(): WatchState {
    return this.current
  }

  /** The paths under watch now, as given to the system; for tests. */
  watched(): { root: string | null; waitingAt: string | null; links: Record<string, string> } {
    return {
      root: this.rootWatch === null ? null : this.rootReal,
      waitingAt: this.waitWatch === null ? null : this.waitingAt,
      links: Object.fromEntries([...this.linkWatches].map(([path, link]) => [path, link.target])),
    }
  }

  /** The links that were found and left alone: they lead off the machine, or could not be checked. */
  skipped(): string[] {
    return [...this.leftAlone].sort()
  }

  /** Resolves once nothing is being attached or scanned, and no scan is scheduled; for tests. */
  async settled(): Promise<void> {
    for (;;) {
      const queue = this.queue
      await queue
      if (this.scanTimer !== null) await new Promise((done) => setTimeout(done, this.options.scanDelayMs ?? SCAN_DELAY_MS))
      else if (queue === this.queue) return
    }
  }

  close(): void {
    this.closed = true
    this.current = 'closed'
    if (this.scanTimer !== null) clearTimeout(this.scanTimer)
    this.scanTimer = null
    this.endRetry()
    this.detach()
    this.endWait()
  }

  /** Jobs run one after another: an event never meets a half-made state. */
  private enqueue(job: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.closed) return
      try {
        await job()
      } catch (error) {
        this.options.onError(error)
      }
    })
    return this.queue
  }

  private detach(): void {
    this.rootWatch?.close()
    this.rootWatch = null
    for (const link of this.linkWatches.values()) link.handle.close()
    this.linkWatches.clear()
  }

  private endWait(): void {
    this.waitWatch?.close()
    this.waitWatch = null
  }

  private endRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  /**
   * Looks at the root and watches it, waits for it, or refuses it. A look that fails leaves no
   * watch behind and is repeated in a while: the failure is said once, and not at all when it only
   * says that the root is not there.
   */
  private async attach(): Promise<void> {
    // A refusal is for good. A look that was already queued when it came — the system sends more
    // than one event for a new entry — neither says it once more nor undoes it.
    if (this.current === 'refused') return
    this.detach()
    this.endWait()
    this.endRetry()
    try {
      await this.look()
    } catch (error) {
      if (this.closed) return
      this.detach()
      this.current = 'waiting'
      if (!this.said && !notThere(error)) {
        this.said = true
        this.options.onError(error)
      }
      this.failures++
      this.retryLater(this.failures)
    }
  }

  /** Looks at the root again after a pause: the long one once `inARow` reaches RETRY_SLOW_AFTER. */
  private retryLater(inARow: number): void {
    this.endRetry()
    const delay = inARow < RETRY_SLOW_AFTER ? (this.options.retryDelayMs ?? RETRY_DELAY_MS) : (this.options.slowRetryDelayMs ?? SLOW_RETRY_DELAY_MS)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.enqueue(() => this.attach())
    }, delay)
  }

  private async look(): Promise<void> {
    const { root, allowed } = this.options
    const verdict = await walkLinks(root, allowed, { paths: this.paths, links: this.options.links })
    if (this.closed) return
    // At the start a root that cannot be checked is refused like one that leads off the machine.
    // Later it is looked at again: a folder that is being removed may not let itself be looked at
    // for a moment, and the walk asks nothing through a link.
    if (verdict === 'unchecked' && this.started) throw new Error(`${root} ${UNCHECKED}`)
    if (verdict !== 'local') {
      // Nothing is asked of the file system about such a root, and no event will say it changed.
      this.current = 'refused'
      if (this.started) this.options.onError(new Error(`${root} now leads off this machine: it is no longer watched`))
      return
    }
    const kind = await this.fs.kind(root)
    if (kind === null) {
      if (!this.started) this.absentAtStart = true
      await this.waitFor(root)
      return
    }
    const real = await this.fs.realpath(root).catch((error: unknown) => {
      // A root that is a link to a folder that is not there is no root that is not there: there is
      // no folder above to wait at, and nothing will say when it comes. The log says it once.
      if (kind === 'link' && notThere(error)) throw new Error(`${root} is a link that leads nowhere: it is looked at again until it leads to a folder`)
      throw error
    })
    if (this.closed) return
    this.rootReal = real
    const mine: { handle: WatchHandle | null } = { handle: null }
    mine.handle = this.fs.watch(
      real,
      true,
      (name) => {
        if (this.rootWatch !== mine.handle) return
        // The watch works: a later error of it is said again.
        this.rootErrors = 0
        if (name !== null && this.paths.isAbsolute(name)) return this.lost()
        this.report(name === null ? root : this.paths.join(root, name))
      },
      (error) => {
        if (this.rootWatch !== mine.handle) return
        this.rootErrors++
        if (this.rootErrors <= ROOT_ERRORS_BEFORE_PAUSE) {
          this.options.onError(error)
          return this.lost()
        }
        // An error that comes after every new watch: the watch is made again after a pause, and
        // the log has said enough.
        if (this.rootErrors === ROOT_ERRORS_BEFORE_PAUSE + 1) this.options.onError(new Error(`the watch of ${root} fails each time it is made: it is made again after a pause, and not said again until it works`))
        this.detach()
        this.current = 'waiting'
        this.options.onChange(root)
        this.retryLater(this.rootErrors - ROOT_ERRORS_BEFORE_PAUSE)
      },
    )
    this.rootWatch = mine.handle
    this.current = 'watching'
    await this.scan()
    if (this.rootWatch !== mine.handle) return
    if (this.started) this.options.onChange(root)
    // The look has succeeded to its end: a failure after this is a new one, and is said.
    this.said = false
    this.failures = 0
  }

  /** The root is gone, or its watch failed: it is waited for again, and said to have changed. */
  private lost(): void {
    this.detach()
    this.current = 'waiting'
    this.options.onChange(this.options.root)
    void this.enqueue(() => this.attach())
  }

  /** Watches the nearest folder above `root` that is there for the next name on the way to it. */
  private async waitFor(root: string): Promise<void> {
    const missing: string[] = []
    let at = root
    for (;;) {
      const parent = this.paths.dirname(at)
      if (parent === at) throw new Error(`nothing above ${root} is there to watch`)
      missing.unshift(this.paths.relative(parent, at))
      at = parent
      if ((await this.fs.kind(at)) !== null) break
    }
    if (this.closed) return
    const next = missing[0]!.toLowerCase()
    const mine: { handle: WatchHandle | null } = { handle: null }
    const again = (): void => {
      if (this.waitWatch !== mine.handle) return
      void this.enqueue(() => this.attach())
    }
    mine.handle = this.fs.watch(
      at,
      false,
      (name) => {
        // Only the next name on the way matters: a repository root changes all the time.
        if (name === null || this.paths.isAbsolute(name) || name.split(this.paths.sep)[0]!.toLowerCase() === next) again()
      },
      again,
    )
    this.waitWatch = mine.handle
    this.waitingAt = at
    this.current = 'waiting'
    // The folder may have come between the look and the watch.
    // (After a close the look that follows ends at its first step.)
    if ((await this.fs.kind(this.paths.join(at, missing[0]!))) !== null) return this.attach()
    // A proper wait: nothing is failing any more.
    this.said = false
    this.failures = 0
    this.rootErrors = 0
  }

  /** Called only by a watch that is still the current one: after close there is none. */
  private report(path: string): void {
    const { root } = this.options
    const interesting = path === root || this.options.wanted(path)
    if (interesting) this.options.onChange(path)
    // A link may have come or gone where links are looked for.
    if (interesting || this.entered(this.paths.dirname(path))) this.scheduleScan()
  }

  private entered(path: string): boolean {
    return path === this.options.root || this.options.enter(path)
  }

  private scheduleScan(): void {
    if (this.closed || this.scanTimer !== null) return
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null
      void this.enqueue(() => this.scan())
    }, this.options.scanDelayMs ?? SCAN_DELAY_MS)
  }

  /** Lists the folders where links are looked for, and watches what each local link leads to. */
  private async scan(): Promise<void> {
    const mine = this.rootWatch
    if (mine === null) return
    // The watch was closed, or the root was lost, while a call of the look was awaited — either
    // way the root watch is no longer this one. What the look finds after that belongs to nobody,
    // and no watch may be made for it.
    const stale = (): boolean => this.rootWatch !== mine
    const seen = new Set<string>()
    const left = new Set<string>()
    await this.walk(this.options.root, this.rootReal, 0, { seen, left, visited: new Set([this.rootReal]), stale })
    if (stale()) return
    for (const [path, link] of [...this.linkWatches]) {
      if (seen.has(path)) continue
      link.handle.close()
      this.linkWatches.delete(path)
    }
    this.leftAlone.clear()
    for (const path of left) this.leftAlone.add(path)
  }

  /**
   * `shown` is the folder by its path under the root, `real` the same folder by a path with no
   * link in it: only `real` is given to the file system.
   */
  private async walk(shown: string, real: string, depth: number, found: Found): Promise<void> {
    let entries: { name: string; kind: EntryKind }[]
    try {
      entries = await this.fs.list(real)
    } catch {
      // Gone meanwhile, or not readable: nothing to look for in it.
      return
    }
    for (const entry of entries) {
      if (found.stale()) return
      const path = this.paths.join(shown, entry.name)
      const below = depth + 1 < MAX_SCAN_DEPTH && this.entered(path)
      if (entry.kind === 'folder') {
        if (below) await this.walk(path, this.paths.join(real, entry.name), depth + 1, found)
        continue
      }
      if (entry.kind !== 'link' || !(below || this.options.wanted(path))) continue
      const link = this.paths.join(real, entry.name)
      // `real` starts with the real path of the root, which may be the UNC path of a mapped drive.
      if ((await walkLinks(link, [...this.options.allowed, this.rootReal], { paths: this.paths, links: this.options.links })) !== 'local') {
        found.left.add(path)
        continue
      }
      let target: string
      let folder: boolean
      try {
        target = await this.fs.realpath(link)
        folder = await this.fs.isFolder(target)
      } catch {
        // It leads nowhere now.
        continue
      }
      // Three calls were awaited since the last look at it.
      if (found.stale()) return
      found.seen.add(path)
      this.watchLink(path, target, folder)
      if (folder && below && !found.visited.has(target)) {
        found.visited.add(target)
        await this.walk(path, target, depth + 1, found)
      }
    }
  }

  private watchLink(path: string, target: string, folder: boolean): void {
    const had = this.linkWatches.get(path)
    if (had?.target === target) return
    had?.handle.close()
    this.linkWatches.delete(path)
    const mine: { handle: WatchHandle | null } = { handle: null }
    const gone = (): void => {
      if (this.linkWatches.get(path)?.handle !== mine.handle) return
      mine.handle?.close()
      this.linkWatches.delete(path)
      this.report(path)
    }
    try {
      mine.handle = this.fs.watch(
        target,
        folder,
        (name) => {
          if (this.linkWatches.get(path)?.handle !== mine.handle) return
          if (name !== null && this.paths.isAbsolute(name)) return gone()
          this.report(folder && name !== null ? this.paths.join(path, name) : path)
        },
        (error) => {
          this.options.onError(error)
          gone()
        },
      )
    } catch (error) {
      this.options.onError(error)
      return
    }
    this.linkWatches.set(path, { target, handle: mine.handle })
  }
}
