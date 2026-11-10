// The Subagents of a Codex Session on the Canvas (worfy-multi-vendor ticket 34; src/main/vendors/codex/subagents.ts)
// on the fake app-server (WORFY_CODEX=fake, which test/setup-contract.ts sets): the Session's thread is read
// with its turns (`thread/read`), the Subagent threads are listed (`thread/list`) and the tree is built by
// `parentThreadId`. A spawned Subagent gets its Node with its nickname, role and status; the service
// children (review, compact, memory_consolidation, guardian) and the Subagents of another Session do not.
// The `claudeHome.subagents` channel answers the tree for a Codex Session of the Project, and never asks
// Codex for a Session it does not list.
//
// The fake runs under scriptNode() (test/script-node.ts) through the spawn stand-in of codexAskStarter, as
// test/contract/codex-history.test.ts starts it. Every process a test started is killed after it.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { ClaudeHomeRegistry } from '../../src/main/claude-home/registry'
import { ClaudeHomeSubscriptions, claudeHomeHandlers } from '../../src/main/ipc/claude-home'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { codexAskStarter, type StartCodex } from '../../src/main/vendors/codex/account'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import type { CodexSessions } from '../../src/main/vendors/codex/sessions-on-canvas'
import { CodexSubagentsOnCanvas, codexSubagentsPart, codexSubagentTree, SUBAGENT_SOURCE_KINDS } from '../../src/main/vendors/codex/subagents'
import type { Thread } from '../../src/main/vendors/codex/protocol/ts/v2/Thread'
import type { ThreadItem } from '../../src/main/vendors/codex/protocol/ts/v2/ThreadItem'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { flattenSubagents, type SubagentInfo } from '../../src/shared/transcript/subagents'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const id = (n: number): string => `019a0000-0000-7000-8000-000000000${n}`
/** The Session of the script subagents.jsonl, its two spawned Subagents and the Subagent of another Session. */
const SESSION = id(341)
const ADA = id(342)
const BO = id(343)
const FOREIGN = id(348)
const PROJECT = '/fake/project'

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
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-subagents-'))
  roots.push(root)
  return root
}

/** The Subagents part over the fake playing `script`, with the log of what worfy sent and the processes it started. */
function fake(script: string) {
  const cwd = tempRoot()
  const codexHome = tempRoot()
  const log = join(cwd, 'codex.log')
  const started: ChildProcess[] = []
  const spawnProcess = (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    const child = spawn(scriptNode(), [...args], options)
    children.push(child)
    started.push(child)
    return child
  }
  const start: StartCodex = codexAskStarter({
    runtime: RUNTIME,
    appPath: REPO,
    cwd,
    clientVersion: '9.9.9',
    env: { ...process.env, CODEX_HOME: codexHome, WORFY_CODEX_SCRIPT: script, WORFY_CODEX_LOG: log },
    spawnProcess,
    log: () => undefined,
  })
  const sent = (): Record<string, unknown>[] => readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
  return { part: codexSubagentsPart({ start, codexHome: () => codexHome }), sent, started }
}

const exited = (child: ChildProcess): Promise<void> => (hasExited(child) ? Promise.resolve() : new Promise((resolve) => child.once('exit', () => resolve())))

/** Each entry of a tree, parents first: what its Node shows. */
const shown = (tree: readonly SubagentInfo[]) =>
  flattenSubagents(tree).map(({ id: entry, agentId, name, subagentType, status, depth, durationMs, transcript }) => ({ id: entry, agentId, name, subagentType, status, depth, durationMs, transcript }))

