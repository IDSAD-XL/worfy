// The Assistant's own notifications in the window (worfy-assistant ticket 14; spec, UI; owner's decision 17): one speech
// card at a time next to its rail icon, the rest as the number on the icon; nothing while it is off or while its section
// is in front of the user.
import { describe, expect, it } from 'vitest'
import type { AssistantView, WindowItem } from '../../src/shared/assistant/window'
import { assistantBadge, shownItemIds, speechQueue } from '../../src/renderer/assistant/speech'

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
