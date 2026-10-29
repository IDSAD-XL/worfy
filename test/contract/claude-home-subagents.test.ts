// The Subagent channels of the `claudeHome` domain (ticket 15): `claudeHome.subagents` (what a
// Session's transcript and its `subagents/` folder say) and `claudeHome.subagentTranscript` (one
// Subagent's own transcript), over copies of the synthetic Claude home of ticket 09 whose folders
// under projects/ have the names the registry looks for on this system (claude-home-fixture.ts).
// The Claude home is only read: a snapshot of every file before and after proves it.
import { createHash } from 'node:crypto'
import { appendFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { HIDDEN_SUBAGENTS_FILE, HiddenSubagents } from '../../src/main/claude-home/hidden-subagents'
import { ClaudeHomeRegistry, processAlive, processState } from '../../src/main/claude-home/registry'
import { SubagentReader, transcriptSessionId } from '../../src/main/claude-home/subagents'
import { ClaudeHomeSubscriptions, claudeHomeHandlers } from '../../src/main/ipc/claude-home'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { AgentEvent } from '../../src/shared/agent/events'
import { buildSubagentTree, flattenSubagents, type SubagentFile, type SubagentSignal } from '../../src/shared/transcript/subagents'
import { APP_URL, INDEX_HTML } from '../app-url'
import { copyClaudeHome, projectDir, windowsProcStart } from './claude-home-fixture'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const WINDOWS = process.platform === 'win32'

/** A copy of the fixture that the tests which only read share; a test that writes makes its own (copyOfFixture). */
let FIXTURE: string
let fixtureDir: string
const AGENTS = '/Users/test/projects/agents'
const DEMO = '/Users/test/projects/demo'
const S5 = '55555555-5555-4555-8555-555555555555'
const S7 = '77777777-7777-4777-8777-777777777777'
const S7_DIR = join('projects', projectDir(AGENTS))
const STALE = '/Users/test/projects/stale'
const S9 = '99999999-9999-4999-8999-999999999999'
const S9_DIR = join('projects', projectDir(STALE))
/** Fixture Subagents of Session 9999: A ended by a queued task-notification, B never reported. */
const A = 'a6000000000000260'
const B = 'a7000000000000260'

const temps: string[] = []
const closers: (() => Promise<void>)[] = []

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'worfy-subagents-'))
  FIXTURE = await copyClaudeHome(join(fixtureDir, 'claude'))
})

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  vi.restoreAllMocks()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'worfy-subagents-'))
  temps.push(dir)
  return dir
}

async function copyOfFixture(): Promise<string> {
  return copyClaudeHome(join(await tempDir(), 'claude'))
}

/** Every file and folder under `root` with its mtime, size and sha1. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const stats = await lstat(path)
      if (entry.isDirectory()) {
        out[path] = `dir mtime=${stats.mtimeMs}`
        await walk(path)
      } else {
        out[path] = `file mtime=${stats.mtimeMs} size=${stats.size} sha1=${createHash('sha1').update(await readFile(path)).digest('hex')}`
      }
    }
  }
  out[root] = `dir mtime=${(await lstat(root)).mtimeMs}`
  await walk(root)
  return out
}

const registryOver = (home: string) => new ClaudeHomeRegistry({ home, listWorktrees: async () => [], isAlive: async () => false })

/** No process of the fixtures runs on this machine: a Session is live only where a test says so. */
const readerWith = (isAlive: (pid: number) => Promise<boolean> = async () => false) =>
  new SubagentReader({ processState: async (pid) => ((await isAlive(pid)) ? 'alive' : 'gone') })

/** Registers the Session `sessionId` as run by process `pid` in the Claude home `home` (a copy); `fields` go into the entry too. */
async function register(home: string, pid: number, sessionId: string, cwd: string, fields: Record<string, unknown> = {}): Promise<void> {
  await mkdir(join(home, 'sessions'), { recursive: true })
  await writeFile(join(home, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId, cwd, procStart: 'Thu Sep 10 02:29:00 2026', status: 'busy', ...fields }))
}