describe('the Subagents of a Codex Session (thread/read, thread/list)', () => {
  it('gives a Node to each spawned Subagent with its status, and none to a service child or another Session\'s Subagent', async () => {
    const at = fake('subagents')
    const tree = await at.part.tree(SESSION)
    expect(shown(tree)).toEqual([
      // Started 2 s into the Session, completed 10 s later (subAgentActivity of the Session's turn).
      { id: `agent:${ADA}`, agentId: ADA, name: 'Ada', subagentType: 'explorer', status: 'done', depth: 1, durationMs: 10_000, transcript: false },
      // Its thread ended in a system error.
      { id: `agent:${BO}`, agentId: BO, name: 'Bo', subagentType: 'worker', status: 'error', depth: 1, durationMs: 6_000, transcript: false },
    ])
    expect(tree[0]).toMatchObject({ model: 'gpt-5.5-codex', description: 'Find the flaky test', parentAgentId: null, children: [] })
    expect(flattenSubagents(tree).map((info) => info.agentId)).not.toContain(FOREIGN)

    // The Session's thread with its turns, then the Subagent threads newest first; one process, closed after.
    const requests = at.sent().filter((message) => typeof message.method === 'string' && message.id !== undefined && message.method !== 'initialize')
    expect(requests.map((message) => [message.method, message.params])).toEqual([
      ['thread/read', { threadId: SESSION, includeTurns: true }],
      ['thread/list', { limit: 100, sortKey: 'created_at', sortDirection: 'desc', sourceKinds: [...SUBAGENT_SOURCE_KINDS] }],
    ])
    expect(at.started).toHaveLength(1)
    await exited(at.started[0] as ChildProcess)
  })

  it('a Codex that cannot read the Session rejects, and its process is closed', async () => {
    // The script answers `thread/list` first: the read gets the fake's refusal.
    const at = fake('threads')
    await expect(at.part.tree(SESSION)).rejects.toThrow()
    expect(at.started).toHaveLength(1)
    await exited(at.started[0] as ChildProcess)
  })
})

// The tree itself, from threads and items as Codex gives them (the same function the part above calls).
const T0 = 1_793_000_000
function thread(fields: Partial<Thread> & { id: string }): Thread {
  return {
    sessionId: SESSION,
    forkedFromId: null,
    parentThreadId: null,
    preview: '',
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: 'paginated',
    modelProvider: 'openai',
    model: 'gpt-5.5-codex',
    reasoningEffort: null,
    createdAt: T0,
    updatedAt: T0,
    recencyAt: T0,
    status: { type: 'idle' },
    path: null,
    cwd: PROJECT,
    cliVersion: '0.166.0',
    originator: 'worfy',
    source: 'vscode',
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...fields,
  } as Thread
}
const spawned = (child: string, parent: string, nickname: string, extra: Partial<Thread> = {}): Thread =>
  thread({
    id: child,
    parentThreadId: parent,
    agentNickname: nickname,
    agentRole: 'explorer',
    source: { subAgent: { thread_spawn: { parent_thread_id: parent, depth: 1, agent_path: null, agent_nickname: nickname, agent_role: 'explorer' } } },
    ...extra,
  })
const activity = (n: number, kind: 'started' | 'completed' | 'interrupted' | 'interacted', agent: string, atSeconds: number): ThreadItem =>
  ({ type: 'subAgentActivity', model: null, reasoningEffort: null, id: `call_${n}`, kind, agentThreadId: agent, agentPath: '/root/x', startedAtMs: atSeconds * 1000, completedAtMs: atSeconds * 1000 }) as ThreadItem
const withTurn = (root: Thread, items: ThreadItem[], status: 'completed' | 'interrupted' | 'inProgress' = 'completed'): Thread =>
  ({ ...root, turns: [{ id: 'turn_1', items, status, startedAt: T0, completedAt: null, durationMs: null }] }) as Thread

