import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { nodeScript } from '../harness-node'

// A Silent Project and a Project over two repositories in the built app (worfy-harness ticket 23;
// ADR-0042, ADR-0045). The Harness is stubbed in a temporary WORFY_CLAUDE_HOME: `bin/profile --json`
// names the mode, the Workflow folder and the repositories, `bin/ticket root` the Tickets root, and
// `bin/epic-status` answers with the Tickets, their `Branch:` and `Repo:` lines included. gh is a
// stub that answers by the folder it runs in, so each repository has its own PRs. worfy must write
// nothing into the Workflow folder or the repositories: no file, no ref, no fetch.

const repoRoot = join(import.meta.dirname, '..', '..')
/** With WORFY_EVIDENCE=1 the light and dark snapshots are kept as the ticket's evidence (rules: .scratch/<epic>/evidence/NN-what.png). */
const EVIDENCE = join(repoRoot, '.scratch', 'worfy-harness', 'evidence')

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-silent-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/** A git repository with one commit and no workflow files. */
function makeRepo(path: string): string {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'README.md'), `${path}\n`)
  git(path, 'init', '-q')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'init')
  return path
}

interface TicketLines {
  num: number
  status: string
  state: string
  branch?: string
  repo?: string
}

function ticketMarkdown(ticket: TicketLines): string {
  const nn = String(ticket.num).padStart(2, '0')
  const lines = [`# ${nn} — Ticket ${ticket.num}`, '', 'Type: task', `Status: ${ticket.status}`, 'Blocked by: —']
  if (ticket.branch) lines.push(`Branch: ${ticket.branch}`)
  if (ticket.repo) lines.push(`Repo: ${ticket.repo}`)
  return [...lines, '', '## Где в коде', '', '- `src/a.ts`', ''].join('\n')
}

/** Writes Epic `epic` into `<folder>/.scratch` and returns what epic-status says about it. */
function writeEpic(folder: string, epic: string, title: string, tickets: TicketLines[]): unknown {
  const issues = join(folder, '.scratch', epic, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(folder, '.scratch', epic, 'spec.md'), `# ${title}\n\ntext\n`)
  for (const ticket of tickets) writeFileSync(join(issues, `${String(ticket.num).padStart(2, '0')}-ticket-${ticket.num}.md`), ticketMarkdown(ticket))
  return epicStatusOf(epic, tickets)
}

/** What epic-status says about Epic `epic` with `tickets`. */
function epicStatusOf(epic: string, tickets: TicketLines[]): unknown {
  return {
    ref: 'main',
    epics: [{ epic, hasSpec: true, hasMap: false }],
    tickets: tickets.map((ticket) => ({
      epic,
      num: ticket.num,
      slug: `ticket-${ticket.num}`,
      title: `${String(ticket.num).padStart(2, '0')} — Ticket ${ticket.num}`,
      statusRaw: ticket.status,
      state: ticket.state,
      blockedRaw: '—',
      blockedNums: [],
      blockedParsed: true,
      branch: ticket.branch ?? null,
      repo: ticket.repo ?? null,
    })),
  }
}

/**
 * The stubbed Harness in `claudeHome/bin`: `profile --json` prints `resolved` as `_resolved` (any
 * other question: exit code 4, as for a field the Profile does not have), `ticket root` prints
 * `ticketsRoot`, `epic-status` prints `epicStatus` and refuses `--ref` with exit code 3, as in
 * Silent mode. Every run is logged to `harness.log` outside the home.
 */
