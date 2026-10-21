import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { expectSettledWithoutOverlaps, launchApp, ticketCardCuts } from './helpers'
import { catScript, profileJsonScript } from '../harness-node'

// Gate, PR, CI and verdict badges (ticket 17) in the built app. A temporary WORFY_CLAUDE_HOME holds
// what the gate and Claude Code leave behind: gate/config.json, a red marker for the worktree of
// Ticket 07, a transcript in that worktree whose last gate line is green, and the registry entry
// of a Session running there. `gh` is test/fixtures/gh/gh over a prs.json: it records its
// arguments and never reaches GitHub. worfy must write nothing under the Claude home, in the
// Project or to GitHub.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-00000017'
const S7 = 'a7000000-0000-4000-8000-0000000000a7'

let scratch: string
const processes: ChildProcess[] = []

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const tag = (path: string): string => createHash('sha1').update(path).digest('hex').slice(0, 8)
const dirName = (cwd: string): string => cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-')

function ticketFile(num: number, status: string): string {
  const nn = String(num).padStart(2, '0')
  return [`# ${nn} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, 'Blocked by: —', '', '## Что делаем', '', 'text', ''].join('\n')
}

const ticketJson = (num: number, status: string, state: string) => ({
  epic: 'demo',
  num,
  slug: `ticket-${num}`,
  title: `${String(num).padStart(2, '0')} — Ticket ${num}`,
  statusRaw: status,
  state,
  blockedRaw: '—',
  blockedNums: [],
  blockedParsed: true,
})

/** Every file under `dir` with its size and modification time. */
function listing(dir: string, skip: (path: string) => boolean = () => false): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (skip(path)) continue
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

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  child.kill('SIGTERM')
  await exited
}

/** The boxes around `locator`, up to its Ticket Node, that clip it: each one it is not inside. */
async function clippedBy(locator: Locator): Promise<string[]> {
  return locator.evaluate((node) => {
    type El = { getBoundingClientRect: () => { left: number; right: number; top: number; bottom: number }; parentElement: El | null; dataset: Record<string, string> }
    const { getComputedStyle } = globalThis as unknown as { getComputedStyle: (element: object) => { overflowX: string; overflowY: string } }
    const own = (node as unknown as El).getBoundingClientRect()
    const cuts: string[] = []
    for (let up = (node as unknown as El).parentElement; up; up = up.parentElement) {
      const style = getComputedStyle(up)
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        const r = up.getBoundingClientRect()
        if (own.left < r.left - 0.5 || own.right > r.right + 0.5 || own.top < r.top - 0.5 || own.bottom > r.bottom + 0.5) cuts.push(JSON.stringify({ own, by: r }))
      }
      if (up.dataset.testid === 'ticket-node') break
    }
    return cuts
  })
}

/** What of `locator` is seen: its own overflow and how its text would end if cut. */
async function seen(locator: Locator): Promise<{ scroll: number; client: number; textOverflow: string }> {
  return locator.evaluate((node) => {
    const element = node as unknown as { scrollWidth: number; clientWidth: number }
    const { getComputedStyle } = globalThis as unknown as { getComputedStyle: (element: object) => { textOverflow: string } }
    return { scroll: element.scrollWidth, client: element.clientWidth, textOverflow: getComputedStyle(node).textOverflow }
  })
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-checks-')))
})

test.afterEach(async () => {
  await Promise.all(processes.splice(0).map(stop))
  await removeDir(scratch)
})

test('gate on Ticket 07 and its Session: red by the marker, green by the transcript once the marker is gone; PR, CI and verdict on Ticket 08; nothing written', async () => {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const ghDir = join(scratch, 'gh')
  const ghLog = join(ghDir, 'calls.jsonl')
  const repo = join(scratch, 'demo')

  // The Project: Tickets 07 and 08 claimed, 09 open; Ticket 07 has its worktree.
  const issues = join(repo, '.scratch', 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', 'demo', 'spec.md'), '# Demo\n')
  writeFileSync(join(issues, '07-ticket-7.md'), ticketFile(7, 'claimed — 2026-10-05'))
  writeFileSync(join(issues, '08-ticket-8.md'), ticketFile(8, 'claimed — 2026-10-05'))
  writeFileSync(join(issues, '09-ticket-9.md'), ticketFile(9, 'open'))
  writeFileSync(join(issues, '10-ticket-10.md'), ticketFile(10, 'blocked — rejected by review'))
  writeFileSync(join(repo, '.gitignore'), '.claude/\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const worktree07 = join(repo, '.claude', 'worktrees', '07')
  git(repo, 'worktree', 'add', '-q', '-b', 'demo/07', worktree07)
  // Tickets 08 and 10 have worktrees too, so they show a gate, a PR and CI at once.
  git(repo, 'worktree', 'add', '-q', '-b', 'demo/08', join(repo, '.claude', 'worktrees', '08'))
  git(repo, 'worktree', 'add', '-q', '-b', 'demo/10', join(repo, '.claude', 'worktrees', '10'))

  // epic-status answers the same for the checkout and for the branch.
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: 'demo', hasSpec: true, hasMap: false }],
      tickets: [
        ticketJson(7, 'claimed — 2026-10-05', 'work'),
        ticketJson(8, 'claimed — 2026-10-05', 'work'),
        ticketJson(9, 'open', 'open'),
        ticketJson(10, 'blocked — rejected by review', 'blocked'),
      ],
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  // The gate: this repository is `worfy`; the worktree of Ticket 07 is red by its marker, and the
  // last gate line in a transcript of that worktree is green.
  mkdirSync(join(claudeHome, 'gate', 'state'), { recursive: true })
  writeFileSync(join(claudeHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'worfy', match: repo, profile: 'worfy', pm: 'pnpm' }] }))
  const marker = join(claudeHome, 'gate', 'state', `red-worfy-${tag(worktree07)}`)
  writeFileSync(marker, '')
  const transcripts = join(claudeHome, 'projects', dirName(worktree07))
  mkdirSync(transcripts, { recursive: true })
  // A Bash call that ran gate.sh, then its result: only such results count as the gate's verdict.
  const record = (timestamp: string, content: string) => {
    const id = `toolu_${timestamp}`
    const command = 'bash ~/.claude/hooks/gate.sh fast </dev/null; echo "КОД=$?"'
    return (
      `${JSON.stringify({ type: 'assistant', sessionId: S7, cwd: worktree07, timestamp, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } })}\n` +
      `${JSON.stringify({ type: 'user', sessionId: S7, cwd: worktree07, timestamp, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } })}\n`
    )
  }
  writeFileSync(
    join(transcripts, `${S7}.jsonl`),
    record('2026-10-05T10:00:00.000Z', '[gate] красно (fast): worfy/.:test') + record('2026-10-05T10:05:00.000Z', '[gate] набор (fast): все пакеты\n[gate] зелено (fast): worfy/.:lint worfy/.:typecheck worfy/.:test'),
  )

  // A Session running in the worktree of Ticket 07 (a `sleep` stands for its process).
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  const claude = spawn('sleep', ['600'], { stdio: 'ignore' })
  processes.push(claude)
  writeFileSync(
    join(claudeHome, 'sessions', `${claude.pid}.json`),
    JSON.stringify({ pid: claude.pid, sessionId: S7, cwd: worktree07, kind: 'interactive', entrypoint: 'cli', status: 'busy', name: 'ticket-07' }),
  )

  // GitHub: PR #31 on demo/08 with CI running and a review success mark on its head commit — the
  // verdict comes from the mark (ADR-0067), so the comments say the opposite of each mark.
  mkdirSync(ghDir)
  writeFileSync(
    join(ghDir, 'prs.json'),
    JSON.stringify([
      {
        number: 31,
        headRefName: 'demo/08',
        state: 'OPEN',
        url: 'https://github.com/o/r/pull/31',
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: '' },
          { __typename: 'StatusContext', context: 'review', state: 'SUCCESS' },
        ],
        comments: [{ body: 'REJECTED\n- x' }],
      },
      // PR #1234 on demo/10, the blocked Ticket: a four-digit number, and both its actions
      // ("Ship ticket", "Open PR") next to the badges.
      {
        number: 1234,
        headRefName: 'demo/10',
        state: 'OPEN',
        url: 'https://github.com/o/r/pull/1234',
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
          { __typename: 'StatusContext', context: 'review', state: 'FAILURE' },
        ],
        comments: [{ body: 'VERIFIED\nall lenses clean' }],
      },
    ]),
  )

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 40, y: 40, zoom: 0.8 } }))

  const homeBefore = listing(claudeHome, (path) => path === ghDir)
  const repoStatus = git(repo, 'status', '--porcelain')
  const worktreeStatus = git(worktree07, 'status', '--porcelain')
  const repoFiles = listing(repo, (path) => path.endsWith('/.git'))

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, GH_STUB_DIR: ghDir, GH_STUB_LOG: ghLog } })
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))

    const ticket = (num: number): Locator => window.locator(`[data-testid="ticket-node"][data-ticket="${num}"]`)
    const session = window.locator(`[data-testid="session-node"][data-session-id="${S7}"]`)
    await expect(ticket(7)).toBeVisible()
    await expect(session).toBeVisible({ timeout: 10_000 })

    // Red by the marker, on the Ticket and on the Session in its worktree.
    await expect(ticket(7).getByTestId('checks-gate')).toHaveAttribute('data-value', 'red')
    await expect(ticket(7).getByTestId('checks-gate')).toHaveText('gate red')
    await expect(session.getByTestId('checks-gate')).toHaveAttribute('data-value', 'red')

    // PR, CI and the reviewer's verdict on Ticket 08; Ticket 09 shows nothing.
    await expect(ticket(8).getByTestId('checks-pr')).toHaveText('PR #31')
    await expect(ticket(8).getByTestId('checks-ci')).toHaveAttribute('data-value', 'running')
    await expect(ticket(8).getByTestId('checks-ci')).toHaveText('CI running')
    await expect(ticket(8).getByTestId('checks-verdict')).toHaveText('VERIFIED')
    await expect(ticket(9).locator('[data-testid^="checks-"]')).toHaveCount(0)
    // The stepper above the badges, in place of the status word: Ticket 08 is on CI (its checks run),
    // Ticket 09 is Queued; the Project has no Profile, so the default Pipeline of seven Stages.
    await expect(ticket(8)).toHaveAttribute('aria-label', 'Ticket 08, CI')
    await expect(ticket(8).getByTestId('stepper-label')).toHaveText('CI')
    await expect(ticket(8).locator('[data-step]')).toHaveCount(7)
    await expect(ticket(9)).toHaveAttribute('aria-label', 'Ticket 09, Queued')
    await expect(ticket(8).getByText('claimed', { exact: true })).toHaveCount(0)
    expect(await clippedBy(ticket(8).locator('.w-stepper__dots')), 'the dots of the stepper are cut by no box around them').toEqual([])
    // A gate, a PR, CI and a verdict on a 240 px Ticket: every chip is whole (worfy-canvas ticket
    // 18), on a second line when the first has no room, inside the Ticket Node and inside every box
    // that clips them; the row's tooltip still lists everything.
    await expect(ticket(8).getByTestId('checks-gate')).toHaveText('gate: no data')
    await expect(ticket(10).getByTestId('checks-gate')).toHaveText('gate: no data')
    await expect(ticket(10).getByTestId('checks-pr')).toHaveText('PR #1234')
    await expect(ticket(10).getByTestId('checks-ci')).toHaveText('CI failing')
    await expect(ticket(10).getByTestId('checks-verdict')).toHaveText('REJECTED')
    await expect(ticket(10).getByTestId('action-open-pr')).toBeVisible()
    for (const num of [8, 10]) {
      const pr = ticket(num).getByTestId('checks-pr')
      const prSeen = await seen(pr)
      expect(prSeen.scroll, `the PR number on Ticket ${num} is whole: ${JSON.stringify(prSeen)}`).toBeLessThanOrEqual(prSeen.client)
      expect(await clippedBy(pr), `the PR on Ticket ${num} is cut by no box around it`).toEqual([])
      for (const id of ['checks-gate', 'checks-verdict']) {
        const chip = ticket(num).getByTestId(id)
        const face = id === 'checks-gate' ? chip : chip.locator('.w-chip')
        const chipSeen = await seen(face)
        expect(chipSeen.scroll, `${id} on Ticket ${num} is whole: ${JSON.stringify(chipSeen)}`).toBeLessThanOrEqual(chipSeen.client)
        expect(chipSeen.textOverflow, `${id} on Ticket ${num} never ends with "…"`).not.toBe('ellipsis')
        expect(await clippedBy(chip), `${id} on Ticket ${num} is cut by no box around it`).toEqual([])
      }
      expect(await ticketCardCuts(ticket(num)), `nothing is cut on Ticket ${num}`).toEqual([])

      const ci = ticket(num).getByTestId('checks-ci')
      // The card and its CI chip in one read: a relayout between two reads would move only one of them.
      const { card, box } = await ticket(num).evaluate((node) => {
        type Rect = { x: number; y: number; width: number; height: number }
        type El = { getBoundingClientRect(): Rect; querySelector(selector: string): El | null }
        const rect = (element: El): Rect => {
          const { x, y, width, height } = element.getBoundingClientRect()
          return { x, y, width, height }
        }
        const chip = (node as unknown as El).querySelector('[data-testid="checks-ci"]')
        if (chip === null) throw new Error('no CI chip on the card')
        return { card: rect(node as unknown as El), box: rect(chip) }
      })
      expect(box.x, `CI on Ticket ${num} starts inside the Ticket Node`).toBeGreaterThanOrEqual(card.x)
      expect(box.x + box.width, `CI on Ticket ${num} ends inside the Ticket Node`).toBeLessThanOrEqual(card.x + card.width)
      expect(box.y + box.height, `CI on Ticket ${num} ends inside the Ticket Node`).toBeLessThanOrEqual(card.y + card.height)
      expect(await clippedBy(ci), `CI on Ticket ${num} is cut by no box around it`).toEqual([])
      // Nor is it narrowed and cut at its own edge: the row shrinks the other items instead.
      const own = await seen(ci)
      expect(own.scroll, `CI on Ticket ${num} keeps its whole width`).toBeLessThanOrEqual(own.client)
      await expect(ticket(num).getByTestId('checks-badges')).toHaveAttribute('title', /CI (running|failing)/)
    }
    await window.screenshot({ path: test.info().outputPath('checks-badges-red.png') })

    // The marker goes (gate.sh removes it on green): the last gate line of the transcript decides.
    rmSync(marker)
    await window.evaluate(() => (globalThis as unknown as { dispatchEvent: (event: Event) => boolean }).dispatchEvent(new Event('focus')))
    await expect(ticket(7).getByTestId('checks-gate')).toHaveAttribute('data-value', 'green')
    await expect(session.getByTestId('checks-gate')).toHaveAttribute('data-value', 'green')
    await window.screenshot({ path: test.info().outputPath('checks-badges-green.png') })

    // Read-only: gh ran `pr list` only; nothing changed under the Claude home but the marker the
    // test removed, nor in the Project and its worktree.
    const calls = readFileSync(ghLog, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])
    expect(calls.length).toBeGreaterThan(0)
    for (const args of calls) expect(args.slice(0, 2)).toEqual(['pr', 'list'])
    const homeAfter = listing(claudeHome, (path) => path === ghDir)
    const expectedHome = { ...homeBefore }
    delete expectedHome[relative(claudeHome, marker)]
    expect(homeAfter).toEqual(expectedHome)
    expect(git(repo, 'status', '--porcelain')).toBe(repoStatus)
    expect(git(worktree07, 'status', '--porcelain')).toBe(worktreeStatus)
    expect(listing(repo, (path) => path.endsWith('/.git'))).toEqual(repoFiles)
  } finally {
    await launched.close()
  }
})

test('gh missing: «gh unavailable» on the Tickets in work, and the app goes on', async () => {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(issues, '08-ticket-8.md'), ticketFile(8, 'claimed — 2026-10-05'))
  writeFileSync(join(issues, '09-ticket-9.md'), ticketFile(9, 'open'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: false, hasMap: false }], tickets: [ticketJson(8, 'claimed — 2026-10-05', 'work'), ticketJson(9, 'open', 'open')] }))
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 40, y: 40, zoom: 0.8 } }))

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_GH: join(scratch, 'no-such-gh') } })
  try {
    const { window } = launched
    const ticket = (num: number): Locator => window.locator(`[data-testid="ticket-node"][data-ticket="${num}"]`)
    await expect(ticket(8).getByTestId('checks-gh-unavailable')).toHaveText('gh unavailable')
    await expect(ticket(8).getByTestId('checks-gh-unavailable')).toHaveAttribute('title', /gh not found/)
    await expect(window.getByTestId('checks-gh-unavailable')).toHaveCount(1)
    await expect(ticket(9).locator('[data-testid^="checks-"]')).toHaveCount(0)
    // The app goes on: the Canvas still answers, the Ticket opens nothing broken.
    await window.evaluate(() => (globalThis as unknown as { dispatchEvent: (event: Event) => boolean }).dispatchEvent(new Event('focus')))
    await expect(ticket(9)).toBeVisible()
  } finally {
    await launched.close()
  }
})

// ── the stepper of a nine-Stage Pipeline on a 240 px Card (worfy-pipeline ticket 05) ──────────

/** worfy's own Pipeline (spec.md of worfy-pipeline, owner's decision 4): nine Stages. */
const WORFY_PIPELINE = [
  { kind: 'queued' },
  { kind: 'implementing' },
  { kind: 'ci' },
  { kind: 'agent-review' },
  { kind: 'check', name: 'windows' },
  { kind: 'gate-merge' },
  { kind: 'deploy' },
  { kind: 'closing' },
  { kind: 'done' },
]

interface StepperTicket {
  num: number
  status: string
  state: string
  reason?: string
  repo?: string
  /** The title without its number; «Ticket N» when left out. */
  title?: string
}

/** A Project whose Profile (a stand-in bin/profile) has the nine-Stage Pipeline (or `pipeline`) and `repos`, launched. */
async function launchNineStages(
  tickets: StepperTicket[],
  pulls: unknown[],
  repos: (repo: string) => { name: string; path: string }[],
  pipeline: unknown[] = WORFY_PIPELINE,
  viewport = { x: 40, y: 40, zoom: 0.8 },
) {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const ghDir = join(scratch, 'gh')
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', 'demo', 'issues')
  for (const dir of [issues, join(claudeHome, 'bin'), ghDir, join(dataDir, PROJECT)]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(repo, '.scratch', 'demo', 'spec.md'), '# Demo\n')
  for (const t of tickets) writeFileSync(join(issues, `${String(t.num).padStart(2, '0')}-ticket-${t.num}.md`), ticketFile(t.num, t.status))
  writeFileSync(join(repo, '.gitignore'), '.claude/\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const projectRepos = repos(repo)
  for (const each of projectRepos) {
    if (each.path === repo) continue
    mkdirSync(each.path, { recursive: true })
    writeFileSync(join(each.path, 'a'), 'a')
    git(each.path, 'init', '-q')
    git(each.path, 'add', '.')
    git(each.path, 'commit', '-q', '-m', 'init')
  }
  const answer = join(claudeHome, 'epic-status.json')
  const json = (t: StepperTicket) => ({
    ...ticketJson(t.num, t.status, t.state),
    ...(t.reason ? { blockedReason: t.reason } : {}),
    ...(t.repo ? { repo: t.repo } : {}),
    ...(t.title ? { title: `${String(t.num).padStart(2, '0')} — ${t.title}` } : {}),
  })
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: 'demo', hasSpec: true, hasMap: false }], tickets: tickets.map(json) }))
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  const profile = { _resolved: { name: 'worfy', mode: 'full', workflow_folder: repo, workspace: repo, repos: projectRepos, pipeline }, workflow: { e2e_lock: join(scratch, 'no-lock') } }
  writeFileSync(join(claudeHome, 'bin', 'profile'), profileJsonScript(JSON.stringify(profile)))
  for (const script of ['epic-status', 'profile']) chmodSync(join(claudeHome, 'bin', script), 0o755)
  writeFileSync(join(ghDir, 'prs.json'), JSON.stringify(pulls))
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport }))
  return launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_HARNESS_HOME: join(scratch, 'no-harness-home'), GH_STUB_DIR: ghDir, GH_STUB_LOG: join(ghDir, 'calls.jsonl') } })
}

/**
 * Whether the Stage's name and the stepper are whole: nothing cut, nothing past the stepper's edge,
 * the top row inside the Card. Fractional widths: `scrollWidth` and `clientWidth` round to whole
 * pixels and read 50 and 50 for a name that needs 42.66 px and has 42. Each pair is [needs, has] in
 * CSS pixels; the content is a Range's rectangle, which keeps the whole width of text cut with «…»;
 * for the stepper it is its parts' boxes, as the stepper measures itself.
 */
const stepperFit = (ticket: Locator) =>
  ticket.getByTestId('ticket-stepper').evaluate((element) => {
    // The test tsconfig has no DOM lib: the few page types used here.
    type Rect = { width: number; left: number; right: number }
    type Box = { getBoundingClientRect(): Rect; offsetWidth: number; children: ArrayLike<Box>; querySelector(selector: string): Box | null; closest(selector: string): Box | null }
    const page = globalThis as unknown as { document: { createRange(): { selectNodeContents(node: Box): void; getBoundingClientRect(): Rect } }; getComputedStyle(node: Box): Record<string, string> }
    const stepper = element as unknown as Box
    const card = stepper.closest('[data-testid="ticket-node"]')!
    // React Flow's zoom scales every rectangle: back to CSS pixels by the Card's own width.
    const scale = card.getBoundingClientRect().width / card.offsetWidth
    const round = (value: number) => Math.round((value / scale) * 100) / 100
    const frame = (box: Box, sides: string[]) => {
      const style = page.getComputedStyle(box)
      return sides.reduce((sum, side) => sum + (parseFloat(style[`padding${side}`] ?? '') || 0) + (parseFloat(style[`border${side}Width`] ?? '') || 0), 0) * scale
    }
    const needs = (box: Box) => {
      const range = page.document.createRange()
      range.selectNodeContents(box)
      return range.getBoundingClientRect().width
    }
    const pair = (box: Box | null) => (box === null ? null : [round(needs(box)), round(box.getBoundingClientRect().width - frame(box, ['Left', 'Right']))])
    const rect = card.getBoundingClientRect()
    const inner = { left: rect.left + frame(card, ['Left']), right: rect.right - frame(card, ['Right']) }
    const top = Array.from(card.querySelector('.w-ticket__top')!.children, (child) => child.getBoundingClientRect())
    return {
      label: pair(stepper.querySelector('[data-testid="stepper-label"]')),
      count: pair(stepper.querySelector('[data-testid="stepper-count"]')),
      blocked: pair(stepper.querySelector('[data-testid="stepper-blocked"]')),
      ready: pair(card.querySelector('[data-testid="ticket-ready"]')),
      // The stepper's parts, not their text: a name cut with «…» stays inside its own box.
      stepper: (() => {
        const parts = Array.from(stepper.children, (child) => child.getBoundingClientRect())
        return [round(Math.max(...parts.map((each) => each.right)) - Math.min(...parts.map((each) => each.left))), round(stepper.getBoundingClientRect().width)]
      })(),
      row: [round(Math.max(...top.map((each) => each.right)) - inner.left), round(inner.right - inner.left)],
      card: card.offsetWidth,
    }
  })

/** needs ≤ has, with the 1/64 px of layout rounding. */
const whole = (pair: number[] | null | undefined, what: string, fit: unknown) => {
  expect(pair, `${what} is drawn: ${JSON.stringify(fit)}`).not.toBeNull()
  expect(pair![0], `${what} is whole: ${JSON.stringify(fit)}`).toBeLessThanOrEqual(pair![1]! + 0.02)
}

const HEAD = (n: number) => String(n).repeat(40).slice(0, 40)
const ok = { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }
const review = (state: string) => ({ __typename: 'StatusContext', context: 'review', state })
const openPull = (num: number, branch: string, rollup: unknown[]) => ({ number: num, headRefName: branch, state: 'OPEN', url: `https://github.com/o/r/pull/${num}`, headRefOid: HEAD(num % 9 + 1), statusCheckRollup: rollup, comments: [] })

