// The PR search in the Pull requests view (worfy-pr-review ticket 05; spec, Solution 1 and 2, implementation decisions
// 1, 9, 10 and 12), over answers of `prSearch.*` in the shape main sends them (src/shared/ipc/pr-search.ts):
// - the field: `/` focuses it from anywhere in the view but a text field, Escape takes the focus off it, Enter searches;
//   GitHub's limits (256 characters, 5 operators) are said under it before Enter;
// - the scope menu: This Project first and chosen, the organizations of the Project, All of GitHub;
// - the filter chips write their qualifiers into the field, and show a qualifier the field already holds;
// - the results in place of the groups, the inbox's row with its approvals chip; the first one selected; ↑ ↓; Load more;
//   "Searched N min ago · Refresh"; Clear gives the groups back;
// - a result the inbox lacks is read by `prSearch.pull` and shown in the same pane, its strip «Review this pull request»
//   with Start review ▾, which opens Review mode in worfy (ticket 09);
// - the saved searches: the menu of the field, ☆ Save, read-only on a Linked machine;
// - the notices of section 10 of the spec: above the results, or under the field with a red frame for 422.
// main is a fake preload bridge; every owner, repository, login and text is invented. Nothing here reaches GitHub.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult, WorfyBridge } from '../../src/shared/ipc/channels'
import type { PrApprovals, PrInboxRow, PrInboxSnapshot } from '../../src/shared/ipc/pr-inbox'
import type { PrSearchNotice, PrSearchPull, PrSearchResult, PrSearchRow, SavedSearch } from '../../src/shared/ipc/pr-search'
import type { ProjectsState } from '../../src/shared/ipc/projects'
import type { AppSettings } from '../../src/shared/settings/app-settings'
import { ms } from '../time-scale'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const ago = (ms: number): string => new Date(NOW - ms).toISOString()

const WEB = 'example-org/web'
const API = 'example-org/api'
const ME = 'dev-me'
const ANA = 'dev-ana'
const BO = 'dev-bo'
const PROJECT = 'web-00000001'

const row = (repo: string, number: number, over: Partial<PrInboxRow> = {}): PrInboxRow => ({
  repo,
  number,
  title: `Change ${number}`,
  url: `https://github.com/${repo}/pull/${number}`,
  isDraft: false,
  author: ME,
  headRefName: `feature/${number}`,
  headRefOid: `sha${number}`,
  createdAt: ago(30 * HOUR),
  updatedAt: ago(2 * HOUR),
  ci: 'passing',
  reviewDecision: null,
  mergeStateStatus: 'CLEAN',
  additions: 10,
  deletions: 2,
  viaTeam: false,
  unresolvedThreads: 0,
  newSinceSeen: 0,
  lastActivityAt: ago(2 * HOUR),
  threads: [],
  comments: [],
  ...over,
})

const approvals = (have: number, need: number | null, reviewers: PrApprovals['reviewers'] = []): PrApprovals => ({
  have,
  need,
  source: need === null ? 'hidden' : 'ruleset',
  codeOwnersPending: [],
  stale: 0,
  lastPushNeedsOther: false,
  moreRules: false,
  decision: 'review-required',
  reviewers,
})

/** The inbox: a review asked of me through my team, and my PR that owes an answer. */
const INBOX = {
  review: row(WEB, 41, { title: 'Add the export button', author: ANA, reviewDecision: 'REVIEW_REQUIRED' }),
  answer: row(API, 118, { title: 'Retry the upload', unresolvedThreads: 1, newSinceSeen: 1 }),
}
const SNAPSHOT: PrInboxSnapshot = {
  projectId: PROJECT,
  enabled: true,
  viewer: ME,
  groups: [
    { group: 'needs-review', rows: [INBOX.review] },
    { group: 'needs-answer', rows: [INBOX.answer] },
  ],
  readAt: ago(MIN),
  nextSearchAt: new Date(NOW + 4 * MIN).toISOString(),
  error: null,
  notice: null,
}

/** A colleague's PR the inbox does not hold, asked of nobody: 0 of 2 approvals. */
const RETRY = row(WEB, 77, {
  title: 'Retry on 429',
  author: BO,
  approvals: approvals(0, 2, [{ login: ANA, kind: 'user', state: 'requested', counts: false, codeOwner: false }]),
  headRefName: 'fix/retry-429',
  // Main counts comments of a PR nobody marked seen; the inbox alone clears that count.
  newSinceSeen: 2,
})
const OTHER = row('other-org/tools', 5, { title: 'Retry the cache warm-up', author: ANA, approvals: approvals(1, null) })

