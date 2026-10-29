// "Tidy up" (src/renderer/canvas/tidy.ts, worfy-week/07): what is laid out, ELK's packing, the one
// group operation and its single undo step. The operation goes through the undo history the Canvas
// records it in, to a stand-in for main that corrects a `moveMany` with the same shared function as
// main does (`freeShift`, src/main/layout/store.ts; ADR-0038), so a group that lands on a Node would
// show up shifted here. jsdom has no Worker: the rectangles are packed by ELK without one
// (elkjs/lib/elk.bundled.js), as in the tests of the Epic frames.
//
// The file is .tsx, in the jsdom project, though the ticket names tidy.test.ts: tidy.ts uses the
// renderer's modules (React, the Subagent source), which the node project's type check does not
// take in (tsconfig.test.node.json lists its renderer files one by one).
import { act, renderHook } from '@testing-library/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyRecorded, historyOf, resetHistories } from '../../src/renderer/canvas/history'
import type { ElkEngine } from '../../src/renderer/canvas/elk/layout'
import { packGraph } from '../../src/renderer/canvas/elk/pack'
import { clearShift, placeSubagents } from '../../src/renderer/canvas/sources/subagents'
import { naturalTreeBlocks, runTidyUp, tidyOperation, useTidyUpRequests } from '../../src/renderer/canvas/tidy'
import { TIDY_GAP, tidyItems } from '../../src/renderer/canvas/tidy-items'
import { acceptLayoutState } from '../../src/renderer/canvas/useLayout'
import { requestTidyUp } from '../../src/renderer/find/canvas-requests'
import type { Rect } from '../../src/renderer/canvas/epic-layout'
import { crowds, freeShift, isParticipant, NODE_GAP, obstaclesFor } from '../../src/shared/layout/free-place'
import { DEFAULT_VIEWPORT, layoutNodeSchema, layoutOpSchema, type Layout, type LayoutNode, type LayoutOpInput, type LayoutState } from '../../src/shared/layout/types'
import type { SubagentInfo } from '../../src/shared/transcript/subagents'

/**
 * main's Layout store as far as these tests need it: `create` (the fixtures never crowd, so the
 * place is taken as given — checked), `move`, and `moveMany` corrected as main corrects it.
 */
class FakeMain {
  private nodes: LayoutNode[] = []
  private revision = 0

  get(projectId: string): LayoutState {
    const layout: Layout = { nodes: this.nodes, viewport: DEFAULT_VIEWPORT }
    return { projectId, layout, revision: this.revision }
  }

  apply(projectId: string, input: LayoutOpInput): void {
    const op = layoutOpSchema.parse(input)
    if (op.op === 'create') {
      const node = layoutNodeSchema.parse({ ...op.node, id: op.node.id ?? `n${this.nodes.length}` })
      if (isParticipant(node) && obstaclesFor(this.nodes, new Set()).some((other) => crowds(node, other))) throw new Error(`fixture ${node.id} crowds a Node`)
      this.nodes = [...this.nodes, node]
    } else if (op.op === 'move') {
      this.nodes = this.nodes.map((node) => (node.id === op.id ? { ...node, x: op.x, y: op.y } : node))
    } else if (op.op === 'moveMany') {
      const at = new Map(op.moves.map((move) => [move.id, move]))
      for (const { id } of op.moves) {
        const node = this.nodes.find((each) => each.id === id)
        if (node === undefined || node.pinned) throw new Error(`cannot move ${id}`)
      }
      const moved = this.nodes.map((node) => (at.has(node.id) ? { ...node, x: at.get(node.id)!.x, y: at.get(node.id)!.y } : node))
      const group = moved.filter((node) => at.has(node.id) && isParticipant(node))
      const { dx, dy } = freeShift(group, obstaclesFor(moved, new Set(at.keys())))
      this.nodes = moved.map((node) => (group.includes(node) ? { ...node, x: node.x + dx, y: node.y + dy } : node))
    } else throw new Error(`FakeMain does not apply ${op.op}`)
    this.revision += 1
    acceptLayoutState(this.get(projectId))
  }
}

let projectSeq = 0
let PROJECT = ''
let store: FakeMain
let sent: LayoutOpInput[]
const elk: ElkEngine = new ELK()

