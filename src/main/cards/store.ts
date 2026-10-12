// The Cards of each Project (CONTEXT.md, «Карточка»): folders <Project data folder>/cards/<id>/,
// in worfy's own data folder and never in the Project's repository (ADR-0003, ADR-0005). Agents
// write a Card's files; this store only reads them: it lists the Cards, reads a Card's <title>,
// and watches the folders so a Node reloads its Card within a second of a file change.
//
// On Windows stat of a Card's folder and open of its index.html follow a link, and a link to
// `\\host\share\…` makes the system contact that host with the user's credentials. So info() reads
// the links on the way first (remote-links.ts; worfy-windows ticket 19): a Card whose folder leads
// there is not there, and a Card whose index.html leads there has no title. This covers info()
// alone. The watch below does not have it: chokidar calls realpath, stat and readdir through every
// link in the Cards folder, also with followSymlinks off.
//
// Watching starts for a Project the first time one of its Cards is asked for, and lasts until the
// Project leaves the list or close(). Changes are reported per Card after a short quiet period
// (CARD_CHANGE_DELAY_MS), so a burst of writes reloads the Card once.
import { mkdirSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { relative, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { CARD_ID_PATTERN, type CardInfo } from '../../shared/ipc/cards'
import { projectStore } from '../projects/store'
import { leadsToRemote, type LinkFs, type PathRules } from '../remote-links'
import { cardUrl, projectLabel, type CardHost } from './protocol'

/** The folder of a Project's Cards, inside its data folder. */
export const CARDS_DIR = 'cards'

/** Quiet period after the last file event of a Card before it is reported changed. */
export const CARD_CHANGE_DELAY_MS = 100

/** How much of index.html is read to find its <title>. */
const TITLE_READ_LIMIT = 64 * 1024
const TITLE_LENGTH_LIMIT = 200

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

/** The text of the first <title> in an HTML document, or null when there is none or it is empty. */
export function titleOf(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)
  if (!match?.[1]) return null
  const text = decodeEntities(match[1]).replace(/\s+/g, ' ').trim()
  return text === '' ? null : text.slice(0, TITLE_LENGTH_LIMIT)
}

async function readTitle(file: string): Promise<string | null> {
  try {
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(TITLE_READ_LIMIT)
      const { bytesRead } = await handle.read(buffer, 0, TITLE_READ_LIMIT, 0)
      return titleOf(buffer.subarray(0, bytesRead).toString('utf8'))
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** What is asked of the file system for one Card; both calls follow links. */
export interface CardFs {
  isDirectory: (path: string) => Promise<boolean>
  /** The <title> of an HTML file, or null when there is no file or no title. */
  readTitle: (file: string) => Promise<string | null>
}

const nodeFs: CardFs = { isDirectory, readTitle }

export interface CardStoreOptions {
  /** A Project's data folder; throws for a Project that is not in the list. */
  dataDirOf: (projectId: string) => string
  /** The ids of the Projects in the list, to find a Project by its label. */
  projectIds: () => readonly string[]
  /** Watch the Cards' folders (default true); tests of the protocol alone switch it off. */
  watch?: boolean
  /**
   * Subscribes to changes of the Project list; returns the function that unsubscribes. The store
   * stops watching the Cards of a Project that is no longer listed.
   */
  subscribeProjects?: (listener: () => void) => () => void
  delayMs?: number
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: PathRules
  /** lstat and readlink for the links on the way to a Card (remote-links.ts); replaced in tests. */
  links?: LinkFs
  /** The calls that follow links; replaced in tests. */
  fs?: CardFs
}

const keyOf = (projectId: string, cardId: string): string => `${projectId}\n${cardId}`

export class CardStore {
  private readonly revisions = new Map<string, number>()
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly listeners = new Set<(info: CardInfo) => void>()
  private readonly delayMs: number
  private readonly unsubscribeProjects: () => void
  private readonly paths: PathRules
  private readonly fs: CardFs
  private closed = false

  /** Does no I/O. */
  constructor(private readonly options: CardStoreOptions) {
    this.delayMs = options.delayMs ?? CARD_CHANGE_DELAY_MS
    this.paths = options.paths ?? nativePath
    this.fs = options.fs ?? nodeFs
    this.unsubscribeProjects = options.subscribeProjects?.(() => this.forgetRemovedProjects()) ?? (() => undefined)
  }

  /** The folder of all Cards of a Project. Throws for a Project that is not in the list. */
  cardsDir(projectId: string): string {
    return this.paths.join(this.options.dataDirOf(projectId), CARDS_DIR)
  }

  /** The folder of one Card. Throws for an invalid Card id or a Project that is not in the list. */
  cardDir(projectId: string, cardId: string): string {
    if (!CARD_ID_PATTERN.test(cardId)) throw new Error(`${cardId} is not a valid Card id`)
    return this.paths.join(this.cardsDir(projectId), cardId)
  }

  /**
   * The Cards folder of the Project a protocol host names, or null when no Project, or more than
   * one, has that label.
   */
  locate({ projectLabel: label }: CardHost): string | null {
    const matches = this.options.projectIds().filter((id) => projectLabel(id) === label)
    const [projectId] = matches
    if (matches.length !== 1 || projectId === undefined) return null
    try {
      return this.cardsDir(projectId)
    } catch {
      return null
    }
  }

  /**
   * One Card as the renderer shows it; starts watching the Project's Cards. A Card whose folder
   * leads to a share is not there, and one whose index.html leads there has no title: stat and
   * open here are not asked about either. The watch it starts is another matter (see the top of
   * this file).
   */
  async info(projectId: string, cardId: string): Promise<CardInfo> {
    // The folders are asked of the Project list once, before anything is awaited: a Project that
    // leaves the list meanwhile still gets its answer, as before the walk was here.
    const cards = this.cardsDir(projectId)
    const dir = this.cardDir(projectId, cardId)
    const url = cardUrl(projectId, cardId)
    this.watchProject(projectId)
    // The Cards folder is the only place these paths may go: also when it lies on a share itself.
    const away = (path: string): Promise<boolean> => leadsToRemote(path, [cards], { paths: this.paths, links: this.options.links })
    const index = this.paths.join(dir, 'index.html')
    const exists = !(await away(dir)) && (await this.fs.isDirectory(dir))
    const title = exists && !(await away(index)) ? await this.fs.readTitle(index) : null
    return { projectId, cardId, url, exists, title, revision: this.revisions.get(keyOf(projectId, cardId)) ?? 0 }
  }

  /** Every Card of a Project that has a folder, by id. */
  async list(projectId: string): Promise<CardInfo[]> {
    const dir = this.cardsDir(projectId)
    let ids: string[]
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      ids = entries.filter((entry) => entry.isDirectory() && CARD_ID_PATTERN.test(entry.name)).map((entry) => entry.name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return Promise.all(ids.sort().map((id) => this.info(projectId, id)))
  }

  /** Called with the Card's new state after its files changed. Returns the function that unsubscribes. */
  onChange(listener: (info: CardInfo) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private watchProject(projectId: string): void {
    if (this.options.watch === false || this.closed || this.watchers.has(projectId)) return
    const dir = this.cardsDir(projectId)
    // worfy's own data folder (ADR-0005): the folder is made so it can be watched before the
    // first Card is written.
    mkdirSync(dir, { recursive: true })
    const watcher = watch(dir, { ignoreInitial: true })
    watcher.on('all', (_event, path) => {
      const [cardId] = relative(dir, path).split(sep)
      if (cardId !== undefined && CARD_ID_PATTERN.test(cardId)) this.schedule(projectId, cardId)
    })
    watcher.on('error', (error) => console.error(`[cards] watching the Cards of ${projectId} failed`, error))
    this.watchers.set(projectId, watcher)
  }

  private schedule(projectId: string, cardId: string): void {
    const key = keyOf(projectId, cardId)
    clearTimeout(this.timers.get(key))
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        // The Project left the list while this change waited: its Cards are no longer read.
        if (this.closed || !this.watchers.has(projectId)) return
        this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1)
        void this.info(projectId, cardId).then(
          (info) => {
            if (this.closed) return
            for (const listener of this.listeners) {
              try {
                listener(info)
              } catch (error) {
                console.error('[cards] a change listener threw', error)
              }
            }
          },
          (error: unknown) => console.error(`[cards] could not read Card ${cardId} of ${projectId}`, error),
        )
      }, this.delayMs),
    )
  }

  /** The Projects whose Cards are being watched now. */
  watchedProjects(): string[] {
    return [...this.watchers.keys()].sort()
  }

  /** Stops watching the Cards of every Project that is no longer in the list. */
  private forgetRemovedProjects(): void {
    if (this.closed) return
    const listed = new Set(this.options.projectIds())
    for (const [projectId, watcher] of [...this.watchers]) {
      if (listed.has(projectId)) continue
      this.watchers.delete(projectId)
      watcher.close().catch((error: unknown) => console.error(`[cards] could not stop watching the Cards of ${projectId}`, error))
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.unsubscribeProjects()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    const watchers = [...this.watchers.values()]
    this.watchers.clear()
    await Promise.all(watchers.map((watcher) => watcher.close()))
  }
}

let shared: CardStore | undefined

/** The store of the running app, over the Projects' data folders. Creating it does no I/O. */
export function cardStore(): CardStore {
  shared ??= new CardStore({
    dataDirOf: (projectId) => {
      const projects = projectStore()
      return projects.dataDir(projects.get(projectId).id)
    },
    projectIds: () => projectStore().list().map((project) => project.id),
    subscribeProjects: (listener) => projectStore().onChange(listener),
  })
  return shared
}
