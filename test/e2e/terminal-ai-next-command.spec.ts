import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'
import { TERMINAL_AI_PROMPT, editedLine, greyText, openTerminal, screenText, terminalAiSandbox, type TerminalAiSandbox } from './terminal-ai-helpers'
import { NO_ZSH, NO_ZSH_ON_WINDOWS } from '../zsh'
import { shellCaughtUp } from './wait'
import { ms } from '../time-scale'

// Next command of Terminal AI, in a Terminal Node of the built app on a real zsh: once a command is
// over and the line is empty, the assist process proposes the next command after a pause; it is on
// the screen in grey, → puts it into the line, and nothing runs until Enter. The assist process is
// the fake (WORFY_AGENT=fake): no Claude Code is started and the subscription is not spent.
//
// HOME is a temporary folder and SHELL the zsh of the machine (terminal-ai-helpers.ts): no startup
// file and no history of the machine running the tests is read or written.

test.skip(NO_ZSH, NO_ZSH_ON_WINDOWS)

let sandbox: TerminalAiSandbox

test.beforeEach(() => {
  sandbox = terminalAiSandbox()
})

test.afterEach(async () => {
  await sandbox.remove()
})

test('after a command the empty line shows the next one in grey; → puts it into the line; it runs only on Enter', async () => {
  // Unique to this run: no history has a command with it.
  const mark = `worfy-tai-next-${Date.now().toString(36)}-${process.pid}`
  const first = `echo ${mark} first`
  const answer = `echo ${mark} proposed`
  sandbox.answers([{ feature: 'next', answer: `\`${answer}\`` }])
  const launched = await launchApp({ env: sandbox.env })
  try {
    const { window } = launched
    const node = await openTerminal(window)
    const ran = new RegExp(`^${mark} proposed$`, 'gm')

    await window.keyboard.type(first)
    await window.keyboard.press('Enter')
    await expect.poll(async () => (await screenText(node)).match(new RegExp(`^${mark} first$`, 'm')) !== null, { timeout: ms(10_000) }).toBe(true)

    // After the pause the proposed command is grey on the empty line.
    await expect.poll(async () => (await greyText(node)).text, { timeout: ms(15_000) }).toBe(answer)
    expect(await editedLine(node)).toBe(`${TERMINAL_AI_PROMPT}${answer}`)
    expect((await greyText(node)).color).not.toBe('')
    expect([...(await screenText(node)).matchAll(ran)]).toHaveLength(0)
    expect(sandbox.requests()).toMatchObject([
      { feature: 'next', model: 'sonnet', cancelled: false, context: { line: '', cwd: sandbox.root, commands: [first], exitCode: 0, output: null } },
    ])

    // → puts it into the line: nothing grey is left, and nothing ran.
    await window.keyboard.press('ArrowRight')
    await expect.poll(async () => (await greyText(node)).text, { timeout: ms(10_000) }).toBe('')
    expect(await editedLine(node)).toBe(`${TERMINAL_AI_PROMPT}${answer}`)
    await shellCaughtUp(window, node, `${TERMINAL_AI_PROMPT}${answer}`)
    expect([...(await screenText(node)).matchAll(ran)]).toHaveLength(0)

    // Enter is the user's: the command runs once.
    await window.keyboard.press('Enter')
    await expect.poll(async () => [...(await screenText(node)).matchAll(ran)].length, { timeout: ms(10_000) }).toBe(1)
  } finally {
    await launched.close()
  }
})
