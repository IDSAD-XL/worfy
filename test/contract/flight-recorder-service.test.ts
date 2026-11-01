// The Flight Recorder service (src/main/flight-recorder/service.ts; worfy-flight-recorder ticket 17): the
// Runs of a Project from the Journals of a temporary WORFY_DATA_DIR, and the timeline of one Run from all four
// readers — the night-Run fixture (test/fixtures/flight-recorder/night-run/: its Journal, its transcripts as
// WORFY_CLAUDE_HOME, its gate logs as the Harness home, gh through the stand-in of WORFY_GH) and small Runs
// written here. The live timeline runs on a clock and a timer of the test: ten Journal lines within one
// interval give one `runs.changed`, gh is read at most once a minute, a transcript is read on from where the
// last read stopped. Nothing reaches GitHub, no real Claude Code or Agent SDK runs, git is a stand-in.
import { symlinkSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectDirName } from '../../src/main/claude-home/registry'
import { readNewLines } from '../../src/main/claude-home/tail'
import { FlightRecorder, RECOMPUTE_INTERVAL_MS, type FlightRecorderOptions, type RunProfile, type RunSubscriber } from '../../src/main/flight-recorder/service'
import { accountAuth, ghRunner, PrTracker } from '../../src/main/github/prs'
import { SubagentParse, TranscriptParse } from '../../src/shared/flight-recorder/from-transcript'
import { formatJournalLine, makeRunId, type JournalEvent } from '../../src/shared/autopilot/journal'
import type { RunView } from '../../src/shared/ipc/runs'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'
import { writeBigTranscript } from '../big-transcript'
import { shapedSession, writeShapedSession } from './flight-recorder-shaped-transcript'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

const FIXTURES = join(__dirname, '..', 'fixtures', 'flight-recorder')
const NIGHT = join(FIXTURES, 'night-run')
const STAND_IN = join(FIXTURES, 'gh-night-run.mjs')
const NIGHT_RUN = '2026-10-17T22-29-32-707Z-58e783'
const NIGHT_PROJECT = 'CanvasForAI-38cb72ec'
const NIGHT_ROOT = '/Users/someone/Stuff/CanvasForAI'
// The fixture's verdict comments are by `owner`, the anonymised owner of the repository.
const ACCOUNT = 'owner'
const MINUTE = 60_000

// A token the developer's shell exports must reach no stand-in: it logs GH_TOKEN.
beforeEach(() => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) vi.stubEnv(name, undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

let base: string
beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'worfy-fr-service-')))
})
afterAll(async () => {
  await removeTestTree(base)
})

let folders = 0
async function folder(name: string): Promise<string> {
  const path = join(base, `${name}-${++folders}`)
  await mkdir(path, { recursive: true })
  return path
}

const profileOf = (over: Partial<RunProfile> = {}): RunProfile => ({ name: 'worfy', mode: 'full', finish: 'pr-green-ci', pipeline: DEFAULT_PIPELINE, account: ACCOUNT, accountReason: null, crossMachineGate: null, reason: null, ...over })

/** git as a stand-in: no repository answers anything (exit 128), so no Ticket without a PR has local verdicts. */
const noGit: NonNullable<FlightRecorderOptions['git']> = async () => ({ code: 128, stdout: '' })

