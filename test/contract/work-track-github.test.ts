// GitHub for Work track (src/main/work-track/github.ts; worfy-work-track ticket 06) against a gh stand-in named by
// WORFY_GH (test/fixtures/work-track/gh/gh-work-track.mjs) that answers from a synthetic repository: the merged PRs
// of a period by a GraphQL search per week, 100 a page; the CI runs by a REST call per day; one read per interval;
// «GitHub did not answer» with the reason when gh fails, the facts read before it kept. Nothing here reaches GitHub.
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountAuth, ghRunner, PrTracker } from '../../src/main/github/prs'
import { GITHUB_READ_INTERVAL_MS, WorkGithubReader } from '../../src/main/work-track/github'
import type { Period } from '../../src/shared/work-track/facts'
import { periodBounds, periodDays } from '../../src/shared/work-track/lanes'

const STAND_IN = join(__dirname, '..', 'fixtures', 'work-track', 'gh', 'gh-work-track.mjs')
const REPO = { owner: 'example-org', name: 'example-repo' }
const ACCOUNT = 'track-owner'
const TOKEN = 'token-of-track-owner'
const HOUR = 3_600_000

// A token the developer's shell exports must reach no stand-in: it logs GH_TOKEN.
beforeEach(() => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) vi.stubEnv(name, undefined)
})

const temps: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

interface Pr {
  number: number
  title: string
  headRefName: string
  createdAt: string
  mergedAt: string
  mergeOid: string
  headOid: string
}

interface Run {
  id: number
  name: string
  head_branch: string
  head_sha: string
  status: string
  conclusion: string | null
  created_at: string
  run_started_at: string
  updated_at: string
  pull_requests: { number: number }[]
}

const iso = (ms: number): string => new Date(ms).toISOString()
const oid = (seed: number): string => seed.toString(16).padStart(40, '0')
/** A local midnight, as Work track starts a period. */
const midnight = (year: number, month: number, day: number): string => iso(new Date(year, month - 1, day).getTime())

const WEEK: Period = { kind: 'week', start: midnight(2026, 10, 5) }
const MONTH: Period = { kind: 'month', start: midnight(2026, 10, 1) }

/** `count` merged PRs spread over the period, each on a Ticket branch `<epic>/<NN>`, and one run of each PR's head. */
function repository(period: Period, count: number): { prs: Pr[]; runs: Run[] } {
  const { start, end } = periodBounds(period)
  const step = (end - start) / (count + 1)
  const prs: Pr[] = []
  const runs: Run[] = []
  for (let index = 0; index < count; index += 1) {
    const number = 1000 + index
    const merged = Math.round(start + step * (index + 1))
    prs.push({
      number,
      title: `Change ${number}`,
      headRefName: `epic-${index % 3}/${String(index % 40).padStart(2, '0')}`,
      createdAt: iso(merged - 2 * HOUR),
      mergedAt: iso(merged),
      mergeOid: oid(number * 2),
      headOid: oid(number * 2 + 1),
    })
    runs.push(run(number, `epic-${index % 3}/${String(index % 40).padStart(2, '0')}`, oid(number * 2 + 1), merged - HOUR, 'success', []))
  }
  return { prs, runs }
}

function run(id: number, branch: string, sha: string, startedAt: number, conclusion: string | null, pulls: number[]): Run {
  return {
    id,
    name: 'CI',
    head_branch: branch,
    head_sha: sha,
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
    created_at: iso(startedAt - 60_000),
    run_started_at: iso(startedAt),
    updated_at: iso(startedAt + 10 * 60_000),
    pull_requests: pulls.map((number) => ({ number })),
  }
}

/**
 * The stand-in behind the PR tracker as the app builds it: `ghRunner` with WORFY_GH, `accountAuth` with the
 * Project's account, and the reader on `PrTracker.gh`. `calls()` — the gh calls but `auth token`, with the
 * GH_TOKEN each had.
 */
