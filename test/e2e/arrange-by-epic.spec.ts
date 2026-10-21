// "Arrange by Epic" (worfy-canvas ticket 12) against the built app: from ⌘K the Sessions of the
// fixture line up in one column right of the strip of Epic frames — each at the height of its
// Epic's frame, the Session without a Binding under them — while a Session with Keep and a Note
// stay where they are; one ⌘Z puts every Session back, ⇧⌘Z arranges again; a second window of the
// same Project draws the same places (ADR-0053); a second command right away sends nothing. The
// look in both themes is kept as the snapshot `arrange-by-epic` (test-results/e2e/snapshots/).
//
// The Sessions are bound the way family.spec.ts binds them: from transcripts in a temporary
// WORFY_CLAUDE_HOME that ran `ticket claim <epic> <NN>`.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, openSecondWindow, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript, loginProfileWithNode } from '../harness-node'

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT_ID = 'arrange-0000000c'
const ALPHA = 'alpha-epic'
const BETA = 'beta-epic'
const S_ALPHA = 'aaaaaaaa-1111-4111-8111-111111111111'
const S_BETA = 'bbbbbbbb-2222-4222-8222-222222222222'
const S_FREE = 'cccccccc-3333-4333-8333-333333333333'
const S_KEPT = 'dddddddd-4444-4444-8444-444444444444'
/** The gap right of the strip (FRAME_GAP) and between two clusters (CLUSTER_GAP). */
const FRAME_GAP = 48
/** How long a command that sends nothing is watched for a late operation. */
const SETTLE_MS = 2000

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

/** A committed repository with two Epics of open Tickets, and a Claude home whose `bin/epic-status` answers them. */
function makeEpics(repo: string, claudeHome: string, epics: Record<string, readonly number[]>): void {
  const nn = (num: number): string => String(num).padStart(2, '0')
  for (const [epic, nums] of Object.entries(epics)) {
    const issues = join(repo, '.scratch', epic, 'issues')
    mkdirSync(issues, { recursive: true })
    writeFileSync(join(repo, '.scratch', epic, 'spec.md'), '# Epic\n')
    for (const num of nums) writeFileSync(join(issues, `${nn(num)}-ticket-${num}.md`), [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', 'Status: open', 'Blocked by: —', ''].join('\n'))
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: Object.keys(epics).map((epic) => ({ epic, hasSpec: true, hasMap: false })),
      tickets: Object.entries(epics).flatMap(([epic, nums]) =>
        nums.map((num) => ({ epic, num, slug: `ticket-${num}`, title: `${nn(num)} — Ticket ${num}`, statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true })),
      ),
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
const claim = (sessionId: string, epic: string, num: number) => [prompt('take it'), bash(`toolu_${sessionId.slice(0, 4)}`, `~/.claude/bin/ticket claim ${epic} ${String(num).padStart(2, '0')}; echo "EXIT=$?"`), answer(`a_${sessionId.slice(0, 4)}`, 'claimed')]

const base = { hidden: false, locked: false, pinned: false, tags: [] }
const sessionNode = (id: string, x: number, y: number, cwd: string, extra: Record<string, unknown> = {}) => ({ id: `session:${id}`, kind: 'session', x, y, w: 300, h: 120, ...base, data: { sessionId: id, origin: 'external', source: 'terminal', cwd }, ...extra })

interface StateNode {
  id: string
  x: number
  y: number
  w: number
  h: number
}

async function state(window: Page): Promise<{ nodes: StateNode[]; revision: number }> {
  const result = await window.evaluate(
    (id) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { revision: number; layout: { nodes: StateNode[] } } }> } }).worfy.invoke('layout.get', {
        projectId: id,
      }),
    PROJECT_ID,
  )
  expect(result.ok).toBe(true)
  return { nodes: result.value.layout.nodes, revision: result.value.revision }
}

const placesOf = (nodes: readonly StateNode[]): Record<string, [number, number]> => Object.fromEntries(nodes.map((node) => [node.id, [node.x, node.y]]))

