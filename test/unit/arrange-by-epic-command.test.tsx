// The command "Arrange by Epic" (src/renderer/canvas/arrange-by-epic-command.ts, worfy-canvas ticket
// 12): it waits for the Sessions' Bindings to be read before it places them, so right after the
// window opens a Session bound by its transcript does not go to the "Unbound" cluster; when they are
// not read in time it places the Sessions by the Bindings known by then, and it sends nothing on a
// read-only screen.
//
// The file is .tsx, in the jsdom project: the command's module uses the renderer's stores and React.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARRANGE_GAP } from '../../src/renderer/canvas/arrange-by-epic'
import { runArrangeByEpic, type DrawnFlowNode } from '../../src/renderer/canvas/arrange-by-epic-command'
import { setArrangement, type ArrangementState } from '../../src/renderer/canvas/arrangement-record'
import { FRAME_GAP } from '../../src/renderer/canvas/epic-layout'
import type { DrawnNode } from '../../src/renderer/canvas/session-spot'
import { acceptLayoutState } from '../../src/renderer/canvas/useLayout'
import { useBindingsStore } from '../../src/renderer/binding/store'
import { answerReadOnly } from '../../src/renderer/projects/read-only-now'
import { EMPTY_AGENT_SIGNALS } from '../../src/shared/binding/resolve'
import { EPIC_FRAME_KIND, SUBAGENT_KIND } from '../../src/shared/layout/derived'
import { DEFAULT_VIEWPORT, type LayoutNode, type LayoutOpInput } from '../../src/shared/layout/types'

const ROOT = '/repo/demo'
const BOUND = 'aaaaaaaa-1111-4111-8111-111111111111'
const FREE = 'bbbbbbbb-2222-4222-8222-222222222222'
let projectSeq = 0
let PROJECT = ''

const base = { hidden: false, locked: false, pinned: false, tags: [] as string[] }
const session = (sessionId: string, x: number, y: number): LayoutNode => ({ id: `session:${sessionId}`, kind: 'session', x, y, w: 300, h: 120, ...base, data: { sessionId } })

/** One Epic frame `alpha`, 500 × 400 at the plane's corner: the column stands at 500 + FRAME_GAP. */
const frames = (): DrawnNode[] => [
  { type: EPIC_FRAME_KIND, width: 500, height: 400, internals: { positionAbsolute: { x: 0, y: 0 } }, data: { node: { data: { epic: { epic: 'alpha' }, auto: { x: 0, y: 0 } } } } },
]
const COLUMN = 500 + FRAME_GAP

const signalsKey = (sessionId: string): string => `${ROOT}\0${sessionId}`
/** The Bindings' store as it is once main answered `bindings.get` and every Session's transcript was read: BOUND claimed alpha 07. */
function readBindings(): void {
  useBindingsStore.setState(({ manual, signals }) => ({
    manual: { ...manual, [PROJECT]: [] },
    signals: {
      ...signals,
      [signalsKey(BOUND)]: { found: true, session: { ...EMPTY_AGENT_SIGNALS, claim: { epic: 'alpha', num: 7, command: 'ticket claim alpha 07' } }, subagents: [] },
      [signalsKey(FREE)]: { found: true, session: EMPTY_AGENT_SIGNALS, subagents: [] },
    },
  }))
}

function run(apply: (op: LayoutOpInput) => Promise<void>, waitMs?: number, drawn: () => DrawnFlowNode[] = frames): Promise<LayoutOpInput | undefined> {
  return runArrangeByEpic({ projectId: PROJECT, root: ROOT, drawn, trees: () => new Map(), apply, ...(waitMs === undefined ? {} : { waitMs }) })
}

const movesOf = (op: LayoutOpInput | undefined) => {
  if (op?.op !== 'moveMany') throw new Error(`expected moveMany, got ${op?.op}`)
  return op.moves
}

beforeEach(() => {
  projectSeq += 1
  PROJECT = `arrange-${String(projectSeq).padStart(8, '0')}`
  useBindingsStore.setState({ manual: {}, manualError: {}, signals: {} })
  // FREE reads before BOUND: were BOUND unbound, it would stand under FREE in the "Unbound" cluster.
  acceptLayoutState({ projectId: PROJECT, revision: 1, layout: { nodes: [session(FREE, -2000, 0), session(BOUND, -2000, 500)], viewport: DEFAULT_VIEWPORT } })
})

afterEach(() => {
  answerReadOnly(() => null)
  vi.restoreAllMocks()
})

