// The Work track service (src/main/work-track/service.ts, harness-state.ts; worfy-work-track ticket 08) on
// fixtures built in a temporary folder: a Project repository with a Ticket whose status changes, a Run
// journal with one Wave, the Harness home with the Wave markers (of the Run's Wave and of a Wave sent by
// hand) and gate records (of the Project's worktree and of another Project's), a Claude home with three
// Sessions of the Project, and a stand-in for gh. Every fact of every source comes in the answer, the Run's
// Wave and its marker are one Wave, a source that fails is a gap while the rest still comes, and nothing in
// the Claude home, the Harness home or the repository changes (ADR-0005).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, realpath, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectDirName } from '../../src/main/claude-home/registry'
import { TIMINGS_KEPT_MS } from '../../src/main/flight-recorder/gate-logs'
import { GATE_GAP_WHY } from '../../src/main/work-track/harness-state'
import { WorkTrackService, type WorkTrackOptions } from '../../src/main/work-track/service'
import { TranscriptCache, type CanvasSession } from '../../src/main/work-track/transcripts'
import { formatJournalLine, makeRunId, type JournalEvent } from '../../src/shared/autopilot/journal'
import { workTrackViewSchema, type WorkTrackView } from '../../src/shared/ipc/work-track'
import type { Period } from '../../src/shared/work-track/facts'
import { removeTestTree } from '../remove'

const PROJECT = 'demo-0a1b2c3d'
const HARNESS_PROJECT = 'demo'
const NOW = Date.parse('2026-03-06T12:00:00.000Z')
/** A local midnight, as a period starts (src/shared/work-track/facts.ts). */
const midnight = (month: number, day: number): string => new Date(2026, month - 1, day).toISOString()
const WEEK: Period = { kind: 'week', start: midnight(3, 2) }
const A = 'a0a0a0a0-0000-4000-8000-000000000001'
const B = 'b0b0b0b0-0000-4000-8000-000000000002'
const C = 'c0c0c0c0-0000-4000-8000-000000000003'
const RUN = makeRunId(new Date('2026-03-04T08:00:00.000Z'), 'aaaaaa')
const CANVAS: CanvasSession[] = [
  { id: A, title: 'Orchestrator', hidden: false },
  { id: B, title: 'Side quest', hidden: true },
]

let base: string
let repo: string
let claude: string
let harness: string
let data: string

