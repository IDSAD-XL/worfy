import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, chooseLevel, closeSettings, launchApp, linkThroughUi, machineIdOf, openMachinesSettings, PROJECTS_ACCESS_LABEL, showSidebarSection, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { ms } from '../time-scale'

// Review mode and the choice of who writes the review (worfy-pr-review ticket 09) against the built app: one Project,
// `web`, a temporary git repository whose `origin` is example-org/web on github.com, and gh the stub of launchApp
// (test/fixtures/gh/gh-stub.mjs): graphql.json holds the PRs (their files Viewed on github.com in `viewed`), rest.json
// the diff GitHub lists for each PR (`pulls/<n>/files`), search.json what GitHub's search answers.
// - Start review → Review myself from the inbox: the list folds into a column, the tree and the diff of the PR's head,
//   GitHub's thread on its line, the file Viewed on github.com already marked; `v` marks the shown file; Escape closes
//   it, another tab and back keeps it, Start review opens it again with the marks; Enter on a search result opens it
//   too (← Results); screenshots at 1280 and 1600 px in both themes; the stub's log holds no write;
// - Start review → Agent review on the fake agent (pr-review-agent-turn): the bar says the agent writes; what the
//   Session writes through harness/bin/pr-review-draft shows on its line, «Written by the agent»; the end of its turn
//   gives the suggested verdict and Take over, which makes the draft the person's;
// - a window on a Linked machine with Read only: Start review inactive with «Review on the machine of the Project»;
//   View changes opens Review mode read only — the diff and the threads, no Viewed, no bar, no «+».
// - comments on lines (worfy-pr-review ticket 10): «+» and Suggest change, a range by dragging «+» (worfy-changes-view
//   ticket 09), ⌘↵; they stand on their lines, Pending; the bar counts them; worfy quits and starts again — the draft is there, and the row of the PR has the
//   chip `Review draft`; Discard asks first and removes it; the agent's comment edited is the person's; screenshots in
//   both themes; nothing written to GitHub.
// - Finish review and Submit (worfy-pr-review ticket 11), with reviews.json in the stub, so that the one POST of a
//   review is understood: path A — the search, Review myself, a comment, the dialog, Enter on Submit posts nothing, a
//   click posts once, the body byte for byte as shown, the approvals chip 1/2 → 2/2, the bar «You reviewed…»; path C —
//   the head moved: the dialog says so and Submit on <a> posts on the commit the comments were written on; path E — an
//   Agent review: the agent suggests Request changes, the person edits one comment, removes the other, approves.
// Every name, login, sha and text is invented.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const WEB = 'web-0000000w'
const ALPHA = 'alpha-0000000a'
const WEB_REPO = 'example-org/web'
const ME = 'dev-me'
const ANA = 'dev-ana'
const BO = 'dev-bo'
const TAIL = 'is:pr archived:false sort:updated-desc'
const BASE = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0'
const headOf = (number: number): string => `${String(number).padStart(4, '0')}a1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8`

const PROFILE = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'profile')
const PR_REVIEW_DRAFT = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'pr-review-draft')
const REVIEW_DRAFT_LINT = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'review-draft-lint')

/** Where the screenshots go for the review of ticket 09: beside Playwright's own output, which each run empties. */
const SCREENS = join(import.meta.dirname, '..', '..', 'test-results', 'worfy-pr-review-09-screens')

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

const pullRule = {
  type: 'PULL_REQUEST',
  parameters: { requiredApprovingReviewCount: 1, dismissStaleReviewsOnPush: false, requireCodeOwnerReview: false, requireLastPushApproval: false, requireExtraApprovalForUnattributedChanges: false, requiredReviewers: [] },
}

/** A PR of the stub in the shape of the details query: a colleague's, asking `requested`, with one open thread on retry.ts. */
function stubPull(number: number, title: string, over: { author: string; requested: string[]; inbox: boolean; viewed?: Record<string, string> }) {
  return {
    repo: WEB_REPO,
    number,
    updatedAt: at(1),
    headRefOid: headOf(number),
    reviewRequested: over.requested.includes(ME),
    involves: over.inbox,
    viewed: over.viewed ?? {},
    pull: {
      title,
      url: `https://github.com/${WEB_REPO}/pull/${number}`,
      state: 'OPEN',
      isDraft: false,
      createdAt: at(30),
      author: { login: over.author },
      headRefName: `feature/${number}`,
      baseRefName: 'main',
      baseRefOid: BASE,
      baseRef: { rules: { nodes: [pullRule] }, branchProtectionRule: null },
      reviewDecision: 'REVIEW_REQUIRED',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BLOCKED',
      additions: 6,
      deletions: 1,
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
      reviewRequests: { nodes: over.requested.map((login) => ({ asCodeOwner: false, requestedReviewer: { __typename: 'User', login } })) },
      latestOpinionatedReviews: { nodes: [] },
      reviewThreads: {
        nodes: [
          {
            id: `T${number}`,
            isResolved: false,
            isOutdated: false,
            path: 'src/net/retry.ts',
            line: 2,
            viewerCanReply: true,
            comments: { nodes: [{ id: `C${number}`, databaseId: number * 10, author: { login: BO }, body: 'Why three tries? The gateway gives up after two.', createdAt: at(1), url: `https://github.com/${WEB_REPO}/pull/${number}#discussion_r${number * 10}` }] },
          },
        ],
      },
      comments: { nodes: [] },
    },
  }
}

const PULLS = [
  // The inbox: a review asked of me; Viewed on github.com: retry.ts.
  stubPull(41, 'Add the retry delay', { author: ANA, requested: [ME], inbox: true, viewed: { 'src/net/retry.ts': 'VIEWED', 'src/net/backoff.ts': 'UNVIEWED' } }),
  // Only the search finds it: a colleague's PR asking another reviewer.
  stubPull(77, 'Retry on 429', { author: BO, requested: [ANA], inbox: false }),
]

