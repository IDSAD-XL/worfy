// The Assistant's section of the rail as main builds it (worfy-assistant ticket 14; spec, implementation decisions, UI;
// stories 1, 2, 16, 21–23, 35 and 38): what waits, with the reason, the source and the duty of each item; the proposals
// with Dismiss, Snooze, Open and Prepare; like and dislike that reach the duty (ticket 07); the journal with the item that
// caused each line; the summary; the conversation; the line of usage.
//
// The attention core and the duties are the real ones over a temporary data folder; the clock is the test's; the
// Assistant, the Session starter and the journal are fakes that record what they get. Nothing runs a model or a Session.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ActionJournalLine } from '../../src/shared/assistant/actions'
import type { AttentionEvent } from '../../src/shared/assistant/attention'
import type { LinkedMachineWaits } from '../../src/shared/assistant/linked'
import type { AssistantProposal } from '../../src/shared/assistant/proposals'
import { ASSISTANT_NOTE_TITLE, isUrgentItem, SUMMARY_HOURS, type AssistantView } from '../../src/shared/assistant/window'
import { AttentionCore } from '../../src/main/assistant/core/attention-core'
import { attentionFileStore, attentionPaths } from '../../src/main/assistant/core/store'
import { Duties } from '../../src/main/assistant/duties/duties'
import { assistantMemoryPath, memoryFileStore } from '../../src/main/assistant/duties/memory'
import { ProposalBook } from '../../src/main/assistant/proposals/book'
import { AssistantNotices } from '../../src/main/assistant/window/notices'
import { AssistantReveal, type RevealClient } from '../../src/main/assistant/window/reveal'
import { memoryWindowState } from '../../src/main/assistant/window/store'
import { ASSISTANT_OFF, AssistantWindow, ITEM_GONE, nextWorkHoursAfter, type AssistantRunLike } from '../../src/main/assistant/window/view'
import { removeTree } from '../../src/main/storage/remove'

const temp = mkdtempSync(join(tmpdir(), 'worfy-assistant-window-'))
afterAll(() => removeTree(temp))

const HOUR = 60 * 60_000
const MIN = 60_000
/** Tuesday 2026-11-24 10:00 UTC: inside work hours in UTC. */
const T0 = Date.parse('2026-11-24T10:00:00Z')
const WORK = { days: ['mon', 'tue', 'wed', 'thu', 'fri'] as const, windows: [{ from: 9 * 60, to: 18 * 60 }], timeZone: 'UTC' }
const SHOP = 'shop-api-1'
const MOBILE = 'mobile-app-2'
const DEMO = 'demo-project-3'

interface World {
  clock: { now: number }
  core: AttentionCore
  duties: Duties
  book: ProposalBook
  journal: ActionJournalLine[]
  started: { projectId: string; text: string }[]
  assistant: { said: string[]; answer: (text: string) => Promise<AssistantRunLike> | null } | null
  /** What the Linked machines last answered of what waits there (worfy-assistant ticket 18). */
  linked: LinkedMachineWaits[]
  window: AssistantWindow
}

let n = 0
function world(options: { demo?: boolean } = {}): World {
  const dir = join(temp, `w${++n}`)
  const clock = { now: T0 }
  const now = () => clock.now
  const projects: { id: string; name: string; localOnly?: true }[] = [
    { id: SHOP, name: 'shop-api' },
    { id: MOBILE, name: 'mobile-app' },
    // The Demo project of worfy-onboarding 11: this Machine's only, never seen by a Linked machine.
    ...(options.demo === true ? [{ id: DEMO, name: 'Demo project', localOnly: true as const }] : []),
  ]
  const duties = new Duties({ now, store: memoryFileStore(assistantMemoryPath(dir)), projects: () => projects.map((each) => each.id), projectRules: () => [] })
  const core = new AttentionCore({
    now,
    store: attentionFileStore(attentionPaths((id) => join(dir, id), dir)),
    projects: () => projects.map((each) => each.id),
    dutyOf: (event) => duties.dutyOf(event),
    settings: () => ({ timeZone: 'UTC' }),
  })
  let id = 0
  const book = new ProposalBook({ now, id: () => `proposal-${++id}` })
  const journal: ActionJournalLine[] = []
  const started: World['started'] = []
  const w: World = { clock, core, duties, book, journal, started, assistant: null, linked: [], window: undefined as unknown as AssistantWindow }
  w.window = new AssistantWindow({
    now,
    core: () => core,
    duties,
    projects: () => projects,
    proposals: book,
    journal: () => journal,
    usage: () => ({ today: 25_800, week: 244_600, shares: [{ window: 'five_hour', share: 0.011 }, { window: 'seven_day', share: 0.002 }] }),
    workHours: () => ({ ...WORK, days: [...WORK.days] }),
    store: memoryWindowState(),
    assistant: () => (w.assistant === null ? null : { userMessage: (text) => w.assistant!.answer(text) }),
    nodeOf: (projectId, sessionId) => (projectId === MOBILE && sessionId === 'sess-04' ? 'node-04' : null),
    start: (projectId, text) => {
      started.push({ projectId, text })
      return { nodeId: 'node-new', sessionId: 'sess-new' }
    },
    newId: () => `m${++id}`,
    linked: () => w.linked,
  })
  return w
}

