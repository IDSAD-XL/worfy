import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot, type LaunchedApp } from './helpers'

// Bindings of Sessions and Subagents to Tickets and Epics (ticket 16), against the built app:
// Sessions whose transcripts the test writes into a temporary WORFY_CLAUDE_HOME the way Claude Code
// does — one that ran `ticket claim worfy-mvp 07`, two that work in the worktree folders
// `.claude/worktrees/12` and `.claude/worktrees/07-движок-сессий`, and one that runs
// `/epic-wave` with two Subagents (the synthetic Session 7777 of test/fixtures/claude-home, its
// briefs naming Ticket files). That Session's checkout is on the branch of Ticket 07, as an
// Orchestrator's often is, and its Subagents' files carry the same branch, as Claude Code writes
// them: the wave still binds it to the Epic and its Subagents to the Tickets of their briefs. It
// is live (a registry entry with the test's own pid), so its Subagents' files are read again on a
// timer. While the app runs, claims are appended to a finished Session's transcript and to a
// Subagent's file, and the lines follow. Then a Session's Node and a Subagent's Node are dropped
// on a Ticket (manual Bindings), the app restarts, and "Remove binding" — from the Session rail and
// from the Node's menu — brings the automatic Bindings back. worfy must write nothing under the
// Claude home or the Project.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT_ID = 'demo-0000000d'
const EPIC = 'worfy-mvp'
const CLAIM = 'aaaaaaaa-1111-4111-8111-111111111111'
const FOLDER = 'bbbbbbbb-2222-4222-8222-222222222222'
const SLUG = 'cccccccc-3333-4333-8333-333333333333'
const WAVE = '77777777-7777-4777-8777-777777777777'
/** The branch of the wave Session's checkout: a Ticket's, which must not beat `/epic-wave` or the briefs. */
const WAVE_BRANCH = `${EPIC}/07`
const IMPLEMENTER = 'a3000000000000286'
const REVIEWER = 'a5000000000000286'
const FIXTURE = join(repoRoot, 'test', 'fixtures', 'claude-home', 'projects', '-Users-test-projects-agents')

let scratch: string
let dataDir: string
let claudeHome: string
let repo: string

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const transcriptDir = (cwd: string): string => join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))

function snapshot(root: string, skip: (path: string) => boolean = () => false): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (skip(relative(root, path))) continue
      if (entry.isDirectory()) walk(path)
      else {
        const stats = statSync(path)
        out[relative(root, path)] = `${stats.size}:${stats.mtimeMs}`
      }
    }
  }
  walk(root)
  return out
}

const TICKETS = [
  { num: 7, slug: 'движок-сессий', status: 'claimed — 2026-10-05', state: 'work', title: '07 — Движок сессий' },
  { num: 12, slug: 'рамка', status: 'open', state: 'open', title: '12 — Рамка Эпика' },
  { num: 16, slug: 'привязка', status: 'open', state: 'open', title: '16 — Привязка' },
]

/** The Project: a git repository with one Epic of three Tickets, the only and active Project. */
function makeProject(): void {
  repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# worfy MVP\n')
  for (const ticket of TICKETS) {
    const nn = String(ticket.num).padStart(2, '0')
    writeFileSync(join(issues, `${nn}-${ticket.slug}.md`), [`# ${ticket.title}`, '', 'Type: task', `Status: ${ticket.status}`, 'Blocked by: —', ''].join('\n'))
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  // The worktree folders the Sessions work in (not git worktrees: only their path matters).
  mkdirSync(join(repo, '.claude', 'worktrees', '12'), { recursive: true })
  mkdirSync(join(repo, '.claude', 'worktrees', '07-движок-сессий'), { recursive: true })

  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  const answer = join(scratch, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: TICKETS.map((ticket) => ({
        epic: EPIC,
        num: ticket.num,
        slug: ticket.slug,
        title: ticket.title,
        statusRaw: ticket.status,
        state: ticket.state,
        blockedRaw: '—',
        blockedNums: [],
        blockedParsed: true,
      })),
    }),
  )
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, `#!/bin/sh\ncat '${answer}'\n`)
  chmodSync(script, 0o755)
}

