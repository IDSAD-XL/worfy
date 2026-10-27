// The Subagent tree on the Canvas and in the Session rail (ticket 15): where the Nodes go
// (src/renderer/canvas/sources/subagents.ts), the tree's lines (edges/subagents.ts), what a Node
// shows (nodes/SubagentNode.tsx) and the rail's list (session/rail/SubagentsRail.tsx). The tree is
// the one of the synthetic Session 7777 (test/fixtures/claude-home/README.md).
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import subagentEdges from '../../src/renderer/canvas/edges/subagents'
import SubagentNode from '../../src/renderer/canvas/nodes/SubagentNode'
import type { CanvasNodeProps } from '../../src/renderer/canvas/nodes/index'
import subagentSource, {
  anchorNodeId,
  buildSubagentNodes,
  doneExpanded,
  FOLD_HEIGHT,
  placeSubagents,
  SUBAGENT_HEIGHT,
  SUBAGENT_WIDTH,
  subagentPlaneRects,
  type SubagentNodeData,
} from '../../src/renderer/canvas/sources/subagents'
import { formatElapsed, statusLabel } from '../../src/renderer/claude-home/subagents'
import { useNavigation } from '../../src/renderer/session/navigation'
import { SubagentsList } from '../../src/renderer/session/rail/SubagentsRail'
import { Transcript } from '../../src/renderer/session/Transcript'
import type { Layout, LayoutNode } from '../../src/shared/layout/types'
import { parseTranscriptLines } from '../../src/shared/transcript/parse'
import { buildSubagentTree, flattenSubagents, subagentFile, subagentSignals, type SubagentFile, type SubagentInfo } from '../../src/shared/transcript/subagents'

