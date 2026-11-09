import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// "Edit profile" of Project settings (worfy-polish ticket 78) against the built app, with the real
// harness/bin/profile-set over a temporary Harness home: the form shows the Profile's fields, mode as
// text; an empty verify is refused under its field by the Harness's check and Save waits; a valid edit
// is written through profile-set with a commit in the Harness home's git; a Profile changed outside since
// the form read it is refused with "The profile changed since you opened it", and the form shows it as it
// is now. Screenshots of the dialog in both themes go to the test's output folder.
//
// The app finds bin/profile-set in its Claude home (src/main/harness/locate.ts, the old layout). The one
// there is a Node stand-in that runs the repository's harness/bin/profile-set with the temporary Harness
// home and home folder, so nothing of the machine's own Harness is read or written. The GitHub account
// step is not opened here: it asks gh, and its own tests cover it.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const PROFILE_SET = join(import.meta.dirname, '..', '..', 'harness', 'bin', 'profile-set')
const PROFILE = {
  schema: 2,
  name: 'alpha',
  title: 'Alpha',
  mode: 'full',
  commands: { test: 'make test', verify: 'make check' },
  tickets: { path: '.scratch/<epic>/issues/NN-*.md', branch: '<epic>/<NN>' },
  workflow: { finish: 'local-green' },
  review: { lenses: ['correctness'] },
}

let scratch: string
let dataDir: string
let claudeHome: string
let harnessHome: string
let profileJson: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' })
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-edit-profile-')))
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

/** Project settings of alpha, then "Edit profile…" by the keyboard. */
async function openEditProfile(window: Page) {
  await window.getByTestId('project-row').filter({ hasText: 'alpha' }).click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Project settings…' }).click()
  const settings = window.getByRole('dialog', { name: 'Project settings' })
  await expect(settings).toBeVisible()
  const button = settings.getByRole('button', { name: 'Edit profile…' })
  await button.focus()
  await window.keyboard.press('Enter')
  const form = window.getByRole('dialog', { name: 'Edit profile' })
  await expect(form.getByLabel('Title', { exact: true })).toBeVisible()
  return { settings, form }
}

type Written = Record<string, unknown> & { commands: Record<string, unknown>; tickets: Record<string, unknown> }
const written = (): Written => JSON.parse(readFileSync(profileJson, 'utf8')) as Written

test('Edit profile: the fields of the Profile, a refusal under its field, a write through profile-set, and a Profile changed outside', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { window } = launched
    const { settings, form } = await openEditProfile(window)
    await expect(form.getByLabel('verify', { exact: true })).toHaveValue('make check')
    await expect(form.getByLabel('Ticket path')).toHaveValue('.scratch/<epic>/issues/NN-*.md')
    await expect(form.getByTestId('edit-profile-mode')).toHaveText('full')
    await expect(form.getByText('Changed by moving the workflow files')).toHaveCount(2)
    await expect(form.getByLabel('Mode', { exact: true })).toHaveCount(0)

    // The keyboard reaches the fields: Tab from the dialog goes to Title, the first field.
    await form.focus()
    await window.keyboard.press('Tab')
    await expect(form.getByLabel('Title', { exact: true })).toBeFocused()

    // An empty verify: the Harness's check refuses it under the field, and Save waits.
    const verify = form.getByLabel('verify', { exact: true })
    await verify.fill('')
    const verifyField = form.locator('[data-field="commands.verify"]')
    await expect(verifyField.getByRole('alert')).toHaveText('must not be empty')
    await expect(verify).toHaveAttribute('aria-invalid', 'true')
    await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled()
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await form.screenshot({ path: test.info().outputPath(`78-edit-profile-refused-${scheme}.png`) })
    }
    await window.emulateMedia({ colorScheme: null })
    expect(written()).toEqual(PROFILE)

    // A valid edit: written through profile-set, one commit more in the Harness home.
    const before = Number(git(harnessHome, 'rev-list', '--count', 'HEAD').trim())
    await verify.fill('make verify')
    await form.getByLabel('Ticket path').fill('tickets/NN-*.md')
    await expect(verifyField.getByRole('alert')).toHaveCount(0)
    await expect(form.getByRole('button', { name: 'Save' })).toBeEnabled()
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form).toHaveCount(0)
    await expect(settings.getByTestId('project-settings-profile-saved')).toHaveText('Profile saved.')
    expect(written().commands).toEqual({ test: 'make test', verify: 'make verify' })
    expect(written().tickets).toEqual({ path: 'tickets/NN-*.md', branch: '<epic>/<NN>' })
    expect(Number(git(harnessHome, 'rev-list', '--count', 'HEAD').trim())).toBe(before + 1)

    // A Profile changed outside since the form read it: refused, and the form shows it as it is now.
    await settings.getByRole('button', { name: 'Edit profile…' }).click()
    await expect(form.getByLabel('Title', { exact: true })).toHaveValue('Alpha')
    writeFileSync(profileJson, `${JSON.stringify({ ...written(), title: 'Changed outside' }, null, 2)}\n`)
    await form.getByLabel('Title', { exact: true }).fill('Mine')
    await expect(form.getByRole('button', { name: 'Save' })).toBeEnabled()
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form.getByTestId('edit-profile-message')).toContainText('The profile changed since you opened it')
    await expect(form.getByLabel('Title', { exact: true })).toHaveValue('Changed outside')
    expect(written().title).toBe('Changed outside')

    // Escape closes Edit profile alone.
    await form.getByLabel('Title', { exact: true }).press('Escape')
    await expect(form).toHaveCount(0)
    await expect(settings).toBeVisible()
  } finally {
    await launched.close()
  }
})
