import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, chooseLevel, closeSettings, launchApp, linkThroughUi, machineIdOf, openMachinesSettings, PROJECTS_ACCESS_LABEL, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'

// The control rules of src/renderer/theme/tokens.css in the built app: every control shows the
// pointer, an inactive one the not-allowed cursor, a text field the text cursor; a control under
// the pointer looks different, an inactive one and a plain label do not; keyboard focus draws a
// ring. Checked in the light and the dark theme, in every area a person clicks in: the sidebar,
// the toolbar, a Node's header, a Browser's header, the selection toolbar, the command palette,
// the Session view and Settings. The Canvas keeps its own cursors (React Flow's and canvas.css).

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

/** What a click can act on; the same list as the control rules of tokens.css. */
const CONTROLS = [
  'button',
  '[role="button"]',
  'a[href]',
  'summary',
  'select',
  'label:has(input[type="checkbox"], input[type="radio"])',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="link"]',
].join(', ')

/**
 * The few DOM globals the page-side callbacks use. test/e2e is type-checked without the DOM
 * library (it runs under Node), so the callbacks declare what they touch.
 */
interface PageElement {
  matches: (selector: string) => boolean
  getAttribute: (name: string) => string | null
  getBoundingClientRect: () => { width: number; height: number }
  closest: (selector: string) => PageElement | null
  outerHTML: string
  disabled?: boolean
}
interface PageGlobals {
  document: { querySelectorAll: (selector: string) => Iterable<PageElement>; documentElement: PageElement }
  getComputedStyle: (element: PageElement) => Record<string, string> & { getPropertyValue: (name: string) => string }
}

let server: Server
let scratch: string
let launched: LaunchedApp | undefined

test.beforeAll(async () => {
  server = createServer((_request, response) => response.end('<!doctype html><title>blank</title><p>blank</p>'))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
})

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-controls-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

