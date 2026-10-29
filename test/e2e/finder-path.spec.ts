import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'
import { ms } from '../time-scale'

// worfy started from Finder (worfy-harness ticket 37). launchd gives such an app the PATH
// /usr/bin:/bin:/usr/sbin:/sbin, and node is not on it; the user's node is on the PATH of the login
// shell only (nvm, Homebrew). Here the app gets exactly that PATH, and the login shell is /bin/sh
// with a temporary HOME whose .profile puts a folder with node first. The Harness is the real one
// the build carries (out/harness), installed as the plugin in a temporary Claude home: its
// `profile` and `ticket` are `#!/usr/bin/env node`, and `epic-status` asks `ticket root` only when
// it finds node. The Project is Silent: its Epic lies in the Workflow folder, outside the
// repository, before the app starts. Its Epic must be in the sidebar and on the Canvas. When the
// login shell has no node either, the sidebar says why, with the word node, instead of an empty
// list and the "No epics yet" panel (slice 2 of the ticket).

const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const PROJECT = 'silent-app-00000037'

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-finder-path-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

function commit(path: string, message: string): void {
  git(path, 'init', '-q')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', message)
}

interface Fixture {
  home: string
  claudeHome: string
  harnessHome: string
  dataDir: string
}

/**
 * The Silent Project, the Harness and the login shell. `node`: whether the login shell's PATH has
 * a folder with node; without it the login shell has the PATH of Finder too.
 */
function fixture(options: { node: boolean }): Fixture {
  const home = join(scratch, 'home')
  const claudeHome = join(home, '.claude')
  const harnessHome = join(claudeHome, 'worfy-harness')
  const dataDir = join(scratch, 'data')
  const shellBin = join(scratch, 'login-shell-bin')
  const repo = join(scratch, 'silent-app')
  // No `workflow.folder` in the Profile: the Workflow folder is the default one, in the Harness home.
  const folder = join(harnessHome, 'projects', 'sp', 'workflow')
  for (const dir of [home, join(harnessHome, 'gate'), dataDir, shellBin, repo]) mkdirSync(dir, { recursive: true })

  // node only where the login shell looks: $HOME/.profile, read by `/bin/sh -ilc`.
  symlinkSync(process.execPath, join(shellBin, 'node'))
  writeFileSync(join(home, '.profile'), `PATH='${options.node ? `${shellBin}:` : ''}${SYSTEM_PATH}'; export PATH\n`)

  // The Harness plugin as First run installs it: the scripts of this build.
  cpSync(join(repoRoot, 'out', 'harness'), join(harnessHome, 'plugin'), { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'sp', match: repo, profile: 'sp', pm: 'npm', root: {}, workspace: {} }] }))
  mkdirSync(join(harnessHome, 'projects', 'sp'), { recursive: true })
  writeFileSync(join(harnessHome, 'projects', 'sp', 'profile.json'), JSON.stringify({ schema: 2, name: 'sp', mode: 'silent', attribution: 'off', tickets: { root: '.scratch/' } }))

  writeFileSync(join(repo, 'README.md'), 'text\n')
  commit(repo, 'init')
  const issues = join(folder, '.scratch', 'e3-acceptance', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(folder, '.scratch', 'e3-acceptance', 'spec.md'), '# Epic in the Workflow folder\n\ntext\n')
  writeFileSync(join(issues, '01-first.md'), '# 01 — First\n\nType: task\nStatus: open\nBlocked by: —\n\n## Где в коде\n\n- `src/a.ts`\n')
  writeFileSync(join(folder, 'HANDOFF.md'), '# HANDOFF\n\nState kept in the Workflow folder.\n')
  commit(folder, 'epic')

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'silent-app', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 40, y: 40, zoom: 0.8 } }))
  return { home, claudeHome, harnessHome, dataDir }
}