async function world(data: { prs: Pr[]; runs: Run[] }, now: number) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-wt-gh-')))
  temps.push(dir)
  const root = join(dir, 'project')
  const stub = join(dir, 'stub')
  await Promise.all([mkdir(root), mkdir(stub)])
  const log = join(stub, 'calls.jsonl')
  const failFile = join(stub, 'fail')
  const dataFile = join(stub, 'data.json')
  await writeFile(log, '')
  await writeFile(dataFile, JSON.stringify({ repo: `${REPO.owner}/${REPO.name}`, ...data }))
  let clock = now
  const runGh = ghRunner({ processEnv: { WORFY_GH: STAND_IN }, env: async () => ({ ...process.env, WT_GH_DATA: dataFile, WT_GH_LOG: log, WT_GH_FAIL: failFile, WT_GH_ACCOUNT: ACCOUNT, WT_GH_TOKEN: TOKEN }) })
  const tracker = new PrTracker({ run: runGh, auth: accountAuth({ account: () => Promise.resolve(ACCOUNT), run: runGh }) })
  const reader = new WorkGithubReader({ gh: (at, args) => tracker.gh(at, args), now: () => clock })
  const calls = async (): Promise<{ token: string | null; args: string[] }[]> =>
    (await readFile(log, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { token: string | null; args: string[] })
      .filter((call) => call.args[0] !== 'auth')
  return {
    root,
    reader,
    calls,
    searches: async () => (await calls()).filter((call) => call.args[1] === 'graphql'),
    runLists: async () => (await calls()).filter((call) => call.args[1]?.startsWith('repos/')),
    later: (ms: number) => void (clock += ms),
    fail: (match: string, text: string) => writeFile(failFile, `${match}\n${text}`),
  }
}

const field = (args: readonly string[], name: string): string | undefined => args.find((arg, index) => args[index - 1] === '-f' && arg.startsWith(`${name}=`))?.slice(name.length + 1)
/** `merged:<from>..<to>` of a search as milliseconds. */
const mergedRange = (args: readonly string[]): [number, number] => {
  const [from, to] = /merged:(\S+)/.exec(field(args, 'q') ?? '')![1]!.split('..')
  return [Date.parse(from!), Date.parse(to!)]
}
/** `created=<from>..<to>` of a run list as milliseconds. */
const createdRange = (args: readonly string[]): [number, number] => {
  const [from, to] = new URL(args[1]!, 'https://api.github.invalid/').searchParams.get('created')!.split('..')
  return [Date.parse(from!), Date.parse(to!)]
}

