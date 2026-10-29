// `claudeHome.subagents` over a real link connection (worfy-link ticket 33, part 4). The answer
// carries the signals of every Subagent of a Session in one piece; a Session with a large tree of
// Subagents made it bigger than the 16 MiB a link connection carries (LINK_MAX_PAYLOAD), and the
// Linked machine got an error instead of the tree. B now shortens the texts of an answer to a
// Linked machine until it fits, and says so with `truncated`; the tree itself stays whole.
//
// B's handlers are the real ones over a stand-in registry and Subagent reader: no Claude home on
// disk, no git.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeHomeRegistry } from '../../src/main/claude-home/registry'
import type { SubagentReader } from '../../src/main/claude-home/subagents'
import type { ModuleLoader } from '../../src/main/ipc/index'
import { LINK_MAX_PAYLOAD } from '../../src/main/link/messages'
import { buildSubagentTree, type SubagentFile, type SubagentSignal } from '../../src/shared/transcript/subagents'
import { LinkBench, type BenchMachine } from './link-bench'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

const env = await vi.hoisted(async () => {
  // Before any module of main is imported: claude-home.ts makes its default registry at import.
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-33-subagents-')))
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  process.env.WORFY_CLAUDE_HOME = path.join(scratch, 'claude-home')
  return { scratch }
})

vi.mock('electron', () => ({
  app: { on: () => undefined, getVersion: () => '0.2.0', isPackaged: false, getAppPath: () => '/' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
}))

const { addClient } = await import('../../src/main/broadcast')
const { claudeHomeHandlers, ClaudeHomeSubscriptions } = await import('../../src/main/ipc/claude-home')

const SESSION = '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT = join(env.scratch, 'project')
mkdirSync(PROJECT, { recursive: true })
const projects = () => [{ path: PROJECT }]

/** As long as a result text may be (TEXT_MAX of src/shared/transcript/subagents.ts). */
const LONG_TEXT = `First line of the answer\n${'x'.repeat(4000 - 25)}`

/**
 * A Session that called the Agent tool `calls` times, every Subagent answering with a text of the
 * longest kind; a third of the Subagents also have a file of their own with such a text.
 */
function bigSession(calls: number): { signals: SubagentSignal[]; files: SubagentFile[] } {
  const signals: SubagentSignal[] = []
  const files: SubagentFile[] = []
  for (let n = 0; n < calls; n += 1) {
    const toolUseId = `toolu_${n}`
    const agentId = `a${n}`
    signals.push({ kind: 'call', toolUseId, at: n, parentToolUseId: null, subagentType: 'general-purpose', description: `Task ${n}`, name: null, model: null, background: false })
    signals.push({ kind: 'started', agentId, toolUseId, at: n, subagentType: 'general-purpose', description: `Task ${n}` })
    signals.push({ kind: 'result', toolUseId, at: n + 1, text: LONG_TEXT, isError: false, launched: false })
    signals.push({ kind: 'finished', agentId, toolUseId, at: n + 1, status: 'completed', summary: `Task ${n} done`, result: LONG_TEXT })
    if (n % 3 === 0) {
      files.push({ agentId, meta: null, transcript: true, firstAt: n, lastAt: n + 1, model: 'claude', finalText: LONG_TEXT, ended: true, signals: [], workflow: null })
    }
  }
  return { signals, files }
}

let session = bigSession(1)

const registry = {
  transcriptPath: async () => join(env.scratch, 'claude-home', 'projects', 'p', `${SESSION}.jsonl`),
  worktrees: async () => [PROJECT],
} as unknown as ClaudeHomeRegistry
const reader = { session: async () => session } as unknown as SubagentReader
const subscriptions = new ClaudeHomeSubscriptions(registry, new Set())

const modules: Record<string, ModuleLoader> = {
  './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default),
  './claude-home.ts': async () => claudeHomeHandlers(registry, subscriptions, reader, projects),
}

let bench: LinkBench | undefined
let a: BenchMachine
let bId: string

beforeEach(async () => {
  bench = new LinkBench({ ipcModules: modules, addClient })
  a = await bench.machine('alpha')
  const b = await bench.machine('beta')
  await bench.link(a, b)
  bId = b.service.machine.id
  b.service.settings.set({ projectsAccess: true, machines: { [a.service.machine.id]: 'read' } })
  await a.service.connect(bId)
})

afterEach(async () => {
  const current = bench
  bench = undefined
  await current?.close()
  await subscriptions.closeAll()
})

afterAll(() => {
  removeTestTree(env.scratch)
})

interface SubagentsAnswer {
  found: boolean
  signals: SubagentSignal[]
  files: SubagentFile[]
  truncated?: boolean
}

const ask = () => a.service.call(bId, 'claudeHome.subagents', { projectRoot: PROJECT, sessionId: SESSION })

describe('claudeHome.subagents over a link', () => {
  it('a Session whose answer is larger than a link carries gives the whole tree, its texts shortened and flagged, not an error', async () => {
    session = bigSession(2000)
    // The answer as it is would not fit: this is the case the link used to refuse.
    expect(Buffer.byteLength(JSON.stringify({ found: true, ...session }))).toBeGreaterThan(LINK_MAX_PAYLOAD)
    const result = await ask()
    if (!result.ok) throw new Error(`the call failed: ${result.error}`)
    const answer = result.value as SubagentsAnswer
    expect(answer.truncated).toBe(true)
    expect(answer.signals).toHaveLength(session.signals.length)
    expect(answer.files).toHaveLength(session.files.length)
    // The tree has every Subagent, ended, with the first line of its answer.
    const tree = buildSubagentTree(answer)
    expect(tree).toHaveLength(2000)
    expect(tree.every((info) => info.status !== 'running')).toBe(true)
    const texts = answer.signals.flatMap((signal) => (signal.kind === 'result' ? [signal.text] : []))
    expect(texts.every((text) => text.startsWith('First line of the answer'))).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(answer))).toBeLessThanOrEqual(LINK_MAX_PAYLOAD)
  }, ms(60_000))

  it('an answer that fits goes out as it is, without the flag', async () => {
    session = bigSession(20)
    const result = await ask()
    if (!result.ok) throw new Error(`the call failed: ${result.error}`)
    expect(result.value).toStrictEqual({ found: true, ...session })
  })
})

