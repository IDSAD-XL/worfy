// The Subagent channels of the `claudeHome` domain (ticket 15): `claudeHome.subagents` (what a
// Session's transcript and its `subagents/` folder say) and `claudeHome.subagentTranscript` (one
// Subagent's own transcript), over the synthetic Claude home of ticket 09 and a copy of it. The
// Claude home is only read: a snapshot of every file before and after proves it.
import { createHash } from 'node:crypto'
import { appendFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeHomeRegistry } from '../../src/main/claude-home/registry'
import { SubagentReader } from '../../src/main/claude-home/subagents'
import { ClaudeHomeSubscriptions, claudeHomeHandlers } from '../../src/main/ipc/claude-home'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { AgentEvent } from '../../src/shared/agent/events'
import { buildSubagentTree, flattenSubagents, type SubagentFile, type SubagentSignal } from '../../src/shared/transcript/subagents'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'claude-home')
const INDEX_HTML = '/Applications/worfy.app/Contents/Resources/app/out/renderer/index.html'
const AGENTS = '/Users/test/projects/agents'
const DEMO = '/Users/test/projects/demo'
const S5 = '55555555-5555-4555-8555-555555555555'
const S7 = '77777777-7777-4777-8777-777777777777'
const S7_DIR = join('projects', '-Users-test-projects-agents')

const temps: string[] = []
const closers: (() => Promise<void>)[] = []

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
  const home = join(await tempDir(), 'claude')
  await cp(FIXTURE, home, { recursive: true })
  return home
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

async function ipcOver(registry: ClaudeHomeRegistry, reader = new SubagentReader()) {
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  const subscriptions = new ClaudeHomeSubscriptions(registry)
  closers.push(() => subscriptions.closeAll())
  await registerIpc(ipc, { modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions, reader) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  return async (channel: string, input: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    return (await listener({ senderFrame: { url: `file://${INDEX_HTML}` } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
}

type SubagentsAnswer = { found: boolean; signals: SubagentSignal[]; files: SubagentFile[] }
type TranscriptAnswer = { found: boolean; events: AgentEvent[]; more: boolean }

function value<T>(result: IpcResult<unknown>): T {
  if (!result.ok) throw new Error(`call failed: ${result.error}`)
  return result.value as T
}

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
    expect(value(await call('claudeHome.subagents', { projectRoot: DEMO, sessionId: '11111111-1111-4111-8111-111111111111' }))).toStrictEqual({ found: true, signals: [], files: [] })
  })

  it('passes on the contract fields only, whatever the reader returns', async () => {
    const reader = new SubagentReader()
    const call = await ipcOver(registryOver(FIXTURE), reader)
    const plain = await call('claudeHome.subagents', { projectRoot: AGENTS, sessionId: S7 })
    // A reader that leaks raw fields of the files (a prompt, an output path) must not reach the renderer.
    vi.spyOn(reader, 'session').mockImplementation(async (path) => {
      const real = await SubagentReader.prototype.session.call(new SubagentReader(), path)
      return {
        signals: real.signals.map((signal) => ({ ...signal, prompt: 'Synthetic secret brief.' })),
        files: real.files.map((file) => ({ ...file, outputFile: '/Users/test/tmp/out', meta: { ...file.meta, prompt: 'Synthetic secret brief.' } })),
      }
    })
    const leaky = await call('claudeHome.subagents', { projectRoot: AGENTS, sessionId: S7, extra: true })
    expect(JSON.stringify(leaky)).not.toMatch(/Synthetic secret brief|outputFile/)
    expect(leaky).toStrictEqual(plain)
  })

  it('refuses an answer of the wrong shape instead of passing it on', async () => {
    const reader = new SubagentReader()
    const call = await ipcOver(registryOver(FIXTURE), reader)
    vi.spyOn(reader, 'session').mockResolvedValue({ signals: [{ kind: 'call', toolUseId: 7 }] as unknown as SubagentSignal[], files: [] })
    const result = await call('claudeHome.subagents', { projectRoot: AGENTS, sessionId: S7 })
    expect(result.ok).toBe(false)
  })

  it('follows a Session as it is written: a task-notification turns the running Subagent done', async () => {
    const home = await copyOfFixture()
    const transcript = join(home, S7_DIR, `${S7}.jsonl`)
    const lines = (await readFile(transcript, 'utf8')).split('\n').filter((line) => line !== '')
    const notification = lines.findIndex((line) => line.includes('<task-notification>'))
    await writeFile(transcript, `${lines.slice(0, notification).join('\n')}\n`)
    const call = await ipcOver(registryOver(home))
    const before = buildSubagentTree(value<SubagentsAnswer>(await call('claudeHome.subagents', { projectRoot: AGENTS, sessionId: S7 })))
    expect(before[0]).toMatchObject({ name: 'impl-08', status: 'done', summary: 'Synthetic implementer report for 08.' })
    // The implementer's file already ends its turn; a file still being written keeps it running.
    const implementer = join(home, S7_DIR, S7, 'subagents', 'agent-a3000000000000286.jsonl')
    const implementerLines = (await readFile(implementer, 'utf8')).split('\n').filter((line) => line !== '')
    await writeFile(implementer, `${implementerLines.slice(0, -1).join('\n')}\n`)
    const fresh = await ipcOver(registryOver(home))
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
    ] as const) {
      expect(value<SubagentsAnswer>(await call('claudeHome.subagents', { projectRoot, sessionId })).found).toBe(true)
    }
    for (const agentId of ['a3000000000000286', 'a4000000000000286', 'a5000000000000286']) {
      expect(value<TranscriptAnswer>(await call('claudeHome.subagentTranscript', { projectRoot: AGENTS, sessionId: S7, agentId })).found).toBe(true)
    }
    expect(await snapshot(home)).toStrictEqual(before)
  })
})

describe('claudeHome.subagentTranscript', () => {
  it('sends every event of the Subagent transcript, though each record is a sidechain one', async () => {
    const call = await ipcOver(registryOver(FIXTURE))
    const answer = value<TranscriptAnswer>(await call('claudeHome.subagentTranscript', { projectRoot: AGENTS, sessionId: S7, agentId: 'a5000000000000286' }))
    expect(answer.found).toBe(true)
    expect(answer.events.map((event) => event.type)).toEqual(['notice', 'text'])
    expect(answer.events[1]).toMatchObject({ type: 'text', text: '**REJECTED**\n\nSynthetic finding: the test does not fail without the fix.' })
  })

  it('answers found: false for an unknown Subagent and for a file outside subagents/', async () => {
    const call = await ipcOver(registryOver(FIXTURE))
    expect(value<TranscriptAnswer>(await call('claudeHome.subagentTranscript', { projectRoot: AGENTS, sessionId: S7, agentId: 'a9999999999999999' })).found).toBe(false)
    // The Session's own transcript is not a Subagent: no id leads out of subagents/.
    expect(value<TranscriptAnswer>(await call('claudeHome.subagentTranscript', { projectRoot: DEMO, sessionId: S7, agentId: 'a3000000000000286' })).found).toBe(false)
  })
})

describe('reading a large Session', () => {
  it('reads 24 Subagents of 400 KB each within a second', async () => {
    const home = await tempDir()
    const dir = join(home, 'projects', '-Users-test-projects-agents')
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
