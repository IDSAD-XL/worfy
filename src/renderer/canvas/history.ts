// Undo and redo of the user's changes to the Layout (ticket 30): ⌘Z and ⇧⌘Z on the Canvas.
//
// main stays the only writer of the Layout (ADR-0003). Undoing a step sends its inverse operation to
// main through the same channel as every other operation, and redoing sends the operation again;
// deleting to the trash is undone by restoring the entry (src/shared/ipc/trash.ts). The inverse is
// computed from the renderer's copy of the Layout just before the operation is sent.
//
// Only what the user does on the Canvas is recorded: the Canvas's LayoutOps (Canvas.tsx, the
// LayoutOpsContext of useLayout.ts) send the user's gestures through applyRecorded(), the gestures
// on an Epic frame too — its drag and its collapse button (sources/epics.ts, worfy-week ticket 08).
// Everything else writes the Layout without a step: main itself, an agent through the canvas MCP
// tools, and the renderer's automatic writers (the Session Nodes sync, the Subagent source), which
// call applyLayoutOp() directly. An undo after them only reverts the user's own step.
//
// One history per Project, HISTORY_DEPTH steps deep: a 41st step pushes out the oldest. A new step
// clears what could be redone. Several operations made by one gesture (a drag of three Nodes, a tag
// given to the selection) are one step when they are recorded into the Group that grouped() gives.
// Such a step takes its place in the history when its first operation is recorded, not when the
// gesture ends: a gesture that waits on main keeps its place below a gesture that started later.
//
// ⌘Z undoes only this screen's changes (worfy-link ticket 07, ADR-0053): a window of worfy, here or
// on a Linked machine, is a screen with its own history. Each step remembers the Nodes it changes,
// which side of them (place and size, visibility, data keys, tags, existence) and the Layout's
// revision after it. A `layout.changed` from another screen (screen.ts) with a later revision that
// changes the same side of the same Node puts the step out of date; ⌘Z on such a step drops it
// without sending anything and raises the notice (overlays/UndoSkipped.tsx). Changes without a
// screen — main, agents, the automatic writers — leave steps alone, as before.
import { createStore } from 'zustand/vanilla'
import type { ArchiveRule, Layout, LayoutNode, LayoutOpInput } from '../../shared/layout/types'
import { trashRefusal, type TrashEntry } from '../../shared/ipc/trash'
import { invoke } from '../ipc'
import { readOnlyNow } from '../projects/read-only-now'
import { screenId } from './screen'

/** How many steps can be undone. */
export const HISTORY_DEPTH = 40

/**
 * main's answer to one operation: the reason it refused it, or, when it applied it, the revision of
 * the Layout after it — or undefined when the channel does not tell the revision.
 */
export type SendAnswer = string | { revision: number } | undefined

/** Resolves to the reason main refused it, or to what it applied (SendAnswer). */
export type Send = (op: LayoutOpInput) => Promise<SendAnswer>

const refusalOf = (answer: SendAnswer): string | undefined => (typeof answer === 'string' ? answer : undefined)
const revisionOf = (answer: SendAnswer): number | undefined => (typeof answer === 'object' ? answer.revision : undefined)

/** One step of the history: both directions resolve to the reason they were refused, or undefined. */
export interface HistoryStep {
  undo(): Promise<string | undefined>
  redo(): Promise<string | undefined>
  /**
   * Resolves when the step is complete. A gesture's step is in the history from its first operation
   * and complete when the gesture is over; a step without it is complete when pushed.
   */
  readonly complete?: Promise<void>
  /** True when another screen changed what this step changes since it was last done or undone. */
  stale?(): boolean
  /** The step leaves the history for good; it stops following the changes of other screens. */
  drop?(): void
}

/** What undo() and redo() did: true — done; false — nothing to do or main refused; 'skipped' — out of date. */
export type StepOutcome = boolean | 'skipped'

export class History {
  private past: HistoryStep[] = []
  private future: HistoryStep[] = []
  /** Undo and redo run one at a time, in the order they were asked for. */
  private queue: Promise<unknown> = Promise.resolve()