test('nine Stages on a 240 px Card: the Stage name and whom it waits for are never cut — rework, blocked, both, Check «windows»; the narrow form when the full one does not fit on one line', async () => {
  const tickets: StepperTicket[] = [
    { num: 2, status: 'claimed — 2026-10-17', state: 'work' },
    { num: 3, status: 'blocked — needs Stripe test keys', state: 'blocked', reason: 'needs Stripe test keys' },
    { num: 4, status: 'claimed — 2026-10-17', state: 'work' },
    { num: 5, status: 'blocked — waits for the owner', state: 'blocked', reason: 'waits for the owner' },
    { num: 6, status: 'claimed — 2026-10-17', state: 'work' },
  ]
  const pulls = [
    openPull(41, 'demo/02', [ok, review('FAILURE')]),
    openPull(43, 'demo/04', [ok, review('SUCCESS')]),
    openPull(44, 'demo/05', [ok, review('FAILURE')]),
    openPull(45, 'demo/06', [{ __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: '' }]),
  ]
  const launched = await launchNineStages(tickets, pulls, () => [])
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
    const ticket = (num: number): Locator => window.locator(`[data-testid="ticket-node"][data-ticket="${num}"]`)
    const expected = [
      { num: 2, stage: 'Implementing', rework: true, blocked: false },
      { num: 3, stage: 'Implementing', rework: false, blocked: true },
      { num: 4, stage: 'Check «windows»', rework: false, blocked: false },
      { num: 5, stage: 'Implementing', rework: true, blocked: true },
      { num: 6, stage: 'CI', rework: false, blocked: false },
    ]
    for (const each of expected) {
      const card = ticket(each.num)
      await expect(card).toHaveAttribute('aria-label', `Ticket 0${each.num}, ${each.stage}`, { timeout: 20_000 })
      await expect(card.getByTestId('stepper-label')).toHaveText(each.stage)
      await expect(card.getByTestId('stepper-rework')).toHaveCount(each.rework ? 1 : 0)
      await expect(card.getByTestId('stepper-blocked')).toHaveCount(each.blocked ? 1 : 0)
      // Who it waits for, whole, in the narrow form too.
      await expect(card.getByTestId('stepper-waits')).toHaveText('agent')
      const fit = await stepperFit(card)
      expect(fit.card, `Ticket ${each.num} is a Card of the default width`).toBe(240)
      whole(fit.label, `the Stage name on Ticket ${each.num}`, fit)
      whole(fit.stepper, `the stepper of Ticket ${each.num}`, fit)
      whole(fit.row, `the top row of Ticket ${each.num}`, fit)
      if (fit.count !== null) whole(fit.count, `«N/M» on Ticket ${each.num}`, fit)
      expect(await ticketCardCuts(card), `nothing is cut on Ticket ${each.num}`).toEqual([])
    }
    // Nine dots, the name, its flags and whom it waits for do not fit one line of 240 px for these: the narrow form with «N/M».
    await expect(ticket(5).getByTestId('ticket-stepper')).toHaveAttribute('data-narrow', 'true')
    await expect(ticket(5).getByTestId('stepper-count')).toHaveText('2/9')
    await expect(ticket(4).getByTestId('stepper-count')).toHaveText('5/9')
    // A short name keeps the full form: the dots and who it waits for.
    await expect(ticket(6).getByTestId('ticket-stepper')).not.toHaveAttribute('data-narrow', 'true')
    await expect(ticket(6).locator('[data-step]')).toHaveCount(9)
    await expect(ticket(6).getByTestId('stepper-waits')).toHaveText('agent')
  } finally {
    await launched.close()
  }
})

