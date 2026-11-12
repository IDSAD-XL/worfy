import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, innerSize, launchApp, type LaunchedApp } from './helpers'
import { settled } from './wait'

// The menus of the kit in the built app (worfy-ui-kit ticket 11, ADR-0106), each a Menu of
// theme/kit/Menu.tsx:
// - Over the Canvas, on a Node that is dragged: «Choose a profile» of a Browser whose profile is gone
//   opens over the Canvas, on top of everything; a press on the Node's header with the menu open drags
//   the Node at once (the menu is modal={false}: no backdrop over the window) and closes the menu.
//   Esc closes only the menu, and the focus goes back to its button.
// - At the edge of the window, in an element with an Esc of its own: «Modes» stands in the composer at
//   the bottom of the Orchestrator's Session view. Its menu opens over the button and stays inside the
//   window. While the agent runs a turn, Esc in the menu closes the menu and the turn goes on (the
//   Session stays busy once the renderer has caught up with main); the next Esc in the input field
//   interrupts it (ADR-0106, the e2e scenario for Tickets 10 and 11). Every menu of this ticket takes
//   the focus in when it opens, so the case of a field that keeps the focus is held by
//   test/unit/kit-layer.test.tsx.
// - Over a window: none of the six menus of this ticket opens inside a dialog or Settings; a kit menu
//   in one takes the `dialogMenu` layer of the scale, which test/unit/kit-menu.test.tsx holds.
// The Projects are temporary folders; the agent is the fake one with
// test/fixtures/agent-scripts/session-view.jsonl, whose turn 2 holds until it is interrupted.

const PROJECT = 'layers-0000c11a'
const WINDOW = { width: 1400, height: 900 }

let scratch: string
let launched: LaunchedApp | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-layers-menu-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

const dataDir = (): string => join(scratch, 'data')

/** A Project whose Layout holds `nodes`, at zoom 1. */
function project(nodes: Record<string, unknown>[]): void {
  const repo = join(scratch, 'alpha')
  for (const dir of [join(scratch, 'home'), join(scratch, 'claude-home'), repo, join(dataDir(), PROJECT)]) mkdirSync(dir, { recursive: true })
  git(repo, 'init', '-q')
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  writeFileSync(join(dataDir(), 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir(), PROJECT, 'layout.json'), JSON.stringify({ nodes: nodes.map((node) => ({ ...base, ...node })), viewport: { x: 0, y: 0, zoom: 1 } }))
}

async function start(): Promise<Page> {
  launched = await launchApp({
    env: { WORFY_DATA_DIR: dataDir(), WORFY_CLAUDE_HOME: join(scratch, 'claude-home'), HOME: join(scratch, 'home'), WORFY_AGENT_SCRIPT: 'session-view' },
  })
  await canvasReady(launched, { size: WINDOW })
  return launched.window
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

/** Whether the element at the centre of `locator` is the locator's element or inside it: nothing covers it. */
const onTop = (locator: Locator): Promise<boolean> =>
  locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = element.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit !== null && element.contains(hit)
  })

/** Whether `locator` lies wholly inside the page. */
async function insideWindow(window: Page, locator: Locator): Promise<boolean> {
  const at = await box(locator)
  const page = await innerSize(window)
  return at.x >= 0 && at.y >= 0 && at.x + at.width <= page.width && at.y + at.height <= page.height
}

test('on the Canvas, on a Node that is dragged: the menu stands over the Canvas, the first drag moves the Node and closes the menu, Esc closes only the menu', async () => {
  // A Browser whose profile is gone shows «Choose a profile».
  project([{ id: 'b1', kind: 'browser', x: 300, y: 120, w: 360, h: 280, data: { profile: 'gone-000000' } }])
  const window = await start()
  const frame = window.locator('[data-testid="browser-frame"][data-node-id="b1"]')
  const node = window.locator('.react-flow__node', { has: frame })
  const button = frame.getByTestId('browser-choose-profile-button')
  await expect(button).toBeVisible()

  await button.click()
  const menu = window.getByRole('menu', { name: 'Browser profiles' })
  await expect(menu).toBeVisible()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByRole('menuitem')).toHaveText(['Default', 'Browser profiles…'])
  // Drawn into the page's body, out of the Node, under its button, on top of everything and inside the window.
  expect(await frame.evaluate((element, label) => element.querySelector(`[role="menu"][aria-label="${label}"]`) === null, 'Browser profiles')).toBe(true)
  const [menuBox, buttonBox] = [await box(menu), await box(button)]
  expect(menuBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height - 1)
  expect(await onTop(menu)).toBe(true)
  expect(await insideWindow(window, menu)).toBe(true)
  // The focus is on its first item; the arrows move.
  await expect(menu.getByRole('menuitem', { name: 'Default' })).toBeFocused()
  await window.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Browser profiles…' })).toBeFocused()
  // Esc closes the menu alone, back to its button; the Browser stays where it was.
  await window.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(button).toBeFocused()
  await expect(frame).toBeVisible()

  // With the menu open, the first drag of the Node's header moves the Node and closes the menu.
  await button.click()
  await expect(menu).toBeVisible()
  const before = await box(node)
  const title = await box(frame.locator('.w-browser-frame__title').first())
  const from = { x: title.x + title.width / 2, y: title.y + title.height / 2 }
  await window.mouse.move(from.x, from.y)
  await window.mouse.down()
  for (let step = 1; step <= 8; step += 1) await window.mouse.move(from.x + step * 10, from.y + step * 5)
  await window.mouse.up()
  await expect(menu).toHaveCount(0)
  await expect.poll(async () => Math.round((await box(node)).x - before.x), { message: 'the Node moved right with the drag' }).toBeGreaterThan(40)
})

test('at the bottom edge, in the composer, while the agent works: Modes opens over its button inside the window, Esc closes it and the turn goes on, the next Esc interrupts', async () => {
  project([])
  const window = await start()
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
  await node.locator('.w-orchestrator__header').dblclick()
  const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
  await expect(view.getByTestId('session-state')).toHaveText('idle')
  const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
  // Turn 1 answers at once; turn 2 holds until it is interrupted.
  await field.fill('first')
  await field.press('Enter')
  await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
  await field.fill('hold')
  await field.press('Enter')
  await expect(view.getByTestId('session-state')).toHaveText('busy')

  const modes = view.locator('.w-composer__bar').getByRole('button', { name: /^Modes/u })
  const menu = window.getByRole('menu', { name: 'Modes' })
  await modes.click()
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitemcheckbox', { name: /^Eco mode/u })).toBeFocused()
  // Over the button — the bar is at the bottom of the window —, on top and inside the window.
  const [menuBox, modesBox] = [await box(menu), await box(modes)]
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(modesBox.y + 1)
  expect(await onTop(menu)).toBe(true)
  expect(await insideWindow(window, menu)).toBe(true)

  // One press, one action: Esc closes the menu, the turn goes on.
  await window.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(modes).toBeFocused()
  await settled(window)
  await expect(view.getByTestId('session-state')).toHaveText('busy')
  // The next Esc, in the input field, interrupts the turn.
  await field.focus()
  await window.keyboard.press('Escape')
  await expect(view.getByTestId('session-state')).toHaveText('idle')
})