// No auto maintenance: git 2.56 may start it detached after a commit, and its .git/objects/maintenance.lock
// comes and goes while a test compares the repository's files (#1510).
function git(cwd: string, at: string, ...args: string[]): string {
  const env = { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at }
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'maintenance.auto=false', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/** A Session's transcript: one prompt and its answer, the file dated by its last record. */
async function session(id: string, cwd: string, from: string, to: string): Promise<void> {
  const file = join(claude, 'projects', projectDirName(repo), `${id}.jsonl`)
  const line = (type: 'user' | 'assistant', timestamp: string, content: unknown) => JSON.stringify({ type, sessionId: id, cwd, timestamp, isSidechain: false, message: { role: type, content } })
  await put(file, `${line('user', from, `SECRET-PROMPT-${id}`)}\n${line('assistant', to, [{ type: 'text', text: `SECRET-ANSWER-${id}` }])}\n`)
  await utimes(file, new Date(to), new Date(to))
}

/** A gate record, as gate-log.mjs writes it: the run folder named by its start. */
async function gateRun(tag: string, worktree: string, end: string, totalMs = 300_000): Promise<void> {
  const start = new Date(Date.parse(end) - totalMs)
  const name = `${start.toISOString().replace(/\.\d+Z$/u, 'Z').replaceAll(':', '-')}-4242`
  const record = { version: 1, profile: 'fast', worktree, head: 'f'.repeat(40), outcome: 'green', at: end, total_ms: totalMs, steps: [{ step: 'lint', script: 'lint', ms: 60_000, exit: 0 }], cached: [] }
  await put(join(harness, 'gate', 'state', 'logs', tag, name, 'timings.json'), JSON.stringify(record))
}

/** A Wave log of epic-wave: its start marker, its end marker. */
async function marker(folder: string, rows: readonly [string, string, string][]): Promise<void> {
  await put(join(harness, 'runs', HARNESS_PROJECT, folder, 'decisions.tsv'), `time_utc\tdecision\twhy\tevidence\n${rows.map((row) => `${row.join('\t')}\t-\n`).join('')}`)
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'worfy-wt-service-')))
  repo = join(base, 'repo')
  claude = join(base, 'claude')
  harness = join(base, 'harness')
  data = join(base, 'data')

  // The repository: Ticket e/05 open before the period, claimed in it.
  await mkdir(join(repo, '.claude', 'worktrees', '07'), { recursive: true })
  git(repo, '2026-03-01T09:00:00Z', 'init', '-q', '-b', 'main')
  await put(join(repo, '.scratch', 'e', 'issues', '05-five.md'), '# 05\n\nStatus: open\n')
  git(repo, '2026-03-01T09:00:00Z', 'add', '.')
  git(repo, '2026-03-01T09:00:00Z', 'commit', '-q', '-m', 'docs: ticket 05')
  await put(join(repo, '.scratch', 'e', 'issues', '05-five.md'), '# 05\n\nStatus: claimed\n')
  git(repo, '2026-03-04T08:05:00Z', 'commit', '-q', '-am', 'docs: claim 05')
  git(repo, '2026-03-04T08:05:00Z', 'remote', 'add', 'origin', 'https://github.com/example-org/example-repo.git')

  // The Run: one Wave of Ticket 05 sent to Session A.
  const head = { run: RUN, project: PROJECT, epic: 'e' }
  const events = [
    { ...head, at: '2026-03-04T08:00:00.000Z', kind: 'run-started' },
    { ...head, at: '2026-03-04T08:00:01.000Z', kind: 'wave-started', wave: 1, tickets: ['05'], session: A },
    { ...head, at: '2026-03-04T10:00:00.000Z', kind: 'wave-finished', wave: 1, tickets: ['05'] },
    { ...head, at: '2026-03-04T10:05:00.000Z', kind: 'run-stopped', reason: 'tickets-done' },
  ]
  await put(join(data, 'autopilot', `${RUN}.jsonl`), events.map((event) => formatJournalLine(event as JournalEvent)).join(''))

  // The Wave markers: the Run's Wave, and Wave 06 sent by hand.
  await marker('e-wave-20260304T080010Z', [
    ['2026-03-04T08:00:10Z', 'wave-started', '05'],
    ['2026-03-04T09:58:00Z', 'wave-finished', 'merged 1'],
  ])
  await marker('e-wave-20260305T090000Z', [
    ['2026-03-05T09:00:00Z', 'wave-started', '06'],
    ['2026-03-05T10:00:00Z', 'ticket-left-wave', 'blocked by 05'],
    ['2026-03-05T11:00:00Z', 'wave-finished', 'merged 0'],
  ])

  // The gate: a run in the Project's worktree 07, an older one in its root, one in another Project's folder.
  await gateRun('aaaa1111', join(repo, '.claude', 'worktrees', '07'), '2026-03-05T10:30:00.000Z')
  await gateRun('cccc3333', repo, '2026-02-20T12:00:00.000Z')
  await mkdir(join(base, 'other'), { recursive: true })
  await gateRun('bbbb2222', join(base, 'other'), '2026-03-05T10:40:00.000Z')

  // Three Sessions: the Orchestrator in the Run's Wave, a hidden one, one with no Node in the worktree 07.
  await session(A, repo, '2026-03-04T08:10:00.000Z', '2026-03-04T08:20:00.000Z')
  await session(B, repo, '2026-03-04T13:00:00.000Z', '2026-03-04T13:30:00.000Z')
  await session(C, join(repo, '.claude', 'worktrees', '07'), '2026-03-05T09:30:00.000Z', '2026-03-05T10:00:00.000Z')
})

afterEach(() => {
  removeTestTree(base)
})

