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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalWorktree, readGateLogs } from '../../src/main/flight-recorder/gate-logs'
import { readLocalVerdicts } from '../../src/main/flight-recorder/local-verdicts'
import { markFilePath } from '../../src/main/workflow/marks'
import { GREEN_CACHE_NOTE } from '../../src/shared/flight-recorder/from-gate'
import { buildTimeline, LOST_SOURCE_LABELS, type RunFacts, type Span, type StageEventFact, type WorkFact } from '../../src/shared/flight-recorder/spans'
import { DEFAULT_PIPELINE, type PipelineStage } from '../../src/shared/workflow/pipeline'

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

/** Every file under `root` with its size, mtime and content hash, `.git` included. */
function treeState(root: string): Map<string, string> {
  const state = new Map<string, string>()
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
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

  it('leaves out runs outside the Run, and reads the night-Run fixture', async () => {
    const worktree = join(dir, 'wt', '03')
    mkdirSync(worktree, { recursive: true })
    writeRun({ tag: 'eeee5555', end: '09:00', worktree, head: SHA('before') })
    writeRun({ tag: 'eeee5555', end: '15:00', worktree, head: SHA('after') })
    writeRun({ tag: 'eeee5555', end: '12:00', worktree, head: SHA('inside') })
    const read = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    expect(read.work.filter((fact) => fact.kind === 'gate').map((fact) => fact.sha)).toEqual([SHA('inside')])

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
  it('labels a worktree whose 10 kept runs all began after the Run started: its older runs are gone', async () => {
    const worktree = join(dir, 'wt', '05')
    mkdirSync(worktree, { recursive: true })
    for (let index = 0; index < 10; index++) writeRun({ tag: 'ffff6666', end: `12:${String(index * 5 + 10).padStart(2, '0')}`, worktree, head: SHA(`r${index}`) })
    const read = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    const canonical = await canonicalWorktree(worktree)
    expect(read.lost).toEqual([{ worktree: canonical, kind: 'gate', name: 'gate', source: 'gate-logs-deleted' }])

    const agent: WorkFact = { id: 'agent-05', kind: 'agent', ticket: 'e/05', name: 'impl-05', start: T('10:05'), end: T('13:30'), worktree: canonical, startSource: 'transcript', endSource: 'transcript' }
    const timeline = buildTimeline(runFacts({ ticketEvents: [ev('10:02', 'e/05', { event: 'status', state: 'claimed' })], work: [agent, ...read.work], lost: read.lost }))
    const lost = timeline.spans.filter((span) => span.lost !== null)
    expect(lost.map((span) => [span.kind, span.links.ticket, LOST_SOURCE_LABELS[span.lost ?? 'gate-logs-deleted']])).toEqual([['gate', 'e/05', 'gate logs deleted (10 runs or 8 days)']])

    // Nine runs: the log still holds everything of that worktree.
    await rm(join(harnessHome, 'gate', 'state', 'logs', 'ffff6666'), { recursive: true, force: true })
    for (let index = 0; index < 9; index++) writeRun({ tag: 'ffff6666', end: `12:${String(index * 5 + 10).padStart(2, '0')}`, worktree, head: SHA(`r${index}`) })
    expect((await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })).lost).toEqual([])
  })

  it('labels a known run whose timings.json is missing, at the time its folder names', async () => {
    const worktree = join(dir, 'wt', '05')
    mkdirSync(worktree, { recursive: true })
    writeRun({ tag: 'abab7777', end: '11:00', worktree, head: SHA('kept') })
    const gone = join(harnessHome, 'gate', 'state', 'logs', 'abab7777', '2026-10-17T12-00-00Z-99')
    mkdirSync(gone)
    writeFileSync(join(gone, '01-worfy-lint.log'), 'ok\n')
    const read = await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    expect(read.lost).toEqual([{ worktree: await canonicalWorktree(worktree), kind: 'gate', name: 'gate', source: 'gate-logs-deleted', start: '2026-10-17T12:00:00.000Z' }])
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
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    }).trim()

  beforeEach(() => {
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

    const tickets = [{ ticket: 'e/02', epic: 'e', num: 2, branch: 'e/02' }]
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

    git(T('12:00'), 'merge', '-q', '--ff-only', 'e/02')
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

  it('reads the marks file of Silent mode as the verdicts of a Ticket without a PR', async () => {
    const sha = SHA('silent')
    const file = markFilePath(harnessHome, 'proj', 'e', 4)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ epic: 'e', num: 4, marks: [{ kind: 'review', verdict: 'failure', sha, at: T('10:30') }, { kind: 'check/windows', verdict: 'success', sha, at: T('11:00') }, { kind: 'review', verdict: 'success', sha, at: null }] }))
    const read = await readLocalVerdicts({ repo, tickets: [{ ticket: 'e/04', epic: 'e', num: 4, branch: 'e/04' }], marksFile: { harnessHome, project: 'proj' } })
    expect(read.ticketEvents.filter((event) => event.source === 'marks-file')).toEqual([
      { ticket: 'e/04', at: '2026-10-17T10:30:00.000Z', source: 'marks-file', event: 'mark', mark: 'review', verdict: 'failure', sha },
      { ticket: 'e/04', at: '2026-10-17T11:00:00.000Z', source: 'marks-file', event: 'mark', mark: 'check/windows', verdict: 'success', sha },
    ])
    // Without the marks file option the file is not read.
    expect((await readLocalVerdicts({ repo, tickets: [{ ticket: 'e/04', epic: 'e', num: 4, branch: 'e/04' }] })).ticketEvents).toEqual([])
  })

  it('labels a Ticket whose branch is gone «branch deleted»', async () => {
    git(T('10:05'), 'branch', 'e/09')
    git(T('10:06'), 'branch', '-D', 'e/09')
    const read = await readLocalVerdicts({ repo, tickets: [{ ticket: 'e/09', epic: 'e', num: 9, branch: 'e/09' }] })
    expect(read.lost).toEqual([{ ticket: 'e/09', kind: 'script', name: 'branch e/09', source: 'branch-deleted' }])
    expect(LOST_SOURCE_LABELS[read.lost[0]?.source ?? 'branch-deleted']).toBe('branch deleted')
  })

  it('writes nothing to the Harness home or the repository', async () => {
    git(T('10:05'), 'branch', 'e/02')
    writeRun({ tag: 'aaaa1111', end: '10:40', worktree: repo, head: SHA('a') })
    const file = markFilePath(harnessHome, 'proj', 'e', 2)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ epic: 'e', num: 2, marks: [] }))
    const before = [treeState(harnessHome), treeState(repo)]
    await readGateLogs({ harnessHome, since: T('10:00'), until: T('14:00'), now: RUN_END })
    await readLocalVerdicts({ repo, tickets: [{ ticket: 'e/02', epic: 'e', num: 2, branch: 'e/02' }], marksFile: { harnessHome, project: 'proj' } })
    expect([treeState(harnessHome), treeState(repo)]).toEqual(before)
  })
})
