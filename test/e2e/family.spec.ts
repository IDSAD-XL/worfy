// The Family of a Node on the built app (worfy-canvas ticket 03): hovering a Session draws its
// Binding line and no other Node fades — another Session, another Ticket, a note all keep opacity 1
// (worfy-canvas ticket 17); "Show family" in the selection toolbar fits the camera to the whole
// Family; a second window of the same Project draws no line for it (the highlight is the window's
// own, ADR-0053); on the read-only screen of a Linked machine (ADR-0066) hovering fades nothing
// either and "Show family" works.
//
// The Sessions are bound the way binding.spec.ts binds them, from transcripts in a temporary
// WORFY_CLAUDE_HOME: one ran `ticket claim worfy-mvp 07`, the other works in `.claude/worktrees/12`.
// The look in both themes is kept as the snapshot `family-hover` (test-results/e2e/snapshots/).
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, chooseLevel, closeSettings, launchApp, linkThroughUi, machineIdOf, openMachinesSettings, openSecondWindow, PROJECTS_ACCESS_LABEL, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript, loginProfileWithNode } from '../harness-node'

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT_ID = 'demo-0000000d'
const EPIC = 'worfy-mvp'
const CLAIM = 'aaaaaaaa-1111-4111-8111-111111111111'
const FOLDER = 'bbbbbbbb-2222-4222-8222-222222222222'

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