/** gh as the account would answer: PR #12 of branch e/05 merged in the Run's Wave, its CI run. */
const gh: WorkTrackOptions['gh'] = async (_root, args) => {
  if (args[1] === 'graphql') {
    const pr = { number: 12, title: 'Five', headRefName: 'e/05', createdAt: '2026-03-04T08:30:00Z', mergedAt: '2026-03-04T09:50:00Z', mergeCommit: { oid: 'm'.repeat(40) }, commits: { nodes: [{ commit: { oid: 'h'.repeat(40) } }] } }
    return JSON.stringify({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [pr] } } })
  }
  const run = { id: 1, name: 'CI', head_branch: 'e/05', head_sha: 'h'.repeat(40), status: 'completed', conclusion: 'success', created_at: '2026-03-04T09:00:00Z', run_started_at: '2026-03-04T09:00:00Z', updated_at: '2026-03-04T09:10:00Z', pull_requests: [{ number: 12 }] }
  return JSON.stringify({ total_count: 1, workflow_runs: [run] })
}

function service(over: Partial<WorkTrackOptions> = {}): WorkTrackService {
  return new WorkTrackService({
    env: { WORFY_DATA_DIR: data, WORFY_CLAUDE_HOME: claude },
    harnessHome: harness,
    projectRoot: (projectId) => {
      if (projectId !== PROJECT) throw new Error(`no Project ${projectId}`)
      return repo
    },
    harnessProject: async () => HARNESS_PROJECT,
    canvas: async () => CANVAS,
    gh,
    running: () => false,
    codex: () => null,
    transcriptCache: new TranscriptCache(),
    now: () => NOW,
    ...over,
  })
}

const brief = (view: WorkTrackView) => view.facts.map((fact) => [fact.kind, fact.source, fact.title, fact.start, fact.end, fact.session, fact.epic ?? null, fact.parent ?? null])