async function ipcOver(registry: ClaudeHomeRegistry, reader = readerWith(), hidden?: HiddenSubagents) {
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  const subscriptions = new ClaudeHomeSubscriptions(registry)
  closers.push(() => subscriptions.closeAll())
  await registerIpc(ipc, {
    modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions, reader, undefined, undefined, hidden) },
    isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }),
  })
  return async (channel: string, input: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    return (await listener({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
}

type SubagentsAnswer = { found: boolean; signals: SubagentSignal[]; files: SubagentFile[] }
type TranscriptAnswer = { found: boolean; events: AgentEvent[]; more: boolean }

function value<T>(result: IpcResult<unknown>): T {
  if (!result.ok) throw new Error(`call failed: ${result.error}`)
  return result.value as T
}

/** Each Subagent of an answer with its status, parents first. */
const statuses = (answer: SubagentsAnswer) => flattenSubagents(buildSubagentTree(answer)).map(({ agentId, status }) => [agentId, status])
/** The answer for fixture Session 9999. */
const ask = async (call: Awaited<ReturnType<typeof ipcOver>>) => value<SubagentsAnswer>(await call('claudeHome.subagents', { projectRoot: STALE, sessionId: S9 }))

describe('claudeHome.subagents', () => {
  it.each([
    ['claudeHome.subagents', { projectRoot: 'relative', sessionId: S7 }],
    ['claudeHome.subagents', { projectRoot: AGENTS, sessionId: '../../etc/passwd' }],
    ['claudeHome.subagents', { projectRoot: AGENTS, sessionId: 7 }],
    ['claudeHome.subagents', { projectRoot: AGENTS }],
    ['claudeHome.subagentTranscript', { projectRoot: AGENTS, sessionId: S7, agentId: '../agent-a3000000000000286' }],
    ['claudeHome.subagentTranscript', { projectRoot: AGENTS, sessionId: S7, agentId: 'a/b' }],
    ['claudeHome.subagentTranscript', { projectRoot: AGENTS, sessionId: S7, agentId: 42 }],
    ['claudeHome.subagentTranscript', { projectRoot: AGENTS, sessionId: S7 }],
    ['claudeHome.subagentTranscript', { projectRoot: AGENTS, sessionId: S7, agentId: 'a3000000000000286', maxBytes: 0 }],
  ])('rejects %s with input %j', async (channel, input) => {
    const call = await ipcOver(registryOver(FIXTURE))
    const result = await call(channel, input)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/invalid input/)
  })

  it('answers the signals and the files of a Session, from which the tree is built', async () => {
    const call = await ipcOver(registryOver(FIXTURE))
    const answer = value<SubagentsAnswer>(await call('claudeHome.subagents', { projectRoot: AGENTS, sessionId: S7 }))
    expect(answer.found).toBe(true)
    expect(answer.files.map((file) => [file.agentId, file.meta?.agentType, file.transcript])).toEqual([
      ['a3000000000000286', 'implementer', true],
      ['a4000000000000286', 'scout', true],
      ['a5000000000000286', 'reviewer', true],
    ])
    const tree = buildSubagentTree(answer)
    expect(flattenSubagents(tree).map(({ name, subagentType, status, verdict, depth }) => ({ name, subagentType, status, verdict, depth }))).toEqual([
      { name: 'impl-08', subagentType: 'implementer', status: 'done', verdict: null, depth: 1 },
      { name: null, subagentType: 'scout', status: 'done', verdict: null, depth: 2 },
      { name: 'verify-07', subagentType: 'reviewer', status: 'done', verdict: 'REJECTED', depth: 1 },
    ])
  })

  it('answers found: false for a Session without a transcript, and no files for one without Subagents', async () => {
    const call = await ipcOver(registryOver(FIXTURE))
    expect(value(await call('claudeHome.subagents', { projectRoot: AGENTS, sessionId: '99999999-9999-4999-8999-999999999999' }))).toStrictEqual({ found: false, signals: [], files: [] })
    // Session 1111 has ended (no sessions/ entry): its only signal says so.
    expect(value(await call('claudeHome.subagents', { projectRoot: DEMO, sessionId: '11111111-1111-4111-8111-111111111111' }))).toStrictEqual({
      found: true,
      signals: [{ kind: 'session-closed' }],
      files: [],
    })
  })

  it('passes on the contract fields only, whatever the reader returns', async () => {
    const reader = new SubagentReader()
    const call = await ipcOver(registryOver(FIXTURE), reader)
    const plain = await call('claudeHome.subagents', { projectRoot: AGENTS, sessionId: S7 })
    // The Session is found and has Subagents. For one that is not found the reader is never asked,
    // and both answers below would be the same empty one whatever the channel lets through.
    const found = value<SubagentsAnswer>(plain)
    expect(found.found).toBe(true)
    expect(found.signals.length).toBeGreaterThan(0)
    expect(found.files.length).toBeGreaterThan(0)
    // A reader that leaks raw fields of the files (a prompt, an output path) must not reach the renderer.
    const leaking = vi.spyOn(reader, 'session').mockImplementation(async (path) => {
      const real = await SubagentReader.prototype.session.call(new SubagentReader(), path)
      return {
        signals: real.signals.map((signal) => ({ ...signal, prompt: 'Synthetic secret brief.' })),
        files: real.files.map((file) => ({ ...file, outputFile: '/Users/test/tmp/out', meta: { ...file.meta, prompt: 'Synthetic secret brief.' } })),
      }
    })
    const leaky = await call('claudeHome.subagents', { projectRoot: AGENTS, sessionId: S7, extra: true })
    expect(leaking).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(leaky)).not.toMatch(/Synthetic secret brief|outputFile/)
    expect(leaky).toStrictEqual(plain)
  })

  it('refuses an answer of the wrong shape instead of passing it on', async () => {
    const reader = new SubagentReader()
    const call = await ipcOver(registryOver(FIXTURE), reader)
    const wrong = vi.spyOn(reader, 'session').mockResolvedValue({ signals: [{ kind: 'call', toolUseId: 7 }] as unknown as SubagentSignal[], files: [] })
    const result = await call('claudeHome.subagents', { projectRoot: AGENTS, sessionId: S7 })
    // The Session is found, so the reader is asked; the refusal is of its answer, not of the call.
    expect(wrong).toHaveBeenCalledTimes(1)
    expect(result).toStrictEqual({ ok: false, error: 'claudeHome.subagents: invalid output from the handler' })
  })

  it('follows a Session as it is written: a task-notification turns the running Subagent done', async () => {
    const home = await copyOfFixture()
    const transcript = join(home, S7_DIR, `${S7}.jsonl`)
    const lines = (await readFile(transcript, 'utf8')).split('\n').filter((line) => line !== '')
    const notification = lines.findIndex((line) => line.includes('<task-notification>'))
    await writeFile(transcript, `${lines.slice(0, notification).join('\n')}\n`)
    // The Session runs: a Subagent without an end is running, not cut off (ADR-0031).
    await register(home, 47777, S7, AGENTS)
    const live = () => readerWith(async (pid) => pid === 47777)
    const call = await ipcOver(registryOver(home), live())
    const before = buildSubagentTree(value<SubagentsAnswer>(await call('claudeHome.subagents', { projectRoot: AGENTS, sessionId: S7 })))
    expect(before[0]).toMatchObject({ name: 'impl-08', status: 'done', summary: 'Synthetic implementer report for 08.' })
    // The implementer's file already ends its turn; a file still being written keeps it running.
    const implementer = join(home, S7_DIR, S7, 'subagents', 'agent-a3000000000000286.jsonl')
    const implementerLines = (await readFile(implementer, 'utf8')).split('\n').filter((line) => line !== '')
    await writeFile(implementer, `${implementerLines.slice(0, -1).join('\n')}\n`)
    const fresh = await ipcOver(registryOver(home), live())
    const running = buildSubagentTree(value<SubagentsAnswer>(await fresh('claudeHome.subagents', { projectRoot: AGENTS, sessionId: S7 })))
    expect(running[0]).toMatchObject({ name: 'impl-08', status: 'running', durationMs: null })
    await appendFile(implementer, `${implementerLines.at(-1)!}\n`)
    await appendFile(transcript, `${lines.slice(notification).join('\n')}\n`)
    const after = buildSubagentTree(value<SubagentsAnswer>(await fresh('claudeHome.subagents', { projectRoot: AGENTS, sessionId: S7 })))
    expect(after[0]).toMatchObject({ name: 'impl-08', status: 'done', durationMs: 175_000 })
  })

  it('reads the Subagents of a Session without writing anything under the Claude home', async () => {
    const home = await copyOfFixture()
    const before = await snapshot(home)
    const call = await ipcOver(registryOver(home))
    for (const [projectRoot, sessionId] of [
      [AGENTS, S7],
      [DEMO, S5],
      [STALE, S9],
    ] as const) {
      expect(value<SubagentsAnswer>(await call('claudeHome.subagents', { projectRoot, sessionId })).found).toBe(true)
    }
    for (const agentId of ['a3000000000000286', 'a4000000000000286', 'a5000000000000286']) {
      expect(value<TranscriptAnswer>(await call('claudeHome.subagentTranscript', { projectRoot: AGENTS, sessionId: S7, agentId })).found).toBe(true)
    }
    expect(await snapshot(home)).toStrictEqual(before)
  })
})

// Ticket worfy-daily/08, ADR-0030 and ADR-0031: Subagents that stayed `running` long after they stopped.
describe('claudeHome.subagents: Subagents without a task-notification user message', () => {

  it('ends a Subagent by the task-notification Claude Code queued, and cuts off one that never reported when its Session is closed', async () => {
    const answer = await ask(await ipcOver(registryOver(FIXTURE)))
    expect(answer.signals.at(-1)).toEqual({ kind: 'session-closed' })
    expect(statuses(answer)).toEqual([
      [A, 'done'],
      [B, 'error'],
    ])
  })

  it('keeps a Subagent running while its Session runs, however long its file has not changed, and cuts it off once the Session is gone', async () => {
    const home = await copyOfFixture()
    await register(home, 43000, S9, STALE)
    let running = true
    const call = await ipcOver(registryOver(home), readerWith(async (pid) => running && pid === 43000))
    const live = await ask(call)
    // An entry without `startedAt`: no start of the process to compare with (ADR-0085).
    expect(live.signals.some((signal) => signal.kind === 'session-closed' || signal.kind === 'session-process')).toBe(false)
    expect(statuses(live)).toEqual([
      [A, 'done'],
      [B, 'running'],
    ])
    // Its file grows: still running.
    const b = join(home, S9_DIR, S9, 'subagents', `agent-${B}.jsonl`)
    await appendFile(b, `${JSON.stringify({ type: 'user', isSidechain: true, agentId: B, timestamp: '2026-09-10T02:40:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01S9FETCH1XXXXXXXXXXXXXX', content: 'Synthetic page.' }] } })}\n`)
    expect(statuses(await ask(call))).toEqual([
      [A, 'done'],
      [B, 'running'],
    ])
    running = false
    const closed = buildSubagentTree(await ask(call))
    expect(flattenSubagents(closed).map(({ agentId, status, durationMs }) => [agentId, status, durationMs])).toEqual([
      [A, 'done', 175_000],
      [B, 'error', 593_000],
    ])
  })

  it('asks whether the Session runs before it reads the files: an end written just before the process stopped is read as an end', async () => {
    const home = await copyOfFixture()
    await register(home, 43000, S9, STALE)
    const transcript = join(home, S9_DIR, `${S9}.jsonl`)
    const ended = JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: '2026-09-10T02:45:00.000Z',
      sessionId: S9,
      content: `<task-notification>\n<task-id>${B}</task-id>\n<tool-use-id>toolu_01S9AGENT2XXXXXXXXXXXXXX</tool-use-id>\n<status>completed</status>\n<summary>Agent "Research option B" finished</summary>\n</task-notification>`,
    })
    // The process writes the notification and exits while worfy asks whether it runs.
    const call = await ipcOver(
      registryOver(home),
      readerWith(async () => {
        await appendFile(transcript, `${ended}\n`)
        return false
      }),
    )
    expect(statuses(await ask(call))).toEqual([
      [A, 'done'],
      [B, 'done'],
    ])
  })

  it('does not call a Session closed when it cannot tell: no sessions/ folder, or an entry being rewritten', async () => {
    const home = await copyOfFixture()
    await rm(join(home, 'sessions'), { recursive: true })
    expect(statuses(await ask(await ipcOver(registryOver(home))))).toEqual([
      [A, 'done'],
      [B, 'running'],
    ])
    await mkdir(join(home, 'sessions'))
    await writeFile(join(home, 'sessions', '43000.json'), `{"pid":43000,"sessionId":"${S9}","cwd`)
    expect(statuses(await ask(await ipcOver(registryOver(home))))).toEqual([
      [A, 'done'],
      [B, 'running'],
    ])
  })

  it('does not call a Session closed when whether its process runs cannot be told', async () => {
    const home = await copyOfFixture()
    await register(home, 43000, S9, STALE)
    const call = await ipcOver(registryOver(home), new SubagentReader({ processState: async () => 'unknown' }))
    const answer = await ask(call)
    expect(answer.signals.some((signal) => signal.kind === 'session-closed')).toBe(false)
    expect(statuses(answer)).toEqual([
      [A, 'done'],
      [B, 'running'],
    ])
  })
})

