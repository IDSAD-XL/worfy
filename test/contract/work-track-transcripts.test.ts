// The reader of the transcripts for Work track (src/main/work-track/transcripts.ts; worfy-work-track
// ticket 05): every Session of a Project on this Machine over a period — those on the Canvas, the
// hidden ones and those with no Node — with their turns and Subagents, from the Claude home's files
// whose modification time lies in the period, and the threads of Codex. Only names reach the facts,
// never the text of a prompt or an answer. A file read once is not read again while its modification
// time and size stay the same, and nothing is written to the Claude home (ADR-0005).
//
// The fixture (test/fixtures/work-track/claude-home/) is synthetic: the Project `/work/acme/shop`,
// Session A on the Canvas (an implementer with a nested Subagent, a background verifier that
// rejects), Session B hidden on the Canvas (its Claude Code stopped while a Subagent worked), Session
// C with no Node, started in the worktree 07 and still being written, Session D of another Project
// whose folder has the same name, Session E from February. Each test copies it into a temporary home
// and sets each file's modification time to its last record's.
import { appendFile, cp, mkdtemp, readdir, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CODEX_ARCHIVED_SESSION, fileLines, readProjectTranscripts, TranscriptCache, type CanvasSession, type ProjectTranscriptsInput } from '../../src/main/work-track/transcripts'
import type { HistoryPart, HistorySession } from '../../src/main/vendors/history'
import type { TranscriptEntry } from '../../src/shared/transcript/parse'
import { removeTestTree } from '../remove'

const FIXTURE = join(__dirname, '..', 'fixtures', 'work-track', 'claude-home')
const ROOT = '/work/acme/shop'
const A = 'a0a0a0a0-0000-4000-8000-000000000001'
const B = 'b0b0b0b0-0000-4000-8000-000000000002'
const C = 'c0c0c0c0-0000-4000-8000-000000000003'
const D = 'd0d0d0d0-0000-4000-8000-000000000004'
const E = 'e0e0e0e0-0000-4000-8000-000000000005'
const MAIN_DIR = join('projects', '-work-acme-shop')
const CANVAS: CanvasSession[] = [
  { id: A, title: 'Orchestrator', hidden: false },
  { id: B, title: 'Side quest', hidden: true },
]
/** A local midnight, as a period starts (src/shared/work-track/facts.ts). */
const midnight = (month: number, day: number): string => new Date(2026, month - 1, day).toISOString()
const WEEK: ProjectTranscriptsInput = { root: ROOT, period: { kind: 'week', start: midnight(3, 2) }, now: '2026-03-06T12:00:00.000Z', canvas: CANVAS }

let base: string
beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'worfy-wt-transcripts-')))
})
afterAll(() => {
  removeTestTree(base)
})

async function files(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
}

/** A copy of the fixture's home, each file dated by its last record (a meta file by its transcript's). */
async function home(name: string): Promise<string> {
  const path = join(base, name)
  await cp(FIXTURE, path, { recursive: true })
  for (const file of await files(path)) {
    const transcript = file.endsWith('.meta.json') ? file.replace(/\.meta\.json$/u, '.jsonl') : file
    const last = (await readFile(transcript, 'utf8')).trim().split('\n').at(-1) ?? '{}'
    const at = new Date(String((JSON.parse(last) as { timestamp?: string }).timestamp))
    await utimes(file, at, at)
  }
  return path
}

/** Every file under a folder with its size and modification time: what a read must leave as it was. */
async function snapshot(folder: string): Promise<string[]> {
  return (await Promise.all((await files(folder)).map(async (file) => `${file} ${(await stat(file)).size} ${(await stat(file)).mtimeMs}`))).sort()
}

/** The default line source, counting the files it opens. */
function counted(): { lines: (file: string) => AsyncIterable<string>; opened: string[] } {
  const opened: string[] = []
  return {
    opened,
    lines: (file) => {
      opened.push(file)
      return fileLines(file)
    },
  }
}

const brief = (fact: { id: string; start: string; end: string | null; outcome: string | null; title: string; parent?: string }) => [fact.id, fact.title, fact.start, fact.end, fact.outcome, fact.parent]