const layout = () => store.get(PROJECT).layout
const nodeOf = (id: string): LayoutNode => layout().nodes.find((node) => node.id === id)!
/** main as the Canvas reaches it: the operation is applied, and the renderer's copy of the Layout takes the answer. */
const send = (op: LayoutOpInput): Promise<string | undefined> => {
  sent.push(op)
  try {
    store.apply(PROJECT, op)
    acceptLayoutState(store.get(PROJECT))
    return Promise.resolve(undefined)
  } catch (error) {
    return Promise.resolve(error instanceof Error ? error.message : String(error))
  }
}
/** The Canvas's LayoutOps: every operation is a step of the undo history. */
const apply = async (op: LayoutOpInput): Promise<void> => {
  await applyRecorded(PROJECT, op, { send, layout }, undefined)
}
const create = (node: Partial<LayoutNode> & { id: string; kind: string; x: number; y: number; w: number; h: number }) => {
  store.apply(PROJECT, { op: 'create', node: { data: {}, ...node } })
  acceptLayoutState(store.get(PROJECT))
}

function subagent(id: string, status: SubagentInfo['status'] = 'running'): SubagentInfo {
  return {
    id,
    agentId: null,
    toolUseId: id,
    parentAgentId: null,
    name: id,
    subagentType: 'implementer',
    model: null,
    description: null,
    status,
    background: false,
    startedAt: 0,
    durationMs: null,
    summary: null,
    verdict: null,
    depth: 1,
    transcript: true,
    children: [],
  }
}

const SESSION_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
/** The Session `s` has three Subagents: two running, one done (folded into one row). */
const TREE: readonly SubagentInfo[] = [subagent('one'), subagent('two'), subagent('three', 'done')]
const trees = new Map([[SESSION_ID, TREE]])
const treeBlocks = () => naturalTreeBlocks(PROJECT, layout(), trees)

/**
 * Twelve Layout Nodes scattered over the plane: a Session with its Subagent tree, Cards, Notes, a
 * Terminal, the Orchestrator, HANDOFF, a pinned Note and a hidden Card. None crowds another (main
 * would move it when it is created), and none is on the 8 px grid.
 */
function scatter(): void {
  create({ id: 'c1', kind: 'card', x: 1803, y: 61, w: 300, h: 180 })
  create({ id: 's', kind: 'session', x: 245, y: 413, w: 480, h: 320, data: { origin: 'worfy', sessionId: SESSION_ID } })
  create({ id: 'n1', kind: 'note', x: 37, y: 1203, w: 220, h: 120 })
  create({ id: 'c2', kind: 'card', x: 2603, y: 1101, w: 340, h: 210 })
  create({ id: 'n2', kind: 'note', x: 1405, y: 1590, w: 220, h: 150 })
  create({ id: 't1', kind: 'terminal', x: 3001, y: 333, w: 560, h: 340 })
  create({ id: 'o', kind: 'orchestrator', x: 101, y: 21, w: 420, h: 300 })
  create({ id: 'hf', kind: 'handoff', x: 2205, y: 2207, w: 360, h: 260 })
  create({ id: 'c3', kind: 'card', x: 811, y: 2603, w: 260, h: 170 })
  create({ id: 'n3', kind: 'note', x: 3603, y: 1803, w: 230, h: 130 })
  create({ id: 'p', kind: 'note', x: 13, y: 17, w: 200, h: 100, pinned: true })
  create({ id: 'h', kind: 'card', x: 5, y: 9, w: 300, h: 180, hidden: true })
}

const MOVED = ['c1', 's', 'n1', 'c2', 'n2', 't1', 'o', 'hf', 'c3', 'n3']

/** Every Node `tidyItems` packs, as the rectangle around it and its tree. */
const rects = (): Map<string, Rect> => new Map(tidyItems(layout().nodes, treeBlocks()).map((item) => [item.id, item.rect]))

/** The distance between two rectangles that do not overlap: the larger of the gaps on x and on y. */
function gapBetween(a: Rect, b: Rect): number {
  const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
  const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
  return Math.max(gx, gy)
}

const readingOrder = (ids: readonly string[]) =>
  [...ids].sort((a, b) => {
    const ra = rects().get(a)!
    const rb = rects().get(b)!
    return ra.y - rb.y || ra.x - rb.x
  })

