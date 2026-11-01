// The gate logs and the verdicts without a PR as facts of a Run (worfy-flight-recorder ticket 16),
// against a temporary Harness home with gate run folders, a temporary git repository with the
// branches of Tickets, and the gate runs of the shared night-Run fixture. Each gate run lands on its
// Ticket through the span model (spans.ts): by `head`, and without a PR by `worktree`, the path in
// the canonical form (realpath, then on Windows one separator and no letter case). Times come from
// `at` inside timings.json, not from the file's mtime. What is gone is labelled: «gate logs deleted
// (10 runs or 8 days)», «branch deleted». Nothing is written to the Harness home or the repository.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOG_RUNS_KEPT, readGateLogs } from '../../src/main/flight-recorder/gate-logs'
import { readLocalVerdicts } from '../../src/main/flight-recorder/local-verdicts'
import { canonicalWorktree } from '../../src/main/flight-recorder/worktree-path'
import { markFilePath } from '../../src/main/workflow/marks'
import { GREEN_CACHE_NOTE } from '../../src/shared/flight-recorder/from-gate'
import { buildTimeline, LOST_SOURCE_LABELS, type RunFacts, type Span, type StageEventFact, type WorkFact } from '../../src/shared/flight-recorder/spans'
import { DEFAULT_PIPELINE, type PipelineStage } from '../../src/shared/workflow/pipeline'

const GATE_LOG = join(__dirname, '..', '..', 'harness', 'hooks', 'gate-log.mjs')
const NIGHT_HARNESS = join(__dirname, '..', 'fixtures', 'flight-recorder', 'night-run', 'harness')

const T = (hhmm: string): string => `2026-10-17T${hhmm}:00.000Z`
const RUN_END = Date.parse(T('14:00'))
const SHA = (seed: string): string => createHash('sha1').update(seed).digest('hex')

let dir: string
let harnessHome: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-fr-gate-'))
  harnessHome = join(dir, 'harness')
  mkdirSync(join(harnessHome, 'gate', 'state', 'logs'), { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

interface RunSpec {
  tag: string
  /** UTC hh:mm the run ended (`at`). */
  end: string
  worktree: string
  head: string | null
  outcome?: 'green' | 'red' | 'unverified'
  steps?: { script: string; ms: number; exit: number }[]
  totalMs?: number
}

/** A run folder as gate-log.mjs names it, from the start of the run, with its timings.json. */
function writeRun(spec: RunSpec): string {
  const steps = spec.steps ?? [
    { script: 'lint', ms: 60_000, exit: 0 },
    { script: 'typecheck', ms: 60_000, exit: 0 },
    { script: 'test', ms: 180_000, exit: 0 },
  ]
  const total = spec.totalMs ?? steps.reduce((sum, step) => sum + step.ms, 0) + 30_000
  const start = new Date(Date.parse(T(spec.end)) - total)
  const name = `${start.toISOString().replace(/\.\d+Z$/u, 'Z').replaceAll(':', '-')}-4242`
  const folder = join(harnessHome, 'gate', 'state', 'logs', spec.tag, name)
  mkdirSync(folder, { recursive: true })
  const record = {
    version: 1,
    profile: 'fast',
    key: 'worfy',
    worktree: spec.worktree,
    head: spec.head,
    outcome: spec.outcome ?? 'green',
    exit: spec.outcome === 'red' ? 2 : 0,
    at: new Date(Date.parse(T(spec.end))).toISOString().replace(/\.\d+Z$/u, 'Z'),
    total_ms: total,
    steps: steps.map((step) => ({ step: `worfy/.:${step.script}`, package: '.', ...step })),
    cached: [],
  }
  writeFileSync(join(folder, 'timings.json'), JSON.stringify(record))
  writeFileSync(join(folder, '01-worfy-lint.log'), 'ok\n')
  return folder
}

const ev = (hhmm: string, ticket: string, fields: Record<string, unknown>): StageEventFact => ({ ticket, at: T(hhmm), source: 'journal', ...fields }) as StageEventFact

function runFacts(over: Partial<RunFacts>, pipeline: readonly PipelineStage[] = DEFAULT_PIPELINE): RunFacts {
  return {
    run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: T('14:00'), live: false, outcome: 'ok' },
    now: T('14:00'),
    pipeline,
    waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('14:00'), tickets: ['e/03', 'e/05', 'e/07'] }],
    ticketEvents: [],
    work: [],
    retryCauses: [],
    waits: [],
    turns: [],
    lost: [],
    orchestratorMarks: [],
    ...over,
  }
}