const record = (sessionId: string, cwd: string, gitBranch: string, body: Record<string, unknown>, n: number): string =>
  `${JSON.stringify({ isSidechain: false, timestamp: `2026-10-05T10:00:0${n}.000Z`, uuid: `${sessionId.slice(0, 8)}-0000-4000-8000-00000000000${n}`, sessionId, cwd, gitBranch, version: '2.1.289', ...body })}\n`
const prompt = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
const bash = (id: string, command: string) => ({ type: 'assistant', message: { id: `msg_${id}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } })
const answer = (id: string, text: string) => ({ type: 'assistant', message: { id: `msg_${id}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text }] } })

/** A finished Session's transcript, as Claude Code leaves it. */
function writeSession(sessionId: string, cwd: string, gitBranch: string, bodies: Record<string, unknown>[]): void {
  const dir = transcriptDir(cwd)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), bodies.map((body, index) => record(sessionId, cwd, gitBranch, body, index)).join(''))
}

/** Session 7777 of the fixtures in this Project, started with `/epic-wave`, its Subagents briefed with Ticket files. */
function writeWaveSession(): void {
  const dir = transcriptDir(repo)
  const subagents = join(dir, WAVE, 'subagents')
  mkdirSync(subagents, { recursive: true })
  const onBranch = (text: string): string => text.replaceAll('/Users/test/projects/agents', repo).replaceAll('"gitBranch":"main"', `"gitBranch":${JSON.stringify(WAVE_BRANCH)}`)
  const lines = onBranch(readFileSync(join(FIXTURE, `${WAVE}.jsonl`), 'utf8')).split('\n').filter((line) => line !== '')
  const first = JSON.parse(lines[0]!) as Record<string, unknown>
  first.message = { role: 'user', content: `<command-name>/epic-wave</command-name>\n<command-args>волна 1 эпика ${EPIC}</command-args>` }
  writeFileSync(join(dir, `${WAVE}.jsonl`), [JSON.stringify(first), ...lines.slice(1)].join('\n') + '\n')
  const briefs: Record<string, string> = {
    'Synthetic implementer brief.': `Тикет: ${repo}/.scratch/${EPIC}/issues/16-привязка.md (один файл).`,
    'Synthetic reviewer brief.': `Ревью тикета .scratch/${EPIC}/issues/12-рамка.md, линза: тесты.`,
  }
  for (const name of readdirSync(join(FIXTURE, WAVE, 'subagents'))) {
    let text = onBranch(readFileSync(join(FIXTURE, WAVE, 'subagents', name), 'utf8'))
    for (const [from, to] of Object.entries(briefs)) text = text.replaceAll(from, to)
    writeFileSync(join(subagents, name), text)
  }
  // Live: the registry entry of a process that runs (this test's), so its signals are polled.
  writeFileSync(join(claudeHome, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: WAVE, cwd: repo, status: 'busy', kind: 'interactive' }))
}

const subagentFile = (agentId: string): string => join(transcriptDir(repo), WAVE, 'subagents', `agent-${agentId}.jsonl`)

const sessionNode = (id: string, x: number, y: number, cwd: string) => ({
  id: `session:${id}`,
  kind: 'session',
  x,
  y,
  w: 300,
  h: 120,
  data: { sessionId: id, origin: 'external', source: 'terminal', cwd },
})

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })

const sessionEdge = (window: Page, sessionId: string): Locator => window.getByTestId(`rf__edge-binding:session:${sessionId}`)
const subagentNode = (window: Page, agentId: string): Locator => window.locator(`[data-testid="subagent-node"][data-subagent-id="${agentId}"]`)

async function subagentEdge(window: Page, agentId: string): Promise<Locator> {
  const nodeId = await subagentNode(window, agentId).getAttribute('data-node-id')
  if (nodeId === null) throw new Error(`Subagent ${agentId} has no Node id`)
  return window.getByTestId(`rf__edge-binding:${nodeId}`)
}