const launch = (at: Fixture): ReturnType<typeof launchApp> =>
  launchApp({
    env: { PATH: SYSTEM_PATH, HOME: at.home, SHELL: '/bin/sh', WORFY_DATA_DIR: at.dataDir, WORFY_CLAUDE_HOME: at.claudeHome, WORFY_HARNESS_HOME: at.harnessHome },
  })

test('started with the PATH of Finder, a Silent Project shows its Epic: the Harness scripts get the login shell environment', async () => {
  // Windows has no Finder PATH and no /bin/sh: the premise below would pass only because /bin/sh is
  // missing, and node would come from the registry Path (captureWindowsEnv in src/main/agent/env.ts),
  // not from a login shell. macOS runs this test as before.
  test.skip(process.platform === 'win32', 'Finder and its PATH exist only on macOS; on Windows the PATH comes from the registry')
  const launched = await launch(fixture({ node: true }))
  try {
    const { window } = launched
    // The premise: the main process itself has the PATH of Finder, and node is not on it.
    expect(await launched.app.evaluate(() => process.env.PATH)).toBe(SYSTEM_PATH)
    expect(() => execFileSync('/bin/sh', ['-c', 'command -v node'], { env: { PATH: SYSTEM_PATH }, stdio: 'ignore' })).toThrow()

    const row = window.getByTestId('sidebar-epic')
    // The login shell and three Harness scripts run before the row appears.
    await expect(row).toHaveCount(1, { timeout: ms(20_000) })
    await expect(row).toHaveAttribute('data-epic', 'e3-acceptance')
    await expect(row).toHaveAttribute('title', 'Epic in the Workflow folder')
    const frame = window.locator('[data-testid="epic-frame"]')
    await expect(frame).toHaveCount(1, { timeout: ms(15_000) })
    await expect(frame.locator('.w-epic__title')).toContainText('Epic in the Workflow folder')
    await expect(window.locator('[data-testid="ticket-node"][data-ticket="1"]')).toHaveAttribute('data-state', 'open')
    // The documents ask the app's layout cache where the workflow lives: it runs `profile` too.
    await expect(window.getByTestId('handoff-body')).toContainText('State kept in the Workflow folder.')
  } finally {
    await launched.close()
  }
})

test('started with the PATH of Finder and no node in the login shell either, the sidebar says why, with the word node, and no "No epics yet" panel', async () => {
  // Windows has no Finder PATH and no login shell .profile to take node away: worfy builds the
  // scripts' environment from the session and the registry there (captureWindowsEnv in
  // src/main/agent/env.ts), whose Path has the machine's node. macOS runs this test as before; the
  // reason text itself is checked on every system by test/contract/workflow-profile.test.ts
  // ("readWorkflow: no node on the PATH of the environment").
  test.skip(process.platform === 'win32', 'Finder and its PATH exist only on macOS; on Windows the PATH comes from the registry')
  const launched = await launch(fixture({ node: false }))
  try {
    const { window } = launched
    expect(await launched.app.evaluate(() => process.env.PATH)).toBe(SYSTEM_PATH)
    expect(() => execFileSync('/bin/sh', ['-c', 'command -v node'], { env: { PATH: SYSTEM_PATH }, stdio: 'ignore' })).toThrow()

    // worfy finds no node to run `profile` with: where the workflow lives is unknown, and the window says so.
    const reason = window.getByText(/^worfy could not ask the Harness where the workflow of this Project lives: the profile script could not be run: node not found in PATH/)
    await expect(reason).toBeVisible({ timeout: ms(20_000) })
    await expect(window.getByText('No epics in .scratch/')).toHaveCount(0)
    await expect(window.getByTestId('sidebar-epic')).toHaveCount(0)
    await expect(window.getByTestId('first-epic')).toHaveCount(0)
    await expect(window.locator('[data-testid="epic-frame"]')).toHaveCount(0)
    await window.screenshot({ path: test.info().outputPath('37-finder-path-no-node.png') })
  } finally {
    await launched.close()
  }
})
