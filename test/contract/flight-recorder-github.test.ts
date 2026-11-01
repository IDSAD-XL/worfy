// GitHub for Flight Recorder (src/main/flight-recorder/github.ts and src/shared/flight-recorder/from-github.ts;
// worfy-flight-recorder ticket 15) against a gh stand-in named by WORFY_GH (test/fixtures/flight-recorder/gh-night-run.mjs),
// which answers with the gh answers of the night-Run fixture: the PRs and CI runs of the Run's Tickets by their
// branch, at most one gh read a minute, «GitHub did not answer» with the local part of the timeline when gh
// fails, and gh run as the Project's account through the PR tracker. Nothing here reaches GitHub.
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GithubReader, PR_FIELDS, RUN_FIELDS, type GithubRead } from '../../src/main/flight-recorder/github'
import { accountAuth, ghRunner, PrTracker } from '../../src/main/github/prs'
import { githubFacts, githubNoAnswer, type GithubFacts } from '../../src/shared/flight-recorder/from-github'
import { parseJournal, walkRun } from '../../src/shared/flight-recorder/journal-walk.mjs'
import { buildTimeline, LOST_SOURCE_LABELS, type RunFacts } from '../../src/shared/flight-recorder/spans'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'

const FIXTURES = join(__dirname, '..', 'fixtures', 'flight-recorder')
const NIGHT = join(FIXTURES, 'night-run')
const STAND_IN = join(FIXTURES, 'gh-night-run.mjs')
const NIGHT_RUN = '2026-10-17T22-29-32-707Z-58e783'
const ACCOUNT = 'night-owner'
const TOKEN = 'token-of-night-owner'
const MINUTE = 60_000

// A token the developer's shell exports must reach no stand-in: it logs GH_TOKEN.
beforeEach(() => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) vi.stubEnv(name, undefined)
})

const temps: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const iso = (ms: number): string => new Date(ms).toISOString()

/** The local part of the night Run's timeline: the Run and its Waves from the Journal. */
async function nightLocal(): Promise<RunFacts> {
  const walked = walkRun(parseJournal(await readFile(join(NIGHT, 'data', 'autopilot', `${NIGHT_RUN}.jsonl`), 'utf8')).events)
  const startedAt = iso(walked.started?.at ?? 0)
  const stoppedAt = iso(walked.stopped?.at ?? 0)
  return {
    run: { id: NIGHT_RUN, startedAt, stoppedAt, live: false, reason: walked.stopped?.reason ?? 'stopped' },
    now: stoppedAt,
    pipeline: DEFAULT_PIPELINE,
    waves: walked.waves.map((wave) => ({ number: wave.wave, startedAt: iso(wave.start), finishedAt: wave.end === null ? null : iso(wave.end), tickets: wave.tickets })),
    ticketEvents: [],
    work: [],
    retryCauses: [],
    waits: [],
    turns: [],
    lost: [],
    orchestratorMarks: [],
  }
}

const TICKETS = ['03', '07', '04', '05'].map((ticket) => ({ ticket, branch: `worfy-pipeline/${ticket}` }))
const BRANCHES = TICKETS.map(({ branch }) => branch)

/**
 * The stand-in behind the PR tracker as the app builds it: `ghRunner` with WORFY_GH, `accountAuth` with the
 * Project's account, and the reader on `PrTracker.gh`. `calls()` — what gh was run with, and the GH_TOKEN it had.
 */
async function nightWorld(account: string = ACCOUNT) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-fr-gh-')))
  temps.push(dir)
  const log = join(dir, 'calls.jsonl')
  const failFile = join(dir, 'fail')
  await writeFile(log, '')
  let now = Date.parse('2026-11-01T10:00:00Z')
  const run = ghRunner({ processEnv: { WORFY_GH: STAND_IN }, env: async () => ({ ...process.env, FR_GH_DIR: join(NIGHT, 'gh'), FR_GH_LOG: log, FR_GH_FAIL: failFile, FR_GH_ACCOUNT: ACCOUNT, FR_GH_TOKEN: TOKEN }) })
  const tracker = new PrTracker({ run, auth: accountAuth({ account: () => Promise.resolve(account), run }) })
  const reader = new GithubReader({ gh: (root, args) => tracker.gh(root, args), now: () => now })
  const calls = async (): Promise<{ token: string | null; args: string[] }[]> =>
    (await readFile(log, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { token: string | null; args: string[] })
  return {
    root: dir,
    reader,
    calls,
    later: (ms: number) => void (now += ms),
    fail: (text: string) => writeFile(failFile, text),
    heal: () => rm(failFile, { force: true }),
  }
}

