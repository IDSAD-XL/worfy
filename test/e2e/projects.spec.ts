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
    let dialog = await openSettings(window, 'worfy')
    const shipTicket = dialog.getByLabel('Ship ticket')
    await expect(shipTicket).toHaveValue('/ship-ticket {epic} {NN}')
    await expect(dialog.getByLabel('Run wave')).toHaveValue('/epic-wave волна {wave} эпика {epic}')
    await shipTicket.fill('/ship-ticket {foo}')
    await expect(dialog.getByRole('alert')).toContainText('Unknown placeholder {foo}')
    await expect(shipTicket).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    await window.screenshot({ path: test.info().outputPath('project-settings-error.png'), omitBackground: true })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()

    dialog = await openSettings(window, 'worfy')
    await expect(dialog.getByLabel('Ship ticket')).toHaveValue('/ship-ticket {epic} {NN}')
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
    await expect(dialog.getByLabel('Ship ticket')).toHaveValue('/ship-ticket {epic} {NN}')
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