  /** `skipped` hears of every step dropped as out of date, with the direction asked for. */
  constructor(
    private readonly depth: number = HISTORY_DEPTH,
    private readonly skipped: (direction: Direction) => void = () => undefined,
  ) {}

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
    if (this.past.length > this.depth) dropAll(this.past.splice(0, this.past.length - this.depth))
    this.dropRedo()
  }

  /** A change was made that belongs to a step already in the history: what was undone can no longer be redone. */
  dropRedo(): void {
    dropAll(this.future)
    this.future = []
  }

  /**
   * Undoes the latest step. Resolves to false when there was nothing to undo or main refused the
   * inverse (the Node is gone, an agent removed it): such a step is dropped, not retried. Resolves
   * to 'skipped' when another screen changed the step's Nodes since (worfy-link ticket 07): the step
   * is dropped whole, nothing is sent, and the notice goes up; the next ⌘Z undoes the step below.
   *
   * When the latest step is a gesture still waiting on main, the undo waits for the gesture to be
   * over and then undoes all of it. Undoing only the operations recorded so far would let the rest
   * land afterwards and leave the Node where it never was, neither before nor after the gesture.
   */
  undo(): Promise<StepOutcome> {
    return this.run(() => this.past, 'undo', (step) => this.future.push(step))
  }

  /** Redoes the latest undone step; false when there was none or main refused it, 'skipped' as for undo(). */
  redo(): Promise<StepOutcome> {
    return this.run(() => this.future, 'redo', (step) => this.past.push(step))
  }

  clear(): void {
    dropAll(this.past)
    dropAll(this.future)
    this.past = []
    this.future = []
  }

  private run(stack: () => HistoryStep[], direction: Direction, done: (step: HistoryStep) => void): Promise<StepOutcome> {
    const next = this.queue.then(async () => {
      // A read-only screen (worfy-link ticket 25) changes nothing; the steps stay for when it may again.
      if (readOnlyNow() !== null) return false
      // Wait until the latest step is complete; another gesture may take the top meanwhile.
      for (let top = stack().at(-1); top?.complete !== undefined; ) {
        await top.complete
        const now = stack().at(-1)
        if (now === top) break
        top = now
      }
      const step = stack().pop()
      if (step === undefined) return false
      if (step.stale?.() === true) {
        step.drop?.()
        this.skipped(direction)
        return 'skipped'
      }
      const error = await step[direction]()
      if (error !== undefined) {
        console.error(`${direction} was refused:`, error)
        step.drop?.()
        return false
      }
      done(step)
      return true
    })
    this.queue = next.catch(() => undefined)
    return next
  }
}

type Direction = 'undo' | 'redo'

const dropAll = (steps: readonly HistoryStep[]): void => {
  for (const step of steps) step.drop?.()
}

const histories = new Map<string, History>()

/** The history of a Project's Canvas, made on first use. */
export function historyOf(projectId: string): History {
  let history = histories.get(projectId)
  if (history === undefined) {
    history = new History(HISTORY_DEPTH, (direction) => showSkipped(projectId, direction))
    histories.set(projectId, history)
  }
  return history
}

/** Forgets every Project's history, what other screens changed and the notice; tests start from a clean one. */
export function resetHistories(): void {
  histories.clear()
  watches.clear()
  hideSkipped()
}

// ── Changes made on another screen (worfy-link ticket 07) ────────────────────────────────────────

/** How long the notice of a skipped step stays up. */
export const SKIPPED_NOTICE_MS = 4000

/** The notice that ⌘Z or ⇧⌘Z skipped a step another screen had changed since. */
export interface SkippedNotice {
  projectId: string
  direction: Direction
  /** Grows with every skip, so the same notice raised twice is shown afresh. */
  count: number
}

/** The notice of the latest skipped step, null when none is up. overlays/UndoSkipped.tsx shows it. */
export const skippedNotice = createStore<{ notice: SkippedNotice | null }>(() => ({ notice: null }))

