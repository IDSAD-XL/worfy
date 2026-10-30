import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { MIN_SIZE } from '../../src/shared/window/bounds'
import { launchApp, smallestWindow } from './helpers'
import { nextFrames, settled } from './wait'

// The input field's pickers and message queue (ticket 19) against the built app, on the fake agent
// with the script test/fixtures/agent-scripts/session-view.jsonl: turn 1 answers at once, turn 2
// holds until it is interrupted, then the script starts over. WORFY_AGENT_LOG makes the fake agent
// write down what it was asked to do: the settings each Claude Code process started with, the
// control calls, and each user message at the moment it reached Claude Code. The model picker
// never offers a haiku, and a Session never runs on one (worfy-daily ticket 07).

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

type Call = { kind: string; text?: string; model?: string | null; mode?: string; settings?: Record<string, unknown>; resume?: string | null }

let scratch: string
let dataDir: string
let claudeHome: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-session-controls-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  log = join(scratch, 'agent.log')
  mkdirSync(claudeHome)
  const path = join(scratch, 'alpha')
  mkdirSync(path)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const calls = (): Call[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Call)
    : []
const messages = () => calls().flatMap((call) => (call.kind === 'message' ? [call.text] : []))
const controls = () => calls().filter((call) => call.kind !== 'message' && call.kind !== 'start')

/** Opens the Orchestrator's Session view with a double click on its Node. */
async function openSession(window: Page): Promise<Locator> {
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
  await node.locator('.w-orchestrator__header').dblclick()
  const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
  await expect(view).toBeVisible()
  await expect(view.getByTestId('session-state')).toHaveText('idle')
  return view
}

/** The list of a Select picker: drawn into the document's body, not inside the Session view. */
const listOf = async (window: Page, picker: Locator): Promise<Locator> => window.getByTestId(`${(await picker.getAttribute('data-testid')) ?? ''}-list`)

/** Opens the list of a Select picker and waits for these rows in it; Esc then closes the list alone. */
async function expectOptions(window: Page, picker: Locator, rows: string[]): Promise<void> {
  await picker.click()
  const list = await listOf(window, picker)
  await expect(list).toBeVisible()
  await expect(list.getByRole('option')).toHaveText(rows)
  await expect(picker).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
}

/** Chooses a row of a Select picker: a click on its button, then on the option. */
async function choose(window: Page, picker: Locator, label: string): Promise<void> {
  await picker.click()
  await (await listOf(window, picker)).getByRole('option', { name: label, exact: true }).click()
  await expect(await listOf(window, picker)).toHaveCount(0)
}