// A Session continued in a new process keeps its sessionId: a Subagent that died with the earlier
// process has no end, and the Session runs (ADR-0085).
describe('claudeHome.subagents: the start of the Session process (ADR-0085)', () => {
  /** The last record of Subagent B of fixture Session 9999. */
  const B_LAST = Date.parse('2026-09-10T02:31:00.000Z')

  it('gives the numeric startedAt of the entry of the running process, and B is interrupted when the process started after its last record', async () => {
    const home = await copyOfFixture()
    const startedAt = Date.parse('2026-09-10T05:00:00.000Z')
    await register(home, 43000, S9, STALE, { startedAt })
    const answer = await ask(await ipcOver(registryOver(home), readerWith(async (pid) => pid === 43000)))
    expect(answer.signals.at(-1)).toEqual({ kind: 'session-process', startedAt })
    expect(statuses(answer)).toEqual([
      [A, 'done'],
      [B, 'interrupted'],
    ])
  })

  it('keeps B running when the process started before its last record', async () => {
    const home = await copyOfFixture()
    await register(home, 43000, S9, STALE, { startedAt: B_LAST - 300 })
    const answer = await ask(await ipcOver(registryOver(home), readerWith(async (pid) => pid === 43000)))
    expect(answer.signals.at(-1)).toEqual({ kind: 'session-process', startedAt: B_LAST - 300 })
    expect(statuses(answer)).toEqual([
      [A, 'done'],
      [B, 'running'],
    ])
  })

  it('gives no start for an entry whose startedAt is not a number, nor when whether the process runs cannot be told', async () => {
    const home = await copyOfFixture()
    await register(home, 43000, S9, STALE, { startedAt: '2026-09-10T05:00:00.000Z' })
    const text = await ask(await ipcOver(registryOver(home), readerWith(async (pid) => pid === 43000)))
    expect(text.signals.some((signal) => signal.kind === 'session-process')).toBe(false)
    expect(statuses(text)).toEqual([
      [A, 'done'],
      [B, 'running'],
    ])
    await register(home, 43000, S9, STALE, { startedAt: Date.parse('2026-09-10T05:00:00.000Z') })
    const unknown = await ask(await ipcOver(registryOver(home), new SubagentReader({ processState: async () => 'unknown' })))
    expect(unknown.signals.some((signal) => signal.kind === 'session-process' || signal.kind === 'session-closed')).toBe(false)
    expect(statuses(unknown)).toEqual([
      [A, 'done'],
      [B, 'running'],
    ])
  })
})