/** Where React Flow draws a Node, in canvas units: the translate of its element and its size. */
const drawnAt = (page: Page, id: string): Promise<{ x: number; y: number; w: number; h: number }> =>
  page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((element) => {
    const el = element as unknown as { style: { transform: string }; offsetWidth: number; offsetHeight: number }
    const found = /translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)/.exec(el.style.transform)
    return { x: Number(found?.[1]), y: Number(found?.[2]), w: el.offsetWidth, h: el.offsetHeight }
  })

/**
 * The Layout keeps `revision` for a while: a command that sends nothing leaves no signal of its own,
 * so the revision is read again and again over SETTLE_MS, long past an operation still in flight.
 */
async function revisionStays(window: Page, revision: number): Promise<void> {
  const until = Date.now() + SETTLE_MS
  while (Date.now() < until) {
    expect((await state(window)).revision, 'the Layout keeps its revision').toBe(revision)
    await window.waitForTimeout(100)
  }
}

/** The palette's "Arrange by Epic". */
async function arrangeFromPalette(window: Page): Promise<void> {
  await window.keyboard.press('ControlOrMeta+k')
  const input = window.getByTestId('palette-input')
  await input.fill('Arrange by Epic')
  await expect(window.getByTestId('palette-option').first()).toHaveAttribute('data-command', 'arrange-by-epic')
  await input.press('Enter')
  await expect(window.getByTestId('command-palette')).toHaveCount(0)
}

