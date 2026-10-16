import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, openSecondWindow } from './helpers'
import { NO_ZSH, NO_ZSH_ON_WINDOWS, zshPath } from './zsh'

// The Suggestion of Terminal AI from the history of commands, in a Terminal Node of the built app
// on a real zsh: a command that ran is offered again in grey when its start is typed, → and
// Alt+→ take it, and a second window on the same Terminal shows the same grey text, because the
// shell draws it itself. No model is asked: the history is the shell's own.
//
// SHELL is the zsh of the machine and HOME a temporary folder with its own .zshrc, so no startup
// file and no history of the machine running the tests is read, and none is written. The command
// carries a mark of its own all the same. Windows has no zsh: the test is skipped there.

test.skip(NO_ZSH, NO_ZSH_ON_WINDOWS)

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
/** Where the screenshots of the grey text go when the run is asked for them (the evidence of the ticket). */
const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

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
  // A short prompt and a history that is kept: what a user's .zshrc usually sets.
  writeFileSync(join(home, '.zshrc'), "PS1='e2e%# '\nHISTSIZE=1000\nSAVEHIST=1000\n")
})

test.afterEach(async () => {
  await removeDir(scratch)
})

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
  return (await node.locator('.xterm-rows').innerText()).replace(/\u00a0/g, ' ')
}

/** The line being edited: the last line of the screen that starts with the prompt. */
async function editedLine(node: Locator): Promise<string> {
  const lines = (await screenText(node)).split('\n').filter((line) => line.startsWith('e2e% '))
  return (lines.at(-1) ?? '').replace(/\s+$/, '')
}

interface GreyText {
  text: string
  color: string
}

/**
 * The grey text on the screen, as xterm.js drew it: the cells with the bright black of the palette
 * (colour 8, the class xterm-fg-8 of its DOM renderer), and the colour they are painted with.
 */
async function greyText(node: Locator): Promise<GreyText> {
  return node.locator('.xterm-rows').evaluate((rows) => {
    const view = (rows as unknown as { ownerDocument: { defaultView: { getComputedStyle(element: unknown): { color: string } } } }).ownerDocument.defaultView
    const cells = [...(rows as unknown as { querySelectorAll(selector: string): Iterable<{ textContent: string | null }> }).querySelectorAll('.xterm-fg-8')]
    const first = cells[0]
    return { text: cells.map((cell) => cell.textContent ?? '').join('').replace(/\u00a0/g, ' '), color: first === undefined ? '' : view.getComputedStyle(first).color }
  })
}

/** The colour of the text the user typed: the terminal's own foreground. */
function typedColor(node: Locator): Promise<string> {
  return node.locator('.xterm-rows').evaluate((rows) => {
    const view = (rows as unknown as { ownerDocument: { defaultView: { getComputedStyle(element: unknown): { color: string } } } }).ownerDocument.defaultView
    return view.getComputedStyle(rows).color
  })
}

test('a command that ran is suggested in grey from the history; → and Alt+→ take it; a second window shows the same grey text', async () => {
  // Unique to this run: nothing else in any history starts with it.
  const mark = `worfy-tai-${Date.now().toString(36)}-${process.pid}`
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, SHELL: zshPath(), HOME: home, skip_global_compinit: '1' } })
  try {
    const { window } = launched
    const node = await newTerminal(window)
    const screen = node.getByTestId('terminal-screen')
    await screen.click()
    await expect.poll(() => screenText(node), { timeout: 15_000 }).toMatch(/^e2e% /m)

    // The command runs once: its output is one line that is the mark and two more words.
    await window.keyboard.type(`echo ${mark} second third`)
    await window.keyboard.press('Enter')
    const output = new RegExp(`^${mark} second third$`, 'gm')
    await expect.poll(async () => [...(await screenText(node)).matchAll(output)].length, { timeout: 10_000 }).toBe(1)

    // The same Terminal in a second window, before anything is typed.
    const second = await openSecondWindow(launched)
    const node2 = second.locator('.react-flow__node').getByTestId('terminal-node')
    await expect(node2).toHaveAttribute('data-state', 'running')
    expect(await node2.getAttribute('data-pid')).toBe(await node.getAttribute('data-pid'))

    // Its start typed again: the rest of it is on the screen in grey, after the cursor.
    await screen.click()
    await window.keyboard.type('echo wo')
    const rest = `${mark.slice('wo'.length)} second third`
    await expect.poll(async () => (await greyText(node)).text, { timeout: 10_000 }).toBe(rest)
    expect(await editedLine(node)).toBe(`e2e% echo ${mark} second third`)
    // Grey is another colour than what was typed, not only another class.
    const grey = await greyText(node)
    expect(grey.color).not.toBe('')
    expect(grey.color).not.toBe(await typedColor(node))
    // The second window shows the same line with the same part of it in grey.
    await expect.poll(async () => (await greyText(node2)).text, { timeout: 10_000 }).toBe(rest)
    expect(await editedLine(node2)).toBe(`e2e% echo ${mark} second third`)

    if (EVIDENCE_DIR !== undefined) {
      for (const scheme of ['light', 'dark'] as const) {
        await window.emulateMedia({ colorScheme: scheme })
        await window.screenshot({ path: join(EVIDENCE_DIR, `03-suggestion-${scheme}.png`) })
      }
      await window.emulateMedia({ colorScheme: null })
    }

    // Alt+→ takes one word: the mark; the two words after it stay grey.
    await window.keyboard.press('Alt+ArrowRight')
    await expect.poll(async () => (await greyText(node)).text, { timeout: 10_000 }).toBe(' second third')
    await expect.poll(async () => (await greyText(node2)).text, { timeout: 10_000 }).toBe(' second third')
    // → takes the rest: nothing grey is left, and Enter runs the whole command a second time.
    await window.keyboard.press('ArrowRight')
    await expect.poll(async () => (await greyText(node)).text, { timeout: 10_000 }).toBe('')
    expect(await editedLine(node)).toBe(`e2e% echo ${mark} second third`)
    await window.keyboard.press('Enter')
    await expect.poll(async () => [...(await screenText(node)).matchAll(output)].length, { timeout: 10_000 }).toBe(2)
    await expect.poll(async () => [...(await screenText(node2)).matchAll(output)].length, { timeout: 10_000 }).toBe(2)
    // Nothing of worfy's is in the environment of what the shell runs.
    await window.keyboard.type('echo "env-$(env | grep -c WORFY_)"')
    await window.keyboard.press('Enter')
    await expect.poll(() => screenText(node), { timeout: 10_000 }).toMatch(/^env-0$/m)
  } finally {
    await launched.close()
  }
})
