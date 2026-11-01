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
import { realpathSync, symlinkSync } from 'node:fs'
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectDirName } from '../../src/main/claude-home/registry'
import { readNewLines } from '../../src/main/claude-home/tail'
import { TailLines } from '../../src/main/flight-recorder/service'
import { PROMPT_LEAD_MS, readRunTranscripts, streamLines, TranscriptCompactor, TranscriptParses, WAVE_SLACK_MS, type ReadLines, type TranscriptRun } from '../../src/main/flight-recorder/transcripts'
import { canonicalWorktree } from '../../src/main/flight-recorder/worktree-path'
import { comparablePath } from '../../src/shared/flight-recorder/from-gate'
import { agentIdsIn, SubagentParse, TranscriptParse, transcriptFacts, type SubagentLines } from '../../src/shared/flight-recorder/from-transcript'
import { shapedSession, writeShapedSession } from './flight-recorder-shaped-transcript'
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
    // The session alone: no text to search by.
    const facts = await readRunTranscripts(withoutText(withSession(NIGHT, SESSION)), { env: { WORFY_CLAUDE_HOME: FIXTURE } })
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

  it('keeps only what started in the Waves of the Run, and reads only the files of its Subagents, through the line source of the options', async () => {
    const run: TranscriptRun = { ...withSession(NIGHT, SESSION), waves: [withSession(NIGHT, SESSION).waves[0]!], stoppedAt: '2026-10-18T01:13:01.175Z' }
    const files: string[] = []
    const readLines = (file: string) => {
      files.push(file)
      return streamLines(file)
    }
    const facts = await readRunTranscripts(run, { env: { WORFY_CLAUDE_HOME: FIXTURE }, readLines })
    const agentFiles = new Set(files.flatMap((file) => /agent-([a-z0-9]+)\.jsonl$/u.exec(file)?.[1] ?? []))
    // The scout, impl-03, verify-03, impl-07, verify-07 and verify-07r2 of the first Wave; none of the second.
    expect([...agentFiles].sort()).toEqual(['a1a04fe1bfe94e08b', 'a4f4ef600ce73b83a', 'a60e687cd0ab6803e', 'aa037f56c7bb8ed93', 'adb147aa44e4451c4', 'afc1f7e33caf5dcc3'])
    expect(files.every((file) => file.startsWith(join(FIXTURE, 'projects', DIR)))).toBe(true)
    expect(facts.work.map((fact) => fact.name)).not.toContain('impl-05')
    expect(facts.work.map((fact) => fact.name)).toContain('impl-07')

    // The second Wave alone: its prompt, written a moment before wave-started, is in; the first Wave's agents are not.
    const second = await readRunTranscripts({ ...withSession(NIGHT, SESSION), waves: [withSession(NIGHT, SESSION).waves[1]!] }, { env: { WORFY_CLAUDE_HOME: FIXTURE } })
    expect(second.turns[0]?.start).toBe('2026-10-18T01:13:02.513Z')
    expect(second.work.map((fact) => fact.name)).not.toContain('impl-07')
  })
})