// The process check of the Session registry (registry.ts): what `ps` cannot answer is not a
// process that ended (PR #45 review: with `ps` missing, a live Session was called closed).
// «Hide» (worfy-polish ticket 45, ADR-0085): the hidden Subagent entries live in the Project's own
// data folder, never under the Claude home, and stay hidden after a restart of worfy.
describe('claudeHome.hiddenSubagents, hideSubagents and showSubagents', () => {
  const PROJECT_ID = 'stale-00000001'
  const OTHER = '88888888-8888-4888-8888-888888888888'

  it('keeps hidden entries across a restart (a new store reads the same file), and «Show hidden Subagents» brings them back', async () => {
    const data = await tempDir()
    const dataDir = (projectId: string) => join(data, projectId)
    const home = await copyOfFixture()
    const before = await snapshot(home)
    const call = await ipcOver(registryOver(home), readerWith(), new HiddenSubagents(dataDir))
    expect(value(await call('claudeHome.hiddenSubagents', { projectId: PROJECT_ID }))).toEqual({ sessions: {} })
    expect(value(await call('claudeHome.hideSubagents', { projectId: PROJECT_ID, sessionId: S9, ids: ['toolu_a', 'agent:b'] }))).toEqual({ sessions: { [S9]: ['toolu_a', 'agent:b'] } })
    // Hidden twice, an entry is kept once; another Session keeps its own list.
    value(await call('claudeHome.hideSubagents', { projectId: PROJECT_ID, sessionId: S9, ids: ['agent:b', 'workflow:wf_1'] }))
    value(await call('claudeHome.hideSubagents', { projectId: PROJECT_ID, sessionId: OTHER, ids: ['toolu_c'] }))

    // worfy restarts: a new store over the same folder.
    const again = await ipcOver(registryOver(home), readerWith(), new HiddenSubagents(dataDir))
    expect(value(await again('claudeHome.hiddenSubagents', { projectId: PROJECT_ID }))).toEqual({ sessions: { [S9]: ['toolu_a', 'agent:b', 'workflow:wf_1'], [OTHER]: ['toolu_c'] } })
    expect(JSON.parse(await readFile(join(data, PROJECT_ID, HIDDEN_SUBAGENTS_FILE), 'utf8'))).toEqual({ sessions: { [S9]: ['toolu_a', 'agent:b', 'workflow:wf_1'], [OTHER]: ['toolu_c'] } })

    expect(value(await again('claudeHome.showSubagents', { projectId: PROJECT_ID, sessionId: S9 }))).toEqual({ sessions: { [OTHER]: ['toolu_c'] } })
    expect(new HiddenSubagents(dataDir).list(PROJECT_ID)).toEqual({ sessions: { [OTHER]: ['toolu_c'] } })
    // Nothing was written under the Claude home.
    expect(await snapshot(home)).toEqual(before)
  })

  it('refuses a Session id that could leave its folder, and an empty or oversized list of ids', async () => {
    const data = await tempDir()
    const call = await ipcOver(registryOver(FIXTURE), readerWith(), new HiddenSubagents((projectId) => join(data, projectId)))
    expect((await call('claudeHome.hideSubagents', { projectId: PROJECT_ID, sessionId: '../x', ids: ['a'] })).ok).toBe(false)
    expect((await call('claudeHome.hideSubagents', { projectId: PROJECT_ID, sessionId: S9, ids: [] })).ok).toBe(false)
    expect((await call('claudeHome.hideSubagents', { projectId: PROJECT_ID, sessionId: S9, ids: ['x'.repeat(201)] })).ok).toBe(false)
    expect(await readdir(data)).toEqual([])
  })
})

