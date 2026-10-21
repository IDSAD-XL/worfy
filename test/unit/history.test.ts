// Undo and redo of the Layout (src/renderer/canvas/history.ts, ticket 30) against main's own Layout
// store: every operation and every inverse goes through LayoutStore.apply, the code that applies
// them in the app, so an inverse that main would read differently fails here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyRecorded, deleteToTrash, grouped, History, historyOf, HISTORY_DEPTH, inverseOf, resetHistories, skippedNotice, SKIPPED_NOTICE_MS, trashRecorded, type Group, type LayoutChannel, type Send, type StepOutcome, type TrashClient } from '../../src/renderer/canvas/history'
import { screenId } from '../../src/renderer/canvas/screen'
import { LayoutStore, type LayoutChange } from '../../src/main/layout/store'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { TrashEntry } from '../../src/shared/ipc/trash'
import { layoutNodeSchema, layoutOpSchema, type Layout, type LayoutNode, type LayoutOpInput, type LayoutState } from '../../src/shared/layout/types'

const PROJECT = 'demo-0a1b2c3d'

let store: LayoutStore
let sent: LayoutOpInput[]

/** main as the renderer reaches it: applies the operation, answers with the refusal text. */
const send: Send = (op) => {
  sent.push(op)
  try {
    store.apply(PROJECT, op)
    return Promise.resolve(undefined)
  } catch (error) {
    return Promise.resolve(error instanceof Error ? error.message : String(error))
  }
}

const layout = () => store.get(PROJECT).layout
const nodeOf = (id: string): LayoutNode | undefined => layout().nodes.find((node) => node.id === id)
/** What the Canvas sends through: main, and the Layout as main has it now. */
const channel: LayoutChannel = { send: (op) => send(op), layout: () => layout() }
/** An operation the user makes on the Canvas: recorded against the Layout as it was just before. */
const user = (op: LayoutOpInput, group?: Group) => applyRecorded(PROJECT, op, channel, group)
/** An operation an agent makes through the canvas MCP tools: main applies it directly. */
const agent = (op: LayoutOpInput) => store.apply(PROJECT, op)
const history = () => historyOf(PROJECT)
const layoutNodeOf = (fields: Partial<LayoutNode> & { id: string; kind: string }): LayoutNode => layoutNodeSchema.parse({ x: 0, y: 0, w: 220, h: 120, ...fields })
const note = (id: string, extra: Partial<LayoutNode> = {}) => store.apply(PROJECT, { op: 'create', node: { id, kind: 'note', x: 0, y: 0, w: 220, h: 120, data: { text: id }, ...extra } })

beforeEach(() => {
  resetHistories()
  sent = []
  store = new LayoutStore(() => '/nonexistent/worfy-history-test', { write: () => undefined, delayMs: 60_000 })
})

describe('history: the stack', () => {
  it('a move is undone by ⌘Z and done again by ⇧⌘Z', async () => {
    note('a')
    await user({ op: 'move', id: 'a', x: 300, y: 200 })
    expect(nodeOf('a')).toMatchObject({ x: 300, y: 200 })

    expect(await history().undo()).toBe(true)
    expect(nodeOf('a')).toMatchObject({ x: 0, y: 0 })
    expect(await history().redo()).toBe(true)
    expect(nodeOf('a')).toMatchObject({ x: 300, y: 200 })
    expect(history().canRedo).toBe(false)
  })

  it(`keeps ${HISTORY_DEPTH} steps: after 41 moves the oldest is not undone`, async () => {
    expect(HISTORY_DEPTH).toBe(40)
    note('a')
    for (let n = 1; n <= 41; n++) await user({ op: 'move', id: 'a', x: n * 10, y: 0 })
    expect(history().size).toBe(40)

    for (let n = 0; n < 40; n++) expect(await history().undo()).toBe(true)
    // Back to where the first move put it, not to where it was before that.
    expect(nodeOf('a')).toMatchObject({ x: 10, y: 0 })
    expect(await history().undo()).toBe(false)
    expect(nodeOf('a')).toMatchObject({ x: 10, y: 0 })
  })

  it('a new step clears what could be redone', async () => {
    note('a')
    await user({ op: 'move', id: 'a', x: 1, y: 1 })
    await history().undo()
    expect(history().canRedo).toBe(true)
    await user({ op: 'move', id: 'a', x: 2, y: 2 })
    expect(history().canRedo).toBe(false)
    expect(await history().redo()).toBe(false)
  })

  it('undo and redo asked for at once run one after another, in order', async () => {
    note('a')
    await user({ op: 'move', id: 'a', x: 1, y: 0 })
    await user({ op: 'move', id: 'a', x: 2, y: 0 })
    const results = await Promise.all([history().undo(), history().undo(), history().redo()])
    expect(results).toEqual([true, true, true])
    expect(nodeOf('a')).toMatchObject({ x: 1, y: 0 })
  })

  it('a step whose inverse main refuses is dropped, and the next undo reaches the step before it', async () => {
    note('a')
    note('b')
    await user({ op: 'move', id: 'a', x: 50, y: 50 })
    await user({ op: 'move', id: 'b', x: 70, y: 70 })
    agent({ op: 'remove', id: 'b' })
    expect(await history().undo()).toBe(false)
    expect(await history().undo()).toBe(true)
    expect(nodeOf('a')).toMatchObject({ x: 0, y: 0 })
  })

  it('the history of one Project is not the history of another', async () => {
    note('a')
    await user({ op: 'move', id: 'a', x: 5, y: 5 })
    expect(historyOf('other-project').canUndo).toBe(false)
    expect(history().canUndo).toBe(true)
  })

  it('a refused operation is not recorded', async () => {
    note('locked', { locked: true })
    expect(await user({ op: 'remove', id: 'locked' })).toMatch(/locked/)
    expect(history().canUndo).toBe(false)
  })
})