/** A committed repository with Epic `epic` of open Tickets `nums`, and a Claude home whose `bin/epic-status` answers them. */
function makeEpic(repo: string, claudeHome: string, epic: string, nums: readonly number[]): void {
  const issues = join(repo, '.scratch', epic, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', epic, 'spec.md'), '# Epic\n')
  const nn = (num: number): string => String(num).padStart(2, '0')
  for (const num of nums) writeFileSync(join(issues, `${nn(num)}-ticket-${num}.md`), [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', 'Status: open', 'Blocked by: —', ''].join('\n'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic, hasSpec: true, hasMap: false }],
      tickets: nums.map((num) => ({ epic, num, slug: `ticket-${num}`, title: `${nn(num)} — Ticket ${num}`, statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
}

/** A finished Session's transcript, as Claude Code leaves it. */
function writeSession(claudeHome: string, sessionId: string, cwd: string, bodies: Record<string, unknown>[]): void {
  const dir = join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const record = (body: Record<string, unknown>, n: number): string =>
    `${JSON.stringify({ isSidechain: false, timestamp: `2026-10-05T10:00:0${n}.000Z`, uuid: `${sessionId.slice(0, 8)}-0000-4000-8000-00000000000${n}`, sessionId, cwd, gitBranch: 'main', version: '2.1.289', ...body })}\n`
  writeFileSync(join(dir, `${sessionId}.jsonl`), bodies.map(record).join(''))
}
const prompt = (text: string) => ({ type: 'user', message: { role: 'user', content: text } })
const bash = (id: string, command: string) => ({ type: 'assistant', message: { id: `msg_${id}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } })
const answer = (id: string, text: string) => ({ type: 'assistant', message: { id: `msg_${id}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text }] } })

const base = { hidden: false, locked: false, pinned: false, tags: [] }
const sessionNode = (id: string, x: number, y: number, cwd: string) => ({ id: `session:${id}`, kind: 'session', x, y, w: 300, h: 120, ...base, data: { sessionId: id, origin: 'external', source: 'terminal', cwd } })

/** The computed opacity of a Node's element, as React Flow draws it. */
const opacity = (window: Page, nodeId: string): Promise<string> =>
  window
    .locator(`.react-flow__node[data-id="${nodeId}"]`)
    .evaluate((element) => (globalThis as unknown as { getComputedStyle(e: object): { opacity: string } }).getComputedStyle(element).opacity)

/** Polls until each Node has its opacity; a Node is never faded, so it is '1' for every one. */
async function expectOpacities(window: Page, expected: Record<string, string>, timeout = 20_000): Promise<void> {
  const ids = Object.keys(expected)
  await expect.poll(async () => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await opacity(window, id)]))), { timeout }).toEqual(expected)
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

/** Whether every one of `nodeIds` lies wholly inside the Canvas. */
async function allOnCanvas(window: Page, nodeIds: readonly string[]): Promise<boolean> {
  const canvas = await box(window.locator('.react-flow'))
  for (const id of nodeIds) {
    const node = await window.locator(`.react-flow__node[data-id="${id}"]`).boundingBox()
    if (!node || node.x < canvas.x || node.y < canvas.y || node.x + node.width > canvas.x + canvas.width || node.y + node.height > canvas.y + canvas.height) return false
  }
  return true
}

test('hovering a Session draws its Binding line and fades no Node; "Show family" fits the camera to it; a second window draws no line', async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-family-')))
  const repo = join(scratch, 'demo')
  const claudeHome = join(scratch, 'claude-home')
  const dataDir = join(scratch, 'data')
  makeEpic(repo, claudeHome, EPIC, [7, 12])
  mkdirSync(join(repo, '.claude', 'worktrees', '12'), { recursive: true })
  writeSession(claudeHome, CLAIM, repo, [prompt('take 07'), bash('toolu_claim', `~/.claude/bin/ticket claim ${EPIC} 07; echo "EXIT=$?"`), answer('a1', 'claimed')])
  writeSession(claudeHome, FOLDER, join(repo, '.claude', 'worktrees', '12'), [prompt('look around'), answer('a2', 'ok')])
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(
    join(dataDir, PROJECT_ID, 'layout.json'),
    JSON.stringify({
      nodes: [
        sessionNode(CLAIM, 760, 0, repo),
        sessionNode(FOLDER, 760, 180, join(repo, '.claude', 'worktrees', '12')),
        { id: 'note-1', kind: 'note', x: 760, y: 360, w: 220, h: 120, ...base, data: { text: 'A note' } },
      ],
      viewport: { x: 20, y: 40, zoom: 0.5 },
    }),
  )

  // The login shell is /bin/sh with this HOME: its .profile puts node on PATH, for the epic-status stub.
  const home = join(scratch, 'home')
  mkdirSync(home, { recursive: true })
  loginProfileWithNode(home)

  const launched: LaunchedApp = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, SHELL: '/bin/sh', HOME: home } })
  try {
    const { window } = launched
    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    await canvasReady(launched, { size: { width: 1600, height: 900 }, visible: [frame] })
    const second = await openSecondWindow(launched, { size: { width: 1200, height: 800 } })
    await canvasReady({ window: second }, { visible: [second.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)] })
    // The machine's own cursor may rest over either window. A Node that comes to lie under it while
    // the Canvas settles (a frame that grows, a camera that moves) is hovered for real, and its
    // Family's lines are drawn. Each window first gets the test's pointer at an empty corner of its
    // Canvas, so only the test's own moves hover anything.
    for (const page of [window, second]) {
      const canvas = await box(page.locator('.react-flow'))
      await page.mouse.move(canvas.x + 8, canvas.y + canvas.height - 8)
    }

    const claim = `session:${CLAIM}`
    const folder = `session:${FOLDER}`
    const ticket7 = `ticket:${EPIC}/7`
    const ticket12 = `ticket:${EPIC}/12`
    const epicFrame = `epic:${EPIC}`
    // Nothing focused: every Node bright.
    await expectOpacities(window, { [claim]: '1', [folder]: '1', [ticket7]: '1', [ticket12]: '1', [epicFrame]: '1', 'note-1': '1' })

    // Hovering the claiming Session: its Binding line is drawn; the other Session's is not.
    const claimNode = window.locator(`[data-testid="session-node"][data-session-id="${CLAIM}"]`)
    await claimNode.hover()
    await expect(window.getByTestId(`rf__edge-binding:${claim}`).locator('path.react-flow__edge-path')).toHaveCount(1)
    await expect(window.getByTestId(`rf__edge-binding:${folder}`).locator('path.react-flow__edge-path')).toHaveCount(0)
    // No Node fades, in the Family or outside it.
    await expectOpacities(window, { [claim]: '1', [ticket7]: '1', [epicFrame]: '1', [folder]: '1', [ticket12]: '1', 'note-1': '1' })
    // The second window of the same Project draws no line for it.
    await expect(second.getByTestId(`rf__edge-binding:${claim}`).locator('path.react-flow__edge-path')).toHaveCount(0)
    expect(await opacity(second, ticket12)).toBe('1')
    await snapshotThemes(window, 'family-hover')

    // Away from the Nodes: the line goes, and the Nodes are as they were.
    const pane = await box(window.locator('.react-flow'))
    await window.mouse.move(pane.x + 8, pane.y + pane.height - 8)
    await expect(window.getByTestId(`rf__edge-binding:${claim}`).locator('path.react-flow__edge-path')).toHaveCount(0)
    await expectOpacities(window, { [folder]: '1', [ticket12]: '1', 'note-1': '1' })

    // Select the Session, then pan the Canvas right until the Epic frame (right of the Sessions)
    // leaves the screen; the Session and its toolbar stay on it. Then "Show family".
    await claimNode.click()
    const showFamily = window.getByTestId('selection-toolbar').getByRole('button', { name: 'Show family' })
    await expect(showFamily).toBeVisible()
    await window.mouse.move(pane.x + 8, pane.y + pane.height - 8)
    for (let step = 0; step < 20 && (await allOnCanvas(window, [epicFrame, ticket7, claim])); step += 1) {
      await window.mouse.wheel(-80, 0)
      await canvasReady(launched)
    }
    expect(await allOnCanvas(window, [epicFrame, ticket7, claim])).toBe(false)
    const camera = (page: Page): Promise<string | null> => page.locator('.react-flow__viewport').getAttribute('style')
    const secondCamera = await camera(second)
    const before = await camera(window)
    await showFamily.click()
    await expect.poll(() => allOnCanvas(window, [epicFrame, ticket7, claim])).toBe(true)
    expect(await camera(window)).not.toBe(before)
    // The selected Session fades no Node either, and the second window's camera did not move with it.
    await expectOpacities(window, { [folder]: '1', [ticket12]: '1', 'note-1': '1' })
    expect(await camera(second)).toBe(secondCamera)
  } finally {
    await launched.close()
    await removeDir(scratch)
  }
})

