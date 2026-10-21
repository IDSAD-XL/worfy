import { describe, expect, it } from 'vitest'
import {
  FIND_LIMIT,
  findDocs,
  FindIndex,
  nodeTitle,
  orderMatches,
  rankItems,
  selectionScope,
  snippet,
  stepMatch,
  transcriptText,
  type FindDoc,
  type FindNode,
} from '../../src/renderer/find/search-index'

describe('palette ranking', () => {
  it('puts the exact Ticket number above a title that only contains the same digits', () => {
    const items = [
      { id: 'title-07', title: 'Release notes for build 07', detail: 'worfy-mvp/12' },
      { id: 'ticket-07', title: 'Search over the Canvas', detail: 'worfy-mvp/07', keys: ['07', '7', 'worfy-mvp/07'] },
    ]
    expect(rankItems(items, '07').map((item) => item.id)).toEqual(['ticket-07', 'title-07'])
    expect(rankItems(items, '7').map((item) => item.id)[0]).toBe('ticket-07')
  })

  it('ranks a title prefix over a word start, a word start over a match inside a word, and a title over the detail', () => {
    const items = [
      { id: 'inside', title: 'Reship it' },
      { id: 'detail', title: 'Something', detail: 'ship' },
      { id: 'word', title: 'Go and ship' },
      { id: 'prefix', title: 'Ship ticket' },
    ]
    expect(rankItems(items, 'ship').map((item) => item.id)).toEqual(['prefix', 'word', 'inside', 'detail'])
  })

  it('matches several words in any order, then letters in order, and drops what does not match', () => {
    const items = [
      { id: 'words', title: 'Ship ticket', detail: 'worfy-mvp/08' },
      { id: 'fuzzy', title: 'New terminal' },
      { id: 'none', title: 'Switch to Canvas' },
    ]
    expect(rankItems(items, '08 ship').map((item) => item.id)).toEqual(['words'])
    expect(rankItems(items, 'nwtrm').map((item) => item.id)).toEqual(['fuzzy'])
  })

  it('keeps the items’ own order for an empty query and for equal scores, and stops at the limit', () => {
    const items = [{ title: 'b' }, { title: 'a' }, { title: 'c' }]
    expect(rankItems(items, '  ')).toEqual(items)
    expect(rankItems(items, '', 2)).toEqual(items.slice(0, 2))
    expect(rankItems([{ title: 'x one' }, { title: 'x two' }], 'x').map((item) => item.title)).toEqual(['x one', 'x two'])
  })

  it('is not case-sensitive and collapses spaces', () => {
    expect(rankItems([{ title: 'Run wave worfy-mvp' }], '  RUN   wave ')).toHaveLength(1)
  })
})

const doc = (key: string, nodeId: string, text: string, field: FindDoc['field'] = 'node'): FindDoc => ({ key, nodeId, field, text })

describe('find index', () => {
  it('counts every occurrence, ignoring case, in every document', () => {
    const index = new FindIndex()
    index.sync([doc('a', 'n1', 'Fake agent, fake AGENT'), doc('b', 'n2', 'no match here'), doc('c', 'n3', 'the fake agent card', 'card')])
    const result = index.search('fake agent')
    expect(result.total).toBe(3)
    expect(result.matches.map((match) => [match.nodeId, match.offset])).toEqual([
      ['n1', 0],
      ['n1', 12],
      ['n3', 4],
    ])
    expect(result.matches[2]!.field).toBe('card')
  })

  it('finds nothing for a query shorter than two characters', () => {
    const index = new FindIndex()
    index.sync([doc('a', 'n1', 'aaaa')])
    expect(index.search('a').total).toBe(0)
    expect(index.search(' a ').total).toBe(0)
  })

  it('searches only the Nodes in scope', () => {
    const index = new FindIndex()
    index.sync([doc('a', 'n1', 'wave'), doc('b', 'n2', 'wave')])
    expect(index.search('wave', { scope: new Set(['n2']) }).matches.map((match) => match.nodeId)).toEqual(['n2'])
  })

  it('stops at the limit and says so', () => {
    const index = new FindIndex()
    index.sync([doc('a', 'n1', 'ab'.repeat(FIND_LIMIT + 5))])
    const result = index.search('ab')
    expect(result.total).toBe(FIND_LIMIT)
    expect(result.capped).toBe(true)
    expect(index.search('ab', { limit: 3 }).matches).toHaveLength(3)
  })

  it('after a search that hit the limit, a longer query looks at every document again', () => {
    const index = new FindIndex()
    // The limit is reached inside the first document; the second one is never looked at.
    index.sync([doc('a', 'n1', 'ab'.repeat(FIND_LIMIT + 5)), doc('b', 'n2', 'abc')])
    expect(index.search('ab').capped).toBe(true)
    expect(index.search('abc').matches.map((match) => match.key)).toEqual(['b'])
  })

  it('sees a changed, added or removed document on the next search, even when the query only grew', () => {
    const index = new FindIndex()
    index.sync([doc('a', 'n1', 'transcript one'), doc('b', 'n2', 'nothing')])
    expect(index.search('tra').total).toBe(1)
    // A document that did not match "tra" now matches "tran": the narrowing must not hide it.
    index.sync([doc('a', 'n1', 'transcript one'), doc('b', 'n2', 'transcript two')])
    expect(index.search('tran').total).toBe(2)
    index.sync([doc('b', 'n2', 'transcript two')])
    expect(index.search('trans').matches.map((match) => match.key)).toEqual(['b'])
  })

  it('narrows a growing query to the documents that matched, with the same answer as a full search', () => {
    const docs = [doc('a', 'n1', 'alpha beta'), doc('b', 'n2', 'alphabet'), doc('c', 'n3', 'gamma')]
    const narrowing = new FindIndex()
    narrowing.sync(docs)
    narrowing.search('al')
    narrowing.search('alp')
    const fresh = new FindIndex()
    fresh.sync(docs)
    expect(narrowing.search('alpha')).toEqual(fresh.search('alpha'))
    // A query that is not an extension searches everything again.
    expect(narrowing.search('gam').matches.map((match) => match.key)).toEqual(['c'])
  })

  it('changes its version only when a document changed', () => {
    const index = new FindIndex()
    const first = index.sync([doc('a', 'n1', 'x')])
    expect(index.sync([doc('a', 'n1', 'x')])).toBe(first)
    expect(index.sync([doc('a', 'n1', 'y')])).toBeGreaterThan(first)
    expect(index.text('a')).toBe('y')
    expect(index.size).toBe(1)
  })
})

