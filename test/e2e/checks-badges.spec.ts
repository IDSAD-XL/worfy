import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { launchApp } from './helpers'
import { catScript } from '../harness-node'

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

/** What of `locator` is seen: its own overflow and how its text ends when cut. */
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
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000))

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
    // A gate, a PR, CI and a verdict on a 204 px Ticket: the PR number and the CI chip are whole,
    // inside the Ticket Node and inside every box that clips them. The gate and the verdict may be
    // cut, then with "…" and their text in a tooltip; the row's tooltip lists everything.
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
        expect(chipSeen.client, `${id} on Ticket ${num} keeps some width`).toBeGreaterThan(12)
        if (chipSeen.scroll > chipSeen.client) {
          expect(chipSeen.textOverflow, `${id} on Ticket ${num} is cut, so it ends with "…"`).toBe('ellipsis')
          await expect(chip, `${id} on Ticket ${num} is cut, so its tooltip holds its text`).toHaveAttribute('title', new RegExp(`^${(await chip.textContent())!}`))
        }
      }

      const card = (await ticket(num).boundingBox())!
      const ci = ticket(num).getByTestId('checks-ci')
      const box = (await ci.boundingBox())!
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