describe('the merged PRs and the CI runs of a period', () => {
  it('reads a week of 150 PRs with one search of two pages, and the CI runs with one call a day', async () => {
    const data = repository(WEEK, 150)
    // A busy day: 120 runs more on the third day, two pages of runs; one of a branch that is no Ticket's.
    const third = periodDays(WEEK)[2]!
    for (let index = 0; index < 120; index += 1) data.runs.push(run(9000 + index, 'main', oid(9000 + index), third + HOUR + index * 1000, index === 0 ? 'failure' : 'success', []))
    data.runs.push(run(8000, 'feature-x', oid(8000), third + 2 * HOUR, null, []))
    const world_ = await world(data, periodBounds(WEEK).end + HOUR)

    const read = await world_.reader.read(world_.root, REPO, WEEK)
    expect(read.error).toBeNull()
    expect(read.gaps).toEqual([])

    const searches = await world_.searches()
    expect(searches).toHaveLength(2)
    expect(field(searches[0]!.args, 'after')).toBeUndefined()
    expect(field(searches[1]!.args, 'after')).toBe('100')
    expect(field(searches[0]!.args, 'q')).toContain(`repo:${REPO.owner}/${REPO.name} is:pr is:merged merged:`)
    expect(field(searches[0]!.args, 'query')).toMatch(/first:\s*100\b/)
    const [from, to] = mergedRange(searches[0]!.args)
    expect([from, to + 1000]).toEqual([periodBounds(WEEK).start, periodBounds(WEEK).end])

    const days = periodDays(WEEK)
    const runLists = await world_.runLists()
    // Seven days, the third of two pages.
    expect(runLists.map((call) => createdRange(call.args)[0])).toEqual([days[0], days[1], days[2], days[2], days[3], days[4], days[5], days[6]])
    expect(runLists.map((call) => new URL(call.args[1]!, 'https://api.github.invalid/').searchParams.get('page'))).toEqual(['1', '1', '1', '2', '1', '1', '1', '1'])
    expect(runLists.every((call) => call.args[1]!.includes('per_page=100'))).toBe(true)
    // Every call ran as the Project's account.
    expect(new Set((await world_.calls()).map((call) => call.token))).toEqual(new Set([TOKEN]))

    const prs = read.facts.filter((fact) => fact.kind === 'pr')
    expect(prs).toHaveLength(150)
    expect(prs.find((fact) => fact.pr === 1004)).toEqual({
      id: 'gh-pr:1004',
      kind: 'pr',
      start: data.prs[4]!.createdAt,
      end: data.prs[4]!.mergedAt,
      outcome: 'ok',
      session: null,
      epic: 'epic-1',
      ticket: '04',
      pr: 1004,
      source: 'github',
      title: '#1004 Change 1004',
    })

    const ci = read.facts.filter((fact) => fact.kind === 'ci')
    expect(ci).toHaveLength(150 + 121)
    // A run of a PR's head is that PR's, of its Ticket.
    expect(ci.find((fact) => fact.id === 'gh-run:1004')).toMatchObject({ kind: 'ci', pr: 1004, epic: 'epic-1', ticket: '04', outcome: 'ok', session: null, source: 'github', title: 'CI' })
    // A run of main is no Ticket's; a failed one failed; a running one has no end yet.
    const failed = ci.find((fact) => fact.id === 'gh-run:9000')!
    expect(failed).toMatchObject({ outcome: 'failed', start: iso(third + HOUR), end: iso(third + HOUR + 10 * 60_000) })
    expect(failed.epic).toBeUndefined()
    expect(failed.pr).toBeUndefined()
    expect(ci.find((fact) => fact.id === 'gh-run:8000')).toMatchObject({ outcome: null, end: null })
    expect(ci.find((fact) => fact.id === 'gh-run:8000')!.ticket).toBeUndefined()
  })

  it('reads a month with one search a week, four to five in all, and the CI runs with one call a day', async () => {
    const world_ = await world(repository(MONTH, 40), periodBounds(MONTH).end + HOUR)
    const read = await world_.reader.read(world_.root, REPO, MONTH)
    expect(read.error).toBeNull()

    const days = periodDays(MONTH)
    const searches = await world_.searches()
    expect(searches.length).toBeGreaterThanOrEqual(4)
    expect(searches.length).toBeLessThanOrEqual(5)
    expect(searches).toHaveLength(Math.ceil(days.length / 7))
    // The weeks follow one another and cover the month.
    const ranges = searches.map((call) => mergedRange(call.args))
    expect(ranges[0]![0]).toBe(periodBounds(MONTH).start)
    expect(ranges.at(-1)![1] + 1000).toBe(periodBounds(MONTH).end)
    for (let index = 1; index < ranges.length; index += 1) expect(ranges[index]![0]).toBe(ranges[index - 1]![1] + 1000)

    const runLists = await world_.runLists()
    expect(runLists.map((call) => createdRange(call.args)[0])).toEqual(days)
    expect(read.facts.filter((fact) => fact.kind === 'pr')).toHaveLength(40)
    expect(read.facts.filter((fact) => fact.kind === 'ci')).toHaveLength(40)
  })

  it('asks for the CI of the days begun only', async () => {
    const days = periodDays(WEEK)
    const world_ = await world(repository(WEEK, 5), days[2]! + HOUR)
    await world_.reader.read(world_.root, REPO, WEEK)
    expect((await world_.runLists()).map((call) => createdRange(call.args)[0])).toEqual(days.slice(0, 3))
  })

  it('gives the answer kept in memory within the interval without gh, reads again after it or on retry', async () => {
    const world_ = await world(repository(WEEK, 10), periodBounds(WEEK).end + HOUR)
    const first = await world_.reader.read(world_.root, REPO, WEEK)
    const ran = (await world_.calls()).length
    expect(ran).toBe(1 + 7)

    world_.later(GITHUB_READ_INTERVAL_MS - 1)
    const [again, together] = await Promise.all([world_.reader.read(world_.root, REPO, WEEK), world_.reader.read(world_.root, REPO, WEEK)])
    expect(again).toBe(first)
    expect(together).toBe(first)
    expect(await world_.calls()).toHaveLength(ran)

    world_.later(1)
    await world_.reader.read(world_.root, REPO, WEEK)
    expect(await world_.calls()).toHaveLength(2 * ran)
    await world_.reader.read(world_.root, REPO, WEEK, { retry: true })
    expect(await world_.calls()).toHaveLength(3 * ran)
  })
})

