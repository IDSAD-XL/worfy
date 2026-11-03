// The history part of the Codex driver (src/main/vendors/codex/history.ts; worfy-multi-vendor ticket 22)
// on the fake app-server (WORFY_CODEX=fake, which test/setup-contract.ts sets): `thread/list` of a
// Project's folder, page by page, finds the threads started in worfy and in a terminal and tells them
// apart; `thread/read` with the turns gives the messages, the thinking, the commands and their output.
// Each ask starts its own process and closes it — after an answer, a refusal, the time limit of an ask
// (a silent stand-in) and the last of at most 20 pages; a Codex with no home folder starts none.
//
// The fake runs under scriptNode() (test/script-node.ts) through the spawn stand-in of codexAskStarter,
// as test/contract/codex-account.test.ts starts it. Every process a test started is killed after it.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { codexAskStarter, type StartCodex } from '../../src/main/vendors/codex/account'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexHistoryPart } from '../../src/main/vendors/codex/history'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }

const roots: string[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  for (const root of roots.splice(0)) removeTestTree(root)
})

function tempRoot(): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-history-'))
  roots.push(root)
  return root
}

/**
 * A stand-in app-server that answers `initialize` and then stays silent: it never answers another
 * request, and it exits once its stdin is closed, as the app-server does.
 */
const SILENT_APP_SERVER = `
const lines = require('node:readline').createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') process.stdout.write(JSON.stringify({ id: message.id, result: { codexHome: '/fake/codex-home', platformFamily: 'unix', platformOs: 'macos', userAgent: 'worfy-silent-stand-in/0.166.0' } }) + '\\n')
})
lines.on('close', () => process.exit(0))
`

interface FakeOptions {
  /** The Codex home folder; an empty one by default. */
  home?: string
  /** Start the silent stand-in in place of the fake. */
  silent?: boolean
  /** The time limit every request of the history part actually waits; the one it asks for by default. */
  askTimeoutMs?: number
}

/**
 * The history part over the fake playing `script`. `timeouts` are the time limits the part asked for,
 * one per request; `askTimeoutMs` replaces them on the way, so a test of the limit waits a moment only.
 */
function fake(script: string, options: FakeOptions = {}) {
  const cwd = tempRoot()
  const codexHome = options.home ?? tempRoot()
  const log = join(cwd, 'codex.log')
  const started: ChildProcess[] = []
  const timeouts: (number | undefined)[] = []
  const spawnProcess = (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
    const child = spawn(scriptNode(), options.silent === true ? ['-e', SILENT_APP_SERVER] : [...args], spawnOptions)
    children.push(child)
    started.push(child)
    return child
  }
  const starter = codexAskStarter({
    runtime: RUNTIME,
    appPath: REPO,
    cwd,
    clientVersion: '9.9.9',
    env: { ...process.env, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: script, WORFY_CODEX_LOG: log },
    spawnProcess,
    log: () => undefined,
  })
  const start: StartCodex = async (onEvent) => {
    const ask = await starter(onEvent)
    return {
      ...ask,
      request: (method, params, timeoutMs) => {
        timeouts.push(timeoutMs)
        return ask.request(method, params, options.askTimeoutMs ?? timeoutMs)
      },
    }
  }
  const sent = (): Record<string, unknown>[] => readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
  return { history: codexHistoryPart({ start, codexHome: () => codexHome }), sent, started, timeouts, cwd, codexHome }
}

const exited = (child: ChildProcess): Promise<void> => (hasExited(child) ? Promise.resolve() : new Promise((resolve) => child.once('exit', () => resolve())))

