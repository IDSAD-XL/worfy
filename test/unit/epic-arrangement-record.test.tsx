// How sources/epics.ts and arrangement-record.ts write the Layout's `epic-arrangement` record
// (ADR-0075, point 6): an automatic write goes past the ⌘Z history (ADR-0016), "Re-pack" is one step of it. The arrangement
// itself: epic-arrangement.test.ts.
import { act, renderHook, waitFor } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { elkKey, setElkEngine, useElkAnswers, type ElkAnswer } from '../../src/renderer/canvas/elk/client'
import { layoutEpic } from '../../src/renderer/canvas/epic-layout'
import { activityNow, arrangementOf, epicsWithWork, FIRST_OPENING_WAIT_MS, saveArrangement, useArrangementUpkeep, useRepack } from '../../src/renderer/canvas/arrangement-record'
import source, { buildEpicNodes, requestEpicLayouts } from '../../src/renderer/canvas/sources/epics'
import { useBindingsStore, whenBindingsRead } from '../../src/renderer/binding/store'
import { EMPTY_AGENT_SIGNALS } from '../../src/shared/binding/resolve'
import { BINDING_ANCHOR_KIND } from '../../src/renderer/canvas/sources/workflow-bindings'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { LayoutOpsContext, type LayoutOps } from '../../src/renderer/canvas/useLayout'
import { EPIC_ARRANGEMENT_ID, EPIC_ARRANGEMENT_KIND, onThePlane, SOURCE_NODE_KINDS } from '../../src/shared/layout/derived'
import type { Layout, LayoutOpInput } from '../../src/shared/layout/types'

// The badges and actions on a Ticket and a frame are other tickets' business: none here.
vi.mock('../../src/renderer/canvas/badges', () => ({ actions: [], badges: [] }))

// main's answer to `autopilot.state`.
const invoke = vi.hoisted(() => vi.fn())
vi.mock('../../src/renderer/ipc', async (original) => ({ ...(await original<typeof import('../../src/renderer/ipc')>()), invoke }))

// The operations sent past the ⌘Z history, recorded instead of sent; the Layout main has now.
// Each test mounts the upkeep for Projects of its own (`mounted`); a write a finished test left
// under way (its awaits outlive the unmount) goes on later, and an operation of such a Project
// (`finished`) is dropped instead of landing among the next test's.
const sent = vi.hoisted(() => ({ ops: [] as LayoutOpInput[], layout: undefined as Layout | undefined, mounted: new Set<string>(), finished: new Set<string>() }))
vi.mock('../../src/renderer/canvas/useLayout', async (original) => ({
  ...(await original<typeof import('../../src/renderer/canvas/useLayout')>()),
  applyLayoutOp: (projectId: string, op: LayoutOpInput) => {
    if (!sent.finished.has(projectId)) sent.ops.push(op)
    return Promise.resolve(undefined)
  },
  currentLayout: () => sent.layout,
}))

afterEach(() => {
  for (const projectId of sent.mounted) sent.finished.add(projectId)
  sent.mounted.clear()
})

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

