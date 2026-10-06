// Undo and redo of the Layout (src/renderer/canvas/history.ts, ticket 30) against main's own Layout
// store: every operation and every inverse goes through LayoutStore.apply, the code that applies
// them in the app, so an inverse that main would read differently fails here.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyRecorded, deleteToTrash, grouped, History, historyOf, HISTORY_DEPTH, inverseOf, resetHistories, trashRecorded, type Group, type LayoutChannel, type Send, type TrashClient } from '../../src/renderer/canvas/history'
import { LayoutStore } from '../../src/main/layout/store'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { TrashEntry } from '../../src/shared/ipc/trash'
import { layoutNodeSchema, type Layout, type LayoutNode, type LayoutOpInput, type LayoutState } from '../../src/shared/layout/types'

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

  it('the viewport, a note text and a no-op hide are not steps', () => {
    note('a')
    expect(inverseOf(layout(), { op: 'setViewport', viewport: { x: 1, y: 2, zoom: 1 } })).toBeUndefined()
    expect(inverseOf(layout(), { op: 'patchData', id: 'a', data: { text: 'x' } })).toBeUndefined()
    expect(inverseOf(layout(), { op: 'hide', id: 'a', hidden: false })).toBeUndefined()
    expect(inverseOf(layout(), { op: 'move', id: 'missing', x: 1, y: 1 })).toBeUndefined()
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
  applyLayoutOp(projectId: string, op: LayoutOpInput): Promise<string | undefined>
  currentLayout(projectId: string): Layout | undefined
}
// useLayout.ts imports React, which tsconfig.test.node.json leaves out of this project's files, so
// it is loaded through a computed specifier and given the signatures used here.
const useLayoutModule = (): Promise<UseLayoutModule> => import(/* @vite-ignore */ ['..', '..', 'src', 'renderer', 'canvas', 'useLayout.ts'].join('/')) as Promise<UseLayoutModule>

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