async function factsOf(read: GithubRead, local: RunFacts, crossMachineGate = null as Parameters<typeof githubFacts>[1]['crossMachineGate']): Promise<GithubFacts> {
  if (read.answer === null) return githubNoAnswer()
  return githubFacts(read.answer, { tickets: TICKETS, window: { start: local.run.startedAt, end: local.run.stoppedAt }, crossMachineGate })
}

const withFacts = (local: RunFacts, facts: GithubFacts): RunFacts => ({ ...local, ticketEvents: facts.ticketEvents, work: facts.work, waits: facts.waits, lost: facts.lost })

describe('the night Run from gh', () => {
  it('gives the PRs and the CI runs of the Tickets by their branch; a second read within the minute runs no gh', async () => {
    const world = await nightWorld()
    const local = await nightLocal()
    const read = await world.reader.read(world.root, BRANCHES)
    expect(read.error).toBeNull()
    const facts = await factsOf(read, local)

    const opened = Object.fromEntries(facts.ticketEvents.flatMap((event) => (event.event === 'pr-opened' ? [[event.ticket, event.pr]] : [])))
    expect(opened).toEqual({ '03': 457, '07': 460, '04': 467, '05': 468 })
    const merges = facts.ticketEvents.flatMap((event) => (event.event === 'merge' ? [[event.ticket, event.pr, event.sha?.slice(0, 8)]] : []))
    expect(merges).toEqual([
      ['03', 457, '8f0f945f'],
      ['04', 467, 'e074b41f'],
      ['05', 468, '786aee97'],
      ['07', 460, '62a4c4ab'],
    ])
    // CI ran in batch on main: the runs of the merge commits of #460 and #467 are those Tickets' CI.
    expect(facts.work.map(({ ticket, id, kind, start, end, outcome }) => ({ ticket, id, kind, start, end, outcome }))).toEqual([
      { ticket: '04', id: 'gh-run:39092198641', kind: 'ci', start: '2026-10-18T03:02:21Z', end: '2026-10-18T03:15:26Z', outcome: 'ok' },
      { ticket: '07', id: 'gh-run:39084438682', kind: 'ci', start: '2026-10-18T00:53:30Z', end: '2026-10-18T01:11:29Z', outcome: 'ok' },
    ])
    // #460: REJECTED, then VERIFIED, from the comments; #468 has review statuses, and its comments are no marks.
    const marks = facts.ticketEvents.flatMap((event) => (event.event === 'mark' ? [[event.ticket, event.mark, event.verdict]] : []))
    expect(marks).toEqual([
      ['03', 'review', 'success'],
      ['04', 'review', 'success'],
      ['04', 'review', 'success'],
      ['05', 'check/windows', 'success'],
      ['05', 'review', 'success'],
      ['07', 'review', 'failure'],
      ['07', 'review', 'success'],
    ])

    const timeline = buildTimeline(withFacts(local, facts))
    expect(timeline.spans.filter((span) => span.kind === 'ci').map((span) => span.links.ticket)).toEqual(['07', '04'])
    expect(timeline.spans.filter((span) => span.kind === 'ticket').map((span) => span.name).sort()).toEqual(['03', '04', '05', '07'])

    const ran = (await world.calls()).length
    // pr list per branch, run list per branch with a PR, run list per merge commit; each with gh auth token first.
    expect(ran).toBe(2 * (4 + 4 + 4))
    world.later(MINUTE - 1)
    expect(await world.reader.read(world.root, [...BRANCHES].reverse())).toBe(read)
    expect((await world.calls()).length).toBe(ran)
    world.later(1)
    expect((await world.reader.read(world.root, BRANCHES)).error).toBeNull()
    expect((await world.calls()).length).toBe(2 * ran)
    // Another Run of the Project, other branches: its own read, not the answer of the first.
    const other = await world.reader.read(world.root, ['worfy-pipeline/07'])
    expect(other.answer?.prs.map((pr) => pr.number)).toEqual([460])
    expect((await world.calls()).length).toBe(2 * ran + 2 * 3)
  })

  it('asks gh for the fields of pr-facts.mjs with labels, and for the exact branch', async () => {
    const world = await nightWorld()
    await world.reader.read(world.root, ['worfy-pipeline/07'])
    const args = (await world.calls()).map((call) => call.args).filter((call) => call[0] !== 'auth')
    expect(args).toEqual([
      ['pr', 'list', '--state', 'all', '--head', 'worfy-pipeline/07', '--limit', '10', '--json', PR_FIELDS],
      ['run', 'list', '--branch', 'worfy-pipeline/07', '--limit', '50', '--json', RUN_FIELDS],
      ['run', 'list', '--commit', '62a4c4ab2456d342a243a33de8ee67ea72a161a6', '--limit', '20', '--json', RUN_FIELDS],
    ])
    expect(PR_FIELDS.split(',')).toEqual(expect.arrayContaining(['number', 'headRefName', 'statusCheckRollup', 'comments', 'commits', 'labels', 'mergeCommit']))
  })

  it('gives the Wait other-machine of #468: from its opening to the Mac checks report', async () => {
    const world = await nightWorld()
    const local = await nightLocal()
    const facts = await factsOf(await world.reader.read(world.root, BRANCHES), local, { label: 'needs-mac-gate', checksSection: 'Mac checks', account: 'owner' })
    expect(facts.waits.map(({ cause, start, end, tickets }) => ({ cause, start, end, tickets }))).toEqual([{ cause: 'other-machine', start: '2026-10-18T02:00:50Z', end: '2026-10-18T15:58:37Z', tickets: ['05'] }])
  })
})

