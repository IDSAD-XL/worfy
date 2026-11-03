// The Codex Sessions of a Project on the Canvas (src/main/vendors/codex/sessions-on-canvas.ts;
// worfy-multi-vendor ticket 27), on the fake app-server (WORFY_CODEX=fake, which test/setup-contract.ts
// sets) playing test/fixtures/codex-scripts/threads-worktrees.jsonl: the threads of the Project's root
// and of its worktree are found, a folder outside them is not — nor one whose name only starts like the
// root's or the worktree's. A Windows folder spelled in another case is found by the rule of Windows
// paths, on any system. Codex is asked at most once per CODEX_SESSIONS_POLL_MS for a Project, in the
// background, never without a Codex home, and a Codex that fails keeps the last list and is logged once.
// An answer never waits for Codex: a Codex that hangs leaves the Claude part of `claudeHome.sessions`
// on time, and its threads come with a later answer. Through the
// `claudeHome` channels the threads are Sessions of the history with `vendor: 'codex'`, and a thread's
// transcript is read from Codex only for a thread of the Project.
//
// The fake runs under scriptNode() (test/script-node.ts) through the spawn stand-in of codexAskStarter,
// as test/contract/codex-history.test.ts starts it. Every process a test started is killed after it.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { ClaudeHomeRegistry } from '../../src/main/claude-home/registry'
import { ClaudeHomeSubscriptions, claudeHomeHandlers } from '../../src/main/ipc/claude-home'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import type { HistoryPart, HistorySession } from '../../src/main/vendors/history'
import { codexAskStarter } from '../../src/main/vendors/codex/account'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexHistoryPart } from '../../src/main/vendors/codex/history'
import {
  CodexSessionsOnCanvas,
  codexProjectSessions,
  codexTranscriptAnswer,
  type CodexSessions,
} from '../../src/main/vendors/codex/sessions-on-canvas'
import type { AgentEvent } from '../../src/shared/agent/events'
import { CODEX_SESSIONS_POLL_MS } from '../../src/shared/ipc/claude-home'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const id = (n: number): string => `019a0000-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`

const roots: string[] = []
const children: ChildProcess[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  for (const root of roots.splice(0)) removeTestTree(root)
})

function tempRoot(): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-canvas-'))
  roots.push(root)
  return root
}

/** The history part of the Codex driver over the fake playing `script`, by the path rules of `platform`. */
function fake(script: string, platform: NodeJS.Platform = 'darwin') {
  const cwd = tempRoot()
  const codexHome = tempRoot()
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
    env: { ...process.env, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: script },
    spawnProcess,
    log: () => undefined,
  })
  return { history: codexHistoryPart({ start, codexHome: () => codexHome, platform }), started }
}

const PROJECT = '/fake/project'
const WORKTREE = '/fake/project-wt/27'
/** A worktree under the root: in the root's list already, so not asked of Codex again. */
const INNER_WORKTREE = '/fake/project/.claude/worktrees/5'

describe('the Codex Sessions of a Project (thread/list of its root and worktrees)', () => {
  it('finds the threads of the root and of a worktree outside it; not a foreign folder, nor one whose name only starts like theirs', async () => {
    const at = fake('threads-worktrees')
    const sessions = await codexProjectSessions(at.history, [PROJECT, WORKTREE, INNER_WORKTREE], 'darwin')
    expect(sessions.map((session) => [session.id, session.cwd, session.origin])).toEqual([
      [id(1), '/fake/project', 'external'],
      [id(2), '/fake/project-wt/27', 'external'],
      [id(3), '/fake/project-wt/27/src', 'external'],
      [id(7), '/fake/project', 'worfy'],
    ])
    // The root and the worktree outside it: one process each, the worktree inside the root none.
    expect(at.started).toHaveLength(2)
  })

  it('a Windows folder in another case is the Project\'s, by the rule of Windows paths (any system runs it)', async () => {
    const at = fake('threads-worktrees', 'win32')
    const sessions = await codexProjectSessions(at.history, ['c:\\work\\PROJECT'], 'win32')
    expect(sessions.map((session) => [session.id, session.cwd])).toEqual([[id(6), 'C:\\Work\\Project\\src']])
    // The same folder under the rules of macOS and Linux is another folder.
    expect(await codexProjectSessions(fake('threads-worktrees', 'darwin').history, ['c:\\work\\PROJECT'], 'darwin')).toEqual([])
  })

  it('gives each thread once, the newest first, when two roots list it', async () => {
    const thread = (n: number, cwd: string, updatedAt: number): HistorySession => ({ id: id(n), cwd, title: null, updatedAt, origin: 'external' })
    const history: Pick<HistoryPart, 'list'> = {
      list: async (cwd) => (cwd === '/a' ? [thread(1, '/a', 10), thread(2, '/b/x', 30)] : [thread(2, '/b/x', 30), thread(3, '/b', 20)]),
    }
    const sessions = await codexProjectSessions(history, ['/a', '/b'], 'darwin')
    expect(sessions.map((session) => session.id)).toEqual([id(2), id(3), id(1)])
  })
})