describe('history: inverse operations', () => {
  it('create, resize, hide, remove, tag and pin are each reverted exactly by their inverse', async () => {
    note('a', { tags: ['old'] })
    const original = nodeOf('a')

    await user({ op: 'create', node: { kind: 'note', x: 10, y: 10, w: 220, h: 120, data: { text: 'new' } } })
    const created = layout().nodes.find((node) => node.id !== 'a')
    expect(created).toBeDefined()
    await user({ op: 'resize', id: 'a', w: 400, h: 300, x: -20, y: -10 })
    await user({ op: 'hide', id: 'a', hidden: true })
    await user({ op: 'tag', id: 'a', add: ['new', 'old'], remove: ['old'] })
    await user({ op: 'pin', id: 'a', pinned: true, x: 12, y: 14, w: 200, h: 100 })
    expect(nodeOf('a')).toMatchObject({ w: 200, h: 100, x: 12, y: 14, hidden: true, pinned: true, tags: ['new'] })
    await user({ op: 'remove', id: 'a' })
    expect(nodeOf('a')).toBeUndefined()

    for (let n = 0; n < 5; n++) await history().undo()
    expect(nodeOf('a')).toEqual(original)
    await history().undo()
    expect(layout().nodes.map((node) => node.id)).toEqual(['a'])

    // Redo brings the created Node back under the same id, then the rest in order.
    for (let n = 0; n < 6; n++) expect(await history().redo()).toBe(true)
    expect(nodeOf(created!.id)).toEqual(created)
    expect(nodeOf('a')).toBeUndefined()
  })

  it('a removed Node comes back with every field it had', async () => {
    note('a', { x: 33, y: 44, tags: ['t'], data: { text: 'keep me', extra: 1 } })
    const before = nodeOf('a')
    await user({ op: 'remove', id: 'a' })
    await history().undo()
    expect(nodeOf('a')).toEqual(before)
  })

  it('a note text and a no-op hide are not steps, and the camera is not a Layout operation at all', () => {
    note('a')
    // The camera is each screen's own, outside the Layout and its history (worfy-link ticket 06).
    // @ts-expect-error -- setViewport is no longer a Layout operation
    expect(() => layoutOpSchema.parse({ op: 'setViewport', viewport: { x: 1, y: 2, zoom: 1 } } satisfies LayoutOpInput)).toThrow()
    expect(inverseOf(layout(), { op: 'patchData', id: 'a', data: { text: 'x' } })).toBeUndefined()
    expect(inverseOf(layout(), { op: 'hide', id: 'a', hidden: false })).toBeUndefined()
    expect(inverseOf(layout(), { op: 'move', id: 'missing', x: 1, y: 1 })).toBeUndefined()
  })

  // worfy-week ticket 08: the collapse button of an Epic frame is a step; a note's text still is not.
  it('a data patch asked to be recorded is a step: ⌘Z puts back the old value, and null for a key the Node did not have', async () => {
    store.apply(PROJECT, { op: 'create', node: { id: 'epic:a', kind: 'epic-frame', x: 0, y: 0, w: 1, h: 1, locked: true, data: {} } })
    expect(inverseOf(layout(), { op: 'patchData', id: 'epic:a', data: { collapsed: true } }, { data: true })).toEqual({ op: 'patchData', id: 'epic:a', data: { collapsed: null } })
    // Without the option the same patch is no step, and a patch that changes nothing is none either.
    expect(inverseOf(layout(), { op: 'patchData', id: 'epic:a', data: { collapsed: true } })).toBeUndefined()
    expect(inverseOf(layout(), { op: 'patchData', id: 'missing', data: { collapsed: true } }, { data: true })).toBeUndefined()

    expect(await applyRecorded(PROJECT, { op: 'patchData', id: 'epic:a', data: { collapsed: true } }, channel, undefined, { data: true })).toBeUndefined()
    expect(await applyRecorded(PROJECT, { op: 'patchData', id: 'epic:a', data: { collapsed: false } }, channel, undefined, { data: true })).toBeUndefined()
    expect(inverseOf(layout(), { op: 'patchData', id: 'epic:a', data: { collapsed: false } }, { data: true })).toBeUndefined()
    expect(history().size).toBe(2)

    expect(await history().undo()).toBe(true)
    expect(nodeOf('epic:a')?.data).toEqual({ collapsed: true })
    expect(await history().undo()).toBe(true)
    expect(nodeOf('epic:a')?.data).toEqual({ collapsed: null })
    expect(await history().redo()).toBe(true)
    expect(nodeOf('epic:a')?.data).toEqual({ collapsed: true })
    expect(await history().redo()).toBe(true)
    expect(nodeOf('epic:a')?.data).toEqual({ collapsed: false })
  })

  it('a created note keeps the text typed into it through undo and redo', async () => {
    // Double click creates the note, the user types (patchData, not a step), clicks away, ⌘Z, ⇧⌘Z.
    await user({ op: 'create', node: { kind: 'note', x: 10, y: 10, w: 220, h: 120, data: { text: '' } } })
    const id = layout().nodes[0]!.id
    await user({ op: 'patchData', id, data: { text: 'important' } })
    expect(history().size).toBe(1)
    const typed = nodeOf(id)

    expect(await history().undo()).toBe(true)
    expect(nodeOf(id)).toBeUndefined()
    expect(await history().redo()).toBe(true)
    expect(nodeOf(id)).toEqual(typed)
    expect(nodeOf(id)?.data).toEqual({ text: 'important' })
  })

  it('a removed Node brought back and changed comes back changed after redo and undo', async () => {
    note('a', { data: { text: 'first' } })
    await user({ op: 'remove', id: 'a' })
    await history().undo()
    await user({ op: 'patchData', id: 'a', data: { text: 'second' } })
    expect(await history().redo()).toBe(true)
    expect(nodeOf('a')).toBeUndefined()
    expect(await history().undo()).toBe(true)
    expect(nodeOf('a')?.data).toEqual({ text: 'second' })
  })

  it('a create gets its id before it is sent, so its undo can name it', async () => {
    await user({ op: 'create', node: { kind: 'note', x: 0, y: 0, w: 220, h: 120 } })
    const first = sent[0]
    expect(first?.op === 'create' && typeof first.node.id === 'string' && first.node.id.length > 0).toBe(true)
  })
})