test('nine Stages, a repository chip and the Ready chip on a 240 px Card: the repository name, the Stage name, «N/M» and whom it waits for stay whole; the stepper takes a line of its own when the row has no room', async () => {
  // The names of the round-2 review: «Queued» needed 42.66 px and got 42 beside each of them.
  const names = ['app', 'web-client', 'application-server']
  const launched = await launchNineStages(
    names.map((repo, at) => ({ num: at + 1, status: 'open', state: 'open', repo })),
    [],
    (repo) => names.map((name, at) => ({ name, path: at === 0 ? repo : join(scratch, name) })),
  )
  try {
    const { window } = launched
    for (const [at, name] of names.entries()) {
      const card = window.locator(`[data-testid="ticket-node"][data-ticket="${at + 1}"]`)
      await expect(card).toHaveAttribute('aria-label', `Ticket 0${at + 1}, Queued`, { timeout: 20_000 })
      await expect(card.getByTestId('ticket-repo')).toHaveAttribute('data-repo', name)
      await expect(card.getByTestId('ticket-repo')).toHaveText(name)
      await expect(card.getByTestId('ticket-ready')).toBeVisible()
      await expect(card.getByTestId('ticket-stepper')).toHaveAttribute('data-narrow', 'true')
      await expect(card.getByTestId('stepper-label')).toHaveText('Queued')
      await expect(card.getByTestId('stepper-count')).toHaveText('1/9')
      await expect(card.getByTestId('stepper-waits')).toHaveText('agent')
      expect(await ticketCardCuts(card), `nothing is cut on the Card of ${name}`).toEqual([])
      const fit = await stepperFit(card)
      expect(fit.card, `the Card of ${name} has the default width`).toBe(240)
      whole(fit.label, `the Stage name beside ${name}`, fit)
      whole(fit.count, `«N/M» beside ${name}`, fit)
      whole(fit.stepper, `the stepper beside ${name}`, fit)
      whole(fit.row, `the top row beside ${name}`, fit)
    }
  } finally {
    await launched.close()
  }
})