describe('codexSubagentTree', () => {
  const root = thread({ id: SESSION })

  it('says running for a Subagent that started and has not ended, interrupted for one Codex interrupted', () => {
    const items = [activity(1, 'started', ADA, T0 + 1), activity(2, 'started', BO, T0 + 2), activity(3, 'interrupted', BO, T0 + 5)]
    const tree = codexSubagentTree(withTurn(root, items, 'inProgress'), [spawned(ADA, SESSION, 'Ada'), spawned(BO, SESSION, 'Bo')], new Map())
    expect(shown(tree).map(({ name, status, durationMs }) => [name, status, durationMs])).toEqual([
      ['Ada', 'running', null],
      ['Bo', 'interrupted', 3000],
    ])
  })

  it('says interrupted for a Subagent still running when the Session\'s last turn was interrupted', () => {
    const tree = codexSubagentTree(withTurn(root, [activity(1, 'started', ADA, T0 + 1)], 'interrupted'), [spawned(ADA, SESSION, 'Ada')], new Map())
    expect(tree.map((info) => info.status)).toEqual(['interrupted'])
  })

  it('takes the status and the answer of a collab call\'s agent states, the latest last', () => {
    const wait = {
      type: 'collabAgentToolCall',
      id: 'call_wait',
      tool: 'wait',
      status: 'completed',
      senderThreadId: SESSION,
      receiverThreadIds: [ADA, BO],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: { [ADA]: { status: 'completed', message: '**VERIFIED** the tests pass\nmore' }, [BO]: { status: 'errored', message: 'The command failed.' } },
      startedAtMs: (T0 + 3) * 1000,
      completedAtMs: (T0 + 9) * 1000,
    } as ThreadItem
    const tree = codexSubagentTree(withTurn(root, [activity(1, 'started', ADA, T0 + 1), activity(2, 'started', BO, T0 + 2), wait]), [spawned(ADA, SESSION, 'Ada'), spawned(BO, SESSION, 'Bo')], new Map())
    expect(tree.map(({ name, status, summary, verdict }) => [name, status, summary, verdict])).toEqual([
      ['Ada', 'done', 'VERIFIED the tests pass', 'VERIFIED'],
      ['Bo', 'error', 'The command failed.', null],
    ])
  })

  // A reviewer's verdict is its first line that starts with VERIFIED or REJECTED (src/shared/workflow/verdict.mjs,
  // worfy-polish 91): a lead-in before it is dropped from the summary too; a word inside a sentence is no verdict.
  it('reads the verdict of an answer after a lead-in, and none from a word inside a sentence', () => {
    const answers = (ada: string, bo: string): unknown[][] => {
      const wait = {
        type: 'collabAgentToolCall',
        id: 'call_wait',
        tool: 'wait',
        status: 'completed',
        senderThreadId: SESSION,
        receiverThreadIds: [ADA, BO],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agentsStates: { [ADA]: { status: 'completed', message: ada }, [BO]: { status: 'completed', message: bo } },
        startedAtMs: (T0 + 3) * 1000,
        completedAtMs: (T0 + 9) * 1000,
      } as ThreadItem
      const tree = codexSubagentTree(withTurn(root, [activity(1, 'started', ADA, T0 + 1), activity(2, 'started', BO, T0 + 2), wait]), [spawned(ADA, SESSION, 'Ada'), spawned(BO, SESSION, 'Bo')], new Map())
      return tree.map(({ name, summary, verdict }) => [name, summary, verdict])
    }
    expect(answers('This confirms a clear discrepancy.\n\nREJECTED: node --test exits 1', 'Every claim was VERIFIED by re-running it.')).toEqual([
      ['Ada', 'REJECTED: node --test exits 1', 'REJECTED'],
      ['Bo', 'Every claim was VERIFIED by re-running it.', null],
    ])
  })

  it('puts a Subagent of a Subagent under it, its status from its parent\'s items; a service child\'s own children stay hidden too', () => {
    const NESTED = id(350)
    const REVIEW = id(344)
    const UNDER_REVIEW = id(351)
    const threads = [
      spawned(ADA, SESSION, 'Ada'),
      spawned(NESTED, ADA, 'Nia'),
      thread({ id: REVIEW, parentThreadId: SESSION, source: { subAgent: 'review' } }),
      spawned(UNDER_REVIEW, REVIEW, 'Rex'),
    ]
    const items = new Map([[ADA, [activity(1, 'started', NESTED, T0 + 3), activity(2, 'completed', NESTED, T0 + 4)]]])
    const tree = codexSubagentTree(withTurn(root, [activity(3, 'started', ADA, T0 + 1)]), threads, items)
    expect(shown(tree).map(({ name, status, depth }) => [name, status, depth])).toEqual([
      ['Ada', 'running', 1],
      ['Nia', 'done', 2],
    ])
    expect(tree[0]?.children[0]?.parentAgentId).toBe(ADA)
  })

  it('hides each kind of service child: review, compact, memory_consolidation, guardian', () => {
    const service = [
      thread({ id: id(352), parentThreadId: SESSION, source: { subAgent: 'review' } }),
      thread({ id: id(353), parentThreadId: SESSION, source: { subAgent: 'compact' } }),
      thread({ id: id(354), parentThreadId: SESSION, source: { subAgent: 'memory_consolidation' } }),
      thread({ id: id(355), parentThreadId: SESSION, source: { subAgent: { other: 'guardian' } } }),
    ]
    expect(codexSubagentTree(root, service, new Map())).toEqual([])
  })
})

