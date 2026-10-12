// The trash of each Project (ticket 30): <Project data folder>/trash/<label>/, one folder per
// deleted Node, inside worfy's own data folder (ADR-0005). Nothing here reaches the Project's
// repository or the Claude home: every path is built from the Project's data folder, a Card id
// (CARD_ID_PATTERN) and a label (TRASH_LABEL_PATTERN), none of which can name another folder.
//
// An entry folder holds entry.json — the Node's Layout entry, when it was deleted, which Card it
// showed — and, for a Card, `card/` (the Card's folder, moved) and `card-data.json` (its data,
// moved). The Node leaves the Layout through the Layout store like any other operation (main is
// its only writer, ADR-0003), and comes back through it with the same id, place and fields.
//
// A Card is moved only when no other Node shows it; otherwise only the deleted Node goes to the
// trash. Entries older than TRASH_KEEP_MS are deleted by purge(), which the IPC module runs when
// the app starts.
//
// On Windows a call through a link to `\\host\share\…` makes the system contact that host with
// the user's credentials (remote-links.ts). So before a Card's folder or data file is looked at,
// the links on the way to it are read (worfy-windows ticket 20), and the look itself is lstat,
// which does not follow: a Card folder that is a link goes to the trash as the link it is, and
// comes back as one; its title is not read through it when it leads off the machine.
import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import * as nativePath from 'node:path'
import { join } from 'node:path'
import { z } from 'zod'
import { CARD_ID_PATTERN } from '../../shared/ipc/cards'
import { TRASH_KEEP_MS, TRASH_LABEL_PATTERN, trashRefusal, type TrashEntry } from '../../shared/ipc/trash'
import { layoutNodeSchema, type LayoutNode, type LayoutState } from '../../shared/layout/types'
import { titleOf } from '../cards/store'
import { leadsToRemoteSync, type LinkFsSync, type PathRules } from '../remote-links'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { removeTree } from '../storage/remove'

/** The folder of a Project's trash, inside its data folder. */
export const TRASH_DIR = 'trash'
const ENTRY_FILE = 'entry.json'
const CARD_FOLDER = 'card'
const CARD_DATA_FILE = 'card-data.json'

const TITLE_LENGTH_LIMIT = 200

const storedEntrySchema = z.object({
  trashedAt: z.number().int().nonnegative(),
  node: layoutNodeSchema,
  /** The Card the Node showed and what of it moved here; null for a Node of another kind. */
  card: z
    .object({
      cardId: z.string().regex(CARD_ID_PATTERN),
      files: z.boolean(),
      data: z.boolean(),
      title: z.string().nullable(),
    })
    .nullable(),
})
type StoredEntry = z.output<typeof storedEntrySchema>

/** The part of the Layout store the trash uses. */
export interface TrashLayout {
  get(projectId: string): LayoutState
  /** `screen`: the screen whose gesture or undo this is, handed on in `layout.changed`; null without one. */
  apply(projectId: string, op: { op: 'remove'; id: string } | { op: 'create'; node: LayoutNode }, screen: string | null): LayoutState
}

export interface TrashDeps {
  /** A Project's data folder; throws for a Project that is not in the list. */
  dataDirOf: (projectId: string) => string
  /**
   * Where a Card's folder and its data file are, as src/main/cards lays them out (CardStore.cardDir,
   * CardDataStore.file); throws for an invalid Card id or a Project that is not in the list.
   */
  cardPaths: (projectId: string, cardId: string) => { folder: string; data: string }
  layout: TrashLayout
  /** Why this Node may not be deleted now, beyond trashRefusal(): a Session running on it. */
  busy?: (projectId: string, node: LayoutNode) => string | null
  now?: () => number
}

/** The Card a Node of kind `card` shows: `data.cardId` when it is set, otherwise the Node's own id (as CardNode.tsx reads it). */
export function cardIdOf(node: LayoutNode): string | null {
  if (node.kind !== 'card') return null
  const fromData = node.data.cardId
  const cardId = typeof fromData === 'string' ? fromData : node.id
  return CARD_ID_PATTERN.test(cardId) ? cardId : null
}

function titleOfNode(node: LayoutNode): string | null {
  const text = node.data.text ?? node.data.title
  if (typeof text !== 'string') return null
  const line = text.split('\n').find((each) => each.trim() !== '')?.trim()
  return line === undefined ? null : line.slice(0, TITLE_LENGTH_LIMIT)
}

