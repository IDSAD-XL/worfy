import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeSettings, launchApp, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'
import { NO_ZSH, NO_ZSH_ON_WINDOWS, zshPath } from './zsh'

// Settings → "Terminal AI" against the built app:
// - the switches reach a zsh that is already running: with "Suggestion" off, and with "Terminal AI"
//   off, the start of a command that ran brings no grey text; with both on it does;
// - the section in both themes: every switch, the model of Next command, the keys, the contrast of
//   its text, and the rows a switch holds off;
// - a feature the Limits stopped says until when.
// No model is asked: the grey text is the Suggestion from the shell's own history.
//
// SHELL is the zsh of the machine and HOME a temporary folder with its own .zshrc, so no startup
// file and no history of the machine running the tests is read, and none is written. The command
// carries a mark of its own all the same. Windows has no zsh: there the app keeps its own shell,
// the section's tests run, and the one that needs a running zsh is skipped.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
/** SETTINGS_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron, so it is not imported here. */
const SETTINGS_MENU_ITEM_ID = 'app.settings'
/** Where the screenshots of the section go when the run is asked for them (the evidence of the ticket). */
const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

/** The switches of the section, top to bottom, and the model of Next command where it stands among them. */
const SWITCHES = ['Terminal AI', 'Suggestion', 'Ask Claude when history has nothing', 'Next command', 'Command request', 'Fix']
const MODEL = 'Next command model'

let scratch: string
let dataDir: string
let root: string
let home: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-tai-')))
  dataDir = join(scratch, 'data')
  root = join(scratch, 'alpha')
  home = join(scratch, 'home')
  mkdirSync(root)
  mkdirSync(home)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: root }], activeId: PROJECT }))
  // A short prompt, a history that is kept, and the emacs keys whatever EDITOR says: Ctrl+U empties the line.
  writeFileSync(join(home, '.zshrc'), "PS1='e2e%# '\nHISTSIZE=1000\nSAVEHIST=1000\nbindkey -e\n")
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, ...(NO_ZSH ? {} : { SHELL: zshPath() }), HOME: home, skip_global_compinit: '1' } })

function invokeIn<T>(window: Page, channel: string, input: unknown): Promise<{ ok: boolean; value: T }> {
  return window.evaluate(
    ({ channel, input }) => (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<{ ok: boolean; value: T }> } }).worfy.invoke(channel, input),
    { channel, input },
  ) as Promise<{ ok: boolean; value: T }>
}

/** Where the Orchestrator Node is moved to keep the top left of the Canvas empty: off the screen. */
const ORCHESTRATOR_AWAY = { x: 2400, y: 1600 }

/** Moves the Orchestrator Node off the screen, as test/e2e/terminal.spec.ts does: the terminal goes where main puts it. */
async function moveOrchestratorAway(window: Page): Promise<boolean> {
  const result = await invokeIn<{ layout: { nodes: { id: string; kind: string; x: number; y: number }[] } }>(window, 'layout.get', { projectId: PROJECT })
  expect(result.ok).toBe(true)
  const orchestrators = result.value.layout.nodes.filter((node) => node.kind === 'orchestrator')
  for (const node of orchestrators) {
    if (node.x === ORCHESTRATOR_AWAY.x && node.y === ORCHESTRATOR_AWAY.y) continue
    expect(await invokeIn(window, 'layout.apply', { projectId: PROJECT, op: { op: 'move', id: node.id, ...ORCHESTRATOR_AWAY } })).toMatchObject({ ok: true })
  }
  return orchestrators.length > 0
}

