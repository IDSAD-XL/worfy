import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { animatedText, launchApp, repoRoot, type LaunchedApp } from './helpers'
import { profileJsonScript } from '../harness-node'

// The Limits panel by Vendor (worfy-multi-vendor ticket 26) against the built app: Claude's section from
// limits.json, and the Codex section from the background poll of the Codex driver, which e2e runs make
// on the fake app-server (WORFY_CODEX=fake, src/main/agent/limits-usage.ts). The poll starts only when
// the launch's CODEX_HOME exists: here it does, and the fake plays test/fixtures/codex-scripts/
// account-plus.jsonl — signed in to the Plus plan, a 5-hour window at 12 % and a weekly one at 40 %.
// The section comes from the poll, not from a Codex turn; the turn's `limits` event is
// test/contract/codex-session-limits.test.ts.
// The window is 1280 px wide with a Project open, as the F mockup draws the toolbar: with both sections, each
// named by its Vendor's logo alone (ticket 24; owner, 2026-11-03), the Project title and its branch line stay
// whole (ticket 26, rework round 1). worfy-polish ticket 93: each Vendor's windows stand one above the other,
// one line each, so a section is about as wide as one line; checked at 1280 px and 1600 px, and with Claude's
// section alone. With WORFY_EVIDENCE_DIR set, the toolbar screenshots are copied there.

/**
 * The Project of the F mockup (docs/design/F-canvas-light.dc.html), under an invented name as wide as
 * the mockup's, so the title takes about the room the mockup draws (the title names the Project alone next to the sidebar since worfy-polish ticket 94).
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

/** Screenshots of the toolbar in both themes, kept with the test's output and copied to WORFY_EVIDENCE_DIR when it is set. */
async function screenshots(window: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    const file = test.info().outputPath(`${name}-${scheme}.png`)
    await window.getByRole('banner').screenshot({ path: file })
    const dir = process.env.WORFY_EVIDENCE_DIR
    if (dir !== undefined && dir !== '') {
      mkdirSync(dir, { recursive: true })
      copyFileSync(file, join(dir, `${name}-${scheme}.png`))
    }
  }
  await window.emulateMedia({ colorScheme: null })
}

/** The window's content to `width` px wide, once it is on screen (macOS fits a window shown later into the display). */
async function sizeWindow({ app, window }: LaunchedApp, width: number): Promise<void> {
  await expect
    .poll(async () => {
      const now = await window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
      if (now !== width) await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted, 800), width)
      return now
    })
    .toBe(width)
}

/**
 * A section's windows one above the other (worfy-polish ticket 93): each next one starts under the one
 * before it, at the same x, and no text of a window is cut.
 */
async function expectStacked(section: Locator, ids: readonly string[]): Promise<void> {
  for (let index = 1; index < ids.length; index++) {
    const above = await box(section.getByTestId(ids[index - 1]!))
    const below = await box(section.getByTestId(ids[index]!))
    expect(below.y, `${ids[index]!} under ${ids[index - 1]!}`).toBeGreaterThanOrEqual(above.y + above.height)
    expect(below.x, `${ids[index]!} in the column of ${ids[index - 1]!}`).toBe(above.x)
  }
  for (const id of ids) {
    const cut = await section.getByTestId(id).evaluate((node) => {
      type Element = { scrollWidth: number; clientWidth: number; querySelectorAll(selector: string): Iterable<Element> }
      const element = node as unknown as Element
      return [element, ...element.querySelectorAll('*')].some((each) => each.scrollWidth > each.clientWidth && each.clientWidth > 0)
    })
    expect(cut, `a text of ${id} is cut`).toBe(false)
  }
}

/**
 * The widest a Vendor's section may be. Before worfy-polish ticket 93 a section was its logo and two bars
 * of 72 px side by side, 172 px. One line of label, share and reset time at 10 px measured 125 px for
 * Claude's and 128 px for Codex's with the full labels; with the short ones (`7d 38% Fri 11:19`,
 * `7d 40% Sat 00:40`; owner, 2026-11-10) 104 px and 107 px on macOS.
 */
const SECTION_MAX = 112

