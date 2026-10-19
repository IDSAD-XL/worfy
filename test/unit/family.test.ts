// The Family of a Node (worfy-canvas ticket 03): the Node and what is tied to it by a Binding and
// by the Subagent tree — a Ticket, its Epic frame, the Sessions bound to it and their Subagents.
// The Canvas lights it up on hover and selection; here only the pure computation and the reading
// of the links from React Flow's Nodes.
import { describe, expect, it } from 'vitest'
import { FAMILY_ANCHOR_KIND, familyLinksOf, familyOf, type FamilyLinks } from '../../src/renderer/canvas/family'
import { EPIC_FRAME_KIND, epicNodeId, SUBAGENT_KIND, TICKET_KIND, ticketNodeId } from '../../src/shared/layout/derived'

const S = (name: string): string => `session:${name}`
const SUB = (session: string, key: string): string => `subagent:${session}/${key}`

// Epic e: Tickets 1 and 2; Epic f: Ticket 1.
// Session A is bound to Ticket e/1 and has Subagents a1, a2.
// Session B is bound to Epic e and has Subagent b1.
// Session C has no Binding and has Subagent c1.
// Session D is bound to Ticket f/1, no Subagents.
// Session W has no Binding; its Subagent w1 is bound to Ticket e/2 by itself, w2 is not.
// Session E has no Binding and no Subagents.
const links: FamilyLinks = {
  epics: ['e', 'f'],
  tickets: [
    { epic: 'e', num: 1 },
    { epic: 'e', num: 2 },
    { epic: 'f', num: 1 },
  ],
  sessions: [S('A'), S('B'), S('C'), S('D'), S('W'), S('E')],
  subagents: [
    { nodeId: SUB('A', 'a1'), sessionNodeId: S('A') },
    { nodeId: SUB('A', 'a2'), sessionNodeId: S('A') },
    { nodeId: SUB('B', 'b1'), sessionNodeId: S('B') },
    { nodeId: SUB('C', 'c1'), sessionNodeId: S('C') },
    { nodeId: SUB('W', 'w1'), sessionNodeId: S('W') },
    { nodeId: SUB('W', 'w2'), sessionNodeId: S('W') },
  ],
  bindings: [
    { agentNodeId: S('A'), target: { kind: 'ticket', epic: 'e', num: 1 } },
    { agentNodeId: S('B'), target: { kind: 'epic', epic: 'e' } },
    { agentNodeId: S('D'), target: { kind: 'ticket', epic: 'f', num: 1 } },
    { agentNodeId: SUB('W', 'w1'), target: { kind: 'ticket', epic: 'e', num: 2 } },
  ],
}

const sorted = (family: ReadonlySet<string> | null): string[] | null => (family === null ? null : [...family].sort())
const of = (nodeId: string): string[] | null => sorted(familyOf(nodeId, links))

describe('familyOf', () => {
  it('a Ticket: it, its Epic frame, the Sessions bound to it and their Subagents', () => {
    expect(of(ticketNodeId('e', 1))).toEqual([epicNodeId('e'), S('A'), SUB('A', 'a1'), SUB('A', 'a2'), ticketNodeId('e', 1)].sort())
    // Bound by a Subagent only: that Subagent and its Session, not the Session's other Subagents.
    expect(of(ticketNodeId('e', 2))).toEqual([epicNodeId('e'), S('W'), SUB('W', 'w1'), ticketNodeId('e', 2)].sort())
    expect(of(ticketNodeId('f', 1))).toEqual([epicNodeId('f'), S('D'), ticketNodeId('f', 1)].sort())
  })

  it('a Session: it, its Subagents, its Ticket and that Ticket’s Epic frame — or its Epic frame', () => {
    expect(of(S('A'))).toEqual([epicNodeId('e'), S('A'), SUB('A', 'a1'), SUB('A', 'a2'), ticketNodeId('e', 1)].sort())
    expect(of(S('B'))).toEqual([epicNodeId('e'), S('B'), SUB('B', 'b1')].sort())
    expect(of(S('D'))).toEqual([epicNodeId('f'), S('D'), ticketNodeId('f', 1)].sort())
  })

  it('a Session without a Binding: it and its Subagents; with none of them either, no Family', () => {
    expect(of(S('C'))).toEqual([S('C'), SUB('C', 'c1')])
    expect(of(S('W'))).toEqual([S('W'), SUB('W', 'w1'), SUB('W', 'w2')])
    expect(of(S('E'))).toBeNull()
  })

  it('a Subagent: its Session’s Family, and what the Subagent is bound to itself', () => {
    expect(of(SUB('A', 'a2'))).toEqual(of(S('A')))
    expect(of(SUB('C', 'c1'))).toEqual(of(S('C')))
    expect(of(SUB('W', 'w2'))).toEqual(of(S('W')))
    expect(of(SUB('W', 'w1'))).toEqual([epicNodeId('e'), S('W'), SUB('W', 'w1'), SUB('W', 'w2'), ticketNodeId('e', 2)].sort())
  })

  it('an Epic frame: it, its Tickets, the Sessions bound to the Epic or its Tickets and their Subagents', () => {
    expect(of(epicNodeId('e'))).toEqual(
      [epicNodeId('e'), ticketNodeId('e', 1), ticketNodeId('e', 2), S('A'), SUB('A', 'a1'), SUB('A', 'a2'), S('B'), SUB('B', 'b1'), S('W'), SUB('W', 'w1')].sort(),
    )
    expect(of(epicNodeId('f'))).toEqual([epicNodeId('f'), S('D'), ticketNodeId('f', 1)].sort())
  })

  it('any other Node has no Family', () => {
    expect(of('note-1')).toBeNull()
    expect(of(ticketNodeId('e', 9))).toBeNull()
    expect(of(epicNodeId('nope'))).toBeNull()
  })
})

describe('familyLinksOf', () => {
  const layoutNode = (id: string, kind: string, data: Record<string, unknown>) => ({ id, kind, x: 0, y: 0, w: 1, h: 1, hidden: false, locked: false, pinned: false, tags: [], data })
  const flowNode = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, data: { node: layoutNode(id, type, data) } })

  it('reads the Epic frames, Tickets, Sessions, Subagents and Bindings from the Canvas’s Nodes', () => {
    const nodes = [
      flowNode(epicNodeId('e'), EPIC_FRAME_KIND, { epic: { epic: 'e' } }),
      flowNode(ticketNodeId('e', 1), TICKET_KIND, { ticket: { epic: 'e', num: 1 } }),
      flowNode(S('A'), 'session', { sessionId: 'A' }),
      flowNode('note-1', 'note', { text: 'a note' }),
      flowNode(SUB('A', 'a1'), SUBAGENT_KIND, { variant: 'agent', sessionId: 'A', sessionNodeId: S('A') }),
      flowNode(`binding-anchor:${S('A')}`, FAMILY_ANCHOR_KIND, { variant: 'agent', sessionId: 'A', agentNodeId: S('A'), binding: { target: { kind: 'ticket', epic: 'e', num: 1 } } }),
      flowNode('binding-anchor:ticket:e/1', FAMILY_ANCHOR_KIND, { variant: 'ticket', epic: 'e', num: 1 }),
    ]
    expect(familyLinksOf(nodes)).toEqual({
      epics: ['e'],
      tickets: [{ epic: 'e', num: 1 }],
      sessions: [S('A')],
      subagents: [{ nodeId: SUB('A', 'a1'), sessionNodeId: S('A') }],
      bindings: [{ agentNodeId: S('A'), target: { kind: 'ticket', epic: 'e', num: 1 } }],
    })
  })
})
