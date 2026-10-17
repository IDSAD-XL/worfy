import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'
import { TERMINAL_AI_PROMPT, editedLine, greyText, openTerminal, screenText, terminalAiSandbox, type TerminalAiSandbox } from './terminal-ai-helpers'
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

/** Opens the panel with ⌘I from the terminal, once main has said the zsh of this Terminal is connected. */
async function openPanel(window: Page, node: Locator, panel: Locator): Promise<void> {
  await expect(async () => {
    await node.getByTestId('terminal-screen').click()
    await window.keyboard.press('Meta+I')
    await expect(panel).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

/** The requests of Command request that reached the fake, in the order they ended. */
const commandRequests = (sandbox: TerminalAiSandbox) => sandbox.requests().filter((entry) => entry.feature === 'request')

test('the line typed in the shell goes to the model with the words: without the prompt and the grey Suggestion, wrapped rows as one line, a secret redacted, a line with a space at its start not at all', async () => {
  test.setTimeout(120_000)
  const mark = `worfy-tai-${Date.now().toString(36)}-${process.pid}`
  const answer = `echo ${mark}-answer`
  sandbox.answers([{ feature: 'request', match: mark, answer: `\`${answer}\``, delayMs: 100 }])
  const launched = await launchApp({ env: sandbox.env })
  try {
    const { window } = launched
    const node = await openTerminal(window)
    const panel = node.getByRole('dialog', { name: 'Command request' })
    const field = panel.getByRole('textbox', { name: 'Describe the command' })

    /** Types `line` (no Enter), asks from the panel, and returns the line of the context the fake got; the line of the shell is empty again after. */
    const contextLineOf = async (line: string, ready?: () => Promise<void>): Promise<string> => {
      const before = commandRequests(sandbox).length
      await node.getByTestId('terminal-screen').click()
      await window.keyboard.type(line)
      // All of it is on the screen: its start after the prompt, and its end.
      await expect.poll(() => editedLine(node), { timeout: 10_000 }).toContain(`${TERMINAL_AI_PROMPT}${line.slice(0, 20)}`)
      await expect.poll(() => screenText(node), { timeout: 10_000 }).toContain(line.slice(-20))
      await ready?.()
      await openPanel(window, node, panel)
      await field.fill(`complete ${mark}`)
      await window.keyboard.press('Enter')
      await expect(panel).toBeHidden({ timeout: 15_000 })
      await expect.poll(() => commandRequests(sandbox).length, { timeout: 10_000 }).toBe(before + 1)
      // The answer is in the line; Ctrl+U takes the whole line away for the next one.
      await expect.poll(() => screenText(node), { timeout: 10_000 }).toContain(answer)
      await window.keyboard.press('Control+U')
      await expect.poll(() => editedLine(node), { timeout: 10_000 }).toBe(TERMINAL_AI_PROMPT.trimEnd())
      return commandRequests(sandbox).at(-1)?.context.line ?? '<none>'
    }

    // Typed, without Enter.
    expect(await contextLineOf('git status --short')).toBe('git status --short')

    // A grey Suggestion from the history after the typed text: not typed, not sent.
    await node.getByTestId('terminal-screen').click()
    await window.keyboard.type(`echo ${mark} second third`)
    await window.keyboard.press('Enter')
    await expect.poll(async () => [...(await screenText(node)).matchAll(new RegExp(`^${mark} second third$`, 'gm'))].length, { timeout: 10_000 }).toBe(1)
    const rest = `${mark.slice('wo'.length)} second third`
    expect(await contextLineOf('echo wo', () => expect.poll(async () => (await greyText(node)).text, { timeout: 10_000 }).toBe(rest))).toBe('echo wo')

    // Longer than the row: the screen wraps it onto the next row, the context gets it whole.
    const long = `echo ${'abcdefghij'.repeat(16)}`
    expect(await contextLineOf(long)).toBe(long)
    // It was wrapped on the screen: no row holds all of it.
    expect((await screenText(node)).split('\n').some((row) => row.includes(long))).toBe(false)

    // A secret: redacted before it leaves main.
    expect(await contextLineOf('export GITHUB_TOKEN=s3cr3t-value-0123')).toBe('export GITHUB_TOKEN=[redacted]')
    // A line with a space at its start stays out of the model, as it stays out of the history.
    expect(await contextLineOf(' echo private-line')).toBe('')
    expect(JSON.stringify(sandbox.requests())).not.toContain('s3cr3t')
    expect(JSON.stringify(sandbox.requests())).not.toContain('private-line')
  } finally {
    await launched.close()
  }
})

interface PanelPlace {
  rowBottom: number
  panelTop: number
  rowText: string
  /** What is drawn over the first character of the first row is not the panel. */
  rowCovered: boolean
  rows: number
}

/** Where the open panel is against the first row of the screen of xterm.js, and how many rows the screen has. */
function panelPlace(node: Locator): Promise<PanelPlace> {
  return node.evaluate((root) => {
    interface Box {
      top: number
      bottom: number
      left: number
      height: number
    }
    interface El {
      textContent: string | null
      getBoundingClientRect(): Box
      contains(other: unknown): boolean
      querySelector(selector: string): El | null
      querySelectorAll(selector: string): { length: number }
      ownerDocument: { elementFromPoint(x: number, y: number): unknown }
    }
    const node = root as unknown as El
    const row = node.querySelector('.xterm-rows > div')
    const panel = node.querySelector('[data-testid="terminal-ai-request"]')
    if (row === null || panel === null) throw new Error('no first row or no panel')
    const rowBox = row.getBoundingClientRect()
    const hit = node.ownerDocument.elementFromPoint(rowBox.left + 3, rowBox.top + rowBox.height / 2)
    return {
      rowBottom: rowBox.bottom,
      panelTop: panel.getBoundingClientRect().top,
      rowText: (row.textContent ?? '').replace(/\u00a0/g, ' '),
      rowCovered: panel.contains(hit),
      rows: node.querySelectorAll('.xterm-rows > div').length,
    }
  })
}

/** The size of the pty as `stty size` reports it in the shell. */
async function sttySize(window: Page, node: Locator, tag: string): Promise<string> {
  await node.getByTestId('terminal-screen').click()
  // The output differs from the echoed command line (`$(…)`), so the pattern matches only the output.
  await window.keyboard.type(`echo "${tag}=$(stty size | tr ' ' x)"`)
  await window.keyboard.press('Enter')
  const pattern = new RegExp(`^${tag}=(\\d+x\\d+)$`, 'm')
  await expect.poll(async () => pattern.test(await screenText(node)), { timeout: 10_000 }).toBe(true)
  return pattern.exec(await screenText(node))?.[1] ?? ''
}

test('the open panel hangs under the first row of the screen, also while a command runs; opening and closing it do not change the size of the pty', async () => {
  sandbox.answers([])
  const launched = await launchApp({ env: sandbox.env })
  try {
    const { window } = launched
    const node = await openTerminal(window)
    const panel = node.getByRole('dialog', { name: 'Command request' })

    // A command runs; it is the first row of the screen.
    const mark = `worfy-tai-${Date.now().toString(36)}`
    await node.getByTestId('terminal-screen').click()
    await window.keyboard.type(`sleep 30; : ${mark}`)
    await window.keyboard.press('Enter')
    await openPanel(window, node, panel)
    await expect(panel.getByRole('status')).toHaveText('Terminal is busy', { timeout: 10_000 })
    const busy = await panelPlace(node)
    expect(busy.rowText).toContain(`${TERMINAL_AI_PROMPT}sleep 30; : ${mark}`)
    expect(busy.panelTop).toBeGreaterThanOrEqual(busy.rowBottom)
    expect(busy.rowCovered).toBe(false)
    if (EVIDENCE_DIR !== undefined) {
      for (const scheme of ['light', 'dark'] as const) {
        await window.emulateMedia({ colorScheme: scheme })
        await node.screenshot({ path: join(EVIDENCE_DIR, `13-request-panel-busy-${scheme}.png`) })
      }
      await window.emulateMedia({ colorScheme: null })
    }
    await window.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await window.keyboard.press('Control+C')

    // At the prompt: the size before, the panel open, the size after.
    const before = await sttySize(window, node, 'before')
    const rowsBefore = (await screenRows(node)).rows
    await window.keyboard.type('echo typed')
    await openPanel(window, node, panel)
    const open = await panelPlace(node)
    expect(open.panelTop).toBeGreaterThanOrEqual(open.rowBottom)
    expect(open.rowCovered).toBe(false)
    expect(open.rows).toBe(rowsBefore)
    if (EVIDENCE_DIR !== undefined) {
      for (const scheme of ['light', 'dark'] as const) {
        await window.emulateMedia({ colorScheme: scheme })
        await node.screenshot({ path: join(EVIDENCE_DIR, `13-request-panel-${scheme}.png`) })
      }
      await window.emulateMedia({ colorScheme: null })
    }
    await window.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await window.keyboard.press('Control+U')
    expect(await sttySize(window, node, 'after')).toBe(before)
    expect((await screenRows(node)).rows).toBe(rowsBefore)
  } finally {
    await launched.close()
  }
})

/** How many rows the screen of xterm.js has, with no panel open. */
function screenRows(node: Locator): Promise<{ rows: number }> {
  return node.locator('.xterm-rows').evaluate((rows) => ({ rows: (rows as unknown as { children: { length: number } }).children.length }))
}