test('the pickers change the live Session and survive a restart; the queue sends one message per turn', async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view', WORFY_AGENT_LOG: log }
  const first = await launchApp({ env })
  try {
    const { window } = first
    const view = await openSession(window)
    const model = view.getByTestId('picker-model')
    const effort = view.getByTestId('picker-effort')
    const mode = view.getByTestId('picker-permissions')
    // The fake agent lists a haiku too; worfy leaves it out (worfy-daily ticket 07).
    await expectOptions(window, model, ['Default (recommended)', 'Opus', 'Sonnet'])
    // Esc closed the list alone: the Session view is still the one shown.
    await expect(view).toBeVisible()
    await expect(model).toHaveAttribute('data-value', '')
    await expect(model).toHaveText('ModelDefault (recommended)')
    await expect(effort).toHaveAttribute('data-value', '')
    await expect(effort).toHaveText('Effortdefault')
    await expect(mode).toHaveAttribute('data-value', 'bypassPermissions')
    await expect(mode).toHaveText('PermissionsBypass permissions')
    // None of the three is a native select element.
    await expect(view.locator('select')).toHaveCount(0)
    // A new Orchestrator with no pick starts on the user's model: no model named to Claude Code.
    expect(calls().filter((call) => call.kind === 'start')).toMatchObject([{ settings: { model: null, effort: null } }])
    await expect(view.getByTestId('session-effort')).toHaveText('—')

    // The picks reach the live Claude Code as control calls, without a restart.
    await choose(window, model, 'Sonnet')
    await expect(model).toHaveAttribute('data-value', 'sonnet')

    // The effort is a slider in the popover of its button: its marks are the levels of the picked
    // model, and the popover opens over the button, inside the window.
    await effort.click()
    const popover = view.getByTestId('effort-popover')
    const slider = view.getByTestId('effort-slider')
    await expect(popover).toBeVisible()
    await expect(slider).toBeFocused()
    expect(await view.getByTestId('effort-mark').evaluateAll((marks) => marks.map((mark) => mark.getAttribute('data-mark')))).toEqual(['default', 'low', 'medium', 'high', 'max'])
    await expect(slider).toHaveAttribute('aria-valuetext', 'default')
    const [popoverBox, effortBox] = [await popover.boundingBox(), await effort.boundingBox()]
    expect(popoverBox !== null && effortBox !== null && popoverBox.y >= 0 && popoverBox.y + popoverBox.height <= effortBox.y).toBe(true)
    // → moves the thumb to the next mark; the level goes to Claude Code once, not on the key press.
    await window.keyboard.press('ArrowRight')
    await expect(slider).toHaveAttribute('aria-valuetext', 'low')
    await expect(view.getByTestId('effort-current')).toHaveText('low')
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`effort-slider-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
    // The thumb rests: the level is sent with the popover still open, and the button shows it once
    // main reports it. Enter then closes the popover and sends nothing more (the control calls below).
    await expect(effort).toHaveAttribute('data-value', 'low')
    await expect(effort).toHaveText('Effortlow')
    await expect(popover).toBeVisible()
    await window.keyboard.press('Enter')
    await expect(popover).toHaveCount(0)
    await expect(effort).toBeFocused()

    await choose(window, mode, 'Plan only')
    await expect(mode).toHaveAttribute('data-value', 'plan')
    await expect(view.getByTestId('session-effort')).toHaveText('low')
    await expect.poll(controls).toEqual([
      { kind: 'setModel', model: 'sonnet' },
      { kind: 'applyFlagSettings', settings: { effortLevel: 'low' } },
      { kind: 'setPermissionMode', mode: 'plan' },
    ])
    expect(calls().filter((call) => call.kind === 'start')).toHaveLength(1)

    // The next turn runs with them: its system/init reports the model and the mode.
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('first')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    await expect(view.getByTestId('session-model')).toHaveText('sonnet')
    await expect(view.getByTestId('session-permissions')).toHaveText('plan')

    // Turn 2 holds; three messages written meanwhile wait in the queue, not in Claude Code.
    await field.fill('hold')
    await field.press('Enter')
    await expect(view.getByTestId('session-state')).toHaveText('busy')
    await expect(view.getByText('Return to queue')).toBeVisible()
    for (const text of ['queued one', 'queued two', 'queued three']) {
      await field.fill(text)
      await field.press('Enter')
    }
    await expect(view.getByTestId('queue-chip')).toHaveText('3 queued')
    await expect.poll(messages).toEqual(['first', 'hold'])
    await expect(view.getByTestId('transcript-prompt')).toHaveCount(2)

    // One is removed before it is sent.
    await view.getByTestId('queue-chip').click()
    await expect(view.getByTestId('queue-item')).toHaveCount(3)
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`session-queue-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
    await view.getByRole('button', { name: 'Remove queued message 2' }).click()
    await expect(view.getByTestId('queue-chip')).toHaveText('2 queued')

    // Interrupt stops the turn and holds the queue: nothing goes by itself.
    await view.getByTestId('input-interrupt').click()
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    await expect(view.getByTestId('queue-send')).toBeVisible()
    // main decides on the next message in the same step that makes the Session idle: once the
    // renderer has caught up with main, a message that went would show in the queue.
    await settled(window)
    await expect(view.getByTestId('queue-chip')).toHaveText('2 queued')
    expect(messages()).toEqual(['first', 'hold'])

    // Send queued: the first goes now (the script's turn 1 answers), the next after its result.
    await view.getByTestId('queue-send').click()
    await expect.poll(messages).toEqual(['first', 'hold', 'queued one', 'queued three'])
    await expect(view.getByTestId('queue-chip')).toHaveCount(0)
    await expect(view.getByTestId('session-state')).toHaveText('busy')
    await expect(view.getByTestId('transcript-prompt')).toHaveText([/first$/, /hold$/, /queued one$/, /queued three$/])
    await view.getByTestId('input-interrupt').click()
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    expect(messages()).not.toContain('queued two')
  } finally {
    await first.close()
  }

  // After a restart the Orchestrator starts with the same picks. The fake agent writes no
  // transcript, so the Orchestrator starts a new session here rather than resuming (ADR 0010);
  // that a resume gets the picks too is test/contract/orchestrator.test.ts.
  const second = await launchApp({ env })
  try {
    const view = await openSession(second.window)
    await expect(view.getByTestId('picker-model')).toHaveAttribute('data-value', 'sonnet')
    await expect(view.getByTestId('picker-effort')).toHaveAttribute('data-value', 'low')
    await expect(view.getByTestId('picker-permissions')).toHaveAttribute('data-value', 'plan')
    const starts = calls().filter((call) => call.kind === 'start')
    expect(starts).toHaveLength(2)
    expect(starts[1]).toMatchObject({ kind: 'start', settings: { model: 'sonnet', effort: 'low', permissionMode: 'plan' } })
  } finally {
    await second.close()
  }
})