describe('GitHub did not answer', () => {
  it('marks the CI of every Ticket «GitHub did not answer», keeps the local part, and reads gh again after the minute or on Retry', async () => {
    const world = await nightWorld()
    const local = await nightLocal()
    await world.fail('error connecting to api.github.com')
    const read = await world.reader.read(world.root, BRANCHES)
    expect(read).toMatchObject({ answer: null, error: 'error connecting to api.github.com' })

    const timeline = buildTimeline(withFacts(local, await factsOf(read, local)))
    expect(timeline.spans.filter((span) => span.kind === 'wave').length).toBe(2)
    expect(timeline.spans.filter((span) => span.kind === 'ticket').map((span) => span.name).sort()).toEqual(['03', '04', '05', '07'])
    const lost = timeline.spans.filter((span) => span.lost !== null)
    expect(lost.map((span) => [span.kind, span.links.ticket, LOST_SOURCE_LABELS[span.lost ?? 'github-no-answer']]).sort()).toEqual(
      ['03', '04', '05', '07'].map((ticket) => ['ci', ticket, 'GitHub did not answer']),
    )

    // A failing gh is not run more than once a minute either; Retry runs it at once.
    const ran = (await world.calls()).length
    expect(ran).toBeGreaterThan(0)
    world.later(1_000)
    expect(await world.reader.read(world.root, BRANCHES)).toBe(read)
    expect((await world.calls()).length).toBe(ran)
    const retried = await world.reader.read(world.root, BRANCHES, { retry: true })
    expect(retried.error).toBe('error connecting to api.github.com')
    expect((await world.calls()).length).toBeGreaterThan(ran)

    // gh answers again: the next read after the minute gives the facts.
    await world.heal()
    world.later(MINUTE)
    const healed = await world.reader.read(world.root, BRANCHES)
    expect(healed.error).toBeNull()
    expect((await factsOf(healed, local)).lost).toEqual([])
  })

  it('an answer that is not JSON, or not a list, is no answer either', async () => {
    const world = await nightWorld()
    const reader = new GithubReader({ gh: async () => 'Welcome to GitHub CLI!' })
    expect(await reader.read(world.root, BRANCHES)).toMatchObject({ answer: null, error: 'gh pr list gave an answer that is not JSON' })
    const object = new GithubReader({ gh: async () => '{"message":"Bad credentials"}' })
    expect(await object.read(world.root, BRANCHES)).toMatchObject({ answer: null, error: 'gh pr list gave no list' })
  })
})

describe('the Project’s account', () => {
  it('every gh call of a read runs with GH_TOKEN of the Profile’s account, as gh() of prs.ts', async () => {
    const world = await nightWorld()
    await world.reader.read(world.root, BRANCHES)
    const calls = await world.calls()
    const reads = calls.filter((call) => call.args[0] !== 'auth')
    expect(reads.length).toBe(12)
    expect(new Set(reads.map((call) => call.token))).toEqual(new Set([TOKEN]))
    expect(calls.filter((call) => call.args[0] === 'auth').map((call) => call.args)).toEqual(Array.from({ length: 12 }, () => ['auth', 'token', '-u', ACCOUNT]))
    expect(calls.every((call) => call.token === null || call.token === TOKEN)).toBe(true)
  })

  it('an account gh has no login for: no read runs, and the reason names the account', async () => {
    const world = await nightWorld('someone-else')
    const read = await world.reader.read(world.root, BRANCHES)
    expect(read.error).toMatch(/^no gh login for someone-else, the Project's GitHub account/u)
    expect((await world.calls()).map((call) => call.args[0])).toEqual(['auth'])
  })

  it('writes nothing next to the Project: the answer lives in memory', async () => {
    const world = await nightWorld()
    await world.reader.read(world.root, BRANCHES)
    expect(existsSync(join(world.root, 'fail'))).toBe(false)
    expect((await readdir(world.root)).sort()).toEqual(['calls.jsonl'])
  })
})
