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
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CARD_ID_PATTERN } from '../../shared/ipc/cards'
import { TRASH_KEEP_MS, TRASH_LABEL_PATTERN, trashRefusal, type TrashEntry } from '../../shared/ipc/trash'
import { layoutNodeSchema, type LayoutNode, type LayoutState } from '../../shared/layout/types'
import { CARD_DATA_DIR } from '../cards/data'
import { CARDS_DIR, titleOf } from '../cards/store'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

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
  apply(projectId: string, op: { op: 'remove'; id: string } | { op: 'create'; node: LayoutNode }): LayoutState
}

export interface TrashDeps {
  /** A Project's data folder; throws for a Project that is not in the list. */
  dataDirOf: (projectId: string) => string
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

function readCardTitle(cardFolder: string): string | null {
  try {
    return titleOf(readFileSync(join(cardFolder, 'index.html'), 'utf8').slice(0, 64 * 1024))
  } catch {
    return null
  }
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

  private cardPaths(projectId: string, cardId: string): { folder: string; data: string } {
    const dataDir = this.deps.dataDirOf(projectId)
    return { folder: join(dataDir, CARDS_DIR, cardId), data: join(dataDir, CARD_DATA_DIR, `${cardId}.json`) }
  }

  /**
   * Moves a Node to the trash: for a Card that no other Node shows, its folder and its data too;
   * then removes the Node from the Layout. Throws, having moved nothing, for a Node the user may
   * not delete.
   */
  put(projectId: string, nodeId: string): TrashEntry {
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
        const paths = this.cardPaths(projectId, cardId)
        const title = existsSync(paths.folder) ? readCardTitle(paths.folder) : null
        const move = (from: string, to: string): boolean => {
          if (shared || !existsSync(from)) return false
          renameSync(from, to)
          moved.push({ from, to })
          return true
        }
        const files = move(paths.folder, join(dir, CARD_FOLDER))
        const data = move(paths.data, join(dir, CARD_DATA_FILE))
        card = { cardId, files, data, title }
      }
      const entry: StoredEntry = { trashedAt, node, card }
      writeJsonFile(join(dir, ENTRY_FILE), storedEntrySchema, entry)
      this.deps.layout.apply(projectId, { op: 'remove', id: nodeId })
      return summaryOf(label, entry)
    } catch (error) {
      // Put back what moved, newest first, and drop the half-made entry.
      for (const { from, to } of moved.reverse()) renameSync(to, from)
      rmSync(dir, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * Puts an entry back: the Card's folder and data, then the Node with its old id and fields; the
   * entry folder is deleted. Throws, having changed nothing, when the Node id is in the Layout
   * again or a Card with the same id was written meanwhile.
   */
  restore(projectId: string, label: string): TrashEntry {
    const dir = this.entryDir(projectId, label)
    const entry = readJsonFile(join(dir, ENTRY_FILE), storedEntrySchema)
    if (!entry) throw new Error(`The trash has no entry ${label}`)
    const { node, card } = entry
    if (this.deps.layout.get(projectId).layout.nodes.some((each) => each.id === node.id)) {
      throw new Error(`The Layout has a Node with id ${node.id} again; remove it before restoring`)
    }

    const back: { from: string; to: string }[] = []
    if (card !== null) {
      const paths = this.cardPaths(projectId, card.cardId)
      if (card.files) back.push({ from: join(dir, CARD_FOLDER), to: paths.folder })
      if (card.data) back.push({ from: join(dir, CARD_DATA_FILE), to: paths.data })
      for (const { to } of back) if (existsSync(to)) throw new Error(`A Card with id ${card.cardId} exists again; delete it before restoring`)
    }

    const done: { from: string; to: string }[] = []
    try {
      for (const move of back) {
        mkdirSync(join(move.to, '..'), { recursive: true })
        renameSync(move.from, move.to)
        done.push(move)
      }
      this.deps.layout.apply(projectId, { op: 'create', node })
    } catch (error) {
      for (const { from, to } of done.reverse()) renameSync(to, from)
      throw error
    }
    rmSync(dir, { recursive: true, force: true })
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
      rmSync(this.entryDir(projectId, label), { recursive: true, force: true })
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
