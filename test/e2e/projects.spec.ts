import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'
import { nodeScript, printScript, profileJsonScript } from '../harness-node'

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
  return realpathSync.native(dir)
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
const NO_EPICS = printScript('{"ref":"main","epics":[],"tickets":[]}\n')
/**
 * A `bin/profile` stub that knows every folder: `--json` exits 0, a `--field` is absent (exit 4).
 * "Add project" then puts a repository into the list at once, without the dialog that connects a
 * new one (worfy-harness ticket 24).
 */
const KNOWS_ALL = profileJsonScript('{"name":"stub","_resolved":{"workspace":null}}')

/** Puts the stub `bin/profile` where worfy looks for the scripts when there is no Harness: <Claude home>/bin. */
function harnessKnowsEverything(claudeHome: string): void {
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  writeFileSync(join(claudeHome, 'bin', 'profile'), KNOWS_ALL, { mode: 0o755 })
}

let scratch: string
let dataDir: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-projects-')))
  dataDir = join(scratch, 'data')
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('Projects: add, switch, edit settings, restart, remove — and the repositories stay untouched', async () => {
  const auberge = makeRepo(scratch, 'auberge', 'main')
  const worfy = makeRepo(scratch, 'worfy', 'dev')
  const plain = join(scratch, 'plain')
  mkdirSync(plain)

  const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window } = first
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await expect(subtitle(window)).toHaveText('No project')
    harnessKnowsEverything(first.claudeHome)

    // A folder outside any git repository and without repositories is refused in step 1, with a message.
    await addProject(first, plain)
    await expect(window.getByTestId('projects-error')).toHaveText(
      `${plain} is not a git repository and holds no repositories. Choose the folder of a git repository, or the folder above the repositories of one project.`,
    )
    await expect(window.getByTestId('project-row')).toHaveCount(0)
    await expect(window.getByTestId('connect-project')).toHaveCount(0)

    // A subfolder becomes its repository root, and the user is told so.
    await addProject(first, join(auberge, 'src'))
    await expect(window.getByTestId('projects-notice')).toContainText('the repository root was added instead')
    await expect(row(window, 'auberge')).toHaveAttribute('title', auberge)
    await expect(rowButton(window, 'auberge')).toHaveAttribute('aria-current', 'true')
    await expect(subtitle(window)).toHaveText('auberge · main')

    await addProject(first, worfy)
    await expect(rowButton(window, 'worfy')).toHaveAttribute('aria-current', 'true')
    await expect(rowButton(window, 'auberge')).not.toHaveAttribute('aria-current', 'true')
    await expect(subtitle(window)).toHaveText('worfy · dev')

    await rowButton(window, 'auberge').click()
    await expect(rowButton(window, 'auberge')).toHaveAttribute('aria-current', 'true')
    await expect(subtitle(window)).toHaveText('auberge · main')

    // Adding a Project that is in the list already selects it and says so, as before.
    await addProject(first, worfy)
    await expect(window.getByTestId('projects-notice')).toHaveText('worfy is already in the list.')
    await expect(window.getByTestId('project-row')).toHaveCount(2)
    await expect(rowButton(window, 'worfy')).toHaveAttribute('aria-current', 'true')
    await rowButton(window, 'auberge').click()
    await expect(rowButton(window, 'auberge')).toHaveAttribute('aria-current', 'true')

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
    // The window opened from the row's context menu gives the focus back to the row (worfy-ui-kit ticket 12).
    await expect(rowButton(window, 'worfy')).toBeFocused()

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
    await expect(rowButton(window, 'auberge')).toHaveAttribute('aria-current', 'true')
    await expect(subtitle(window)).toHaveText('auberge · main')
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
  for (const repo of [auberge, worfy]) {
    expect(git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
  }
})

