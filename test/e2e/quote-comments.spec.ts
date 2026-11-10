import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// Comments on quotes of an agent's message (worfy-polish ticket 102) against the built app, on the
// fake agent (test/fixtures/agent-scripts/message-input.jsonl, which answers «Hello from the fake
// agent» to every message). A part of the answer is selected, a right click offers «Comment», the
// popover takes the comment, the tray above the field lists it, and Send sends the round with the
// field's text as one message: the agent gets the quote, the comment and the general text in the
// round's format, and the user's bubble draws a quote block. The quote stays lit, dimly, afterwards.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const QUOTE = 'from the fake agent'

type Call = { kind: string; text?: string }

let scratch: string
let dataDir: string
let claudeHome: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-quote-comments-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  log = join(scratch, 'agent.log')
  const project = join(scratch, 'alpha')
  mkdirSync(claudeHome)
  writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
  mkdirSync(project)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: project }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** What the fake agent got, message by message (WORFY_AGENT_LOG). */
const messages = (): Call[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Call)
        .filter((call) => call.kind === 'message')
    : []

/** Opens the Orchestrator's Session view with a double click on its Node, once it is idle. */
async function openSession(window: Page): Promise<Locator> {
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
  await node.locator('.w-orchestrator__header').dblclick()
  const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
  await expect(view.getByTestId('session-state')).toHaveText('idle')
  return view
}

/** Selects `text` in the last agent answer that can be commented on. Page code as a string: the e2e tsconfig has no DOM types. */
const selectInAnswer = (window: Page, text: string) =>
  window.evaluate(`(() => {
    const rows = document.querySelectorAll('.w-shell__view[data-view="session"] [data-quote-anchor]')
    const row = rows[rows.length - 1]
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.data.indexOf(${JSON.stringify(text)})
      if (at === -1) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + ${text.length})
      const selection = document.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      const box = range.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }
    return null
  })()`) as Promise<{ x: number; y: number } | null>

/** Whether a highlight of that name paints a range now. */
const lit = (window: Page, name: string) => window.evaluate(`(() => (CSS.highlights.get(${JSON.stringify(name)})?.size ?? 0) > 0)()`) as Promise<boolean>

test('select a part of an answer, comment on it, send the round: the agent gets the quote, the bubble shows its block', async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'message-input', WORFY_AGENT_LOG: log }
  const app = await launchApp({ env })
  try {
    const { window } = app
    const view = await openSession(window)
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('hello')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    await expect(view.locator('[data-quote-anchor]')).toHaveCount(1)

    // The selection gets its button, and a right click on it offers «Comment».
    const point = await selectInAnswer(window, QUOTE)
    expect(point).not.toBeNull()
    await expect(window.getByTestId('quote-button')).toContainText('Comment')
    await window.mouse.click(point!.x, point!.y, { button: 'right' })
    const menu = window.getByTestId('quote-menu')
    await expect(menu).toBeVisible()
    await menu.getByTestId('quote-menu-comment').click()

    const popover = window.getByTestId('quote-popover')
    await expect(popover.getByTestId('quote-popover-quote')).toHaveText(QUOTE)
    await popover.getByTestId('quote-popover-text').fill('Say it shorter.')
    await popover.getByTestId('quote-popover-save').click()
    await expect(popover).toHaveCount(0)
    await expect.poll(() => lit(window, 'worfy-quote')).toBe(true)

    const tray = view.getByTestId('quote-tray')
    await expect(tray).toContainText('1 comment on this message')
    await expect(tray.getByTestId('quote-chip')).toHaveText([/«from the fake agent»/])

    await field.fill('Thanks.')
    await field.press('Enter')
    await expect.poll(() => messages().length).toBe(2)
    expect(messages()[1]?.text).toMatch(/^Comments on parts of your messages \(1\):\n\n1\. > «from the fake agent» \(your message( \d\d:\d\d)?\)\n {3}Say it shorter\.\n\nGeneral:\nThanks\.$/)
    await expect(tray).toHaveCount(0)

    const block = view.getByTestId('quoted-prompt-block')
    await expect(block).toHaveCount(1)
    await expect(block.getByTestId('quoted-prompt-quote')).toHaveText(QUOTE)
    await expect(block.getByTestId('quoted-prompt-comment')).toHaveText('Say it shorter.')
    await expect(view.getByTestId('quoted-prompt-general')).toHaveText('Thanks.')
    // The quote stays lit, dimly: it was sent.
    await expect.poll(() => lit(window, 'worfy-quote-sent')).toBe(true)
    await expect.poll(() => lit(window, 'worfy-quote')).toBe(false)
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await view.screenshot({ path: test.info().outputPath(`quote-comments-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
  } finally {
    await app.close()
  }
})