/** The two calls the trash makes about a Card's files; replaced in tests. */
export interface CardFilesFs {
  /** Whether something is at the path, by lstat: a link is there whatever it leads to. */
  there: (path: string) => boolean
  readText: (path: string) => string
}

const nodeCardFiles: CardFilesFs = {
  there: (path) => {
    try {
      lstatSync(path)
      return true
    } catch {
      return false
    }
  },
  readText: (path) => readFileSync(path, 'utf8'),
}

export interface CardFilesOptions {
  /** The path rules of the platform; path.win32 in tests on any system. */
  paths?: PathRules
  links?: LinkFsSync
  fs?: CardFilesFs
}

/**
 * What is at a path the trash moves from or to. 'away': a link on the way to its folder leads off
 * the machine, or cannot be checked — the path is not looked at. Else whether something is there;
 * a link at the path itself is something, and is not followed.
 */
export function placeOf(path: string, dataDir: string, options: CardFilesOptions = {}): 'away' | 'taken' | 'free' {
  const paths = options.paths ?? nativePath
  if (leadsToRemoteSync(paths.dirname(path), [dataDir], { paths, links: options.links })) return 'away'
  return (options.fs ?? nodeCardFiles).there(path) ? 'taken' : 'free'
}

/**
 * What put() learns of a Card before it moves it: whether its folder and its data file are there,
 * and the title of its index.html. The title is read only when no link on the way to the file —
 * the Card folder itself, or index.html — leads off the machine.
 */
export function cardOnDisk(card: { folder: string; data: string }, dataDir: string, options: CardFilesOptions = {}): { folder: boolean; data: boolean; title: string | null } {
  const paths = options.paths ?? nativePath
  const fs = options.fs ?? nodeCardFiles
  const folder = placeOf(card.folder, dataDir, options) === 'taken'
  const data = placeOf(card.data, dataDir, options) === 'taken'
  const index = paths.join(card.folder, 'index.html')
  let title: string | null = null
  if (folder && !leadsToRemoteSync(index, [dataDir], { paths, links: options.links })) {
    try {
      title = titleOf(fs.readText(index).slice(0, 64 * 1024))
    } catch {
      title = null
    }
  }
  return { folder, data, title }
}

const summaryOf = (label: string, entry: StoredEntry): TrashEntry => ({
  label,
  trashedAt: entry.trashedAt,
  nodeId: entry.node.id,
  kind: entry.node.kind,
  title: entry.card ? entry.card.title : titleOfNode(entry.node),
  hasFiles: entry.card !== null && (entry.card.files || entry.card.data),
})

/** The time a label was made at (its first part). */
const labelTime = (label: string): number => Number(label.slice(0, label.indexOf('-')))

export class TrashStore {
  private readonly now: () => number

  /** Does no I/O. */
  constructor(private readonly deps: TrashDeps) {
    this.now = deps.now ?? (() => Date.now())
  }

  /** The folder of a Project's trash. Throws for a Project that is not in the list. */
  trashDir(projectId: string): string {
    return join(this.deps.dataDirOf(projectId), TRASH_DIR)
  }

  private entryDir(projectId: string, label: string): string {
    if (!TRASH_LABEL_PATTERN.test(label)) throw new Error(`${label} is not a trash label`)
    return join(this.trashDir(projectId), label)
  }

