import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { startUpdateStub, type UpdateStub } from '../update-stub'
import { launchApp, type LaunchedApp } from './helpers'
import { E2E_SHELL } from './launch-env'

// worfy-update ticket 06: the version chip of the toolbar in the built app, and its "What's new"
// (ticket 10): the PR titles main reads from the stub's comparison. Update is on through
// WORFY_UPDATE=1; GitHub is the local stub of test/update-stub.ts, the repository a bare one in a
// temporary folder, the Stable copy a folder there too (WORFY_UPDATE_STABLE, refused by the stub
// outside the temporary folder). The build of ticket 03 runs in worfy's own clone with a stand-in
// pnpm whose `install --frozen-lockfile` does nothing, and a build in place of `pnpm package` that
// waits for a file of the test, so "Building…" is seen before "Restart now". Both are written by the
// spec into its temporary folder, as test/fixtures/update/ does for the contract tests. Nothing is
// restarted: the press would quit worfy.
//
// The PATH of the build is the login shell's (src/main/agent/env.ts): the spec's own SHELL is the e2e
// shell of launch-env.ts with the stand-in pnpm first on its PATH. Windows has no login shell, so the
// spec runs off Windows only.

test.skip(process.platform === 'win32', 'the stand-in pnpm reaches the build through the login shell PATH, which Windows does not have (the registry stands in there)')

type Bridge = { invoke: (channel: string, input?: unknown) => Promise<{ ok: boolean; value?: unknown; error?: string }> }

const VERSION = '0.9.0'

let root: string
let stub: UpdateStub | undefined
let launched: LaunchedApp | undefined

/** Electron helper processes may still hold files in a folder for a moment after the app exits. */
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git with an identity of its own, in `cwd`. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' }).trim()
}

/** The build in place of `pnpm package`: waits for `release`, then leaves the app as build-ok.mjs does. */
function gatedBuild(release: string): string {
  const file = join(root, 'build-gated.mjs')
  writeFileSync(
    file,
    `import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const release = ${JSON.stringify(release)}
// Never left running: a test that does not release it ends it after two minutes.
const deadline = Date.now() + 120000
while (!existsSync(release)) {
  if (Date.now() > deadline) {
    process.stderr.write('gated build: never released\\n')
    process.exit(1)
  }
  await new Promise((done) => setTimeout(done, 50))
}
const app = join('dist', 'mac-arm64', 'worfy.app')
mkdirSync(app, { recursive: true })
writeFileSync(join(app, 'marker.txt'), readFileSync('marker.txt', 'utf8'))
process.stdout.write('gated build done\\n')
`,
  )
  return file
}

const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

