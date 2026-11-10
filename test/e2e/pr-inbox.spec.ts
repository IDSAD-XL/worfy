import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { ms } from '../time-scale'

// The Pull requests view (worfy-pr-inbox ticket 03) against the built app: two Projects, `web` and `ops`, each a
// temporary git repository whose `origin` is on github.com, and gh the stub of launchApp over a graphql.json of
// invented PRs (test/fixtures/gh/gh-stub.mjs). The reader of ticket 02 searches them; the view shows them.
// - the toolbar tab opens the view, the sidebar section counts the groups, the palette opens the view too;
// - a row opens to its threads, and "N new since you looked" goes;
// - openPrInboxOf with a PR of the other Project selects that Project and opens its view on the PR;
// - the switch of Project settings: off, main runs no gh for the Project; on again, it reads;
// - the stub's log holds no write of any kind after all of it: the view only reads (ADR-0105).
// Every name, login and text is invented.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const WEB = 'web-0000000w'
const OPS = 'ops-0000000o'
const ME = 'dev-me'
const ANA = 'dev-ana'
/** The reader's look at the Projects (INBOX_TICK_MS of src/main/github/inbox.ts) and a margin: a Project never read is read at the next one. */
const TICK_AND_MARGIN_MS = 35_000

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
const comment = (id: string, author: string, hoursAgo: number, body: string, repo: string, number: number) => ({
  id,
  databaseId: Number(id.replace(/\D/gu, '')) || 1,
  author: { login: author },
  body,
  createdAt: at(hoursAgo),
  url: `https://github.com/${repo}/pull/${number}#discussion_r${id.replace(/\D/gu, '')}`,
})

interface StubPull {
  repo: string
  number: number
  updatedAt: string
  headRefOid: string
  reviewRequested: boolean
  involves: boolean
  pull: Record<string, unknown>
}

/** A PR of the stub in the shape of the reader's details query; mine unless `author` says otherwise. */
function stubPull(repo: string, number: number, title: string, over: { author?: string; requested?: { login?: string; team?: string }[]; reviewDecision?: string | null; ci?: string; threads?: unknown[]; draft?: boolean } = {}): StubPull {
  const author = over.author ?? ME
  const requested = over.requested ?? []
  return {
    repo,
    number,
    updatedAt: at(1),
    headRefOid: `sha${number}`,
    reviewRequested: requested.length > 0,
    involves: true,
    pull: {
      title,
      url: `https://github.com/${repo}/pull/${number}`,
      state: 'OPEN',
      isDraft: over.draft ?? false,
      createdAt: at(72),
      author: { login: author },
      headRefName: `feature/${number}`,
      reviewDecision: over.reviewDecision ?? null,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      commits: { nodes: [{ commit: { statusCheckRollup: { state: over.ci ?? 'SUCCESS' } } }] },
      reviewRequests: { nodes: requested.map((who) => ({ requestedReviewer: who.team ? { __typename: 'Team', slug: who.team } : { __typename: 'User', login: who.login } })) },
      latestOpinionatedReviews: { nodes: [] },
      reviewThreads: { nodes: over.threads ?? [] },
      comments: { nodes: [] },
    },
  }
}

const WEB_REPO = 'example-org/web'
const OPS_REPO = 'example-org/ops'

/** web: a review asked of my team, my PR owing an answer with two new comments, one with red CI; ops: one review asked of me. */
const PULLS: StubPull[] = [
  stubPull(WEB_REPO, 41, 'Add the export button', { author: ANA, requested: [{ team: 'web-team' }], reviewDecision: 'REVIEW_REQUIRED', ci: 'PENDING' }),
  stubPull(WEB_REPO, 118, 'Retry the upload', {
    threads: [
      {
        id: 'T1',
        isResolved: false,
        isOutdated: false,
        path: 'src/upload.ts',
        line: 12,
        viewerCanReply: true,
        comments: { nodes: [comment('C11', ANA, 5, 'Why three tries here?', WEB_REPO, 118), comment('C12', ANA, 4, 'A comment would help', WEB_REPO, 118)] },
      },
    ],
  }),
  stubPull(WEB_REPO, 40, 'Fix the date picker', { ci: 'FAILURE' }),
  stubPull(OPS_REPO, 5, 'Rotate the keys', { author: ANA, requested: [{ login: ME }] }),
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

/** The Project's settings.json with the PR inbox switched as asked (the templates empty: not configured). */
function settings(projectId: string, prInbox: boolean): void {
  mkdirSync(join(dataDir, projectId), { recursive: true })
  writeFileSync(join(dataDir, projectId, 'settings.json'), JSON.stringify({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '' }, prInbox }))
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-pr-inbox-')))
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

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, GH_STUB_DIR: ghDir, GH_STUB_LOG: ghLog } })

/** Every gh call so far, its arguments. */
const ghCalls = (): string[][] => (existsSync(ghLog) ? readFileSync(ghLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]) : [])
const graphqlCalls = (): string[][] => ghCalls().filter((args) => args[0] === 'api' && args[1] === 'graphql')