test('signed in to Codex: a Codex section with the windows of its plan next to Claude\'s, inside the toolbar', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: 'account-plus', WORFY_CODEX_SCRIPTS: join(repoRoot, 'test', 'fixtures', 'codex-scripts') } })
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true)
    await sizeWindow(launched, WIDTH)
    const repo = makeRepo(scratch, PROJECT)
    mkdirSync(join(launched.claudeHome, 'bin'), { recursive: true })
    writeFileSync(join(launched.claudeHome, 'bin', 'profile'), KNOWS_ALL, { mode: 0o755 })
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, repo)
    await window.getByRole('button', { name: 'Add project' }).click()
    const toolbar = window.getByRole('banner')
    await expect(toolbar.locator('.w-toolbar__name')).toHaveText(PROJECT)

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
    await expect(animatedText(codex.getByTestId('limit-codex-primary-value'))).toHaveText('12%')
    // Two sections make the panel compact: the reset line is the time alone, the whole line its tooltip.
    await expect(meter).toHaveAttribute('data-compact', 'true')
    await expect(codex.getByTestId('limit-codex-secondary-note')).toHaveText(/^[A-Z][a-z]{2} \d\d:\d\d$/)
    await expect(codex.getByTestId('limit-codex-secondary-note')).toHaveAttribute('title', /^resets [A-Z][a-z]{2} \d\d:\d\d$/)
    // The 5-hour window above the weekly one, and Claude's 5-hour above its 7-day (worfy-polish ticket 93).
    await expectStacked(codex, ['limit-codex-primary', 'limit-codex-secondary'])
    await expectStacked(claude, ['limit-five_hour', 'limit-seven_day'])
    for (const [vendor, section] of [['claude', claude], ['codex', codex]] as const) {
      const width = (await box(section)).width
      test.info().annotations.push({ type: `${vendor} section width at ${WIDTH} px`, description: String(width) })
      expect(width, `the ${vendor} section is no wider than ${SECTION_MAX} px`).toBeLessThanOrEqual(SECTION_MAX)
    }

    // Claude's section keeps its bars and their test ids.
    await expect(animatedText(claude.getByTestId('limit-five_hour-value'))).toHaveText('62%')
    await expect(animatedText(claude.getByTestId('limit-seven_day-value'))).toHaveText('38%')
    // Short labels in the toolbar (owner, 2026-11-10), the full ones in the meters' names and the values' tooltips.
    await expect(claude.locator('.w-limit-bar__label')).toHaveText(['5h', '7d'])
    await expect(codex.locator('.w-limit-bar__label')).toHaveText(['5h', '7d'])
    await expect(claude.getByTestId('limit-five_hour-value')).toHaveAttribute('title', /^5-hour: 62% · resets /)
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

    await screenshots(window, `limits-vendors-${WIDTH}`)

    // 1600 px: the same two stacks, inside the toolbar.
    await sizeWindow(launched, 1600)
    await expectStacked(codex, ['limit-codex-primary', 'limit-codex-secondary'])
    await expectStacked(claude, ['limit-five_hour', 'limit-seven_day'])
    const wide = await box(meter)
    expect(wide.y >= bar.y && wide.y + wide.height <= bar.y + bar.height, 'the Limits inside the toolbar at 1600 px').toBe(true)
    expect(wide.x + wide.width, 'the Limits end before the Harness column at 1600 px').toBeLessThanOrEqual((await box(toolbar.getByTestId('harness-column'))).x)
    await screenshots(window, 'limits-vendors-1600')
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

test('Claude Code alone, at 1280 px and 1600 px: its two windows one above the other under the "Limits" heading', async () => {
  // No CODEX_HOME: no Codex poll, so Claude's section is the only one.
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true)
    const toolbar = window.getByRole('banner')
    const meter = window.getByTestId('limits-meter')
    const claude = meter.getByRole('group', { name: 'Claude Code limits' })
    for (const width of [WIDTH, 1600]) {
      await sizeWindow(launched, width)
      await expect(animatedText(claude.getByTestId('limit-five_hour-value'))).toHaveText('62%')
      await expect(meter.getByRole('group', { name: 'Codex limits' })).toHaveCount(0)
      await expect(meter).not.toHaveAttribute('data-compact', 'true')
      await expect(meter.getByText('Limits', { exact: true })).toBeVisible()
      await expectStacked(claude, ['limit-five_hour', 'limit-seven_day'])
      await expect(claude.getByTestId('limit-seven_day-note')).toHaveText(/^[A-Z][a-z]{2} \d\d:\d\d$/)
      await expect(claude.getByTestId('limit-seven_day-note')).toHaveAttribute('title', /^resets [A-Z][a-z]{2} \d\d:\d\d$/)
      expect((await box(claude)).width, `the section is no wider than ${SECTION_MAX} px`).toBeLessThanOrEqual(SECTION_MAX)
      const limits = await box(meter)
      const bar = await box(toolbar)
      expect(limits.y >= bar.y && limits.y + limits.height <= bar.y + bar.height, 'the Limits inside the toolbar').toBe(true)
      await screenshots(window, `limits-claude-only-${width}`)
    }
  } finally {
    await launched.close()
  }
})
