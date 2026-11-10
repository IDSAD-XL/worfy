// The Pull requests view and its entries (worfy-pr-inbox ticket 03), over snapshots of `prInbox.get` in the shape
// main sends them (src/shared/ipc/pr-inbox.ts):
// - the view (src/renderer/pr-inbox/PrInboxView.tsx): the five groups in the spec's order, a row with every field,
//   "via team"; the status line — the next search, why the last read failed, the snapshot's notice; a row opens to
//   its threads and tells main the PR was seen (`prInbox.markSeen`), and "N new since you looked" goes;
// - openPrInboxOf with a PR: the view opens that row, or says the PR is not in the inbox; another Project is
//   selected first;
// - the sidebar section (src/renderer/shell/sidebar/PullRequestsSection.tsx): the counts of the groups, a click
//   opens the view on that group;
// - the toolbar tab, the palette command, and the switch of Project settings.
// main is a fake preload bridge; every fixture is invented — owners, repositories, logins and texts. Nothing
// here reaches GitHub, and the view sends nothing but `prInbox.get` and `prInbox.markSeen` (ADR-0105).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { PrInboxRow, PrInboxSnapshot } from '../../src/shared/ipc/pr-inbox'
import type { ProjectsState } from '../../src/shared/ipc/projects'
import type { AppSettings } from '../../src/shared/settings/app-settings'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const NOW = Date.parse('2026-11-10T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const ago = (ms: number): string => new Date(NOW - ms).toISOString()

const WEB = 'example-org/web'
const API = 'example-org/api'
const ME = 'dev-me'
const ANA = 'dev-ana'
const BO = 'dev-bo'

const comment = (id: string, author: string | null, at: string, body: string) => ({ id, databaseId: 1, author, body, createdAt: at, url: `https://github.com/${API}/pull/118#discussion_${id}` })

const row = (repo: string, number: number, over: Partial<PrInboxRow> = {}): PrInboxRow => ({
  repo,
  number,
  title: `Change ${number}`,
  url: `https://github.com/${repo}/pull/${number}`,
  isDraft: false,
  author: ME,
  headRefName: `feature/${number}`,
  headRefOid: `sha${number}`,
  createdAt: ago(3 * DAY),
  updatedAt: ago(2 * HOUR),
  ci: 'passing',
  reviewDecision: null,
  mergeStateStatus: 'CLEAN',
  viaTeam: false,
  unresolvedThreads: 0,
  newSinceSeen: 0,
  lastActivityAt: ago(2 * HOUR),
  threads: [],
  comments: [],
  ...over,
})

/** A review request through a team, my PR owing two answers with three new comments, one to fix, one ready, one draft waiting. */
const ROWS = {
  review: row(WEB, 41, { title: 'Add the export button', author: ANA, viaTeam: true, ci: 'running', reviewDecision: 'REVIEW_REQUIRED', createdAt: ago(3 * DAY), lastActivityAt: ago(5 * MIN) }),
  answer: row(API, 118, {
    title: 'Retry the upload',
    headRefName: 'demo/07',
    unresolvedThreads: 2,
    newSinceSeen: 3,
    lastActivityAt: ago(2 * HOUR),
    threads: [
      { id: 'T3', isResolved: true, isOutdated: false, path: 'src/old.ts', line: 1, viewerCanReply: true, comments: [comment('C31', ANA, ago(DAY), 'fine now')] },
      { id: 'T1', isResolved: false, isOutdated: false, path: 'src/upload.ts', line: 12, viewerCanReply: true, comments: [comment('C11', ANA, ago(3 * HOUR), 'Why three tries?'), comment('C12', ME, ago(150 * MIN), 'The server drops one'), comment('C13', ANA, ago(2 * HOUR), 'Then say so in a comment')] },
      { id: 'T2', isResolved: false, isOutdated: true, path: 'src/retry.ts', line: null, viewerCanReply: true, comments: [comment('C21', BO, ago(2 * HOUR), 'Rename the helper')] },
    ],
    comments: [comment('C91', null, ago(DAY), 'Looks close')],
  }),
  fix: row(WEB, 40, { title: 'Fix the date picker', ci: 'failing', reviewDecision: 'CHANGES_REQUESTED', lastActivityAt: ago(DAY) }),
  ready: row(API, 120, { title: 'Bump the parser', reviewDecision: 'APPROVED', lastActivityAt: ago(30 * MIN) }),
  waiting: row(WEB, 39, { title: 'Sketch the settings page', isDraft: true, ci: null, lastActivityAt: ago(5 * DAY) }),
}

const snapshotOf = (projectId: string, over: Partial<PrInboxSnapshot> = {}): PrInboxSnapshot => ({
  projectId,
  enabled: true,
  viewer: ME,
  // Out of order on purpose: the view keeps the spec's order whatever main sends.
  groups: [
    { group: 'waiting', rows: [ROWS.waiting] },
    { group: 'ready', rows: [ROWS.ready] },
    { group: 'needs-review', rows: [ROWS.review] },
    { group: 'needs-fix', rows: [ROWS.fix] },
    { group: 'needs-answer', rows: [ROWS.answer] },
  ],
  readAt: ago(MIN),
  nextSearchAt: new Date(NOW + 4 * MIN).toISOString(),
  error: null,
  notice: null,
  ...over,
})

const modelTicket = (epic: string, num: number, title: string, over: Partial<Ticket> = {}): Ticket => ({
  epic,
  num,
  slug: `t-${num}`,
  title: `${String(num).padStart(2, '0')} — ${title}`,
  statusRaw: 'open',
  state: 'open',
  blockedRaw: '—',
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: false,
  fromBranch: null,
  ...over,
})

/** demo 07 by its branch `demo/07`, demo 03 by its `PR:` line naming web#40. */
const TICKETS: Ticket[] = [modelTicket('demo', 7, 'Upload retries'), modelTicket('demo', 3, 'Date picker', { prs: [{ repo: WEB, number: 40 }] })]

const WEB_ROOT = '/projects/web'
const OPS_ROOT = '/projects/ops'
const PROJECTS: ProjectsState = {
  projects: [
    { id: 'web-00000001', name: 'web', path: WEB_ROOT, branch: 'main' },
    { id: 'ops-00000002', name: 'ops', path: OPS_ROOT, branch: 'main' },
  ],
  activeId: 'web-00000001',
  revision: 1,
}

const appSettings = (): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  revision: 0,
})