beforeEach(() => {
  resetHistories()
  sent = []
  projectSeq += 1
  PROJECT = `tidy-${String(projectSeq).padStart(8, '0')}`
  store = new FakeMain()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Tidy up', () => {
  it('lays out twelve scattered Nodes: none closer than 16 px, pinned and hidden stay, the tree clear of its neighbours, sizes kept, corners on the grid, reading order', async () => {
    scatter()
    const before = new Map(layout().nodes.map((node) => [node.id, { ...node }]))
    const order = readingOrder(MOVED)
    const corner = rects()
    const left = Math.round(Math.min(...[...corner.values()].map((r) => r.x)) / 8) * 8
    const top = Math.round(Math.min(...[...corner.values()].map((r) => r.y)) / 8) * 8

    const op = await runTidyUp(PROJECT, () => treeBlocks(), apply, elk)
    expect(op?.op).toBe('moveMany')
    // A layout command: main does not count the moved Nodes as touched (ADR-0076, Amendments).
    expect(op).toMatchObject({ arrange: true })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(op)

    // main took the places as sent: the group as a whole lands on nothing (ADR-0038).
    for (const move of op!.op === 'moveMany' ? op!.moves : []) expect(nodeOf(move.id)).toMatchObject({ x: move.x, y: move.y })

    const after = rects()
    expect([...after.keys()].sort()).toEqual([...MOVED].sort())
    const ids = [...after.keys()]
    for (const a of ids) for (const b of ids) if (a < b) expect(gapBetween(after.get(a)!, after.get(b)!), `${a} and ${b}`).toBeGreaterThanOrEqual(NODE_GAP)
    // Packed, not spread out: every rectangle has a neighbour TIDY_GAP away, give or take the
    // padding of its size up to the grid.
    for (const a of ids) {
      const nearest = Math.min(...ids.filter((b) => b !== a).map((b) => gapBetween(after.get(a)!, after.get(b)!)))
      expect(nearest, a).toBeGreaterThanOrEqual(TIDY_GAP)
      expect(nearest, a).toBeLessThan(TIDY_GAP + 8)
    }

    expect(nodeOf('p')).toEqual(before.get('p'))
    expect(nodeOf('h')).toEqual(before.get('h'))

    // The tree, where it hangs with nothing in its way, covers no neighbour: it does not move off them.
    const session = nodeOf('s')
    const around = layout()
      .nodes.filter((node) => node.id !== 's' && !node.pinned && !node.hidden)
      .map((node) => ({ x: node.x - session.x, y: node.y - session.y, w: node.w, h: node.h }))
    const tree = placeSubagents({ sessionId: SESSION_ID, sessionWidth: session.w, tree: TREE, expanded: () => false }).filter((place) => place.key !== 'anchor')
    expect(tree).toHaveLength(3)
    expect(clearShift(tree, around)).toEqual({ dx: 0, dy: 0 })

    for (const id of MOVED) {
      const node = nodeOf(id)
      expect([node.w, node.h], id).toEqual([before.get(id)!.w, before.get(id)!.h])
      expect([node.x % 8, node.y % 8], id).toEqual([0, 0])
    }
    expect(readingOrder(MOVED)).toEqual(order)
    expect(Math.min(...[...after.values()].map((r) => r.x))).toBe(left)
    expect(Math.min(...[...after.values()].map((r) => r.y))).toBe(top)
  })

  it('a second Tidy up right after the first sends no operation', async () => {
    scatter()
    await runTidyUp(PROJECT, () => treeBlocks(), apply, elk)
    expect(sent).toHaveLength(1)
    expect(await runTidyUp(PROJECT, () => treeBlocks(), apply, elk)).toBeUndefined()
    expect(sent).toHaveLength(1)
    expect(historyOf(PROJECT).size).toBe(1)
  })

  it('a second Tidy up finds nothing to move on forty Canvases of random sizes', async () => {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let canvas = 0; canvas < 40; canvas += 1) {
      const nodes: LayoutNode[] = Array.from({ length: 3 + Math.floor(random() * 20) }, (_, index) => ({
        id: `n${index}`,
        kind: 'note',
        x: Math.round(random() * 5000),
        y: Math.round(random() * 5000),
        w: 80 + Math.round(random() * 560),
        h: 48 + Math.round(random() * 400),
        hidden: false,
        locked: false,
        pinned: false,
        tags: [],
        data: {},
      }))
      const op = await tidyOperation(nodes, new Map(), elk)
      const at = new Map((op?.op === 'moveMany' ? op.moves : []).map((move) => [move.id, move]))
      const tidied = nodes.map((node) => ({ ...node, x: at.get(node.id)?.x ?? node.x, y: at.get(node.id)?.y ?? node.y }))
      expect(await tidyOperation(tidied, new Map(), elk), `Canvas ${canvas}`).toBeUndefined()
    }
  })

  it('is one step: one ⌘Z puts every Node back to the unit, ⇧⌘Z tidies again', async () => {
    scatter()
    const before = layout().nodes.map((node) => ({ ...node }))
    await runTidyUp(PROJECT, () => treeBlocks(), apply, elk)
    const tidied = layout().nodes.map((node) => ({ ...node }))
    expect(tidied).not.toEqual(before)
    expect(historyOf(PROJECT).size).toBe(1)

    expect(await historyOf(PROJECT).undo()).toBe(true)
    expect(layout().nodes).toEqual(before)
    expect(await historyOf(PROJECT).redo()).toBe(true)
    expect(layout().nodes).toEqual(tidied)
  })

  it('does nothing with no Node or with one Node on the plane', async () => {
    acceptLayoutState(store.get(PROJECT))
    expect(await runTidyUp(PROJECT, () => new Map(), apply, elk)).toBeUndefined()
    create({ id: 'only', kind: 'note', x: 13, y: 17, w: 220, h: 120 })
    create({ id: 'pinned', kind: 'note', x: 900, y: 900, w: 220, h: 120, pinned: true })
    expect(await runTidyUp(PROJECT, () => new Map(), apply, elk)).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  it('packs the Layout again when a Node moved while ELK was packing', async () => {
    scatter()
    let calls = 0
    const moving: ElkEngine = {
      layout: async (graph) => {
        calls += 1
        // An agent moves a Card while the first packing is out.
        if (calls === 1) {
          store.apply(PROJECT, { op: 'move', id: 'c3', x: 4011, y: 3005 })
          acceptLayoutState(store.get(PROJECT))
        }
        return elk.layout(graph)
      },
    }
    const op = await runTidyUp(PROJECT, () => treeBlocks(), apply, moving)
    expect(calls).toBe(2)
    expect(sent).toHaveLength(1)
    // The second packing read c3 at its new place: it is now the last in reading order.
    const moves = op!.op === 'moveMany' ? op!.moves : []
    expect(moves.at(-1)?.id).toBe('c3')
  })

  it('a second Tidy up while one runs is dropped; one whose packing fails moves nothing', async () => {
    scatter()
    let release: () => void = () => undefined
    const slow: ElkEngine = { layout: (graph) => new Promise((resolve) => (release = () => resolve(elk.layout(graph)))) }
    const first = runTidyUp(PROJECT, () => treeBlocks(), apply, slow)
    expect(await runTidyUp(PROJECT, () => treeBlocks(), apply, elk)).toBeUndefined()
    release()
    expect((await first)?.op).toBe('moveMany')
    expect(sent).toHaveLength(1)

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    store.apply(PROJECT, { op: 'move', id: 'c1', x: 6001, y: 6001 })
    acceptLayoutState(store.get(PROJECT))
    expect(await runTidyUp(PROJECT, () => treeBlocks(), apply, { layout: () => Promise.reject(new Error('worker gone')) })).toBeUndefined()
    expect(sent).toHaveLength(1)
    expect(error).toHaveBeenCalled()
  })

  it('packs a Session and its tree as one rectangle, and keeps ELK to the input order with the SIMPLE strategy', async () => {
    scatter()
    const items = tidyItems(layout().nodes, treeBlocks())
    const session = items.find((item) => item.id === 's')!
    const block = treeBlocks().get('s')!
    expect(session.rect).toEqual({ x: nodeOf('s').x, y: nodeOf('s').y, w: block.x + block.w, h: Math.max(320, block.h) })
    expect(packGraph([{ id: 'a', w: 8, h: 8 }], TIDY_GAP).layoutOptions).toMatchObject({ 'elk.algorithm': 'rectpacking', 'elk.rectpacking.packing.strategy': 'SIMPLE', 'elk.spacing.nodeNode': '24' })
    // Without the tree the Session's rectangle is the Session alone.
    expect(tidyItems(layout().nodes).find((item) => item.id === 's')!.rect).toEqual({ x: nodeOf('s').x, y: nodeOf('s').y, w: 480, h: 320 })
    expect(await tidyOperation(layout().nodes.slice(0, 1), new Map(), elk)).toBeUndefined()
  })
})

// The palette leaves a request (find/canvas-requests.ts); the Canvas menu carries it out with the
// same "Tidy up" its own item runs (overlays/CanvasMenu.tsx).
describe("the palette's Tidy up (useTidyUpRequests)", () => {
  it('runs once per request for its Project: not for one made before it was mounted, nor for another Project', () => {
    const run = vi.fn(() => Promise.resolve())
    act(() => requestTidyUp('tidy-requests'))
    const { rerender, unmount } = renderHook(({ fn }) => useTidyUpRequests('tidy-requests', fn), { initialProps: { fn: run } })
    expect(run).not.toHaveBeenCalled()
    act(() => requestTidyUp('tidy-requests-other'))
    expect(run).not.toHaveBeenCalled()
    act(() => requestTidyUp('tidy-requests'))
    expect(run).toHaveBeenCalledTimes(1)
    // The Canvas menu's tidyUp changes identity with the Subagent trees and Layout operations.
    rerender({ fn: (() => run()) as typeof run })
    expect(run).toHaveBeenCalledTimes(1)
    act(() => requestTidyUp('tidy-requests'))
    expect(run).toHaveBeenCalledTimes(2)
    unmount()
  })
})