describe('transcriptSessionId (worfy-windows ticket 08)', () => {
  it('is the transcript file name without .jsonl, the path split at `/` or `\\`', () => {
    expect(transcriptSessionId('/h/projects/p/abc-1.jsonl')).toBe('abc-1')
    expect(transcriptSessionId('C:\\Users\\u\\.claude\\projects\\C--p\\abc-1.jsonl')).toBe('abc-1')
    expect(transcriptSessionId('C:/Users/u/.claude/projects/C--p/abc-1.jsonl')).toBe('abc-1')
    expect(transcriptSessionId('abc-1.jsonl')).toBe('abc-1')
  })
})

describe('processState', () => {
  /**
   * This test's own process and its start time, as `ps` prints it for `procStart`; on Windows the
   * FILETIME of the start, asked by the test's own command (claude-home-fixture.ts).
   */
  const self = () => ({
    pid: process.pid,
    procStart: WINDOWS ? windowsProcStart(process.pid) : execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } }).toString().trim(),
  })

  /**
   * Runs `work` with no `ps` on PATH. Not for Windows: there the start time is read by the
   * powershell.exe under SystemRoot, started by its full path, and a time once read is kept for
   * 30 s (registry.ts), so an empty PATH does not stop the check. A start time that cannot be read
   * on Windows is covered with the reader replaced: 'is alive when the start of the running pid
   * is procStart, gone when it is another, unknown when it cannot be read' in
   * claude-home-registry.test.ts, and 'does not call a Session closed when whether its process
   * runs cannot be told' above.
   */
  async function withoutPs<T>(work: () => Promise<T>): Promise<T> {
    const path = process.env.PATH
    process.env.PATH = '/nonexistent'
    try {
      return await work()
    } finally {
      process.env.PATH = path
    }
  }

  it('tells a running process, one that is gone, a reused pid, and a ps that could not answer', async () => {
    const { pid, procStart } = self()
    expect(await processState(pid, procStart)).toBe('alive')
    expect(await processState(pid, undefined)).toBe('alive')
    expect(await processState(pid, 'Thu Jan  1 00:00:00 1970')).toBe('gone')
    expect(await processState(2_147_483_000, procStart)).toBe('gone')
    expect(await processState(0, procStart)).toBe('gone')
    if (!WINDOWS) {
      expect(await withoutPs(() => processState(pid, procStart))).toBe('unknown')
      // The registry's own check keeps its answer: a ps that could not answer is not running there.
      expect(await withoutPs(() => processAlive(pid, procStart))).toBe(false)
    }
    expect(await processAlive(pid, procStart)).toBe(true)
  })

  it('keeps a Subagent of a Session running when ps cannot tell whether the Session runs, and cuts it off when the process is gone', async () => {
    const home = await copyOfFixture()
    const { pid, procStart } = self()
    await mkdir(join(home, 'sessions'), { recursive: true })
    const entry = join(home, 'sessions', `${pid}.json`)
    await writeFile(entry, JSON.stringify({ pid, sessionId: S9, cwd: STALE, procStart }))
    const read = async () => statuses(await ask(await ipcOver(registryOver(home), new SubagentReader())))
    expect(await read()).toEqual([
      [A, 'done'],
      [B, 'running'],
    ])
    if (!WINDOWS) {
      expect(await withoutPs(read)).toEqual([
        [A, 'done'],
        [B, 'running'],
      ])
    }
    await writeFile(entry, JSON.stringify({ pid, sessionId: S9, cwd: STALE, procStart: 'Thu Jan  1 00:00:00 1970' }))
    expect(await read()).toEqual([
      [A, 'done'],
      [B, 'error'],
    ])
  })
})