const gateSpans = (spans: readonly Span[]): Span[] => spans.filter((span) => span.kind === 'gate' && span.lost === null)

/** Every folder and every file under `root`, the files with size, mtime and content hash, `.git` included. */
function treeState(root: string): Map<string, string> {
  const state = new Map<string, string>()
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        state.set(path, 'folder')
        walk(path)
      }
      else if (entry.isFile()) {
        const stat = statSync(path)
        state.set(path, `${stat.size}:${stat.mtimeMs}:${createHash('sha1').update(readFileSync(path)).digest('hex')}`)
      }
    }
  }
  walk(root)
  return state
}

describe('gate runs as facts of a Run', () => {
  it('gives two runs of one worktree with different heads each to its own Ticket, by head', async () => {
    const worktree = join(dir, 'wt', '05')
    mkdirSync(worktree, { recursive: true })
    const [A, B] = [SHA('a'), SHA('b')]
    writeRun({ tag: 'aaaa1111', end: '10:40', worktree, head: A })
    writeRun({ tag: 'aaaa1111', end: '11:40', worktree, head: B, outcome: 'red', steps: [{ script: 'lint', ms: 60_000, exit: 0 }, { script: 'typecheck', ms: 60_000, exit: 0 }, { script: 'test', ms: 180_000, exit: 1 }] })

    const read = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    expect(read.work.filter((fact) => fact.kind === 'gate').map((fact) => fact.sha)).toEqual([A, B])

    const timeline = buildTimeline(
      runFacts({
        ticketEvents: [
          ev('10:01', 'e/03', { event: 'status', state: 'claimed' }),
          ev('10:02', 'e/05', { event: 'status', state: 'claimed' }),
          { ...ev('10:30', 'e/03', { event: 'pr-opened', pr: 3, sha: A }), source: 'github' },
          { ...ev('11:30', 'e/05', { event: 'pr-opened', pr: 5, sha: B }), source: 'github' },
        ],
        work: read.work,
      }),
    )
    const gates = gateSpans(timeline.spans)
    expect(gates.map((span) => [span.links.sha, span.links.ticket, span.outcome])).toEqual([
      [A, 'e/03', 'ok'],
      [B, 'e/05', 'failed'],
    ])
    expect(gates[1]?.reason).toBe('red: test (exit 1)')
    // The steps hang off their gate run.
    const steps = timeline.spans.filter((span) => span.kind === 'script' && span.parent === gates[1]?.id)
    expect(steps.map((span) => [span.name, span.outcome])).toEqual([
      ['lint', 'ok'],
      ['typecheck', 'ok'],
      ['test', 'failed'],
    ])
    // The note names what the log cannot hold: a run answered wholly by the green cache.
    expect(gates[0]?.note).toBe(GREEN_CACHE_NOTE)
  })

  it('gives a run without a PR to the Ticket whose agent worked in that worktree, the paths brought to one form by realpath', async () => {
    // The agent's folder as reader 14 hands it over (canonical), the gate's through a link to it.
    const real = join(dir, 'wt', '07')
    mkdirSync(real, { recursive: true })
    const link = join(dir, 'link-07')
    symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir')
    writeRun({ tag: 'bbbb2222', end: '11:00', worktree: link, head: SHA('unpushed') })

    const read = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    const agentWorktree = await canonicalWorktree(real)
    expect(read.work.find((fact) => fact.kind === 'gate')?.worktree).toBe(agentWorktree)

    const agent: WorkFact = { id: 'agent-07', kind: 'agent', ticket: 'e/07', name: 'impl-07', agentType: 'worfy:implementer', start: T('10:05'), end: T('11:30'), worktree: agentWorktree, startSource: 'transcript', endSource: 'transcript' }
    const timeline = buildTimeline(runFacts({ ticketEvents: [ev('10:03', 'e/07', { event: 'status', state: 'claimed' })], work: [agent, ...read.work] }))
    expect(gateSpans(timeline.spans).map((span) => span.links.ticket)).toEqual(['e/07'])
  })

  it('reads one Windows worktree in two spellings as one path, and an 8.3 short name through realpath', async () => {
    const missing = (path: string): Promise<string> => Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' }))
    const one = await canonicalWorktree('C:\\Users\\Ann\\Repo\\.claude\\worktrees\\05', { platform: 'win32', realpath: missing })
    const two = await canonicalWorktree('c:/users/ann/repo/.claude/worktrees/05', { platform: 'win32', realpath: missing })
    expect(one).toBe('c:/users/ann/repo/.claude/worktrees/05')
    expect(two).toBe(one)
    // Elsewhere `\` is a character of a name and letter case counts.
    expect(await canonicalWorktree('/Users/Ann/Repo', { platform: 'darwin', realpath: missing })).not.toBe(await canonicalWorktree('/users/ann/repo', { platform: 'darwin', realpath: missing }))

    // realpath(3) of the Windows runner expands the 8.3 short name of its home folder.
    const long = 'C:\\Users\\runneradmin\\work\\.claude\\worktrees\\05'
    const shortName = (path: string): Promise<string> => Promise.resolve(path.replace('RUNNER~1', 'runneradmin'))
    expect(await canonicalWorktree('C:/Users/RUNNER~1/work/.claude/worktrees/05', { platform: 'win32', realpath: shortName })).toBe(await canonicalWorktree(long, { platform: 'win32', realpath: shortName }))

    // The gate writes C:/… as git prints it; the reader hands over the same form an agent's C:\… gets.
    writeRun({ tag: 'cccc3333', end: '11:00', worktree: 'C:/Users/Ann/Repo/.claude/worktrees/05', head: SHA('w') })
    const read = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END, platform: 'win32', realpath: missing })
    expect(read.work.find((fact) => fact.kind === 'gate')?.worktree).toBe(one)

    // On this machine: the temporary folder as the OS names it (C:\Users\RUNNER~1\… on the GitHub
    // Windows runner, /var/… for /private/var/… on macOS) and its realpath are one worktree.
    expect(await canonicalWorktree(dir)).toBe(await canonicalWorktree(realpathSync.native(dir)))
  })

  it('takes the time from `at` inside timings.json, not from the mtime of the file', async () => {
    const worktree = join(dir, 'wt', '03')
    mkdirSync(worktree, { recursive: true })
    const folder = writeRun({ tag: 'dddd4444', end: '12:00', worktree, head: SHA('t'), totalMs: 330_000 })
    const before = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    const old = new Date('2001-01-01T00:00:00Z')
    utimesSync(join(folder, 'timings.json'), old, old)
    utimesSync(folder, old, old)
    const after = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    expect(after).toEqual(before)
    const gate = after.work.find((fact) => fact.kind === 'gate')
    expect([gate?.start, gate?.end]).toEqual(['2026-10-17T11:54:30.000Z', '2026-10-17T12:00:00.000Z'])
    // The steps back to back up to the end of the run: 30 s of the run were outside them.
    expect(after.work.filter((fact) => fact.kind === 'script').map((fact) => [fact.start, fact.end])).toEqual([
      ['2026-10-17T11:55:00.000Z', '2026-10-17T11:56:00.000Z'],
      ['2026-10-17T11:56:00.000Z', '2026-10-17T11:57:00.000Z'],
      ['2026-10-17T11:57:00.000Z', '2026-10-17T12:00:00.000Z'],
    ])
  })

  it('keeps runs that overlap the Run, its edges included, and leaves out the rest', async () => {
    const worktree = join(dir, 'wt', '03')
    mkdirSync(worktree, { recursive: true })
    // Each run lasts 5.5 min and ends at the time given.
    writeRun({ tag: 'eeee5555', end: '09:00', worktree, head: SHA('before') })
    writeRun({ tag: 'eeee5555', end: '10:03', worktree, head: SHA('across the start') })
    writeRun({ tag: 'eeee5555', end: '12:00', worktree, head: SHA('inside') })
    writeRun({ tag: 'eeee5555', end: '14:04', worktree, head: SHA('across the end') })
    writeRun({ tag: 'eeee5555', end: '15:00', worktree, head: SHA('after') })
    const read = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    expect(read.work.filter((fact) => fact.kind === 'gate').map((fact) => [fact.sha, fact.start.slice(11, 19)])).toEqual([
      [SHA('across the start'), '09:57:30'],
      [SHA('inside'), '11:54:30'],
      [SHA('across the end'), '13:58:30'],
    ])
  })

  it('reads the gate runs of the night-Run fixture', async () => {
    const night = await readGateLogs({ harnessHome: NIGHT_HARNESS, since: '2026-10-17T22:29:32Z', until: '2026-10-18T03:18:00Z', now: Date.parse('2026-10-18T03:30:00Z') })
    const gates = night.work.filter((fact) => fact.kind === 'gate')
    expect(gates.map((fact) => [fact.name, fact.sha?.slice(0, 8), fact.end, fact.outcome])).toEqual([
      ['gate full', 'c616dac1', '2026-10-17T23:50:40.000Z', 'ok'],
      ['gate full', expect.any(String), expect.any(String), 'ok'],
    ])
    expect(gates[0]?.start).toBe('2026-10-17T23:37:10.000Z')
    expect(night.work.filter((fact) => fact.parentWork?.id === gates[0]?.id).map((fact) => fact.name)).toEqual(['lint', 'typecheck', 'test', 'test:e2e', 'test:package'])
    expect(night.lost).toEqual([])
  })
})

