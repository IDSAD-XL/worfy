// The Project's HANDOFF.md and ADRs (docs/adr/NNNN-*.md), read-only (ADR-0002, ADR-0005).
//
// `root` here is the root of the Project's documents: the Project root in Full mode, its Workflow
// folder in Silent mode (ADR-0042; src/main/ipc/docs.ts picks it). Every read goes through
// resolveDocPath: the path is resolved against that root, symlinks included, and must then be
// HANDOFF.md at the root or an ADR file directly in docs/adr of the same root. `docs.read`
// (src/main/ipc/docs.ts) hands out nothing else.
//
// DocsWatcher follows those files with one recursive fs.watch of the root and reports a new state
// after a short quiet period; DocsHub shares one watcher per Project between the windows that
// opened it. Nothing here writes a file: the watch only listens, the rest only reads.
import { createHash } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { resolve, sep } from 'node:path'
import { ADR_DIR, ADR_FILE_PATTERN, HANDOFF_FILE, type AdrEntry, type DocsState } from '../../shared/ipc/docs'
import { isInside, leadsToRemote, UNCHECKED, walkLinks, type LinkFs, type PathRules } from '../remote-links'

/** A larger file is refused: HANDOFF and ADRs are short text. */
export const DOC_SIZE_MAX = 1024 * 1024

/** What the watcher knows about a Project's documents. */
export type Docs = Omit<DocsState, 'projectId'>

const ADR_PARTS = ADR_DIR.split('/')

/** What is asked of the file system for a document; each of these follows links. */
export interface DocFs {
  realpath: (path: string) => Promise<string>
  /** The names in a folder. */
  readdir: (dir: string) => Promise<string[]>
  stat: (path: string) => Promise<{ isFile: () => boolean; size: number }>
  /** The text of a file. */
  readFile: (path: string) => Promise<string>
}

const nodeFs: DocFs = { realpath: (path) => realpath(path), readdir: (dir) => readdir(dir), stat: (path) => stat(path), readFile: (path) => readFile(path, 'utf8') }

export interface DocOptions {
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: PathRules
  /** lstat and readlink for the links on the way to a document (remote-links.ts); replaced in tests. */
  links?: LinkFs
  /** The calls that follow links; replaced in tests. */
  fs?: DocFs
}

/** True when `rel` (relative, any separator) leaves the folder it is relative to. */
function leaves(rel: string, paths: PathRules): boolean {
  return rel === '..' || rel.startsWith(`..${paths.sep}`) || paths.isAbsolute(rel)
}

/** True for HANDOFF.md at the root and for docs/adr/NNNN-*.md; `parts` are the segments of a relative path. */
function isDocument(parts: readonly string[]): boolean {
  if (parts.length === 1) return parts[0] === HANDOFF_FILE
  return parts.length === ADR_PARTS.length + 1 && ADR_PARTS.every((part, index) => parts[index] === part) && ADR_FILE_PATTERN.test(parts.at(-1)!)
}

/**
 * The real file behind `path` (relative to `root`, or absolute) and its path relative to the real
 * root, when it is HANDOFF.md or an ADR of this Project; throws otherwise. Symlinks are resolved
 * first, so `../`, a link that points out of the Project and a link to some other file of it are
 * all refused.
 *
 * On Windows realpath of a path on a share, or of one that goes through a link to a share, makes
 * the system contact that host and hand it the user's NTLM credentials (worfy-windows tickets 18
 * and 19). So a UNC or device path outside the root is refused by its text, before anything is
 * asked of the file system; and the links on the way to any other path are read before realpath
 * (remote-links.ts): one that leads to such a host is refused as outside the Project, one that
 * cannot be read as a path that could not be checked. A Project that is itself on a share reads its
 * documents there as before.
 */
export async function resolveDocPath(root: string, path: string, options: DocOptions = {}): Promise<{ real: string; rel: string }> {
  const paths = options.paths ?? nativePath
  const fs = options.fs ?? nodeFs
  const lexical = paths.resolve(root, path)
  // path.win32.resolve gives every UNC and device form a leading `\\`.
  if (paths.sep === '\\' && lexical.startsWith('\\\\') && !isInside(paths.resolve(root), lexical, paths)) throw new Error(`${path} is outside the Project`)
  const base = await fs.realpath(root)
  const verdict = await walkLinks(lexical, [root, base], { paths, links: options.links })
  if (verdict === 'remote') throw new Error(`${path} is outside the Project`)
  if (verdict === 'unchecked') throw new Error(`${path} ${UNCHECKED}`)
  const real = await fs.realpath(lexical).catch(() => null)
  if (real === null) {
    if (leaves(paths.relative(root, lexical), paths) && leaves(paths.relative(base, lexical), paths)) throw new Error(`${path} is outside the Project`)
    throw new Error(`${path} does not exist`)
  }
  const rel = paths.relative(base, real)
  if (rel === '' || leaves(rel, paths)) throw new Error(`${path} is outside the Project`)
  const parts = rel.split(paths.sep)
  if (!isDocument(parts)) throw new Error(`${path}: only HANDOFF.md and docs/adr/NNNN-*.md of the Project are read`)
  return { real, rel: parts.join('/') }
}