/** The parts of src/renderer/canvas/useLayout.ts this file uses. */
interface UseLayoutModule {
  acceptLayoutState(state: LayoutState): void
  /** What the renderer subscribes to `layout.changed`. */
  acceptLayoutChange(change: LayoutChange): void
  applyLayoutOp(projectId: string, op: LayoutOpInput): Promise<string | undefined>
  currentLayout(projectId: string): Layout | undefined
}
// useLayout.ts imports React, which tsconfig.test.node.json leaves out of this project's files, so
// it is loaded through a computed specifier and given the signatures used here.
const useLayoutModule = (): Promise<UseLayoutModule> => import(/* @vite-ignore */ ['..', '..', 'src', 'renderer', 'canvas', 'useLayout.ts'].join('/')) as Promise<UseLayoutModule>

describe('history: the undo of a Restore (review of PR #654)', () => {
  it('a pinned Node is archived again and not moved: its x and y are screen pixels', async () => {
    note('a', { pinned: true, x: 12, y: 14 })
    note('b', { x: 400 })
    agent({ op: 'archive', batch: 'b1', nodes: [{ id: 'a', rule: 'idle', at: 1_000 }, { id: 'b', rule: 'idle', at: 1_000 }] })
    expect(inverseOf(layout(), { op: 'restore', ids: ['a', 'b'] })).toEqual([
      { op: 'archive', batch: 'b1', nodes: [{ id: 'a', rule: 'idle', at: 1_000 }, { id: 'b', rule: 'idle', at: 1_000 }] },
      { op: 'move', id: 'b', x: 400, y: 0 },
    ])
    expect(inverseOf(layout(), { op: 'restore', ids: ['a'] })).toEqual([{ op: 'archive', batch: 'b1', nodes: [{ id: 'a', rule: 'idle', at: 1_000 }] }])

    await user({ op: 'restore', ids: ['a'] })
    sent = []
    expect(await history().undo()).toBe(true)
    expect(sent.map((op) => op.op)).toEqual(['archive'])
    expect(nodeOf('a')).toMatchObject({ pinned: true, x: 12, y: 14, archived: { batch: 'b1', at: 1_000 } })
  })

  it('stops at the first operation main refuses: nothing after it is sent', async () => {
    note('a')
    note('b', { x: 400 })
    agent({ op: 'archive', batch: 'b1', nodes: [{ id: 'a', rule: 'idle' }] })
    agent({ op: 'archive', batch: 'b2', nodes: [{ id: 'b', rule: 'idle' }] })
    await user({ op: 'restore', ids: ['a', 'b'] })
    // An agent removes Node a: the archive of its batch is refused.
    agent({ op: 'remove', id: 'a' })
    sent = []
    await history().undo()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ op: 'archive', batch: 'b1' })
    expect(nodeOf('b')?.archived ?? null).toBeNull()
  })
})