const event = (over: Partial<AttentionEvent> & Pick<AttentionEvent, 'source' | 'id' | 'kind' | 'text' | 'subject'>): AttentionEvent => ({ revision: '1', projectId: SHOP, at: T0 - 30 * MIN, ...over })

const question = (): AttentionEvent =>
  event({ source: 'session', id: 'sess-04:question', projectId: MOBILE, subject: { kind: 'session', id: 'sess-04', label: 'checkout 04' }, kind: 'question', text: 'Asks: Use payments SDK v4 now?', at: T0 - 2 * HOUR })
const runStopped = (): AttentionEvent =>
  event({ source: 'autopilot', id: 'run-7:stopped', subject: { kind: 'run', id: 'run-7', label: 'Autopilot · invoice-export' }, kind: 'run-stopped', text: 'The Run of invoice-export stopped on a red gate', at: T0 - 6 * HOUR })
const ciRed = (): AttentionEvent =>
  event({
    source: 'ci',
    id: 'ci:acme/shop@main',
    subject: { kind: 'check', id: 'ci:acme/shop@main', label: 'CI of main · acme/shop' },
    kind: 'red',
    text: 'CI of main is red for 52 min',
    duty: 'main-ci-red',
    pr: { repo: 'acme/shop', number: 212, title: 'Bump date library' },
    at: T0 - 52 * MIN,
  })
const slack = (revision = '1'): AttentionEvent =>
  event({
    source: 'slack',
    id: 'C1/1',
    revision,
    subject: { kind: 'message', id: 'slack:C1/1', label: 'teammate A' },
    kind: 'message',
    text: 'Teammate A asks you to look at the rate-limit change before 15:00',
    message: { source: 'slack', id: 'C1/1', author: 'teammate A', at: '2026-11-24T09:02:00Z', url: 'https://acme.slack.com/archives/C1/p1', concernsUser: true, urgent: false, project: 'shop-api', ticket: null },
    at: T0 - 58 * MIN,
  })

/** The view once the coalesced change listeners ran. */
async function settled(w: World): Promise<AssistantView> {
  await Promise.resolve()
  return w.window.view()
}

const byTitle = (view: AssistantView, text: string) => view.items.find((item) => item.title === text)

describe('what waits', () => {
  let w: World
  beforeEach(() => {
    w = world()
    for (const each of [question(), runStopped(), ciRed(), slack()]) w.core.ingest(each)
  })

  it('lists every item a duty shows, over every Project, with its reason, source, Project and duty', () => {
    const view = w.window.view()
    expect(view.items.map((item) => item.title)).toContain('Asks: Use payments SDK v4 now?')
    const asks = byTitle(view, 'Asks: Use payments SDK v4 now?')!
    expect(asks).toMatchObject({ sourceLabel: 'Session', projectName: 'mobile-app', duty: { id: 'waits-for-user', title: 'Waits for you' }, urgent: false })
    const ci = byTitle(view, 'CI of main is red for 52 min')!
    expect(ci).toMatchObject({ sourceLabel: 'CI of the main branch', projectName: 'shop-api', duty: { id: 'main-ci-red', title: 'CI of the main branch is red' } })
    expect(view.projects).toBe(2)
  })

  it('puts the urgent first: a Run that stopped before the rest, newest after it', () => {
    const view = w.window.view()
    expect(view.items[0]?.title).toBe('The Run of invoice-export stopped on a red gate')
    expect(view.items[0]?.urgent).toBe(true)
    expect(view.items.slice(1).every((item) => !item.urgent)).toBe(true)
    const rest = view.items.slice(1).map((item) => item.lastAt)
    expect(rest).toEqual([...rest].sort((a, b) => b - a))
  })

  it('a Run the user stopped is not urgent, as the decision to wake reads it; another stop is (worfy-assistant ticket 23)', () => {
    w.core.ingest(event({ source: 'autopilot', id: 'run-8:stopped', subject: { kind: 'run', id: 'run-8', label: 'Autopilot · billing' }, kind: 'run-stopped', text: 'billing: stopped by the user (user-stop)', stopReason: 'user-stop', at: T0 - HOUR }))
    const view = w.window.view()
    expect(byTitle(view, 'billing: stopped by the user (user-stop)')?.urgent).toBe(false)
    expect(byTitle(view, 'The Run of invoice-export stopped on a red gate')?.urgent).toBe(true)
    // One rule on both sides: the window's urgency is the planner's for every stop reason.
    for (const stopReason of ['user-stop', 'user-force-stop', 'start-cancelled', 'discarded']) expect(isUrgentItem({ kind: 'run-stopped', stopReason })).toBe(false)
    for (const stopReason of ['main-red', 'turn-hung', 'some-later-reason', undefined]) expect(isUrgentItem({ kind: 'run-stopped', ...(stopReason === undefined ? {} : { stopReason }) })).toBe(true)
    expect(isUrgentItem({ kind: 'run-finished', stopReason: 'tickets-done' })).toBe(false)
  })

  it('marks the text of an outside source as data, with its author and link', () => {
    const item = byTitle(w.window.view(), 'Teammate A asks you to look at the rate-limit change before 15:00')!
    expect(item.outside).toEqual({ author: 'teammate A', at: '2026-11-24T09:02:00Z', url: 'https://acme.slack.com/archives/C1/p1' })
  })

  it('takes the reason and the exact text of Prepare from the Assistant\'s proposal for the item', () => {
    const asks = byTitle(w.window.view(), 'Asks: Use payments SDK v4 now?')!
    w.book.create({ title: 'Answer checkout 04', why: 'Tickets 05 and 06 of its Wave wait for the answer.', item: asks.id, prepare: { projectId: MOBILE, text: 'Decide the SDK version for checkout.' } })
    const after = byTitle(w.window.view(), 'Asks: Use payments SDK v4 now?')!
    expect(after.why).toBe('Tickets 05 and 06 of its Wave wait for the answer.')
    expect(after.prepare).toEqual({ projectId: MOBILE, projectName: 'mobile-app', text: 'Decide the SDK version for checkout.', by: 'assistant' })
    expect(after.proposalId).toBe('proposal-1')
  })

  it('names in Prepare the Project the Session starts in, not the Project of the item (review round 1)', () => {
    const ci = byTitle(w.window.view(), 'CI of main is red for 52 min')!
    w.book.create({ title: 'Fix it from mobile', why: 'The fix lives in the mobile app.', item: ci.id, prepare: { projectId: MOBILE, text: 'Pin the date library.' } })
    const after = byTitle(w.window.view(), 'CI of main is red for 52 min')!
    expect(after.projectName).toBe('shop-api')
    expect(after.prepare).toMatchObject({ projectId: MOBILE, projectName: 'mobile-app' })
  })

  it("offers worfy's own fix Session for a red main branch: the duty's text, in the item's Project", () => {
    const ci = byTitle(w.window.view(), 'CI of main is red for 52 min')!
    expect(ci.prepare?.by).toBe('worfy')
    expect(ci.prepare?.projectId).toBe(SHOP)
    expect(ci.prepare?.text).toContain('acme/shop')
  })

  it('opens each subject where it lives: the Session on its Node, the source page, the PR of the red branch', () => {
    const view = w.window.view()
    expect(byTitle(view, 'Asks: Use payments SDK v4 now?')!.open).toEqual({ kind: 'session', projectId: MOBILE, nodeId: 'node-04' })
    expect(byTitle(view, 'Teammate A asks you to look at the rate-limit change before 15:00')!.open).toEqual({ kind: 'url', url: 'https://acme.slack.com/archives/C1/p1' })
    expect(byTitle(view, 'CI of main is red for 52 min')!.open).toEqual({ kind: 'pr', projectId: SHOP, repo: 'acme/shop', number: 212 })
    expect(byTitle(view, 'The Run of invoice-export stopped on a red gate')!.open).toEqual({ kind: 'pipeline', projectId: SHOP })
  })
})