describe('the transcripts of every Session of a Project over a period', () => {
  it('give the turns and Subagents of a Session on the Canvas, a hidden one and one with no Node, not of another Project, with no text', async () => {
    const claude = await home('all')
    const before = await snapshot(claude)
    const cache = new TranscriptCache()
    const read = await readProjectTranscripts(WEEK, { env: { WORFY_CLAUDE_HOME: claude }, cache, platform: 'linux' })
    expect(await snapshot(claude)).toEqual(before)

    const of = (session: string) => read.facts.filter((fact) => fact.session === session).map(brief)
    expect(of(A)).toEqual([
      [`turn:${A}:1`, 'Orchestrator', '2026-03-03T09:00:00.000Z', '2026-03-03T09:20:15.000Z', 'ok', undefined],
      [`subagent:${A}:a1#1`, 'impl-05', '2026-03-03T09:00:05.000Z', '2026-03-03T09:20:00.000Z', 'ok', undefined],
      [`subagent:${A}:n1#1`, 'Find the reader', '2026-03-03T09:01:00.000Z', '2026-03-03T09:03:00.000Z', 'ok', `subagent:${A}:a1#1`],
      [`subagent:${A}:a2#1`, 'verify-05', '2026-03-03T09:20:10.000Z', '2026-03-03T09:40:00.000Z', 'rejected', undefined],
      [`turn:${A}:2`, 'Orchestrator', '2026-03-03T09:40:00.000Z', '2026-03-03T09:41:00.000Z', 'ok', undefined],
    ])
    // Its Claude Code stopped while the Subagent worked: cut off at the Subagent's last record, not running until now.
    expect(of(B)).toEqual([
      [`turn:${B}:1`, 'Side quest', '2026-03-04T14:00:00.000Z', '2026-03-04T14:00:40.000Z', 'ok', undefined],
      [`subagent:${B}:b1#1`, 'researcher', '2026-03-04T14:00:30.000Z', '2026-03-04T14:25:00.000Z', 'cut-off', undefined],
    ])
    // No Node, and its last turn is still going: its file was written a minute ago.
    expect(of(C)).toEqual([
      [`turn:${C}:1`, 'Session c0c0 · 07', '2026-03-06T11:00:00.000Z', '2026-03-06T11:05:00.000Z', 'ok', undefined],
      [`turn:${C}:2`, 'Session c0c0 · 07', '2026-03-06T11:59:00.000Z', null, null, undefined],
    ])
    expect(read.facts.map((fact) => fact.session)).not.toContain(D)
    expect(read.facts.map((fact) => fact.session)).not.toContain(E)
    expect(read.facts.every((fact) => fact.source === 'transcript' && ['turn', 'subagent'].includes(fact.kind))).toBe(true)
    expect(read.facts.filter((fact) => fact.kind === 'turn').every((fact) => fact.id.startsWith('turn:'))).toBe(true)

    expect(read.sessions).toEqual([
      { id: A, name: 'Orchestrator', vendor: 'claude', hidden: false, archived: false },
      { id: B, name: 'Side quest', vendor: 'claude', hidden: true, archived: false },
      { id: C, name: 'Session c0c0 · 07', vendor: 'claude', hidden: false, archived: true },
    ])
    // February's Session is older than the period: the transcripts reach back past its start.
    expect(read.gaps).toEqual([])
    // Only names: no prompt, answer, report, summary or result of a task-notification, in the facts or in what is kept.
    expect(JSON.stringify(read)).not.toContain('SECRET')
    expect(inspect(cache, { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity })).not.toContain('SECRET')
  })

  it('reads a file again only when its modification time or size changed, and writes nothing', async () => {
    const claude = await home('cache')
    const before = await snapshot(claude)
    const cache = new TranscriptCache()
    const first = counted()
    const options = { env: { WORFY_CLAUDE_HOME: claude }, cache, platform: 'linux' as const }
    const once = await readProjectTranscripts(WEEK, { ...options, lines: first.lines })
    // February's file is dated before the period: it is not opened.
    expect(first.opened.some((file) => file.includes(E))).toBe(false)
    expect(first.opened).toHaveLength(8)

    const second = counted()
    const again = await readProjectTranscripts(WEEK, { ...options, lines: second.lines })
    expect(second.opened).toEqual([])
    expect(again).toEqual(once)
    expect(await snapshot(claude)).toEqual(before)

    // Session C answers: only its file is read again.
    const fileC = join(claude, 'projects', '-work-acme-shop--claude-worktrees-07', `${C}.jsonl`)
    await appendFile(fileC, `${JSON.stringify({ type: 'assistant', sessionId: C, cwd: `${ROOT}/.claude/worktrees/07`, timestamp: '2026-03-06T11:59:30.000Z', message: { role: 'assistant', content: [] } })}\n`)
    const third = counted()
    const answered = await readProjectTranscripts(WEEK, { ...options, lines: third.lines })
    expect(third.opened).toEqual([fileC])
    expect(answered.facts.find((fact) => fact.id === `turn:${C}:2`)).toEqual(expect.objectContaining({ end: '2026-03-06T11:59:30.000Z', outcome: 'ok' }))
  })

  it('a period before the oldest transcript and past cleanupPeriodDays is a gap; the setting moves it', async () => {
    const claude = await home('gaps')
    await rm(join(claude, MAIN_DIR, `${E}.jsonl`))
    const input: ProjectTranscriptsInput = { ...WEEK, period: { kind: 'week', start: midnight(1, 26) } }
    const options = { env: { WORFY_CLAUDE_HOME: claude }, cache: new TranscriptCache(), platform: 'linux' as const }

    // 30 days by default: the transcripts before 2026-02-04T12:00 are deleted, the period ends before that.
    const deleted = await readProjectTranscripts(input, options)
    expect(deleted.facts).toEqual([])
    expect(deleted.gaps).toEqual([{ source: 'transcript', start: midnight(1, 26), end: midnight(2, 2), why: expect.stringContaining('30 days') }])

    // A week that starts before the 30 days and ends after them: the gap ends where the deletion stops.
    const across = await readProjectTranscripts({ ...input, period: { kind: 'week', start: midnight(2, 2) } }, options)
    expect(across.gaps).toEqual([{ source: 'transcript', start: midnight(2, 2), end: '2026-02-04T12:00:00.000Z', why: expect.stringContaining('cleanupPeriodDays') }])

    // 60 days in the settings: nothing of that week is deleted yet, it simply had no work.
    await writeFile(join(claude, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 60 }))
    expect((await readProjectTranscripts(input, options)).gaps).toEqual([])

    // 30 days again, and a Session that began on January 28 and was last written on February 10: kept, it bounds the gap.
    await writeFile(join(claude, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 30 }))
    const fileE = join(claude, MAIN_DIR, `${E}.jsonl`)
    const record = (type: string, timestamp: string) => JSON.stringify({ type, sessionId: E, cwd: ROOT, timestamp, message: { role: type, content: type === 'user' ? 'SECRET' : [] } })
    await writeFile(fileE, [record('user', '2026-01-28T09:00:00.000Z'), record('assistant', '2026-01-28T09:30:00.000Z'), record('user', '2026-02-10T09:00:00.000Z'), record('assistant', '2026-02-10T09:30:00.000Z')].join('\n'))
    await utimes(fileE, new Date('2026-02-10T09:30:00.000Z'), new Date('2026-02-10T09:30:00.000Z'))
    const bounded = await readProjectTranscripts(input, options)
    expect(bounded.gaps).toEqual([{ source: 'transcript', start: midnight(1, 26), end: '2026-01-28T09:00:00.000Z', why: expect.stringContaining('30 days') }])
    expect(bounded.facts.map((fact) => fact.id)).toEqual([`turn:${E}:1`])
  })
})

