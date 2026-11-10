import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, showSidebarSection, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'
import { ms } from '../time-scale'

// The Pull requests view (worfy-pr-inbox ticket 03) against the built app: two Projects, `web` and `ops`, each a
// temporary git repository whose `origin` is on github.com, and gh the stub of launchApp over a graphql.json of
// invented PRs (test/fixtures/gh/gh-stub.mjs). The reader of ticket 02 searches them; the view shows them.
// - the toolbar tab opens the view, the sidebar section counts the groups, the palette opens the view too;
// - two panes (worfy-polish 96): the list by group on the left, the selected PR on the right with its threads; a click
//   or ↑ / ↓ selects a PR, and its "N new since you looked" goes; Send all (2) of the strip opens its dialog and posts
//   nothing on Cancel; a long repository name at 1280 px is cut alone, the list never scrolls sideways; screenshots at
//   1280 and 1600 px, both themes;
// - openPrInboxOf with a PR of the other Project selects that Project and opens its view on the PR;
// - the switch of Project settings: off, main runs no gh for the Project; on again, it reads;
// - the stub's log holds no write of any kind after all of it: the view only reads (ADR-0105);
// - a draft reply (worfy-pr-inbox ticket 05): shown under its thread in the pane of the selected PR, nothing posted
//   without a click — not on selecting, not on ↑ / ↓; edited and sent, one POST whose body is the edited text (the Profile folder and review-draft-lint are the repository's own scripts
//   over a temporary Harness home, through stand-ins in the temporary Claude home).
// Every name, login and text is invented.