/** A file of `pulls/<n>/files` as GitHub lists it. */
const ghFile = (number: number, filename: string, patch: string, over: { status?: string; additions: number; deletions: number }) => ({
  filename,
  status: over.status ?? 'modified',
  additions: over.additions,
  deletions: over.deletions,
  changes: over.additions + over.deletions,
  sha: `${number}${filename.length}`.padEnd(40, 'f'),
  blob_url: `https://github.com/${WEB_REPO}/blob/${headOf(number)}/${filename}`,
  patch,
})

const RETRY_PATCH = ['@@ -1,4 +1,6 @@', " import { wait } from './wait'", '-const TRIES = 2', '+const TRIES = 3', '+const DELAY_MS = 200', ' export async function retry(run) {', '+  await wait(DELAY_MS)', '   return run()'].join('\n')
const BACKOFF_PATCH = ['@@ -0,0 +1,3 @@', '+export function backoff(n) {', '+  return 2 ** n * 100', '+}'].join('\n')

const REST = Object.fromEntries(
  [41, 77].map((number) => [
    `repos/${WEB_REPO}/pulls/${number}/files?per_page=100&page=1`,
    [ghFile(number, 'src/net/retry.ts', RETRY_PATCH, { additions: 3, deletions: 1 }), ghFile(number, 'src/net/backoff.ts', BACKOFF_PATCH, { status: 'added', additions: 3, deletions: 0 })],
  ]),
)

const SEARCHES = { answers: [{ q: `retry ${TAIL} repo:${WEB_REPO}`, nodes: [{ repo: WEB_REPO, number: 77, updatedAt: PULLS[1]!.updatedAt }] }] }

/** The data folder, the gh stub's answers and the repository `web`, under `root`. */
function prepare(root: string): { dataDir: string; claudeHome: string; ghDir: string; ghLog: string; web: string } {
  const paths = { dataDir: join(root, 'data'), claudeHome: join(root, 'claude-home'), ghDir: join(root, 'gh'), ghLog: join(root, 'gh-calls.jsonl'), web: join(root, 'web') }
  for (const dir of [paths.claudeHome, paths.ghDir, paths.web, join(paths.dataDir, WEB)]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(paths.ghDir, 'graphql.json'), JSON.stringify({ viewer: ME, pulls: PULLS }))
  writeFileSync(join(paths.ghDir, 'rest.json'), JSON.stringify(REST))
  writeFileSync(join(paths.ghDir, 'search.json'), JSON.stringify(SEARCHES))
  writeFileSync(join(paths.web, 'README.md'), '# web\n')
  git(paths.web, 'init', '-q')
  git(paths.web, 'add', '.')
  git(paths.web, 'commit', '-q', '-m', 'init')
  git(paths.web, 'remote', 'add', 'origin', `https://github.com/${WEB_REPO}.git`)
  writeFileSync(join(paths.dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: WEB, name: 'web', path: paths.web }], activeId: WEB }))
  return paths
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-pr-review-')))
  ;({ dataDir, claudeHome, ghDir, ghLog } = prepare(scratch))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (env: Record<string, string> = {}): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, GH_STUB_DIR: ghDir, GH_STUB_LOG: ghLog, ...env } })

const ghCalls = (log: string): string[][] => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]) : [])

/** The calls that could write to GitHub: a method but GET, a GraphQL mutation, a body from a file, a `gh pr`/`gh issue` that writes. */
const writesOf = (log: string): string[][] =>
  ghCalls(log).filter((args) => {
    const method = args.find((arg, index) => args[index - 1] === '-X' || args[index - 1] === '--method' || arg.startsWith('--method='))
    if (method !== undefined && method.replace('--method=', '').toUpperCase() !== 'GET') return true
    if (args.some((arg) => /\bmutation\b/u.test(arg) || arg === '--input')) return true
    return (args[0] === 'pr' || args[0] === 'issue') && ['comment', 'review', 'merge', 'edit', 'create', 'close', 'ready'].includes(args[1] ?? '')
  })

/** No call that could write to GitHub. */
function expectNoWrite(log: string): void {
  expect(writesOf(log)).toEqual([])
}

/** The one write: the POST of the review of PR `number` (worfy-pr-review ticket 11), its body from a file. */
function expectOnlyReviewPost(log: string, number: number): void {
  const writes = writesOf(log)
  expect(writes).toHaveLength(1)
  expect(writes[0]!.slice(0, 5)).toEqual(['api', '--method', 'POST', `repos/${WEB_REPO}/pulls/${number}/reviews`, '--input'])
}

/** The reads of the files Viewed on github.com (`viewerViewedState`). */
const viewedReads = (log: string): number => ghCalls(log).filter((args) => args.some((arg) => arg.includes('viewerViewedState') && !arg.includes('reviewThreads'))).length

/**
 * A Harness home where `web` is a registered Project with a Profile folder, and a stand-in of `profile` in the Claude
 * home (the old layout, src/main/harness/locate.ts) that runs the repository's own script over it: the review draft
 * lives in that Profile folder. Returns the stand-in, for harness/bin/pr-review-draft.
 */
function harnessForWeb(): string {
  const harnessHome = join(scratch, 'harness-home')
  const home = join(scratch, 'home')
  const profileDir = join(harnessHome, 'projects', 'web')
  for (const dir of [join(harnessHome, 'gate'), profileDir, home, join(claudeHome, 'bin')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'web', match: join(scratch, 'web'), profile: 'web' }] }))
  writeFileSync(join(profileDir, 'profile.json'), `${JSON.stringify({ schema: 2, name: 'web', mode: 'full', github: { account: ME } }, null, 2)}\n`)
  writeFileSync(join(ghDir, 'tokens.json'), JSON.stringify({ [ME]: 'tok-me' }))
  const env = { HARNESS_HOME: harnessHome, HOME: home, USERPROFILE: home }
  for (const [name, script] of [
    ['profile', PROFILE],
    ['review-draft-lint', REVIEW_DRAFT_LINT],
  ] as const)
    writeFileSync(
      join(claudeHome, 'bin', name),
      [
        "const { spawnSync } = require('node:child_process')",
        `const env = { ...process.env, ...${JSON.stringify(env)} }`,
        'for (const name of ["CLAUDE_GATE_CONFIG", "CLAUDE_GATE_RESOLVE", "CLAUDE_PROFILES_DIR", "CLAUDE_PROFILE_BIN", "CLAUDE_TICKET_BIN", "EVAL_HARNESS_HOME"]) delete env[name]',
        `const run = spawnSync(process.execPath, [${JSON.stringify(script)}, ...process.argv.slice(2)], { stdio: 'inherit', env })`,
        'process.exit(run.status ?? 1)',
        '',
      ].join('\n'),
    )
  return join(claudeHome, 'bin', 'profile')
}

