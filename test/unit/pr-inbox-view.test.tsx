// The Pull requests view and its entries (worfy-pr-inbox ticket 03; two panes since worfy-polish 96), over snapshots
// of `prInbox.get` in the shape main sends them (src/shared/ipc/pr-inbox.ts):
// - the view (src/renderer/pr-inbox/PrInboxView.tsx): the groups that hold a PR in the spec's order, a row of the list
//   with every field; the selected PR in the pane — what to do next, CI, review, merge state, size, "via team"; the
//   status line — the next search, why the last read failed, the snapshot's notice; the empty inbox;
// - selecting: the view's own choice tells main nothing and stays over a snapshot that reorders its group; a click,
//   ↑ / ↓ and an entry that names a PR tell main the PR was seen (`prInbox.markSeen`), and "N new since you looked"
//   goes; drafts are read for the selected PR only, and after ↓ a Send goes with the new PR; the strip's Send all opens
//   the dialog with every text;
// - openPrInboxOf with a PR: the view selects it, or says the PR is not in the inbox; another Project is selected
//   first;
// - the sidebar section (src/renderer/shell/sidebar/PullRequestsSection.tsx): the counts of the groups, a click
//   opens the view on that group;
// - the toolbar tab, the palette command, and the switch of Project settings.
// main is a fake preload bridge; every fixture is invented — owners, repositories, logins and texts. Nothing
// here reaches GitHub: of the `prInbox` channels the view sends only `prInbox.get`, `prInbox.markSeen` and, for the
// selected PR, `prInbox.drafts`; `prInbox.send` only from a click on Send or on Send all in its dialog (ADR-0105; the
// rest of Send is in test/unit/draft-thread.test.tsx).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { PrInboxBodyProps } from '../../src/renderer/pr-inbox/PrInboxView'
import type { PrInboxRow, PrInboxSnapshot, PrReplyDrafts, PrReplyItem } from '../../src/shared/ipc/pr-inbox'
import type { ProjectsState } from '../../src/shared/ipc/projects'
import type { AppSettings } from '../../src/shared/settings/app-settings'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const NOW = Date.parse('2026-11-10T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const ago = (ms: number): string => new Date(NOW - ms).toISOString()
const NOW_ISO = new Date(NOW).toISOString()

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

/** Answers of main by channel, in place of the fake's own; a promise answers later (worfy-polish 125: a read under way). */
type Answers = Record<string, (input: unknown) => IpcResult<unknown> | Promise<IpcResult<unknown>>>

/** This Machine's preload over the answers of main. `markSeen` answers the snapshot with that PR's new count at zero. */
function preload(options: { inbox: Record<string, PrInboxSnapshot>; models?: Record<string, WorkflowModel>; answers?: Answers }): void {
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
  const answer = (channel: string, input: unknown): IpcResult<unknown> | Promise<IpcResult<unknown>> => {
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
      // No build by the button under way (worfy-polish 122): "Code story" asks on mount.
      case 'stories.running':
        return { ok: true, value: null }
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

  it('name#N of a row: the repository name is its own part, cut by the stylesheet; #N stays whole', async () => {
    await body(snapshotOf('web-00000001'))
    const ref = within(rowOf(API, 118)).getByTestId('pr-inbox-ref')
    expect(ref.textContent).toBe('api#118')
    expect(within(ref).getByTestId('pr-inbox-ref-repo').textContent).toBe('api')
    expect(ref.getAttribute('title')).toBe(`${API}#118`)
  })

  it('the second line of a row gives way in order — the repository name, then the Epic name of the chip — and #N is never covered (jsdom lays nothing out: the sheet is read)', () => {
    const sheet = readFileSync(join(import.meta.dirname, '../../src/renderer/pr-inbox/pr-inbox.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
    const body = (selector: string) => {
      const at = sheet.indexOf(`\n${selector} {`)
      expect(at, selector).toBeGreaterThanOrEqual(0)
      return sheet.slice(at, sheet.indexOf('}', at))
    }
    // name#N never shrinks below #N (its name column adds nothing to its min-content width) and grows only into the
    // room the chip and the CI text leave at their full size: no flex basis.
    const ref = body('.w-pr-inbox-item__ref')
    expect(ref).toMatch(/display\s*:\s*grid/u)
    expect(ref).toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*auto\)\s+auto/u)
    expect(ref).toMatch(/flex\s*:\s*1 1 0\b/u)
    expect(ref).toMatch(/min-width\s*:\s*min-content/u)
    expect(ref).toMatch(/max-width\s*:\s*max-content/u)
    // The chip shrinks, its Epic name cut with an ellipsis, its number whole; the CI text never shrinks.
    const chip = body('.w-pr-inbox-ticket')
    expect(chip).toMatch(/min-width\s*:\s*0/u)
    expect(chip).toMatch(/overflow\s*:\s*hidden/u)
    expect(chip).not.toMatch(/flex\s*:\s*none/u)
    expect(body('.w-pr-inbox-ticket__epic')).toMatch(/text-overflow\s*:\s*ellipsis/u)
    expect(body('.w-pr-inbox-ticket__number')).toMatch(/flex\s*:\s*none/u)
    expect(sheet).not.toMatch(/\.w-pr-inbox-item__sub \.w-chip/u)
    // The last resort of a too narrow row: the line is cut at its own edge, never drawn under the age.
    expect(body('.w-pr-inbox-item__sub')).toMatch(/overflow\s*:\s*hidden/u)
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
    // The Ticket by its branch demo/07; the Epic's name is its own part, cut by the stylesheet; the whole ref and the
    // Ticket's title are the tooltip.
    expect(text(answer, 'pr-inbox-ticket')).toBe('demo 07')
    expect(text(answer, 'pr-inbox-ticket-epic')).toBe('demo')
    expect(within(answer).getByTestId('pr-inbox-ticket').getAttribute('title')).toBe('demo 07 — Upload retries')
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
    // No draft: Draft replies is the strip's main button, and only there.
    expect(within(next).getByTestId('pr-inbox-draft-replies').className).toContain('w-pr-inbox-button--primary')
    expect(within(pane()).getAllByTestId('pr-inbox-draft-replies')).toHaveLength(1)
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
    expect(within(next).getByTestId('pr-inbox-next-step-action').className).toContain('w-pr-inbox-button--primary')
    // Not a PR to answer: Draft replies stays in the row of actions.
    expect(within(next).queryByTestId('pr-inbox-draft-replies')).toBeNull()
    expect(within(pane()).getAllByTestId('pr-inbox-draft-replies')).toHaveLength(1)
    // More than one PR: the keys that move to the next one are shown.
    expect(within(pane()).queryByTestId('pr-inbox-keys-hint')).not.toBeNull()
    // Start review is a button of worfy now (worfy-pr-review ticket 09): Review mode, not the Files page on GitHub.
    expect(within(next).getByTestId('pr-inbox-next-step-action').getAttribute('href')).toBeNull()
    expect(within(next).getByTestId('pr-review-start-more').getAttribute('aria-label')).toBe('Choose who writes the review')
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
    // Red CI and changes asked: Fix checks, Address comments beside it, and Open checks a link (worfy-pr-follow ticket 04).
    expect(within(next).getAllByTestId('pr-inbox-follow').map((button) => button.textContent)).toEqual(['Fix checks', 'Address comments'])
    expect(within(next).getByTestId('pr-inbox-next-step-link').getAttribute('href')).toBe(`https://github.com/${WEB}/pull/40/checks`)
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

  it('one PR: it is selected and shown, its group alone in the list, with no hint of keys to a next PR', async () => {
    await body(snapshotOf('web-00000001', { groups: [{ group: 'waiting', rows: [ROWS.waiting] }] }))
    expect(groupTitles()).toEqual(['Waiting on others'])
    expect(selectedRows()).toEqual([`${WEB}#39`])
    expect(text(pane(), 'pr-inbox-pane-title')).toBe('Sketch the settings page')
    expect(within(pane()).getByText('No review threads.')).toBeTruthy()
    expect(within(pane()).queryByTestId('pr-inbox-keys-hint')).toBeNull()
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

  it('a PR whose Ticket has no story file — here a colleague\'s PR of no Ticket — has "Code story" that builds it by the button (worfy-code-stories ticket 11)', async () => {
    preload({ inbox: {}, answers: { 'stories.saved': () => ({ ok: true, value: null }), 'stories.make': () => ({ ok: true, value: { key: `${WEB}#41`, reused: false, outcome: { status: 'stopped' } } }) } })
    await body(snapshotOf('web-00000001'), [], { selected: `${WEB}#41` })
    const button = await within(pane()).findByTestId('pr-inbox-code-story')
    expect(button.textContent).toBe('Code story')
    // No story kept yet: nothing to build again.
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'stories.saved').map((call) => call.input)).toEqual([{ projectId: 'web-00000001', key: `${WEB}#41` }]))
    expect(within(pane()).queryByTestId('pr-inbox-code-story-rebuild')).toBeNull()
    fireEvent.click(button)
    expect(main.calls.filter((call) => call.channel === 'stories.make').map((call) => call.input)).toEqual([expect.objectContaining({ projectId: 'web-00000001', target: { kind: 'pr', repo: WEB, number: 41 } })])
    // "Code story" opens a kept story: only "Rebuild story" builds it anew.
    expect((main.calls.find((call) => call.channel === 'stories.make')!.input as { rebuild?: boolean }).rebuild).toBeUndefined()
    expect(await within(pane()).findByTestId('pr-inbox-code-story-progress')).toBeTruthy()
  })

  it('a build that failed says "Failed" with the reason; Close puts the button back with the focus on it', async () => {
    preload({ inbox: {}, answers: { 'stories.saved': () => ({ ok: true, value: null }), 'stories.make': () => ({ ok: true, value: { key: `${WEB}#41`, reused: false, outcome: { status: 'failed', reason: 'PR #41 changes nothing: its diff is empty.' } } }) } })
    await body(snapshotOf('web-00000001'), [], { selected: `${WEB}#41` })
    fireEvent.click(await within(pane()).findByTestId('pr-inbox-code-story'))
    const progress = await within(pane()).findByTestId('story-progress')
    await waitFor(() => expect(progress.dataset.state).toBe('failed'))
    expect(progress.textContent).toContain('Failed')
    expect(progress.textContent).not.toContain('Not available')
    expect(within(pane()).getByTestId('story-progress-reason').textContent).toBe('PR #41 changes nothing: its diff is empty.')
    const close = within(progress).getByRole('button', { name: 'Close' })
    close.focus()
    fireEvent.click(close)
    const button = await within(pane()).findByTestId('pr-inbox-code-story')
    await waitFor(() => expect(document.activeElement).toBe(button))
  })

  it('a PR with a story kept: "Rebuild story" builds it again in place of the kept one', async () => {
    preload({ inbox: {}, answers: { 'stories.saved': () => ({ ok: true, value: { savedAt: NOW_ISO, colleague: true, story: {}, answers: [] } }), 'stories.make': () => ({ ok: true, value: { key: `${WEB}#41`, reused: false, outcome: { status: 'stopped' } } }) } })
    await body(snapshotOf('web-00000001'), [], { selected: `${WEB}#41` })
    fireEvent.click(await within(pane()).findByTestId('pr-inbox-code-story-rebuild'))
    expect(main.calls.filter((call) => call.channel === 'stories.make').map((call) => call.input)).toEqual([expect.objectContaining({ target: { kind: 'pr', repo: WEB, number: 41 }, rebuild: true })])
  })
})

describe('the approvals chip in the row and the Approvals cell (worfy-pr-review ticket 03)', () => {
  const approvals = (extra: Partial<NonNullable<PrInboxRow['approvals']>> = {}): NonNullable<PrInboxRow['approvals']> => ({
    have: 1,
    need: 2,
    source: 'ruleset',
    codeOwnersPending: [],
    stale: 0,
    lastPushNeedsOther: false,
    moreRules: false,
    decision: 'review-required',
    reviewers: [],
    ...extra,
  })
  const FULL = approvals({
    decision: 'changes-requested',
    reviewers: [
      { login: ANA, kind: 'user', state: 'approved', counts: true, codeOwner: false },
      { login: BO, kind: 'user', state: 'changes-requested', counts: false, codeOwner: false },
      { login: ME, kind: 'user', state: 'commented', counts: false, codeOwner: false },
      { login: 'example-org/payments', kind: 'team', state: 'requested', counts: false, codeOwner: true },
      { login: 'dev-ed', kind: 'user', state: 'stale', counts: false, codeOwner: false },
      { login: 'dev-fi', kind: 'user', state: 'approved', counts: false, codeOwner: false },
    ],
  })
  const rowChip = (repo: string, number: number): HTMLElement | null => {
    const item = screen.getAllByTestId('pr-inbox-row').find((each) => each.dataset.repo === repo && each.dataset.number === String(number))!
    return within(item).queryByTestId('approvals-chip')
  }
  const withApprovals = (waiting: PrInboxRow['approvals'], ready: PrInboxRow['approvals'] = undefined) =>
    snapshotOf('web-00000001', {
      groups: [
        { group: 'waiting', rows: [{ ...ROWS.waiting, approvals: waiting }] },
        { group: 'ready', rows: [{ ...ROWS.ready, approvals: ready }] },
      ],
    })

  it('a row carries the chip on its right; none when nothing asks for reviews or main sent no approvals', async () => {
    await body(withApprovals(approvals({ reviewers: [{ login: ANA, kind: 'user', state: 'approved', counts: true, codeOwner: false }] }), approvals({ need: 0, source: 'none', decision: null })))
    const chip = rowChip(WEB, 39)!
    expect(chip.textContent).toBe('1/2')
    expect(chip.getAttribute('aria-label')).toBe('1 of 2 required approvals')
    expect(chip.getAttribute('title')).toBe(`1 of 2 required approvals · approved by @${ANA}`)
    expect(chip.closest('.w-pr-inbox-item__side')).not.toBeNull()
    expect(rowChip(API, 120)).toBeNull()
    cleanup()
    await body(snapshotOf('web-00000001'))
    expect(screen.queryAllByTestId('approvals-chip')).toEqual([])
  })

  it('the Review cell becomes Approvals: the chip, its line and every reviewer with their state', async () => {
    await body(withApprovals(FULL), TICKETS, { selected: `${WEB}#39` })
    expect(screen.queryByTestId('pr-inbox-review')).toBeNull()
    const cell = fact('approvals')
    expect(within(cell).getByTestId('approvals-chip').textContent).toBe('✕ 1/2')
    expect(within(cell).getByTestId('approvals-chip').className).toContain('w-approvals-chip--large')
    expect(text(cell, 'pr-inbox-approvals-note')).toBe('changes requested')
    const reviewers = within(cell).getAllByTestId('pr-inbox-reviewer')
    expect(reviewers.map((each) => [each.dataset.login, each.dataset.state, text(each, 'pr-inbox-reviewer-state')])).toEqual([
      [ANA, 'approved', 'Approved'],
      [BO, 'changes-requested', 'Changes requested'],
      [ME, 'commented', 'Commented'],
      ['example-org/payments', 'requested', 'Requested'],
      ['dev-ed', 'stale', 'Approved · stale'],
      ['dev-fi', 'approved', 'Approved · does not count'],
    ])
    expect(reviewers[2]!.textContent).toContain('(you)')
    expect(text(reviewers[3]!, 'pr-inbox-reviewer-owner')).toBe('code owner')
    expect(text(reviewers[4]!, 'pr-inbox-reviewer-why')).toBe('before the last push; the rule drops it')
    expect(text(reviewers[5]!, 'pr-inbox-reviewer-why')).toBe('no write access to the repository')
    expect(reviewers[5]!.dataset.tone).toBe('muted')
    // The pane's header carries the chip with its word too, as the prototype draws it.
    expect(within(pane()).getAllByTestId('approvals-chip')[0]!.textContent).toBe('✕ 1/2 approvals')
  })

  it('no review rule: «No review rule · 1 approval», no chip; no reviewer yet: says so', async () => {
    await body(withApprovals(approvals({ need: 0, source: 'none', decision: null, reviewers: [] })), TICKETS, { selected: `${WEB}#39` })
    const cell = fact('approvals')
    expect(within(cell).queryByTestId('approvals-chip')).toBeNull()
    expect(text(cell, 'pr-inbox-approvals-note')).toBe('No review rule · 1 approval')
    expect(text(cell, 'pr-inbox-reviewers-empty')).toBe('No reviewers asked yet.')
  })

  it('a Project machine that sends no approvals: the Review cell as before', async () => {
    await body(withApprovals(undefined), TICKETS, { selected: `${WEB}#39` })
    expect(screen.queryByTestId('pr-inbox-approvals-note')).toBeNull()
    expect(screen.getAllByTestId('pr-inbox-fact').map((each) => each.dataset.fact)).toEqual(['ci', 'review', 'merge', 'size'])
  })
})

describe('the chips of the facts are the Chip of their tone, each with its icon (worfy-ui-kit ticket 16)', () => {
  it.each([
    ['CLEAN', 'Mergeable', 'w-chip--ready', null],
    ['BEHIND', 'Behind the base', 'w-chip--blocked', null],
    ['BLOCKED', 'Blocked', 'w-chip--open', null],
    ['DIRTY', 'Conflicts', 'w-chip--blocked', 'w-pr-inbox-chip--problem'],
  ] as const)('the merge state %s: «%s», %s', async (status, word, variant, extra) => {
    const review = { ...ROWS.review, mergeStateStatus: status }
    await body(snapshotOf('web-00000001', { groups: [{ group: 'needs-review', rows: [review] }] }), TICKETS, { selected: `${WEB}#41` })
    const chip = within(fact('merge')).getByTestId('pr-inbox-merge').querySelector<HTMLElement>('.w-chip')!
    expect(chip.textContent).toBe(word)
    expect(chip.classList.contains(variant)).toBe(true)
    if (extra !== null) expect(chip.classList.contains(extra)).toBe(true)
    expect(chip.firstElementChild?.matches('svg, .w-chip__dot')).toBe(true)
  })

  it('a review still owed is the neutral Chip with the open circle', async () => {
    await body(snapshotOf('web-00000001'), TICKETS, { selected: `${WEB}#41` })
    const chip = within(fact('review')).getByTestId('pr-inbox-review').querySelector<HTMLElement>('.w-chip')!
    expect(chip.textContent).toBe('Review required')
    expect(chip.classList.contains('w-chip--open')).toBe(true)
    expect(chip.querySelector('svg circle')).not.toBeNull()
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
    // Two drafts or more: Send all; one: its Send under the thread, no button of the strip; none: Draft replies.
    expect(nextStep('needs-answer', ROWS.answer, NOW, 2, true, ME)).toMatchObject({ text: '2 draft replies are ready below: read, edit, then send each or all.', action: { kind: 'send-all', count: 2 } })
    expect(nextStep('needs-answer', ROWS.answer, NOW, 1, true, ME)).toMatchObject({ text: '1 draft reply is ready below: read, edit, then Send under its thread.', action: null })
    expect(nextStep('needs-answer', ROWS.answer, NOW, 0, true, ME)).toMatchObject({ text: 'No drafts yet: Draft replies starts a Session that writes them.', action: { kind: 'draft-replies' } })
    // A Linked machine: no drafts here, no button.
    expect(nextStep('needs-answer', ROWS.answer, NOW, 0, false, ME)).toMatchObject({ text: 'Drafts of replies stay on the machine of the Project.', action: null })
    expect(nextStep('needs-answer', { ...ROWS.answer, unresolvedThreads: 0 }, NOW, 0, true, ME).title).toBe('Your answer is awaited')
    expect(nextStep('needs-answer', { ...ROWS.answer, unresolvedThreads: 1 }, NOW, 0, true, ME).title).toBe('Answer 1 open thread')
  })

  it('nextStep of a PR to fix names what is wrong; its first reason is the main button, the others beside it, and Open checks stays a link (worfy-pr-follow ticket 04)', async () => {
    const { nextStep } = await load()
    const fix = (over: Partial<PrInboxRow>) => nextStep('needs-fix', { ...ROWS.fix, ci: 'passing', reviewDecision: null, mergeStateStatus: 'CLEAN', ...over }, NOW, 0, true, ME)
    const checks = { kind: 'link', label: 'Open checks', url: `${ROWS.fix.url}/checks` }
    const follow = (action: string) => ({ kind: 'pr-follow', action })
    // In conflict and red: a PR in conflict runs no CI, so Resolve conflicts comes first.
    expect(fix({ mergeStateStatus: 'DIRTY', ci: 'failing' })).toEqual({
      tone: 'fix',
      title: 'Merge conflict and CI failing',
      text: 'Resolve conflicts hands the conflict with the base branch to a Session; it asks before it pushes.',
      action: follow('resolveConflicts'),
      more: [follow('fixChecks'), checks],
    })
    expect(fix({ ci: 'failing' })).toMatchObject({ title: 'CI failing', text: 'Fix checks hands the failing checks to a Session; it asks before it pushes.', action: follow('fixChecks'), more: [checks] })
    expect(fix({ reviewDecision: 'CHANGES_REQUESTED' })).toMatchObject({
      title: 'Changes requested',
      text: 'Address comments hands the requested changes to a Session: it edits the code, drafts the replies and asks before it pushes.',
      action: follow('addressComments'),
      more: [checks],
    })
    expect(fix({ ci: 'failing', reviewDecision: 'CHANGES_REQUESTED' })).toMatchObject({ title: 'CI failing and changes requested', action: follow('fixChecks'), more: [follow('addressComments'), checks] })
    expect(fix({ mergeStateStatus: 'DIRTY' })).toMatchObject({ title: 'Merge conflict', action: follow('resolveConflicts'), more: [checks] })
    // No reason worfy can hand to a Session: the checks are the one button, as before.
    expect(fix({ mergeStateStatus: 'BLOCKED' })).toEqual({ tone: 'fix', title: 'Needs a fix', text: 'Look at the PR on GitHub.', action: checks, more: [] })
    expect(nextStep('waiting', { ...ROWS.waiting, isDraft: false }, NOW, 0, true, ME).title).toBe('Waiting for reviewers')
  })

  it('nextStep of my PR that waits for an answer puts Address comments beside Draft replies; a colleague\'s PR gets none', async () => {
    const { nextStep } = await load()
    expect(nextStep('needs-answer', ROWS.answer, NOW, 0, true, ME)).toMatchObject({ action: { kind: 'draft-replies' }, more: [{ kind: 'pr-follow', action: 'addressComments' }] })
    // Drafts or none, the button stays: the Session edits the code too.
    expect(nextStep('needs-answer', ROWS.answer, NOW, 2, true, ME).more).toEqual([{ kind: 'pr-follow', action: 'addressComments' }])
    expect(nextStep('needs-answer', { ...ROWS.answer, author: ANA }, NOW, 0, true, ME).more).toEqual([])
    // No login read yet: whose PR it is is not known.
    expect(nextStep('needs-answer', ROWS.answer, NOW, 0, true, null).more).toEqual([])
    // Every other group has no button of pr-fix.
    expect(nextStep('needs-review', ROWS.review, NOW, 0, true, ME).more).toEqual([])
    expect(nextStep('ready', ROWS.ready, NOW, 0, true, ME).more).toEqual([])
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

  // worfy-auth-check ticket 07: GitHub refused the sign-in — the reason of the Project's GitHub access row and Health check one click away.
  it('a refused sign-in says the reason in plain words, and "Open Health check" opens Settings on Health', async () => {
    const { useSettingsWindow } = await import('../../src/renderer/settings/settings-window')
    useSettingsWindow.setState({ open: false, section: null })
    await body(snapshotOf('web-00000001', { error: 'GH_TOKEN from the environment does not work (HTTP 401)', signInFailed: true }))
    const row = screen.getByTestId('pr-inbox-error')
    expect(row.textContent).toBe('GitHub refused the sign-in: GH_TOKEN from the environment does not work (HTTP 401) Open Health check')
    fireEvent.click(within(row).getByRole('button', { name: 'Open Health check' }))
    expect(useSettingsWindow.getState()).toEqual({ open: true, section: 'HealthSection' })
  })

  it('a failure that is not the sign-in has no Health check link', async () => {
    await body(snapshotOf('web-00000001', { error: 'error connecting to api.github.com', signInFailed: false }))
    expect(screen.queryByTestId('pr-inbox-health')).toBeNull()
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
async function view(inbox: Record<string, PrInboxSnapshot> = { 'web-00000001': snapshotOf('web-00000001') }, answers?: Answers) {
  preload({ inbox, models: { [WEB_ROOT]: WEB_MODEL }, answers })
  const { PullRequestsView } = await import('../../src/renderer/pr-inbox/PrInboxView')
  const shown = render(<PullRequestsView />)
  await waitFor(() => expect(screen.getAllByTestId('pr-inbox-row').length).toBeGreaterThan(0))
  return shown
}

describe('Start review (worfy-pr-review ticket 09)', () => {
  /** The answers Review mode reads: one file of the PR, and the draft Start review creates. */
  const reviewAnswers: Answers = {
    'changes.list': () => ({
      ok: true,
      value: {
        repos: [
          {
            repo: WEB,
            kind: 'pr',
            branch: '#41',
            scope: 'all',
            base: null,
            headSha: 'abc1234',
            workTree: false,
            files: [{ path: 'src/export.ts', oldPath: null, status: 'A', additions: 1, deletions: 0, binary: false, oldMode: null, newMode: '100644', oldBlob: null, newBlob: 'b1', untracked: false, workflow: false, fold: null }],
            additions: 1,
            deletions: 0,
            error: null,
            source: 'github',
            truncatedAt: null,
          },
        ],
      },
    }),
    'changes.file': () => ({ ok: true, value: { file: { kind: 'hunks', path: 'src/export.ts', oldPath: null, oldMode: null, newMode: null, whole: false, hunks: [] } } }),
    'prReview.draft': () => ({ ok: true, value: { repo: WEB, pr: 41, draft: null, problem: null } }),
    'prReview.start': (input) => ({ ok: true, value: { repo: WEB, pr: 41, draft: { schema: 1, repo: WEB, pr: 41, startedOn: (input as { head: string }).head, payload: { body: '', comments: [] }, anchors: [], viewed: {}, state: 'draft' }, problem: null } }),
  }
  const reviewed = (): PrInboxSnapshot => {
    const snapshot = snapshotOf('web-00000001')
    return { ...snapshot, groups: snapshot.groups.map((group) => ({ ...group, rows: group.rows.map((each) => (each.number === 41 ? { ...each, headRefOid: 'abc1234', baseRefOid: 'def5678', baseRefName: 'main' } : each)) })) }
  }

  it('Start review → Review myself: Review mode in the pane\'s place, the list folded into a column; ← Inbox gives the list back', async () => {
    await view({ 'web-00000001': reviewed() }, reviewAnswers)
    select(WEB, 41)
    fireEvent.click(within(pane()).getByTestId('pr-review-start-more'))
    fireEvent.click(await screen.findByTestId('pr-review-start-myself'))
    const mode = await screen.findByTestId('pr-review-mode')
    expect(mode.dataset.number).toBe('41')
    expect(screen.queryByTestId('pr-inbox-pane')).toBeNull()
    expect(screen.queryByTestId('pr-inbox-list')).toBeNull()
    const column = screen.getByTestId('pr-review-column')
    expect(within(column).getByTestId('pr-review-back').textContent).toBe('←Inbox')
    expect(within(column).getAllByTestId('pr-review-column-item').map((each) => each.textContent?.endsWith(`#${each.dataset.number}`))).not.toContain(false)
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'prReview.start')).toHaveLength(1))
    expect(main.calls.find((call) => call.channel === 'changes.list')?.input).toMatchObject({ subject: { kind: 'pr', repo: WEB, number: 41, headOid: 'abc1234', baseOid: 'def5678' } })
    // ↑ ↓ move along the files of Review mode, not along the list.
    key('ArrowDown')
    expect(within(column).getByRole('button', { current: true }).dataset.number).toBe('41')
    fireEvent.click(within(column).getByTestId('pr-review-back'))
    expect(screen.queryByTestId('pr-review-mode')).toBeNull()
    expect(text(pane(), 'pr-inbox-pane-title')).toBe('Add the export button')
  })
})

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

  it('a comment body reads as GitHub markdown: bold, a list, a code block, #N of the PR repository, a newline as a line break, raw HTML as text (worfy-polish ticket 104)', async () => {
    const body = ['**Two things** before merge:', '', '- rename `tryUpload`', '- see #12', '', '```ts', 'const tries = 3', '```', '', '<details>open</details>'].join('\n')
    const marked = { ...ROWS.answer, threads: [{ id: 'T1', isResolved: false, isOutdated: false, path: 'src/upload.ts', line: 12, viewerCanReply: true, comments: [comment('C11', ANA, ago(HOUR), body)] }], comments: [comment('C91', BO, ago(HOUR), 'Thanks @dev-ana,\nsee #3')] }
    await view({ 'web-00000001': snapshotOf('web-00000001', { groups: [{ group: 'needs-answer', rows: [marked] }] }) })
    const shown = within(within(pane()).getAllByTestId('pr-inbox-thread')[0]!).getByTestId('pr-inbox-comment-body')
    expect(shown.querySelector('strong')?.textContent).toBe('Two things')
    expect([...shown.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['rename tryUpload', 'see #12'])
    expect(shown.querySelector('pre > code')?.textContent).toBe('const tries = 3\n')
    expect(shown.querySelector('details')).toBeNull()
    expect(shown.textContent).toContain('<details>open</details>')
    fireEvent.click(within(shown).getByText('#12'))
    expect(main.calls).toContainEqual({ channel: 'shell.openExternal', input: { url: `https://github.com/${API}/issues/12` } })
    // The conversation too: a mention links to the person on GitHub.
    const conversation = within(pane()).getByRole('region', { name: 'Conversation' })
    expect(within(conversation).getByText('@dev-ana').getAttribute('href')).toBe(`https://github.com/${ANA}`)
    expect(within(conversation).getByText('#3').getAttribute('href')).toBe(`https://github.com/${API}/issues/3`)
    // A single newline in a comment is a line break, as GitHub shows it.
    expect(within(conversation).getByTestId('pr-inbox-comment-body').querySelector('p > br')).not.toBeNull()
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

  // Two PRs that wait for an answer, each with a thread and its draft reply: X (api#118) first, Y (web#40) second.
  const X = { ...ROWS.answer, lastActivityAt: ago(HOUR) }
  const Y = row(WEB, 40, {
    title: 'Fix the date picker',
    unresolvedThreads: 1,
    lastActivityAt: ago(3 * HOUR),
    threads: [{ id: 'T5', isResolved: false, isOutdated: false, path: 'src/date.ts', line: 7, viewerCanReply: true, comments: [comment('C51', BO, ago(3 * HOUR), 'Which zone?')] }],
  })
  const answering = (rows: PrInboxRow[]): PrInboxSnapshot => snapshotOf('web-00000001', { groups: [{ group: 'needs-answer', rows }] })
  const draftItem = (index: number, threadId: string, body: string): PrReplyItem => ({
    index,
    kind: 'thread',
    threadId,
    replyTo: 500 + index,
    label: 'needs answer',
    body,
    fixPlan: null,
    state: 'draft',
    sentUrl: null,
    error: null,
    edited: false,
  })
  const DRAFTS: Record<number, PrReplyItem[]> = { 118: [draftItem(0, 'T1', 'Draft for 118')], 40: [draftItem(0, 'T5', 'Draft for 40')] }
  const draftsOf = (repo: string, pr: number): PrReplyDrafts => ({ repo, pr, headOid: 'abc1234', items: DRAFTS[pr] ?? [], problem: null })
  const draftsAnswer = (input: unknown): IpcResult<unknown> => {
    const { repo, number } = input as { repo: string; number: number }
    return { ok: true, value: draftsOf(repo, number) }
  }

  it("the view's own pick stays over a snapshot that reorders its group: the typed text of its draft stays, and it is not marked seen", async () => {
    await view({ 'web-00000001': answering([X, Y]) }, { 'prInbox.drafts': draftsAnswer })
    expect(selectedRows()).toEqual([`${API}#118`])
    const field = (await within(pane()).findByTestId('pr-draft-field')) as HTMLTextAreaElement
    expect(field.value).toBe('Draft for 118')
    fireEvent.change(field, { target: { value: 'Typed by me, not saved yet' } })
    // A reviewer comments on Y: main sorts Y first.
    main.inbox['web-00000001'] = answering([{ ...Y, lastActivityAt: ago(MIN), newSinceSeen: 1 }, X])
    await act(async () => main.emit('prInbox.changed', { projectId: 'web-00000001' }))
    await waitFor(() => expect(screen.getAllByTestId('pr-inbox-row').map((each) => each.dataset.number)).toEqual(['40', '118']))
    expect(selectedRows()).toEqual([`${API}#118`])
    expect(pane().dataset.number).toBe('118')
    expect((within(pane()).getByTestId('pr-draft-field') as HTMLTextAreaElement).value).toBe('Typed by me, not saved yet')
    // X is merged and leaves the snapshot: the view picks again, still without telling main.
    main.inbox['web-00000001'] = answering([{ ...Y, lastActivityAt: ago(MIN) }])
    await act(async () => main.emit('prInbox.changed', { projectId: 'web-00000001' }))
    await waitFor(() => expect(pane().dataset.number).toBe('40'))
    expect(selectedRows()).toEqual([`${WEB}#40`])
    // X back again (a reopened PR) does not take the pane from Y.
    main.inbox['web-00000001'] = answering([X, Y])
    await act(async () => main.emit('prInbox.changed', { projectId: 'web-00000001' }))
    await waitFor(() => expect(screen.getAllByTestId('pr-inbox-row')).toHaveLength(2))
    expect(pane().dataset.number).toBe('40')
    await act(async () => Promise.resolve())
    expect(seenCalls()).toEqual([])
  })

  it('after ↓ the pane is the new PR\'s from the start: no draft of the last one shows, and Send goes with the new repository, number and text', async () => {
    let release: () => void = () => undefined
    const late = new Promise<void>((resolve) => (release = resolve))
    const answers = {
      'prInbox.drafts': (input: unknown) => {
        const { repo, number } = input as { repo: string; number: number }
        // The drafts of Y come late: until then the pane must not show X's.
        return (number === 40 ? late.then(() => ({ ok: true, value: draftsOf(repo, number) })) : { ok: true, value: draftsOf(repo, number) }) as never
      },
      'prInbox.send': (input: unknown): IpcResult<unknown> => {
        const { repo, number } = input as { repo: string; number: number }
        return { ok: true, value: { results: [], drafts: draftsOf(repo, number) } }
      },
    }
    await view({ 'web-00000001': answering([X, Y]) }, answers)
    await within(pane()).findByTestId('pr-draft')
    key('ArrowDown')
    expect(pane().dataset.number).toBe('40')
    await act(async () => Promise.resolve())
    expect(within(pane()).queryByTestId('pr-draft')).toBeNull()
    expect(within(pane()).queryByText('Draft for 118')).toBeNull()
    await act(async () => release())
    const field = (await within(pane()).findByTestId('pr-draft-field')) as HTMLTextAreaElement
    expect(field.value).toBe('Draft for 40')
    expect(main.calls.filter((call) => call.channel === 'prInbox.send')).toEqual([])
    fireEvent.click(within(pane()).getByTestId('pr-draft-send'))
    await waitFor(() => expect(main.calls.filter((call) => call.channel === 'prInbox.send')).toHaveLength(1))
    expect(main.calls.find((call) => call.channel === 'prInbox.send')?.input).toEqual({
      projectId: 'web-00000001',
      repo: WEB,
      number: 40,
      items: [{ index: 0, kind: 'thread', threadId: 'T5', base: 'Draft for 40', body: 'Draft for 40' }],
    })
  })

  it('the strip of a PR with two drafts or more: Send all (N) opens the dialog with every text, and only its own Send all posts', async () => {
    const answer = { ...X, unresolvedThreads: 2 }
    DRAFTS[118] = [draftItem(0, 'T1', 'Draft for 118'), draftItem(1, 'T2', 'Second draft for 118')]
    try {
      await view({ 'web-00000001': answering([answer]) }, {
        'prInbox.drafts': draftsAnswer,
        'prInbox.send': (input: unknown) => {
          const { repo, number } = input as { repo: string; number: number }
          return { ok: true, value: { results: [], drafts: draftsOf(repo, number) } }
        },
      })
      const next = within(pane()).getByTestId('pr-inbox-next-step')
      const button = await within(next).findByTestId('pr-inbox-next-step-action')
      expect(button.textContent).toBe('Send all (2)')
      expect(button.className).toContain('w-pr-inbox-button--primary')
      expect(next.textContent).toContain('2 draft replies are ready below')
      // With drafts the strip carries Send all, not Draft replies.
      expect(within(next).queryByTestId('pr-inbox-draft-replies')).toBeNull()
      fireEvent.change(within(pane()).getAllByTestId('pr-draft-field')[0]!, { target: { value: 'Edited first' } })
      fireEvent.click(button)
      const dialog = screen.getByTestId('pr-send-all-dialog')
      expect(within(dialog).getAllByTestId('pr-send-all-text').map((each) => each.textContent)).toEqual(['Edited first', 'Second draft for 118'])
      await act(async () => Promise.resolve())
      expect(main.calls.filter((call) => call.channel === 'prInbox.send')).toEqual([])
      fireEvent.click(within(dialog).getByTestId('pr-send-all-cancel'))
      expect(screen.queryByTestId('pr-send-all-dialog')).toBeNull()
      fireEvent.click(within(next).getByTestId('pr-inbox-next-step-action'))
      fireEvent.click(within(screen.getByTestId('pr-send-all-dialog')).getByTestId('pr-send-all-confirm'))
      await waitFor(() => expect(main.calls.filter((call) => call.channel === 'prInbox.send')).toHaveLength(1))
      const sent = main.calls.find((call) => call.channel === 'prInbox.send')?.input as { repo: string; number: number; items: { body: string }[] }
      expect([sent.repo, sent.number, sent.items.map((each) => each.body)]).toEqual([API, 118, ['Edited first', 'Second draft for 118']])
    } finally {
      DRAFTS[118] = [draftItem(0, 'T1', 'Draft for 118')]
    }
  })

  it('the strip of a PR with one draft has no button: its Send is under its thread', async () => {
    await view({ 'web-00000001': answering([X, Y]) }, { 'prInbox.drafts': draftsAnswer })
    await within(pane()).findByTestId('pr-draft')
    const next = within(pane()).getByTestId('pr-inbox-next-step')
    await waitFor(() => expect(next.textContent).toContain('1 draft reply is ready below: read, edit, then Send under its thread.'))
    expect(within(next).queryByTestId('pr-inbox-next-step-action')).toBeNull()
    expect(within(next).queryByTestId('pr-inbox-draft-replies')).toBeNull()
    expect(within(pane()).getByTestId('pr-draft-send')).toBeTruthy()
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
    await act(async () => main.emit('projects.settings.changed', { id: 'web-00000001', settings: { actionTemplates: { shipTicket: '', runWave: '', gateQueue: '', prReply: '', fixChecks: '', resolveConflicts: '', addressComments: '' }, prInbox: false } }))
    await waitFor(() => expect(screen.getByTestId('pr-inbox-off')).toBeTruthy())
    expect(screen.queryAllByTestId('pr-inbox-row')).toHaveLength(0)
    expect(screen.queryByTestId('pr-inbox-pane')).toBeNull()
  })
})

// worfy-polish 125: the view asks main to read GitHub now each time it is shown — the toolbar tab, an entry that opens
// it, another Project while it is shown — and says it is reading, with the time of the last read, until main answers.
// Whether main reads (30 seconds, the rate limit, the switch) is main's: test/contract/pr-inbox.test.ts.
describe('the read on opening the view (worfy-polish 125)', () => {
  const openReads = (): unknown[] => main.calls.filter((call) => call.channel === 'prInbox.get' && (call.input as { opened?: boolean }).opened === true).map((call) => call.input)

  it('the view mounted hidden asks for no read; each time it is shown it asks main to read the Project now', async () => {
    await view()
    const { setView } = await import('../../src/renderer/session/navigation')
    expect(openReads()).toEqual([])
    await act(async () => setView('pull-requests'))
    await waitFor(() => expect(openReads()).toEqual([{ projectId: 'web-00000001', opened: true }]))
    // Shown again after another view: another ask; main decides whether it reads.
    await act(async () => setView('canvas'))
    await act(async () => setView('pull-requests'))
    await waitFor(() => expect(openReads()).toHaveLength(2))
    // A new snapshot while it stays shown asks nothing more.
    await act(async () => main.emit('prInbox.changed', { projectId: 'web-00000001' }))
    await act(async () => Promise.resolve())
    expect(openReads()).toHaveLength(2)
  })

  it('an entry that opens the view (palette, notification, sidebar) asks for the read too, and so does another Project shown in it', async () => {
    preload({ inbox: { 'web-00000001': snapshotOf('web-00000001'), 'ops-00000002': snapshotOf('ops-00000002') }, models: { [WEB_ROOT]: WEB_MODEL } })
    const { PullRequestsView } = await import('../../src/renderer/pr-inbox/PrInboxView')
    const { openPrInboxOf } = await import('../../src/renderer/pr-inbox/open')
    render(<PullRequestsView />)
    await waitFor(() => expect(screen.getAllByTestId('pr-inbox-view')).toHaveLength(1))
    await act(async () => {
      await openPrInboxOf('web-00000001', 'web-00000001', { repo: WEB, number: 40 })
    })
    await waitFor(() => expect(openReads()).toEqual([{ projectId: 'web-00000001', opened: true }]))
    await act(async () => {
      await openPrInboxOf('ops-00000002', 'web-00000001')
    })
    await waitFor(() =>
      expect(openReads()).toEqual([
        { projectId: 'web-00000001', opened: true },
        { projectId: 'ops-00000002', opened: true },
      ]),
    )
  })

  it('while main reads, the status line says it is reading and keeps the time of the last read; the answer brings the next search back', async () => {
    let answer: (result: IpcResult<unknown>) => void = () => undefined
    const fresh = snapshotOf('web-00000001', { readAt: NOW_ISO, nextSearchAt: new Date(NOW + 5 * MIN).toISOString() })
    await view(
      { 'web-00000001': snapshotOf('web-00000001', { readAt: ago(3 * MIN) }) },
      {
        'prInbox.get': (input) =>
          (input as { opened?: boolean }).opened === true
            ? new Promise<IpcResult<unknown>>((resolve) => {
                answer = resolve
              })
            : { ok: true, value: main.inbox['web-00000001'] },
      },
    )
    const { setView } = await import('../../src/renderer/session/navigation')
    expect(screen.queryByTestId('pr-inbox-reading')).toBeNull()
    await act(async () => setView('pull-requests'))
    await waitFor(() => expect(screen.getByTestId('pr-inbox-reading').textContent).toBe('Reading pull requests…'))
    expect(screen.getByTestId('pr-inbox-read-at').textContent).toBe('Last read 3m ago')
    expect(screen.queryByTestId('pr-inbox-next')).toBeNull()
    // The rows stay while it reads.
    expect(screen.getAllByTestId('pr-inbox-row').length).toBeGreaterThan(0)

    await act(async () => answer({ ok: true, value: fresh }))
    await waitFor(() => expect(screen.queryByTestId('pr-inbox-reading')).toBeNull())
    expect(screen.queryByTestId('pr-inbox-read-at')).toBeNull()
    expect(screen.getByTestId('pr-inbox-next').textContent).toBe('Next search in 5 min')
  })

  it('a read on opening that main refuses ends the reading line and keeps the rows', async () => {
    await view(undefined, {
      'prInbox.get': (input) => ((input as { opened?: boolean }).opened === true ? { ok: false, error: 'not a Project of this Machine' } : { ok: true, value: main.inbox['web-00000001'] }),
    })
    const { setView } = await import('../../src/renderer/session/navigation')
    await act(async () => setView('pull-requests'))
    await waitFor(() => expect(openReads()).toHaveLength(1))
    await act(async () => Promise.resolve())
    expect(screen.queryByTestId('pr-inbox-reading')).toBeNull()
    expect(screen.getAllByTestId('pr-inbox-row').length).toBeGreaterThan(0)
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

describe('Fix checks, Resolve conflicts and Address comments in the pane (worfy-pr-follow ticket 04)', () => {
  /** A head of 40 hex characters, as {sha} takes it. */
  const HEAD = '3f2a9c1'.padEnd(40, '0')
  const TEMPLATES = {
    shipTicket: '/worfy:ship-ticket {epic} {NN}',
    runWave: '/worfy:epic-wave {wave} {epic}',
    gateQueue: '',
    prReply: '/worfy:pr-reply {repo}#{pr}',
    fixChecks: '/worfy:pr-fix checks {repo}#{pr} {sha}',
    resolveConflicts: '/worfy:pr-fix conflicts {repo}#{pr} {sha}',
    addressComments: '/worfy:pr-fix comments {repo}#{pr} {sha}',
  }
  /** web#40 of demo 03: in conflict with its base and red, mine. */
  const CONFLICT = row(WEB, 40, { title: 'Fix the date picker', headRefOid: HEAD, ci: 'failing', mergeStateStatus: 'DIRTY' })
  const ANSWER = { ...ROWS.answer, headRefOid: HEAD }
  const inbox = (rows: PrInboxRow[], group: 'needs-fix' | 'needs-answer' = 'needs-fix') => snapshotOf('web-00000001', { groups: [{ group, rows }] })
  const settingsAnswer = (templates: Partial<typeof TEMPLATES> = {}) => ({
    'projects.settings.get': () => ({ ok: true as const, value: { actionTemplates: { ...TEMPLATES, ...templates }, prInbox: true } }),
  })
  const follow = (action: string): HTMLElement => {
    const found = within(pane())
      .queryAllByTestId('pr-inbox-follow')
      .find((each) => each.dataset.action === action)
    if (!found) throw new Error(`no button ${action}`)
    return found
  }
  /** The pane of `snapshot`, with main's PR inbox answering the same snapshot: usePrFollowState reads the login there. */
  const show = async (snapshot: PrInboxSnapshot, answers: Record<string, (input: unknown) => IpcResult<unknown>>): Promise<void> => {
    preload({ inbox: { 'web-00000001': snapshot }, answers })
    await body(snapshot)
  }
  const followCalls = (): unknown[] => main.calls.filter((call) => call.channel === 'actions.prFollow').map((call) => call.input)
  const shownToasts = async () => {
    const { toasts } = await import('../../src/renderer/toast/toasts')
    return toasts.getState().toasts.map((toast) => ({ kind: toast.kind, text: toast.text }))
  }

  it('a PR in conflict and red: Resolve conflicts is the main button, Fix checks beside it, Open checks a link; each shows the text it sends', async () => {
    await show(inbox([CONFLICT]), settingsAnswer())
    const next = within(pane()).getByTestId('pr-inbox-next-step')
    expect(text(next, 'pr-inbox-next-step-title')).toBe('Merge conflict and CI failing')
    expect(next.textContent).toContain('Resolve conflicts hands the conflict with the base branch to a Session; it asks before it pushes.')
    expect(within(next).getAllByTestId('pr-inbox-follow').map((button) => button.textContent)).toEqual(['Resolve conflicts', 'Fix checks'])
    expect(follow('resolveConflicts').className).toContain('w-pr-inbox-button--primary')
    expect(follow('fixChecks').className).not.toContain('w-pr-inbox-button--primary')
    const checks = within(next).getByTestId('pr-inbox-next-step-link')
    expect(checks.textContent).toBe('Open checks')
    expect(checks.tagName).toBe('A')
    expect(checks.getAttribute('href')).toBe(`https://github.com/${WEB}/pull/40/checks`)
    // The buttons come before the link, in the order of the reasons.
    expect([...next.querySelectorAll('[data-testid="pr-inbox-follow"], [data-testid="pr-inbox-next-step-link"]')].map((each) => each.textContent)).toEqual(['Resolve conflicts', 'Fix checks', 'Open checks'])
    await waitFor(() => expect(follow('fixChecks').getAttribute('aria-disabled')).toBe('false'))
    expect(follow('fixChecks').title).toBe(`/worfy:pr-fix checks ${WEB}#40 ${HEAD}`)
    expect(follow('resolveConflicts').title).toBe(`/worfy:pr-fix conflicts ${WEB}#40 ${HEAD}`)
    // Showing the buttons sends nothing.
    expect(followCalls()).toEqual([])
  })

  it('red CI alone: Fix checks; changes requested alone: Address comments', async () => {
    await show(inbox([{ ...CONFLICT, mergeStateStatus: 'UNSTABLE' }]), settingsAnswer())
    let next = within(pane()).getByTestId('pr-inbox-next-step')
    expect(within(next).getAllByTestId('pr-inbox-follow').map((button) => button.textContent)).toEqual(['Fix checks'])
    expect(text(next, 'pr-inbox-next-step-link')).toBe('Open checks')
    cleanup()

    await show(inbox([{ ...CONFLICT, ci: 'passing', mergeStateStatus: 'BLOCKED', reviewDecision: 'CHANGES_REQUESTED' }]), settingsAnswer())
    next = within(pane()).getByTestId('pr-inbox-next-step')
    expect(within(next).getAllByTestId('pr-inbox-follow').map((button) => button.textContent)).toEqual(['Address comments'])
    expect(follow('addressComments').className).toContain('w-pr-inbox-button--primary')
    expect(text(next, 'pr-inbox-next-step-link')).toBe('Open checks')
  })

  it('my PR in Needs my answer: Address comments right beside Draft replies', async () => {
    await show(inbox([ANSWER], 'needs-answer'), settingsAnswer())
    const next = within(pane()).getByTestId('pr-inbox-next-step')
    const draft = within(next).getByTestId('pr-inbox-draft-replies')
    expect(draft.nextElementSibling).toBe(follow('addressComments'))
    expect(follow('addressComments').textContent).toBe('Address comments')
    await waitFor(() => expect(follow('addressComments').getAttribute('aria-disabled')).toBe('false'))
    expect(follow('addressComments').title).toBe(`/worfy:pr-fix comments ${API}#118 ${HEAD}`)
    cleanup()

    // A colleague's PR that waits for my answer: no button of pr-fix.
    await show(inbox([{ ...ANSWER, author: ANA }], 'needs-answer'), settingsAnswer())
    expect(within(pane()).queryAllByTestId('pr-inbox-follow')).toEqual([])
  })

  it('an empty template: the button is inactive, and its tooltip says where to set it; a click sends nothing', async () => {
    await show(inbox([CONFLICT]), settingsAnswer({ fixChecks: '' }))
    await waitFor(() => expect(follow('fixChecks').getAttribute('aria-disabled')).toBe('true'))
    expect(follow('fixChecks').getAttribute('data-kit-hint')).toBe('Set the Fix checks template in Project settings')
    expect(follow('fixChecks').getAttribute('aria-description')).toBe('Set the Fix checks template in Project settings')
    // No native title beside the kit tooltip: the two would show one over the other.
    expect(follow('fixChecks').hasAttribute('title')).toBe(false)
    // The other one has its template.
    expect(follow('resolveConflicts').getAttribute('aria-disabled')).toBe('false')
    fireEvent.click(follow('fixChecks'))
    await act(async () => Promise.resolve())
    expect(followCalls()).toEqual([])
  })

  it('a refusal of the verdict of ticket 01 is the tooltip too: a PR from a fork', async () => {
    await show(inbox([{ ...CONFLICT, isCrossRepository: true }]), settingsAnswer())
    await waitFor(() => expect(follow('fixChecks').getAttribute('data-kit-hint')).toBe(`${WEB}#40 comes from a fork: a Session cannot push to it`))
    expect(follow('fixChecks').getAttribute('aria-disabled')).toBe('true')
  })

  it('a click sends actions.prFollow with the Project, the PR and the action of that button; the toast says where the text went', async () => {
    const deliveries = ['new', 'sent', 'queued']
    // In conflict, red and with changes asked: all three buttons, each sending its own action.
    await show(inbox([{ ...CONFLICT, reviewDecision: 'CHANGES_REQUESTED' }]), {
      ...settingsAnswer(),
      'actions.prFollow': () => ({ ok: true, value: { nodeId: 'node-1', sessionId: 'session-1', text: `/worfy:pr-fix checks ${WEB}#40 ${HEAD}`, delivery: deliveries.shift()! } }),
    })
    expect(within(pane()).getAllByTestId('pr-inbox-follow').map((button) => button.dataset.action)).toEqual(['resolveConflicts', 'fixChecks', 'addressComments'])
    const call = (action: string) => ({ projectId: 'web-00000001', repo: WEB, pr: 40, action })
    await waitFor(() => expect(follow('fixChecks').getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(follow('fixChecks'))
    await waitFor(() => expect(followCalls()).toEqual([call('fixChecks')]))
    await waitFor(async () => expect(await shownToasts()).toEqual([{ kind: 'success', text: `Fix checks for ${WEB}#40: Started a Session` }]))
    // The PR's Ticket is demo 03: a Session of that Ticket took the text, at once or into its queue.
    await waitFor(() => expect(follow('resolveConflicts').getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(follow('resolveConflicts'))
    await waitFor(async () => expect(await shownToasts()).toContainEqual({ kind: 'success', text: `Resolve conflicts for ${WEB}#40: Sent to the Session of demo 03` }))
    await waitFor(() => expect(follow('addressComments').getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(follow('addressComments'))
    await waitFor(async () => expect(await shownToasts()).toContainEqual({ kind: 'success', text: `Address comments for ${WEB}#40: Queued for the Session of demo 03` }))
    expect(followCalls()).toEqual([call('fixChecks'), call('resolveConflicts'), call('addressComments')])
  })

  it('while a click is on its way the button is inactive and says so: a second click sends nothing', async () => {
    let answer: (value: IpcResult<unknown>) => void = () => undefined
    await show(inbox([CONFLICT]), {
      ...settingsAnswer(),
      'actions.prFollow': () => new Promise<IpcResult<unknown>>((resolve) => (answer = resolve)) as unknown as IpcResult<unknown>,
    })
    await waitFor(() => expect(follow('fixChecks').getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(follow('fixChecks'))
    await waitFor(() => expect(follow('fixChecks').getAttribute('aria-disabled')).toBe('true'))
    expect(follow('fixChecks').getAttribute('data-kit-hint')).toBe(`Fix checks is starting for ${WEB}#40…`)
    fireEvent.click(follow('fixChecks'))
    await act(async () => Promise.resolve())
    expect(followCalls()).toHaveLength(1)
    // main answers: the button is active again, and the toast says where the text went.
    await act(async () => answer({ ok: true, value: { nodeId: 'node-1', sessionId: 'session-1', text: 'x', delivery: 'new' } }))
    await waitFor(() => expect(follow('fixChecks').getAttribute('aria-disabled')).toBe('false'))
    expect(await shownToasts()).toEqual([{ kind: 'success', text: `Fix checks for ${WEB}#40: Started a Session` }])
    expect(followCalls()).toHaveLength(1)
  })

  it("main's refusal is an error toast with its reason", async () => {
    const reason = `Fix checks is already starting for ${WEB}#40: wait for its Session, or close its Node to start again`
    await show(inbox([CONFLICT]), { ...settingsAnswer(), 'actions.prFollow': () => ({ ok: false, error: `actions.prFollow failed: ${reason}` }) })
    await waitFor(() => expect(follow('fixChecks').getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(follow('fixChecks'))
    await waitFor(async () => expect(await shownToasts()).toEqual([{ kind: 'error', text: `Fix checks for ${WEB}#40 failed: ${reason}` }]))
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

  it('Fix checks and the other actions on a PR are inactive, with the hint, and a click sends nothing (worfy-pr-follow ticket 04)', async () => {
    const head = '3f2a9c1'.padEnd(40, '0')
    const snapshot = snapshotOf('web-00000001', { groups: [{ group: 'needs-fix', rows: [row(WEB, 40, { headRefOid: head, ci: 'failing' })] }] })
    preload({
      inbox: { 'web-00000001': snapshot },
      answers: { 'projects.settings.get': () => ({ ok: true, value: { actionTemplates: { shipTicket: '', runWave: '', gateQueue: '', prReply: '', fixChecks: '/worfy:pr-fix checks {repo}#{pr} {sha}', resolveConflicts: '', addressComments: '' }, prInbox: true } }) },
    })
    await body(snapshot)
    const button = within(pane()).getByTestId('pr-inbox-follow')
    expect(button.textContent).toBe('Fix checks')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('data-kit-hint')).toBe(HINT)
    fireEvent.click(button)
    await act(async () => Promise.resolve())
    expect(main.calls.filter((call) => call.channel === 'actions.prFollow')).toEqual([])
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
        'projects.settings.get': () => ({ ok: true, value: { actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '', gateQueue: '', prReply: '', fixChecks: '', resolveConflicts: '', addressComments: '' } } }),
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
  const TEMPLATES = { shipTicket: '/ship-ticket {epic} {NN}', runWave: '', gateQueue: '', prReply: '', fixChecks: '', resolveConflicts: '', addressComments: '' }

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
