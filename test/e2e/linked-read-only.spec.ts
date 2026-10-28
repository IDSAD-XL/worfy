// The screen of a Linked machine that shares its Projects read-only (worfy-link ticket 25,
// ADR-0066) on two built worfy: B gives A the level Read only in Settings → Machines; A's sidebar
// marks B "Read only" beside Online, and B's Project in A's window can be looked at and nothing on
// it changes — the write actions are inactive with "<B> gives this Machine read-only access", a
// Node does not move, the Terminal is not opened. Full access on B makes them active again.
//
// The look in both themes is kept as snapshots (test-results/e2e/snapshots/25-*/); with
// WORFY_EVIDENCE=1 also as the ticket's evidence `.scratch/worfy-link/evidence/25-*-{light,dark}.png`.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, chooseLevel, closeSettings, launchApp, linkThroughUi, machineIdOf, openMachinesSettings, PROJECTS_ACCESS_LABEL, repoRoot, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript, loginProfileWithNode } from '../harness-node'

test.setTimeout(180_000)

const ALPHA = 'alpha-0000000a'
const BETA = 'beta-0000000b'
const EPIC = 'demo'
const SIZE = { width: 1400, height: 900 }
const HINT = /^.+ gives this Machine read-only access$/

const EVIDENCE = join(repoRoot, '.scratch', 'worfy-link', 'evidence')

/** The light and dark snapshot of `window`; with WORFY_EVIDENCE=1 also the ticket's evidence `25-<name>-{light,dark}.png`. */
async function evidence(window: Page, name: string): Promise<void> {
  const shots = await snapshotThemes(window, `25-${name}`)
  if (process.env.WORFY_EVIDENCE !== '1') return
  await mkdir(EVIDENCE, { recursive: true })
  await copyFile(shots.light, join(EVIDENCE, `25-${name}-light.png`))
  await copyFile(shots.dark, join(EVIDENCE, `25-${name}-dark.png`))
}

function git(cwd: string, ...args: string[]): void {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv })
}

/** A data folder whose projects.json lists `projects`, the first one active. */
function dataFolder(path: string, projects: { id: string; name: string; path: string }[]): string {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'projects.json'), JSON.stringify({ projects, activeId: projects[0]?.id ?? null }))
  return path
}

/**
 * B: a committed repository `beta` with Epic `demo` (two open Tickets) and an epic-status in B's
 * Claude home that answers them; a Layout with a note and a Terminal Node.
 */
