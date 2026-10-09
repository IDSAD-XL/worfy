import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'

/**
 * A `bin/profile` stub that knows every folder: `--json` exits 0, a `--field` is absent (exit 4).
 * "Add project" then puts a repository into the list at once, without the dialog that connects a
 * new one (worfy-harness ticket 24).
 */
const KNOWS_ALL = `#!/bin/sh\ncase "$*" in *--json*) echo '{"name":"stub","_resolved":{"workspace":null}}' ;; *) exit 4 ;; esac\n`

// worfy's own Sessions (worfy-daily ticket 24) against the built app, on the fake agent. With
// WORFY_AGENT_REGISTRY=1 the fake agent writes its entry to <WORFY_CLAUDE_HOME>/sessions as soon as
// it starts, before system/init, with `entrypoint: "sdk-ts"` — as Claude Code does. worfy gives a
// new Session its id up front, so that entry is known as worfy's own: the Session keeps one Node
// before and after its first turn, the Orchestrator of a new Project gets no read-only twin, the
// sidebar says «worfy» with the Node's name and state, and only the Orchestrator answers as «orch».
//
// The Canvas makes a read-only Node for each Session it does not know. Each check that no such Node
// was made first starts a terminal Session (`claude` in a shell, a `sleep` here) and waits for its
// Node: the same pass over the registry also saw worfy's own entry.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
const processes: ChildProcess[] = []
let terminals = 0

function gitRepo(dir: string): string {
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  return realpathSync(dir)
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-own-sessions-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  projectPath = gitRepo(join(scratch, 'alpha'))
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  for (const child of processes.splice(0)) child.kill('SIGTERM')
  await removeDir(scratch)
})

/** A Session started outside worfy: a running process and its registry entry. */
function externalSession(cwd: string, entrypoint: string, name: string): string {
  terminals += 1
  const sessionId = `e0000000-0000-4000-8000-${String(terminals).padStart(12, '0')}`
  const child = spawn('sleep', ['600'], { stdio: 'ignore' })
  processes.push(child)
  writeFileSync(join(claudeHome, 'sessions', `${child.pid}.json`), JSON.stringify({ pid: child.pid, sessionId, cwd, entrypoint, name, version: '2.1.289' }))
  return sessionId
}

const sessionNodes = (window: Page): Locator => window.locator('[data-testid="session-node"]')
const sidebarRow = (window: Page, filter: { source?: string; sessionId?: string }): Locator =>
  window.locator(`[data-testid="sidebar-session"]${filter.source ? `[data-source="${filter.source}"]` : ''}${filter.sessionId ? `[data-session-id="${filter.sessionId}"]` : ''}`)

/**
 * Lets the Canvas take one more pass over the registry: a new terminal Session gets its read-only
 * Node. Any read-only Node for a Session of worfy's would have been made by then.
 */
async function settle(window: Page, cwd: string): Promise<void> {
  const id = externalSession(cwd, 'cli', `terminal-${terminals + 1}`)
  await expect(window.locator(`[data-testid="session-node"][data-session-id="${id}"]`)).toHaveCount(1)
}

async function launch(script: string): Promise<LaunchedApp> {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: script, WORFY_AGENT_REGISTRY: '1' } })
  await canvasReady(launched, { size: { width: 1400, height: 900 } })
  return launched
}

