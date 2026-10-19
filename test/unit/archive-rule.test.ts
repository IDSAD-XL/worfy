// The rule of the automatic archive (ADR-0076, points 1–2; worfy-canvas ticket 07): which Session
// Nodes main takes off the Canvas. A candidate is a Session Node whose Session is not live and
// either idled past the threshold or had its Ticket done an hour ago; a live Session, one of
// unknown status, a pinned Node, a Node with Keep, the Orchestrator and a recently touched Node
// never are. «Never» archives nothing.
import { describe, expect, it } from 'vitest'
import type { BindingTarget, BindingWorkflow } from '../../src/shared/binding/resolve'
import { layoutNodeSchema, type LayoutNode } from '../../src/shared/layout/types'
import { EMPTY_AGENT_SIGNALS } from '../../src/shared/binding/resolve'
import type { ManualBinding } from '../../src/shared/ipc/bindings'
import { ARCHIVE_NEVER, archiveCandidates, archiveSettings, sessionBindings, TICKET_DONE_GRACE_MS, type ArchiveSettings } from '../../src/main/layout/archive'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-19T12:00:00Z')
const DAY: ArchiveSettings = { idleMs: 24 * HOUR, ticketDone: true }

const session = (sessionId: string, fields: Record<string, unknown> = {}): LayoutNode =>
  layoutNodeSchema.parse({ id: `session:${sessionId}`, kind: 'session', x: 0, y: 0, w: 300, h: 120, data: { sessionId, origin: 'external', source: 'terminal', cwd: '/p' }, ...fields })

/** A transcript whose last record is `ago` ms before NOW. */
const last = (sessionId: string, ago: number) => ({ sessionId, lastAt: new Date(NOW - ago).toISOString() })

const ticket = (epic: string, num: number): BindingTarget => ({ kind: 'ticket', epic, num })
const workflow = (state: string): BindingWorkflow => ({ epics: ['e'], tickets: [{ epic: 'e', num: 7, state }] })

interface Case {
  nodes: LayoutNode[]
  live?: { sessionId: string; status: 'idle' | 'busy' | 'unknown' }[]
  history?: { sessionId: string; lastAt?: string }[]
  flow?: BindingWorkflow | undefined
  bindings?: Map<string, BindingTarget | null>
  now?: number
  settings?: ArchiveSettings
}

const run = ({ nodes, live = [], history = [], flow, bindings = new Map(), now = NOW, settings = DAY }: Case) =>
  archiveCandidates(nodes, live, history, flow, bindings, now, settings).map(({ id, rule }) => ({ id, rule }))

describe('candidates', () => {
  it('a finished Session idle past the threshold is archived by the idle rule', () => {
    expect(run({ nodes: [session('a')], history: [last('a', 25 * HOUR)] })).toEqual([{ id: 'session:a', rule: 'idle' }])
  })

  it('a finished Session idle less than the threshold is not', () => {
    expect(run({ nodes: [session('a')], history: [last('a', 23 * HOUR)] })).toEqual([])
  })

  it('a finished Session whose Ticket is done and whose last record is over an hour old is archived by the ticket-done rule', () => {
    const nodes = [session('a')]
    const bindings = new Map([['a', ticket('e', 7)]])
    expect(run({ nodes, history: [last('a', HOUR + 1)], flow: workflow('done'), bindings })).toEqual([{ id: 'session:a', rule: 'ticket-done' }])
    // Within the hour: not yet.
    expect(run({ nodes, history: [last('a', HOUR - 1)], flow: workflow('done'), bindings })).toEqual([])
    // A Ticket not done: the idle threshold alone.
    expect(run({ nodes, history: [last('a', 2 * HOUR)], flow: workflow('work'), bindings })).toEqual([])
    // The rule switched off in the settings.
    expect(run({ nodes, history: [last('a', 2 * HOUR)], flow: workflow('done'), bindings, settings: { idleMs: 24 * HOUR, ticketDone: false } })).toEqual([])
  })

  it('a Session bound to an Epic, or with no workflow model, is archived only by the idle rule', () => {
    const nodes = [session('a')]
    expect(run({ nodes, history: [last('a', 2 * HOUR)], flow: workflow('done'), bindings: new Map([['a', { kind: 'epic', epic: 'e' }]]) })).toEqual([])
    expect(run({ nodes, history: [last('a', 2 * HOUR)], flow: undefined, bindings: new Map([['a', ticket('e', 7)]]) })).toEqual([])
  })

  it('the grace after a done Ticket is one hour', () => {
    expect(TICKET_DONE_GRACE_MS).toBe(HOUR)
  })

  it('a Session Node with no transcript, or a transcript without a time, is not archived: what is not known is not closed', () => {
    expect(run({ nodes: [session('a')], history: [] })).toEqual([])
    expect(run({ nodes: [session('a')], history: [{ sessionId: 'a' }] })).toEqual([])
    expect(run({ nodes: [session('a')], history: [{ sessionId: 'a', lastAt: 'not a time' }] })).toEqual([])
  })

  it('a Node already archived is not a candidate again', () => {
    expect(run({ nodes: [session('a', { archived: { at: 1, rule: 'idle', batch: 'b1' } })], history: [last('a', 30 * HOUR)] })).toEqual([])
  })
})