/** The text of HANDOFF.md or an ADR; `path` in the answer is the real file relative to the root. */
export async function readDoc(root: string, path: string, options: DocOptions = {}): Promise<{ path: string; text: string }> {
  const fs = options.fs ?? nodeFs
  const { real, rel } = await resolveDocPath(root, path, options)
  const info = await fs.stat(real)
  if (!info.isFile()) throw new Error(`${path} is not a file`)
  if (info.size > DOC_SIZE_MAX) throw new Error(`${path} is larger than ${DOC_SIZE_MAX} bytes`)
  return { path: rel, text: await fs.readFile(real) }
}

/** Changes with the content; the renderer reads the text again when it does. */
export function versionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** How many lines from the top `Статус:` is looked for (it is the second line in this repository's ADRs). */
const STATUS_LINES = 20

/** Number, title (first `# ` heading) and status (`Статус: …` or `Status: …`) of an ADR file. */
export function parseAdr(fileName: string, text: string): Omit<AdrEntry, 'path' | 'version'> {
  const number = ADR_FILE_PATTERN.exec(fileName)?.[1]
  if (number === undefined) throw new Error(`${fileName} is not an ADR file name`)
  const title = /^#[ \t]+(.+?)[ \t#]*$/m.exec(text)?.[1]?.trim()
  const head = text.split('\n', STATUS_LINES).join('\n')
  const status = /(?:Статус|Status)[ \t]*:[ \t]*(.+?)\.?[ \t]*$/im.exec(head)?.[1]?.trim()
  return { number, title: title || fileName, status: status || null }
}

/**
 * HANDOFF.md and the ADRs of the Project at `root`, as they are now. Files that cannot be read are
 * left out, and so is all that lies behind a link to a share (resolveDocPath): the folder of the
 * ADRs is not listed when the way to it leads there.
 */
export async function readDocs(root: string, options: DocOptions = {}): Promise<Docs> {
  const paths = options.paths ?? nativePath
  const fs = options.fs ?? nodeFs
  const handoffText = await readDoc(root, HANDOFF_FILE, options).then(
    (doc) => doc.text,
    () => null,
  )
  const adrDir = paths.join(root, ...ADR_PARTS)
  const base = await fs.realpath(root).catch(() => null)
  // A root that cannot be resolved has no documents: nothing more is asked about it.
  const away = base === null || (await leadsToRemote(adrDir, [root, base], { paths, links: options.links }))
  const names = away ? [] : await fs.readdir(adrDir).catch(() => [] as string[])
  const adrs = await Promise.all(
    names
      .filter((name) => ADR_FILE_PATTERN.test(name))
      .map(async (name): Promise<AdrEntry | null> => {
        const path = `${ADR_DIR}/${name}`
        try {
          const { text } = await readDoc(root, path, options)
          return { path, ...parseAdr(name, text), version: versionOf(text) }
        } catch {
          return null
        }
      }),
  )
  return {
    handoff: handoffText === null ? null : { path: HANDOFF_FILE, version: versionOf(handoffText) },
    adrs: adrs.filter((adr): adr is AdrEntry => adr !== null).sort((a, b) => a.number.localeCompare(b.number) || a.path.localeCompare(b.path)),
  }
}

/** True for a path (relative to the root) whose change may change HANDOFF.md or the ADR list. */
function isWatchedPath(filename: string): boolean {
  const parts = filename.split(sep)
  if (parts[0] === HANDOFF_FILE) return parts.length === 1
  // docs/ and docs/adr/ themselves (created, removed, renamed) and the files directly in docs/adr/.
  return parts.length <= ADR_PARTS.length + 1 && parts.every((part, index) => index >= ADR_PARTS.length || part === ADR_PARTS[index])
}

/** When the reads after the start run, in ms (see DocsWatcher.watch). */
export const SETTLE_READS_MS: readonly number[] = [100, 400, 1000]

const sameDocs = (a: Docs, b: Docs): boolean => JSON.stringify(a) === JSON.stringify(b)

export interface DocsWatchOptions {
  root: string
  /** Quiet period after the last file event before a read (default 50 ms). */
  debounceMs?: number
  /** Called with the new state after every read that changed something. */
  onChange: (docs: Docs) => void
}

/** Watches one Project's documents. Create with `DocsWatcher.start`, stop with `close`. */
export class DocsWatcher {
  private docs: Docs | null = null
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly settle: ReturnType<typeof setTimeout>[] = []
  private running: Promise<void> | null = null
  private pending = false
  private closed = false

  private constructor(private readonly options: DocsWatchOptions) {}

  /** Starts watching, then reads; resolves once the first read is done. No `onChange` before that. */
  static async start(options: DocsWatchOptions): Promise<DocsWatcher> {
    const watcher = new DocsWatcher({ ...options, root: resolve(options.root) })
    try {
      watcher.watch()
      watcher.docs = await readDocs(watcher.options.root)
    } catch (error) {
      await watcher.close()
      throw error
    }
    return watcher
  }

  get current(): Docs {
    if (!this.docs) throw new Error('docs: the watcher has not read the Project yet')
    return this.docs
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const timer of this.settle) clearTimeout(timer)
    this.watcher?.close()
    if (this.running) await this.running
  }

  private watch(): void {
    const { root } = this.options
    // One recursive watch of the root (FSEvents on macOS): events for any other path of the
    // repository (node_modules, .git, out/) are dropped by name here, before any read.
    const watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (filename === null || isWatchedPath(filename)) this.schedule()
    })
    watcher.on('error', (error) => console.error('[docs] watcher error', error))
    this.watcher = watcher
    // The event stream starts a moment after watch() returns, and a change in that moment is not
    // reported. A few reads after the start pick such a change up; each one sends nothing unless
    // something changed.
    for (const delay of SETTLE_READS_MS) this.settle.push(setTimeout(() => this.request(), delay))
  }

  private schedule(): void {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.request()
    }, this.options.debounceMs ?? 50)
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
      try {
        const next = await readDocs(this.options.root)
        if (this.closed) return
        if (this.docs === null || sameDocs(this.docs, next)) continue
        this.docs = next
        this.options.onChange(next)
      } catch (error) {
        // readDocs leaves unreadable files out instead of throwing; a throw is a bug in onChange.
        console.error('[docs] read failed', error)
      }
    } while (this.pending && !this.closed)
  }
}

