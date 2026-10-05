import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../src/shared/ipc/claude-home'
import { layoutNodeSchema, type LayoutNode } from '../../src/shared/layout/types'
import {
  planSessionNodes,
  readSessionNodeData,
  sessionNodeId,
  SESSION_KIND,
  sessionSourceLabel,
  sessionStatus,
  worfySessionIds,
} from '../../src/renderer/claude-home/session-nodes'

// Which Session Nodes the Canvas needs for the Project's live Sessions (ticket 14): one Node per
// Session id, wherever the Session was started; a Session worfy runs keeps its own Node.

const live = (sessionId: string, extra: Partial<LiveSession> = {}): LiveSession => ({
  pid: 100,
  sessionId,
  cwd: '/Users/test/projects/demo',
  status: 'idle',
  entrypoint: 'cli',
  ...extra,
})

const node = (fields: Partial<LayoutNode> & { id: string; kind: string }): LayoutNode => layoutNodeSchema.parse({ x: 0, y: 0, w: 300, h: 120, ...fields })

const orchestrator = (sessionId: string | null) => node({ id: 'orch', kind: 'orchestrator', w: 360, h: 200, data: { sessionId } })
const external = (sessionId: string, fields: Partial<LayoutNode> = {}) =>
  node({ id: sessionNodeId(sessionId), kind: SESSION_KIND, data: { sessionId, origin: 'external', source: 'terminal', cwd: '/x' }, ...fields })

describe('deduplication by session id', () => {
  it('gives no external Node to a Session that the Orchestrator Node names', () => {
    const nodes = [orchestrator('S-worfy')]
    const plan = planSessionNodes({ live: [live('S-worfy')], nodes, worfyIds: worfySessionIds(nodes, []), seen: new Set() })
    expect(plan).toEqual({ create: [], remove: [] })
  })

  it('gives no external Node to a Session that worfy runs, even before its Node names it', () => {
    const nodes = [orchestrator(null)]
    const plan = planSessionNodes({ live: [live('S-running')], nodes, worfyIds: worfySessionIds(nodes, ['S-running']), seen: new Set() })
    expect(plan.create).toEqual([])
  })

  it('removes the external Node of a Session that turns out to be worfy’s own', () => {
    const nodes = [orchestrator('S-worfy'), external('S-worfy'), external('S-other')]
    const plan = planSessionNodes({ live: [live('S-worfy'), live('S-other')], nodes, worfyIds: worfySessionIds(nodes, []), seen: new Set() })
    expect(plan).toEqual({ create: [], remove: [sessionNodeId('S-worfy')] })
  })

  it('creates one Node per Session id, and none for a Session that already has one', () => {
    const nodes = [external('S-1')]
    const plan = planSessionNodes({ live: [live('S-1'), live('S-2'), live('S-2', { pid: 101 })], nodes, worfyIds: worfySessionIds(nodes, []), seen: new Set() })
    expect(plan.remove).toEqual([])
    expect(plan.create.map((op) => op.node.id)).toEqual([sessionNodeId('S-2')])
  })

  it('does not bring back a Node the user removed while the app runs', () => {
    const plan = planSessionNodes({ live: [live('S-1')], nodes: [], worfyIds: new Set(), seen: new Set(['S-1']) })
    expect(plan.create).toEqual([])
  })

  it('counts an external Node as no claim of worfy’s', () => {
    expect([...worfySessionIds([external('S-1'), orchestrator('S-2'), node({ id: 'n', kind: 'note', data: { sessionId: 'S-3' } })], ['S-4'])].sort()).toEqual([
      'S-2',
      'S-3',
      'S-4',
    ])
  })
})

describe('a new Session Node', () => {
  it('is a read-only Session Node with where it was started', () => {
    const [op] = planSessionNodes({ live: [live('S-1', { cwd: '/Users/test/projects/demo/sub', name: 'fix-tests' })], nodes: [], worfyIds: new Set(), seen: new Set() }).create
    expect(op?.op).toBe('create')
    expect(op?.node).toMatchObject({
      id: 'session:S-1',
      kind: 'session',
      data: { sessionId: 'S-1', origin: 'external', source: 'terminal', cwd: '/Users/test/projects/demo/sub', name: 'fix-tests' },
    })
    expect(layoutNodeSchema.safeParse(op?.node).success).toBe(true)
  })

  it('stands right of the Nodes there are, and under the last Session Node', () => {
    const nodes = [node({ id: 'a', kind: 'note', x: 10, y: 40, w: 200, h: 100 }), node({ id: 'b', kind: 'note', x: 300, y: -20, w: 100, h: 50 })]
    const [first, second] = planSessionNodes({ live: [live('S-1'), live('S-2')], nodes, worfyIds: new Set(), seen: new Set() }).create
    expect(first?.node).toMatchObject({ x: 448, y: -20 })
    expect(second?.node.x).toBe(448)
    expect(second?.node.y).toBeGreaterThan((first?.node.y ?? 0) + (first?.node.h ?? 0))
  })

  it('names a Claude desktop Session as such', () => {
    const [op] = planSessionNodes({ live: [live('S-1', { entrypoint: 'claude-desktop' })], nodes: [], worfyIds: new Set(), seen: new Set() }).create
    expect(op?.node.data).toMatchObject({ source: 'desktop' })
    const data = readSessionNodeData(op?.node.data ?? {})
    expect(data && sessionSourceLabel(data)).toBe('Claude desktop')
    expect(sessionSourceLabel({ sessionId: 'S', origin: 'external', source: 'terminal', cwd: '/a/b' })).toBe('terminal · /a/b')
  })
})

describe('the status of a Session Node', () => {
  it('follows the live Session and is finished once its process is gone', () => {
    expect(sessionStatus(live('S', { status: 'busy' }))).toEqual({ status: 'working', label: 'busy' })
    expect(sessionStatus(live('S', { status: 'idle' }))).toEqual({ status: 'ready', label: 'idle' })
    expect(sessionStatus(live('S', { status: 'unknown' }))).toEqual({ status: 'ready', label: 'live' })
    expect(sessionStatus(undefined)).toEqual({ status: 'done', label: 'finished' })
  })

  it('reads the Node data it wrote and refuses what it did not', () => {
    expect(readSessionNodeData({ sessionId: 'S', origin: 'external', source: 'desktop', cwd: '/a', extra: 1 })).toEqual({ sessionId: 'S', origin: 'external', source: 'desktop', cwd: '/a' })
    expect(readSessionNodeData({ sessionId: 5 })).toBeNull()
  })
})