describe('claudeHome.subagentTranscript', () => {
  it('sends every event of the Subagent transcript, though each record is a sidechain one', async () => {
    const call = await ipcOver(registryOver(FIXTURE))
    const answer = value<TranscriptAnswer>(await call('claudeHome.subagentTranscript', { projectRoot: AGENTS, sessionId: S7, agentId: 'a5000000000000286' }))
    expect(answer.found).toBe(true)
    expect(answer.events.map((event) => event.type)).toEqual(['notice', 'text'])
    expect(answer.events[1]).toMatchObject({ type: 'text', text: '**REJECTED**\n\nSynthetic finding: the test does not fail without the fix.' })
    // Each event carries the time of its record, so the rows show when they were written (ticket 14).
    expect(answer.events.map((event) => event.at)).toEqual([Date.parse('2026-06-01T10:00:11.000Z'), Date.parse('2026-06-01T10:00:59.000Z')])
  })

  it('answers found: false for an unknown Subagent and for a file outside subagents/', async () => {
    const call = await ipcOver(registryOver(FIXTURE))
    const found = async (projectRoot: string, sessionId: string, agentId: string) =>
      value<TranscriptAnswer>(await call('claudeHome.subagentTranscript', { projectRoot, sessionId, agentId })).found
    // Both Sessions are found and have Subagents, so `false` below is about the Subagent or the
    // file, not about a Session that is not there.
    expect(await found(AGENTS, S7, 'a3000000000000286')).toBe(true)
    expect(await found(DEMO, S5, 'a1000000000000286')).toBe(true)
    expect(await found(AGENTS, S7, 'a9999999999999999')).toBe(false)
    // A Subagent of another Project's Session is not served through this Project's root: S7 is a
    // Session of AGENTS, and its Subagent a3… is found there (above), but not through DEMO.
    expect(await found(DEMO, S7, 'a3000000000000286')).toBe(false)
    // A Subagent of another Session: its file exists, but not in the subagents/ of this Session.
    expect(await found(DEMO, S5, 'a3000000000000286')).toBe(false)
    // The Session's own id names no Subagent: the reader looks only for subagents/agent-<id>.jsonl.
    // (Ids that would lead out of subagents/ are refused by the schema: "rejects %s with input %j".)
    expect(await found(AGENTS, S7, S7)).toBe(false)
  })
})

