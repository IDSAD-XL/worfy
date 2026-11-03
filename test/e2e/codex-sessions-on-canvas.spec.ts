import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, repoRoot } from './helpers'

// The Codex Sessions of a Project on the Canvas (worfy-multi-vendor ticket 27), against the built app with
// Codex on the fake app-server (WORFY_CODEX=fake, which every launch sets; the real Codex never starts).
// The launch's CODEX_HOME exists, so worfy asks Codex for the Project's threads. A thread started in a
// terminal in the Project's folder that changed a moment ago gets a read-only Node with the Codex badge;
// one of another folder does not, nor one that changed hours ago (it stays in the History). A double
// click opens its transcript, read from Codex (`thread/read`). Resume asks first — «This Session may be
// open in a terminal» — and then continues the same thread (`thread/resume`) on a live Node in its place.
//
// One script plays every process of the fake, and each process starts it from its first line. So the
// test writes the script of each step into its own scripts folder before the step: the list
// (`thread/list`), the read, the resume. The threads are those of the checked scripts
// (threads.jsonl, thread-read.jsonl, resume.jsonl) with this test's thread id, folders and times. A
// process of a step that is not its own (Codex is asked again every 30 s) gets refusals from the fake,
// and worfy keeps the list it has. Screenshots of both themes go to the test's output folder; the
// ticket's evidence is copied from there.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const SIZE = { width: 1400, height: 900 }
const THREAD = '019a0000-0000-7000-8000-000000000127'
const OLD_THREAD = '019a0000-0000-7000-8000-000000000128'
const FOREIGN_THREAD = '019a0000-0000-7000-8000-000000000129'
const FIXTURES = join(repoRoot, 'test', 'fixtures', 'codex-scripts')

let scratch: string
let dataDir: string
let codexHome: string
let projectPath: string
let scripts: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-codex-canvas-')))
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

/** The steps of the checked script `name`, with the fake's thread `from` named `THREAD` and /fake/project this Project. */
function fixture(name: string, from: string): Record<string, unknown>[] {
  const text = readFileSync(join(FIXTURES, `${name}.jsonl`), 'utf8').replaceAll(from, THREAD).replaceAll('"/fake/project"', JSON.stringify(projectPath))
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

/** Writes the script every process of the fake plays from now on. */
function playNext(steps: readonly Record<string, unknown>[]): void {
  writeFileSync(join(scripts, 'canvas.jsonl'), steps.map((step) => JSON.stringify(step)).join('\n') + '\n')
}

/** `thread/list`: a thread of the Project started in a terminal now, one of two hours ago, one of another folder. */
function listScript(): Record<string, unknown>[] {
  const threads = fixture('threads', 'thr_other_1')
  const page = threads[2] as { result: { data: Record<string, unknown>[] } }
  const terminal = page.result.data[1] as Record<string, unknown>
  const now = Math.floor(Date.now() / 1000)
  const thread = (id: string, cwd: string, preview: string, updatedAt: number) => ({ ...terminal, id, sessionId: `ses-${id}`, cwd, preview, updatedAt })
  const data = [
    thread(THREAD, projectPath, 'Explain the tests', now),
    thread(FOREIGN_THREAD, join(scratch, 'elsewhere'), 'Another folder', now),
    thread(OLD_THREAD, join(projectPath, 'src'), 'An older thread', now - 2 * 60 * 60),
  ]
  return [threads[0] as Record<string, unknown>, threads[1] as Record<string, unknown>, { expect: 'thread/list', result: { data, nextCursor: null, backwardsCursor: null } }]
}

/** The window in both themes, for the ticket's evidence and the review. */
async function screenshots(window: Page, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await window.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
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

test('a Codex Session from a terminal: its Node with the Codex badge and its transcript; Resume asks first and continues the thread', async () => {
  playNext(listScript())
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: 'canvas', WORFY_CODEX_SCRIPTS: scripts, WORFY_CODEX_LOG: log } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: SIZE })

    // The thread of the Project that changed now has its read-only Node, named Codex's.
    const node = window.locator(`[data-testid="session-node"][data-session-id="${THREAD}"]`)
    await expect(node).toBeVisible()
    await expect(node.getByTestId('session-node-title')).toHaveText('Explain the tests')
    await expect(node.getByTestId('session-node-vendor')).toHaveAttribute('data-vendor', 'codex')
    await expect(node.getByTestId('session-node-vendor')).toHaveText('Codex')
    await expect(node.getByTestId('session-node-source')).toHaveText(`terminal · ${projectPath}`)
    await expect(node.getByTestId('session-node-read-only')).toBeVisible()
    // Neither the thread of another folder nor the old one gets a Node by itself.
    await expect(window.locator(`[data-testid="session-node"][data-session-id="${FOREIGN_THREAD}"]`)).toHaveCount(0)
    await expect(window.locator(`[data-testid="session-node"][data-session-id="${OLD_THREAD}"]`)).toHaveCount(0)
    expect(sent('thread/list').length).toBeGreaterThan(0)
    await canvasReady(launched)
    await screenshots(window, 'codex-node')

    // Its transcript comes from Codex: the read of the thread with its turns.
    playNext(fixture('thread-read', 'thr_worfy_1'))
    await node.getByTestId('session-node-title').dblclick()
    const view = window.getByTestId('session-view')
    await expect(view.getByTestId('transcript-text').filter({ hasText: 'The build is fixed.' })).toBeVisible()
    await expect(view).toContainText('Fix the build')
    // The view names Codex: its badge after the title, `codex` on the agent's answers.
    await expect(view.getByTestId('session-vendor')).toHaveText('Codex')
    await expect(view.getByTestId('transcript-text').filter({ hasText: 'The build is fixed.' })).toContainText('codex')
    expect(sent('thread/read').map((message) => (message.params as { threadId?: string }).threadId)).toContain(THREAD)
    await screenshots(window, 'codex-transcript')
    await window.getByRole('button', { name: 'Canvas', exact: true }).click()

    // Resume asks whether the thread may be open in its terminal; Cancel changes nothing.
    playNext(fixture('resume', 'thr_fake_1'))
    await node.getByTestId('session-node-resume').click()
    const question = node.getByTestId('session-node-resume-question')
    await expect(question).toContainText('This Session may be open in a terminal')
    await screenshots(window, 'codex-resume-question')
    await question.getByRole('button', { name: 'Cancel' }).click()
    await expect(question).toHaveCount(0)
    expect(sent('thread/resume')).toEqual([])

    // Confirmed: the same thread goes on, on a live Node in the read-only one's place.
    await node.getByTestId('session-node-resume').click()
    await node.getByTestId('session-node-resume-confirm').click()
    const live = window.locator(`[data-testid="session-node"][data-live="true"][data-node-id="session:${THREAD}"]`)
    await expect(live).toBeVisible()
    await expect(live.getByTestId('session-node-vendor')).toHaveAttribute('data-vendor', 'codex')
    await expect.poll(() => sent('thread/resume').map((message) => (message.params as { threadId?: string }).threadId)).toEqual([THREAD])
    await live.getByTestId('session-node-input').fill('go on')
    await live.getByTestId('session-node-input').press('Enter')
    await expect(live.getByTestId('session-node-answer')).toContainText('Hello again.')
    await canvasReady(launched)
    await screenshots(window, 'codex-resumed')
  } finally {
    await launched.close()
  }
})