interface FakeMain {
  calls: { channel: string; input: unknown }[]
  emit: (channel: string, payload: unknown) => void
  inbox: Record<string, PrInboxSnapshot>
}

let main: FakeMain

/** This Machine's preload over the answers of main. `markSeen` answers the snapshot with that PR's new count at zero. */
function preload(options: { inbox: Record<string, PrInboxSnapshot>; models?: Record<string, WorkflowModel>; answers?: Record<string, (input: unknown) => IpcResult<unknown>> }): void {
  const handlers = new Map<number, { channel: string; handler: (payload: unknown) => void }>()
  let projects = PROJECTS
  let next = 0
  const fake: FakeMain = {
    calls: [],
    inbox: options.inbox,
    emit: (channel, payload) => {
      for (const each of handlers.values()) if (each.channel === channel) each.handler(payload)
    },
  }
  const answer = (channel: string, input: unknown): IpcResult<unknown> => {
    const own = options.answers?.[channel]
    if (own !== undefined) return own(input)
    switch (channel) {
      case 'projects.list':
        return { ok: true, value: projects }
      case 'projects.select':
        projects = { ...projects, activeId: (input as { id: string }).id, revision: projects.revision + 1 }
        return { ok: true, value: projects }
      case 'appSettings.get':
        return { ok: true, value: appSettings() }
      case 'workflow.open': {
        const root = (input as { root: string }).root
        return { ok: true, value: options.models?.[root] ?? { root, epics: [], tickets: [], error: null, branchErrors: [] } }
      }
      case 'prInbox.get': {
        const snapshot = fake.inbox[(input as { projectId: string }).projectId]
        return snapshot ? { ok: true, value: snapshot } : { ok: false, error: 'not a Project of this Machine' }
      }
      case 'prInbox.markSeen': {
        const { projectId, repo, number } = input as { projectId: string; repo: string; number: number }
        const snapshot = fake.inbox[projectId]!
        fake.inbox[projectId] = { ...snapshot, groups: snapshot.groups.map((group) => ({ ...group, rows: group.rows.map((each) => (each.repo === repo && each.number === number ? { ...each, newSinceSeen: 0 } : each)) })) }
        return { ok: true, value: fake.inbox[projectId] }
      }
      default:
        return { ok: true, value: { closed: true } }
    }
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      fake.calls.push({ channel, input })
      return Promise.resolve(answer(channel, input) as never)
    },
    on: (channel, handler) => {
      next += 1
      handlers.set(next, { channel, handler: handler as (payload: unknown) => void })
      return next
    },
    off: (id) => {
      handlers.delete(id)
    },
  }
  main = fake
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

const WEB_MODEL: WorkflowModel = { root: WEB_ROOT, epics: [], tickets: TICKETS, error: null, branchErrors: [] }