/** No call that could write to GitHub: no method but GET, no GraphQL mutation, no `gh pr` or `gh issue` subcommand that writes. */
function expectNoWrite(): void {
  const writes = ghCalls().filter((args) => {
    const method = args.findIndex((arg) => arg === '-X' || arg === '--method')
    if (method >= 0 && args[method + 1]?.toUpperCase() !== 'GET') return true
    if (args.some((arg) => /^query=\s*mutation\b/u.test(arg))) return true
    return (args[0] === 'pr' || args[0] === 'issue') && ['comment', 'review', 'merge', 'edit', 'create', 'close', 'ready'].includes(args[1] ?? '')
  })
  expect(writes).toEqual([])
}

const section = (window: Page): Locator => window.getByRole('region', { name: 'Pull requests' })
const sectionRow = (window: Page, project: string, group: string): Locator => window.locator(`[data-testid="pr-inbox-section-row"][data-project="${project}"][data-group="${group}"]`)
const view = (window: Page): Locator => window.getByTestId('pr-inbox-view')
const prRow = (window: Page, repo: string, number: number): Locator => window.locator(`[data-testid="pr-inbox-row"][data-repo="${repo}"][data-number="${number}"]`)

test('the toolbar, the sidebar and the palette open the view; a row opens to its threads and its new mark goes; nothing is written to GitHub', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    // The sidebar counts the groups of both Projects once the first search has answered.
    await expect(sectionRow(window, WEB, 'needs-review')).toContainText('Needs my review1', { timeout: ms(30_000) })
    await expect(sectionRow(window, WEB, 'needs-answer')).toContainText('Needs my answer1')
    await expect(sectionRow(window, WEB, 'needs-fix')).toContainText('Needs a fix1')
    await expect(sectionRow(window, OPS, 'needs-review')).toContainText('Needs my review1')
    await expect(section(window).getByTestId('pr-inbox-section-row')).toHaveCount(4)

    // The toolbar: the fifth tab opens the view of the active Project.
    const views = window.getByRole('group', { name: 'View', exact: true })
    await expect(views.getByRole('button')).toHaveText(['Canvas', 'Session', 'Pipeline', 'Runs', 'Pull requests'])
    await views.getByRole('button', { name: 'Pull requests' }).click()
    await expect(views.getByRole('button', { name: 'Pull requests' })).toHaveAttribute('aria-pressed', 'true')
    await expect(window.getByRole('main', { name: 'Pull requests' })).toBeVisible()
    await expect(view(window)).toHaveAttribute('data-project', WEB)
    await expect(view(window).getByTestId('pr-inbox-group-title')).toHaveText(['Needs my review', 'Needs my answer', 'Needs a fix', 'Ready', 'Waiting on others'])
    await expect(prRow(window, WEB_REPO, 41).getByTestId('pr-inbox-via-team')).toHaveText('via team')
    await expect(view(window).getByTestId('pr-inbox-next')).toHaveText(/^Next search in \d+ min$/u)
    const shots = await snapshotThemes(window, 'pr-inbox-view')
    console.log(`pull requests view: ${shots.light} ${shots.dark}`)

    // A row opens to its thread; "2 new since you looked" goes once main has the look.
    const answer = prRow(window, WEB_REPO, 118)
    await expect(answer.getByTestId('pr-inbox-new')).toHaveText('2 new since you looked')
    await answer.getByRole('button', { name: /Retry the upload/u }).click()
    await expect(answer.getByTestId('pr-inbox-thread')).toHaveCount(1)
    await expect(answer.getByTestId('pr-inbox-thread-link')).toHaveText('src/upload.ts:12')
    await expect(answer.getByTestId('pr-inbox-comment')).toHaveCount(2)
    await expect(answer.getByTestId('pr-inbox-comment').first()).toContainText('Why three tries here?')
    await expect(answer.getByTestId('pr-inbox-new')).toHaveCount(0)
    // What the user has seen is in the Project's data folder, as ids and a time, never a text (ADR-0005).
    const seen = readFileSync(join(dataDir, WEB, 'pr-inbox.json'), 'utf8')
    expect(JSON.parse(seen)).toMatchObject({ pulls: { [`${WEB_REPO}#118`]: { seenHeadOid: 'sha118' } } })
    expect(seen).not.toContain('three tries')
    const threadShots = await snapshotThemes(window, 'pr-inbox-thread')
    console.log(`pull requests thread: ${threadShots.light} ${threadShots.dark}`)

    // The palette opens the view from the Canvas.
    await views.getByRole('button', { name: 'Canvas' }).click()
    await expect(view(window)).toBeHidden()
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('Pull requests')
    await expect(window.getByTestId('palette-option').first()).toContainText('Pull requests')
    await window.keyboard.press('Enter')
    await expect(view(window)).toBeVisible()

    // A group of the sidebar opens the view on that group.
    await views.getByRole('button', { name: 'Canvas' }).click()
    await sectionRow(window, WEB, 'needs-fix').click()
    await expect(view(window)).toBeVisible()
    await expect(view(window).locator('[data-testid="pr-inbox-group"][data-focused="true"]')).toHaveAttribute('data-group', 'needs-fix')

    // The view open and a thread open: the stub saw reads only.
    expect(graphqlCalls().length).toBeGreaterThan(0)
    expectNoWrite()
  } finally {
    await launched.close()
  }
})