test('the width estimate against the real fonts: Cyrillic, wide letters, a long path, emoji and a long repository name are whole on cards that do not overlap', async () => {
  // ticket-card.ts guesses each character's width; these are the texts it is most likely to guess
  // too narrow. Cyrillic is written as escapes: the sources stay in Latin script.
  const CYRILLIC_TITLE =
    'Кнопка снятия лота для модератора с причиной, которую видит продавец'
  const CYRILLIC_REASON =
    'ждёт ответа владельца, какой платёжный провайдер работает в продакшене'
  const SHA = 'ШЩЖ'
  const WIDE = `WWWWWWWWWW MMMMMMMMMM WMWMWMWMWM ${SHA.repeat(4)} ${'W'.repeat(30)}`
  const PATH = 'src/renderer/canvas/epic-arrangement-and-k-column-strip-layout-with-long-names.ts'
  const EMOJI = '✅ gate ❌ verdict ✅✅✅✅ ❌❌❌❌ ✅ done ❌ failed ✅❌✅❌✅❌'
  const REPO = 'application-server-with-a-really-long-repository-name'
  const tickets: StepperTicket[] = [
    { num: 1, status: 'open', state: 'open', title: CYRILLIC_TITLE, repo: REPO },
    { num: 2, status: `blocked — ${CYRILLIC_REASON}`, state: 'blocked', reason: CYRILLIC_REASON, title: CYRILLIC_TITLE },
    { num: 3, status: 'open', state: 'open', title: WIDE },
    { num: 4, status: 'blocked — see the path', state: 'blocked', reason: PATH, title: PATH },
    { num: 5, status: 'open', state: 'open', title: EMOJI, repo: REPO },
  ]
  // The five tall cards stand in one column: zoomed out so React Flow draws all of them
  // (it draws only the Nodes in view).
  const launched = await launchNineStages(
    tickets,
    [],
    (repo) => [
      { name: REPO, path: repo },
      { name: 'web', path: join(scratch, 'web') },
    ],
    WORFY_PIPELINE,
    { x: 40, y: 20, zoom: 0.5 },
  )
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000))
    for (const each of tickets) {
      const card = window.locator(`[data-testid="ticket-node"][data-ticket="${each.num}"]`)
      await expect(card.getByTestId('ticket-repo')).toBeVisible({ timeout: 20_000 })
      await expect(card.locator('.w-ticket__title')).toHaveText(each.title!)
      if (each.reason) await expect(card.locator('.w-ticket__reason')).toHaveText(each.reason)
      if (each.repo) await expect(card.getByTestId('ticket-repo')).toHaveText(each.repo)
      expect(await card.evaluate((node) => (node as unknown as { offsetWidth: number }).offsetWidth), `Ticket ${each.num} has the default width`).toBe(240)
      expect(await ticketCardCuts(card), `nothing is cut on Ticket ${each.num}`).toEqual([])
    }
    // All five cards in one pass, once the layout has settled: a card's height changes when its
    // repository chip arrives, and the cards are placed again, so boxes read card by card could mix
    // two layouts.
    const cards = tickets.map((each) => ({ name: `Ticket ${each.num}`, selector: `[data-testid="ticket-node"][data-ticket="${each.num}"]` }))
    await expectSettledWithoutOverlaps(window, cards, 'cards that overlap')
  } finally {
    await launched.close()
  }
})