/** A history part that answers `threads` and counts its lists. */
function counted(threads: () => HistorySession[] | Error) {
  const asked: string[] = []
  const reads: [string, string][] = []
  const history: Pick<HistoryPart, 'list' | 'read'> = {
    list: async (cwd) => {
      asked.push(cwd)
      const answer = threads()
      if (answer instanceof Error) throw answer
      return answer
    },
    read: async (threadId, cwd) => {
      reads.push([threadId, cwd])
      return [
        { uuid: 'u1', timestamp: '2026-11-03T10:00:00.000Z', sidechain: false, event: { type: 'notice', kind: 'user', text: 'Explain the tests' } },
        { uuid: 'u2', sidechain: true, event: { type: 'notice', kind: 'user', text: 'a Subagent' } },
      ] as never
    },
  }
  return { history, asked, reads }
}

const THREAD: HistorySession = { id: id(1), cwd: '/fake/project/src', title: 'Explain the tests', updatedAt: Date.UTC(2026, 10, 3, 10), origin: 'external' }

describe('asking Codex for a Project at most once per CODEX_SESSIONS_POLL_MS', () => {
  it('answers the last list at once, asks in the background, and asks again once CODEX_SESSIONS_POLL_MS passed', async () => {
    let now = 1_000_000
    const { history, asked } = counted(() => [THREAD])
    const codex = new CodexSessionsOnCanvas({ history, roots: async (root) => [root], now: () => now, platform: 'darwin' })
    // The first answer has no list yet and says Codex is loading; the ask runs meanwhile.
    expect(codex.sessions(PROJECT)).toEqual({ sessions: [], available: true, loading: true })
    await codex.settled(PROJECT)
    expect(codex.sessions(PROJECT)).toEqual({
      available: true,
      loading: false,
      sessions: [
        {
          sessionId: id(1),
          title: 'Explain the tests',
          lastAt: '2026-11-03T10:00:00.000Z',
          cwd: '/fake/project/src',
          size: 0,
          modifiedAt: THREAD.updatedAt,
          live: false,
          vendor: 'codex',
          origin: 'external',
        },
      ],
    })
    now += CODEX_SESSIONS_POLL_MS - 1
    // Another spelling of the same root shares the answer.
    codex.sessions(`${PROJECT}/`)
    expect(asked).toEqual([PROJECT])
    now += 1
    // A later ask is no longer `loading`: the last list stands until it answers.
    expect(codex.sessions(PROJECT)).toMatchObject({ loading: false, sessions: [{ sessionId: id(1) }] })
    await codex.settled(PROJECT)
    expect(asked).toEqual([PROJECT, PROJECT])
    expect(CODEX_SESSIONS_POLL_MS).toBe(30_000)
  })

  it('two asks at once start one list', async () => {
    const { history, asked } = counted(() => [THREAD])
    const codex = new CodexSessionsOnCanvas({ history, roots: async (root) => [root] })
    codex.sessions(PROJECT)
    await Promise.all([codex.settled(PROJECT), codex.settled(PROJECT)])
    expect(asked).toHaveLength(1)
  })

  it('without a Codex home asks nothing and turns the polling off', async () => {
    const { history, asked } = counted(() => [THREAD])
    const codex = new CodexSessionsOnCanvas({ history, roots: async (root) => [root], present: () => false })
    expect(codex.sessions(PROJECT)).toEqual({ sessions: [], available: false, loading: false })
    expect(await codex.settled(PROJECT)).toEqual([])
    expect(asked).toEqual([])
  })

  it('a Codex that fails keeps the last list, turns the polling off and is logged once per reason', async () => {
    let now = 0
    let answer: HistorySession[] | Error = [THREAD]
    const logged: string[] = []
    const { history } = counted(() => answer)
    const codex = new CodexSessionsOnCanvas({ history, roots: async (root) => [root], now: () => now, log: (message) => logged.push(message) })
    await codex.settled(PROJECT)
    answer = new Error('no Codex for this platform')
    now += CODEX_SESSIONS_POLL_MS
    await codex.settled(PROJECT)
    const failed = codex.sessions(PROJECT)
    expect(failed.available).toBe(false)
    expect(failed.loading).toBe(false)
    expect(failed.sessions.map((session) => session.sessionId)).toEqual([id(1)])
    now += CODEX_SESSIONS_POLL_MS
    await codex.settled(PROJECT)
    expect(logged).toHaveLength(1)
    answer = [THREAD]
    now += CODEX_SESSIONS_POLL_MS
    await codex.settled(PROJECT)
    expect(codex.sessions(PROJECT).available).toBe(true)
  })

  it('a thread whose id cannot name a Session is left out of the history', async () => {
    const { history } = counted(() => [THREAD, { ...THREAD, id: 'thr/../x' }])
    const codex = new CodexSessionsOnCanvas({ history, roots: async (root) => [root] })
    await codex.settled(PROJECT)
    expect(codex.sessions(PROJECT).sessions.map((session) => session.sessionId)).toEqual([id(1)])
  })

  it('reads the transcript of a thread of the Project only, in its own folder, without the Subagents\' records', async () => {
    const { history, reads } = counted(() => [THREAD])
    const codex = new CodexSessionsOnCanvas({ history, roots: async (root) => [root] })
    // Before a list nothing is the Project's.
    expect(await codex.transcript(PROJECT, id(1))).toBeNull()
    await codex.settled(PROJECT)
    expect(await codex.transcript(PROJECT, id(9))).toBeNull()
    const events = await codex.transcript(PROJECT, id(1))
    expect(events).toEqual([{ type: 'notice', kind: 'user', text: 'Explain the tests', at: Date.parse('2026-11-03T10:00:00.000Z') }])
    expect(reads).toEqual([[id(1), '/fake/project/src']])
  })
})