describe('the search and its bounds', () => {
  const text = '/worfy:epic-wave tickets 01 of epic e'
  const root = '/p/repo'
  const run: TranscriptRun = { epic: 'e', root, startedAt: '2026-10-17T10:00:00.000Z', stoppedAt: '2026-10-17T11:00:00.000Z', waves: [{ number: 1, startedAt: '2026-10-17T10:00:00.000Z', finishedAt: '2026-10-17T11:00:00.000Z', tickets: ['e/01'], text }] }
  const promptAt = (at: string, session: string) => line({ type: 'user', timestamp: at, cwd: root, sessionId: session, message: { role: 'user', content: text } })

  it(`takes a prompt within ${WAVE_SLACK_MS / 1000} s of wave-started and none farther`, async () => {
    for (const [name, at, found] of [
      ['slack-in', '2026-10-17T10:00:59.000Z', true],
      ['slack-out', '2026-10-17T10:01:01.000Z', false],
    ] as const) {
      const path = await home(name, false)
      const dir = join(path, 'projects', projectDirName(root))
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'dddddddd-0000-4000-8000-000000000001.jsonl'), promptAt(at, 'd1'))
      const facts = await readRunTranscripts(run, { env: { WORFY_CLAUDE_HOME: path } })
      expect(facts.turns.length, name).toBe(found ? 1 : 0)
      expect(facts.lost.length, name).toBe(found ? 0 : 2)
    }
  })

  it('a session that is not a file name reads no file outside the folder', async () => {
    const path = await home('session-id', false)
    const other = join(path, 'projects', 'other')
    await mkdir(join(path, 'projects', projectDirName(root)), { recursive: true })
    await mkdir(other, { recursive: true })
    await writeFile(join(other, 'eeee.jsonl'), promptAt('2026-10-17T10:00:01.000Z', 'eeee'))
    const facts = await readRunTranscripts({ ...run, waves: run.waves.map((wave) => ({ ...wave, session: '../other/eeee', text: undefined })) }, { env: { WORFY_CLAUDE_HOME: path } })
    expect(facts.turns).toEqual([])
    expect(facts.lost.map((fact) => fact.kind)).toEqual(['orchestrator-turn', 'agent'])
  })

  it('an agent with no Ticket of its own takes the Ticket of an agent in its worktree, else it is the Run\'s', async () => {
    const path = await home('worktree-ticket', false)
    const dir = join(path, 'projects', projectDirName(root))
    const session = 'ffffffff-0000-4000-8000-000000000002'
    await mkdir(join(dir, session, 'subagents'), { recursive: true })
    const at = (mm: string) => `2026-10-17T10:${mm}:00.000Z`
    const record = (time: string, value: Record<string, unknown>) => line({ timestamp: time, cwd: root, sessionId: session, ...value })
    const call = (time: string, id: string, agentId: string, name: string) => [
      record(time, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input: { name, subagent_type: name.startsWith('verify') ? 'worfy:reviewer' : 'worfy:implementer', run_in_background: true } }] } }),
      record(time, { type: 'user', toolUseResult: { status: 'async_launched', agentId }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Async agent launched' }] } }),
    ]
    await writeFile(join(dir, `${session}.jsonl`), [record(at('00'), { type: 'user', message: { role: 'user', content: text } }), ...call(at('01'), 'c1', 'a1', 'impl-01'), ...call(at('02'), 'c2', 'h1', 'helper'), ...call(at('03'), 'c3', 'v1', 'verify-fr01-correct')].join('\n'))
    const own = (agentId: string, cwd: string, text_: string) =>
      writeFile(join(dir, session, 'subagents', `agent-${agentId}.jsonl`), [line({ type: 'user', timestamp: at('05'), cwd, isSidechain: true, message: { role: 'user', content: 'task' } }), line({ type: 'assistant', timestamp: at('06'), cwd, isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: text_ }] } })].join('\n'))
    await own('a1', `${root}/.claude/worktrees/01`, '{"worktree": "/p/repo/.claude/worktrees/01"}')
    await own('h1', `${root}/.claude/worktrees/01/`, 'done')
    await own('v1', `${root}/.claude/worktrees/review-470`, 'VERIFIED')
    const facts = await readRunTranscripts({ ...run, waves: run.waves.map((wave) => ({ ...wave, session })) }, { env: { WORFY_CLAUDE_HOME: path } })
    expect(facts.work.map((fact) => [fact.name, fact.ticket])).toEqual([
      ['impl-01', 'e/01'],
      ['helper', 'e/01'],
      ['verify-fr01-correct', null],
    ])
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
      expect(facts.work).toEqual([expect.objectContaining({ name: 'helper', worktree: 'c:/users/ann/repo/.claude/worktrees/05', start: '2026-10-17T10:01:00.000Z', end: '2026-10-17T10:40:00.000Z' })])
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

  it('the canonical path of worktree-path.ts, the helper reader 16 calls too: one Windows worktree in two spellings is one path; links and 8.3 names go through realpath', async () => {
    const missing = (path: string): Promise<string> => Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' }))
    const one = await canonicalWorktree('C:\\Users\\Ann\\Repo\\.claude\\worktrees\\05', { platform: 'win32', realpath: missing })
    expect(one).toBe('c:/users/ann/repo/.claude/worktrees/05')
    expect(await canonicalWorktree('c:/users/ann/repo/.claude/worktrees/05/', { platform: 'win32', realpath: missing })).toBe(one)
    expect(await canonicalWorktree('\\\\?\\C:\\Users\\Ann\\Repo\\.claude\\worktrees\\05', { platform: 'win32', realpath: missing })).toBe(one)
    expect(await canonicalWorktree('C:\\', { platform: 'win32', realpath: missing })).toBe('c:/')
    expect(comparablePath('\\\\?\\UNC\\Server\\Share\\Repo\\', 'win32')).toBe('//server/share/repo')
    // Elsewhere a backslash is a character of a name and letter case counts.
    expect(await canonicalWorktree('/Users/Ann/Repo', { platform: 'darwin', realpath: missing })).not.toBe(await canonicalWorktree('/users/ann/repo', { platform: 'darwin', realpath: missing }))

    // realpath(3) of the Windows runner expands the 8.3 short name of its home folder.
    const shortName = (path: string): Promise<string> => Promise.resolve(path.replace('RUNNER~1', 'runneradmin'))
    expect(await canonicalWorktree('C:/Users/RUNNER~1/work/.claude/worktrees/05', { platform: 'win32', realpath: shortName })).toBe(
      await canonicalWorktree('C:\\Users\\runneradmin\\work\\.claude\\worktrees\\05', { platform: 'win32', realpath: shortName }),
    )

    // On this machine: a link to a worktree and the worktree are one path; so are the temporary folder as the OS names it and its realpath.
    const real = join(base, 'wt', '07')
    await mkdir(real, { recursive: true })
    const link = join(base, 'link-07')
    symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await canonicalWorktree(link)).toBe(await canonicalWorktree(real))
    expect(await canonicalWorktree(tmpdir())).toBe(await canonicalWorktree(realpathSync.native(tmpdir())))
  })
})