describe('the activity "Re-pack" and the first opening of the day read (arrangement-record.ts)', () => {
  const anchor = (variant: string, live: boolean, epic: string, type = BINDING_ANCHOR_KIND) => ({ type, data: { node: { data: { variant, live, binding: { target: { epic } } } } } })

  it('counts a claimed Ticket, a live bound agent and the running Autopilot; not a finished agent, nor a stopped Autopilot', async () => {
    const lookup = new Map([
      ['live', anchor('agent', true, 'agent-live')],
      ['done', anchor('agent', false, 'agent-done')],
      ['session', anchor('session', true, 'session-only')],
      ['other', anchor('agent', true, 'not-an-anchor', 'note')],
    ])
    const input = { model: { root: '/repo', tickets: [{ epic: 'claimed', state: 'work' as const }] } as unknown as WorkflowModel, sessions: [] }
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'stopped', epic: 'autopilot' } })
    expect([...(await activityNow('p1', input, lookup))].sort()).toEqual(['agent-live', 'claimed'])
    invoke.mockResolvedValueOnce({ ok: true, value: { status: 'running', epic: 'autopilot' } })
    expect([...(await activityNow('p1', input, lookup))].sort()).toEqual(['agent-live', 'autopilot', 'claimed'])
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
  const upkeep = (projectId: string, nodes: readonly unknown[]) => {
    sent.mounted.add(projectId)
    return renderHook(({ current }) => useArrangementUpkeep(projectId, current as never), { wrapper, initialProps: { current: nodes } })
  }

  beforeEach(() => {
    sent.ops = []
    sent.layout = undefined
    invoke.mockReset()
    invoke.mockResolvedValue({ ok: true, value: { status: 'running', epic: 'e06' } })
  })
  afterEach(() => setElkEngine(null))

  it('"Re-pack" counts a live agent by its Binding anchor in React Flow\'s store (review of PR #662)', async () => {
    invoke.mockResolvedValue({ ok: true, value: { status: 'stopped', epic: null } })
    const layout = layoutWith({ order: names, columns: 3, at: new Date().toISOString() })
    sent.layout = layout
    buildEpicNodes('repack-anchor', '/repo', model, layout, {}, [], answers())
    const recorded: LayoutOpInput[] = []
    const ops: LayoutOps = {
      apply: (op) => {
        recorded.push(op)
        return Promise.resolve()
      },
    }
    const withOps = ({ children }: { children: ReactNode }) => (
      <ReactFlowProvider>
        <LayoutOpsContext.Provider value={ops}>{children}</LayoutOpsContext.Provider>
      </ReactFlowProvider>
    )
    const { result } = renderHook(() => ({ run: useRepack('repack-anchor'), store: useStoreApi() }), { wrapper: withOps })
    const anchor = { id: 'anchor', type: BINDING_ANCHOR_KIND, data: { node: { data: { variant: 'agent', live: true, binding: { target: { epic: 'e07' } } } } } }
    act(() => result.current.store.setState({ nodeLookup: new Map([['anchor', anchor]]) as never }))
    await act(() => result.current.run())
    expect(recorded).toHaveLength(1)
    expect((recorded[0] as Extract<LayoutOpInput, { op: 'patchData' }>).data.order).toEqual(['e07', ...names.filter((name) => name !== 'e07')])
  })

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

  it('waits for no frame that is collapsed, and counts an answer for older inputs as no answer', () => {
    setElkEngine({} as never)
    // Epic e01 collapsed by the user: ELK lays out no collapsed frame.
    const base = layoutWith({ order: names, columns: 3, at: new Date().toISOString() })
    const frame = { id: 'epic:e01', kind: 'epic-frame', x: 0, y: 0, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data: { collapsed: true } }
    const collapsed: Layout = { ...base, nodes: [...base.nodes, frame] }
    const others = answers()
    delete others.e01
    buildEpicNodes('upkeep-collapsed', '/repo', model, collapsed, {}, [], others)
    expect(arrangementOf('upkeep-collapsed')!.settled).toBe(true)
    const old = answers()
    old.e05 = { ...old.e05!, key: 'older inputs' }
    buildEpicNodes('upkeep-old-key', '/repo', model, layoutWith({ order: names, columns: 3, at: new Date().toISOString() }), {}, [], old)
    expect(arrangementOf('upkeep-old-key')!.settled).toBe(false)
  })

  it('a frame ELK failed to lay out is answered with the synchronous layout and holds nothing up', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    setElkEngine({ layout: () => Promise.reject(new Error('ELK failed')) })
    const layout = layoutWith({ order: names, columns: 11, at: '2026-01-01T08:00:00.000Z' })
    sent.layout = layout
    const early = buildEpicNodes('upkeep-failed', '/repo', model, layout, {})
    expect(arrangementOf('upkeep-failed')!.settled).toBe(false)
    const { rerender } = upkeep('upkeep-failed', early)
    requestEpicLayouts('upkeep-failed')
    await waitFor(() => expect(Object.keys(useElkAnswers.getState()['upkeep-failed'] ?? {})).toHaveLength(names.length))
    const failed = useElkAnswers.getState()['upkeep-failed']!
    const own = tickets.filter((t) => t.epic === 'e03')
    expect(failed.e03!.key).toBe(elkKey(own, 'e03'))
    expect(failed.e03!.folded).toEqual(layoutEpic({ tickets: own, collapsed: false, doneExpanded: false, name: 'e03' }))
    const answered = buildEpicNodes('upkeep-failed', '/repo', model, layout, {}, [], failed)
    expect(arrangementOf('upkeep-failed')!.settled).toBe(true)
    rerender({ current: answered })
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    expect(sent.ops[0]).toMatchObject({ op: 'patchData', id: EPIC_ARRANGEMENT_ID })
    expect(quiet).toHaveBeenCalled()
    quiet.mockRestore()
  })
})