function prepareB(scratch: string) {
  const repo = join(scratch, 'beta')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  for (const num of [1, 2]) {
    writeFileSync(join(issues, `0${num}-ticket-${num}.md`), [`# 0${num} — Ticket ${num}`, '', 'Type: task', 'Status: open', 'Blocked by: —', ''].join('\n'))
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const claudeHome = join(scratch, 'b-claude')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: [1, 2].map((num) => ({
        epic: EPIC,
        num,
        slug: `ticket-${num}`,
        title: `0${num} — Ticket ${num}`,
        statusRaw: 'open',
        state: 'open',
        blockedRaw: '—',
        blockedNums: [],
        blockedParsed: true,
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  const dataDir = dataFolder(join(scratch, 'b-data'), [{ id: BETA, name: 'beta', path: realpathSync.native(repo) }])
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  mkdirSync(join(dataDir, BETA), { recursive: true })
  writeFileSync(
    join(dataDir, BETA, 'layout.json'),
    JSON.stringify({
      nodes: [
        { id: 'note-b', kind: 'note', x: 1300, y: 60, w: 220, h: 120, ...base, data: { text: 'A note of B' } },
        { id: 'term', kind: 'terminal', x: 1300, y: 260, w: 520, h: 300, ...base, data: {} },
      ],
      viewport: { x: 0, y: 0, zoom: 0.5 },
    }),
  )
  const home = join(scratch, 'b-home')
  mkdirSync(home, { recursive: true })
  // B's login shell is /bin/sh with this HOME: its .profile puts node on PATH, for the Node stubs.
  loginProfileWithNode(home)
  return { env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'orchestrator', SHELL: '/bin/sh', HOME: home } }
}

const group = (window: Page, machineId: string): Locator => window.locator(`[data-testid="machine-group"][data-machine-id="${machineId}"]`)

/** The flow position of a Node as React Flow draws it: its transform `translate(x, y)`. */
async function drawnAt(window: Page, nodeId: string): Promise<string> {
  return (await window.locator(`.react-flow__node[data-id="${nodeId}"]`).getAttribute('style'))?.match(/translate\([^)]*\)/)?.[0] ?? ''
}

/** Expects `action` to be inactive with the read-only hint as its tooltip. */
async function expectInactive(action: Locator): Promise<void> {
  await expect(action).toHaveAttribute('aria-disabled', 'true')
  await expect(action).toHaveAttribute('title', HINT)
}

test('Read only: A marks B in the sidebar, B\'s Canvas in A only shows — inactive actions, no drag, no Terminal; Full access makes them active again', async () => {
  const scratch = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-link-25-')))
  const alpha = join(scratch, 'alpha')
  mkdirSync(alpha, { recursive: true })
  git(alpha, 'init', '-q')
  const aData = dataFolder(join(scratch, 'a-data'), [{ id: ALPHA, name: 'alpha', path: realpathSync.native(alpha) }])
  const bSetup = prepareB(scratch)
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: bSetup.env })
    await canvasReady(b, { size: SIZE })
    await canvasReady(a, { size: SIZE })
    await linkThroughUi(a.window, b.window)
    const aId = await machineIdOf(a.window)
    const bId = await machineIdOf(b.window)

    // On B: access on, and A's level Read only.
    const settings = await openMachinesSettings(b)
    await settings.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true }).click()
    await chooseLevel(b.window, settings.getByTestId(`link-machine-access-${aId}`), 'read')
    await closeSettings(b.window)

    // A's sidebar: "Read only" beside Online, with the reason as its tooltip; B's Project is listed.
    const mark = group(a.window, bId).getByTestId('machine-read-only')
    await expect(mark).toHaveText('Read only', { timeout: 20_000 })
    await expect(mark).toHaveAttribute('title', HINT)
    await expect(group(a.window, bId).getByText('Online')).toBeVisible()
    const betaRow = group(a.window, bId).locator(`[data-testid="project-row"][data-project-id="${BETA}"]`)
    await expect(betaRow).toContainText('beta')
    await evidence(a.window, 'sidebar-read-only')

    // A opens beta of B: the window loads on B and shows B's Layout, read-only.
    await betaRow.getByRole('button').click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`))
    const canvas = a.window.getByTestId('canvas')
    await expect(canvas).toHaveAttribute('data-project-id', BETA)
    await expect(a.window.getByTestId('canvas-read-only')).toHaveText(HINT)
    const note = a.window.locator('[data-testid="note-node"][data-node-id="note-b"]')
    await expect(note).toContainText('A note of B')
    await expect(note.getByRole('textbox', { name: 'Note text' })).not.toBeEditable()
    // The Terminal is not opened on B: a stand-in says why, the Terminal itself is not there.
    const term = a.window.locator('.react-flow__node[data-id="term"]')
    await expect(term.getByTestId('terminal-node-read-only')).toContainText('gives this Machine read-only access')
    await expect(term.getByTestId('terminal-node')).toHaveCount(0)
    // The actions of the Epic frame and the sidebar's "New session": inactive, saying why.
    const frame = a.window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    for (const action of [frame.getByTestId('action-run-wave'), frame.getByTestId('action-autopilot'), a.window.getByTestId('sidebar-new-session')]) await expectInactive(action)
    // Playwright waits for an aria-disabled button to become enabled; the click is forced, as a person's would land.
    await a.window.getByTestId('sidebar-new-session').click({ force: true })
    await expect(a.window.locator('[data-testid="session-node"][data-live="true"]')).toHaveCount(0)

    // A drag of the note moves nothing, here or on B.
    await canvasReady(a, { visible: [note] })
    const before = await drawnAt(a.window, 'note-b')
    const header = note.locator('.w-note__header')
    const box = await header.boundingBox()
    if (box === null) throw new Error('the note has no header on screen')
    await a.window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await a.window.mouse.down()
    await a.window.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 90, { steps: 12 })
    await a.window.mouse.up()
    await canvasReady(a)
    expect(await drawnAt(a.window, 'note-b')).toBe(before)
    expect(await drawnAt(b.window, 'note-b')).toBe(before)
    await evidence(a.window, 'canvas-read-only')

    // Full access on B: A's window makes the actions active again.
    const again = await openMachinesSettings(b)
    await chooseLevel(b.window, again.getByTestId(`link-machine-access-${aId}`), 'all')
    await closeSettings(b.window)
    await expect(a.window.getByTestId('canvas-read-only')).toHaveCount(0, { timeout: 20_000 })
    await expect(a.window.getByTestId('sidebar-new-session')).not.toHaveAttribute('aria-disabled', 'true')
    await expect(note.getByRole('textbox', { name: 'Note text' })).toBeEditable()
    await expect(group(a.window, bId).getByTestId('machine-read-only')).toHaveCount(0)
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