test('openPrInboxOf with a PR of the other Project selects it and opens its view on that PR', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await launched.app.context().addInitScript(() => {
      ;(globalThis as unknown as { __worfyPrInbox: object }).__worfyPrInbox = {}
    })
    await window.reload()
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect.poll(() => window.evaluate(() => typeof (globalThis as unknown as { __worfyPrInbox?: { open?: unknown } }).__worfyPrInbox?.open)).toBe('function')
    await expect(sectionRow(window, OPS, 'needs-review')).toBeVisible({ timeout: ms(30_000) })

    const refused = await window.evaluate(
      ([project, active, slug]) =>
        (globalThis as unknown as { __worfyPrInbox: { open: (p: string, a: string, pr: { repo: string; number: number }) => Promise<string | undefined> } }).__worfyPrInbox.open(project, active, { repo: slug, number: 5 }),
      [OPS, WEB, OPS_REPO] as const,
    )
    expect(refused ?? null).toBeNull()
    await expect(window.locator('.w-toolbar__subtitle')).toHaveAttribute('title', /^ops · /u)
    await expect(view(window)).toHaveAttribute('data-project', OPS)
    await expect(prRow(window, OPS_REPO, 5)).toHaveAttribute('data-expanded', 'true')
    await expect(prRow(window, OPS_REPO, 5).getByTestId('pr-inbox-body')).toBeVisible()

    // A PR the inbox does not hold: the view opens and says so.
    await window.evaluate(
      ([project, slug]) =>
        (globalThis as unknown as { __worfyPrInbox: { open: (p: string, a: string, pr: { repo: string; number: number }) => Promise<string | undefined> } }).__worfyPrInbox.open(project, project, { repo: slug, number: 999 }),
      [OPS, OPS_REPO] as const,
    )
    await expect(view(window).getByTestId('pr-inbox-missing')).toHaveText(`This pull request is not in the inbox: ${OPS_REPO}#999`)
    expectNoWrite()
  } finally {
    await launched.close()
  }
})

test('the switch of Project settings: off, main runs no gh for the Project; on, it reads; off again, the view says so', async () => {
  test.setTimeout(ms(240_000))
  // Both Projects start with the switch off.
  settings(WEB, false)
  settings(OPS, false)
  const launched = await launch()
  try {
    const { window } = launched
    const views = window.getByRole('group', { name: 'View', exact: true })
    await views.getByRole('button', { name: 'Pull requests' }).click()
    await expect(view(window).getByTestId('pr-inbox-off')).toBeVisible({ timeout: ms(15_000) })
    await expect(section(window).getByTestId('pr-inbox-section-empty')).toBeVisible()
    const shots = await snapshotThemes(window, 'pr-inbox-off')
    console.log(`pull requests view, off: ${shots.light} ${shots.dark}`)
    // Past one look of the reader, which reads a Project never read: still not one search.
    await window.waitForTimeout(TICK_AND_MARGIN_MS)
    expect(graphqlCalls()).toEqual([])

    // On in Project settings of web: the reader searches at its next look, and the view fills.
    const openSettings = async () => {
      await window.getByTestId('project-row').filter({ hasText: 'web' }).click({ button: 'right' })
      await window.getByRole('menuitem', { name: 'Project settings…' }).click()
      return window.getByRole('dialog', { name: 'Project settings' })
    }
    let dialog = await openSettings()
    const toggle = dialog.getByRole('switch', { name: 'Read pull requests from GitHub' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    expect(JSON.parse(readFileSync(join(dataDir, WEB, 'settings.json'), 'utf8'))).toMatchObject({ prInbox: true })
    await expect(prRow(window, WEB_REPO, 118)).toBeVisible({ timeout: ms(TICK_AND_MARGIN_MS + 10_000) })
    expect(graphqlCalls().length).toBeGreaterThan(0)
    // ops stays off: no search names its repository.
    expect(graphqlCalls().filter((args) => args.join(' ').includes(OPS_REPO))).toEqual([])

    // Off again: the view says so at once, and the reader runs no more gh for web.
    dialog = await openSettings()
    await expect(dialog.getByRole('switch', { name: 'Read pull requests from GitHub' })).toHaveAttribute('aria-checked', 'true')
    await dialog.getByRole('switch', { name: 'Read pull requests from GitHub' }).click()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(view(window).getByTestId('pr-inbox-off')).toBeVisible()
    await expect(prRow(window, WEB_REPO, 118)).toHaveCount(0)
    const before = graphqlCalls().length
    await window.waitForTimeout(TICK_AND_MARGIN_MS)
    expect(graphqlCalls()).toHaveLength(before)
    expectNoWrite()
  } finally {
    await launched.close()
  }
})