function stubHarness(claudeHome: string, resolved: unknown, ticketsRoot: string, epicStatus: unknown): string {
  const bin = join(claudeHome, 'bin')
  mkdirSync(bin, { recursive: true })
  const log = join(scratch, 'harness.log')
  writeFileSync(log, '')
  writeFileSync(join(scratch, 'profile.json'), JSON.stringify({ name: 'stub', mode: 'silent', _resolved: resolved }))
  writeFileSync(join(scratch, 'epic-status.json'), JSON.stringify(epicStatus))
  // Node scripts: worfy runs the Harness scripts as `node <script>`. `args`, `has` and `cat` are set by the lines below.
  const scripts: Record<string, string> = {
    profile: `if (has('--json')) cat(${JSON.stringify(join(scratch, 'profile.json'))})\nelse process.exitCode = 4`,
    ticket: `process.stdout.write(${JSON.stringify(`${ticketsRoot}\n`)})`,
    'epic-status': `if (has('--ref')) {\n  process.stderr.write('in Silent mode the status does not live in branches\\n')\n  process.exitCode = 3\n} else cat(${JSON.stringify(join(scratch, 'epic-status.json'))})`,
  }
  for (const [name, body] of Object.entries(scripts)) {
    const setup = [
      'const args = process.argv.slice(2)',
      'const has = (flag) => args.some((arg) => arg.includes(flag))',
      "const cat = (file) => process.stdout.write(fs.readFileSync(file, 'utf8'))",
      `fs.appendFileSync(${JSON.stringify(log)}, \`${name} \${args.join(' ')} in \${fs.realpathSync(process.cwd())}\\n\`)`,
    ]
    writeFileSync(join(bin, name), nodeScript([...setup, body].join('\n')))
  }
  return log
}

/** A gh stub: `pr list` answers `<dir>/prs-<folder name>.json` of the folder it runs in, filtered by `--head`. */
function stubGh(dir: string): { command: string; log: string } {
  mkdirSync(dir, { recursive: true })
  const log = join(dir, 'gh.log')
  writeFileSync(log, '')
  const js = join(dir, 'gh.cjs')
  writeFileSync(
    js,
    `const { appendFileSync, existsSync, readFileSync } = require('node:fs')
const { basename, join } = require('node:path')
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cwd: process.cwd(), args }) + '\\n')
if (args[0] !== 'pr' || args[1] !== 'list') { process.stderr.write('stub: only pr list\\n'); process.exit(1) }
const file = join(${JSON.stringify(dir)}, 'prs-' + basename(process.cwd()) + '.json')
let prs = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
const head = args.indexOf('--head')
if (head !== -1) prs = prs.filter((pr) => pr.headRefName === args[head + 1])
process.stdout.write(JSON.stringify(prs))
`,
  )
  const command = join(dir, 'gh')
  writeFileSync(command, `#!/bin/sh\nexec node '${js}' "$@"\n`)
  chmodSync(command, 0o755)
  return { command, log }
}

const pr = (number: number, headRefName: string, conclusion: 'SUCCESS' | 'FAILURE' | null) => ({
  number,
  headRefName,
  state: 'OPEN',
  url: `https://github.com/o/r/pull/${number}`,
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'ci', status: conclusion === null ? 'IN_PROGRESS' : 'COMPLETED', conclusion: conclusion ?? '' }],
  comments: [],
})

/** Every file under `dir` with its size and modification time. */
function listing(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        const stats = statSync(path)
        out[relative(dir, path)] = `${stats.size}:${stats.mtimeMs}`
      }
    }
  }
  walk(dir)
  return out
}

/** What git says of a repository: its status and every ref. */
const gitState = (repo: string): { status: string; refs: string } => ({ status: git(repo, 'status', '--porcelain', '--untracked-files=all'), refs: git(repo, 'for-each-ref') })

/** Writes projects.json with the one Project at `path`, active, and an empty Layout. */
function writeProject(dataDir: string, id: string, name: string, path: string): void {
  mkdirSync(join(dataDir, id), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id, name, path }], activeId: id }))
  writeFileSync(join(dataDir, id, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 40, y: 40, zoom: 0.8 } }))
}

async function evidence(window: Page, name: string): Promise<void> {
  const shots = await snapshotThemes(window, `23-${name}`)
  if (process.env.WORFY_EVIDENCE !== '1') return
  mkdirSync(EVIDENCE, { recursive: true })
  copyFileSync(shots.light, join(EVIDENCE, `23-${name}-light.png`))
  copyFileSync(shots.dark, join(EVIDENCE, `23-${name}-dark.png`))
}