/** Right click on an empty spot of the Canvas, then "New terminal". */
async function newTerminal(window: Page): Promise<Locator> {
  const at = { x: 80, y: 60 }
  const pane = window.locator('.react-flow__pane')
  await expect
    .poll(
      async () => {
        if (!(await moveOrchestratorAway(window))) return false
        return pane.evaluate((element, point) => {
          const box = element.getBoundingClientRect()
          // The e2e tsconfig has no DOM lib: the page's document is reached through the element.
          const { ownerDocument } = element as unknown as { ownerDocument: { elementFromPoint(x: number, y: number): unknown } }
          return ownerDocument.elementFromPoint(box.x + point.x, box.y + point.y) === element
        }, at)
      },
      { message: 'no Orchestrator Node moved away, or the Canvas is not empty where the terminal goes' },
    )
    .toBe(true)
  await pane.click({ button: 'right', position: at })
  const menu = window.getByRole('menu', { name: 'Canvas' })
  await menu.getByRole('menuitem', { name: 'New terminal' }).click()
  await expect(menu).toBeHidden()
  const node = window.getByTestId('terminal-node')
  await expect(node).toHaveCount(1)
  await expect(node).toHaveAttribute('data-state', 'running')
  return node
}

/** What the terminal shows; xterm.js draws spaces as no-break spaces. */
async function screenText(node: Locator): Promise<string> {
  return (await node.locator('.xterm-rows').innerText()).replaceAll(String.fromCharCode(0xa0), ' ')
}

/** The line being edited: the last line of the screen that starts with the prompt. */
async function editedLine(node: Locator): Promise<string> {
  const lines = (await screenText(node)).split('\n').filter((line) => line.startsWith('e2e% '))
  return (lines.at(-1) ?? '').replace(/\s+$/, '')
}

/** The grey text on the screen, as xterm.js drew it: the cells with the bright black of the palette (the class xterm-fg-8 of its DOM renderer). */
async function greyText(node: Locator): Promise<string> {
  return node.locator('.xterm-rows').evaluate((rows) => {
    const cells = [...(rows as unknown as { querySelectorAll(selector: string): Iterable<{ textContent: string | null }> }).querySelectorAll('.xterm-fg-8')]
    return cells.map((cell) => cell.textContent ?? '').join('').replaceAll(String.fromCharCode(0xa0), ' ')
  })
}

/** Opens Settings → Terminal AI the way a person does: "Settings…" of the app menu, then the row of the section list. */
async function openTerminalAi(launched: Pick<LaunchedApp, 'app' | 'window'>): Promise<Locator> {
  await clickMenuItem(launched.app, SETTINGS_MENU_ITEM_ID)
  const dialog = launched.window.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Terminal AI', exact: true }).click()
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Terminal AI')
  await expect(dialog.getByRole('switch', { name: 'Terminal AI', exact: true })).toBeVisible()
  return dialog
}

const switchOf = (dialog: Locator, name: string): Locator => dialog.getByRole('switch', { name, exact: true })

/** What main saved: <WORFY_DATA_DIR>/terminal-ai.json; nothing until the first change. */
function savedSettings(): Record<string, unknown> | undefined {
  const file = join(dataDir, 'terminal-ai.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : undefined
}

interface TextContrast {
  what: string
  text: string
  ratio: number
}

/**
 * The contrast of every text of the section against what is painted behind it (WCAG 2 relative
 * luminance): the labels, the hints, the lines that say what holds a row off or that the Limits
 * paused it, and the model's button while it takes a click.
 */
function textContrasts(dialog: Locator): Promise<TextContrast[]> {
  return dialog.getByTestId('settings-terminal-ai').evaluate((section) => {
    interface El {
      textContent: string | null
      parentElement: El | null
      querySelectorAll(selector: string): Iterable<El>
    }
    const view = (section as unknown as { ownerDocument: { defaultView: { getComputedStyle(element: unknown): { color: string; backgroundColor: string } } } }).ownerDocument.defaultView
    const parse = (color: string): [number, number, number, number] => {
      const parts = /^rgba?\(([^)]+)\)$/.exec(color)?.[1]?.split(/[\s,/]+/).filter((part) => part !== '').map(Number)
      if (parts === undefined || parts.length < 3 || parts.some((part) => !Number.isFinite(part))) throw new Error(`a colour this test cannot read: ${color}`)
      return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1]
    }
    const luminance = ([r, g, b]: [number, number, number, number]): number => {
      const channel = (value: number): number => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4)
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    /** The first opaque background behind `element`. */
    const behind = (element: El): [number, number, number, number] => {
      for (let at: El | null = element; at !== null; at = at.parentElement) {
        const background = parse(view.getComputedStyle(at).backgroundColor)
        if (background[3] === 1) return background
        if (background[3] !== 0) throw new Error('a half-transparent background: this test does not blend colours')
      }
      throw new Error('no opaque background behind the text')
    }
    const kinds: [what: string, selector: string][] = [
      ['label', '.w-setting-row__label'],
      ['hint', '.w-setting-row__description'],
      ['note', '[data-testid$="-note"]'],
      ['paused', '[data-testid$="-status"]'],
      ['model', '[role="combobox"]:not(:disabled)'],
    ]
    const root = section as unknown as El
    return kinds.flatMap(([what, selector]) =>
      [...root.querySelectorAll(selector)].map((element) => {
        const text = luminance(parse(view.getComputedStyle(element).color))
        const background = luminance(behind(element))
        return { what, text: (element.textContent ?? '').trim(), ratio: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05) }
      }),
    )
  })
}

