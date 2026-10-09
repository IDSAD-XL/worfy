// Linked machines on two built worfy (worfy-link ticket 02; ADR-0052, points 4, 6 and 9): linking
// through "Link a machine" by the address 127.0.0.1:<port> and the code read from the other window,
// a wrong code, revoking from either side, and the access switch across a restart. Each worfy has
// its own data folder and so its own Machine; Bonjour is off and the link server listens on loopback
// only (launchApp). worfy-link ticket 09 adds its tests to this file.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, chooseByAddress, launchApp, launchLinkedPair, linkThroughUi, machineIdOf, openLinkDialog, repoRoot, shownCode, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

test.setTimeout(120_000)

const row = (window: Page, machineId: string) => window.locator(`[data-testid="machine-row"][data-machine-id="${machineId}"]`)

/** Revokes `machineId` from its row's context menu in `window`. */
async function revoke(window: Page, machineId: string): Promise<void> {
  await row(window, machineId).click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Revoke' }).click()
}

test('two worfy link by address and code, and each lists the other as online', async () => {
  const a = await launchApp()
  let b: LaunchedApp | undefined
  try {
    b = await launchApp()
    // A fresh Machine: no Linked machine, only the button and the switch.
    await expect(a.window.getByTestId('machines-section')).toBeVisible()
    await expect(a.window.getByTestId('machine-row')).toHaveCount(0)
    await expect(a.window.getByTestId('link-machine-button')).toHaveText('Link a machine…')

    await openLinkDialog(a.window)
    await openLinkDialog(b.window)
    const code = await shownCode(b.window)
    await snapshotThemes(b.window, 'link-a-machine-code')

    // An address typed wrong shows its error under the field.
    await a.window.getByTestId('link-address-input').fill('127.0.0.1')
    await a.window.getByRole('button', { name: 'Next' }).click()
    await expect(a.window.getByTestId('link-address-error')).toHaveText('Add the port: host:port')

    await chooseByAddress(a.window, b.window)
    await snapshotThemes(a.window, 'link-a-machine-code-field')
    await a.window.getByTestId('link-code-input').fill(code)
    await a.window.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(a.window.getByTestId('link-success')).toBeVisible()
    await expect(b.window.getByTestId('link-success')).toBeVisible()
    const [aId, bId] = [await machineIdOf(a.window), await machineIdOf(b.window)]
    await expect(b.window.getByTestId('link-success')).toContainText(await nameOf(a.window))

    for (const window of [a.window, b.window]) await window.getByTestId('link-machine-dialog').getByRole('button', { name: 'Done' }).click()
    await expect(row(a.window, bId)).toHaveAttribute('data-state', 'online')
    await expect(row(b.window, aId)).toHaveAttribute('data-state', 'online')
    await expect(row(a.window, bId)).toContainText('Online')
    // A development build's "(dev)" stays visible, left of the chip, however long the name is.
    const suffix = row(a.window, bId).getByTestId('machine-name-suffix')
    await expect(suffix).toHaveText('(dev)')
    const suffixBox = await suffix.boundingBox()
    const chipBox = await row(a.window, bId).getByText('Online').boundingBox()
    expect(suffixBox).not.toBeNull()
    expect(chipBox).not.toBeNull()
    if (suffixBox && chipBox) expect(suffixBox.x + suffixBox.width).toBeLessThanOrEqual(chipBox.x)
    await snapshotThemes(a.window, 'machines-section')
  } finally {
    await a.close()
    await b?.close()
  }
})

test('a wrong code: a message on A, a new code on B, nothing linked', async () => {
  const a = await launchApp()
  let b: LaunchedApp | undefined
  try {
    b = await launchApp()
    await openLinkDialog(a.window)
    await openLinkDialog(b.window)
    await chooseByAddress(a.window, b.window)
    const code = await shownCode(b.window)
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0')
    await a.window.getByTestId('link-code-input').fill(wrong)
    await a.window.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(a.window.getByTestId('link-error')).toContainText('the code did not match')
    // The code is one-time: B shows a new one.
    await expect(b.window.getByTestId('link-code')).not.toHaveText(code)
    await expect(b.window.getByTestId('link-failure')).toBeVisible()
    await expect(a.window.getByTestId('machine-row')).toHaveCount(0)
    await expect(b.window.getByTestId('machine-row')).toHaveCount(0)

    // The new code links.
    await a.window.getByTestId('link-code-input').fill(await shownCode(b.window))
    await a.window.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(a.window.getByTestId('link-success')).toBeVisible()
    await expect(b.window.getByTestId('link-success')).toBeVisible()
  } finally {
    await a.close()
    await b?.close()
  }
})

