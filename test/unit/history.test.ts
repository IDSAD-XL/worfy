// Undo and redo of the Layout (src/renderer/canvas/history.ts, ticket 30) against main's own Layout
// store: every operation and every inverse goes through LayoutStore.apply, the code that applies
// them in the app, so an inverse that main would read differently fails here.
import { beforeEach, describe, expect, it } from 'vitest'
import { applyRecorded, grouped, History, historyOf, HISTORY_DEPTH, inverseOf, resetHistories, trashRecorded, type Send, type TrashClient } from '../../src/renderer/canvas/history'
import { LayoutStore } from '../../src/main/layout/store'
import type { TrashEntry } from '../../src/shared/ipc/trash'
import type { LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'

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
/** An operation the user makes on the Canvas: recorded against the Layout as it was just before. */
const user = (op: LayoutOpInput) => applyRecorded(PROJECT, layout(), op, send)
/** An operation an agent makes through the canvas MCP tools: main applies it directly. */
const agent = (op: LayoutOpInput) => store.apply(PROJECT, op)
const history = () => historyOf(PROJECT)
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

  it('a create gets its id before it is sent, so its undo can name it', async () => {
    await user({ op: 'create', node: { kind: 'note', x: 0, y: 0, w: 220, h: 120 } })
    const first = sent[0]
    expect(first?.op === 'create' && typeof first.node.id === 'string' && first.node.id.length > 0).toBe(true)
  })
})

describe('history: operations of agents', () => {
  it('what an agent does through the MCP tools is not in the user history, and an undo leaves it in place', async () => {
    note('mine')
    note('theirs')
    await user({ op: 'move', id: 'mine', x: 100, y: 100 })
    agent({ op: 'move', id: 'theirs', x: 500, y: 500 })
    agent({ op: 'create', node: { id: 'card-by-agent', kind: 'card', x: 0, y: 0, w: 360, h: 280 } })
    agent({ op: 'move', id: 'mine', x: 120, y: 130 })
    expect(history().size).toBe(1)

    expect(await history().undo()).toBe(true)
    expect(nodeOf('mine')).toMatchObject({ x: 0, y: 0 })
    expect(nodeOf('theirs')).toMatchObject({ x: 500, y: 500 })
    expect(nodeOf('card-by-agent')).toBeDefined()
    expect(history().canUndo).toBe(false)
  })
})

describe('history: one gesture, one step', () => {
  it('operations made inside grouped() are undone and redone together', async () => {
    note('a')
    note('b')
    await grouped(() => Promise.all([user({ op: 'move', id: 'a', x: 10, y: 0 }), user({ op: 'move', id: 'b', x: 20, y: 0 })]))
    expect(history().size).toBe(1)
    await history().undo()
    expect([nodeOf('a')?.x, nodeOf('b')?.x]).toEqual([0, 0])
    await history().redo()
    expect([nodeOf('a')?.x, nodeOf('b')?.x]).toEqual([10, 20])
  })

  it('a grouped undo runs every part even when one part is refused', async () => {
    note('a')
    note('b')
    await grouped(async () => {
      await user({ op: 'move', id: 'a', x: 10, y: 0 })
      await user({ op: 'move', id: 'b', x: 20, y: 0 })
    })
    agent({ op: 'remove', id: 'b' })
    expect(await history().undo()).toBe(false)
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

  it('a refused delete is not a step', async () => {
    const trash: TrashClient = {
      put: () => Promise.resolve({ ok: false, error: 'locked' }),
      restore: () => Promise.reject(new Error('never called')),
    }
    expect(await trashRecorded(PROJECT, 'orch', trash)).toBe('locked')
    expect(history().canUndo).toBe(false)
  })
})
