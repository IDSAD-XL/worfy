import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'

// The command palette (⌘K) and the search over the Canvas (⌘F), ticket 31, in the built app on the
// fake agent. The Project is a git repository with the Epic `worfy-mvp`; `epic-status` is a script
// under the temporary Claude home that prints a fixed answer. The Layout holds a Card whose page
// says "The fake agent card" and a Note tagged `plan`. worfy must not touch the repository.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

// Not all digits: the label becomes the last part of a Card's host name (worfy-card://c1.<label>),
// and a host name that ends in digits is read as an IPv4 address.
const PROJECT = 'worfy-0000003a'
const EPIC = 'worfy-mvp'

let scratch: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const TICKETS: { num: number; title: string; status: string; state: string; blocked: number[] }[] = [
  { num: 1, title: 'Skeleton', status: 'done — 2026-10-01', state: 'done', blocked: [] },
  { num: 2, title: 'Layout store', status: 'done — 2026-10-02', state: 'done', blocked: [1] },
  { num: 7, title: 'Search over the Canvas', status: 'open', state: 'open', blocked: [2] },
  { num: 8, title: 'Minimap', status: 'open', state: 'open', blocked: [9] },
  { num: 9, title: 'Focus mode', status: 'open', state: 'open', blocked: [2] },
  // A title with the digits of Ticket 07: "07" must still land on Ticket 07.
  { num: 12, title: 'Release notes for build 07', status: 'open', state: 'open', blocked: [] },
]
const nn = (num: number): string => String(num).padStart(2, '0')