const pane = (window: Page): Locator => window.getByTestId('pr-inbox-pane')
const review = (window: Page): Locator => window.getByTestId('pr-review-mode')
const viewedBox = (window: Page, path: string): Locator => review(window).locator(`[data-testid="pr-review-viewed"][data-path="${path}"]`)
const treeFile = (window: Page, path: string): Locator => review(window).locator(`[data-testid="changes-tree-file"][data-path="${path}"]`)

async function openView(window: Page): Promise<void> {
  await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Pull requests' }).click()
  await expect(window.getByTestId('pr-inbox-group').first()).toBeVisible({ timeout: ms(45_000) })
}

/** Dismisses the toasts shown (the PR inbox's morning digest comes on the window's first focus): they cover the view. */
async function noToasts(window: Page): Promise<void> {
  const dismiss = window.getByTestId('toasts').getByRole('button', { name: 'Dismiss' })
  while ((await dismiss.count()) > 0) await dismiss.first().click()
}

/** Selects the inbox row of PR `number`. */
async function selectRow(window: Page, number: number): Promise<void> {
  await window.locator(`[data-testid="pr-inbox-group"] [data-testid="pr-inbox-row"][data-number="${number}"]`).click()
  await expect(pane(window)).toHaveAttribute('data-number', String(number))
}

/** Start review ▾ → `how` in the strip of the shown PR. */
async function startReview(window: Page, how: 'myself' | 'agent'): Promise<void> {
  await pane(window).getByTestId('pr-review-start-more').click()
  await window.getByTestId(`pr-review-start-${how}`).click()
}

async function shoot(window: Page, name: string): Promise<void> {
  mkdirSync(SCREENS, { recursive: true })
  const shots = await snapshotThemes(window, `pr-review-${name}`)
  for (const scheme of ['light', 'dark'] as const) copyFileSync(shots[scheme], join(SCREENS, `${name}-${scheme}.png`))
  console.log(`review mode ${name}: ${join(SCREENS, `${name}-light.png`)} ${join(SCREENS, `${name}-dark.png`)}`)
}

test('Start review → Review myself from the inbox and from the search: the tree, the diff, the thread, Viewed from github.com once; `v`; Escape and back; screenshots at 1280 and 1600 px', async () => {
  test.setTimeout(ms(180_000))
  harnessForWeb()
  const launched = await launch()
  try {
    const { window } = launched
    await window.setViewportSize({ width: 1280, height: 800 })
    await openView(window)
    await noToasts(window)
    await selectRow(window, 41)
    const main = pane(window).getByTestId('pr-inbox-next-step-action')
    await expect(main).toHaveText('Start review')
    await expect(main).not.toHaveAttribute('href', /./)

    await startReview(window, 'myself')
    await expect(review(window)).toHaveAttribute('data-number', '41')
    await expect(review(window)).toHaveAttribute('data-read-only', 'false')
    // The list folded into its column, with the way back; the PR's head and its branches in the head of the view.
    await expect(window.getByTestId('pr-review-back')).toContainText('Inbox')
    await expect(window.getByTestId('pr-review-column-item')).toHaveCount(1)
    await expect(review(window).getByTestId('pr-review-branches')).toContainText('main')
    await expect(review(window).getByTestId('pr-review-branches')).toContainText('feature/41')
    await expect(review(window).getByTestId('pr-review-head')).toHaveText(headOf(41).slice(0, 7))
    // The tree and the diff of the head; GitHub's thread on its line.
    await expect(treeFile(window, 'src/net/retry.ts')).toBeVisible({ timeout: ms(30_000) })
    await expect(treeFile(window, 'src/net/backoff.ts')).toBeVisible()
    await expect(review(window).locator('[data-testid="changes-thread"][data-path="src/net/retry.ts"]')).toContainText('Why three tries?')
    // Viewed on github.com: read once, only read; retry.ts marked, backoff.ts not.
    await expect(viewedBox(window, 'src/net/retry.ts')).toBeChecked({ timeout: ms(15_000) })
    await expect(viewedBox(window, 'src/net/backoff.ts')).not.toBeChecked()
    await expect(review(window).getByTestId('pr-review-viewed-count')).toHaveText('Viewed 1/2')
    await expect(review(window).getByTestId('pr-review-bar')).toHaveAttribute('data-state', 'person')
    expect(viewedReads(ghLog)).toBe(1)

    // The tree in its order, backoff.ts first: `j` to retry.ts, `k` back to backoff.ts, `v` marks it.
    await treeFile(window, 'src/net/backoff.ts').click()
    await window.keyboard.press('j')
    await expect(treeFile(window, 'src/net/retry.ts')).toHaveAttribute('aria-current', 'true')
    await window.keyboard.press('k')
    await expect(treeFile(window, 'src/net/backoff.ts')).toHaveAttribute('aria-current', 'true')
    await window.keyboard.press('v')
    await expect(viewedBox(window, 'src/net/backoff.ts')).toBeChecked()
    await expect(review(window).getByTestId('pr-review-viewed-count')).toHaveText('Viewed 2/2')

    await noToasts(window)
    for (const width of [1280, 1600]) {
      await window.setViewportSize({ width, height: 800 })
      await expect(review(window)).toBeVisible()
      // The column of 48 px, Review mode beside it.
      const [column, shown] = await Promise.all([window.getByTestId('pr-review-column').boundingBox(), review(window).boundingBox()])
      expect(column !== null && shown !== null && Math.round(column.width) === 48 && column.x + column.width <= shown.x + 1).toBe(true)
      await shoot(window, `myself-${width}`)
    }
    await window.setViewportSize({ width: 1280, height: 800 })

    // Another tab and back: still open, on the same file.
    const views = window.getByRole('group', { name: 'View', exact: true })
    await views.getByRole('button', { name: 'Canvas' }).click()
    await views.getByRole('button', { name: 'Pull requests' }).click()
    await expect(review(window)).toBeVisible()
    await expect(treeFile(window, 'src/net/backoff.ts')).toHaveAttribute('aria-current', 'true')

    // Escape: the PR's pane again; Start review (the last choice) opens it again, the marks kept, nothing read again.
    await review(window).getByTestId('pr-review-head').click()
    await window.keyboard.press('Escape')
    await expect(review(window)).toHaveCount(0)
    await expect(pane(window)).toHaveAttribute('data-number', '41')
    await expect(main).toHaveAttribute('data-how', 'myself')
    await main.click()
    await expect(review(window)).toBeVisible()
    await expect(review(window).getByTestId('pr-review-viewed-count')).toHaveText('Viewed 2/2', { timeout: ms(15_000) })
    expect(viewedReads(ghLog)).toBe(1)
    await window.getByTestId('pr-review-back').click()
    await expect(review(window)).toHaveCount(0)

    // From the search: Enter on a result opens Review mode, ← Results.
    const field = window.getByRole('searchbox', { name: 'Search pull requests' })
    await field.fill('retry')
    await field.press('Enter')
    const result = window.getByTestId('pr-search-results').locator('[data-testid="pr-inbox-row"][data-number="77"]')
    await expect(result).toBeVisible({ timeout: ms(30_000) })
    await expect(pane(window)).toHaveAttribute('data-number', '77')
    await result.locator('button.w-pr-inbox-item').focus()
    await window.keyboard.press('Enter')
    await expect(review(window)).toHaveAttribute('data-number', '77')
    await expect(window.getByTestId('pr-review-back')).toContainText('Results')
    await expect(treeFile(window, 'src/net/retry.ts')).toBeVisible({ timeout: ms(30_000) })
    await expect(viewedBox(window, 'src/net/retry.ts')).not.toBeChecked()
    await noToasts(window)
    await shoot(window, 'search-1280')
    await window.keyboard.press('Escape')
    await expect(review(window)).toHaveCount(0)
    await expect(window.getByTestId('pr-search-results')).toBeVisible()
    expectNoWrite(ghLog)
  } finally {
    await launched.close()
  }
})