test("an Orchestrator saved on haiku starts on the default model with its effort reset; a haiku in the user's settings.json starts Claude Code on sonnet", async () => {
  // The Orchestrator Node and its picks as an older build saved them: model haiku, effort high.
  const project = join(dataDir, PROJECT)
  const orchestrator = { id: 'orch', kind: 'orchestrator', x: 10, y: 20, w: 300, h: 180, hidden: false, locked: true, pinned: false, tags: [], data: {} }
  writeFileSync(join(project, 'layout.json'), JSON.stringify({ nodes: [orchestrator], viewport: { x: 0, y: 0, zoom: 1 } }))
  writeFileSync(join(project, 'session-settings.json'), JSON.stringify({ nodes: { orch: { model: 'haiku', effort: 'high', permissionMode: 'plan' } } }))
  const userSettings = join(claudeHome, 'settings.json')
  const userText = JSON.stringify({ model: 'claude-haiku-4-5', permissions: { allow: ['Bash'] } })
  writeFileSync(userSettings, userText)
  const userMtime = statSync(userSettings).mtimeMs

  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view', WORFY_AGENT_LOG: log }
  const app = await launchApp({ env })
  try {
    const view = await openSession(app.window)
    const model = view.getByTestId('picker-model')
    await expect(model).toHaveAttribute('data-value', '')
    await expectOptions(app.window, model, ['Default (recommended)', 'Opus', 'Sonnet'])
    await expect(view.getByTestId('picker-effort')).toHaveAttribute('data-value', '')
    await expect(view.getByTestId('picker-permissions')).toHaveAttribute('data-value', 'plan')

    // Claude Code is asked for sonnet, as the user's model is a haiku; the Node keeps the default model.
    expect(calls().filter((call) => call.kind === 'start')).toMatchObject([{ settings: { model: 'sonnet', effort: null, permissionMode: 'plan' } }])
    await expect
      .poll(() => JSON.parse(readFileSync(join(project, 'session-settings.json'), 'utf8')) as unknown)
      .toEqual({ nodes: { orch: { model: null, effort: null, permissionMode: 'plan' } } })

    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('first')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    await expect(view.getByTestId('session-model')).toHaveText('sonnet')
  } finally {
    await app.close()
  }
  // worfy never writes to the user's settings.json (ADR 0005).
  expect(readFileSync(userSettings, 'utf8')).toBe(userText)
  expect(statSync(userSettings).mtimeMs).toBe(userMtime)
})

// The three native lists the pickers replaced were 427 px wide together on the default model (150,
// 132 and 137 px with two 4 px gaps, measured in a 1280×800 window). A block that wide in the
// pickers' place gives the bar the lines it had then.
const NATIVE_LISTS_WIDTH = 427

type Box = { x: number; y: number; width: number; height: number }

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (found === null) throw new Error('no box')
  return found
}

/**
 * Resizes the app's window until the page of `inPage` is `width` px wide. 800×520 is the smallest
 * window worfy allows, an outer size: smallestWindow sets it, and on Windows the page is narrower.
 */
async function resizeWindow(app: ElectronApplication, inPage: Locator, width: number, height: number): Promise<void> {
  if (width === MIN_SIZE.width && height === MIN_SIZE.height) {
    await smallestWindow({ app, window: inPage.page() })
    return
  }
  await expect
    .poll(
      async () => {
        // Reading a box lays the page out for the width it has now.
        const now = await inPage.evaluate((element) => element.ownerDocument.documentElement.clientWidth)
        if (now !== width) await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted.width, wanted.height), { width, height })
        return now
      },
      { message: `the window is ${width} px wide` },
    )
    .toBe(width)
}