let noticeTimer: ReturnType<typeof setTimeout> | undefined
let noticeCount = 0

function showSkipped(projectId: string, direction: Direction): void {
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  noticeCount += 1
  skippedNotice.setState({ notice: { projectId, direction, count: noticeCount } })
  noticeTimer = setTimeout(hideSkipped, SKIPPED_NOTICE_MS)
}

/** Takes the notice down. */
export function hideSkipped(): void {
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  noticeTimer = undefined
  skippedNotice.setState({ notice: null })
}

/**
 * A side of a Node an operation changes: its place and size (`move`, `moveMany`, `resize`, `pin`,
 * `restore`), its visibility (`hide`, `archive`, `restore`), one key of its data (`patchData`), its
 * tags (`tag`), its Keep flag (`keep`) or its existence (`create`, `remove`, the trash). Existence
 * meets every side: a Node removed or brought back is changed whole. A `touch` changes no side.
 */
type Side = 'place' | 'visibility' | 'tags' | 'keep' | 'existence' | `data:${string}`

/** The sides of each Node an operation changes, by Node id. */
export type Footprint = ReadonlyMap<string, ReadonlySet<Side>>

/** What `op` changes, Node by Node; nothing for a `create` without an id. */
export function footprintOf(op: LayoutOpInput): Footprint {
  const one = (id: string, ...sides: Side[]): Footprint => new Map([[id, new Set(sides)]])
  switch (op.op) {
    case 'create':
      return op.node.id === undefined ? new Map() : one(op.node.id, 'existence')
    case 'remove':
      return one(op.id, 'existence')
    case 'move':
    case 'resize':
    case 'pin':
      return one(op.id, 'place')
    case 'moveMany':
      return new Map(op.moves.map(({ id }) => [id, new Set<Side>(['place'])]))
    case 'hide':
      return one(op.id, 'visibility')
    case 'tag':
      return one(op.id, 'tags')
    case 'patchData':
      return one(op.id, ...Object.keys(op.data).map((key): Side => `data:${key}`))
    case 'archive':
      return new Map(op.nodes.map(({ id }) => [id, new Set<Side>(['visibility'])]))
    case 'restore':
      return new Map(op.ids.map((id) => [id, new Set<Side>(['visibility', 'place'])]))
    case 'keep':
      return one(op.id, 'keep')
    case 'touch':
      return new Map()
  }
}

/** True when the two change a common side of a common Node. */
function overlaps(a: Footprint, b: Footprint): boolean {
  for (const [id, sides] of a) {
    const theirs = b.get(id)
    if (theirs === undefined) continue
    if (sides.has('existence') || theirs.has('existence')) return true
    for (const side of sides) if (theirs.has(side)) return true
  }
  return false
}

/** One change of the Layout as `layout.changed` tells it. */
export interface LayoutChangeNote {
  projectId: string
  revision: number
  /** The screen that sent the operation; null without one (main, an agent, an automatic writer). */
  screen: string | null
  op: LayoutOpInput
}

interface Seen {
  revision: number
  /** True for this screen's own change. */
  own: boolean
  footprint: Footprint
}

/** How many of a Project's latest changes made with a screen are kept to compare later steps with. */
const SEEN_KEPT = 200

/**
 * The changes of one Project's Layout made with a screen, as they arrive, and the marks of the
 * steps that follow them. The latest few are kept: main's answer to a step can arrive after the
 * broadcast of another screen's change that main applied later.
 */
class Watch {
  readonly seen: Seen[] = []
  readonly marks = new Set<Mark>()

  note(change: Seen): void {
    this.seen.push(change)
    if (this.seen.length > SEEN_KEPT) this.seen.splice(0, this.seen.length - SEEN_KEPT)
    if (!change.own) for (const mark of this.marks) mark.see(change)
  }

  /** The revision of the latest change here; undefined before any. */
  latest(): number | undefined {
    return this.seen.at(-1)?.revision
  }