const searchRow = (each: PrInboxRow, inInbox: boolean): PrSearchRow => ({ ...each, inInbox })

const result = (rows: PrSearchRow[], over: Partial<PrSearchResult> = {}): PrSearchResult => ({
  queries: ['retry is:pr archived:false sort:updated-desc repo:example-org/web'],
  rows,
  issueCount: rows.length,
  cursor: null,
  viewer: ME,
  rate: null,
  pausedUntil: null,
  searchedAt: new Date(NOW).toISOString(),
  fromMemory: false,
  notices: [],
  ...over,
})

const RESULTS = result([searchRow(RETRY, false), searchRow(INBOX.review, true), searchRow(OTHER, false)])

const BUILT_IN: SavedSearch[] = [
  { id: 'built-in:review-requested', name: 'Review requested from me · All of GitHub', query: 'review-requested:@me is:open', scope: 'github', builtIn: true },
  { id: 'built-in:reviewed-by-me', name: 'Reviewed by me · open', query: 'reviewed-by:@me is:open', scope: 'project', builtIn: true },
]
const MINE: SavedSearch = { id: 's1', name: 'Network retries', query: 'retry label:network', scope: 'project', builtIn: false }

const PROJECTS: ProjectsState = { projects: [{ id: PROJECT, name: 'web', path: '/projects/web', branch: 'main' }], activeId: PROJECT, revision: 1 }

const appSettings = (): AppSettings => ({
  interfaceScale: 1,
  sidebar: { collapsed: {}, visible: { normal: true, focus: true } },
  autoCompactWindow: { orchestrator: 400_000, other: 500_000 },
  memoryIndicator: true,
  revision: 0,
})

type Answer = (input: unknown) => IpcResult<unknown>

let calls: { channel: string; input: unknown }[] = []

