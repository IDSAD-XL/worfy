// The list «To» of the comments on lines of the Changes screen (worfy-changes-view ticket 05): the handler of
// `changes.targets` (src/main/ipc/changes.ts over src/main/changes/targets.ts), called as main calls it, with the
// channel's schemas on both sides, over a Layout, stored Bindings and transcript times the test gives.
//
// - A Session Node of worfy bound to the Ticket (a manual Binding or a launch one) is in the list; one bound to another
//   Ticket, an archived one and one with no Binding are not; the Orchestrator is.
// - The default is the bound Session whose transcript's last record is the newest, however old it is (no limit of 24
//   hours, unlike the actions on a PR); without a bound Session, the Orchestrator (spec, Q2).
// - A Session that runs names its comments by its live id; `pending-…` is no id yet.
import { describe, expect, it } from 'vitest'
import { changesHandlers, type ChangesDeps } from '../../src/main/ipc/changes'
import type { TargetsDeps } from '../../src/main/changes/targets'
import type { InvokeHandler } from '../../src/main/ipc/index'
import { changesTargets } from '../../src/shared/ipc/changes'
import type { InvokeChannel } from '../../src/shared/ipc/channels'
import type { ManualBinding } from '../../src/shared/ipc/bindings'
import type { LayoutNode } from '../../src/shared/layout/types'

const PROJECT = 'demo-0000000d'
const DAY = 24 * 60 * 60_000
const NOW = Date.parse('2026-11-20T10:00:00Z')

/** A handler of `handlers` by its channel; called with the channel's schemas on both sides, as main's wrapper does. */
function caller(handlers: readonly InvokeHandler[]) {
  return async <C extends InvokeChannel>(channel: C, input: unknown): Promise<ReturnType<C['output']['parse']>> => {
    const handler = handlers.find((each) => each.channel.name === channel.name)!
    const output = await handler.handle(channel.input.parse(input) as never, {} as never)
    return channel.output.parse(output) as ReturnType<C['output']['parse']>
  }
}

const node = (id: string, kind: string, data: Record<string, unknown>, over: Partial<LayoutNode> = {}): LayoutNode => ({ id, kind, x: 0, y: 0, w: 340, h: 220, data, ...over }) as LayoutNode

const session = (id: string, sessionId: string, over: Partial<LayoutNode> = {}): LayoutNode => node(id, 'session', { origin: 'worfy', vendor: 'claude', sessionId }, over)

const bound = (sessionId: string, epic: string, num: number, source?: 'launch'): ManualBinding => ({ sessionId, agentId: null, target: { kind: 'ticket', epic, num }, ...(source === undefined ? {} : { source }) })

interface World {
  nodes: LayoutNode[]
  stored: ManualBinding[]
  lastAt: Record<string, number>
  live?: Record<string, string>
  autopilot?: boolean
}

function call(world: World) {
  const targets: TargetsDeps = {
    nodes: () => world.nodes,
    stored: () => world.stored,
    lastAt: async (_projectId, ids) => new Map(ids.flatMap((id) => (world.lastAt[id] === undefined ? [] : [[id, world.lastAt[id]!] as const]))),
    live: (_projectId, nodeId) => world.live?.[nodeId] ?? null,
    autopilot: () => world.autopilot === true,
  }
  const deps: ChangesDeps = {
    project: () => Promise.reject(new Error('the list «To» reads no repository')),
    git: () => Promise.reject(new Error('the list «To» runs no git')),
    targets: async () => targets,
  }
  return caller(changesHandlers(deps))(changesTargets, { projectId: PROJECT, ticket: { epic: 'demo', num: 3 } })
}

const ORCHESTRATOR = node('orchestrator', 'orchestrator', { sessionId: 'orch-sdk-1' })