/** Something that receives the state of a Project's documents: a window's webContents in the app. */
export interface DocsSubscriber {
  readonly id: number | string
  send(state: DocsState): void
}

export interface DocsHubOptions {
  debounceMs?: number
  /** Called with every state of every open Project, the first one included (the HANDOFF Node follows it). */
  onState?: (state: DocsState) => void
}

interface OpenProject {
  watcher: Promise<DocsWatcher>
  subscribers: Map<number | string, DocsSubscriber>
}

/** One watcher per Project, shared by its subscribers; it stops when the last one leaves. */
export class DocsHub {
  private readonly open_ = new Map<string, OpenProject>()

  constructor(private readonly options: DocsHubOptions = {}) {}

  private notify(state: DocsState): void {
    try {
      this.options.onState?.(state)
    } catch (error) {
      console.error(`[docs] could not follow the documents of ${state.projectId}`, error)
    }
  }

  /** Starts watching the Project at `root` for `subscriber` (once per subscriber) and returns its state. */
  async open(projectId: string, root: string, subscriber: DocsSubscriber): Promise<DocsState> {
    let project = this.open_.get(projectId)
    if (!project) {
      const subscribers = new Map<number | string, DocsSubscriber>()
      const watcher = DocsWatcher.start({
        root,
        ...(this.options.debounceMs === undefined ? {} : { debounceMs: this.options.debounceMs }),
        onChange: (docs) => {
          const state = { projectId, ...docs }
          this.notify(state)
          for (const target of subscribers.values()) target.send(state)
        },
      })
      project = { watcher, subscribers }
      this.open_.set(projectId, project)
      watcher.then(
        (started) => this.notify({ projectId, ...started.current }),
        () => {
          if (this.open_.get(projectId)?.watcher === watcher) this.open_.delete(projectId)
        },
      )
    }
    project.subscribers.set(subscriber.id, subscriber)
    return { projectId, ...(await project.watcher).current }
  }

  /** Ends `subscriberId`'s interest in the Project; false when it was not subscribed. */
  async close(projectId: string, subscriberId: number | string): Promise<boolean> {
    const project = this.open_.get(projectId)
    if (!project || !project.subscribers.delete(subscriberId)) return false
    if (project.subscribers.size === 0) {
      this.open_.delete(projectId)
      await (await project.watcher.catch(() => null))?.close()
    }
    return true
  }

  /** Drops a subscriber from every Project, e.g. when its window is gone. */
  async drop(subscriberId: number | string): Promise<void> {
    await Promise.all([...this.open_.keys()].map((projectId) => this.close(projectId, subscriberId)))
  }

  /** The Projects being watched; for tests. */
  get projects(): string[] {
    return [...this.open_.keys()]
  }

  async closeAll(): Promise<void> {
    const projects = [...this.open_.values()]
    this.open_.clear()
    await Promise.all(projects.map(async (project) => (await project.watcher.catch(() => null))?.close()))
  }
}
