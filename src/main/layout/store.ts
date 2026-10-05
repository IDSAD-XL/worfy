// The Layout of each Project's Canvas, kept in `<Project data folder>/layout.json` (ADR-0005).
// main is the only writer (ADR-0003): the renderer sends operations over IPC
// (src/main/ipc/layout.ts), the MCP tools of ticket 24 will call apply() directly, and both go
// through the same schema check here. The process applies operations one at a time, in the order
// they arrive, so the last operation on a Node wins and two callers can never interleave halfway.
//
// Operations change the Layout in memory at once; the file is written after a quiet period
// (LAYOUT_SAVE_DELAY_MS since the last operation), and right away by flush() — the IPC module
// calls flushAll() when the app quits.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { EMPTY_LAYOUT, layoutOpSchema, layoutSchema, type Layout, type LayoutNode, type LayoutOp, type LayoutOpInput, type LayoutState } from '../../shared/layout/types'
import { projectStore } from '../projects/store'
import { readJsonFile, writeJsonFile } from '../storage/json-file'

/** How long the Layout must stay unchanged before it is written. */
export const LAYOUT_SAVE_DELAY_MS = 250

export const LAYOUT_FILE = 'layout.json'

export interface LayoutChange extends LayoutState {
  /** The operation that made this change, after parsing. */
  op: LayoutOp
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

/** Applies one parsed operation to a Layout; returns the new Layout. Throws when it is refused. */
function applyOp(layout: Layout, op: LayoutOp): Layout {
  if (op.op === 'setViewport') return { ...layout, viewport: op.viewport }

  if (op.op === 'create') {
    const id = op.node.id ?? randomUUID()
    if (layout.nodes.some((node) => node.id === id)) throw new Error(`The Layout already has a Node with id ${id}`)
    return { ...layout, nodes: [...layout.nodes, { ...op.node, id }] }
  }

  const index = layout.nodes.findIndex((node) => node.id === op.id)
  const current = layout.nodes[index]
  if (current === undefined) throw new Error(`The Layout has no Node with id ${op.id}`)

  if (op.op === 'remove') {
    if (current.locked) throw new Error(`Node ${op.id} is locked and cannot be removed`)
    return { ...layout, nodes: layout.nodes.filter((node) => node.id !== op.id) }
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
  }
  const nodes = [...layout.nodes]
  nodes[index] = next
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
      entry = { layout: readJsonFile(file, layoutSchema) ?? EMPTY_LAYOUT, revision: 0, timer: undefined, dirty: false }
      this.entries.set(projectId, entry)
    }
    return entry
  }

  get(projectId: string): LayoutState {
    const { layout, revision } = this.entry(projectId)
    return { projectId, layout, revision }
  }

  /**
   * Parses `op`, applies it and schedules the write. Keys the schema does not declare are
   * dropped; an invalid or refused operation throws and changes nothing.
   */
  apply(projectId: string, op: LayoutOpInput): LayoutState {
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
        listener({ ...state, op: parsed.data })
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