/** This Machine's preload: the inbox above, and `prSearch.*` from `answers`; a search answers RESULTS by default. */
function preload(answers: Record<string, Answer> = {}): void {
  calls = []
  const answer = (channel: string, input: unknown): IpcResult<unknown> => {
    const own = answers[channel]
    if (own !== undefined) return own(input)
    switch (channel) {
      case 'projects.list':
        return { ok: true, value: PROJECTS }
      case 'appSettings.get':
        return { ok: true, value: appSettings() }
      case 'workflow.open':
        return { ok: true, value: { root: (input as { root: string }).root, epics: [], tickets: [], error: null, branchErrors: [] } }
      case 'prInbox.get':
        return { ok: true, value: SNAPSHOT }
      case 'prInbox.markSeen':
        return { ok: true, value: SNAPSHOT }
      case 'prSearch.run':
        return { ok: true, value: RESULTS }
      case 'prSearch.saved':
        return { ok: true, value: { searches: [...BUILT_IN, MINE] } }
      case 'prSearch.pull': {
        const { repo, number } = input as { repo: string; number: number }
        const found = RESULTS.rows.find((each) => each.repo === repo && each.number === number) ?? null
        return { ok: true, value: { row: found, readAt: new Date(NOW).toISOString(), notices: [] } satisfies PrSearchPull }
      }
      case 'stories.running':
        return { ok: true, value: null }
      default:
        return { ok: true, value: { closed: true } }
    }
  }
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      calls.push({ channel, input })
      return Promise.resolve(answer(channel, input) as never)
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

async function view(answers?: Record<string, Answer>) {
  preload(answers)
  const { PullRequestsView } = await import('../../src/renderer/pr-inbox/PrInboxView')
  const shown = render(<PullRequestsView />)
  await waitFor(() => expect(screen.getAllByTestId('pr-inbox-row').length).toBeGreaterThan(0))
  return shown
}

const field = (): HTMLInputElement => screen.getByRole('searchbox', { name: 'Search pull requests' })
const runs = (): unknown[] => calls.filter((call) => call.channel === 'prSearch.run').map((call) => call.input)
const keys = (): string[] => screen.getAllByTestId('pr-inbox-row').map((each) => `${each.dataset.repo}#${each.dataset.number}`)
const selected = (): string[] =>
  screen
    .getAllByTestId('pr-inbox-row')
    .filter((each) => each.dataset.selected === 'true')
    .map((each) => `${each.dataset.repo}#${each.dataset.number}`)
const pane = (): HTMLElement => screen.getByTestId('pr-inbox-pane')
const chip = (id: string): HTMLElement => screen.getAllByTestId('pr-search-chip').find((each) => each.dataset.chip === id)!

async function search(text: string): Promise<void> {
  fireEvent.change(field(), { target: { value: text } })
  fireEvent.keyDown(field(), { key: 'Enter' })
  // The answer is in: the heading no longer says the search is on its way.
  await waitFor(() => expect(screen.getByTestId('pr-search-heading').textContent).not.toContain('searching…'))
}

describe('the search field', () => {
  it('`/` puts the focus in the field from anywhere in the view, but not from a text field or with a modifier; Escape takes it off', async () => {
    await view()
    expect(field().getAttribute('placeholder')).toBe('Search pull requests… text and GitHub qualifiers')
    fireEvent.keyDown(document.body, { key: '/' })
    expect(document.activeElement).toBe(field())
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(document.activeElement).not.toBe(field())
    // A text field of the pane, like a draft reply: `/` is a letter there.
    const area = document.createElement('textarea')
    pane().appendChild(area)
    area.focus()
    const typed = fireEvent.keyDown(area, { key: '/' })
    expect(typed).toBe(true)
    expect(document.activeElement).toBe(area)
    area.blur()
    fireEvent.keyDown(document.body, { key: '/', metaKey: true })
    expect(document.activeElement).not.toBe(field())
  })

  it('Enter searches the text in the scope; nothing is searched while it is typed', async () => {
    await view()
    fireEvent.change(field(), { target: { value: 'retry' } })
    expect(runs()).toEqual([])
    fireEvent.keyDown(field(), { key: 'Enter' })
    await waitFor(() => expect(runs()).toEqual([{ projectId: PROJECT, text: 'retry', scope: 'project', cursor: null }]))
  })

  it('says under the field what GitHub would refuse, before Enter: over 256 characters, more than 5 operators', async () => {
    await view()
    fireEvent.change(field(), { target: { value: 'a OR b OR c OR d OR e OR f OR g' } })
    expect(screen.getByTestId('pr-search-warning').textContent).toBe('GitHub refuses more than 5 AND, OR and NOT: this search has 6.')
    fireEvent.change(field(), { target: { value: `retry ${'x'.repeat(260)}` } })
    expect(screen.getByTestId('pr-search-warning').textContent).toMatch(/^GitHub refuses a search over 256 characters: this one has \d+\.$/u)
    fireEvent.change(field(), { target: { value: 'retry' } })
    expect(screen.queryByTestId('pr-search-warning')).toBeNull()
  })
})

describe('the scope menu', () => {
  it('lists This Project, the organizations of the Project and All of GitHub; This Project is chosen; a choice searches there', async () => {
    await view()
    const trigger = screen.getByTestId('pr-search-scope')
    expect(trigger.textContent).toContain('This Project')
    fireEvent.change(field(), { target: { value: 'retry' } })
    fireEvent.click(trigger)
    const items = await screen.findAllByTestId('pr-search-scope-item')
    expect(items.map((each) => each.dataset.scope)).toEqual(['project', 'owners', 'github'])
    expect(items.map((each) => each.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(items[2]!.textContent).toContain('All of GitHub')
    fireEvent.click(items[2]!)
    await waitFor(() => expect(runs()).toEqual([{ projectId: PROJECT, text: 'retry', scope: 'github', cursor: null }]))
    expect(screen.getByTestId('pr-search-scope').textContent).toContain('All of GitHub')
  })
})

describe('the filter chips', () => {
  it('a chip writes its qualifier into the field and searches; the field is the one source of truth', async () => {
    await view()
    expect(screen.getAllByTestId('pr-search-chip').map((each) => each.dataset.chip)).toEqual(['state', 'reviewRequested', 'author', 'involves', 'label', 'draft', 'review', 'reviewedBy', 'reviewInvolves'])
    fireEvent.change(field(), { target: { value: 'retry' } })
    fireEvent.click(chip('state'))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Open/u }))
    expect(field().value).toBe('retry is:open')
    await waitFor(() => expect(runs()).toEqual([{ projectId: PROJECT, text: 'retry is:open', scope: 'project', cursor: null }]))
    expect(chip('state').getAttribute('aria-pressed')).toBe('true')
    expect(chip('state').textContent).toContain('Open')
    // Another state replaces it in the field; Remove the filter takes it out.
    fireEvent.click(chip('state'))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Merged/u }))
    expect(field().value).toBe('retry is:merged')
    fireEvent.click(chip('state'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove the filter' }))
    expect(field().value).toBe('retry')
    expect(chip('state').getAttribute('aria-pressed')).toBe('false')
  })

  it('a chip of one qualifier toggles it: Involves me, Reviewed by me, Asked or reviewed', async () => {
    await view()
    fireEvent.click(chip('involves'))
    expect(field().value).toBe('involves:@me')
    expect(chip('involves').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip('reviewInvolves'))
    expect(field().value).toBe('involves:@me review-involves:@me')
    fireEvent.click(chip('involves'))
    expect(field().value).toBe('review-involves:@me')
    expect(chip('involves').getAttribute('aria-pressed')).toBe('false')
  })

  it('a qualifier typed into the field shows on its chip, with its value', async () => {
    await view()
    fireEvent.change(field(), { target: { value: 'retry author:dev-bo label:"needs review" draft:false' } })
    expect(chip('author').getAttribute('aria-pressed')).toBe('true')
    expect(chip('author').textContent).toContain('dev-bo')
    expect(chip('label').textContent).toContain('needs review')
    expect(chip('draft').textContent).toContain('Ready for review')
    expect(chip('state').getAttribute('aria-pressed')).toBe('false')
  })

  it('Author offers me and the authors of the rows shown; Label puts `label:` into the field for a name', async () => {
    await view()
    fireEvent.click(chip('author'))
    const options = await screen.findAllByTestId('pr-search-chip-option')
    expect(options.map((each) => each.textContent)).toEqual(['Meauthor:@me', `${ANA}author:${ANA}`])
    fireEvent.click(options[1]!)
    expect(field().value).toBe(`author:${ANA}`)
    fireEvent.click(chip('label'))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Type a label/u }))
    expect(field().value).toBe(`author:${ANA} label:`)
    await waitFor(() => expect(document.activeElement).toBe(field()))
  })
})