/** The toolbar, with the chip's menu or "What's new" under it when one is open, in both themes; kept with the test's output. */
async function snapshots(window: Page, toolbar: Locator, name: string): Promise<void> {
  const menu = window.getByRole('menu', { name: 'worfy update' })
  const whatsNew = window.getByTestId('whats-new')
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    const boxes = [(await toolbar.boundingBox())!]
    if (await menu.isVisible()) boxes.push((await menu.boundingBox())!)
    if (await whatsNew.isVisible()) boxes.push((await whatsNew.boundingBox())!)
    const x = Math.min(...boxes.map((box) => box.x))
    const y = Math.min(...boxes.map((box) => box.y))
    const clip = { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y }
    await window.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`), clip })
  }
  await window.emulateMedia({ colorScheme: null })
}

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'worfy-update-toolbar-'))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await stub?.close()
  stub = undefined
  await removeDir(root)
})

test('an Available update puts a dot on the version chip; "Update worfy" builds it, "Building…", then "Restart now"', async () => {
  // GitHub's worfy: a bare repository whose main is one commit ahead of the copy that runs.
  const origin = join(root, 'origin.git')
  const work = join(root, 'work')
  mkdirSync(work)
  git(root, 'init', '-q', '--bare', origin)
  git(work, 'init', '-q')
  git(work, 'remote', 'add', 'origin', origin)
  writeFileSync(join(work, 'package.json'), `{ "name": "fixture", "version": "${VERSION}" }\n`)
  const commit = (marker: string): string => {
    writeFileSync(join(work, 'marker.txt'), `${marker}\n`)
    git(work, 'add', '-A')
    git(work, 'commit', '-qm', `commit ${marker}`)
    git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main')
    return git(work, 'rev-parse', 'HEAD')
  }
  const running = commit('A')
  const head = commit('B')

  // The Stable copy of the test and the file next to it that names the commit it runs.
  const stable = join(root, 'Applications', 'worfy-stable.app')
  mkdirSync(stable, { recursive: true })
  writeFileSync(join(root, 'Applications', 'worfy-stable.json'), JSON.stringify({ commit: running }))
  // The comparison's commits, oldest first as GitHub lists them: two squash merges and a push without a PR.
  const commits = [
    { sha: running, message: 'feat(update): sticky Update toasts (worfy-update 07) (#1124)\n\nThe body.' },
    { sha: running, message: 'chore: a push to main without a PR' },
    { sha: head, message: 'feat(update): "What\'s new" after an Update <b>not bold</b> (worfy-update 10) (#1130)' },
  ]
  stub = await startUpdateStub({ head, version: VERSION, compare: { status: 'ahead', files: ['src/main/index.ts'], commits } }, { stable })

  // The login shell of the app: the e2e shell, with the stand-in pnpm first on its PATH.
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\n[ "$*" = "install --frozen-lockfile" ] && exit 0\necho "pnpm stand-in: unsupported: $*" >&2\nexit 2\n')
  chmodSync(join(bin, 'pnpm'), 0o755)
  const shell = join(root, 'shell', 'sh')
  mkdirSync(join(root, 'shell'))
  symlinkSync(E2E_SHELL, shell)
  writeFileSync(`${shell}.path`, `${bin}${delimiter}${process.env.PATH ?? ''}`)
  const release = join(root, 'release')

  launched = await launchApp({
    env: {
      SHELL: shell,
      WORFY_UPDATE: '1',
      WORFY_UPDATE_API: stub.url,
      WORFY_UPDATE_STABLE: stable,
      WORFY_UPDATE_REPO: origin,
      WORFY_UPDATE_BUILD: gatedBuild(release),
    },
  })
  const { window } = launched
  const toolbar = window.locator('.w-toolbar')
  const chip = toolbar.getByTestId('app-version')
  const update = `${VERSION}+${head.slice(0, 7)}`

  // No Update yet: the plain version line.
  await expect(chip).toBeVisible()
  expect(await chip.evaluate((element) => element.tagName)).toBe('SMALL')
  // The toolbar's own height is fixed (shell.css): what could grow is the Harness column, the Harness
  // line over the version line, and the version line itself.
  const column = toolbar.getByTestId('harness-column')
  const heights = async (): Promise<{ column: number; chip: number }> => ({ column: (await column.boundingBox())!.height, chip: (await chip.boundingBox())!.height })
  const before = await heights()
  await snapshots(window, toolbar, 'update-none')

  // Built only when asked: "Update automatically" off, then the check the app would run on its schedule.
  expect((await bridgeCall(window, 'appSettings.set', { autoUpdate: false })).ok).toBe(true)
  expect((await bridgeCall(window, 'update.check')).ok).toBe(true)

  // The dot, the tooltip, and the column and the version line as high as before.
  await expect(chip).toHaveAttribute('data-update', 'available')
  await expect(chip.locator('.w-update-dot')).toBeVisible()
  await expect(chip).toHaveAttribute('title', `worfy ${update} is available`)
  expect(await heights()).toEqual(before)
  await snapshots(window, toolbar, 'update-available')

  // The menu: "Update worfy", "What's new" and "Later"; "Later" closes it and the dot stays.
  await chip.click()
  const menu = window.getByRole('menu', { name: 'worfy update' })
  await expect(menu.getByRole('menuitem')).toHaveText(['Update worfy', "What's new", 'Later'])
  await snapshots(window, toolbar, 'update-available-menu')
  await menu.getByRole('menuitem', { name: 'Later' }).click()
  await expect(menu).toBeHidden()
  await expect(chip.locator('.w-update-dot')).toBeVisible()

  // "What's new": the PRs of the comparison, newest first, the push without a PR left out; the title is text.
  await chip.click()
  await menu.getByRole('menuitem', { name: "What's new" }).click()
  await expect(menu).toBeHidden()
  const whatsNew = window.getByRole('dialog', { name: `What's new in worfy ${update}` })
  await expect(whatsNew.getByRole('heading')).toHaveText(`What's new in worfy ${update}`)
  await expect(whatsNew.getByRole('listitem')).toHaveText([
    'feat(update): "What\'s new" after an Update <b>not bold</b> (worfy-update 10) #1130',
    'feat(update): sticky Update toasts (worfy-update 07) #1124',
  ])
  await expect(whatsNew.getByRole('link', { name: '#1130' })).toHaveAttribute('href', 'https://github.com/IDSAD-XL/worfy/pull/1130')
  await expect(whatsNew.locator('b')).toHaveCount(0)
  await expect(whatsNew.getByRole('button', { name: 'Update worfy' })).toBeVisible()
  await snapshots(window, toolbar, 'update-whats-new')
  await window.keyboard.press('Escape')
  await expect(whatsNew).toBeHidden()
  // One comparison for the check and one for "What's new"; no request per PR.
  expect(stub.requests.filter((request) => /\/pulls?\//u.test(request.path))).toEqual([])

  // "Update worfy": the build runs and waits for the test's file.
  await chip.click()
  await menu.getByRole('menuitem', { name: 'Update worfy' }).click()
  await expect(menu).toBeHidden()
  await expect(chip).toHaveAttribute('data-update', 'building')
  await expect(chip).toHaveAttribute('title', `Building worfy ${update}…`)
  await chip.click()
  const building = menu.getByRole('menuitem', { name: `Building worfy ${update}…` })
  await expect(building).toHaveAttribute('aria-disabled', 'true')
  await snapshots(window, toolbar, 'update-building-menu')
  await window.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await snapshots(window, toolbar, 'update-building')

  // Built: nothing works in this app, so "Restart now".
  writeFileSync(release, '')
  await expect(chip).toHaveAttribute('data-update', 'ready')
  await expect(chip).toHaveAttribute('title', `worfy ${update} is ready — restart to update`)
  await snapshots(window, toolbar, 'update-ready')
  await chip.click()
  await expect(menu.getByRole('menuitem')).toHaveText(['Restart now', "What's new", 'Later'])
  await snapshots(window, toolbar, 'update-ready-menu')
  await menu.getByRole('menuitem', { name: 'Later' }).click()
  expect(await heights()).toEqual(before)
})