test('a Stage name too long even for the narrow form, beside a repository chip: the name wraps onto more lines, never «…», and «N/M», the blocked «!» and Ready stay whole inside the 240 px Card', async () => {
  // Check names and labels have no length limit (pipeline.ts): a long one in a Project over several repositories.
  const pipeline = WORFY_PIPELINE.map((stage) =>
    stage.kind === 'queued' ? { kind: 'queued', label: 'Waiting to start' } : stage.kind === 'check' ? { kind: 'check', name: 'windows-full-e2e' } : stage,
  )
  const launched = await launchNineStages(
    [
      { num: 1, status: 'open', state: 'open', repo: 'application-server' },
      { num: 2, status: 'blocked — waits for the owner', state: 'blocked', reason: 'waits for the owner', repo: 'web-client' },
    ],
    [openPull(42, 'demo/02', [ok, review('SUCCESS')])],
    (repo) => [
      { name: 'application-server', path: repo },
      { name: 'web-client', path: join(scratch, 'web-client') },
    ],
    pipeline,
  )
  try {
    const { window } = launched
    const cards = [
      { num: 1, stage: 'Waiting to start', count: '1/9', blocked: false, ready: true },
      { num: 2, stage: 'Check «windows-full-e2e»', count: '5/9', blocked: true, ready: false },
    ]
    for (const each of cards) {
      const card = window.locator(`[data-testid="ticket-node"][data-ticket="${each.num}"]`)
      await expect(card).toHaveAttribute('aria-label', `Ticket 0${each.num}, ${each.stage}`, { timeout: 20_000 })
      await expect(card.getByTestId('ticket-repo')).toBeVisible()
      await expect(card.getByTestId('ticket-ready')).toHaveCount(each.ready ? 1 : 0)
      await expect(card.getByTestId('stepper-blocked')).toHaveCount(each.blocked ? 1 : 0)
      await expect(card.getByTestId('ticket-stepper')).toHaveAttribute('data-narrow', 'true')
      await expect(card.getByTestId('stepper-label')).toHaveText(each.stage)
      await expect(card.getByTestId('stepper-count')).toHaveText(each.count)
      const fit = await stepperFit(card)
      expect(fit.card, `Ticket ${each.num} is a Card of the default width`).toBe(240)
      // The name wraps rather than end with «…»; the Card is tall enough for the extra lines.
      await expect(card.getByTestId('stepper-label')).not.toHaveCSS('text-overflow', 'ellipsis')
      expect(await ticketCardCuts(card), `nothing is cut on Ticket ${each.num}`).toEqual([])
      whole(fit.count, `«N/M» on Ticket ${each.num}`, fit)
      if (each.blocked) whole(fit.blocked, `the blocked «!» on Ticket ${each.num}`, fit)
      if (each.ready) whole(fit.ready, `the Ready chip on Ticket ${each.num}`, fit)
      whole(fit.stepper, `the stepper of Ticket ${each.num}`, fit)
      whole(fit.row, `the top row of Ticket ${each.num}`, fit)
    }
  } finally {
    await launched.close()
  }
})