/** A Project whose Layout holds a Note and a Browser Node; the Orchestrator comes with every Project. */
async function start(): Promise<LaunchedApp> {
  const dataDir = join(scratch, 'data')
  const repo = join(scratch, 'alpha')
  mkdirSync(repo)
  mkdirSync(join(scratch, 'home'))
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(
    join(dataDir, PROJECT, 'layout.json'),
    JSON.stringify({
      nodes: [
        { ...base, id: 'n1', kind: 'note', x: 40, y: 420, w: 220, h: 120, data: { text: 'one' } },
        { ...base, id: 'b1', kind: 'browser', x: 520, y: 60, w: 480, h: 400, data: { url } },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
  )
  const app = await launchApp({ env: { WORFY_DATA_DIR: dataDir, HOME: join(scratch, 'home') } })
  await canvasReady(app, { size: { width: 1400, height: 900 } })
  return app
}

const cursorOf = (target: Locator): Promise<string> => target.evaluate((element) => (globalThis as unknown as PageGlobals).getComputedStyle(element as PageElement).cursor ?? '')

/** What hover may change on a control: its background, border, text colour, shadow (the veil), opacity. */
const looks = (target: Locator): Promise<string> =>
  target.evaluate((element) => {
    const style = (globalThis as unknown as PageGlobals).getComputedStyle(element as PageElement)
    return [style.backgroundColor, style.borderColor, style.color, style.boxShadow, style.opacity, style.textDecorationLine].join(' | ')
  })

/** The look once it has stopped changing: two reads 50 ms apart agree (a transition may run). */
async function settledLooks(window: Page, target: Locator): Promise<string> {
  let last = await looks(target)
  for (let read = 0; read < 40; read++) {
    await window.waitForTimeout(50)
    const next = await looks(target)
    if (next === last) return next
    last = next
  }
  throw new Error('the look of the control kept changing for 2 s')
}

/** The control's look with the pointer away from it and over it. */
async function hovered(window: Page, target: Locator): Promise<{ away: string; over: string }> {
  await window.mouse.move(1, 1)
  const away = await settledLooks(window, target)
  await target.hover()
  const over = await settledLooks(window, target)
  await window.mouse.move(1, 1)
  return { away, over }
}

/**
 * The veil in a computed box-shadow: an inset layer in the veil's colour whose spread is more than
 * zero (`100vmax` computes to pixels). The look string lists the box-shadow fourth.
 */
const veilOf = (look: string): RegExpMatchArray | null => /rgba\((?:0, 0, 0, 0\.04|255, 255, 255, 0\.06)\) 0px 0px 0px ([1-9][\d.]*)px inset/.exec(look.split(' | ')[3] ?? '')

/** A control: the pointer, and the veil under the pointer. */
async function expectControl(window: Page, target: Locator, name: string): Promise<void> {
  await expect(target, name).toBeVisible()
  expect(await cursorOf(target), `${name}: cursor`).toBe('pointer')
  const { away, over } = await hovered(window, target)
  expect(over, `${name}: looks different under the pointer`).not.toBe(away)
  expect(veilOf(over), `${name}: the veil under the pointer (${over})`).not.toBeNull()
}

/** An inactive control: the not-allowed cursor, and no change under the pointer. */
async function expectInactive(window: Page, target: Locator, name: string): Promise<void> {
  await expect(target, name).toBeVisible()
  expect(await cursorOf(target), `${name}: cursor`).toBe('not-allowed')
  const { away, over } = await hovered(window, target)
  expect(over, `${name}: looks the same under the pointer`).toBe(away)
}

/** Something a click does not act on: not the pointer, and no change under the pointer. */
async function expectStatic(window: Page, target: Locator, name: string): Promise<void> {
  await expect(target, name).toBeVisible()
  expect(await cursorOf(target), `${name}: cursor`).not.toBe('pointer')
  const { away, over } = await hovered(window, target)
  expect(over, `${name}: looks the same under the pointer`).toBe(away)
}

/**
 * Every control on screen right now: an active one has the pointer, an inactive one the not-allowed
 * cursor. Answers the controls that do not, as a short piece of their HTML each.
 */
const wrongCursors = (window: Page): Promise<string[]> =>
  window.evaluate((selector) => {
    const wrong: string[] = []
    for (const element of (globalThis as unknown as PageGlobals).document.querySelectorAll(selector)) {
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0 || element.closest('[hidden]')) continue
      const inactive = element.disabled === true || element.getAttribute('aria-disabled') === 'true'
      const cursor = (globalThis as unknown as PageGlobals).getComputedStyle(element).cursor
      if (cursor !== (inactive ? 'not-allowed' : 'pointer')) wrong.push(`${cursor}: ${element.outerHTML.slice(0, 140)}`)
    }
    return wrong
  }, CONTROLS)

async function expectAllCursors(window: Page, area: string): Promise<void> {
  expect(await wrongCursors(window), `${area}: controls with the wrong cursor`).toEqual([])
}

for (const scheme of ['light', 'dark'] as const) {
  test(`every control shows the pointer and a hover of its own, inactive ones and labels do not (${scheme})`, async () => {
    test.setTimeout(120_000)
    launched = await start()
    const { app, window } = launched
    await window.emulateMedia({ colorScheme: scheme })
    const veil = await window.evaluate(() => (globalThis as unknown as PageGlobals).getComputedStyle((globalThis as unknown as PageGlobals).document.documentElement).getPropertyValue('--hover-veil'))
    expect(veil.trim(), 'the veil of this theme').toBe(scheme === 'light' ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.06)')

    // The empty Canvas, where a drag draws a selection, has the arrow (canvas.css), not React Flow's
    // pointer; a pan with the middle button shows grabbing. A Node's drag handle keeps its grab.
    const pane = window.locator('.react-flow__pane')
    await expect.poll(() => cursorOf(pane)).toBe('default')
    const paneBox = await pane.boundingBox()
    if (paneBox === null) throw new Error('the Canvas has no box')
    await window.mouse.move(paneBox.x + 300, paneBox.y + paneBox.height - 40)
    await window.mouse.down({ button: 'middle' })
    await window.mouse.move(paneBox.x + 340, paneBox.y + paneBox.height - 60, { steps: 4 })
    await expect.poll(() => cursorOf(pane), { message: 'the Canvas while it is panned' }).toBe('grabbing')
    await window.mouse.up({ button: 'middle' })
    await expect.poll(() => cursorOf(pane)).toBe('default')
    expect(await cursorOf(window.locator('.w-note__header')), 'the drag handle of a Note').toBe('grab')
    expect(await cursorOf(window.locator('.w-note__text')), 'the text of a Note').toBe('text')

    // Sidebar and toolbar.
    await expectControl(window, window.locator('.w-sidebar-section__toggle').first(), 'a sidebar section toggle')
    await expectControl(window, window.getByRole('button', { name: 'Add project' }), 'Add project')
    await expectControl(window, window.getByTestId('palette-trigger'), 'the command palette trigger')
    await expectControl(window, window.getByRole('button', { name: 'Hide sidebar' }), 'the sidebar toggle of the toolbar')

    // A Node's header, and the Orchestrator's state beside its buttons, which is only a label.
    const orchestrator = window.getByTestId('orchestrator-node')
    await expectControl(window, orchestrator.getByTestId('orchestrator-new-conversation'), 'New conversation of the Orchestrator')
    await expectStatic(window, orchestrator.getByTestId('orchestrator-state'), 'the state of the Orchestrator')

    // A Browser's header: Back stays inactive on a page with no history. All three buttons are
    // inactive until the page is ready (BrowserNode.tsx), so Reload is read once it is enabled.
    const frame = window.locator('[data-testid="browser-frame"][data-node-id="b1"]')
    const reload = frame.getByRole('button', { name: 'Reload' })
    await expect(reload, 'Reload of a Browser once its page is ready').toBeEnabled()
    await expectControl(window, reload, 'Reload of a Browser')
    await expectInactive(window, frame.getByRole('button', { name: 'Back' }), 'Back of a Browser with no history')
    await expectAllCursors(window, 'the Canvas')

    // The Canvas menu of the empty Canvas: its items are controls.
    await window.mouse.click(paneBox.x + 300, paneBox.y + paneBox.height - 40, { button: 'right' })
    const menu = window.getByRole('menu', { name: 'Canvas' })
    await expect(menu).toBeVisible()
    await expectControl(window, menu.getByRole('menuitem').first(), 'an item of the Canvas menu')
    await expectAllCursors(window, 'the Canvas menu')
    await menu.press('Escape')
    await expect(menu).toHaveCount(0)

    // Inactive controls the screens of this test do not show: a `.w-action` button with `disabled`
    // (Up of the folder browser at the root, Move up and Reset of Settings → Pipeline, which need
    // a Linked machine or a Harness profile) and the label of a disabled checkbox (the Autopilot box
    // of a read-only Browser profile). Drawn into the app's own document, so the app's own
    // stylesheets style them.
    await window.evaluate(() => {
      const probe = (globalThis as unknown as { document: { createElement: (tag: string) => { innerHTML: string; style: { cssText: string } }; body: { append: (node: unknown) => void } } }).document
      const holder = probe.createElement('div')
      holder.style.cssText = 'position: fixed; left: 360px; top: 120px; z-index: 100000; display: flex; gap: 8px; padding: 8px; background: var(--surface)'
      holder.innerHTML = '<button type="button" class="w-action" disabled data-testid="probe-action">Up</button><label data-testid="probe-label"><input type="checkbox" disabled> Available to Autopilot</label>'
      probe.body.append(holder)
    })
    await expectInactive(window, window.getByTestId('probe-action'), 'a disabled .w-action button')
    await expectInactive(window, window.getByTestId('probe-label'), 'the label of a disabled checkbox')
    await window.evaluate(() => (globalThis as unknown as { document: { querySelector: (selector: string) => { parentElement: { remove: () => void } } | null } }).document.querySelector('[data-testid="probe-action"]')?.parentElement.remove())

    // The selection toolbar of a selected Note: its buttons, and its own ground that is not one.
    await window.locator('.w-note__header').click()
    const toolbar = window.getByRole('toolbar', { name: 'Selection' })
    await expectControl(window, toolbar.getByRole('button', { name: 'Pin' }), 'Pin of the selection toolbar')
    expect(await cursorOf(toolbar), 'the selection toolbar between its buttons').toBe('default')
    await expectAllCursors(window, 'the selection toolbar')
    await window.keyboard.press('Escape')

    // The command palette: its rows are controls, its field takes text.
    await window.keyboard.press('ControlOrMeta+k')
    const palette = window.getByTestId('palette-input')
    await expect(palette).toBeVisible()
    expect(await cursorOf(palette), 'the palette field').toBe('text')
    const option = window.getByTestId('palette-option').first()
    expect(await cursorOf(option), 'a palette row').toBe('pointer')
    await expectAllCursors(window, 'the command palette')
    await window.keyboard.press('Escape')
    await expect(palette).toBeHidden()

    // Settings: a switch, the Close button, a section heading that is only a label; the keyboard
    // focus draws the ring on a control.
    await clickMenuItem(app, 'app.settings')
    const dialog = window.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()
    await expectControl(window, dialog.getByRole('switch').first(), 'a Settings switch')
    await expectControl(window, dialog.getByRole('button', { name: 'Close' }), 'Close of Settings')
    await expectStatic(window, dialog.getByRole('heading', { level: 2 }), 'the heading of a Settings section')
    await expectAllCursors(window, 'Settings')
    const close = dialog.getByRole('button', { name: 'Close' })
    await close.focus()
    await window.keyboard.press('Shift+Tab')
    await window.keyboard.press('Tab')
    await expect(close).toBeFocused()
    const ring = await close.evaluate((element) => {
      const focused = element as PageElement
      if (!focused.matches(':focus-visible')) return 'no keyboard focus'
      const style = (globalThis as unknown as PageGlobals).getComputedStyle(focused)
      return `${style.outlineStyle} ${style.outlineWidth}`
    })
    expect(ring, 'the keyboard focus ring of Close, a control with no ring of its own').toBe('solid 2px')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)

    // The Session view of the Orchestrator: its buttons, and the message field that takes text.
    await orchestrator.locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view).toBeVisible()
    await expectControl(window, view.getByRole('button', { name: 'Attach files' }), 'Attach files')
    await expectControl(window, view.locator('.w-session__toggle'), 'the tools toggle of the Session view')
    expect(await cursorOf(view.locator('.w-composer__field')), 'the message field').toBe('text')
    await expectAllCursors(window, 'the Session view')
  })
}