test('Start review → Agent review: the bar says the agent writes, its comment shows on its line, the end of its turn gives the suggested verdict, Take over makes the draft mine', async () => {
  test.setTimeout(ms(180_000))
  const profile = harnessForWeb()
  const launched = await launch({ WORFY_AGENT_SCRIPT: 'pr-review-agent-turn' })
  try {
    const { app, window } = launched
    await window.setViewportSize({ width: 1280, height: 800 })
    await openView(window)
    await noToasts(window)
    await selectRow(window, 41)
    await startReview(window, 'agent')
    await expect(review(window)).toHaveAttribute('data-number', '41')
    const bar = review(window).getByTestId('pr-review-bar')
    await expect(bar).toHaveAttribute('data-state', 'writing', { timeout: ms(30_000) })
    await expect(bar).toContainText('Agent is writing the review…')
    // The menu remembers the choice: the main button now starts an Agent review.
    await expect(treeFile(window, 'src/net/retry.ts')).toBeVisible({ timeout: ms(30_000) })

    // What the Session writes, through the only way it has: on line 3 of retry.ts, at the head.
    const draft = (...args: string[]): string =>
      execFileSync(process.execPath, [PR_REVIEW_DRAFT, '-C', join(scratch, 'web'), `${WEB_REPO}#41`, ...args], { env: { ...process.env, CLAUDE_PROFILE_BIN: profile }, encoding: 'utf8' })
    expect(draft('comment', 'src/net/retry.ts', '3', 'Two hundred ms is a guess: read the delay from the config.')).toContain('pr-review-draft: wrote')
    const comment = review(window).locator('[data-testid="pr-review-comment"][data-by="agent"]')
    await expect(comment).toContainText('Two hundred ms is a guess', { timeout: ms(30_000) })
    await expect(comment).toContainText('Written by the agent')
    await expect(comment).toHaveAttribute('data-line', '3')
    // On its line in the diff, not in the list of comments on other lines.
    await expect(review(window).getByTestId('pr-review-off-lines')).toHaveCount(0)
    await expect(bar).toContainText('1 comment so far')
    await noToasts(window)
    await shoot(window, 'agent-writing-1280')

    // The end of the Session's turn: the draft is done; the suggested verdict; Take over.
    draft('verdict', 'request_changes')
    await app.evaluate(() => (globalThis as { worfyFakeRelease?: (name: string) => void }).worfyFakeRelease?.('end'))
    await expect(bar).toHaveAttribute('data-state', 'agent', { timeout: ms(30_000) })
    await expect(review(window).getByTestId('pr-review-suggests')).toContainText('Request changes')
    await expect(review(window).getByTestId('pr-review-bar-count')).toHaveText('1 comment (1 by the agent) on 1 file')
    await noToasts(window)
    await shoot(window, 'agent-done-1280')
    await review(window).getByTestId('pr-review-take-over').click()
    await expect(bar).toHaveAttribute('data-state', 'person', { timeout: ms(15_000) })
    await expect(review(window).getByTestId('pr-review-ask-agent')).toBeVisible()
    await expect(comment).toContainText('Two hundred ms is a guess')

    // The person edits the agent's comment: it is the person's from then on, Pending.
    await comment.getByTestId('pr-review-comment-edit').click()
    const field = window.getByTestId('changes-comment-popover').getByTestId('changes-comment-text')
    await expect(field).toHaveValue('Two hundred ms is a guess: read the delay from the config.')
    await field.fill('Two hundred ms is a guess: read the delay from the config, as the client does.')
    await field.press('ControlOrMeta+Enter')
    await expect(window.getByTestId('changes-comment-popover')).toHaveCount(0)
    const mine = review(window).locator('[data-testid="pr-review-comment"][data-line="3"]')
    await expect(mine).toHaveAttribute('data-by', 'person', { timeout: ms(15_000) })
    await expect(mine).toContainText('Pending')
    await expect(mine).toContainText('as the client does')
    await expect(review(window).getByTestId('pr-review-bar-count')).toHaveText('1 pending comment on 1 file')

    // Escape and back: the strip's button keeps the last choice.
    await review(window).getByTestId('pr-review-head').click()
    await window.keyboard.press('Escape')
    await expect(review(window)).toHaveCount(0)
    await expect(pane(window).getByTestId('pr-inbox-next-step-action')).toHaveText('Start review · Agent')
    expectNoWrite(ghLog)
  } finally {
    await launched.close()
  }
})

