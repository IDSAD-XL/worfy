import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'

// worfy started from Finder (worfy-harness ticket 37). launchd gives such an app the PATH
// /usr/bin:/bin:/usr/sbin:/sbin, and node is not on it; the user's node is on the PATH of the login
// shell only (nvm, Homebrew). Here the app gets exactly that PATH, and the login shell is /bin/sh
// with a temporary HOME whose .profile puts a folder with node first. The Harness is the real one
// the build carries (out/harness), installed as the plugin in a temporary Claude home: its
// `profile` and `ticket` are `#!/usr/bin/env node`, and `epic-status` asks `ticket root` only when
// it finds node. The Project is Silent: its Epic lies in the Workflow folder, outside the
// repository, before the app starts. Its Epic must be in the sidebar and on the Canvas.

const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const PROJECT = 'silent-app-00000037'

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-finder-path-')))
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

test('started with the PATH of Finder, a Silent Project shows its Epic: the Harness scripts get the login shell environment', async () => {
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
  writeFileSync(join(home, '.profile'), `PATH='${shellBin}:${SYSTEM_PATH}'; export PATH\n`)

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

  const launched = await launchApp({
    env: { PATH: SYSTEM_PATH, HOME: home, SHELL: '/bin/sh', WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_HARNESS_HOME: harnessHome },
  })
  try {
    const { window } = launched
    // The premise: the main process itself has the PATH of Finder, and node is not on it.
    expect(await launched.app.evaluate(() => process.env.PATH)).toBe(SYSTEM_PATH)
    expect(() => execFileSync('/bin/sh', ['-c', 'command -v node'], { env: { PATH: SYSTEM_PATH }, stdio: 'ignore' })).toThrow()

    const row = window.getByTestId('sidebar-epic')
    // The login shell and three Harness scripts run before the row appears.
    await expect(row).toHaveCount(1, { timeout: 20_000 })
    await expect(row).toHaveAttribute('data-epic', 'e3-acceptance')
    await expect(row).toHaveAttribute('title', 'Epic in the Workflow folder')
    const frame = window.locator('[data-testid="epic-frame"]')
    await expect(frame).toHaveCount(1, { timeout: 15_000 })
    await expect(frame.locator('.w-epic__title')).toContainText('Epic in the Workflow folder')
    await expect(window.locator('[data-testid="ticket-node"][data-ticket="1"]')).toHaveAttribute('data-state', 'open')
    // The documents ask the app's layout cache where the workflow lives: it runs `profile` too.
    await expect(window.getByTestId('handoff-body')).toContainText('State kept in the Workflow folder.')
  } finally {
    await launched.close()
  }
})
