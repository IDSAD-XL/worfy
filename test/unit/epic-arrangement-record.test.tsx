// How sources/epics.ts writes the Layout's `epic-arrangement` record (ADR-0075, point 6): an
// automatic write goes past the ⌘Z history (ADR-0016), "Re-pack" is one step of it. The arrangement
// itself: epic-arrangement.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epicsWithWork, saveArrangement } from '../../src/renderer/canvas/sources/epics'
import type { LayoutOps } from '../../src/renderer/canvas/useLayout'
import { EPIC_ARRANGEMENT_ID, EPIC_ARRANGEMENT_KIND, onThePlane, SOURCE_NODE_KINDS } from '../../src/shared/layout/derived'
import type { Layout, LayoutOpInput } from '../../src/shared/layout/types'

// The badges and actions on a Ticket and a frame are other tickets' business: none here.
vi.mock('../../src/renderer/canvas/badges', () => ({ actions: [], badges: [] }))

// The operations sent past the ⌘Z history, recorded instead of sent; the Layout main has now.
const sent = vi.hoisted(() => ({ ops: [] as LayoutOpInput[], layout: undefined as Layout | undefined }))
vi.mock('../../src/renderer/canvas/useLayout', async (original) => ({
  ...(await original<typeof import('../../src/renderer/canvas/useLayout')>()),
  applyLayoutOp: (_projectId: string, op: LayoutOpInput) => {
    sent.ops.push(op)
    return Promise.resolve(undefined)
  },
  currentLayout: () => sent.layout,
}))

describe('the record in the Layout (sources/epics.ts)', () => {
  const record = { order: ['b', 'a'], columns: 2, at: '2026-10-19T08:00:00.000Z' }
  const withRecord: Layout = {
    nodes: [{ id: EPIC_ARRANGEMENT_ID, kind: EPIC_ARRANGEMENT_KIND, x: 0, y: 0, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data: { ...record } }],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
  const recorded: { op: LayoutOpInput; options: unknown }[] = []
  const ops: LayoutOps = {
    apply: (op, _group, options) => {
      recorded.push({ op, options })
      return Promise.resolve()
    },
  }
  beforeEach(() => {
    sent.ops = []
    sent.layout = undefined
    recorded.length = 0
  })

  it('is a source Node: not on the plane, so nothing keeps clear of it and the canvas tools do not list it', () => {
    expect(SOURCE_NODE_KINDS).toContain(EPIC_ARRANGEMENT_KIND)
    expect(onThePlane(withRecord.nodes[0]!)).toBe(false)
  })

  it('an automatic write goes past the ⌘Z history: a locked 1×1 create with the data, then patches', async () => {
    sent.layout = { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }
    await saveArrangement('p1', record)
    expect(sent.ops).toEqual([{ op: 'create', node: { id: EPIC_ARRANGEMENT_ID, kind: EPIC_ARRANGEMENT_KIND, x: 0, y: 0, w: 1, h: 1, locked: true, data: record } }])
    sent.ops = []
    sent.layout = withRecord
    await saveArrangement('p1', { ...record, columns: 3 })
    expect(sent.ops).toEqual([{ op: 'patchData', id: EPIC_ARRANGEMENT_ID, data: { ...record, columns: 3 } }])
    expect(recorded).toEqual([])
  })

  it('"Re-pack" is one step of ⌘Z: the data goes through the Canvas\'s LayoutOps as a recorded patchData; the create before it is no step', async () => {
    sent.layout = { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } }
    await saveArrangement('p1', record, ops)
    expect(sent.ops).toEqual([{ op: 'create', node: { id: EPIC_ARRANGEMENT_ID, kind: EPIC_ARRANGEMENT_KIND, x: 0, y: 0, w: 1, h: 1, locked: true, data: {} } }])
    expect(recorded).toEqual([{ op: { op: 'patchData', id: EPIC_ARRANGEMENT_ID, data: record }, options: { data: true } }])
    sent.ops = []
    recorded.length = 0
    sent.layout = withRecord
    await saveArrangement('p1', record, ops)
    expect(sent.ops).toEqual([])
    expect(recorded).toHaveLength(1)
  })

  it('counts as work a claimed Ticket, a live bound agent and the running Autopilot', () => {
    const tickets = [
      { epic: 'a', state: 'work' as const },
      { epic: 'b', state: 'open' as const },
      { epic: 'c', state: 'done' as const },
      { epic: 'd', state: 'blocked' as const },
    ]
    expect([...epicsWithWork(tickets, [], null)]).toEqual(['a'])
    expect([...epicsWithWork(tickets, ['b'], 'c')].sort()).toEqual(['a', 'b', 'c'])
  })
})