  /**
   * Moves a Node to the trash: for a Card that no other Node shows, its folder and its data too;
   * then removes the Node from the Layout. Throws, having moved nothing, for a Node the user may
   * not delete. `screen` is the screen that asked, carried by the Layout change.
   */
  put(projectId: string, nodeId: string, screen: string | null = null): TrashEntry {
    const { layout } = this.deps.layout.get(projectId)
    const node = layout.nodes.find((each) => each.id === nodeId)
    if (!node) throw new Error(`The Layout has no Node with id ${nodeId}`)
    const refusal = trashRefusal(node) ?? this.deps.busy?.(projectId, node) ?? null
    if (refusal !== null) throw new Error(refusal)

    const trashedAt = this.now()
    const label = `${trashedAt}-${randomBytes(4).toString('hex')}`
    const dir = this.entryDir(projectId, label)
    mkdirSync(dir, { recursive: true })

    const cardId = cardIdOf(node)
    const shared = cardId !== null && layout.nodes.some((each) => each.id !== nodeId && cardIdOf(each) === cardId)
    const moved: { from: string; to: string }[] = []
    let card: StoredEntry['card'] = null
    try {
      if (cardId !== null) {
        const paths = this.deps.cardPaths(projectId, cardId)
        const found = cardOnDisk(paths, this.deps.dataDirOf(projectId))
        const move = (there: boolean, from: string, to: string): boolean => {
          if (shared || !there) return false
          renameSync(from, to)
          moved.push({ from, to })
          return true
        }
        const files = move(found.folder, paths.folder, join(dir, CARD_FOLDER))
        const data = move(found.data, paths.data, join(dir, CARD_DATA_FILE))
        card = { cardId, files, data, title: found.title }
      }
      const entry: StoredEntry = { trashedAt, node, card }
      writeJsonFile(join(dir, ENTRY_FILE), storedEntrySchema, entry)
      this.deps.layout.apply(projectId, { op: 'remove', id: nodeId }, screen)
      return summaryOf(label, entry)
    } catch (error) {
      // Put back what moved, newest first, and drop the half-made entry.
      for (const { from, to } of moved.reverse()) renameSync(to, from)
      removeTree(dir)
      throw error
    }
  }

  /**
   * Puts an entry back: the Card's folder and data, then the Node with its old id and fields; the
   * entry folder is deleted. Throws, having changed nothing, when the Node id is in the Layout
   * again or a Card with the same id was written meanwhile. `screen` as for put().
   */
  restore(projectId: string, label: string, screen: string | null = null): TrashEntry {
    const dir = this.entryDir(projectId, label)
    const entry = readJsonFile(join(dir, ENTRY_FILE), storedEntrySchema)
    if (!entry) throw new Error(`The trash has no entry ${label}`)
    const { node, card } = entry
    if (this.deps.layout.get(projectId).layout.nodes.some((each) => each.id === node.id)) {
      throw new Error(`The Layout has a Node with id ${node.id} again; remove it before restoring`)
    }

    const back: { from: string; to: string }[] = []
    if (card !== null) {
      const paths = this.deps.cardPaths(projectId, card.cardId)
      if (card.files) back.push({ from: join(dir, CARD_FOLDER), to: paths.folder })
      if (card.data) back.push({ from: join(dir, CARD_DATA_FILE), to: paths.data })
      for (const { to } of back) {
        const place = placeOf(to, this.deps.dataDirOf(projectId))
        if (place === 'away') throw new Error(`The folder of Card ${card.cardId} leads off this machine, or cannot be checked; the Card is not put back`)
        if (place === 'taken') throw new Error(`A Card with id ${card.cardId} exists again; delete it before restoring`)
      }
    }

    const done: { from: string; to: string }[] = []
    try {
      for (const move of back) {
        mkdirSync(join(move.to, '..'), { recursive: true })
        renameSync(move.from, move.to)
        done.push(move)
      }
      this.deps.layout.apply(projectId, { op: 'create', node }, screen)
    } catch (error) {
      for (const { from, to } of done.reverse()) renameSync(to, from)
      throw error
    }
    removeTree(dir)
    return summaryOf(label, entry)
  }

  /** The Project's entries, newest first. An entry whose entry.json cannot be read is left out. */
  list(projectId: string): TrashEntry[] {
    const entries: TrashEntry[] = []
    for (const label of this.labels(projectId)) {
      const entry = readJsonFile(join(this.trashDir(projectId), label, ENTRY_FILE), storedEntrySchema)
      if (entry) entries.push(summaryOf(label, entry))
    }
    return entries.sort((a, b) => b.trashedAt - a.trashedAt || b.label.localeCompare(a.label))
  }

  /** Deletes the entries made more than TRASH_KEEP_MS ago; returns their labels. */
  purge(projectId: string): string[] {
    const oldest = this.now() - TRASH_KEEP_MS
    const removed: string[] = []
    for (const label of this.labels(projectId)) {
      if (labelTime(label) >= oldest) continue
      removeTree(this.entryDir(projectId, label))
      removed.push(label)
    }
    return removed
  }

  /** The entry folders of the Project's trash; anything else in it is not ours to read or delete. */
  private labels(projectId: string): string[] {
    try {
      return readdirSync(this.trashDir(projectId), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && TRASH_LABEL_PATTERN.test(entry.name))
        .map((entry) => entry.name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
}
