import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes } from './snapshots'
import { startUpdateStub, type UpdateStub } from '../update-stub'

// worfy-update ticket 09: Settings → General → Updates and the Command palette's "Update worfy"
// against the built app with Update on (WORFY_UPDATE=1). GitHub is the local stub of test/update-stub.ts,
// the Stable copy and its previous copy are folders in a temporary folder (WORFY_UPDATE_STABLE), the
// repository to build from does not exist, and the native dialog of the roll back is replaced: nothing
// here reaches GitHub, builds, or touches a real Stable copy. Snapshots of the block and of the
// palette row in both themes: test-results/e2e/snapshots/09-updates-*/ (test/e2e/snapshots.ts).

const SETTINGS = 'app.settings'
const RUNNING = 'a1'.repeat(20)
const NEWER = 'b2'.repeat(20)
const PREVIOUS = 'c3'.repeat(20)

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** The page's globals this file uses: the e2e typecheck has no DOM library. */
interface PageGlobals {
  worfy: { invoke(channel: string): Promise<{ ok: boolean; value?: { build: { phase: string }; idle: boolean } }> }
}

let scratch: string
let stub: UpdateStub

/** The Stable copy of the test, the file with the commit it runs, and a previous copy with its file. */
function stableCopies(): string {
  const stable = join(scratch, process.platform === 'win32' ? 'worfy-stable' : 'worfy-stable.app')
  mkdirSync(stable)
  writeFileSync(join(scratch, 'worfy-stable.json'), JSON.stringify({ commit: RUNNING }))
  mkdirSync(join(scratch, 'worfy-stable.previous'))
  writeFileSync(join(scratch, 'worfy-stable.previous.json'), JSON.stringify({ commit: PREVIOUS }))
  return stable
}

test.beforeEach(async () => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-update-settings-')))
})

test.afterEach(async () => {
  await stub?.close()
  await removeDir(scratch)
})

/**
 * worfy with Update on; the first scheduled check finds main at the commit this copy runs. `env`: more
 * of the app's environment (its own WORFY_DATA_DIR).
 */
async function launch(env: Record<string, string> = {}): Promise<LaunchedApp> {
  const stable = stableCopies()
  stub = await startUpdateStub({ head: RUNNING }, { stable })
  return launchApp({
    env: {
      ...env,
      WORFY_UPDATE: '1',
      WORFY_UPDATE_API: stub.url,
      WORFY_UPDATE_STABLE: stable,
      // Nothing to clone: a build that started anyway would fail, never fetch.
      WORFY_UPDATE_REPO: join(scratch, 'no-repo'),
    },
  })
}

async function openGeneral(app: ElectronApplication, window: Page) {
  await clickMenuItem(app, SETTINGS)
  const dialog = window.getByRole('dialog', { name: 'Settings' })
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('General')
  return dialog
}

/** What main's update.state says the build is doing now. */
const buildPhase = (window: Page): Promise<string | undefined> =>
  window.evaluate(async () => {
    const answer = await (globalThis as unknown as PageGlobals).worfy.invoke('update.state')
    return answer.value?.build.phase
  })

/** Whether main's update.state says nothing works (no Session in a turn, no Autopilot run). */
const idleNow = (window: Page): Promise<boolean | undefined> =>
  window.evaluate(async () => {
    const answer = await (globalThis as unknown as PageGlobals).worfy.invoke('update.state')
    return answer.value?.idle
  })

/** Sends a snapshot to the window as main's update.changed would: only for the snapshots of states the stub cannot reach. */
const sendSnapshot = (app: ElectronApplication, snapshot: Record<string, unknown>): Promise<void> =>
  app.evaluate(({ BrowserWindow }, payload) => {
    for (const each of BrowserWindow.getAllWindows()) each.webContents.send('worfy:update.changed', payload)
  }, snapshot)

