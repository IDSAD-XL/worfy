import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'

// Electron helper processes may still hold files in a directory for a moment after the app exits.
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

function makeRepo(parent: string, name: string, branch: string): string {
  const dir = join(parent, name)
  mkdirSync(join(dir, 'src'), { recursive: true })
  git(dir, 'init', '-q', '-b', branch)
  writeFileSync(join(dir, 'README.md'), name)
  writeFileSync(join(dir, 'src', 'index.ts'), 'export {}\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return realpathSync(dir)
}

/** Replaces the system folder picker in main: the next "Add project" gets `folder`. */
async function pickNext(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, folder)
}

async function addProject(launched: LaunchedApp, folder: string): Promise<void> {
  await pickNext(launched.app, folder)
  await launched.window.getByRole('button', { name: 'Add project' }).click()
}

const row = (window: Page, name: string) => window.getByTestId('project-row').filter({ hasText: name })
const rowButton = (window: Page, name: string) => row(window, name).getByRole('button')
const subtitle = (window: Page) => window.locator('.w-toolbar__subtitle')

async function openSettings(window: Page, name: string) {
  await row(window, name).click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Project settings…' }).click()
  const dialog = window.getByRole('dialog', { name: 'Project settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

// The default templates by the Harness on the machine (src/shared/projects/action-templates.ts).
const PLUGIN_SHIP = '/worfy:ship-ticket {epic} {NN}'
const PLUGIN_WAVE = '/worfy:epic-wave tickets {tickets} of epic {epic}'
const LEGACY_SHIP = '/ship-ticket {epic} {NN}'
const LEGACY_WAVE = '/epic-wave Ticket-ы {tickets} эпика {epic}'
/** An `epic-status` stub that answers with no Epics, so the sidebar reads the Project without an error. */
const NO_EPICS = `#!/bin/sh\necho '{"ref":"main","epics":[],"tickets":[]}'\n`

let scratch: string
let dataDir: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-projects-')))
  dataDir = join(scratch, 'data')
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('Projects: add, switch, edit settings, restart, remove — and the repositories stay untouched', async () => {
  const auction = makeRepo(scratch, 'auction', 'main')
  const worfy = makeRepo(scratch, 'worfy', 'dev')
  const plain = join(scratch, 'plain')
  mkdirSync(plain)

  const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = first
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect(subtitle(window)).toHaveText('No project')

    // A folder outside any git repository is refused with a message.
    await addProject(first, plain)
    await expect(window.getByTestId('projects-error')).toHaveText(`${plain} is not a git repository. Choose the folder of a git repository.`)
    await expect(window.getByTestId('project-row')).toHaveCount(0)

    // A subfolder becomes its repository root, and the user is told so.
    await addProject(first, join(auction, 'src'))
    await expect(window.getByTestId('projects-notice')).toContainText('the repository root was added instead')
    await expect(row(window, 'auction')).toHaveAttribute('title', auction)
    await expect(rowButton(window, 'auction')).toHaveAttribute('aria-current', 'true')
    await expect(subtitle(window)).toHaveText('auction · main')

    await addProject(first, worfy)
    await expect(rowButton(window, 'worfy')).toHaveAttribute('aria-current', 'true')
    await expect(rowButton(window, 'auction')).not.toHaveAttribute('aria-current', 'true')
    await expect(subtitle(window)).toHaveText('worfy · dev')

    await rowButton(window, 'auction').click()
    await expect(rowButton(window, 'auction')).toHaveAttribute('aria-current', 'true')
    await expect(subtitle(window)).toHaveText('auction · main')

    // A template with an unknown placeholder shows its error under the field and cannot be saved.
    // The temporary Claude home of launchApp holds no Harness: the defaults are the plugin's (worfy-harness ticket 12).
    let dialog = await openSettings(window, 'worfy')
    const shipTicket = dialog.getByLabel('Ship ticket')
    await expect(shipTicket).toHaveValue(PLUGIN_SHIP)
    await expect(dialog.getByLabel('Run wave')).toHaveValue(PLUGIN_WAVE)
    await shipTicket.fill('/ship-ticket {foo}')
    await expect(dialog.getByRole('alert')).toContainText('Unknown placeholder {foo}')
    await expect(shipTicket).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    await window.screenshot({ path: test.info().outputPath('project-settings-error.png'), omitBackground: true })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()

    dialog = await openSettings(window, 'worfy')
    await expect(dialog.getByLabel('Ship ticket')).toHaveValue(PLUGIN_SHIP)
    await dialog.getByLabel('Ship ticket').fill('/ship {epic}-{NN} on {branch}')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    await window.screenshot({ path: test.info().outputPath('projects-sidebar.png'), omitBackground: true })
  } finally {
    await first.close()
  }

  const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = second
    // The list, the active Project and the edited template survive the restart.
    await expect(window.getByTestId('project-row')).toHaveCount(2)
    await expect(rowButton(window, 'auction')).toHaveAttribute('aria-current', 'true')
    await expect(subtitle(window)).toHaveText('auction · main')
    const dialog = await openSettings(window, 'worfy')
    await expect(dialog.getByLabel('Ship ticket')).toHaveValue('/ship {epic}-{NN} on {branch}')
    await dialog.getByRole('button', { name: 'Reset to default' }).click()
    await expect(dialog.getByLabel('Ship ticket')).toHaveValue(PLUGIN_SHIP)
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // Removing a Project takes it off the list and keeps its data folder.
    const worfyId = await row(window, 'worfy').getAttribute('data-project-id')
    await row(window, 'worfy').click({ button: 'right' })
    await window.getByRole('menuitem', { name: 'Remove from list' }).click()
    await expect(window.getByTestId('project-row')).toHaveCount(1)
    expect(readdirSync(dataDir)).toContain(worfyId)
  } finally {
    await second.close()
  }

  // worfy wrote nothing into either repository, ignored files included.
  for (const repo of [auction, worfy]) {
    expect(git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
  }
})

// worfy-harness ticket 12: the default templates are those of the Harness found on the machine,
// looked for again on every read. The screenshots of the dialog in both themes are the ticket's
// evidence (copied from test-results to .scratch/worfy-harness/evidence/12-*.png).
test('Project settings: the defaults and "Reset to default" follow the Harness on the machine', async () => {
  const worfy = makeRepo(scratch, 'worfy', 'main')
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window, claudeHome } = launched
    // The old Harness: <Claude home>/bin/epic-status. A new Project gets its templates.
    mkdirSync(join(claudeHome, 'bin'))
    writeFileSync(join(claudeHome, 'bin', 'epic-status'), NO_EPICS, { mode: 0o755 })
    await addProject(launched, worfy)
    await expect(rowButton(window, 'worfy')).toHaveAttribute('aria-current', 'true')

    let dialog = await openSettings(window, 'worfy')
    await expect(dialog.getByLabel('Ship ticket')).toHaveValue(LEGACY_SHIP)
    await expect(dialog.getByLabel('Run wave')).toHaveValue(LEGACY_WAVE)
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`12-project-settings-legacy-${scheme}.png`) })
    }
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // The move takes the old Harness away and the plugin is installed: the saved defaults now read
    // as the plugin's, with no restart; an edited field goes back to the plugin's on Reset.
    await rm(join(claudeHome, 'bin'), { recursive: true })
    const plugin = join(claudeHome, 'worfy-harness', 'plugin')
    mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
    mkdirSync(join(plugin, 'bin'), { recursive: true })
    writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'worfy' }))
    writeFileSync(join(plugin, 'bin', 'epic-status'), NO_EPICS, { mode: 0o755 })
    dialog = await openSettings(window, 'worfy')
    await expect(dialog.getByLabel('Ship ticket')).toHaveValue(PLUGIN_SHIP)
    await expect(dialog.getByLabel('Run wave')).toHaveValue(PLUGIN_WAVE)
    await dialog.getByLabel('Run wave').fill('my wave {tickets}')
    await dialog.getByRole('button', { name: 'Reset to default' }).click()
    await expect(dialog.getByLabel('Run wave')).toHaveValue(PLUGIN_WAVE)
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      await window.screenshot({ path: test.info().outputPath(`12-project-settings-plugin-${scheme}.png`) })
    }
    await dialog.getByRole('button', { name: 'Cancel' }).click()
  } finally {
    await launched.close()
  }
  expect(git(worfy, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
})

test('a broken projects.json is set aside and the app still starts', async () => {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), '{"projects": [{"id": ')

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect(window.getByText('No projects yet')).toBeVisible()
    expect(readdirSync(dataDir).filter((name) => name.startsWith('projects.json.unreadable-'))).toHaveLength(1)
  } finally {
    await launched.close()
  }
})