describe('the first opening of the day waits for the Bindings and writes once (useArrangementUpkeep)', () => {
  const names = Array.from({ length: 11 }, (_, index) => `f${String(index + 1).padStart(2, '0')}`)
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
  const yesterday = { order: names, columns: 11, at: '2026-01-01T08:00:00.000Z' }
  const recordNode = (data: Record<string, unknown>) => ({ id: EPIC_ARRANGEMENT_ID, kind: EPIC_ARRANGEMENT_KIND, x: 0, y: 0, w: 1, h: 1, hidden: false, locked: true, pinned: false, tags: [], data })
  // A Session on the plane: the Bindings of its agent are what the first opening waits for.
  const session = { id: 'session:s1', kind: 'session', x: 2000, y: 0, w: 300, h: 200, hidden: false, locked: false, pinned: false, tags: [], data: { sessionId: 's1' } }
  const layoutWith = (data: Record<string, unknown>): Layout => ({ nodes: [recordNode(data), session], viewport: { x: 0, y: 0, zoom: 1 } })
  /** ELK's answer for every Epic, `extra` taller than the synchronous layout. */
  const answers = (extra = 0): Record<string, ElkAnswer> =>
    Object.fromEntries(
      names.map((epic) => {
        const own = tickets.filter((t) => t.epic === epic)
        const laid = layoutEpic({ tickets: own, collapsed: false, doneExpanded: false, name: epic })
        const taller = { ...laid, height: laid.height + extra }
        return [epic, { key: elkKey(own, epic), folded: taller, open: taller }]
      }),
    )
  const wrapper = ({ children }: { children: ReactNode }) => <ReactFlowProvider>{children}</ReactFlowProvider>
  const upkeep = (projectId: string, nodes: readonly unknown[]) => {
    sent.mounted.add(projectId)
    return renderHook(({ current }) => useArrangementUpkeep(projectId, current as never), { wrapper, initialProps: { current: nodes } })
  }
  /** main's Bindings of the Project: Session s1 bound by hand to `epic`, its transcript read. */
  const bindingsArrive = (projectId: string, epic: string) =>
    useBindingsStore.setState(({ manual, signals }) => ({
      manual: { ...manual, [projectId]: [{ sessionId: 's1', agentId: null, target: { kind: 'epic', epic } }] },
      signals: { ...signals, ['/repo\0s1']: { found: true, session: EMPTY_AGENT_SIGNALS, subagents: [] } },
    }))
  const dayWrites = () => sent.ops.filter((op) => op.op === 'patchData' && 'at' in op.data)
  /** The data of the first operation sent: the day's record. */
  const written = () => (sent.ops[0] as Extract<LayoutOpInput, { op: 'patchData' }>).data as { order: string[]; columns: number; at: string }

  beforeEach(() => {
    sent.ops = []
    sent.layout = undefined
    useBindingsStore.setState({ manual: {}, manualError: {}, signals: {} })
    invoke.mockReset()
    // No Autopilot runs; Session s1 is live.
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(
        channel === 'claudeHome.live'
          ? { ok: true, value: { live: [{ pid: 1, sessionId: 's1', cwd: '/repo', status: 'busy' }] } }
          : { ok: true, value: { status: 'stopped', epic: null } },
      ),
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    setElkEngine(null)
  })

  it('puts first the Epic of a live agent whose Binding arrives after the first commit', async () => {
    const layout = layoutWith(yesterday)
    sent.layout = layout
    const nodes = buildEpicNodes('first-live', '/repo', model, layout, {})
    expect(arrangementOf('first-live')!.settled).toBe(true)
    const { rerender } = upkeep('first-live', nodes)
    await act(async () => {})
    // Neither the Bindings nor the anchors are there yet: nothing is written.
    expect(sent.ops).toEqual([])
    act(() => bindingsArrive('first-live', 'f09'))
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    expect(sent.ops[0]).toMatchObject({ op: 'patchData', id: EPIC_ARRANGEMENT_ID })
    expect(written().order).toEqual(['f09', ...names.filter((name) => name !== 'f09')])
    expect(invoke).toHaveBeenCalledWith('claudeHome.live', { projectRoot: '/repo' })
    // main has the record (applyLayoutOp's answer); the next build has not read it yet.
    sent.layout = layoutWith(written())
    rerender({ current: [...nodes] })
    await act(async () => {})
    expect(sent.ops).toHaveLength(1)
  })

  it('a bound Session that is not live does not count', async () => {
    invoke.mockImplementation((channel: string) => Promise.resolve(channel === 'claudeHome.live' ? { ok: true, value: { live: [] } } : { ok: true, value: { status: 'stopped', epic: null } }))
    const layout = layoutWith(yesterday)
    sent.layout = layout
    bindingsArrive('first-idle', 'f09')
    upkeep('first-idle', buildEpicNodes('first-idle', '/repo', model, layout, {}))
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    expect(written().order).toEqual(names)
  })

  it('ELK changes the heights after the first commit: exactly one automatic write', async () => {
    setElkEngine({} as never)
    const layout = layoutWith(yesterday)
    sent.layout = layout
    bindingsArrive('first-elk', 'f04')
    const early = buildEpicNodes('first-elk', '/repo', model, layout, {})
    expect(arrangementOf('first-elk')!.settled).toBe(false)
    const { rerender } = upkeep('first-elk', early)
    await act(async () => {})
    expect(sent.ops).toEqual([])
    // ELK answers with taller frames than the synchronous layout.
    const answered = buildEpicNodes('first-elk', '/repo', model, layout, {}, [], answers(400))
    expect(arrangementOf('first-elk')!.settled).toBe(true)
    rerender({ current: answered })
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    const record = written()
    expect(record.order[0]).toBe('f04')
    // main has the record; a build from the Layout before it still shows yesterday's, with another K.
    sent.layout = layoutWith(record)
    const stale = buildEpicNodes('first-elk', '/repo', model, layout, {}, [], answers(800))
    expect(arrangementOf('first-elk')!.columns).not.toBe(11)
    rerender({ current: stale })
    await act(async () => {})
    expect(sent.ops).toHaveLength(1)
    // The build that reads the record keeps its K: nothing more to write.
    const fresh = buildEpicNodes('first-elk', '/repo', model, layoutWith(record), {}, [], answers(400))
    rerender({ current: fresh })
    await act(async () => {})
    expect(sent.ops).toHaveLength(1)
    expect(dayWrites()).toHaveLength(1)
  })

  it('without the Bindings by the limit it writes once, at the limit, with one line in the log', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const layout = layoutWith(yesterday)
    sent.layout = layout
    const nodes = buildEpicNodes('first-late', '/repo', model, layout, {})
    const { rerender } = upkeep('first-late', nodes)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_OPENING_WAIT_MS - 1)
    })
    expect(sent.ops).toEqual([])
    rerender({ current: [...nodes] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(sent.ops).toHaveLength(1)
    expect(written().order).toEqual(names)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain(`${FIRST_OPENING_WAIT_MS} ms`)
    sent.layout = layoutWith(written())
    // Bindings that arrive later write nothing more on this opening.
    act(() => bindingsArrive('first-late', 'f09'))
    rerender({ current: [...nodes] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_OPENING_WAIT_MS * 2)
    })
    expect(sent.ops).toHaveLength(1)
    warn.mockRestore()
  })

  it('ends the day write when it is sent: the next day\'s first opening writes again, and K is written as before', async () => {
    bindingsArrive('first-next', 'f02')
    sent.layout = layoutWith(yesterday)
    const first = upkeep('first-next', buildEpicNodes('first-next', '/repo', model, layoutWith(yesterday), {}))
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    await act(async () => {})
    // The Canvas is closed before any other build: nothing else runs the effect of this mount.
    first.unmount()
    // The next day: the Layout's record is a day old again.
    sent.layout = layoutWith(yesterday)
    const { rerender } = upkeep('first-next', buildEpicNodes('first-next', '/repo', model, layoutWith(yesterday), {}))
    await waitFor(() => expect(dayWrites()).toHaveLength(2))
    await act(async () => {})
    // main has today's record with another K: the hysteresis writes its K as on any other build.
    const changed = layoutWith({ ...(sent.ops[1] as Extract<LayoutOpInput, { op: 'patchData' }>).data, columns: 11 })
    sent.layout = changed
    const nodes = buildEpicNodes('first-next', '/repo', model, changed, {})
    const columns = arrangementOf('first-next')!.columns
    expect(columns).not.toBe(11)
    rerender({ current: nodes })
    await act(async () => {})
    expect(sent.ops).toHaveLength(3)
    expect(sent.ops[2]).toEqual({ op: 'patchData', id: EPIC_ARRANGEMENT_ID, data: { columns } })
  })

  it('waits for the transcript signals that arrive after bindings.get, and counts the Binding they give', async () => {
    const layout = layoutWith(yesterday)
    sent.layout = layout
    useBindingsStore.setState(({ manual }) => ({ manual: { ...manual, 'first-signals': [] } }))
    upkeep('first-signals', buildEpicNodes('first-signals', '/repo', model, layout, {}))
    await act(async () => {})
    expect(sent.ops).toEqual([])
    // Session s1 ran `ticket claim f07 01`.
    act(() =>
      useBindingsStore.setState(({ signals }) => ({
        signals: { ...signals, ['/repo\0s1']: { found: true, session: { ...EMPTY_AGENT_SIGNALS, claim: { epic: 'f07', num: 1, command: 'ticket claim f07 01' } }, subagents: [] } },
      })),
    )
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    expect(written().order[0]).toBe('f07')
  })

  it('frames that change while the Bindings are read: the write waits for ELK again and is the only one', async () => {
    setElkEngine({} as never)
    const layout = layoutWith(yesterday)
    sent.layout = layout
    const { rerender } = upkeep('first-moved', buildEpicNodes('first-moved', '/repo', model, layout, {}, [], answers()))
    expect(arrangementOf('first-moved')!.settled).toBe(true)
    await act(async () => {})
    // A Ticket's inputs change: ELK's answer for f05 is for older inputs now.
    const old = answers()
    old.f05 = { ...old.f05!, key: 'older inputs' }
    rerender({ current: buildEpicNodes('first-moved', '/repo', model, layout, {}, [], old) })
    expect(arrangementOf('first-moved')!.settled).toBe(false)
    act(() => bindingsArrive('first-moved', 'f03'))
    await act(async () => {})
    expect(sent.ops).toEqual([])
    rerender({ current: buildEpicNodes('first-moved', '/repo', model, layout, {}, [], answers(400)) })
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    const record = written()
    expect(record.order[0]).toBe('f03')
    expect(record.columns).toBe(arrangementOf('first-moved')!.columns)
    sent.layout = layoutWith(record)
    rerender({ current: buildEpicNodes('first-moved', '/repo', model, layoutWith(record), {}, [], answers(400)) })
    await act(async () => {})
    expect(sent.ops).toHaveLength(1)
  })

  it('writes nothing when the Layout has a record of today by then ("Re-pack" during the wait, another screen)', async () => {
    const layout = layoutWith(yesterday)
    sent.layout = layout
    upkeep('first-repacked', buildEpicNodes('first-repacked', '/repo', model, layout, {}))
    await act(async () => {})
    sent.layout = layoutWith({ order: [...names].reverse(), columns: 3, at: new Date().toISOString() })
    act(() => bindingsArrive('first-repacked', 'f09'))
    await act(async () => {})
    await act(async () => {})
    expect(sent.ops).toEqual([])
  })

  it('an error of bindings.get counts as read: no wait for the limit, no line in the log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const layout = layoutWith(yesterday)
    sent.layout = layout
    useBindingsStore.setState(({ manualError, signals }) => ({
      manualError: { ...manualError, 'first-error': 'bindings.json is not readable' },
      signals: { ...signals, ['/repo\0s1']: { found: true, session: EMPTY_AGENT_SIGNALS, subagents: [] } },
    }))
    upkeep('first-error', buildEpicNodes('first-error', '/repo', model, layout, {}))
    await waitFor(() => expect(sent.ops).toHaveLength(1), { timeout: FIRST_OPENING_WAIT_MS / 3 })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('whenBindingsRead stops listening to the store once it has its answer', async () => {
    const real = useBindingsStore.subscribe
    const unsubscribed = vi.fn()
    const spy = vi.spyOn(useBindingsStore, 'subscribe').mockImplementation((listener) => {
      const stop = real(listener)
      return () => {
        unsubscribed()
        stop()
      }
    })
    const read = whenBindingsRead('first-unsub', { root: '/repo', sessions: ['s1'] }, FIRST_OPENING_WAIT_MS)
    bindingsArrive('first-unsub', 'f01')
    await expect(read).resolves.toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(unsubscribed).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('two mounts of the Canvas on the first opening of the day: one write', async () => {
    const layout = layoutWith(yesterday)
    sent.layout = layout
    const nodes = buildEpicNodes('first-two', '/repo', model, layout, {})
    upkeep('first-two', nodes)
    upkeep('first-two', nodes)
    await act(async () => {})
    act(() => bindingsArrive('first-two', 'f05'))
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    await act(async () => {})
    expect(dayWrites()).toHaveLength(1)
    expect(written().order[0]).toBe('f05')
  })

  it('a write that waits for ELK goes on when the Project\'s frames are gone (its workflow model unread)', async () => {
    setElkEngine({} as never)
    const layout = layoutWith(yesterday)
    sent.layout = layout
    upkeep('first-gone', buildEpicNodes('first-gone', '/repo', model, layout, {}, [], answers()))
    await act(async () => {})
    // While the Bindings are read, ELK's answer for f05 goes out of date: the write will wait for ELK.
    const old = answers()
    old.f05 = { ...old.f05!, key: 'older inputs' }
    buildEpicNodes('first-gone', '/repo', model, layout, {}, [], old)
    expect(arrangementOf('first-gone')!.settled).toBe(false)
    act(() => bindingsArrive('first-gone', 'f03'))
    await act(async () => {})
    expect(sent.ops).toEqual([])
    buildEpicNodes('first-gone', '/repo', undefined, layout, {})
    expect(arrangementOf('first-gone')).toBeUndefined()
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    expect(written().order[0]).toBe('f03')
  })

  it('whenBindingsRead clears its limit once the Bindings are read', async () => {
    vi.useFakeTimers()
    const read = whenBindingsRead('first-timer', { root: '/repo', sessions: ['s1'] }, FIRST_OPENING_WAIT_MS)
    expect(vi.getTimerCount()).toBe(1)
    bindingsArrive('first-timer', 'f01')
    await expect(read).resolves.toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['answers an error', () => Promise.resolve({ ok: false, error: 'registry unreadable' })],
    ['throws', () => Promise.reject(new Error('main is gone'))],
  ])('when claudeHome.live %s, no Session counts as live', async (_label, live) => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    invoke.mockImplementation((channel: string) => (channel === 'claudeHome.live' ? live() : Promise.resolve({ ok: true, value: { status: 'stopped', epic: null } })))
    const project = `first-live-error-${_label.split(' ')[0]}`
    const layout = layoutWith(yesterday)
    sent.layout = layout
    bindingsArrive(project, 'f09')
    upkeep(project, buildEpicNodes(project, '/repo', model, layout, {}))
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    expect(written().order).toEqual(names)
    expect(quiet).toHaveBeenCalledWith('claudeHome.live failed:', expect.anything())
    quiet.mockRestore()
  })

  it('midnight during the wait: no K is written meanwhile, the late write of the day before writes nothing and leaves the next day\'s mark (review of PR #662)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 5, 23, 59, 58))
    const layout = layoutWith(yesterday)
    sent.layout = layout
    // No Bindings arrive: the day's write waits FIRST_OPENING_WAIT_MS, past midnight.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const nodes = buildEpicNodes('first-midnight', '/repo', model, layout, {})
    expect(arrangementOf('first-midnight')!.columns).not.toBe(11)
    const first = upkeep('first-midnight', nodes)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500)
    })
    expect(new Date().getDate()).toBe(6)
    // A build of the first mount after midnight, while its write waits: the K it shows is not written.
    first.rerender({ current: [...nodes] })
    await act(async () => {})
    expect(sent.ops).toEqual([])
    // Another mount opens on the new day and starts that day's write.
    const second = upkeep('first-midnight', nodes)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    // The first write has ended: it was for the day before, so it sends nothing; the second's mark stays.
    expect(sent.ops).toEqual([])
    second.rerender({ current: [...nodes] })
    await act(async () => {})
    expect(sent.ops).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_OPENING_WAIT_MS)
    })
    expect(dayWrites()).toHaveLength(1)
    expect(sent.ops).toHaveLength(1)
    expect(new Date(written().at).getDate()).toBe(6)
    warn.mockRestore()
  })

  it('a write of another day that never ended does not hold up today\'s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 2, 1, 23, 0))
    // main never answers the Autopilot's state on the first day.
    invoke.mockImplementation((channel: string) => (channel === 'autopilot.state' ? new Promise(() => {}) : Promise.resolve({ ok: true, value: { live: [] } })))
    bindingsArrive('first-hung', 'f02')
    sent.layout = layoutWith(yesterday)
    const first = upkeep('first-hung', buildEpicNodes('first-hung', '/repo', model, layoutWith(yesterday), {}))
    await act(async () => {})
    expect(invoke).toHaveBeenCalledWith('autopilot.state', { projectId: 'first-hung' })
    first.unmount()
    vi.setSystemTime(new Date(2026, 2, 2, 9, 0))
    invoke.mockImplementation((channel: string) => Promise.resolve(channel === 'claudeHome.live' ? { ok: true, value: { live: [] } } : { ok: true, value: { status: 'stopped', epic: null } }))
    upkeep('first-hung', buildEpicNodes('first-hung', '/repo', model, layoutWith(yesterday), {}))
    await waitFor(() => expect(sent.ops).toHaveLength(1))
    expect(new Date(written().at).getDate()).toBe(2)
  })
})
