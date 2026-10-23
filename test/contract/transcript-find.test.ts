// `claudeHome.transcriptFind` (worfy-ui ticket 26) through the real handler of main, on a transcript
// of 40 MB (test/big-transcript.ts) in a temporary Claude home: the lines of the matches before
// `before`, a Subagent's own file, a missing Session, the file left as it was — and how long the
// search of the whole file takes, with the main process's event loop getting its turns meanwhile.
import { mkdir, mkdtemp, open, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ClaudeHomeRegistry, projectDirName } from '../../src/main/claude-home/registry'
import { ClaudeHomeSubscriptions, claudeHomeHandlers } from '../../src/main/ipc/claude-home'
import { appUrlMatcher, registerIpc, type IpcMainLike } from '../../src/main/ipc/index'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'
import { writeBigTranscript } from '../big-transcript'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
type Found = { found: boolean; hits: { offset: number; count: number }[]; total: number; skipped: number }

const SESSION = 'f1d00000-0000-4000-8000-000000000026'
const MARKED = new Set([3, 1000])

let base: string
let project: string
let file: string
let size: number
let turns: number
let call: (channel: string, input: unknown) => Promise<IpcResult<unknown>>
let close: () => Promise<void>

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'worfy-transcript-find-')))
  const home = join(base, 'claude')
  project = join(base, 'project')
  await mkdir(project, { recursive: true })
  const dir = join(home, 'projects', projectDirName(project))
  await mkdir(join(dir, SESSION, 'subagents'), { recursive: true })
  file = join(dir, `${SESSION}.jsonl`)
  // Two answers say «zebra»: one near the start, one in the middle of the file.
  ;({ size, turns } = writeBigTranscript(file, { sessionId: SESSION, cwd: project, answer: (turn) => (MARKED.has(turn) ? `Answer number ${turn}: the zebra is here` : `Answer number ${turn}`) }))
  await writeFile(
    join(dir, SESSION, 'subagents', 'agent-a1.jsonl'),
    `${JSON.stringify({ type: 'user', isSidechain: true, uuid: 'u', message: { role: 'user', content: 'zebra for the Subagent' } })}\n`,
  )
  const registry = new ClaudeHomeRegistry({ home, listWorktrees: async () => [], isAlive: async () => false })
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) }
  const subscriptions = new ClaudeHomeSubscriptions(registry, new Set())
  close = () => subscriptions.closeAll()
  await registerIpc(ipc, { modules: { './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  call = async (channel, input) => {
    const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    return (await listener({ senderFrame: { url: APP_URL } } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
}, 120_000)

afterAll(async () => {
  await close?.()
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** The line of the file that starts at byte `offset`. */
async function lineAt(offset: number): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(512)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
    return buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0] ?? ''
  } finally {
    await handle.close()
  }
}

/** Runs `work` and counts the turns the event loop got meanwhile. */
async function withTurns<T>(work: () => Promise<T>): Promise<{ value: T; turns: number; ms: number }> {
  let counted = 0
  let ticking = true
  const tick = () => {
    if (!ticking) return
    counted += 1
    setImmediate(tick)
  }
  setImmediate(tick)
  const started = performance.now()
  const value = await work()
  const ms = performance.now() - started
  ticking = false
  return { value, turns: counted, ms }
}

describe('claudeHome.transcriptFind', () => {
  it('finds the lines of the matches in a 40 MB transcript, and the event loop gets its turns meanwhile', async () => {
    const before = (await stat(file)).mtimeMs
    const { value, turns: loop, ms } = await withTurns(() => call('claudeHome.transcriptFind', { projectRoot: project, sessionId: SESSION, query: 'ZEBRA', before: size }))
    expect(value.ok).toBe(true)
    const found = (value as { value: Found }).value
    expect(found.found).toBe(true)
    expect(found.total).toBe(2)
    expect(found.skipped).toBe(0)
    expect(found.hits.map((hit) => hit.count)).toEqual([1, 1])
    expect(await lineAt(found.hits[0]!.offset)).toContain('Answer number 3: the zebra')
    expect(await lineAt(found.hits[1]!.offset)).toContain('Answer number 1000: the zebra')
    // A slice of about 1 MiB between two turns: 40 of them for 40 MB.
    expect(loop).toBeGreaterThanOrEqual(30)
    expect((await stat(file)).mtimeMs).toBe(before)
    console.info(`[transcript-find] ${(size / 1024 / 1024).toFixed(1)} MB, ${turns} turns: «zebra» in ${ms.toFixed(0)} ms, ${loop} turns of the event loop`)

    // Up to the line of the second match: only the first one is before it.
    const middle = found.hits[1]!.offset
    const part = (await call('claudeHome.transcriptFind', { projectRoot: project, sessionId: SESSION, query: 'zebra', before: middle })) as { ok: true; value: Found }
    expect(part.value.hits).toEqual([found.hits[0]])
  })

  it('parses every line when the query is in every raw line, and still gives the event loop its turns', async () => {
    // «xx» is in every tool result: no line is passed over unparsed; the results are not searched.
    const { value, turns: loop, ms } = await withTurns(() => call('claudeHome.transcriptFind', { projectRoot: project, sessionId: SESSION, query: 'xx', before: size }))
    expect((value as { ok: true; value: Found }).value.total).toBe(0)
    expect(loop).toBeGreaterThanOrEqual(30)
    console.info(`[transcript-find] ${(size / 1024 / 1024).toFixed(1)} MB, every line parsed: ${ms.toFixed(0)} ms, ${loop} turns of the event loop`)
  })

  it("searches a Subagent's own file with agentId, and answers found: false for a Session with no transcript", async () => {
    const subagent = (await call('claudeHome.transcriptFind', { projectRoot: project, sessionId: SESSION, agentId: 'a1', query: 'zebra', before: 1_000_000 })) as { ok: true; value: Found }
    expect(subagent.value).toEqual({ found: true, hits: [{ offset: 0, count: 1 }], total: 1, skipped: 0 })
    const missing = await call('claudeHome.transcriptFind', { projectRoot: project, sessionId: '00000000-0000-4000-8000-000000000000', query: 'zebra', before: 10 })
    expect(missing).toEqual({ ok: true, value: { found: false, hits: [], total: 0, skipped: 0 } })
  })
})
