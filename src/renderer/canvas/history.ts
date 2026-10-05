// Undo and redo of the user's changes to the Layout (ticket 30): ⌘Z and ⇧⌘Z on the Canvas.
//
// main stays the only writer of the Layout (ADR-0003). Undoing a step sends its inverse operation to
// main through the same channel as every other operation, and redoing sends the operation again;
// deleting to the trash is undone by restoring the entry (src/shared/ipc/trash.ts). The inverse is
// computed from the Layout as the user saw it just before the operation.
//
// Only what the user does on the Canvas is recorded: the Canvas sends its operations through
// applyRecorded(). Operations made by main itself or by an agent through the canvas MCP tools never
// pass through here, so they are not in the user's history; an undo after them only reverts the
// user's own step.
//
// One history per Project, HISTORY_DEPTH steps deep: a 41st step pushes out the oldest. A new step
// clears what could be redone. Several operations made by one gesture (a drag of three Nodes, a tag
// given to the selection) are one step when they are made inside grouped().
import type { Layout, LayoutNode, LayoutOpInput } from '../../shared/layout/types'
import { trashRefusal, type TrashEntry } from '../../shared/ipc/trash'
import { invoke } from '../ipc'

/** How many steps can be undone. */
export const HISTORY_DEPTH = 40

/** Resolves to the reason main refused it, or undefined when it was applied. */
export type Send = (op: LayoutOpInput) => Promise<string | undefined>

/** One step of the history: both directions resolve to the reason they were refused, or undefined. */
export interface HistoryStep {
  undo(): Promise<string | undefined>
  redo(): Promise<string | undefined>
}

export class History {
  private past: HistoryStep[] = []
  private future: HistoryStep[] = []
  /** Undo and redo run one at a time, in the order they were asked for. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly depth: number = HISTORY_DEPTH) {}

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** How many steps can be undone now. */
  get size(): number {
    return this.past.length
  }

  push(step: HistoryStep): void {
    this.past.push(step)
    if (this.past.length > this.depth) this.past.splice(0, this.past.length - this.depth)
    this.future = []
  }

  /**
   * Undoes the latest step. Resolves to false when there was nothing to undo or main refused the
   * inverse (the Node is gone, an agent removed it): such a step is dropped, not retried.
   */
  undo(): Promise<boolean> {
    return this.run(() => this.past.pop(), 'undo', (step) => this.future.push(step))
  }

  /** Redoes the latest undone step; false when there was none or main refused it. */
  redo(): Promise<boolean> {
    return this.run(() => this.future.pop(), 'redo', (step) => this.past.push(step))
  }

  clear(): void {
    this.past = []
    this.future = []
  }

  private run(take: () => HistoryStep | undefined, direction: 'undo' | 'redo', done: (step: HistoryStep) => void): Promise<boolean> {
    const next = this.queue.then(async () => {
      const step = take()
      if (step === undefined) return false
      const error = await step[direction]()
      if (error !== undefined) {
        console.error(`${direction} was refused:`, error)
        return false
      }
      done(step)
      return true
    })
    this.queue = next.catch(() => undefined)
    return next
  }
}

const histories = new Map<string, History>()

/** The history of a Project's Canvas, made on first use. */
export function historyOf(projectId: string): History {
  let history = histories.get(projectId)
  if (history === undefined) {
    history = new History()
    histories.set(projectId, history)
  }
  return history
}

/** Forgets every Project's history; tests start from a clean one. */
export function resetHistories(): void {
  histories.clear()
}

const nodeOf = (layout: Layout, id: string): LayoutNode | undefined => layout.nodes.find((node) => node.id === id)

/**
 * The operation that reverts `op` on `layout`, or undefined when `op` is not recorded: the
 * viewport, a Node's data (a note's text has its own undo), a Node that is not there. A `create`
 * must carry its id (applyRecorded() gives it one).
 */
export function inverseOf(layout: Layout, op: LayoutOpInput): LayoutOpInput | undefined {
  if (op.op === 'setViewport' || op.op === 'patchData') return undefined
  if (op.op === 'create') return op.node.id === undefined ? undefined : { op: 'remove', id: op.node.id }
  const before = nodeOf(layout, op.id)
  if (before === undefined) return undefined
  switch (op.op) {
    case 'move':
      return { op: 'move', id: op.id, x: before.x, y: before.y }
    case 'resize':
      return { op: 'resize', id: op.id, w: before.w, h: before.h, x: before.x, y: before.y }
    case 'hide':
      return before.hidden === op.hidden ? undefined : { op: 'hide', id: op.id, hidden: before.hidden }
    case 'remove':
      return { op: 'create', node: before }
    case 'pin':
      return { op: 'pin', id: op.id, pinned: before.pinned, x: before.x, y: before.y, w: before.w, h: before.h }
    case 'tag': {
      const had = new Set(before.tags)
      const removed = new Set(op.remove ?? [])
      // What the operation added must go again, what it took away must come back.
      const add = [...removed].filter((tag) => had.has(tag))
      const remove = [...new Set(op.add ?? [])].filter((tag) => !had.has(tag) && !removed.has(tag))
      return add.length === 0 && remove.length === 0 ? undefined : { op: 'tag', id: op.id, add, remove }
    }
  }
}

