import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'
import { TERMINAL_AI_PROMPT, editedLine, openTerminal, screenText, terminalAiSandbox, type TerminalAiSandbox } from './terminal-ai-helpers'
import { NO_ZSH, NO_ZSH_ON_WINDOWS } from './zsh'
import { shellCaughtUp } from './wait'

// Command request of Terminal AI from the ⌘I panel, in a Terminal Node of the built app on a real
// zsh: ⌘I opens the panel over the screen, Enter asks the assist process, the command of its answer
// lands in the line of the shell, the panel closes and the focus is back in the terminal. The
// command runs only when the test presses Enter. The assist process is the fake (WORFY_AGENT=fake):
// no Claude Code is started and the subscription is not spent.
//
// HOME is a temporary folder and SHELL the zsh of the machine (terminal-ai-helpers.ts): no startup
// file and no history of the machine running the tests is read or written.

/** Where the screenshots of the panel go when the run asks for them (the evidence of the ticket). */
const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

test.skip(NO_ZSH, NO_ZSH_ON_WINDOWS)

let sandbox: TerminalAiSandbox

test.beforeEach(() => {
  sandbox = terminalAiSandbox()
})

test.afterEach(async () => {
  await sandbox.remove()
})

interface TextContrast {
  what: string
  ratio: number
}

/** The contrast of every text of the panel against the colour behind it (WCAG 2 relative luminance). */
function textContrasts(panel: Locator): Promise<TextContrast[]> {
  return panel.evaluate((root) => {
    interface El {
      parentElement: El | null
      querySelector(selector: string): El | null
    }
    const view = (root as unknown as { ownerDocument: { defaultView: { getComputedStyle(element: unknown, pseudo?: string): { color: string; backgroundColor: string } } } }).ownerDocument.defaultView
    const parse = (color: string): [number, number, number, number] => {
      const parts = /^rgba?\(([^)]+)\)$/.exec(color)?.[1]?.split(/[\s,/]+/).filter((part) => part !== '').map(Number)
      if (parts === undefined || parts.length < 3 || parts.some((part) => !Number.isFinite(part))) throw new Error(`a colour this test cannot read: ${color}`)
      return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1]
    }
    const luminance = ([r, g, b]: [number, number, number, number]): number => {
      const channel = (value: number): number => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4)
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    const behind = (element: El): [number, number, number, number] => {
      for (let at: El | null = element; at !== null; at = at.parentElement) {
        const background = parse(view.getComputedStyle(at).backgroundColor)
        if (background[3] === 1) return background
        if (background[3] !== 0) throw new Error('a half-transparent background: this test does not blend colours')
      }
      throw new Error('no opaque background behind the text')
    }
    const ratio = (element: El, pseudo?: string): number => {
      const text = luminance(parse(view.getComputedStyle(element, pseudo).color))
      const background = luminance(behind(element))
      return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05)
    }
    const panel = root as unknown as El
    const of = (selector: string): El => {
      const found = panel.querySelector(selector)
      if (found === null) throw new Error(`no ${selector} in the panel`)
      return found
    }
    return [
      { what: 'key', ratio: ratio(of('.w-terminal-request__key')) },
      { what: 'field', ratio: ratio(of('.w-terminal-request__field')) },
      { what: 'placeholder', ratio: ratio(of('.w-terminal-request__field'), '::placeholder') },
      { what: 'note', ratio: ratio(of('.w-terminal-request__note')) },
    ]
  })
}

/** In the light and in the dark theme: every text of the panel has a contrast of 4.5:1 or more, and — when the run asks for evidence — a screenshot of the Node. */
async function inBothThemes(window: Page, node: Locator, panel: Locator): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    const low = (await textContrasts(panel)).filter(({ ratio }) => ratio < 4.5)
    expect(low.map(({ what, ratio }) => `${scheme} ${what} ${ratio.toFixed(2)}:1`)).toEqual([])
    if (EVIDENCE_DIR !== undefined) await node.screenshot({ path: join(EVIDENCE_DIR, `06-request-panel-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('⌘I opens the panel over the Terminal; Enter puts the command of the answer into the line; it runs only on Enter in the terminal', async () => {
  // Unique to this run: no history has a command with it.
  const mark = `worfy-tai-${Date.now().toString(36)}-${process.pid}`
  const words = `print the mark ${mark}`
  const answer = `echo ${mark} done`
  // As a model writes it: in backticks. The answer takes a moment, as Sonnet does.
  sandbox.answers([{ feature: 'request', match: mark, answer: `\`${answer}\``, delayMs: 300 }])
  const launched = await launchApp({ env: sandbox.env })
  try {
    const { window } = launched
    const node = await openTerminal(window)
    const panel = node.getByRole('dialog', { name: 'Command request' })
    const field = panel.getByRole('textbox', { name: 'Describe the command' })

    // The panel is there once main has said the zsh of this Terminal is connected.
    await expect(async () => {
      await node.getByTestId('terminal-screen').click()
      await window.keyboard.press('Meta+I')
      await expect(panel).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
    await expect(field).toBeFocused()
    // ⌘I did not reach the shell: the line is empty.
    expect(await editedLine(node)).toBe(TERMINAL_AI_PROMPT.trimEnd())

    await window.keyboard.type(words)
    await inBothThemes(window, node, panel)
    await window.keyboard.press('Enter')

    // The answer: the panel is gone, and the line of the shell is the command.
    await expect(panel).toBeHidden({ timeout: 15_000 })
    await expect.poll(() => editedLine(node), { timeout: 10_000 }).toBe(`${TERMINAL_AI_PROMPT}${answer}`)
    // The model was asked once, for the words of the panel, and it was Sonnet.
    const requests = sandbox.requests()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ feature: 'request', model: 'sonnet', cancelled: false, context: { request: words, line: '', cwd: sandbox.root } })

    // Nothing ran: once the shell has read all it was given, the output of the command is not on the screen.
    const output = new RegExp(`^${mark} done$`, 'gm')
    await shellCaughtUp(window, node, `${TERMINAL_AI_PROMPT}${answer}`)
    expect([...(await screenText(node)).matchAll(output)]).toHaveLength(0)

    // The focus is back in the terminal: Enter there runs the command, once.
    await window.keyboard.press('Enter')
    await expect.poll(async () => [...(await screenText(node)).matchAll(output)].length, { timeout: 10_000 }).toBe(1)
  } finally {
    await launched.close()
  }
})

test('Esc closes the panel without asking, and the focus is back in the terminal', async () => {
  const mark = `worfy-tai-${Date.now().toString(36)}-${process.pid}`
  sandbox.answers([{ feature: 'request', answer: 'echo never-asked' }])
  const launched = await launchApp({ env: sandbox.env })
  try {
    const { window } = launched
    const node = await openTerminal(window)
    const panel = node.getByRole('dialog', { name: 'Command request' })
    await expect(async () => {
      await node.getByTestId('terminal-screen').click()
      await window.keyboard.press('Meta+I')
      await expect(panel).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 15_000 })
    await window.keyboard.type('anything at all')
    await window.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    // What is typed now goes to the shell.
    await window.keyboard.type(`echo ${mark}`)
    await expect.poll(() => editedLine(node), { timeout: 10_000 }).toBe(`${TERMINAL_AI_PROMPT}echo ${mark}`)
    expect(sandbox.requests()).toEqual([])
  } finally {
    await launched.close()
  }
})