test('a window on a Linked machine with Read only: Start review inactive with its reason; View changes opens Review mode read only', async () => {
  test.setTimeout(ms(240_000))
  // A: its own Project alpha. B: web, with the gh stub's answers.
  const alpha = join(scratch, 'alpha')
  mkdirSync(alpha, { recursive: true })
  git(alpha, 'init', '-q')
  const aData = join(scratch, 'a-data')
  mkdirSync(aData, { recursive: true })
  writeFileSync(join(aData, 'projects.json'), JSON.stringify({ projects: [{ id: ALPHA, name: 'alpha', path: alpha }], activeId: ALPHA }))
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launch()
    const size = { width: 1400, height: 900 }
    await canvasReady(b, { size })
    await canvasReady(a, { size })
    // B reads its inbox: its own view shows the PR.
    await openView(b.window)
    await linkThroughUi(a.window, b.window)
    const aId = await machineIdOf(a.window)
    const bId = await machineIdOf(b.window)
    const settings = await openMachinesSettings(b)
    await settings.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true }).click()
    await chooseLevel(b.window, settings.getByTestId(`link-machine-access-${aId}`), 'read')
    await closeSettings(b.window)

    // A opens web of B and its Pull requests.
    await showSidebarSection(a.window, 'Projects')
    const webRow = a.window.locator(`[data-testid="machine-group"][data-machine-id="${bId}"] [data-testid="project-row"][data-project-id="${WEB}"]`)
    await expect(webRow).toContainText('web', { timeout: ms(20_000) })
    await webRow.getByRole('button').click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`, 'u'))
    await openView(a.window)
    await noToasts(a.window)
    await selectRow(a.window, 41)
    const start = pane(a.window).getByTestId('pr-inbox-next-step-action')
    await expect(start).toHaveAttribute('aria-disabled', 'true')
    await expect(start).toHaveAttribute('title', 'Review on the machine of the Project')
    await start.click({ force: true })
    await expect(review(a.window)).toHaveCount(0)

    await pane(a.window).getByTestId('pr-review-view').click()
    await expect(review(a.window)).toHaveAttribute('data-read-only', 'true')
    await expect(review(a.window).getByTestId('pr-review-read-only')).toHaveText('Read only')
    await expect(treeFile(a.window, 'src/net/retry.ts')).toBeVisible({ timeout: ms(30_000) })
    await expect(review(a.window).locator('[data-testid="changes-thread"][data-path="src/net/retry.ts"]')).toContainText('Why three tries?')
    await expect(review(a.window).getByTestId('pr-review-viewed')).toHaveCount(0)
    await expect(review(a.window).getByTestId('pr-review-bar')).toHaveCount(0)
    await expect(review(a.window).locator('[data-testid="changes-line"]').first()).toBeVisible({ timeout: ms(15_000) })
    await expect(review(a.window).getByTestId('changes-line-plus')).toHaveCount(0)
    await shoot(a.window, 'linked-read-only-1280')
    // Nothing read of github.com's Viewed marks: no draft was started on B.
    expect(viewedReads(ghLog)).toBe(0)
    expectNoWrite(ghLog)
  } finally {
    await a.close()
    await b?.close()
  }
})

/** The row of line `line` of `path` on the new side, in the diff of Review mode. */
const diffLine = (window: Page, path: string, line: number): Locator =>
  review(window).locator(`[data-testid="changes-hunk"][data-path="${path}"] [data-testid="changes-line"][data-side="new"][data-line="${line}"]`)

test('comments on lines: «+», Suggest change, a range by dragging «+»; Pending on their lines; worfy again — the draft and the chip Review draft; Discard', async () => {
  test.setTimeout(ms(240_000))
  harnessForWeb()
  let launched = await launch()
  try {
    let { window } = launched
    await window.setViewportSize({ width: 1280, height: 800 })
    await openView(window)
    await noToasts(window)
    await selectRow(window, 41)
    await startReview(window, 'myself')
    await expect(diffLine(window, 'src/net/retry.ts', 3)).toBeVisible({ timeout: ms(30_000) })
    await expect(review(window).getByTestId('pr-review-bar')).toHaveAttribute('data-state', 'person', { timeout: ms(15_000) })

    // «+» on line 3: the popover; Suggest change puts the line into a suggestion block after the text; ⌘↵ saves.
    await diffLine(window, 'src/net/retry.ts', 3).hover()
    await diffLine(window, 'src/net/retry.ts', 3).getByTestId('changes-line-plus').click()
    const popover = window.getByTestId('changes-comment-popover')
    await expect(popover.getByTestId('changes-comment-where')).toHaveText('src/net/retry.ts:3 · new side')
    const field = popover.getByTestId('changes-comment-text')
    await field.fill('Read it from the config:')
    await popover.getByTestId('changes-comment-suggest').click()
    await expect(field).toHaveValue('Read it from the config:\n\n```suggestion\nconst DELAY_MS = 200\n```')
    await field.press('ControlOrMeta+Enter')
    await expect(popover).toHaveCount(0)
    const first = review(window).locator('[data-testid="pr-review-comment"][data-line="3"]')
    await expect(first).toContainText('Pending', { timeout: ms(15_000) })
    await expect(first).toHaveAttribute('data-by', 'person')

    // A range: «+» of line 5 dragged down to line 6, as on GitHub (worfy-changes-view ticket 09).
    await diffLine(window, 'src/net/retry.ts', 6).scrollIntoViewIfNeeded()
    await diffLine(window, 'src/net/retry.ts', 5).hover()
    const plus = await diffLine(window, 'src/net/retry.ts', 5).getByTestId('changes-line-plus').boundingBox()
    const end = await diffLine(window, 'src/net/retry.ts', 6).locator('.w-changes__code').boundingBox()
    if (plus === null || end === null) throw new Error('lines 5 and 6 of retry.ts are not on the screen')
    await window.mouse.move(plus.x + plus.width / 2, plus.y + plus.height / 2)
    await window.mouse.down()
    await window.mouse.move(end.x + 20, end.y + end.height / 2, { steps: 6 })
    await window.mouse.up()
    await expect(popover.getByTestId('changes-comment-where')).toHaveText('src/net/retry.ts:5–6 · new side')
    await popover.getByTestId('changes-comment-text').fill('The wait comes before the first try too.')
    await popover.getByTestId('changes-comment-text').press('ControlOrMeta+Enter')
    const second = review(window).locator('[data-testid="pr-review-comment"][data-line="6"]')
    await expect(second).toContainText('lines 5–6', { timeout: ms(15_000) })
    await expect(review(window).getByTestId('pr-review-bar-count')).toHaveText('2 pending comments on 1 file')
    await expect(review(window).getByTestId('pr-review-finish')).toHaveAttribute('aria-disabled', 'false')
    await noToasts(window)
    await first.scrollIntoViewIfNeeded()
    await shoot(window, 'comments-1280')

    // worfy quits and starts again: the draft is there; the row of the PR has the chip Review draft.
    await launched.close()
    launched = await launch()
    ;({ window } = launched)
    await window.setViewportSize({ width: 1280, height: 800 })
    await openView(window)
    await noToasts(window)
    const chip = window.locator('[data-testid="pr-inbox-group"] [data-testid="pr-inbox-row"][data-number="41"]').getByTestId('pr-review-draft-chip')
    await expect(chip).toHaveText('Review draft', { timeout: ms(15_000) })
    await expect(chip).toHaveAttribute('title', `2 pending comments, started on ${headOf(41).slice(0, 7)}`)
    await noToasts(window)
    await shoot(window, 'draft-chip-1280')
    await selectRow(window, 41)
    await pane(window).getByTestId('pr-inbox-next-step-action').click()
    await expect(review(window).locator('[data-testid="pr-review-comment"][data-line="3"]')).toContainText('Read it from the config', { timeout: ms(30_000) })
    await expect(review(window).getByTestId('pr-review-bar-count')).toHaveText('2 pending comments on 1 file')

    // Discard asks first; Cancel keeps the draft, Discard removes it and closes Review mode; the chip goes.
    await review(window).getByTestId('pr-review-discard').click()
    const ask = window.getByTestId('pr-review-discard-confirm')
    await expect(ask).toContainText('Discard 2 pending comments?')
    await noToasts(window)
    await shoot(window, 'discard-1280')
    await ask.getByTestId('pr-review-discard-cancel').click()
    await expect(ask).toHaveCount(0)
    await expect(review(window)).toBeVisible()
    await review(window).getByTestId('pr-review-discard').click()
    await window.getByTestId('pr-review-discard-confirm').getByTestId('pr-review-discard-ok').click()
    await expect(review(window)).toHaveCount(0)
    await expect(chip).toHaveCount(0, { timeout: ms(15_000) })
    expectNoWrite(ghLog)
  } finally {
    await launched.close()
  }
})

/**
 * A world where worfy may submit a review: reviews.json (the stub then understands the one POST of a review) and each
 * PR as `api repos/<o>/<r>/pulls/<n>` gives it — its head `heads[n]` when given, else the head of graphql.json.
 */
function submitWorld(heads: Record<number, string> = {}): void {
  writeFileSync(join(ghDir, 'reviews.json'), '{}')
  const rest = JSON.parse(readFileSync(join(ghDir, 'rest.json'), 'utf8')) as Record<string, unknown>
  for (const pull of PULLS)
    rest[`repos/${WEB_REPO}/pulls/${pull.number}`] = { number: pull.number, state: 'open', user: { login: pull.pull.author.login }, head: { sha: heads[pull.number] ?? headOf(pull.number) }, base: { sha: BASE } }
  writeFileSync(join(ghDir, 'rest.json'), JSON.stringify(rest))
}

/** The reviews the stub took: the account and the bytes of the body worfy sent. */
const postedReviews = (): { repo: string; pr: number; login: string; raw: string }[] =>
  existsSync(join(ghDir, 'posted-reviews.json')) ? (JSON.parse(readFileSync(join(ghDir, 'posted-reviews.json'), 'utf8')) as { repo: string; pr: number; login: string; raw: string }[]) : []

/** The body of the POST as worfy builds it: the keys in this order, nothing else. */
const reviewBody = (commit: string, event: string, body: string, comments: { line: number; body: string }[]): string =>
  JSON.stringify({ commit_id: commit, event, body, comments: comments.map((each) => ({ path: 'src/net/retry.ts', line: each.line, side: 'RIGHT', body: each.body })) })

/** «+» on line `line` of retry.ts, `text`, ⌘↵: a Pending comment of the person on that line. */
async function commentOn(window: Page, line: number, text: string): Promise<void> {
  await diffLine(window, 'src/net/retry.ts', line).hover()
  await diffLine(window, 'src/net/retry.ts', line).getByTestId('changes-line-plus').click()
  const popover = window.getByTestId('changes-comment-popover')
  await popover.getByTestId('changes-comment-text').fill(text)
  await popover.getByTestId('changes-comment-text').press('ControlOrMeta+Enter')
  await expect(popover).toHaveCount(0)
  await expect(review(window).locator(`[data-testid="pr-review-comment"][data-line="${line}"]`)).toContainText('Pending', { timeout: ms(15_000) })
}

/** Finish review: the dialog, its texts checked by review-draft-lint. */
async function openFinish(window: Page): Promise<Locator> {
  await review(window).getByTestId('pr-review-finish').click()
  const dialog = window.getByTestId('pr-review-finish-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('pr-review-dialog-lint')).toHaveClass(/is-clean/u, { timeout: ms(15_000) })
  return dialog
}

test('path A: the search, Review myself, a comment, Finish review; Enter on Submit posts nothing, the click posts once, byte for byte; the chip 1/2 → 2/2; «You reviewed this pull request»', async () => {
  test.setTimeout(ms(240_000))
  harnessForWeb()
  submitWorld()
  // PR 77 asks for two approvals and has one, by dev-ana.
  const rules = { nodes: [{ ...pullRule, parameters: { ...pullRule.parameters, requiredApprovingReviewCount: 2 } }] }
  const approved = { nodes: [{ author: { login: ANA }, state: 'APPROVED', submittedAt: at(1), authorCanPushToRepository: true, commit: { oid: headOf(77) } }] }
  const pulls = PULLS.map((each) => (each.number === 77 ? { ...each, pull: { ...each.pull, baseRef: { ...each.pull.baseRef, rules }, latestOpinionatedReviews: approved } } : each))
  writeFileSync(join(ghDir, 'graphql.json'), JSON.stringify({ viewer: ME, pulls }))
  const launched = await launch()
  try {
    const { window } = launched
    await window.setViewportSize({ width: 1280, height: 800 })
    await openView(window)
    await noToasts(window)
    const field = window.getByRole('searchbox', { name: 'Search pull requests' })
    await field.fill('retry')
    await field.press('Enter')
    const result = window.getByTestId('pr-search-results').locator('[data-testid="pr-inbox-row"][data-number="77"]')
    await expect(result).toBeVisible({ timeout: ms(30_000) })
    await expect(pane(window)).toHaveAttribute('data-number', '77')
    await expect(pane(window).getByTestId('approvals-chip').first()).toContainText('1/2', { timeout: ms(15_000) })
    await result.locator('button.w-pr-inbox-item').focus()
    await window.keyboard.press('Enter')
    await expect(review(window)).toHaveAttribute('data-number', '77')
    await expect(diffLine(window, 'src/net/retry.ts', 3)).toBeVisible({ timeout: ms(30_000) })
    await expect(review(window).getByTestId('pr-review-bar')).toHaveAttribute('data-state', 'person', { timeout: ms(15_000) })
    await commentOn(window, 3, 'Read the delay from the config.')

    // The dialog: Comment first, the comment exactly as it goes, on the head the draft started on.
    const dialog = await openFinish(window)
    await expect(dialog.getByTestId('pr-review-event-COMMENT')).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByTestId('pr-review-dialog-count')).toHaveText(`1 comment will be posted on ${headOf(77).slice(0, 7)}, exactly as below`)
    await expect(dialog.getByTestId('pr-review-dialog-where')).toHaveText('src/net/retry.ts:3')
    await expect(dialog.getByTestId('pr-review-dialog-body')).toHaveText('Read the delay from the config.')
    await dialog.getByTestId('pr-review-summary').fill('Looks right to me.')
    await dialog.getByTestId('pr-review-event-APPROVE').click()
    await expect(dialog.getByTestId('pr-review-event-APPROVE')).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByTestId('pr-review-dialog-lint')).toHaveClass(/is-clean/u, { timeout: ms(15_000) })
    await noToasts(window)
    await shoot(window, 'finish-1280')

    // Enter on the focused Submit is not a click: nothing goes.
    await dialog.getByTestId('pr-review-submit').focus()
    await window.keyboard.press('Enter')
    await window.waitForTimeout(ms(1_000))
    await expect(dialog).toBeVisible()
    expectNoWrite(ghLog)

    // The click: one POST, the body byte for byte as the dialog showed it; a toast; Review mode closes.
    await dialog.getByTestId('pr-review-submit').click()
    await expect(dialog).toHaveCount(0, { timeout: ms(30_000) })
    await expect(review(window)).toHaveCount(0)
    await expect(window.getByTestId('toasts')).toContainText(`Review sent to ${WEB_REPO}#77 · Approve · 1 comment`)
    expect(postedReviews()).toEqual([
      expect.objectContaining({ repo: WEB_REPO, pr: 77, login: ME, raw: reviewBody(headOf(77), 'APPROVE', 'Looks right to me.', [{ line: 3, body: 'Read the delay from the config.' }]) }),
    ])
    // The PR read again: GitHub counts the approval.
    await expect(pane(window).getByTestId('approvals-chip').first()).toContainText('2/2', { timeout: ms(30_000) })
    await noToasts(window)
    await shoot(window, 'submitted-pane-1280')

    // Review mode again: the review is on GitHub, «You reviewed this pull request · Approve», the link, Start a new review.
    await result.locator('button.w-pr-inbox-item').focus()
    await window.keyboard.press('Enter')
    const bar = review(window).getByTestId('pr-review-bar')
    await expect(bar).toHaveAttribute('data-state', 'submitted', { timeout: ms(15_000) })
    await expect(bar).toContainText('You reviewed this pull request · Approve')
    await expect(bar.getByTestId('pr-review-open-review')).toHaveAttribute('href', `https://github.com/${WEB_REPO}/pull/77#pullrequestreview-7001`)
    await expect(bar.getByTestId('pr-review-new')).toBeVisible()
    await expect(review(window).locator('[data-testid="pr-review-comment"][data-line="3"]')).toContainText('Submitted')
    await noToasts(window)
    await shoot(window, 'submitted-bar-1280')
    expectOnlyReviewPost(ghLog, 77)
  } finally {
    await launched.close()
  }
})