describe('the command Arrange by Epic', () => {
  it('waits for the Bindings to be read: the Session bound by its transcript goes to its Epic, not to "Unbound"', async () => {
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    const pending = run(apply)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(apply).not.toHaveBeenCalled()
    readBindings()
    const op = await pending
    expect(apply).toHaveBeenCalledTimes(1)
    expect(op).toEqual({
      op: 'moveMany',
      // A layout command: main does not count the moved Sessions as touched (ADR-0076, Amendments).
      arrange: true,
      moves: [
        { id: `session:${BOUND}`, x: COLUMN, y: 0 },
        { id: `session:${FREE}`, x: COLUMN, y: 120 + FRAME_GAP },
      ],
    })
  })

  it("binds by the Project's workflow model: a Session on a Ticket's branch goes to that Ticket's Epic", async () => {
    // Only the model knows that branch `feature/x` is alpha 09: without it FREE would go to "Unbound".
    const model = {
      root: ROOT,
      epics: [{ epic: 'alpha', hasSpec: false, hasMap: false, title: null }],
      tickets: [
        { epic: 'alpha', num: 7, state: 'work', branch: null },
        { epic: 'alpha', num: 9, state: 'work', branch: 'feature/x' },
      ],
      error: null,
      branchErrors: [],
    }
    setArrangement(PROJECT, { model, sessions: [] } as unknown as ArrangementState)
    readBindings()
    useBindingsStore.setState(({ signals }) => ({ signals: { ...signals, [signalsKey(FREE)]: { found: true, session: { ...EMPTY_AGENT_SIGNALS, gitBranch: 'feature/x' }, subagents: [] } } }))
    const op = await run(() => Promise.resolve())
    if (op?.op !== 'moveMany') throw new Error('expected moveMany')
    // Both in alpha's cluster, ARRANGE_GAP apart, in the order the Layout lists them; with FREE
    // unbound, the two would stand in two clusters, CLUSTER_GAP apart, BOUND first.
    expect(op.moves).toEqual([
      { id: `session:${FREE}`, x: COLUMN, y: 0 },
      { id: `session:${BOUND}`, x: COLUMN, y: 120 + ARRANGE_GAP },
    ])
    setArrangement(PROJECT, undefined)
  })

  it('places the Sessions by the Bindings known when they are not read in time: a Session whose transcript is not read goes to "Unbound"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // main answered `bindings.get`, and BOUND's transcript was read; FREE's never answers.
    readBindings()
    useBindingsStore.setState(({ signals }) => ({ signals: Object.fromEntries(Object.entries(signals).filter(([key]) => key !== signalsKey(FREE))) }))
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    const op = await run(apply, 30)
    expect(apply).toHaveBeenCalledWith(op)
    expect(movesOf(op)).toEqual([
      { id: `session:${BOUND}`, x: COLUMN, y: 0 },
      { id: `session:${FREE}`, x: COLUMN, y: 120 + FRAME_GAP },
    ])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('moves nothing after the wait when main has not answered bindings.get: a Session bound by hand would go by its transcript', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // Every transcript is read; the manual Bindings never come.
    readBindings()
    useBindingsStore.setState(({ manual }) => ({ manual: Object.fromEntries(Object.entries(manual).filter(([id]) => id !== PROJECT)) }))
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    expect(await run(apply, 30)).toBeUndefined()
    expect(apply).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('nothing was moved')
  })

  it('places at once by the transcripts when main answered bindings.get with an error: the Canvas shows no manual Binding then either', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // Every transcript is read; main's answer to `bindings.get` is an error.
    readBindings()
    useBindingsStore.setState(({ manual, manualError }) => ({
      manual: Object.fromEntries(Object.entries(manual).filter(([id]) => id !== PROJECT)),
      manualError: { ...manualError, [PROJECT]: 'bindings.json is not readable' },
    }))
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    // An error answer counts as read: the command does not wait for the limit, and finds the manual Bindings answered.
    const started = Date.now()
    const op = await run(apply, 1000)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(apply).toHaveBeenCalledWith(op)
    expect(movesOf(op)).toEqual([
      { id: `session:${BOUND}`, x: COLUMN, y: 0 },
      { id: `session:${FREE}`, x: COLUMN, y: 120 + FRAME_GAP },
    ])
    expect(warn).not.toHaveBeenCalled()
  })

  it('releases the Project after a timeout and after an exception: the next command runs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(() => Promise.resolve(), 10)
    const failing = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.reject(new Error('main is gone')))
    readBindings()
    expect(await run(failing)).toBeUndefined()
    expect(failing).toHaveBeenCalledTimes(1)
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    expect(movesOf(await run(apply))).toHaveLength(2)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('waits for the Binding of a Session that came while it waited, too', async () => {
    const LATE = 'cccccccc-3333-4333-8333-333333333333'
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    const pending = run(apply)
    await new Promise((resolve) => setTimeout(resolve, 10))
    // LATE comes onto the plane while BOUND's and FREE's Bindings are read; its own is not yet.
    acceptLayoutState({ projectId: PROJECT, revision: 2, layout: { nodes: [session(FREE, -2000, 0), session(BOUND, -2000, 500), session(LATE, -2000, 900)], viewport: DEFAULT_VIEWPORT } })
    readBindings()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(apply).not.toHaveBeenCalled()
    // LATE claimed alpha 08: it stands in alpha's cluster under BOUND, not in "Unbound".
    useBindingsStore.setState(({ signals }) => ({
      signals: { ...signals, [signalsKey(LATE)]: { found: true, session: { ...EMPTY_AGENT_SIGNALS, claim: { epic: 'alpha', num: 8, command: 'ticket claim alpha 08' } }, subagents: [] } },
    }))
    expect(movesOf(await pending)).toEqual([
      { id: `session:${BOUND}`, x: COLUMN, y: 0 },
      { id: `session:${LATE}`, x: COLUMN, y: 120 + ARRANGE_GAP },
      { id: `session:${FREE}`, x: COLUMN, y: 2 * 120 + ARRANGE_GAP + FRAME_GAP },
    ])
  })

  it('sends nothing when the screen turns read-only while it waits', async () => {
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    const pending = run(apply)
    await new Promise((resolve) => setTimeout(resolve, 10))
    answerReadOnly(() => 'Mini gives this Machine read-only access')
    readBindings()
    expect(await pending).toBeUndefined()
    expect(apply).not.toHaveBeenCalled()
  })

  it('keeps clear of the Subagent Nodes of a Session that stays where they are drawn, not where its tree would hang', async () => {
    const KEPT = 'dddddddd-4444-4444-8444-444444444444'
    acceptLayoutState({
      projectId: PROJECT,
      revision: 2,
      layout: { nodes: [session(FREE, -2000, 0), session(BOUND, -2000, 500), { ...session(KEPT, -3000, 0), keep: true }], viewport: DEFAULT_VIEWPORT },
    })
    readBindings()
    useBindingsStore.setState(({ signals }) => ({ signals: { ...signals, [signalsKey(KEPT)]: { found: true, session: EMPTY_AGENT_SIGNALS, subagents: [] } } }))
    // KEPT's Subagent Node is drawn in the column, 0..200 high; its anchor (1 × 1) takes no room.
    const subagent = (variant: string, x: number, w: number, h: number): DrawnFlowNode => ({
      type: SUBAGENT_KIND,
      parentId: `session:${KEPT}`,
      width: w,
      height: h,
      internals: { positionAbsolute: { x, y: 0 } },
      data: { node: { data: { variant } } },
    })
    const drawn = () => [...frames(), subagent('agent', COLUMN, 400, 200), subagent('anchor', COLUMN, 1, 1)]
    expect(movesOf(await run(() => Promise.resolve(), undefined, drawn))).toEqual([
      { id: `session:${BOUND}`, x: COLUMN, y: 200 + 16 },
      { id: `session:${FREE}`, x: COLUMN, y: 200 + 16 + 120 + FRAME_GAP },
    ])
  })

  it('places at once when the Bindings are read already, and a second run on the result sends nothing', async () => {
    readBindings()
    let applied: LayoutOpInput | undefined
    const op = await run((sent) => {
      applied = sent
      return Promise.resolve()
    })
    expect(op).toBe(applied)
    if (op?.op !== 'moveMany') throw new Error('expected moveMany')
    const nodes = [session(FREE, -2000, 0), session(BOUND, -2000, 500)].map((node) => {
      const move = op.moves.find((each) => each.id === node.id)!
      return { ...node, x: move.x, y: move.y }
    })
    expect(nodes.map((node) => [node.id, node.x, node.y])).toEqual([[`session:${FREE}`, COLUMN, 120 + FRAME_GAP], [`session:${BOUND}`, COLUMN, 0]])
    acceptLayoutState({ projectId: PROJECT, revision: 2, layout: { nodes, viewport: DEFAULT_VIEWPORT } })
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    expect(await run(apply)).toBeUndefined()
    expect(apply).not.toHaveBeenCalled()
  })

  it('sends nothing on a read-only screen', async () => {
    readBindings()
    answerReadOnly(() => 'Mini gives this Machine read-only access')
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    expect(await run(apply)).toBeUndefined()
    expect(apply).not.toHaveBeenCalled()
  })

  it('does not run twice at once for one Project: a second command while the first waits is dropped', async () => {
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    const first = run(apply)
    expect(await run(apply)).toBeUndefined()
    readBindings()
    await first
    expect(apply).toHaveBeenCalledTimes(1)
  })
})