  /**
   * The revision of this screen's latest change of `footprint` later than `after` — the change a
   * trash call just made, which main broadcasts before it answers; undefined when it is not here.
   */
  ownRevision(footprint: Footprint, after: number | undefined): number | undefined {
    for (let index = this.seen.length - 1; index >= 0; index -= 1) {
      const change = this.seen[index]!
      if (after !== undefined && change.revision <= after) return undefined
      if (change.own && overlaps(change.footprint, footprint)) return change.revision
    }
    return undefined
  }
}

const watches = new Map<string, Watch>()

function watchOf(projectId: string): Watch {
  let watch = watches.get(projectId)
  if (watch === undefined) {
    watch = new Watch()
    watches.set(projectId, watch)
  }
  return watch
}

/**
 * What one part of a step changed and whether another screen has changed it since. `revision` is
 * the Layout's revision after the part was last done or undone; undefined when the channel did not
 * tell it, and then every change of another screen that arrives from now on counts.
 */
class Mark {
  private out = false

  constructor(
    private readonly watch: Watch,
    private readonly footprint: Footprint,
    private revision: number | undefined,
  ) {
    watch.marks.add(this)
    this.catchUp()
  }

  get stale(): boolean {
    return this.out
  }

  see(change: Seen): void {
    if (this.out || (this.revision !== undefined && change.revision <= this.revision)) return
    if (overlaps(this.footprint, change.footprint)) this.out = true
  }

  /** The part was undone or redone: the Layout's revision after that, if known. */
  moved(revision: number | undefined): void {
    this.revision = revision
    this.catchUp()
  }

  drop(): void {
    this.watch.marks.delete(this)
  }

  /** Another screen's changes that arrived before main's answer and came after it. */
  private catchUp(): void {
    if (this.revision === undefined) return
    for (const change of this.watch.seen) if (!change.own) this.see(change)
  }
}

/**
 * Hears every `layout.changed` (useLayout.ts subscribes it): a change another screen made puts the
 * steps it meets out of date. A change without a screen is not followed.
 */
export function noteLayoutChange(change: LayoutChangeNote): void {
  if (change.screen === null) return
  watchOf(change.projectId).note({ revision: change.revision, own: change.screen === screenId(), footprint: footprintOf(change.op) })
}

/** The step's undo and redo, with its mark keeping track of other screens' changes. */
function marked(mark: Mark, step: { undo(): Promise<SendAnswer>; redo(): Promise<SendAnswer> }): HistoryStep {
  const run = async (direction: Direction): Promise<string | undefined> => {
    const answer = await step[direction]()
    const refusal = refusalOf(answer)
    if (refusal === undefined) mark.moved(revisionOf(answer))
    return refusal
  }
  return { undo: () => run('undo'), redo: () => run('redo'), stale: () => mark.stale, drop: () => mark.drop() }
}

const nodeOf = (layout: Layout, id: string): LayoutNode | undefined => layout.nodes.find((node) => node.id === id)

/** How an operation is recorded. */
export interface RecordOptions {
  /**
   * Record a `patchData` too. By default a Node's data is not a step (a note's text has its own
   * undo); a gesture whose whole effect is a data key, as collapsing an Epic frame, asks for it.
   */
  data?: boolean
}

/**
 * The operation that reverts `op` on `layout`, or undefined when `op` is not recorded: a Node's
 * data unless `options.data` (a note's text has its own undo), a Node that is not there. A `create` must carry its id (applyRecorded() gives it one).
 * A `restore` is reverted by several operations, sent in their order.
 */
export function inverseOf(layout: Layout, op: LayoutOpInput, options: RecordOptions = {}): LayoutOpInput | LayoutOpInput[] | undefined {
  // The archive is main's own operation (ADR-0076) and a touch changes nothing to undo; «Archive
  // now» gets its step with its ticket (worfy-canvas 08). The user's `restore` is undone by
  // several operations: archiving the Nodes again and moving them back (restoreInverse).
  if (op.op === 'archive' || op.op === 'touch') return undefined
  if (op.op === 'restore') return restoreInverse(layout, op)
  if (op.op === 'patchData') return options.data === true ? dataInverse(layout, op) : undefined
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
    case 'keep': {
      const had = before.keep === true
      return had === op.keep ? undefined : { op: 'keep', id: op.id, keep: had }
    }
  }
}