describe('Dismiss, Snooze, Open and Prepare', () => {
  let w: World
  let id: string
  beforeEach(() => {
    w = world()
    w.core.ingest(slack())
    w.core.ingest(question())
    id = byTitle(w.window.view(), 'Teammate A asks you to look at the rate-limit change before 15:00')!.id
  })

  it('Dismiss takes the item off the list, and its duty counts it declined', () => {
    w.assistant = { said: [], answer: () => null }
    w.window.item(id, 'dismiss')
    const view = w.window.view()
    expect(view.items.some((item) => item.id === id)).toBe(false)
    expect(w.duties.look([]).duties.find((duty) => duty.id === 'source:slack')?.counters.declined).toBe(1)
  })

  it('Open marks the item seen, and its duty counts it accepted', () => {
    w.assistant = { said: [], answer: () => null }
    w.window.item(id, 'open')
    expect(byTitle(w.window.view(), 'Teammate A asks you to look at the rate-limit change before 15:00')?.state).toBe('seen')
    expect(w.duties.look([]).duties.find((duty) => duty.id === 'source:slack')?.counters.accepted).toBe(1)
  })

  it('while the Assistant is off, Dismiss and Open count nothing at the duty (review round 2)', () => {
    w.window.item(id, 'open')
    w.window.item(id, 'dismiss')
    expect(w.duties.look([]).duties.find((duty) => duty.id === 'source:slack')?.counters).toMatchObject({ shown: 0, accepted: 0, declined: 0 })
    expect(w.window.view().items.some((item) => item.id === id)).toBe(false)
  })

  it('Snooze for an hour moves the item to Snoozed, and it waits again an hour later', () => {
    const until = w.window.snooze(id, 'hour')
    expect(until).toBe(T0 + HOUR)
    let view = w.window.view()
    expect(view.items.some((item) => item.id === id)).toBe(false)
    expect(view.snoozed.find((item) => item.id === id)?.snoozedUntil).toBe(T0 + HOUR)
    w.clock.now = T0 + HOUR - 1
    w.window.tick()
    expect(w.window.view().snoozed.map((item) => item.id)).toEqual([id])
    w.clock.now = T0 + HOUR
    w.window.tick()
    view = w.window.view()
    expect(view.snoozed).toEqual([])
    expect(view.items.find((item) => item.id === id)?.state).toBe('new')
  })

  it('Snooze until something changes wakes the item when a new event is glued into it', () => {
    expect(w.window.snooze(id, 'change')).toBeNull()
    w.clock.now = T0 + 3 * HOUR
    w.window.tick()
    expect(w.window.view().snoozed.map((item) => item.id)).toEqual([id])
    w.core.ingest({ ...slack('2'), text: 'Teammate A: the release moved to 16:00' })
    w.window.tick()
    expect(w.window.view().items.find((item) => item.id === id)?.state).toBe('new')
  })

  it('Snooze to the next work hours, from inside them, is the start of the next work day', () => {
    expect(w.window.snooze(id, 'next-work-hours')).toBe(Date.parse('2026-11-25T09:00:00Z'))
    expect(nextWorkHoursAfter(Date.parse('2026-11-27T19:00:00Z'), { ...WORK, days: [...WORK.days] })).toBe(Date.parse('2026-11-30T09:00:00Z'))
  })

  it('Wake now brings a snoozed item back at once', () => {
    w.window.snooze(id, 'three-hours')
    w.window.item(id, 'wake')
    expect(w.window.view().items.find((item) => item.id === id)?.state).toBe('new')
    expect(w.window.view().snoozed).toEqual([])
  })

  it('Start runs a new Session with exactly the text the user read, and only then', () => {
    w.assistant = { said: [], answer: () => null }
    const asks = byTitle(w.window.view(), 'Asks: Use payments SDK v4 now?')!
    w.book.create({ title: 'Answer checkout 04', why: 'It blocks the Wave.', item: asks.id, prepare: { projectId: MOBILE, text: 'Decide the SDK version.' } })
    expect(w.started).toEqual([])
    const result = w.window.start({ projectId: MOBILE, text: 'Decide the SDK version.\nKeep v3 for this release.', itemId: asks.id, proposalId: 'proposal-1' })
    expect(result).toEqual({ projectId: MOBILE, nodeId: 'node-new', sessionId: 'sess-new' })
    expect(w.started).toEqual([{ projectId: MOBILE, text: 'Decide the SDK version.\nKeep v3 for this release.' }])
    expect(w.book.list()).toEqual([])
    expect(w.duties.look([]).duties.find((duty) => duty.id === 'waits-for-user')?.counters.accepted).toBe(1)
  })

  it('refuses an item that is not there', () => {
    expect(() => w.window.item('nope', 'open')).toThrow(/no longer/i)
    expect(() => w.window.snooze('nope', 'hour')).toThrow(/no longer/i)
  })
})