describe('history: operations of agents', () => {
  // The renderer side as the app has it: the Canvas's channel sends through applyLayoutOp() and
  // reads currentLayout(); the automatic writers (Session Nodes sync, Epic and Subagent sources)
  // call applyLayoutOp() themselves; an agent's MCP tool call is applied by main and broadcast.
  beforeEach(() => {
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel: string, input: unknown) => {
        if (channel !== 'layout.apply') return Promise.resolve({ ok: false, error: `no ${channel}` })
        const { projectId, op } = input as { projectId: string; op: LayoutOpInput }
        try {
          return Promise.resolve({ ok: true, value: store.apply(projectId, op) })
        } catch (error) {
          return Promise.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
      on: () => 1,
      off: () => undefined,
    } as unknown as WorfyBridge
  })
  afterEach(() => {
    delete (globalThis as { worfy?: WorfyBridge }).worfy
  })

  it('what the automatic writers and an agent change is not in the user history, and an undo leaves it in place', async () => {
    const { acceptLayoutState, applyLayoutOp, currentLayout } = await useLayoutModule()
    note('mine')
    note('theirs')
    acceptLayoutState(store.get(PROJECT))
    const canvas: LayoutChannel = { send: (op) => applyLayoutOp(PROJECT, op), layout: () => currentLayout(PROJECT) ?? layout() }
    await applyRecorded(PROJECT, { op: 'move', id: 'mine', x: 100, y: 100 }, canvas)
    expect(history().size).toBe(1)

    // An automatic writer of the renderer.
    expect(await applyLayoutOp(PROJECT, { op: 'move', id: 'theirs', x: 500, y: 500 })).toBeUndefined()
    expect(await applyLayoutOp(PROJECT, { op: 'create', node: { id: 'card-by-source', kind: 'card', x: 0, y: 0, w: 360, h: 280 } })).toBeUndefined()
    // An agent through the canvas MCP tools: main applies it and broadcasts the Layout.
    acceptLayoutState(store.apply(PROJECT, { op: 'move', id: 'mine', x: 120, y: 130 }))
    expect(history().size).toBe(1)

    expect(await history().undo()).toBe(true)
    expect(nodeOf('mine')).toMatchObject({ x: 0, y: 0 })
    expect(nodeOf('theirs')).toMatchObject({ x: 500, y: 500 })
    expect(nodeOf('card-by-source')).toBeDefined()
    expect(history().canUndo).toBe(false)
  })
})

describe('history: a drag of several Nodes (moveMany, ADR-0038)', () => {
  it('two neighbours dragged together by +100 px on x stand exactly 100 px further; one ⌘Z brings both back, ⇧⌘Z moves both again', async () => {
    note('a', { x: 0, y: 0 })
    note('b', { x: 240, y: 0 })
    sent = []
    // `a` lands where `b` was: one move at a time would have put `a` off the `b` not yet moved.
    await user({ op: 'moveMany', moves: [{ id: 'a', x: 100, y: 0 }, { id: 'b', x: 340, y: 0 }] })
    expect(sent).toHaveLength(1)
    expect([nodeOf('a'), nodeOf('b')]).toMatchObject([{ x: 100, y: 0 }, { x: 340, y: 0 }])
    expect(history().size).toBe(1)

    expect(await history().undo()).toBe(true)
    expect([nodeOf('a'), nodeOf('b')]).toMatchObject([{ x: 0, y: 0 }, { x: 240, y: 0 }])
    expect(sent.at(-1)).toEqual({ op: 'moveMany', moves: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 240, y: 0 }] })
    expect(await history().redo()).toBe(true)
    expect([nodeOf('a'), nodeOf('b')]).toMatchObject([{ x: 100, y: 0 }, { x: 340, y: 0 }])
  })

  it('the inverse names the Nodes that are there with their old places, and there is none when none of them is', () => {
    note('a', { x: 5, y: 6 })
    expect(inverseOf(layout(), { op: 'moveMany', moves: [{ id: 'a', x: 1, y: 1 }, { id: 'gone', x: 2, y: 2 }] })).toEqual({ op: 'moveMany', moves: [{ id: 'a', x: 5, y: 6 }] })
    expect(inverseOf(layout(), { op: 'moveMany', moves: [{ id: 'gone', x: 2, y: 2 }] })).toBeUndefined()
  })
})

