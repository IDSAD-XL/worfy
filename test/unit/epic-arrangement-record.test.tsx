// How sources/epics.ts writes the Layout's `epic-arrangement` record (ADR-0075, point 6): an
// automatic write goes past the ⌘Z history (ADR-0016), "Re-pack" is one step of it. The arrangement
// itself: epic-arrangement.test.ts.
import { act, renderHook, waitFor } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { elkKey, setElkEngine, type ElkAnswer } from '../../src/renderer/canvas/elk/client'
import { layoutEpic } from '../../src/renderer/canvas/epic-layout'
import source, { activityNow, arrangementOf, buildEpicNodes, epicsWithWork, saveArrangement, useArrangementUpkeep } from '../../src/renderer/canvas/sources/epics'
import { BINDING_ANCHOR_KIND } from '../../src/renderer/canvas/sources/workflow-bindings'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import type { LayoutOps } from '../../src/renderer/canvas/useLayout'
import { EPIC_ARRANGEMENT_ID, EPIC_ARRANGEMENT_KIND, onThePlane, SOURCE_NODE_KINDS } from '../../src/shared/layout/derived'
import type { Layout, LayoutOpInput } from '../../src/shared/layout/types'

// The badges and actions on a Ticket and a frame are other tickets' business: none here.
vi.mock('../../src/renderer/canvas/badges', () => ({ actions: [], badges: [] }))

// main's answer to `autopilot.state`.
const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/ipc', async (original) => ({ ...(await original<typeof import('../../src/renderer/ipc')>()), invoke }))

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

  it('belongs to the Epic node source, so the Canvas does not draw it as a Node of an unknown kind', () => {
    expect(source.owns).toContain(EPIC_ARRANGEMENT_KIND)
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

describe('the activity "Re-pack" and the first opening of the day read (sources/epics.ts)', () => {
  const anchor = (variant: string, live: boolean, epic: string, type = BINDING_ANCHOR_KIND) => ({ type, data: { node: { data: { variant, live, binding: { target: { epic } } } } } })

  it('counts a claimed Ticket, a live bound agent and the running Autopilot; not a finished agent, nor a stopped Autopilot', async () => {
    const lookup = new Map([
      ['live', anchor('agent', true, 'agent-live')],
      ['done', anchor('agent', false, 'agent-done')],
      ['session', anchor('session', true, 'session-only')],
      ['other', anchor('agent', true, 'not-an-anchor', 'note')],
    ])
    const tickets = [{ epic: 'claimed', state: 'work' as const }]
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'stopped', epic: 'autopilot' } })
    expect([...(await activityNow('p1', tickets, lookup))].sort()).toEqual(['agent-live', 'claimed'])
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'running', epic: 'autopilot' } })
    expect([...(await activityNow('p1', tickets, lookup))].sort()).toEqual(['agent-live', 'autopilot', 'claimed'])
    expect(invoke).toHaveBeenLastCalledWith('autopilot.state', { projectId: 'p1' })
  })
})