describe('gh fails', () => {
  it('gives «GitHub did not answer» with the reason from the call that failed, and keeps the facts read before it', async () => {
    const days = periodDays(WEEK)
    const world_ = await world(repository(WEEK, 14), periodBounds(WEEK).end + HOUR)
    await world_.fail(`created=${iso(days[3]!).replace(/\.\d{3}Z$/u, 'Z')}`, 'HTTP 502: Bad Gateway (https://api.github.com/)')

    const read = await world_.reader.read(world_.root, REPO, WEEK)
    expect(read.error).toBe('HTTP 502: Bad Gateway (https://api.github.com/)')
    expect(read.gaps).toEqual([{ source: 'github', start: iso(days[3]!), end: iso(periodBounds(WEEK).end), why: 'GitHub did not answer: HTTP 502: Bad Gateway (https://api.github.com/)' }])
    // The PRs of the week and the CI of its first three days are there; gh ran no more after the failure.
    expect(read.facts.filter((fact) => fact.kind === 'pr')).toHaveLength(14)
    const ci = read.facts.filter((fact) => fact.kind === 'ci')
    expect(ci.length).toBeGreaterThan(0)
    expect(ci.every((fact) => Date.parse(fact.start) < days[3]!)).toBe(true)
    expect((await world_.runLists()).map((call) => createdRange(call.args)[0])).toEqual(days.slice(0, 4))
  })

  it('with no answer at all, gives one gap over the period and runs gh once an interval', async () => {
    const world_ = await world(repository(WEEK, 3), periodBounds(WEEK).end + HOUR)
    await world_.fail('', 'error connecting to api.github.com')
    const read = await world_.reader.read(world_.root, REPO, WEEK)
    expect(read.facts).toEqual([])
    expect(read.gaps).toEqual([{ source: 'github', start: WEEK.start, end: iso(periodBounds(WEEK).end), why: 'GitHub did not answer: error connecting to api.github.com' }])
    expect(await world_.calls()).toHaveLength(1)
    await world_.reader.read(world_.root, REPO, WEEK)
    expect(await world_.calls()).toHaveLength(1)
  })
})

describe('read-only', () => {
  it('writes nothing into the Project', async () => {
    const world_ = await world(repository(WEEK, 3), periodBounds(WEEK).end + HOUR)
    await world_.reader.read(world_.root, REPO, WEEK)
    expect(await readdir(world_.root)).toEqual([])
  })

  it('refuses a repository name that is not one, without gh', async () => {
    const world_ = await world(repository(WEEK, 3), periodBounds(WEEK).end + HOUR)
    const read = await world_.reader.read(world_.root, { owner: 'example-org', name: 'x is:issue' }, WEEK)
    expect(read.facts).toEqual([])
    expect(read.gaps).toHaveLength(1)
    expect(read.gaps[0]!.why).toMatch(/^GitHub did not answer: /u)
    expect(await world_.calls()).toHaveLength(0)
  })
})