describe('fitSubagentsAnswer', () => {
  const sizeOf = (answer: unknown) => Buffer.byteLength(JSON.stringify(answer))

  it('cuts the texts no further than needed: 1000 characters when that fits', async () => {
    const { fitSubagentsAnswer } = await import('../../src/main/ipc/claude-home')
    const answer = { found: true, ...bigSession(10) }
    const fitted = fitSubagentsAnswer(answer, sizeOf(answer) - 1)
    expect(fitted.truncated).toBe(true)
    expect(fitted.signals).toHaveLength(answer.signals.length)
    const result = fitted.signals.find((signal) => signal.kind === 'result')
    expect(result?.kind === 'result' ? result.text.length : -1).toBe(1000)
    expect(fitted.files.every((file) => file.finalText?.length === 1000)).toBe(true)
  })

  it('cut to the last length, each text keeps the line the tree shows, so every Subagent keeps its one-line summary', async () => {
    const { fitSubagentsAnswer } = await import('../../src/main/ipc/claude-home')
    const answer = { found: true, ...bigSession(40) }
    // Too small for 200 characters a text, large enough for one line of each.
    expect(fitSubagentsAnswer(answer, Number.MAX_SAFE_INTEGER)).toBe(answer)
    const fitted = fitSubagentsAnswer(answer, sizeOf(answer) / 12)
    expect(fitted.signals).toHaveLength(answer.signals.length)
    const finished = fitted.signals.filter((signal) => signal.kind === 'finished')
    expect(finished.every((signal) => signal.kind === 'finished' && signal.result === 'First line of the answer')).toBe(true)
    expect(fitted.files.every((file) => file.finalText === 'First line of the answer')).toBe(true)
    const tree = buildSubagentTree(fitted)
    expect(tree).toHaveLength(40)
    expect(tree.map((info) => info.summary)).toStrictEqual(buildSubagentTree(answer).map((info) => info.summary))
    expect(tree.every((info) => info.summary === 'First line of the answer')).toBe(true)
  })

  it('keeps the start of the Session process when it cuts an answer (ADR-0085)', async () => {
    const { fitSubagentsAnswer } = await import('../../src/main/ipc/claude-home')
    const answer = { found: true, ...bigSession(10), processStartedAt: 1_000 }
    expect(fitSubagentsAnswer(answer, sizeOf(answer) - 1)).toMatchObject({ truncated: true, processStartedAt: 1_000 })
    expect(fitSubagentsAnswer(answer, 10)).toStrictEqual({ found: true, signals: [], files: [], truncated: true, processStartedAt: 1_000 })
  })

  it('with one line of each text still too large, leaves out the oldest signals and files until it fits, and never loops on one left', async () => {
    const { fitSubagentsAnswer } = await import('../../src/main/ipc/claude-home')
    const answer = { found: true, ...bigSession(64) }
    const limit = 4000
    const fitted = fitSubagentsAnswer(answer, limit)
    expect(sizeOf(fitted)).toBeLessThanOrEqual(limit)
    expect(fitted.signals.length).toBeGreaterThan(0)
    expect(fitted.signals.length).toBeLessThan(answer.signals.length)
    // The newest are kept.
    expect(fitted.signals.at(-1)).toStrictEqual({ ...answer.signals.at(-1), result: 'First line of the answer' })
    // A limit nothing fits in ends with empty lists rather than a loop.
    expect(fitSubagentsAnswer(answer, 10)).toStrictEqual({ found: true, signals: [], files: [], truncated: true })
  })
})