describe('the compacted lines a live Run keeps (TranscriptCompactor, worfy-flight-recorder ticket 17)', () => {
  /** A line source that reads each file whole, compacted or not, and counts the characters it hands on. */
  function counted(compact: boolean): { read: ReadLines; chars: () => number } {
    let chars = 0
    const read: ReadLines = async (file) => {
      const lines = await streamLines(file)
      if (lines === null) return null
      let out = lines
      if (compact && file.endsWith('.jsonl')) {
        const compactor = new TranscriptCompactor()
        out = lines.flatMap((each) => {
          const kept = compactor.line(each)
          return kept === null ? [] : [kept]
        })
      }
      for (const each of out) chars += each.length
      return out
    }
    return { read, chars: () => chars }
  }

  it('give the facts the raw lines give on the night Run: the Orchestrator and every Subagent', async () => {
    const run = withSession(NIGHT, SESSION)
    const raw = counted(false)
    const small = counted(true)
    const full = await readRunTranscripts(run, { env: { WORFY_CLAUDE_HOME: FIXTURE }, readLines: raw.read })
    expect(full.work).toHaveLength(15)
    expect(await readRunTranscripts(run, { env: { WORFY_CLAUDE_HOME: FIXTURE }, readLines: small.read })).toEqual(full)
    expect(small.chars()).toBeLessThan(raw.chars())
  })

  it('drop the output of tools, thinking and images, keep the facts, and come out a small part of the file', async () => {
    const claude = await home('compact', false)
    const session = 'bbbbbbbb-0000-4000-8000-000000000002'
    const dir = join(claude, 'projects', DIR)
    await mkdir(join(dir, session, 'subagents'), { recursive: true })
    const worktree = `${ROOT}/.claude/worktrees/e-01`
    const t0 = Date.parse('2026-11-01T10:00:00.000Z')
    const at = (seconds: number): string => new Date(t0 + seconds * 1000).toISOString()
    const big = 'x'.repeat(400_000)
    const rec = (seconds: number, value: Record<string, unknown>, cwd = ROOT) => line({ timestamp: at(seconds), cwd, sessionId: session, uuid: `u${seconds}`, ...value })
    const orchestrator = [
      rec(1, { type: 'user', message: { role: 'user', content: '/worfy:epic-wave tickets 01 of epic e' } }),
      rec(2, { type: 'assistant', message: { role: 'assistant', id: 'm1', model: 'claude', content: [{ type: 'thinking', thinking: big, signature: 'sig' }, { type: 'text', text: 'reading the ticket' }, { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/x', note: big } }] } }),
      rec(3, { type: 'user', toolUseResult: { file: { content: big } }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: big }] } }),
      rec(4, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Agent', input: { name: 'impl-01', subagent_type: 'worfy:implementer', description: 'ticket 01', prompt: 'implement e/01', run_in_background: true } }] } }),
      rec(5, { type: 'user', toolUseResult: { status: 'async_launched', agentId: 'a1' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Async agent launched' }] } }),
      rec(6, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: big } }] } }),
      rec(7, { type: 'user', toolUseResult: { stdout: big, stderr: '' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: `boom ${big}`, is_error: true }] } }),
      rec(8, { type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: big } }, { type: 'text', text: 'look at this' }] } }),
      rec(9, { type: 'attachment', attachment: { type: 'file', filename: '/x', content: big } }),
      // A prompt Claude Code adds itself and a summary of the context: neither starts a turn.
      rec(20, { type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'Caveat: the messages below were generated by the user' }] } }),
      rec(21, { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued from a previous conversation.' } }),
      // impl-01's report waited in the queue: enqueued, then taken out.
      rec(41, { type: 'queue-operation', operation: 'enqueue', content: '<task-notification><task-id>a1</task-id><tool-use-id>c1</tool-use-id><status>completed</status><summary>done</summary><result>{"ticket": "e/01", "pr": 12}</result></task-notification>' }),
      rec(41, { type: 'queue-operation', operation: 'dequeue', content: `<task-notification><task-id>a1</task-id>${big}</task-notification>` }),
      rec(42, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 's1', name: 'SendMessage', input: { to: 'impl-01', message: 'fix the test' } }] } }),
      rec(43, { type: 'user', toolUseResult: { resumedAgentId: 'a1' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 's1', content: 'sent' }] } }),
      rec(58, { type: 'attachment', attachment: { type: 'queued_command', prompt: '<task-notification><task-id>a1</task-id><status>completed</status><summary>fixed</summary></task-notification>' } }),
      rec(60, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'impl-01 is done' }] } }),
      // A verifier run in the foreground: its result is its report, the verdict.
      rec(61, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'v1', name: 'Agent', input: { name: 'verify-01', subagent_type: 'worfy:reviewer', prompt: 'review e/01' } }] } }),
      rec(70, { type: 'user', toolUseResult: { status: 'completed', agentId: 'a2', content: [{ type: 'text', text: big }], usage: { output_tokens: 1 } }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'v1', content: 'REJECTED: the test is missing' }] } }),
      // One that failed by its status.
      rec(71, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'v2', name: 'Task', input: { description: 'second look', prompt: 'review e/01 again' } }] } }),
      rec(72, { type: 'user', toolUseResult: { status: 'failed', agentId: 'a3' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'v2', content: 'it broke' }] } }),
      // A new turn whose only Ticket is that of the agent it writes to (no agent resumed).
      rec(80, { type: 'user', message: { role: 'user', content: 'how is it going?' } }),
      rec(81, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 's2', name: 'SendMessage', input: { to: 'impl-01', message: 'status?' } }] } }),
      rec(82, { type: 'user', toolUseResult: { success: true }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 's2', content: 'queued' }] } }),
      // A record of a Subagent in the Session's own file (older Claude Code): not a turn of the Orchestrator.
      rec(85, { type: 'user', isSidechain: true, message: { role: 'user', content: 'a Subagent prompt' } }),
      'not a JSON line',
    ]
    const agent = [
      rec(4, { type: 'user', isSidechain: true, agentId: 'a1', message: { role: 'user', content: 'implement e/01' } }, worktree),
      rec(10, { type: 'assistant', isSidechain: true, agentId: 'a1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: big } }] } }, worktree),
      rec(11, { type: 'user', isSidechain: true, agentId: 'a1', toolUseResult: { content: big }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'g1', content: big }] } }, worktree),
      rec(40, { type: 'assistant', isSidechain: true, agentId: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }, worktree),
      rec(44, { type: 'user', isSidechain: true, agentId: 'a1', message: { role: 'user', content: 'fix the test' } }, worktree),
      rec(55, { type: 'assistant', isSidechain: true, agentId: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'fixed' }] } }, worktree),
    ]
    await writeFile(join(dir, `${session}.jsonl`), orchestrator.join('\n') + '\n')
    await writeFile(join(dir, session, 'subagents', 'agent-a1.jsonl'), agent.join('\n') + '\n')
    await writeFile(join(dir, session, 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'worfy:implementer' }))
    const run: TranscriptRun = { epic: 'e', root: ROOT, startedAt: at(0), stoppedAt: at(100), waves: [{ number: 1, startedAt: at(1), finishedAt: at(100), tickets: ['e/01'], session }] }

    const raw = counted(false)
    const small = counted(true)
    const full = await readRunTranscripts(run, { env: { WORFY_CLAUDE_HOME: claude }, readLines: raw.read })
    expect(full.work.map((fact) => [fact.name, fact.start, fact.end])).toEqual([
      ['impl-01', at(4), at(41)],
      ['impl-01', at(42), at(58)],
      ['verify-01', at(61), at(70)],
      ['second look', at(71), at(72)],
    ])
    expect(full.work[0]?.pr).toBe(12)
    expect(full.work.slice(2).map((fact) => [fact.verdict, fact.outcome])).toEqual([
      ['REJECTED', 'rejected'],
      [undefined, 'failed'],
    ])
    expect(full.turns.map((turn) => [turn.start, turn.tickets])).toEqual([
      [at(1), ['e/01']],
      [at(8), ['e/01']],
      [at(80), ['e/01']],
    ])
    expect(full.turns.length).toBeGreaterThan(0)
    expect(await readRunTranscripts(run, { env: { WORFY_CLAUDE_HOME: claude }, readLines: small.read })).toEqual(full)
    expect(small.chars()).toBeLessThan(raw.chars() / 100)
  })
})