describe('like and dislike', () => {
  let w: World
  let id: string
  beforeEach(() => {
    w = world()
    w.core.ingest(slack())
    id = w.window.view().items[0]!.id
  })

  const status = (duty: string) => w.duties.look([]).duties.find((each) => each.id === duty)!
  const counters = (duty: string) => status(duty).counters

  it('a like of an item reaches its duty once, and shows on the item', () => {
    w.window.rate({ kind: 'item', id }, 'like')
    w.window.rate({ kind: 'item', id }, 'like')
    expect(counters('source:slack').liked).toBe(1)
    expect(w.window.view().items[0]?.rating).toBe('like')
  })

  it('a dislike writes a rule of the duty: the item leaves the list and shows under hidden, with the rule', () => {
    const rule = w.window.rate({ kind: 'item', id }, 'dislike')
    expect(rule?.text).toMatch(/Slack/)
    expect(w.duties.rules().map((each) => each.id)).toEqual([rule!.id])
    expect(counters('source:slack').disliked).toBe(1)
    const view = w.window.view()
    expect(view.items).toEqual([])
    expect(view.hidden.map((each) => [each.item.id, each.rule.id])).toEqual([[id, rule!.id]])
  })

  it('taking a dislike back deletes its rule, and the item waits again', () => {
    w.window.rate({ kind: 'item', id }, 'dislike')
    expect(w.window.rate({ kind: 'item', id }, null)).toBeNull()
    expect(w.duties.rules()).toEqual([])
    expect(w.window.view().items.map((item) => [item.id, item.rating])).toEqual([[id, null]])
  })

  it('five rounds of dislike and Undo leave the duty as it was: no dislike counted, no run of dislikes, no pause (review round 1)', () => {
    for (let round = 0; round < 5; round++) {
      w.window.rate({ kind: 'item', id }, 'dislike')
      w.window.rate({ kind: 'item', id }, null)
    }
    expect(counters('source:slack').disliked).toBe(0)
    expect(status('source:slack').paused).toBeNull()
    expect(w.window.view().items.map((item) => item.id)).toEqual([id])
  })

  it('Undo of the dislike that paused its duty ends that pause', () => {
    w.duties.setPauseAfter(1)
    w.window.rate({ kind: 'item', id }, 'dislike')
    expect(status('source:slack').paused?.by).toBe('disliked')
    w.window.rate({ kind: 'item', id }, null)
    expect(status('source:slack').paused).toBeNull()
  })

  it('like, none, like counts one like; a like turned into a dislike counts the dislike alone', () => {
    w.window.rate({ kind: 'item', id }, 'like')
    w.window.rate({ kind: 'item', id }, null)
    w.window.rate({ kind: 'item', id }, 'like')
    expect(counters('source:slack').liked).toBe(1)
    w.window.rate({ kind: 'item', id }, 'dislike')
    expect(counters('source:slack')).toMatchObject({ liked: 0, disliked: 1 })
  })

  it('Undo of one dislike keeps the rule another dislike still holds: the item and a journal row of it (review round 2)', () => {
    w.journal.push({ at: T0 - 10 * MIN, action: 'continue-session', by: 'assistant', item: id, duty: 'source:slack', projectId: SHOP, itemKind: 'message', itemText: 'x', mode: 'self', sessionId: 'sess-01', outcome: 'done' })
    const row = w.window.view().journal[0]!.id
    const rule = w.window.rate({ kind: 'item', id }, 'dislike')!
    expect(w.window.rate({ kind: 'journal', id: row }, 'dislike')?.id).toBe(rule.id)
    w.window.rate({ kind: 'journal', id: row }, null)
    expect(w.duties.rules().map((each) => each.id)).toEqual([rule.id])
    expect(w.window.view().items).toEqual([])
    w.window.rate({ kind: 'item', id }, null)
    expect(w.duties.rules()).toEqual([])
  })

  it('Undo of a dislike from an earlier run leaves the current run and its pause alone (review round 2)', () => {
    const other = (n: number, kind: string): string => {
      w.core.ingest({ ...slack(), id: `C1/${n}`, kind, subject: { kind: 'message', id: `slack:C1/${n}`, label: 'teammate B' }, text: `Message ${n}` })
      return w.window.view().items.find((item) => item.title === `Message ${n}`)!.id
    }
    const b = other(2, 'mention')
    const c = other(3, 'thread')
    w.duties.setPauseAfter(2)
    w.window.rate({ kind: 'item', id }, 'dislike')
    w.duties.resume('source:slack')
    w.window.rate({ kind: 'item', id: b }, 'dislike')
    w.window.rate({ kind: 'item', id: c }, 'dislike')
    expect(status('source:slack').paused?.by).toBe('disliked')
    w.window.rate({ kind: 'item', id }, null)
    expect(status('source:slack').paused?.by).toBe('disliked')
    expect(counters('source:slack').disliked).toBe(2)
  })

  it('Show again deletes the rule by its id', () => {
    const rule = w.window.rate({ kind: 'item', id }, 'dislike')!
    w.window.forgetRule(rule.id)
    expect(w.window.view().items.map((item) => item.id)).toEqual([id])
  })

  it('a rating of a journal line reaches the duty of the item that caused it', () => {
    w.journal.push({ at: T0, action: 'continue-session', by: 'main', item: id, duty: 'source:slack', projectId: SHOP, itemKind: 'message', itemText: 'x', mode: 'self', sessionId: 's', outcome: 'done' })
    const line = w.window.view().journal[0]!
    w.window.rate({ kind: 'journal', id: line.id }, 'like')
    expect(counters('source:slack').liked).toBe(1)
    expect(w.window.view().journal[0]?.rating).toBe('like')
  })

  it('a rating of a message, a proposal or the summary is kept and shown', () => {
    w.window.noteAssistantMessage('batch', 'Two things wait for you in shop-api.')
    const message = w.window.view().conversation[0]!
    w.window.rate({ kind: 'message', id: message.id }, 'dislike')
    const summary = w.window.view().summary
    w.window.rate({ kind: 'summary', id: summary.id }, 'like')
    const proposal = w.book.create({ title: 'Look at PR #87', why: 'Teammate B asked.', item: null, prepare: null })
    w.window.rate({ kind: 'proposal', id: proposal.id }, 'like')
    const view = w.window.view()
    expect(view.conversation[0]?.rating).toBe('dislike')
    expect(view.summary.rating).toBe('like')
    expect(view.proposals[0]?.rating).toBe('like')
  })

  it('refuses a rating of a message that is not there', () => {
    expect(() => w.window.rate({ kind: 'journal', id: 'nope' }, 'like')).toThrow(/no longer/i)
  })
})

