// The Layout of each Project's Canvas, kept in `<Project data folder>/layout.json` (ADR-0005).
// main is the only writer (ADR-0003): the renderer sends operations over IPC
// (src/main/ipc/layout.ts), the MCP tools of ticket 24 will call apply() directly, and both go
// through the same schema check here. The process applies operations one at a time, in the order
// they arrive, so the last operation on a Node wins and two callers can never interleave halfway.
//
// The camera of the Canvas is not written here: each screen keeps its own (viewports.ts,
// worfy-link ticket 06). The `viewport` of layout.json is read as it is and written back unchanged.
//
// Nodes never overlap (ADR-0038): an operation that puts a Node on the plane — create, move,
// resize, showing a hidden Node, unpinning, moveMany — is corrected here, whoever sent it, so the
// Node keeps the gap from every other Node on the plane; the neighbours do not move. The answer
// carries the corrected place.
//
// The automatic archive (ADR-0076, archive.ts) takes Nodes off the plane with `archive` and brings
// them back with `restore`, which puts each at its old place when that is clear, else at the nearest
// clear one. Every operation the user makes on a Node — one sent with a screen: move, moveMany,
// resize, pin, hide, tag, patchData, keep — and every `touch` and `restore` set the Node's
// `touchedAt` to now, so the archive leaves a Node the user has just worked with or brought back.
// A `moveMany` of a layout command (`arrange`: Tidy up, Arrange by Epic) does not: it moves every
// Node at once, which is not work with each of them (ADR-0076, Amendments).
//
// Operations change the Layout in memory at once; the file is written after a quiet period
// (LAYOUT_SAVE_DELAY_MS since the last operation) or, while operations keep coming with no quiet
// period, LAYOUT_SAVE_MAX_DELAY_MS after the first unsaved one; and right away by flush() — the IPC
// module calls flushAll() when the app quits. The file's path is asked of the list of Projects at
// write time, so projects.remove writes the Layout before the Project leaves the list and forgets
// it after (worfy-windows ticket 31).
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { freePlace, freeShift, isParticipant, obstaclesFor, stopResize } from '../../shared/layout/free-place'
import { EMPTY_LAYOUT, isArchived, layoutOpSchema, layoutSchema, type Layout, type LayoutNode, type LayoutOp, type LayoutOpInput, type LayoutState } from '../../shared/layout/types'
import { projectStore } from '../projects/store'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { upgradeLayout, upgradeMessages } from './upgrade'

/** How long the Layout must stay unchanged before it is written. */
export const LAYOUT_SAVE_DELAY_MS = 250

/**
 * The longest an unsaved change waits for its write while operations keep coming less than
 * LAYOUT_SAVE_DELAY_MS apart (an agent's Session, the canvas tools): what a crash can lose.
 */
export const LAYOUT_SAVE_MAX_DELAY_MS = 1000

export const LAYOUT_FILE = 'layout.json'

export interface LayoutChange extends LayoutState {
  /** The operation that made this change, after parsing. */
  op: LayoutOp
  /**
   * The screen that sent the operation (src/renderer/canvas/screen.ts), null when it came without
   * one: main itself, an agent, an automatic writer of the renderer (worfy-link ticket 07).
   */
  screen: string | null
}

export interface LayoutStoreOptions {
  /** Writes a Layout to its file; tests pass a recorder. */
  write?: (file: string, layout: Layout) => void
  delayMs?: number
  maxDelayMs?: number
  /** The clock of `touchedAt` and of an archive's `at`; tests pass their own. */
  now?: () => number
}

interface Entry {
  layout: Layout
  revision: number
  /** The write after the quiet period; started again by every operation. */
  timer: ReturnType<typeof setTimeout> | undefined
  /** The write at the latest: started by the first unsaved operation, not moved by later ones. */
  deadline: ReturnType<typeof setTimeout> | undefined
  dirty: boolean
}

const writeLayoutFile = (file: string, layout: Layout): void => writeJsonFile(file, layoutSchema, layout)

/**
 * The Node at `index` of `nodes`, put where it keeps the gap from every other Node on the plane
 * (ADR-0038): at the nearest clear place, or, after a resize, with the edges that ran into a
 * neighbour stopped short of it. A Node off the plane (pinned, hidden, a node source's) stays as it
 * is and is in nobody's way.
 */