function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

// A read-only screen (worfy-link ticket 25): B shares its Project with A read-only, A opens it. The
// write actions there carry aria-disabled, not disabled (projects/read-only.ts): the items of the
// Canvas menu and the rows of the command palette that would change B's Layout.
test('the write actions of a read-only screen show not-allowed and no hover', async () => {
  test.setTimeout(180_000)
  const projectOf = (name: string, id: string): string => {
    const repo = join(scratch, name)
    const dataDir = join(scratch, `${name}-data`)
    mkdirSync(repo)
    git(repo, 'init', '-q')
    mkdirSync(join(dataDir, id), { recursive: true })
    mkdirSync(join(scratch, `${name}-home`))
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id, name, path: realpathSync.native(repo) }], activeId: id }))
    return dataDir
  }
  const BETA = 'beta-0000000b'
  const a = await launchApp({ env: { WORFY_DATA_DIR: projectOf('alpha', PROJECT), HOME: join(scratch, 'alpha-home') } })
  launched = a
  const b = await launchApp({ env: { WORFY_DATA_DIR: projectOf('beta', BETA), HOME: join(scratch, 'beta-home') } })
  try {
    await canvasReady(b, { size: { width: 1400, height: 900 } })
    await canvasReady(a, { size: { width: 1400, height: 900 } })
    await linkThroughUi(a.window, b.window)
    const aId = await machineIdOf(a.window)
    const bId = await machineIdOf(b.window)
    const settings = await openMachinesSettings(b)
    await settings.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true }).click()
    await chooseLevel(b.window, settings.getByTestId(`link-machine-access-${aId}`), 'read')
    await closeSettings(b.window)

    const window = a.window
    const group = window.locator(`[data-testid="machine-group"][data-machine-id="${bId}"]`)
    await expect(group.getByTestId('machine-read-only')).toHaveText('Read only', { timeout: 20_000 })
    await group.locator(`[data-testid="project-row"][data-project-id="${BETA}"]`).getByRole('button').click()
    await expect(window.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)
    await expect(window.getByTestId('canvas-read-only')).toBeVisible()

    const pane = window.locator('.react-flow__pane')
    const box = await pane.boundingBox()
    if (box === null) throw new Error('the Canvas has no box')
    await window.mouse.click(box.x + 300, box.y + box.height - 40, { button: 'right' })
    const menu = window.getByRole('menu', { name: 'Canvas' })
    await expect(menu).toBeVisible()
    const item = menu.getByRole('menuitem').first()
    await expect(item).toHaveAttribute('aria-disabled', 'true')
    await expectInactive(window, item, 'an inactive item of the Canvas menu')
    await expectAllCursors(window, 'the Canvas menu of a read-only screen')
    await menu.press('Escape')
    await expect(menu).toHaveCount(0)

    await window.keyboard.press('ControlOrMeta+k')
    await expect(window.getByTestId('palette-input')).toBeVisible()
    const inactive = window.locator('[data-testid="palette-option"][aria-disabled="true"]').first()
    await expect(inactive).toBeVisible()
    expect(await cursorOf(inactive), 'an inactive row of the command palette').toBe('not-allowed')
    await expectAllCursors(window, 'the command palette of a read-only screen')
  } finally {
    await b.close()
  }
})
