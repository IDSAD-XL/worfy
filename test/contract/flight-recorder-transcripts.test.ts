// The reader of the transcripts for Flight Recorder (src/main/flight-recorder/transcripts.ts;
// worfy-flight-recorder ticket 14): the Orchestrator's transcript of a Run is found under the Claude
// home (WORFY_CLAUDE_HOME) by `wave-started.session`, else by the text of `wave-started` and its
// time; with neither the Orchestrator's lane is grey; a folder of the same name whose transcript
// started in another folder is not the Project's; a Session the Journal names whose file is gone is
// «transcript deleted». The Project root of Windows gives its folder name, a worktree path comes
// out canonical, and a file's modification time changes nothing. Nothing is written to the home.
//
// The night-Run fixture (test/fixtures/flight-recorder/night-run/) is read in place; tests that add
// files copy it into a temporary home of their own.
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectDirName } from '../../src/main/claude-home/registry'
import { canonicalPath, readRunTranscripts, type TranscriptRun } from '../../src/main/flight-recorder/transcripts'
import { removeTestTree } from '../remove'

const FIXTURE = join(__dirname, '..', 'fixtures', 'flight-recorder', 'night-run', 'claude')
const ROOT = '/Users/someone/Stuff/CanvasForAI'
const SESSION = 'f6ab7045-416c-471a-a78d-433567aefa5a'
const DIR = projectDirName(ROOT)

const NIGHT: TranscriptRun = {
  epic: 'worfy-pipeline',
  root: ROOT,
  startedAt: '2026-10-17T22:29:32.707Z',
  stoppedAt: '2026-10-18T03:17:34.592Z',
  waves: [
    { number: 1, startedAt: '2026-10-17T22:29:33.879Z', finishedAt: '2026-10-18T01:13:01.175Z', tickets: ['worfy-pipeline/03', 'worfy-pipeline/07'], text: '/worfy:epic-wave tickets 03, 07 of epic worfy-pipeline' },
    { number: 2, startedAt: '2026-10-18T01:13:02.542Z', finishedAt: '2026-10-18T03:17:34.592Z', tickets: ['worfy-pipeline/04', 'worfy-pipeline/05'], text: '/worfy:epic-wave tickets 04, 05 of epic worfy-pipeline' },
  ],
}
const withSession = (run: TranscriptRun, session: string): TranscriptRun => ({ ...run, waves: run.waves.map((wave) => ({ ...wave, session })) })
const withoutText = (run: TranscriptRun): TranscriptRun => ({ ...run, waves: run.waves.map((wave) => ({ ...wave, text: undefined })) })

let base: string
beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'worfy-fr-transcripts-')))
})
afterAll(async () => {
  await removeTestTree(base)
})

/** A Claude home of the test's own: a copy of the fixture's, or an empty one. */
async function home(name: string, copy = true): Promise<string> {
  const path = join(base, name)
  if (copy) await cp(FIXTURE, path, { recursive: true })
  else await mkdir(join(path, 'projects'), { recursive: true })
  return path
}

/** Every file under a folder with its size and modification time: what a read must leave as it was. */
async function snapshot(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
  return (await Promise.all(files.map(async (file) => `${file} ${(await stat(file)).size} ${(await stat(file)).mtimeMs}`))).sort()
}

const line = (record: Record<string, unknown>): string => JSON.stringify(record)

