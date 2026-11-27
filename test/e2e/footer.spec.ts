import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { launchApp, openVersionPopover, repoRoot, type LaunchedApp } from './helpers'

// worfy-layout ticket 03: the footer — a 28 px strip across the whole window under the sidebar and the
// main area (src/renderer/shell/footer/Footer.tsx) — and the version chip at its right end with its dot
// and popover (VersionChip.tsx, version-dot.ts). The Claude home of launchApp is a sandbox, so the
// Harness is not installed and this dev run may install it: the dot is red. The `claude` of the run is
// a stub (WORFY_CLAUDE) that keeps the plugins it "installed" in a file of the test and never reaches the
// network; the consent dialog is replaced in main and answers Install. An Update of worfy is main's
// snapshot sent to the window as `update.changed` does: the press on "Update worfy" itself, Retry and
// "Move old Harness…" are the specs of their own features (update-toolbar, harness-install, harness-migrate).
// Focus mode with the footer: focus.spec.ts and focus-sidebar.spec.ts.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
const bundledVersion = (): string => (JSON.parse(readFileSync(join(repoRoot, 'out', 'harness', '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }).version

/** A `claude` that answers the Harness's reads and installs from the marketplace folder it was given; any other call does nothing. */
const STUB = `
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
const line = args.join(' ')
const statePath = process.env.STUB_CLAUDE_STATE
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { marketplaces: {}, plugins: {} }
const manifest = (dir, file) => JSON.parse(readFileSync(join(dir, '.claude-plugin', file), 'utf8'))
if (line.startsWith('plugin marketplace list')) process.stdout.write(JSON.stringify(Object.keys(state.marketplaces).map((name) => ({ name }))) + '\\n')
else if (line.startsWith('plugin list')) process.stdout.write(JSON.stringify(Object.entries(state.plugins).map(([id, version]) => ({ id, version, scope: 'user', enabled: true, errors: [] }))) + '\\n')
else if (line.startsWith('plugin marketplace add')) state.marketplaces[manifest(args[3], 'marketplace.json').name] = args[3]
else if (line.startsWith('plugin install')) state.plugins[args[2]] = manifest(state.marketplaces[args[2].split('@')[1]], 'plugin.json').version
if (!line.includes(' list')) writeFileSync(statePath, JSON.stringify(state))
`

let scratch: string
let env: Record<string, string>

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-footer-')))
  // A .mjs, which worfy starts under its own Node on every system (src/main/program.ts).
  const claude = join(scratch, 'claude-stub.mjs')
  writeFileSync(claude, STUB)
  env = { WORFY_CLAUDE: claude, STUB_CLAUDE_STATE: join(scratch, 'state.json') }
})

test.afterEach(async () => {
  await removeDir(scratch)
})

type Box = { x: number; y: number; width: number; height: number }

async function box(locator: Locator): Promise<Box> {
  const found = await locator.boundingBox()
  if (found === null) throw new Error(`${locator.toString()} is not on screen`)
  return found
}

/** Main's snapshot of an Update that waits to be installed, as update.changed sends it. */
const availableSnapshot = () => {
  const sha = 'b'.repeat(40)
  return {
    enabled: true,
    checking: false,
    restartWhenIdle: false,
    lastCheck: { at: new Date().toISOString(), result: 'ok' },
    available: { sha, version: `9.9.9+${sha.slice(0, 7)}`, quiet: false },
    build: { phase: 'idle' },
    idle: true,
    previous: null,
    rolledBackFrom: null,
    harnessBehind: null,
    running: null,
    lastRestart: null,
    harnessAfterUpdate: null,
  }
}

/** Replaces the message box in main: it counts what it was shown and answers with the first button (Install). */
async function answerInstall(launched: LaunchedApp): Promise<void> {
  await launched.app.evaluate(({ dialog }) => {
    const shown: unknown[] = []
    ;(globalThis as { shownDialogs?: unknown[] }).shownDialogs = shown
    dialog.showMessageBox = ((...args: unknown[]) => {
      shown.push(args.at(-1))
      return Promise.resolve({ response: 0, checkboxChecked: false })
    }) as typeof dialog.showMessageBox
  })
}
const shownDialogs = (launched: LaunchedApp): Promise<number> => launched.app.evaluate(() => ((globalThis as { shownDialogs?: unknown[] }).shownDialogs ?? []).length)

test('the footer spans the window under the sidebar and the main area, 28 px; the chip at its right end has a red dot for a Harness not installed, and its popover closes on Esc and on a press outside', async () => {
  const launched = await launchApp({ env })
  try {
    const { window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    const footer = window.getByRole('contentinfo', { name: 'Footer' })
    await expect(footer).toBeVisible()
    const page = await window.evaluate(() => {
      const view = globalThis as unknown as { innerWidth: number; innerHeight: number; getComputedStyle(of: unknown): { getPropertyValue(name: string): string }; document: { documentElement: unknown } }
      return { width: view.innerWidth, height: view.innerHeight, token: view.getComputedStyle(view.document.documentElement).getPropertyValue('--footer-height').trim() }
    })
    expect(page.token).toBe('28px')
    // Across the whole window at its bottom, 28 px at the interface scale of 100 %.
    const strip = await box(footer)
    expect(strip.x).toBe(0)
    expect(strip.width).toBeCloseTo(page.width, 0)
    expect(strip.height).toBeCloseTo(28, 0)
    expect(strip.y + strip.height).toBeCloseTo(page.height, 0)
    // The sidebar and the main area end where it begins.
    const sidebar = await box(window.getByRole('navigation', { name: 'Sidebar' }))
    const main = await box(window.locator('.w-shell__main'))
    expect(sidebar.y + sidebar.height).toBeCloseTo(strip.y, 0)
    expect(main.y + main.height).toBeCloseTo(strip.y, 0)
    expect(main.x + main.width).toBeCloseTo(page.width, 0)
    // The header has no Harness column and no version any more.
    const toolbar = window.getByRole('banner')
    await expect(toolbar.getByTestId('harness-status')).toHaveCount(0)
    await expect(toolbar.getByTestId('app-version')).toHaveCount(0)

    // The chip at the right end of the footer: the version and a red dot, the reason in its name.
    const chip = footer.getByTestId('app-version')
    const chipBox = await box(chip)
    expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(strip.x + strip.width)
    expect(strip.x + strip.width - (chipBox.x + chipBox.width), 'the chip ends near the right edge').toBeLessThan(24)
    expect(chipBox.y).toBeGreaterThanOrEqual(strip.y)
    expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(strip.y + strip.height + 0.5)
    await expect(chip).toHaveText(/^v\d+\.\d+\.\S+$/)
    await expect(chip).toHaveAttribute('data-dot', 'red')
    await expect(chip).toHaveAccessibleName(/^worfy v\S+ — Harness needs Install$/)
    await expect(chip.getByTestId('version-dot')).toHaveClass(/w-version-dot--red/)

    // The popover above the chip: the app row, the Harness line with Install, the memory row.
    const popover = await openVersionPopover(window)
    await expect(popover.getByTestId('version-app-line')).toHaveText(/^worfy v\S+$/)
    await expect(popover.getByTestId('harness-text')).toHaveText('Harness not installed')
    await expect(popover.getByTestId('harness-action')).toHaveAccessibleName('Install')
    await expect(popover.getByTestId('version-memory-line')).toBeVisible()
    const frame = await box(popover)
    expect(frame.y + frame.height, 'the popover opens above the chip').toBeLessThanOrEqual(chipBox.y + 0.5)
    expect(frame.x + frame.width).toBeLessThanOrEqual(page.width)
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`03-footer-popover-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })

    // Esc closes it; so does a press outside it — on the empty middle of the footer.
    await window.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    await openVersionPopover(window)
    await footer.click({ position: { x: Math.round(strip.width / 2), y: Math.round(strip.height / 2) } })
    await expect(popover).toHaveCount(0)
    // The chip itself toggles it.
    await chip.click()
    await expect(popover).toBeVisible()
    await chip.click()
    await expect(popover).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

test('Install from the popover opens the consent dialog and takes the red dot away; an Update of worfy gives the chip an amber dot and "Update worfy" in the popover', async () => {
  const launched = await launchApp({ env })
  try {
    const { app, window } = launched
    const chip = window.getByTestId('footer').getByTestId('app-version')
    await expect(chip).toHaveAttribute('data-dot', 'red')
    const popover = await openVersionPopover(window)
    await answerInstall(launched)
    await popover.getByTestId('harness-action').click()
    await expect(popover.getByTestId('harness-text')).toHaveText(`Harness ${bundledVersion()}`)
    expect(await shownDialogs(launched)).toBe(1)
    await expect(chip).not.toHaveAttribute('data-dot', 'red')
    await expect(chip).not.toHaveAccessibleName(/is available$/)
    await window.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)

    // An Update waits: amber, before anything the Codex line may still offer.
    await app.evaluate(({ BrowserWindow }, payload) => {
      for (const each of BrowserWindow.getAllWindows()) each.webContents.send('worfy:update.changed', payload)
    }, availableSnapshot())
    await expect(chip).toHaveAttribute('data-dot', 'amber')
    await expect(chip).toHaveAccessibleName(/^worfy v\S+ — worfy .+ is available$/)
    await expect(chip.getByTestId('version-dot')).toHaveClass(/w-version-dot--amber/)
    await openVersionPopover(window)
    const appLine = popover.getByTestId('version-app-line')
    await expect(appLine).toContainText('available')
    await expect(appLine.getByRole('button')).toHaveText(['Update worfy', "What's new"])
    await window.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    // The dot stays until the Update is installed.
    await expect(chip).toHaveAttribute('data-dot', 'amber')
  } finally {
    await launched.close()
  }
})