describe('what counts as shown (review round 1)', () => {
  let w: World
  let id: string
  beforeEach(() => {
    w = world()
    w.core.ingest(slack())
    id = w.window.view().items[0]!.id
  })

  const status = (duty: string) => w.duties.look([]).duties.find((each) => each.id === duty)!

  it('the view counts nothing: a day of looks by the background loop leaves the duty with nothing shown, ignored or paused', () => {
    w.window.view()
    w.clock.now += 25 * HOUR
    w.window.tick()
    w.window.view()
    expect(status('source:slack').counters).toMatchObject({ shown: 0, ignored: 0 })
    expect(status('source:slack').paused).toBeNull()
  })

  it('an item the window reports shown counts once, and only while the Assistant is on', () => {
    w.window.shown([id])
    expect(status('source:slack').counters.shown).toBe(0)
    w.assistant = { said: [], answer: () => null }
    w.window.shown([id])
    w.window.shown([id])
    expect(status('source:slack').counters.shown).toBe(1)
  })

  it('an item shown and left alone for a day counts as ignored on a later look', () => {
    w.assistant = { said: [], answer: () => null }
    w.window.shown([id])
    w.clock.now += 25 * HOUR
    w.window.view()
    expect(status('source:slack').counters).toMatchObject({ shown: 1, ignored: 1 })
  })
})

describe('the journal', () => {
  it('names who did each action and the item that caused it, newest first', () => {
    const w = world()
    w.core.ingest(question())
    const item = w.window.view().items[0]!
    const line = (at: number, by: ActionJournalLine['by'], outcome: ActionJournalLine['outcome'], action = 'continue-session'): ActionJournalLine => ({
      at,
      action,
      by,
      item: item.id,
      duty: 'waits-for-user',
      projectId: MOBILE,
      itemKind: 'question',
      itemText: 'Asks: Use payments SDK v4 now?',
      mode: 'self',
      sessionId: 'sess-04',
      outcome,
      ...(outcome === 'refused' ? { reason: 'busy' as const } : {}),
    })
    w.journal.push(line(T0 - 2 * HOUR, 'main', 'done', 'wake-orchestrator'), line(T0 - HOUR, 'assistant', 'refused'), line(T0 - 30 * MIN, 'main', 'escalated'))
    const rows = w.window.view().journal
    expect(rows.map((row) => row.by)).toEqual(['worfy', 'assistant', 'worfy'])
    expect(rows[2]?.text).toMatch(/Woke the Orchestrator/)
    expect(rows[1]?.text).toMatch(/busy/i)
    expect(rows[0]?.text).toMatch(/Assistant/)
    expect(rows.every((row) => row.cause.itemId === item.id && row.cause.text === 'Asks: Use payments SDK v4 now?' && row.cause.open)).toBe(true)
    w.window.item(item.id, 'dismiss')
    expect(w.window.view().journal[0]?.cause.open).toBe(false)
  })
})