test('path C: the head moved since the draft started — the dialog says so, Submit on <a> posts once on the commit the comments are on', async () => {
  test.setTimeout(ms(240_000))
  const moved = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00'
  harnessForWeb()
  submitWorld({ 41: moved })
  // The lines of the draft's commit, which GitHub gives as the compare of the base with it.
  const rest = JSON.parse(readFileSync(join(ghDir, 'rest.json'), 'utf8')) as Record<string, unknown>
  rest[`repos/${WEB_REPO}/compare/${BASE}...${headOf(41)}`] = { files: rest[`repos/${WEB_REPO}/pulls/41/files?per_page=100&page=1`] }
  writeFileSync(join(ghDir, 'rest.json'), JSON.stringify(rest))
  const launched = await launch()
  try {
    const { window } = launched
    await window.setViewportSize({ width: 1280, height: 800 })
    await openView(window)
    await noToasts(window)
    await selectRow(window, 41)
    await startReview(window, 'myself')
    await expect(diffLine(window, 'src/net/retry.ts', 3)).toBeVisible({ timeout: ms(30_000) })
    await expect(review(window).getByTestId('pr-review-bar')).toHaveAttribute('data-state', 'person', { timeout: ms(15_000) })
    await commentOn(window, 3, 'Read the delay from the config.')
    const dialog = await openFinish(window)
    const submit = dialog.getByTestId('pr-review-submit')
    await expect(submit).toHaveText('Submit review')

    // The first click finds the head moved: nothing posted, the dialog names both commits.
    await submit.click()
    await expect(dialog.getByTestId('pr-review-dialog-moved')).toContainText(`Your comments are on ${headOf(41).slice(0, 7)}; the head is ${moved.slice(0, 7)}.`, { timeout: ms(30_000) })
    await expect(submit).toHaveText(`Submit on ${headOf(41).slice(0, 7)}`)
    expectNoWrite(ghLog)
    await noToasts(window)
    await shoot(window, 'finish-moved-1280')

    await submit.click()
    await expect(dialog).toHaveCount(0, { timeout: ms(30_000) })
    expect(postedReviews().map((each) => each.raw)).toEqual([reviewBody(headOf(41), 'COMMENT', '', [{ line: 3, body: 'Read the delay from the config.' }])])
    expectOnlyReviewPost(ghLog, 41)
  } finally {
    await launched.close()
  }
})

