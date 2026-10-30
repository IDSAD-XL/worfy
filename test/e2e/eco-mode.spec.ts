import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The Eco mode switch under the Orchestrator's input field (worfy-throughput ticket 60) against the
// built app, on the fake agent, with the real harness/bin/profile-set over a temporary Harness home:
// a click on writes `workflow.agents: "eco"` and Sonnet with effort medium for the four agent roles
// into the Project's profile.json, a click off removes both fields, and a Profile changed outside
// worfy since the switch read it is not written — the switch shows it as it is now.
//
// The app finds bin/profile-set in its Claude home (src/main/harness/locate.ts, the old layout). The
// one there is a Node stand-in that runs the repository's harness/bin/profile-set with the temporary
// Harness home and home folder, so nothing of the machine's own Harness is read or written.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const PROFILE_SET = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'profile-set')
const PROFILE = {
  schema: 2,
  name: 'alpha',
  mode: 'full',
  commands: { test: 'make test' },
  workflow: { ci: 'pr', pipeline: [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'done' }] },
  review: { lenses: ['correctness'] },
}
const SONNET_MEDIUM = { model: 'sonnet', effort: 'medium' }

let scratch: string
let dataDir: string
let claudeHome: string
let harnessHome: string
let profileJson: string

function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-eco-mode-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  harnessHome = join(scratch, 'harness-home')
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  for (const dir of [join(dataDir, PROJECT), join(claudeHome, 'bin'), join(harnessHome, 'gate'), join(harnessHome, 'projects', 'alpha'), home, repo]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'alpha', match: repo, profile: 'alpha' }] }))
  profileJson = join(harnessHome, 'projects', 'alpha', 'profile.json')
  writeFileSync(profileJson, `${JSON.stringify(PROFILE, null, 2)}\n`)
  writeFileSync(join(harnessHome, 'projects', 'alpha', 'rules.md'), '# alpha rules\n')
  git(harnessHome, 'init', '-q')
  git(harnessHome, 'add', '-A')
  git(harnessHome, 'commit', '-q', '-m', 'init')
  const env = { HARNESS_HOME: harnessHome, HOME: home, USERPROFILE: home }
  writeFileSync(
    join(claudeHome, 'bin', 'profile-set'),
    [
      "const { spawnSync } = require('node:child_process')",
      `const env = { ...process.env, ...${JSON.stringify(env)} }`,
      'for (const name of ["CLAUDE_GATE_CONFIG", "CLAUDE_PROFILES_DIR", "EVAL_HARNESS_HOME"]) delete env[name]',
      `const run = spawnSync(process.execPath, [${JSON.stringify(PROFILE_SET)}, ...process.argv.slice(2)], { stdio: 'inherit', env })`,
      'process.exit(run.status ?? 1)',
      '',
    ].join('\n'),
  )
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

/** Resizes the app's window until its page is `width` px wide. */
async function resizeWindow(app: ElectronApplication, window: Page, width: number, height: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const now = await window.locator('html').evaluate((element) => element.clientWidth)
        if (now !== width) await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted.width, wanted.height), { width, height })
        return now
      },
      { message: `the window is ${width} px wide` },
    )
    .toBe(width)
}

/** The bar under the input field in the light and the dark theme, into the test's output folder. */
async function snapshotBar(window: Page, bar: Locator, name: string): Promise<void> {
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await bar.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`), animations: 'disabled' })
    }
  } finally {
    await window.emulateMedia({ colorScheme: null })
  }
}

type Written = typeof PROFILE & { agents?: unknown; workflow: { agents?: unknown } }
const written = (): Written => JSON.parse(readFileSync(profileJson, 'utf8')) as Written

test("the Orchestrator's Eco mode switch writes the Project's Profile: on, off, and nothing over a Profile changed outside", async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-view' } })
  try {
    const { app, window } = launched
    const view = await openSession(window)
    const bar = view.locator('.w-composer__bar')
    const eco = bar.getByRole('switch', { name: 'Eco mode' })
    const caption = eco.locator('.w-eco__label')
    const model = bar.getByTestId('picker-model')
    // Off, and usable once the Profile is read: it has no workflow.agents.
    await expect(eco).toHaveAttribute('aria-checked', 'false')
    await expect(eco).toHaveAttribute('title', /applies to the next Ticket/u)
    await expect(eco).not.toHaveAttribute('aria-disabled', 'true')

    // A wide bar: the pickers keep their captions, and the switch its caption, right of the permission picker.
    await window.getByRole('button', { name: 'Hide sidebar' }).click()
    await resizeWindow(app, window, 1920, 1080)
    await expect(model).not.toHaveClass(/w-pickers__select--bare/u)
    await expect(caption).toBeVisible()
    expect((await eco.boundingBox())!.x).toBeGreaterThan((await bar.getByTestId('picker-permissions').boundingBox())!.x)
    await snapshotBar(window, bar, 'eco-off-wide')

    // The switch shows the value it writes at once; the write is done once it is no longer busy.
    await eco.click()
    await expect(eco).toHaveAttribute('aria-checked', 'true')
    await expect(eco).not.toHaveAttribute('aria-busy', 'true')
    await expect(eco.getByTestId('eco-mode-icon')).toHaveAttribute('data-icon', 'leaf')
    expect(written().workflow.agents).toBe('eco')
    expect(written().agents).toEqual({ implementer: SONNET_MEDIUM, reviewer: SONNET_MEDIUM, scout: SONNET_MEDIUM, verifier: SONNET_MEDIUM })
    await snapshotBar(window, bar, 'eco-on-wide')

    // A narrower bar: the caption is the first to go; the icon and the tooltip stay.
    await resizeWindow(app, window, 1100, 800)
    await expect(caption).toBeHidden()
    await expect(eco.getByTestId('eco-mode-icon')).toBeVisible()
    await expect(eco).toHaveAttribute('title', /applies to the next Ticket/u)
    await snapshotBar(window, bar, 'eco-on-narrow')

    await eco.click()
    await expect(eco).toHaveAttribute('aria-checked', 'false')
    await expect(eco).not.toHaveAttribute('aria-busy', 'true')
    await expect(eco.getByTestId('eco-mode-icon')).toHaveAttribute('data-icon', 'bolt')
    expect(written()).toEqual(PROFILE)
    await snapshotBar(window, bar, 'eco-off-narrow')

    // Turned on outside worfy: the switch still shows off, and a click finds the Profile changed.
    const outside = `${JSON.stringify({ ...PROFILE, workflow: { ...PROFILE.workflow, agents: 'eco' } }, null, 2)}\n`
    writeFileSync(profileJson, outside)
    await eco.click()
    await expect(window.getByTestId('eco-mode-toast')).toContainText('The Profile changed outside worfy')
    await expect(eco).toHaveAttribute('aria-checked', 'true')
    expect(readFileSync(profileJson, 'utf8')).toBe(outside)
  } finally {
    await launched.close()
  }
})
