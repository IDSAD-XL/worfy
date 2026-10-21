// The list of archived Session Nodes (src/renderer/canvas/archive-list.ts, worfy-canvas ticket 09):
// grouped by Binding, newest first; where Show puts a Node; that Show and Restore go through the
// Canvas's LayoutOps; and that Restore and Show sent through the history against main's store are
// one step whose undo archives the Nodes again at their old place, with their rule, batch and time
// (the shared inverse of `restore`, src/renderer/canvas/history.ts).
import { describe, expect, it } from 'vitest'
import type { BindingTarget } from '../../src/shared/binding/resolve'
import type { Layout, LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'
import { DEFAULT_VIEWPORT } from '../../src/shared/layout/types'
import { archivedToday, archiveList, epicHistory, restoreSessions, searchArchive, showPlace, showSession, ticketHistory, type ArchiveOps } from '../../src/renderer/canvas/archive-list'
import { applyRecorded, historyOf, resetHistories, type Group, type LayoutChannel, type Send } from '../../src/renderer/canvas/history'
import { LayoutStore } from '../../src/main/layout/store'

const sessionNode = (sessionId: string, at: number | null, extra: Partial<LayoutNode> = {}): LayoutNode => ({
  id: `session:${sessionId}`,
  kind: 'session',
  x: 0,
  y: 0,
  w: 300,
  h: 120,
  hidden: false,
  locked: false,
  pinned: false,
  tags: [],
  data: { sessionId, origin: 'external', source: 'terminal', cwd: '/repo', name: `name ${sessionId}` },
  archived: at === null ? null : { at, rule: 'idle', batch: `b${at}` },
  ...extra,
})

const layoutOf = (...nodes: LayoutNode[]): Layout => ({ nodes, viewport: DEFAULT_VIEWPORT })

const ticket = (epic: string, num: number): BindingTarget => ({ kind: 'ticket', epic, num })
const epic = (name: string): BindingTarget => ({ kind: 'epic', epic: name })

const LAYOUT = layoutOf(
  sessionNode('t1-old', 100),
  sessionNode('t1-new', 300),
  sessionNode('t2', 200),
  sessionNode('e1', 150),
  sessionNode('free-old', 50),
  sessionNode('free-new', 500),
  // Not archived: on the Canvas, not in the list.
  sessionNode('live', null),
  // Archived, but not a Session Node.
  { ...sessionNode('note', 400), id: 'note-1', kind: 'note', data: {} },
  // Another epic's Ticket.
  sessionNode('other', 250),
)

const BINDINGS = new Map<string, BindingTarget>([
  ['t1-old', ticket('demo', 1)],
  ['t1-new', ticket('demo', 1)],
  ['t2', ticket('demo', 2)],
  ['e1', epic('demo')],
  ['other', ticket('else', 1)],
])

const HISTORY = [{ sessionId: 't1-new', title: 'Fix the parser', lastAt: '2026-10-20T10:00:00.000Z' }]

const ids = (sessions: readonly { sessionId: string }[]) => sessions.map((each) => each.sessionId)

describe('archiveList', () => {
  const list = archiveList(LAYOUT, HISTORY, BINDINGS)

  it('groups the archived Session Nodes by Binding: to a Ticket, to an Epic, without one', () => {
    expect(ids(ticketHistory(list, 'demo', 1))).toEqual(['t1-new', 't1-old'])
    expect(ids(ticketHistory(list, 'demo', 2))).toEqual(['t2'])
    expect(ids(list.epics.get('demo') ?? [])).toEqual(['e1'])
    expect(ids(list.unbound)).toEqual(['free-new', 'free-old'])
    expect(list.count).toBe(7)
  })

  it('leaves out Nodes that are not archived and Nodes that are not Sessions', () => {
    const all = [...list.unbound, ...[...list.tickets.values()].flat(), ...[...list.epics.values()].flat()]
    expect(ids(all)).not.toContain('live')
    expect(all.map((each) => each.nodeId)).not.toContain('note-1')
  })

  it('orders each group by archived.at, newest first', () => {
    expect(ticketHistory(list, 'demo', 1).map((each) => each.archivedAt)).toEqual([300, 100])
    expect(list.unbound.map((each) => each.archivedAt)).toEqual([500, 50])
  })

  it('caps an archive time in the future at now: such a Session is archived just now, not above the later ones', () => {
    const capped = archiveList(layoutOf(sessionNode('future', 9_000), sessionNode('recent', 900)), [], new Map(), () => true, 1_000)
    expect(capped.unbound.map((each) => [each.sessionId, each.archivedAt])).toEqual([
      ['future', 1_000],
      ['recent', 900],
    ])
  })

  it("shows a Session bound to a Ticket in its Epic's history too, with the Epic's own, newest first", () => {
    expect(ids(epicHistory(list, 'demo'))).toEqual(['t1-new', 't2', 'e1', 't1-old'])
    expect(ids(epicHistory(list, 'else'))).toEqual(['other'])
    expect(epicHistory(list, 'none')).toEqual([])
  })

  it("takes the title from the Session's history, else the name its Node kept; the end time from the history", () => {
    const [fresh, old] = ticketHistory(list, 'demo', 1)
    expect(fresh).toMatchObject({ title: 'Fix the parser', endedAt: Date.parse('2026-10-20T10:00:00.000Z') })
    expect(old).toMatchObject({ title: 'name t1-old', endedAt: null })
  })

  it('a Session the bindings do not name is without Binding once its Binding is known', () => {
    const fresh = archiveList(LAYOUT, [], new Map())
    expect(fresh.unbound).toHaveLength(7)
    expect(fresh.pending).toEqual([])
    expect(fresh.tickets.size).toBe(0)
  })

  it('a Session whose Binding is not known yet is pending, in no group', () => {
    const reading = archiveList(LAYOUT, [], new Map([['t2', ticket('demo', 2)]]), (sessionId) => sessionId === 'free-new' || sessionId === 't2')
    expect(ids(reading.unbound)).toEqual(['free-new'])
    expect(ids(reading.pending)).toEqual(['t1-new', 'other', 'e1', 't1-old', 'free-old'])
    // A Session the bindings name is grouped whatever `known` says.
    expect(ids(ticketHistory(reading, 'demo', 2))).toEqual(['t2'])
    expect(reading.count).toBe(7)
  })
})

describe('search and today', () => {
  const list = archiveList(LAYOUT, HISTORY, new Map())

  it('finds by title, ignoring case; an empty query keeps all', () => {
    expect(ids(searchArchive(list.unbound, 'PARSER'))).toEqual(['t1-new'])
    expect(searchArchive(list.unbound, '  ')).toHaveLength(list.unbound.length)
  })

  it('today means archived since the local midnight', () => {
    const now = new Date(2026, 9, 21, 15, 0).getTime()
    const midnight = new Date(2026, 9, 21, 0, 0).getTime()
    const today = archiveList(layoutOf(sessionNode('a', midnight + 1), sessionNode('b', midnight - 1), sessionNode('c', now)), [], new Map())
    expect(ids(archivedToday(today.unbound, now))).toEqual(['c', 'a'])
  })
})

describe('showPlace', () => {
  it('puts the Node at the spot when it is clear', () => {
    expect(showPlace({ w: 300, h: 120 }, { x: 1000, y: 40 }, [])).toEqual({ x: 1000, y: 40 })
  })

  it('moves it off a Node that stands at the spot', () => {
    const place = showPlace({ w: 300, h: 120 }, { x: 1000, y: 40 }, [{ x: 1000, y: 40, w: 300, h: 120 }])
    expect(place).not.toEqual({ x: 1000, y: 40 })
    const clear = place.x >= 1000 + 300 + 16 || place.y >= 40 + 120 + 16 || place.x + 300 + 16 <= 1000 || place.y + 120 + 16 <= 40
    expect(clear).toBe(true)
  })
})

/** LayoutOps that record what they are given. */
function fakeOps(): { ops: ArchiveOps; sent: { op: LayoutOpInput; group: Group | undefined }[] } {
  const sent: { op: LayoutOpInput; group: Group | undefined }[] = []
  return {
    sent,
    ops: {
      apply: (op, group) => {
        sent.push({ op, group })
        return Promise.resolve()
      },
    },
  }
}

describe('Show and Restore go through LayoutOps', () => {
  it('Restore is one restore of the archived ones of the named Nodes', async () => {
    const { ops, sent } = fakeOps()
    const layout = layoutOf({ ...sessionNode('a', 10), x: 5, y: 6 }, { ...sessionNode('b', 20), x: 7, y: 8 }, sessionNode('live', null))
    await restoreSessions(ops, layout, ['session:a', 'session:b', 'session:live', 'session:gone'])
    expect(sent.map((each) => each.op)).toEqual([{ op: 'restore', ids: ['session:a', 'session:b'] }])
  })

  it('Restore of Nodes none of which is archived sends nothing', async () => {
    const { ops, sent } = fakeOps()
    await restoreSessions(ops, layoutOf(sessionNode('live', null)), ['session:live'])
    expect(sent).toEqual([])
  })

  it('Show moves the archived Node to its place, then restores it, as one gesture', async () => {
    const { ops, sent } = fakeOps()
    const layout = layoutOf(sessionNode('a', 10), { ...sessionNode('live', null), x: 2000, y: 40 })
    await showSession(ops, layout, 'session:a', { x: 2000, y: 40 }, [])
    expect(sent.map((each) => each.op.op)).toEqual(['move', 'restore'])
    const move = sent[0]!.op as Extract<LayoutOpInput, { op: 'move' }>
    // Off the live Node standing at the spot.
    expect(move.id).toBe('session:a')
    expect(move.x === 2000 && move.y === 40).toBe(false)
    expect(sent[0]!.group).toBeDefined()
    expect(sent[1]!.group).toBe(sent[0]!.group)
  })

  it('Show without a spot only restores the Node, at its old place or the nearest clear one', async () => {
    const { ops, sent } = fakeOps()
    await showSession(ops, layoutOf(sessionNode('a', 10)), 'session:a', undefined, [])
    expect(sent.map((each) => each.op)).toEqual([{ op: 'restore', ids: ['session:a'] }])
  })

  it('Show of a Node that is no longer archived sends nothing: it does not move a Node on the Canvas', async () => {
    const { ops, sent } = fakeOps()
    await showSession(ops, layoutOf(sessionNode('live', null)), 'session:live', { x: 2000, y: 40 }, [])
    expect(sent).toEqual([])
  })
})

describe('Restore and Show against the store of main, through the undo history', () => {
  const PROJECT = 'demo-0a1b2c3d'
  const ARCHIVED_AT = 1_700_000_000_000
  /** An archived Session Node at (0, 0), a second one at (600, 0) of another batch, and a Note that took the first one's place since. */
  function setup() {
    resetHistories()
    const store = new LayoutStore(() => '/nonexistent/worfy-test', { write: () => undefined, delayMs: 60_000 })
    const send: Send = (op) => {
      try {
        return Promise.resolve({ revision: store.apply(PROJECT, op, 'screen-1').revision })
      } catch (error) {
        return Promise.resolve(String(error))
      }
    }
    const channel: LayoutChannel = { send, layout: () => store.get(PROJECT).layout }
    const ops: ArchiveOps = { apply: async (op, group) => void (await applyRecorded(PROJECT, op, channel, group)) }
    store.apply(PROJECT, { op: 'create', node: { id: 's1', kind: 'session', x: 0, y: 0, w: 200, h: 100, data: { sessionId: 'aaaa' } } })
    store.apply(PROJECT, { op: 'create', node: { id: 's2', kind: 'session', x: 600, y: 0, w: 200, h: 100, data: { sessionId: 'bbbb' } } })
    store.apply(PROJECT, { op: 'archive', batch: 'b1', nodes: [{ id: 's1', rule: 'idle', at: ARCHIVED_AT }] })
    store.apply(PROJECT, { op: 'archive', batch: 'b2', nodes: [{ id: 's2', rule: 'ticket-done', at: ARCHIVED_AT + 5 }] })
    store.apply(PROJECT, { op: 'create', node: { id: 'n1', kind: 'note', x: 0, y: 0, w: 200, h: 100, data: {} } })
    const nodeOf = (id: string) => () => store.get(PROJECT).layout.nodes.find((node) => node.id === id)!
    return { store, ops, s1: nodeOf('s1'), s2: nodeOf('s2') }
  }

  it('Restore puts the Node off the Note; ⌘Z archives it again at its old place; ⇧⌘Z restores it again', async () => {
    const { store, ops, s1 } = setup()
    await restoreSessions(ops, store.get(PROJECT).layout, ['s1'])
    expect(s1().archived).toBeNull()
    expect(s1().x === 0 && s1().y === 0).toBe(false)
    const restoredAt = { x: s1().x, y: s1().y }
    expect(await historyOf(PROJECT).undo()).toBe(true)
    expect(s1()).toMatchObject({ x: 0, y: 0, archived: { rule: 'idle', batch: 'b1', at: ARCHIVED_AT } })
    expect(await historyOf(PROJECT).redo()).toBe(true)
    expect(s1()).toMatchObject({ ...restoredAt, archived: null })
  })

  it('Show puts the Node at the spot; ⌘Z archives it again at its old place', async () => {
    const { store, ops, s1 } = setup()
    await showSession(ops, store.get(PROJECT).layout, 's1', { x: 1000, y: 40 }, [])
    expect(s1()).toMatchObject({ x: 1000, y: 40, archived: null })
    expect(await historyOf(PROJECT).undo()).toBe(true)
    expect(s1()).toMatchObject({ x: 0, y: 0, archived: { rule: 'idle', batch: 'b1', at: ARCHIVED_AT } })
  })

  it('Restore of several (Restore all from today) is one step; ⌘Z archives each again in its batch, at its place and time', async () => {
    const { store, ops, s1, s2 } = setup()
    await restoreSessions(ops, store.get(PROJECT).layout, ['s1', 's2'])
    expect([s1().archived, s2().archived]).toEqual([null, null])
    expect(await historyOf(PROJECT).undo()).toBe(true)
    expect(s1()).toMatchObject({ x: 0, y: 0, archived: { rule: 'idle', batch: 'b1', at: ARCHIVED_AT } })
    expect(s2()).toMatchObject({ x: 600, y: 0, archived: { rule: 'ticket-done', batch: 'b2', at: ARCHIVED_AT + 5 } })
    expect(await historyOf(PROJECT).undo()).toBe(false)
  })
})
