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
// Operations change the Layout in memory at once; the file is written after a quiet period
// (LAYOUT_SAVE_DELAY_MS since the last operation), and right away by flush() — the IPC module
// calls flushAll() when the app quits.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { freePlace, freeShift, isParticipant, obstaclesFor, stopResize } from '../../shared/layout/free-place'
import { EMPTY_LAYOUT, layoutOpSchema, layoutSchema, type Layout, type LayoutNode, type LayoutOp, type LayoutOpInput, type LayoutState } from '../../shared/layout/types'
import { projectStore } from '../projects/store'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { upgradeLayout, upgradeMessages } from './upgrade'

/** How long the Layout must stay unchanged before it is written. */
export const LAYOUT_SAVE_DELAY_MS = 250

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
}

interface Entry {
  layout: Layout
  revision: number
  timer: ReturnType<typeof setTimeout> | undefined
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

/**
 * Applies one parsed operation to a Layout; returns the new Layout. Throws when it is refused. An
 * operation that puts a Node on the plane is corrected so that the Node overlaps none (ADR-0038).
 */
function applyOp(layout: Layout, op: LayoutOp): Layout {
  if (op.op === 'moveMany') return moveMany(layout, op)

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
  }
  const nodes = [...layout.nodes]
  nodes[index] = next
  // Data and tags do not move a Node; the operations that put it somewhere on the plane are corrected.
  if (op.op === 'move' || op.op === 'resize' || op.op === 'hide' || op.op === 'pin') nodes[index] = settle(nodes, index, current, op)
  return { ...layout, nodes }
}

export class LayoutStore {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<(change: LayoutChange) => void>()
  private readonly write: (file: string, layout: Layout) => void
  private readonly delayMs: number

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
      entry = { layout: upgraded?.layout ?? read, revision: 0, timer: undefined, dirty: false }
      this.entries.set(projectId, entry)
      if (upgraded) {
        for (const line of upgradeMessages(projectId, upgraded)) console.info(line)
        entry.dirty = true
        this.flush(projectId)
      }
    }
    return entry
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
    entry.layout = applyOp(entry.layout, parsed.data)
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
  }

  /** Writes the Project's Layout now if it has unsaved changes. A failed write is logged and retried on the next change. */
  flush(projectId: string): void {
    const entry = this.entries.get(projectId)
    if (!entry) return
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    entry.timer = undefined
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