describe('the summary and the usage', () => {
  it('counts the night over every Project without the model, and names what to take first', () => {
    const w = world()
    for (const each of [question(), runStopped(), ciRed(), slack()]) w.core.ingest(each)
    w.journal.push({ at: T0 - HOUR, action: 'continue-session', by: 'main', item: 'x', duty: null, projectId: SHOP, itemKind: null, itemText: null, mode: 'self', sessionId: 's', outcome: 'done' })
    const summary = w.window.view().summary
    expect(summary.since).toBe(T0 - SUMMARY_HOURS * HOUR)
    expect(summary).toMatchObject({ came: 4, done: 1, stopped: 1, waiting: 4 })
    expect(summary.projects.map((each) => [each.name, each.came, each.urgent])).toEqual([
      ['shop-api', 3, 1],
      ['mobile-app', 1, 0],
    ])
    expect(summary.first[0]).toBe(w.window.view().items[0]?.id)
    expect(summary.first).toHaveLength(3)
    expect(summary.morning).toBeNull()
    w.window.noteAssistantMessage('morning', 'Good morning. Two things stopped overnight.')
    expect(w.window.view().summary.morning?.text).toBe('Good morning. Two things stopped overnight.')
  })

  it("shows the Assistant's tokens and its share of the Limits as an estimate", () => {
    const usage = world().window.view().usage
    expect(usage).toEqual({ today: 25_800, week: 244_600, fiveHour: 1.1, sevenDay: 0.2, estimate: true })
  })
})

describe('the conversation', () => {
  it('is refused while the Assistant is off', () => {
    const w = world()
    expect(w.window.view().on).toBe(false)
    expect(() => w.window.send('hello')).toThrow(ASSISTANT_OFF)
    expect(w.window.view().conversation).toEqual([])
  })

  it('keeps the user message, waits for the answer, and shows it', async () => {
    const w = world()
    let answer: (run: AssistantRunLike) => void = () => undefined
    w.assistant = { said: [], answer: (text) => (w.assistant!.said.push(text), new Promise((done) => (answer = done))) }
    expect(w.window.view().on).toBe(true)
    w.window.send('Why did the Orchestrator stop?')
    expect(w.assistant.said).toEqual(['Why did the Orchestrator stop?'])
    expect(w.window.view().conversation.map((message) => [message.who, message.state])).toEqual([
      ['you', 'done'],
      ['assistant', 'pending'],
    ])
    answer({ outcome: 'answered', text: 'The Limits stopped its Subagents at 00:41.' })
    await new Promise((done) => setTimeout(done, 0))
    expect(w.window.view().conversation[1]).toMatchObject({ who: 'assistant', state: 'done', text: 'The Limits stopped its Subagents at 00:41.', reason: 'user' })
  })

  it('says so when the Assistant did not answer', async () => {
    const w = world()
    w.assistant = { said: [], answer: () => Promise.resolve({ outcome: 'failed', text: null }) }
    w.window.send('hello')
    await new Promise((done) => setTimeout(done, 0))
    expect(w.window.view().conversation[1]).toMatchObject({ state: 'failed' })
  })
})

describe("the texts of the Assistant's wakes (worfy-assistant ticket 14)", () => {
  it('the text of a morning or a batch wake joins the conversation; the morning one is the summary', () => {
    const w = world()
    w.window.noteWakeRun({ reason: 'morning', outcome: 'answered', text: 'Good morning. One Run stopped overnight.' })
    w.window.noteWakeRun({ reason: 'batch', outcome: 'answered', text: 'Two things wait in shop-api.' })
    const view = w.window.view()
    expect(view.conversation.map((message) => [message.reason, message.text])).toEqual([
      ['morning', 'Good morning. One Run stopped overnight.'],
      ['batch', 'Two things wait in shop-api.'],
    ])
    expect(view.summary.morning?.text).toBe('Good morning. One Run stopped overnight.')
  })

  it('a run that did not answer posts no message, nor one with no text', () => {
    const w = world()
    w.window.noteWakeRun({ reason: 'urgent', outcome: 'failed', text: null })
    w.window.noteWakeRun({ reason: 'batch', outcome: 'timed-out', text: 'half a thought' })
    w.window.noteWakeRun({ reason: 'batch', outcome: 'answered', text: '  ' })
    expect(w.window.view().conversation).toEqual([])
  })

  it("the run of the user's message is not posted again: the conversation shows its answer already", () => {
    const w = world()
    w.window.noteWakeRun({ reason: 'user', outcome: 'answered', text: 'Two Sessions wait for you.' })
    expect(w.window.view().conversation).toEqual([])
  })
})