beforeEach(() => {
  // The stores of the inbox, the Projects and the navigation live in modules: every test starts with fresh ones.
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const groupTitles = (): string[] => screen.getAllByTestId('pr-inbox-group').map((group) => within(group).getByTestId('pr-inbox-group-title').textContent ?? '')
const rowOf = (repo: string, number: number): HTMLElement => {
  const found = screen.getAllByTestId('pr-inbox-row').find((each) => each.dataset.repo === repo && each.dataset.number === String(number))
  if (!found) throw new Error(`no row ${repo}#${number}`)
  return found
}
const text = (scope: HTMLElement, testId: string): string | null => within(scope).queryByTestId(testId)?.textContent ?? null
/** Only reads and markSeen went to main: nothing else of the view could reach GitHub. */
const channels = (): string[] => [...new Set(main.calls.map((call) => call.channel))]

async function body(snapshot: PrInboxSnapshot, tickets: Ticket[] = TICKETS) {
  const { PrInboxBody } = await import('../../src/renderer/pr-inbox/PrInboxView')
  render(
    <PrInboxBody name="web" snapshot={snapshot} tickets={tickets} now={NOW} expanded={new Set()} focusedGroup={null} missing={null} failure={null} readOnly={null} onToggle={() => undefined} onMarkSeen={() => undefined} />,
  )
}

describe('the view of a snapshot', () => {
  it('shows the five groups in the order of the spec, whatever order main sent them in', async () => {
    await body(snapshotOf('web-00000001'))
    expect(groupTitles()).toEqual(['Needs my review', 'Needs my answer', 'Needs a fix', 'Ready', 'Waiting on others'])
    expect(screen.getAllByTestId('pr-inbox-group').map((group) => group.dataset.group)).toEqual(['needs-review', 'needs-answer', 'needs-fix', 'ready', 'waiting'])
    expect(screen.getAllByTestId('pr-inbox-group-count').map((count) => count.textContent)).toEqual(['1', '1', '1', '1', '1'])
    // Each row under its own group.
    expect(screen.getAllByTestId('pr-inbox-row').map((each) => `${each.closest<HTMLElement>('[data-testid="pr-inbox-group"]')!.dataset.group} ${each.dataset.repo}#${each.dataset.number}`)).toEqual([
      `needs-review ${WEB}#41`,
      `needs-answer ${API}#118`,
      `needs-fix ${WEB}#40`,
      `ready ${API}#120`,
      `waiting ${WEB}#39`,
    ])
  })

  it('keeps the order of the rows inside a group as main sorted them', async () => {
    const older = row(WEB, 7, { title: 'Older', author: ANA, createdAt: ago(9 * DAY) })
    await body(snapshotOf('web-00000001', { groups: [{ group: 'needs-review', rows: [older, ROWS.review] }] }))
    const review = screen.getAllByTestId('pr-inbox-group')[0]!
    expect(within(review).getAllByTestId('pr-inbox-title').map((title) => title.textContent)).toEqual(['Older', 'Add the export button'])
    // The groups main left out are there, empty.
    expect(screen.getAllByTestId('pr-inbox-group-count').map((count) => count.textContent)).toEqual(['2', '0', '0', '0', '0'])
  })

  it('a row has its title, repo#N, Ticket chip, CI dot, review decision, open threads, new comments and age', async () => {
    await body(snapshotOf('web-00000001'))
    const answer = rowOf(API, 118)
    expect(text(answer, 'pr-inbox-title')).toBe('Retry the upload')
    // A title cut with an ellipsis is whole in its tooltip.
    expect(within(answer).getByTestId('pr-inbox-title').getAttribute('title')).toBe('Retry the upload')
    expect(text(answer, 'pr-inbox-ref')).toBe(`${API}#118`)
    // The Ticket by its branch demo/07.
    expect(text(answer, 'pr-inbox-ticket')).toBe('demo 07')
    expect(within(answer).getByTestId('pr-inbox-ci').getAttribute('data-ci')).toBe('passing')
    expect(within(answer).getByRole('img', { name: 'CI passing' })).toBeTruthy()
    expect(text(answer, 'pr-inbox-threads')).toBe('2 open threads')
    expect(text(answer, 'pr-inbox-new')).toBe('3 new since you looked')
    // The age of the last activity.
    expect(text(answer, 'pr-inbox-age')).toBe('2h')
    expect(text(answer, 'pr-inbox-review')).toBeNull()
    expect(text(answer, 'pr-inbox-via-team')).toBeNull()

    const fix = rowOf(WEB, 40)
    // The Ticket whose PR: line names web#40.
    expect(text(fix, 'pr-inbox-ticket')).toBe('demo 03')
    expect(text(fix, 'pr-inbox-review')).toBe('Changes requested')
    expect(within(fix).getByTestId('pr-inbox-review').querySelector('[data-status]')?.getAttribute('data-status')).toBe('blocked')
    expect(within(fix).getByTestId('pr-inbox-ci').getAttribute('data-ci')).toBe('failing')
    expect(text(fix, 'pr-inbox-threads')).toBeNull()
    expect(text(fix, 'pr-inbox-new')).toBeNull()
    expect(text(fix, 'pr-inbox-age')).toBe('1d')

    const ready = rowOf(API, 120)
    expect(text(ready, 'pr-inbox-review')).toBe('Approved')
    expect(within(ready).getByTestId('pr-inbox-review').querySelector('[data-status]')?.getAttribute('data-status')).toBe('ready')
    expect(text(ready, 'pr-inbox-ticket')).toBeNull()
    expect(text(ready, 'pr-inbox-age')).toBe('30m')

    const waiting = rowOf(WEB, 39)
    expect(within(waiting).getByText('Draft')).toBeTruthy()
    expect(within(waiting).getByTestId('pr-inbox-ci').getAttribute('data-ci')).toBe('none')
    expect(within(waiting).getByRole('img', { name: 'No CI' })).toBeTruthy()
    expect(text(waiting, 'pr-inbox-age')).toBe('5d')
  })

  it('a review asked through a team says "via team", and its age is the age of the PR', async () => {
    await body(snapshotOf('web-00000001'))
    const review = rowOf(WEB, 41)
    expect(text(review, 'pr-inbox-via-team')).toBe('via team')
    expect(text(review, 'pr-inbox-review')).toBe('Review required')
    expect(within(review).getByTestId('pr-inbox-ci').getAttribute('data-ci')).toBe('running')
    // Created 3 days ago, last comment 5 minutes ago: a review request shows how long it waits.
    expect(text(review, 'pr-inbox-age')).toBe('3d')
    // A request in person says nothing of a team.
    await act(async () => cleanup())
    await body(snapshotOf('web-00000001', { groups: [{ group: 'needs-review', rows: [{ ...ROWS.review, viaTeam: false }] }] }))
    expect(text(rowOf(WEB, 41), 'pr-inbox-via-team')).toBeNull()
  })

  it('one open thread is "1 open thread"', async () => {
    await body(snapshotOf('web-00000001', { groups: [{ group: 'needs-answer', rows: [{ ...ROWS.answer, unresolvedThreads: 1, newSinceSeen: 1 }] }] }))
    expect(text(rowOf(API, 118), 'pr-inbox-threads')).toBe('1 open thread')
    expect(text(rowOf(API, 118), 'pr-inbox-new')).toBe('1 new since you looked')
  })

  it('on a read-only screen an open row has Mark seen inactive, with the hint', async () => {
    const { PrInboxBody } = await import('../../src/renderer/pr-inbox/PrInboxView')
    const onMarkSeen = vi.fn()
    render(
      <PrInboxBody
        name="web"
        snapshot={snapshotOf('web-00000001')}
        tickets={TICKETS}
        now={NOW}
        expanded={new Set([`${API}#118`])}
        focusedGroup={null}
        missing={null}
        failure={null}
        readOnly="Read only: this Machine shares its Projects to look at"
        onToggle={() => undefined}
        onMarkSeen={onMarkSeen}
      />,
    )
    const markSeen = within(rowOf(API, 118)).getByRole('button', { name: 'Mark seen' }) as HTMLButtonElement
    expect(markSeen.disabled).toBe(true)
    expect(markSeen.title).toBe('Read only: this Machine shares its Projects to look at')
    // The threads still show.
    expect(within(rowOf(API, 118)).getAllByTestId('pr-inbox-thread')).toHaveLength(3)
  })

  it('a PR of no Ticket has no chip', async () => {
    await body(snapshotOf('web-00000001'), [])
    expect(screen.queryAllByTestId('pr-inbox-ticket')).toHaveLength(0)
  })
})

describe('the Ticket chip and the repository of a PR: line', () => {
  const LIB = 'example-org/lib'
  const pull = (repo: string, number: number, headRefName = 'feature/x') => ({ repo, number, headRefName })
  const load = async () => import('../../src/renderer/pr-inbox/usePrInbox')

  it("a bare PR: #N counts only in the repositories of the Ticket's Repo: lines", async () => {
    const { ticketOfRow } = await load()
    const ticket = modelTicket('demo', 5, 'Api', { repos: [API], prs: [{ repo: null, number: 41 }] })
    expect(ticketOfRow(pull(API, 41), [ticket])?.num).toBe(5)
    expect(ticketOfRow(pull(WEB, 41), [ticket])).toBeUndefined()
  })

  it('a bare PR: #N of a Ticket with no Repo: line counts in any repository', async () => {
    const { ticketOfRow } = await load()
    const ticket = modelTicket('demo', 5, 'Any', { prs: [{ repo: null, number: 41 }] })
    expect(ticketOfRow(pull(WEB, 41), [ticket])?.num).toBe(5)
    expect(ticketOfRow(pull(API, 41), [ticket])?.num).toBe(5)
  })

  it('a Repo: line by its layout name matches the repository of that name', async () => {
    const { ticketOfRow } = await load()
    const ticket = modelTicket('demo', 5, 'Lib', { repos: ['lib'], prs: [{ repo: null, number: 41 }] })
    expect(ticketOfRow(pull(LIB, 41), [ticket])?.num).toBe(5)
    expect(ticketOfRow(pull(WEB, 41), [ticket])).toBeUndefined()
  })

  it('PR: lib#41 names #41 of the repository called lib, not #41 of another one', async () => {
    const { ticketOfRow } = await load()
    const ticket = modelTicket('demo', 5, 'Lib', { repos: [WEB, LIB], prs: [{ repo: 'lib', number: 41 }] })
    expect(ticketOfRow(pull(LIB, 41), [ticket])?.num).toBe(5)
    expect(ticketOfRow(pull(WEB, 41), [ticket])).toBeUndefined()
    // By its full name, in any case.
    const full = modelTicket('demo', 6, 'Lib', { prs: [{ repo: 'Example-Org/Lib', number: 41 }] })
    expect(ticketOfRow(pull(LIB, 41), [full])?.num).toBe(6)
    expect(ticketOfRow(pull('other-org/lib', 41), [full])).toBeUndefined()
  })

  it("another repository's PR of the same number goes to the Ticket of its branch", async () => {
    const { ticketOfRow } = await load()
    const tickets = [modelTicket('demo', 5, 'Api', { repos: [API], prs: [{ repo: null, number: 41 }] }), modelTicket('demo', 8, 'Web')]
    expect(ticketOfRow(pull(WEB, 41, 'demo/08'), tickets)?.num).toBe(8)
    expect(ticketOfRow(pull(API, 41, 'demo/08'), tickets)?.num).toBe(5)
  })

  it('sameRepo: a full name whole and in any case, a bare name by the name part', async () => {
    const { sameRepo } = await load()
    expect(sameRepo('Example-Org/Web', WEB)).toBe(true)
    expect(sameRepo('web', WEB)).toBe(true)
    expect(sameRepo('WEB', WEB)).toBe(true)
    expect(sameRepo('other-org/web', WEB)).toBe(false)
    expect(sameRepo('we', WEB)).toBe(false)
    expect(sameRepo('example-org', WEB)).toBe(false)
  })
})

describe('the status line', () => {
  it('says when the next search runs', async () => {
    await body(snapshotOf('web-00000001'))
    expect(screen.getByTestId('pr-inbox-next').textContent).toBe('Next search in 4 min')
    expect(screen.queryByTestId('pr-inbox-error')).toBeNull()
    expect(screen.queryByTestId('pr-inbox-notice')).toBeNull()
  })

  it('a search whose time has come says "now"', async () => {
    await body(snapshotOf('web-00000001', { nextSearchAt: ago(10_000) }))
    expect(screen.getByTestId('pr-inbox-next').textContent).toBe('Next search now')
  })

  it('says why the last read failed, beside the next search', async () => {
    await body(snapshotOf('web-00000001', { error: 'gh: Service Unavailable (HTTP 503)', nextSearchAt: new Date(NOW + 10 * MIN).toISOString() }))
    expect(screen.getByTestId('pr-inbox-error').textContent).toBe('The last read failed: gh: Service Unavailable (HTTP 503)')
    expect(screen.getByTestId('pr-inbox-next').textContent).toBe('Next search in 10 min')
  })

  it("shows the snapshot's notice as it is", async () => {
    const notice = 'GitHub notifications unavailable for this token — checking every 5 minutes'
    await body(snapshotOf('web-00000001', { notice }))
    expect(screen.getByTestId('pr-inbox-notice').textContent).toBe(notice)
    expect(screen.getByTestId('pr-inbox-status').textContent).toContain('Next search in 4 min')
  })

  it('a Project that reads no pull requests says so and shows no groups', async () => {
    await body(snapshotOf('web-00000001', { enabled: false, groups: [], nextSearchAt: null, readAt: null }))
    expect(screen.getByTestId('pr-inbox-off').textContent).toContain('reading is off in Project settings')
    expect(screen.queryAllByTestId('pr-inbox-group')).toHaveLength(0)
    expect(screen.queryByTestId('pr-inbox-next')).toBeNull()
  })

  it('before the first read the view says it is reading, not that there are no pull requests', async () => {
    await body(snapshotOf('web-00000001', { groups: [], readAt: null }))
    expect(screen.getByTestId('pr-inbox-status').textContent).toContain('Reading pull requests…')
    expect(screen.queryByText('No open pull requests and no review requests.')).toBeNull()
  })

  it('an empty inbox after a read says so, with the groups at zero', async () => {
    await body(snapshotOf('web-00000001', { groups: [] }))
    expect(screen.getByText('No open pull requests and no review requests.')).toBeTruthy()
    expect(screen.getAllByTestId('pr-inbox-group-count').map((count) => count.textContent)).toEqual(['0', '0', '0', '0', '0'])
  })
})

/** The view of the window over the fake main, its Project the active one. */
async function view(inbox: Record<string, PrInboxSnapshot> = { 'web-00000001': snapshotOf('web-00000001') }, answers?: Record<string, (input: unknown) => IpcResult<unknown>>) {
  preload({ inbox, models: { [WEB_ROOT]: WEB_MODEL }, answers })
  const { PullRequestsView } = await import('../../src/renderer/pr-inbox/PrInboxView')
  render(<PullRequestsView />)
  await waitFor(() => expect(screen.getAllByTestId('pr-inbox-row').length).toBeGreaterThan(0))
}

describe('opening a row', () => {
  it('shows its threads, open ones first, with links to the code line, and tells main the PR was seen', async () => {
    await view()
    const answer = rowOf(API, 118)
    expect(within(answer).queryByTestId('pr-inbox-body')).toBeNull()
    expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen')).toHaveLength(0)
    fireEvent.click(within(answer).getByRole('button', { name: /Retry the upload/u }))
    expect(within(answer).getByRole('button', { name: /Retry the upload/u }).getAttribute('aria-expanded')).toBe('true')
    const threads = within(answer).getAllByTestId('pr-inbox-thread')
    expect(threads.map((thread) => within(thread).queryByTestId('pr-inbox-thread-link')?.textContent)).toEqual(['src/upload.ts:12', 'src/retry.ts', 'src/old.ts:1'])
    expect(threads.map((thread) => thread.dataset.resolved ?? null)).toEqual([null, null, 'true'])
    expect(within(threads[1]!).getByText('Outdated')).toBeTruthy()
    // The last comments of a thread, oldest first, with their authors.
    expect(within(threads[0]!).getAllByTestId('pr-inbox-comment').map((each) => each.textContent)).toEqual([`${ANA}3hWhy three tries?`, `${ME}2hThe server drops one`, `${ANA}2hThen say so in a comment`])
    expect(within(threads[0]!).getByTestId('pr-inbox-thread-link').getAttribute('href')).toBe(`https://github.com/${API}/pull/118#discussion_C11`)
    // The conversation tab; a deleted account is "ghost", as on GitHub.
    expect(within(answer).getByRole('region', { name: 'Conversation' }).textContent).toContain('ghost')
    expect(within(answer).getByTestId('pr-inbox-open-github').getAttribute('href')).toBe(`https://github.com/${API}/pull/118`)

    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen').map((call) => call.input)).toEqual([{ projectId: 'web-00000001', repo: API, number: 118 }]))
    // "3 new since you looked" goes with main's answer.
    await waitFor(() => expect(text(rowOf(API, 118), 'pr-inbox-new')).toBeNull())
    expect(channels().filter((channel) => channel.startsWith('prInbox.'))).toEqual(['prInbox.get', 'prInbox.markSeen'])
  })

  it('a link opens in the system browser, not in the window', async () => {
    await view()
    fireEvent.click(within(rowOf(API, 118)).getByRole('button', { name: /Retry the upload/u }))
    fireEvent.click(within(rowOf(API, 118)).getAllByTestId('pr-inbox-thread-link')[0]!)
    expect(main.calls).toContainEqual({ channel: 'shell.openExternal', input: { url: `https://github.com/${API}/pull/118#discussion_C11` } })
  })

  it('closing a row tells main nothing; "Mark seen" does', async () => {
    await view()
    const toggle = () => fireEvent.click(within(rowOf(API, 118)).getByRole('button', { name: /Retry the upload/u }))
    toggle()
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen')).toHaveLength(1))
    toggle()
    expect(within(rowOf(API, 118)).queryByTestId('pr-inbox-body')).toBeNull()
    expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen')).toHaveLength(1)
    // A new comment arrives: Mark seen is there for it.
    main.inbox['web-00000001'] = snapshotOf('web-00000001', { groups: [{ group: 'needs-answer', rows: [{ ...ROWS.answer, newSinceSeen: 1 }] }] })
    await act(async () => main.emit('prInbox.changed', { projectId: 'web-00000001' }))
    await waitFor(() => expect(text(rowOf(API, 118), 'pr-inbox-new')).toBe('1 new since you looked'))
    toggle()
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen')).toHaveLength(2))
    await waitFor(() => expect(text(rowOf(API, 118), 'pr-inbox-new')).toBeNull())
    main.inbox['web-00000001'] = snapshotOf('web-00000001', { groups: [{ group: 'needs-answer', rows: [{ ...ROWS.answer, newSinceSeen: 2 }] }] })
    await act(async () => main.emit('prInbox.changed', { projectId: 'web-00000001' }))
    await waitFor(() => expect(text(rowOf(API, 118), 'pr-inbox-new')).toBe('2 new since you looked'))
    const markSeen = within(rowOf(API, 118)).getByRole('button', { name: 'Mark seen' }) as HTMLButtonElement
    expect(markSeen.disabled).toBe(false)
    fireEvent.click(markSeen)
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen')).toHaveLength(3))
    await waitFor(() => expect(text(rowOf(API, 118), 'pr-inbox-new')).toBeNull())
    expect((within(rowOf(API, 118)).getByRole('button', { name: 'Mark seen' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a refused markSeen says why in the status line', async () => {
    await view(undefined, { 'prInbox.markSeen': () => ({ ok: false, error: 'pr-inbox.json cannot be written' }) })
    fireEvent.click(within(rowOf(API, 118)).getByRole('button', { name: /Retry the upload/u }))
    await waitFor(() => expect(screen.getByTestId('pr-inbox-seen-failure').textContent).toContain('pr-inbox.json cannot be written'))
    expect(text(rowOf(API, 118), 'pr-inbox-new')).toBe('3 new since you looked')
  })

  it('the switch of Project settings turned off: the view says so without waiting for a search', async () => {
    await view()
    main.inbox['web-00000001'] = snapshotOf('web-00000001', { enabled: false, groups: [], nextSearchAt: null })
    await act(async () => main.emit('projects.settings.changed', { id: 'web-00000001', settings: { actionTemplates: { shipTicket: '', runWave: '', gateQueue: '', prReply: '' }, prInbox: false } }))
    await waitFor(() => expect(screen.getByTestId('pr-inbox-off')).toBeTruthy())
    expect(screen.queryAllByTestId('pr-inbox-row')).toHaveLength(0)
  })
})

describe('openPrInboxOf with a PR', () => {
  async function opened(inbox: Record<string, PrInboxSnapshot> = { 'web-00000001': snapshotOf('web-00000001'), 'ops-00000002': snapshotOf('ops-00000002') }) {
    preload({ inbox, models: { [WEB_ROOT]: WEB_MODEL } })
    const { PullRequestsView } = await import('../../src/renderer/pr-inbox/PrInboxView')
    const { openPrInboxOf } = await import('../../src/renderer/pr-inbox/open')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    render(<PullRequestsView />)
    await waitFor(() => expect(screen.getAllByTestId('pr-inbox-view')).toHaveLength(1))
    return { openPrInboxOf, useNavigation }
  }

  it('opens the view with that row open, and marks it seen', async () => {
    const { openPrInboxOf, useNavigation } = await opened()
    expect(useNavigation.getState().view).toBe('canvas')
    await act(async () => {
      expect(await openPrInboxOf('web-00000001', 'web-00000001', { repo: API, number: 118 })).toBeUndefined()
    })
    expect(useNavigation.getState().view).toBe('pull-requests')
    expect(rowOf(API, 118).dataset.expanded).toBe('true')
    expect(within(rowOf(API, 118)).getAllByTestId('pr-inbox-thread')).toHaveLength(3)
    // The other rows stay closed.
    expect(screen.getAllByTestId('pr-inbox-row').filter((each) => each.dataset.expanded === 'true')).toHaveLength(1)
    expect(screen.queryByTestId('pr-inbox-missing')).toBeNull()
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen').map((call) => call.input)).toEqual([{ projectId: 'web-00000001', repo: API, number: 118 }]))
  })

  it('finds the PR whatever the case of its repository', async () => {
    const { openPrInboxOf } = await opened()
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', { repo: 'Example-Org/API', number: 118 })
    })
    expect(rowOf(API, 118).dataset.expanded).toBe('true')
  })

  it('a PR the inbox does not hold: the view opens and says so', async () => {
    const { openPrInboxOf, useNavigation } = await opened()
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', { repo: API, number: 999 })
    })
    expect(useNavigation.getState().view).toBe('pull-requests')
    expect(screen.getByTestId('pr-inbox-missing').textContent).toBe(`This pull request is not in the inbox: ${API}#999`)
    expect(screen.getAllByTestId('pr-inbox-row').filter((each) => each.dataset.expanded === 'true')).toHaveLength(0)
    expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen')).toHaveLength(0)
    // The next ask clears it.
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', { repo: API, number: 118 })
    })
    expect(screen.queryByTestId('pr-inbox-missing')).toBeNull()
  })

  it('a PR of another Project: that Project is selected first, then its view opens on the PR', async () => {
    const ops = snapshotOf('ops-00000002', { groups: [{ group: 'needs-review', rows: [row('example-org/ops', 5, { title: 'Rotate the keys', author: ANA })] }] })
    const { openPrInboxOf, useNavigation } = await opened({ 'web-00000001': snapshotOf('web-00000001'), 'ops-00000002': ops })
    await act(async () => {
      await openPrInboxOf('ops-00000002', 'web-00000001', { repo: 'example-org/ops', number: 5 })
    })
    expect(main.calls).toContainEqual({ channel: 'projects.select', input: { id: 'ops-00000002' } })
    expect(useNavigation.getState().view).toBe('pull-requests')
    await waitFor(() => expect(screen.getByTestId('pr-inbox-view').dataset.project).toBe('ops-00000002'))
    await waitFor(() => expect(rowOf('example-org/ops', 5).dataset.expanded).toBe('true'))
    // The selection happened before the view was switched to.
    const select = main.calls.findIndex((call) => call.channel === 'projects.select')
    const read = main.calls.findIndex((call) => call.channel === 'prInbox.get' && (call.input as { projectId: string }).projectId === 'ops-00000002')
    expect(select).toBeGreaterThanOrEqual(0)
    expect(read).toBeGreaterThan(select)
  })

  it('the ask is cleared once the view took it: the view shown again opens no row and marks nothing again', async () => {
    const { openPrInboxOf } = await opened()
    const { usePrInboxFocus } = await import('../../src/renderer/pr-inbox/usePrInbox')
    const { PullRequestsView } = await import('../../src/renderer/pr-inbox/PrInboxView')
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', { repo: API, number: 118 })
    })
    expect(rowOf(API, 118).dataset.expanded).toBe('true')
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen')).toHaveLength(1))
    expect(usePrInboxFocus.getState().focus).toBeNull()
    cleanup()
    render(<PullRequestsView />)
    await waitFor(() => expect(screen.getAllByTestId('pr-inbox-row').length).toBeGreaterThan(0))
    expect(screen.getAllByTestId('pr-inbox-row').filter((each) => each.dataset.expanded === 'true')).toHaveLength(0)
    await act(async () => Promise.resolve())
    expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen')).toHaveLength(1)
  })

  it('an ask on a group marks that group and opens no row', async () => {
    const { openPrInboxOf } = await opened()
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', undefined, 'needs-fix')
    })
    expect(screen.getAllByTestId('pr-inbox-group').filter((group) => group.dataset.focused === 'true').map((group) => group.dataset.group)).toEqual(['needs-fix'])
    expect(screen.getAllByTestId('pr-inbox-row').filter((each) => each.dataset.expanded === 'true')).toHaveLength(0)
  })
})

