// The done shelf (worfy-canvas ticket 02, ADR-0075, point 5): an Epic whose every Ticket is done and
// whose frame is collapsed leaves the strip of frames and stands as a chip on the shelf under it.
// The strip and the arrangement themselves: epic-arrangement.test.ts and epic-canvas.test.tsx.
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DONE_SHELF_KIND, EPIC_ARRANGEMENT_ID, EPIC_ARRANGEMENT_KIND, onThePlane, SOURCE_NODE_KINDS } from '../../src/shared/layout/derived'
import type { Layout, LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'
import type { Epic, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { arrange, stripSize } from '../../src/renderer/canvas/epic-arrangement'
import {
  FRAME_GAP,
  layoutShelf,
  onDoneShelf,
  placeStrip,
  SHELF_CHIP_GAP,
  SHELF_CHIP_HEIGHT,
  SHELF_MIN_WIDTH,
  SHELF_PADDING,
  shelfChipWidth,
  stackFrames,
} from '../../src/renderer/canvas/epic-layout'
import { applyRecorded, historyOf, type LayoutChannel } from '../../src/renderer/canvas/history'
import DoneShelfNode from '../../src/renderer/canvas/nodes/DoneShelfNode'
import type { CanvasFlowNode, CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import source, { arrangementOf, buildEpicNodes, epicNodeId, openDoneStacks, setDoneStack, foldHiddenDoneStacks, type DoneShelfData, type EpicFrameData } from '../../src/renderer/canvas/sources/epics'
import { acceptLayoutState, applyLayoutOp, currentLayout, LayoutOpsContext, type LayoutOps } from '../../src/renderer/canvas/useLayout'

// The badges and actions on a Ticket and a frame are other tickets' business: none here.
vi.mock('../../src/renderer/canvas/badges', () => ({ actions: [], badges: [] }))

// A fake main per Project: it applies `create` and `patchData` as src/main/layout/store.ts does
// and sends the new Layout back, so the history (history.ts) sees what main has.
const mains = vi.hoisted(() => new Map<string, { revision: number; layout: Layout }>())
vi.mock('../../src/renderer/canvas/useLayout', async (original) => {
  const actual = await original<typeof import('../../src/renderer/canvas/useLayout')>()
  return {
    ...actual,
    applyLayoutOp: (projectId: string, op: LayoutOpInput) => {
      const main = mains.get(projectId)
      if (main === undefined) return Promise.resolve(undefined)
      const nodes = main.layout.nodes
      if (op.op === 'create') {
        const id = op.node.id ?? 'made-up'
        if (nodes.some((node) => node.id === id)) return Promise.resolve(`A Node with id ${id} already exists`)
        main.layout = { ...main.layout, nodes: [...nodes, { hidden: false, locked: false, pinned: false, tags: [], ...op.node, data: op.node.data ?? {}, id }] }
      } else if (op.op === 'patchData') {
        if (!nodes.some((node) => node.id === op.id)) return Promise.resolve(`The Layout has no Node with id ${op.id}`)
        main.layout = { ...main.layout, nodes: nodes.map((node) => (node.id === op.id ? { ...node, data: { ...node.data, ...op.data } } : node)) }
      } else return Promise.resolve(`not in this fake: ${op.op}`)
      main.revision += 1
      actual.acceptLayoutState({ projectId, revision: main.revision, layout: main.layout })
      return Promise.resolve(undefined)
    },
  }
})

function ticket(epic: string, num: number, over: Partial<Ticket> = {}): Ticket {
  return {
    epic,
    num,
    slug: `t${num}`,
    title: `${num}`,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
    ...over,
  }
}
const done = { state: 'done' as const, statusRaw: 'done 2026-10-10' }
const epic = (name: string): Epic => ({ epic: name, hasSpec: true, hasMap: false, title: null })
const model = (tickets: Ticket[], epics: string[]): WorkflowModel => ({ root: '/repo', epics: epics.map(epic), tickets, error: null, branchErrors: [] })
const node = (over: Partial<LayoutNode> & { id: string }): LayoutNode => ({ kind: 'epic-frame', x: 0, y: 0, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data: {}, ...over })
const layoutWith = (nodes: LayoutNode[] = []): Layout => ({ nodes, viewport: { x: 0, y: 0, zoom: 1 } })
const frameNode = (name: string, collapsed: boolean | null) => node({ id: epicNodeId(name), data: { collapsed } })
const recordNode = (order: string[], columns = 1) => node({ id: EPIC_ARRANGEMENT_ID, kind: EPIC_ARRANGEMENT_KIND, data: { order, columns, at: '2026-10-20T08:00:00.000Z' } })

let project = 0
const freshProject = () => `shelf-${(project += 1)}`

const frames = (nodes: readonly CanvasFlowNode[]): string[] => nodes.filter((n) => n.type === 'epic-frame').map((n) => (n.data.node.data as EpicFrameData).epic.epic)
const shelfOf = (nodes: readonly CanvasFlowNode[]): CanvasFlowNode | undefined => nodes.find((n) => n.type === DONE_SHELF_KIND)
const chipsOf = (nodes: readonly CanvasFlowNode[]): string[] => ((shelfOf(nodes)?.data.node.data as DoneShelfData | undefined)?.chips ?? []).map((chip) => chip.epic)

/** a: every Ticket done; b: one of two done; c: no Tickets; d: open. */
const TICKETS = [ticket('a', 1, done), ticket('a', 2, done), ticket('b', 1, done), ticket('b', 2), ticket('d', 1)]
const EPICS = ['a', 'b', 'c', 'd']

describe('who is on the shelf', () => {
  it('onDoneShelf: every Ticket done and the frame collapsed — yes; open frame, a Ticket not done, or no Tickets — no', () => {
    const allDone = [ticket('a', 1, done), ticket('a', 2, done)]
    expect(onDoneShelf(allDone, true)).toBe(true)
    expect(onDoneShelf(allDone, false)).toBe(false)
    expect(onDoneShelf([ticket('a', 1, done), ticket('a', 2)], true)).toBe(false)
    expect(onDoneShelf([], true)).toBe(false)
  })

  it('a done Epic whose frame is collapsed by default is not in the strip: it is a chip on the shelf', () => {
    const id = freshProject()
    const nodes = buildEpicNodes(id, '/repo', model(TICKETS, EPICS), layoutWith(), {})
    expect(nodes.map((n) => n.id)).not.toContain(epicNodeId('a'))
    expect(frames(nodes)).toEqual(['b', 'c', 'd'])
    expect(chipsOf(nodes)).toEqual(['a'])
    const chip = (shelfOf(nodes)!.data.node.data as DoneShelfData).chips[0]!
    expect(chip).toMatchObject({ epic: 'a', done: 2, total: 2, saved: false })
  })

  it('a done Epic the user collapsed is on the shelf; the one the user opened stays in the strip', () => {
    const id = freshProject()
    const collapsed = buildEpicNodes(id, '/repo', model(TICKETS, EPICS), layoutWith([frameNode('a', true)]), {})
    expect(chipsOf(collapsed)).toEqual(['a'])
    expect((shelfOf(collapsed)!.data.node.data as DoneShelfData).chips[0]!.saved).toBe(true)
    const opened = buildEpicNodes(id, '/repo', model(TICKETS, EPICS), layoutWith([frameNode('a', false)]), {})
    expect(frames(opened)).toEqual(['a', 'b', 'c', 'd'])
    // An empty shelf is not drawn.
    expect(shelfOf(opened)).toBeUndefined()
  })

  it('an Epic with a Ticket not done stays in the strip when collapsed, and so does an Epic without Tickets', () => {
    const id = freshProject()
    const nodes = buildEpicNodes(id, '/repo', model(TICKETS, EPICS), layoutWith([frameNode('a', false), frameNode('b', true), frameNode('c', true)]), {})
    expect(frames(nodes)).toEqual(['a', 'b', 'c', 'd'])
    expect(shelfOf(nodes)).toBeUndefined()
  })

  it('the chips go in the order of the record, then by name; the Epics on the shelf are not in the strip\'s order', () => {
    const id = freshProject()
    const tickets = ['p', 'q', 'r', 's'].map((name) => ticket(name, 1, done)).concat([ticket('o', 1)])
    const nodes = buildEpicNodes(id, '/repo', model(tickets, ['o', 'p', 'q', 'r', 's']), layoutWith([recordNode(['r', 'o', 'p'])]), {})
    expect(chipsOf(nodes)).toEqual(['r', 'p', 'q', 's'])
    expect(frames(nodes)).toEqual(['o'])
  })

  it('is a source Node: owned by the Epic source, not on the plane, not listed by the canvas tools', () => {
    expect(SOURCE_NODE_KINDS).toContain(DONE_SHELF_KIND)
    expect(source.owns).toContain(DONE_SHELF_KIND)
    expect(onThePlane({ kind: DONE_SHELF_KIND, pinned: false, hidden: false })).toBe(false)
  })

  it('keeps the same shelf Node while nothing about it changed', () => {
    const id = freshProject()
    const first = shelfOf(buildEpicNodes(id, '/repo', model(TICKETS, EPICS), layoutWith(), {}))
    const second = shelfOf(buildEpicNodes(id, '/repo', model([...TICKETS], EPICS), layoutWith(), {}))
    expect(second).toBe(first)
  })
})

describe('where the shelf stands', () => {
  const strip = [
    { epic: 'x', width: 500, height: 300 },
    { epic: 'y', width: 600, height: 600 },
    { epic: 'z', width: 500, height: 200, reserve: 400 },
  ]

  it('at the strip\'s left edge, FRAME_GAP under its tallest column of reserved heights', () => {
    // Two columns 600 wide: x then z (300 + 48 + 400 reserved), y (600).
    const placed = placeStrip(strip, [], 2, 100, 1248)
    expect(placed.width).toBe(2 * 600 + FRAME_GAP)
    expect(placed.shelf).toEqual({ x: 0, y: 300 + FRAME_GAP + 400 + FRAME_GAP })
    expect(placed.frames.get('x')!.auto).toEqual({ x: 0, y: 0 })
    // Without a shelf it is stackFrames.
    expect(placeStrip(strip, [], 2).frames).toEqual(stackFrames(strip, [], 2))
  })

  it('its height counts in the strip\'s height for frameColumnX: a Node under the strip, clear of it alone, moves the strip', () => {
    const tallest = 300 + FRAME_GAP + 400
    const below = { x: 0, y: tallest + FRAME_GAP + 10, w: 100, h: 50 }
    expect(placeStrip(strip, [below], 2).frames.get('x')!.auto.x).toBe(0)
    const withShelf = placeStrip(strip, [below], 2, 120, 1248)
    expect(withShelf.shelf.x).toBe(below.x + below.w + FRAME_GAP)
    expect(withShelf.frames.get('x')!.auto.x).toBe(withShelf.shelf.x)
  })

  it('without frames in the strip the shelf stands at the top, as wide as it is', () => {
    const placed = placeStrip([], [{ x: 0, y: 0, w: 200, h: 80 }], 1, 72, SHELF_MIN_WIDTH)
    expect(placed.shelf).toEqual({ x: 200 + FRAME_GAP, y: 0 })
  })

  it('a frame with an offset yields to the shelf as to the frames of the strip', () => {
    // y's offset would put it over the shelf, which starts FRAME_GAP under the tallest column.
    const moved = [{ epic: 'x', width: 500, height: 300 }, { epic: 'y', width: 500, height: 200, offset: { dx: 0, dy: 400 } }]
    const placed = placeStrip(moved, [], 1, 100, 520)
    const y = placed.frames.get('y')!
    const shelfTop = placed.shelf.y
    const overlaps = y.y < shelfTop + 100 && shelfTop < y.y + 200 && y.x < placed.shelf.x + 520 && placed.shelf.x < y.x + 500
    expect(overlaps).toBe(false)
  })

  it('the shelf Node of a build stands at the strip\'s left edge under its tallest column', () => {
    const id = freshProject()
    const nodes = buildEpicNodes(id, '/repo', model(TICKETS, EPICS), layoutWith(), {})
    const strip = nodes.filter((n) => n.type === 'epic-frame')
    const left = Math.min(...strip.map((n) => n.position.x))
    const shelf = shelfOf(nodes)!
    expect(shelf.position.x).toBe(left)
    // Every frame of the strip ends at least FRAME_GAP above the shelf.
    for (const frame of strip) expect(frame.position.y + frame.height!).toBeLessThanOrEqual(shelf.position.y - FRAME_GAP)
    expect(shelf.width).toBe(Math.max(SHELF_MIN_WIDTH, stripSize(strip.map((n) => ({ width: n.width!, height: n.height! })), 1).width))
  })
})

describe('the chips wrap at the strip\'s width', () => {
  const entries = ['worfy-reliability', 'worfy-review', 'worfy-week', 'worfy-mvp', 'worfy-daily'].map((name) => ({ epic: name, done: 9, total: 9 }))

  it('a wide strip holds them in one row; a narrow one breaks them into rows, in order, each within the width', () => {
    const wide = layoutShelf(entries, 2400)
    expect(new Set(wide.chips.map((chip) => chip.y)).size).toBe(1)
    expect(wide.height).toBe(SHELF_PADDING + 24 + SHELF_CHIP_HEIGHT + SHELF_PADDING)

    const narrow = layoutShelf(entries, 520)
    const rows = new Set(narrow.chips.map((chip) => chip.y)).size
    expect(rows).toBeGreaterThan(1)
    expect(narrow.height).toBe(SHELF_PADDING + 24 + rows * SHELF_CHIP_HEIGHT + (rows - 1) * SHELF_CHIP_GAP + SHELF_PADDING)
    expect(narrow.chips.map((chip) => chip.epic)).toEqual(entries.map((entry) => entry.epic))
    for (const chip of narrow.chips) expect(chip.x + chip.w).toBeLessThanOrEqual(narrow.width - SHELF_PADDING)
    // Row by row, left to right.
    const sorted = [...narrow.chips].sort((a, b) => a.y - b.y || a.x - b.x)
    expect(sorted.map((chip) => chip.epic)).toEqual(entries.map((entry) => entry.epic))
  })

  it('a chip is as wide as its text in monospace with its chrome; one wider than the shelf is cut to it', () => {
    expect(shelfChipWidth({ epic: 'worfy-week', done: 20, total: 20 })).toBeGreaterThan(shelfChipWidth({ epic: 'worfy-mvp', done: 3, total: 3 }))
    const long = layoutShelf([{ epic: 'x'.repeat(200), done: 1, total: 1 }], 520)
    expect(long.chips[0]!.w).toBe(520 - 2 * SHELF_PADDING)
  })

  it('no entries: no shelf', () => {
    expect(layoutShelf([], 900)).toEqual({ width: 0, height: 0, chips: [] })
  })
})

describe('a chip', () => {
  afterEach(() => mains.clear())

  function opsOf(projectId: string): LayoutOps {
    const channel: LayoutChannel = { send: (op) => applyLayoutOp(projectId, op), layout: () => currentLayout(projectId) ?? layoutWith() }
    return { apply: async (op, group, options) => void (await applyRecorded(projectId, op, channel, group, options)) }
  }

  function start(projectId: string, nodes: LayoutNode[]): void {
    const layout = layoutWith(nodes)
    mains.set(projectId, { revision: 1, layout })
    acceptLayoutState({ projectId, revision: 1, layout })
  }

  function renderShelf(projectId: string) {
    const nodes = buildEpicNodes(projectId, '/repo', model(TICKETS, EPICS), currentLayout(projectId)!, {})
    const shelf = shelfOf(nodes)!
    const props = { id: shelf.id, data: shelf.data, selected: false } as unknown as CanvasNodeProps
    return render(
      <ReactFlowProvider>
        <LayoutOpsContext.Provider value={opsOf(projectId)}>
          <DoneShelfNode {...props} />
        </LayoutOpsContext.Provider>
      </ReactFlowProvider>,
    )
  }

  const mainNode = (projectId: string, id: string) => mains.get(projectId)!.layout.nodes.find((each) => each.id === id)

  it('is a button with the aria-label "Expand <epic>, N of N done", reachable by Tab', () => {
    const id = freshProject()
    start(id, [])
    const view = renderShelf(id)
    const chip = screen.getByRole('button', { name: 'Expand a, 2 of 2 done' })
    expect(chip.tagName).toBe('BUTTON')
    expect(chip.getAttribute('type')).toBe('button')
    expect(chip.getAttribute('tabindex')).toBeNull()
    expect(chip.textContent).toBe('a2/2')
    view.unmount()
  })

  it('opens the frame and moves the Epic to the end of the record\'s order, as one step of ⌘Z', async () => {
    const id = freshProject()
    start(id, [recordNode(['a', 'b', 'c', 'd'], 2)])
    const view = renderShelf(id)
    screen.getByRole('button', { name: 'Expand a, 2 of 2 done' }).click()
    await vi.waitFor(() => expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['b', 'c', 'd', 'a']))
    view.unmount()
    expect(mainNode(id, epicNodeId('a'))!.data.collapsed).toBe(false)
    expect(historyOf(id).size).toBe(1)
    const opened = buildEpicNodes(id, '/repo', model(TICKETS, EPICS), currentLayout(id)!, {})
    expect(frames(opened)).toContain('a')
    expect(shelfOf(opened)).toBeUndefined()

    expect(await historyOf(id).undo()).toBe(true)
    expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['a', 'b', 'c', 'd'])
    expect(chipsOf(buildEpicNodes(id, '/repo', model(TICKETS, EPICS), currentLayout(id)!, {}))).toEqual(['a'])
  })

  it('leaves the record alone when it does not have the Epic: the frame comes last anyway', async () => {
    const id = freshProject()
    start(id, [frameNode('a', true), recordNode(['b', 'c', 'd'], 1)])
    const view = renderShelf(id)
    screen.getByRole('button', { name: 'Expand a, 2 of 2 done' }).click()
    await vi.waitFor(() => expect(mainNode(id, epicNodeId('a'))!.data.collapsed).toBe(false))
    view.unmount()
    expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['b', 'c', 'd'])
    buildEpicNodes(id, '/repo', model(TICKETS, EPICS), currentLayout(id)!, {})
    const state = arrangementOf(id)!
    expect(arrange(state.epics, state.frames, state.record).order).toEqual(['b', 'c', 'd', 'a'])
    expect(historyOf(id).size).toBe(1)
  })
})

describe('the done stack of an Epic on the shelf', () => {
  it('is folded: no frame shows it, so Esc must not fold it unseen', () => {
    const id = freshProject()
    setDoneStack(id, 'a', true)
    setDoneStack(id, 'd', true)
    const nodes = buildEpicNodes(id, '/repo', model(TICKETS, EPICS), layoutWith(), {})
    foldHiddenDoneStacks(id, nodes)
    expect(openDoneStacks(id)).not.toContain('a')
  })
})