describe('the Orchestrator transcript of a Run', () => {
  it('is found by wave-started.session: the agents, the rework #2 and the turns of the night Run, writing nothing', async () => {
    const before = await snapshot(FIXTURE)
    const facts = await readRunTranscripts(withSession(NIGHT, SESSION), { env: { WORFY_CLAUDE_HOME: FIXTURE } })
    expect(await snapshot(FIXTURE)).toEqual(before)
    expect(facts.lost).toEqual([])

    const named = (name: string) => facts.work.filter((fact) => fact.name === name)
    expect(named('impl-07').map((fact) => [fact.ticket, fact.start, fact.end])).toEqual([
      ['worfy-pipeline/07', '2026-10-17T23:30:00.601Z', '2026-10-18T00:12:51.975Z'],
      ['worfy-pipeline/07', '2026-10-18T00:19:39.312Z', '2026-10-18T00:34:58.262Z'],
    ])
    // Three messages reached impl-05 while it worked; only the rework after its report is a span.
    expect(named('impl-05').map((fact) => fact.start)).toEqual(['2026-10-18T01:14:22.597Z', '2026-10-18T02:13:05.315Z'])
    expect(named('verify-07')).toEqual([expect.objectContaining({ ticket: 'worfy-pipeline/07', outcome: 'rejected', verdict: 'REJECTED' })])
    expect(named('verify-03')).toEqual([expect.objectContaining({ ticket: 'worfy-pipeline/03', verdict: 'VERIFIED' })])
    expect(named('verify-03')[0]?.outcome).toBeUndefined()
    expect(facts.work.every((fact) => fact.kind === 'agent' && fact.session === SESSION && fact.startSource === 'transcript')).toBe(true)
    expect(facts.work).toHaveLength(15)

    expect(facts.turns.length).toBeGreaterThan(10)
    expect(facts.turns[0]).toEqual(expect.objectContaining({ start: '2026-10-17T22:29:33.907Z', session: SESSION }))
    // The fixture cuts the slash command's arguments; the turn names 03 through the agents it started.
    expect(facts.turns[0]?.tickets).toEqual(['worfy-pipeline/03'])
    expect(facts.turns.some((turn) => turn.tickets.includes('worfy-pipeline/07'))).toBe(true)
    // The second Wave's prompt reached the transcript before worfy wrote wave-started.
    expect(facts.turns.some((turn) => turn.start === '2026-10-18T01:13:02.513Z' && turn.tickets.includes('worfy-pipeline/05'))).toBe(true)
  })

  it('without a session is found by the text of wave-started and its time, not by a copy at another time or of another folder', async () => {
    const path = await home('by-text')
    const dir = join(path, 'projects', DIR)
    const original = (await readFile(join(dir, `${SESSION}.jsonl`), 'utf8')).split('\n').slice(0, 40).join('\n')
    // The same prompt a day earlier, and at the same time in a Session started in another folder that shares the name.
    await writeFile(join(dir, 'ffffffff-0000-4000-8000-000000000001.jsonl'), original.replaceAll('2026-10-17T', '2026-10-16T'))
    await writeFile(join(dir, 'aaaaaaaa-0000-4000-8000-000000000002.jsonl'), original.replaceAll(`"cwd":"${ROOT}"`, '"cwd":"/Users/someone/Stuff-CanvasForAI"'))
    const facts = await readRunTranscripts(NIGHT, { env: { WORFY_CLAUDE_HOME: path } })
    expect(facts.lost).toEqual([])
    expect(new Set([...facts.work, ...facts.turns].map((fact) => fact.session))).toEqual(new Set([SESSION]))
    const bySession = await readRunTranscripts(withSession(NIGHT, SESSION), { env: { WORFY_CLAUDE_HOME: path } })
    expect(facts).toEqual(bySession)
  })

  it('without a session and a text leaves the Orchestrator lane grey and the Tickets with no agent details', async () => {
    const facts = await readRunTranscripts(withoutText(NIGHT), { env: { WORFY_CLAUDE_HOME: FIXTURE } })
    expect(facts.work).toEqual([])
    expect(facts.turns).toEqual([])
    expect(facts.lost).toEqual([
      { kind: 'orchestrator-turn', name: 'Orchestrator', source: 'transcript-deleted', start: NIGHT.waves[0]!.startedAt, end: NIGHT.waves[0]!.finishedAt },
      { kind: 'agent', ticket: 'worfy-pipeline/03', name: 'impl-03', source: 'transcript-deleted' },
      { kind: 'agent', ticket: 'worfy-pipeline/07', name: 'impl-07', source: 'transcript-deleted' },
      { kind: 'orchestrator-turn', name: 'Orchestrator', source: 'transcript-deleted', start: NIGHT.waves[1]!.startedAt, end: NIGHT.waves[1]!.finishedAt },
      { kind: 'agent', ticket: 'worfy-pipeline/04', name: 'impl-04', source: 'transcript-deleted' },
      { kind: 'agent', ticket: 'worfy-pipeline/05', name: 'impl-05', source: 'transcript-deleted' },
    ])
  })

  it('a folder of the same name whose transcript started in another folder is not taken', async () => {
    const path = await home('foreign', false)
    // `/p/A/evil` and `/p/A-evil` share the folder name `-p-A-evil`.
    const root = '/p/A/evil'
    const dir = join(path, 'projects', projectDirName(root))
    await mkdir(dir, { recursive: true })
    const session = 'bbbbbbbb-0000-4000-8000-000000000001'
    const text = '/worfy:epic-wave tickets 01 of epic e'
    await writeFile(
      join(dir, `${session}.jsonl`),
      [
        line({ type: 'user', timestamp: '2026-10-17T10:00:01.000Z', cwd: '/p/A-evil', sessionId: session, message: { role: 'user', content: text } }),
        line({ type: 'assistant', timestamp: '2026-10-17T10:00:05.000Z', cwd: '/p/A-evil', sessionId: session, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }),
      ].join('\n'),
    )
    const run: TranscriptRun = { epic: 'e', root, startedAt: '2026-10-17T10:00:00.000Z', stoppedAt: '2026-10-17T11:00:00.000Z', waves: [{ number: 1, startedAt: '2026-10-17T10:00:00.000Z', finishedAt: '2026-10-17T11:00:00.000Z', tickets: ['e/01'], text }] }
    for (const variant of [run, withSession(run, session)]) {
      const facts = await readRunTranscripts(variant, { env: { WORFY_CLAUDE_HOME: path } })
      expect(facts.turns).toEqual([])
      expect(facts.lost.map((fact) => fact.kind)).toEqual(['orchestrator-turn', 'agent'])
    }
  })

  it('a Session the Journal names whose file is gone is «transcript deleted»', async () => {
    const path = await home('deleted', false)
    const facts = await readRunTranscripts(withSession(NIGHT, SESSION), { env: { WORFY_CLAUDE_HOME: path } })
    expect(facts.work).toEqual([])
    expect(facts.lost.filter((fact) => fact.kind === 'agent').map((fact) => [fact.ticket, fact.source])).toEqual([
      ['worfy-pipeline/03', 'transcript-deleted'],
      ['worfy-pipeline/07', 'transcript-deleted'],
      ['worfy-pipeline/04', 'transcript-deleted'],
      ['worfy-pipeline/05', 'transcript-deleted'],
    ])
    expect(facts.lost.filter((fact) => fact.kind === 'orchestrator-turn')).toHaveLength(2)
  })

  it('keeps only what started in the Waves of the Run', async () => {
    const run: TranscriptRun = { ...withSession(NIGHT, SESSION), waves: [withSession(NIGHT, SESSION).waves[0]!], stoppedAt: '2026-10-18T01:13:01.175Z' }
    const facts = await readRunTranscripts(run, { env: { WORFY_CLAUDE_HOME: FIXTURE } })
    expect(facts.work.map((fact) => fact.name)).not.toContain('impl-05')
    expect(facts.work.map((fact) => fact.name)).toContain('impl-07')

    // The second Wave alone: its prompt, written a moment before wave-started, is in; the first Wave's agents are not.
    const second = await readRunTranscripts({ ...withSession(NIGHT, SESSION), waves: [withSession(NIGHT, SESSION).waves[1]!] }, { env: { WORFY_CLAUDE_HOME: FIXTURE } })
    expect(second.turns[0]?.start).toBe('2026-10-18T01:13:02.513Z')
    expect(second.work.map((fact) => fact.name)).not.toContain('impl-07')
  })
})

