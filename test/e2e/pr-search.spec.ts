import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, viewButton, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { ms } from '../time-scale'

// The PR search in the Pull requests view (worfy-pr-review ticket 05) against the built app: one Project, `web`, a
// temporary git repository whose `origin` is example-org/web on github.com, and gh the stub of launchApp
// (test/fixtures/gh/gh-stub.mjs): graphql.json holds the PRs, search.json what GitHub's search answers for each exact
// search string main sends (main builds it: src/shared/pr-search/query.ts).
// - `/` puts the focus in the field; Enter searches This Project; the results stand in place of the groups, each row
//   with its approvals chip; the first result, a colleague's PR the inbox lacks, is read by `prSearch.pull` and shown
//   in the pane with the strip «Review this pull request» and Start review ▾ (Review mode, ticket 09: test/e2e/pr-review.spec.ts); Clear gives the inbox
//   back; screenshots at 1280 and 1600 px in both themes;
// - a built-in saved search runs in its own scope (All of GitHub); ☆ Save names a search and main keeps it in the
//   Project's data folder (pr-searches.json);
// - GitHub's 422 is said under the field, framed red; an organization behind single sign-on gives the notice with the
//   link that authorizes the token;
// - the stub's log holds no write of any kind: the search only reads (ADR-0105).
// Every name, login and text is invented.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const WEB = 'web-0000000w'
const WEB_REPO = 'example-org/web'
const ME = 'dev-me'
const ANA = 'dev-ana'
const BO = 'dev-bo'
/** The tail main adds to every search, and This Project's scope. */
const TAIL = 'is:pr archived:false sort:updated-desc'
const PROJECT_SCOPE = `repo:${WEB_REPO}`
const SSO_URL = 'https://github.com/orgs/example-org/sso?authorization_request=A1B2C3'

/** Where the screenshots of the search go for the review of ticket 05: beside Playwright's own output, which each run empties. */
const SCREENS = join(import.meta.dirname, '..', '..', 'test-results', 'worfy-pr-review-05-screens')

let scratch: string
let dataDir: string
let claudeHome: string
let ghDir: string
let ghLog: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const at = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 3_600_000).toISOString()

const pullRule = (count: number) => ({
  type: 'PULL_REQUEST',
  parameters: { requiredApprovingReviewCount: count, dismissStaleReviewsOnPush: false, requireCodeOwnerReview: false, requireLastPushApproval: false, requireExtraApprovalForUnattributedChanges: false, requiredReviewers: [] },
})
const review = (author: string, oid: string) => ({ author: { login: author }, state: 'APPROVED', submittedAt: at(2), authorCanPushToRepository: true, commit: { oid } })

/**
 * A PR of the stub in the shape of the details query, its base branch asking for two approvals. `inbox` — the inbox's
 * own search finds it (mine, or one asking my review); a colleague's PR that asks nothing of me only the search finds.
 */
function stubPull(number: number, title: string, over: { author?: string; requested?: string[]; approvedBy?: string[]; inbox?: boolean; threads?: unknown[] } = {}) {
  const author = over.author ?? ME
  const head = `sha${number}`
  return {
    repo: WEB_REPO,
    number,
    updatedAt: at(1),
    headRefOid: head,
    reviewRequested: (over.requested ?? []).includes(ME),
    involves: over.inbox ?? true,
    pull: {
      title,
      url: `https://github.com/${WEB_REPO}/pull/${number}`,
      state: 'OPEN',
      isDraft: false,
      createdAt: at(30),
      author: { login: author },
      headRefName: `feature/${number}`,
      baseRefName: 'main',
      baseRef: { rules: { nodes: [pullRule(2)] }, branchProtectionRule: null },
      reviewDecision: 'REVIEW_REQUIRED',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BLOCKED',
      additions: 184,
      deletions: 22,
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
      reviewRequests: { nodes: (over.requested ?? []).map((login) => ({ asCodeOwner: false, requestedReviewer: { __typename: 'User', login } })) },
      latestOpinionatedReviews: { nodes: (over.approvedBy ?? []).map((login) => review(login, head)) },
      reviewThreads: { nodes: over.threads ?? [] },
      comments: { nodes: [] },
    },
  }
}