test('revoking from A, then from B: the row goes on both within 5 s, and linking again by code works', async () => {
  const pair = await launchLinkedPair()
  try {
    const { a, b, aId, bId } = pair
    await revoke(a.window, bId)
    await expect(row(a.window, bId)).toHaveCount(0, { timeout: 5_000 })
    await expect(row(b.window, aId)).toHaveCount(0, { timeout: 5_000 })

    await linkThroughUi(a.window, b.window)
    await revoke(b.window, aId)
    await expect(row(b.window, aId)).toHaveCount(0, { timeout: 5_000 })
    await expect(row(a.window, bId)).toHaveCount(0, { timeout: 5_000 })

    await linkThroughUi(a.window, b.window)
  } finally {
    await pair.close()
  }
})

test('the access switch is off on a fresh Machine and stays on across a restart over the same data folder', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'worfy-link-access-'))
  try {
    const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      const toggle = first.window.getByRole('switch', { name: 'Linked machines can work with my Projects' })
      await machineIdOf(first.window)
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
    } finally {
      await first.close()
    }
    const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      await machineIdOf(second.window)
      await expect(second.window.getByRole('switch', { name: 'Linked machines can work with my Projects' })).toHaveAttribute('aria-checked', 'true')
    } finally {
      await second.close()
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

// ── Projects of Linked machines in the sidebar and on the Canvas (worfy-link ticket 09) ─────────

/** Where the snapshots of ticket 09 are kept in the repository (rules: .scratch/<epic>/evidence/NN-what.png). */
const EVIDENCE = join(repoRoot, '.scratch', 'worfy-link', 'evidence')

/**
 * Takes the light and dark snapshot of `window` (test-results/snapshots/09-<name>/). With
 * WORFY_EVIDENCE=1 both are also kept as the ticket's evidence `09-<name>-{light,dark}.png`; an
 * ordinary run (gate full) leaves the repository's files alone.
 */
async function evidence(window: Page, name: string): Promise<void> {
  const shots = await snapshotThemes(window, `09-${name}`)
  if (process.env.WORFY_EVIDENCE !== '1') return
  await mkdir(EVIDENCE, { recursive: true })
  await copyFile(shots.light, join(EVIDENCE, `09-${name}-light.png`))
  await copyFile(shots.dark, join(EVIDENCE, `09-${name}-dark.png`))
}

const group = (window: Page, machineId: string) => window.locator(`[data-testid="machine-group"][data-machine-id="${machineId}"]`)
const projectRow = (window: Page, machineId: string, projectId: string) =>
  group(window, machineId).locator(`[data-testid="project-row"][data-project-id="${projectId}"]`)

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

/** Calls a channel of the window's own main through the preload, the way the renderer does. */
async function call<T>(window: Page, channel: string, input?: unknown): Promise<T> {
  const result = await window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)
  if (!result.ok) throw new Error(`${channel}: ${result.error ?? 'failed'}`)
  return result.value as T
}

/** Sets "Linked machines can work with my Projects" on the worfy of `window`. */
async function setSharing(window: Page, on: boolean): Promise<void> {
  const toggle = window.getByRole('switch', { name: 'Linked machines can work with my Projects' })
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(on))
}

/** A folder with a git repository on branch main, for a Project. */
function gitRepo(path: string): string {
  mkdirSync(path, { recursive: true })
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: path, env: gitEnv })
  return realpathSync(path)
}

/** A data folder whose projects.json lists `projects`, the first one active. */
function dataFolder(path: string, projects: { id: string; name: string; path: string }[]): string {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'projects.json'), JSON.stringify({ projects, activeId: projects[0]?.id ?? null }))
  return path
}

