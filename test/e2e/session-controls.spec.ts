import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

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
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-session-controls-')))
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
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await view.getByTestId('pickers').screenshot({ path: test.info().outputPath(`composer-pickers-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

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
    await window.waitForTimeout(500)
    expect(messages()).toEqual(['first', 'hold'])
    await expect(view.getByTestId('queue-chip')).toHaveText('2 queued')

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
