import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'
import { TERMINAL_AI_PROMPT, editedLine, greyText, openTerminal, screenText, terminalAiSandbox, typedColor, type TerminalAiSandbox } from './terminal-ai-helpers'

// The Suggestion of Terminal AI from the model, in a Terminal Node of the built app on a real zsh:
// a line the history of commands has nothing for is answered by the assist process after a pause,
// the rest of its answer is on the screen in grey, and → takes it. The assist process is the fake
// (WORFY_AGENT=fake): no Claude Code is started and the subscription is not spent.
//
// HOME is a temporary folder and SHELL the zsh of the machine (terminal-ai-helpers.ts): no startup
// file and no history of the machine running the tests is read or written.

let sandbox: TerminalAiSandbox

test.beforeEach(() => {
  sandbox = terminalAiSandbox()
})

test.afterEach(async () => {
  await sandbox.remove()
})

test('a line the history has nothing for is completed in grey by the model after a pause; → takes the answer; the model was asked once', async () => {
  // Unique to this run: no history has a command with it.
  const mark = `worfy-tai-${Date.now().toString(36)}-${process.pid}`
  const typed = `echo ${mark} se`
  const answer = `echo ${mark} second third`
  // As a model writes it: in backticks. The answer takes a moment, as Haiku does.
  sandbox.answers([{ feature: 'suggest', match: mark, answer: `\`${answer}\``, delayMs: 300 }])
  const launched = await launchApp({ env: sandbox.env })
  try {
    const { window } = launched
    const node = await openTerminal(window)

    await window.keyboard.type(typed)
    // The rest of the answer is on the screen in grey, after what was typed.
    await expect.poll(async () => (await greyText(node)).text, { timeout: 15_000 }).toBe('cond third')
    expect(await editedLine(node)).toBe(`${TERMINAL_AI_PROMPT}${answer}`)
    const grey = await greyText(node)
    expect(grey.color).not.toBe('')
    expect(grey.color).not.toBe(await typedColor(node))
    // Nothing ran: the output of the command is not on the screen.
    const output = new RegExp(`^${mark} second third$`, 'gm')
    expect([...(await screenText(node)).matchAll(output)]).toHaveLength(0)

    // → takes the answer: nothing grey is left, and the line is the whole command.
    await window.keyboard.press('ArrowRight')
    await expect.poll(async () => (await greyText(node)).text, { timeout: 10_000 }).toBe('')
    expect(await editedLine(node)).toBe(`${TERMINAL_AI_PROMPT}${answer}`)
    // Enter is the user's: the command runs once.
    await window.keyboard.press('Enter')
    await expect.poll(async () => [...(await screenText(node)).matchAll(output)].length, { timeout: 10_000 }).toBe(1)

    // The model was asked once, about the line as it was typed, and it was Haiku.
    // Well past the pause of the widget: an ask about the line that was taken would have come by now.
    await window.waitForTimeout(1500)
    const requests = sandbox.requests().filter((r) => r.feature === 'suggest')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ feature: 'suggest', model: 'haiku', cancelled: false, context: { line: typed, cwd: sandbox.root, commands: [] } })
  } finally {
    await launched.close()
  }
})
