// Undo and redo of the user's changes to the Layout (ticket 30): ⌘Z and ⇧⌘Z on the Canvas.
//
// main stays the only writer of the Layout (ADR-0003). Undoing a step sends its inverse operation to
// main through the same channel as every other operation, and redoing sends the operation again;
// deleting to the trash is undone by restoring the entry (src/shared/ipc/trash.ts). The inverse is
// computed from the renderer's copy of the Layout just before the operation is sent.
//
// Only what the user does on the Canvas is recorded: the Canvas's LayoutOps (Canvas.tsx, the
// LayoutOpsContext of useLayout.ts) send the user's gestures through applyRecorded(). Everything
// else writes the Layout without a step: main itself, an agent through the canvas MCP tools, and the
// renderer's automatic writers (the Session Nodes sync, the Epic and Subagent sources), which call
// applyLayoutOp() directly. An undo after them only reverts the user's own step.
//
// One history per Project, HISTORY_DEPTH steps deep: a 41st step pushes out the oldest. A new step
// clears what could be redone. Several operations made by one gesture (a drag of three Nodes, a tag
// given to the selection) are one step when they are recorded into the Group that grouped() gives.
// Such a step takes its place in the history when its first operation is recorded, not when the
// gesture ends: a gesture that waits on main keeps its place below a gesture that started later.
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
  /**
   * Resolves when the step is complete. A gesture's step is in the history from its first operation
   * and complete when the gesture is over; a step without it is complete when pushed.
   */
  readonly complete?: Promise<void>
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

  /** A change was made that belongs to a step already in the history: what was undone can no longer be redone. */
  dropRedo(): void {
    this.future = []
  }

  /**
   * Undoes the latest step. Resolves to false when there was nothing to undo or main refused the
   * inverse (the Node is gone, an agent removed it): such a step is dropped, not retried.
   *
   * When the latest step is a gesture still waiting on main, the undo waits for the gesture to be
   * over and then undoes all of it. Undoing only the operations recorded so far would let the rest
   * land afterwards and leave the Node where it never was, neither before nor after the gesture.
   */
  undo(): Promise<boolean> {
    return this.run(() => this.past, 'undo', (step) => this.future.push(step))
  }

  /** Redoes the latest undone step; false when there was none or main refused it. */
  redo(): Promise<boolean> {
    return this.run(() => this.future, 'redo', (step) => this.past.push(step))
  }

  clear(): void {
    this.past = []
    this.future = []
  }

  private run(stack: () => HistoryStep[], direction: 'undo' | 'redo', done: (step: HistoryStep) => void): Promise<boolean> {
    const next = this.queue.then(async () => {
      // Wait until the latest step is complete; another gesture may take the top meanwhile.
      for (let top = stack().at(-1); top?.complete !== undefined; ) {
        await top.complete
        const now = stack().at(-1)
        if (now === top) break
        top = now
      }
      const step = stack().pop()
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
  if (op.op === 'moveMany') {
    // The same group operation with the old places: main checks the group as a whole again (ADR-0038).
    const moves = op.moves.flatMap(({ id }) => {
      const node = nodeOf(layout, id)
      return node === undefined ? [] : [{ id, x: node.x, y: node.y }]
    })
    return moves.length === 0 ? undefined : { op: 'moveMany', moves }
  }
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

/**
 * The steps of one gesture, gathered while it runs into one step of the history. That step is pushed
 * when the first of them is recorded, so it keeps its place below a gesture that started later and
 * ended sooner; it is complete when grouped() closes the group. The group is handed to every
 * operation of the gesture explicitly, so an operation of another gesture that finishes meanwhile
 * never joins it: it is a step of its own, below this one when it finishes before the first step
 * here is recorded.
 */
export class Group {
  private readonly steps: HistoryStep[] = []
  private projectId: string | undefined
  private open = true
  private finish: () => void = () => undefined
  private readonly complete = new Promise<void>((resolve) => (this.finish = resolve))

  /** Takes the step unless the gesture is over or the step is of another Project. */
  add(projectId: string, step: HistoryStep): boolean {
    if (!this.open) return false
    this.projectId ??= projectId
    if (this.projectId !== projectId) return false
    this.steps.push(step)
    const history = historyOf(projectId)
    if (this.steps.length === 1) history.push({ ...combine(this.steps), complete: this.complete })
    else history.dropRedo()
    return true
  }

  close(): void {
    this.open = false
    this.finish()
  }
}

/**
 * Several steps that are undone and redone as one: undone newest first, redone in order. The list is
 * read when the step runs, so the parts a gesture records later belong to it.
 */
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

/** Adds a step to the gesture's group, or to the Project's history when there is none or the group does not take it. */
export function record(projectId: string, step: HistoryStep, group?: Group): void {
  if (group?.add(projectId, step) === true) return
  historyOf(projectId).push(step)
}

/** Runs `make` with a new Group; the steps recorded into that group become one step of the history. */
export async function grouped<T>(make: (group: Group) => Promise<T>): Promise<T> {
  const group = new Group()
  try {
    return await make(group)
  } finally {
    group.close()
  }
}

/**
 * The operation one drag of Layout Nodes sends: a `move` for one Node, one `moveMany` for several.
 * One drag is one operation and one step of the history, however many Nodes it moved, and main
 * checks the dragged Nodes as one group, so none of them is put off a neighbour from the same
 * selection that has not moved yet (ADR-0038).
 */
export function dropOperation(dragged: readonly { id: string; position: { x: number; y: number } }[]): LayoutOpInput | undefined {
  const moves = dragged.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y }))
  if (moves.length === 0) return undefined
  return moves.length === 1 ? { op: 'move', ...moves[0]! } : { op: 'moveMany', moves }
}

