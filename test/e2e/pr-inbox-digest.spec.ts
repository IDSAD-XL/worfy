import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'
import { ms } from '../time-scale'

// The morning digest of the PR inbox (worfy-pr-inbox ticket 07) against the built app: two Projects, `web` and
// `ops`, each a temporary git repository whose `origin` is on github.com, and gh the stub of launchApp over a
// graphql.json of invented PRs (test/fixtures/gh/gh-stub.mjs), as test/e2e/pr-inbox.spec.ts sets them up.
// - the first focus of the window in a day: one action toast with the counts of both inboxes;
// - a second focus the same day: no toast;
// - main's clock a day ahead (a stub of Date.now in main): the next focus shows it again, and Open opens the view;
// - the stub's log holds no write of any kind after all of it: the digest only reads (ADR-0105).
// The windows of an e2e run never take the system's focus (quiet windows), so the test sends the window its focus
// event itself. No system notification is shown in an e2e run. Every name, login and text is invented.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const WEB = 'web-0000000w'
const OPS = 'ops-0000000o'
const ME = 'dev-me'
const ANA = 'dev-ana'
const WEB_REPO = 'example-org/web'
const OPS_REPO = 'example-org/ops'
const DAY_MS = 24 * 3_600_000

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

/** A PR of the stub in the shape of the reader's details query; mine unless `author` says otherwise. */
function stubPull(repo: string, number: number, title: string, over: { author?: string; requested?: string; threads?: unknown[] } = {}) {
  return {
    repo,
    number,
    updatedAt: at(1),
    headRefOid: `sha${number}`,
    reviewRequested: over.requested !== undefined,
    involves: true,
    pull: {
      title,
      url: `https://github.com/${repo}/pull/${number}`,
      state: 'OPEN',
      isDraft: false,
      createdAt: at(72),
      author: { login: over.author ?? ME },
      headRefName: `feature/${number}`,
      reviewDecision: null,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
      reviewRequests: { nodes: over.requested === undefined ? [] : [{ requestedReviewer: { __typename: 'User', login: over.requested } }] },
      latestOpinionatedReviews: { nodes: [] },
      reviewThreads: { nodes: over.threads ?? [] },
      comments: { nodes: [] },
    },
  }
}

const comment = (id: string, hoursAgo: number, body: string) => ({
  id,
  databaseId: Number(id.replace(/\D/gu, '')),
  author: { login: ANA },
  body,
  createdAt: at(hoursAgo),
  url: `https://github.com/${WEB_REPO}/pull/118#discussion_r${id.replace(/\D/gu, '')}`,
})

/** web: a review asked of me, my PR with two new comments in a thread; ops: a review asked of me. */
const PULLS = [
  stubPull(WEB_REPO, 41, 'Add the export button', { author: ANA, requested: ME }),
  stubPull(WEB_REPO, 118, 'Retry the upload', {
    threads: [{ id: 'T1', isResolved: false, isOutdated: false, path: 'src/upload.ts', line: 12, viewerCanReply: true, comments: { nodes: [comment('C11', 5, 'Why three tries here?'), comment('C12', 4, 'A comment would help')] } }],
  }),
  stubPull(OPS_REPO, 5, 'Rotate the keys', { author: ANA, requested: ME }),
]

function repo(name: string, slug: string): string {
  const path = join(scratch, name)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'README.md'), `# ${name}\n`)
  git(path, 'init', '-q')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'init')
  git(path, 'remote', 'add', 'origin', `https://github.com/${slug}.git`)
  return path
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-pr-digest-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  ghDir = join(scratch, 'gh')
  ghLog = join(scratch, 'gh-calls.jsonl')
  mkdirSync(claudeHome, { recursive: true })
  mkdirSync(ghDir, { recursive: true })
  writeFileSync(join(ghDir, 'graphql.json'), JSON.stringify({ viewer: ME, pulls: PULLS }))
  const web = repo('web', WEB_REPO)
  const ops = repo('ops', OPS_REPO)
  mkdirSync(join(dataDir, WEB), { recursive: true })
  mkdirSync(join(dataDir, OPS), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: WEB, name: 'web', path: web }, { id: OPS, name: 'ops', path: ops }], activeId: WEB }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** Every gh call so far, its arguments. */
const ghCalls = (): string[][] => (existsSync(ghLog) ? readFileSync(ghLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]) : [])

/** No gh call that could write: no method but GET, no GraphQL mutation, no REST body or input, no writing `gh pr` or `gh issue`. */
function expectNoWrite(): void {
  const writes = ghCalls().filter((args) => {
    const method = args.find((arg, index) => args[index - 1] === '-X' || args[index - 1] === '--method' || arg.startsWith('--method='))
    if (method !== undefined && method.replace('--method=', '').toUpperCase() !== 'GET') return true
    if (args.some((arg) => /\bmutation\b/u.test(arg))) return true
    if (args[0] === 'api' && args[1] !== 'graphql' && args.some((arg) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(arg))) return true
    return (args[0] === 'pr' || args[0] === 'issue') && ['comment', 'review', 'merge', 'edit', 'create', 'close', 'ready'].includes(args[1] ?? '')
  })
  expect(writes).toEqual([])
}

const digest = (window: Page): Locator => window.getByTestId('pr-inbox-digest')
/** The window's `focus` event, as the system's focus would send it. */
const focusWindow = (page: Page): Promise<boolean> => page.evaluate(() => (globalThis as unknown as { dispatchEvent: (event: Event) => boolean }).dispatchEvent(new Event('focus')))
const sectionRow = (window: Page, project: string, group: string): Locator => window.locator(`[data-testid="pr-inbox-section-row"][data-project="${project}"][data-group="${group}"]`)

test('the first focus of the day shows one digest toast; the second shows none; the next day it comes again and Open opens the view; nothing is written to GitHub', async () => {
  const launched: LaunchedApp = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, GH_STUB_DIR: ghDir, GH_STUB_LOG: ghLog } })
  try {
    const { app, window } = launched
    // Both inboxes read once: the sidebar counts them.
    await expect(sectionRow(window, WEB, 'needs-review')).toBeVisible({ timeout: ms(30_000) })
    await expect(sectionRow(window, OPS, 'needs-review')).toBeVisible({ timeout: ms(30_000) })

    await focusWindow(window)
    await expect(digest(window)).toHaveCount(1)
    await expect(digest(window)).toContainText('2 reviews wait for you (oldest 3 days) · 1 PR has new comments')
    await expect(digest(window).getByRole('button', { name: 'Open' })).toBeVisible()
    await digest(window).getByRole('button', { name: 'Dismiss' }).click()
    await expect(digest(window)).toHaveCount(0)

    // A second focus the same day: main answers nothing.
    await focusWindow(window)
    await window.waitForTimeout(ms(1_500))
    await expect(digest(window)).toHaveCount(0)

    // The next day by main's clock.
    await app.evaluate((_electron, ahead) => {
      const real = Date.now.bind(Date)
      Date.now = () => real() + ahead
    }, DAY_MS)
    await focusWindow(window)
    await expect(digest(window)).toHaveCount(1)
    await digest(window).getByRole('button', { name: 'Open' }).click()
    await expect(window.getByTestId('pr-inbox-view')).toBeVisible()
    await expect(window.getByTestId('pr-inbox-view')).toHaveAttribute('data-project', WEB)
    await expect(digest(window)).toHaveCount(0)

    expect(ghCalls().length).toBeGreaterThan(0)
    expectNoWrite()
  } finally {
    await launched.close()
  }
})