test('a Silent Project: the Epic frame with its title and the Tickets come from the Workflow folder, the HANDOFF Node too; nothing is written', async () => {
  const repo = makeRepo(join(scratch, 'silent-app'))
  // A worktree on a Ticket branch: in Silent mode its branch is not read for a status.
  git(repo, 'worktree', 'add', '-q', '-b', 'demo/02', join(repo, '.claude', 'worktrees', '02'))
  const folder = join(scratch, 'workflow-folder')
  const epicStatus = writeEpic(folder, 'demo', 'Silent epic from the Workflow folder', [
    { num: 1, status: 'claimed — 2026-10-09', state: 'work', branch: 'fix/login', repo: 'silent-app' },
    { num: 2, status: 'open', state: 'open' },
  ])
  writeFileSync(join(folder, 'HANDOFF.md'), '# HANDOFF\n\nState kept in the Workflow folder.\n')
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const harnessLog = stubHarness(claudeHome, { mode: 'silent', workflow_folder: folder, workspace: null, repos: [{ name: 'silent-app', path: repo, gate_key: 'silent-app' }] }, join(folder, '.scratch'), epicStatus)
  const gh = stubGh(join(scratch, 'gh'))
  writeProject(dataDir, 'silent-app-00000023', 'silent-app', repo)

  // `git status` may refresh .git/index itself, so it runs before the listing, not after.
  const beforeGit = gitState(repo)
  const before = { folder: listing(folder), repo: listing(repo), git: beforeGit }
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_HARNESS_HOME: join(scratch, 'no-harness-home'), WORFY_GH: gh.command } })
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    const frame = window.locator('[data-testid="epic-frame"]')
    // The frame appears after three Harness scripts run one after another (profile, ticket root,
    // epic-status); under a loaded gate full that took longer than the default 5 s.
    await expect(frame).toHaveCount(1, { timeout: 15_000 })
    await expect(frame.locator('.w-epic__title')).toContainText('Silent epic from the Workflow folder')
    const ticket = (num: number): Locator => window.locator(`[data-testid="ticket-node"][data-ticket="${num}"]`)
    await expect(ticket(1)).toHaveAttribute('data-state', 'work')
    await expect(ticket(2)).toHaveAttribute('data-state', 'open')
    // One repository: no repository chip.
    await expect(window.getByTestId('ticket-repo')).toHaveCount(0)
    await expect(window.getByTestId('handoff-node')).toBeVisible()
    await expect(window.getByTestId('handoff-body')).toContainText('State kept in the Workflow folder.')
    await evidence(window, 'silent-project')
  } finally {
    await launched.close()
  }

  const calls = readFileSync(harnessLog, 'utf8')
  expect(calls).toContain(`ticket root in ${repo}`)
  expect(calls).not.toContain('--ref')
  expect(listing(folder)).toEqual(before.folder)
  expect(listing(repo)).toEqual(before.repo)
  expect(gitState(repo)).toEqual(before.git)
})

