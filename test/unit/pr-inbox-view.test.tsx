// The Pull requests view and its entries (worfy-pr-inbox ticket 03; two panes since worfy-polish 96), over snapshots
// of `prInbox.get` in the shape main sends them (src/shared/ipc/pr-inbox.ts):
// - the view (src/renderer/pr-inbox/PrInboxView.tsx): the groups that hold a PR in the spec's order, a row of the list
//   with every field; the selected PR in the pane — what to do next, CI, review, merge state, size, "via team"; the
//   status line — the next search, why the last read failed, the snapshot's notice; the empty inbox;
// - selecting: the view's own choice tells main nothing; a click, ↑ / ↓ and an entry that names a PR tell main the PR
//   was seen (`prInbox.markSeen`), and "N new since you looked" goes; drafts are read for the selected PR only;
// - openPrInboxOf with a PR: the view selects it, or says the PR is not in the inbox; another Project is selected
//   first;
// - the sidebar section (src/renderer/shell/sidebar/PullRequestsSection.tsx): the counts of the groups, a click
//   opens the view on that group;
// - the toolbar tab, the palette command, and the switch of Project settings.
// main is a fake preload bridge; every fixture is invented — owners, repositories, logins and texts. Nothing
// here reaches GitHub: of the `prInbox` channels the view sends only `prInbox.get`, `prInbox.markSeen` and, for the
// selected PR, `prInbox.drafts` (ADR-0105; Send is in test/unit/draft-thread.test.tsx).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { PrInboxBodyProps } from '../../src/renderer/pr-inbox/PrInboxView'
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
  additions: null,
  deletions: null,
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
    additions: 184,
    deletions: 22,
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
/** The PRs the list marks selected, as `owner/name#N`. */
const selectedRows = (): string[] =>
  screen
    .queryAllByTestId('pr-inbox-row')
    .filter((each) => each.dataset.selected === 'true')
    .map((each) => `${each.dataset.repo}#${each.dataset.number}`)
const pane = (): HTMLElement => screen.getByTestId('pr-inbox-pane')
const select = (repo: string, number: number): void => {
  fireEvent.click(within(rowOf(repo, number)).getByRole('button'))
}
const key = (name: 'ArrowDown' | 'ArrowUp', target: Element = document.body, init: KeyboardEventInit = {}): void => {
  fireEvent.keyDown(target, { key: name, ...init })
}
const text = (scope: HTMLElement, testId: string): string | null => within(scope).queryByTestId(testId)?.textContent ?? null
const label = (scope: HTMLElement, testId: string): string | null => within(scope).queryByTestId(testId)?.getAttribute('aria-label') ?? null
const fact = (name: string): HTMLElement => {
  const found = within(pane())
    .getAllByTestId('pr-inbox-fact')
    .find((each) => each.dataset.fact === name)
  const value = found?.querySelector<HTMLElement>('.w-pr-inbox-fact__value')
  if (!value) throw new Error(`no fact ${name}`)
  return value
}
const seenCalls = (): unknown[] => main.calls.filter((call) => call.channel === 'prInbox.markSeen').map((call) => call.input)
/** Only reads and markSeen went to main: nothing else of the view could reach GitHub. */
const channels = (): string[] => [...new Set(main.calls.map((call) => call.channel))]

async function body(snapshot: PrInboxSnapshot, tickets: Ticket[] = TICKETS, over: Partial<PrInboxBodyProps> = {}) {
  const { PrInboxBody } = await import('../../src/renderer/pr-inbox/PrInboxView')
  render(
    <PrInboxBody
      name="web"
      snapshot={snapshot}
      tickets={tickets}
      now={NOW}
      selected={null}
      focusedGroup={null}
      missing={null}
      failure={null}
      readOnly={null}
      onSelect={() => undefined}
      onMarkSeen={() => undefined}
      {...over}
    />,
  )
}

