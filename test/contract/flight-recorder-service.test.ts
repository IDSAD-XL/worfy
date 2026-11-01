// The Flight Recorder service (src/main/flight-recorder/service.ts; worfy-flight-recorder ticket 17): the
// Runs of a Project from the Journals of a temporary WORFY_DATA_DIR, and the timeline of one Run from all four
// readers — the night-Run fixture (test/fixtures/flight-recorder/night-run/: its Journal, its transcripts as
// WORFY_CLAUDE_HOME, its gate logs as the Harness home, gh through the stand-in of WORFY_GH) and small Runs
// written here. The live timeline runs on a clock and a timer of the test: ten Journal lines within one
// interval give one `runs.changed`, gh is read at most once a minute, a transcript is read on from where the
// last read stopped. Nothing reaches GitHub, no real Claude Code or Agent SDK runs, git is a stand-in.
import { symlinkSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectDirName } from '../../src/main/claude-home/registry'
import { readNewLines } from '../../src/main/claude-home/tail'
import { FlightRecorder, RECOMPUTE_INTERVAL_MS, type FlightRecorderOptions, type RunProfile, type RunSubscriber } from '../../src/main/flight-recorder/service'
import { accountAuth, ghRunner, PrTracker } from '../../src/main/github/prs'
import { formatJournalLine, makeRunId, type JournalEvent } from '../../src/shared/autopilot/journal'
import type { RunView } from '../../src/shared/ipc/runs'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'
import { removeTestTree } from '../remove'

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
  const nightRecorder = async (gh: FlightRecorderOptions['gh'], profile: RunProfile = profileOf()) =>
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
    const recorder = await nightRecorder(world.gh)
    const subscriber = collector()
    const view = await recorder.open(NIGHT_PROJECT, NIGHT_RUN, subscriber)
    expect(view.github).toMatchObject({ state: 'no-answer', reason: expect.stringContaining('error connecting to api.github.com') })
    expect(view.timeline.spans.filter((span) => span.kind === 'ticket')).toHaveLength(4)
    expect(view.timeline.spans.some((span) => span.lost === 'github-no-answer')).toBe(true)
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

async function liveWorld() {
  const data = await folder('data')
  const home = await folder('claude')
  const root = await folder('repo')
  const run = makeRunId(new Date(T0), 'eeeeee')
  const project = 'live-0a1b2c3d'
  const journal = await writeJournal(data, run, [
    { at: at(0), run, project, epic: 'e', kind: 'run-started' },
    { at: at(1), run, project, epic: 'e', kind: 'wave-started', wave: 1, tickets: ['01'], session: SESSION },
  ])
  const dir = join(home, 'projects', projectDirName(root))
  await mkdir(join(dir, SESSION, 'subagents'), { recursive: true })
  const transcript = join(dir, `${SESSION}.jsonl`)
  await writeFile(transcript, orchestratorLines(root))
  const worktree = join(root, '.claude', 'worktrees', '01')
  await mkdir(worktree, { recursive: true })
  return { data, home, root, run, project, journal, transcript, worktree, subagents: join(dir, SESSION, 'subagents') }
}

describe('the live timeline', () => {
  it(`recomputes on new Journal lines at most once per ${RECOMPUTE_INTERVAL_MS / 1000} s, reads gh at most once a minute, and reads a transcript on from where it stopped`, async () => {
    const world = await liveWorld()
    const gh = await ghWorld()
    const timer = manualTimer()
    let now = T0 + 10_000
    let running = true
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
      running: () => running,
      git: noGit,
      now: () => now,
      schedule: timer.schedule,
      tail,
    })
    const subscriber = collector()
    const opened = await recorder.open(world.project, world.run, subscriber)
    expect(opened.timeline.live).toBe(true)
    expect(timer.state.ms).toBe(RECOMPUTE_INTERVAL_MS)
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

    // A transcript line: read from where the last read stopped, not from the start.
    const size = (await readFile(world.transcript)).length
    await appendFile(world.transcript, record(world.root, 30, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'waiting for impl-01' }] } }))
    now += RECOMPUTE_INTERVAL_MS
    await timer.fire()
    expect(subscriber.views).toHaveLength(2)
    expect(reads.filter((read) => read.file === world.transcript).at(-1)).toEqual({ file: world.transcript, from: size })
    // gh has not been read again within the minute, however often the timeline was recomputed.
    expect(await gh.prLists()).toBe(ghAtOpen)

    // A minute after the read gh is read again, and the timeline goes out with its answer.
    now = T0 + 10_000 + MINUTE
    await timer.fire()
    expect(await gh.prLists()).toBe(ghAtOpen + 1)
    expect(subscriber.views).toHaveLength(3)

    // The Run stops: the last timeline is not live, and the timer stops with it.
    running = false
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
    const recorder = new FlightRecorder({ env: { WORFY_DATA_DIR: world.data, WORFY_CLAUDE_HOME: world.home }, harnessHome: harness, projectRoot: () => world.root, profile: async () => profileOf({ finish: 'local-green' }), gh: async () => '[]', running: () => false, git: noGit, now: () => T0 + MINUTE * 5 })

    const { spans } = (await recorder.view(world.project, world.run)).timeline
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