const PULLS = [
  // The inbox: my PR waiting on others (one approval of two), and a review asked of me.
  stubPull(118, 'Retry the upload', { approvedBy: [ANA] }),
  stubPull(41, 'Add the export button', { author: ANA, requested: [ME] }),
  // Only the search finds these: a colleague's PR that asks for another reviewer, and one of another colleague.
  stubPull(77, 'Retry on 429', {
    author: BO,
    requested: [ANA],
    inbox: false,
    threads: [
      {
        id: 'T77',
        isResolved: false,
        isOutdated: false,
        path: 'src/net/retry.ts',
        line: 10,
        viewerCanReply: true,
        comments: { nodes: [{ id: 'C771', databaseId: 771, author: { login: ANA }, body: 'Why three tries? The gateway gives up after two.', createdAt: at(1), url: `https://github.com/${WEB_REPO}/pull/77#discussion_r771` }] },
      },
    ],
  }),
  stubPull(80, 'Retry the cache warm-up', { author: ANA, inbox: false }),
]

const node = (number: number) => ({ repo: WEB_REPO, number, updatedAt: PULLS.find((each) => each.number === number)!.updatedAt })

/** What GitHub's search answers, by the exact search string main sends. */
const SEARCHES = {
  answers: [
    { q: `retry ${TAIL} ${PROJECT_SCOPE}`, nodes: [node(77), node(118), node(80)] },
    { q: `review-requested:@me is:open ${TAIL}`, nodes: [node(41)] },
    { q: `retry NOT ${TAIL} ${PROJECT_SCOPE}`, status: 422, message: 'Validation Failed: the query has a NOT with nothing after it' },
    { q: `payments ${TAIL} org:example-org`, status: 403, message: 'Resource protected by organization SAML enforcement.', headers: { 'X-GitHub-SSO': `required; url=${SSO_URL}` } },
  ],
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-pr-search-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  ghDir = join(scratch, 'gh')
  ghLog = join(scratch, 'gh-calls.jsonl')
  mkdirSync(claudeHome, { recursive: true })
  mkdirSync(ghDir, { recursive: true })
  writeFileSync(join(ghDir, 'graphql.json'), JSON.stringify({ viewer: ME, pulls: PULLS }))
  writeFileSync(join(ghDir, 'search.json'), JSON.stringify(SEARCHES))
  const web = join(scratch, 'web')
  mkdirSync(web, { recursive: true })
  writeFileSync(join(web, 'README.md'), '# web\n')
  git(web, 'init', '-q')
  git(web, 'add', '.')
  git(web, 'commit', '-q', '-m', 'init')
  git(web, 'remote', 'add', 'origin', `https://github.com/${WEB_REPO}.git`)
  mkdirSync(join(dataDir, WEB), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: WEB, name: 'web', path: web }], activeId: WEB }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, GH_STUB_DIR: ghDir, GH_STUB_LOG: ghLog } })

const ghCalls = (): string[][] => (existsSync(ghLog) ? readFileSync(ghLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]) : [])

/** No call that could write to GitHub: no method but GET, no GraphQL mutation, no body from a file, no `gh pr`/`gh issue` that writes. */
function expectNoWrite(): void {
  const writes = ghCalls().filter((args) => {
    const method = args.find((arg, index) => args[index - 1] === '-X' || args[index - 1] === '--method' || arg.startsWith('--method='))
    if (method !== undefined && method.replace('--method=', '').toUpperCase() !== 'GET') return true
    if (args.some((arg) => /^query=\s*mutation\b/u.test(arg) || arg === '--input')) return true
    return (args[0] === 'pr' || args[0] === 'issue') && ['comment', 'review', 'merge', 'edit', 'create', 'close', 'ready'].includes(args[1] ?? '')
  })
  expect(writes).toEqual([])
}

const field = (window: Page): Locator => window.getByRole('searchbox', { name: 'Search pull requests' })
const pane = (window: Page): Locator => window.getByTestId('pr-inbox-pane')
const resultRows = (window: Page): Locator => window.getByTestId('pr-search-results').getByTestId('pr-inbox-row')

async function openView(window: Page): Promise<void> {
  await viewButton(window, 'pull-requests').click()
  await expect(window.getByTestId('pr-inbox-group').first()).toBeVisible({ timeout: ms(45_000) })
}