const PROFILE = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'profile')
const REVIEW_DRAFT_LINT = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'review-draft-lint')

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
function stubPull(
  repo: string,
  number: number,
  title: string,
  over: { author?: string; requested?: { login?: string; team?: string }[]; reviewDecision?: string | null; ci?: string; threads?: unknown[]; draft?: boolean; size?: [number, number]; merge?: string; branch?: string } = {},
): StubPull {
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
      headRefName: over.branch ?? `feature/${number}`,
      reviewDecision: over.reviewDecision ?? null,
      mergeable: 'MERGEABLE',
      mergeStateStatus: over.merge ?? 'CLEAN',
      additions: over.size?.[0] ?? 40,
      deletions: over.size?.[1] ?? 6,
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
  stubPull(WEB_REPO, 41, 'Add the export button', { author: ANA, requested: [{ team: 'web-team' }], reviewDecision: 'REVIEW_REQUIRED', ci: 'PENDING', size: [96, 310], merge: 'BLOCKED' }),
  stubPull(WEB_REPO, 118, 'Retry the upload', {
    size: [184, 22],
    reviewDecision: 'REVIEW_REQUIRED',
    merge: 'BLOCKED',
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
  stubPull(WEB_REPO, 40, 'Fix the date picker', { ci: 'FAILURE', size: [12, 9], merge: 'UNSTABLE' }),
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
  writeFileSync(join(dataDir, projectId, 'settings.json'), JSON.stringify({ actionTemplates: { shipTicket: '', runWave: '', gateQueue: '', prReply: '' }, prInbox }))
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

/**
 * No call that could write to GitHub: no method but GET; no REST call with a body (`-f`, `-F`, `--field`,
 * `--raw-field`, `--input`) unless it says GET, since gh then sends a POST; no GraphQL mutation, and no GraphQL
 * body from a file; no `gh pr` or `gh issue` subcommand that writes.
 */
function expectNoWrite(): void {
  // A flag as gh takes it: `--name value`, `--name=value`, `-x value` or `-xvalue`.
  const valueOf = (args: string[], names: string[]): string | undefined => {
    for (const [index, arg] of args.entries()) {
      for (const name of names) {
        if (arg === name) return args[index + 1] ?? ''
        if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
        if (!name.startsWith('--') && arg.startsWith(name)) return arg.slice(name.length)
      }
    }
    return undefined
  }
  const writes = ghCalls().filter((args) => {
    const named = valueOf(args, ['-X', '--method'])?.toUpperCase()
    if (named !== undefined && named !== 'GET') return true
    if (args.some((arg) => /^(?:-[fF]|--field=|--raw-field=)?query=\s*mutation\b/u.test(arg))) return true
    if (args[0] === 'api') {
      if (valueOf(args, ['--input']) !== undefined) return true
      const body = valueOf(args, ['-f', '-F', '--field', '--raw-field']) !== undefined
      if (args[1] !== 'graphql' && body && named !== 'GET') return true
    }
    return (args[0] === 'pr' || args[0] === 'issue') && ['comment', 'review', 'merge', 'edit', 'create', 'close', 'ready'].includes(args[1] ?? '')
  })
  expect(writes).toEqual([])
}

const section = (window: Page): Locator => window.getByRole('region', { name: 'Pull requests' })
const sectionRow = (window: Page, project: string, group: string): Locator => window.locator(`[data-testid="pr-inbox-section-row"][data-project="${project}"][data-group="${group}"]`)
const view = (window: Page): Locator => window.getByTestId('pr-inbox-view')
const prRow = (window: Page, repo: string, number: number): Locator => window.locator(`[data-testid="pr-inbox-row"][data-repo="${repo}"][data-number="${number}"]`)
const pane = (window: Page): Locator => window.getByTestId('pr-inbox-pane')
/** The PRs the list marks selected, as `owner/name#N`. */
const selectedRows = (window: Page): Promise<string[]> =>
  window.locator('[data-testid="pr-inbox-row"][data-selected="true"]').evaluateAll((rows) => rows.map((row) => `${row.getAttribute('data-repo')}#${row.getAttribute('data-number')}`))

test('the toolbar, the sidebar and the palette open the view; a click and ↑ / ↓ select a PR, its threads show and its new mark goes; nothing is written to GitHub', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    await showSidebarSection(window, 'Pull requests')
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
    // The list holds the groups that have a PR; the view selects the one that waits for an answer by itself.
    await expect(view(window).getByTestId('pr-inbox-group-title')).toHaveText(['Needs my review', 'Needs my answer', 'Needs a fix'])
    await expect(view(window).getByTestId('pr-inbox-next')).toHaveText(/^Next search in \d+ min$/u)
    await expect(pane(window)).toHaveAttribute('data-number', '118')
    expect(await selectedRows(window)).toEqual([`${WEB_REPO}#118`])
    const shots = await snapshotThemes(window, 'pr-inbox-view')
    console.log(`pull requests view: ${shots.light} ${shots.dark}`)

    // The selected PR in full: its thread, what to do next, CI, review, merge state and size.
    const answer = prRow(window, WEB_REPO, 118)
    await expect(pane(window).getByTestId('pr-inbox-thread')).toHaveCount(1)
    await expect(pane(window).getByTestId('pr-inbox-thread-link')).toHaveText('src/upload.ts:12')
    await expect(pane(window).getByTestId('pr-inbox-comment')).toHaveCount(2)
    await expect(pane(window).getByTestId('pr-inbox-comment').first()).toContainText('Why three tries here?')
    await expect(pane(window).getByTestId('pr-inbox-next-step-title')).toHaveText('Answer 1 open thread')
    await expect(pane(window).getByTestId('pr-inbox-size')).toHaveText('+184−22')
    await expect(pane(window).getByTestId('pr-inbox-merge')).toHaveText('Blocked')
    await expect(pane(window).getByTestId('pr-inbox-review')).toHaveText('Review required')
    // Selected by the view itself: still new. A click is the user's look: "2 new since you looked" goes once main has it.
    await expect(answer.getByTestId('pr-inbox-new')).toHaveAttribute('aria-label', '2 new since you looked')
    await expect(pane(window).getByTestId('pr-inbox-pane-new')).toHaveText('2 new since you looked')
    await answer.getByRole('button', { name: /Retry the upload/u }).click()
    await expect(answer.getByTestId('pr-inbox-new')).toHaveCount(0)
    await expect(pane(window).getByTestId('pr-inbox-pane-new')).toHaveCount(0)
    // What the user has seen is in the Project's data folder, as ids and a time, never a text (ADR-0005).
    const seen = readFileSync(join(dataDir, WEB, 'pr-inbox.json'), 'utf8')
    expect(JSON.parse(seen)).toMatchObject({ pulls: { [`${WEB_REPO}#118`]: { seenHeadOid: 'sha118' } } })
    expect(seen).not.toContain('three tries')

    // ↑ and ↓ move the selection along the list: the review request through a team, then the PR to fix.
    await window.keyboard.press('ArrowUp')
    await expect(pane(window)).toHaveAttribute('data-number', '41')
    await expect(pane(window).getByTestId('pr-inbox-via-team')).toHaveText('via team')
    await expect(pane(window).getByTestId('pr-inbox-next-step-title')).toHaveText('Your review is asked')
    await window.keyboard.press('ArrowDown')
    await window.keyboard.press('ArrowDown')
    await expect(pane(window)).toHaveAttribute('data-number', '40')
    await expect(pane(window).getByTestId('pr-inbox-next-step-title')).toHaveText('CI failing')
    expect(await selectedRows(window)).toEqual([`${WEB_REPO}#40`])

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
    await showSidebarSection(window, 'Pull requests')
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
    await expect(prRow(window, OPS_REPO, 5)).toHaveAttribute('data-selected', 'true')
    await expect(pane(window)).toHaveAttribute('data-repo', OPS_REPO)
    await expect(pane(window).getByTestId('pr-inbox-pane-title')).toHaveText('Rotate the keys')

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
  test.setTimeout(ms(180_000))
  // Both Projects start with the switch off.
  settings(WEB, false)
  settings(OPS, false)
  const launched = await launch()
  try {
    const { window } = launched
    await showSidebarSection(window, 'Pull requests')
    const views = window.getByRole('group', { name: 'View', exact: true })
    await views.getByRole('button', { name: 'Pull requests' }).click()
    await expect(view(window).getByTestId('pr-inbox-off')).toBeVisible({ timeout: ms(15_000) })
    await expect(section(window).getByTestId('pr-inbox-section-empty')).toBeVisible()
    const shots = await snapshotThemes(window, 'pr-inbox-off')
    console.log(`pull requests view, off: ${shots.light} ${shots.dark}`)
    // Past one look of the reader, which reads a Project never read: still not one search.
    await window.waitForTimeout(TICK_AND_MARGIN_MS)
    expect(graphqlCalls()).toEqual([])

    // On in Project settings of web: the view asks again on the settings change and main reads web at once, without
    // waiting for the reader's next look (30 s), so the view fills within the usual wait.
    const openSettings = async () => {
      await showSidebarSection(window, 'Projects')
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
    await expect(prRow(window, WEB_REPO, 118)).toBeVisible({ timeout: ms(15_000) })
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

/**
 * A Harness home where `web` is a registered Project with a Profile folder, and stand-ins of `profile` and
 * `review-draft-lint` in the Claude home (the old layout, src/main/harness/locate.ts) that run the repository's own
 * scripts over it: nothing of the machine's own Harness is read or written. Returns the Profile folder.
 */
function harnessForWeb(): string {
  const harnessHome = join(scratch, 'harness-home')
  const home = join(scratch, 'home')
  const profileDir = join(harnessHome, 'projects', 'web')
  for (const dir of [join(harnessHome, 'gate'), profileDir, home, join(claudeHome, 'bin')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'web', match: join(scratch, 'web'), profile: 'web' }] }))
  // The account replies go from: without one Send refuses.
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
  return profileDir
}

test('a draft reply under its thread in the pane: nothing is posted on selecting or on ↑ / ↓; edited and sent, one POST with the edited text', async () => {
  const profileDir = harnessForWeb()
  const draftFile = join(profileDir, 'state', 'pr-inbox', 'drafts', 'example-org-web-118.json')
  mkdirSync(dirname(draftFile), { recursive: true })
  const drafted = 'Three tries: the server drops the first one.'
  writeFileSync(
    draftFile,
    JSON.stringify({ schema: 1, repo: WEB_REPO, pr: 118, headOid: 'abc1234', items: [{ kind: 'thread', threadId: 'T1', replyTo: 11, label: 'needs answer', body: drafted, fixPlan: null, state: 'draft', sentUrl: null }] }),
  )
  // The stub may take the reply to thread T1, whose first comment is C11.
  writeFileSync(join(ghDir, 'replies.json'), JSON.stringify({ threads: { T1: 11 } }))
  const launched = await launch()
  try {
    const { window } = launched
    await showSidebarSection(window, 'Pull requests')
    const views = window.getByRole('group', { name: 'View', exact: true })
    await expect(sectionRow(window, WEB, 'needs-answer')).toBeVisible({ timeout: ms(30_000) })
    await views.getByRole('button', { name: 'Pull requests' }).click()
    // Another PR selected: its pane has no draft.
    await prRow(window, WEB_REPO, 41).getByRole('button').click()
    await expect(pane(window)).toHaveAttribute('data-number', '41')
    await expect(pane(window).getByTestId('pr-draft')).toHaveCount(0)
    // ↓ to the PR that waits for an answer: its draft shows under its thread, with the strip that counts it.
    await window.keyboard.press('ArrowDown')
    await expect(pane(window)).toHaveAttribute('data-number', '118')
    const draft = pane(window).getByTestId('pr-inbox-thread').getByTestId('pr-draft')
    await expect(draft.getByTestId('pr-draft-field')).toHaveValue(drafted, { timeout: ms(15_000) })
    await expect(pane(window).getByTestId('pr-inbox-next-step')).toContainText('1 draft reply is ready below: read, edit, then Send under its thread.')
    await expect(pane(window).getByTestId('pr-inbox-draft-replies')).toBeEnabled()
    const shots = await snapshotThemes(window, 'pr-inbox-draft')
    console.log(`pull requests draft: ${shots.light} ${shots.dark}`)
    // ↓ and ↑ again, the view open and the draft read again: not one write.
    await window.keyboard.press('ArrowDown')
    await expect(pane(window)).toHaveAttribute('data-number', '40')
    await window.keyboard.press('ArrowUp')
    await expect(draft.getByTestId('pr-draft-field')).toHaveValue(drafted, { timeout: ms(15_000) })
    await window.waitForTimeout(ms(6_000))
    expectNoWrite()
    expect(ghCalls().filter((args) => args.includes('POST'))).toEqual([])

    const edited = 'Three tries: the server drops the first one.\nI will say so in a comment above the loop.'
    await draft.getByTestId('pr-draft-field').fill(edited)
    expectNoWrite()
    await draft.getByTestId('pr-draft-send').click()
    await expect(draft.getByTestId('pr-draft-sent')).toBeVisible({ timeout: ms(30_000) })
    await expect(draft.getByTestId('pr-draft-sent')).toContainText('View on GitHub')

    const posts = ghCalls().filter((args) => args[0] === 'api' && args.includes('POST'))
    expect(posts).toEqual([['api', '--method', 'POST', `repos/${WEB_REPO}/pulls/118/comments/11/replies`, '-f', `body=${edited}`]])
    expect(JSON.parse(readFileSync(join(ghDir, 'posted.json'), 'utf8'))).toEqual([{ repo: WEB_REPO, pr: 118, replyTo: 11, login: ME, body: edited, url: `https://github.com/${WEB_REPO}/pull/118#discussion_r9001` }])
    const file = JSON.parse(readFileSync(draftFile, 'utf8')) as { items: Record<string, unknown>[] }
    expect(file.items[0]).toMatchObject({ state: 'sent', body: edited, edited: true, sentUrl: `https://github.com/${WEB_REPO}/pull/118#discussion_r9001` })
  } finally {
    await launched.close()
  }
})

/** Where the screenshots of the two panes go for the review of worfy-polish 96: beside Playwright's own output, which each run empties. */
const SCREENS = join(import.meta.dirname, '..', '..', 'test-results', 'worfy-polish-96-screens')

test('two panes at 1280 and 1600 px in both themes: three PRs with a draft, one PR, and none', async () => {
  test.setTimeout(ms(120_000))
  // A third Project whose repository holds no PR: the empty view.
  const docs = repo('docs', 'example-org/docs')
  const DOCS = 'docs-000000d'
  mkdirSync(join(dataDir, DOCS), { recursive: true })
  writeFileSync(
    join(dataDir, 'projects.json'),
    JSON.stringify({
      projects: [
        { id: WEB, name: 'web', path: join(scratch, 'web') },
        { id: OPS, name: 'ops', path: join(scratch, 'ops') },
        { id: DOCS, name: 'docs', path: docs },
      ],
      activeId: WEB,
    }),
  )
  const profileDir = harnessForWeb()
  const draftFile = join(profileDir, 'state', 'pr-inbox', 'drafts', 'example-org-web-118.json')
  mkdirSync(dirname(draftFile), { recursive: true })
  const body = 'Three tries: the server drops the first one. I will say so in a comment above the loop.'
  const item = { kind: 'thread', threadId: 'T1', replyTo: 11, label: 'needs answer', body, fixPlan: 'Add a comment above the retry loop', state: 'draft', sentUrl: null }
  // A second reply, in the conversation: two drafts, so the strip carries Send all (2).
  const thanks = { kind: 'conversation', threadId: null, replyTo: null, label: 'thanks', body: 'Thanks for the quick look, both points are in the next push.', fixPlan: null, state: 'draft', sentUrl: null }
  writeFileSync(draftFile, JSON.stringify({ schema: 1, repo: WEB_REPO, pr: 118, headOid: 'abc1234', items: [item, thanks] }))
  const launched = await launch()
  try {
    const { window } = launched
    await showSidebarSection(window, 'Pull requests')
    const views = window.getByRole('group', { name: 'View', exact: true })
    await expect(sectionRow(window, WEB, 'needs-answer')).toBeVisible({ timeout: ms(30_000) })
    await views.getByRole('button', { name: 'Pull requests' }).click()
    await expect(pane(window).getByTestId('pr-draft-field').first()).toBeVisible({ timeout: ms(15_000) })
    // The strip's main button of a PR with two drafts: Send all (2) opens the dialog with every text; Cancel posts nothing.
    const sendAll = pane(window).getByTestId('pr-inbox-next-step').getByTestId('pr-inbox-next-step-action')
    await expect(sendAll).toHaveText('Send all (2)')
    await sendAll.click()
    const dialog = window.getByTestId('pr-send-all-dialog')
    await expect(dialog.getByTestId('pr-send-all-text')).toHaveText([body, thanks.body])
    await dialog.getByTestId('pr-send-all-cancel').click()
    await expect(dialog).toHaveCount(0)
    expectNoWrite()
    mkdirSync(SCREENS, { recursive: true })
    const shoot = async (name: string): Promise<void> => {
      const shots = await snapshotThemes(window, `pr-inbox-${name}`)
      for (const scheme of ['light', 'dark'] as const) copyFileSync(shots[scheme], join(SCREENS, `${name}-${scheme}.png`))
      console.log(`pull requests ${name}: ${join(SCREENS, `${name}-light.png`)} ${join(SCREENS, `${name}-dark.png`)}`)
    }
    for (const width of [1280, 1600]) {
      await window.setViewportSize({ width, height: 800 })
      await expect(pane(window)).toBeVisible()
      await expect(pane(window).getByTestId('pr-inbox-keys-hint')).toBeVisible()
      // The two panes side by side at both widths.
      const [list, shown] = await Promise.all([window.getByTestId('pr-inbox-list').boundingBox(), pane(window).boundingBox()])
      expect(list !== null && shown !== null && list.x + list.width <= shown.x + 1 && Math.abs(list.y - shown.y) < 2).toBe(true)
      await shoot(`three-prs-${width}`)
    }

    // One PR: ops, from its row of the sidebar; it is selected and shown.
    await sectionRow(window, OPS, 'needs-review').click()
    await expect(view(window)).toHaveAttribute('data-project', OPS)
    await expect(pane(window)).toHaveAttribute('data-number', '5')
    // One PR: no ↑ ↓ to a next one.
    await expect(pane(window).getByTestId('pr-inbox-keys-hint')).toHaveCount(0)
    for (const width of [1280, 1600]) {
      await window.setViewportSize({ width, height: 800 })
      await shoot(`one-pr-${width}`)
    }

    // None: docs, from the Project list.
    await showSidebarSection(window, 'Projects')
    await window.getByTestId('project-row').filter({ hasText: 'docs' }).click()
    await expect(view(window)).toHaveAttribute('data-project', DOCS)
    await expect(view(window).getByTestId('pr-inbox-empty')).toBeVisible({ timeout: ms(45_000) })
    await expect(pane(window)).toHaveCount(0)
    for (const width of [1280, 1600]) {
      await window.setViewportSize({ width, height: 800 })
      await shoot(`no-prs-${width}`)
    }
    expectNoWrite()
  } finally {
    await launched.close()
  }
})

const LONG_REPO = 'example-org/customer-billing-platform-integration-services'

test('a long repository name at 1280 px: the list never scrolls sideways, only the name is cut; #N, the CI text and the Ticket chip stay whole', async () => {
  test.setTimeout(ms(90_000))
  // One Project whose repository has a long name, with Ticket demo 07 (its PR's branch is demo/07).
  const billing = join(scratch, 'billing')
  const issues = join(billing, '.scratch', 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(billing, '.scratch', 'demo', 'spec.md'), '# Demo\n')
  writeFileSync(join(issues, '07-ticket-7.md'), ['# 07 — Ticket 7', '', 'Type: task', 'Status: claimed — 2026-10-05', 'Blocked by: —', '', '## Что делаем', '', 'text', ''].join('\n'))
  repo('billing', LONG_REPO)
  const BILLING = 'billing-000000b'
  mkdirSync(join(dataDir, BILLING), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: BILLING, name: 'billing', path: billing }], activeId: BILLING }))
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  const ticket = { epic: 'demo', num: 7, slug: 'ticket-7', title: '07 — Ticket 7', statusRaw: 'claimed — 2026-10-05', state: 'work', blockedRaw: '—', blockedNums: [], blockedParsed: true }
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: true, hasMap: false }], tickets: [ticket] }))
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  writeFileSync(
    join(ghDir, 'graphql.json'),
    JSON.stringify({
      viewer: ME,
      pulls: [
        stubPull(LONG_REPO, 1207, 'Retry the invoice export when the ledger is busy', { ci: 'FAILURE', merge: 'UNSTABLE', branch: 'demo/07', size: [58, 14] }),
        stubPull(LONG_REPO, 1188, 'Show the currency of each line', { author: ANA, requested: [{ login: ME }], ci: 'PENDING' }),
      ],
    }),
  )
  const launched = await launch()
  try {
    const { window } = launched
    await showSidebarSection(window, 'Pull requests')
    await window.setViewportSize({ width: 1280, height: 800 })
    const views = window.getByRole('group', { name: 'View', exact: true })
    await expect(sectionRow(window, BILLING, 'needs-fix')).toBeVisible({ timeout: ms(30_000) })
    await views.getByRole('button', { name: 'Pull requests' }).click()
    const failing = prRow(window, LONG_REPO, 1207)
    await expect(failing.getByTestId('pr-inbox-ticket')).toHaveText('demo 07', { timeout: ms(30_000) })
    await expect(failing.getByTestId('pr-inbox-ref')).toHaveText('customer-billing-platform-integration-services#1207')
    const list = window.getByTestId('pr-inbox-list')
    // The list does not scroll sideways.
    const widths = await list.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
    expect(widths.scroll).toBeLessThanOrEqual(widths.client)
    // Only the repository name is cut: it is narrower than its text.
    const name = await failing.getByTestId('pr-inbox-ref-repo').evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
    expect(name.scroll).toBeGreaterThan(name.client)
    // #N, the CI text and the Ticket chip are whole and inside the list.
    const box = await list.boundingBox()
    for (const part of [failing.locator('.w-pr-inbox-item__number'), failing.locator('.w-pr-inbox-ci-text'), failing.getByTestId('pr-inbox-ticket')]) {
      await expect(part).toBeVisible()
      const whole = await part.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
      const at = await part.boundingBox()
      expect(whole && box !== null && at !== null && at.x >= box.x && at.x + at.width <= box.x + box.width).toBe(true)
    }
    await expect(failing.locator('.w-pr-inbox-item__number')).toHaveText('#1207')
    await expect(failing.locator('.w-pr-inbox-ci-text')).toHaveText('CI failing')
    // Needs fix with failing CI: the strip opens the checks.
    await failing.getByRole('button').click()
    await expect(pane(window).getByTestId('pr-inbox-next-step-action')).toHaveText('Open checks')
    mkdirSync(SCREENS, { recursive: true })
    const shots = await snapshotThemes(window, 'pr-inbox-long-name-1280')
    for (const scheme of ['light', 'dark'] as const) copyFileSync(shots[scheme], join(SCREENS, `long-name-1280-${scheme}.png`))
    console.log(`pull requests long-name-1280: ${join(SCREENS, 'long-name-1280-light.png')} ${join(SCREENS, 'long-name-1280-dark.png')}`)
    expectNoWrite()
  } finally {
    await launched.close()
  }
})