describe('the Work track of a Project', () => {
  it('gives every fact of every source: the Run, a Wave sent by hand, the turns of three Sessions, the PR, CI, gate and the status change', async () => {
    const view = await service().read(PROJECT, WEEK, { wait: true })
    expect(() => workTrackViewSchema.parse(view)).not.toThrow()
    expect(view.loading).toEqual([])
    expect(view.gaps).toEqual([])
    const runId = `run:${RUN}`
    const waveId = `wave:${RUN}:1`
    const facts = brief(view)
    expect(facts).toEqual(
      expect.arrayContaining([
        ['run', 'journal', 'Run · e', '2026-03-04T08:00:00.000Z', '2026-03-04T10:05:00.000Z', null, 'e', null],
        ['wave', 'journal', 'Wave 1 · tickets 05', '2026-03-04T08:00:01.000Z', '2026-03-04T10:00:00.000Z', A, 'e', runId],
        ['wave', 'wave-marker', 'Wave · tickets 06', '2026-03-05T09:00:00.000Z', '2026-03-05T11:00:00.000Z', null, 'e', null],
        // The Orchestrator's turn in the Run's Wave takes the Wave, and its Epic, as its parent.
        ['turn', 'transcript', expect.any(String), '2026-03-04T08:10:00.000Z', '2026-03-04T08:20:00.000Z', A, null, waveId],
        ['turn', 'transcript', expect.any(String), '2026-03-04T13:00:00.000Z', '2026-03-04T13:30:00.000Z', B, null, null],
        ['turn', 'transcript', expect.any(String), '2026-03-05T09:30:00.000Z', '2026-03-05T10:00:00.000Z', C, null, null],
        ['pr', 'github', '#12 Five', '2026-03-04T08:30:00Z', '2026-03-04T09:50:00Z', null, 'e', null],
        ['ci', 'github', 'CI', '2026-03-04T09:00:00Z', '2026-03-04T09:10:00Z', null, 'e', null],
        ['gate', 'gate-log', 'gate fast', '2026-03-05T10:25:00.000Z', '2026-03-05T10:30:00.000Z', null, null, null],
        ['ticket-status', 'git', '05 open → claimed', '2026-03-04T08:05:00.000Z', '2026-03-04T08:05:00.000Z', null, 'e', null],
      ]),
    )
    // The Run's Wave and its marker are one Wave; the gate run of another Project is not here.
    expect(view.facts.filter((fact) => fact.kind === 'wave')).toHaveLength(2)
    expect(view.facts.filter((fact) => fact.kind === 'gate')).toHaveLength(1)
    expect(view.sessions.map((info) => [info.id, info.name, info.hidden, info.archived])).toEqual([
      [A, 'Orchestrator', false, false],
      [B, 'Side quest', true, false],
      [C, expect.stringContaining('Session c0c0'), false, true],
    ])
    // Only names: no text of a prompt or an answer.
    expect(JSON.stringify(view)).not.toContain('SECRET')
    // The summary: one merged PR, one Run; the hours of work are the union of Waves and turns.
    expect(view.summary.prsMerged).toBe(1)
    expect(view.summary.runs).toBe(1)
    expect(view.summary.byEpic[0]).toEqual({ epic: 'e', ms: expect.any(Number) })
  })

  it('changes no file in the Claude home, the Harness home or the repository (ADR-0005)', async () => {
    const snapshot = async (): Promise<string[]> => {
      const entries = await readdir(base, { recursive: true, withFileTypes: true })
      return Promise.all(
        entries
          .map((entry) => join(entry.parentPath, entry.name))
          .sort()
          .map(async (path) => {
            const info = await stat(path)
            const hash = info.isFile() ? createHash('sha1').update(await readFile(path)).digest('hex') : 'dir'
            return `${path} ${info.size} ${info.mtimeMs} ${hash}`
          }),
      )
    }
    const before = await snapshot()
    const work = service()
    await work.read(PROJECT, WEEK)
    await work.read(PROJECT, WEEK, { wait: true })
    await work.read(PROJECT, { kind: 'month', start: midnight(3, 1) }, { wait: true })
    expect(await snapshot()).toEqual(before)
  })

  it('gives the part of the period before the gate keeps its records as a gap', async () => {
    const month: Period = { kind: 'month', start: midnight(2, 1) }
    const view = await service().read(PROJECT, month, { wait: true })
    // The oldest record of the Project is later than the 31 days: no data before it.
    expect(view.gaps.filter((gap) => gap.source === 'gate-log')).toEqual([{ source: 'gate-log', start: month.start, end: '2026-02-20T11:55:00.000Z', why: GATE_GAP_WHY }])
    expect(view.facts.filter((fact) => fact.kind === 'gate').map((fact) => fact.end)).toEqual(['2026-02-20T12:00:00.000Z'])
    // A record older than the limit: no data before the limit.
    await gateRun('aaaa1111', join(repo, '.claude', 'worktrees', '07'), '2026-02-01T12:00:00.000Z')
    const older = await service().read(PROJECT, month, { wait: true })
    expect(older.gaps.filter((gap) => gap.source === 'gate-log')).toEqual([{ source: 'gate-log', start: month.start, end: new Date(NOW - TIMINGS_KEPT_MS).toISOString(), why: GATE_GAP_WHY }])
    expect(older.summary.gapCount).toBeGreaterThan(0)
    // A Week inside the limit has no gate gap.
    expect((await service().read(PROJECT, WEEK, { wait: true })).gaps).toEqual([])
  })

  it('gives GitHub that does not answer as a gap, and every other source still', async () => {
    const view = await service({
      gh: async () => {
        throw new Error('could not resolve host: api.github.com')
      },
    }).read(PROJECT, WEEK, { wait: true })
    const github = view.gaps.filter((gap) => gap.source === 'github')
    expect(github).toHaveLength(1)
    expect(github[0]?.why).toContain('GitHub did not answer: could not resolve host')
    expect(view.facts.some((fact) => fact.source === 'github')).toBe(false)
    expect(new Set(view.facts.map((fact) => fact.kind))).toEqual(new Set(['run', 'wave', 'turn', 'gate', 'ticket-status']))
  })

  it('answers without the transcripts while they are read and names them in `loading`; `wait` answers with them', async () => {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const work = service({
      canvas: async () => {
        await held
        return CANVAS
      },
    })
    const first = await work.read(PROJECT, WEEK)
    expect(first.loading).toContain('transcripts')
    expect(first.facts.some((fact) => fact.kind === 'turn')).toBe(false)
    expect(first.facts.some((fact) => fact.kind === 'run')).toBe(true)
    const waiting = work.read(PROJECT, WEEK, { wait: true })
    release()
    const full = await waiting
    expect(full.loading).toEqual([])
    expect(full.facts.filter((fact) => fact.kind === 'turn')).toHaveLength(3)
  })

  it('refuses a Project that is not in the list', async () => {
    await expect(service().read('nope-00000000', WEEK)).rejects.toThrow(/no Project/)
  })
})
