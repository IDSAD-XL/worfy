import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { captureScreenshot } from './evidence-capture'
import { launchApp } from './helpers'
import { expectSamePx } from './px'

// Auto-continue in the Modes menu under the Orchestrator's input field (worfy-retry ticket 02) against
// the built app, on the fake agent, over a temporary data folder. Off by default: the third icon of the
// button is muted and app-settings.json holds no entry. Turning it on in the menu writes the Project's
// entry, turning it off removes it, and a restart of the app shows what was written. The button is as
// wide in every combination of the three states. Unlike Auto-approval, Auto-continue is not held off
// under Playwright's debugging port: it only lets worfy send the Orchestrator "continue". The pictures of
// the button and the open menu, on and off, in both themes, go through captureScreenshot
// (evidence-capture.ts): into the test's output, or with WORFY_EVIDENCE into the Ticket's evidence. What
// the menu does in a regular Session and in a window on a Linked machine is covered by
// test/unit/modes-menu.test.tsx; the store and the channels by test/contract/auto-continue-setting.test.ts.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

let scratch: string
let dataDir: string
let claudeHome: string
let settingsFile: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-auto-continue-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  const repo = join(scratch, 'alpha')
  for (const dir of [join(dataDir, PROJECT), claudeHome, repo]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  settingsFile = join(dataDir, 'app-settings.json')
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

/** `autoContinue` of app-settings.json; undefined while there is no file or no field. */
const written = (): unknown => (existsSync(settingsFile) ? (JSON.parse(readFileSync(settingsFile, 'utf8')) as { autoContinue?: unknown }).autoContinue : undefined)

/** The Modes button of the Orchestrator's bar in Session view `view`, its Auto-continue icon, and the Auto-continue item of its menu. */
const modesOf = (view: Locator) => {
  const bar = view.locator('.w-composer__bar')
  const button = bar.getByRole('button', { name: 'Modes' })
  const menu = view.page().getByRole('menu', { name: 'Modes' })
  return { bar, button, icon: button.locator('[data-mode-item="auto-continue"]'), menu, item: menu.getByRole('menuitemcheckbox', { name: /^Auto-continue/u }) }
}

test("Auto-continue in the Orchestrator's Modes menu: off by default, on writes the Project's entry, off removes it, a restart shows what was written", async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view' }
  const first = await launchApp({ env })
  try {
    const { window } = first
    const view = await openSession(window)
    const { bar, button, icon, menu, item } = modesOf(view)

    // Off by default: three icons on the button, Auto-continue the last one and muted; nothing written.
    await expect(button.locator('[data-mode-item]')).toHaveCount(3)
    await expect(icon).toHaveAttribute('data-state', 'off')
    await expect(button).toHaveAttribute('title', /, Auto-continue off$/u)
    expect(written()).toBeUndefined()
    const offBox = (await button.boundingBox())!
    expect(Math.round(offBox.height)).toBe(24)
    await captureScreenshot(bar, 'modes-continue-off')

    // The menu: Auto-continue is its last item, unchecked, with the tooltip of the spec.
    await button.click()
    await expect(item).toHaveAttribute('aria-checked', 'false')
    await expect(item).toHaveAttribute('title', /^Auto-continue: after a temporary API error \(500, 529, connection lost\)/u)
    await expect(item).not.toHaveAttribute('aria-disabled', 'true')
    await captureScreenshot(menu, 'modes-menu-continue-off')

    // On: the item and the icon show it at once, the menu stays open, the Project's entry is written.
    await item.click()
    await expect(item).toHaveAttribute('aria-checked', 'true')
    await expect(item).not.toHaveAttribute('aria-busy', 'true')
    await expect(menu).toBeVisible()
    await expect(icon).toHaveAttribute('data-state', 'on')
    await expect.poll(written).toEqual({ [PROJECT]: true })
    await captureScreenshot(menu, 'modes-menu-continue-on')
    await window.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(button).toHaveAttribute('title', /, Auto-continue on$/u)
    expectSamePx([(await button.boundingBox())!.width], offBox.width, 'the Modes button on as wide as off')
    await captureScreenshot(bar, 'modes-continue-on')

    // Every state of every slot, as the stylesheet draws it (Auto-approval cannot leave Off under
    // Playwright's debugging port, so the states are set on the page): the button is as wide in each of
    // the 64 combinations.
    const widths = await button.evaluate((element) => {
      const slots = [...element.querySelectorAll('.w-modes__slot')]
      const before = slots.map((slot) => slot.getAttribute('data-state'))
      const states = ['on', 'off', 'shadow', 'unknown']
      const seen: number[] = []
      for (const eco of states) {
        for (const auto of states) {
          for (const cont of states) {
            slots[0]?.setAttribute('data-state', eco)
            slots[1]?.setAttribute('data-state', auto)
            slots[2]?.setAttribute('data-state', cont)
            seen.push(element.getBoundingClientRect().width)
          }
        }
      }
      slots.forEach((slot, at) => slot.setAttribute('data-state', before[at] ?? 'unknown'))
      return { seen, slots: slots.length }
    })
    expect(widths.slots).toBe(3)
    expect(widths.seen).toHaveLength(64)
    expectSamePx(widths.seen, offBox.width, 'the Modes button in every combination of states')
  } finally {
    await first.close()
  }

  // A restart reads what was written: on.
  const second = await launchApp({ env })
  try {
    const { window } = second
    const view = await openSession(window)
    const { button, icon, menu, item } = modesOf(view)
    await expect(icon).toHaveAttribute('data-state', 'on')
    await button.click()
    await expect(item).toHaveAttribute('aria-checked', 'true')

    // Off removes the entry.
    await item.click()
    await expect(item).toHaveAttribute('aria-checked', 'false')
    await expect(item).not.toHaveAttribute('aria-busy', 'true')
    await expect(icon).toHaveAttribute('data-state', 'off')
    await expect.poll(written).toBeUndefined()
    await window.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  } finally {
    await second.close()
  }
  expect(written()).toBeUndefined()
})