/**
 * In the light and in the dark theme: every text of the section has a contrast of 4.5:1 or more
 * (docs/design/F-SPEC.md), and — when the run asks for evidence — a screenshot of the Settings window.
 */
async function inBothThemes(window: Page, dialog: Locator, shot: string, kinds: string[]): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    const contrasts = await textContrasts(dialog)
    // Every kind of text this state has was measured: a selector that matches nothing fails here.
    expect([...new Set(contrasts.map(({ what }) => what))].sort()).toEqual([...kinds].sort())
    expect(contrasts.filter(({ ratio }) => ratio < 4.5).map(({ what, text, ratio }) => `${scheme} ${what} "${text}" ${ratio.toFixed(2)}:1`)).toEqual([])
    if (EVIDENCE_DIR !== undefined) await dialog.screenshot({ path: join(EVIDENCE_DIR, `${shot}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('Suggestion off, and Terminal AI off, take the grey text from a zsh that is already running; on again brings it back', async () => {
  test.skip(NO_ZSH, NO_ZSH_ON_WINDOWS)
  // Unique to this run: nothing else in any history starts with it.
  const mark = `worfy-tai-${Date.now().toString(36)}-${process.pid}`
  const rest = `${mark.slice('wo'.length)} second third`
  const launched = await launch()
  try {
    const { window } = launched
    const node = await newTerminal(window)
    const screen = node.getByTestId('terminal-screen')

    /** Empties the line and types the start of the command that ran. */
    const typeStart = async (): Promise<void> => {
      await screen.click()
      await window.keyboard.press('Control+U')
      await window.keyboard.type('echo wo')
    }
    // The shell learns of a change of Settings when zsh next waits for a key, so both ways the line
    // is typed again until the screen shows what the setting gives.
    const expectGrey = (): Promise<void> =>
      expect(async () => {
        await typeStart()
        await expect.poll(() => greyText(node), { timeout: 2_000 }).toBe(rest)
        expect(await editedLine(node)).toBe(`e2e% echo ${mark} second third`)
      }).toPass({ timeout: 20_000 })
    const expectNoGrey = (): Promise<void> =>
      expect(async () => {
        await typeStart()
        // The line is what was typed and nothing after it, and stays so letter after letter: each
        // letter makes zsh look in the history and draw the line again.
        let typed = 'echo wo'
        for (const letter of ['', 'r', 'f', 'y']) {
          if (letter !== '') await window.keyboard.type(letter)
          typed += letter
          await expect.poll(() => editedLine(node), { timeout: 2_000 }).toBe(`e2e% ${typed}`)
          expect(await greyText(node)).toBe('')
        }
      }).toPass({ timeout: 20_000 })

    await screen.click()
    await expect.poll(() => screenText(node), { timeout: 15_000 }).toMatch(/^e2e% /m)
    // The command runs once: its output is one line that is the mark and two more words.
    await window.keyboard.type(`echo ${mark} second third`)
    await window.keyboard.press('Enter')
    const output = new RegExp(`^${mark} second third$`, 'gm')
    await expect.poll(async () => [...(await screenText(node)).matchAll(output)].length, { timeout: 10_000 }).toBe(1)

    // Everything is on from the start: the rest of the command is grey after its start.
    await expectGrey()
    expect(savedSettings()).toBeUndefined()

    // "Suggestion" off, with a click.
    let dialog = await openTerminalAi(launched)
    await expect(switchOf(dialog, 'Suggestion')).toHaveAttribute('aria-checked', 'true')
    await switchOf(dialog, 'Suggestion').click()
    await expect(switchOf(dialog, 'Suggestion')).toHaveAttribute('aria-checked', 'false')
    await expect(switchOf(dialog, 'Ask Claude when history has nothing')).toBeDisabled()
    await expect(dialog.getByTestId('terminal-ai-suggestion-model-note')).toHaveText('Off while Suggestion is off.')
    await closeSettings(window)
    await expectNoGrey()
    expect(savedSettings()).toMatchObject({ enabled: true, suggestion: false })

    // On again, from the keyboard: the same line gets its grey text back.
    dialog = await openTerminalAi(launched)
    await switchOf(dialog, 'Suggestion').focus()
    await window.keyboard.press('Space')
    await expect(switchOf(dialog, 'Suggestion')).toHaveAttribute('aria-checked', 'true')
    await expect(switchOf(dialog, 'Ask Claude when history has nothing')).toBeEnabled()
    await closeSettings(window)
    await expectGrey()

    // "Terminal AI" off: no grey text from the history either, though "Suggestion" itself is still on.
    dialog = await openTerminalAi(launched)
    await switchOf(dialog, 'Terminal AI').click()
    await expect(switchOf(dialog, 'Terminal AI')).toHaveAttribute('aria-checked', 'false')
    await expect(switchOf(dialog, 'Suggestion')).toHaveAttribute('aria-checked', 'true')
    await expect(switchOf(dialog, 'Suggestion')).toBeDisabled()
    await closeSettings(window)
    await expectNoGrey()
    expect(savedSettings()).toMatchObject({ enabled: false, suggestion: true })

    // And on again.
    dialog = await openTerminalAi(launched)
    await switchOf(dialog, 'Terminal AI').click()
    await expect(switchOf(dialog, 'Terminal AI')).toHaveAttribute('aria-checked', 'true')
    await closeSettings(window)
    await expectGrey()
  } finally {
    await launched.close()
  }
})

test('the section shows every switch and the model, works from the keyboard, and reads in both themes', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const dialog = await openTerminalAi(launched)
    const model = dialog.getByRole('combobox', { name: MODEL, exact: true })

    // Everything is on and Next command asks Sonnet until the user says otherwise.
    await expect(dialog.getByRole('switch')).toHaveCount(SWITCHES.length)
    expect(await dialog.getByRole('switch').evaluateAll((switches) => switches.map((element) => element.getAttribute('aria-label')))).toEqual(SWITCHES)
    for (const name of SWITCHES) {
      await expect(switchOf(dialog, name)).toHaveAttribute('aria-checked', 'true')
      await expect(switchOf(dialog, name)).toBeEnabled()
    }
    await expect(model).toHaveText('Sonnet')
    await expect(dialog.getByTestId('terminal-ai-zsh')).toHaveText('Works in zsh Terminals.')
    await expect(dialog.getByText(/Paused by Limits/)).toHaveCount(0)
    await inBothThemes(window, dialog, '08-settings', ['label', 'hint', 'model'])

    // Tab walks the controls top to bottom; the model stands after "Next command".
    await switchOf(dialog, 'Terminal AI').focus()
    for (const name of ['Suggestion', 'Ask Claude when history has nothing', 'Next command']) {
      await window.keyboard.press('Tab')
      await expect(switchOf(dialog, name)).toBeFocused()
    }
    await window.keyboard.press('Tab')
    await expect(model).toBeFocused()
    // The model from the keyboard: ↓ opens the list on Sonnet, ↓ goes to Haiku, Enter takes it.
    await window.keyboard.press('ArrowDown')
    await expect(window.getByRole('listbox', { name: MODEL })).toBeVisible()
    await window.keyboard.press('ArrowDown')
    await window.keyboard.press('Enter')
    await expect(model).toHaveText('Haiku')
    await expect.poll(savedSettings).toMatchObject({ nextCommandModel: 'haiku' })
    for (const name of ['Command request', 'Fix']) {
      await window.keyboard.press('Tab')
      await expect(switchOf(dialog, name)).toBeFocused()
    }
    // Space on a switch turns it.
    await window.keyboard.press('Space')
    await expect(switchOf(dialog, 'Fix')).toHaveAttribute('aria-checked', 'false')
    await expect.poll(savedSettings).toMatchObject({ fix: false, commandRequest: true, nextCommandModel: 'haiku' })

    // "Next command" off holds its model off, and the row says so in words.
    await switchOf(dialog, 'Next command').click()
    await expect(model).toBeDisabled()
    await expect(dialog.getByTestId('terminal-ai-next-model-note')).toHaveText('Off while Next command is off.')
    await switchOf(dialog, 'Next command').click()
    await expect(model).toBeEnabled()

    // "Terminal AI" off holds everything under it off; what was chosen under it stays shown.
    await switchOf(dialog, 'Terminal AI').click()
    for (const name of SWITCHES.slice(1)) await expect(switchOf(dialog, name)).toBeDisabled()
    await expect(model).toBeDisabled()
    await expect(model).toHaveText('Haiku')
    await expect(switchOf(dialog, 'Fix')).toHaveAttribute('aria-checked', 'false')
    await expect(switchOf(dialog, 'Suggestion')).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByText('Off while Terminal AI is off.')).toHaveCount(6)
    // A switch that is held off takes no key and no click.
    await switchOf(dialog, 'Suggestion').click({ force: true })
    await expect(switchOf(dialog, 'Suggestion')).toHaveAttribute('aria-checked', 'true')
    await inBothThemes(window, dialog, '08-settings-off', ['label', 'hint', 'note'])
    await closeSettings(window)

    // Settings opened again shows what was saved.
    const again = await openTerminalAi(launched)
    await expect(switchOf(again, 'Terminal AI')).toHaveAttribute('aria-checked', 'false')
    await expect(again.getByRole('combobox', { name: MODEL, exact: true })).toHaveText('Haiku')
    expect(savedSettings()).toMatchObject({ enabled: false, suggestion: true, suggestionAsksModel: true, nextCommand: true, nextCommandModel: 'haiku', commandRequest: true, fix: false })
  } finally {
    await launched.close()
  }
})

test('a feature the Limits stopped says "Paused by Limits until …" with the time the window resets', async () => {
  // The 5-hour window is used above 80 %: Suggestion from the model and Next command stop until it
  // resets; Command request and Fix, asked for by the user, go on.
  const resetsAt = Math.floor(Date.now() / 1000) + 40 * 60
  writeFileSync(join(dataDir, 'limits.json'), JSON.stringify({ windows: { five_hour: { utilization: 0.92, resetsAt, status: 'allowed', receivedAt: Date.now(), source: 'sdk' } } }))
  const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(resetsAt * 1000)
  // The day is named too when the window resets after midnight.
  const paused = new RegExp(`^Paused by Limits until (?:[A-Z][a-z]{2} )?${clock}$`)

  const launched = await launch()
  try {
    const { window } = launched
    const dialog = await openTerminalAi(launched)

    await expect(dialog.getByTestId('terminal-ai-suggestion-model-status')).toHaveText(paused)
    await expect(dialog.getByTestId('terminal-ai-next-status')).toHaveText(paused)
    await expect(dialog.getByText(/Paused by Limits/)).toHaveCount(2)
    // The switches stay as the user set them.
    for (const name of SWITCHES) {
      await expect(switchOf(dialog, name)).toHaveAttribute('aria-checked', 'true')
      await expect(switchOf(dialog, name)).toBeEnabled()
    }
    await inBothThemes(window, dialog, '08-settings-paused', ['label', 'hint', 'paused', 'model'])

    // A feature turned off in Settings is off, not paused.
    await switchOf(dialog, 'Next command').click()
    await expect(dialog.getByTestId('terminal-ai-next-status')).toHaveCount(0)
    await expect(dialog.getByText(/Paused by Limits/)).toHaveCount(1)
    await switchOf(dialog, 'Next command').click()
    await expect(dialog.getByTestId('terminal-ai-next-status')).toHaveText(paused)
  } finally {
    await launched.close()
  }
})