function settle(nodes: readonly LayoutNode[], index: number, before: LayoutNode | undefined, op: LayoutOp): LayoutNode {
  const node = nodes[index]!
  if (!isParticipant(node)) return node
  const obstacles = obstaclesFor(nodes, new Set([node.id]))
  if (op.op === 'resize' && before !== undefined && isParticipant(before)) return { ...node, ...stopResize(before, node, obstacles) }
  return { ...node, ...freePlace(node, obstacles) }
}

/** Moves several Nodes as one group: the group shifts as a whole off the Nodes outside it (ADR-0038). */
function moveMany(layout: Layout, op: Extract<LayoutOp, { op: 'moveMany' }>): Layout {
  const at = new Map(op.moves.map((move) => [move.id, move]))
  for (const { id } of op.moves) {
    const node = layout.nodes.find((each) => each.id === id)
    if (node === undefined) throw new Error(`The Layout has no Node with id ${id}`)
    if (node.pinned) throw new Error(`Node ${id} is pinned to the screen; unpin it before a move`)
  }
  const moved = layout.nodes.map((node) => {
    const move = at.get(node.id)
    return move === undefined ? node : { ...node, x: move.x, y: move.y }
  })
  const group = moved.filter((node) => at.has(node.id) && isParticipant(node))
  const { dx, dy } = freeShift(group, obstaclesFor(moved, new Set(at.keys())))
  if (dx === 0 && dy === 0) return { ...layout, nodes: moved }
  const shifted = new Set(group.map((node) => node.id))
  return { ...layout, nodes: moved.map((node) => (shifted.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node)) }
}

/** The index of each named Node; throws for an id the Layout does not have. */
function indexesOf(layout: Layout, ids: readonly string[]): number[] {
  return ids.map((id) => {
    const index = layout.nodes.findIndex((node) => node.id === id)
    if (index < 0) throw new Error(`The Layout has no Node with id ${id}`)
    return index
  })
}

/** Takes the Nodes off the plane into the archive, as one batch; a Node already archived keeps its record. */
function archive(layout: Layout, op: Extract<LayoutOp, { op: 'archive' }>, now: number): Layout {
  const indexes = indexesOf(
    layout,
    op.nodes.map((node) => node.id),
  )
  // `at` is a time main wrote before (the undo of a Restore sends it back): one in the future is refused.
  const future = op.nodes.find((node) => node.at !== undefined && node.at > now)
  if (future !== undefined) throw new Error(`The archive time of ${future.id} is in the future`)
  const nodes = [...layout.nodes]
  for (const [n, index] of indexes.entries()) {
    const node = nodes[index]!
    if (!isArchived(node)) nodes[index] = { ...node, archived: { at: op.nodes[n]!.at ?? now, rule: op.nodes[n]!.rule, batch: op.batch } }
  }
  return { ...layout, nodes }
}

/** Brings archived Nodes back: each, in the order named, at its old place when clear, else the nearest clear one (ADR-0038). */
function restore(layout: Layout, op: Extract<LayoutOp, { op: 'restore' }>): Layout {
  const indexes = indexesOf(layout, op.ids)
  const nodes = [...layout.nodes]
  for (const index of indexes) {
    const node = nodes[index]!
    if (!isArchived(node)) continue
    nodes[index] = { ...node, archived: null }
    nodes[index] = settle(nodes, index, undefined, op)
  }
  return { ...layout, nodes }
}

/** The Nodes an operation sent with a screen counts as the user's work with (ADR-0076, point 2). */
function touchedBy(op: LayoutOp, screen: string | null): string[] {
  switch (op.op) {
    case 'touch':
      return [op.id]
    case 'restore':
      return op.ids
    case 'move':
    case 'resize':
    case 'pin':
    case 'hide':
    case 'tag':
    case 'patchData':
    case 'keep':
      return screen === null ? [] : [op.id]
    case 'moveMany':
      // A layout command (Tidy up, Arrange by Epic) is not the user's work with each Node it moves.
      return screen === null || op.arrange === true ? [] : op.moves.map((move) => move.id)
    case 'create':
    case 'remove':
    case 'archive':
      return []
  }
}

/** Sets `touchedAt` of the named Nodes that are in the Layout. */
function touch(layout: Layout, ids: readonly string[], now: number): Layout {
  if (ids.length === 0) return layout
  const named = new Set(ids)
  return { ...layout, nodes: layout.nodes.map((node) => (named.has(node.id) ? { ...node, touchedAt: now } : node)) }
}