describe('the upkeep of the record (useArrangementUpkeep)', () => {
  // Eleven open Epics with two Tickets each: frames of one size.
  const names = Array.from({ length: 11 }, (_, index) => `e${String(index + 1).padStart(2, '0')}`)
  const ticket = (epic: string, num: number): Ticket => ({
    epic,
    num,
    slug: `t${num}`,
    title: `Ticket ${num}`,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
  })
  const tickets = names.flatMap((epic) => [ticket(epic, 1), ticket(epic, 2)])
  const model: WorkflowModel = { root: '/repo', epics: names.map((epic) => ({ epic, hasSpec: false, hasMap: false, title: null })), tickets, error: null, branchErrors: [] }
  const layoutWith = (data: Record<string, unknown>): Layout => ({
    nodes: [{ id: EPIC_ARRANGEMENT_ID, kind: EPIC_ARRANGEMENT_KIND, x: 0, y: 0, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data }],
    viewport: { x: 0, y: 0, zoom: 1 },
  })
  /** ELK's answer for every Epic's current inputs. */
  const answers = (): Record<string, ElkAnswer> =>
    Object.fromEntries(
      names.map((epic) => {
        const own = tickets.filter((t) => t.epic === epic)
        const laid = layoutEpic({ tickets: own, collapsed: false, doneExpanded: false, name: epic })
        return [epic, { key: elkKey(own, epic), folded: laid, open: laid }]
      }),
    )
  const wrapper = ({ children }: { children: ReactNode }) => <ReactFlowProvider>{children}</ReactFlowProvider>
  const upkeep = (projectId: string, nodes: readonly unknown[]) =>
    renderHook(({ current }) => useArrangementUpkeep(projectId, current as never), { wrapper, initialProps: { current: nodes } })

  beforeEach(() => {
    sent.ops = []
    sent.layout = undefined
    invoke.mockReset()
    invoke.mockResolvedValue({ ok: true, value: { status: 'running', epic: 'e06' } })
  })
  afterEach(() => setElkEngine(null))

  it('writes the K the hysteresis changed, past the ⌘Z history, and only once', async () => {
    const layout = layoutWith({ order: names, columns: 11, at: new Date().toISOString() })
    sent.layout = layout
    const nodes = buildEpicNodes('upkeep-k', '/repo', model, layout, {})
    const state = arrangementOf('upkeep-k')!
    expect(state.settled).toBe(true)
    expect(state.columns).not.toBe(11)
    const { rerender } = upkeep('upkeep-k', nodes)
    expect(sent.ops).toEqual([{ op: 'patchData', id: EPIC_ARRANGEMENT_ID, data: { columns: state.columns } }])
    rerender({ current: [...nodes] })
    expect(sent.ops).toHaveLength(1)
    // Today's record: no new order is computed.
    await act(async () => {})
    expect(invoke).not.toHaveBeenCalled()
  })

  it('writes nothing while the record\'s K holds', async () => {
    const layout = layoutWith({ order: names, columns: 1, at: new Date().toISOString() })
    buildEpicNodes('upkeep-held', '/repo', model, layout, {})
    const held = arrangementOf('upkeep-held')!.columns
    const nodes = buildEpicNodes('upkeep-held', '/repo', model, layoutWith({ order: names, columns: held, at: new Date().toISOString() }), {})
    upkeep('upkeep-held', nodes)
    await act(async () => {})
    expect(sent.ops).toEqual([])
  })

  it('computes the day\'s order only once the frames show ELK\'s answers, active first', async () => {
    setElkEngine({} as never)
    const layout = layoutWith({ order: names, columns: 11, at: '2026-01-01T08:00:00.000Z' })
    sent.layout = layout
    const early = buildEpicNodes('upkeep-day', '/repo', model, layout, {})
    expect(arrangementOf('upkeep-day')!.settled).toBe(false)
    const { rerender } = upkeep('upkeep-day', early)
    await act(async () => {})
    // Neither the day's order nor the K is written from the synchronous sizes.
    expect(invoke).not.toHaveBeenCalled()
    expect(sent.ops).toEqual([])
    const answered = buildEpicNodes('upkeep-day', '/repo', model, layout, {}, [], answers())
    expect(arrangementOf('upkeep-day')!.settled).toBe(true)
    rerender({ current: answered })
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    const op = sent.ops[0] as { op: string; id: string; data: { order: string[]; columns: number; at: string } }
    expect(op).toMatchObject({ op: 'patchData', id: EPIC_ARRANGEMENT_ID })
    expect(op.data.order).toEqual(['e06', ...names.filter((name) => name !== 'e06')])
    expect(op.data.columns).toBe(arrangementOf('upkeep-day')!.columns)
    expect(new Date(op.data.at).toDateString()).toBe(new Date().toDateString())
  })
})