test.describe('on a read-only screen', () => {
  test.setTimeout(180_000)

  test('hovering a Ticket of a Linked machine shown read-only fades no Node; "Show family" is there and active', async () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-family-ro-')))
    const ALPHA = 'alpha-0000000a'
    const BETA = 'beta-0000000b'
    const epic = 'demo'
    const alpha = join(scratch, 'alpha')
    mkdirSync(alpha, { recursive: true })
    git(alpha, 'init', '-q')
    const aData = join(scratch, 'a-data')
    mkdirSync(aData, { recursive: true })
    writeFileSync(join(aData, 'projects.json'), JSON.stringify({ projects: [{ id: ALPHA, name: 'alpha', path: realpathSync(alpha) }], activeId: ALPHA }))
    // B: Epic `demo` with Tickets 1 and 2, and a note.
    const beta = join(scratch, 'beta')
    const bClaude = join(scratch, 'b-claude')
    makeEpic(beta, bClaude, epic, [1, 2])
    const bData = join(scratch, 'b-data')
    mkdirSync(join(bData, BETA), { recursive: true })
    writeFileSync(join(bData, 'projects.json'), JSON.stringify({ projects: [{ id: BETA, name: 'beta', path: realpathSync(beta) }], activeId: BETA }))
    writeFileSync(join(bData, BETA, 'layout.json'), JSON.stringify({ nodes: [{ id: 'note-b', kind: 'note', x: 1300, y: 60, w: 220, h: 120, ...base, data: { text: 'A note of B' } }], viewport: { x: 0, y: 0, zoom: 0.5 } }))
    const bHome = join(scratch, 'b-home')
    mkdirSync(bHome, { recursive: true })
    loginProfileWithNode(bHome)

    const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
    let b: LaunchedApp | undefined
    try {
      b = await launchApp({ env: { WORFY_DATA_DIR: bData, WORFY_CLAUDE_HOME: bClaude, WORFY_AGENT_SCRIPT: 'orchestrator', SHELL: '/bin/sh', HOME: bHome } })
      const size = { width: 1400, height: 900 }
      await canvasReady(b, { size })
      await canvasReady(a, { size })
      await linkThroughUi(a.window, b.window)
      const aId = await machineIdOf(a.window)
      const bId = await machineIdOf(b.window)
      const settings = await openMachinesSettings(b)
      await settings.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true }).click()
      await chooseLevel(b.window, settings.getByTestId(`link-machine-access-${aId}`), 'read')
      await closeSettings(b.window)

      // A opens beta of B, read-only.
      const group = a.window.locator(`[data-testid="machine-group"][data-machine-id="${bId}"]`)
      await expect(group.getByTestId('machine-read-only')).toHaveText('Read only', { timeout: 20_000 })
      await group.locator(`[data-testid="project-row"][data-project-id="${BETA}"]`).getByRole('button').click()
      await expect(a.window.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)
      await expect(a.window.getByTestId('canvas-read-only')).toBeVisible()
      const ticket1 = a.window.locator('[data-testid="ticket-node"][data-ticket="1"]')
      await canvasReady(a, { visible: [ticket1, a.window.locator('[data-testid="note-node"][data-node-id="note-b"]')] })

      await ticket1.hover()
      await expectOpacities(a.window, { [`ticket:${epic}/1`]: '1', [`epic:${epic}`]: '1', [`ticket:${epic}/2`]: '1', 'note-b': '1' })

      await ticket1.click()
      const showFamily = a.window.getByTestId('selection-toolbar').getByRole('button', { name: 'Show family' })
      await expect(showFamily).toBeVisible()
      await expect(showFamily).not.toHaveAttribute('aria-disabled', 'true')
      await showFamily.click()
      await expect.poll(() => allOnCanvas(a.window, [`epic:${epic}`, `ticket:${epic}/1`])).toBe(true)
    } finally {
      await a.close()
      await b?.close()
      await removeDir(scratch)
    }
  })
})