describe('on a read-only screen of a Linked machine', () => {
  const HINT = 'Studio gives this Machine read-only access'
  const PROJECTS_MODULE = '../../src/renderer/projects/useProjects'

  beforeEach(() => {
    vi.doMock(PROJECTS_MODULE, async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/renderer/projects/useProjects')>()), useReadOnly: () => HINT }))
  })

  afterEach(() => {
    vi.doUnmock(PROJECTS_MODULE)
  })

  it('a row opens to its threads but tells main nothing', async () => {
    await view()
    fireEvent.click(within(rowOf(API, 118)).getByRole('button', { name: /Retry the upload/u }))
    expect(within(rowOf(API, 118)).getAllByTestId('pr-inbox-thread')).toHaveLength(3)
    await act(async () => Promise.resolve())
    expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen')).toHaveLength(0)
    expect(text(rowOf(API, 118), 'pr-inbox-new')).toBe('3 new since you looked')
  })

  it('openPrInboxOf with a PR opens its row and marks nothing seen', async () => {
    preload({ inbox: { 'web-00000001': snapshotOf('web-00000001') }, models: { [WEB_ROOT]: WEB_MODEL } })
    const { PullRequestsView } = await import('../../src/renderer/pr-inbox/PrInboxView')
    const { openPrInboxOf } = await import('../../src/renderer/pr-inbox/open')
    render(<PullRequestsView />)
    await waitFor(() => expect(screen.getAllByTestId('pr-inbox-row').length).toBeGreaterThan(0))
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', { repo: API, number: 118 })
    })
    expect(rowOf(API, 118).dataset.expanded).toBe('true')
    await act(async () => Promise.resolve())
    expect(main.calls.filter((call) => call.channel === 'prInbox.markSeen')).toHaveLength(0)
  })

  it('the switch of Project settings is inactive, with the hint', async () => {
    preload({
      inbox: {},
      answers: {
        'projects.settings.get': () => ({ ok: true, value: { actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '', gateQueue: '', prReply: '' } } }),
        'terminal.shells': () => ({ ok: true, value: [] }),
      },
    })
    const { ProjectSettings } = await import('../../src/renderer/shell/ProjectSettings')
    render(<ProjectSettings project={{ id: 'web-00000001', name: 'web' }} onClose={() => undefined} />)
    const toggle = (await screen.findByRole('switch', { name: 'Read pull requests from GitHub' })) as HTMLButtonElement
    expect(toggle.disabled).toBe(true)
    expect(toggle.getAttribute('title')).toBe(HINT)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
})