/** Two boxes in the same place, to a pixel. */
const near = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1

/** Drags a Node by `handle` onto Ticket `num` and drops it there once the Ticket is outlined. */
async function dropOnTicket(window: Page, handle: Locator, num: number): Promise<void> {
  // Start only once the Node has stopped moving (a fold just opened, a Node just sent back).
  let last = await box(handle)
  await expect
    .poll(async () => {
      const now = await box(handle)
      const still = near(now, last)
      last = now
      return still
    })
    .toBe(true)
  const from = last
  const to = await box(window.locator(`[data-testid="ticket-node"][data-ticket="${num}"]`))
  await window.mouse.move(from.x + 10, from.y + from.height / 2)
  await window.mouse.down()
  await window.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 })
  await expect(window.getByTestId('binding-drop-target')).toHaveAttribute('data-target', `${EPIC}/${String(num).padStart(2, '0')}`)
  await window.mouse.up()
  await expect(window.getByTestId('binding-drop-target')).toHaveCount(0)
}
const sessionTitle = (window: Page, sessionId: string): Locator => window.locator(`[data-testid="session-node"][data-session-id="${sessionId}"] [data-testid="session-node-title"]`)

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

async function layoutNode(window: Page, id: string): Promise<{ x: number; y: number } | undefined> {
  return window.evaluate(
    async ({ projectId, nodeId }) => {
      const bridge = (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ value: { layout: { nodes: { id: string; x: number; y: number }[] } } }> } }).worfy
      const result = await bridge.invoke('layout.get', { projectId })
      return result.value.layout.nodes.find((node) => node.id === nodeId)
    },
    { projectId: PROJECT_ID, nodeId: id },
  )
}

const bindingsFile = (): string => join(dataDir, PROJECT_ID, 'bindings.json')
const savedBindings = (): unknown => (existsSync(bindingsFile()) ? (JSON.parse(readFileSync(bindingsFile(), 'utf8')) as { bindings: unknown[] }).bindings : null)

/** Opens a Session's view by a double click on its Node and returns its rail's Binding block. */
async function openRail(window: Page, sessionId: string): Promise<Locator> {
  await sessionTitle(window, sessionId).dblclick()
  const rail = window.getByTestId('session-view').getByTestId('binding-rail')
  await expect(rail).toBeVisible()
  return rail
}