// Ticket worfy-daily/17, ADR-0035: the agents of a workflow script, in `subagents/workflows/wf_*/`.
describe('claudeHome.subagents: Subagents of workflow scripts', () => {
  const WORKFLOW = '/Users/test/projects/workflow'
  const S12 = '12121212-1212-4121-8121-121212121212'
  const S12_DIR = join('projects', projectDir(WORKFLOW))
  const RUN_DIR = join(S12_DIR, S12, 'subagents', 'workflows', 'wf_0a1b2c3d-4e5')
  const IMPL = 'a8100000000000260'
  const askWorkflow = async (call: Awaited<ReturnType<typeof ipcOver>>) => value<SubagentsAnswer>(await call('claudeHome.subagents', { projectRoot: WORKFLOW, sessionId: S12 }))

  it('puts the agents of a workflow run under its Workflow call', async () => {
    const call = await ipcOver(registryOver(FIXTURE))
    const answer = await askWorkflow(call)
    expect(answer.files.map((file) => [file.agentId, file.workflow?.runId, file.workflow?.label ?? null])).toEqual([
      [IMPL, 'wf_0a1b2c3d-4e5', 'impl:03'],
      ['a8200000000000260', 'wf_0a1b2c3d-4e5', null],
      ['a8300000000000260', 'wf_0a1b2c3d-4e5', 'scout:03'],
    ])
    expect(flattenSubagents(buildSubagentTree(answer)).map(({ name, subagentType, status, depth }) => ({ name, subagentType, status, depth }))).toEqual([
      { name: 'wave-03', subagentType: 'workflow', status: 'done', depth: 1 },
      { name: 'impl:03', subagentType: 'workflow-subagent', status: 'done', depth: 2 },
      { name: null, subagentType: 'workflow-subagent', status: 'error', depth: 2 },
      { name: 'scout:03', subagentType: 'Explore', status: 'done', depth: 2 },
    ])
  })

  it('opens the transcript of a workflow agent, and of no file outside the run folders', async () => {
    const call = await ipcOver(registryOver(FIXTURE))
    const answer = value<TranscriptAnswer>(await call('claudeHome.subagentTranscript', { projectRoot: WORKFLOW, sessionId: S12, agentId: IMPL }))
    expect(answer.found).toBe(true)
    expect(answer.events.map((event) => event.type)).toEqual(['notice', 'tool_use', 'tool_result'])
    expect(value<TranscriptAnswer>(await call('claudeHome.subagentTranscript', { projectRoot: WORKFLOW, sessionId: S12, agentId: 'journal' })).found).toBe(false)
  })

  it('reads again only what was appended to a workflow agent transcript', async () => {
    const home = await copyOfFixture()
    const implementer = join(home, RUN_DIR, `agent-${IMPL}.jsonl`)
    const [first, ...rest] = (await readFile(implementer, 'utf8')).split('\n').filter((line) => line !== '')
    // A long-running agent: 400 KB of answers before its last records.
    const filler = JSON.stringify({ type: 'assistant', isSidechain: true, agentId: IMPL, timestamp: '2026-09-12T10:01:00.000Z', message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: 'x'.repeat(4000) }], stop_reason: 'tool_use' } })
    await writeFile(implementer, `${[first!, ...Array.from({ length: 100 }, () => filler), ...rest.slice(0, -1)].join('\n')}\n`)
    const reader = readerWith()
    const transcript = join(home, S12_DIR, `${S12}.jsonl`)
    await reader.session(transcript)
    const firstRead = reader.bytesRead
    expect(firstRead).toBeGreaterThan(400_000)
    const last = `${rest.at(-1)!}\n`
    await appendFile(implementer, last)
    const { files } = await reader.session(transcript)
    const again = reader.bytesRead - firstRead
    // The appended line, and one byte per other file to check it was not rewritten in place.
    expect(again).toBeGreaterThanOrEqual(Buffer.byteLength(last))
    expect(again).toBeLessThan(Buffer.byteLength(last) + 16)
    expect(files.find((file) => file.agentId === IMPL)?.lastAt).toBe(Date.parse('2026-09-12T10:04:00.000Z'))
  })

  it('keeps an agent running while its run and its Session run, and ends it by its journal record', async () => {
    const home = await copyOfFixture()
    const transcript = join(home, S12_DIR, `${S12}.jsonl`)
    const lines = (await readFile(transcript, 'utf8')).split('\n').filter((line) => line !== '')
    await writeFile(transcript, `${lines.filter((line) => !line.includes('task-notification') && !line.includes('Wave 3 is merged')).join('\n')}\n`)
    const journal = join(home, RUN_DIR, 'journal.jsonl')
    const records = (await readFile(journal, 'utf8')).split('\n').filter((line) => line !== '')
    await writeFile(journal, `${records.slice(0, 5).join('\n')}\n`)
    await register(home, 41212, S12, WORKFLOW)
    const call = await ipcOver(registryOver(home), readerWith(async (pid) => pid === 41212))
    const running = flattenSubagents(buildSubagentTree(await askWorkflow(call))).map(({ name, status }) => [name, status])
    expect(running).toEqual([
      ['wave-03', 'running'],
      ['impl:03', 'done'],
      [null, 'running'],
      ['scout:03', 'running'],
    ])
    await appendFile(journal, `${records.slice(5).join('\n')}\n`)
    const after = flattenSubagents(buildSubagentTree(await askWorkflow(call))).map(({ name, status }) => [name, status])
    expect(after).toEqual([
      ['wave-03', 'running'],
      ['impl:03', 'done'],
      [null, 'error'],
      ['scout:03', 'done'],
    ])
  })

  it('reads workflow runs without writing anything under the Claude home', async () => {
    const home = await copyOfFixture()
    const before = await snapshot(home)
    const call = await ipcOver(registryOver(home))
    expect((await askWorkflow(call)).files).toHaveLength(3)
    expect(value<TranscriptAnswer>(await call('claudeHome.subagentTranscript', { projectRoot: WORKFLOW, sessionId: S12, agentId: IMPL })).found).toBe(true)
    expect(await snapshot(home)).toStrictEqual(before)
  })

  it('goes no deeper than subagents/workflows/wf_*/: a folder inside a run, or a folder not named wf_*, is not read', async () => {
    const home = await copyOfFixture()
    const run = join(home, RUN_DIR)
    await mkdir(join(run, 'deeper'), { recursive: true })
    await cp(join(run, `agent-${IMPL}.jsonl`), join(run, 'deeper', 'agent-a8900000000000260.jsonl'))
    await mkdir(join(home, S12_DIR, S12, 'subagents', 'workflows', 'other'), { recursive: true })
    await cp(join(run, `agent-${IMPL}.jsonl`), join(home, S12_DIR, S12, 'subagents', 'workflows', 'other', 'agent-a8800000000000260.jsonl'))
    const call = await ipcOver(registryOver(home))
    expect((await askWorkflow(call)).files.map((file) => file.agentId)).toEqual([IMPL, 'a8200000000000260', 'a8300000000000260'])
  })
})

