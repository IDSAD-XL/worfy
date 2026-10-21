import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './helpers'
import { settled } from './wait'

// Sessions started outside worfy (ticket 14), against the built app: a temporary WORFY_CLAUDE_HOME
// stands in for ~/.claude. A `sleep` process plays the Claude Code process — the registry checks
// that the pid runs — and the test writes what Claude Code would: sessions/<pid>.json and the
// transcript under projects/<folder of the cwd>/. The Orchestrator runs on the fake agent.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const EXTERNAL = 'e0000000-0000-4000-8000-00000000e001'
const OTHER = 'e0000000-0000-4000-8000-00000000e002'
const LATER = 'e0000000-0000-4000-8000-00000000e003'

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
const processes: ChildProcess[] = []

/** The folder Claude Code keeps a cwd's transcripts in (src/main/claude-home/registry.ts, projectDirName). */
const transcriptDir = (cwd: string): string => join(claudeHome, 'projects', cwd.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))

const line = (record: Record<string, unknown>): string => `${JSON.stringify({ isSidechain: false, timestamp: '2026-10-05T10:00:00.000Z', cwd: projectPath, ...record })}\n`
const prompt = (sessionId: string, uuid: string, text: string) => line({ type: 'user', uuid, sessionId, message: { role: 'user', content: text } })
const answer = (sessionId: string, uuid: string, text: string) =>
  line({ type: 'assistant', uuid, sessionId, message: { id: `msg_${uuid}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text }] } })

/** A process that stands for a running Claude Code; the registry sees its pid alive until it is killed. */
function claudeProcess(): ChildProcess {
  const child = spawn('sleep', ['600'], { stdio: 'ignore' })
  processes.push(child)
  return child
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  child.kill('SIGTERM')
  await exited
}

/** Every file under the Claude home with its size and modification time. */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        const stats = statSync(path)
        out[relative(claudeHome, path)] = `${stats.size}:${stats.mtimeMs}`
      }
    }
  }
  walk(claudeHome)
  return out
}

/**
 * The Claude home as the test itself left it: taken when the app starts, then each file the test
 * writes is recorded right after the write. Anything else that differs was written by worfy.
 */
let expected: Record<string, string> = {}

/** worfy changed nothing under the Claude home since the test last wrote there. */
function expectUntouched(): void {
  expect(snapshot(), 'files under WORFY_CLAUDE_HOME that the test did not write').toEqual(expected)
}

/** Writes (or appends to) a file under the Claude home as Claude Code would, after checking that worfy wrote nothing so far. */
function write(path: string, text: string, mode: 'create' | 'append' = 'create'): void {
  expectUntouched()
  if (mode === 'append') appendFileSync(path, text)
  else writeFileSync(path, text)
  const stats = statSync(path)
  expected[relative(claudeHome, path)] = `${stats.size}:${stats.mtimeMs}`
}

function register(child: ChildProcess, sessionId: string, extra: Record<string, unknown> = {}): void {
  write(
    join(claudeHome, 'sessions', `${child.pid}.json`),
    JSON.stringify({ pid: child.pid, sessionId, cwd: projectPath, kind: 'interactive', entrypoint: 'cli', status: 'busy', version: '2.1.289', ...extra }),
  )
}

async function orchestratorSessionId(window: Page): Promise<string | null> {
  return window.evaluate(async (projectId) => {
    const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
    const result = await bridge.invoke('layout.get', { projectId })
    const nodes = (result.value as { layout: { nodes: { kind: string; data: { sessionId?: string | null } }[] } } | undefined)?.layout.nodes ?? []
    return nodes.find((node) => node.kind === 'orchestrator')?.data.sessionId ?? null
  }, PROJECT)
}

async function nodeHidden(window: Page, nodeId: string): Promise<boolean | null> {
  return window.evaluate(
    async ({ projectId, id }) => {
      const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
      const result = await bridge.invoke('layout.get', { projectId })
      const nodes = (result.value as { layout: { nodes: { id: string; hidden: boolean }[] } } | undefined)?.layout.nodes ?? []
      return nodes.find((node) => node.id === id)?.hidden ?? null
    },
    { projectId: PROJECT, id: nodeId },
  )
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-external-')))
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
  await removeDir(scratch)
})

test('a Session started in a terminal: its Node, its read-only transcript, its end, and one Node for a Session of worfy', async () => {
  expected = snapshot()
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const { window } = launched
    await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
    const canvasView = window.locator('.w-shell__view[data-view="canvas"]')
    const sessionView = window.locator('.w-shell__view[data-view="session"]')
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()
    await expect(window.getByTestId('sidebar-sessions-live')).toHaveText('0 live')

    // A `claude` started in a terminal in the Project: its transcript, then its registry entry.
    mkdirSync(transcriptDir(projectPath), { recursive: true })
    const transcript = join(transcriptDir(projectPath), `${EXTERNAL}.jsonl`)
    write(transcript, prompt(EXTERNAL, 'u1', 'Fix the flaky test') + answer(EXTERNAL, 'a1', 'Looking at **the test** now.'))
    const claude = claudeProcess()
    const written = Date.now()
    register(claude, EXTERNAL, { name: 'fix-flaky-test' })

    const node = window.locator(`[data-testid="session-node"][data-session-id="${EXTERNAL}"]`)
    await node.waitFor({ state: 'visible', timeout: 5000 })
    const appeared = Date.now() - written
    expect(appeared, `the Session Node appeared ${appeared} ms after the registry file`).toBeLessThanOrEqual(1000)
    await expect(node.getByTestId('session-node-title')).toHaveText('fix-flaky-test')
    await expect(node.getByTestId('session-node-read-only')).toHaveText('read-only')
    await expect(node.getByTestId('session-node-source')).toHaveText(`terminal · ${projectPath}`)
    // status: busy is the working chip.
    await expect(node.getByTestId('session-node-status').locator('.w-chip')).toHaveAttribute('data-status', 'working')
    await expect(node.getByTestId('session-node-status')).toHaveText('busy')
    await expect(window.getByTestId('sidebar-sessions-live')).toHaveText('1 live')
    await expect(window.locator(`[data-testid="sidebar-session"][data-session-id="${EXTERNAL}"]`)).toContainText('fix-flaky-test')
    await window.screenshot({ path: test.info().outputPath('external-session-node.png') })

    // A double click opens its transcript, read from the file, without an input field.
    await node.getByTestId('session-node-title').dblclick()
    await expect(sessionView).toBeVisible()
    const view = sessionView.getByTestId('session-view')
    await expect(view).toHaveAttribute('data-session-id', EXTERNAL)
    await expect(view.getByTestId('transcript-prompt').locator('.w-tr__prompt')).toHaveText('Fix the flaky test')
    await expect(view.getByTestId('transcript-text').locator('strong')).toHaveText('the test')
    await expect(view.getByTestId('message-input')).toHaveCount(0)
    await expect(view.getByRole('textbox')).toHaveCount(0)
    await expect(view.getByTestId('session-read-only')).toHaveText('Read-only: started in terminal')
    await expect(view.getByTestId('session-state')).toHaveText('busy')

    // New records appear in the open view as Claude Code writes them.
    // Up to here the transcript was read and tailed in the open view: worfy wrote nothing (write() checks).
    write(transcript, prompt(EXTERNAL, 'u2', 'And the other one') + answer(EXTERNAL, 'a2', 'Both fixed.'), 'append')
    await expect(view.getByTestId('transcript-text')).toHaveCount(2)
    await expect(view.getByTestId('transcript-text').last().locator('.w-tr__body')).toHaveText('Both fixed.')
    await expect(view.getByTestId('transcript-prompt').last().locator('.w-tr__prompt')).toHaveText('And the other one')
    await window.screenshot({ path: test.info().outputPath('external-session-view.png') })

    // The process ends without removing its registry file: the Node stays, finished.
    await window.getByRole('button', { name: /Canvas/ }).click()
    await expect(canvasView).toBeVisible()
    await stop(claude)
    await expect(node.getByTestId('session-node-status')).toHaveText('finished', { timeout: 10_000 })
    await expect(node.getByTestId('session-node-status').locator('.w-chip')).toHaveAttribute('data-status', 'done')
    await expect(window.getByTestId('sidebar-sessions-live')).toHaveText('0 live')

    // A Session of worfy's own (the Orchestrator, on the fake agent) writes a transcript and a
    // registry entry too: it keeps its own Node, and gets no Session Node.
    await window.evaluate(async () => {
      const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
      const listed = await bridge.invoke('agent.list')
      const [session] = (listed.value as { sessionId: string }[] | undefined) ?? []
      if (session) await bridge.invoke('agent.send', { sessionId: session.sessionId, text: 'hello' })
    })
    await expect.poll(() => orchestratorSessionId(window), { timeout: 10_000 }).not.toBeNull()
    const own = (await orchestratorSessionId(window)) ?? ''
    write(join(transcriptDir(projectPath), `${own}.jsonl`), prompt(own, 'o1', 'hello') + answer(own, 'o2', 'hi'))
    register(claudeProcess(), own, { entrypoint: 'sdk-ts' })
    // And one more external Session at the same moment: once its Node is there, the registry change was seen.
    write(join(transcriptDir(projectPath), `${OTHER}.jsonl`), prompt(OTHER, 'x1', 'other'))
    register(claudeProcess(), OTHER, { entrypoint: 'claude-desktop', status: 'idle', name: 'desktop-session' })
    // From here on the test writes nothing under the Claude home but one more Session, near the end.
    const other = window.locator(`[data-testid="session-node"][data-session-id="${OTHER}"]`)
    await expect(other).toBeVisible()
    await expect(other.getByTestId('session-node-source')).toHaveText('Claude desktop')
    await expect(other.getByTestId('session-node-status')).toHaveText('idle')
    await expect(window.getByTestId('sidebar-sessions-live')).toHaveText('2 live')
    // The same change brought both: a Node for worfy's own Session would have been sent along with
    // the other one, and the renderer has caught up with main.
    await settled(window)
    await expect(window.locator(`[data-testid="session-node"][data-session-id="${own}"]`)).toHaveCount(0)
    const kinds = await window.evaluate(async (projectId) => {
      const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
      const result = await bridge.invoke('layout.get', { projectId })
      return ((result.value as { layout: { nodes: { kind: string; data: { sessionId?: string } }[] } }).layout.nodes ?? []).map((n) => `${n.kind}:${n.data.sessionId ?? ''}`)
    }, PROJECT)
    expect(kinds.filter((kind) => kind.endsWith(`:${own}`))).toEqual([`orchestrator:${own}`])
    expect(kinds.filter((kind) => kind.startsWith('session:')).sort()).toEqual([`session:${EXTERNAL}`, `session:${OTHER}`].sort())

    // The sidebar row of worfy's own Session leads to the Orchestrator's Node.
    await window.locator(`[data-testid="sidebar-session"][data-session-id="${own}"]`).click()
    await expect(window.locator('.react-flow__node.selected [data-testid="orchestrator-node"]')).toHaveCount(1)

    // Hiding a Session Node leaves the Session live; its sidebar row shows the Node again, selected.
    const otherRow = window.locator(`[data-testid="sidebar-session"][data-session-id="${OTHER}"]`)
    await other.getByRole('button', { name: 'Hide' }).click()
    await expect(other).toBeHidden()
    await expect.poll(() => nodeHidden(window, `session:${OTHER}`)).toBe(true)
    await expect(window.getByTestId('sidebar-sessions-live')).toHaveText('2 live')
    await otherRow.click()
    await expect(other).toBeVisible()
    await expect.poll(() => nodeHidden(window, `session:${OTHER}`)).toBe(false)
    await expect(window.locator(`.react-flow__node.selected [data-testid="session-node"][data-session-id="${OTHER}"]`)).toHaveCount(1)

    // Removing a Session Node leaves the Session alone, and the Node does not come back.
    await other.getByRole('button', { name: 'Remove' }).click()
    await expect(other).toHaveCount(0)
    // One more Session starts: its Node comes from a new look at all live Sessions, and that one
    // would bring the removed Node back if anything did.
    write(join(transcriptDir(projectPath), `${LATER}.jsonl`), prompt(LATER, 'l1', 'later'))
    register(claudeProcess(), LATER, { entrypoint: 'claude-desktop', status: 'idle', name: 'later-session' })
    await expect(window.locator(`[data-testid="session-node"][data-session-id="${LATER}"]`)).toBeVisible()
    await settled(window)
    await expect(other).toHaveCount(0)
    await expect(window.getByTestId('sidebar-sessions-live')).toHaveText('3 live')

    // worfy wrote nothing under the Claude home during the whole run: only the files the test
    // wrote, with the sizes and times the test left them at.
    expectUntouched()
    expect(readFileSync(transcript, 'utf8').split('\n').filter(Boolean)).toHaveLength(4)
  } finally {
    await launched.close()
  }
})
