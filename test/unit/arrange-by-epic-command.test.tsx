// The command "Arrange by Epic" (src/renderer/canvas/arrange-by-epic-command.ts, worfy-canvas ticket
// 12): it waits for the Sessions' Bindings to be read before it places them, so right after the
// window opens a Session bound by its transcript does not go to the "Unbound" cluster; it sends
// nothing when they are not read in time, and nothing on a read-only screen.
//
// The file is .tsx, in the jsdom project: the command's module uses the renderer's stores and React.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runArrangeByEpic } from '../../src/renderer/canvas/arrange-by-epic-command'
import { FRAME_GAP } from '../../src/renderer/canvas/epic-layout'
import type { DrawnNode } from '../../src/renderer/canvas/session-spot'
import { acceptLayoutState } from '../../src/renderer/canvas/useLayout'
import { useBindingsStore } from '../../src/renderer/binding/store'
import { answerReadOnly } from '../../src/renderer/projects/read-only-now'
import { EMPTY_AGENT_SIGNALS } from '../../src/shared/binding/resolve'
import { EPIC_FRAME_KIND } from '../../src/shared/layout/derived'
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

function run(apply: (op: LayoutOpInput) => Promise<void>, waitMs?: number): Promise<LayoutOpInput | undefined> {
  return runArrangeByEpic({ projectId: PROJECT, root: ROOT, drawn: frames, trees: () => new Map(), apply, ...(waitMs === undefined ? {} : { waitMs }) })
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

  it('sends nothing when the Bindings are not read in time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const apply = vi.fn<(op: LayoutOpInput) => Promise<void>>(() => Promise.resolve())
    expect(await run(apply, 30)).toBeUndefined()
    expect(apply).not.toHaveBeenCalled()
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