interface Group {
  projectId: string | undefined
  steps: HistoryStep[]
}

let openGroup: Group | undefined

/** Several steps that are undone and redone as one: undone newest first, redone in order. */
function combine(steps: readonly HistoryStep[]): HistoryStep {
  const each = async (list: readonly HistoryStep[], direction: 'undo' | 'redo'): Promise<string | undefined> => {
    let first: string | undefined
    // Every part runs, even after one was refused; the first refusal is the step's answer.
    for (const step of list) {
      const error = await step[direction]()
      first ??= error
    }
    return first
  }
  return {
    undo: () => each([...steps].reverse(), 'undo'),
    redo: () => each(steps, 'redo'),
  }
}

/** Adds a step to the Project's history, or to the group being made. */
export function record(projectId: string, step: HistoryStep): void {
  if (openGroup !== undefined) {
    openGroup.projectId ??= projectId
    if (openGroup.projectId === projectId) {
      openGroup.steps.push(step)
      return
    }
  }
  historyOf(projectId).push(step)
}

/** Runs `make`; the steps it records become one step of the history. Nested calls join the outer one. */
export async function grouped<T>(make: () => Promise<T>): Promise<T> {
  if (openGroup !== undefined) return make()
  const group: Group = { projectId: undefined, steps: [] }
  openGroup = group
  try {
    return await make()
  } finally {
    openGroup = undefined
    if (group.projectId !== undefined && group.steps.length > 0) {
      historyOf(group.projectId).push(group.steps.length === 1 ? group.steps[0]! : combine(group.steps))
    }
  }
}

const newNodeId = (): string => crypto.randomUUID()

/**
 * Sends an operation the user made on the Canvas and records it. `layout` is the Layout the user
 * saw before it. A `create` without an id gets one here, so that its undo can name the Node.
 */
export async function applyRecorded(projectId: string, layout: Layout, op: LayoutOpInput, send: Send): Promise<string | undefined> {
  const sent: LayoutOpInput = op.op === 'create' && op.node.id === undefined ? { ...op, node: { ...op.node, id: newNodeId() } } : op
  const inverse = inverseOf(layout, sent)
  const error = await send(sent)
  if (error === undefined && inverse !== undefined) record(projectId, { undo: () => send(inverse), redo: () => send(sent) })
  return error
}

/** What deleting to the trash and restoring from it go through; tests pass a fake. */
export interface TrashClient {
  put(projectId: string, nodeId: string): Promise<{ ok: true; value: TrashEntry } | { ok: false; error: string }>
  restore(projectId: string, label: string): Promise<{ ok: true; value: TrashEntry } | { ok: false; error: string }>
}

export const ipcTrash: TrashClient = {
  put: (projectId, nodeId) => invoke('trash.put', { projectId, nodeId }),
  restore: (projectId, label) => invoke('trash.restore', { projectId, label }),
}

/**
 * Deletes a Node to the trash and records the step: undo restores the entry, redo deletes the Node
 * again (into a new entry). Resolves to the reason main refused, or undefined.
 */
export async function trashRecorded(projectId: string, nodeId: string, trash: TrashClient = ipcTrash): Promise<string | undefined> {
  const first = await trash.put(projectId, nodeId)
  if (!first.ok) return first.error
  let label = first.value.label
  record(projectId, {
    undo: async () => {
      const result = await trash.restore(projectId, label)
      return result.ok ? undefined : result.error
    },
    redo: async () => {
      const result = await trash.put(projectId, nodeId)
      if (!result.ok) return result.error
      label = result.value.label
      return undefined
    },
  })
  return undefined
}

/** The Nodes of a selection the user may delete (trashRefusal); main still has the last word. */
export const deletableNodes = (nodes: readonly LayoutNode[]): LayoutNode[] => nodes.filter((node) => trashRefusal(node) === null)

/**
 * Deletes what may be deleted of the Nodes to the Project's trash, one after another, as one step
 * of the history. Resolves to main's refusals (a Session that runs, a Node gone meanwhile); empty
 * when all went.
 */
export async function deleteToTrash(projectId: string, nodes: readonly LayoutNode[], trash: TrashClient = ipcTrash): Promise<string[]> {
  const refusals: string[] = []
  await grouped(async () => {
    for (const node of deletableNodes(nodes)) {
      const refusal = await trashRecorded(projectId, node.id, trash)
      if (refusal !== undefined) refusals.push(refusal)
    }
  })
  return refusals
}