describe('the sidebar section', () => {
  async function section(inbox: Record<string, PrInboxSnapshot>) {
    preload({ inbox })
    const { default: PullRequestsSection } = await import('../../src/renderer/shell/sidebar/PullRequestsSection')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    const { usePrInboxFocus } = await import('../../src/renderer/pr-inbox/usePrInbox')
    render(<PullRequestsSection />)
    return { useNavigation, usePrInboxFocus }
  }
  const sectionRows = () =>
    screen.getAllByTestId('pr-inbox-section-row').map((each) => `${each.dataset.project} ${each.textContent}`)

  it('counts the groups that hold a PR, for every Project, in the order of the spec', async () => {
    const web = snapshotOf('web-00000001', { groups: [{ group: 'ready', rows: [ROWS.ready] }, { group: 'needs-review', rows: [ROWS.review, row(WEB, 7, { author: ANA })] }] })
    const ops = snapshotOf('ops-00000002', { groups: [{ group: 'needs-answer', rows: [ROWS.answer] }] })
    await section({ 'web-00000001': web, 'ops-00000002': ops })
    await waitFor(() => expect(screen.getAllByTestId('pr-inbox-section-row')).toHaveLength(3))
    expect(sectionRows()).toEqual(['web-00000001 Needs my review2', 'web-00000001 Ready1', 'ops-00000002 Needs my answer1'])
    expect(screen.getByText('web')).toBeTruthy()
    expect(screen.getByText('ops')).toBeTruthy()
    expect(screen.queryByTestId('pr-inbox-section-empty')).toBeNull()
  })

  it('a count follows prInbox.changed without a reload', async () => {
    await section({ 'web-00000001': snapshotOf('web-00000001', { groups: [] }), 'ops-00000002': snapshotOf('ops-00000002', { enabled: false, groups: [] }) })
    expect(await screen.findByTestId('pr-inbox-section-empty')).toBeTruthy()
    main.inbox['web-00000001'] = snapshotOf('web-00000001', { groups: [{ group: 'needs-fix', rows: [ROWS.fix] }] })
    await act(async () => main.emit('prInbox.changed', { projectId: 'web-00000001' }))
    await waitFor(() => expect(sectionRows()).toEqual(['web-00000001 Needs a fix1']))
    expect(screen.queryByTestId('pr-inbox-section-empty')).toBeNull()
  })

  it('a Project that reads no pull requests shows nothing, even with rows left in its snapshot', async () => {
    await section({ 'web-00000001': snapshotOf('web-00000001', { enabled: false }), 'ops-00000002': snapshotOf('ops-00000002', { groups: [] }) })
    expect(await screen.findByTestId('pr-inbox-section-empty')).toBeTruthy()
    expect(screen.queryAllByTestId('pr-inbox-section-row')).toHaveLength(0)
  })

  it("a click opens the view on that group, selecting the row's Project first when it is not the active one", async () => {
    const { useNavigation, usePrInboxFocus } = await section({ 'web-00000001': snapshotOf('web-00000001'), 'ops-00000002': snapshotOf('ops-00000002', { groups: [{ group: 'needs-review', rows: [ROWS.review] }] }) })
    await waitFor(() => expect(screen.getAllByTestId('pr-inbox-section-row').length).toBe(6))
    const opsRow = screen.getAllByTestId('pr-inbox-section-row').find((each) => each.dataset.project === 'ops-00000002')!
    fireEvent.click(opsRow)
    await waitFor(() => expect(useNavigation.getState().view).toBe('pull-requests'))
    expect(main.calls).toContainEqual({ channel: 'projects.select', input: { id: 'ops-00000002' } })
    expect(usePrInboxFocus.getState().focus).toMatchObject({ projectId: 'ops-00000002', pr: null, group: 'needs-review' })

    useNavigation.setState({ view: 'canvas' })
    const selects = main.calls.filter((call) => call.channel === 'projects.select').length
    const webFix = screen.getAllByTestId('pr-inbox-section-row').find((each) => each.dataset.project === 'web-00000001' && each.dataset.group === 'needs-fix')!
    fireEvent.click(webFix)
    await waitFor(() => expect(usePrInboxFocus.getState().focus).toMatchObject({ projectId: 'web-00000001', group: 'needs-fix' }))
    // web is no longer the active Project: it is selected again.
    expect(main.calls.filter((call) => call.channel === 'projects.select')).toHaveLength(selects + 1)
  })

  it('a Project whose inbox cannot be read says why', async () => {
    await section({ 'web-00000001': snapshotOf('web-00000001', { groups: [] }) })
    expect(await screen.findByText(/Pull requests could not be read: not a Project of this Machine/u)).toBeTruthy()
  })
})