function ticketFile({ num, title, status, blocked }: (typeof TICKETS)[number]): string {
  const blockers = blocked.length ? blocked.map(nn).join(', ') : '—'
  return [`# ${nn(num)} — ${title}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blockers}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n')
}

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

/** How far the middle of `node` is from the middle of the Canvas, in screen pixels. */
async function offCenter(window: Page, node: Locator): Promise<number> {
  const canvas = await window.getByTestId('canvas').boundingBox()
  const box = await node.boundingBox()
  if (!canvas || !box) return Number.POSITIVE_INFINITY
  return Math.hypot(box.x + box.width / 2 - (canvas.x + canvas.width / 2), box.y + box.height / 2 - (canvas.y + canvas.height / 2))
}

/** The React Flow wrapper of a Node, which carries its id. */
const flowNode = (window: Page, id: string): Locator => window.locator(`.react-flow__node[data-id="${id}"]`)

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-palette-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('⌘K goes to a Ticket and runs commands as the buttons do; ⌘F finds words in a transcript and a Card', async () => {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const repo = join(scratch, 'worfy')

  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# worfy MVP\n')
  for (const ticket of TICKETS) writeFileSync(join(issues, `${nn(ticket.num)}-t${ticket.num}.md`), ticketFile(ticket))
  writeFileSync(join(repo, 'HANDOFF.md'), '# HANDOFF\n\nNext: the palette.\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: TICKETS.map(({ num, title, status, state, blocked }) => ({
        epic: EPIC,
        num,
        slug: `t${num}`,
        title: `${nn(num)} — ${title}`,
        statusRaw: status,
        state,
        blockedRaw: blocked.length ? blocked.map(nn).join(', ') : '—',
        blockedNums: blocked,
        blockedParsed: true,
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), `#!/bin/sh\ncat '${answer}'\n`)
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  mkdirSync(join(dataDir, PROJECT, 'cards', 'c1'), { recursive: true })
  writeFileSync(
    join(dataDir, PROJECT, 'cards', 'c1', 'index.html'),
    '<!doctype html><html><head><title>Notes</title></head><body><p>The fake agent card</p><script>document.body.dataset.ready = "yes"</script></body></html>',
  )
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'worfy', path: repo }], activeId: PROJECT }))
  // The Epic frame is laid out right of the origin; the Card and the Note sit left of it.
  const base = { hidden: false, locked: false, pinned: false }
  writeFileSync(
    join(dataDir, PROJECT, 'layout.json'),
    JSON.stringify({
      nodes: [
        { id: 'c1', kind: 'card', x: -760, y: 40, w: 320, h: 220, ...base, tags: [], data: {} },
        { id: 'n1', kind: 'note', x: -760, y: 320, w: 220, h: 120, ...base, tags: ['plan'], data: { text: 'Plan of the wave' } },
      ],
      viewport: { x: 800, y: 60, zoom: 0.8 },
    }),
  )

  const scratchBefore = listing(join(repo, '.scratch'))
  const repoBefore = listing(repo, (path) => path.endsWith('/.git'))
  const statusBefore = git(repo, 'status', '--porcelain')
  const claudeBefore = listing(claudeHome)

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { window } = launched
    const ticket = (num: number): Locator => window.locator(`[data-testid="ticket-node"][data-ticket="${num}"]`)
    const palette = window.getByTestId('command-palette')
    const input = window.getByTestId('palette-input')
    const option = (id: string): Locator => window.locator(`[data-testid="palette-option"][data-command="${id}"]`)
    const options = window.getByTestId('palette-option')
    const sessionNodes = window.locator('[data-testid="session-node"]')
    // Ticket 07 sits near the right edge of the Canvas: it is drawn only once the window is 1600 px wide.
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [ticket(7), window.locator('[data-card-id="c1"]')] })

    // ⌘K → "07" → Enter: Ticket 07 first (above "Release notes for build 07"), and the Canvas centers on it.
    expect(await offCenter(window, ticket(7))).toBeGreaterThan(50_000)
    await window.keyboard.press('Meta+k')
    await expect(palette).toBeVisible()
    await input.fill('07')
    await expect(options.first()).toHaveAttribute('data-command', `ticket:${EPIC}/07`)
    await expect(option(`ticket:${EPIC}/12`)).toBeVisible()
    await window.screenshot({ path: test.info().outputPath('palette-07.png') })
    await input.press('Enter')
    await expect(palette).toHaveCount(0)
    await expect.poll(() => offCenter(window, ticket(7))).toBeLessThan(3)

    // "Ship ticket" is inactive for a Ticket with an open blocker, with the button's reason; Enter does nothing.
    const button = (num: number) => ticket(num).getByTestId('action-ship-ticket')
    await expect(button(8)).toHaveAttribute('title', 'blocked by 09')
    await window.keyboard.press('Meta+k')
    await input.fill(`ship ${EPIC}/08`)
    await expect(options.first()).toHaveAttribute('data-command', `ship-ticket:${EPIC}/08`)
    await expect(options.first()).toHaveAttribute('aria-disabled', 'true')
    await expect(options.first()).toHaveAttribute('title', 'blocked by 09')
    await input.press('Enter')
    await expect(palette).toBeVisible()
    // Nothing moves on the Canvas and no Session Node appears. A Session started late is caught
    // after "New session" below, by main's record of launches and by the count of Session Nodes.
    await canvasReady(launched)
    await expect(sessionNodes).toHaveCount(0)
    // The row did not run the action at all: main was not asked, so it had nothing to refuse.
    await expect(window.getByTestId('palette-problem')).toHaveCount(0)
    // An open Ticket whose blockers are done is active, with the text the button would send.
    await input.fill(`ship ${EPIC}/07`)
    await expect(options.first()).toHaveAttribute('data-command', `ship-ticket:${EPIC}/07`)
    await expect(options.first()).toHaveAttribute('aria-disabled', 'false')
    await expect(options.first()).toHaveAttribute('title', await button(7).getAttribute('title').then((title) => title ?? ''))
    await input.press('Escape')
    await expect(palette).toHaveCount(0)

    // "New session" from the palette: a Session Node, which answers through the fake agent.
    await window.keyboard.press('Meta+k')
    await input.fill('new session')
    await expect(options.first()).toHaveAttribute('data-command', 'new:session')
    await input.press('Enter')
    await expect(sessionNodes).toHaveCount(1)
    const sessionNode = sessionNodes.first()
    // The Canvas moves to the new Node (and has stopped moving before the next step).
    await expect.poll(() => offCenter(window, sessionNode)).toBeLessThan(3)
    await sessionNode.getByTestId('session-node-input').fill('first')
    await sessionNode.getByTestId('session-node-input').press('Enter')
    await expect(sessionNode.getByTestId('session-node-answer')).toHaveText('Hello from the fake agent')
    const sessionNodeId = await sessionNode.getAttribute('data-node-id')
    expect(sessionNodeId).toBeTruthy()
    // Seconds after the Enter on the inactive "Ship ticket" row: main has launched no Session for a
    // Ticket (its own record of "Ship ticket" launches), and the Canvas still shows one Session
    // Node, the one "New session" made. (agent.list is no help here: it also holds the Project's
    // Orchestrator Session, which starts on its own.)
    const launches = await window.evaluate(
      (projectId) =>
        (globalThis as unknown as { worfy: { invoke(channel: string, input: unknown): Promise<{ ok: boolean; value: { tickets: unknown[] } }> } }).worfy.invoke(
          'actions.launches',
          { projectId },
        ),
      PROJECT,
    )
    expect(launches).toMatchObject({ ok: true, value: { tickets: [] } })
    await expect(sessionNodes).toHaveCount(1)

    // "New terminal" comes from the Canvas menu's items (createLabel, ADR-0014): a Terminal Node in the middle of the Canvas.
    await window.keyboard.press('Meta+k')
    await input.fill('new terminal')
    await expect(options.first()).toHaveAttribute('data-command', 'new:terminal')
    await input.press('Enter')
    await expect(window.getByTestId('terminal-node')).toHaveCount(1)
    await expect.poll(() => offCenter(window, window.getByTestId('terminal-node'))).toBeLessThan(3)

    // Show only the Nodes tagged `plan`, then all again.
    await window.keyboard.press('Meta+k')
    await input.fill('only tag plan')
    await expect(options.first()).toHaveAttribute('data-command', 'tag:plan')
    await input.press('Enter')
    await expect(window.getByTestId('tag-filter')).toHaveAttribute('data-tag', 'plan')
    // The Nodes without the tag (the Card, the Session) are not drawn; the Note is. A Node off
    // screen is not in the page at all (React Flow draws only what is visible), so the rule is checked.
    const rule = async (id: string) => `.react-flow__node[data-id="${await window.evaluate((nodeId) => (globalThis as unknown as { CSS: { escape(text: string): string } }).CSS.escape(nodeId), id)}"]`
    const filterCss = (await window.getByTestId('tag-filter-style').textContent()) ?? ''
    expect(filterCss).toContain(await rule('c1'))
    expect(filterCss).toContain(await rule(sessionNodeId ?? ''))
    expect(filterCss).not.toContain(await rule('n1'))
    await expect(flowNode(window, 'c1')).toBeHidden()
    await window.keyboard.press('Meta+k')
    await input.fill('show all nodes')
    await input.press('Enter')
    await expect(window.getByTestId('tag-filter')).toHaveCount(0)
    await expect(window.getByTestId('tag-filter-style')).toHaveCount(0)

    // Go to the Card: it runs once it is on screen.
    await window.keyboard.press('Meta+k')
    await input.fill('c1')
    await expect(options.first()).toHaveAttribute('data-command', 'node:c1')
    await input.press('Enter')
    await expect(window.frameLocator('[data-card-id="c1"] iframe').locator('body[data-ready="yes"]')).toHaveCount(1)

    // ⌘F "fake agent": once in the Session's transcript, once in the Card's text; Enter moves between them.
    const find = window.getByTestId('canvas-find')
    // Typing into the Session Node selected it; an empty spot clears the selection, so the whole Canvas is searched.
    await window.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
    await window.keyboard.press('Meta+f')
    await expect(find).toBeVisible()
    await expect(window.getByTestId('find-scope')).toHaveCount(0)
    await window.getByTestId('find-input').fill('fake agent')
    await expect(window.getByTestId('find-count')).toHaveText('2 matches')
    await window.getByTestId('find-input').press('Enter')
    const first = { node: await find.getAttribute('data-current-node'), field: await find.getAttribute('data-current-field') }
    await expect(window.getByTestId('find-count')).toHaveText('1 of 2')
    await expect.poll(() => offCenter(window, flowNode(window, first.node ?? ''))).toBeLessThan(3)
    await window.getByTestId('find-input').press('Enter')
    await expect(window.getByTestId('find-count')).toHaveText('2 of 2')
    const second = { node: await find.getAttribute('data-current-node'), field: await find.getAttribute('data-current-field') }
    await expect.poll(() => offCenter(window, flowNode(window, second.node ?? ''))).toBeLessThan(3)
    expect([first, second].sort((a, b) => (a.field ?? '').localeCompare(b.field ?? ''))).toEqual([
      { node: 'c1', field: 'card' },
      { node: sessionNodeId, field: 'transcript' },
    ])
    await window.screenshot({ path: test.info().outputPath('find-fake-agent.png') })
    // ⇧Enter goes back to the first.
    await window.getByTestId('find-input').press('Shift+Enter')
    await expect(find).toHaveAttribute('data-current-node', first.node ?? '')
    // ⌘F again with the same (empty) selection keeps the place among the matches.
    await window.keyboard.press('Meta+f')
    await expect(window.getByTestId('find-count')).toHaveText('1 of 2')

    // ⌘F with the bar still open takes the selection anew: with the Card selected, only the Card
    // is searched, and the step through the matches starts again.
    await flowNode(window, 'c1').locator('[data-testid="card-title"]').click()
    await window.keyboard.press('Meta+f')
    await expect(window.getByTestId('find-scope')).toBeVisible()
    await expect(window.getByTestId('find-input')).toHaveValue('fake agent')
    await expect(window.getByTestId('find-count')).toHaveText('1 match')
    await window.getByTestId('find-input').press('Escape')
    await expect(find).toHaveCount(0)

    // Opened again with the Card selected: the same scope.
    await window.keyboard.press('Meta+f')
    await window.getByTestId('find-input').fill('fake agent')
    await expect(window.getByTestId('find-scope')).toBeVisible()
    await expect(window.getByTestId('find-count')).toHaveText('1 match')
    await window.getByTestId('find-input').press('Escape')
    await expect(find).toHaveCount(0)
  } finally {
    await launched.close()
  }

  // Nothing in the repository changed, nor under the Claude home.
  expect(listing(join(repo, '.scratch'))).toEqual(scratchBefore)
  expect(listing(repo, (path) => path.endsWith('/.git'))).toEqual(repoBefore)
  expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
  expect(listing(claudeHome)).toEqual(claudeBefore)
})
