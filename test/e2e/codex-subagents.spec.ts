import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, repoRoot } from './helpers'

// The Subagents of a Codex Session on the Canvas (worfy-multi-vendor ticket 34), against the built app with
// Codex on the fake app-server (WORFY_CODEX=fake, which every launch sets; the real Codex never starts).
// A Codex thread of the Project started in a terminal gets its Node (ticket 27); its two spawned Subagents
// get Subagent Nodes under it, named by their nicknames, with their roles and statuses — Bo failed, Ada
// done (folded into "1 done" until opened). The service children of the thread (review, compact, memory
// consolidation, guardian) and the Subagent of another Session get none.
//
// One script plays every process of the fake, and each process starts it from its first line: the list
// of the Project's threads (`thread/list` of threads.jsonl, with this test's thread) first; once its Node
// shows, the script of subagents.jsonl (`thread/read` of the Session, `thread/list` of the Subagent
// threads), and the window is reloaded so its Node asks for the tree again (the first ask met the list's
// script and was refused). main keeps the list of the Project's threads for 30 s, so the reload asks Codex
// only for the tree. Screenshots of both themes go to the test's output folder; the ticket's evidence is
// copied from there.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const SIZE = { width: 1400, height: 900 }
/** The Session of subagents.jsonl and its two spawned Subagents. */
const THREAD = '019a0000-0000-7000-8000-000000000341'
const ADA = '019a0000-0000-7000-8000-000000000342'
const BO = '019a0000-0000-7000-8000-000000000343'
const FIXTURES = join(repoRoot, 'test', 'fixtures', 'codex-scripts')

let scratch: string
let dataDir: string
let codexHome: string
let projectPath: string
let scripts: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-codex-subagents-')))
  dataDir = join(scratch, 'data')
  codexHome = join(scratch, 'codex-home')
  projectPath = join(scratch, 'alpha')
  scripts = join(scratch, 'codex-scripts')
  log = join(scratch, 'codex.log')
  for (const dir of [projectPath, codexHome, scripts, join(dataDir, PROJECT)]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** The steps of the checked script `name`, with /fake/project this Project. */
function fixture(name: string): Record<string, unknown>[] {
  const text = readFileSync(join(FIXTURES, `${name}.jsonl`), 'utf8').replaceAll('"/fake/project', JSON.stringify(projectPath).slice(0, -1))
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

/** Writes the script every process of the fake plays from now on. */
function playNext(steps: readonly Record<string, unknown>[]): void {
  writeFileSync(join(scripts, 'canvas.jsonl'), steps.map((step) => JSON.stringify(step)).join('\n') + '\n')
}

/** `thread/list`: the Session of subagents.jsonl, started in a terminal in the Project's folder now. */
function listScript(): Record<string, unknown>[] {
  const threads = fixture('threads')
  const page = threads[2] as { result: { data: Record<string, unknown>[] } }
  const terminal = page.result.data[1] as Record<string, unknown>
  const thread = { ...terminal, id: THREAD, sessionId: THREAD, cwd: projectPath, preview: 'Check the release', updatedAt: Math.floor(Date.now() / 1000) }
  return [threads[0] as Record<string, unknown>, threads[1] as Record<string, unknown>, { expect: 'thread/list', result: { data: [thread], nextCursor: null, backwardsCursor: null } }]
}

/** The Canvas in both themes, for the ticket's evidence and the review: the sidebar would show the machine's temporary folder. */
async function screenshots(window: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await window.getByTestId('canvas').screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

/** What worfy sent the fake, of `method`. */
function sent(method: string): Record<string, unknown>[] {
  let text: string
  try {
    text = readFileSync(log, 'utf8')
  } catch {
    return []
  }
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((message) => message.method === method)
}

test('a Codex Session\'s spawned Subagents get Subagent Nodes with their statuses; its service children get none', async () => {
  playNext(listScript())
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: 'canvas', WORFY_CODEX_SCRIPTS: scripts, WORFY_CODEX_LOG: log } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: SIZE })
    const node = window.locator(`[data-testid="session-node"][data-session-id="${THREAD}"]`)
    await expect(node).toBeVisible()
    await expect(node.getByTestId('session-node-vendor')).toHaveAttribute('data-vendor', 'codex')

    // From now on every process plays the tree; the reload makes the Node ask for it again.
    playNext(fixture('subagents'))
    await window.reload()
    await canvasReady(launched)
    await expect(node).toBeVisible()

    const ada = window.locator(`[data-testid="subagent-node"][data-subagent-id="${ADA}"]`)
    const bo = window.locator(`[data-testid="subagent-node"][data-subagent-id="${BO}"]`)
    await expect(bo.getByTestId('subagent-name')).toHaveText('Bo')
    await expect(bo.getByTestId('subagent-kind')).toContainText('worker')
    await expect(bo.getByTestId('subagent-status')).toHaveText('error 6s')
    // Ada is done: folded into one row under the Session, as a Claude Subagent that is done.
    const fold = window.getByTestId('subagent-fold')
    await expect(fold).toHaveText('1 done')
    await fold.click()
    await expect(ada.getByTestId('subagent-name')).toHaveText('Ada')
    await expect(ada.getByTestId('subagent-kind')).toContainText('explorer')
    await expect(ada.getByTestId('subagent-status')).toHaveText('done 10s')
    // Only these two: no Node for a service child or another Session's Subagent.
    await expect(window.getByTestId('subagent-node')).toHaveCount(2)
    // Codex keeps no transcript worfy reads for a Subagent: its Node opens none.
    await expect(ada.getByTestId('subagent-open')).toBeDisabled()
    expect(sent('thread/read').map((message) => (message.params as { threadId?: string }).threadId)).toContain(THREAD)
    await canvasReady(launched)
    await screenshots(window, 'codex-subagents')
  } finally {
    await launched.close()
  }
})
