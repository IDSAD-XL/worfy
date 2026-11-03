import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'

// The Limits panel by Vendor (worfy-multi-vendor ticket 26) against the built app: Claude's section from
// limits.json, and the Codex section from the background poll of the Codex driver, which e2e runs make
// on the fake app-server (WORFY_CODEX=fake, src/main/agent/limits-usage.ts). The poll starts only when
// the launch's CODEX_HOME exists: here it does, and the fake plays test/fixtures/codex-scripts/
// account-plus.jsonl — signed in to the Plus plan, a 5-hour window at 12 % and a weekly one at 40 %.
// A Codex Session cannot start in the app yet (tickets 23 and 24), so the section comes from the poll,
// not from a Codex turn; the turn's `limits` event is test/contract/codex-session-limits.test.ts.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

let scratch: string
let dataDir: string
let codexHome: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-limits-vendors-')))
  dataDir = join(scratch, 'data')
  codexHome = join(scratch, 'codex-home')
  mkdirSync(dataDir)
  mkdirSync(codexHome)
  // Claude's windows as a Session left them a minute ago: fresh, so the bars are not dimmed.
  const receivedAt = Date.now() - 60_000
  const inHours = (hours: number): number => Math.floor(Date.now() / 1000) + hours * 3600
  writeFileSync(
    join(dataDir, 'limits.json'),
    JSON.stringify({
      windows: {
        five_hour: { utilization: 0.62, resetsAt: inHours(2), status: 'allowed', receivedAt, source: 'sdk' },
        seven_day: { utilization: 0.38, resetsAt: inHours(72), status: 'allowed', receivedAt, source: 'sdk' },
      },
    }),
  )
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const found = await locator.boundingBox()
  if (found === null) throw new Error('not on screen')
  return found
}

/** Screenshots of the toolbar in both themes, for the ticket's evidence and the review. */
async function screenshots(window: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await window.getByRole('banner').screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('signed in to Codex: a Codex section with the windows of its plan next to Claude\'s, inside the toolbar', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: 'account-plus', WORFY_CODEX_SCRIPTS: join(repoRoot, 'test', 'fixtures', 'codex-scripts') } })
  try {
    const { window } = launched
    const meter = window.getByTestId('limits-meter')
    const claude = meter.getByRole('group', { name: 'Claude Code limits' })
    const codex = meter.getByRole('group', { name: 'Codex limits' })

    await expect(codex).toBeVisible()
    await expect(codex.getByTestId('limits-codex-name')).toHaveText('Codex')
    // Shortest window first, each labelled by its length as Codex's own TUI does.
    await expect(codex.getByRole('meter')).toHaveCount(2)
    await expect(codex.getByRole('meter', { name: '5h limit' })).toHaveAttribute('aria-valuenow', '12')
    await expect(codex.getByRole('meter', { name: 'weekly limit' })).toHaveAttribute('aria-valuenow', '40')
    await expect(codex.getByTestId('limit-codex-primary-value')).toHaveText('12%')
    // Two sections make the panel compact: the reset line is the time alone, the whole line its tooltip.
    await expect(meter).toHaveAttribute('data-compact', 'true')
    await expect(codex.getByTestId('limit-codex-secondary-note')).toHaveText(/^[A-Z][a-z]{2} \d\d:\d\d$/)
    await expect(codex.getByTestId('limit-codex-secondary-note')).toHaveAttribute('title', /^resets [A-Z][a-z]{2} \d\d:\d\d$/)
    const first = await box(codex.getByTestId('limit-codex-primary'))
    const second = await box(codex.getByTestId('limit-codex-secondary'))
    expect(first.x, 'the 5-hour window before the weekly one').toBeLessThan(second.x)

    // Claude's section keeps its bars and their test ids.
    await expect(claude.getByTestId('limits-claude-name')).toHaveText('Claude Code')
    await expect(claude.getByTestId('limit-five_hour-value')).toHaveText('62%')
    await expect(claude.getByTestId('limit-seven_day-value')).toHaveText('38%')
    expect((await box(claude)).x, 'Claude\'s section first').toBeLessThan((await box(codex)).x)

    // Both sections fit the toolbar: the meter ends before the Harness column, inside the window.
    const toolbar = window.getByRole('banner')
    const limits = await box(meter)
    const harness = await box(toolbar.getByTestId('harness-column'))
    expect(limits.x + limits.width, `the Limits (${JSON.stringify(limits)}) end before the Harness column (${JSON.stringify(harness)})`).toBeLessThanOrEqual(harness.x)
    const bar = await box(toolbar)
    expect(limits.y >= bar.y && limits.y + limits.height <= bar.y + bar.height, 'the Limits inside the toolbar').toBe(true)
    const width = await window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
    const search = await box(toolbar.locator('.w-toolbar__palette-hint'))
    expect(search.x, 'the search field after the Harness column').toBeGreaterThanOrEqual(harness.x + harness.width)
    expect(search.x + search.width, `the search field ends inside the window (${width} px)`).toBeLessThanOrEqual(width)

    // No text of a bar is cut in the narrower bars: the labels, the shares and the reset times are whole.
    for (const id of ['limit-five_hour', 'limit-seven_day', 'limit-codex-primary', 'limit-codex-secondary']) {
      const cut = await meter.getByTestId(id).evaluate((node) => {
        type Element = { scrollWidth: number; clientWidth: number; querySelectorAll(selector: string): Iterable<Element> }
        const element = node as unknown as Element
        return [element, ...element.querySelectorAll('*')].some((each) => each.scrollWidth > each.clientWidth && each.clientWidth > 0)
      })
      expect(cut, `a text of ${id} is cut`).toBe(false)
    }

    await screenshots(window, 'limits-vendors')
  } finally {
    await launched.close()
  }
})