const S7 = '77777777-7777-4777-8777-777777777777'
/** The files of Session 7777, by path relative to its project folder. */
const FILES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../fixtures/claude-home/projects/-Users-test-projects-agents/**/*', { query: '?raw', import: 'default', eager: true }),
  ).map(([path, text]) => [path.slice(path.indexOf('-Users-test-projects-agents/') + '-Users-test-projects-agents/'.length), text]),
)
const lines = (path: string, until?: string): string[] =>
  (FILES[path] ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .filter((line) => until === undefined || ((JSON.parse(line) as { timestamp?: string }).timestamp ?? '') <= until)

/** The tree of Session 7777 as it was at `until`. */
function tree7(until?: string): SubagentInfo[] {
  const files: SubagentFile[] = []
  for (const path of Object.keys(FILES).sort()) {
    const agentId = new RegExp(`^${S7}/subagents/agent-(.+)\\.jsonl$`).exec(path)?.[1]
    if (!agentId) continue
    const meta = FILES[`${S7}/subagents/agent-${agentId}.meta.json`]
    const transcript = lines(path, until)
    if (transcript.length > 0) files.push(subagentFile(agentId, meta === undefined ? null : JSON.parse(meta), transcript))
  }
  return buildSubagentTree({ signals: subagentSignals(parseTranscriptLines(lines(`${S7}.jsonl`, until))), files })
}

const RUNNING_AT = '2026-06-01T10:01:10.000Z'
const node = (fields: Partial<LayoutNode> & Pick<LayoutNode, 'id' | 'kind'>): LayoutNode => ({ x: 100, y: 200, w: 300, h: 120, hidden: false, locked: false, pinned: false, tags: [], data: {}, ...fields })
const session = node({ id: `session:${S7}`, kind: 'session', data: { sessionId: S7 } })
const layoutWith = (...nodes: LayoutNode[]): Layout => ({ nodes, viewport: { x: 0, y: 0, zoom: 1 } })
const trees = (tree: SubagentInfo[]) => new Map([[S7, tree]])

afterEach(() => {
  vi.useRealTimers()
  useNavigation.setState({ view: 'canvas', opened: {}, offCanvas: {} })
})

describe('placeSubagents', () => {
  const X = 300 + 56

  it('puts running Subagents right of the Session, nested ones right of their parent, and folds the done ones', () => {
    const placed = placeSubagents({ sessionId: S7, sessionWidth: 300, tree: tree7(RUNNING_AT), expanded: () => false })
    expect(placed.map(({ key, x, y, h, parentId, fold }) => ({ key, x, y, h, parentId, fold }))).toEqual([
      { key: 'anchor', x: 300, y: 18, h: 1, parentId: null, fold: null },
      { key: 'toolu_01S7AGENT1XXXXXXXXXXXXXX', x: X, y: 0, h: SUBAGENT_HEIGHT, parentId: anchorNodeId(S7), fold: null },
      { key: 'toolu_01S7AGENT2XXXXXXXXXXXXXX', x: X + SUBAGENT_WIDTH + 56, y: 0, h: SUBAGENT_HEIGHT, parentId: `subagent:${S7}/toolu_01S7AGENT1XXXXXXXXXXXXXX`, fold: null },
      { key: 'done:session', x: X, y: SUBAGENT_HEIGHT + 12, h: FOLD_HEIGHT, parentId: anchorNodeId(S7), fold: { parentKey: 'session', count: 1, expanded: false } },
    ])
  })

  it('shows the done Subagents when their row is open', () => {
    const placed = placeSubagents({ sessionId: S7, sessionWidth: 300, tree: tree7(RUNNING_AT), expanded: (key) => key === 'session' })
    const byKey = new Map(placed.map((place) => [place.key, place]))
    expect(byKey.get('toolu_01S7AGENT1XXXXXXXXXXXXXX')).toMatchObject({ x: X, y: 0 })
    expect(byKey.get('toolu_01S7AGENT2XXXXXXXXXXXXXX')).toMatchObject({ x: X + SUBAGENT_WIDTH + 56, y: 0 })
    expect(byKey.get('toolu_01S7AGENT3XXXXXXXXXXXXXX')).toMatchObject({ x: X, y: SUBAGENT_HEIGHT + 12 })
    expect(byKey.get('done:session')).toMatchObject({ y: 2 * (SUBAGENT_HEIGHT + 12), fold: { count: 1, expanded: true } })
  })

  it('folds every done Subagent of the finished Session into one row, nested ones included', () => {
    const placed = placeSubagents({ sessionId: S7, sessionWidth: 300, tree: tree7(), expanded: () => false })
    expect(placed.map((place) => place.key)).toEqual(['anchor', 'done:session'])
    expect(placed[1]!.fold).toEqual({ parentKey: 'session', count: 2, expanded: false })
  })
})

describe('buildSubagentNodes', () => {
  it('hangs the Nodes from the Session Node, skips hidden and pinned Session Nodes, and keeps the array while nothing changed', () => {
    const tree = tree7(RUNNING_AT)
    const layout = layoutWith(session)
    const nodes = buildSubagentNodes('p1', layout, trees(tree), {})
    expect(nodes.map((each) => each.id)).toEqual([
      anchorNodeId(S7),
      `subagent:${S7}/toolu_01S7AGENT1XXXXXXXXXXXXXX`,
      `subagent:${S7}/toolu_01S7AGENT2XXXXXXXXXXXXXX`,
      `subagent:${S7}/done:session`,
    ])
    expect(nodes.every((each) => each.parentId === session.id && each.type === 'subagent')).toBe(true)
    expect(buildSubagentNodes('p1', layoutWith(session), trees(tree7(RUNNING_AT)), {})).toBe(nodes)
    expect(buildSubagentNodes('p2', layoutWith({ ...session, hidden: true }), trees(tree), {})).toEqual([])
    expect(buildSubagentNodes('p3', layoutWith({ ...session, pinned: true }), trees(tree), {})).toEqual([])
  })

  it('reports where its Nodes are on the plane, for the Epic frames (ADR-0032): absolute, without the anchor', () => {
    const nodes = buildSubagentNodes('p5', layoutWith(session), trees(tree7(RUNNING_AT)), {})
    const rects = subagentPlaneRects(layoutWith(session), nodes)
    const drawn = nodes.filter((each) => (each.data.node.data as SubagentNodeData).variant !== 'anchor')
    expect(drawn).toHaveLength(3)
    expect(rects).toEqual(drawn.map((each) => ({ x: session.x + each.position.x, y: session.y + each.position.y, w: each.width, h: each.height })))
    expect(rects[0]).toMatchObject({ w: SUBAGENT_WIDTH, h: SUBAGENT_HEIGHT })
    // Right of the Session Node, in plane units rather than relative to it.
    expect(rects[0]!.x).toBeGreaterThan(session.x + session.w)
    // A Session Node that is not in the Layout any more: nothing to measure from.
    expect(subagentPlaneRects(layoutWith(), nodes)).toEqual([])
  })

  // ADR-0037: the places are computed; a `subagent-tree` Node an older version left moves nothing.
  it('ignores the offsets of a subagent-tree Node an older version left', () => {
    const saved = node({ id: `subagents:${S7}`, kind: 'subagent-tree', w: 1, h: 1, data: { 'offset:toolu_01S7AGENT1XXXXXXXXXXXXXX': { dx: 5, dy: 7 } } })
    const plain = buildSubagentNodes('p4a', layoutWith(session), trees(tree7(RUNNING_AT)), {})
    const nodes = buildSubagentNodes('p4', layoutWith(session, saved), trees(tree7(RUNNING_AT)), {})
    expect(nodes.find((each) => each.id.endsWith('AGENT1XXXXXXXXXXXXXX'))!.position).toEqual({ x: 300 + 56, y: 0 })
    expect(nodes.map((each) => each.position)).toEqual(plain.map((each) => each.position))
  })

  it('lets only a Subagent’s own Node be dragged, to bind it, and saves nothing when it is dropped', () => {
    const nodes = buildSubagentNodes('p-drag-none', layoutWith(session), trees(tree7(RUNNING_AT)), {})
    const variant = (each: (typeof nodes)[number]) => (each.data.node.data as SubagentNodeData).variant
    expect(nodes.filter((each) => each.draggable !== false).map(variant)).toEqual(['agent', 'agent'])
    expect(nodes.filter((each) => each.draggable === false).map(variant)).toEqual(['anchor', 'fold'])
    // A fold row is neither dragged nor selected, yet clicked: React Flow must not let the pointer through it.
    expect(nodes.find((each) => variant(each) === 'fold')!.style).toEqual({ pointerEvents: 'all' })
    const agent = nodes.find((each) => variant(each) === 'agent')!
    // Not saved: the Canvas puts the Node back where the source has it (Canvas.tsx).
    expect(subagentSource.moved({ projectId: 'p-drag-none', layout: layoutWith(session) }, { ...agent, position: { x: agent.position.x + 200, y: agent.position.y + 200 } })).toBe(false)
  })
})

describe('the tree keeps clear of the Nodes of the Layout (worfy-daily ticket 28)', () => {
  const AGENT1 = `subagent:${S7}/toolu_01S7AGENT1XXXXXXXXXXXXXX`
  /** A Card right next to the Session Node, where the tree's automatic place is. */
  const card = (x: number, y: number): LayoutNode => node({ id: 'card-question', kind: 'card', x, y, w: 320, h: 200 })
  const near = card(session.x + session.w + 40, session.y)
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  it('puts the Subagent Nodes and the done row where they cover neither the Card nor another Node', () => {
    const other = node({ id: 'note', kind: 'note', x: 1100, y: 180, w: 200, h: 140 })
    const layout = layoutWith(session, near, other)
    const nodes = buildSubagentNodes('p-clear', layout, trees(tree7(RUNNING_AT)), {})
    const rects = subagentPlaneRects(layout, nodes)
    expect(rects).toHaveLength(3)
    for (const rect of rects) {
      for (const each of [session, near, other]) expect(overlaps(rect, each), `${JSON.stringify(rect)} on ${each.id}`).toBe(false)
    }
    // Still to the right of its Session, and the tree keeps its shape.
    expect(Math.min(...rects.map((rect) => rect.x))).toBeGreaterThan(session.x + session.w)
    expect(rects[1]!.x - rects[0]!.x).toBe(SUBAGENT_WIDTH + 56)
  })

  it('ignores the Epic frames, Tickets, hidden and pinned Nodes: the frames\' column keeps clear of the tree, not the other way round (ADR-0032)', () => {
    const lone = buildSubagentNodes('p-skip-a', layoutWith(session), trees(tree7(RUNNING_AT)), {})
    for (const extra of [{ kind: 'epic-frame' }, { kind: 'ticket' }, { hidden: true }, { pinned: true }] as Partial<LayoutNode>[]) {
      const nodes = buildSubagentNodes(`p-skip-${JSON.stringify(extra)}`, layoutWith(session, { ...near, ...extra }), trees(tree7(RUNNING_AT)), {})
      expect(nodes.map((each) => each.position), JSON.stringify(extra)).toEqual(lone.map((each) => each.position))
    }
  })

  // ADR-0037: no Node of the tree keeps a place of its own; the whole tree but its anchor moves.
  it('shifts the whole tree but its anchor together off a Card, keeping its shape', () => {
    const tree = tree7(RUNNING_AT)
    const free = buildSubagentNodes('p-whole-a', layoutWith(session), trees(tree), {})
    const shifted = buildSubagentNodes('p-whole-b', layoutWith(session, near), trees(tree), {})
    const anchor = anchorNodeId(S7)
    expect(shifted.find((each) => each.id === anchor)!.position).toEqual(free.find((each) => each.id === anchor)!.position)
    const offsets = shifted
      .filter((each) => each.id !== anchor)
      .map((each) => {
        const before = free.find((other) => other.id === each.id)!.position
        return { dx: each.position.x - before.x, dy: each.position.y - before.y }
      })
    expect(offsets[0]).not.toEqual({ dx: 0, dy: 0 })
    for (const offset of offsets) expect(offset).toEqual(offsets[0])
  })

  it('follows its Session: a Session and a Card moved together leave the tree where it was relative to the Session', () => {
    const tree = tree7(RUNNING_AT)
    const here = buildSubagentNodes('p-follow', layoutWith(session, near), trees(tree), {})
    const there = buildSubagentNodes('p-follow', layoutWith({ ...session, x: session.x + 500, y: session.y + 70 }, card(near.x + 500, near.y + 70)), trees(tree), {})
    expect(there.find((each) => each.id === AGENT1)!.position).toEqual(here.find((each) => each.id === AGENT1)!.position)
  })
})

describe('the trees of two Sessions keep clear of each other (ADR-0038)', () => {
  const S8 = '88888888-8888-4888-8888-888888888888'
  // The second Session right under the first: its tree's automatic place is on the first one's tree.
  const second = node({ id: `session:${S8}`, kind: 'session', x: session.x, y: session.y + session.h + 16, data: { sessionId: S8 } })
  const both = (tree: SubagentInfo[]) =>
    new Map([
      [S7, tree],
      [S8, tree],
    ])
  const crowds = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
    a.x < b.x + b.w + 16 && b.x < a.x + a.w + 16 && a.y < b.y + b.h + 16 && b.y < a.y + a.h + 16
  const rectsOf = (layout: Layout, nodes: ReturnType<typeof buildSubagentNodes>, sessionNodeId: string) =>
    subagentPlaneRects(
      layout,
      nodes.filter((each) => each.parentId === sessionNodeId),
    )

  it('the later Session’s tree goes around the earlier one’s, which stays where it is alone; computed twice, the answer is the same', () => {
    const tree = tree7(RUNNING_AT)
    const layout = layoutWith(session, second)
    const alone = buildSubagentNodes('p-two-alone', layoutWith(session), trees(tree), {})
    const nodes = buildSubagentNodes('p-two', layout, both(tree), {})
    const first = rectsOf(layout, nodes, session.id)
    const later = rectsOf(layout, nodes, second.id)
    expect(first).toHaveLength(3)
    expect(later).toHaveLength(3)
    // Without the rule the second tree would sit on the first: the same shape, 136 px lower.
    const unshifted = first.map((rect) => ({ ...rect, y: rect.y + second.y - session.y }))
    expect(unshifted.some((rect) => first.some((other) => crowds(rect, other)))).toBe(true)
    for (const rect of later) for (const other of first) expect(crowds(rect, other), `${JSON.stringify(rect)} on ${JSON.stringify(other)}`).toBe(false)
    // The earlier Session's tree does not yield to the later one.
    expect(first).toEqual(rectsOf(layoutWith(session), alone, session.id))
    // The same input twice: the same places, no back and forth.
    const again = buildSubagentNodes('p-two-again', layout, both(tree), {})
    expect(again.map((each) => [each.id, each.position])).toEqual(nodes.map((each) => [each.id, each.position]))
  })

  it('the order of the Sessions in the Layout decides who yields', () => {
    const tree = tree7(RUNNING_AT)
    const swapped = layoutWith(second, session)
    const nodes = buildSubagentNodes('p-two-swapped', swapped, both(tree), {})
    const alone = buildSubagentNodes('p-two-swapped-alone', layoutWith(second), new Map([[S8, tree]]), {})
    expect(rectsOf(swapped, nodes, second.id)).toEqual(rectsOf(layoutWith(second), alone, second.id))
    for (const rect of rectsOf(swapped, nodes, session.id)) for (const other of rectsOf(swapped, nodes, second.id)) expect(crowds(rect, other)).toBe(false)
  })
})

describe('subagent edges', () => {
  it('draws a line from each parent to its Subagents and to its done row, only between Nodes on the Canvas', () => {
    const nodes = buildSubagentNodes('p5', layoutWith(session), trees(tree7(RUNNING_AT)), {}).map((each) => each.data.node)
    const edges = subagentEdges([session, ...nodes])
    expect(edges.map((edge) => edge.source)).toEqual([anchorNodeId(S7), `subagent:${S7}/toolu_01S7AGENT1XXXXXXXXXXXXXX`, anchorNodeId(S7)])
    expect(edges.map((edge) => edge.target)).toEqual([
      `subagent:${S7}/toolu_01S7AGENT1XXXXXXXXXXXXXX`,
      `subagent:${S7}/toolu_01S7AGENT2XXXXXXXXXXXXXX`,
      `subagent:${S7}/done:session`,
    ])
    // Without its parent on the Canvas, a Node gets no line.
    expect(subagentEdges(nodes.filter((each) => !each.id.endsWith('AGENT1XXXXXXXXXXXXXX'))).map((edge) => edge.target)).toEqual([`subagent:${S7}/done:session`])
  })
})

function renderNode(data: SubagentNodeData, id = 'n1') {
  const props = { id, data: { node: { id, kind: 'subagent', data } }, selected: false } as unknown as CanvasNodeProps
  return render(
    <ReactFlowProvider>
      <SubagentNode {...props} />
    </ReactFlowProvider>,
  )
}

const dataOf = (key: string, tree = tree7(RUNNING_AT)): SubagentNodeData => {
  const found = buildSubagentNodes(`p-${key}-${Math.random()}`, layoutWith(session), trees(tree), {}).find((each) => each.id.endsWith(key))
  return found!.data.node.data as SubagentNodeData
}

describe('SubagentNode', () => {
  it('shows a running Subagent with its time going on', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(Date.parse('2026-06-01T10:01:10.000Z'))
    renderNode(dataOf('AGENT1XXXXXXXXXXXXXX'))
    expect(screen.getByTestId('subagent-node').dataset.status).toBe('running')
    expect(screen.getByTestId('subagent-name').textContent).toBe('impl-08')
    expect(screen.getByTestId('subagent-kind').textContent).toBe('implementer · claude-sonnet-5')
    expect(screen.getByTestId('subagent-status').textContent).toBe('running 1m 05s')
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByTestId('subagent-status').textContent).toBe('running 1m 07s')
  })

  it('shows the type of a Subagent of the `worfy` plugin without the plugin, and the full type in the tooltip', () => {
    const data = dataOf('AGENT1XXXXXXXXXXXXXX')
    renderNode({ ...data, agent: { ...data.agent!, name: null, subagentType: 'worfy:implementer' } })
    const name = screen.getByTestId('subagent-name')
    const kind = screen.getByTestId('subagent-kind')
    expect(name.textContent).toBe('implementer')
    expect(name.title).toBe('worfy:implementer')
    expect(kind.textContent).toBe('implementer · claude-sonnet-5')
    expect(kind.title).toBe('worfy:implementer')
  })

  it('shows a reviewer that rejected with the word REJECTED on the Node', () => {
    const reviewer = dataOf('done:session')
    expect(reviewer.fold?.count).toBe(1)
    const open = buildSubagentNodes('p-open', layoutWith(session), trees(tree7(RUNNING_AT)), { [`p-open|${S7}|session`]: true }).find((each) => each.id.endsWith('AGENT3XXXXXXXXXXXXXX'))!
    renderNode(open.data.node.data as SubagentNodeData)
    expect(screen.getByTestId('subagent-verdict').textContent).toBe('REJECTED')
    expect(screen.getByTestId('subagent-status').textContent).toBe('done 50s')
    expect(screen.getByTestId('subagent-node').dataset.status).toBe('done')
  })

  it('opens the Subagent transcript, read-only, from the Transcript button', () => {
    const data = dataOf('AGENT1XXXXXXXXXXXXXX')
    renderNode(data)
    fireEvent.click(screen.getByTestId('subagent-open'))
    expect(useNavigation.getState()).toMatchObject({ view: 'session', opened: { [data.projectId]: { nodeId: session.id, projectId: data.projectId, external: { sessionId: S7, agentId: 'a3000000000000286' } } } })
  })

  it('cannot open a Subagent that has no transcript file yet', () => {
    const tree = buildSubagentTree({ signals: subagentSignals([{ event: { type: 'tool_use', id: 'toolu_x', name: 'Agent', input: { subagent_type: 'scout' }, parentToolUseId: null }, at: 1 }]), files: [] })
    renderNode(dataOf('toolu_x', tree))
    expect((screen.getByTestId('subagent-open') as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens and folds the done row with a click', () => {
    const data = dataOf('done:session')
    renderNode(data)
    const row = screen.getByTestId('subagent-fold')
    expect(row.textContent).toBe('1 done')
    fireEvent.click(row)
    expect(doneExpanded(data.projectId, S7, 'session')).toBe(true)
    fireEvent.click(row)
    expect(doneExpanded(data.projectId, S7, 'session')).toBe(false)
  })
})

describe('status label', () => {
  it('formats the time a Subagent ran', () => {
    expect([formatElapsed(45_000), formatElapsed(365_000), formatElapsed(3_720_000), formatElapsed(-5)]).toEqual(['45s', '6m 05s', '1h 02m', '0s'])
    expect(statusLabel({ status: 'error', startedAt: 0, durationMs: 3000 }, 0)).toBe('error 3s')
    expect(statusLabel({ status: 'running', startedAt: null, durationMs: null }, 0)).toBe('running')
  })
})

describe('SubagentsList', () => {
  it('lists the tree with statuses, nested Subagents indented, and opens a row', () => {
    const onOpen = vi.fn()
    render(<SubagentsList tree={tree7(RUNNING_AT)} now={Date.parse('2026-06-01T10:01:10.000Z')} onOpen={onOpen} sessionKey="list-7777" />)
    expect(screen.getAllByTestId('subagents-rail-row')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('subagents-rail-done'))
    const rows = screen.getAllByTestId('subagents-rail-row')
    expect(rows.map((row) => [row.dataset.subagentId, row.dataset.status, row.textContent])).toEqual([
      ['a3000000000000286', 'running', '•impl-08 · implementerrunning 1m 05s'],
      ['a4000000000000286', 'running', '└scoutrunning 50s'],
      ['a5000000000000286', 'done', '•verify-07 · reviewerREJECTEDdone 50s'],
    ])
    expect(Number.parseInt(rows[1]!.style.paddingLeft)).toBeGreaterThan(Number.parseInt(rows[0]!.style.paddingLeft))
    fireEvent.click(within(rows[2]!).getByText('REJECTED'))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a5000000000000286' }))
  })

  it('shows the types of the `worfy` plugin without the plugin, the full type in the tooltip', () => {
    const [first] = tree7(RUNNING_AT)
    const tree = [{ ...first!, subagentType: 'worfy:implementer', children: [] }, { ...first!, id: 'x', agentId: 'ax', name: null, subagentType: 'worfy:scout', children: [] }]
    render(<SubagentsList tree={tree} now={Date.parse('2026-06-01T10:01:10.000Z')} onOpen={() => undefined} sessionKey="list-types" />)
    const names = screen.getAllByTestId('subagents-rail-name')
    expect(names.map((name) => [name.textContent, name.title])).toEqual([
      ['impl-08 · implementer', 'worfy:implementer'],
      ['scout', 'worfy:scout'],
    ])
  })

  it('says so when the Session has no Subagents', () => {
    render(<SubagentsList tree={[]} now={0} onOpen={() => undefined} sessionKey="list-empty" />)
    expect(screen.getByTestId('subagents-rail').textContent).toContain('No Subagents yet')
    expect(screen.queryByTestId('subagents-rail-done')).toBeNull()
    expect(flattenSubagents([])).toEqual([])
  })

  it('puts the newest first and folds the done ones into a closed "Done (N)" group', () => {
    const tree = settled([
      sub('old', 'done', 1000),
      sub('mid', 'running', 2000),
      sub('new', 'done', 3000, [sub('new-child', 'running', 3500)]),
    ])
    render(<SubagentsList tree={tree} now={10_000} onOpen={() => undefined} sessionKey="list-fold" />)
    expect(railIds()).toEqual(['mid'])
    const group = screen.getByTestId('subagents-rail-done')
    expect(group.tagName).toBe('BUTTON')
    expect(group.textContent).toBe('Done (2)')
    expect(group.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(group)
    expect(group.getAttribute('aria-expanded')).toBe('true')
    // Both done ones, newest first, each with its whole subtree under it.
    expect(railIds()).toEqual(['mid', 'new', 'new-child', 'old'])
    expect(document.getElementById(group.getAttribute('aria-controls')!)?.contains(screen.getAllByTestId('subagents-rail-row')[1]!)).toBe(true)
    fireEvent.click(group)
    expect(group.getAttribute('aria-expanded')).toBe('false')
    expect(railIds()).toEqual(['mid'])
  })

  it('keeps running and error ones above the group, newest first on every level, the ones without a start last', () => {
    const tree = settled([
      sub('err', 'error', 1000),
      sub('nostart', 'running', null),
      sub('run', 'running', 2000, [sub('child-old', 'done', 2100), sub('child-nostart', 'running', null), sub('child-new', 'error', 2200)]),
      sub('done', 'done', 4000),
    ])
    render(<SubagentsList tree={tree} now={10_000} onOpen={() => undefined} sessionKey="list-order" />)
    expect(railIds()).toEqual(['run', 'child-new', 'child-old', 'child-nostart', 'err', 'nostart'])
    expect(screen.getByTestId('subagents-rail-done').textContent).toBe('Done (1)')
  })

  it('remembers the group open per Session while the window runs', () => {
    const tree = settled([sub('a', 'done', 1000), sub('b', 'done', 2000)])
    const view = render(<SubagentsList tree={tree} now={10_000} onOpen={() => undefined} sessionKey="list-s1" />)
    expect(railIds()).toEqual([])
    expect(screen.getByTestId('subagents-rail').textContent).not.toContain('No Subagents yet')
    fireEvent.click(screen.getByTestId('subagents-rail-done'))
    expect(railIds()).toEqual(['b', 'a'])
    view.rerender(<SubagentsList tree={tree} now={10_000} onOpen={() => undefined} sessionKey="list-s2" />)
    expect(screen.getByTestId('subagents-rail-done').getAttribute('aria-expanded')).toBe('false')
    expect(railIds()).toEqual([])
    view.unmount()
    render(<SubagentsList tree={tree} now={10_000} onOpen={() => undefined} sessionKey="list-s1" />)
    expect(screen.getByTestId('subagents-rail-done').getAttribute('aria-expanded')).toBe('true')
    expect(railIds()).toEqual(['b', 'a'])
  })
})

/** A Subagent of a hand-made tree; `settled` gives the depths. */
function sub(id: string, status: SubagentInfo['status'], startedAt: number | null, children: SubagentInfo[] = []): SubagentInfo {
  return {
    id,
    agentId: id,
    toolUseId: null,
    parentAgentId: null,
    name: id,
    subagentType: null,
    model: null,
    description: null,
    status,
    background: true,
    startedAt,
    durationMs: null,
    summary: null,
    verdict: null,
    depth: 1,
    transcript: true,
    children,
  }
}
/** The tree in the order buildSubagentTree gives it: oldest first on each level, without a start last. */
function settled(list: SubagentInfo[], depth = 1): SubagentInfo[] {
  return [...list]
    .sort((a, b) => (a.startedAt ?? Number.POSITIVE_INFINITY) - (b.startedAt ?? Number.POSITIVE_INFINITY))
    .map((info) => ({ ...info, depth, children: settled(info.children, depth + 1) }))
}
const railIds = (): (string | undefined)[] => screen.queryAllByTestId('subagents-rail-row').map((row) => row.dataset.subagentId)

describe('the Subagent row of a transcript', () => {
  it('shows the type of a `worfy` plugin Subagent without the plugin, the full type in the tooltip', () => {
    render(
      <Transcript
        events={[
          { type: 'subagent', phase: 'started', taskId: 'k1', toolUseId: null, description: 'impl-10', subagentType: 'worfy:implementer', status: null, summary: null },
          { type: 'subagent', phase: 'started', taskId: 'k2', toolUseId: null, description: 'map', subagentType: 'scout', status: null, summary: null },
        ]}
      />,
    )
    expect(screen.getAllByTestId('transcript-subagent-type').map((type) => [type.textContent, type.title])).toEqual([
      ['implementer', 'worfy:implementer'],
      ['scout', 'scout'],
    ])
  })
})
