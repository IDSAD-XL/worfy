import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The Session view against the built app, on the fake agent: the script
// test/fixtures/agent-scripts/session-view.jsonl plays two turns and starts over. Turn 1 runs a
// tool and answers with markdown (a table, a task list, a link) at $0.0021; turn 2 starts to
// count and holds until it is interrupted ($0.0026 for its process). Everything goes through the
// window: a double click on the Orchestrator Node, the input field, the Interrupt button.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

type Bridge = { on(channel: string, handler: (payload: unknown) => void): number }
interface Envelope {
  sessionId: string
  event: { type: string; state?: string }
}

let scratch: string
let dataDir: string
let claudeHome: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-session-view-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(claudeHome)
  const path = join(scratch, 'alpha')
  mkdirSync(path)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** Starts recording the state events the window receives, to read back with states(). */
async function record(window: Page): Promise<void> {
  await window.evaluate(() => {
    const store = globalThis as unknown as { worfy: Bridge; recorded: unknown[] }
    store.recorded = []
    store.worfy.on('agent.event', (payload) => store.recorded.push(payload))
  })
}

async function states(window: Page): Promise<string[]> {
  const recorded = await window.evaluate(() => (globalThis as unknown as { recorded: Envelope[] }).recorded)
  return recorded.flatMap((envelope) => (envelope.event.type === 'state' && envelope.event.state ? [envelope.event.state] : []))
}

test('the Session view: opened from the Orchestrator Node, a turn, an interrupted turn, and the prompt history', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view' } })
  try {
    const { window } = launched
    await record(window)
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')

    // A double click on the Node opens its Session in the Session view.
    const canvasView = window.locator('.w-shell__view[data-view="canvas"]')
    const sessionView = window.locator('.w-shell__view[data-view="session"]')
    await expect(sessionView).toBeHidden()
    await node.locator('.w-orchestrator__header').dblclick()
    await expect(sessionView).toBeVisible()
    await expect(canvasView).toBeHidden()
    const view = sessionView.getByTestId('session-view')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    await expect(view.getByTestId('session-cost')).toHaveText('$0.00')
    const nodeId = await node.getAttribute('data-node-id')
    await expect(view).toHaveAttribute('data-node-id', nodeId ?? '')

    // Turn 1: Return sends; busy, then the answer as markdown, then idle with the cost in the header.
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('first prompt')
    await field.press('Enter')
    await expect(field).toHaveValue('')
    await expect(view.getByTestId('transcript-prompt').first()).toContainText('first prompt')
    const answer = view.getByTestId('transcript-text').first()
    await expect(answer.locator('table td').first()).toHaveText('33')
    await expect(answer.locator('strong')).toHaveText('Wave 6')
    await expect(answer.locator('input[type="checkbox"]')).toHaveCount(2)
    await expect(view.getByTestId('tool-call')).toHaveCount(1)
    await expect(view.getByTestId('tool-call')).toContainText('epic-status worfy-mvp --json')
    await expect(view.getByTestId('tool-ok')).toHaveCount(1)
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    await expect(view.getByTestId('session-cost')).toHaveText('$0.0021')
    await expect(view.getByTestId('session-model')).toHaveText('claude-haiku-4-5-20251001')
    await expect(view.getByTestId('session-permissions')).toHaveText('bypass')
    expect((await states(window)).slice(-2)).toEqual(['busy', 'idle'])

    // Turn 2 holds while running: the send button is Interrupt; Interrupt stops the turn.
    await field.fill('second prompt')
    await field.press('Enter')
    await expect(view.getByTestId('session-state')).toHaveText('busy')
    await expect(view.getByTestId('input-send')).toHaveCount(0)
    await expect(view.getByTestId('transcript-text').last()).toContainText('1 2')
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`session-view-busy-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
    await view.getByTestId('input-interrupt').click()
    await expect(view.getByTestId('transcript-interrupted')).toHaveCount(1)
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    await expect(view.getByTestId('input-send')).toHaveCount(1)
    await expect(view.getByTestId('session-cost')).toHaveText('$0.0026')
    // The interruption is a marker, not a message from the user.
    await expect(view.getByTestId('transcript-prompt')).toHaveCount(2)

    // ↑/↓ in the empty field step through this Session's prompts.
    await field.click()
    await field.press('ArrowUp')
    await expect(field).toHaveValue('second prompt')
    await field.press('ArrowUp')
    await expect(field).toHaveValue('first prompt')
    await field.press('ArrowDown')
    await expect(field).toHaveValue('second prompt')
    await field.press('ArrowDown')
    await expect(field).toHaveValue('')

    // Shift+Return is a new line, not a send; the field grows with it.
    const before = (await field.boundingBox())?.height ?? 0
    await field.fill('line 1')
    await field.press('Shift+Enter')
    await field.pressSequentially('line 2')
    await expect(field).toHaveValue('line 1\nline 2')
    expect((await field.boundingBox())?.height ?? 0).toBeGreaterThan(before)
    await expect(view.getByTestId('transcript-prompt')).toHaveCount(2)

    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`session-view-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

    // The toolbar switch goes back to the Canvas.
    await window.getByRole('button', { name: /Canvas/ }).click()
    await expect(canvasView).toBeVisible()
    await expect(sessionView).toBeHidden()
  } finally {
    await launched.close()
  }
})