/** Dismisses the toasts shown (the PR inbox's morning digest comes on the window's first focus): they cover the right of the search bar. */
async function noToasts(window: Page): Promise<void> {
  const dismiss = window.getByTestId('toasts').getByRole('button', { name: 'Dismiss' })
  while ((await dismiss.count()) > 0) await dismiss.first().click()
}

async function shoot(window: Page, name: string): Promise<void> {
  mkdirSync(SCREENS, { recursive: true })
  const shots = await snapshotThemes(window, `pr-search-${name}`)
  for (const scheme of ['light', 'dark'] as const) copyFileSync(shots[scheme], join(SCREENS, `${name}-${scheme}.png`))
  console.log(`pull requests search ${name}: ${join(SCREENS, `${name}-light.png`)} ${join(SCREENS, `${name}-dark.png`)}`)
}

test('`/`, Enter and the results with their approvals chips; a result the inbox lacks in the pane with «Review this pull request»; Clear; screenshots at 1280 and 1600 px', async () => {
  test.setTimeout(ms(150_000))
  const launched = await launch()
  try {
    const { window } = launched
    await window.setViewportSize({ width: 1280, height: 800 })
    await openView(window)
    await expect(window.getByTestId('pr-inbox-group')).toHaveCount(2)

    // `/` from the view puts the focus in the field; typing alone searches nothing; Enter does.
    await window.getByTestId('pr-inbox-view').getByRole('heading', { name: 'web' }).click()
    await window.keyboard.press('/')
    await expect(field(window)).toBeFocused()
    await window.keyboard.type('retry')
    await expect(window.getByTestId('pr-search-results')).toHaveCount(0)
    await window.keyboard.press('Enter')
    await expect(window.getByTestId('pr-search-heading')).toHaveText('Search · 3 results', { timeout: ms(30_000) })
    await expect(window.getByTestId('pr-inbox-group')).toHaveCount(0)
    await expect(resultRows(window).getByTestId('pr-inbox-title')).toHaveText(['Retry on 429', 'Retry the upload', 'Retry the cache warm-up'])
    // Each row carries the approvals chip of the inbox's row: none approved of two, and one of two.
    await expect(resultRows(window).getByTestId('approvals-chip')).toHaveText(['0/2', '1/2', '0/2'])
    await expect(window.getByTestId('pr-search-searched')).toHaveText('Searched just now')

    // The first result, a colleague's PR the inbox lacks, is selected and read in full: its thread and its strip.
    await expect(pane(window)).toHaveAttribute('data-number', '77')
    await expect(pane(window).getByTestId('pr-inbox-next-step-title')).toHaveText('Review this pull request')
    await expect(pane(window).getByTestId('pr-inbox-next-step')).toContainText(`${BO} asked ${ANA}; 0 of 2 required approvals.`)
    await expect(pane(window).getByTestId('pr-inbox-next-step-action')).toHaveText('Start review')
    // Start review opens Review mode in worfy (ticket 09), no longer the Files page of GitHub; ▾ chooses who writes it.
    await expect(pane(window).getByTestId('pr-inbox-next-step-action')).not.toHaveAttribute('href', /./)
    await expect(pane(window).getByTestId('pr-review-start-more')).toHaveAttribute('aria-label', 'Choose who writes the review')
    await expect(pane(window).getByTestId('pr-inbox-comment')).toContainText('Why three tries?')
    // A result of the inbox keeps the inbox's strip; ↓ moves along the results.
    await field(window).blur()
    await window.keyboard.press('ArrowDown')
    await expect(pane(window)).toHaveAttribute('data-number', '118')
    await expect(pane(window).getByTestId('pr-inbox-next-step-title')).toHaveText('Waiting for reviewers')
    await window.keyboard.press('ArrowUp')
    await expect(pane(window)).toHaveAttribute('data-number', '77')

    await noToasts(window)
    for (const width of [1280, 1600]) {
      await window.setViewportSize({ width, height: 800 })
      await expect(pane(window)).toBeVisible()
      // The two panes side by side, the search bar above them.
      const [bar, list, shown] = await Promise.all([window.getByTestId('pr-search-bar').boundingBox(), window.getByTestId('pr-search-results').boundingBox(), pane(window).boundingBox()])
      expect(bar !== null && list !== null && shown !== null && bar.y + bar.height <= list.y && list.x + list.width <= shown.x + 1).toBe(true)
      await shoot(window, `results-${width}`)
    }

    // Clear gives the inbox back.
    await noToasts(window)
    await window.getByTestId('pr-search-clear').click()
    await expect(field(window)).toHaveValue('')
    await expect(window.getByTestId('pr-search-results')).toHaveCount(0)
    await expect(window.getByTestId('pr-inbox-group')).toHaveCount(2)
    expectNoWrite()
  } finally {
    await launched.close()
  }
})