test('the sidebar of A lists the Projects of B under B, with its state; not shared — none and a line; B closed — unavailable', async () => {
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), 'worfy-link-09-sidebar-')))
  const ownRepo = gitRepo(join(scratch, 'alpha-repo'))
  const bRepo = gitRepo(join(scratch, 'beta-repo'))
  const aData = dataFolder(join(scratch, 'a-data'), [{ id: 'alpha-repo-0000000a', name: 'alpha-repo', path: ownRepo }])
  const bData = dataFolder(join(scratch, 'b-data'), [{ id: 'beta-repo-0000000b', name: 'beta-repo', path: bRepo }])
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: { WORFY_DATA_DIR: bData } })
    await linkThroughUi(a.window, b.window)
    const bId = await machineIdOf(b.window)
    await setSharing(b.window, true)

    // This Machine first, then B, online, with its Project.
    await expect(a.window.getByTestId('machine-group')).toHaveCount(2)
    await expect(a.window.getByTestId('machine-group').first()).toHaveAttribute('data-state', 'this')
    await expect(group(a.window, bId)).toHaveAttribute('data-state', 'online')
    await expect(group(a.window, bId)).toContainText('Online')
    await expect(projectRow(a.window, bId, 'beta-repo-0000000b')).toContainText('beta-repo')
    await expect(projectRow(a.window, bId, 'beta-repo-0000000b')).toContainText('main')
    await evidence(a.window, 'sidebar-online')

    // B stops sharing: its group stays, without Projects, with a line that says so.
    await setSharing(b.window, false)
    await expect(group(a.window, bId)).toHaveAttribute('data-sharing', 'no')
    await expect(group(a.window, bId).getByTestId('machine-not-sharing')).toHaveText(/ doesn't share its Projects$/)
    await expect(group(a.window, bId).getByTestId('project-row')).toHaveCount(0)
    await evidence(a.window, 'sidebar-not-shared')

    // Shared again: the Projects come back without a restart.
    await setSharing(b.window, true)
    await expect(projectRow(a.window, bId, 'beta-repo-0000000b')).toBeVisible()

    // B closed: unavailable.
    await b.close()
    b = undefined
    await expect(group(a.window, bId)).toHaveAttribute('data-state', 'unavailable', { timeout: 20_000 })
    await expect(group(a.window, bId)).toContainText('Unavailable')
    await expect(group(a.window, bId).getByTestId('project-row')).toHaveCount(0)
    await evidence(a.window, 'sidebar-unavailable')
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const BETA = 'beta-0000000b'
const SHARED = 'shared-0000005c'
const EPIC = 'demo'
const SIZE = { width: 1400, height: 900 }

function git(cwd: string, ...args: string[]): void {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv })
}

/**
 * B of the Canvas tests: a committed repository `beta` with Epic `demo` (two open Tickets) and an
 * epic-status in B's Claude home that answers them; a Layout with a note and a Terminal Node; and
 * `shared`, one folder that A lists too.
 */
function prepareB(scratch: string, shared: string) {
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
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), `#!/bin/sh\ncat '${answer}'\n`)
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  const dataDir = dataFolder(join(scratch, 'b-data'), [
    { id: BETA, name: 'beta', path: realpathSync(repo) },
    { id: SHARED, name: 'shared', path: shared },
  ])
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
  return {
    dataDir,
    env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'orchestrator', SHELL: '/bin/sh', HOME: home },
  }
}

/** Replaces Electron's powerSaveBlocker in main, so an Autopilot run never keeps the Mac awake. */
async function stubPower(app: LaunchedApp['app']): Promise<void> {
  await app.evaluate(({ powerSaveBlocker }) => {
    let next = 100
    const started = new Set<number>()
    powerSaveBlocker.start = () => {
      next += 1
      started.add(next)
      return next
    }
    powerSaveBlocker.stop = (id) => started.delete(id)
    powerSaveBlocker.isStarted = (id) => started.has(id)
  })
}

/** The flow position of a Node as React Flow draws it: its transform `translate(x, y)`. */
async function drawnAt(window: Page, nodeId: string): Promise<string> {
  return (await window.locator(`.react-flow__node[data-id="${nodeId}"]`).getAttribute('style'))?.match(/translate\([^)]*\)/)?.[0] ?? ''
}

/** Drags `from` by (dx, dy) with the mouse, once the Canvas is at rest. */
async function drag(launched: LaunchedApp, from: Locator, dx: number, dy: number): Promise<void> {
  await canvasReady(launched, { visible: [from] })
  const box = await from.boundingBox()
  if (box === null) throw new Error('nothing to drag')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await launched.window.mouse.move(start.x, start.y)
  await launched.window.mouse.down()
  await launched.window.mouse.move(start.x + dx, start.y + dy, { steps: 12 })
  await launched.window.mouse.up()
}

const screenText = async (node: Locator): Promise<string> => (await node.locator('.xterm-rows').innerText()).replace(/\u00a0/g, ' ')