describe('the entries of the view', () => {
  it('the toolbar has a fifth tab, Pull requests, inactive without a Project', async () => {
    const { ToolbarView } = await import('../../src/renderer/shell/Toolbar')
    const onViewChange = vi.fn()
    render(<ToolbarView items={[]} project={{ id: 'web-00000001', name: 'web', branch: 'main' }} view="canvas" onViewChange={onViewChange} sidebarVisible onToggleSidebar={() => {}} />)
    const tabs = within(screen.getByRole('group', { name: 'View' }))
    expect(tabs.getAllByRole('button').map((tab) => tab.getAttribute('aria-label'))).toEqual(['Canvas', 'Session', 'Pipeline', 'Runs', 'Pull requests'])
    fireEvent.click(tabs.getByRole('button', { name: 'Pull requests' }))
    expect(onViewChange).toHaveBeenCalledWith('pull-requests')
    cleanup()
    render(<ToolbarView items={[]} view="canvas" onViewChange={onViewChange} sidebarVisible onToggleSidebar={() => {}} />)
    const none = within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Pull requests' }) as HTMLButtonElement
    expect(none.disabled).toBe(true)
    expect(none.title).toBe('Open a Project to see its pull requests')
  })

  it('the palette has "Pull requests" in View with a Project, and it opens the view', async () => {
    preload({ inbox: {} })
    const { buildCommands } = await import('../../src/renderer/palette/commands')
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    const context = { project: PROJECTS.projects[0], projects: PROJECTS.projects, view: 'canvas' as const, model: undefined, layoutNodes: [], history: [], adrs: [], tagFilter: null, createItems: [] }
    const command = buildCommands(context).find((each) => each.id === 'view:pull-requests')
    expect(command).toMatchObject({ group: 'View', title: 'Pull requests' })
    expect(await command!.run()).toBeUndefined()
    expect(useNavigation.getState().view).toBe('pull-requests')
    expect(buildCommands({ ...context, view: 'pull-requests' }).find((each) => each.id === 'view:pull-requests')?.detail).toBe('shown now')
    expect(buildCommands({ ...context, project: undefined }).find((each) => each.id === 'view:pull-requests')).toBeUndefined()
  })
})

