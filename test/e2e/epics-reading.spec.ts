import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'
import { catScript } from '../harness-node'

// The sidebar's Epics section during the first read of an app run (worfy-harness ticket 44). That
// read waits for the environment of the user's login shell (`$SHELL -ilc`, src/main/agent/env.ts),
// and a slow rc file makes it wait for seconds. SHELL here is a stand-in that answers no sooner
// than 2 s, and only once the test has seen "Reading epics…" (a release file), so the test never
// races the section's show delay: the capture may start before the window is on screen. Then the
// login shell answers, `epic-status` runs, and the row gives way to the fixture's Epics.
//
// Not on Windows (worfy-windows ticket 83): there worfy runs no login shell, it reads the
// environment from the registry (src/main/agent/env.ts), so there is no slow step to hold the row,
// and this stand-in shell is a #!/bin/sh script Windows cannot start.

test.skip(process.platform === 'win32', 'Windows has no login shell to be slow: worfy reads the registry there (worfy-windows ticket 83)')

const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const PROJECT = 'reading-0000044a'
const EPICS = ['shop-mvp', 'shop-daily']
const READING = 'Reading epics…'

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-epics-reading-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

interface Fixture {
  env: Record<string, string>
  /** The file whose appearance lets the slow login shell answer. */
  release: string
}

function fixture(): Fixture {
  const home = join(scratch, 'home')
  const shellBin = join(scratch, 'login-shell-bin')
  const claudeHome = join(scratch, 'claude-home')
  const dataDir = join(scratch, 'data')
  const repo = join(scratch, 'shop')
  for (const dir of [home, shellBin, join(claudeHome, 'bin'), join(dataDir, PROJECT), repo]) mkdirSync(dir, { recursive: true })

  // node for the stand-in epic-status, on the PATH the login shell sets from $HOME/.profile.
  symlinkSync(process.execPath, join(shellBin, 'node'))
  writeFileSync(join(home, '.profile'), `PATH='${shellBin}:${SYSTEM_PATH}'; export PATH\n`)

  // The slow login shell: 2 s at least, then until the release file appears, 9 s in all at most.
  // The app kills a login shell that has not answered in 10 s (SHELL_TIMEOUT_MS,
  // src/main/agent/env.ts) and reads with a fallback environment that has no node; answering by
  // 9 s keeps this shell's environment even when the test never releases it.
  const release = join(scratch, 'release-login-shell')
  const shell = join(scratch, 'slow-shell')
  writeFileSync(
    shell,
    `#!/bin/sh\nsleep 2\ni=0\nwhile [ ! -e '${release}' ] && [ "$i" -lt 70 ]; do sleep 0.1; i=$((i + 1)); done\nexec /bin/sh "$@"\n`,
  )
  chmodSync(shell, 0o755)

  for (const epic of EPICS) {
    mkdirSync(join(repo, '.scratch', epic, 'issues'), { recursive: true })
    writeFileSync(join(repo, '.scratch', epic, 'spec.md'), `# ${epic}\n`)
    writeFileSync(join(repo, '.scratch', epic, 'issues', '01-first.md'), '# 01 — First\n\nType: task\nStatus: open\nBlocked by: —\n')
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  // The old Harness location, <claude home>/bin: its epic-status answers with the fixture's Epics.
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: EPICS.map((epic) => ({ epic, hasSpec: true, hasMap: false })),
      tickets: EPICS.map((epic) => ({ epic, num: 1, slug: 'first', title: '01 — First', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true })),
    }),
  )
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answer))
  chmodSync(script, 0o755)

  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'shop', path: repo }], activeId: PROJECT }))

  return {
    release,
    env: {
      SHELL: shell,
      HOME: home,
      WORFY_DATA_DIR: dataDir,
      WORFY_CLAUDE_HOME: claudeHome,
      // No plugin Harness: the one in <claude home>/bin is read.
      WORFY_HARNESS_HOME: join(scratch, 'no-harness-home'),
    },
  }
}

test('while the login shell is slow, the Epics section says "Reading epics…", then shows the Epics in its place', async () => {
  const { env, release } = fixture()
  const launched = await launchApp({ env })
  try {
    const { window } = launched
    const section = window.getByRole('region', { name: 'Epics' })
    const rows = section.getByTestId('sidebar-epic')
    const reading = section.getByText(READING)

    // The shell has not answered: it waits for the release file. The row must show within the
    // shell's 9 s, which may have started before the window: a window that starts too slowly
    // fails here, clearly, once the shell answers by itself and the row gives way to the list.
    await expect(reading).toBeVisible({ timeout: 9_000 })
    await expect(rows).toHaveCount(0)

    writeFileSync(release, '')
    // What is left of the 2 s, the login shell's rc files and epic-status.
    await expect(rows).toHaveCount(EPICS.length, { timeout: 15_000 })
    for (const epic of EPICS) await expect(section.locator(`[data-testid="sidebar-epic"][data-epic="${epic}"]`)).toHaveCount(1)
    await expect(reading).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
