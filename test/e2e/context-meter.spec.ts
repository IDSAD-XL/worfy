import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The context meter under the input field (worfy-polish ticket 23) against the built app, on the
// fake agent with test/fixtures/agent-scripts/context-meter.jsonl: each turn sets what
// getContextUsage() answers — 10 %, 75 %, 95 % of the 167K autocompact threshold of a 200K window
// (8 %, 63 %, 79 % of the window, the SDK's own percentage), then an error. The
// meter stands in the bar of the input field, at the right end of the line of the hint, and says "no data" before
// the first turn and after the failed ask. The bar is shot in the light and the dark theme at each
// state; with WORFY_EVIDENCE_DIR set, the shots are copied there.
//
// The meter never takes width from the pickers: the bar has two lines (worfy-throughput ticket 60),
// the meter on the line of the hint and the pickers on the line below with Send, in every width. In
// the 1280×800 window with the sidebar and the rail shown the permission mode of the default model
// is whole, in every state of the meter (test/e2e/session-controls.spec.ts asks the same of the
// pickers).

const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

/** As in test/e2e/snapshots.ts: the translucent sidebar gets its opaque token while a shot is taken. */
const VIBRANCY_BACKDROP = 'html { background: var(--sidebar) !important; }'

let scratch: string
let dataDir: string
let claudeHome: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-context-meter-')))
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

type Box = { x: number; y: number; width: number; height: number }

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (found === null) throw new Error('no box')
  return found
}

const middle = (found: Box): number => found.y + found.height / 2

/** Makes the window `width` × `height`, as test/e2e/session-controls.spec.ts does. */
async function resize(app: ElectronApplication, bar: Locator, width: number, height: number): Promise<void> {
  await expect
    .poll(
      async () => {
        // Reading a box lays the page out for the width it has now.
        const now = await bar.evaluate((element) => element.ownerDocument.documentElement.clientWidth)
        if (now !== width) await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted.width, wanted.height), { width, height })
        return now
      },
      { message: `the window is ${width} px wide` },
    )
    .toBe(width)
}

/**
 * The meter is in the bar, on the line of the hint, apart from the pickers, which stand on the line
 * below with Send; the permission mode of the default model is not cut (in the 1280×800 window with
 * the sidebar and the rail shown, and wider).
 */
async function expectPickersKeepTheirRoom(composer: Locator, state: string): Promise<void> {
  const bar = composer.locator('.w-composer__bar')
  const meter = composer.getByTestId('context-meter')
  const pickers = composer.getByTestId('pickers')
  const mode = composer.getByTestId('picker-permissions')
  const [barBox, meterBox, pickersBox, hintBox, sendBox] = [await box(bar), await box(meter), await box(pickers), await box(composer.locator('.w-composer__hint').first()), await box(composer.getByTestId('input-send'))]
  expect(meterBox.x, `${state}: the meter's left edge`).toBeGreaterThanOrEqual(barBox.x)
  expect(meterBox.x + meterBox.width, `${state}: the meter's right edge`).toBeLessThanOrEqual(barBox.x + barBox.width)
  expect(Math.abs(middle(meterBox) - middle(hintBox)), `${state}: the meter on the line of the hint`).toBeLessThan(4)
  expect(Math.abs(middle(sendBox) - middle(pickersBox)), `${state}: Send on the line of the pickers`).toBeLessThan(4)
  expect(middle(pickersBox), `${state}: the pickers below the meter`).toBeGreaterThan(meterBox.y + meterBox.height)
  const cut = await mode.locator('.w-select__value').evaluate((element) => element.scrollWidth > element.clientWidth)
  expect(cut, `${state}: the permission mode is cut`).toBe(false)
}

test('the context meter shows the share of the autocompact threshold after each turn, and "no data" without one', async () => {
  const app = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'context-meter' } })
  try {
    const { window } = app
    const view = await openSession(window)
    await resize(app.app, view.locator('.w-composer__bar'), 1280, 800)
    const composer = view.getByTestId('message-input')
    const meter = composer.getByTestId('context-meter')
    const value = meter.getByTestId('context-meter-value')
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })

    // Before the first turn: nothing to say yet.
    await expect(value).toHaveText('no data')
    await expect(meter).toHaveAttribute('data-level', 'none')

    await expectPickersKeepTheirRoom(composer, 'no data')
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
      await expectPickersKeepTheirRoom(composer, state.text)
      await shoot(window, composer, state.shot)
    }

    // The fourth turn's ask fails: the turn ends as usual, and the meter has no data again.
    await field.fill('turn 4')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(4)
    await expect(value).toHaveText('no data')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    await expectPickersKeepTheirRoom(composer, 'no data after a failed ask')

    // The sidebar hidden, the bar wide: the meter stays on the line of the hint, at its right end,
    // and the pickers on the line below it.
    await window.getByRole('button', { name: 'Hide sidebar' }).click()
    await resize(app.app, view.locator('.w-composer__bar'), 1920, 1080)
    await expectPickersKeepTheirRoom(composer, 'a wide bar')
    const [meterBox, barBox] = [await box(meter), await box(composer.locator('.w-composer__bar'))]
    expect(barBox.x + barBox.width - (meterBox.x + meterBox.width)).toBeLessThan(16)
  } finally {
    await app.close()
  }
})