describe('the results', () => {
  it('Enter on a result opens Review mode (worfy-pr-review ticket 09), but not on a PR of my own; Clear closes it with the result', async () => {
    const mine = searchRow(INBOX.answer, true)
    const answer = (input: unknown) => {
      const { repo, number } = input as { repo: string; number: number }
      const found = [mine, searchRow(RETRY, false)].find((each) => each.repo === repo && each.number === number) ?? null
      return { ok: true as const, value: { row: found, readAt: new Date(NOW).toISOString(), notices: [] } satisfies PrSearchPull }
    }
    await view({ 'prSearch.run': () => ({ ok: true, value: result([mine, searchRow(RETRY, false)]) }), 'prSearch.pull': answer })
    await search('retry')
    const rowButton = (number: number): HTMLElement => within(screen.getAllByTestId('pr-inbox-row').find((each) => each.dataset.number === String(number))!).getByRole('button')
    fireEvent.keyDown(rowButton(118), { key: 'Enter' })
    expect(screen.queryByTestId('pr-review-mode')).toBeNull()
    fireEvent.keyDown(rowButton(77), { key: 'Enter' })
    expect((await screen.findByTestId('pr-review-mode')).dataset.number).toBe('77')
    fireEvent.click(screen.getByTestId('pr-search-clear'))
    await waitFor(() => expect(screen.queryByTestId('pr-review-mode')).toBeNull())
    expect(screen.getAllByTestId('pr-inbox-group').length).toBeGreaterThan(0)
    // The list takes ↓ again: Review mode is gone, not only hidden.
    const before = selected()
    const last = keys().indexOf(before[0]!) === keys().length - 1
    fireEvent.keyDown(document.body, { key: last ? 'ArrowUp' : 'ArrowDown' })
    expect(selected()).not.toEqual(before)
  })

  it('replace the groups: «Search · N results», the inbox row with its approvals chip, the first one selected; Clear gives the groups back', async () => {
    await view()
    expect(screen.getAllByTestId('pr-inbox-group')).toHaveLength(2)
    await search('retry')
    expect(screen.queryAllByTestId('pr-inbox-group')).toHaveLength(0)
    expect(screen.getByTestId('pr-search-heading').textContent).toBe('Search · 3 results')
    expect(keys()).toEqual([`${WEB}#77`, `${WEB}#41`, 'other-org/tools#5'])
    expect(within(screen.getAllByTestId('pr-inbox-row')[0]!).getByTestId('approvals-chip').textContent).toBe('0/2')
    expect(within(screen.getAllByTestId('pr-inbox-row')[2]!).getByTestId('approvals-chip').textContent).toBe('1/?')
    expect(selected()).toEqual([`${WEB}#77`])
    fireEvent.click(screen.getByTestId('pr-search-clear'))
    expect(field().value).toBe('')
    expect(screen.queryByTestId('pr-search-results')).toBeNull()
    expect(screen.getAllByTestId('pr-inbox-group')).toHaveLength(2)
  })

  it('a result the inbox lacks is read by prSearch.pull and shown in the pane: «Review this pull request» with Start review ▾ (Review mode)', async () => {
    await view()
    await search('retry')
    await waitFor(() => expect(calls.filter((call) => call.channel === 'prSearch.pull').map((call) => call.input)).toEqual([{ projectId: PROJECT, repo: WEB, number: 77, updatedAt: RETRY.updatedAt }]))
    expect(pane().dataset.number).toBe('77')
    expect(within(pane()).getByTestId('pr-inbox-next-step-title').textContent).toBe('Review this pull request')
    expect(within(pane()).getByTestId('pr-inbox-next-step').textContent).toContain(`${BO} asked ${ANA}; 0 of 2 required approvals.`)
    const start = within(pane()).getByTestId('pr-inbox-next-step-action')
    expect(start.textContent).toBe('Start review')
    expect(start.getAttribute('href')).toBeNull()
    expect(within(pane()).getByTestId('pr-review-start-more').getAttribute('aria-label')).toBe('Choose who writes the review')
    // No "new since you looked" on a PR the inbox lacks: nothing could ever mark it seen.
    expect(within(pane()).queryByTestId('pr-inbox-pane-new')).toBeNull()
    expect(within(screen.getAllByTestId('pr-inbox-row')[0]!).queryByTestId('pr-inbox-new')).toBeNull()
  })

  it('a result the inbox holds keeps its inbox strip, and a click on it is a look the inbox hears', async () => {
    await view()
    await search('retry')
    fireEvent.click(within(screen.getAllByTestId('pr-inbox-row')[1]!).getByRole('button'))
    expect(pane().dataset.number).toBe('41')
    expect(within(pane()).getByTestId('pr-inbox-next-step-title').textContent).toBe('Your review is asked')
    await waitFor(() => expect(calls.filter((call) => call.channel === 'prInbox.markSeen').map((call) => call.input)).toEqual([{ projectId: PROJECT, repo: WEB, number: 41 }]))
  })

  it('↓ and ↑ move along the results', async () => {
    await view()
    await search('retry')
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    expect(selected()).toEqual([`${WEB}#41`])
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    expect(selected()).toEqual(['other-org/tools#5'])
    fireEvent.keyDown(document.body, { key: 'ArrowUp' })
    expect(selected()).toEqual([`${WEB}#41`])
  })

  it('Load more asks for the next page by its cursor and adds its rows; «Searched N min ago · Refresh» has no timer', async () => {
    const pages: Record<string, PrSearchResult> = {
      first: result([searchRow(RETRY, false)], { issueCount: 2, cursor: 'c1' }),
      c1: result([searchRow(OTHER, false)], { issueCount: 2, cursor: null }),
    }
    await view({ 'prSearch.run': (input) => ({ ok: true, value: pages[(input as { cursor: string | null }).cursor ?? 'first']! }) })
    await search('retry')
    expect(screen.getByTestId('pr-search-heading').textContent).toBe('Search · 2 results')
    expect(screen.getByTestId('pr-search-searched').textContent).toBe('Searched just now')
    fireEvent.click(screen.getByTestId('pr-search-load-more'))
    await waitFor(() => expect(keys()).toEqual([`${WEB}#77`, 'other-org/tools#5']))
    expect(runs().at(-1)).toEqual({ projectId: PROJECT, text: 'retry', scope: 'project', cursor: 'c1' })
    expect(screen.queryByTestId('pr-search-load-more')).toBeNull()
    // The age the line gives by the view's clock; time passing searches nothing by itself.
    const { searchedText } = await import('../../src/renderer/pr-inbox/usePrInbox')
    expect(searchedText(ago(3 * MIN), NOW)).toBe('Searched 3 min ago')
    expect(searchedText(ago(2 * HOUR), NOW)).toBe('Searched 2 h ago')
    vi.setSystemTime(NOW + 3 * MIN)
    fireEvent.change(field(), { target: { value: 'retry ' } })
    await act(async () => Promise.resolve())
    expect(runs()).toHaveLength(2)
    fireEvent.click(screen.getByTestId('pr-search-refresh'))
    await waitFor(() => expect(runs()).toHaveLength(3))
    expect(runs().at(-1)).toEqual({ projectId: PROJECT, text: 'retry', scope: 'project', cursor: null })
  })

  it('no result: says so and offers All of GitHub', async () => {
    await view({ 'prSearch.run': () => ({ ok: true, value: result([]) }) })
    await search('nothing-like-this')
    expect(screen.getByTestId('pr-search-heading').textContent).toBe('Search · 0 results')
    expect(screen.getByTestId('pr-search-empty').textContent).toContain('No pull requests match')
    fireEvent.click(within(screen.getByTestId('pr-search-empty')).getByRole('button', { name: 'Search All of GitHub' }))
    await waitFor(() => expect(runs().at(-1)).toEqual({ projectId: PROJECT, text: 'nothing-like-this', scope: 'github', cursor: null }))
  })
})