describe('history: one gesture, one step', () => {
  it('operations made inside grouped() are undone and redone together', async () => {
    note('a')
    note('b')
    await grouped((group) => Promise.all([user({ op: 'move', id: 'a', x: 10, y: 0 }, group), user({ op: 'move', id: 'b', x: 20, y: 0 }, group)]))
    expect(history().size).toBe(1)
    await history().undo()
    expect([nodeOf('a')?.x, nodeOf('b')?.x]).toEqual([0, 0])
    await history().redo()
    expect([nodeOf('a')?.x, nodeOf('b')?.x]).toEqual([10, 20])
  })

  it('a group undoes its parts newest first and redoes them in order', async () => {
    note('a')
    await grouped(async (group) => {
      await user({ op: 'move', id: 'a', x: 10, y: 0 }, group)
      await user({ op: 'move', id: 'a', x: 20, y: 0 }, group)
    })
    expect(history().size).toBe(1)
    await history().undo()
    expect(nodeOf('a')).toMatchObject({ x: 0 })
    await history().redo()
    expect(nodeOf('a')).toMatchObject({ x: 20 })
  })

  it('a grouped undo runs every part even when one part is refused', async () => {
    note('a')
    note('b')
    await grouped(async (group) => {
      await user({ op: 'move', id: 'a', x: 10, y: 0 }, group)
      await user({ op: 'move', id: 'b', x: 20, y: 0 }, group)
    })
    agent({ op: 'remove', id: 'b' })
    expect(await history().undo()).toBe(false)
    expect(nodeOf('a')).toMatchObject({ x: 0 })
  })

  it('an operation of another gesture that finishes while a group waits on main is a step of its own', async () => {
    note('a')
    note('b')
    let release: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => (release = resolve))
    // The drag of `a` waits for main's answer; meanwhile the user resizes `b`.
    const slow: LayoutChannel = { send: async (op) => (await waiting, send(op)), layout: () => layout() }
    const drag = grouped((group) => applyRecorded(PROJECT, { op: 'move', id: 'a', x: 10, y: 0 }, slow, group))
    await user({ op: 'resize', id: 'b', w: 400, h: 300, x: 0, y: 0 })
    release()
    await drag
    expect(history().size).toBe(2)

    await history().undo()
    expect(nodeOf('a')).toMatchObject({ x: 0 })
    expect(nodeOf('b')).toMatchObject({ w: 400 })
  })

  it('a gesture takes its place in the history at its first recorded operation, not when it ends', async () => {
    note('a')
    let release: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => (release = resolve))
    const slow: LayoutChannel = { send: async (op) => (await waiting, send(op)), layout: () => layout() }
    // Gesture A moves `a` to x=10, then waits for main's answer on its second operation.
    let recorded: () => void = () => undefined
    const first = new Promise<void>((resolve) => (recorded = resolve))
    const gestureA = grouped(async (group) => {
      await user({ op: 'move', id: 'a', x: 10, y: 0 }, group)
      recorded()
      await applyRecorded(PROJECT, { op: 'move', id: 'a', x: 20, y: 0 }, slow, group)
    })
    await first
    // Meanwhile gesture B moves `a` to x=50 and is over; then A is over.
    await grouped((group) => user({ op: 'move', id: 'a', x: 50, y: 0 }, group))
    release()
    await gestureA
    expect(history().size).toBe(2)

    await history().undo()
    await history().undo()
    expect(nodeOf('a')).toMatchObject({ x: 0 })
    await history().redo()
    await history().redo()
    expect(nodeOf('a')).toMatchObject({ x: 50 })
  })

  it('⌘Z while a gesture whose step is already in the history waits on main undoes the whole gesture once it is over', async () => {
    note('a')
    note('b')
    let release: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => (release = resolve))
    const slow: LayoutChannel = { send: async (op) => (await waiting, send(op)), layout: () => layout() }
    let recorded: () => void = () => undefined
    const first = new Promise<void>((resolve) => (recorded = resolve))
    const gesture = grouped(async (group) => {
      await user({ op: 'move', id: 'a', x: 10, y: 0 }, group)
      recorded()
      await applyRecorded(PROJECT, { op: 'move', id: 'b', x: 20, y: 0 }, slow, group)
    })
    await first
    let undone: StepOutcome | undefined
    const undo = history().undo().then((result) => (undone = result))
    // The undo does not touch the half-done gesture: `a` stays where the gesture put it.
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    expect(undone).toBeUndefined()
    expect(nodeOf('a')).toMatchObject({ x: 10 })
    release()
    await gesture
    await undo
    expect(undone).toBe(true)
    expect([nodeOf('a')?.x, nodeOf('b')?.x]).toEqual([0, 0])
    expect(history().canUndo).toBe(false)
    // ⇧⌘Z brings the whole gesture back.
    expect(await history().redo()).toBe(true)
    expect([nodeOf('a')?.x, nodeOf('b')?.x]).toEqual([10, 20])
  })

  it('a waiting ⌘Z waits for a gesture that took the top while it waited, and undoes that gesture', async () => {
    note('a')
    note('b')
    const gate = () => {
      let release: () => void = () => undefined
      const waiting = new Promise<void>((resolve) => (release = resolve))
      const slow: LayoutChannel = { send: async (op) => (await waiting, send(op)), layout: () => layout() }
      return { release, slow }
    }
    const started = (body: (group: Group, recorded: () => void) => Promise<unknown>) => {
      let recorded: () => void = () => undefined
      const first = new Promise<void>((resolve) => (recorded = resolve))
      return { done: grouped((group) => body(group, recorded)), first }
    }
    const one = gate()
    const two = gate()
    const gestureA = started(async (group, recorded) => {
      await user({ op: 'move', id: 'a', x: 10, y: 0 }, group)
      recorded()
      await applyRecorded(PROJECT, { op: 'move', id: 'a', x: 20, y: 0 }, one.slow, group)
    })
    await gestureA.first
    const undo = history().undo()
    // While ⌘Z waits for A, gesture C records its first part on top of A and waits on main too.
    const gestureC = started(async (group, recorded) => {
      await user({ op: 'move', id: 'b', x: 30, y: 0 }, group)
      recorded()
      await applyRecorded(PROJECT, { op: 'move', id: 'b', x: 40, y: 0 }, two.slow, group)
    })
    await gestureC.first
    one.release()
    await gestureA.done
    two.release()
    await gestureC.done
    expect(await undo).toBe(true)
    // The ⌘Z took C, the latest step, whole; A is still done.
    expect([nodeOf('a')?.x, nodeOf('b')?.x]).toEqual([20, 0])
    expect(history().size).toBe(1)
  })

  it('⌘Z while a gesture waits on main undoes the newer finished step above it at once', async () => {
    note('a')
    note('b')
    let release: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => (release = resolve))
    const slow: LayoutChannel = { send: async (op) => (await waiting, send(op)), layout: () => layout() }
    let recorded: () => void = () => undefined
    const first = new Promise<void>((resolve) => (recorded = resolve))
    const gesture = grouped(async (group) => {
      await user({ op: 'move', id: 'a', x: 10, y: 0 }, group)
      recorded()
      await applyRecorded(PROJECT, { op: 'move', id: 'a', x: 20, y: 0 }, slow, group)
    })
    await first
    await user({ op: 'resize', id: 'b', w: 400, h: 300, x: 0, y: 0 })
    expect(await history().undo()).toBe(true)
    expect(nodeOf('b')).toMatchObject({ w: 220 })
    expect(nodeOf('a')).toMatchObject({ x: 10 })
    release()
    await gesture
    // The rest of the gesture is a new change: the undone resize can no longer be redone.
    expect(history().canRedo).toBe(false)
    expect(await history().undo()).toBe(true)
    expect(nodeOf('a')).toMatchObject({ x: 0 })
  })

  it('a step recorded after its gesture closed is still a step', async () => {
    note('a')
    let release: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => (release = resolve))
    const slow: LayoutChannel = { send: async (op) => (await waiting, send(op)), layout: () => layout() }
    let late: Promise<unknown> = Promise.resolve()
    // The gesture does not wait for its operation: the group closes first.
    await grouped((group) => {
      late = applyRecorded(PROJECT, { op: 'move', id: 'a', x: 10, y: 0 }, slow, group)
      return Promise.resolve()
    })
    release()
    await late
    expect(history().size).toBe(1)
    await history().undo()
    expect(nodeOf('a')).toMatchObject({ x: 0 })
  })

  it('a depth of one keeps only the newest step', async () => {
    const short = new History(1)
    const calls: string[] = []
    short.push({ undo: () => (calls.push('first'), Promise.resolve(undefined)), redo: () => Promise.resolve(undefined) })
    short.push({ undo: () => (calls.push('second'), Promise.resolve(undefined)), redo: () => Promise.resolve(undefined) })
    await short.undo()
    await short.undo()
    expect(calls).toEqual(['second'])
  })
})

