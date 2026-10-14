import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'
import { TERMINAL_AI_PROMPT, editedLine, openTerminal, screenText, terminalAiSandbox, type TerminalAiSandbox } from './terminal-ai-helpers'

// Fix of Terminal AI in a Terminal Node of the built app on a real zsh: after a command that failed,
// "Fix" is in the header of the Node; a click asks the assist process, the corrected command of its
// answer lands in the line of the shell, and it runs only when the test presses Enter. The assist
// process is the fake (WORFY_AGENT=fake): no Claude Code is started and the subscription is not spent.
//
// HOME is a temporary folder and SHELL the zsh of the machine (terminal-ai-helpers.ts): no startup
// file and no history of the machine running the tests is read or written.

/** Where the screenshots of the button go when the run asks for them (the evidence of the ticket). */
const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

const FAILING = 'ls /nonexistent-worfy'

let sandbox: TerminalAiSandbox

test.beforeEach(() => {
  sandbox = terminalAiSandbox()
})

test.afterEach(async () => {
  await sandbox.remove()
})

/** The contrast of the text of `element` against the first opaque colour behind it (WCAG 2 relative luminance). */
function textContrast(element: Locator): Promise<number> {
  return element.evaluate((start) => {
    interface El {
      parentElement: El | null
    }
    const view = (start as unknown as { ownerDocument: { defaultView: { getComputedStyle(element: unknown): { color: string; backgroundColor: string } } } }).ownerDocument.defaultView
    const parse = (color: string): [number, number, number, number] => {
      const parts = /^rgba?\(([^)]+)\)$/.exec(color)?.[1]?.split(/[\s,/]+/).filter((part) => part !== '').map(Number)
      if (parts === undefined || parts.length < 3 || parts.some((part) => !Number.isFinite(part))) throw new Error(`a colour this test cannot read: ${color}`)
      return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1]
    }
    const luminance = ([r, g, b]: [number, number, number, number]): number => {
      const channel = (value: number): number => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4)
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    let background: [number, number, number, number] | null = null
    for (let at: El | null = start as unknown as El; at !== null && background === null; at = at.parentElement) {
      const color = parse(view.getComputedStyle(at).backgroundColor)
      if (color[3] === 1) background = color
      else if (color[3] !== 0) throw new Error('a half-transparent background: this test does not blend colours')
    }
    if (background === null) throw new Error('no opaque background behind the text')
    const text = luminance(parse(view.getComputedStyle(start).color))
    const behind = luminance(background)
    return (Math.max(text, behind) + 0.05) / (Math.min(text, behind) + 0.05)
  })
}

/** In the light and in the dark theme: the button reads at 4.5:1 or more, and — when the run asks for evidence — a screenshot of the Node. */
async function inBothThemes(window: Page, node: Locator, button: Locator): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    // Away from the button: the colour checked is the one at rest, not under the mouse.
    await window.mouse.move(0, 0)
    expect(await textContrast(button), `${scheme}: the contrast of Fix`).toBeGreaterThanOrEqual(4.5)
    if (EVIDENCE_DIR !== undefined) await node.screenshot({ path: join(EVIDENCE_DIR, `07-fix-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('after a command that failed, Fix puts the corrected command into the line; it runs only on Enter, and the button is gone', async () => {
  // Unique to this run: no history has a command with it.
  const mark = `worfy-tai-${Date.now().toString(36)}-${process.pid}`
  const answer = `echo ${mark} fixed`
  // As a model writes it: in backticks. The answer takes a moment, as Sonnet does.
  sandbox.answers([{ feature: 'fix', answer: `\`${answer}\``, delayMs: 300 }])
  const launched = await launchApp({ env: sandbox.env })
  try {
    const { window } = launched
    const node = await openTerminal(window)
    const fix = node.getByRole('button', { name: 'Fix', exact: true })
    await expect(fix).toHaveCount(0)

    await window.keyboard.type(FAILING)
    await window.keyboard.press('Enter')
    await expect(fix).toBeVisible({ timeout: 15_000 })
    await inBothThemes(window, node, fix)

    await fix.click()
    // The answer: the line of the shell is the corrected command, and the button is gone.
    await expect.poll(() => editedLine(node), { timeout: 10_000 }).toBe(`${TERMINAL_AI_PROMPT}${answer}`)
    await expect(fix).toHaveCount(0)
    // Nothing ran: the output of the command is not on the screen.
    const output = new RegExp(`^${mark} fixed$`, 'gm')
    await window.waitForTimeout(500)
    expect([...(await screenText(node)).matchAll(output)]).toHaveLength(0)

    // The model was asked once for a Fix, by Sonnet, with the failed command and its output.
    const fixes = sandbox.requests().filter((request) => request.feature === 'fix')
    expect(fixes).toHaveLength(1)
    expect(fixes[0]).toMatchObject({ model: 'sonnet', cancelled: false, context: { cwd: sandbox.root } })
    expect(fixes[0]?.context.commands.at(-1)).toBe(FAILING)
    expect(fixes[0]?.context.exitCode).not.toBe(0)
    expect(fixes[0]?.context.output?.join('\n')).toContain('No such file')

    // The focus stayed in the terminal: Enter there runs the command, once, and no button comes back.
    await window.keyboard.press('Enter')
    await expect.poll(async () => [...(await screenText(node)).matchAll(output)].length, { timeout: 10_000 }).toBe(1)
    await window.waitForTimeout(500)
    await expect(fix).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