describe('"Read pull requests from GitHub" in Project settings', () => {
  const TEMPLATES = { shipTicket: '/ship-ticket {epic} {NN}', runWave: '', gateQueue: '', prReply: '' }

  async function settings(saved: Record<string, unknown>) {
    const sets: unknown[] = []
    preload({
      inbox: {},
      answers: {
        'projects.settings.get': () => ({ ok: true, value: { actionTemplates: TEMPLATES, ...saved } }),
        'projects.settings.set': (input) => {
          sets.push((input as { settings: unknown }).settings)
          return { ok: true, value: { actionTemplates: TEMPLATES } }
        },
        'terminal.shells': () => ({ ok: true, value: [] }),
      },
    })
    const { ProjectSettings } = await import('../../src/renderer/shell/ProjectSettings')
    const onClose = vi.fn()
    render(<ProjectSettings project={{ id: 'web-00000001', name: 'web' }} onClose={onClose} />)
    const toggle = await screen.findByRole('switch', { name: 'Read pull requests from GitHub' })
    const save = async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })
    }
    return { toggle, save, sets, onClose }
  }

  it('is on when settings.json says nothing; turned off, Save sends prInbox: false', async () => {
    const { toggle, save, sets } = await settings({})
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await save()
    expect(sets).toEqual([{ actionTemplates: TEMPLATES, prInbox: false }])
  })

  it('shows a saved false, and turned on again Save sends true', async () => {
    const { toggle, save, sets } = await settings({ prInbox: false })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await save()
    expect(sets).toEqual([{ actionTemplates: TEMPLATES, prInbox: true }])
  })

  it('a Save that leaves the switch alone sends no prInbox: what settings.json says stays', async () => {
    const { save, sets } = await settings({ prInbox: false })
    await save()
    expect(sets).toEqual([{ actionTemplates: TEMPLATES }])
  })
})
