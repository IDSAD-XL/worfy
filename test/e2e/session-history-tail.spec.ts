import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { writeBigTranscript, writeMarkedTranscript } from '../big-transcript'
import { launchApp } from './helpers'
import { snapshotThemes } from './snapshots'

// A Session's history opens from its end (worfy-ui ticket 21), against the built app: a temporary
// WORFY_CLAUDE_HOME stands in for ~/.claude, with one Session started in a terminal whose
// transcript is about 40 MB, written at test time (test/big-transcript.ts). The view shows the
// newest turns at once, without the oldest; «Load earlier» brings the turns before them and keeps
// the row the reader was looking at in place. A `sleep` process plays the Claude Code process.

const PROJECT = 'alpha-0000000a'
const SESSION = 'b1900000-0000-4000-8000-0000000000e2'

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
const processes: ChildProcess[] = []

/** The folder Claude Code keeps a cwd's transcripts in (src/main/claude-home/registry.ts, projectDirName). */
const transcriptDir = (cwd: string): string => join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  child.kill('SIGTERM')
  await exited
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-history-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await Promise.all(processes.splice(0).map(stop))
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('a 40 MB transcript opens on its newest turns; Load earlier brings the ones before', async () => {
  test.setTimeout(180_000)
  mkdirSync(transcriptDir(projectPath), { recursive: true })
  const { turns, size } = writeBigTranscript(join(transcriptDir(projectPath), `${SESSION}.jsonl`), { sessionId: SESSION, cwd: projectPath })
  const claude = spawn('sleep', ['600'], { stdio: 'ignore' })
  processes.push(claude)
  writeFileSync(
    join(claudeHome, 'sessions', `${claude.pid}.json`),
    JSON.stringify({ pid: claude.pid, sessionId: SESSION, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'idle', version: '2.1.289', name: 'big-history' }),
  )

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    const node = window.locator(`[data-testid="session-node"][data-session-id="${SESSION}"]`)
    await node.waitFor({ state: 'visible', timeout: 10_000 })

    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    const newest = view.getByTestId('transcript-text').filter({ hasText: `Answer number ${turns - 1}` })
    const opened = Date.now()
    await node.getByTestId('session-node-title').dblclick()
    await expect(newest).toBeVisible({ timeout: 120_000 })
    const shown = Date.now() - opened
    test.info().annotations.push({ type: 'measure', description: `${(size / 1024 / 1024).toFixed(1)} MB transcript: newest answer visible ${shown} ms after the double click` })
    console.info(`[history-tail e2e] ${(size / 1024 / 1024).toFixed(1)} MB: newest answer visible after ${shown} ms`)

    // The oldest turns are not there: only the last 4 MiB was read.
    const prompts = view.locator('[data-testid="transcript-prompt"] .w-tr__prompt')
    const prompt = (n: number) => prompts.filter({ hasText: new RegExp(`^Prompt number ${n}$`) })
    await expect(prompt(0)).toHaveCount(0)
    const load = view.getByRole('button', { name: 'Load earlier' })
    await expect(load).toBeVisible()
    await snapshotThemes(window, 'session-history-tail')

    // The first prompt shown now; after Load earlier it stays where the reader sees it.
    const firstText = (await prompts.first().textContent()) ?? ''
    const firstNumber = Number(/Prompt number (\d+)/.exec(firstText)?.[1])
    expect(firstNumber).toBeGreaterThan(0)
    const anchor = prompt(firstNumber)
    const log = view.getByTestId('transcript')
    await log.evaluate((element) => {
      element.scrollTop = 0
    })
    // The control above the first row, in both themes.
    await snapshotThemes(window, 'session-history-load-earlier')
    const top = async () => (await anchor.boundingBox())?.y ?? Number.NaN
    const before = await top()
    await load.click()
    const earlier = prompt(firstNumber - 1)
    await expect(earlier).toHaveCount(1)
    await expect(anchor).toBeInViewport()
    expect(Math.abs((await top()) - before), 'the row the reader looked at stays in place').toBeLessThanOrEqual(2)
    // The earlier rows are above it, a scroll away.
    await earlier.scrollIntoViewIfNeeded()
    await expect(earlier).toBeInViewport()
    await log.evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(load).toBeInViewport()
    await snapshotThemes(window, 'session-history-earlier')
  } finally {
    await launched.close()
  }
})

test('⌘F in the read-only view of a terminal Session finds a match behind «Load earlier» and loads up to it (worfy-ui ticket 26)', async () => {
  test.setTimeout(180_000)
  mkdirSync(transcriptDir(projectPath), { recursive: true })
  writeMarkedTranscript(join(transcriptDir(projectPath), `${SESSION}.jsonl`), SESSION, projectPath, 10 * 1024 * 1024)
  const claude = spawn('sleep', ['600'], { stdio: 'ignore' })
  processes.push(claude)
  writeFileSync(
    join(claudeHome, 'sessions', `${claude.pid}.json`),
    JSON.stringify({ pid: claude.pid, sessionId: SESSION, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'idle', version: '2.1.289', name: 'find-history' }),
  )

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1280, 800))
    const node = window.locator(`[data-testid="session-node"][data-session-id="${SESSION}"]`)
    await node.waitFor({ state: 'visible', timeout: 10_000 })
    await node.getByTestId('session-node-title').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view).toHaveAttribute('data-read-only', 'true')
    await expect(view.getByTestId('transcript-text').last()).toContainText('in the garden', { timeout: 60_000 })
    await expect(view.getByText('Answer number 2: the')).toHaveCount(0)

    await window.keyboard.press('ControlOrMeta+f')
    const field = view.getByTestId('session-find-input')
    await expect(field).toBeFocused()
    await field.fill('зебра')
    const count = view.getByTestId('session-find-count')
    await expect(count).toHaveText('3 of 3')
    await field.press('Enter')
    await expect(count).toHaveText('1 of 3', { timeout: 30_000 })
    await expect(view.getByText('Answer number 2: the')).toBeInViewport()
    await field.press('Escape')
    await expect(view.getByTestId('session-find')).toHaveCount(0)
  } finally {
    await launched.close()
  }
})
