import { mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, repoRoot } from './helpers'

// The transcript search of the command palette over the Project's Codex threads (worfy-multi-vendor
// ticket 28), against the built app with Codex on the fake app-server (WORFY_CODEX=fake, which every
// launch sets; the real Codex never starts). The Project has a Claude Code transcript and a Codex thread
// started in a terminal, and both say "zebra": ⌘K "zebra" lists both under "In transcripts", newest
// first, each row ending with its Vendor's logo, and the Codex row's snippet comes from the thread's
// read (`thread/read`). Picking the Codex row opens its transcript in the Session view.
//
// One script plays every process of the fake, and each process starts it from its first line. So the
// test writes the script of each step into its own scripts folder before the step: the list
// (`thread/list`) first, then the read. The steps are those of the checked scripts threads.jsonl and
// thread-read.jsonl with this test's thread id, folder, times and text. Screenshots of both themes go
// to the test's output folder; the ticket's evidence is copied from there.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const SIZE = { width: 1400, height: 900 }
const THREAD = '019a0000-0000-7000-8000-000000000228'
const CLAUDE_SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa028'
const FIXTURES = join(repoRoot, 'test', 'fixtures', 'codex-scripts')

let scratch: string
let dataDir: string
let claudeHome: string
let codexHome: string
let projectPath: string
let scripts: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-codex-search-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  codexHome = join(scratch, 'codex-home')
  projectPath = join(scratch, 'alpha')
  scripts = join(scratch, 'codex-scripts')
  log = join(scratch, 'codex.log')
  for (const dir of [projectPath, claudeHome, codexHome, scripts, join(dataDir, PROJECT)]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

function steps(name: string): Record<string, unknown>[] {
  return readFileSync(join(FIXTURES, `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

/** Writes the script every process of the fake plays from now on. */
function playNext(script: readonly Record<string, unknown>[]): void {
  writeFileSync(join(scripts, 'search.jsonl'), script.map((step) => JSON.stringify(step)).join('\n') + '\n')
}

/** The Codex thread of the Project, started in a terminal an hour ago; `turns` empty in a list. */
function thread(updatedAt: number, turns: unknown[]): Record<string, unknown> {
  const [, , read] = steps('thread-read') as [unknown, unknown, { result: { thread: Record<string, unknown> } }]
  return { ...read.result.thread, id: THREAD, sessionId: `ses-${THREAD}`, cwd: projectPath, preview: 'Theme the stripes', originator: 'codex_cli_rs', source: 'cli', updatedAt, turns }
}

/** The Claude Code transcript of the Project, two hours old: older than the Codex thread. */
function claudeTranscript(at: Date): void {
  const dir = join(claudeHome, 'projects', projectPath.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const record = (type: 'user' | 'assistant', uuid: string, content: unknown) =>
    JSON.stringify({ type, isSidechain: false, message: { role: type, ...(type === 'assistant' ? { id: `m-${uuid}`, model: 'claude-opus-5' } : {}), content }, uuid, timestamp: at.toISOString(), cwd: projectPath, entrypoint: 'cli' })
  const path = join(dir, `${CLAUDE_SESSION}.jsonl`)
  writeFileSync(path, `${record('user', 'u1', 'Where does the Zebra config live?')}\n${record('assistant', 'a1', [{ type: 'text', text: 'It lives in config.ts, next to the router.' }])}\n`)
  utimesSync(path, at, at)
}

/** The palette in both themes, for the ticket's evidence and the review. */
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

test('⌘K finds the text of a Codex thread beside a Claude transcript; each row ends with its Vendor’s logo, and the Codex row opens its transcript', async () => {
  const now = Math.floor(Date.now() / 1000)
  const codexAt = now - 60 * 60
  claudeTranscript(new Date((now - 2 * 60 * 60) * 1000))
  const [initialize, initialized] = steps('threads') as [Record<string, unknown>, Record<string, unknown>]
  playNext([initialize, initialized, { expect: 'thread/list', result: { data: [thread(codexAt, [])], nextCursor: null, backwardsCursor: null } }])
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: 'search', WORFY_CODEX_SCRIPTS: scripts, WORFY_CODEX_LOG: log } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: SIZE })
    // The list of the Project's Codex threads is in: the search reads the threads it named.
    await expect.poll(() => sent('thread/list').length).toBeGreaterThan(0)

    // From now on Codex reads the thread: one turn, the user's message and the agent's reply.
    const turn = {
      id: 'turn-28',
      items: [
        { type: 'userMessage', id: 'user-28', clientId: null, content: [{ type: 'text', text: 'Theme the stripes', text_elements: [] }] },
        { type: 'agentMessage', id: 'msg-28', text: 'The zebra pattern now lives in theme.ts, next to the colours.' },
      ],
      status: 'completed',
      startedAt: codexAt,
      completedAt: codexAt,
      durationMs: 1000,
    }
    playNext([initialize, initialized, { expect: 'thread/read', result: { thread: thread(codexAt, [turn]) } }])

    await window.keyboard.press('ControlOrMeta+k')
    await expect(window.getByTestId('command-palette')).toBeVisible()
    await window.getByTestId('palette-input').fill('zebra')
    const group = window.locator('[data-testid="palette-group"][data-group="In transcripts"]')
    const rows = group.getByTestId('palette-option')
    await expect(rows).toHaveCount(2)
    // Newest first: the Codex thread, then the Claude Code transcript.
    await expect(rows.nth(0)).toHaveAttribute('data-command', `transcript:${THREAD}`)
    await expect(rows.nth(0)).toContainText('Theme the stripes')
    await expect(rows.nth(0)).toContainText('The zebra pattern now lives in theme.ts')
    await expect(rows.nth(0).getByTestId('palette-option-vendor')).toHaveAttribute('data-vendor', 'codex')
    await expect(rows.nth(0).getByTestId('palette-option-vendor')).toHaveAttribute('aria-label', 'Codex')
    await expect(rows.nth(1)).toHaveAttribute('data-command', `transcript:${CLAUDE_SESSION}`)
    await expect(rows.nth(1).getByTestId('palette-option-vendor')).toHaveAttribute('data-vendor', 'claude')
    await expect(rows.nth(1).getByTestId('palette-option-vendor')).toHaveAttribute('aria-label', 'Claude Code')
    expect(sent('thread/read').map((message) => (message.params as { threadId?: string }).threadId)).toContain(THREAD)
    await screenshots(window, 'codex-search')

    // The Codex row opens the thread's transcript, read from Codex.
    await rows.nth(0).click()
    const view = window.getByTestId('session-view')
    await expect(view.getByTestId('transcript-text').filter({ hasText: 'The zebra pattern now lives in theme.ts' })).toBeVisible()
    await expect(view.getByTestId('session-vendor')).toHaveText('Codex')
  } finally {
    await launched.close()
  }
})