/**
 * Applies one parsed operation to a Layout; returns the new Layout. Throws when it is refused. An
 * operation that puts a Node on the plane is corrected so that the Node overlaps none (ADR-0038).
 */
function applyOp(layout: Layout, op: LayoutOp, now: number): Layout {
  if (op.op === 'moveMany') return moveMany(layout, op)
  if (op.op === 'archive') return archive(layout, op, now)
  if (op.op === 'restore') return restore(layout, op)

  if (op.op === 'create') {
    const id = op.node.id ?? randomUUID()
    if (layout.nodes.some((node) => node.id === id)) throw new Error(`The Layout already has a Node with id ${id}`)
    const nodes = [...layout.nodes, { ...op.node, id }]
    nodes[nodes.length - 1] = settle(nodes, nodes.length - 1, undefined, op)
    return { ...layout, nodes }
  }

  const index = layout.nodes.findIndex((node) => node.id === op.id)
  const current = layout.nodes[index]
  if (current === undefined) throw new Error(`The Layout has no Node with id ${op.id}`)

  if (op.op === 'remove') {
    if (current.locked) throw new Error(`Node ${op.id} is locked and cannot be removed`)
    return { ...layout, nodes: layout.nodes.filter((node) => node.id !== op.id) }
  }

  // A pinned Node's x, y, w and h are screen pixels (types.ts): a `move` or `resize` in canvas
  // units would put it somewhere else on the screen. They change only with `pin`.
  if ((op.op === 'move' || op.op === 'resize') && current.pinned) {
    throw new Error(`Node ${op.id} is pinned to the screen; unpin it before a ${op.op}`)
  }

  let next: LayoutNode
  switch (op.op) {
    case 'move':
      next = { ...current, x: op.x, y: op.y }
      break
    case 'resize':
      next = { ...current, w: op.w, h: op.h, x: op.x ?? current.x, y: op.y ?? current.y }
      break
    case 'hide':
      next = { ...current, hidden: op.hidden }
      break
    case 'patchData':
      next = { ...current, data: { ...current.data, ...op.data } }
      break
    case 'pin':
      next = { ...current, pinned: op.pinned, x: op.x, y: op.y, w: op.w, h: op.h }
      break
    case 'tag': {
      const removed = new Set(op.remove)
      const tags = [...new Set([...current.tags, ...op.add])].filter((tag) => !removed.has(tag))
      next = { ...current, tags }
      break
    }
    case 'keep':
      next = { ...current, keep: op.keep }
      break
    case 'touch':
      // touchedAt is set by apply(), as for every operation of the user.
      next = current
      break
  }
  const nodes = [...layout.nodes]
  nodes[index] = next
  // Data and tags do not move a Node; the operations that put it somewhere on the plane are corrected.
  if (op.op === 'move' || op.op === 'resize' || op.op === 'hide' || op.op === 'pin') nodes[index] = settle(nodes, index, current, op)
  return { ...layout, nodes }
}

export class LayoutStore {
  private readonly entries = new Map<string, Entry>()
  /**
   * The last revision of each Layout forget() dropped. A screen keeps the Layout it last saw and
   * takes no state with a lower revision (src/renderer/canvas/useLayout.ts, the undo marks of
   * history.ts), so a Project added again in the same run goes on from here instead of from 0.
   */
  private readonly forgottenRevisions = new Map<string, number>()
  private readonly listeners = new Set<(change: LayoutChange) => void>()
  private readonly write: (file: string, layout: Layout) => void
  private readonly delayMs: number
  private readonly maxDelayMs: number
  private readonly now: () => number

  /**
   * `dirOf` gives a Project's data folder and throws for a Project that is not in the list.
   * Does no I/O: a Layout is read on first use.
   */
  constructor(
    private readonly dirOf: (projectId: string) => string,
    options: LayoutStoreOptions = {},
  ) {
    this.write = options.write ?? writeLayoutFile
    this.delayMs = options.delayMs ?? LAYOUT_SAVE_DELAY_MS
    this.maxDelayMs = options.maxDelayMs ?? LAYOUT_SAVE_MAX_DELAY_MS
    this.now = options.now ?? Date.now
  }

  file(projectId: string): string {
    return join(this.dirOf(projectId), LAYOUT_FILE)
  }