describe('Windows paths and times', () => {
  const ROOT_WIN = 'C:\\Users\\Ann\\repo'
  const session = 'cccccccc-0000-4000-8000-000000000001'
  const text = '/worfy:epic-wave tickets 05 of epic e'
  const run: TranscriptRun = {
    epic: 'e',
    root: ROOT_WIN,
    startedAt: '2026-10-17T10:00:00.000Z',
    stoppedAt: '2026-10-17T12:00:00.000Z',
    waves: [{ number: 1, startedAt: '2026-10-17T10:00:00.000Z', finishedAt: '2026-10-17T12:00:00.000Z', tickets: ['e/05'], text }],
  }

  async function windowsHome(name: string): Promise<{ path: string; file: string }> {
    const path = await home(name, false)
    expect(projectDirName(ROOT_WIN)).toBe('C--Users-Ann-repo')
    const dir = join(path, 'projects', 'C--Users-Ann-repo')
    await mkdir(join(dir, session, 'subagents'), { recursive: true })
    const cwd = 'c:\\users\\ann\\repo'
    const report = '{"ticket": "e/05", "worktree": "C:\\\\Users\\\\Ann\\\\repo\\\\.claude\\\\worktrees\\\\05\\\\"}'
    const file = join(dir, `${session}.jsonl`)
    await writeFile(
      file,
      [
        line({ type: 'user', timestamp: '2026-10-17T10:00:01.000Z', cwd, sessionId: session, message: { role: 'user', content: text } }),
        line({ type: 'assistant', timestamp: '2026-10-17T10:01:00.000Z', cwd, sessionId: session, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'Agent', input: { name: 'helper', run_in_background: true } }] } }),
        line({ type: 'user', timestamp: '2026-10-17T10:01:00.100Z', cwd, sessionId: session, toolUseResult: { status: 'async_launched', agentId: 'a1' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'Async agent launched' }] } }),
        line({ type: 'user', timestamp: '2026-10-17T10:40:00.000Z', cwd, sessionId: session, message: { role: 'user', content: '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>call-1</tool-use-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>' } }),
      ].join('\n'),
    )
    await writeFile(join(dir, session, 'subagents', 'agent-a1.jsonl'), line({ type: 'assistant', timestamp: '2026-10-17T10:39:00.000Z', cwd, isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: report }] } }))
    return { path, file }
  }

  it('the root C:\\Users\\Ann\\repo gives the folder C--Users-Ann-repo; the cwd matches without case; the worktree comes out canonical', async () => {
    const { path } = await windowsHome('windows')
    for (const variant of [run, withSession(run, session)]) {
      const facts = await readRunTranscripts(variant, { env: { WORFY_CLAUDE_HOME: path }, platform: 'win32' })
      expect(facts.lost).toEqual([])
      expect(facts.work).toEqual([expect.objectContaining({ name: 'helper', worktree: 'c:\\users\\ann\\repo\\.claude\\worktrees\\05', start: '2026-10-17T10:01:00.000Z', end: '2026-10-17T10:40:00.000Z' })])
    }
  })

  it('the times come from the timestamps: another modification time of the file gives the same facts', async () => {
    const { path, file } = await windowsHome('windows-mtime')
    const first = await readRunTranscripts(run, { env: { WORFY_CLAUDE_HOME: path }, platform: 'win32' })
    await utimes(file, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))
    expect(await readRunTranscripts(run, { env: { WORFY_CLAUDE_HOME: path }, platform: 'win32' })).toEqual(first)
    await utimes(file, new Date('2030-01-01T00:00:00Z'), new Date('2030-01-01T00:00:00Z'))
    expect(await readRunTranscripts(run, { env: { WORFY_CLAUDE_HOME: path }, platform: 'win32' })).toEqual(first)
    expect(first.work).toHaveLength(1)
  })

  it('a canonical path: case-folded with one separator on Windows, the real path elsewhere', async () => {
    expect(await canonicalPath('C:/Users/Ann/repo/.claude/worktrees/05/', 'win32')).toBe('c:\\users\\ann\\repo\\.claude\\worktrees\\05')
    expect(await canonicalPath('C:\\Users\\Ann\\repo\\..\\repo\\x', 'win32')).toBe('c:\\users\\ann\\repo\\x')
    expect(await canonicalPath('c:\\', 'win32')).toBe('c:\\')
    const real = join(base, 'real')
    await mkdir(real, { recursive: true })
    expect(await canonicalPath(`${real}/`, 'darwin')).toBe(real)
    expect(await canonicalPath('/no/such/folder/', 'linux')).toBe('/no/such/folder')
  })
})