describe('the past Sessions of a Project folder (thread/list)', () => {
  it('finds the threads of the folder and of a folder inside it, started in worfy and in a terminal, and tells them apart', async () => {
    const at = fake('threads')
    const sessions = await at.history.list('/fake/project')
    expect(sessions).toEqual([
      { id: 'thr_worfy_1', cwd: '/fake/project', title: 'Fix the build', updatedAt: 1793000060000, origin: 'worfy' },
      { id: 'thr_cli_1', cwd: '/fake/project/src', title: 'Test walkthrough', updatedAt: 1793000030000, origin: 'external' },
      { id: 'thr_exec_1', cwd: '/fake/project', title: null, updatedAt: 1793000020000, origin: 'external' },
    ])
    const lists = at.sent().filter((message) => message.method === 'thread/list')
    // The interactive sources only: no Subagent's thread (subAgent*), 100 threads a page.
    const page = { limit: 100, sortKey: 'updated_at', sortDirection: 'desc', sourceKinds: ['cli', 'vscode', 'exec', 'appServer'], archived: false }
    expect(lists.map((message) => message.params)).toEqual([page, { ...page, cursor: 'page-2' }])
    // Each page waits 30 s at most, CODEX_ASK_TIMEOUT_MS.
    expect(at.timeouts).toEqual([30_000, 30_000])
    // One process for the ask, closed after it.
    expect(at.started).toHaveLength(1)
    await exited(at.started[0] as ChildProcess)
  })

  it('reads 20 pages at most, and closes the process after the last of them', async () => {
    // Every page of the script names a next one: the 21st is never asked for.
    const at = fake('threads-pages')
    const sessions = await at.history.list('/fake/project')
    expect(sessions.map((session) => session.id)).toEqual(Array.from({ length: 20 }, (_, index) => `thr_page_${index + 1}`))
    const cursors = at
      .sent()
      .filter((message) => message.method === 'thread/list')
      .map((message) => (message.params as { cursor?: string }).cursor)
    expect(cursors).toEqual([undefined, ...Array.from({ length: 19 }, (_, index) => `page-${index + 2}`)])
    expect(at.started).toHaveLength(1)
    await exited(at.started[0] as ChildProcess)
  })

  it('a list Codex never answers rejects by the time limit of an ask, and its process is closed', async () => {
    const at = fake('threads', { silent: true, askTimeoutMs: 200 })
    await expect(at.history.list('/fake/project')).rejects.toThrow(/did not answer thread\/list .*within 200 ms/)
    expect(at.timeouts).toEqual([30_000])
    await exited(at.started[0] as ChildProcess)
  })

  it('a Codex with no home folder has no threads, and nothing is started', async () => {
    const at = fake('threads', { home: join(tempRoot(), 'no-codex-home') })
    expect(await at.history.list('/fake/project')).toEqual([])
    await expect(at.history.read('thr_worfy_1', '/fake/project')).rejects.toThrow(/no home folder/)
    expect(at.started).toEqual([])
  })

  it('a list Codex refuses rejects, and its process is closed', async () => {
    // The script waits for thread/list, so the fake refuses thread/read; and the other way round.
    const at = fake('thread-read')
    await expect(at.history.list('/fake/project')).rejects.toThrow(/thread\/list/)
    await exited(at.started[0] as ChildProcess)
  })
})

describe('the transcript of a past Session (thread/read)', () => {
  it('reads the thread by its id with its turns: the messages, the thinking, the commands and their output', async () => {
    const at = fake('thread-read')
    const entries = await at.history.read('thr_worfy_1', '/somewhere/else')
    expect(at.sent().filter((message) => message.method === 'thread/read').map((message) => message.params)).toEqual([{ threadId: 'thr_worfy_1', includeTurns: true }])
    expect(entries.map((entry) => entry.event)).toEqual([
      { type: 'notice', kind: 'user', text: 'Fix the build' },
      { type: 'thinking', text: 'Looking at the lint output', messageId: 'rs_1', parentToolUseId: null },
      { type: 'tool_use', id: 'cmd_1', name: 'commandExecution', input: { command: 'pnpm lint', cwd: '/fake/project' }, parentToolUseId: null },
      { type: 'tool_result', toolUseId: 'cmd_1', content: 'no problems\n', isError: false, parentToolUseId: null },
      { type: 'text', text: 'The build is fixed.', messageId: 'msg_1', parentToolUseId: null, synthetic: false },
      { type: 'notice', kind: 'user', text: '$release-notes for 1.2' },
      { type: 'text', text: 'Notes are ready.', messageId: 'msg_2', parentToolUseId: null, synthetic: false },
    ])
    expect(entries[0]).toMatchObject({ uuid: 'user_1', timestamp: new Date(1793000000 * 1000).toISOString(), sidechain: false })
    expect(entries.at(-1)).toMatchObject({ uuid: 'msg_2', timestamp: new Date(1793000100 * 1000).toISOString() })
    // The read waits 30 s at most, CODEX_ASK_TIMEOUT_MS.
    expect(at.timeouts).toEqual([30_000])
    await exited(at.started[0] as ChildProcess)
  })

  it('a read Codex refuses rejects, and its process is closed', async () => {
    // The script waits for thread/list, so the fake refuses thread/read.
    const at = fake('threads')
    await expect(at.history.read('thr_worfy_1', '/fake/project')).rejects.toThrow(/thread\/read/)
    expect(at.started).toHaveLength(1)
    await exited(at.started[0] as ChildProcess)
  })

  it('a read Codex never answers rejects by the time limit of an ask, and its process is closed', async () => {
    const at = fake('thread-read', { silent: true, askTimeoutMs: 200 })
    await expect(at.history.read('thr_worfy_1', '/fake/project')).rejects.toThrow(/did not answer thread\/read .*within 200 ms/)
    expect(at.timeouts).toEqual([30_000])
    await exited(at.started[0] as ChildProcess)
  })

  it('writes nothing into the Codex home', async () => {
    const at = fake('thread-read')
    await at.history.read('thr_worfy_1', '/fake/project')
    await at.history.list('/fake/project').catch(() => undefined)
    expect(readdirSync(at.codexHome)).toEqual([])
  })
})