describe('history: deleting to the trash', () => {
  it('undo restores the entry, redo deletes the Node again, and the next undo restores the new entry', async () => {
    const calls: string[] = []
    let count = 0
    const entry = (label: string): TrashEntry => ({ label, trashedAt: 1, nodeId: 'c1', kind: 'card', title: null, hasFiles: true })
    const trash: TrashClient = {
      put: (_projectId, nodeId) => {
        count += 1
        const label = `${count}-0000000${count}`
        calls.push(`put ${nodeId} → ${label}`)
        return Promise.resolve({ ok: true, value: entry(label) })
      },
      restore: (_projectId, label) => {
        calls.push(`restore ${label}`)
        return Promise.resolve({ ok: true, value: entry(label) })
      },
    }
    expect(await trashRecorded(PROJECT, 'c1', trash)).toBeUndefined()
    await history().undo()
    await history().redo()
    await history().undo()
    expect(calls).toEqual(['put c1 → 1-00000001', 'restore 1-00000001', 'put c1 → 2-00000002', 'restore 2-00000002'])
  })

  it('deleting a selection of two Nodes is one step: one undo restores both', async () => {
    const calls: string[] = []
    const node = (id: string) => layoutNodeOf({ id, kind: 'note' })
    const trash: TrashClient = {
      put: (_projectId, nodeId) => {
        calls.push(`put ${nodeId}`)
        return Promise.resolve({ ok: true, value: { label: `1-${nodeId.padStart(8, '0')}`, trashedAt: 1, nodeId, kind: 'note', title: null, hasFiles: false } })
      },
      restore: (_projectId, label) => {
        calls.push(`restore ${label}`)
        return Promise.resolve({ ok: true, value: { label, trashedAt: 1, nodeId: label, kind: 'note', title: null, hasFiles: false } })
      },
    }
    expect(await deleteToTrash(PROJECT, [node('n1'), node('n2')], trash)).toEqual([])
    expect(history().size).toBe(1)
    expect(await history().undo()).toBe(true)
    expect(calls).toEqual(['put n1', 'put n2', 'restore 1-000000n2', 'restore 1-000000n1'])
    expect(history().canUndo).toBe(false)
  })

  it('a refused delete is not a step', async () => {
    const trash: TrashClient = {
      put: () => Promise.resolve({ ok: false, error: 'locked' }),
      restore: () => Promise.reject(new Error('never called')),
    }
    expect(await trashRecorded(PROJECT, 'orch', trash)).toBe('locked')
    expect(history().canUndo).toBe(false)
  })
})

