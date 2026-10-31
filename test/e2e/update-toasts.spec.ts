import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { startUpdateStub, type UpdateStub } from '../update-stub'
import { ms } from '../time-scale'

// The sticky toasts of Update in the built app (worfy-update ticket 07), with Update on for this run
// (WORFY_UPDATE=1), the GitHub API of test/update-stub.ts, a bare repository in a temporary folder
// for the clone and a stand-in build that exits 1. No test here reaches GitHub, the
// real Stable copy or its data: the Stable copy is a path in the temporary folder.
//
// 1. A build ready at the start: the toast "worfy <version> ready" and no "available"; once nothing
//    works, its button is "Restart now". "Later" closes it. Nothing restarts.
// 2. "Update automatically" off and an Available update: the toast "New worfy <version> available".
//    Its "Update" builds the Update in worfy's clone; the stand-in build exits 1, and the toast
//    "Update failed" with "Show log" comes. "Show log" is not pressed: it opens a program of the system.

const PROJECT_ID = 'update-0000c007'

let scratch: string
let dataDir: string
let stub: UpdateStub | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' }).trim()
}

/**
 * A bare repository whose main is one commit: an empty pnpm project, so the real `pnpm install
 * --frozen-lockfile` of the build passes and the stand-in build is the step that fails. Answers its path and the SHA.
 */
function bareRepository(): { path: string; sha: string } {
  const path = join(scratch, 'origin.git')
  const work = join(scratch, 'work')
  mkdirSync(work, { recursive: true })
  git(scratch, 'init', '-q', '--bare', path)
  git(scratch, 'clone', '-q', path, work)
  writeFileSync(join(work, 'package.json'), `${JSON.stringify({ name: 'worfy-update-e2e', private: true })}\n`)
  writeFileSync(join(work, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n")
  writeFileSync(join(work, 'marker.txt'), 'update-toasts\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-qm', 'the Update of the test')
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main')
  return { path, sha: git(work, 'rev-parse', 'HEAD') }
}

/** The stand-in for `pnpm package`: a line to stderr and exit code 1. */
function failingBuild(): string {
  const path = join(scratch, 'build-fail.mjs')
  writeFileSync(path, "process.stderr.write('fake build failed: electron-builder said no\\n')\nprocess.exitCode = 1\n")
  return path
}

/** The data folder with one Project, the Update state and, when given, the app settings. */
function makeData(state: unknown, settings?: unknown): void {
  dataDir = join(scratch, 'data')
  const repo = join(scratch, 'demo')
  mkdirSync(repo, { recursive: true })
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  mkdirSync(join(dataDir, 'update'), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  writeFileSync(join(dataDir, 'update', 'state.json'), JSON.stringify(state))
  if (settings !== undefined) writeFileSync(join(dataDir, 'app-settings.json'), JSON.stringify(settings))
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-update-toasts-')))
})

async function launch(extra: Record<string, string>): Promise<LaunchedApp> {
  return launchApp({
    env: {
      WORFY_DATA_DIR: dataDir,
      WORFY_CLAUDE_HOME: join(scratch, 'claude-home'),
      WORFY_UPDATE: '1',
      WORFY_UPDATE_API: stub!.url,
      WORFY_UPDATE_STABLE: join(scratch, 'stable', process.platform === 'win32' ? 'worfy-stable' : 'worfy-stable.app'),
      ...extra,
    },
  })
}

test.afterEach(async () => {
  await stub?.close()
  stub = undefined
  if (scratch) await removeDir(scratch)
})

test('a build ready at the start shows "worfy <version> ready", not "available"; once nothing works its button is "Restart now"; "Later" closes it', async () => {
  const sha = 'c'.repeat(40)
  const version = `0.9.0+${sha.slice(0, 7)}`
  makeData({
    available: { sha, version, quiet: false },
    build: { phase: 'ready', sha, version, appPath: join(tmpdir(), 'worfy-e2e-update-toasts-not-there.app') },
  })
  stub = await startUpdateStub({ head: sha, version: '0.9.0' }, { stable: join(scratch, 'stable') })
  const launched = await launch({})
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1400, height: 900 }, timeout: ms(20_000) })
    const toast = window.getByTestId('update-ready')
    await expect(toast).toBeVisible({ timeout: ms(20_000) })
    await expect(toast).toContainText(`worfy ${version} ready`)
    // No Session and no Autopilot run: the watch finds it quiet, and the button changes in place.
    await expect(toast.getByRole('button', { name: 'Restart now' })).toBeVisible({ timeout: ms(20_000) })
    await expect(toast.getByRole('button', { name: 'Later' })).toBeVisible()
    await expect(window.getByTestId('update-available')).toHaveCount(0)
    await snapshotThemes(window, '07-update-ready')

    await toast.getByRole('button', { name: 'Later' }).click()
    await expect(toast).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

test('without "Update automatically" an Available update shows "New worfy <version> available"; its "Update" builds it, the stand-in build exits 1, and "Update failed" with "Show log" comes', async () => {
  const repository = bareRepository()
  const version = `0.9.0+${repository.sha.slice(0, 7)}`
  makeData({ available: { sha: repository.sha, version, quiet: false } }, { autoUpdate: false })
  stub = await startUpdateStub({ head: repository.sha, version: '0.9.0' }, { stable: join(scratch, 'stable') })
  const launched = await launch({ WORFY_UPDATE_REPO: repository.path, WORFY_UPDATE_BUILD: failingBuild() })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1400, height: 900 }, timeout: ms(20_000) })
    const available = window.getByTestId('update-available')
    await expect(available).toBeVisible({ timeout: ms(20_000) })
    await expect(available).toContainText(`New worfy ${version} available`)
    await expect(available.getByRole('button', { name: 'Later' })).toBeVisible()
    await snapshotThemes(window, '07-update-available')

    await available.getByRole('button', { name: 'Update' }).click()
    await expect(available).toHaveCount(0)
    const failed = window.getByTestId('update-failed')
    // The clone, the real `pnpm install` of an empty project and the stand-in build.
    await expect(failed).toBeVisible({ timeout: ms(60_000) })
    await expect(failed).toContainText('Update failed')
    await expect(failed.getByRole('button', { name: 'Show log' })).toBeVisible()
    // The step that failed is the stand-in build, not the clone or the install.
    expect(readFileSync(join(dataDir, 'update', 'build.log'), 'utf8')).toContain('fake build failed')
    await snapshotThemes(window, '07-update-failed')
  } finally {
    await launched.close()
  }
})