test('path E: an Agent review suggests Request changes; the person edits one comment, removes the other in the dialog and approves — the POST has the event and the comment the person chose', async () => {
  test.setTimeout(ms(240_000))
  const profile = harnessForWeb()
  submitWorld()
  const launched = await launch({ WORFY_AGENT_SCRIPT: 'pr-review-agent-turn' })
  try {
    const { app, window } = launched
    await window.setViewportSize({ width: 1280, height: 800 })
    await openView(window)
    await noToasts(window)
    await selectRow(window, 41)
    await expect(pane(window).getByTestId('approvals-chip').first()).toContainText('0/1', { timeout: ms(15_000) })
    await startReview(window, 'agent')
    const bar = review(window).getByTestId('pr-review-bar')
    await expect(bar).toHaveAttribute('data-state', 'writing', { timeout: ms(30_000) })
    await expect(treeFile(window, 'src/net/retry.ts')).toBeVisible({ timeout: ms(30_000) })
    // Finish review waits while the agent writes.
    await expect(review(window).getByTestId('pr-review-finish')).toHaveAttribute('aria-disabled', 'true')

    const draft = (...args: string[]): string =>
      execFileSync(process.execPath, [PR_REVIEW_DRAFT, '-C', join(scratch, 'web'), `${WEB_REPO}#41`, ...args], { env: { ...process.env, CLAUDE_PROFILE_BIN: profile }, encoding: 'utf8' })
    draft('comment', 'src/net/retry.ts', '3', 'Two hundred ms is a guess: read the delay from the config.')
    draft('comment', 'src/net/retry.ts', '5', 'The wait comes before the first try too.')
    draft('verdict', 'request_changes')
    await app.evaluate(() => (globalThis as { worfyFakeRelease?: (name: string) => void }).worfyFakeRelease?.('end'))
    await expect(bar).toHaveAttribute('data-state', 'agent', { timeout: ms(30_000) })
    await expect(review(window).getByTestId('pr-review-bar-count')).toHaveText('2 comments (2 by the agent) on 1 file')

    // The person edits the comment on line 3: it is the person's.
    const three = review(window).locator('[data-testid="pr-review-comment"][data-line="3"]')
    await three.getByTestId('pr-review-comment-edit').click()
    const field = window.getByTestId('changes-comment-popover').getByTestId('changes-comment-text')
    await field.fill('Two hundred ms is a guess: read the delay from the config, as the client does.')
    await field.press('ControlOrMeta+Enter')
    await expect(three).toHaveAttribute('data-by', 'person', { timeout: ms(15_000) })

    // The dialog: Comment first whatever the agent suggests; the agent's comment flagged, with Remove.
    const dialog = await openFinish(window)
    await expect(dialog.getByTestId('pr-review-event-COMMENT')).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByTestId('pr-review-dialog-suggests')).toContainText('The agent suggests: Request changes')
    const agents = dialog.getByTestId('pr-review-dialog-comment').filter({ hasText: 'by the agent' })
    await expect(agents).toHaveCount(1)
    await expect(agents).toContainText('src/net/retry.ts:5')
    await noToasts(window)
    await shoot(window, 'finish-agent-1280')
    await agents.getByRole('button', { name: 'Remove' }).click()
    await expect(dialog.getByTestId('pr-review-dialog-comment')).toHaveCount(1)
    await expect(dialog.getByTestId('pr-review-dialog-count')).toHaveText(`1 comment will be posted on ${headOf(41).slice(0, 7)}, exactly as below`)
    await dialog.getByTestId('pr-review-event-APPROVE').click()
    await expect(dialog.getByTestId('pr-review-dialog-lint')).toHaveClass(/is-clean/u, { timeout: ms(15_000) })
    await dialog.getByTestId('pr-review-submit').click()
    await expect(dialog).toHaveCount(0, { timeout: ms(30_000) })

    expect(postedReviews().map((each) => each.raw)).toEqual([reviewBody(headOf(41), 'APPROVE', '', [{ line: 3, body: 'Two hundred ms is a guess: read the delay from the config, as the client does.' }])])
    await expect(pane(window).getByTestId('approvals-chip').first()).toContainText('1/1', { timeout: ms(30_000) })
    expectOnlyReviewPost(ghLog, 41)
  } finally {
    await launched.close()
  }
})