describe('order of matches, the selection and stepping', () => {
  it('orders matches by the place of their Node, top to bottom, then left to right, and uses a fallback place', () => {
    const places: Record<string, { x: number; y: number }> = { low: { x: 0, y: 500 }, right: { x: 400, y: 0 }, left: { x: 0, y: 0 }, 'epic:e': { x: 0, y: 200 } }
    const matches = [
      { key: 'l', nodeId: 'low', field: 'node' as const, offset: 0 },
      { key: 'gone', nodeId: 'gone', field: 'node' as const, offset: 0 },
      { key: 't', nodeId: 'ticket:e/1', field: 'ticket' as const, offset: 0, fallbackId: 'epic:e' },
      { key: 'r', nodeId: 'right', field: 'node' as const, offset: 0 },
      { key: 'L2', nodeId: 'left', field: 'transcript' as const, offset: 9 },
      { key: 'L1', nodeId: 'left', field: 'node' as const, offset: 3 },
    ]
    expect(orderMatches(matches, (id) => places[id]).map((match) => match.key)).toEqual(['L1', 'L2', 'r', 't', 'l', 'gone'])
  })

  it('covers the selected Nodes and everything inside them; no selection is the whole Canvas', () => {
    const nodes = [{ id: 'frame' }, { id: 't1', parentId: 'frame' }, { id: 'inner', parentId: 't1' }, { id: 'other' }]
    expect(selectionScope([], nodes)).toBeUndefined()
    expect([...(selectionScope(['frame'], nodes) ?? [])].sort()).toEqual(['frame', 'inner', 't1'])
    expect([...(selectionScope(['other'], nodes) ?? [])]).toEqual(['other'])
  })

  it('steps forward and back around the matches', () => {
    expect(stepMatch(-1, 3)).toBe(0)
    expect(stepMatch(-1, 3, true)).toBe(2)
    expect(stepMatch(2, 3)).toBe(0)
    expect(stepMatch(0, 3, true)).toBe(2)
    expect(stepMatch(0, 0)).toBe(-1)
  })

  it('cuts a snippet around the match', () => {
    expect(snippet('a'.repeat(50) + 'MATCH' + 'b'.repeat(50), 50, 5, 4)).toBe('…aaaaMATCHbbbb…')
    expect(snippet('short MATCH', 6, 5)).toBe('short MATCH')
  })
})

