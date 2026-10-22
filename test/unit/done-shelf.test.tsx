// The done shelf (worfy-canvas ticket 02, ADR-0075, point 5): an Epic whose every Ticket is done and
// whose frame is collapsed leaves the strip of frames and stands as a chip on the shelf under it.
// The strip and the arrangement themselves: epic-arrangement.test.ts and epic-canvas.test.tsx.
import { act, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Binding } from '../../src/shared/binding/resolve'
import { DONE_SHELF_ID, DONE_SHELF_KIND, EPIC_ARRANGEMENT_ID, EPIC_ARRANGEMENT_KIND, onThePlane, SOURCE_NODE_KINDS } from '../../src/shared/layout/derived'
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
import EpicFrameNode from '../../src/renderer/canvas/nodes/EpicFrameNode'
import { rectOf } from '../../src/renderer/find/node-rect'
import type { CanvasFlowNode, CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import { buildBindingAnchors, epicAnchorId } from '../../src/renderer/canvas/sources/workflow-bindings'
import { arrangementOf, useArrangementUpkeep } from '../../src/renderer/canvas/arrangement-record'
import source, { buildEpicNodes, epicPlace, shelfChipRect, epicNodeId, openDoneStacks, setDoneStack, foldHiddenDoneStacks, type DoneShelfData, type EpicFrameData } from '../../src/renderer/canvas/sources/epics'
import { acceptLayoutState, applyLayoutOp, currentLayout, LayoutOpsContext, type LayoutOps } from '../../src/renderer/canvas/useLayout'

// The badges and actions on a Ticket and a frame are other tickets' business: none here.
vi.mock('../../src/renderer/canvas/badges', () => ({ actions: [], badges: [] }))

// The read-only hint of the screen, as useReadOnly() answers it (worfy-link ticket 25).
const readOnly = vi.hoisted(() => ({ hint: null as string | null }))
vi.mock('../../src/renderer/projects/useProjects', async (original) => ({
  ...(await original<typeof import('../../src/renderer/projects/useProjects')>()),
  useReadOnly: () => readOnly.hint,
}))

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
const recordNode = (order: string[], columns = 1) => node({ id: EPIC_ARRANGEMENT_ID, kind: EPIC_ARRANGEMENT_KIND, data: { order, columns, at: new Date().toISOString() } })

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

  it('at the strip\'s left edge, FRAME_GAP under its tallest column of visible heights, not of reserved ones (ADR-0082)', () => {
    // Two columns 600 wide: x then z (300 + 48 + 200 visible, 300 + 48 + 400 reserved), y (600).
    const placed = placeStrip(strip, [], 2, 100, 1248)
    expect(placed.width).toBe(2 * 600 + FRAME_GAP)
    expect(placed.shelf).toEqual({ x: 0, y: 600 + FRAME_GAP })
    expect(placed.frames.get('x')!.auto).toEqual({ x: 0, y: 0 })
    // Without a shelf it is stackFrames.
    expect(placeStrip(strip, [], 2).frames).toEqual(stackFrames(strip, [], 2))
  })

  it('an open done stack whose column reaches the shelf moves it down under the column; folded, the shelf is back up', () => {
    // z with its done stack open is as tall as its reserve: x then z, 300 + 48 + 400, is the tallest column.
    const open = strip.map((frame) => (frame.epic === 'z' ? { ...frame, height: 400 } : frame))
    expect(placeStrip(open, [], 2, 100, 1248).shelf).toEqual({ x: 0, y: 300 + FRAME_GAP + 400 + FRAME_GAP })
    expect(placeStrip(strip, [], 2, 100, 1248).shelf).toEqual({ x: 0, y: 600 + FRAME_GAP })
    // An open stack whose column stays above y's leaves the shelf where it is.
    const short = strip.map((frame) => (frame.epic === 'z' ? { ...frame, height: 250 } : frame))
    expect(placeStrip(short, [], 2, 100, 1248).shelf).toEqual({ x: 0, y: 600 + FRAME_GAP })
  })

  it('the strip\'s x is still found for the reserve and the shelf under it: a Node under the visible frames, within that room, moves the strip', () => {
    // Column x then z: 548 visible, 748 reserved; the room is the reserve, FRAME_GAP, and the shelf's 50.
    // The shelf itself stands at 648-698, under the frames as drawn.
    const room = 300 + FRAME_GAP + 400 + FRAME_GAP + 50
    const placed = placeStrip(strip, [], 2, 50, 1248)
    expect(placed.roomHeight).toBe(room)
    expect(placed.shelf.y + 50).toBeLessThan(room)
    // Clear of the shelf and of the visible frames, but within FRAME_GAP of the room.
    const within = { x: 0, y: room + FRAME_GAP - 1, w: 100, h: 50 }
    const moved = placeStrip(strip, [within], 2, 50, 1248)
    expect(moved.shelf.x).toBe(within.x + within.w + FRAME_GAP)
    expect(moved.frames.get('x')!.auto.x).toBe(moved.shelf.x)
    // Just past it the strip stays at x = 0.
    expect(placeStrip(strip, [{ ...within, y: within.y + 1 }], 2, 50, 1248).shelf.x).toBe(0)
    // No shelf: the room is the reserve alone.
    expect(placeStrip(strip, [], 2).roomHeight).toBe(300 + FRAME_GAP + 400)
  })

  it('opening a done stack moves the shelf only: the room and the strip\'s x stay (ADR-0032, ADR-0082, point 3)', () => {
    // One frame 500 tall as drawn, 3000 with its done stack open; a shelf 100 tall; a Node 300 wide
    // under the reserve, within FRAME_GAP of the room (3000 + 48 + 100).
    const folded = { epic: 'a', width: 500, height: 500, reserve: 3000 }
    const open = { ...folded, height: 3000 }
    const node = { x: 0, y: 3049, w: 300, h: 50 }
    const before = placeStrip([folded], [node], 1, 100, 500)
    const after = placeStrip([open], [node], 1, 100, 500)
    expect(before.shelf.y).toBe(500 + FRAME_GAP)
    expect(after.shelf.y).toBe(3000 + FRAME_GAP)
    expect(before.roomHeight).toBe(3000 + FRAME_GAP + 100)
    expect(after.roomHeight).toBe(before.roomHeight)
    expect(before.shelf.x).toBe(300 + FRAME_GAP)
    expect(after.shelf.x).toBe(before.shelf.x)
    expect(after.frames.get('a')!.auto.x).toBe(before.frames.get('a')!.auto.x)
    // A Node past the room moves the strip neither way.
    const past = { ...node, y: 3000 + FRAME_GAP + 100 + FRAME_GAP }
    expect(placeStrip([folded], [past], 1, 100, 500).shelf.x).toBe(0)
    expect(placeStrip([open], [past], 1, 100, 500).shelf.x).toBe(0)
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
    // The column: x 0–300, y 348–548; the shelf 596–696. y's offset of 300 puts it at 648–848, on
    // the shelf: without the yield it would stand there.
    const moved = [{ epic: 'x', width: 500, height: 300 }, { epic: 'y', width: 500, height: 200, offset: { dx: 0, dy: 300 } }]
    const placed = placeStrip(moved, [], 1, 100, 520)
    const y = placed.frames.get('y')!
    const shelfTop = placed.shelf.y
    expect(shelfTop).toBe(596)
    expect(y.auto).toEqual({ x: 0, y: 348 })
    expect(y).not.toMatchObject({ x: 0, y: 648 })
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

  it('the Nodes of a build end at the shelf, FRAME_GAP under the lowest frame drawn, so the minimap bounds are the frames\' (ADR-0082)', () => {
    // b has five done Tickets: its folded done stack keeps room for the open one under the frame.
    const id = freshProject()
    const tickets = [ticket('a', 1, done), ...[1, 2, 3, 4, 5].map((num) => ticket('b', num, done)), ticket('b', 6), ticket('d', 1)]
    const build = (doneExpanded: Record<string, boolean>) => buildEpicNodes(id, '/repo', model(tickets, EPICS), layoutWith(), doneExpanded)
    const bottomOf = (nodes: readonly CanvasFlowNode[]) => Math.max(...nodes.filter((n) => n.type === 'epic-frame').map((n) => n.position.y + n.height!))
    const folded = build({})
    const open = build({ [`${id}|b`]: true })
    expect(bottomOf(open)).toBeGreaterThan(bottomOf(folded))
    expect(shelfOf(open)!.position.y).toBeGreaterThan(shelfOf(folded)!.position.y)
    // Folded again after the open build: the shelf is back where it stood.
    const refolded = build({})
    expect(shelfOf(refolded)!.position).toEqual(shelfOf(folded)!.position)
    for (const nodes of [folded, open, refolded]) {
      const shelf = shelfOf(nodes)!
      expect(shelf.position.y).toBe(bottomOf(nodes) + FRAME_GAP)
      // Nothing of the Epic source stands lower than the shelf: React Flow's MiniMap takes its bounds from these Nodes.
      // Ticket Nodes stand inside their frames (parentId), so the Nodes on the plane are the frames and the shelf.
      const onPlane = nodes.filter((n) => n.parentId === undefined)
      expect(Math.max(...onPlane.map((n) => n.position.y + (n.height ?? 0)))).toBe(shelf.position.y + shelf.height!)
    }
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

  it('writes the Epic last also when the record does not have it; two chips opened one after another keep the order of the clicks', async () => {
    const id = freshProject()
    // p, q and r are done and on the shelf; the day's record names the strip's Epic only.
    const tickets = [ticket('o', 1), ticket('p', 1, done), ticket('q', 1, done), ticket('r', 1, done)]
    const workflow = model(tickets, ['o', 'p', 'q', 'r'])
    start(id, [recordNode(['o'], 1)])
    const click = async (name: string) => {
      const shelf = shelfOf(buildEpicNodes(id, '/repo', workflow, currentLayout(id)!, {}))!
      const props = { id: shelf.id, data: shelf.data, selected: false } as unknown as CanvasNodeProps
      const view = render(
        <ReactFlowProvider>
          <LayoutOpsContext.Provider value={opsOf(id)}>
            <DoneShelfNode {...props} />
          </LayoutOpsContext.Provider>
        </ReactFlowProvider>,
      )
      screen.getByRole('button', { name: `Expand ${name}, 1 of 1 done` }).click()
      await vi.waitFor(() => expect(mainNode(id, epicNodeId(name))?.data.collapsed).toBe(false))
      view.unmount()
    }
    // q first, then p: by name p would come first.
    await click('q')
    await click('p')
    expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['o', 'q', 'p'])
    buildEpicNodes(id, '/repo', workflow, currentLayout(id)!, {})
    const state = arrangementOf(id)!
    expect(arrange(state.epics, state.frames, state.record).order).toEqual(['o', 'q', 'p'])
    expect(historyOf(id).size).toBe(2)
    // ⌘Z of the second click: p back on the shelf, the order as after the first.
    expect(await historyOf(id).undo()).toBe(true)
    expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['o', 'q'])
    expect(chipsOf(buildEpicNodes(id, '/repo', workflow, currentLayout(id)!, {}))).toEqual(['p', 'r'])
  })

  it('on a read-only screen it stays, inactive, with the hint as its tooltip, and a click sends nothing', async () => {
    const id = freshProject()
    start(id, [recordNode(['a', 'b', 'c', 'd'], 2)])
    readOnly.hint = 'Studio gives this Machine read-only access'
    try {
      const view = renderShelf(id)
      const chip = screen.getByRole('button', { name: 'Expand a, 2 of 2 done' })
      expect(chip.getAttribute('aria-disabled')).toBe('true')
      expect(chip.getAttribute('title')).toBe('Studio gives this Machine read-only access')
      chip.click()
      await act(async () => {})
      view.unmount()
      expect(mainNode(id, epicNodeId('a'))).toBeUndefined()
      expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['a', 'b', 'c', 'd'])
      expect(historyOf(id).size).toBe(0)
    } finally {
      readOnly.hint = null
    }
  })

  it('without a record there is no order to write: only the frame opens', async () => {
    const id = freshProject()
    start(id, [frameNode('a', true)])
    const view = renderShelf(id)
    screen.getByRole('button', { name: 'Expand a, 2 of 2 done' }).click()
    await vi.waitFor(() => expect(mainNode(id, epicNodeId('a'))!.data.collapsed).toBe(false))
    view.unmount()
    expect(mainNode(id, EPIC_ARRANGEMENT_ID)).toBeUndefined()
    // By name, as on every screen until a record is written.
    buildEpicNodes(id, '/repo', model(TICKETS, EPICS), currentLayout(id)!, {})
    const state = arrangementOf(id)!
    expect(arrange(state.epics, state.frames, state.record).order).toEqual(['a', 'b', 'c', 'd'])
    expect(historyOf(id).size).toBe(1)
  })
})