  private entry(projectId: string): Entry {
    // Asked every time, so a Project removed from the list is refused even when it is in memory.
    const file = this.file(projectId)
    let entry = this.entries.get(projectId)
    if (!entry) {
      const read = readJsonFile(file, layoutSchema) ?? EMPTY_LAYOUT
      // What this version no longer keeps goes once, and overlaps are removed, on the first read
      // (upgrade.ts, ADR-0037, ADR-0038).
      const upgraded = upgradeLayout(read)
      // After a forget the file is read again: a new state, one revision after the last one handed out.
      const forgotten = this.forgottenRevisions.get(projectId)
      const revision = forgotten === undefined ? 0 : forgotten + 1
      entry = { layout: upgraded?.layout ?? read, revision, timer: undefined, deadline: undefined, dirty: false }
      this.entries.set(projectId, entry)
      this.forgottenRevisions.delete(projectId)
      if (upgraded) {
        for (const line of upgradeMessages(projectId, upgraded)) console.info(line)
        entry.dirty = true
        this.flush(projectId)
      }
    }
    return entry
  }

  /** The Project's Layout when main already holds it; undefined, without reading layout.json, when it does not. */
  peek(projectId: string): LayoutState | undefined {
    const entry = this.entries.get(projectId)
    return entry === undefined ? undefined : { projectId, layout: entry.layout, revision: entry.revision }
  }

  get(projectId: string): LayoutState {
    const { layout, revision } = this.entry(projectId)
    return { projectId, layout, revision }
  }

  /**
   * Parses `op`, applies it and schedules the write. Keys the schema does not declare are
   * dropped; an invalid or refused operation throws and changes nothing. `screen` is the screen
   * that sent it, handed on to the listeners; null for a change made without one.
   */
  apply(projectId: string, op: LayoutOpInput, screen: string | null = null): LayoutState {
    const parsed = layoutOpSchema.safeParse(op)
    if (!parsed.success) throw new Error(`invalid layout operation\n${z.prettifyError(parsed.error)}`)
    const entry = this.entry(projectId)
    const now = this.now()
    entry.layout = touch(applyOp(entry.layout, parsed.data, now), touchedBy(parsed.data, screen), now)
    entry.revision += 1
    entry.dirty = true
    this.schedule(projectId, entry)

    const state = { projectId, layout: entry.layout, revision: entry.revision }
    for (const listener of this.listeners) {
      try {
        listener({ ...state, op: parsed.data, screen })
      } catch (error) {
        console.error('[layout] a change listener threw', error)
      }
    }
    return state
  }

  /** Called after every applied operation, whoever sent it. Returns the function that unsubscribes. */
  onChange(listener: (change: LayoutChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private schedule(projectId: string, entry: Entry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => this.flush(projectId), this.delayMs)
    entry.deadline ??= setTimeout(() => this.flush(projectId), this.maxDelayMs)
  }

  private static stopTimers(entry: Entry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    if (entry.deadline !== undefined) clearTimeout(entry.deadline)
    entry.timer = undefined
    entry.deadline = undefined
  }

  /** Writes the Project's Layout now if it has unsaved changes. A failed write is logged and retried on the next change. */
  flush(projectId: string): void {
    const entry = this.entries.get(projectId)
    if (!entry) return
    LayoutStore.stopTimers(entry)
    if (!entry.dirty) return
    try {
      this.write(this.file(projectId), entry.layout)
      entry.dirty = false
    } catch (error) {
      console.error(`[layout] could not save the Layout of ${projectId}`, error)
    }
  }

  flushAll(): void {
    for (const projectId of this.entries.keys()) this.flush(projectId)
  }

  /**
   * Drops the Project's Layout from memory, for a Project that has left the list: a later add reads
   * layout.json again, and quitting has nothing of it to write. The caller flushes first, while the
   * Project is still in the list; a change that write could not save is lost here, and said so.
   * The revision is kept: a later read goes on after it.
   */
  forget(projectId: string): void {
    const entry = this.entries.get(projectId)
    if (!entry) return
    LayoutStore.stopTimers(entry)
    this.entries.delete(projectId)
    this.forgottenRevisions.set(projectId, entry.revision)
    if (entry.dirty) console.error(`[layout] the Layout of ${projectId} had unsaved changes when its Project left the list; they are lost`)
  }
}

let shared: LayoutStore | undefined

/** The store of the running app, over the Projects' data folders. Creating it does no I/O. */
export function layoutStore(): LayoutStore {
  shared ??= new LayoutStore((projectId) => {
    const projects = projectStore()
    return projects.dataDir(projects.get(projectId).id)
  })
  return shared
}