test('a built-in saved search runs in its own scope; ☆ Save keeps a search in the Project data folder; 422 under the field; the single sign-on notice', async () => {
  test.setTimeout(ms(150_000))
  const launched = await launch()
  try {
    const { window } = launched
    await window.setViewportSize({ width: 1280, height: 800 })
    await openView(window)

    // The menu of the field: the two built-in searches; the first runs on All of GitHub.
    await noToasts(window)
    await window.getByRole('button', { name: 'Saved searches' }).click()
    const items = window.getByTestId('pr-search-saved-item')
    await expect(items).toHaveCount(2)
    await items.filter({ hasText: 'Review requested from me · All of GitHub' }).click()
    await expect(field(window)).toHaveValue('review-requested:@me is:open')
    await expect(window.getByTestId('pr-search-scope')).toContainText('All of GitHub')
    await expect(window.getByTestId('pr-search-heading')).toHaveText('Search · 1 result · ★ Review requested from me · All of GitHub', { timeout: ms(30_000) })
    await expect(resultRows(window).getByTestId('pr-inbox-title')).toHaveText(['Add the export button'])
    await expect(window.getByTestId('pr-search-chip').and(window.locator('[data-chip="reviewRequested"]'))).toHaveAttribute('aria-pressed', 'true')
    await expect(window.getByTestId('pr-search-save')).toContainText('Saved')

    // A search of my own, saved under a name: main keeps it in the Project's data folder.
    await window.getByTestId('pr-search-scope').click()
    await window.getByTestId('pr-search-scope-item').and(window.locator('[data-scope="project"]')).click()
    await field(window).fill('retry')
    await field(window).press('Enter')
    await expect(window.getByTestId('pr-search-heading')).toHaveText('Search · 3 results', { timeout: ms(30_000) })
    await noToasts(window)
    await window.getByTestId('pr-search-save').click()
    await window.getByTestId('pr-search-save-name').fill('Retry work')
    await window.getByTestId('pr-search-save-confirm').click()
    await expect(window.getByTestId('pr-search-save')).toContainText('Saved')
    await expect(window.getByTestId('pr-search-heading')).toContainText('★ Retry work')
    const kept = JSON.parse(readFileSync(join(dataDir, WEB, 'pr-searches.json'), 'utf8')) as { searches: { name: string; query: string; scope: string }[] }
    expect(kept.searches).toEqual([expect.objectContaining({ name: 'Retry work', query: 'retry', scope: 'project' })])

    // GitHub refuses the search (422): its words under the field, the field framed red.
    await field(window).fill('retry NOT')
    await field(window).press('Enter')
    await expect(window.getByTestId('pr-search-invalid')).toContainText('Validation Failed', { timeout: ms(30_000) })
    await expect(field(window)).toHaveAttribute('aria-invalid', 'true')
    await noToasts(window)
    await shoot(window, 'invalid-1280')

    // An organization behind single sign-on: the notice above the results, with the link that authorizes the token.
    await window.getByTestId('pr-search-scope').click()
    await window.getByTestId('pr-search-scope-item').and(window.locator('[data-scope="owners"]')).click()
    await field(window).fill('payments')
    await field(window).press('Enter')
    const notice = window.getByTestId('pr-search-notice').and(window.locator('[data-kind="sso"]'))
    await expect(notice).toContainText('Authorize your token for example-org single sign-on', { timeout: ms(30_000) })
    await expect(notice.getByRole('link', { name: 'Authorize' })).toHaveAttribute('href', SSO_URL)
    await expect(field(window)).toHaveAttribute('aria-invalid', 'false')
    await noToasts(window)
    await shoot(window, 'sso-1280')
    expectNoWrite()
  } finally {
    await launched.close()
  }
})