/** The height of the bar as it is, and with a block as wide as the native lists in the pickers' place. */
async function barHeights(window: Page, bar: Locator): Promise<{ now: number; withNativeLists: number }> {
  const now = (await box(bar)).height
  const style = await window.addStyleTag({
    content: `.w-composer__item[data-item='Pickers'] { flex: 0 0 ${NATIVE_LISTS_WIDTH}px !important; min-width: 0 !important; max-width: none !important; overflow: hidden !important; }`,
  })
  const withNativeLists = (await box(bar)).height
  await style.evaluate((element) => element.remove())
  return { now, withNativeLists }
}

test('on the default model the pickers do not make the bar under the input field taller than the native lists did, and Send stays on their line', async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view', WORFY_AGENT_LOG: log }
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    const view = await openSession(window)
    const model = view.getByTestId('picker-model')
    const mode = view.getByTestId('picker-permissions')
    const bar = view.locator('.w-composer__bar')
    const pickers = view.getByTestId('pickers')
    const send = view.getByTestId('input-send')
    // Every new Session starts here: the default model, whose name is the longest of the list.
    await expect(model).toHaveText('ModelDefault (recommended)')
    await expect(mode).toHaveText('PermissionsBypass permissions')

    const resize = (width: number, height: number): Promise<void> => resizeWindow(app, bar, width, height)
    const heights = (): Promise<{ now: number; withNativeLists: number }> => barHeights(window, bar)
    const cut = (picker: Locator): Promise<boolean> => picker.locator('.w-select__value').evaluate((value) => value.scrollWidth > value.clientWidth)

    // The window the app opens in, with the sidebar and the rail of the Session shown: the pickers
    // stand on one line with Send, and the bar is as tall as it was with the native lists.
    await resize(1280, 800)
    const [barBox, pickersBox, sendBox] = [await box(bar), await box(pickers), await box(send)]
    expect(Math.abs(sendBox.y + sendBox.height / 2 - (pickersBox.y + pickersBox.height / 2))).toBeLessThan(4)
    expect(sendBox.x).toBeGreaterThan(pickersBox.x + pickersBox.width)
    expect(await heights()).toEqual({ now: barBox.height, withNativeLists: barBox.height })
    // In whatever window: the place the pickers ask of the bar before its lines are made is no
    // wider than the native lists were.
    const asked = await pickers.evaluate((element) => element.ownerDocument.defaultView?.getComputedStyle(element.parentElement ?? element).flexBasis ?? '')
    expect(Number.parseFloat(asked), `flex-basis of the pickers' item: ${asked}`).toBeLessThanOrEqual(NATIVE_LISTS_WIDTH)
    // There is room for the permission mode in full; a value that is cut is in the button's title.
    expect(await cut(mode)).toBe(false)
    await expect(mode).toHaveAttribute('title', 'Bypass permissions')
    await expect(model).toHaveAttribute('title', 'Default (recommended)')
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await view.getByTestId('message-input').screenshot({ path: test.info().outputPath(`composer-pickers-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

    // Other windows, down to the smallest, with the sidebar shown and hidden: never a line more.
    for (const sidebar of ['shown', 'hidden'] as const) {
      if (sidebar === 'hidden') await window.getByRole('button', { name: 'Hide sidebar' }).click()
      for (const [width, height] of [
        [1280, 800],
        [1200, 800],
        [1000, 700],
        [800, 520],
      ] as const) {
        await resize(width, height)
        const { now, withNativeLists } = await heights()
        expect(now, `the bar in a ${width}×${height} window, the sidebar ${sidebar}`).toBeLessThanOrEqual(withNativeLists)
        // In a line narrower than the pickers their values are cut; the buttons stay inside the bar.
        const [outer, inner] = [await box(bar), await box(pickers)]
        if (outer.width >= 400) {
          expect(inner.x, `the pickers' left edge in a ${width}×${height} window, the sidebar ${sidebar}`).toBeGreaterThanOrEqual(outer.x)
          expect(inner.x + inner.width, `the pickers' right edge in a ${width}×${height} window, the sidebar ${sidebar}`).toBeLessThanOrEqual(outer.x + outer.width)
        }
      }
    }
    // A cut value is still the whole value to a screen reader, and in the title.
    await expect(model).toHaveText('ModelDefault (recommended)')
    await expect(model).toHaveAttribute('title', 'Default (recommended)')

    // The sidebar hidden, the window wide again: the pickers stand in one line with the hint and
    // the spacer. The room of that line is theirs first: the spacer gets none while a value is cut.
    await resize(1280, 800)
    const width = (locator: Locator): Promise<number> => locator.evaluate((element) => element.getBoundingClientRect().width)
    const spacer = view.locator('.w-composer__spacer')
    expect((await width(spacer)) < 1 || !(await cut(model))).toBe(true)
    // And they take no more than their full width: with a short model name the rest is the spacer's.
    await choose(window, model, 'Sonnet')
    await expect(model).toHaveAttribute('data-value', 'sonnet')
    await expect(model).toHaveAttribute('title', 'Sonnet')
    expect(Math.abs((await width(pickers.locator('xpath=..'))) - (await width(pickers)))).toBeLessThan(1)
  } finally {
    await launched.close()
  }
})