test('"Check now" shows the Available update; with "Update automatically" off nothing is built', async () => {
  const launched = await launch()
  try {
    const { app, window, dataDir } = launched
    const dialog = await openGeneral(app, window)
    const status = dialog.getByTestId('settings-updates-status')
    await expect(status).toHaveText(/^worfy \S+\.( Last checked .+\.)?$/u)
    await expect(dialog.getByRole('button', { name: 'Update worfy' })).toHaveCount(0)

    const toggle = dialog.getByRole('switch', { name: 'Update automatically', exact: true })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect.poll(() => (JSON.parse(readFileSync(join(dataDir, 'app-settings.json'), 'utf8')) as { autoUpdate?: boolean }).autoUpdate).toBe(false)

    // main moves on to a newer commit with a green ci-ok that changes the app.
    stub.answers = { head: NEWER, version: '9.9.9', compare: { status: 'ahead', files: ['src/main/index.ts'] } }
    await dialog.getByRole('button', { name: 'Check now' }).click()
    await expect(status).toHaveText(`worfy 9.9.9+${NEWER.slice(0, 7)} is available.`)
    await expect(dialog.getByRole('button', { name: 'Update worfy' })).toBeEnabled()
    // The check is over and has its answer: with the switch off no build began after it.
    expect(await buildPhase(window)).toBe('idle')
    expect(existsSync(join(dataDir, 'update', 'repo'))).toBe(false)
    await snapshotThemes(window, '09-updates-available')

    // The palette row of the same state: built from the window's snapshot.
    await dialog.getByRole('button', { name: 'Close' }).click()
    await window.keyboard.press('ControlOrMeta+k')
    const palette = window.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    await window.getByTestId('palette-input').fill('update')
    const row = palette.locator('[data-testid="palette-option"][data-command="update-worfy"]')
    await expect(row).toContainText('Update worfy')
    await expect(row).toContainText(`worfy 9.9.9+${NEWER.slice(0, 7)} available`)
    await snapshotThemes(window, '09-updates-palette-available')
    await window.keyboard.press('Escape')

    // The states the stub cannot reach (a build, its end, missing tools, a roll back), drawn from a
    // snapshot sent to the window, for the snapshots only.
    const base = {
      enabled: true,
      checking: false,
      restartWhenIdle: false,
      lastCheck: { at: new Date().toISOString(), result: 'ok' },
      available: { sha: NEWER, version: `9.9.9+${NEWER.slice(0, 7)}`, quiet: false },
      build: { phase: 'idle' },
      idle: true,
      previous: { version: PREVIOUS.slice(0, 7) },
      rolledBackFrom: null,
      harnessBehind: null,
      running: { commit: RUNNING, version: `1.0.0+${RUNNING.slice(0, 7)}` },
      lastRestart: null,
      harnessAfterUpdate: null,
    }
    const states: [string, Record<string, unknown>, string | RegExp][] = [
      ['building', { ...base, build: { phase: 'building', sha: NEWER, version: `9.9.9+${NEWER.slice(0, 7)}` } }, `Building worfy 9.9.9+${NEWER.slice(0, 7)}…`],
      // Ticket 16: the step, its place and the time since the build began, with "Show log".
      [
        'building-step',
        { ...base, build: { phase: 'building', sha: NEWER, version: `9.9.9+${NEWER.slice(0, 7)}`, step: 'install', steps: 3, startedAt: new Date(Date.now() - 192_000).toISOString(), stepStartedAt: new Date().toISOString() } },
        new RegExp(`Building worfy 9\\.9\\.9\\+${NEWER.slice(0, 7)}… 2/3 Installing dependencies · \\d+:\\d\\d$`, 'u'),
      ],
      ['ready-busy', { ...base, idle: false, build: { phase: 'ready', sha: NEWER, version: `9.9.9+${NEWER.slice(0, 7)}` } }, `worfy 9.9.9+${NEWER.slice(0, 7)} is ready.`],
      ['missing-tools', { ...base, build: { phase: 'failed', missing: ['pnpm'] } }, `worfy 9.9.9+${NEWER.slice(0, 7)} is available.`],
      ['rolled-back', { ...base, available: { ...base.available, quiet: true }, rolledBackFrom: NEWER, previous: null }, `worfy 1.0.0+${RUNNING.slice(0, 7)}.`],
    ]
    const settings = await openGeneral(app, window)
    for (const [name, snapshot, line] of states) {
      await sendSnapshot(app, snapshot)
      await expect(settings.getByTestId('settings-updates-status')).toContainText(line)
      if (name === 'building-step') {
        await expect(settings.getByTestId('settings-updates-show-log')).toBeVisible()
        await expect(settings.getByTestId('settings-updates-install')).toBeDisabled()
      }
      await snapshotThemes(window, `${name === 'building-step' ? '16' : '09'}-updates-${name}`)
    }
    await sendSnapshot(app, { ...base, idle: false, build: { phase: 'ready', sha: NEWER, version: `9.9.9+${NEWER.slice(0, 7)}` } })
    await settings.getByRole('button', { name: 'Close' }).click()
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('update')
    await expect(palette.locator('[data-testid="palette-option"][data-command="update-worfy"]')).toContainText('ready — restart')
    await snapshotThemes(window, '09-updates-palette-ready')
  } finally {
    await launched.close()
  }
})

