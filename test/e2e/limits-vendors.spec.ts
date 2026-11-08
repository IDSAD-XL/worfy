import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'
import { profileJsonScript } from '../harness-node'

// The Limits panel by Vendor (worfy-multi-vendor ticket 26) against the built app: Claude's section from
// limits.json, and the Codex section from the background poll of the Codex driver, which e2e runs make
// on the fake app-server (WORFY_CODEX=fake, src/main/agent/limits-usage.ts). The poll starts only when
// the launch's CODEX_HOME exists: here it does, and the fake plays test/fixtures/codex-scripts/
// account-plus.jsonl — signed in to the Plus plan, a 5-hour window at 12 % and a weekly one at 40 %.
// The section comes from the poll, not from a Codex turn; the turn's `limits` event is
// test/contract/codex-session-limits.test.ts.
// The window is 1280 px wide with a Project open, as the F mockup draws the toolbar: with both sections, each
// named by its Vendor's logo alone (ticket 24; owner, 2026-11-03), and the compact bars at 72 px, the Project
// title and its branch line stay whole (ticket 26, rework round 1).

/**
 * The Project of the F mockup (docs/design/F-canvas-light.dc.html), under an invented name as wide as
 * the mockup's, so the title `worfy — caution` takes the room the mockup draws.
 */
const PROJECT = 'caution'
const WIDTH = 1280

/**
 * A `bin/profile` stub that knows every folder, so "Add project" puts the repository into the list at
 * once (as in test/e2e/toolbar.spec.ts).
 */
const KNOWS_ALL = profileJsonScript('{"name":"stub","_resolved":{"workspace":null}}')

function makeRepo(parent: string, name: string): string {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, env })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), name)
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return realpathSync.native(dir)
}

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
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true)
    // Set the size once the window is on screen (macOS fits a window shown later into the display).
    await expect
      .poll(async () => {
        const width = await window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
        if (width !== WIDTH) await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted, 800), WIDTH)
        return width
      })
      .toBe(WIDTH)
    const repo = makeRepo(scratch, PROJECT)
    mkdirSync(join(launched.claudeHome, 'bin'), { recursive: true })
    writeFileSync(join(launched.claudeHome, 'bin', 'profile'), KNOWS_ALL, { mode: 0o755 })
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, repo)
    await window.getByRole('button', { name: 'Add project' }).click()
    const toolbar = window.getByRole('banner')
    await expect(toolbar.locator('.w-toolbar__name')).toHaveText(`worfy — ${PROJECT}`)

    const meter = window.getByTestId('limits-meter')
    const claude = meter.getByRole('group', { name: 'Claude Code limits' })
    const codex = meter.getByRole('group', { name: 'Codex limits' })

    await expect(codex).toBeVisible()
    // Each section starts with its Vendor's logo and shows no Vendor name (ticket 24; owner, 2026-11-03): the
    // name is the section's tooltip and the logo's accessible name. A thin line parts the two sections.
    for (const [section, vendor, name] of [[claude, 'claude', 'Claude Code'], [codex, 'codex', 'Codex']] as const) {
      await expect(section).toHaveAttribute('title', name)
      const logo = section.getByRole('img', { name, exact: true })
      await expect(logo).toBeVisible()
      await expect(logo).toHaveAttribute('data-testid', `limits-${vendor}-logo`)
      await expect(logo).toHaveText('')
      await expect(logo.locator('svg')).toHaveAttribute('fill', 'currentColor')
    }
    await expect(meter).not.toContainText('Claude')
    await expect(meter).not.toContainText('Codex')
    await expect(meter.getByTestId('limits-divider')).toHaveCount(1)
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
    // The compact bars are 72 px, the widest at which the title below stays whole (80 px cut it by 29 px).
    expect(first.width, 'a compact bar is 72 px wide').toBe(72)

    // Claude's section keeps its bars and their test ids.
    await expect(claude.getByTestId('limit-five_hour-value')).toHaveText('62%')
    await expect(claude.getByTestId('limit-seven_day-value')).toHaveText('38%')
    expect((await box(claude)).x, 'Claude\'s section first').toBeLessThan((await box(codex)).x)

    // Both sections fit the toolbar: the meter ends before the Harness column, inside the window.
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

    // The Project title and its branch line stay whole next to both sections: neither is cut with an
    // ellipsis (visible Vendor names once left the title ~6 px, `w…`), and the title ends before the View switch.
    const title = await box(toolbar.locator('.w-toolbar__title'))
    const view = await box(toolbar.getByRole('group', { name: 'View', exact: true }))
    expect(title.x + title.width, `the title (${JSON.stringify(title)}) ends before the View switch (${JSON.stringify(view)})`).toBeLessThanOrEqual(view.x)
    for (const [part, locator] of [
      ['title', toolbar.locator('.w-toolbar__name')],
      ['branch line', toolbar.locator('.w-toolbar__subtitle-text')],
    ] as const) {
      const overflow = await locator.evaluate((node) => {
        const found = node as unknown as { scrollWidth: number; clientWidth: number }
        return { scrollWidth: found.scrollWidth, clientWidth: found.clientWidth }
      })
      expect(overflow.scrollWidth, `the ${part} is whole (${JSON.stringify(overflow)})`).toBeLessThanOrEqual(overflow.clientWidth)
      // How much room the part has to spare, in the test's report: the margin left before it is cut.
      test.info().annotations.push({ type: `${part} room`, description: JSON.stringify(overflow) })
    }
    await expect(toolbar.locator('.w-toolbar__subtitle-text')).toHaveText(`${PROJECT} · main`)

    await screenshots(window, 'limits-vendors')
  } finally {
    await launched.close()
  }
})

test('signed in to Codex with no windows and Claude without data: each section is its logo beside its line', async () => {
  // A Codex plan that reports no window (the fake's account-plus with both windows null), and no limits.json.
  const scripts = join(scratch, 'codex-scripts')
  mkdirSync(scripts)
  const plus = readFileSync(join(repoRoot, 'test', 'fixtures', 'codex-scripts', 'account-plus.jsonl'), 'utf8')
  const empty = plus.replace(/"primary":\{[^}]*\},"secondary":\{[^}]*\}/, '"primary":null,"secondary":null')
  if (empty === plus) throw new Error('the account-plus fixture no longer has its two windows')
  writeFileSync(join(scripts, 'account-empty.jsonl'), empty)
  rmSync(join(dataDir, 'limits.json'))
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: 'account-empty', WORFY_CODEX_SCRIPTS: scripts } })
  try {
    const { window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    const meter = window.getByTestId('limits-meter')
    const codex = meter.getByRole('group', { name: 'Codex limits' })
    await expect(codex.getByTestId('limits-codex-empty')).toHaveText('No limits reported')
    // The line says what the section holds and the logo whose it is: no Vendor name is needed beside them.
    await expect(codex.getByRole('img', { name: 'Codex', exact: true })).toBeVisible()
    await expect(codex).toHaveText('No limits reported')
    const claude = meter.getByRole('group', { name: 'Claude Code limits' })
    await expect(claude.getByTestId('limits-claude-empty')).toHaveText('no data yet')
    await expect(claude.getByRole('img', { name: 'Claude Code', exact: true })).toBeVisible()
    await expect(meter).toHaveText('no data yetNo limits reported')
    await screenshots(window, 'limits-vendors-empty')
  } finally {
    await launched.close()
  }
})
