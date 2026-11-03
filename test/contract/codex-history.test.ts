// The history part of the Codex driver (src/main/vendors/codex/history.ts; worfy-multi-vendor ticket 22)
// on the fake app-server (WORFY_CODEX=fake, which test/setup-contract.ts sets): `thread/list` of a
// Project's folder, page by page, finds the threads started in worfy and in a terminal and tells them
// apart; `thread/read` with the turns gives the messages, the thinking, the commands and their output.
// Each ask starts its own process and closes it; a Codex with no home folder starts none.
//
// The fake runs under scriptNode() (test/script-node.ts) through the spawn stand-in of codexAskStarter,
// as test/contract/codex-account.test.ts starts it. Every process a test started is killed after it.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { codexAskStarter } from '../../src/main/vendors/codex/account'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexHistoryPart, HISTORY_SOURCE_KINDS, THREAD_PAGE } from '../../src/main/vendors/codex/history'
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

/** The history part over the fake playing `script`, with the home folder `home` (an empty one by default). */
function fake(script: string, home?: string) {
  const cwd = tempRoot()
  const codexHome = home ?? tempRoot()
  const log = join(cwd, 'codex.log')
  const started: ChildProcess[] = []
  const spawnProcess = (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    const child = spawn(scriptNode(), [...args], options)
    children.push(child)
    started.push(child)
    return child
  }
  const start = codexAskStarter({
    runtime: RUNTIME,
    appPath: REPO,
    cwd,
    clientVersion: '9.9.9',
    env: { ...process.env, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: script, WORFY_CODEX_LOG: log },
    spawnProcess,
    log: () => undefined,
  })
  const sent = (): Record<string, unknown>[] => readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
  return { history: codexHistoryPart({ start, codexHome: () => codexHome }), sent, started, cwd, codexHome }
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
    const page = { limit: THREAD_PAGE, sortKey: 'updated_at', sortDirection: 'desc', sourceKinds: [...HISTORY_SOURCE_KINDS], archived: false }
    expect(lists.map((message) => message.params)).toEqual([page, { ...page, cursor: 'page-2' }])
    // One process for the ask, closed after it.
    expect(at.started).toHaveLength(1)
    await exited(at.started[0] as ChildProcess)
  })

  it('a Codex with no home folder has no threads, and nothing is started', async () => {
    const at = fake('threads', join(tempRoot(), 'no-codex-home'))
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
    await exited(at.started[0] as ChildProcess)
  })

  it('writes nothing into the Codex home', async () => {
    const at = fake('thread-read')
    await at.history.read('thr_worfy_1', '/fake/project')
    await at.history.list('/fake/project').catch(() => undefined)
    expect(readdirSync(at.codexHome)).toEqual([])
  })
})