test('a Project over two repositories: each Ticket shows its repository, and its PR and CI come from gh of that repository; nothing is written', async () => {
  // Like Atakama: a folder that is not a repository, with the repositories in it, and the Workflow folder is the folder itself.
  const workspace = join(scratch, 'atakama')
  const api = makeRepo(join(workspace, 'api'))
  const web = makeRepo(join(workspace, 'web'))
  const epicStatus = writeEpic(workspace, 'atakama', 'Two repositories', [
    { num: 5, status: 'claimed — 2026-10-09', state: 'work', branch: 'fix/x', repo: 'api' },
    { num: 6, status: 'claimed — 2026-10-09', state: 'work', branch: 'fix/y', repo: 'web' },
    { num: 7, status: 'claimed — 2026-10-09', state: 'work', branch: 'fix/z' },
  ])
  writeFileSync(join(workspace, 'HANDOFF.md'), '# HANDOFF\n\nAtakama.\n')
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const resolved = {
    mode: 'silent',
    workflow_folder: workspace,
    workspace,
    repos: [
      { name: 'api', path: api, gate_key: 'api' },
      { name: 'web', path: web, gate_key: 'web' },
    ],
  }
  stubHarness(claudeHome, resolved, join(workspace, '.scratch'), epicStatus)
  const ghDir = join(scratch, 'gh')
  const gh = stubGh(ghDir)
  // Each repository has a PR on the other's branch too: a Ticket takes only its own repository's.
  writeFileSync(join(ghDir, 'prs-api.json'), JSON.stringify([pr(11, 'fix/x', 'SUCCESS'), pr(12, 'fix/y', 'FAILURE'), pr(13, 'fix/z', 'SUCCESS')]))
  writeFileSync(join(ghDir, 'prs-web.json'), JSON.stringify([pr(21, 'fix/y', null), pr(22, 'fix/x', 'FAILURE')]))
  writeProject(dataDir, 'atakama-00000023', 'atakama', workspace)

  // `git status` may refresh .git/index itself, so it runs before the listing, not after.
  const beforeGit = { api: gitState(api), web: gitState(web) }
  const before = { workspace: listing(workspace), ...beforeGit }
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_HARNESS_HOME: join(scratch, 'no-harness-home'), WORFY_GH: gh.command } })
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    const ticket = (num: number): Locator => window.locator(`[data-testid="ticket-node"][data-ticket="${num}"]`)
    await expect(window.locator('[data-testid="epic-frame"] .w-epic__title')).toContainText('Two repositories', {
      timeout: 15_000,
    })

    await expect(ticket(5).getByTestId('ticket-repo')).toHaveText('api')
    await expect(ticket(5).getByTestId('ticket-repo')).toHaveAttribute('title', 'repository api')
    await expect(ticket(6).getByTestId('ticket-repo')).toHaveText('web')
    await expect(ticket(7).getByTestId('ticket-repo')).toHaveText('no repo')

    await expect(ticket(5).getByTestId('checks-pr')).toHaveText('PR #11')
    await expect(ticket(5).getByTestId('checks-ci')).toHaveAttribute('data-value', 'passing')
    await expect(ticket(6).getByTestId('checks-pr')).toHaveText('PR #21')
    await expect(ticket(6).getByTestId('checks-ci')).toHaveAttribute('data-value', 'running')
    await expect(ticket(5).getByTestId('action-open-pr')).toBeVisible()
    // No repository, no Gate, PR or CI — though api has a PR on its branch.
    await expect(ticket(7).locator('[data-testid^="checks-"]')).toHaveCount(0)
    await expect(ticket(7).getByTestId('action-open-pr')).toHaveCount(0)
    await evidence(window, 'two-repos')
  } finally {
    await launched.close()
  }

  // gh ran only in the two repositories, never in the folder above them.
  const ghRuns = readFileSync(gh.log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { cwd: string; args: string[] })
  expect(ghRuns.length).toBeGreaterThan(0)
  expect(new Set(ghRuns.map((run) => realpathSync(run.cwd)))).toEqual(new Set([api, web]))
  expect(ghRuns.every((run) => run.args[0] === 'pr' && run.args[1] === 'list')).toBe(true)

  expect(listing(workspace)).toEqual(before.workspace)
  expect(gitState(api)).toEqual(before.api)
  expect(gitState(web)).toEqual(before.web)
})

test('an Epic put into an open Silent Project whose Workflow folder has no .scratch shows in the sidebar without opening the Project again', async () => {
  // The case of the acceptance run of 2026-10-14 (worfy-harness ticket 26, item 5): the Workflow
  // folder is a git repository, as project-connect makes it, and has no .scratch yet.
  const repo = makeRepo(join(scratch, 'silent-app'))
  const folder = join(scratch, 'workflow-folder')
  mkdirSync(folder)
  git(folder, 'init', '-q')
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  stubHarness(claudeHome, { mode: 'silent', workflow_folder: folder, workspace: null, repos: [{ name: 'silent-app', path: repo, gate_key: 'silent-app' }] }, join(folder, '.scratch'), { ref: 'main', epics: [], tickets: [] })
  const gh = stubGh(join(scratch, 'gh'))
  writeProject(dataDir, 'silent-app-00000041', 'silent-app', repo)

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_HARNESS_HOME: join(scratch, 'no-harness-home'), WORFY_GH: gh.command } })
  try {
    const { window } = launched
    await expect(window.getByText('No epics in .scratch/')).toBeVisible({ timeout: 15_000 })

    // The stubbed epic-status answers with the Epic first; then the Epic is put and committed, as
    // step 15 of the acceptance instructions does.
    const tickets: TicketLines[] = [{ num: 1, status: 'open', state: 'open' }]
    writeFileSync(join(scratch, 'epic-status.json'), JSON.stringify(epicStatusOf('e3-acceptance', tickets)))
    writeEpic(folder, 'e3-acceptance', 'Acceptance epic', tickets)
    git(folder, 'add', '-A')
    git(folder, 'commit', '-q', '-m', 'epic')

    // No switch of the Project: the watcher alone brings the Epic in.
    await expect(window.locator('[data-testid="sidebar-epic"][data-epic="e3-acceptance"]')).toBeVisible({ timeout: 10_000 })
  } finally {
    await launched.close()
  }
})