describe('reading a large Session', () => {
  it('reads 24 Subagents of 400 KB each within a second', async () => {
    const home = await tempDir()
    const dir = join(home, S7_DIR)
    const sessionId = '88888888-8888-4888-8888-888888888888'
    const folder = join(dir, sessionId, 'subagents')
    await mkdir(folder, { recursive: true })
    const record = (fields: Record<string, unknown>) => JSON.stringify({ cwd: AGENTS, sessionId, version: '2.1.286', ...fields })
    const main: string[] = [record({ type: 'user', timestamp: '2026-06-01T09:00:00.000Z', message: { role: 'user', content: 'Synthetic request.' } })]
    const filler = 'x'.repeat(2000)
    for (let n = 0; n < 24; n += 1) {
      const agentId = `a${String(n).padStart(16, '0')}`
      const toolUseId = `toolu_bulk_${n}`
      main.push(record({ type: 'assistant', timestamp: '2026-06-01T09:00:01.000Z', message: { model: 'm', content: [{ type: 'tool_use', id: toolUseId, name: 'Agent', input: { subagent_type: 'scout', run_in_background: true } }] } }))
      main.push(record({ type: 'user', timestamp: '2026-06-01T09:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'Async agent launched successfully.' }] }, toolUseResult: { status: 'async_launched', agentId } }))
      await writeFile(join(folder, `agent-${agentId}.meta.json`), JSON.stringify({ agentType: 'scout', toolUseId, spawnDepth: 1, requestShape: 'background' }))
      const body: string[] = []
      for (let size = 0; size < 400 * 1024; size += filler.length + 200) {
        body.push(record({ type: 'assistant', isSidechain: true, agentId, timestamp: '2026-06-01T09:01:00.000Z', message: { model: 'm', content: [{ type: 'text', text: filler }], stop_reason: 'tool_use' } }))
      }
      await writeFile(join(folder, `agent-${agentId}.jsonl`), `${body.join('\n')}\n`)
    }
    await writeFile(join(dir, `${sessionId}.jsonl`), `${main.join('\n')}\n`)
    const call = await ipcOver(registryOver(home))
    const started = performance.now()
    const answer = value<SubagentsAnswer>(await call('claudeHome.subagents', { projectRoot: AGENTS, sessionId }))
    const tree = buildSubagentTree(answer)
    const elapsed = performance.now() - started
    console.info(`[subagents] ${tree.length} Subagents (${answer.files.length} files, 24 × 400 KB) read and built in ${elapsed.toFixed(0)} ms`)
    expect(tree).toHaveLength(24)
    expect(tree.every((info) => info.status === 'running')).toBe(true)
    expect(elapsed).toBeLessThan(1000)
  })
})