async function shoot(window: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await window.screenshot({ path: test.info().outputPath(`24-${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test('a New session keeps one Node before and after its first turn; the sidebar calls worfy’s Sessions «worfy», others by where they started', async () => {
  const launched = await launch('turn')
  try {
    const { window } = launched
    await expect(window.getByTestId('orchestrator-node').getByTestId('orchestrator-state')).toHaveText('idle')

    // ── New session, before its first turn: one Node for it, and none for the Orchestrator's entry.
    await window.getByTestId('sidebar-new-session').click()
    const live = window.locator('[data-testid="session-node"][data-live="true"]')
    await expect(live).toHaveCount(1)
    await expect(live.getByTestId('session-node-status')).toHaveText('idle')
    await settle(window, projectPath)
    await expect(sessionNodes(window)).toHaveCount(2) // the New session's and the terminal Session's
    await expect(window.locator('[data-testid="session-node"]:not([data-live="true"])')).toHaveCount(1)

    // The Orchestrator's own registry entry: «worfy», its Node's name and state.
    const orchestratorRow = sidebarRow(window, { source: 'worfy' }).filter({ hasText: 'Orchestrator' })
    await expect(orchestratorRow).toHaveCount(1)
    await expect(orchestratorRow.getByTestId('sidebar-session-name')).toHaveText('Orchestrator')
    await expect(orchestratorRow.locator('.w-chip')).toHaveText('idle')
    // The New session's row names it as its Node does.
    await expect(sidebarRow(window, { source: 'worfy' })).toHaveCount(2)
    const newRow = sidebarRow(window, { source: 'worfy' }).filter({ hasNotText: 'Orchestrator' })
    await expect(newRow.getByTestId('sidebar-session-name')).toHaveText('New session')
    await expect(live.getByTestId('session-node-title')).toHaveText('New session')
    await expect(newRow.locator('.w-chip')).toHaveText('idle')
    await expect(newRow.getByTestId('sidebar-session-source')).toHaveText('worfy')

    // ── After the first turn: still one Node for it.
    await live.getByTestId('session-node-input').fill('hello')
    await live.getByTestId('session-node-input').press('Enter')
    await expect(live.getByTestId('session-node-answer')).toHaveText('Hello from the fake agent')
    await expect(live.getByTestId('session-node-status')).toHaveText('idle')
    const sessionId = (await live.getAttribute('data-session-id')) ?? ''
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/)
    await settle(window, projectPath)
    await expect(live).toHaveCount(1)
    await expect(window.locator(`[data-testid="session-node"][data-session-id="${sessionId}"]`)).toHaveCount(1)
    await expect(sessionNodes(window)).toHaveCount(3) // the New session's and two terminal Sessions'
    await expect(sidebarRow(window, { sessionId })).toHaveAttribute('data-source', 'worfy')
    await expect(sidebarRow(window, { sessionId }).getByTestId('sidebar-session-name')).toHaveText((await live.getByTestId('session-node-title').textContent()) ?? '')

    // ── Sessions worfy does not run: a program on the Agent SDK, a terminal, Claude desktop.
    const sdk = externalSession(projectPath, 'sdk-ts', 'some-sdk-script')
    const desktop = externalSession(projectPath, 'claude-desktop', 'desktop-chat')
    await expect(sidebarRow(window, { sessionId: sdk }).getByTestId('sidebar-session-source')).toHaveText('terminal')
    await expect(sidebarRow(window, { sessionId: sdk }).getByTestId('sidebar-session-name')).toHaveText('some-sdk-script')
    await expect(sidebarRow(window, { sessionId: desktop }).getByTestId('sidebar-session-source')).toHaveText('desktop')
    await expect(sidebarRow(window, { source: 'terminal' })).toHaveCount(3) // two from `settle`, the SDK program
    await expect(sidebarRow(window, { source: 'worfy' })).toHaveCount(2)
    await shoot(window, 'sidebar')

    // ── Session view: an ordinary Session answers as «claude».
    await live.getByTestId('session-node-title').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view).toHaveAttribute('data-session-id', sessionId)
    await expect(view.getByTestId('transcript-text').locator('.w-tr__who')).toHaveText(['claude'])
    await shoot(window, 'session-view')
    await window.getByRole('button', { name: /Canvas/ }).click()

    // ── The Orchestrator answers as «orch».
    await window.getByTestId('orchestrator-node').locator('.w-orchestrator__header').dblclick()
    await expect(view.locator('.w-session__title')).toHaveText('Orchestrator · alpha')
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('status')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-text').locator('.w-tr__who')).toHaveText(['orch'])
    await shoot(window, 'orchestrator-view')
  } finally {
    await launched.close()
  }
})

test('a Session of worfy’s waiting for permission shows that in the sidebar, as on its Node, not «live»', async () => {
  const launched = await launch('permission')
  try {
    const { window } = launched
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    const row = sidebarRow(window, { source: 'worfy' })
    await expect(row).toHaveCount(1)
    await node.locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await view.getByTestId('picker-permissions').selectOption({ label: 'Ask before tools' })
    await expect(view.getByTestId('picker-permissions')).toHaveValue('default')
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('build it')
    await field.press('Enter')
    await expect(view.getByTestId('session-state')).toHaveText('needs permission')
    await expect(row.locator('.w-chip')).toHaveText('needs permission')
    await shoot(window, 'sidebar-permission')
    await window.getByRole('button', { name: /Canvas/ }).click()
    await expect(node.getByTestId('orchestrator-state')).toHaveText('needs permission')
    await expect(row.locator('.w-chip')).toHaveText('needs permission')
  } finally {
    await launched.close()
  }
})

test('a new Project gets one Orchestrator Node and no read-only twin of its Session', async () => {
  const launched = await launch('turn')
  try {
    const { app, window } = launched
    await expect(window.getByTestId('orchestrator-node').getByTestId('orchestrator-state')).toHaveText('idle')
    const beta = gitRepo(join(scratch, 'beta'))
    mkdirSync(join(claudeHome, 'bin'), { recursive: true })
    writeFileSync(join(claudeHome, 'bin', 'profile'), KNOWS_ALL, { mode: 0o755 })
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, beta)
    await window.getByRole('button', { name: 'Add project' }).click()
    await expect(window.locator('.w-toolbar__subtitle')).toContainText('beta')
    await expect(window.getByTestId('orchestrator-node').getByTestId('orchestrator-state')).toHaveText('idle')
    await settle(window, beta)
    await expect(window.getByTestId('orchestrator-node')).toHaveCount(1)
    await expect(sessionNodes(window)).toHaveCount(1) // the terminal Session's only
    const row = sidebarRow(window, { source: 'worfy' })
    await expect(row).toHaveCount(1)
    await expect(row.getByTestId('sidebar-session-name')).toHaveText('Orchestrator')
  } finally {
    await launched.close()
  }
})
