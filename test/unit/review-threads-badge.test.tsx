// The review threads badge on a Ticket Node (src/renderer/canvas/badges/ReviewThreads.tsx and review-threads.ts,
// worfy-pr-inbox ticket 06):
// «N open threads» — unresolved threads whose last word is not the user's — and «changes requested», from the
// Project's PR inbox snapshot (`prInbox.get`); a Ticket over several repositories sums its PRs, a PR is found by its
// (repo, N) and, before it has a number in the Ticket, by (repo, branch); a click opens the Pull requests view on that
// PR. A Ticket whose PR the snapshot does not hold looks as before, and its card keeps its height (ticket-card.ts).
// Every owner, login and text is invented; nothing here reaches main or GitHub.
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { PrInboxGroup, PrInboxRow, PrInboxSnapshot, PrInboxThread } from '../../src/shared/ipc/pr-inbox'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const calls = vi.hoisted(() => ({ views: [] as string[] }))

vi.mock('../../src/renderer/session/navigation', () => ({
  setView: (view: string) => calls.views.push(view),
}))

const ROOT = '/projects/shop'
const PROJECT = 'shop-00000001'
const ME = 'dev-me'
const PEER = 'dev-peer'
const WEB = 'example-org/web'
const API = 'example-org/api'

const ticket = (num: number, over: Partial<Ticket> = {}): Ticket => ({
  epic: 'shop',
  num,
  slug: `t${num}`,
  title: `${String(num).padStart(2, '0')} — Ticket ${num}`,
  statusRaw: 'work',
  state: 'work',
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
  ...over,
})

let commentId = 0
/** A thread whose comments are by `authors`, oldest first. */
const thread = (authors: (string | null)[], isResolved = false): PrInboxThread => ({
  id: `T${++commentId}`,
  isResolved,
  isOutdated: false,
  path: 'src/a.ts',
  line: 3,
  viewerCanReply: true,
  comments: authors.map((author) => ({ id: `C${++commentId}`, databaseId: commentId, author, body: 'a question', createdAt: '2026-11-09T10:00:00Z', url: 'https://github.com/x' })),
})

const row = (repo: string, number: number, over: Partial<PrInboxRow> = {}): PrInboxRow => ({
  repo,
  number,
  title: `PR ${number}`,
  url: `https://github.com/${repo}/pull/${number}`,
  isDraft: false,
  author: ME,
  headRefName: `feature/${number}`,
  headRefOid: `sha${number}`,
  createdAt: '2026-11-08T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
  ci: 'passing',
  reviewDecision: null,
  mergeStateStatus: 'CLEAN',
  viaTeam: false,
  unresolvedThreads: (over.threads ?? []).filter((each) => !each.isResolved).length,
  newSinceSeen: 0,
  lastActivityAt: '2026-11-09T10:00:00Z',
  threads: [],
  comments: [],
  ...over,
})

const snapshotOf = (rows: Partial<Record<PrInboxGroup, PrInboxRow[]>>, enabled = true): PrInboxSnapshot => ({
  projectId: PROJECT,
  enabled,
  viewer: ME,
  groups: (['needs-review', 'needs-answer', 'needs-fix', 'ready', 'waiting'] as const).map((group) => ({ group, rows: rows[group] ?? [] })),
  readAt: '2026-11-09T10:00:00Z',
  nextSearchAt: '2026-11-09T10:05:00Z',
  error: null,
  notice: null,
})

/** Three threads that wait for the user, one resolved, one where the user had the last word, one with no comment. */
const WAITING = [thread([PEER]), thread([PEER, ME, PEER]), thread([null]), thread([PEER], true), thread([PEER, ME]), thread([])]

let inbox: PrInboxSnapshot
let tickets: Ticket[]
let invoked: string[]
/** The window's subscriptions to main's events, so a test can send one. */
let handlers: { channel: string; handler: (payload: unknown) => void }[]
const emit = (channel: string, payload: unknown) => {
  for (const each of handlers) if (each.channel === channel) each.handler(payload)
}

