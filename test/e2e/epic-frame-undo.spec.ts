import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'
import { settled } from './wait'
import { catScript } from '../harness-node'

// ⌘Z and ⇧⌘Z over an Epic frame in the built app (worfy-week ticket 08): dragging a frame by its
// header and its collapse button are steps of the user's history, like any other gesture on the
// Canvas. The Project is a temporary git repository with one Epic; `bin/epic-status` in a temporary
// WORFY_CLAUDE_HOME answers with that Epic.

const PROJECT_ID = 'demo-0000008e'
const FRAME = 'epic:demo'

let scratch: string
let dataDir: string
let claudeHome: string

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/** What epic-status says about the Project: Epic demo with two open Tickets, 02 blocked by 01. */
const EPIC_STATUS = {
  ref: 'main',
  epics: [{ epic: 'demo', hasSpec: true, hasMap: false }],
  tickets: [
    { epic: 'demo', num: 1, slug: 't1', title: '01 — Ticket 1', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true },
    { epic: 'demo', num: 2, slug: 't2', title: '02 — Ticket 2', statusRaw: 'open', state: 'open', blockedRaw: '1', blockedNums: [1], blockedParsed: true },
  ],
}

/** A Note left of the frames' column, below the Orchestrator main places at (40, 40). */
const NOTE = { id: 'n1', kind: 'note', x: 40, y: 320, w: 220, h: 120, data: { text: 'move me' } }

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-epic-undo-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(answer, JSON.stringify(EPIC_STATUS))
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)

  const repo = join(scratch, 'demo')
  mkdirSync(join(repo, '.scratch', 'demo'), { recursive: true })
  writeFileSync(join(repo, '.scratch', 'demo', 'spec.md'), '# demo\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  // Zoom 1 at the origin: screen pixels are canvas units, and the Note and the frame are both on screen.
  writeFileSync(join(dataDir, PROJECT_ID, 'layout.json'), JSON.stringify({ nodes: [NOTE], viewport: { x: 0, y: 0, zoom: 1 } }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

interface StateNode {
  id: string
  kind: string
  x: number
  y: number
  data: Record<string, unknown>
}

/** The Layout's Nodes as main has them. */
async function layoutNodes(window: Page): Promise<StateNode[]> {
  const result = await window.evaluate(
    (id) =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: { layout: { nodes: StateNode[] } } }> } }).worfy.invoke(
        'layout.get',
        { projectId: id },
      ),
    PROJECT_ID,
  )
  expect(result.ok).toBe(true)
  return result.value.layout.nodes
}

const nodeIn = async (window: Page, id: string): Promise<StateNode | undefined> => (await layoutNodes(window)).find((node) => node.id === id)

/** The Node's place on the Canvas, from React Flow's transform (canvas units). */
async function flowPosition(window: Page, id: string): Promise<{ x: number; y: number }> {
  const transform = await window.getByTestId(`rf__node-${id}`).evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform)
  if (!match) throw new Error(`no translate in ${transform}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

/** Drags with the mouse from a point of `handle` by (dx, dy), in steps, as a hand does. */
async function dragBy(window: Page, handle: Locator, dx: number, dy: number): Promise<void> {
  const start = await box(handle)
  await window.mouse.move(start.x + 5, start.y + 5)
  await window.mouse.down()
  await window.mouse.move(start.x + 5 + dx / 2, start.y + 5 + dy / 2, { steps: 8 })
  await window.mouse.move(start.x + 5 + dx, start.y + 5 + dy, { steps: 8 })
  await window.mouse.up()
}

async function launch(): Promise<LaunchedApp> {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  await expect(launched.window.getByTestId('canvas')).toHaveAttribute('data-project-id', PROJECT_ID)
  return launched
}

test('⌘Z puts a frame dragged by its header back and leaves the step before it alone; ⇧⌘Z drags it again; ⌘Z after the collapse button opens the frame again', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const frame = window.locator(`[data-testid="epic-frame"][data-epic="demo"]`)
    const note = window.locator('[data-testid="note-node"][data-node-id="n1"] .w-note__header')
    await expect(frame).toBeVisible()
    await expect(note).toBeVisible()
    await expect(frame).toHaveAttribute('data-collapsed', 'false')

    // A step of the user before: the Note dragged 100 px down.
    await dragBy(window, note, 0, 100)
    await expect.poll(async () => (await nodeIn(window, 'n1'))?.y ?? 0).toBeGreaterThan(NOTE.y + 50)
    const noteMoved = (await nodeIn(window, 'n1'))!

    // The frame dragged by its header: main keeps its offset in the `epic-frame` Node.
    const before = await flowPosition(window, FRAME)
    await dragBy(window, frame.locator('.w-epic__drag .w-epic__tag'), 120, 80)
    await expect.poll(async () => (await nodeIn(window, FRAME))?.x ?? 0).toBeGreaterThan(60)
    const saved = (await nodeIn(window, FRAME))!
    expect(saved.y).toBeGreaterThan(40)
    const dropped = await flowPosition(window, FRAME)
    expect({ dx: Math.round(dropped.x - before.x), dy: Math.round(dropped.y - before.y) }).toEqual({ dx: saved.x, dy: saved.y })

    // ⌘Z: the frame is back where it stood before the drag; the Note stays where it was dragged.
    await window.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => flowPosition(window, FRAME)).toEqual(before)
    expect(await nodeIn(window, FRAME)).toMatchObject({ x: 0, y: 0 })
    // A wrong second undo would have been sent by now: the renderer has caught up with main.
    await settled(window)
    expect(await nodeIn(window, 'n1')).toMatchObject({ x: noteMoved.x, y: noteMoved.y })

    // ⇧⌘Z: the frame goes back to where it was dropped.
    await window.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(() => flowPosition(window, FRAME)).toEqual(dropped)
    expect(await nodeIn(window, FRAME)).toMatchObject({ x: saved.x, y: saved.y })

    // The collapse button, then ⌘Z: the frame is open again.
    await frame.getByRole('button', { name: 'Collapse epic demo' }).click()
    await expect(frame).toHaveAttribute('data-collapsed', 'true')
    await expect(window.getByTestId('ticket-node')).toHaveCount(0)
    await window.keyboard.press('ControlOrMeta+z')
    await expect(frame).toHaveAttribute('data-collapsed', 'false')
    await expect(window.getByTestId('ticket-node')).toHaveCount(2)
    // The Layout had no `collapsed` before the click: ⌘Z leaves the frame on the default.
    expect((await nodeIn(window, FRAME))?.data).toEqual({ collapsed: null })
    // And the step before the collapse is still the drag of the frame.
    await window.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => flowPosition(window, FRAME)).toEqual(before)
    expect(await nodeIn(window, 'n1')).toMatchObject({ x: noteMoved.x, y: noteMoved.y })
  } finally {
    await launched.close()
  }
})
