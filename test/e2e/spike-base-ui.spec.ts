import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, repoRoot, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'
import { printJoined } from './terminal-shell'
import { windowsProfileEnv } from '../windows-profile'
import { ms } from '../time-scale'

// Spike worfy-ui-kit 01 — a throwaway branch, never merged. Base UI probes (src/renderer/spike/)
// over the real app: over the Canvas, in a Node that is dragged, next to a Terminal and a Browser
// <webview>, in focus mode and over Settings; the app's own Select inside a modal Base UI Dialog in
// the three ways of the spec. Each answer is printed as a `[spike] <question>: <json>` line for the
// note .scratch/worfy-ui-kit/spike-base-ui.md; the expected answers are soft checks, so one run
// answers every question even when some answers are "no".

const PROJECT = 'spike-0000000a'
const WINDOW = { width: 1400, height: 900 }
const FIXTURES = join(repoRoot, 'test', 'fixtures', 'browser')

let server: Server
let pageUrl: string
let scratch: string
let launched: LaunchedApp | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

function say(question: string, answer: unknown): void {
  const line = `[spike] ${question}: ${JSON.stringify(answer)}`
  console.log(line)
  test.info().annotations.push({ type: 'spike', description: line })
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url !== '/page.html') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(join(FIXTURES, 'page.html')))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/page.html`
})

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-spike-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

/** The app over a Project with a note, a Terminal and a Browser, the probes switched on. */
async function start(): Promise<{ window: Page; app: LaunchedApp['app'] }> {
  const dataDir = join(scratch, 'data')
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  mkdirSync(home)
  mkdirSync(repo)
  git(repo, 'init', '-q')
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  const nodes = [
    { id: 'n1', kind: 'note', x: 40, y: 60, w: 240, h: 140, ...base, data: { text: 'drag me' } },
    { id: 'term', kind: 'terminal', x: 340, y: 60, w: 480, h: 260, ...base, data: {} },
    { id: 'b1', kind: 'browser', x: 40, y: 400, w: 560, h: 340, ...base, data: { url: pageUrl } },
  ]
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 0, y: 0, zoom: 1 } }))
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, HOME: home, SHELL: '/bin/sh', ...windowsProfileEnv(join(scratch, 'profile')) } })
  const { window, app } = launched
  await canvasReady(launched, { size: WINDOW, visible: [window.locator('.react-flow__node[data-id="n1"]')] })
  await window.evaluate(() => (globalThis as unknown as { __worfySpike: { enable(): void } }).__worfySpike.enable())
  await expect(window.getByTestId('spike-toolbar')).toBeVisible()
  return { window, app }
}

interface SpikeLog {
  log: { probe: string; open: boolean; reason: string; defaultPrevented?: boolean }[]
  escapes: { defaultPrevented: boolean; target: string }[]
}

const spikeLog = (window: Page): Promise<SpikeLog> =>
  window.evaluate(() => {
    const spike = (globalThis as unknown as { __worfySpike: SpikeLog }).__worfySpike
    return JSON.parse(JSON.stringify({ log: spike.log, escapes: spike.escapes })) as SpikeLog
  })

const active = (window: Page): Promise<string> => window.evaluate(() => (globalThis as unknown as { __worfySpike: { active(): string } }).__worfySpike.active())

/** Whether the element at the centre of `locator` is the locator's element or inside it: nothing covers it. */
async function onTop(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const doc = element.ownerDocument
    const hit = doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit !== null && element.contains(hit)
  })
}

/** Why the element is hidden from assistive tech (aria-hidden or inert on it or an ancestor), or null. */
const hiddenFromAt = (locator: Locator): Promise<string | null> =>
  locator.evaluate((element) => {
    interface El {
      getAttribute(name: string): string | null
      hasAttribute(name: string): boolean
      parentElement: El | null
      tagName: string
      className: string
    }
    for (let node = element as unknown as El | null; node !== null; node = node.parentElement) {
      if (node.getAttribute('aria-hidden') === 'true') return `aria-hidden on ${node.tagName}.${node.className}`
      if (node.hasAttribute('inert')) return `inert on ${node.tagName}.${node.className}`
    }
    return null
  })

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox()
  if (!found) throw new Error('the element has no box')
  return found
}

const settle = (window: Page, millis = 300): Promise<void> => window.waitForTimeout(ms(millis))

test('Dialog, Popover, Menu and Tooltip over the Canvas: on top, keys, Esc and the focus coming back', async () => {
  const { window } = await start()

  // Popover.
  const popTrigger = window.getByTestId('spike-popover-trigger')
  await popTrigger.click()
  const pop = window.getByTestId('spike-popover-popup')
  await expect(pop).toBeVisible()
  const popOnTop = await onTop(pop)
  await window.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  const popFocus = await active(window)
  say('canvas popover', { onTop: popOnTop, focusAfterEsc: popFocus })
  expect.soft(popOnTop).toBe(true)
  expect.soft(popFocus).toBe('spike-popover-trigger')

  // Menu: arrows and Esc.
  await window.getByTestId('spike-menu-trigger').click()
  const menu = window.getByRole('menu')
  await expect(menu).toBeVisible()
  await window.keyboard.press('ArrowDown')
  const highlighted = await menu.locator('[data-highlighted]').textContent()
  const menuOnTop = await onTop(menu)
  await window.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  const menuFocus = await active(window)
  say('canvas menu', { onTop: menuOnTop, highlightedAfterArrowDown: highlighted, focusAfterEsc: menuFocus })
  expect.soft(menuOnTop).toBe(true)
  expect.soft(menuFocus).toBe('spike-menu-trigger')

  // Tooltip on hover.
  await window.getByTestId('spike-tooltip-trigger').hover()
  const tip = window.getByTestId('spike-tooltip-popup')
  await expect(tip).toBeVisible({ timeout: ms(3_000) })
  say('canvas tooltip', { shown: true, role: await window.getByRole('tooltip').count() })

  // Dialog: Tab stays inside, Esc closes, the focus comes back.
  await window.mouse.move(5, 5)
  await window.getByTestId('spike-dialog-body-trigger').click()
  const dialog = window.getByTestId('spike-dialog-body-popup')
  await expect(dialog).toBeVisible()
  const dialogOnTop = await onTop(dialog)
  const outside: string[] = []
  for (let n = 0; n < 8; n += 1) {
    await window.keyboard.press('Tab')
    const inside = await dialog.evaluate((element) => element.contains(element.ownerDocument.activeElement))
    if (!inside) outside.push(await active(window))
  }
  const role = await dialog.getAttribute('role')
  await window.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  const dialogFocus = await active(window)
  say('canvas dialog', { onTop: dialogOnTop, role, tabLeftDialog: outside, focusAfterEsc: dialogFocus })
  expect.soft(outside).toEqual([])
  expect.soft(dialogFocus).toBe('spike-dialog-body-trigger')
})

test('a menu on a Node does not stop the Node from being dragged', async () => {
  const { window } = await start()
  const node = window.locator('.react-flow__node[data-id="n1"]')
  const header = node.locator('.w-note__header')

  const results: Record<string, unknown> = {}
  for (const variant of ['menu', 'menu-nm'] as const) {
    const id = `spike-canvas-n1-${variant}`
    await window.getByTestId(`${id}-trigger`).click()
    const popup = window.getByTestId(`${id}-popup`)
    await expect(popup).toBeVisible()
    const before = await box(node)
    const from = await box(header)
    await window.mouse.move(from.x + 40, from.y + from.height / 2)
    await window.mouse.down()
    await window.mouse.move(from.x + 140, from.y + 60, { steps: 12 })
    await window.mouse.up()
    await settle(window)
    const after = await box(node)
    const moved = { dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y) }
    const stillOpen = (await popup.count()) > 0
    // A second drag with the menu closed, to tell "the first press only closed the menu" apart.
    let secondDrag: { dx: number; dy: number } | null = null
    if (moved.dx === 0 && moved.dy === 0) {
      if (stillOpen) await window.keyboard.press('Escape')
      const start2 = await box(node)
      const from2 = await box(header)
      await window.mouse.move(from2.x + 40, from2.y + from2.height / 2)
      await window.mouse.down()
      await window.mouse.move(from2.x + 140, from2.y + 60, { steps: 12 })
      await window.mouse.up()
      await settle(window)
      const end2 = await box(node)
      secondDrag = { dx: Math.round(end2.x - start2.x), dy: Math.round(end2.y - start2.y) }
    }
    results[variant] = { firstDragWithMenuOpen: moved, menuOpenAfterDrag: stillOpen, secondDrag }
    if ((await popup.count()) > 0) await window.keyboard.press('Escape')
  }

  // Base UI #6150: a press on the trigger itself (no nodrag) that turns into a drag.
  const grip = window.getByTestId('spike-canvas-n1-grip-trigger')
  const before = await box(node)
  const g = await box(grip)
  await window.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await window.mouse.down()
  const openOnPress = (await window.getByTestId('spike-canvas-n1-grip-popup').count()) > 0
  await window.mouse.move(g.x + 120, g.y + 80, { steps: 12 })
  await window.mouse.up()
  await settle(window)
  const after = await box(node)
  results.gripDrag = {
    menuOpenOnPress: openOnPress,
    nodeMoved: { dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y) },
    menuOpenAfterDrop: (await window.getByTestId('spike-canvas-n1-grip-popup').count()) > 0,
  }
  say('node drag with menu', results)
  const modal = results.menu as { firstDragWithMenuOpen: { dx: number }; secondDrag: { dx: number } | null }
  const nonModal = results['menu-nm'] as { firstDragWithMenuOpen: { dx: number } }
  expect.soft(nonModal.firstDragWithMenuOpen.dx, 'a non-modal menu: the drag moves the Node at once').toBeGreaterThan(50)
  expect.soft(Math.max(modal.firstDragWithMenuOpen.dx, modal.secondDrag?.dx ?? 0), 'a modal menu: the Node moves, at the latest on the next drag').toBeGreaterThan(50)
})

test('next to a Terminal: the focus stays near xterm when a popup closes, a tooltip takes no focus', async () => {
  const { window } = await start()
  const terminal = window.locator('.react-flow__node[data-id="term"]').getByTestId('terminal-node')
  await expect(terminal).toHaveAttribute('data-state', 'running', { timeout: ms(15_000) })
  await terminal.getByTestId('terminal-screen').click()
  const inXterm = await active(window)

  // A tooltip over the Terminal's header leaves the focus in xterm.
  await window.getByTestId('spike-canvas-term-tip-trigger').hover()
  await expect(window.getByTestId('spike-canvas-term-tip-popup')).toBeVisible({ timeout: ms(3_000) })
  const afterTooltip = await active(window)

  // A popover opened and closed with Esc: where is the focus?
  await window.getByTestId('spike-canvas-term-popover-trigger').click()
  const pop = window.getByTestId('spike-canvas-term-popover-popup')
  await expect(pop).toBeVisible()
  const inPopup = await active(window)
  await window.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  const afterEsc = await active(window)

  // A popover closed by a press into the terminal screen: the press reaches xterm.
  await window.getByTestId('spike-canvas-term-popover-trigger').click()
  await expect(pop).toBeVisible()
  await terminal.getByTestId('terminal-screen').click()
  await settle(window)
  const closedByPress = (await pop.count()) === 0
  const afterPress = await active(window)
  await window.keyboard.type(printJoined('spike', '-typed'))
  await window.keyboard.press('Enter')
  let typed = true
  try {
    await expect(terminal.getByTestId('terminal-screen')).toContainText('spike-typed', { timeout: ms(5_000) })
  } catch {
    typed = false
  }
  say('terminal focus', { inXterm, afterTooltip, inPopup, afterEsc, closedByPress, afterPress, typingReachesShell: typed })
  expect.soft(afterTooltip).toBe(inXterm)
  expect.soft(afterEsc).toBe('spike-canvas-term-popover-trigger')
  expect.soft(closedByPress).toBe(true)
  expect.soft(afterPress).toBe(inXterm)
  expect.soft(typed).toBe(true)
})

test('a press inside the Browser <webview> and a popup of the Canvas', async () => {
  const { window, app } = await start()
  const webview = window.locator('webview[data-browser-id="b1"]')
  await expect(webview).toHaveCount(1)
  await expect
    .poll(
      () =>
        app.evaluate(async ({ webContents }) => {
          const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview')
          return guest ? ((await guest.executeJavaScript('document.body?.dataset.ready')) as string | undefined) : undefined
        }),
      { timeout: ms(15_000), message: 'the fixture page has loaded in the <webview>' },
    )
    .toBe('yes')
  const guestFocused = (): Promise<boolean> =>
    app.evaluate(async ({ webContents }) => {
      const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview')
      return guest ? ((await guest.executeJavaScript('document.hasFocus()')) as boolean) : false
    })

  const results: Record<string, unknown> = {}
  for (const probe of ['spike-popover', 'spike-popover-blur', 'spike-menu', 'spike-canvas-b1-popover', 'spike-canvas-b1-popover-blur'] as const) {
    // Back to the app's page before each probe.
    await window.getByTestId('spike-toolbar').click({ position: { x: 2, y: 2 } })
    await settle(window, 150)
    await window.getByTestId(`${probe}-trigger`).click()
    const popup = window.getByTestId(`${probe}-popup`)
    await expect(popup).toBeVisible()
    const before = (await spikeLog(window)).log.length
    const wv = await box(webview)
    await window.mouse.click(wv.x + wv.width / 2, wv.y + wv.height * 0.7)
    await settle(window, 500)
    const open = (await popup.count()) > 0
    const reasons = (await spikeLog(window)).log.slice(before).map((entry) => `${entry.probe}:${entry.reason}`)
    const embedderHasFocus = await window.evaluate(() => (globalThis as unknown as { document: { hasFocus(): boolean } }).document.hasFocus())
    results[probe] = { openAfterPressInWebview: open, reasons, guestHasFocus: await guestFocused(), embedderHasFocus }
    if (open) await window.keyboard.press('Escape')
  }
  say('webview press', results)
  expect.soft((results['spike-popover-blur'] as { openAfterPressInWebview: boolean }).openAfterPressInWebview, 'with the close on window blur the popover closes').toBe(false)
  expect.soft((results['spike-canvas-b1-popover-blur'] as { openAfterPressInWebview: boolean }).openAfterPressInWebview).toBe(false)
})

test('in focus mode: a popup of a tile is drawn over the layer, Esc closes the popup and not focus mode', async () => {
  const { window } = await start()
  await window.locator('.react-flow__node[data-id="n1"] .w-note__header').click()
  await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
  await window.keyboard.press('ControlOrMeta+Enter')
  const focus = window.getByTestId('focus-mode')
  await expect(focus).toBeVisible()

  const results: Record<string, unknown> = {}
  for (const probe of ['popover', 'menu'] as const) {
    const id = `spike-tile-n1-${probe}`
    await window.getByTestId(`${id}-trigger`).click()
    const popup = window.getByTestId(`${id}-popup`)
    await expect(popup).toBeVisible()
    const top = await onTop(popup)
    const before = (await spikeLog(window)).escapes.length
    await window.keyboard.press('Escape')
    await settle(window)
    const popupClosed = (await popup.count()) === 0
    const focusModeStays = (await focus.count()) === 1
    const escapes = (await spikeLog(window)).escapes.slice(before)
    const closeEntry = (await spikeLog(window)).log.filter((entry) => entry.probe === id && !entry.open).at(-1)
    results[probe] = { onTop: top, popupClosed, focusModeStays, focusAfter: await active(window), escReachedWindow: escapes, close: closeEntry }
    expect.soft(top).toBe(true)
    expect.soft(popupClosed).toBe(true)
    expect.soft(focusModeStays).toBe(true)
  }
  await window.keyboard.press('Escape')
  await settle(window)
  results.nextEscLeavesFocusMode = (await focus.count()) === 0
  say('focus mode', results)
})

test('over Settings: a popover and a menu are on top, Esc closes only the top layer, the next Esc closes Settings', async () => {
  const { window, app } = await start()
  const results: Record<string, unknown> = {}
  for (const probe of ['spike-settings-popover', 'spike-settings-menu'] as const) {
    await clickMenuItem(app, 'app.settings')
    const settings = window.getByTestId('settings')
    await expect(settings).toBeVisible()
    await window.getByTestId(`${probe}-trigger`).click()
    const popup = window.getByTestId(`${probe}-popup`)
    await expect(popup).toBeVisible()
    const top = await onTop(popup)
    const focusInPopup = await popup.evaluate((element) => element.contains(element.ownerDocument.activeElement))
    const before = await spikeLog(window)
    await window.keyboard.press('Escape')
    await settle(window)
    const popupClosed = (await popup.count()) === 0
    const settingsStays = (await settings.count()) === 1
    const after = await spikeLog(window)
    const closeEntry = after.log.slice(before.log.length).find((entry) => entry.probe === probe && !entry.open)
    await window.keyboard.press('Escape')
    await settle(window)
    const secondEscClosesSettings = (await settings.count()) === 0
    results[probe] = { onTop: top, focusInPopup, popupClosed, settingsStays, close: closeEntry, escReachedWindow: after.escapes.slice(before.escapes.length), secondEscClosesSettings }
    expect.soft(top).toBe(true)
    expect.soft(popupClosed).toBe(true)
    expect.soft(settingsStays).toBe(true)
    expect.soft(secondEscClosesSettings).toBe(true)
    if (!secondEscClosesSettings) await window.getByTestId('settings-close').click()
  }
  say('over settings', results)
})

for (const way of ['body', 'inside', 'trap'] as const) {
  test(`the app's own Select inside a modal Base UI Dialog, way "${way}": mouse pick, Esc on the open list, the list for a screen reader`, async () => {
    const { window } = await start()
    const id = `spike-dialog-${way}`
    await window.getByTestId(`${id}-trigger`).click()
    const dialog = window.getByTestId(`${id}-popup`)
    await expect(dialog).toBeVisible()
    const select = window.getByTestId(`${id}-select`)
    const list = window.getByTestId(`${id}-select-list`)

    // Mouse pick.
    await select.click()
    await expect(list).toBeVisible()
    const listOnTop = await onTop(list.locator('[data-value="beta"]'))
    await list.locator('[data-value="beta"]').click()
    await settle(window)
    const value = await window.getByTestId(`${id}-value`).textContent()
    const openAfterPick = (await dialog.count()) === 1

    // Esc on the open list.
    await select.click()
    await expect(list).toBeVisible()
    await window.keyboard.press('Escape')
    await settle(window)
    const listClosedByEsc = (await list.count()) === 0
    const openAfterEsc = (await dialog.count()) === 1

    // The list for a screen reader: by role (Playwright leaves out what is hidden from it), the
    // attributes on the way up, and the accessibility tree of the page.
    await select.click()
    await expect(list).toBeVisible()
    const byRole = await window.getByRole('listbox').count()
    const hidden = await hiddenFromAt(list)
    const tree = await window.locator('body').ariaSnapshot()
    const inTree = /option "Gamma"/.test(tree)
    await window.keyboard.press('Escape')

    // A press outside the window still closes it (modal true) or not (trap-focus).
    const closeLog = await spikeLog(window)
    say(`select in dialog ${way}`, {
      listOnTop,
      valueAfterMousePick: value,
      dialogOpenAfterPick: openAfterPick,
      listClosedByEsc,
      dialogOpenAfterEsc: openAfterEsc,
      listboxByRole: byRole,
      hiddenFromAt: hidden,
      optionInAriaTree: inTree,
      log: closeLog.log.filter((entry) => entry.probe === id),
    })
    expect.soft(listOnTop).toBe(true)
    expect.soft(value).toBe('beta')
    expect.soft(openAfterPick).toBe(true)
    expect.soft(listClosedByEsc).toBe(true)
    expect.soft(openAfterEsc).toBe(true)
    expect.soft(byRole).toBe(1)
    expect.soft(hidden).toBeNull()
    expect.soft(inTree).toBe(true)
  })
}