describe('the notices of the search (spec, implementation decisions 10)', () => {
  const failing = (notices: PrSearchNotice[], rows: PrSearchRow[] = []): Record<string, Answer> => ({ 'prSearch.run': () => ({ ok: true, value: result(rows, { notices }) }) })

  it('422: GitHub\'s words under the field, the field framed red; no results notice', async () => {
    await view(failing([{ kind: 'invalid', text: 'Validation Failed: the query is malformed', url: null }]))
    await search('author:')
    expect(screen.getByTestId('pr-search-invalid').textContent).toBe('Validation Failed: the query is malformed')
    expect(field().getAttribute('aria-invalid')).toBe('true')
    // The red frame (pr-search.css) hangs on this attribute.
    expect(field().closest('.w-pr-search__field')!.getAttribute('data-invalid')).toBe('true')
    expect(screen.queryAllByTestId('pr-search-notice')).toHaveLength(0)
    expect(screen.queryByTestId('pr-search-empty')).toBeNull()
    // The next search clears it.
    fireEvent.change(field(), { target: { value: 'retry' } })
    expect(field().getAttribute('aria-invalid')).toBe('false')
    expect(field().closest('.w-pr-search__field')!.getAttribute('data-invalid')).toBeNull()
  })

  it('single sign-on: the notice above the results with the link that authorizes the token', async () => {
    const url = 'https://github.com/orgs/example-org/sso?authorization_request=abc'
    await view(failing([{ kind: 'sso', text: 'Authorize your token for example-org single sign-on', url }]))
    await search('retry')
    const notice = screen.getByTestId('pr-search-notice')
    expect(notice.dataset.kind).toBe('sso')
    expect(notice.textContent).toContain('Authorize your token for example-org single sign-on')
    expect(within(notice).getByRole('link', { name: 'Authorize' }).getAttribute('href')).toBe(url)
    expect(screen.queryByTestId('pr-search-empty')).toBeNull()
  })

  it('results with some hidden by single sign-on: the rows, and the notice above them', async () => {
    await view(failing([{ kind: 'sso-partial', text: 'Results from 2 organizations are hidden: authorize your token for their single sign-on', url: null }], [searchRow(RETRY, false)]))
    await search('retry')
    expect(screen.getByTestId('pr-search-notice').textContent).toBe('Results from 2 organizations are hidden: authorize your token for their single sign-on')
    expect(keys()).toEqual([`${WEB}#77`])
  })

  it('a refused sign-in offers Open Health check; a failed call says why', async () => {
    await view(failing([{ kind: 'sign-in', text: 'GitHub refused the sign-in: no token', url: null }]))
    await search('retry')
    expect(within(screen.getByTestId('pr-search-notice')).getByRole('button', { name: 'Open Health check' })).toBeDefined()
    cleanup()
    await view({ 'prSearch.run': () => ({ ok: false, error: 'the Project machine is not reachable' }) })
    await search('retry')
    expect(screen.getByTestId('pr-search-notice').textContent).toBe('The search failed: the Project machine is not reachable')
  })
})