describe('never archived', () => {
  const old = [last('a', 30 * HOUR)]

  it('a live Session', () => {
    expect(run({ nodes: [session('a')], history: old, live: [{ sessionId: 'a', status: 'idle' }] })).toEqual([])
    expect(run({ nodes: [session('a')], history: old, live: [{ sessionId: 'a', status: 'busy' }] })).toEqual([])
  })

  it('a Session of unknown status: counted as live', () => {
    expect(run({ nodes: [session('a')], history: old, live: [{ sessionId: 'a', status: 'unknown' }] })).toEqual([])
  })

  it('a pinned Node', () => {
    expect(run({ nodes: [session('a', { pinned: true })], history: old })).toEqual([])
  })

  it('a Node with Keep', () => {
    expect(run({ nodes: [session('a', { keep: true })], history: old })).toEqual([])
    expect(run({ nodes: [session('a', { keep: false })], history: old })).toEqual([{ id: 'session:a', rule: 'idle' }])
  })

  it('the Orchestrator: another kind, the rule does not see it', () => {
    const orchestrator = layoutNodeSchema.parse({ id: 'orch', kind: 'orchestrator', x: 0, y: 0, w: 360, h: 200, data: { sessionId: 'a' } })
    expect(run({ nodes: [orchestrator], history: old })).toEqual([])
  })

  it('a Node the user touched less than the threshold ago', () => {
    expect(run({ nodes: [session('a', { touchedAt: NOW - 23 * HOUR })], history: old })).toEqual([])
    // Touched before the threshold: a candidate again.
    expect(run({ nodes: [session('a', { touchedAt: NOW - 25 * HOUR })], history: old })).toEqual([{ id: 'session:a', rule: 'idle' }])
    // The ticket-done rule leaves a recently touched Node too.
    const bindings = new Map([['a', ticket('e', 7)]])
    expect(run({ nodes: [session('a', { touchedAt: NOW - HOUR })], history: [last('a', 2 * HOUR)], flow: workflow('done'), bindings })).toEqual([])
  })

  it('a hidden Node is still a candidate: hiding is the user\'s, archiving the automat\'s', () => {
    expect(run({ nodes: [session('a', { hidden: true })], history: old })).toEqual([{ id: 'session:a', rule: 'idle' }])
  })
})

describe('Never', () => {
  it('archives nothing, by either rule', () => {
    const bindings = new Map([['a', ticket('e', 7)]])
    expect(run({ nodes: [session('a'), session('b')], history: [last('a', 300 * HOUR), last('b', 2 * HOUR)], flow: workflow('done'), bindings, settings: ARCHIVE_NEVER })).toEqual([])
  })
})

describe('several Nodes', () => {
  it('only the candidates come back, in the order of the Layout, each with its rule', () => {
    const nodes = [session('a'), session('b'), session('c', { pinned: true }), session('d')]
    const history = [last('a', 30 * HOUR), last('b', 2 * HOUR), last('c', 30 * HOUR), last('d', 30 * HOUR)]
    const bindings = new Map<string, BindingTarget | null>([['b', ticket('e', 7)]])
    expect(run({ nodes, history, flow: workflow('done'), bindings, live: [{ sessionId: 'd', status: 'idle' }] })).toEqual([
      { id: 'session:a', rule: 'idle' },
      { id: 'session:b', rule: 'ticket-done' },
    ])
  })
})

describe('the settings', () => {
  it('are «Never» until the Setting exists (ADR-0076, point 10)', () => {
    expect(archiveSettings()).toEqual(ARCHIVE_NEVER)
  })
})

describe('the Binding of each Session, as main resolves it for the ticket-done rule', () => {
  const project = { id: 'p1', path: '/repo' }
  const flow: BindingWorkflow = { epics: ['e'], tickets: [{ epic: 'e', num: 1, state: 'done' }, { epic: 'e', num: 2, state: 'work' }, { epic: 'e', num: 3, state: 'open' }] }

  it('takes the manual Binding, else the launch one, else the signals of the transcript; a Subagent\'s stored Binding is not the Session\'s', async () => {
    const stored: ManualBinding[] = [
      { sessionId: 'm', agentId: null, target: ticket('e', 1) },
      { sessionId: 'm', agentId: null, target: ticket('e', 2), source: 'launch' },
      { sessionId: 'l', agentId: null, target: ticket('e', 2), source: 'launch' },
      { sessionId: 'sub', agentId: 'a1', target: ticket('e', 1) },
    ]
    const read: string[] = []
    const found = await sessionBindings(project, ['m', 'l', 'claimed', 'sub', 'gone'], flow, {
      stored: () => stored,
      transcriptPath: (root, sessionId) => Promise.resolve(sessionId === 'gone' ? null : `${root}/${sessionId}.jsonl`),
      signals: (path) => {
        read.push(path)
        return Promise.resolve(path.endsWith('claimed.jsonl') ? { ...EMPTY_AGENT_SIGNALS, claim: { epic: 'e', num: 3, command: 'ticket claim e 03' } } : EMPTY_AGENT_SIGNALS)
      },
    })
    expect(Object.fromEntries(found)).toEqual({ m: ticket('e', 1), l: ticket('e', 2), claimed: ticket('e', 3), sub: null, gone: null })
    // A stored Binding needs no transcript.
    expect(read).toEqual(['/repo/claimed.jsonl', '/repo/sub.jsonl'])
  })
})