test('A opens a Project of B: its Canvas, Node moves, Session, Terminal and Autopilot go to B; B gone — "unreachable", B back — the Canvas again', async () => {
  test.setTimeout(240_000)
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), 'worfy-link-09-canvas-')))
  const shared = gitRepo(join(scratch, 'shared'))
  const own = gitRepo(join(scratch, 'alpha'))
  const aData = dataFolder(join(scratch, 'a-data'), [{ id: 'alpha-0000000a', name: 'alpha', path: own }])
  const bSetup = prepareB(scratch, shared)
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: bSetup.env })
    const bWindow = b.window
    await stubPower(b.app)
    await canvasReady(b, { size: SIZE })
    await canvasReady(a, { size: SIZE })
    await linkThroughUi(a.window, bWindow)
    const bId = await machineIdOf(bWindow)
    await setSharing(bWindow, true)

    // A opens beta of B: the window loads again, on B, and shows B's Layout.
    await projectRow(a.window, bId, BETA).getByRole('button').click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`))
    await expect(a.window.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)
    const noteInA = a.window.locator('[data-testid="note-node"][data-node-id="note-b"]')
    await expect(noteInA).toContainText('A note of B')
    // The toolbar names the Machine next to the Project; the row of beta is the one selected.
    await expect(a.window.locator('.w-toolbar__name')).toContainText('beta · ')
    await expect(projectRow(a.window, bId, BETA).getByRole('button')).toHaveAttribute('aria-current', 'true')
    // B's own screen keeps its own active Project.
    await expect(bWindow.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)
    await canvasReady(a)
    await evidence(a.window, 'canvas-of-b')

    // Autopilot started and stopped from A: B runs it, both windows show it. First, while every
    // camera is still where the Layout opens it, so the Epic frame is in view.
    const frame = (window: Page) => window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    await frame(a.window).getByTestId('action-autopilot').click()
    for (const window of [a.window, bWindow]) await expect(frame(window).getByTestId('autopilot-status')).toHaveText('Wave 1 · running', { timeout: 20_000 })
    await frame(a.window).getByTestId('action-autopilot-more').click()
    await a.window.getByTestId('action-force-stop-autopilot').click()
    for (const window of [a.window, bWindow]) await expect(frame(window).getByTestId('autopilot-status')).toHaveText('stopped: user force stop', { timeout: 20_000 })

    // A Node moved in A is in the same place in B's window within a second.
    const before = await drawnAt(bWindow, 'note-b')
    await drag(a, noteInA.locator('.w-note__header'), 160, 90)
    await expect.poll(() => drawnAt(a.window, 'note-b')).not.toBe(before)
    const moved = await drawnAt(a.window, 'note-b')
    await expect.poll(() => drawnAt(bWindow, 'note-b'), { timeout: 1_000 }).toBe(moved)

    // A Session started in A runs on B and is live in B's window.
    const live = (window: Page) => window.locator('[data-testid="session-node"][data-live="true"]')
    await a.window.getByTestId('sidebar-new-session').click()
    await expect(live(a.window)).toHaveCount(1)
    const sessionNode = await live(a.window).getAttribute('data-node-id')
    await expect(bWindow.locator(`[data-testid="session-node"][data-live="true"][data-node-id="${sessionNode}"]`)).toHaveCount(1)
    await expect(bWindow.locator(`[data-testid="session-node"][data-live="true"][data-node-id="${sessionNode}"]`).getByTestId('session-node-status')).toHaveText('idle')

    // What A types into the Terminal runs in B's shell, and its output is in B's window.
    const termA = a.window.locator('.react-flow__node[data-id="term"]').getByTestId('terminal-node')
    const termB = bWindow.locator('.react-flow__node[data-id="term"]').getByTestId('terminal-node')
    await expect(termA).toHaveAttribute('data-state', 'running', { timeout: 15_000 })
    await termA.getByTestId('terminal-screen').click()
    await a.window.keyboard.type('echo from""-a-$((6*7))')
    await a.window.keyboard.press('Enter')
    await expect.poll(() => screenText(termB), { timeout: 10_000 }).toMatch(/^from-a-42$/m)

    // B quits while A shows its Project: a line over the Canvas, the window stays.
    await b.close()
    b = undefined
    await expect(a.window.getByTestId('linked-machine-notice')).toHaveText(/ is unreachable$/, { timeout: 20_000 })
    await expect(a.window.getByTestId('canvas')).toBeVisible()
    await evidence(a.window, 'canvas-unreachable')

    // B starts again over the same data folder: A loads again and shows B's Layout.
    b = await launchApp({ env: bSetup.env })
    await expect(a.window.getByTestId('linked-machine-notice')).toHaveCount(0, { timeout: 60_000 })
    await expect(a.window.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)
    // B's Layout again, with the Session Node A made and the Node where A left it. The camera is the
    // one this window saved for B's Project (worfy-link ticket 09), so a Node may lie off screen:
    // its place is read from B's Layout.
    await expect(a.window.locator(`[data-testid="session-node"][data-node-id="${sessionNode}"]`)).toBeVisible()
    const layoutOfB = await call<{ ok: boolean; value: { layout: { nodes: { id: string; x: number; y: number }[] } } }>(a.window, 'linked.invoke', {
      machine: bId,
      channel: 'layout.get',
      input: { projectId: BETA },
    })
    const note = layoutOfB.value.layout.nodes.find((node) => node.id === 'note-b')
    const [movedX, movedY] = (moved.match(/-?[\d.]+/g) ?? []).map(Number)
    expect(note).toBeDefined()
    expect(Math.abs((note?.x ?? NaN) - (movedX ?? NaN))).toBeLessThan(1)
    expect(Math.abs((note?.y ?? NaN) - (movedY ?? NaN))).toBeLessThan(1)
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('one folder in A and in B is two Projects: moving a Node in B\'s does not move A\'s; B keeps its active Project and opens the Orchestrator', async () => {
  test.setTimeout(180_000)
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), 'worfy-link-09-shared-')))
  const shared = gitRepo(join(scratch, 'shared'))
  const aData = dataFolder(join(scratch, 'a-data'), [{ id: SHARED, name: 'shared', path: shared }])
  const bSetup = prepareB(scratch, shared)
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  // The same Node id in both Layouts of the folder, at the same place.
  for (const dataDir of [aData, bSetup.dataDir]) {
    mkdirSync(join(dataDir, SHARED), { recursive: true })
    writeFileSync(
      join(dataDir, SHARED, 'layout.json'),
      JSON.stringify({ nodes: [{ id: 'note-s', kind: 'note', x: 700, y: 80, w: 220, h: 120, ...base, data: { text: 'shared note' } }], viewport: { x: 0, y: 0, zoom: 0.8 } }),
    )
  }
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: bSetup.env })
    await canvasReady(a, { size: SIZE })
    await linkThroughUi(a.window, b.window)
    const bId = await machineIdOf(b.window)
    await setSharing(b.window, true)
    const activeOfB = (): string | null => (JSON.parse(readFileSync(join(bSetup.dataDir, 'projects.json'), 'utf8')) as { activeId: string | null }).activeId

    // Two rows with one id, one per Machine.
    await expect(a.window.locator(`[data-testid="project-row"][data-project-id="${SHARED}"]`)).toHaveCount(2)
    await expect(projectRow(a.window, bId, SHARED)).toBeVisible()
    const ownLayout = await call<{ layout: { nodes: { id: string; x: number; y: number }[] } }>(a.window, 'layout.get', { projectId: SHARED })

    await projectRow(a.window, bId, SHARED).getByRole('button').click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`))
    const note = a.window.locator('[data-testid="note-node"][data-node-id="note-s"]')
    await expect(note).toBeVisible()
    await drag(a, note.locator('.w-note__header'), 200, 120)
    const layoutOfB = () => call<{ ok: boolean; value: { layout: { nodes: { id: string; kind: string; x: number; y: number }[] } } }>(a.window, 'linked.invoke', { machine: bId, channel: 'layout.get', input: { projectId: SHARED } })
    await expect.poll(async () => (await layoutOfB()).value.layout.nodes.find((node) => node.id === 'note-s')?.x).toBeGreaterThan(750)
    // A's own Project of the same folder: not moved.
    const ownAfter = await call<{ layout: { nodes: { id: string; x: number; y: number }[] } }>(a.window, 'layout.get', { projectId: SHARED })
    expect(ownAfter.layout.nodes.find((node) => node.id === 'note-s')).toMatchObject({ x: ownLayout.layout.nodes.find((node) => node.id === 'note-s')?.x, y: 80 })
    // B's active Project is still its own choice, and B opened the Orchestrator of the one A shows.
    expect(activeOfB()).toBe(BETA)
    await expect.poll(async () => (await layoutOfB()).value.layout.nodes.filter((node) => node.kind === 'orchestrator').length, { timeout: 15_000 }).toBe(1)
    const opened = await call<{ ok: boolean; value: { sessionId: string | null } | null }>(a.window, 'linked.invoke', { machine: bId, channel: 'orchestrator.view', input: { nodeId: (await layoutOfB()).value.layout.nodes.find((node) => node.kind === 'orchestrator')?.id ?? '' } })
    expect(opened.ok).toBe(true)
    expect(activeOfB()).toBe(BETA)
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

/** The Machine name of the worfy whose window this is. */
async function nameOf(window: Page): Promise<string> {
  const result = await window.evaluate(() =>
    (globalThis as unknown as { worfy: { invoke(channel: string): Promise<{ ok: boolean; value?: { machine: { name: string } | null } }> } }).worfy.invoke('link.state'),
  )
  const name = result.value?.machine?.name
  if (name === undefined) throw new Error('no Machine name')
  return name
}