/**
 * What takes back the Nodes a `restore` brings back: one `archive` per batch, each Node with the
 * rule and the time of its record, then a move of each to the place it had in the archive. The
 * restore may have put a Node elsewhere (its old place was taken, ADR-0038); archived first, the
 * Node is off the plane and in nobody's way, so the move puts it exactly back. Undefined when none
 * of them is archived (the restore changes nothing).
 */
function restoreInverse(layout: Layout, op: Extract<LayoutOpInput, { op: 'restore' }>): LayoutOpInput[] | undefined {
  const batches = new Map<string, { id: string; rule: ArchiveRule; at: number }[]>()
  const moves: { id: string; x: number; y: number }[] = []
  for (const id of op.ids) {
    const node = nodeOf(layout, id)
    const record = node?.archived
    if (node === undefined || record == null) continue
    const batch = batches.get(record.batch) ?? []
    batches.set(record.batch, [...batch, { id, rule: record.rule, at: record.at }])
    // A pinned Node keeps screen pixels and is not moved by a restore.
    if (!node.pinned) moves.push({ id, x: node.x, y: node.y })
  }
  if (batches.size === 0) return undefined
  const archives: LayoutOpInput[] = [...batches].map(([batch, nodes]) => ({ op: 'archive', batch, nodes }))
  if (moves.length === 0) return archives
  return [...archives, moves.length === 1 ? { op: 'move', ...moves[0]! } : { op: 'moveMany', moves }]
}

/**
 * A `patchData` that puts back the old values of the keys `op` patches. A key the Node did not have
 * comes back as null: main merges data and cannot drop a key, and a reader takes null as absent
 * (sources/epics.ts reads a `collapsed` that is not a boolean as the default). Undefined when the
 * Node is not there or `op` changes nothing.
 */