describe('lost gate logs', () => {
  const runsAt = (tag: string, worktree: string, ends: readonly string[]): string[] => ends.map((end, index) => writeRun({ tag, end, worktree, head: SHA(`${tag}${index}`) }))
  const tenAfter = ['12:10', '12:15', '12:20', '12:25', '12:30', '12:35', '12:40', '12:45', '12:50', '12:55']

  it('labels a worktree whose folder is full and whose oldest kept run began after the Run started: from the Run start to that run', async () => {
    const worktree = join(dir, 'wt', '05')
    mkdirSync(worktree, { recursive: true })
    runsAt('ffff6666', worktree, tenAfter)
    const read = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    const canonical = await canonicalWorktree(worktree)
    expect(read.lost).toEqual([{ worktree: canonical, kind: 'gate', name: 'gate', source: 'gate-logs-deleted', start: T('10:00'), end: '2026-10-17T12:04:30.000Z' }])

    // On the timeline the label covers that stretch of the Ticket's row, not the whole row over the kept runs.
    const agent: WorkFact = { id: 'agent-05', kind: 'agent', ticket: 'e/05', name: 'impl-05', start: T('10:05'), end: T('13:30'), worktree: canonical, startSource: 'transcript', endSource: 'transcript' }
    const timeline = buildTimeline(runFacts({ ticketEvents: [ev('10:02', 'e/05', { event: 'status', state: 'claimed' })], work: [agent, ...read.work], lost: read.lost }))
    const lost = timeline.spans.filter((span) => span.lost !== null)
    expect(lost.map((span) => [span.kind, span.links.ticket, LOST_SOURCE_LABELS[span.lost ?? 'gate-logs-deleted'], new Date(span.until).toISOString()])).toEqual([['gate', 'e/05', 'gate logs deleted (10 runs or 8 days)', '2026-10-17T12:04:30.000Z']])
  })

  it('does not label a full folder whose oldest run began before the Run, nor a folder short of full', async () => {
    const worktree = join(dir, 'wt', '05')
    mkdirSync(worktree, { recursive: true })
    runsAt('ffff6666', worktree, ['09:58', ...tenAfter.slice(1)])
    expect((await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })).lost).toEqual([])
    runsAt('ffff7777', worktree, tenAfter.slice(1))
    expect((await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })).lost).toEqual([])
  })

  it('counts a folder full by the pruning of the gate itself (gate-log.mjs pruneLogs)', async () => {
    const gateLog = (await import(pathToFileURL(GATE_LOG).href)) as { LOG_RUNS_KEPT: number; pruneLogs: (state: string, tag: string, current: string) => void }
    expect(LOG_RUNS_KEPT).toBe(gateLog.LOG_RUNS_KEPT)
    const worktree = join(dir, 'wt', '05')
    mkdirSync(worktree, { recursive: true })
    // The eleventh run of a worktree: the gate prunes the oldest and keeps LOG_RUNS_KEPT.
    const folders = runsAt('ffff6666', worktree, ['11:05', ...tenAfter])
    gateLog.pruneLogs(join(harnessHome, 'gate', 'state'), 'ffff6666', folders.at(-1) as string)
    expect(readdirSync(join(harnessHome, 'gate', 'state', 'logs', 'ffff6666'))).toHaveLength(LOG_RUNS_KEPT)
    const read = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    expect(read.lost).toEqual([{ worktree: await canonicalWorktree(worktree), kind: 'gate', name: 'gate', source: 'gate-logs-deleted', start: T('10:00'), end: '2026-10-17T12:04:30.000Z' }])
    expect(read.work.filter((fact) => fact.kind === 'gate')).toHaveLength(LOG_RUNS_KEPT)
  })

  it('labels a run folder of the Run without timings.json, up to the next run of its worktree or the Run end', async () => {
    const worktree = join(dir, 'wt', '05')
    mkdirSync(worktree, { recursive: true })
    runsAt('abab7777', worktree, ['11:00', '13:00'])
    const logs = join(harnessHome, 'gate', 'state', 'logs', 'abab7777')
    for (const name of ['2026-10-17T09-00-00Z-97', '2026-10-17T12-00-00Z-98', '2026-10-17T13-30-00Z-99', '2026-10-17T14-30-00Z-96']) {
      mkdirSync(join(logs, name))
      writeFileSync(join(logs, name, '01-worfy-lint.log'), 'ok\n')
    }
    const read = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    const place = await canonicalWorktree(worktree)
    expect(read.lost).toEqual([
      { worktree: place, kind: 'gate', name: 'gate', source: 'gate-logs-deleted', start: T('12:00'), end: '2026-10-17T12:54:30.000Z' },
      { worktree: place, kind: 'gate', name: 'gate', source: 'gate-logs-deleted', start: T('13:30'), end: '2026-10-17T14:30:00.000Z' },
    ])
    // A folder none of whose runs has a record names no worktree: nothing can be placed.
    mkdirSync(join(harnessHome, 'gate', 'state', 'logs', 'cdcd8888', '2026-10-17T12-00-00Z-95'), { recursive: true })
    expect((await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })).lost).toHaveLength(2)
  })

  it('labels every Ticket without a gate run once the Run is older than the 8 days the gate keeps a quiet worktree', async () => {
    const read = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END + 9 * 24 * 60 * 60 * 1000 })
    expect(read.lost).toEqual([{ ticket: null, kind: 'gate', name: 'gate', source: 'gate-logs-deleted' }])
    const fresh = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END + 7 * 24 * 60 * 60 * 1000 })
    expect(fresh.lost).toEqual([])
  })
})

