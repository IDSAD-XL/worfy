// The Assistant's own notifications in the window (worfy-assistant ticket 14; spec, UI; owner's decision 17): one speech
// card at a time next to its rail icon, the rest as the number on the icon; nothing while it is off or while its section
// is in front of the user. Close closes the card as a whole (worfy-polish 161): what it told of stays off it, and a
// backlog before the first Close is one line.
import { describe, expect, it } from 'vitest'
import type { AssistantView, WindowItem } from '../../src/shared/assistant/window'
import { assistantBadge, shownItemIds, speechCard, speechQueue, stillClosed } from '../../src/renderer/assistant/speech'

const item = (id: string, over: Partial<WindowItem> = {}): WindowItem => ({
  id,
  title: `Item ${id}`,
  why: null,
  source: 'session',
  sourceLabel: 'Session',
  subject: { kind: 'session', id: `s-${id}`, label: id },
  kind: 'question',
  projectId: 'p',
  projectName: 'shop-api',
  duty: { id: 'waits-for-user', title: 'Waits for you' },
  urgent: false,
  state: 'new',
  startedAt: 0,
  lastAt: 0,
  outside: null,
  proposalId: null,
  prepare: null,
  open: null,
  rating: null,
  ...over,
})

const view = (items: WindowItem[], on = true): AssistantView => ({
  on,
  projects: 1,
  items,
  snoozed: [],
  hidden: [],
  proposals: [],
  journal: [],
  conversation: [],
  summary: { id: 'd', since: 0, came: 0, done: 0, stopped: 0, waiting: 0, projects: [], first: [], morning: null, rating: null },
  usage: { today: 0, week: 0, fiveHour: null, sevenDay: null, estimate: true },
  workHours: true,
  linked: [],
  offer: { owed: false, notice: false },
})

describe('the speech cards of the Assistant', () => {
  const items = [item('a', { urgent: true }), item('b'), item('c', { state: 'seen' }), item('d')]

  it('tell of what came and was not seen, in the order of the list, one at a time', () => {
    expect(speechQueue(view(items), new Set(), false).map((each) => each.id)).toEqual(['a', 'b', 'd'])
  })

  it('skip the cards the user closed: the item stays in the list', () => {
    expect(speechQueue(view(items), new Set(['a']), false).map((each) => each.id)).toEqual(['b', 'd'])
  })

  it('say nothing while the Assistant is off or its section is shown', () => {
    expect(speechQueue(view(items, false), new Set(), false)).toEqual([])
    expect(speechQueue(view(items), new Set(), true)).toEqual([])
  })

  it('«Urgent only» tells of the urgent items alone; «None: the list only» of nothing, and the icon still counts what waits (ticket 25)', () => {
    const v = view(items)
    expect(speechQueue(v, new Set(), false, 'batched').map((each) => each.id)).toEqual(['a', 'b', 'd'])
    expect(speechQueue(v, new Set(), false, 'urgent').map((each) => each.id)).toEqual(['a'])
    expect(speechQueue(v, new Set(), false, 'none')).toEqual([])
    expect(assistantBadge(v, speechQueue(v, new Set(), false, 'none'))).toMatchObject({ tone: 'assistant', count: 4, label: '4 items wait for you' })
  })

  it('leave the rest to the number on the icon; without a card the icon counts what waits', () => {
    const v = view(items)
    expect(assistantBadge(v, speechQueue(v, new Set(), false))).toMatchObject({ tone: 'assistant', count: 2, label: '2 more from Assistant' })
    expect(assistantBadge(v, [])).toMatchObject({ tone: 'assistant', count: 4, label: '4 items wait for you' })
    expect(assistantBadge(view([item('a')]), [item('a')])).toBeUndefined()
    expect(assistantBadge(view(items, false), [])).toBeUndefined()
    expect(assistantBadge(view([]), [])).toBeUndefined()
  })
})

describe('what the window reports as shown to the user (review round 1)', () => {
  const items = [item('a'), item('b', { state: 'seen' })]

  it('nothing while the section is out of sight and no card speaks', () => {
    expect(shownItemIds(view(items), false, 'waits', [])).toEqual([])
  })

  it('the item of the speech card', () => {
    expect(shownItemIds(view(items), false, 'waits', [items[0]!])).toEqual(['a'])
  })

  it('every item of the list while the section is in front on its list of what waits, and none on another tab', () => {
    expect(shownItemIds(view(items), true, 'waits', [])).toEqual(['a', 'b'])
    expect(shownItemIds(view(items), true, 'journal', [])).toEqual([])
  })

  it('nothing while the Assistant is off', () => {
    expect(shownItemIds(view(items, false), true, 'waits', [items[0]!])).toEqual([])
  })
})

describe('the card closes as a whole (worfy-polish 161)', () => {
  const many = Array.from({ length: 56 }, (_, i) => item(`i${i + 1}`))
  const backlog = (items: WindowItem[]): AssistantView => ({ ...view(items), cardBacklog: true })

  it('tells nothing of the items it already told of; they stay in the list and on the icon', () => {
    const v = view([...many.map((each) => ({ ...each, cardSeen: true })), item('fresh')])
    const queue = speechQueue(v, new Set(), false)
    expect(queue.map((each) => each.id)).toEqual(['fresh'])
    expect(speechCard(v, queue)).toMatchObject({ kind: 'item', item: { id: 'fresh' }, more: 0 })
    const closed = view(many.map((each) => ({ ...each, cardSeen: true })))
    expect(speechCard(closed, speechQueue(closed, new Set(), false))).toBeNull()
    expect(assistantBadge(closed, speechQueue(closed, new Set(), false))).toMatchObject({ count: 56, label: '56 items wait for you' })
  })

  it('before the first Close sums a backlog up in one line, never its oldest item, and counts none of it as shown', () => {
    const v = backlog(many)
    const queue = speechQueue(v, new Set(), false)
    expect(speechCard(v, queue)).toEqual({ kind: 'backlog', count: 56 })
    expect(shownItemIds(v, false, 'waits', queue)).toEqual([])
    expect(assistantBadge(v, queue)).toMatchObject({ count: 56, label: '56 items wait for you' })
    // A single item is no backlog: the card tells of it.
    expect(speechCard(backlog([item('one')]), [item('one')])).toMatchObject({ kind: 'item', item: { id: 'one' } })
  })

  it("keeps an item off the card after a click only until main's view does the same", () => {
    const v = view([item('a'), item('b', { cardSeen: true }), item('c', { state: 'snoozed' })])
    expect(stillClosed(['a', 'b', 'c', 'gone'], v)).toEqual(['a'])
    expect(stillClosed(['a'], null)).toEqual(['a'])
  })
})