describe('the threads of Codex', () => {
  const entry = (timestamp: string, event: TranscriptEntry['event']): TranscriptEntry => ({ timestamp, sidechain: false, event })
  const THREADS: Record<string, TranscriptEntry[]> = {
    'thr1-0001': [
      entry('2026-03-05T10:00:00.000Z', { type: 'notice', kind: 'user', text: 'SECRET-CODEX-PROMPT-1' }),
      entry('2026-03-05T10:00:20.000Z', { type: 'subagent', phase: 'started', taskId: 'cx1', toolUseId: 'call-1', description: 'impl_05', subagentType: null, status: null, summary: null }),
      entry('2026-03-05T10:04:00.000Z', { type: 'subagent', phase: 'finished', taskId: 'cx1', toolUseId: 'call-2', description: null, subagentType: null, status: 'completed', summary: null, result: 'SECRET-CODEX-REPORT' }),
      entry('2026-03-05T10:05:00.000Z', { type: 'text', text: 'SECRET-CODEX-ANSWER-1', messageId: 'm1', parentToolUseId: null, synthetic: false }),
    ],
    'thr2-0002': [
      entry('2026-03-05T16:00:00.000Z', { type: 'notice', kind: 'user', text: 'SECRET-CODEX-PROMPT-2' }),
      entry('2026-03-05T16:30:00.000Z', { type: 'text', text: 'SECRET-CODEX-ANSWER-2', messageId: 'm2', parentToolUseId: null, synthetic: false }),
    ],
  }
  const LISTED: HistorySession[] = [
    { id: 'thr1-0001', cwd: ROOT, title: 'SECRET-CODEX-TITLE', updatedAt: Date.parse('2026-03-05T10:05:00.000Z'), origin: 'worfy' },
    { id: 'thr2-0002', cwd: `${ROOT}/.claude/worktrees/09`, title: null, updatedAt: Date.parse('2026-03-05T16:30:00.000Z'), origin: 'external' },
    // Last written before the period: not read.
    { id: 'thr3-0003', cwd: ROOT, title: null, updatedAt: Date.parse('2026-02-20T08:00:00.000Z'), origin: 'external' },
  ]

  function fakeCodex(): { history: HistoryPart; read: string[] } {
    const read: string[] = []
    return {
      read,
      history: {
        list: async (cwd) => (cwd === ROOT ? LISTED : []),
        read: async (id) => {
          read.push(id)
          const entries = THREADS[id]
          if (entries === undefined) throw new Error(`no thread ${id}`)
          return entries
        },
      },
    }
  }

  it('give the turns of a Session on Codex with its Subagents, read once while the thread is unchanged; archived threads are a gap', async () => {
    const claude = await home('codex')
    const codex = fakeCodex()
    const cache = new TranscriptCache()
    const canvas: CanvasSession[] = [...CANVAS, { id: 'thr1-0001', title: 'Codex helper', hidden: false }]
    const options = { env: { WORFY_CLAUDE_HOME: claude }, cache, platform: 'linux' as const, codex: codex.history }
    const read = await readProjectTranscripts({ ...WEEK, canvas }, options)

    const codexFacts = read.facts.filter((fact) => fact.source === 'codex').map(brief)
    expect(codexFacts).toEqual([
      ['turn:thr1-0001:1', 'Codex helper', '2026-03-05T10:00:00.000Z', '2026-03-05T10:05:00.000Z', 'ok', undefined],
      ['subagent:thr1-0001:cx1#1', 'impl_05', '2026-03-05T10:00:20.000Z', '2026-03-05T10:04:00.000Z', 'ok', undefined],
      ['turn:thr2-0002:1', 'Session thr2 · 09', '2026-03-05T16:00:00.000Z', '2026-03-05T16:30:00.000Z', 'ok', undefined],
    ])
    expect(read.sessions.filter((session) => session.vendor === 'codex')).toEqual([
      { id: 'thr1-0001', name: 'Codex helper', vendor: 'codex', hidden: false, archived: false },
      { id: 'thr2-0002', name: 'Session thr2 · 09', vendor: 'codex', hidden: false, archived: true },
      { id: CODEX_ARCHIVED_SESSION, name: 'Codex archived threads', vendor: 'codex', hidden: false, archived: true },
    ])
    expect(read.gaps).toEqual([{ source: 'codex', session: CODEX_ARCHIVED_SESSION, start: midnight(3, 2), end: '2026-03-06T12:00:00.000Z', why: expect.stringContaining('archived') }])
    expect(codex.read.sort()).toEqual(['thr1-0001', 'thr2-0002'])
    expect(JSON.stringify(read)).not.toContain('SECRET')
    expect(inspect(cache, { depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity })).not.toContain('SECRET')

    await readProjectTranscripts({ ...WEEK, canvas }, options)
    expect(codex.read).toHaveLength(2)
  })

  it('a Codex that does not answer is a gap of the whole period, and the transcripts still read', async () => {
    const claude = await home('codex-down')
    const history: HistoryPart = {
      list: async () => {
        throw new Error('app-server did not start')
      },
      read: async () => [],
    }
    const read = await readProjectTranscripts(WEEK, { env: { WORFY_CLAUDE_HOME: claude }, cache: new TranscriptCache(), platform: 'linux', codex: history })
    expect(read.facts.some((fact) => fact.session === A)).toBe(true)
    expect(read.gaps).toEqual([{ source: 'codex', start: midnight(3, 2), end: '2026-03-06T12:00:00.000Z', why: expect.stringContaining('did not answer') }])
  })
})