/** The pickers as they were before a caption could go: both captions always shown, buttons up to 220 px. */
const CAPTIONS_ALWAYS = `.w-pickers { width: auto !important; } .w-pickers .w-pickers__select { max-width: 220px !important; } .w-pickers .w-select__prefix { display: inline !important; }`

test('a caption "Model" or "Permissions" goes when a value would be cut with it, by the width of the window alone; the bar keeps its lines, the buttons their names', async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view', WORFY_AGENT_LOG: log }
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    const view = await openSession(window)
    const model = view.getByTestId('picker-model')
    const mode = view.getByTestId('picker-permissions')
    const bar = view.locator('.w-composer__bar')
    const pickers = view.getByTestId('pickers')
    const send = view.getByTestId('input-send')
    await expect(model).toHaveText('ModelDefault (recommended)')
    await expect(mode).toHaveText('PermissionsBypass permissions')

    // Two frames: the pickers' ResizeObserver has run and React has drawn what it chose.
    const frames = (): Promise<void> => nextFrames(window)
    /** What a picker shows: its caption or not, and how many px of its value, whole or cut. */
    const shows = (picker: Locator): Promise<{ caption: boolean; value: number; cut: boolean }> =>
      picker.evaluate((button) => {
        const [caption, value] = [button.querySelector('.w-select__prefix'), button.querySelector('.w-select__value')]
        if (caption === null || value === null) throw new Error('a picker without its caption or value')
        return { caption: caption.checkVisibility(), value: value.clientWidth, cut: value.scrollWidth > value.clientWidth }
      })
    const layout = async () => {
      const [pickersBox, sendBox] = [await box(pickers), await box(send)]
      return {
        model: await shows(model),
        mode: await shows(mode),
        bar: (await box(bar)).height,
        sendOnTheirLine: Math.abs(sendBox.y + sendBox.height / 2 - (pickersBox.y + pickersBox.height / 2)) < 4,
      }
    }
    /** The same in the same window with the captions always shown, as before. */
    const asBefore = async (): Promise<Awaited<ReturnType<typeof layout>>> => {
      const style = await window.addStyleTag({ content: CAPTIONS_ALWAYS })
      const found = await layout()
      await style.evaluate((element) => element.remove())
      await frames()
      return found
    }

    for (const [sidebar, width, height] of [
      ['shown', 1320, 900],
      ['shown', 900, 600],
      ['shown', 800, 520],
      ['hidden', 1920, 1080],
    ] as const) {
      if (sidebar === 'hidden') await window.getByRole('button', { name: 'Hide sidebar' }).click()
      await resizeWindow(app, bar, width, height)
      await frames()
      const where = `${width}×${height}, the sidebar ${sidebar}`
      const now = await layout()
      const before = await asBefore()
      test.info().annotations.push({ type: 'pickers', description: `${where}: ${JSON.stringify(now)}; with the captions always shown: ${JSON.stringify(before)}` })
      // A caption shown has its value whole.
      for (const [name, picker] of [['model', now.model], ['permission mode', now.mode]] as const) {
        if (picker.caption) expect(picker.cut, `the ${name}'s value under its caption, ${where}`).toBe(false)
      }
      // No line more than with the captions always shown, or with the native lists; Send keeps its line.
      expect(now.bar, `the bar, ${where}`).toBe(before.bar)
      expect((await barHeights(window, bar)).withNativeLists, `the bar with the native lists, ${where}`).toBeGreaterThanOrEqual(now.bar)
      expect(now.sendOnTheirLine, `Send on the pickers' line, ${where}`).toBe(before.sendOnTheirLine)
      // Buttons wider than the room overflow on the right, as before, not out of the bar on the left.
      expect((await box(model)).x, `the model's left edge, ${where}`).toBeGreaterThanOrEqual((await box(pickers)).x - 0.5)
      // The captions are for the eye: the names and the titles of the buttons stay.
      await expect(model).toHaveAccessibleName('Model')
      await expect(model).toHaveAttribute('title', 'Default (recommended)')
      await expect(mode).toHaveAccessibleName('Permission mode')
      await expect(mode).toHaveAttribute('title', 'Bypass permissions')
      if (width === 1320) {
        // The model's value was cut: its caption goes, and more of the value shows; the permission mode is whole.
        expect(before.model.cut, where).toBe(true)
        expect(now.model.caption, where).toBe(false)
        expect(now.model.value, where).toBeGreaterThan(before.model.value)
        expect(now.mode.cut, where).toBe(false)
      } else if (width === 1920) {
        expect([now.model, now.mode], where).toEqual([expect.objectContaining({ caption: true, cut: false }), expect.objectContaining({ caption: true, cut: false })])
      } else {
        expect([now.model.caption, now.mode.caption], where).toEqual([false, false])
        expect(now.mode.value, where).toBeGreaterThan(Math.max(5, before.mode.value))
      }
      if (sidebar === 'shown') {
        for (const scheme of ['light', 'dark'] as const) {
          await window.emulateMedia({ colorScheme: scheme })
          await view.getByTestId('message-input').screenshot({ path: test.info().outputPath(`composer-captions-${width}x${height}-${scheme}.png`) })
        }
        await window.emulateMedia({ colorScheme: null })
      }
    }

    // Both captions gone at the narrow end, both shown at the wide one, the pickers on one line between.
    await resizeWindow(app, bar, 1000, 900)
    await frames()
    expect([(await shows(model)).caption, (await shows(mode)).caption], 'the captions at 1000 px').toEqual([false, false])

    // A slow resize across the widths where the captions come back, and back again: each caption
    // turns on once and off once. Every change of a button's class is written down as it happens.
    await pickers.evaluate((element) => {
      const changes: string[] = []
      ;(globalThis as unknown as { captionChanges: string[] }).captionChanges = changes
      const bare = (className: string | null): boolean => (className ?? '').split(' ').includes('w-pickers__select--bare')
      type Record = { oldValue: string | null }
      const { MutationObserver: Observer } = globalThis as unknown as {
        MutationObserver: new (callback: (records: Record[]) => void) => { observe(target: unknown, options: object): void }
      }
      for (const button of element.querySelectorAll('[data-testid="picker-model"], [data-testid="picker-permissions"]')) {
        new Observer((records) => {
          records.forEach((record, at) => {
            const next = at + 1 < records.length ? (records[at + 1]?.oldValue ?? null) : button.getAttribute('class')
            if (bare(record.oldValue) !== bare(next)) changes.push(`${button.getAttribute('data-testid') ?? ''} ${bare(next) ? 'off' : 'on'}`)
          })
        }).observe(button, { attributes: true, attributeFilter: ['class'], attributeOldValue: true })
      }
    })
    const changes = (): Promise<string[]> => window.evaluate(() => [...(globalThis as unknown as { captionChanges: string[] }).captionChanges])
    const sweep = async (from: number, to: number): Promise<void> => {
      for (let width = from; from < to ? width <= to : width >= to; width += from < to ? 4 : -4) {
        await resizeWindow(app, bar, width, 900)
        await frames()
      }
    }
    // The pickers have the controls line of the bar (worfy-throughput ticket 60), with the Eco mode
    // switch of the Orchestrator after them: with the sidebar hidden the permission mode's caption
    // comes back at about 1064 px and the model's at about 1104 px (the switch's own, the first to
    // go, at about 1168 px).
    await sweep(1000, 1200)
    expect([(await shows(model)).caption, (await shows(mode)).caption], 'the captions at 1200 px').toEqual([true, true])
    expect(await changes(), 'widening').toEqual(['picker-permissions on', 'picker-model on'])
    await sweep(1200, 1000)
    expect(await changes(), 'widening, then narrowing').toEqual(['picker-permissions on', 'picker-model on', 'picker-model off', 'picker-permissions off'])
  } finally {
    await launched.close()
  }
})