describe('the collapse button puts a done Epic on the shelf', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <ReactFlowProvider>{children}</ReactFlowProvider>
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

  async function clickFrameButton(projectId: string, epic: string, name: string, until: () => void): Promise<void> {
    const frame = buildEpicNodes(projectId, '/repo', model(TICKETS, EPICS), currentLayout(projectId)!, {}).find((n) => n.id === epicNodeId(epic))!
    const props = { id: frame.id, data: frame.data, selected: false } as unknown as CanvasNodeProps
    const view = render(
      <ReactFlowProvider>
        <LayoutOpsContext.Provider value={opsOf(projectId)}>
          <EpicFrameNode {...props} />
        </LayoutOpsContext.Provider>
      </ReactFlowProvider>,
    )
    screen.getByRole('button', { name }).click()
    await vi.waitFor(until)
    view.unmount()
  }

  async function upkeep(projectId: string, tickets = TICKETS): Promise<void> {
    const nodes = buildEpicNodes(projectId, '/repo', model(tickets, EPICS), currentLayout(projectId)!, {})
    const hook = renderHook(() => useArrangementUpkeep(projectId, nodes), { wrapper })
    await act(async () => {})
    hook.unmount()
  }

  const mainNode = (projectId: string, id: string) => mains.get(projectId)!.layout.nodes.find((each) => each.id === id)
  const orderNow = (projectId: string) => {
    buildEpicNodes(projectId, '/repo', model(TICKETS, EPICS), currentLayout(projectId)!, {})
    const state = arrangementOf(projectId)!
    return arrange(state.epics, state.frames, state.record).order
  }

  it('takes it out of the order in the same step of ⌘Z; undone, the frame is back at its place and the order whole', async () => {
    const id = freshProject()
    // a is done and its frame open: the user opened it.
    start(id, [frameNode('a', false), recordNode(['a', 'b', 'c', 'd'], 1)])
    await clickFrameButton(id, 'a', 'Collapse epic a', () => expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['b', 'c', 'd']))
    expect(mainNode(id, epicNodeId('a'))!.data.collapsed).toBe(true)
    expect(historyOf(id).size).toBe(1)
    expect(chipsOf(buildEpicNodes(id, '/repo', model(TICKETS, EPICS), currentLayout(id)!, {}))).toEqual(['a'])
    // The upkeep has nothing of its own to write here, past ⌘Z.
    await upkeep(id)
    expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['b', 'c', 'd'])

    expect(await historyOf(id).undo()).toBe(true)
    expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['a', 'b', 'c', 'd'])
    expect(mainNode(id, epicNodeId('a'))!.data.collapsed).toBe(false)
    await upkeep(id)
    expect(orderNow(id)).toEqual(['a', 'b', 'c', 'd'])
    // Redone, both again.
    expect(await historyOf(id).redo()).toBe(true)
    expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['b', 'c', 'd'])
  })

  it('collapsing a frame with a Ticket not done keeps the order: the Epic stays in the strip', async () => {
    const id = freshProject()
    start(id, [recordNode(['a', 'b', 'c', 'd'], 1)])
    await clickFrameButton(id, 'b', 'Collapse epic b', () => expect(historyOf(id).size).toBe(1))
    expect(mainNode(id, epicNodeId('b'))!.data.collapsed).toBe(true)
    expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['a', 'b', 'c', 'd'])
  })

  it('the upkeep leaves alone an Epic the user collapsed: only one on the shelf by default leaves the order past ⌘Z', async () => {
    const id = freshProject()
    // b was collapsed by the user while a Ticket was open; now every Ticket of b is done.
    const allDone = TICKETS.map((t) => (t.epic === 'b' ? { ...t, ...done } : t))
    start(id, [frameNode('b', true), recordNode(['a', 'b', 'c', 'd'], 1)])
    await upkeep(id, allDone)
    // a (collapsed by default) leaves the order; b stays in it.
    expect(mainNode(id, EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['b', 'c', 'd'])
    expect(historyOf(id).size).toBe(0)
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

describe('an Epic leaves the shelf by itself: it goes to the end of the order', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <ReactFlowProvider>{children}</ReactFlowProvider>
  afterEach(() => mains.clear())

  it('the upkeep takes an Epic on the shelf out of the record\'s order, past ⌘Z; reopened, its frame comes last', async () => {
    const id = freshProject()
    // A record of today that still names a, which has gone to the shelf since.
    const record = recordNode(['a', 'b', 'c', 'd'], 1)
    const layout = layoutWith([record])
    mains.set(id, { revision: 1, layout })
    acceptLayoutState({ projectId: id, revision: 1, layout })
    const nodes = buildEpicNodes(id, '/repo', model(TICKETS, EPICS), currentLayout(id)!, {})
    expect(arrangementOf(id)!.shelf).toEqual(['a'])
    renderHook(() => useArrangementUpkeep(id, nodes), { wrapper })
    await act(async () => {})
    expect(mains.get(id)!.layout.nodes.find((n) => n.id === EPIC_ARRANGEMENT_ID)!.data.order).toEqual(['b', 'c', 'd'])
    // Past the history: nothing to undo.
    expect(historyOf(id).size).toBe(0)

    // A Ticket of a reopened: a leaves the shelf and its frame goes to the end, not to its old place.
    const reopened = TICKETS.map((t) => (t.epic === 'a' && t.num === 2 ? { ...t, state: 'open' as const, statusRaw: 'open' } : t))
    const after = buildEpicNodes(id, '/repo', model(reopened, EPICS), currentLayout(id)!, {})
    expect(shelfOf(after)).toBeUndefined()
    const state = arrangementOf(id)!
    expect(arrange(state.epics, state.frames, state.record).order).toEqual(['b', 'c', 'd', 'a'])
  })

  it('writes nothing while the order has no Epic of the shelf', async () => {
    const id = freshProject()
    const layout = layoutWith([recordNode(['b', 'c', 'd'], 1)])
    mains.set(id, { revision: 1, layout })
    acceptLayoutState({ projectId: id, revision: 1, layout })
    buildEpicNodes(id, '/repo', model(TICKETS, EPICS), currentLayout(id)!, {})
    const columns = arrangementOf(id)!.columns
    const held = layoutWith([recordNode(['b', 'c', 'd'], columns)])
    mains.set(id, { revision: 2, layout: held })
    acceptLayoutState({ projectId: id, revision: 2, layout: held })
    const again = buildEpicNodes(id, '/repo', model(TICKETS, EPICS), currentLayout(id)!, {})
    renderHook(() => useArrangementUpkeep(id, again), { wrapper })
    await act(async () => {})
    expect(mains.get(id)!.revision).toBe(2)
  })
})

describe('going to an Epic on the shelf', () => {
  it('shelfChipRect: the chip of `epic:<epic>` on the shelf, in absolute canvas units; nothing for another id', () => {
    const id = freshProject()
    const nodes = buildEpicNodes(id, '/repo', model(TICKETS, EPICS), layoutWith(), {})
    const shelf = shelfOf(nodes)!
    const chip = (shelf.data.node.data as DoneShelfData).chips[0]!
    const place = { x: shelf.position.x, y: shelf.position.y, data: shelf.data }
    expect(shelfChipRect(epicNodeId('a'), place)).toEqual({ x: shelf.position.x + chip.x, y: shelf.position.y + chip.y, w: chip.w, h: SHELF_CHIP_HEIGHT })
    expect(shelfChipRect(epicNodeId('b'), place)).toBeUndefined()
    expect(shelfChipRect('ticket:a/1', place)).toBeUndefined()
    expect(shelfChipRect(epicNodeId('a'), undefined)).toBeUndefined()
  })

  it('epicPlace (the sidebar\'s focusEpic): the frame of an Epic in the strip, the chip of one on the shelf', () => {
    const id = freshProject()
    const nodes = buildEpicNodes(id, '/repo', model(TICKETS, EPICS), layoutWith(), {})
    const frame = nodes.find((n) => n.id === epicNodeId('b'))!
    expect(epicPlace(nodes, 'b')).toEqual({ x: frame.position.x, y: frame.position.y, w: frame.width, h: frame.height })
    const shelf = shelfOf(nodes)!
    expect(epicPlace(nodes, 'a')).toEqual(shelfChipRect(epicNodeId('a'), { x: shelf.position.x, y: shelf.position.y, data: shelf.data }))
    expect(epicPlace(nodes, 'missing')).toBeUndefined()
  })
})

describe('⌘F and the palette go to an Epic on the shelf (CanvasFind rectOf)', () => {
  // React Flow's internal Nodes as rectOf reads them.
  const internal = (x: number, y: number, data: unknown, hidden = false) => ({ hidden, internals: { positionAbsolute: { x, y } }, data, width: 300, height: 200, measured: {} })

  it('an Epic without a frame Node is its chip on the shelf Node; one with a frame is the frame', () => {
    const nodes = buildEpicNodes(freshProject(), '/repo', model(TICKETS, EPICS), layoutWith(), {})
    const shelf = shelfOf(nodes)!
    const lookup = new Map<string, unknown>([
      [DONE_SHELF_ID, internal(shelf.position.x, shelf.position.y, shelf.data)],
      [epicNodeId('b'), internal(40, 50, {})],
    ])
    const flow = { getInternalNode: (id: string) => lookup.get(id) } as unknown as Parameters<typeof rectOf>[0]
    expect(rectOf(flow, epicNodeId('a'))).toEqual(shelfChipRect(epicNodeId('a'), { x: shelf.position.x, y: shelf.position.y, data: shelf.data }))
    expect(rectOf(flow, epicNodeId('a'))).toBeDefined()
    expect(rectOf(flow, epicNodeId('b'))).toEqual({ x: 40, y: 50, w: 300, h: 200 })
    expect(rectOf(flow, epicNodeId('c'))).toBeUndefined()
    lookup.set(DONE_SHELF_ID, internal(shelf.position.x, shelf.position.y, shelf.data, true))
    expect(rectOf(flow, epicNodeId('a'))).toBeUndefined()
  })
})

describe('a Binding to an Epic on the shelf', () => {
  const wave: Binding = { target: { kind: 'epic', epic: 'a' }, source: 'skill', detail: '/epic-wave a' }
  const claim: Binding = { target: { kind: 'ticket', epic: 'a', num: 2 }, source: 'claim', detail: 'ticket claim a 02' }
  const sessions = layoutWith([node({ id: 'session:s1', kind: 'session', locked: false, data: { sessionId: 's1' } }), node({ id: 'session:s2', kind: 'session', locked: false, data: { sessionId: 's2' } })])

  it('ends at its chip on the shelf Node, for the Epic and for its Tickets; never at a frame that is not drawn', () => {
    const nodes = buildBindingAnchors({
      projectId: 'p',
      layout: sessions,
      bindings: new Map([
        ['s1', wave],
        ['s2', claim],
      ]),
      // a has no frame: it is on the shelf.
      epics: new Set(['b']),
      shelf: new Map([['a', { x: 12, y: 36 }]]),
      tickets: new Set(),
      subagents: [],
      live: new Set(['s1']),
    })
    const target = nodes.find((n) => n.id === epicAnchorId('a'))!
    expect(target).toMatchObject({ parentId: DONE_SHELF_ID, position: { x: 12, y: 36 + SHELF_CHIP_HEIGHT / 2 } })
    expect(nodes.filter((n) => n.parentId === epicNodeId('a'))).toEqual([])
    for (const agent of nodes.filter((n) => n.id !== target.id)) expect(agent.data.node.data).toMatchObject({ targetId: epicAnchorId('a'), targetNodeId: DONE_SHELF_ID })
  })

  it('without a frame and off the shelf, no line is drawn', () => {
    const nodes = buildBindingAnchors({ projectId: 'p', layout: sessions, bindings: new Map([['s1', wave]]), epics: new Set(), shelf: new Map(), tickets: new Set(), subagents: [], live: new Set() })
    expect(nodes).toEqual([])
  })
})