/** Back to the Canvas, with nothing selected: the selection toolbar of the Node just opened would cover its neighbours. */
async function backToCanvas(window: Page): Promise<void> {
  await window.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click()
  await expect(window.getByTestId('canvas')).toBeVisible()
  const pane = await box(window.locator('.react-flow__pane'))
  await window.mouse.click(pane.x + 10, pane.y + pane.height - 10)
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-binding-')))
  dataDir = join(scratch, 'data')
  makeProject()
  writeSession(CLAIM, repo, 'main', [prompt('take 07'), bash('toolu_claim', `~/.claude/bin/ticket claim ${EPIC} 07; echo "КОД=$?"`), answer('a1', 'claimed')])
  writeSession(FOLDER, join(repo, '.claude', 'worktrees', '12'), 'HEAD', [prompt('look around'), answer('a2', 'ok')])
  writeSession(SLUG, join(repo, '.claude', 'worktrees', '07-движок-сессий'), 'HEAD', [prompt('look around'), answer('a3', 'ok')])
  writeWaveSession()
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(
    join(dataDir, PROJECT_ID, 'layout.json'),
    JSON.stringify({
      nodes: [
        sessionNode(CLAIM, 760, 0, repo),
        sessionNode(FOLDER, 760, 160, join(repo, '.claude', 'worktrees', '12')),
        sessionNode(SLUG, 760, 320, join(repo, '.claude', 'worktrees', '07-движок-сессий')),
        sessionNode(WAVE, 760, 480, repo),
      ],
      // Zoomed out and close together: a CI display may be smaller than the window asked for, and a
      // Node off the screen is not rendered (onlyRenderVisibleElements), so it cannot be clicked.
      viewport: { x: 20, y: 40, zoom: 0.38 },
    }),
  )
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('agents are bound by claim, worktree folder, /epic-wave and their task; a manual Binding by drag survives a restart and "Remove binding" undoes it', async () => {
  const claudeBefore = snapshot(claudeHome)
  /** Appends to a transcript as Claude Code would; the snapshot then expects the file as appended. */
  const append = (path: string, text: string): void => {
    appendFileSync(path, text)
    const stats = statSync(path)
    claudeBefore[relative(claudeHome, path)] = `${stats.size}:${stats.mtimeMs}`
  }
  const repoBefore = snapshot(repo, (path) => path === '.git' || path.startsWith('.git/'))
  const gitStatus = git(repo, 'status', '--porcelain', '--ignored')

  let launched = await launch()
  try {
    let { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 900))
    await expect(window.locator('[data-testid="ticket-node"][data-ticket="12"]')).toBeVisible()
    await expect(sessionTitle(window, CLAIM)).toBeVisible()

    // ticket claim → Ticket 07; the line ends at the Ticket.
    await expect(sessionEdge(window, CLAIM)).toHaveAttribute('aria-label', `bound to ${EPIC}/07 · ticket claim`)
    // The worktree folder, with and without a slug.
    await expect(sessionEdge(window, FOLDER)).toHaveAttribute('aria-label', `bound to ${EPIC}/12 · worktree .claude/worktrees/12`)
    await expect(sessionEdge(window, SLUG)).toHaveAttribute('aria-label', `bound to ${EPIC}/07 · worktree .claude/worktrees/07-движок-сессий`)
    // The Session running the wave → the Epic, though its checkout is on Ticket 07's branch; its
    // Subagents → the Tickets of their briefs, not the branch their files inherit; the scout, whose
    // brief names no Ticket, → nothing (six lines in all).
    await expect(sessionEdge(window, WAVE)).toHaveAttribute('aria-label', `bound to ${EPIC} · /epic-wave`)
    await window.getByTestId('subagent-fold').first().click()
    await expect(await subagentEdge(window, IMPLEMENTER)).toHaveAttribute('aria-label', `bound to ${EPIC}/16 · task`)
    await expect(await subagentEdge(window, REVIEWER)).toHaveAttribute('aria-label', `bound to ${EPIC}/12 · task`)
    await expect(window.locator('.react-flow__edge.w-edge-binding')).toHaveCount(6)
    await window.screenshot({ path: test.info().outputPath('binding-automatic.png') })

    // The rail says why.
    let rail = await openRail(window, CLAIM)
    await expect(rail.getByTestId('binding-target')).toHaveText(`${EPIC}/07`)
    await expect(rail.getByTestId('binding-reason')).toHaveText('ticket claim')
    await expect(rail).toContainText('07 — Движок сессий')
    await backToCanvas(window)
    rail = await openRail(window, FOLDER)
    await expect(rail.getByTestId('binding-reason')).toHaveText('worktree .claude/worktrees/12')
    await backToCanvas(window)

    // While the app runs, a claim appended to a finished Session's transcript (claudeHome.changed)
    // and to a live Session's Subagent file (not watched: read again on a timer) moves their lines.
    const folderCwd = join(repo, '.claude', 'worktrees', '12')
    append(join(transcriptDir(folderCwd), `${FOLDER}.jsonl`), record(FOLDER, folderCwd, 'HEAD', bash('toolu_live', `~/.claude/bin/ticket claim ${EPIC} 16`), 3))
    await expect(sessionEdge(window, FOLDER)).toHaveAttribute('aria-label', `bound to ${EPIC}/16 · ticket claim`)
    append(subagentFile(REVIEWER), record(WAVE, repo, WAVE_BRANCH, { ...bash('toolu_rclaim', `~/.claude/bin/ticket claim ${EPIC} 07`), isSidechain: true, agentId: REVIEWER }, 9))
    await expect(await subagentEdge(window, REVIEWER)).toHaveAttribute('aria-label', `bound to ${EPIC}/07 · ticket claim`)

    // Drag the claiming Session's Node onto Ticket 12: bound by hand, and the Node goes back.
    const before = await layoutNode(window, `session:${CLAIM}`)
    await dropOnTicket(window, sessionTitle(window, CLAIM), 12)
    await expect(sessionEdge(window, CLAIM)).toHaveAttribute('aria-label', `bound to ${EPIC}/12 · manual`)
    await expect.poll(savedBindings).toEqual([{ sessionId: CLAIM, agentId: null, target: { kind: 'ticket', epic: EPIC, num: 12 } }])
    await expect.poll(() => layoutNode(window, `session:${CLAIM}`)).toEqual(before)

    // The same for a Subagent's Node: bound by hand under its own agentId, and back in its place.
    const implementer = subagentNode(window, IMPLEMENTER)
    const placed = await box(implementer)
    await dropOnTicket(window, implementer.getByTestId('subagent-name'), 12)
    await expect(await subagentEdge(window, IMPLEMENTER)).toHaveAttribute('aria-label', `bound to ${EPIC}/12 · manual`)
    await expect
      .poll(savedBindings)
      .toEqual([
        { sessionId: CLAIM, agentId: null, target: { kind: 'ticket', epic: EPIC, num: 12 } },
        { sessionId: WAVE, agentId: IMPLEMENTER, target: { kind: 'ticket', epic: EPIC, num: 12 } },
      ])
    await expect.poll(async () => near(await box(implementer), placed)).toBe(true)
    rail = await openRail(window, CLAIM)
    await expect(rail.getByTestId('binding-reason')).toHaveText('manual')
    await expect(rail.getByTestId('binding-target')).toHaveText(`${EPIC}/12`)
    await backToCanvas(window)
    await window.screenshot({ path: test.info().outputPath('binding-manual.png') })

    // After a restart the manual Binding is still there.
    await launched.close()
    launched = await launch()
    window = launched.window
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 900))
    await expect(sessionEdge(window, CLAIM)).toHaveAttribute('aria-label', `bound to ${EPIC}/12 · manual`)
    await window.getByTestId('subagent-fold').first().click()
    await expect(await subagentEdge(window, IMPLEMENTER)).toHaveAttribute('aria-label', `bound to ${EPIC}/12 · manual`)

    // "Remove binding" in the Session rail: the claim binds again.
    rail = await openRail(window, CLAIM)
    await rail.getByTestId('binding-remove').click()
    await expect(rail.getByTestId('binding-reason')).toHaveText('ticket claim')
    await expect(rail.getByTestId('binding-target')).toHaveText(`${EPIC}/07`)
    await backToCanvas(window)
    await expect(sessionEdge(window, CLAIM)).toHaveAttribute('aria-label', `bound to ${EPIC}/07 · ticket claim`)
    await expect.poll(savedBindings).toEqual([{ sessionId: WAVE, agentId: IMPLEMENTER, target: { kind: 'ticket', epic: EPIC, num: 12 } }])

    // "Remove binding" from the Subagent Node's menu: the brief binds it again.
    await subagentNode(window, IMPLEMENTER).getByTestId('subagent-name').click({ button: 'right' })
    await window.getByTestId('binding-menu').getByRole('menuitem', { name: 'Remove binding' }).click()
    await expect(await subagentEdge(window, IMPLEMENTER)).toHaveAttribute('aria-label', `bound to ${EPIC}/16 · task`)
    await expect.poll(savedBindings).toEqual([])
    // A Node without a manual Binding has no such menu.
    await sessionTitle(window, FOLDER).click({ button: 'right' })
    await expect(window.getByTestId('binding-menu')).toHaveCount(0)
  } finally {
    await launched.close()
  }

  // worfy wrote nothing under the Claude home and nothing into the Project.
  expect(snapshot(claudeHome)).toEqual(claudeBefore)
  expect(snapshot(repo, (path) => path === '.git' || path.startsWith('.git/'))).toEqual(repoBefore)
  expect(git(repo, 'status', '--porcelain', '--ignored')).toBe(gitStatus)
})