// worfy-harness ticket 12: the default templates are those of the Harness found on the machine,
// looked for again on every read. The screenshots of the dialog in both themes are the ticket's
// evidence (copied from test-results/e2e to .scratch/worfy-harness/evidence/12-*.png).
test('Project settings: the defaults and "Reset to default" follow the Harness on the machine', async () => {
  const worfy = makeRepo(scratch, 'worfy', 'main')
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
  try {
    const { window, claudeHome } = launched
    // The old Harness: <Claude home>/bin/epic-status. A new Project gets its templates.
    harnessKnowsEverything(claudeHome)
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

// worfy-human-review ticket 09: the team reviewer offer after "Add project". The old Harness in the
// temporary Claude home is two Node stand-ins: `bin/profile` knows every folder and names a Profile
// folder in the test's scratch, and `bin/review-history` records each probe and answers `voice: yes`.
// The fake agent records the messages its Sessions get (WORFY_AGENT_LOG). Nothing reaches GitHub.
test('the team reviewer offer: a toast after the add, "Later" kept across a restart and a new add, "Build" starts a Session with /worfy:human-review-setup', async () => {
  const shop = makeRepo(scratch, 'shop', 'main')
  const cart = makeRepo(scratch, 'cart', 'main')
  const profileDir = join(scratch, 'harness-home', 'projects', 'stub')
  const probes = join(scratch, 'probes.txt')
  const agentLog = join(scratch, 'agent.jsonl')
  const env = { WORFY_DATA_DIR: dataDir, WORFY_AGENT_LOG: agentLog }
  const json = JSON.stringify({ name: 'stub', _resolved: { workspace: null } })
  const harnessWithProbe = (claudeHome: string): void => {
    mkdirSync(join(claudeHome, 'bin'), { recursive: true })
    const profile = [
      'const args = process.argv.slice(2)',
      `if (args.includes('--dir')) process.stdout.write(${JSON.stringify(`${profileDir}\n`)})`,
      `else if (args.includes('--json')) process.stdout.write(${JSON.stringify(`${json}\n`)})`,
      'else process.exitCode = 4',
    ].join('\n')
    writeFileSync(join(claudeHome, 'bin', 'profile'), nodeScript(profile), { mode: 0o755 })
    const probe = [
      `fs.appendFileSync(${JSON.stringify(probes)}, process.argv.slice(2).join(' ') + '\\n')`,
      `process.stdout.write(${JSON.stringify(JSON.stringify({ voice: 'yes', substantive: 30, threshold: 30, pull_requests: 9, requests: 1, line: 'voice: yes' }))})`,
    ].join('\n')
    writeFileSync(join(claudeHome, 'bin', 'review-history'), nodeScript(probe), { mode: 0o755 })
  }
  const probeRuns = (): string[] => (existsSync(probes) ? readFileSync(probes, 'utf8').split('\n').filter(Boolean) : [])
  const offer = (window: Page) => window.getByTestId('review-offer-toast')
  const settingsOf = (projectId: string): { humanReview?: unknown } => JSON.parse(readFileSync(join(dataDir, projectId, 'settings.json'), 'utf8')) as { humanReview?: unknown }
  let shopId: string

  const first = await launchApp({ env })
  try {
    const { window } = first
    harnessWithProbe(first.claudeHome)
    await addProject(first, shop)
    await expect(rowButton(window, 'shop')).toHaveAttribute('aria-current', 'true')
    await expect(offer(window)).toContainText("Build a reviewer in your team's style?")
    expect(probeRuns()).toEqual([`probe -C ${shop} --json`])
    await window.screenshot({ path: test.info().outputPath('09-review-offer.png') })
    await offer(window).getByRole('button', { name: 'Later' }).click()
    await expect(offer(window)).toHaveCount(0)
    shopId = (await row(window, 'shop').getAttribute('data-project-id'))!
    await expect.poll(() => settingsOf(shopId).humanReview).toEqual({ offer: 'later' })
  } finally {
    await first.close()
  }

  const second = await launchApp({ env })
  try {
    const { window } = second
    harnessWithProbe(second.claudeHome)
    await expect(rowButton(window, 'shop')).toHaveAttribute('aria-current', 'true')
    // Out of the list and in again: the data folder keeps "Later", so no probe runs for it.
    await row(window, 'shop').click({ button: 'right' })
    await window.getByRole('menuitem', { name: 'Remove from list' }).click()
    await expect(window.getByTestId('project-row')).toHaveCount(0)
    await addProject(second, shop)
    await expect(rowButton(window, 'shop')).toHaveAttribute('aria-current', 'true')
    // A Project never answered gets its offer: by then the decision for shop, made before any wait, is long taken.
    await addProject(second, cart)
    await expect(rowButton(window, 'cart')).toHaveAttribute('aria-current', 'true')
    await expect(offer(window)).toHaveCount(1)
    expect(probeRuns()).toEqual([`probe -C ${shop} --json`, `probe -C ${cart} --json`])
    // shop has no toast waiting: back on it, none shows.
    await rowButton(window, 'shop').click()
    await expect(rowButton(window, 'shop')).toHaveAttribute('aria-current', 'true')
    await expect(offer(window)).toHaveCount(0)
    await rowButton(window, 'cart').click()
    await expect(offer(window)).toHaveCount(1)

    // "Build": a new Session Node of cart whose first message is the generator skill; no answer is written.
    await offer(window).getByRole('button', { name: 'Build' }).click()
    await expect(offer(window)).toHaveCount(0)
    await expect(window.locator('[data-testid="session-node"]')).toHaveCount(1)
    await expect.poll(() => messages(agentLog)).toContain('/worfy:human-review-setup')
    const cartId = (await row(window, 'cart').getAttribute('data-project-id'))!
    expect(settingsOf(cartId).humanReview).toBeUndefined()
    expect(settingsOf(shopId).humanReview).toEqual({ offer: 'later' })
  } finally {
    await second.close()
  }

  for (const repo of [shop, cart]) {
    expect(git(repo, 'status', '--porcelain', '--ignored', '--untracked-files=all')).toBe('')
  }
})

/** The messages the fake agent's Sessions got, in order (WORFY_AGENT_LOG). */
function messages(log: string): string[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; text?: string })
    .filter((call) => call.kind === 'message')
    .map((call) => call.text ?? '')
}
