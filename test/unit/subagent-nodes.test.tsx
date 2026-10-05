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
import {
  anchorNodeId,
  buildSubagentNodes,
  doneExpanded,
  FOLD_HEIGHT,
  placeSubagents,
  SUBAGENT_HEIGHT,
  SUBAGENT_WIDTH,
  type SubagentNodeData,
} from '../../src/renderer/canvas/sources/subagents'
import { formatElapsed, statusLabel } from '../../src/renderer/claude-home/subagents'
import { useNavigation } from '../../src/renderer/session/navigation'
import { SubagentsList } from '../../src/renderer/session/rail/SubagentsRail'
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
  useNavigation.setState({ view: 'canvas', opened: null })
})

describe('placeSubagents', () => {
  const X = 300 + 56

  it('puts running Subagents right of the Session, nested ones right of their parent, and folds the done ones', () => {
    const placed = placeSubagents({ sessionId: S7, sessionWidth: 300, tree: tree7(RUNNING_AT), expanded: () => false, offsets: new Map() })
    expect(placed.map(({ key, x, y, h, parentId, fold }) => ({ key, x, y, h, parentId, fold }))).toEqual([
      { key: 'anchor', x: 300, y: 18, h: 1, parentId: null, fold: null },
      { key: 'toolu_01S7AGENT1XXXXXXXXXXXXXX', x: X, y: 0, h: SUBAGENT_HEIGHT, parentId: anchorNodeId(S7), fold: null },
      { key: 'toolu_01S7AGENT2XXXXXXXXXXXXXX', x: X + SUBAGENT_WIDTH + 56, y: 0, h: SUBAGENT_HEIGHT, parentId: `subagent:${S7}/toolu_01S7AGENT1XXXXXXXXXXXXXX`, fold: null },
      { key: 'done:session', x: X, y: SUBAGENT_HEIGHT + 12, h: FOLD_HEIGHT, parentId: anchorNodeId(S7), fold: { parentKey: 'session', count: 1, expanded: false } },
    ])
  })

  it('shows the done Subagents when their row is open, and keeps a manual offset', () => {
    const placed = placeSubagents({
      sessionId: S7,
      sessionWidth: 300,
      tree: tree7(RUNNING_AT),
      expanded: (key) => key === 'session',
      offsets: new Map([['toolu_01S7AGENT1XXXXXXXXXXXXXX', { dx: 40, dy: -10 }]]),
    })
    const byKey = new Map(placed.map((place) => [place.key, place]))
    expect(byKey.get('toolu_01S7AGENT1XXXXXXXXXXXXXX')).toMatchObject({ x: X + 40, y: -10, auto: { x: X, y: 0 } })
    // Its Subagent follows it; the siblings below stay where the automatic layout puts them.
    expect(byKey.get('toolu_01S7AGENT2XXXXXXXXXXXXXX')).toMatchObject({ x: X + 40 + SUBAGENT_WIDTH + 56, y: -10 })
    expect(byKey.get('toolu_01S7AGENT3XXXXXXXXXXXXXX')).toMatchObject({ x: X, y: SUBAGENT_HEIGHT + 12 })
    expect(byKey.get('done:session')).toMatchObject({ y: 2 * (SUBAGENT_HEIGHT + 12), fold: { count: 1, expanded: true } })
  })

  it('folds every done Subagent of the finished Session into one row, nested ones included', () => {
    const placed = placeSubagents({ sessionId: S7, sessionWidth: 300, tree: tree7(), expanded: () => false, offsets: new Map() })
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

  it('reads the offsets the subagent-tree Node keeps', () => {
    const saved = node({ id: `subagents:${S7}`, kind: 'subagent-tree', w: 1, h: 1, data: { 'offset:toolu_01S7AGENT1XXXXXXXXXXXXXX': { dx: 5, dy: 7 }, 'offset:bad': 'x' } })
    const nodes = buildSubagentNodes('p4', layoutWith(session, saved), trees(tree7(RUNNING_AT)), {})
    expect(nodes.find((each) => each.id.endsWith('AGENT1XXXXXXXXXXXXXX'))!.position).toEqual({ x: 300 + 56 + 5, y: 7 })
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
    expect(useNavigation.getState()).toMatchObject({ view: 'session', opened: { nodeId: session.id, projectId: data.projectId, external: { sessionId: S7, agentId: 'a3000000000000286' } } })
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
    render(<SubagentsList tree={tree7(RUNNING_AT)} now={Date.parse('2026-06-01T10:01:10.000Z')} onOpen={onOpen} />)
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

  it('says so when the Session has no Subagents', () => {
    render(<SubagentsList tree={[]} now={0} onOpen={() => undefined} />)
    expect(screen.getByTestId('subagents-rail').textContent).toContain('No Subagents yet')
    expect(flattenSubagents([])).toEqual([])
  })
})