const newNodeId = (): string => crypto.randomUUID()

/** What a recorded operation goes through. */
export interface LayoutChannel {
  /** Sends one operation to main. */
  send: Send
  /** The Project's Layout as the renderer has it now (main's latest answer). */
  layout(): Layout
}

type NodeInput = Extract<LayoutOpInput, { op: 'create' }>['node']

/**
 * Taking a Node away and bringing it back. What comes back is the Node as it was when it was last
 * taken away, read from the Layout at that moment: the text typed into a note after it was created
 * (patchData, not a step of its own) comes back with it.
 */
function takeAndBring(id: string, first: NodeInput, channel: LayoutChannel): { take(): Promise<string | undefined>; bring(): Promise<string | undefined> } {
  let kept: NodeInput = first
  return {
    take() {
      const now = nodeOf(channel.layout(), id)
      if (now !== undefined) kept = now
      return channel.send({ op: 'remove', id })
    },
    bring: () => channel.send({ op: 'create', node: kept }),
  }
}

/**
 * Sends an operation the user made on the Canvas and records it, into `group` when it is part of a
 * gesture. The inverse is computed from channel.layout() just before sending. A `create` without an
 * id gets one here, so that its undo can name the Node.
 */
export async function applyRecorded(projectId: string, op: LayoutOpInput, channel: LayoutChannel, group?: Group): Promise<string | undefined> {
  const sent: LayoutOpInput = op.op === 'create' && op.node.id === undefined ? { ...op, node: { ...op.node, id: newNodeId() } } : op
  const inverse = inverseOf(channel.layout(), sent)
  const error = await channel.send(sent)
  if (error !== undefined || inverse === undefined) return error
  let step: HistoryStep
  if (sent.op === 'create' && inverse.op === 'remove') {
    const node = takeAndBring(inverse.id, sent.node, channel)
    step = { undo: node.take, redo: node.bring }
  } else if (sent.op === 'remove' && inverse.op === 'create') {
    const node = takeAndBring(sent.id, inverse.node, channel)
    step = { undo: node.bring, redo: node.take }
  } else {
    step = { undo: () => channel.send(inverse), redo: () => channel.send(sent) }
  }
  record(projectId, step, group)
  return undefined
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
export async function trashRecorded(projectId: string, nodeId: string, trash: TrashClient = ipcTrash, group?: Group): Promise<string | undefined> {
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
  }, group)
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
  await grouped(async (group) => {
    for (const node of deletableNodes(nodes)) {
      const refusal = await trashRecorded(projectId, node.id, trash, group)
      if (refusal !== undefined) refusals.push(refusal)
    }
  })
  return refusals
}
