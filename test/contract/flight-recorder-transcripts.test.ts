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
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectDirName } from '../../src/main/claude-home/registry'
import { readRunTranscripts, streamLines, TranscriptCompactor, WAVE_SLACK_MS, type ReadLines, type TranscriptRun } from '../../src/main/flight-recorder/transcripts'
import { canonicalWorktree } from '../../src/main/flight-recorder/worktree-path'
import { comparablePath } from '../../src/shared/flight-recorder/from-gate'
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