describe('the answer of claudeHome.transcript for a Codex thread', () => {
  const events: AgentEvent[] = [
    { type: 'notice', kind: 'user', text: 'one' },
    { type: 'notice', kind: 'user', text: 'two' },
  ]

  it('a read from the end gets every event at once, with nothing earlier to load', () => {
    expect(codexTranscriptAnswer(events, { back: { bytes: 1024 } })).toEqual({
      found: true,
      events,
      cursor: { offset: 2, fileId: 'codex-thread' },
      reset: false,
      more: false,
      earlier: 0,
      offsets: [0, 0],
    })
  })

  it('a read forward from its cursor gets what came after; any other cursor starts over', () => {
    expect(codexTranscriptAnswer(events, { cursor: { offset: 1, fileId: 'codex-thread' } })).toMatchObject({ events: [events[1]], reset: false })
    expect(codexTranscriptAnswer(events, { cursor: { offset: 2, fileId: 'codex-thread' } })).toMatchObject({ events: [], reset: false })
    expect(codexTranscriptAnswer(events, { cursor: { offset: 5, fileId: 'other' } })).toMatchObject({ events, reset: true })
  })
})

describe('the claudeHome channels with the Codex Sessions', () => {
  async function ipcOver(codex: CodexSessions) {
    const home = tempRoot()
    const registry = new ClaudeHomeRegistry({ home, listWorktrees: async () => [] })
    const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener as never) }
    const subscriptions = new ClaudeHomeSubscriptions(registry)
    closers.push(() => subscriptions.closeAll())
    await registerIpc(ipc, {
      modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions, undefined, undefined, undefined, undefined, codex) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    })
    return async (channel: string, input: unknown): Promise<IpcResult<Record<string, unknown>>> => {
      const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
      if (!listener) throw new Error(`no handler for ${channel}`)
      return (await listener({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<Record<string, unknown>>
    }
  }

  it('claudeHome.sessions gives the Codex threads in the history, with the Vendor, and says Codex answered', async () => {
    const { history } = counted(() => [THREAD])
    const codex = new CodexSessionsOnCanvas({ history, roots: async (root) => [root] })
    const call = await ipcOver(codex)
    await call('claudeHome.sessions', { projectRoot: PROJECT })
    await codex.settled(PROJECT)
    const answer = await call('claudeHome.sessions', { projectRoot: PROJECT })
    expect(answer).toMatchObject({ ok: true, value: { live: [], codex: true, history: [{ sessionId: id(1), vendor: 'codex', origin: 'external', title: 'Explain the tests' }] } })
    expect((answer as { value: Record<string, unknown> }).value.codexLoading).toBeUndefined()
  })

  it('a Codex that never answers holds back nothing: the Claude part comes at once, the threads with a later answer', async () => {
    let release = (): void => undefined
    const history: Pick<HistoryPart, 'list' | 'read'> = {
      // Answers only when the test lets it: until then, a Codex that hangs.
      list: () => new Promise((resolve) => (release = () => resolve([THREAD]))),
      read: () => Promise.resolve([]),
    }
    const codex = new CodexSessionsOnCanvas({ history, roots: async (root) => [root] })
    const call = await ipcOver(codex)
    const bound = new Promise<'waited'>((resolve) => setTimeout(() => resolve('waited'), 1000))
    const first = await Promise.race([call('claudeHome.sessions', { projectRoot: PROJECT }), bound])
    expect(first).toEqual({ ok: true, value: { live: [], history: [], codex: true, codexLoading: true } })
    // Asked again while Codex still hangs: still at once, and no second Codex is started.
    expect(await Promise.race([call('claudeHome.sessions', { projectRoot: PROJECT }), bound])).toMatchObject({ ok: true, value: { codexLoading: true } })
    release()
    await codex.settled(PROJECT)
    const later = await call('claudeHome.sessions', { projectRoot: PROJECT })
    expect(later).toMatchObject({ ok: true, value: { codex: true, history: [{ sessionId: id(1), vendor: 'codex' }] } })
    expect((later as { value: Record<string, unknown> }).value.codexLoading).toBeUndefined()
  })

  it('without a Codex the answer is the Claude home\'s alone, as before', async () => {
    const call = await ipcOver(new CodexSessionsOnCanvas({ history: counted(() => [THREAD]).history, roots: async (root) => [root], present: () => false }))
    expect(await call('claudeHome.sessions', { projectRoot: PROJECT })).toEqual({ ok: true, value: { live: [], history: [] } })
  })

  it('claudeHome.transcript reads a Codex thread of the Project, and finds none of another', async () => {
    const { history } = counted(() => [THREAD])
    const codex = new CodexSessionsOnCanvas({ history, roots: async (root) => [root] })
    const call = await ipcOver(codex)
    await call('claudeHome.sessions', { projectRoot: PROJECT })
    await codex.settled(PROJECT)
    const read = await call('claudeHome.transcript', { projectRoot: PROJECT, sessionId: id(1), back: { bytes: 1024 } })
    expect(read).toMatchObject({ ok: true, value: { found: true, earlier: 0, events: [{ type: 'notice', kind: 'user', text: 'Explain the tests' }] } })
    expect(await call('claudeHome.transcript', { projectRoot: '/fake/elsewhere', sessionId: id(1), back: { bytes: 1024 } })).toMatchObject({ ok: true, value: { found: false } })
  })
})