test('"Roll back to previous version" asks the native dialog first; Cancel changes nothing', async () => {
  // A roll back runs the helper of the Update clone (scripts/install-stable.mjs, ticket 04): here a
  // script that only leaves a mark, so a roll back that went ahead would show.
  const dataDir = join(scratch, 'data')
  const helper = join(dataDir, 'update', 'repo', 'scripts')
  const ran = join(scratch, 'helper-ran')
  mkdirSync(helper, { recursive: true })
  writeFileSync(join(helper, 'install-stable.mjs'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(ran)}, 'ran')\n`)
  const launched = await launch({ WORFY_DATA_DIR: dataDir })
  try {
    const { app, window } = launched
    await app.evaluate(({ dialog }) => {
      const shown: unknown[] = []
      ;(globalThis as { shownDialogs?: unknown[] }).shownDialogs = shown
      dialog.showMessageBox = ((...args: unknown[]) => {
        shown.push(args.at(-1))
        // Button 1: "Cancel".
        return Promise.resolve({ response: 1, checkboxChecked: false })
      }) as typeof dialog.showMessageBox
    })
    // The palette has "Update worfy" before Settings was ever opened: it reads the Update snapshot itself.
    await window.keyboard.press('ControlOrMeta+k')
    const palette = window.getByTestId('command-palette')
    await window.getByTestId('palette-input').fill('update')
    await expect(palette.locator('[data-testid="palette-option"][data-command="update-worfy"]')).toContainText('check for a new version')
    await window.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)

    const settings = await openGeneral(app, window)
    const rollback = settings.getByTestId('settings-updates-rollback-row')
    await expect(rollback).toContainText(`Return to worfy ${PREVIOUS.slice(0, 7)}. Automatic updates wait for the next commit on main.`)
    await snapshotThemes(window, '09-updates-checked')

    // The roll back is refused while something works; main counts Autopilot as running until it has loaded.
    await expect.poll(() => idleNow(window)).toBe(true)
    await rollback.getByRole('button', { name: 'Roll back' }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as { shownDialogs?: unknown[] }).shownDialogs ?? []))
      .toEqual([expect.objectContaining({ message: `Roll back to worfy ${PREVIOUS.slice(0, 7)}?`, buttons: ['Roll back', 'Cancel'] })])
    // Nothing happened: the button is back, no reason is shown, the previous copy is where it was,
    // no restart was planned, and the app still answers.
    await expect(rollback.getByRole('button', { name: 'Roll back' })).toBeEnabled()
    await expect(settings.getByTestId('settings-updates-rollback-problem')).toHaveCount(0)
    expect(existsSync(join(scratch, 'worfy-stable.previous'))).toBe(true)
    expect(existsSync(join(dataDir, 'update', 'restart.json'))).toBe(false)
    expect(existsSync(ran)).toBe(false)
    expect(await buildPhase(window)).toBe('idle')
  } finally {
    await launched.close()
  }
})