describe('verdicts without a PR', () => {
  let repo: string
  const git = (date: string, ...args: string[]): string =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      // The user's own git config stays out: commit.gpgsign or hooks there would break the commits.
      env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    }).trim()
  /** A branch made at `from` with one commit of its own at `at`; its head. */
  const branchWithCommit = (branch: string, from: string, at: string): string => {
    git(T(from), 'branch', branch)
    git(T(from), 'checkout', '-q', branch)
    writeFileSync(join(repo, `${branch.replaceAll('/', '-')}.txt`), `${branch}\n`)
    git(T(at), 'add', '.')
    git(T(at), 'commit', '-q', '-m', `feat: ${branch}`)
    const head = git(T(at), 'rev-parse', 'HEAD')
    git(T(at), 'checkout', '-q', 'main')
    return head
  }
  const commitOnMain = (at: string): void => {
    writeFileSync(join(repo, `main-${at.replace(':', '')}.txt`), 'm\n')
    git(T(at), 'add', '.')
    git(T(at), 'commit', '-q', '-m', `main ${at}`)
  }
  const one = (ticket: string, branch = ticket) => [{ ticket, epic: ticket.split('/')[0] as string, num: Number(ticket.split('/')[1]), branch }]
  const merges = async (ticket: string) => (await readLocalVerdicts({ repo, tickets: one(ticket) })).ticketEvents.filter((event) => event.event === 'merge')

  beforeEach(() => {
    writeFileSync(join(dir, 'gitconfig'), '')
    repo = join(dir, 'repo')
    mkdirSync(repo)
    git(T('09:00'), 'init', '-q', '-b', 'main')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(T('09:00'), 'add', '.')
    git(T('09:00'), 'commit', '-q', '-m', 'base')
  })

  it('reads the gate: commits of a local-green branch as review marks, its new heads as pushes and its local merge', async () => {
    git(T('10:05'), 'branch', 'e/02')
    git(T('10:05'), 'checkout', '-q', 'e/02')
    writeFileSync(join(repo, 'b.txt'), 'b\n')
    git(T('10:20'), 'add', '.')
    git(T('10:20'), 'commit', '-q', '-m', 'feat: b')
    const first = git(T('10:20'), 'rev-parse', 'HEAD')
    git(T('10:40'), 'commit', '-q', '--allow-empty', '-m', 'gate: REJECTED: [high] b is wrong')
    writeFileSync(join(repo, 'b.txt'), 'b2\n')
    git(T('11:00'), 'commit', '-q', '-am', 'fix: b')
    const second = git(T('11:00'), 'rev-parse', 'HEAD')
    git(T('11:20'), 'commit', '-q', '--allow-empty', '-m', 'gate: VERIFIED')
    git(T('11:25'), 'commit', '-q', '--allow-empty', '-m', 'gate: MAX-REVIEW: VERIFIED')
    const head = git(T('11:25'), 'rev-parse', 'HEAD')
    git(T('11:30'), 'checkout', '-q', 'main')

    const tickets = one('e/02')
    const open = await readLocalVerdicts({ repo, tickets })
    expect(open.lost).toEqual([])
    expect(open.ticketEvents.map((event) => [event.at.slice(11, 16), event.event, 'sha' in event ? event.sha : null, event.event === 'mark' ? `${event.mark} ${event.verdict}` : ''])).toEqual([
      ['10:20', 'push', first, ''],
      ['10:40', 'mark', first, 'review failure'],
      ['11:00', 'push', second, ''],
      ['11:20', 'mark', second, 'review success'],
    ])
    expect(open.ticketEvents.every((event) => event.source === 'git' && event.ticket === 'e/02')).toBe(true)
    expect(open.ticketEvents.find((event) => event.event === 'mark' && event.verdict === 'failure')).toMatchObject({ reason: 'REJECTED: [high] b is wrong' })

    // The local merge: the moment the main branch reached the head, not a later move of main.
    git(T('12:00'), 'merge', '-q', '--ff-only', 'e/02')
    commitOnMain('13:00')
    const merged = await readLocalVerdicts({ repo, tickets })
    expect(merged.ticketEvents.at(-1)).toEqual({ ticket: 'e/02', at: '2026-10-17T12:00:00.000Z', source: 'git', event: 'merge', sha: head })

    // Through the model: the VERIFIED commit (not the REJECTED one) passes Implementing and Agent
    // review, the local merge passes Gate & merge.
    const pipeline: PipelineStage[] = [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'agent-review' }, { kind: 'gate-merge' }, { kind: 'done' }]
    const timeline = buildTimeline(runFacts({ waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('14:00'), tickets: ['e/02'] }], ticketEvents: [ev('10:01', 'e/02', { event: 'status', state: 'claimed' }), ...merged.ticketEvents] }, pipeline))
    const stages = timeline.spans.filter((span) => span.kind === 'stage')
    expect(stages.map((span) => [span.name, span.outcome, new Date(span.until).toISOString().slice(11, 16), span.endSource])).toEqual([
      ['Queued', 'ok', '10:01', 'journal'],
      ['Implementing + Agent review', 'ok', '11:20', 'git'],
      ['Gate & merge', 'ok', '12:00', 'git'],
    ])
  })

  it('gives a branch with no commit of its own no event, though its head is in the main branch', async () => {
    git(T('10:05'), 'branch', 'e/06')
    commitOnMain('11:00')
    expect(await readLocalVerdicts({ repo, tickets: one('e/06') })).toEqual({ ticketEvents: [], lost: [] })
  })

  it('times a merge commit by the main branch reflog, then by the merge commit, then by the head', async () => {
    const noFf = branchWithCommit('e/03', '10:05', '10:30')
    git(T('12:00'), 'merge', '-q', '--no-ff', '-m', 'Merge e/03', 'e/03')
    commitOnMain('13:00')
    expect(await merges('e/03')).toEqual([{ ticket: 'e/03', at: T('12:00'), source: 'git', event: 'merge', sha: noFf }])

    const late = branchWithCommit('e/07', '13:05', '13:10')
    git(T('13:40'), 'merge', '-q', '--no-ff', '-m', 'Merge e/07', 'e/07')
    // Without the reflog of main: the merge commit over the head, else the head's own commit.
    git(T('13:45'), 'reflog', 'expire', '--expire=now', '--expire-unreachable=now', 'main')
    expect(await merges('e/07')).toEqual([{ ticket: 'e/07', at: T('13:40'), source: 'git', event: 'merge', sha: late }])
    const ff = branchWithCommit('e/08', '13:50', '13:55')
    git(T('14:30'), 'merge', '-q', '--ff-only', 'e/08')
    git(T('14:35'), 'reflog', 'expire', '--expire=now', '--expire-unreachable=now', 'main')
    expect(await merges('e/08')).toEqual([{ ticket: 'e/08', at: T('13:55'), source: 'git', event: 'merge', sha: ff }])
    // A reflog cut by expiry: its oldest entry left holds those heads but is not when they went in.
    branchWithCommit('e/11', '14:40', '14:45')
    git(T('15:00'), 'merge', '-q', '--ff-only', 'e/11')
    expect([...(await merges('e/07')), ...(await merges('e/08')), ...(await merges('e/11'))].map((event) => event.at)).toEqual([T('13:40'), T('13:55'), T('15:00')])
  })

  it('reads the marks file of Silent mode as the verdicts of a Ticket without a PR', async () => {
    const sha = SHA('silent')
    const file = markFilePath(harnessHome, 'proj', 'e', 4)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ epic: 'e', num: 4, marks: [{ kind: 'review', verdict: 'failure', sha, at: T('10:30') }, { kind: 'check/windows', verdict: 'success', sha, at: T('11:00') }, { kind: 'review', verdict: 'success', sha, at: null }] }))
    const read = await readLocalVerdicts({ repo, tickets: one('e/04'), marksFile: { harnessHome, project: 'proj' } })
    expect(read.ticketEvents.filter((event) => event.source === 'marks-file')).toEqual([
      { ticket: 'e/04', at: '2026-10-17T10:30:00.000Z', source: 'marks-file', event: 'mark', mark: 'review', verdict: 'failure', sha },
      { ticket: 'e/04', at: '2026-10-17T11:00:00.000Z', source: 'marks-file', event: 'mark', mark: 'check/windows', verdict: 'success', sha },
    ])
    // Without the marks file option the file is not read.
    expect((await readLocalVerdicts({ repo, tickets: one('e/04') })).ticketEvents).toEqual([])
    // A folder that is not a git repository: the marks file still, and no branch is called deleted.
    const plain = join(dir, 'plain')
    mkdirSync(plain)
    const outside = await readLocalVerdicts({ repo: plain, tickets: one('e/04'), marksFile: { harnessHome, project: 'proj' } })
    expect([outside.ticketEvents.length, outside.lost]).toEqual([2, []])
  })

  it('labels a Ticket whose branch is gone «branch deleted»', async () => {
    git(T('10:05'), 'branch', 'e/09')
    git(T('10:06'), 'branch', '-D', 'e/09')
    const read = await readLocalVerdicts({ repo, tickets: one('e/09') })
    expect(read.lost).toEqual([{ ticket: 'e/09', kind: 'script', name: 'branch e/09', source: 'branch-deleted' }])
    expect(LOST_SOURCE_LABELS[read.lost[0]?.source ?? 'branch-deleted']).toBe('branch deleted')
  })

  it('writes nothing to the Harness home or the repository, a merged branch included', async () => {
    const head = branchWithCommit('e/02', '10:05', '10:30')
    git(T('11:00'), 'merge', '-q', '--no-ff', '-m', 'Merge e/02', 'e/02')
    branchWithCommit('e/05', '11:05', '11:10')
    git(T('11:20'), 'merge', '-q', '--ff-only', 'e/05')
    git(T('11:30'), 'reflog', 'expire', '--expire=now', '--expire-unreachable=now', 'main')
    branchWithCommit('e/10', '11:35', '11:36')
    git(T('11:40'), 'merge', '-q', '--ff-only', 'e/10')
    writeRun({ tag: 'aaaa1111', end: '10:40', worktree: repo, head })
    const file = markFilePath(harnessHome, 'proj', 'e', 2)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ epic: 'e', num: 2, marks: [] }))
    const before = [treeState(harnessHome), treeState(repo)]
    await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    const read = await readLocalVerdicts({ repo, tickets: [...one('e/02'), ...one('e/05'), ...one('e/09'), ...one('e/10')], marksFile: { harnessHome, project: 'proj' } })
    // Every git path ran: merges found by the merge commit, the head's own time and the reflog of main; one branch gone.
    expect(read.ticketEvents.filter((event) => event.event === 'merge').map((event) => [event.ticket, event.at])).toEqual([
      ['e/02', T('11:00')],
      ['e/05', T('11:10')],
      ['e/10', T('11:40')],
    ])
    expect(read.lost).toHaveLength(1)
    expect([treeState(harnessHome), treeState(repo)]).toEqual(before)
  })
})