describe('changes', () => {
  it('tells its listeners once after each change of its own, of the core and of the proposals', async () => {
    const w = world()
    let told = 0
    const stop = w.window.watch()
    w.window.subscribe(() => (told += 1))
    w.core.ingest(slack())
    await settled(w)
    expect(told).toBe(1)
    w.book.create({ title: 'x', why: 'y', item: null, prepare: null })
    w.window.rate({ kind: 'summary', id: w.window.view().summary.id }, 'like')
    await settled(w)
    expect(told).toBe(2)
    stop()
  })
})

describe('the system notifications of the Assistant', () => {
  const view = (over: Partial<AssistantView['items'][number]>[], on = true, workHours = true): AssistantView => {
    const w = world()
    const base = w.window.view()
    return {
      ...base,
      on,
      workHours,
      items: over.map((each, index) => ({
        id: `i${index}`,
        title: `Item ${index}`,
        why: null,
        source: 'autopilot',
        sourceLabel: 'Autopilot',
        subject: { kind: 'run', id: `r${index}`, label: 'Run' },
        kind: 'run-stopped',
        projectId: SHOP,
        projectName: 'shop-api',
        duty: { id: 'work-stalled', title: 'Work stands' },
        urgent: true,
        state: 'new',
        startedAt: T0,
        lastAt: T0,
        outside: null,
        proposalId: null,
        prepare: null,
        open: null,
        rating: null,
        ...each,
      })),
    }
  }

  const notices = (focused: boolean) => {
    const shown: { title: string; body: string }[] = []
    const opened: string[] = []
    const notes = new AssistantNotices({ focused: () => focused, show: (note, onClick) => (shown.push(note), onClick()), reveal: () => opened.push('assistant') })
    return { shown, opened, notes }
  }

  it('tells of an urgent item once, titled worfy Assistant, while worfy is not in front; a click opens the section', () => {
    const { shown, opened, notes } = notices(false)
    notes.look(view([{}, { urgent: false, id: 'calm' }]))
    notes.look(view([{}]))
    expect(shown).toEqual([{ title: ASSISTANT_NOTE_TITLE, body: 'shop-api: Item 0' }])
    expect(opened).toEqual(['assistant'])
  })

  it('stays silent while worfy is in front, outside work hours, and while the Assistant is off', () => {
    for (const [focused, on, hours] of [
      [true, true, true],
      [false, true, false],
      [false, false, true],
    ] as const) {
      const { shown, notes } = notices(focused)
      notes.look(view([{}], on, hours))
      expect(shown).toEqual([])
    }
  })

  it('tells of an urgent item that came at night once the work hours begin', () => {
    const { shown, notes } = notices(false)
    notes.look(view([{}], true, false))
    notes.look(view([{}], true, true))
    expect(shown).toHaveLength(1)
  })
})

describe('the proposals of no item', () => {
  it('lists a proposal the user asked for, with Prepare, and Dismiss removes it', () => {
    const w = world()
    const made: AssistantProposal = w.book.create({ title: 'Prepare a check of #87', why: 'You asked in the conversation.', item: null, prepare: { projectId: MOBILE, text: '/worfy:code-review mobile-app#87' } })
    expect(w.window.view().proposals).toEqual([{ id: made.id, title: 'Prepare a check of #87', why: 'You asked in the conversation.', prepare: { projectId: MOBILE, projectName: 'mobile-app', text: '/worfy:code-review mobile-app#87', by: 'assistant' }, createdAt: T0, rating: null }])
    w.window.dismissProposal(made.id)
    expect(w.window.view().proposals).toEqual([])
  })
})

describe('the reveal of a clicked notification (review round 1)', () => {
  const client = (): RevealClient & { got: number; gone: boolean } => {
    const each = { got: 0, gone: false, isDestroyed: () => each.gone }
    return each
  }

  it('goes to the windows that follow the section, and nothing waits for a later window', () => {
    const reveal = new AssistantReveal()
    const a = client()
    reveal.follow(a)
    reveal.request((target) => (target as typeof a).got++)
    expect(a.got).toBe(1)
    expect(reveal.take()).toBe(false)
  })

  it('waits for the first window that opens the section when none follows it, and only for that one', () => {
    const reveal = new AssistantReveal()
    const gone = client()
    reveal.follow(gone)
    gone.gone = true
    reveal.request(() => {
      throw new Error('no window follows the section')
    })
    expect(reveal.take()).toBe(true)
    expect(reveal.take()).toBe(false)
  })

  it('a window that stopped following gets nothing', () => {
    const reveal = new AssistantReveal()
    const a = client()
    const stop = reveal.follow(a)
    stop()
    reveal.request((target) => (target as typeof a).got++)
    expect(a.got).toBe(0)
    expect(reveal.take()).toBe(true)
  })
})

