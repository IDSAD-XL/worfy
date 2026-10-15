import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The context meter under the input field (worfy-polish ticket 23) against the built app, on the
// fake agent with test/fixtures/agent-scripts/context-meter.jsonl: each turn sets what
// getContextUsage() answers — 10 %, 75 %, 95 % of the 167K autocompact threshold of a 200K window
// (8 %, 63 %, 79 % of the window, the SDK's own percentage), then an error. The
// meter stands in the bar of the input field, on the line of the pickers right after them, and says "no data" before
// the first turn and after the failed ask. The bar is shot in the light and the dark theme at each
// state; with WORFY_EVIDENCE_DIR set, the shots are copied there.

const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

/** As in test/e2e/snapshots.ts: the translucent sidebar gets its opaque token while a shot is taken. */
const VIBRANCY_BACKDROP = 'html { background: var(--sidebar) !important; }'

let scratch: string
let dataDir: string
let claudeHome: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-context-meter-')))
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

/** Shots of the input field in both themes, as <test output>/context-meter/<state>-<scheme>.png, copied to the evidence folder when one is set. */
async function shoot(window: Page, composer: Locator, state: string): Promise<void> {
  const folder = join(test.info().project.outputDir, 'snapshots', 'context-meter')
  mkdirSync(folder, { recursive: true })
  const box = await composer.boundingBox()
  if (box === null) throw new Error('the input field is not on screen')
  const clip = { x: Math.max(box.x - 8, 0), y: Math.max(box.y - 8, 0), width: box.width + 16, height: box.height + 16 }
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      const path = join(folder, `${state}-${scheme}.png`)
      await window.screenshot({ path, clip, animations: 'disabled', style: VIBRANCY_BACKDROP })
      if (EVIDENCE_DIR !== undefined) {
        mkdirSync(EVIDENCE_DIR, { recursive: true })
        copyFileSync(path, join(EVIDENCE_DIR, `23-context-meter-${state}-${scheme}.png`))
      }
    }
  } finally {
    await window.emulateMedia({ colorScheme: null })
  }
}

test('the context meter shows the share of the autocompact threshold after each turn, and "no data" without one', async () => {
  const app = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'context-meter' } })
  try {
    const { window } = app
    const view = await openSession(window)
    const composer = view.getByTestId('message-input')
    const meter = composer.getByTestId('context-meter')
    const value = meter.getByTestId('context-meter-value')
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })

    // Before the first turn: nothing to say yet.
    await expect(value).toHaveText('no data')
    await expect(meter).toHaveAttribute('data-level', 'none')

    // In the bar of the input field, on the line of the pickers and right after them — also when
    // the narrow column moves the pickers to a second line.
    const picker = composer.getByTestId('picker-permissions')
    const meterBox = await meter.boundingBox()
    const pickerBox = await picker.boundingBox()
    expect(meterBox).not.toBeNull()
    expect(pickerBox).not.toBeNull()
    expect(meterBox!.x).toBeGreaterThanOrEqual(pickerBox!.x + pickerBox!.width)
    expect(Math.abs(meterBox!.y + meterBox!.height / 2 - (pickerBox!.y + pickerBox!.height / 2))).toBeLessThan(4)
    await shoot(window, composer, 'no-data')

    const states = [
      { text: '10%', level: 'normal', title: '16.7K / 200K tokens · autocompact at 167K', shot: '10' },
      { text: '75%', level: 'working', title: '125.2K / 200K tokens · autocompact at 167K', shot: '75' },
      { text: '95%', level: 'blocked', title: '158.6K / 200K tokens · autocompact at 167K', shot: '95' },
    ]
    for (const [index, state] of states.entries()) {
      await field.fill(`turn ${index + 1}`)
      await field.press('Enter')
      await expect(view.getByTestId('transcript-turn-done')).toHaveCount(index + 1)
      await expect(value).toHaveText(state.text)
      await expect(meter).toHaveAttribute('data-level', state.level)
      await expect(meter).toHaveAttribute('title', state.title)
      await shoot(window, composer, state.shot)
    }

    // The fourth turn's ask fails: the turn ends as usual, and the meter has no data again.
    await field.fill('turn 4')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(4)
    await expect(value).toHaveText('no data')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
  } finally {
    await app.close()
  }
})