/** gh through the PR tracker as the app builds it, on the stand-in; `calls()` — the `pr list` calls it got. */
async function ghWorld() {
  const dir = await folder('gh')
  const log = join(dir, 'calls.jsonl')
  const failFile = join(dir, 'fail')
  await writeFile(log, '')
  const run = ghRunner({ processEnv: { WORFY_GH: STAND_IN }, env: async () => ({ ...process.env, FR_GH_DIR: join(NIGHT, 'gh'), FR_GH_LOG: log, FR_GH_FAIL: failFile, FR_GH_ACCOUNT: ACCOUNT, FR_GH_TOKEN: 'token' }) })
  const tracker = new PrTracker({ run, auth: accountAuth({ account: () => Promise.resolve(ACCOUNT), run }) })
  const prLists = async (): Promise<number> =>
    (await readFile(log, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .filter((line) => (JSON.parse(line) as { args: string[] }).args.slice(0, 2).join(' ') === 'pr list').length
  // gh runs in a folder that exists: the night Run's root (/Users/someone/…) is only a name.
  return { gh: (_root: string, args: readonly string[]) => tracker.gh(dir, args), prLists, fail: (text: string) => writeFile(failFile, text), heal: () => rm(failFile, { force: true }) }
}

/** A subscriber that keeps what it got. */
function collector(id: number | string = 1): RunSubscriber & { views: RunView[] } {
  const views: RunView[] = []
  return { id, views, send: (view) => views.push(view) }
}

/** The timer of the test: `fire()` runs one step of the live timeline and waits for it. */
function manualTimer() {
  const state: { tick: (() => Promise<void>) | null; ms: number | null } = { tick: null, ms: null }
  const schedule: NonNullable<FlightRecorderOptions['schedule']> = (tick, ms) => {
    state.tick = tick
    state.ms = ms
    return () => {
      state.tick = null
    }
  }
  return { state, schedule, fire: async () => state.tick?.() }
}

const journalLine = (event: Record<string, unknown>): string => formatJournalLine(event as JournalEvent)

async function writeJournal(dataDir: string, run: string, events: readonly Record<string, unknown>[]): Promise<string> {
  const dir = join(dataDir, 'autopilot')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${run}.jsonl`)
  await writeFile(file, events.map(journalLine).join(''))
  return file
}

describe('the Runs of a Project', () => {
  it('lists them newest first, keeps one Epic with the filter, and never shows a Run of another Project', async () => {
    const data = await folder('data')
    const run = (day: string, suffix: string) => makeRunId(new Date(`2026-10-${day}T10:00:00.000Z`), suffix)
    const start = (id: string, project: string, epic: string, day: string) => [
      { at: `2026-10-${day}T10:00:00.000Z`, run: id, project, epic, kind: 'run-started' },
      { at: `2026-10-${day}T10:00:01.000Z`, run: id, project, epic, kind: 'wave-started', wave: 1, tickets: ['01', '02'] },
    ]
    const [a, b, c, other] = [run('01', 'aaaaaa'), run('02', 'bbbbbb'), run('03', 'cccccc'), run('04', 'dddddd')]
    await writeJournal(data, a, start(a, 'p-1', 'alpha', '01'))
    await writeJournal(data, b, start(b, 'p-1', 'beta', '02'))
    await writeJournal(data, c, [...start(c, 'p-1', 'alpha', '03'), { at: '2026-10-03T11:00:00.000Z', run: c, project: 'p-1', epic: 'alpha', kind: 'run-stopped', reason: 'tickets-done' }])
    await writeJournal(data, other, start(other, 'p-2', 'alpha', '04'))
    const projectRoot = (id: string): string => {
      if (id !== 'p-1' && id !== 'p-2') throw new Error(`no Project ${id}`)
      return base
    }
    const recorder = new FlightRecorder({ env: { WORFY_DATA_DIR: data }, harnessHome: await folder('harness'), projectRoot, profile: async () => profileOf(), gh: async () => '[]', running: () => false, git: noGit })

    const all = await recorder.list('p-1')
    expect(all.map((item) => [item.run, item.epic])).toEqual([
      [c, 'alpha'],
      [b, 'beta'],
      [a, 'alpha'],
    ])
    expect(all[0]).toMatchObject({ startedAt: '2026-10-03T10:00:00.000Z', stoppedAt: '2026-10-03T11:00:00.000Z', reason: 'tickets-done', live: false, tickets: ['alpha/01', 'alpha/02'] })
    expect(all[2]).toMatchObject({ stoppedAt: null, reason: null })
    expect((await recorder.list('p-1', 'alpha')).map((item) => item.run)).toEqual([c, a])
    expect((await recorder.list('p-2')).map((item) => item.run)).toEqual([other])
    // A Project that is not in the list shows no Runs, though Journals name it.
    await writeJournal(data, run('05', 'eeeeee'), start(run('05', 'eeeeee'), 'p-9', 'alpha', '05'))
    await expect(recorder.list('p-9')).rejects.toThrow('no Project p-9')
    // Nor is the timeline of another Project's Run found by its id.
    await expect(recorder.view('p-1', other)).rejects.toThrow(`there is no Run ${other} of this Project`)
    await expect(recorder.view('p-1', '../escape')).rejects.toThrow('there is no Run')
  })

  it('a Run is live while Autopilot works on its Epic, it has no run-stopped and it is the newest', async () => {
    const data = await folder('data')
    const older = makeRunId(new Date('2026-10-01T10:00:00.000Z'), 'aaaaaa')
    const newer = makeRunId(new Date('2026-10-02T10:00:00.000Z'), 'bbbbbb')
    for (const [id, day] of [
      [older, '01'],
      [newer, '02'],
    ] as const)
      await writeJournal(data, id, [{ at: `2026-10-${day}T10:00:00.000Z`, run: id, project: 'p-1', epic: 'alpha', kind: 'run-started' }])
    let running = true
    const recorder = new FlightRecorder({ env: { WORFY_DATA_DIR: data }, harnessHome: await folder('harness'), projectRoot: () => base, profile: async () => profileOf(), gh: async () => '[]', running: (project, epic) => running && project === 'p-1' && epic === 'alpha', git: noGit })
    expect((await recorder.list('p-1')).map((item) => item.live)).toEqual([true, false])
    running = false
    expect((await recorder.list('p-1')).map((item) => item.live)).toEqual([false, false])
  })
})

describe('the timeline of the night Run', () => {
  const nightRecorder = async (gh: FlightRecorderOptions['gh'], profile: RunProfile = profileOf(), over: Partial<FlightRecorderOptions> = {}) =>
    new FlightRecorder({
      env: { WORFY_DATA_DIR: join(NIGHT, 'data'), WORFY_CLAUDE_HOME: join(NIGHT, 'claude') },
      harnessHome: join(NIGHT, 'harness'),
      projectRoot: (projectId) => {
        if (projectId !== NIGHT_PROJECT) throw new Error(`no Project ${projectId}`)
        return NIGHT_ROOT
      },
      profile: async () => profile,
      gh,
      running: () => false,
      git: noGit,
      now: () => Date.parse('2026-11-01T10:00:00Z'),
      ...over,
    })

  it('is the tree Run → Wave → Ticket → Stage → work from the Journal, the transcripts, GitHub and the gate logs, with its summary', async () => {
    const world = await ghWorld()
    const view = await (await nightRecorder(world.gh)).view(NIGHT_PROJECT, NIGHT_RUN)
    const { spans } = view.timeline
    const byId = new Map(spans.map((span) => [span.id, span]))
    const kinds = (kind: string) => spans.filter((span) => span.kind === kind)

    expect(view).toMatchObject({ projectId: NIGHT_PROJECT, run: NIGHT_RUN, epic: 'worfy-pipeline', github: { state: 'answered', account: ACCOUNT, accountReason: null }, profileReason: null })
    expect(view.timeline.live).toBe(false)
    const [run] = kinds('run')
    expect(run).toMatchObject({ parent: null, start: Date.parse('2026-10-17T22:29:32.707Z'), end: Date.parse('2026-10-18T03:17:34.592Z') })
    expect(kinds('wave').map((span) => [span.parent, span.links.wave])).toEqual([
      [run!.id, 1],
      [run!.id, 2],
    ])
    expect(kinds('ticket').map((span) => span.links.ticket).sort()).toEqual(['worfy-pipeline/03', 'worfy-pipeline/04', 'worfy-pipeline/05', 'worfy-pipeline/07'])
    for (const stage of kinds('stage')) expect(byId.get(stage.parent!)?.kind, stage.name).toBe('ticket')

    // Work of each source hangs off a Stage of its Ticket: agents (transcripts), CI (GitHub), gate runs (gate logs).
    const placed = (kind: string) => kinds(kind).filter((span) => span.lost === null && byId.get(span.parent ?? '')?.kind === 'stage')
    expect(placed('agent').length).toBeGreaterThan(0)
    expect(placed('ci').length).toBeGreaterThan(0)
    expect(placed('gate').map((span) => span.links.ticket).sort()).toEqual(['worfy-pipeline/03', 'worfy-pipeline/07'])
    const agent = placed('agent')[0]!
    const stage = byId.get(agent.parent!)!
    const ticket = byId.get(stage.parent!)!
    expect([agent.kind, stage.kind, ticket.kind, byId.get(ticket.parent!)?.kind]).toEqual(['agent', 'stage', 'ticket', 'run'])
    expect(kinds('orchestrator-turn').length).toBeGreaterThan(0)
    expect(spans.filter((span) => span.lost === 'github-no-answer')).toEqual([])

    expect(view.summary.topStages).toHaveLength(3)
    expect(view.summary.runDuration).toBe(Date.parse('2026-10-18T03:17:34.592Z') - Date.parse('2026-10-17T22:29:32.707Z'))
    expect(view.summary.work.map((row) => row.subkind)).toEqual(expect.arrayContaining(['implementer', 'ci', 'gate']))
  })

  it('is there when gh fails, with «GitHub did not answer» on the PR and CI spans; «Retry» runs gh at once and the label goes', async () => {
    const world = await ghWorld()
    await world.fail('error connecting to api.github.com')
    // The Tickets have branches and git answers: without gh's answer no Ticket counts as one without a PR.
    const git = vi.fn(async () => ({ code: 0, stdout: '' }))
    const branches = async () => new Map([3, 4, 5, 7].map((num) => [num, `worfy-pipeline/0${num}`]))
    const recorder = await nightRecorder(world.gh, profileOf(), { git, branches })
    const subscriber = collector()
    const view = await recorder.open(NIGHT_PROJECT, NIGHT_RUN, subscriber)
    expect(view.github).toMatchObject({ state: 'no-answer', reason: expect.stringContaining('error connecting to api.github.com') })
    expect(view.timeline.spans.filter((span) => span.kind === 'ticket')).toHaveLength(4)
    // The label is a CI span of each Ticket, under the Ticket: the PR stages are not known.
    const byId = new Map(view.timeline.spans.map((span) => [span.id, span]))
    const noAnswer = view.timeline.spans.filter((span) => span.lost === 'github-no-answer').map((span) => [span.kind, span.name, span.links.ticket ?? null, byId.get(span.parent ?? '')?.kind ?? null])
    expect(noAnswer).toEqual(['03', '07', '04', '05'].map((num) => ['ci', 'CI', `worfy-pipeline/${num}`, 'ticket']))
    expect(git).not.toHaveBeenCalled()
    const before = await world.prLists()

    await world.heal()
    // The clock has not moved: without «Retry» the answer of the failed read stands for a minute.
    expect((await recorder.view(NIGHT_PROJECT, NIGHT_RUN)).github.state).toBe('no-answer')
    expect(await world.prLists()).toBe(before)
    const retried = await recorder.retry(NIGHT_PROJECT, NIGHT_RUN)
    expect(await world.prLists()).toBeGreaterThan(before)
    expect(retried.github.state).toBe('answered')
    expect(retried.timeline.spans.some((span) => span.lost === 'github-no-answer')).toBe(false)
    // The window that holds the Run open gets it too.
    expect(subscriber.views.map((each) => each.github.state)).toEqual(['answered'])
    recorder.dispose()
  })
})

// ── a live Run written here ──────────────────────────────────────────────────

const SESSION = 'aaaaaaaa-0000-4000-8000-000000000001'
const T0 = Date.parse('2026-11-01T10:00:00.000Z')
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString()
const record = (root: string, seconds: number, value: Record<string, unknown>): string => `${JSON.stringify({ timestamp: at(seconds), cwd: root, sessionId: SESSION, ...value })}\n`

/** The Orchestrator's transcript of the live Run: the Wave's prompt and the `Agent` call of impl-01. */
function orchestratorLines(root: string): string {
  return [
    record(root, 1, { type: 'user', message: { role: 'user', content: '/worfy:epic-wave tickets 01 of epic e' } }),
    record(root, 2, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Agent', input: { name: 'impl-01', subagent_type: 'worfy:implementer', run_in_background: true } }] } }),
    record(root, 2, { type: 'user', toolUseResult: { status: 'async_launched', agentId: 'a1' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Async agent launched' }] } }),
  ].join('')
}

async function liveWorld({ session = true }: { session?: boolean } = {}) {
  const data = await folder('data')
  const home = await folder('claude')
  const root = await folder('repo')
  const run = makeRunId(new Date(T0), 'eeeeee')
  const project = 'live-0a1b2c3d'
  const journal = await writeJournal(data, run, [
    { at: at(0), run, project, epic: 'e', kind: 'run-started' },
    { at: at(1), run, project, epic: 'e', kind: 'wave-started', wave: 1, tickets: ['01'], text: '/worfy:epic-wave tickets 01 of epic e', ...(session ? { session: SESSION } : {}) },
  ])
  const dir = join(home, 'projects', projectDirName(root))
  await mkdir(join(dir, SESSION, 'subagents'), { recursive: true })
  const transcript = join(dir, `${SESSION}.jsonl`)
  await writeFile(transcript, orchestratorLines(root))
  const worktree = join(root, '.claude', 'worktrees', '01')
  await mkdir(worktree, { recursive: true })
  return { data, home, root, run, project, journal, transcript, worktree, subagents: join(dir, SESSION, 'subagents') }
}

/** A pause a test opens: `wait` stops a reader at `reached` until `release`. */
function hold() {
  let release!: () => void
  let arrived!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = new Promise<void>((resolve) => {
    arrived = resolve
  })
  return {
    reached,
    release,
    wait: () => {
      arrived()
      return released
    },
  }
}

/** The branches of the Tickets, read in every compute: one waits for each pause in `holds`, in turn. */
const holdingBranches =
  (holds: ReturnType<typeof hold>[]): NonNullable<FlightRecorderOptions['branches']> =>
  async () => {
    await holds.shift()?.wait()
    return new Map()
  }

/** A recorder over a live world, on the test's timer and clock. */
async function liveRecorder(world: Awaited<ReturnType<typeof liveWorld>>, timer: ReturnType<typeof manualTimer>, over: Partial<FlightRecorderOptions> = {}): Promise<FlightRecorder> {
  return new FlightRecorder({
    env: { WORFY_DATA_DIR: world.data, WORFY_CLAUDE_HOME: world.home },
    harnessHome: await folder('harness'),
    projectRoot: () => world.root,
    profile: async () => profileOf(),
    gh: async () => '[]',
    running: () => true,
    git: noGit,
    now: () => T0 + 10_000,
    schedule: timer.schedule,
    ...over,
  })
}

describe('the live timeline', () => {
  it(`recomputes on new Journal lines at most once per ${RECOMPUTE_INTERVAL_MS / 1000} s, reads gh at most once a minute, and reads a transcript on from where it stopped`, async () => {
    const world = await liveWorld()
    const gh = await ghWorld()
    const timer = manualTimer()
    let now = T0 + 10_000
    const reads: { file: string; from: number }[] = []
    const tail: typeof readNewLines = async (file, cursor, options) => {
      reads.push({ file, from: cursor?.offset ?? 0 })
      return readNewLines(file, cursor, options)
    }
    const recorder = new FlightRecorder({
      env: { WORFY_DATA_DIR: world.data, WORFY_CLAUDE_HOME: world.home },
      harnessHome: await folder('harness'),
      projectRoot: () => world.root,
      profile: async () => profileOf(),
      gh: gh.gh,
      running: () => true,
      git: noGit,
      now: () => now,
      schedule: timer.schedule,
      tail,
    })
    const subscriber = collector()
    const opened = await recorder.open(world.project, world.run, subscriber)
    expect(opened.timeline.live).toBe(true)
    expect(timer.state.ms).toBe(5_000)
    const ghAtOpen = await gh.prLists()
    expect(ghAtOpen).toBe(1)
    const firstRead = reads.filter((read) => read.file === world.transcript)
    expect(firstRead).toEqual([{ file: world.transcript, from: 0 }])

    // Ten Journal lines within one interval: nothing until the timer's step, then one runs.changed.
    for (let n = 0; n < 10; n++) await appendFile(world.journal, journalLine({ at: at(11 + n * 0.4), run: world.run, project: world.project, epic: 'e', kind: 'background-tasks', tasks: [] }))
    expect(subscriber.views).toHaveLength(0)
    now += RECOMPUTE_INTERVAL_MS
    await timer.fire()
    expect(subscriber.views).toHaveLength(1)
    // Nothing new: no recompute, no event.
    now += RECOMPUTE_INTERVAL_MS
    await timer.fire()
    expect(subscriber.views).toHaveLength(1)

    // A transcript line: read from where the last read stopped, not from the start, and only it is
    // parsed (worfy-flight-recorder ticket 27): the parse of the lines before is kept.
    const appended = vi.spyOn(TranscriptParse.prototype, 'append')
    const parsed = () => appended.mock.calls.reduce((sum, [lines]) => sum + lines.length, 0)
    const size = (await readFile(world.transcript)).length
    await appendFile(world.transcript, record(world.root, 30, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'waiting for impl-01' }] } }))
    now += RECOMPUTE_INTERVAL_MS
    await timer.fire()
    expect(subscriber.views).toHaveLength(2)
    expect(reads.filter((read) => read.file === world.transcript).at(-1)).toEqual({ file: world.transcript, from: size })
    expect(parsed()).toBe(1)
    // What was read before and the new line make the timeline a full read of the files makes.
    const sameAsFull = async () => {
      const live = subscriber.views.at(-1)!.timeline.spans
      expect(live.some((span) => span.kind === 'agent' && span.name === 'impl-01')).toBe(true)
      expect(live.filter((span) => span.kind === 'orchestrator-turn').length).toBeGreaterThan(0)
      expect(live).toEqual((await recorder.view(world.project, world.run)).timeline.spans)
    }
    await sameAsFull()
    // gh has not been read again within the minute, however often the timeline was recomputed.
    expect(await gh.prLists()).toBe(ghAtOpen)

    // A line half written: one step looks at it, the next ones do not until it grows again.
    await appendFile(world.transcript, '{"type":"assistant","timestamp":')
    now += RECOMPUTE_INTERVAL_MS
    await timer.fire()
    const afterHalf = subscriber.views.length
    for (let n = 0; n < 3; n++) {
      now += RECOMPUTE_INTERVAL_MS
      await timer.fire()
    }
    expect(subscriber.views).toHaveLength(afterHalf)

    // A minute after the read gh is read again, and the timeline goes out with its answer.
    now = T0 + 10_000 + MINUTE
    await timer.fire()
    expect(await gh.prLists()).toBe(ghAtOpen + 1)
    expect(subscriber.views).toHaveLength(afterHalf + 1)

    // The transcript replaced by another file (a rewrite, a restore): read again from its start, nothing kept of the old one.
    const replacement = `${world.transcript}.new`
    await writeFile(replacement, orchestratorLines(world.root) + record(world.root, 50, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'impl-01 is back' }] } }))
    await rename(replacement, world.transcript)
    appended.mockClear()
    now += RECOMPUTE_INTERVAL_MS
    await timer.fire()
    expect(subscriber.views).toHaveLength(afterHalf + 2)
    // Parsed again from its start: every line of the new file.
    expect(parsed()).toBe((await readFile(world.transcript, 'utf8')).split('\n').filter(Boolean).length)
    appended.mockRestore()
    await sameAsFull()

    // The Run stops while Autopilot still works on the Epic: the run-stopped line ends it, the last
    // timeline is not live, and the timer stops with it.
    await appendFile(world.journal, journalLine({ at: at(80), run: world.run, project: world.project, epic: 'e', kind: 'run-stopped', reason: 'tickets-done' }))
    now += RECOMPUTE_INTERVAL_MS
    await timer.fire()
    expect(subscriber.views.at(-1)?.timeline.live).toBe(false)
    expect(timer.state.tick).toBeNull()
    recorder.dispose()
  })

  it('stops the timer when the last window lets the Run go', async () => {
    const world = await liveWorld()
    const timer = manualTimer()
    const recorder = new FlightRecorder({ env: { WORFY_DATA_DIR: world.data, WORFY_CLAUDE_HOME: world.home }, harnessHome: await folder('harness'), projectRoot: () => world.root, profile: async () => profileOf(), gh: async () => '[]', running: () => true, git: noGit, now: () => T0 + 10_000, schedule: timer.schedule })
    await recorder.open(world.project, world.run, collector(1))
    await recorder.open(world.project, world.run, collector('link:m/1'))
    expect(recorder.close(world.project, world.run, 1)).toBe(true)
    expect(timer.state.tick).not.toBeNull()
    recorder.drop('link:m/1')
    expect(timer.state.tick).toBeNull()
    expect(recorder.close(world.project, world.run, 1)).toBe(false)
  })

  it('a window closed or dropped while the first timeline is computed holds nothing: no timer, no subscriber', async () => {
    const world = await liveWorld()
    const timer = manualTimer()
    const holds: ReturnType<typeof hold>[] = []
    const recorder = await liveRecorder(world, timer, { branches: holdingBranches(holds) })
    // Dropped (its window closed, a Linked machine's access switched off) during the first compute.
    const first = hold()
    holds.push(first)
    const opening = recorder.open(world.project, world.run, collector(1))
    await first.reached
    recorder.drop(1)
    first.release()
    expect((await opening).timeline.live).toBe(true)
    expect(timer.state.tick).toBeNull()
    expect(recorder.close(world.project, world.run, 1)).toBe(false)
    // Closed during the first compute: the close finds what it closes.
    const second = hold()
    holds.push(second)
    const reopening = recorder.open(world.project, world.run, collector(2))
    await second.reached
    expect(recorder.close(world.project, world.run, 2)).toBe(true)
    second.release()
    await reopening
    expect(timer.state.tick).toBeNull()
  })

  it('two windows that open the same Run at once both get its new timelines, and each close counts', async () => {
    const world = await liveWorld()
    const timer = manualTimer()
    const recorder = await liveRecorder(world, timer)
    const [a, b] = [collector(1), collector('link:m/1')]
    await Promise.all([recorder.open(world.project, world.run, a), recorder.open(world.project, world.run, b)])
    // Each open's recompute goes to the other window too.
    expect([a.views.length, b.views.length]).toEqual([1, 1])
    await appendFile(world.journal, journalLine({ at: at(11), run: world.run, project: world.project, epic: 'e', kind: 'background-tasks', tasks: [] }))
    await timer.fire()
    expect([a.views.length, b.views.length]).toEqual([2, 2])
    expect(recorder.close(world.project, world.run, 1)).toBe(true)
    expect(timer.state.tick).not.toBeNull()
    expect(recorder.close(world.project, world.run, 'link:m/1')).toBe(true)
    expect(timer.state.tick).toBeNull()
  })

  it('a window that joins a live Run after its run-stopped line gives the stopped timeline to the window that held it', async () => {
    const world = await liveWorld()
    const timer = manualTimer()
    const recorder = await liveRecorder(world, timer)
    const a = collector(1)
    expect((await recorder.open(world.project, world.run, a)).timeline.live).toBe(true)
    await appendFile(world.journal, journalLine({ at: at(30), run: world.run, project: world.project, epic: 'e', kind: 'run-stopped', reason: 'tickets-done' }))
    // Window B opens before the next step: its recompute reads the line the step would have.
    const joined = await recorder.open(world.project, world.run, collector(2))
    expect(joined.timeline.live).toBe(false)
    expect(a.views).toEqual([joined])
    expect(timer.state.tick).toBeNull()
  })

  it('an open that fails leaves no subscriber behind, and keeps the one the same client held', async () => {
    const world = await liveWorld()
    const timer = manualTimer()
    let gone = false
    const recorder = await liveRecorder(world, timer, {
      projectRoot: () => {
        if (gone) throw new Error('the Project is gone')
        return world.root
      },
    })
    const [a, b] = [collector(1), collector(2)]
    await recorder.open(world.project, world.run, a)
    gone = true
    await expect(recorder.open(world.project, world.run, b)).rejects.toThrow('the Project is gone')
    gone = false
    await appendFile(world.journal, journalLine({ at: at(11), run: world.run, project: world.project, epic: 'e', kind: 'background-tasks', tasks: [] }))
    await timer.fire()
    expect([a.views.length, b.views.length]).toEqual([1, 0])
    expect(recorder.close(world.project, world.run, 2)).toBe(false)

    // Client 1 opens the Run again (IPC makes a new subscriber per call) and that open fails: its first subscription stays.
    gone = true
    await expect(recorder.open(world.project, world.run, collector(1))).rejects.toThrow('the Project is gone')
    gone = false
    await appendFile(world.journal, journalLine({ at: at(12), run: world.run, project: world.project, epic: 'e', kind: 'background-tasks', tasks: [] }))
    await timer.fire()
    expect(a.views).toHaveLength(2)
    expect(recorder.close(world.project, world.run, 1)).toBe(true)
  })

  it('a step that cannot recompute ends the live timeline: the windows get the last one, not live, with the reason, and the timer stops', async () => {
    const world = await liveWorld()
    const timer = manualTimer()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let gone = false
    const recorder = await liveRecorder(world, timer, {
      projectRoot: () => {
        if (gone) throw new Error('the Project is gone')
        return world.root
      },
    })
    const subscriber = collector()
    const opened = await recorder.open(world.project, world.run, subscriber)
    expect(opened.error).toBeNull()
    gone = true
    await appendFile(world.journal, journalLine({ at: at(11), run: world.run, project: world.project, epic: 'e', kind: 'background-tasks', tasks: [] }))
    await timer.fire()
    expect(subscriber.views).toHaveLength(1)
    expect(subscriber.views[0]).toMatchObject({ error: 'the timeline could not be recomputed: the Project is gone', timeline: { live: false, spans: opened.timeline.spans } })
    expect(timer.state.tick).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('a Run let go while a step, a «Retry» or a join recomputes it sends nothing', async () => {
    const world = await liveWorld()
    const timer = manualTimer()
    const holds: ReturnType<typeof hold>[] = []
    const recorder = await liveRecorder(world, timer, { branches: holdingBranches(holds) })
    const subscriber = collector()
    await recorder.open(world.project, world.run, subscriber)
    const held = hold()
    holds.push(held)
    await appendFile(world.journal, journalLine({ at: at(11), run: world.run, project: world.project, epic: 'e', kind: 'background-tasks', tasks: [] }))
    const step = timer.fire()
    await held.reached
    recorder.dispose()
    held.release()
    await step
    expect(subscriber.views).toEqual([])
    expect(timer.state.tick).toBeNull()

    // Nor does a «Retry» whose Run is let go before it ends.
    await recorder.open(world.project, world.run, subscriber)
    const again = hold()
    holds.push(again)
    const retried = recorder.retry(world.project, world.run)
    await again.reached
    recorder.dispose()
    again.release()
    expect((await retried).run).toBe(world.run)
    expect(subscriber.views).toEqual([])

    // Nor does a window join whose Run is let go before its recompute ends.
    await recorder.open(world.project, world.run, subscriber)
    const third = hold()
    holds.push(third)
    const joining = recorder.open(world.project, world.run, collector(2))
    await third.reached
    recorder.dispose()
    third.release()
    await joining
    expect(subscriber.views).toEqual([])
  })

  it('a step while a «Retry» of the Run is in flight leaves it to the next step, and two steps at once are one', async () => {
    const world = await liveWorld()
    const timer = manualTimer()
    const holds: ReturnType<typeof hold>[] = []
    const recorder = await liveRecorder(world, timer, { branches: holdingBranches(holds) })
    const subscriber = collector()
    await recorder.open(world.project, world.run, subscriber)
    const held = hold()
    holds.push(held)
    const retried = recorder.retry(world.project, world.run)
    await held.reached
    // The «Retry» has read the transcript; a line comes after it.
    await appendFile(world.transcript, record(world.root, 30, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'waiting for impl-01' }] } }))
    const step = timer.fire()
    held.release()
    await Promise.all([retried, step])
    expect(subscriber.views).toHaveLength(1)
    // The next step sees the line.
    await timer.fire()
    expect(subscriber.views).toHaveLength(2)
    expect(subscriber.views[1]!.timeline.spans).toEqual((await recorder.view(world.project, world.run)).timeline.spans)

    // Two steps at once: one recompute, one runs.changed.
    await appendFile(world.journal, journalLine({ at: at(31), run: world.run, project: world.project, epic: 'e', kind: 'background-tasks', tasks: [] }))
    await Promise.all([timer.fire(), timer.fire()])
    expect(subscriber.views).toHaveLength(3)
    recorder.dispose()
  })

  it('a Subagent whose file comes after the open is seen on the next step', async () => {
    const world = await liveWorld()
    const timer = manualTimer()
    const recorder = await liveRecorder(world, timer)
    const subscriber = collector()
    const opened = await recorder.open(world.project, world.run, subscriber)
    // impl-01 was launched (the Orchestrator's transcript says so); its own file is written now.
    const agentLine = (seconds: number, value: Record<string, unknown>) => `${JSON.stringify({ timestamp: at(seconds), cwd: world.worktree, sessionId: SESSION, isSidechain: true, agentId: 'a1', ...value })}\n`
    await writeFile(join(world.subagents, 'agent-a1.jsonl'), agentLine(3, { type: 'user', message: { role: 'user', content: 'task' } }) + agentLine(9, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] } }))
    // Nothing else changed: the step comes from the new file alone.
    await timer.fire()
    expect(subscriber.views).toHaveLength(1)
    expect(subscriber.views[0]!.timeline.spans).toEqual((await recorder.view(world.project, world.run)).timeline.spans)
    expect(opened.timeline.spans.some((span) => span.kind === 'agent' && span.name === 'impl-01')).toBe(true)
    // Its next line is the only line of it parsed on the next step (worfy-flight-recorder ticket 27).
    const parsedOwn = vi.spyOn(SubagentParse.prototype, 'append')
    await appendFile(join(world.subagents, 'agent-a1.jsonl'), agentLine(12, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'still working' }] } }))
    await timer.fire()
    expect(subscriber.views).toHaveLength(2)
    expect(parsedOwn.mock.calls.reduce((sum, [lines]) => sum + lines.length, 0)).toBe(1)
    parsedOwn.mockRestore()
    expect(subscriber.views[1]!.timeline.spans).toEqual((await recorder.view(world.project, world.run)).timeline.spans)
    recorder.dispose()
  })

  it('a Wave that names no Session is read whole on each step, not tailed', async () => {
    const world = await liveWorld({ session: false })
    const timer = manualTimer()
    const tail = vi.fn(readNewLines)
    const recorder = await liveRecorder(world, timer, { tail })
    const view = await recorder.open(world.project, world.run, collector())
    expect(view.timeline.live).toBe(true)
    expect(view.timeline.spans.some((span) => span.kind === 'orchestrator-turn')).toBe(true)
    expect(tail).not.toHaveBeenCalled()
    recorder.dispose()
  })
})

// The cost of a live Run whose Orchestrator transcript is 160 MB (test/big-transcript.ts): the first
// open, a step after one appended line, and the heap the open Run holds. The numbers are printed
// with WORFY_PERF=1 only: the file takes a few seconds to write. They are in the result section of ticket 17.
describe.skipIf(process.env.WORFY_PERF !== '1')('a live Run with a 160 MB transcript', () => {
  it('opens once, then recomputes from the new lines only', { timeout: ms(300_000) }, async () => {
    const world = await liveWorld()
    const { size } = writeBigTranscript(world.transcript, { sessionId: SESSION, cwd: world.root, bytes: 160 * 1024 * 1024 })
    await appendFile(world.transcript, orchestratorLines(world.root))
    const timer = manualTimer()
    let now = T0 + 10_000
    const recorder = await liveRecorder(world, timer, { now: () => now })
    const heap = () => {
      ;(globalThis as { gc?: () => void }).gc?.()
      return process.memoryUsage().heapUsed
    }
    const before = heap()
    let started = performance.now()
    const subscriber = collector()
    await recorder.open(world.project, world.run, subscriber)
    const open = performance.now() - started
    const held = heap() - before
    const steps: number[] = []
    const blocked = monitorEventLoopDelay({ resolution: 1 })
    blocked.enable()
    for (let n = 0; n < 10; n++) {
      await appendFile(world.transcript, record(world.root, 30 + n, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `step ${n}` }] } }))
      now += RECOMPUTE_INTERVAL_MS
      started = performance.now()
      await timer.fire()
      steps.push(performance.now() - started)
    }
    blocked.disable()
    expect(subscriber.views).toHaveLength(10)
    steps.sort((a, b) => a - b)
    const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(0)
    console.info(
      `[flight-recorder] transcript ${mb(size)} MB: first open ${open.toFixed(0)} ms; a step after one line: median ${steps[5]!.toFixed(1)} ms, max ${steps[9]!.toFixed(1)} ms, the main thread held at most ${(blocked.max / 1e6).toFixed(1)} ms at a time; heap held by the open Run ${mb(held)} MB${(globalThis as { gc?: unknown }).gc === undefined ? ' (no gc: an upper bound)' : ''}`,
    )
    recorder.dispose()
  })
})

// The same on an Orchestrator Session shaped like the real one the review of ticket 17 measured
// (worfy-flight-recorder ticket 27): a transcript of about 160 MB over five days with about 1300
// agents, a Run window of 12 h holding about 110 of them, each with its own file of about 1 MB.
// Synthetic (test/contract/flight-recorder-shaped-transcript.ts); the numbers are printed with WORFY_PERF=1
// only and are in the result section of ticket 27.
describe.skipIf(process.env.WORFY_PERF !== '1')('a live Run on a Session shaped like a real one', () => {
  it('a step after new lines parses only them', { timeout: ms(300_000) }, async () => {
    const data = await folder('data')
    const home = await folder('claude')
    const root = await folder('repo')
    const dir = join(home, 'projects', projectDirName(root))
    const turns = 3_000
    const turnSeconds = 170
    const window = 12 * 3600 * 1000
    const start = T0 - turns * turnSeconds * 1000
    // Written and let go: the heap below is the open Run's, not the test's copy of the files.
    const { end, tickets, bytes, agents, inWindow } = (() => {
      const shaped = shapedSession({ sessionId: SESSION, cwd: root, epic: 'e', turns, start, turnSeconds, toolResultBytes: 17_000, toolsPerTurn: 2, promptBytes: 15_000, reportBytes: 6_000, subagentRecords: 40, subagentRecordBytes: 27_000, subagentsFrom: T0 - window })
      return { bytes: writeShapedSession(dir, shaped, SESSION).bytes, end: shaped.end, agents: shaped.agents, inWindow: shaped.subagents.size, tickets: shaped.tickets }
    })()
    const transcriptBytes = (await stat(join(dir, `${SESSION}.jsonl`))).size
    const runStart = end - window
    const runAt = (offset: number) => new Date(runStart + offset).toISOString()
    const run = makeRunId(new Date(runStart), 'ffffff')
    const project = 'live-0a1b2c3d'
    // The Run's Tickets: those of the last Waves, as Autopilot names them.
    const numbers = tickets.slice(-12).map((ticket) => /(\d+)$/u.exec(ticket)![1]!.padStart(2, '0'))
    const journal = await writeJournal(data, run, [
      { at: runAt(0), run, project, epic: 'e', kind: 'run-started' },
      { at: runAt(1_000), run, project, epic: 'e', kind: 'wave-started', wave: 1, tickets: numbers, text: 'go', session: SESSION },
    ])
    expect(journal).toBeTruthy()
    const timer = manualTimer()
    let now = end + 10_000
    const recorder = new FlightRecorder({ env: { WORFY_DATA_DIR: data, WORFY_CLAUDE_HOME: home }, harnessHome: await folder('harness'), projectRoot: () => root, profile: async () => profileOf({ finish: 'local-green' }), gh: async () => '[]', running: () => true, git: noGit, now: () => now, schedule: timer.schedule })
    const heap = () => {
      ;(globalThis as { gc?: () => void }).gc?.()
      return process.memoryUsage().heapUsed
    }
    const before = heap()
    let started = performance.now()
    const subscriber = collector()
    const opened = await recorder.open(project, run, subscriber)
    const open = performance.now() - started
    const held = heap() - before
    const agentSpans = opened.timeline.spans.filter((span) => span.kind === 'agent').length
    // Each step: a line of the Orchestrator and a line of each of three Subagents that still work.
    const working = (await readdir(join(dir, SESSION, 'subagents'))).filter((name) => name.endsWith('.jsonl')).slice(-3)
    const steps: number[] = []
    const appended = vi.spyOn(TranscriptParse.prototype, 'append')
    // How long the main thread is held at a time: the reads in between leave it free.
    const blocked = monitorEventLoopDelay({ resolution: 1 })
    blocked.enable()
    for (let n = 0; n < 10; n++) {
      const at = new Date(end + (n + 1) * 1_000).toISOString()
      await appendFile(join(dir, `${SESSION}.jsonl`), `${JSON.stringify({ type: 'assistant', timestamp: at, cwd: root, sessionId: SESSION, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: `step ${n}` }] } })}\n`)
      for (const name of working) await appendFile(join(dir, SESSION, 'subagents', name), `${JSON.stringify({ type: 'assistant', timestamp: at, cwd: root, sessionId: SESSION, isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: `working ${n}` }] } })}\n`)
      now += RECOMPUTE_INTERVAL_MS
      started = performance.now()
      await timer.fire()
      steps.push(performance.now() - started)
    }
    blocked.disable()
    const parsed = appended.mock.calls.reduce((sum, [lines]) => sum + lines.length, 0)
    appended.mockRestore()
    expect(subscriber.views).toHaveLength(10)
    expect(parsed).toBe(10)
    // The live timeline is the one a whole read gives.
    expect(subscriber.views.at(-1)!.timeline.spans).toEqual((await recorder.view(project, run)).timeline.spans)
    steps.sort((a, b) => a - b)
    const mb = (value: number) => (value / 1024 / 1024).toFixed(0)
    console.info(
      `[flight-recorder] shaped Session: transcript ${mb(transcriptBytes)} MB, all files ${mb(bytes)} MB, ${agents} agents, ${inWindow} Subagent files in the 12 h window, ${agentSpans} agent spans in the Run; first open ${open.toFixed(0)} ms; a step after new lines: median ${steps[5]!.toFixed(1)} ms, max ${steps[9]!.toFixed(1)} ms, the main thread held at most ${(blocked.max / 1e6).toFixed(1)} ms at a time; heap held by the open Run ${mb(held)} MB${(globalThis as { gc?: unknown }).gc === undefined ? ' (no gc: an upper bound)' : ''}`,
    )
    recorder.dispose()
  })
})

describe('worktree paths of two readers', () => {
  it('an agent whose transcript names its worktree through a link and a gate run of the real worktree meet in one Ticket', async () => {
    const world = await liveWorld()
    const link = join(await folder('links'), 'wt-01')
    symlinkSync(world.worktree, link, process.platform === 'win32' ? 'junction' : 'dir')
    // impl-01 works in the worktree through the link; its report names no Ticket.
    const agentLine = (seconds: number, value: Record<string, unknown>) => `${JSON.stringify({ timestamp: at(seconds), cwd: link, sessionId: SESSION, isSidechain: true, ...value })}\n`
    await writeFile(join(world.subagents, 'agent-a1.jsonl'), agentLine(3, { type: 'user', message: { role: 'user', content: 'task' } }) + agentLine(40, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }))
    await appendFile(
      world.transcript,
      record(world.root, 41, { type: 'user', message: { role: 'user', content: '<task-notification><task-id>a1</task-id><tool-use-id>c1</tool-use-id><status>completed</status><summary>done</summary></task-notification>' } }),
    )
    // A gate run of the real worktree, with a head no Ticket event names: only the worktree can place it.
    const harness = await folder('harness')
    const gateFolder = join(harness, 'gate', 'state', 'logs', '0b1c2d3e', `${at(20).replace(/\.\d+Z$/u, 'Z').replaceAll(':', '-')}-4242`)
    await mkdir(gateFolder, { recursive: true })
    await writeFile(
      join(gateFolder, 'timings.json'),
      JSON.stringify({ version: 1, profile: 'fast', key: 'worfy', worktree: world.worktree, head: 'f'.repeat(40), outcome: 'green', exit: 0, at: at(30).replace(/\.\d+Z$/u, 'Z'), total_ms: 10_000, steps: [{ step: 'worfy/.:lint', package: '.', script: 'lint', ms: 5_000, exit: 0 }], cached: [] }),
    )
    await appendFile(world.journal, journalLine({ at: at(2), run: world.run, project: world.project, epic: 'e', kind: 'ticket-status', ticket: '01', state: 'claimed' }))
    await appendFile(world.journal, journalLine({ at: at(60), run: world.run, project: world.project, epic: 'e', kind: 'run-stopped', reason: 'tickets-done' }))
    const gh = vi.fn(async () => '[]')
    const recorder = new FlightRecorder({ env: { WORFY_DATA_DIR: world.data, WORFY_CLAUDE_HOME: world.home }, harnessHome: harness, projectRoot: () => world.root, profile: async () => profileOf({ finish: 'local-green' }), gh, running: () => false, git: noGit, now: () => T0 + MINUTE * 5 })

    const view = await recorder.view(world.project, world.run)
    // workflow.finish local-green: the Tickets end without a PR, and gh is not run.
    expect(view.github).toEqual({ state: 'unused', reason: 'workflow.finish is local-green: the Tickets end without a PR' })
    expect(gh).not.toHaveBeenCalled()
    const { spans } = view.timeline
    const agent = spans.find((span) => span.kind === 'agent' && span.name === 'impl-01')
    const gate = spans.find((span) => span.kind === 'gate' && span.lost === null)
    expect(agent?.links.ticket).toBe('e/01')
    expect(gate?.links.ticket).toBe('e/01')
  })
})

describe('the Profile\'s GitHub account', () => {
  it('without github.account no comment is a verdict, and the view says why; no account is guessed', async () => {
    const world = await liveWorld()
    await appendFile(world.journal, journalLine({ at: at(2), run: world.run, project: world.project, epic: 'e', kind: 'ticket-status', ticket: '01', state: 'claimed' }))
    await appendFile(world.journal, journalLine({ at: at(600), run: world.run, project: world.project, epic: 'e', kind: 'run-stopped', reason: 'tickets-done' }))
    // The PR of e/01: REJECTED by the account, a fix pushed, VERIFIED, merged.
    const pr = {
      number: 9,
      headRefName: 'e/01',
      state: 'MERGED',
      createdAt: at(100),
      mergedAt: at(500),
      mergeCommit: { oid: 'c'.repeat(40) },
      headRefOid: 'b'.repeat(40),
      commits: [
        { oid: 'a'.repeat(40), committedDate: at(90) },
        { oid: 'b'.repeat(40), committedDate: at(300) },
      ],
      comments: [
        { author: { login: ACCOUNT }, createdAt: at(200), body: 'REJECTED: [med] the test is missing' },
        { author: { login: ACCOUNT }, createdAt: at(400), body: 'VERIFIED' },
      ],
      statusCheckRollup: [],
      labels: [],
    }
    const gh = async (_root: string, args: readonly string[]) => (args[0] === 'pr' ? JSON.stringify([pr]) : '[]')
    const viewWith = async (profile: RunProfile) =>
      new FlightRecorder({ env: { WORFY_DATA_DIR: world.data, WORFY_CLAUDE_HOME: world.home }, harnessHome: await folder('harness'), projectRoot: () => world.root, profile: async () => profile, gh, running: () => false, git: noGit, now: () => T0 + MINUTE * 20 }).view(world.project, world.run)
    const withAccount = await viewWith(profileOf())
    const without = await viewWith(profileOf({ account: null, accountReason: 'github.account is null' }))
    // A Profile that names no account and gives no reason: the view says so itself.
    expect((await viewWith(profileOf({ account: null, accountReason: null }))).github).toMatchObject({ account: null, accountReason: 'the Profile names no github.account' })
    expect(withAccount.github).toEqual({ state: 'answered', at: expect.any(Number), account: ACCOUNT, accountReason: null })
    expect(without.github).toEqual({ state: 'answered', at: expect.any(Number), account: null, accountReason: 'github.account is null' })
    const stages = (view: RunView) => view.timeline.spans.filter((span) => span.kind === 'stage').map((span) => [span.name, span.attempt, span.outcome].join(' | '))
    // With the account: the REJECTED comment ends a review attempt and a second round follows.
    expect(stages(withAccount)).toEqual(['Queued | 1 | ok', 'Implementing + CI | 1 | ok', 'Agent review | 1 | rejected', 'Implementing + CI | 2 | ok', 'Agent review | 2 | ok', 'Gate & merge | 1 | ok', 'Closing | 1 | cut-off'])
    // Without one, the comments count for nothing: no boundary of review in the sources.
    expect(stages(without)).toEqual(['Queued | 1 | ok', 'Implementing + CI | 1 | ok', 'Agent review + Gate & merge | 1 | ok', 'Closing | 1 | cut-off'])
  })
})

describe('a Project whose Tickets end without a PR', () => {
  it('runs no gh and says why', async () => {
    const world = await liveWorld()
    const gh = vi.fn(async () => '[]')
    const recorder = new FlightRecorder({ env: { WORFY_DATA_DIR: world.data, WORFY_CLAUDE_HOME: world.home }, harnessHome: await folder('harness'), projectRoot: () => world.root, profile: async () => profileOf({ mode: 'silent' }), gh, running: () => false, git: noGit, now: () => T0 + MINUTE })
    const view = await recorder.view(world.project, world.run)
    expect(view.github).toEqual({ state: 'unused', reason: 'Silent mode: the Tickets end without a PR' })
    expect(gh).not.toHaveBeenCalled()
    expect(view.timeline.spans.some((span) => span.lost === 'github-no-answer')).toBe(false)
  })
})