// worfy-assistant ticket 18 (spec, two machines; boundary 5): the Assistant of each Machine keeps the items of its own
// Projects; what waits on the Linked machine is shown beside them, read-only.
describe('two machines (worfy-assistant ticket 18)', () => {
  let w: World
  beforeEach(() => {
    w = world()
    for (const each of [question(), runStopped(), slack()]) w.core.ingest(each)
  })

  const pcItem = {
    id: 'pc-core-id-1',
    title: 'Asks: Deploy the docs now?',
    source: 'session',
    sourceLabel: 'Session',
    subject: { kind: 'session', label: 'docs 02' },
    kind: 'question',
    projectId: 'docs-site-9',
    projectName: 'docs-site',
    duty: 'Waits for you',
    urgent: false,
    startedAt: T0 - HOUR,
    lastAt: T0 - HOUR,
    outside: null,
  }

  it('answers a Linked machine with this Machine\'s Projects and what waits in them, without anything to act with', () => {
    const answer = w.window.waiting()
    expect(answer.projects).toEqual([
      { id: SHOP, name: 'shop-api' },
      { id: MOBILE, name: 'mobile-app' },
    ])
    const titles = w.window.view().items.map((item) => item.title)
    expect(answer.items.map((item) => item.title)).toEqual(titles)
    const asks = answer.items.find((item) => item.title === 'Asks: Use payments SDK v4 now?')!
    expect(asks).toEqual({
      id: expect.any(String),
      title: 'Asks: Use payments SDK v4 now?',
      source: 'session',
      sourceLabel: 'Session',
      subject: { kind: 'session', label: 'checkout 04' },
      kind: 'question',
      projectId: MOBILE,
      projectName: 'mobile-app',
      duty: 'Waits for you',
      urgent: false,
      startedAt: T0 - 2 * HOUR,
      lastAt: T0 - 2 * HOUR,
      outside: null,
    })
    // No prepared text, no proposal, no target to open and no rating: the Linked machine only reads.
    for (const each of answer.items) for (const key of ['prepare', 'proposalId', 'open', 'rating', 'why']) expect(each, key).not.toHaveProperty(key)
    expect(answer.items.find((item) => item.source === 'slack')!.outside).toMatchObject({ author: 'teammate A' })
  })

  it('never hands the Linked machine what it read from another one', () => {
    w.linked = [{ id: 'pc', name: 'PC', online: true, projects: [{ id: 'docs-site-9', name: 'docs-site' }], items: [pcItem], problem: null }]
    expect(w.window.waiting().items.map((item) => item.id)).not.toContain('pc-core-id-1')
  })

  it('shows what waits on the Linked machine beside its own items, read-only, and counts only its own', () => {
    w.linked = [
      { id: 'pc', name: 'PC', online: true, projects: [{ id: 'docs-site-9', name: 'docs-site' }], items: [pcItem], problem: null },
      { id: 'mini', name: 'Mac mini', online: false, projects: [], items: [], problem: 'Mac mini is offline' },
    ]
    const view = w.window.view()
    expect(view.linked).toEqual(w.linked)
    // The own list, the summary and the count are this Machine's alone.
    expect(view.items.map((item) => item.title)).not.toContain(pcItem.title)
    expect(view.summary.waiting).toBe(view.items.length)
    expect(view.projects).toBe(2)
  })

  it('refuses Dismiss, Snooze, like and Start on an item of the Linked machine: only its own Assistant keeps it', () => {
    w.linked = [{ id: 'pc', name: 'PC', online: true, projects: [{ id: 'docs-site-9', name: 'docs-site' }], items: [pcItem], problem: null }]
    expect(() => w.window.item(pcItem.id, 'dismiss')).toThrow(ITEM_GONE)
    expect(() => w.window.snooze(pcItem.id, 'hour')).toThrow(ITEM_GONE)
    expect(() => w.window.start({ projectId: 'docs-site-9', text: 'Deploy the docs', itemId: null, proposalId: null })).toThrow()
    expect(w.started).toEqual([])
  })

  it('never hands the Linked machine a Project local to this Machine, its items, or an item of no Project (review round 1)', () => {
    const d = world({ demo: true })
    for (const each of [question(), slack()]) d.core.ingest(each)
    d.core.ingest(event({ source: 'session', id: 'demo-1:question', projectId: DEMO, subject: { kind: 'session', id: 'demo-1', label: 'demo 01' }, kind: 'question', text: 'Asks: Try the Demo?' }))
    d.core.ingest(event({ source: 'limits', id: 'limits:five_hour', projectId: null, subject: { kind: 'limit', id: 'five_hour', label: '5-hour window' }, kind: 'high', text: 'The 5-hour window is 85% used' }))
    // This Machine's own section shows both.
    const own = d.window.view().items.map((item) => item.projectId)
    expect(own).toContain(DEMO)
    expect(own).toContain(null)
    const answer = d.window.waiting()
    expect(answer.projects.map((project) => project.id)).toEqual([SHOP, MOBILE])
    expect(answer.items.map((item) => item.projectId).sort()).toEqual([MOBILE, SHOP])
  })

  it('an urgent item of the Linked machine is not urgent here: no notification, nothing urgent in the summary (rebase on ticket 23)', () => {
    const quiet = world()
    quiet.linked = [{ id: 'pc', name: 'PC', online: true, projects: [{ id: 'docs-site-9', name: 'docs-site' }], items: [{ ...pcItem, urgent: true, kind: 'run-stopped' }], problem: null }]
    const view = quiet.window.view()
    expect(view.items).toEqual([])
    expect(view.summary.projects.reduce((sum, each) => sum + each.urgent, 0)).toBe(0)
    const shown: unknown[] = []
    const notes = new AssistantNotices({ focused: () => false, show: (note) => void shown.push(note), reveal: () => undefined })
    notes.look(view)
    expect(shown).toEqual([])
  })

  it('without Linked machines the list of them is empty', () => {
    expect(w.window.view().linked).toEqual([])
  })
})