describe('what the search reads', () => {
  it('takes the text of a transcript once, without counting a finished stream twice', () => {
    const events = [
      { type: 'notice', kind: 'user', text: 'first' },
      { type: 'delta', kind: 'text', text: 'Hello ' },
      { type: 'delta', kind: 'text', text: 'there' },
      { type: 'text', text: 'Hello there' },
      { type: 'tool_use', name: 'Bash' },
      { type: 'delta', kind: 'thinking', text: 'hmm' },
      { type: 'delta', kind: 'text', text: 'still typ' },
    ]
    expect(transcriptText(events)).toBe('first\nHello there\nstill typ')
    // Cached per array.
    expect(transcriptText(events)).toBe(transcriptText(events))
  })

  it('names a Node by its title, else the first line of its text', () => {
    expect(nodeTitle({ data: { title: ' Board ', text: 'x' } })).toBe('Board')
    expect(nodeTitle({ data: { text: '\n\n  first line \nsecond' } })).toBe('first line')
    expect(nodeTitle({ data: {} })).toBeNull()
  })

  it('builds documents from titles, Tickets, open transcripts, HANDOFF and Card text, skipping hidden Nodes', () => {
    const node = (id: string, kind: string, data: Record<string, unknown> = {}, hidden = false): FindNode => ({ id, kind, hidden, data })
    const docs = findDocs({
      nodes: [
        node('n1', 'note', { text: 'A note' }),
        node('n2', 'note', { text: 'hidden note' }, true),
        node('s1', 'session', { sessionId: 'sid-1' }),
        node('s2', 'session', { sessionId: 'sid-gone' }),
        node('h', 'handoff'),
        node('c1', 'card'),
        node('c2', 'card'),
        node('epic:e', 'epic-frame', { collapsed: true }),
      ],
      epics: [{ epic: 'e', title: 'Epic E' }],
      tickets: [{ epic: 'e', num: 7, title: 'Seven' }],
      transcripts: { 'sid-1': { events: [{ type: 'text', text: 'said this' }] } },
      handoff: '# HANDOFF',
      cards: { c1: 'card one text' },
    })
    expect(docs.map((each) => [each.key, each.nodeId, each.field, each.text])).toEqual([
      ['epic:e', 'epic:e', 'node', 'e Epic E'],
      ['ticket:e/7', 'ticket:e/7', 'ticket', 'e/07 Seven'],
      ['node:n1', 'n1', 'node', 'A note'],
      ['transcript:s1', 's1', 'transcript', 'said this'],
      ['handoff', 'h', 'handoff', '# HANDOFF'],
      ['card:c1', 'c1', 'card', 'card one text'],
    ])
    expect(docs[1]!.fallbackId).toBe('epic:e')
  })

  it('skips archived Nodes: their title, transcript and Card text are not searched (ADR-0076)', () => {
    const archived = { at: 1, rule: 'idle' as const, batch: 'b1' }
    const docs = findDocs({
      nodes: [
        { id: 'n1', kind: 'note', hidden: false, archived: null, data: { text: 'shown note' } },
        { id: 'n2', kind: 'note', hidden: false, archived, data: { text: 'archived note' } },
        { id: 's1', kind: 'session', hidden: false, archived, data: { title: 'Old session', sessionId: 'sid-1' } },
        { id: 'c1', kind: 'card', hidden: false, archived, data: { title: 'Old card' } },
      ],
      epics: [],
      tickets: [],
      transcripts: { 'sid-1': { events: [{ type: 'text', text: 'said this' }] } },
      handoff: undefined,
      cards: { c1: 'card one text' },
    })
    expect(docs.map((each) => each.key)).toEqual(['node:n1'])
  })
})

describe('speed on a Project the size of Auction', () => {
  it('answers each character of a typed query in at most 100 ms', () => {
    // 42 Epics, 682 Tickets, 300 Nodes with titles, 6 open transcripts of 5 000 events, HANDOFF of
    // 40 KB and 20 Cards of 20 KB each: about 12 MB of text.
    const words = ['wave', 'ticket', 'canvas', 'session', 'agent', 'review', 'merge', 'search', 'palette', 'binding', 'layout', 'gate']
    const sentence = (seed: number, length: number) => Array.from({ length }, (_, i) => words[(seed * 7 + i * 3) % words.length]).join(' ')
    const epics = Array.from({ length: 42 }, (_, i) => ({ epic: `epic-${i}`, title: sentence(i, 4) }))
    const tickets = Array.from({ length: 682 }, (_, i) => ({ epic: `epic-${i % 42}`, num: i, title: sentence(i, 8) }))
    const nodes: FindNode[] = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, kind: i < 6 ? 'session' : i < 26 ? 'card' : 'note', hidden: false, data: i < 6 ? { sessionId: `s${i}` } : { text: sentence(i, 10) } }))
    nodes.push({ id: 'h', kind: 'handoff', hidden: false, data: {} })
    const transcripts = Object.fromEntries(
      Array.from({ length: 6 }, (_, s) => [`s${s}`, { events: Array.from({ length: 5000 }, (_, e) => ({ type: 'text', text: sentence(s + e, 50) })) }]),
    )
    const cards = Object.fromEntries(Array.from({ length: 20 }, (_, c) => [`n${c + 6}`, sentence(c, 2500)]))
    const index = new FindIndex()
    index.sync(findDocs({ nodes, epics, tickets, transcripts, handoff: sentence(1, 5000), cards }))

    // One query with many matches (the search stops at the limit) and one with none (every
    // character scans all the text).
    const times: number[] = []
    for (const typed of ['palette review', 'quokka in the wave']) {
      for (let length = 1; length <= typed.length; length += 1) {
        const started = performance.now()
        index.search(typed.slice(0, length))
        times.push(performance.now() - started)
      }
    }
    const slowest = Math.max(...times)
    console.info(`search per character on an Auction-size Project: slowest ${slowest.toFixed(1)} ms, all ${times.map((t) => t.toFixed(1)).join(' ')}`)
    expect(slowest).toBeLessThanOrEqual(100)
  })
})