// The incremental facts of a live Run (worfy-flight-recorder ticket 27): a parse that keeps its state
// takes only the lines that came since the last step, and gives the facts a parse of all the lines
// gives, field for field, wherever the lines are cut.
describe('the facts of a transcript parsed in parts (TranscriptParse, worfy-flight-recorder ticket 27)', () => {
  const NIGHT_DIR = join(FIXTURE, 'projects', DIR)

  /** A file's lines compacted, as a live Run keeps them (TranscriptCompactor). */
  const compacted = async (file: string): Promise<string[]> => {
    const compactor = new TranscriptCompactor()
    return ((await streamLines(file)) ?? []).flatMap((each) => compactor.line(each) ?? [])
  }

  /** The night Run's Orchestrator lines and its Subagents' files, compacted as a live Run reads them. */
  async function nightFiles(): Promise<{ lines: string[]; subagents: Map<string, SubagentLines> }> {
    const lines = await compacted(join(NIGHT_DIR, `${SESSION}.jsonl`))
    const subagents = new Map<string, SubagentLines>()
    for (const name of await readdir(join(NIGHT_DIR, SESSION, 'subagents'))) {
      const id = /^agent-([a-z0-9]+)\.jsonl$/u.exec(name)?.[1]
      if (id === undefined) continue
      const meta = await readFile(join(NIGHT_DIR, SESSION, 'subagents', `agent-${id}.meta.json`), 'utf8').then(JSON.parse, () => null)
      subagents.set(id, { meta, lines: await compacted(join(NIGHT_DIR, SESSION, 'subagents', name)) })
    }
    return { lines, subagents }
  }

  /** A parse fed in the given parts, its Subagents' files cut at the same share of their lines. */
  function inParts(lines: readonly string[], subagents: ReadonlyMap<string, SubagentLines>, cuts: readonly number[]) {
    const parse = new TranscriptParse()
    const own = new Map([...subagents].map(([id]) => [id, new SubagentParse()]))
    const taken = new Map([...subagents].map(([id]) => [id, 0]))
    let from = 0
    for (const cut of [...cuts, lines.length]) {
      parse.append(lines.slice(from, cut))
      for (const [id, file] of subagents) {
        const upTo = lines.length === 0 ? file.lines.length : Math.round((file.lines.length * cut) / lines.length)
        own.get(id)!.append(file.lines.slice(taken.get(id), upTo))
        taken.set(id, upTo)
      }
      from = cut
    }
    return { parse, subagents: new Map([...subagents].map(([id, file]) => [id, { meta: file.meta, parse: own.get(id)! }])) }
  }

  it('on the night Run, cut at every line boundary, gives the facts of the whole transcript', async () => {
    const { lines, subagents } = await nightFiles()
    const tickets = NIGHT.waves.flatMap((wave) => wave.tickets)
    const whole = transcriptFacts({ session: SESSION, epic: NIGHT.epic, tickets, lines, subagents })
    expect(whole.work).toHaveLength(15)
    for (let cut = 0; cut <= lines.length; cut++) {
      const parsed = inParts(lines, subagents, [cut])
      expect(parsed.parse.facts({ session: SESSION, epic: NIGHT.epic, tickets, subagents: parsed.subagents }), `cut at line ${cut}`).toEqual(whole)
    }
  })

  it('on a small Session shaped like a real one, cut at every line boundary, gives the facts of the whole', () => {
    // Some of its records name no folder (queue operations, a verifier's call): a part may start with one.
    const session = shapedSession({ sessionId: SESSION, cwd: ROOT, epic: 'e', turns: 60, start: Date.parse('2026-11-01T00:00:00.000Z'), toolResultBytes: 20, promptBytes: 40, reportBytes: 20, subagentRecords: 6, subagentRecordBytes: 20, seed: 9 })
    expect(session.lines.filter((each) => !each.includes('"cwd"')).length).toBeGreaterThan(5)
    const whole = transcriptFacts({ session: SESSION, epic: 'e', tickets: session.tickets, lines: session.lines, subagents: session.subagents })
    for (let cut = 0; cut <= session.lines.length; cut++) {
      const parsed = inParts(session.lines, session.subagents, [cut])
      expect(parsed.parse.facts({ session: SESSION, epic: 'e', tickets: session.tickets, subagents: parsed.subagents }), `cut at line ${cut}`).toEqual(whole)
    }
  })

  it('on a Session shaped like a real one, step by step: after each part, the facts of all the lines so far', () => {
    const session = shapedSession({ sessionId: SESSION, cwd: ROOT, epic: 'e', turns: 160, start: Date.parse('2026-11-01T00:00:00.000Z'), toolResultBytes: 50, promptBytes: 80, reportBytes: 40, subagentRecordBytes: 20, seed: 7 })
    expect(session.agents).toBeGreaterThan(40)
    const ms = (line: string): number => Date.parse((JSON.parse(line) as { timestamp: string }).timestamp)
    const parse = new TranscriptParse()
    const own = new Map<string, { parse: SubagentParse; taken: number }>()
    // Parts of 1 to 40 lines, the same every run.
    let seed = 11
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % 40
    let from = 0
    let steps = 0
    while (from < session.lines.length) {
      const cut = Math.min(session.lines.length, from + 1 + next())
      parse.append(session.lines.slice(from, cut))
      from = cut
      steps += 1
      // What lies on disk at this point: the Orchestrator's lines so far, each Subagent's records up to
      // the last time they name, and the meta of a Subagent once its first record is there, one part late.
      const upTo = ms(session.lines[cut - 1]!)
      const prefix = new Map<string, SubagentLines>()
      const parts = new Map<string, { meta: unknown; parse: SubagentParse }>()
      for (const [id, file] of session.subagents) {
        const count = file.lines.filter((line) => ms(line) <= upTo).length
        if (count === 0) continue
        const entry = own.get(id) ?? { parse: new SubagentParse(), taken: 0 }
        entry.parse.append(file.lines.slice(entry.taken, count))
        const late = entry.taken === 0
        entry.taken = count
        own.set(id, entry)
        const meta = late ? null : file.meta
        prefix.set(id, { meta, lines: file.lines.slice(0, count) })
        parts.set(id, { meta, parse: entry.parse })
      }
      // The Tickets the Waves so far named: a new Wave adds its Tickets to the Run.
      const lines = session.lines.slice(0, cut)
      const tickets = session.tickets.slice(0, 2 * lines.filter((line) => line.includes('<command-name>/worfy:epic-wave')).length)
      const whole = transcriptFacts({ session: SESSION, epic: 'e', tickets, lines, subagents: prefix })
      expect(parse.facts({ session: SESSION, epic: 'e', tickets, subagents: parts }), `after line ${cut}`).toEqual(whole)
      const inside = (at: string) => Date.parse(at) >= upTo - 3_600_000
      expect([...parse.agentIdsIn(inside)], `ids after line ${cut}`).toEqual([...agentIdsIn(lines, inside)])
    }
    expect(steps).toBeGreaterThan(50)
    const last = transcriptFacts({ session: SESSION, epic: 'e', tickets: session.tickets, lines: session.lines, subagents: session.subagents })
    // The Session holds what it is shaped for: reworks, verdicts, failures, restarts and turns with Tickets.
    expect(last.work.some((fact) => fact.id.endsWith('#2'))).toBe(true)
    expect(last.work.some((fact) => fact.outcome === 'rejected')).toBe(true)
    expect(last.work.some((fact) => fact.outcome === 'failed')).toBe(true)
    expect(last.work.some((fact) => fact.outcome === 'cut-off')).toBe(true)
    expect(last.work.some((fact) => fact.end === null)).toBe(true)
    expect(last.turns.filter((turn) => turn.tickets.length > 0).length).toBeGreaterThan(30)
  })

  it('at random cuts of a large shaped Session, in many parts at once, gives the facts of the whole', () => {
    const session = shapedSession({ sessionId: SESSION, cwd: ROOT, epic: 'e', turns: 800, start: Date.parse('2026-11-01T00:00:00.000Z'), toolResultBytes: 50, promptBytes: 80, reportBytes: 40, subagentRecordBytes: 20, seed: 3 })
    const whole = transcriptFacts({ session: SESSION, epic: 'e', tickets: session.tickets, lines: session.lines, subagents: session.subagents })
    let seed = 5
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % session.lines.length
    for (let round = 0; round < 12; round++) {
      const cuts = [...new Set(Array.from({ length: 1 + (round % 7) }, next))].sort((a, b) => a - b)
      const parsed = inParts(session.lines, session.subagents, cuts)
      expect(parsed.parse.facts({ session: SESSION, epic: 'e', tickets: session.tickets, subagents: parsed.subagents }), `cuts ${cuts.join(', ')}`).toEqual(whole)
    }
    // Asked for a window only, it builds the facts that start in it, the same as the whole has. The
    // window starts at a rework: the agent's first span lies before it and stays out.
    const from = Date.parse(whole.work.filter((fact) => fact.id.endsWith('#2'))[0]!.start)
    const inside = (at: string) => Date.parse(at) >= from && Date.parse(at) <= from + 6 * 3_600_000
    const parsed = inParts(session.lines, session.subagents, [Math.floor(session.lines.length / 3)])
    const windowed = parsed.parse.facts({ session: SESSION, epic: 'e', tickets: session.tickets, subagents: parsed.subagents, inside })
    expect(windowed).toEqual({ work: whole.work.filter((fact) => inside(fact.start)), turns: whole.turns.filter((turn) => inside(turn.start)) })
    expect(windowed.work.length).toBeGreaterThan(10)
    expect(windowed.work.length).toBeLessThan(whole.work.length)
    expect(windowed.work.some((fact) => fact.id.endsWith('#2') && !windowed.work.some((other) => other.id === fact.id.replace(/#2$/u, '#1')))).toBe(true)
  })

  it('the facts of a parse are the same each time they are asked for', () => {
    const session = shapedSession({ sessionId: SESSION, cwd: ROOT, epic: 'e', turns: 100, start: Date.parse('2026-11-01T00:00:00.000Z'), toolResultBytes: 50, promptBytes: 80, reportBytes: 40, subagentRecordBytes: 20 })
    const parsed = inParts(session.lines, session.subagents, [])
    const input = { session: SESSION, epic: 'e', tickets: session.tickets, subagents: parsed.subagents }
    const first = parsed.parse.facts(input)
    // The reader in main sets the Ticket of a fact it places: the parse's own state stays as it was.
    for (const fact of first.work) fact.ticket = 'e/99'
    expect(parsed.parse.facts(input)).toEqual(transcriptFacts({ session: SESSION, epic: 'e', tickets: session.tickets, lines: session.lines, subagents: session.subagents }))
  })
})

describe('the reader on a live Run keeps one parse per file (TranscriptParses, worfy-flight-recorder ticket 27)', () => {
  async function liveHome(name: string) {
    const claude = await home(name, false)
    const dir = join(claude, 'projects', DIR)
    await mkdir(dir, { recursive: true })
    const session = 'cccccccc-0000-4000-8000-000000000027'
    const shaped = shapedSession({ sessionId: session, cwd: ROOT, epic: 'e', turns: 120, start: Date.parse('2026-11-01T00:00:00.000Z'), toolResultBytes: 200, promptBytes: 200, reportBytes: 100, subagentRecordBytes: 50 })
    writeShapedSession(dir, shaped, session)
    const run: TranscriptRun = { epic: 'e', root: ROOT, startedAt: new Date(Date.parse('2026-11-01T00:00:00.000Z') - 1_000).toISOString(), stoppedAt: null, waves: [{ number: 1, startedAt: '2026-11-01T00:00:00.000Z', finishedAt: null, tickets: shaped.tickets, session }] }
    return { claude, dir, session, shaped, run, file: join(dir, `${session}.jsonl`) }
  }
  const answer = (at: string, text: string) => `${line({ type: 'assistant', timestamp: at, cwd: ROOT, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`

  it('parses only the lines appended since the last read, with the facts of a whole read', async () => {
    const world = await liveHome('live-parse')
    const tail = new TailLines()
    const options = { env: { WORFY_CLAUDE_HOME: world.claude }, readLines: tail.read, parses: tail.parses }
    const whole = () => readRunTranscripts(world.run, { env: { WORFY_CLAUDE_HOME: world.claude } })
    expect(await readRunTranscripts(world.run, options)).toEqual(await whole())
    expect(tail.parses.last.get(world.file)).toEqual({ from: 'start', lines: world.shaped.lines.length })
    // Two answers and a new prompt: three lines parsed, not the file.
    const end = new Date(world.shaped.end + 1_000).toISOString()
    await appendFile(world.file, answer(end, 'one') + answer(end, 'two') + `${line({ type: 'user', timestamp: end, cwd: ROOT, isSidechain: false, message: { role: 'user', content: '/worfy:epic-wave tickets 90 of epic e' } })}\n`)
    expect(await readRunTranscripts(world.run, options)).toEqual(await whole())
    expect(tail.parses.last.get(world.file)).toEqual({ from: 'cursor', lines: 3 })
    // Nothing new: nothing parsed.
    expect(await readRunTranscripts(world.run, options)).toEqual(await whole())
    expect(tail.parses.last.get(world.file)).toEqual({ from: 'cursor', lines: 0 })
    // A Subagent's file grew: only its new line.
    const [id] = [...world.shaped.subagents.keys()].slice(-1)
    const agentFile = join(world.dir, world.session, 'subagents', `agent-${id}.jsonl`)
    await appendFile(agentFile, `${JSON.stringify({ type: 'assistant', timestamp: end, cwd: ROOT, isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'more' }] } })}\n`)
    expect(await readRunTranscripts(world.run, options)).toEqual(await whole())
    expect(tail.parses.last.get(agentFile)).toEqual({ from: 'cursor', lines: 1 })
  })

  it('a truncated or replaced file is parsed again from its start', async () => {
    const world = await liveHome('live-reset')
    const tail = new TailLines()
    const options = { env: { WORFY_CLAUDE_HOME: world.claude }, readLines: tail.read, parses: tail.parses }
    const whole = () => readRunTranscripts(world.run, { env: { WORFY_CLAUDE_HOME: world.claude } })
    await readRunTranscripts(world.run, options)
    // Truncated to its first half, then a line appended: what was parsed of the rest is gone.
    const half = world.shaped.lines.slice(0, Math.floor(world.shaped.lines.length / 2))
    await writeFile(world.file, half.join('\n') + '\n')
    const shorter = await readRunTranscripts(world.run, options)
    expect(shorter).toEqual(await whole())
    expect(tail.parses.last.get(world.file)).toEqual({ from: 'start', lines: half.length })
    expect(shorter.work.length).toBeLessThan((await readRunTranscripts(world.run, { env: { WORFY_CLAUDE_HOME: world.claude }, readLines: async (file) => (file === world.file ? world.shaped.lines : streamLines(file)) })).work.length)
    // Replaced by another file of the same length or longer: read again from its start, not on from the cursor.
    const other = join(world.dir, 'other.tmp')
    await writeFile(other, world.shaped.lines.join('\n') + '\n')
    await rename(other, world.file)
    expect(await readRunTranscripts(world.run, options)).toEqual(await whole())
    expect(tail.parses.last.get(world.file)).toEqual({ from: 'start', lines: world.shaped.lines.length })
  })

  it('a read that fails on a later chunk keeps nothing of it: the next read takes those lines once', async () => {
    const claude = await home('tail-fail', false)
    const file = join(claude, 'one.jsonl')
    const rec = (n: number) => `${line({ type: 'assistant', timestamp: new Date(Date.parse('2026-11-01T00:00:00.000Z') + n * 1_000).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: `answer ${n} ${'x'.repeat(40)}` }] } })}\n`
    await writeFile(file, rec(1) + rec(2))
    // Chunks of at most 100 bytes: one line each; the second chunk of the second read fails.
    let calls = 0
    let failAt = -1
    const tail: typeof readNewLines = async (path, cursor) => {
      calls += 1
      if (calls === failAt) throw Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' })
      return readNewLines(path, cursor, { maxBytes: 100 })
    }
    const lines = new TailLines(tail)
    const first = await lines.read(file)
    expect(first).toHaveLength(2)
    await appendFile(file, rec(3) + rec(4) + rec(5))
    failAt = calls + 2
    await expect(lines.read(file)).rejects.toThrow('EIO')
    // The array handed out before is as it was, and the next read grows it by the three new lines.
    expect(first).toHaveLength(2)
    const after = await lines.read(file)
    expect(after).toBe(first)
    const compactor = new TranscriptCompactor()
    expect(after).toEqual(((await streamLines(file)) ?? []).map((each) => compactor.line(each)))
  })

  /** A line source over the files that fails on one Subagent's file and counts what it is asked for. */
  function failingSource(failing: string, options: { slowMeta?: boolean; delay?: number } = {}) {
    const state = { failed: false, afterFailure: 0, running: 0, metaDone: false, settledAfter: -1 }
    const readLines: ReadLines = async (file) => {
      if (state.failed) state.afterFailure += 1
      state.running += 1
      try {
        if (file === failing) {
          state.failed = true
          throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
        }
        if (file === failing.replace(/\.jsonl$/u, '.meta.json')) {
          if (options.slowMeta === true) await new Promise((resolve) => setTimeout(resolve, 50))
          state.metaDone = true
        } else if (options.delay !== undefined) await new Promise((resolve) => setTimeout(resolve, options.delay))
        return await streamLines(file)
      } finally {
        state.running -= 1
      }
    }
    return { state, readLines }
  }

  it('a Subagent read that fails stops the reads of the step: no file is started after it, none runs on', async () => {
    const world = await liveHome('read-fail')
    const ids = [...world.shaped.subagents.keys()]
    expect(ids.length).toBeGreaterThan(40)
    const source = failingSource(join(world.dir, world.session, 'subagents', `agent-${ids[5]}.jsonl`), { delay: 5 })
    await expect(
      readRunTranscripts(world.run, { env: { WORFY_CLAUDE_HOME: world.claude }, readLines: source.readLines }).finally(() => {
        source.state.settledAfter = source.state.afterFailure
      }),
    ).rejects.toThrow('EACCES')
    // Nothing is under way when the read rejects.
    expect(source.state.running).toBe(0)
    // Only what the other 15 workers had started may have finished; nothing new started, then or later.
    expect(source.state.settledAfter).toBeLessThanOrEqual(2 * 15)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(source.state.afterFailure).toBe(source.state.settledAfter)
  })

  it('a Subagent file that fails waits for its meta before the read rejects', async () => {
    const world = await liveHome('read-fail-meta')
    const [id] = [...world.shaped.subagents.keys()]
    const source = failingSource(join(world.dir, world.session, 'subagents', `agent-${id}.jsonl`), { slowMeta: true })
    await expect(readRunTranscripts(world.run, { env: { WORFY_CLAUDE_HOME: world.claude }, readLines: source.readLines })).rejects.toThrow('EACCES')
    expect(source.state.metaDone).toBe(true)
    expect(source.state.running).toBe(0)
  })

  it('keeps the facts that start at the edges of the Run\'s window, and none a millisecond outside', async () => {
    const claude = await home('window-edges', false)
    const dir = join(claude, 'projects', DIR)
    await mkdir(dir, { recursive: true })
    const session = 'dddddddd-0000-4000-8000-000000000027'
    const started = Date.parse('2026-11-01T10:00:00.000Z')
    const finished = Date.parse('2026-11-01T11:00:00.000Z')
    const iso = (ms: number) => new Date(ms).toISOString()
    // The window: from PROMPT_LEAD_MS before wave-started to wave-finished, both ends in.
    const edges = [started - PROMPT_LEAD_MS - 1, started - PROMPT_LEAD_MS, finished, finished + 1]
    const lines = edges.flatMap((at, n) => [
      line({ type: 'user', timestamp: iso(at), cwd: ROOT, isSidechain: false, message: { role: 'user', content: `prompt ${n}` } }),
      line({ type: 'assistant', timestamp: iso(at), cwd: ROOT, isSidechain: false, message: { role: 'assistant', content: [{ type: 'tool_use', id: `call-${n}`, name: 'Agent', input: { name: `impl-0${n + 1}`, prompt: 'go', run_in_background: true } }] } }),
    ])
    await writeFile(join(dir, `${session}.jsonl`), lines.join('\n') + '\n')
    const run: TranscriptRun = { epic: 'e', root: ROOT, startedAt: iso(started - 60_000), stoppedAt: iso(finished), waves: [{ number: 1, startedAt: iso(started), finishedAt: iso(finished), tickets: [], session }] }
    const facts = await readRunTranscripts(run, { env: { WORFY_CLAUDE_HOME: claude } })
    expect(facts.work.map((fact) => fact.start)).toEqual([iso(edges[1]!), iso(edges[2]!)])
    expect(facts.turns.map((turn) => turn.start)).toEqual([iso(edges[1]!), iso(edges[2]!)])
  })

  it('a parse is let go with its file: a Session the Run no longer reads, or a cleared line source', async () => {
    const world = await liveHome('live-drop')
    const parses = new TranscriptParses()
    const tail = new TailLines()
    await readRunTranscripts(world.run, { env: { WORFY_CLAUDE_HOME: world.claude }, readLines: tail.read, parses })
    expect(parses.size).toBe(1)
    await readRunTranscripts({ ...world.run, waves: [] }, { env: { WORFY_CLAUDE_HOME: world.claude }, readLines: tail.read, parses })
    expect(parses.size).toBe(0)
    await readRunTranscripts(world.run, { env: { WORFY_CLAUDE_HOME: world.claude }, readLines: tail.read, parses: tail.parses })
    expect(tail.parses.size).toBe(1)
    tail.clear()
    expect(tail.parses.size).toBe(0)
  })
})