describe('claudeHome.subagents for a Codex Session', () => {
  async function ipcWith(codex: Pick<CodexSessions, 'cached'>, part: { tree(threadId: string): Promise<SubagentInfo[]> }) {
    const registry = new ClaudeHomeRegistry({ home: tempRoot(), listWorktrees: async () => [], isAlive: async () => false })
    const subscriptions = new ClaudeHomeSubscriptions(registry)
    closers.push(() => subscriptions.closeAll())
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
    const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
    const sessions = { sessions: () => ({ sessions: [], available: true, loading: false }), settled: async () => [], transcript: async () => null, ...codex }
    const subagents = new CodexSubagentsOnCanvas(sessions, part, () => undefined)
    await registerIpc(ipc, {
      modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions, undefined, undefined, undefined, undefined, sessions, subagents) },
      isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
    })
    return async (sessionId: string): Promise<IpcResult<unknown>> =>
      (await handlers.get(`${IPC_CHANNEL_PREFIX}claudeHome.subagents`)?.({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, { projectRoot: PROJECT, sessionId })) as IpcResult<unknown>
  }

  it('answers the tree of a Codex Session the Project lists, read from the fake', async () => {
    const at = fake('subagents')
    const call = await ipcWith({ cached: () => [{ id: SESSION, cwd: PROJECT, title: null, updatedAt: null, origin: 'worfy' }] }, at.part)
    const result = await call(SESSION)
    expect(result.ok).toBe(true)
    const answer = (result as { value: { found: boolean; signals: unknown[]; files: unknown[]; tree: SubagentInfo[] } }).value
    expect(answer).toMatchObject({ found: true, signals: [], files: [] })
    expect(shown(answer.tree).map(({ name, status }) => [name, status])).toEqual([
      ['Ada', 'done'],
      ['Bo', 'error'],
    ])
  })

  it('asks Codex nothing for a Session neither the Claude home nor the Codex list has', async () => {
    const asked: string[] = []
    const call = await ipcWith({ cached: () => [] }, { tree: async (threadId) => (asked.push(threadId), []) })
    const result = await call(SESSION)
    expect(result).toEqual({ ok: true, value: { found: false, signals: [], files: [] } })
    expect(asked).toEqual([])
  })

  it('keeps the last tree when Codex fails, and answers not found before any tree', async () => {
    let fail = true
    const tree: SubagentInfo[] = [{ ...shownEntry(), id: `agent:${ADA}` }]
    const call = await ipcWith({ cached: () => [{ id: SESSION, cwd: PROJECT, title: null, updatedAt: null, origin: 'external' }] }, {
      tree: async () => {
        if (fail) throw new Error('Codex did not answer')
        return tree
      },
    })
    expect(await call(SESSION)).toEqual({ ok: true, value: { found: false, signals: [], files: [] } })
    fail = false
    expect(await call(SESSION)).toEqual({ ok: true, value: { found: true, signals: [], files: [], tree } })
    fail = true
    expect(await call(SESSION)).toEqual({ ok: true, value: { found: true, signals: [], files: [], tree } })
  })
})

function shownEntry(): SubagentInfo {
  return {
    id: '',
    agentId: ADA,
    toolUseId: null,
    parentAgentId: null,
    name: 'Ada',
    subagentType: 'explorer',
    model: null,
    description: null,
    status: 'done',
    background: true,
    startedAt: null,
    durationMs: null,
    summary: null,
    verdict: null,
    depth: 1,
    transcript: false,
    children: [],
  }
}