describe('the list «To» of a Ticket', () => {
  it('has the Sessions bound to the Ticket and the Orchestrator, not a Session of another Ticket, an archived one or an unbound one', async () => {
    const answer = await call({
      nodes: [
        session('session:a', 'sdk-a'),
        session('session:b', 'sdk-b'),
        session('session:other', 'sdk-other'),
        session('session:archived', 'sdk-archived', { archived: { at: NOW - DAY, rule: 'idle', batch: 'b1' } }),
        session('session:free', 'sdk-free'),
        ORCHESTRATOR,
      ],
      stored: [bound('sdk-a', 'demo', 3), bound('sdk-b', 'demo', 3, 'launch'), bound('sdk-other', 'demo', 4), bound('sdk-archived', 'demo', 3)],
      lastAt: { 'sdk-a': NOW - 3 * DAY, 'sdk-b': NOW - 2 * DAY, 'sdk-other': NOW },
    })
    expect(answer.targets.map((each) => [each.kind, each.nodeId, each.sessionId])).toEqual([
      ['session', 'session:b', 'sdk-b'],
      ['session', 'session:a', 'sdk-a'],
      ['orchestrator', 'orchestrator', 'orch-sdk-1'],
    ])
    expect(answer.targets.map((each) => each.title)).toEqual(['Session sdk-b', 'Session sdk-a', 'Orchestrator'])
  })

  it('goes by default to the bound Session with the newest record, even one older than 24 hours (Q2)', async () => {
    const answer = await call({
      nodes: [session('session:a', 'sdk-a'), session('session:b', 'sdk-b'), ORCHESTRATOR],
      stored: [bound('sdk-a', 'demo', 3), bound('sdk-b', 'demo', 3)],
      lastAt: { 'sdk-a': NOW - 5 * DAY, 'sdk-b': NOW - 9 * DAY },
    })
    expect(answer.defaultNodeId).toBe('session:a')
    expect(answer.targets.find((each) => each.nodeId === 'session:a')?.lastAt).toBe(NOW - 5 * DAY)
  })

  it('goes by default to the Orchestrator when no Session is bound to the Ticket (Q2)', async () => {
    const answer = await call({ nodes: [session('session:other', 'sdk-other'), ORCHESTRATOR], stored: [bound('sdk-other', 'demo', 4)], lastAt: { 'sdk-other': NOW } })
    expect(answer.targets.map((each) => each.nodeId)).toEqual(['orchestrator'])
    expect(answer.defaultNodeId).toBe('orchestrator')
  })

  it('a manual Binding to another Ticket wins over the launch one to this Ticket', async () => {
    const answer = await call({ nodes: [session('session:a', 'sdk-a'), ORCHESTRATOR], stored: [bound('sdk-a', 'demo', 3, 'launch'), bound('sdk-a', 'demo', 7)], lastAt: {} })
    expect(answer.targets.map((each) => each.nodeId)).toEqual(['orchestrator'])
  })

  it('names a running Session by its live id, and says that Autopilot runs', async () => {
    const answer = await call({
      nodes: [session('session:a', 'sdk-a'), node('orchestrator', 'orchestrator', {})],
      stored: [bound('sdk-a', 'demo', 3)],
      lastAt: {},
      live: { 'session:a': 'sdk-a-live', orchestrator: 'orch-live' },
      autopilot: true,
    })
    expect(answer.targets.map((each) => each.sessionId)).toEqual(['sdk-a-live', 'orch-live'])
    expect(answer.defaultNodeId).toBe('session:a')
    expect(answer.autopilot).toBe(true)
  })

  it('an Orchestrator that never reported its Session has no id yet; a Project without one has an empty list', async () => {
    const fresh = await call({ nodes: [node('orchestrator', 'orchestrator', {})], stored: [], lastAt: {} })
    expect(fresh.targets).toEqual([{ kind: 'orchestrator', nodeId: 'orchestrator', sessionId: null, title: 'Orchestrator', lastAt: null }])
    expect(fresh.autopilot).toBe(false)
    const none = await call({ nodes: [], stored: [], lastAt: {} })
    expect(none).toEqual({ targets: [], defaultNodeId: null, autopilot: false })
  })
})