describe('the saved searches', () => {
  it('the menu of the field lists the built-in ones first, then the user\'s; a choice runs it in its scope', async () => {
    await view()
    fireEvent.click(screen.getByRole('button', { name: 'Saved searches' }))
    const items = await screen.findAllByTestId('pr-search-saved-item')
    expect(items.map((each) => each.dataset.id)).toEqual(['built-in:review-requested', 'built-in:reviewed-by-me', 's1'])
    expect(items[0]!.textContent).toContain('review-requested:@me is:open · All of GitHub')
    fireEvent.click(items[0]!)
    expect(field().value).toBe('review-requested:@me is:open')
    await waitFor(() => expect(runs()).toEqual([{ projectId: PROJECT, text: 'review-requested:@me is:open', scope: 'github', cursor: null }]))
    expect(screen.getByTestId('pr-search-heading').textContent).toContain('Review requested from me · All of GitHub')
    expect(screen.getByTestId('pr-search-save').textContent).toContain('Saved')
  })

  it('☆ Save names the search and saves it with its scope; Forget is offered for the user\'s own', async () => {
    const saved: SavedSearch[] = [...BUILT_IN]
    await view({
      'prSearch.saved': () => ({ ok: true, value: { searches: saved } }),
      'prSearch.save': (input) => {
        const { name, query, scope } = input as { name: string; query: string; scope: SavedSearch['scope'] }
        saved.push({ id: 'new', name, query, scope, builtIn: false })
        return { ok: true, value: { searches: saved } }
      },
      'prSearch.forget': () => {
        saved.pop()
        return { ok: true, value: { searches: saved } }
      },
    })
    expect(screen.getByTestId('pr-search-save').hasAttribute('disabled')).toBe(true)
    await search('retry author:dev-bo')
    fireEvent.click(screen.getByTestId('pr-search-save'))
    const name = await screen.findByTestId('pr-search-save-name')
    fireEvent.change(name, { target: { value: 'Bo retries' } })
    fireEvent.click(screen.getByTestId('pr-search-save-confirm'))
    await waitFor(() => expect(calls.filter((call) => call.channel === 'prSearch.save').map((call) => call.input)).toEqual([{ projectId: PROJECT, name: 'Bo retries', query: 'retry author:dev-bo', scope: 'project' }]))
    await waitFor(() => expect(screen.getByTestId('pr-search-save').textContent).toContain('Saved'))
    fireEvent.click(screen.getByRole('button', { name: 'Saved searches' }))
    fireEvent.click(await screen.findByTestId('pr-search-forget'))
    await waitFor(() => expect(calls.filter((call) => call.channel === 'prSearch.forget').map((call) => call.input)).toEqual([{ projectId: PROJECT, id: 'new' }]))
    await waitFor(() => expect(screen.getByTestId('pr-search-save').textContent).not.toContain('Saved'))
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

  it('searches, but ☆ Save is inactive with the hint and Forget is not offered', async () => {
    await view()
    await search('retry author:dev-bo')
    const save = screen.getByTestId('pr-search-save')
    expect(save.getAttribute('aria-disabled')).toBe('true')
    expect(save.getAttribute('data-kit-hint')).toBe(HINT)
    fireEvent.click(save)
    await act(async () => Promise.resolve())
    expect(screen.queryByTestId('pr-search-save-name')).toBeNull()
    fireEvent.change(field(), { target: { value: 'retry' } })
    fireEvent.click(screen.getByRole('button', { name: 'Saved searches' }))
    await screen.findAllByTestId('pr-search-saved-item')
    expect(screen.queryByTestId('pr-search-forget')).toBeNull()
  })
})

describe('review round 1: pages, the pull memory, the window focus, the pause', () => {
  const pulls = (): unknown[] => calls.filter((call) => call.channel === 'prSearch.pull').map((call) => call.input)
  const PAUSE: PrSearchNotice = { kind: 'rate-limit', text: 'Search paused until 13:00 (GitHub rate limit)', url: null }
  const FIRST_1000: PrSearchNotice = { kind: 'first-1000', text: 'Showing the first 1,000 — narrow the search', url: null }

  it('a Load more refused by the rate-limit pause keeps the pages shown: their count, their cursor and their notices', async () => {
    const pages: Record<string, PrSearchResult> = {
      first: result([searchRow(RETRY, false)], { issueCount: 1500, cursor: 'c1', notices: [FIRST_1000] }),
      // What main answers while the account's rate limit is paused (src/main/github/pr-search.ts, empty()).
      c1: result([], { issueCount: 0, cursor: null, pausedUntil: new Date(NOW + HOUR).toISOString(), notices: [PAUSE] }),
    }
    await view({ 'prSearch.run': (input) => ({ ok: true, value: pages[(input as { cursor: string | null }).cursor ?? 'first']! }) })
    await search('retry')
    const heading = screen.getByTestId('pr-search-heading').textContent
    fireEvent.click(screen.getByTestId('pr-search-load-more'))
    await waitFor(() => expect(screen.getAllByTestId('pr-search-notice').map((each) => each.dataset.kind)).toEqual(['first-1000', 'rate-limit']))
    expect(screen.getByTestId('pr-search-heading').textContent).toBe(heading)
    expect(keys()).toEqual([`${WEB}#77`])
    expect(screen.getByTestId('pr-search-load-more')).toBeDefined()
  })

  it('Enter during a rate-limit pause searches again when the pause ends; Clear before then cancels it', async () => {
    let answered = 0
    const paused = (): IpcResult<unknown> => ({ ok: true, value: answered++ === 0 ? result([], { pausedUntil: new Date(NOW + 1000).toISOString(), notices: [PAUSE] }) : RESULTS })
    await view({ 'prSearch.run': paused })
    await search('retry')
    expect(screen.getByTestId('pr-search-notice').dataset.kind).toBe('rate-limit')
    await waitFor(() => expect(keys()).toEqual([`${WEB}#77`, `${WEB}#41`, 'other-org/tools#5']), { timeout: ms(4000) })
    expect(runs()).toHaveLength(2)
    expect(runs()[1]).toEqual(runs()[0])
    cleanup()
    answered = 0
    await view({ 'prSearch.run': paused })
    await search('retry')
    fireEvent.click(screen.getByTestId('pr-search-clear'))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1500)))
    expect(runs()).toHaveLength(1)
    expect(screen.queryByTestId('pr-search-results')).toBeNull()
  }, ms(10_000))

  it('a new search that finds the same PR updated reads it again, and the pane never shows a read older than the result', async () => {
    const NEWER = { ...RETRY, title: 'Retry on 429 and 503', updatedAt: ago(MIN) }
    await view({
      'prSearch.run': (input) => ({ ok: true, value: (input as { text: string }).text === 'retry' ? RESULTS : result([searchRow(NEWER, false)]) }),
      // A read main kept from before: the older title.
      'prSearch.pull': () => ({ ok: true, value: { row: searchRow(RETRY, false), readAt: new Date(NOW).toISOString(), notices: [] } }),
    })
    await search('retry')
    await waitFor(() => expect(pulls()).toHaveLength(1))
    expect(within(pane()).getByTestId('pr-inbox-pane-title').textContent).toContain('Retry on 429')
    await search('retry 503')
    await waitFor(() => expect(pulls()).toHaveLength(2))
    expect(pulls()[1]).toEqual({ projectId: PROJECT, repo: WEB, number: 77, updatedAt: NEWER.updatedAt })
    await act(async () => Promise.resolve())
    expect(within(pane()).getByTestId('pr-inbox-pane-title').textContent).toContain('Retry on 429 and 503')
  })

  it('the selected PR outside the inbox is read again on the window focus once its read is older than 60 s', async () => {
    await view()
    await search('retry')
    await waitFor(() => expect(pulls()).toHaveLength(1))
    vi.setSystemTime(NOW + 30_000)
    fireEvent.focus(window)
    await act(async () => Promise.resolve())
    expect(pulls()).toHaveLength(1)
    vi.setSystemTime(NOW + 2 * MIN)
    fireEvent.focus(window)
    await waitFor(() => expect(pulls()).toHaveLength(2))
    expect(pulls()[1]).toEqual({ projectId: PROJECT, repo: WEB, number: 77, updatedAt: RETRY.updatedAt, refresh: true })
  })

  it("Refresh of the results reads the selected PR again, past main's memory", async () => {
    await view()
    await search('retry')
    await waitFor(() => expect(pulls()).toHaveLength(1))
    fireEvent.click(screen.getByTestId('pr-search-refresh'))
    await waitFor(() => expect(pulls()).toHaveLength(2))
    expect(pulls()[1]).toEqual({ projectId: PROJECT, repo: WEB, number: 77, updatedAt: RETRY.updatedAt, refresh: true })
  })

  it('an entry that opens a PR of the inbox drops the search shown', async () => {
    await view()
    await search('retry')
    const { usePrInboxFocus } = await import('../../src/renderer/pr-inbox/usePrInbox')
    act(() => usePrInboxFocus.setState({ focus: { projectId: PROJECT, pr: { repo: API, number: 118 }, group: null, seq: 1000 } }))
    await waitFor(() => expect(screen.queryByTestId('pr-search-results')).toBeNull())
    expect(screen.getAllByTestId('pr-inbox-group')).toHaveLength(2)
    expect(selected()).toEqual([`${API}#118`])
  })
})