function dataInverse(layout: Layout, op: Extract<LayoutOpInput, { op: 'patchData' }>): LayoutOpInput | undefined {
  const before = nodeOf(layout, op.id)
  if (before === undefined) return undefined
  const keys = Object.keys(op.data)
  const old = (key: string): unknown => (Object.hasOwn(before.data, key) ? before.data[key] : null)
  if (keys.every((key) => JSON.stringify(old(key)) === JSON.stringify(op.data[key]))) return undefined
  return { op: 'patchData', id: op.id, data: Object.fromEntries(keys.map((key) => [key, old(key)])) }
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
 * read when the step runs, so the parts a gesture records later belong to it. It is out of date when
 * one of its parts is: a gesture is skipped whole.
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
    stale: () => steps.some((step) => step.stale?.() === true),
    drop: () => dropAll(steps),
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
function takeAndBring(id: string, first: NodeInput, channel: LayoutChannel): { take(): Promise<SendAnswer>; bring(): Promise<SendAnswer> } {
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

/** Sends the operations one after another; stops at the first refusal and answers with it, else with the last answer. */
async function sendInOrder(channel: LayoutChannel, ops: readonly LayoutOpInput[]): Promise<SendAnswer> {
  let answer: SendAnswer
  for (const op of ops) {
    answer = await channel.send(op)
    if (refusalOf(answer) !== undefined) return answer
  }
  return answer
}

/**
 * Sends an operation the user made on the Canvas and records it, into `group` when it is part of a
 * gesture. The inverse is computed from channel.layout() just before sending. A `create` without an
 * id gets one here, so that its undo can name the Node.
 */
export async function applyRecorded(projectId: string, op: LayoutOpInput, channel: LayoutChannel, group?: Group, options?: RecordOptions): Promise<string | undefined> {
  const sent: LayoutOpInput = op.op === 'create' && op.node.id === undefined ? { ...op, node: { ...op.node, id: newNodeId() } } : op
  const inverse = inverseOf(channel.layout(), sent, options)
  const answer = await channel.send(sent)
  const error = refusalOf(answer)
  if (error !== undefined || inverse === undefined) return error
  let both: { undo(): Promise<SendAnswer>; redo(): Promise<SendAnswer> }
  if (Array.isArray(inverse)) {
    both = { undo: () => sendInOrder(channel, inverse), redo: () => channel.send(sent) }
  } else if (sent.op === 'create' && inverse.op === 'remove') {
    const node = takeAndBring(inverse.id, sent.node, channel)
    both = { undo: node.take, redo: node.bring }
  } else if (sent.op === 'remove' && inverse.op === 'create') {
    const node = takeAndBring(sent.id, inverse.node, channel)
    both = { undo: node.bring, redo: node.take }
  } else {
    both = { undo: () => channel.send(inverse), redo: () => channel.send(sent) }
  }
  record(projectId, marked(new Mark(watchOf(projectId), footprintOf(sent), revisionOf(answer)), both), group)
  return undefined
}

/** What deleting to the trash and restoring from it go through; tests pass a fake. */
export interface TrashClient {
  put(projectId: string, nodeId: string): Promise<{ ok: true; value: TrashEntry } | { ok: false; error: string }>
  restore(projectId: string, label: string): Promise<{ ok: true; value: TrashEntry } | { ok: false; error: string }>
}

/** Deleting and restoring as the Canvas's gestures and their undo do it: with this screen's id. */
export const ipcTrash: TrashClient = {
  put: (projectId, nodeId) => invoke('trash.put', { projectId, nodeId, screen: screenId() }),
  restore: (projectId, label) => invoke('trash.restore', { projectId, label, screen: screenId() }),
}

/**
 * Deletes a Node to the trash and records the step: undo restores the entry, redo deletes the Node
 * again (into a new entry). Resolves to the reason main refused, or undefined.
 *
 * The trash's answer has no revision. main broadcasts the Layout change before it answers, so the
 * revision of a call is that of this screen's change of the Node that arrived meanwhile
 * (Watch.ownRevision); unknown when none did.
 */
export async function trashRecorded(projectId: string, nodeId: string, trash: TrashClient = ipcTrash, group?: Group): Promise<string | undefined> {
  // A read-only screen (worfy-link ticket 25) puts nothing in the trash.
  const readOnly = readOnlyNow()
  if (readOnly !== null) return readOnly
  const watch = watchOf(projectId)
  const footprint: Footprint = new Map([[nodeId, new Set<Side>(['existence'])]])
  const answerSince = (since: number | undefined): SendAnswer => {
    const revision = watch.ownRevision(footprint, since)
    return revision === undefined ? undefined : { revision }
  }
  const since = watch.latest()
  const first = await trash.put(projectId, nodeId)
  if (!first.ok) return first.error
  let label = first.value.label
  const mark = new Mark(watch, footprint, revisionOf(answerSince(since)))
  record(
    projectId,
    marked(mark, {
      undo: async () => {
        const since = watch.latest()
        const result = await trash.restore(projectId, label)
        return result.ok ? answerSince(since) : result.error
      },
      redo: async () => {
        const since = watch.latest()
        const result = await trash.put(projectId, nodeId)
        if (!result.ok) return result.error
        label = result.value.label
        return answerSince(since)
      },
    }),
    group,
  )
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
  // A read-only screen (worfy-link ticket 25): one hint for the whole selection, nothing sent.
  const readOnly = readOnlyNow()
  if (readOnly !== null) return deletableNodes(nodes).length > 0 ? [readOnly] : []
  const refusals: string[] = []
  await grouped(async (group) => {
    for (const node of deletableNodes(nodes)) {
      const refusal = await trashRecorded(projectId, node.id, trash, group)
      if (refusal !== undefined) refusals.push(refusal)
    }
  })
  return refusals
}