// worfy-link ticket 07 (ADR-0053, point 3): ⌘Z undoes only this screen's own changes. A step whose
// Node another screen (a second window, a Linked machine) changed since is skipped with a notice.
// Every change main applies reaches the renderer's `layout.changed` handler, as main broadcasts it.
describe('history: changes made on another screen', () => {
  const SCREENS = 'screens-0a1b2c3d'
  const OTHER = 'another-screen'
  let sends: LayoutOpInput[]

  const here = () => store.get(SCREENS).layout
  const at = (id: string): LayoutNode | undefined => here().nodes.find((node) => node.id === id)
  /** This screen's Canvas: the operation goes to main with this screen's id; main answers with the revision. */
  const mine: LayoutChannel = {
    send: (op) => {
      sends.push(op)
      try {
        return Promise.resolve({ revision: store.apply(SCREENS, op, screenId()).revision })
      } catch (error) {
        return Promise.resolve(error instanceof Error ? error.message : String(error))
      }
    },
    layout: () => here(),
  }
  const gesture = (op: LayoutOpInput, group?: Group) => applyRecorded(SCREENS, op, mine, group)
  /** Another window or a Linked machine changes the Layout. */
  const other = (op: LayoutOpInput) => store.apply(SCREENS, op, OTHER)
  const steps = () => historyOf(SCREENS)
  const place = (id: string) => {
    const node = at(id)
    return node && { x: node.x, y: node.y }
  }
  const make = (id: string, x: number, y = 0) => store.apply(SCREENS, { op: 'create', node: { id, kind: 'note', x, y, w: 220, h: 120, data: { text: id } } })
  /** A trash in main, as src/main/ipc/trash.ts is: the Node's removal and return carry the screen. */
  const kept = new Map<string, LayoutNode>()
  let labels = 0
  const trash: TrashClient = {
    put: (projectId, nodeId) => {
      const node = store.get(projectId).layout.nodes.find((each) => each.id === nodeId)
      if (node === undefined) return Promise.resolve({ ok: false, error: `no ${nodeId}` })
      store.apply(projectId, { op: 'remove', id: nodeId }, screenId())
      labels += 1
      const label = `${labels}-${nodeId.padStart(8, '0')}`
      kept.set(label, node)
      return Promise.resolve({ ok: true, value: { label, trashedAt: 1, nodeId, kind: node.kind, title: null, hasFiles: false } })
    },
    restore: (projectId, label) => {
      const node = kept.get(label)
      if (node === undefined) return Promise.resolve({ ok: false, error: `no ${label}` })
      store.apply(projectId, { op: 'create', node }, screenId())
      return Promise.resolve({ ok: true, value: { label, trashedAt: 1, nodeId: node.id, kind: node.kind, title: null, hasFiles: false } })
    },
  }

  beforeEach(async () => {
    sends = []
    kept.clear()
    const { acceptLayoutChange } = await useLayoutModule()
    // main's broadcast: every change, whoever made it, with its screen and operation.
    store.onChange((change) => acceptLayoutChange(change))
  })

  it('a move of N that another screen moved since is skipped: nothing is sent, the notice is up, the next ⌘Z undoes the step before', async () => {
    make('m', 0)
    make('n', 400)
    await gesture({ op: 'move', id: 'm', x: 0, y: 300 })
    await gesture({ op: 'move', id: 'n', x: 400, y: 300 })
    other({ op: 'move', id: 'n', x: 900, y: 900 })
    sends = []

    expect(await steps().undo()).toBe('skipped')
    expect(sends).toEqual([])
    expect(place('n')).toEqual({ x: 900, y: 900 })
    expect(skippedNotice.getState().notice).toMatchObject({ projectId: SCREENS, direction: 'undo' })

    expect(await steps().undo()).toBe(true)
    expect(place('m')).toEqual({ x: 0, y: 0 })
    expect(place('n')).toEqual({ x: 900, y: 900 })
    expect(steps().canUndo).toBe(false)
    // The skipped step is gone: ⇧⌘Z redoes the move of `m` only.
    expect(await steps().redo()).toBe(true)
    expect(place('m')).toEqual({ x: 0, y: 300 })
    expect(steps().canRedo).toBe(false)
  })

  it('the notice goes away by itself after a few seconds', async () => {
    make('n', 0)
    await gesture({ op: 'move', id: 'n', x: 0, y: 300 })
    other({ op: 'move', id: 'n', x: 500, y: 500 })
    vi.useFakeTimers()
    try {
      expect(await steps().undo()).toBe('skipped')
      expect(skippedNotice.getState().notice).not.toBeNull()
      vi.advanceTimersByTime(SKIPPED_NOTICE_MS - 1)
      expect(skippedNotice.getState().notice).not.toBeNull()
      vi.advanceTimersByTime(1)
      expect(skippedNotice.getState().notice).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('another screen tagging N leaves the move of N undoable', async () => {
    make('n', 0)
    await gesture({ op: 'move', id: 'n', x: 0, y: 300 })
    other({ op: 'tag', id: 'n', add: ['theirs'] })
    expect(await steps().undo()).toBe(true)
    expect(place('n')).toEqual({ x: 0, y: 0 })
    expect(at('n')?.tags).toEqual(['theirs'])
    expect(skippedNotice.getState().notice).toBeNull()
  })

  it('a change of N without a screen (main, an agent, an automatic writer) leaves the step as it was before', async () => {
    make('n', 0)
    await gesture({ op: 'move', id: 'n', x: 0, y: 300 })
    store.apply(SCREENS, { op: 'move', id: 'n', x: 700, y: 700 })
    expect(await steps().undo()).toBe(true)
    expect(place('n')).toEqual({ x: 0, y: 0 })
  })

  it('a change of N this screen made without a step leaves the step undoable', async () => {
    make('n', 0)
    await gesture({ op: 'move', id: 'n', x: 0, y: 300 })
    store.apply(SCREENS, { op: 'move', id: 'n', x: 700, y: 700 }, screenId())
    expect(await steps().undo()).toBe(true)
    expect(place('n')).toEqual({ x: 0, y: 0 })
  })

  it('a moveMany of three Nodes is skipped whole when another screen moved one of them; none moves', async () => {
    make('a', 0)
    make('b', 300)
    make('c', 600)
    await gesture({ op: 'moveMany', moves: [{ id: 'a', x: 0, y: 400 }, { id: 'b', x: 300, y: 400 }, { id: 'c', x: 600, y: 400 }] })
    other({ op: 'move', id: 'b', x: 300, y: 900 })
    sends = []
    expect(await steps().undo()).toBe('skipped')
    expect(sends).toEqual([])
    expect([place('a'), place('b'), place('c')]).toEqual([{ x: 0, y: 400 }, { x: 300, y: 900 }, { x: 600, y: 400 }])
    expect(steps().canUndo).toBe(false)
  })

  it('a gesture of several parts is skipped whole when one part is out of date', async () => {
    make('a', 0)
    make('b', 300)
    await grouped(async (group) => {
      await gesture({ op: 'move', id: 'a', x: 0, y: 400 }, group)
      await gesture({ op: 'tag', id: 'b', add: ['mine'] }, group)
    })
    other({ op: 'tag', id: 'b', remove: ['mine'], add: ['theirs'] })
    sends = []
    expect(await steps().undo()).toBe('skipped')
    expect(sends).toEqual([])
    expect(place('a')).toEqual({ x: 0, y: 400 })
  })

  it("another screen's removal of N makes any step of N out of date", async () => {
    make('n', 0)
    await gesture({ op: 'hide', id: 'n', hidden: true })
    other({ op: 'remove', id: 'n' })
    sends = []
    expect(await steps().undo()).toBe('skipped')
    expect(sends).toEqual([])
  })

  it('the same for ⇧⌘Z: an undone move of N that another screen moved since is not redone', async () => {
    make('n', 0)
    await gesture({ op: 'move', id: 'n', x: 0, y: 300 })
    expect(await steps().undo()).toBe(true)
    other({ op: 'move', id: 'n', x: 800, y: 0 })
    sends = []
    expect(await steps().redo()).toBe('skipped')
    expect(sends).toEqual([])
    expect(place('n')).toEqual({ x: 800, y: 0 })
    expect(skippedNotice.getState().notice).toMatchObject({ projectId: SCREENS, direction: 'redo' })
    expect(steps().canRedo).toBe(false)
  })

  it("⇧⌘Z after another screen's removal of N: the undone step is not redone", async () => {
    make('n', 0)
    await gesture({ op: 'tag', id: 'n', add: ['mine'] })
    expect(await steps().undo()).toBe(true)
    other({ op: 'remove', id: 'n' })
    expect(await steps().redo()).toBe('skipped')
  })

  it("another screen's change that reaches this one before main's answer to the step still makes it out of date", async () => {
    make('n', 0)
    // main applies the move, then the other screen's move, and only then does its answer arrive.
    const late: LayoutChannel = {
      send: (op) => {
        const revision = store.apply(SCREENS, op, screenId()).revision
        other({ op: 'move', id: 'n', x: 600, y: 600 })
        return Promise.resolve({ revision })
      },
      layout: () => here(),
    }
    await applyRecorded(SCREENS, { op: 'move', id: 'n', x: 0, y: 300 }, late)
    expect(await steps().undo()).toBe('skipped')
    expect(place('n')).toEqual({ x: 600, y: 600 })
  })

  it("another screen's change that main applied before this screen's undo does not stop the redo, even when it arrives late", async () => {
    const { acceptLayoutChange } = await useLayoutModule()
    make('n', 0)
    await gesture({ op: 'move', id: 'n', x: 0, y: 300 })
    const before = store.get(SCREENS).revision
    expect(await steps().undo()).toBe(true)
    // Another screen's change no later than the undo, forwarded late (as a Linked machine may).
    acceptLayoutChange({ ...store.get(SCREENS), revision: before + 1, screen: OTHER, op: { op: 'move', id: 'n', x: 5, y: 5 } })
    expect(await steps().redo()).toBe(true)
    expect(place('n')).toEqual({ x: 0, y: 300 })
  })

  it("another screen's change made before the step does not make it out of date", async () => {
    make('n', 0)
    other({ op: 'move', id: 'n', x: 0, y: 100 })
    await gesture({ op: 'move', id: 'n', x: 0, y: 300 })
    expect(await steps().undo()).toBe(true)
    expect(place('n')).toEqual({ x: 0, y: 100 })
  })

  it('a deleted Node that another screen changed after ⌘Z brought it back is not deleted again by ⇧⌘Z', async () => {
    make('n', 0)
    expect(await trashRecorded(SCREENS, 'n', trash)).toBeUndefined()
    expect(await steps().undo()).toBe(true)
    expect(at('n')).toBeDefined()
    other({ op: 'move', id: 'n', x: 500, y: 0 })
    expect(await steps().redo()).toBe('skipped')
    expect(place('n')).toEqual({ x: 500, y: 0 })
  })

  it('deleting to the trash and bringing back without another screen work as before', async () => {
    make('a', 0)
    make('b', 300)
    expect(await deleteToTrash(SCREENS, [at('a')!, at('b')!], trash)).toEqual([])
    other({ op: 'create', node: { id: 'elsewhere', kind: 'note', x: 900, y: 900, w: 220, h: 120 } })
    expect(await steps().undo()).toBe(true)
    expect([at('a'), at('b')].every((node) => node !== undefined)).toBe(true)
    expect(await steps().redo()).toBe(true)
    expect([at('a'), at('b')]).toEqual([undefined, undefined])
  })
})