beforeEach(() => {
  vi.resetModules()
  calls.views.length = 0
  invoked = []
  handlers = []
  tickets = [ticket(7, { pr: 118 }), ticket(8), ticket(9)]
  inbox = snapshotOf({ 'needs-answer': [row(WEB, 118, { threads: WAITING })], 'needs-fix': [], waiting: [row(WEB, 40)] })
  const bridge = {
    invoke: (channel: string) => {
      invoked.push(channel)
      if (channel === 'prInbox.get') return Promise.resolve({ ok: true, value: inbox })
      if (channel === 'projects.list') return Promise.resolve({ ok: true, value: { projects: [{ id: PROJECT, name: 'shop', path: ROOT }], activeId: PROJECT, revision: 1 } })
      if (channel === 'workflow.open') return Promise.resolve({ ok: true, value: { root: ROOT, epics: [], tickets, error: null, branchErrors: [] } satisfies WorkflowModel })
      return Promise.resolve({ ok: false, error: `no ${channel} in this test` })
    },
    on: (channel: string, handler: (payload: unknown) => void) => handlers.push({ channel, handler }),
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function load() {
  const badge = await import('../../src/renderer/canvas/badges/ReviewThreads')
  const counts = await import('../../src/renderer/canvas/badges/review-threads')
  const { usePrInboxFocus } = await import('../../src/renderer/pr-inbox/usePrInbox')
  return { ...badge, ...counts, usePrInboxFocus }
}

const subject = (num: number) => ({ kind: 'ticket' as const, projectId: PROJECT, root: ROOT, ticket: tickets.find((each) => each.num === num)! })

/** Lets the answers of prInbox.get and workflow.open arrive. */
const settle = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
})

describe('ReviewThreads on a Ticket', () => {
  it('a PR with three threads waiting for the user and CHANGES_REQUESTED: «3 open threads» and «changes requested»', async () => {
    inbox = snapshotOf({ 'needs-fix': [row(WEB, 118, { threads: WAITING, reviewDecision: 'CHANGES_REQUESTED' })] })
    const { default: ReviewThreads } = await load()
    render(<ReviewThreads subject={subject(7)} />)
    const badge = await screen.findByTestId('badge-review-threads')
    expect(screen.getByTestId('review-threads-count').textContent).toBe('3 open threads')
    expect(screen.getByTestId('review-threads-count').dataset.value).toBe('3')
    expect(screen.getByTestId('review-threads-changes').textContent).toBe('changes requested')
    expect(badge.getAttribute('title')).toBe(`${WEB}#118: 3 open threads, changes requested\nOpen in Pull requests`)
    expect(badge.className).toContain('nodrag')
  })

  it('only changes requested: one chip; one thread: «1 open thread»', async () => {
    inbox = snapshotOf({ 'needs-fix': [row(WEB, 118, { reviewDecision: 'CHANGES_REQUESTED' })] })
    const { default: ReviewThreads } = await load()
    const { unmount } = render(<ReviewThreads subject={subject(7)} />)
    await screen.findByTestId('badge-review-threads')
    expect(screen.queryByTestId('review-threads-count')).toBeNull()
    expect(screen.getByTestId('review-threads-changes').textContent).toBe('changes requested')
    unmount()
    inbox = snapshotOf({ 'needs-answer': [row(WEB, 118, { threads: [thread([PEER])] })] })
    const fresh = await load()
    render(<fresh.default subject={subject(7)} />)
    expect((await screen.findByTestId('review-threads-count')).textContent).toBe('1 open thread')
  })

  it('a PR with no thread waiting and no changes requested: no badge', async () => {
    inbox = snapshotOf({ waiting: [row(WEB, 118, { threads: [thread([PEER], true), thread([PEER, ME])], reviewDecision: 'APPROVED' })] })
    const { default: ReviewThreads } = await load()
    const { container } = render(<ReviewThreads subject={subject(7)} />)
    await settle()
    expect(invoked).toContain('prInbox.get')
    expect(container.innerHTML).toBe('')
  })

  it('a Ticket without a PR in the snapshot, an Epic and a Session: nothing', async () => {
    const { default: ReviewThreads } = await load()
    const { container } = render(
      <>
        <ReviewThreads subject={subject(8)} />
        <ReviewThreads subject={{ kind: 'session', projectId: PROJECT, root: ROOT, sessionId: 's' }} />
        <ReviewThreads subject={{ kind: 'epic', projectId: PROJECT, root: ROOT, epic: { epic: 'shop', hasSpec: true, hasMap: false, title: 'Shop' }, tickets }} />
      </>,
    )
    await settle()
    expect(container.innerHTML).toBe('')
  })

  it('the inbox switched off: nothing, though the snapshot still names the PR', async () => {
    inbox = snapshotOf({ 'needs-answer': [row(WEB, 118, { threads: WAITING })] }, false)
    const { default: ReviewThreads } = await load()
    const { container } = render(<ReviewThreads subject={subject(7)} />)
    await settle()
    expect(container.innerHTML).toBe('')
  })

  it('a Ticket over two repositories: the threads of both PRs summed; the PR without a number in the Ticket found by (repo, branch)', async () => {
    tickets = [ticket(12, { repos: ['web', 'api'], prs: [{ repo: 'web', number: 41 }], branch: 'shop/12-export' }), ticket(13)]
    inbox = snapshotOf({
      'needs-answer': [row(WEB, 41, { threads: [thread([PEER]), thread([PEER])] }), row(API, 7, { headRefName: 'shop/12-export', threads: [thread([PEER])] })],
      // The same number in another repository, on another branch, is not the Ticket's.
      waiting: [row(API, 41, { threads: [thread([PEER])] })],
    })
    const { default: ReviewThreads } = await load()
    render(<ReviewThreads subject={subject(12)} />)
    const badge = await screen.findByTestId('badge-review-threads')
    expect(screen.getByTestId('review-threads-count').textContent).toBe('3 open threads')
    expect(badge.getAttribute('title')).toBe(`${WEB}#41: 2 open threads\n${API}#7: 1 open thread\nOpen in Pull requests`)
  })

  it('a click opens the Pull requests view on the first PR that waits, and nothing else is asked of main', async () => {
    tickets = [ticket(12, { repos: ['web', 'api'], prs: [{ repo: 'web', number: 41 }], branch: 'shop/12-export' })]
    inbox = snapshotOf({ 'needs-answer': [row(API, 7, { headRefName: 'shop/12-export', threads: [thread([PEER])] })], waiting: [row(WEB, 41)] })
    const { default: ReviewThreads, usePrInboxFocus } = await load()
    render(<ReviewThreads subject={subject(12)} />)
    const badge = await screen.findByTestId('badge-review-threads')
    expect([badge.dataset.repo, badge.dataset.number]).toEqual([API, '7'])
    fireEvent.click(badge)
    await settle()
    expect(calls.views).toEqual(['pull-requests'])
    expect(usePrInboxFocus.getState().focus).toMatchObject({ projectId: PROJECT, pr: { repo: API, number: 7 }, group: null })
    // Read-only: the badge asked main for the snapshot and the model, never for a write.
    expect([...new Set(invoked)].sort()).toEqual(['prInbox.get', 'workflow.open'])
  })
})

describe('the room of the badge on the card (ticket-card.ts)', () => {
  it('reviewChipsOf names the Tickets that draw it with their number of chips; one without a PR in the snapshot draws none', async () => {
    const { reviewChipsOf } = await load()
    tickets = [ticket(7, { pr: 118 }), ticket(8, { pr: 40 }), ticket(9)]
    const both = snapshotOf({ 'needs-fix': [row(WEB, 118, { threads: WAITING, reviewDecision: 'CHANGES_REQUESTED' })], waiting: [row(WEB, 40)] })
    expect(reviewChipsOf(both, tickets)).toEqual({ 'shop/7': 2 })
    expect(reviewChipsOf(snapshotOf({ 'needs-answer': [row(WEB, 118, { threads: WAITING })] }), tickets)).toEqual({ 'shop/7': 1 })
    expect(reviewChipsOf(snapshotOf({}), tickets)).toEqual({})
    expect(reviewChipsOf(undefined, tickets)).toEqual({})
    expect(reviewChipsOf(snapshotOf({ 'needs-fix': [row(WEB, 118, { threads: WAITING })] }, false), tickets)).toEqual({})
  })

  it('each chip and its wrapper are 16 px, the line REVIEW_LINE gives it (jsdom lays nothing out: the sheet is read)', () => {
    const sheet = readFileSync(join(import.meta.dirname, '../../src/renderer/canvas/badges/review-threads.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
    const body = (selector: string) => {
      const at = sheet.indexOf(`${selector} {`)
      expect(at, selector).toBeGreaterThanOrEqual(0)
      return sheet.slice(at, sheet.indexOf('}', at))
    }
    // A wrapper that is a block takes the card's 17 px line around its 16 px chip: 2 px over for two chips.
    expect(body('.w-review-threads > *')).toMatch(/display\s*:\s*inline-flex/u)
    expect(body('.w-review-threads .w-chip')).toMatch(/height\s*:\s*16px/u)
    expect(body('.w-review-threads')).toMatch(/gap\s*:\s*2px/u)
  })

  it('a card gets a line per chip; a card the inbox does not name is as tall as before', async () => {
    const { cardHeights, epicColumns } = await import('../../src/renderer/canvas/epic-layout')
    const { REVIEW_LINE } = await import('../../src/renderer/canvas/ticket-card')
    const layoutTickets = [ticket(7, { pr: 118 }), ticket(8)]
    const columns = epicColumns(layoutTickets)
    const before = cardHeights(layoutTickets, columns)
    const after = cardHeights(layoutTickets, columns, { reviewChips: { 'shop/7': 2 } })
    expect(REVIEW_LINE).toBe(18)
    expect(after.get(7)).toBe(before.get(7)! + 2 * REVIEW_LINE)
    expect(after.get(8)).toBe(before.get(8))
    // Keyed by the Epic too: the same number in another Epic gets no room.
    expect(cardHeights(layoutTickets, columns, { reviewChips: { 'other/7': 2 } }).get(7)).toBe(before.get(7))
  })
})

describe('the Epic node source lays the card out with the badge’s room (sources/epics.ts)', () => {
  it('a Ticket whose PR waits gets a line per chip once the inbox answers; the others keep their height', async () => {
    tickets = [ticket(7, { pr: 118 }), ticket(8)]
    inbox = snapshotOf({ 'needs-fix': [row(WEB, 118, { threads: WAITING, reviewDecision: 'CHANGES_REQUESTED' })] })
    const { default: source } = await import('../../src/renderer/canvas/sources/epics')
    const { cardHeights, epicColumns } = await import('../../src/renderer/canvas/epic-layout')
    const { REVIEW_LINE } = await import('../../src/renderer/canvas/ticket-card')
    const wrapper = ({ children }: { children: ReactNode }) => <ReactFlowProvider>{children}</ReactFlowProvider>
    const { result } = renderHook(() => source.useNodes({ projectId: PROJECT, layout: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } } } as Parameters<typeof source.useNodes>[0]), { wrapper })
    const heightOf = (num: number) => result.current.find((node) => node.type === 'ticket' && node.id.endsWith(`/${num}`))?.height
    const plain = cardHeights(tickets, epicColumns(tickets))
    await vi.waitFor(() => expect(heightOf(7)).toBe(plain.get(7)! + 2 * REVIEW_LINE))
    expect(heightOf(8)).toBe(plain.get(8))
  })
})

describe('whose answer a thread waits for: main\u2019s rule (src/main/github/inbox-groups.ts, owesAnswer)', () => {
  it('on someone else\u2019s PR only the threads the user wrote in count; on the user\u2019s own PR every unresolved one whose last word is not theirs', async () => {
    const { waitingThreads } = await load()
    const threads = [thread([PEER]), thread([PEER, 'Dev-Me', PEER]), thread([PEER, ME]), thread([ME, PEER], true), thread([])]
    expect(waitingThreads({ author: PEER, threads }, ME)).toBe(1)
    expect(waitingThreads({ author: 'DEV-ME', threads }, ME)).toBe(2)
    expect(waitingThreads({ author: null, threads }, ME)).toBe(1)
  })

  it('without a viewer — before the first search — no thread waits for the user', async () => {
    const { waitingThreads, reviewChipsOf } = await load()
    expect(waitingThreads({ author: ME, threads: WAITING }, null)).toBe(0)
    tickets = [ticket(7, { pr: 118 })]
    expect(reviewChipsOf({ ...snapshotOf({ 'needs-answer': [row(WEB, 118, { threads: WAITING })] }), viewer: null }, tickets)).toEqual({})
  })

  it('a review asked of the user on someone else\u2019s PR: the threads of others alone wait for nobody, the badge says nothing of them', async () => {
    inbox = snapshotOf({ 'needs-review': [row(WEB, 118, { author: PEER, threads: [thread([PEER]), thread(['dev-other', PEER])] })] })
    const { default: ReviewThreads } = await load()
    const { container } = render(<ReviewThreads subject={subject(7)} />)
    await settle()
    expect(invoked).toContain('prInbox.get')
    expect(container.innerHTML).toBe('')
  })
})

describe('the work is bounded: rows \u00d7 Tickets, once per snapshot and model', () => {
  /** 950 Tickets, each counting how often whose-PR-is-it reads its `PR:` lines (repoFactsOf reads `prs` once a call). */
  const counted = (count: number) => {
    const reads = { n: 0 }
    const list = Array.from({ length: count }, (_, index) => {
      const each = ticket(index + 1, { pr: index + 1 })
      const prs = [{ repo: null, number: index + 1 }]
      Object.defineProperty(each, 'prs', {
        get: () => {
          reads.n += 1
          return prs
        },
        enumerable: true,
      })
      return each
    })
    return { reads, list }
  }

  it('reviewChipsOf, answersOf and every badge over one snapshot and model match each row once against the Tickets', async () => {
    const { reviewChipsOf, reviewsOfTicket } = await load()
    const { answersOf } = await import('../../src/renderer/pipeline/board')
    const { reads, list } = counted(950)
    const rows = Array.from({ length: 30 }, (_, index) => row(WEB, 900 + index, { threads: [thread([PEER])] }))
    const snapshot = snapshotOf({ 'needs-answer': rows })
    const model: WorkflowModel = { root: ROOT, epics: [], tickets: list, error: null, branchErrors: [] }
    const chips = reviewChipsOf(snapshot, list)
    expect(Object.keys(chips)).toHaveLength(30)
    // At most one look at each Ticket per row (the PR: lines; the branch reads no PR: line): 30 × 950, not 950 × 30 × 950.
    expect(reads.n).toBeLessThanOrEqual(30 * 950)
    const once = reads.n
    // The same snapshot and model again — a render, the board, every Ticket Node's badge: no new matching.
    expect(reviewChipsOf(snapshot, list)).toEqual(chips)
    expect(Object.keys(answersOf(snapshot, model))).toHaveLength(30)
    for (const each of list) reviewsOfTicket(snapshot, each, list)
    expect(reads.n).toBe(once)
    // A new snapshot is matched again, once.
    reviewChipsOf({ ...snapshot }, list)
    expect(reads.n).toBe(2 * once)
  })
})

describe('a new snapshot that changes no badge (sources/epics.ts)', () => {
  it('keeps the Ticket Nodes, the same objects, and asks ELK for no new layout; one that changes a badge lays the Epic out again', async () => {
    tickets = [ticket(7, { pr: 118 }), ticket(8)]
    inbox = snapshotOf({ 'needs-answer': [row(WEB, 118, { threads: [thread([PEER])] })] })
    const { default: source } = await import('../../src/renderer/canvas/sources/epics')
    const { setElkEngine } = await import('../../src/renderer/canvas/elk/client')
    const graphs: unknown[] = []
    // An ELK that never answers: the requests are counted, the Canvas keeps its own layout meanwhile.
    setElkEngine({ layout: (graph) => (graphs.push(graph), new Promise(() => undefined)) })
    try {
      const wrapper = ({ children }: { children: ReactNode }) => <ReactFlowProvider>{children}</ReactFlowProvider>
      // One Layout for every render, as the Canvas keeps it while it does not change.
      const context = { projectId: PROJECT, layout: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } } } as Parameters<typeof source.useNodes>[0]
      const { result } = renderHook(() => source.useNodes(context), { wrapper })
      const ticketNodes = () => result.current.filter((node) => node.type === 'ticket')
      const { REVIEW_LINE } = await import('../../src/renderer/canvas/ticket-card')
      const { cardHeights, epicColumns } = await import('../../src/renderer/canvas/epic-layout')
      await waitFor(() => expect(ticketNodes().find((node) => node.id.endsWith('/7'))?.height).toBe(cardHeights(tickets, epicColumns(tickets)).get(7)! + REVIEW_LINE))
      await settle()
      const nodes = result.current
      const before = ticketNodes()
      const asked = graphs.length
      const gets = invoked.filter((channel) => channel === 'prInbox.get').length

      // Main read again: new times, a new comment, the same badges.
      inbox = { ...snapshotOf({ 'needs-answer': [row(WEB, 118, { updatedAt: '2026-11-10T08:00:00Z', threads: [thread([PEER, ME, PEER])] })] }), readAt: '2026-11-10T08:00:00Z' }
      act(() => emit('prInbox.changed', { projectId: PROJECT }))
      await waitFor(() => expect(invoked.filter((channel) => channel === 'prInbox.get').length).toBe(gets + 1))
      await settle()
      expect(result.current).toBe(nodes)
      expect(ticketNodes()).toEqual(before)
      ticketNodes().forEach((node, index) => expect(node).toBe(before[index]))
      expect(graphs.length).toBe(asked)

      // A snapshot that adds a chip: a new layout is asked for.
      inbox = snapshotOf({ 'needs-fix': [row(WEB, 118, { threads: [thread([PEER])], reviewDecision: 'CHANGES_REQUESTED' })] })
      act(() => emit('prInbox.changed', { projectId: PROJECT }))
      await waitFor(() => expect(graphs.length).toBeGreaterThan(asked))
    } finally {
      setElkEngine(null)
    }
  })
})