describe('the view of a snapshot', () => {
  it('lists the groups in the order of the spec, whatever order main sent them in', async () => {
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

  it('keeps the order of the rows inside a group as main sorted them; a group without a PR is not listed', async () => {
    const older = row(WEB, 7, { title: 'Older', author: ANA, createdAt: ago(9 * DAY) })
    await body(snapshotOf('web-00000001', { groups: [{ group: 'needs-review', rows: [older, ROWS.review] }, { group: 'ready', rows: [] }] }))
    const review = screen.getAllByTestId('pr-inbox-group')[0]!
    expect(within(review).getAllByTestId('pr-inbox-title').map((title) => title.textContent)).toEqual(['Older', 'Add the export button'])
    expect(groupTitles()).toEqual(['Needs my review'])
    expect(screen.getAllByTestId('pr-inbox-group-count').map((count) => count.textContent)).toEqual(['2'])
  })

  it('a row of the list has its title, name#N, Ticket chip, CI, open threads, a new mark and its age', async () => {
    await body(snapshotOf('web-00000001'))
    const answer = rowOf(API, 118)
    expect(text(answer, 'pr-inbox-title')).toBe('Retry the upload')
    // A title cut with an ellipsis is whole in its tooltip.
    expect(within(answer).getByTestId('pr-inbox-title').getAttribute('title')).toBe('Retry the upload')
    // The name of the repository; the whole owner/name#N is the tooltip.
    expect(text(answer, 'pr-inbox-ref')).toBe('api#118')
    expect(within(answer).getByTestId('pr-inbox-ref').getAttribute('title')).toBe(`${API}#118`)
    // The Ticket by its branch demo/07.
    expect(text(answer, 'pr-inbox-ticket')).toBe('demo 07')
    expect(within(answer).getByTestId('pr-inbox-ci').getAttribute('data-ci')).toBe('passing')
    expect(within(answer).getByRole('img', { name: 'CI passing' })).toBeTruthy()
    // A passing CI is a dot alone.
    expect(within(answer).queryByText('CI passing')).toBeNull()
    expect(text(answer, 'pr-inbox-threads')).toBe('2')
    expect(label(answer, 'pr-inbox-threads')).toBe('2 open threads')
    // My PR: its open threads wait for me.
    expect(within(answer).getByTestId('pr-inbox-threads').dataset.mine).toBe('true')
    expect(label(answer, 'pr-inbox-new')).toBe('3 new since you looked')
    // The age of the last activity, and how long it has waited.
    expect(text(answer, 'pr-inbox-age')).toBe('2h')
    expect(within(answer).getByTestId('pr-inbox-age').dataset.heat).toBe('0')

    const fix = rowOf(WEB, 40)
    // The Ticket whose PR: line names web#40.
    expect(text(fix, 'pr-inbox-ticket')).toBe('demo 03')
    expect(within(fix).getByTestId('pr-inbox-ci').getAttribute('data-ci')).toBe('failing')
    // A CI that is not green says so in words beside its dot.
    expect(within(fix).getByText('CI failing')).toBeTruthy()
    expect(text(fix, 'pr-inbox-threads')).toBeNull()
    expect(text(fix, 'pr-inbox-new')).toBeNull()
    expect(text(fix, 'pr-inbox-age')).toBe('1d')
    expect(within(fix).getByTestId('pr-inbox-age').dataset.heat).toBe('1')

    const ready = rowOf(API, 120)
    expect(text(ready, 'pr-inbox-ticket')).toBeNull()
    expect(text(ready, 'pr-inbox-age')).toBe('30m')

    const waiting = rowOf(WEB, 39)
    expect(within(waiting).getByTestId('pr-inbox-ci').getAttribute('data-ci')).toBe('none')
    expect(within(waiting).getByRole('img', { name: 'No CI' })).toBeTruthy()
    expect(text(waiting, 'pr-inbox-age')).toBe('5d')
    expect(within(waiting).getByTestId('pr-inbox-age').dataset.heat).toBe('2')

    // The review request of someone else: its open threads are not the user's to answer.
    const review = rowOf(WEB, 41)
    expect(text(review, 'pr-inbox-age')).toBe('3d')
  })

  it('selects by itself the first PR that waits for an answer and shows it in full', async () => {
    await body(snapshotOf('web-00000001'))
    expect(selectedRows()).toEqual([`${API}#118`])
    expect(pane().dataset.repo).toBe(API)
    expect(text(pane(), 'pr-inbox-pane-title')).toBe('Retry the upload')
    expect(text(pane(), 'pr-inbox-pane-ref')).toBe(`${API}#118`)
    expect(text(pane(), 'pr-inbox-ticket')).toBe('demo 07')
    expect(text(pane(), 'pr-inbox-pane-new')).toBe('3 new since you looked')
    expect(pane().textContent).toContain(`by ${ME}`)
    expect(pane().textContent).toContain('demo/07')
    // What to do next, from its group and its drafts (none read here: no main).
    const next = within(pane()).getByTestId('pr-inbox-next-step')
    expect(next.dataset.tone).toBe('answer')
    expect(text(next, 'pr-inbox-next-step-title')).toBe('Answer 2 open threads')
    expect(next.textContent).toContain('No drafts yet: Draft replies starts a Session that writes them.')
    expect(within(next).queryByTestId('pr-inbox-next-step-action')).toBeNull()
    // CI, review, merge state and size.
    expect(fact('ci').textContent).toBe('CI passing')
    expect(fact('review').textContent).toBe('None yet')
    expect(text(fact('merge'), 'pr-inbox-merge')).toBe('Mergeable')
    expect(text(fact('size'), 'pr-inbox-size')).toBe('+184−22')
    expect(within(fact('size')).getByTestId('pr-inbox-size').getAttribute('title')).toBe('184 lines added, 22 removed')
    expect(text(pane(), 'pr-inbox-thread-count')).toBe('2 open · 1 resolved')
    expect(within(pane()).getAllByTestId('pr-inbox-thread')).toHaveLength(3)
    expect(within(pane()).getByTestId('pr-inbox-open-github').getAttribute('href')).toBe(`https://github.com/${API}/pull/118`)
  })

  it('without a PR that waits for an answer the first of the list is selected; the user\'s choice wins while the snapshot holds it', async () => {
    const groups = snapshotOf('web-00000001').groups.filter(({ group }) => group !== 'needs-answer')
    await body(snapshotOf('web-00000001', { groups }))
    expect(selectedRows()).toEqual([`${WEB}#41`])
    cleanup()
    await body(snapshotOf('web-00000001'), TICKETS, { selected: `${WEB}#39` })
    expect(selectedRows()).toEqual([`${WEB}#39`])
    expect(text(pane(), 'pr-inbox-pane-title')).toBe('Sketch the settings page')
    cleanup()
    // A PR merged meanwhile: the view picks again.
    await body(snapshotOf('web-00000001'), TICKETS, { selected: `${WEB}#999` })
    expect(selectedRows()).toEqual([`${API}#118`])
  })

  it('the pane of each group: what to do next, the review decision, the merge state, the flags', async () => {
    await body(snapshotOf('web-00000001'), TICKETS, { selected: `${WEB}#41` })
    let next = within(pane()).getByTestId('pr-inbox-next-step')
    expect(next.dataset.tone).toBe('review')
    expect(text(next, 'pr-inbox-next-step-title')).toBe('Your review is asked')
    expect(next.textContent).toContain(`${ANA} opened it 3d ago, asked through your team.`)
    expect(within(next).getByTestId('pr-inbox-next-step-action').textContent).toBe('Start review')
    expect(within(next).getByTestId('pr-inbox-next-step-action').getAttribute('href')).toBe(`https://github.com/${WEB}/pull/41/files`)
    expect(text(pane(), 'pr-inbox-via-team')).toBe('via team')
    expect(text(fact('review'), 'pr-inbox-review')).toBe('Review required')
    expect(fact('ci').textContent).toBe('CI running')
    // GitHub gave no size.
    expect(text(fact('size'), 'pr-inbox-size')).toBe('—')
    cleanup()

    await body(snapshotOf('web-00000001'), TICKETS, { selected: `${WEB}#40` })
    next = within(pane()).getByTestId('pr-inbox-next-step')
    expect(next.dataset.tone).toBe('fix')
    expect(text(next, 'pr-inbox-next-step-title')).toBe('CI failing and changes requested')
    expect(within(next).getByTestId('pr-inbox-next-step-action').getAttribute('href')).toBe(`https://github.com/${WEB}/pull/40/checks`)
    expect(text(fact('review'), 'pr-inbox-review')).toBe('Changes requested')
    expect(within(fact('review')).getByTestId('pr-inbox-review').querySelector('[data-status]')?.getAttribute('data-status')).toBe('blocked')
    expect(text(pane(), 'pr-inbox-via-team')).toBeNull()
    cleanup()

    await body(snapshotOf('web-00000001'), TICKETS, { selected: `${API}#120` })
    next = within(pane()).getByTestId('pr-inbox-next-step')
    expect(text(next, 'pr-inbox-next-step-title')).toBe('Ready to merge')
    expect(within(next).getByTestId('pr-inbox-next-step-action').getAttribute('href')).toBe(`https://github.com/${API}/pull/120`)
    expect(within(fact('review')).getByTestId('pr-inbox-review').querySelector('[data-status]')?.getAttribute('data-status')).toBe('ready')
    cleanup()

    await body(snapshotOf('web-00000001'), TICKETS, { selected: `${WEB}#39` })
    next = within(pane()).getByTestId('pr-inbox-next-step')
    expect(next.dataset.tone).toBe('waiting')
    expect(text(next, 'pr-inbox-next-step-title')).toBe('Draft PR: no review asked yet')
    expect(next.textContent).toContain('Last activity 5d ago.')
    expect(within(pane()).getByText('Draft')).toBeTruthy()
    expect(fact('ci').textContent).toBe('No CI')
  })

  it('one PR: it is selected and shown, its group alone in the list', async () => {
    await body(snapshotOf('web-00000001', { groups: [{ group: 'waiting', rows: [ROWS.waiting] }] }))
    expect(groupTitles()).toEqual(['Waiting on others'])
    expect(selectedRows()).toEqual([`${WEB}#39`])
    expect(text(pane(), 'pr-inbox-pane-title')).toBe('Sketch the settings page')
    expect(within(pane()).getByText('No review threads.')).toBeTruthy()
  })

  it('on a read-only screen the pane has Mark seen inactive, with the hint', async () => {
    await body(snapshotOf('web-00000001'), TICKETS, { readOnly: 'Read only: this Machine shares its Projects to look at' })
    const markSeen = within(pane()).getByRole('button', { name: 'Mark seen' }) as HTMLButtonElement
    expect(markSeen.disabled).toBe(true)
    expect(markSeen.title).toBe('Read only: this Machine shares its Projects to look at')
    // The threads still show.
    expect(within(pane()).getAllByTestId('pr-inbox-thread')).toHaveLength(3)
  })

  it('a PR of no Ticket has no chip', async () => {
    await body(snapshotOf('web-00000001'), [])
    expect(screen.queryAllByTestId('pr-inbox-ticket')).toHaveLength(0)
  })
})

describe('the pure parts of the two panes', () => {
  const load = async () => import('../../src/renderer/pr-inbox/usePrInbox')

  it('mergeText: what each merge state of GitHub says, and nothing for an unknown one', async () => {
    const { mergeText } = await load()
    expect(['CLEAN', 'HAS_HOOKS', 'BEHIND', 'BLOCKED', 'UNSTABLE', 'DIRTY', 'DRAFT', 'UNKNOWN', null].map((status) => mergeText(status))).toEqual([
      { label: 'Mergeable', tone: 'ready' },
      { label: 'Mergeable', tone: 'ready' },
      { label: 'Behind the base', tone: 'blocked' },
      { label: 'Blocked', tone: 'open' },
      { label: 'Checks failing', tone: 'blocked' },
      { label: 'Conflicts', tone: 'problem' },
      { label: 'Draft', tone: 'open' },
      null,
      null,
    ])
  })

  it('sizeOf: null without numbers; each side that has lines gets at least 8 % of the bar', async () => {
    const { sizeOf } = await load()
    expect(sizeOf({ additions: null, deletions: 3 })).toBeNull()
    expect(sizeOf({ additions: 3, deletions: null })).toBeNull()
    expect(sizeOf({ additions: 0, deletions: 0 })).toEqual({ additions: 0, deletions: 0, addedShare: 50 })
    expect(sizeOf({ additions: 12, deletions: 0 })).toEqual({ additions: 12, deletions: 0, addedShare: 100 })
    expect(sizeOf({ additions: 0, deletions: 7 })).toEqual({ additions: 0, deletions: 7, addedShare: 0 })
    expect(sizeOf({ additions: 1000, deletions: 1 })?.addedShare).toBe(92)
    expect(sizeOf({ additions: 1, deletions: 1000 })?.addedShare).toBe(8)
    expect(sizeOf({ additions: 184, deletions: 22 })?.addedShare).toBe(89)
  })

  it('ageHeat: under 12 hours, under 3 days, under 14 days, and after', async () => {
    const { ageHeat } = await load()
    expect([11 * HOUR, 13 * HOUR, 71 * HOUR, 73 * HOUR, 13 * DAY, 15 * DAY].map((age) => ageHeat(ago(age), NOW))).toEqual([0, 1, 1, 2, 2, 3])
    expect(ageHeat('not a time', NOW)).toBe(0)
  })

  it('nextStep of a PR that waits for an answer counts its drafts; a mention without a thread asks for an answer too', async () => {
    const { nextStep } = await load()
    expect(nextStep('needs-answer', ROWS.answer, NOW, 2, true).text).toBe('2 draft replies are ready below: read, edit, Send.')
    expect(nextStep('needs-answer', ROWS.answer, NOW, 1, true).text).toBe('1 draft reply is ready below: read, edit, Send.')
    expect(nextStep('needs-answer', ROWS.answer, NOW, 0, false).text).toBe('Drafts of replies stay on the machine of the Project.')
    expect(nextStep('needs-answer', { ...ROWS.answer, unresolvedThreads: 0 }, NOW, 0, true).title).toBe('Your answer is awaited')
    expect(nextStep('needs-answer', { ...ROWS.answer, unresolvedThreads: 1 }, NOW, 0, true).title).toBe('Answer 1 open thread')
  })

  it('nextStep of a PR to fix names what is wrong', async () => {
    const { nextStep } = await load()
    const fix = (over: Partial<PrInboxRow>) => nextStep('needs-fix', { ...ROWS.fix, ci: 'passing', reviewDecision: null, mergeStateStatus: 'CLEAN', ...over }, NOW, 0, true)
    expect(fix({ ci: 'failing' })).toMatchObject({ title: 'CI failing', action: { label: 'Open checks' } })
    expect(fix({ reviewDecision: 'CHANGES_REQUESTED' })).toMatchObject({ title: 'Changes requested', action: null })
    expect(fix({ mergeStateStatus: 'DIRTY' })).toMatchObject({ title: 'Merge conflict', text: 'Resolve the conflict with the base branch.', action: null })
    expect(nextStep('waiting', { ...ROWS.waiting, isDraft: false }, NOW, 0, true).title).toBe('Waiting for reviewers')
  })

  it('initialsOf and avatarTone: two letters of a login, one colour for one login', async () => {
    const { avatarTone, initialsOf } = await load()
    expect([initialsOf('dev-ana'), initialsOf('octo'), initialsOf('a_b.c'), initialsOf(null), initialsOf('x')]).toEqual(['DA', 'OC', 'AB', 'GH', 'X'])
    expect(avatarTone('dev-ana', 8)).toBe(avatarTone('dev-ana', 8))
    expect(avatarTone('dev-ana', 8)).toBeGreaterThanOrEqual(0)
    expect(avatarTone('dev-ana', 8)).toBeLessThan(8)
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

  it('an empty inbox after a read says so calmly, with no list and no pane', async () => {
    await body(snapshotOf('web-00000001', { groups: [] }))
    expect(screen.getByTestId('pr-inbox-empty').textContent).toContain('No open pull requests and no review requests.')
    expect(screen.queryAllByTestId('pr-inbox-group')).toHaveLength(0)
    expect(screen.queryByTestId('pr-inbox-pane')).toBeNull()
  })
})

/** The view of the window over the fake main, its Project the active one. */
async function view(inbox: Record<string, PrInboxSnapshot> = { 'web-00000001': snapshotOf('web-00000001') }, answers?: Record<string, (input: unknown) => IpcResult<unknown>>) {
  preload({ inbox, models: { [WEB_ROOT]: WEB_MODEL }, answers })
  const { PullRequestsView } = await import('../../src/renderer/pr-inbox/PrInboxView')
  const shown = render(<PullRequestsView />)
  await waitFor(() => expect(screen.getAllByTestId('pr-inbox-row').length).toBeGreaterThan(0))
  return shown
}

describe('selecting a PR', () => {
  it('the PR the view selects by itself tells main nothing; a click on one selects it and tells main it was seen', async () => {
    await view()
    expect(selectedRows()).toEqual([`${API}#118`])
    await act(async () => Promise.resolve())
    expect(seenCalls()).toEqual([])
    select(WEB, 40)
    expect(selectedRows()).toEqual([`${WEB}#40`])
    expect(within(rowOf(WEB, 40)).getByRole('button').getAttribute('aria-current')).toBe('true')
    expect(pane().dataset.number).toBe('40')
    expect(text(pane(), 'pr-inbox-pane-title')).toBe('Fix the date picker')
    await waitFor(() => expect(seenCalls()).toEqual([{ projectId: 'web-00000001', repo: WEB, number: 40 }]))
  })

  it('the pane shows the threads, open ones first, with links to the code line; the new mark goes once main has the look', async () => {
    await view()
    select(API, 118)
    const threads = within(pane()).getAllByTestId('pr-inbox-thread')
    expect(threads.map((thread) => within(thread).queryByTestId('pr-inbox-thread-link')?.textContent)).toEqual(['src/upload.ts:12', 'src/retry.ts', 'src/old.ts:1'])
    expect(threads.map((thread) => thread.dataset.resolved ?? null)).toEqual([null, null, 'true'])
    expect(within(threads[1]!).getByText('Outdated')).toBeTruthy()
    // The last comments of a thread, oldest first, with their authors.
    expect(within(threads[0]!).getAllByTestId('pr-inbox-comment').map((each) => each.textContent)).toEqual([`${ANA}3hWhy three tries?`, `${ME}2hThe server drops one`, `${ANA}2hThen say so in a comment`])
    expect(within(threads[0]!).getByTestId('pr-inbox-thread-link').getAttribute('href')).toBe(`https://github.com/${API}/pull/118#discussion_C11`)
    // The conversation tab; a deleted account is "ghost", as on GitHub.
    expect(within(pane()).getByRole('region', { name: 'Conversation' }).textContent).toContain('ghost')

    await waitFor(() => expect(seenCalls()).toEqual([{ projectId: 'web-00000001', repo: API, number: 118 }]))
    // "3 new since you looked" goes with main's answer, in the list and in the pane.
    await waitFor(() => expect(text(rowOf(API, 118), 'pr-inbox-new')).toBeNull())
    expect(text(pane(), 'pr-inbox-pane-new')).toBeNull()
    // The selected PR reads its draft replies (worfy-pr-inbox ticket 05); nothing is saved or sent without the user.
    expect(channels().filter((channel) => channel.startsWith('prInbox.')).sort()).toEqual(['prInbox.drafts', 'prInbox.get', 'prInbox.markSeen'])
  })

  it('drafts are read for the selected PR only', async () => {
    await view()
    const draftsAsked = (): number[] => [...new Set(main.calls.filter((call) => call.channel === 'prInbox.drafts').map((call) => (call.input as { number: number }).number))]
    await waitFor(() => expect(draftsAsked()).toEqual([118]))
    select(WEB, 41)
    await waitFor(() => expect(draftsAsked()).toEqual([118, 41]))
    expect(main.calls.filter((call) => call.channel === 'prInbox.drafts').map((call) => (call.input as { repo: string }).repo)).not.toContain('example-org/other')
  })

  it('a link opens in the system browser, not in the window', async () => {
    await view()
    fireEvent.click(within(pane()).getAllByTestId('pr-inbox-thread-link')[0]!)
    expect(main.calls).toContainEqual({ channel: 'shell.openExternal', input: { url: `https://github.com/${API}/pull/118#discussion_C11` } })
    fireEvent.click(within(pane()).getByTestId('pr-inbox-open-github'))
    expect(main.calls).toContainEqual({ channel: 'shell.openExternal', input: { url: `https://github.com/${API}/pull/118` } })
  })

  it('a click on the selected PR again tells main again; "Mark seen" does too', async () => {
    await view()
    select(API, 118)
    await waitFor(() => expect(seenCalls()).toHaveLength(1))
    // A new comment arrives: the list marks it, and Mark seen is there for it.
    main.inbox['web-00000001'] = snapshotOf('web-00000001', { groups: [{ group: 'needs-answer', rows: [{ ...ROWS.answer, newSinceSeen: 1 }] }] })
    await act(async () => main.emit('prInbox.changed', { projectId: 'web-00000001' }))
    await waitFor(() => expect(label(rowOf(API, 118), 'pr-inbox-new')).toBe('1 new since you looked'))
    select(API, 118)
    await waitFor(() => expect(seenCalls()).toHaveLength(2))
    await waitFor(() => expect(text(rowOf(API, 118), 'pr-inbox-new')).toBeNull())
    main.inbox['web-00000001'] = snapshotOf('web-00000001', { groups: [{ group: 'needs-answer', rows: [{ ...ROWS.answer, newSinceSeen: 2 }] }] })
    await act(async () => main.emit('prInbox.changed', { projectId: 'web-00000001' }))
    await waitFor(() => expect(text(pane(), 'pr-inbox-pane-new')).toBe('2 new since you looked'))
    const markSeen = within(pane()).getByRole('button', { name: 'Mark seen' }) as HTMLButtonElement
    expect(markSeen.disabled).toBe(false)
    fireEvent.click(markSeen)
    await waitFor(() => expect(seenCalls()).toHaveLength(3))
    await waitFor(() => expect(text(rowOf(API, 118), 'pr-inbox-new')).toBeNull())
    expect((within(pane()).getByRole('button', { name: 'Mark seen' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('↓ and ↑ move the selection along the list and tell main each PR was seen; they stop at the ends', async () => {
    await view()
    expect(selectedRows()).toEqual([`${API}#118`])
    key('ArrowDown')
    expect(selectedRows()).toEqual([`${WEB}#40`])
    expect(pane().dataset.number).toBe('40')
    key('ArrowUp')
    key('ArrowUp')
    expect(selectedRows()).toEqual([`${WEB}#41`])
    // The top of the list: nothing moves, nothing more is told.
    key('ArrowUp')
    expect(selectedRows()).toEqual([`${WEB}#41`])
    await waitFor(() => expect(seenCalls().map((call) => (call as { number: number }).number)).toEqual([40, 118, 41]))
    for (let step = 0; step < 6; step += 1) key('ArrowDown')
    expect(selectedRows()).toEqual([`${WEB}#39`])
    await waitFor(() => expect(seenCalls().map((call) => (call as { number: number }).number)).toEqual([40, 118, 41, 118, 40, 120, 39]))
  })

  it('↓ and ↑ are not the view\'s with a modifier, in a field, outside the view, or while the view is hidden', async () => {
    const { container } = await view()
    key('ArrowDown', document.body, { metaKey: true })
    key('ArrowDown', document.body, { altKey: true })
    expect(selectedRows()).toEqual([`${API}#118`])
    // A field of the pane, like the text of a draft reply.
    const field = document.createElement('textarea')
    pane().appendChild(field)
    key('ArrowDown', field)
    expect(selectedRows()).toEqual([`${API}#118`])
    // An element of another part of the window.
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)
    key('ArrowDown', elsewhere)
    expect(selectedRows()).toEqual([`${API}#118`])
    elsewhere.remove()
    // The shell keeps a view mounted and hidden while another one is shown.
    container.hidden = true
    key('ArrowDown')
    expect(selectedRows()).toEqual([`${API}#118`])
    container.hidden = false
    key('ArrowDown')
    expect(selectedRows()).toEqual([`${WEB}#40`])
  })

  it('a refused markSeen says why in the status line', async () => {
    await view(undefined, { 'prInbox.markSeen': () => ({ ok: false, error: 'pr-inbox.json cannot be written' }) })
    select(API, 118)
    await waitFor(() => expect(screen.getByTestId('pr-inbox-seen-failure').textContent).toContain('pr-inbox.json cannot be written'))
    expect(label(rowOf(API, 118), 'pr-inbox-new')).toBe('3 new since you looked')
  })

  it('the switch of Project settings turned off: the view says so without waiting for a search', async () => {
    await view()
    main.inbox['web-00000001'] = snapshotOf('web-00000001', { enabled: false, groups: [], nextSearchAt: null })
    await act(async () => main.emit('projects.settings.changed', { id: 'web-00000001', settings: { actionTemplates: { shipTicket: '', runWave: '', gateQueue: '', prReply: '' }, prInbox: false } }))
    await waitFor(() => expect(screen.getByTestId('pr-inbox-off')).toBeTruthy())
    expect(screen.queryAllByTestId('pr-inbox-row')).toHaveLength(0)
    expect(screen.queryByTestId('pr-inbox-pane')).toBeNull()
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

  it('opens the view with that PR selected, and marks it seen', async () => {
    const { openPrInboxOf, useNavigation } = await opened()
    expect(useNavigation.getState().view).toBe('canvas')
    await act(async () => {
      expect(await openPrInboxOf('web-00000001', 'web-00000001', { repo: WEB, number: 40 })).toBeUndefined()
    })
    expect(useNavigation.getState().view).toBe('pull-requests')
    expect(selectedRows()).toEqual([`${WEB}#40`])
    expect(pane().dataset.number).toBe('40')
    expect(screen.queryByTestId('pr-inbox-missing')).toBeNull()
    await waitFor(() => expect(seenCalls()).toEqual([{ projectId: 'web-00000001', repo: WEB, number: 40 }]))
  })

  it('finds the PR whatever the case of its repository', async () => {
    const { openPrInboxOf } = await opened()
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', { repo: 'Example-Org/WEB', number: 40 })
    })
    expect(selectedRows()).toEqual([`${WEB}#40`])
  })

  it('a PR the inbox does not hold: the view opens and says so, its own selection stays and nothing is marked seen', async () => {
    const { openPrInboxOf, useNavigation } = await opened()
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', { repo: API, number: 999 })
    })
    expect(useNavigation.getState().view).toBe('pull-requests')
    expect(screen.getByTestId('pr-inbox-missing').textContent).toBe(`This pull request is not in the inbox: ${API}#999`)
    expect(selectedRows()).toEqual([`${API}#118`])
    await act(async () => Promise.resolve())
    expect(seenCalls()).toHaveLength(0)
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
    await waitFor(() => expect(selectedRows()).toEqual(['example-org/ops#5']))
    // The selection happened before the view was switched to.
    const select = main.calls.findIndex((call) => call.channel === 'projects.select')
    const read = main.calls.findIndex((call) => call.channel === 'prInbox.get' && (call.input as { projectId: string }).projectId === 'ops-00000002')
    expect(select).toBeGreaterThanOrEqual(0)
    expect(read).toBeGreaterThan(select)
  })

  it('the ask is cleared once the view took it: the view shown again selects by itself and marks nothing again', async () => {
    const { openPrInboxOf } = await opened()
    const { usePrInboxFocus } = await import('../../src/renderer/pr-inbox/usePrInbox')
    const { PullRequestsView } = await import('../../src/renderer/pr-inbox/PrInboxView')
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', { repo: WEB, number: 40 })
    })
    expect(selectedRows()).toEqual([`${WEB}#40`])
    await waitFor(() => expect(seenCalls()).toHaveLength(1))
    expect(usePrInboxFocus.getState().focus).toBeNull()
    cleanup()
    render(<PullRequestsView />)
    await waitFor(() => expect(screen.getAllByTestId('pr-inbox-row').length).toBeGreaterThan(0))
    expect(selectedRows()).toEqual([`${API}#118`])
    await act(async () => Promise.resolve())
    expect(seenCalls()).toHaveLength(1)
  })

  it('an ask on a group marks that group and selects its first PR without marking it seen', async () => {
    const { openPrInboxOf } = await opened()
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', undefined, 'needs-fix')
    })
    expect(screen.getAllByTestId('pr-inbox-group').filter((group) => group.dataset.focused === 'true').map((group) => group.dataset.group)).toEqual(['needs-fix'])
    expect(selectedRows()).toEqual([`${WEB}#40`])
    await act(async () => Promise.resolve())
    expect(seenCalls()).toHaveLength(0)
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

  it('a click selects a PR and shows its threads but tells main nothing', async () => {
    await view()
    select(API, 118)
    expect(within(pane()).getAllByTestId('pr-inbox-thread')).toHaveLength(3)
    key('ArrowDown')
    expect(selectedRows()).toEqual([`${WEB}#40`])
    await act(async () => Promise.resolve())
    expect(seenCalls()).toHaveLength(0)
    expect(label(rowOf(API, 118), 'pr-inbox-new')).toBe('3 new since you looked')
  })

  it('openPrInboxOf with a PR selects it and marks nothing seen', async () => {
    preload({ inbox: { 'web-00000001': snapshotOf('web-00000001') }, models: { [WEB_ROOT]: WEB_MODEL } })
    const { PullRequestsView } = await import('../../src/renderer/pr-inbox/PrInboxView')
    const { openPrInboxOf } = await import('../../src/renderer/pr-inbox/open')
    render(<PullRequestsView />)
    await waitFor(() => expect(screen.getAllByTestId('pr-inbox-row').length).toBeGreaterThan(0))
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', { repo: WEB, number: 40 })
    })
    expect(selectedRows()).toEqual([`${WEB}#40`])
    await act(async () => Promise.resolve())
    expect(seenCalls()).toHaveLength(0)
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