test('Arrange by Epic from ⌘K: the Sessions stand right of the strip at their Epics, the unbound one under them; one ⌘Z, ⇧⌘Z; a second window draws the same', async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-arrange-')))
  const repo = join(scratch, 'demo')
  const claudeHome = join(scratch, 'claude-home')
  const dataDir = join(scratch, 'data')
  makeEpics(repo, claudeHome, { [ALPHA]: [1, 2, 3], [BETA]: [1, 2] })
  writeSession(claudeHome, S_ALPHA, repo, claim(S_ALPHA, ALPHA, 2))
  writeSession(claudeHome, S_BETA, repo, claim(S_BETA, BETA, 1))
  writeSession(claudeHome, S_FREE, repo, [prompt('look around'), answer('a_free', 'ok')])
  writeSession(claudeHome, S_KEPT, repo, claim(S_KEPT, ALPHA, 3))
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(
    join(dataDir, PROJECT_ID, 'layout.json'),
    JSON.stringify({
      nodes: [
        // In the strip's band: the strip stands right of it until it joins the column.
        sessionNode(S_ALPHA, 40, 60, repo),
        sessionNode(S_BETA, -1300, 900, repo),
        sessionNode(S_FREE, -1300, 1200, repo),
        // Bound, but kept (ADR-0076): it stays.
        sessionNode(S_KEPT, -1300, 0, repo, { keep: true }),
        { id: 'note-1', kind: 'note', x: -1300, y: 300, w: 220, h: 120, ...base, data: { text: 'A note' } },
      ],
      viewport: { x: 600, y: 60, zoom: 0.4 },
    }),
  )
  const home = join(scratch, 'home')
  mkdirSync(home, { recursive: true })
  loginProfileWithNode(home)

  const launched: LaunchedApp = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, SHELL: '/bin/sh', HOME: home } })
  try {
    const { window } = launched
    const frame = (epic: string) => window.locator(`[data-testid="epic-frame"][data-epic="${epic}"]`)
    await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: [frame(ALPHA), frame(BETA)], timeout: 20_000 })
    // The Bindings are read: the anchors of the bound Sessions are on the Canvas.
    for (const id of [S_ALPHA, S_BETA, S_KEPT]) await expect(window.locator(`.react-flow__node[data-id="binding-anchor:session:${id}"]`)).toHaveCount(1, { timeout: 20_000 })
    const before = await state(window)

    await arrangeFromPalette(window)
    await expect.poll(async () => (await state(window)).revision, { timeout: 10_000 }).toBeGreaterThan(before.revision)
    // The strip comes back left once the alpha Session left its band; the Canvas settles.
    await canvasReady(launched)
    const arranged = await state(window)
    const at = (id: string) => arranged.nodes.find((node) => node.id === `session:${id}`)!
    // The renderer has drawn the move: the Sessions where main put them, and the strip, which moves
    // in the same render, where it settles. Only then are the frames read.
    for (const id of [S_ALPHA, S_BETA, S_FREE]) {
      await expect.poll(async () => { const drawn = await drawnAt(window, `session:${id}`); return [drawn.x, drawn.y] }, { message: `session ${id} drawn at its new place` }).toEqual([at(id).x, at(id).y])
    }
    const frames = async () => ({ alpha: await drawnAt(window, `epic:${ALPHA}`), beta: await drawnAt(window, `epic:${BETA}`) })
    const columnOf = ({ alpha, beta }: Awaited<ReturnType<typeof frames>>) => Math.ceil(Math.max(alpha.x, beta.x) + Math.max(alpha.w, beta.w) + FRAME_GAP)
    await expect.poll(async () => columnOf(await frames()), { message: 'the column stands FRAME_GAP right of the strip' }).toBe(at(S_ALPHA).x)
    const { alpha: alphaFrame, beta: betaFrame } = await frames()
    expect(at(S_ALPHA).y, 'alpha’s Session at the height of its frame').toBe(Math.round(alphaFrame.y))
    expect(at(S_BETA).x).toBe(at(S_ALPHA).x)
    expect(at(S_BETA).y, 'beta’s Session at its frame or under alpha’s cluster').toBe(Math.max(Math.round(betaFrame.y), at(S_ALPHA).y + 120 + FRAME_GAP))
    expect(at(S_FREE).x).toBe(at(S_ALPHA).x)
    expect(at(S_FREE).y, 'the unbound Session under the other clusters').toBe(at(S_BETA).y + 120 + FRAME_GAP)
    // The kept Session and the note did not move.
    const stayed = (nodes: readonly StateNode[]) => placesOf(nodes.filter((node) => node.id === `session:${S_KEPT}` || node.id === 'note-1'))
    expect(stayed(arranged.nodes)).toEqual(stayed(before.nodes))
    await snapshotThemes(window, 'arrange-by-epic')

    // A second window of the same Project draws every Session where the first one put it.
    const second = await openSecondWindow(launched, { size: { width: 1200, height: 800 } })
    await canvasReady({ window: second }, { visible: [second.locator(`[data-testid="epic-frame"][data-epic="${ALPHA}"]`)], timeout: 20_000 })
    for (const id of [S_ALPHA, S_BETA, S_FREE, S_KEPT]) {
      const drawn = await drawnAt(second, `session:${id}`)
      expect([drawn.x, drawn.y], `session ${id} in the second window`).toEqual([at(id).x, at(id).y])
    }

    // A second Arrange by Epic right away sends nothing: the Layout keeps its revision.
    await window.bringToFront()
    await arrangeFromPalette(window)
    await revisionStays(window, arranged.revision)

    // One ⌘Z puts every Session back; ⇧⌘Z arranges again.
    await window.locator('.react-flow__pane').click({ position: { x: 150, y: 700 } })
    await window.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => placesOf((await state(window)).nodes)).toEqual(placesOf(before.nodes))
    await window.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(async () => placesOf((await state(window)).nodes)).toEqual(placesOf(arranged.nodes))
  } finally {
    await launched.close()
    await removeDir(scratch)
  }
})

test('Arrange by Epic in the Canvas menu: under Tidy up, before Re-pack', async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-arrange-menu-')))
  const dataDir = join(scratch, 'data')
  const repo = join(scratch, 'plain')
  mkdirSync(repo, { recursive: true })
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'plain', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(join(dataDir, PROJECT_ID, 'layout.json'), JSON.stringify({ nodes: [{ id: 'note-1', kind: 'note', x: 100, y: 100, w: 220, h: 120, ...base, data: { text: 'A note' } }], viewport: { x: 0, y: 0, zoom: 1 } }))
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1200, height: 800 } })
    const before = await state(window)
    await window.locator('.react-flow__pane').click({ button: 'right', position: { x: 500, y: 400 } })
    const menu = window.getByRole('menu', { name: 'Canvas' })
    expect((await menu.getByRole('menuitem').allTextContents()).slice(-3)).toEqual(['Tidy up', 'Arrange by Epic', 'Re-pack'])
    // Without Epic frames there is nothing to arrange by: the command sends nothing.
    await menu.getByRole('menuitem', { name: 'Arrange by Epic' }).click()
    await expect(menu).toBeHidden()
    await revisionStays(window, before.revision)
  } finally {
    await launched.close()
    await removeDir(scratch)
  }
})
