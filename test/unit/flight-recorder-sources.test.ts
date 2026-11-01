// The shared parse of the Autopilot Journal and of GitHub's PR data (src/shared/flight-recorder/*.mjs: plain ES
// modules with .d.mts declarations, so that scripts/critical-path.mjs runs them without a build and the app imports
// them from TypeScript). Facts come from the fixture of scripts/critical-path.mjs (test/fixtures/critical-path/)
// and from the night-Run fixture of the Flight Recorder (test/fixtures/flight-recorder/night-run/); gh's answers
// are the recorded JSON files, nothing reaches the network.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectId } from '../../src/main/projects/store'
import { JOURNAL_EVENT_KINDS } from '../../src/shared/autopilot/journal'
import { JOURNAL_KINDS, parseJournal, time, walkJournals, walkRun, type JournalEvent } from '../../src/shared/flight-recorder/journal-walk.mjs'
import { GH_APP_FIELDS, GH_FIELDS, GH_RUN_FIELDS, isCheckRun, labelNames, pick, prFacts, verdicts, type GhPr } from '../../src/shared/flight-recorder/pr-facts.mjs'
import { subagentSignalsOfLines } from '../../src/shared/transcript/subagents'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures')
const CRITICAL_PATH = join(FIXTURES, 'critical-path')
const NIGHT = join(FIXTURES, 'flight-recorder', 'night-run')
const NIGHT_RUN = '2026-10-17T22-29-32-707Z-58e783'

const at = (text: string): number => Date.parse(text)
const journalText = (dir: string, name: string): string => readFileSync(join(dir, name), 'utf8')
const fixtureFiles = (): JournalEvent[][] =>
  readdirSync(join(CRITICAL_PATH, 'journals'))
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => parseJournal(journalText(join(CRITICAL_PATH, 'journals'), name)).events)
const nightEvents = (): JournalEvent[] => parseJournal(journalText(join(NIGHT, 'data', 'autopilot'), `${NIGHT_RUN}.jsonl`)).events
const prsOf = (file: string): GhPr[] => JSON.parse(readFileSync(file, 'utf8')) as GhPr[]
const prOf = (file: string, number: number): GhPr => {
  const pr = prsOf(file).find((p) => p.number === number)
  if (pr === undefined) throw new Error(`no PR #${number} in ${file}`)
  return pr
}

describe('journal-walk: the lines of a Journal', () => {
  it('keeps the kinds it knows in step with the Journal format', () => {
    expect([...JOURNAL_KINDS]).toEqual([...JOURNAL_EVENT_KINDS])
  })

  it('reads the events of a Journal file and counts a cut-off line, an unknown kind and fields that do not match', () => {
    const demo = parseJournal(journalText(join(CRITICAL_PATH, 'journals'), '2026-10-06T01-00-00-000Z-aaaaaa.jsonl'))
    expect(demo).toMatchObject({ lines: 12, notJson: 1, unknownKind: 1, badFields: 0 })
    expect(demo.events.map((e) => e.kind)).toEqual([
      'run-started',
      'wave-started',
      'limits-hit',
      'waiting-until',
      'resumed',
      'narrow-round',
      'session-error',
      'wave-finished',
      'wave-started',
      'run-stopped',
    ])
    // `at` becomes ms, an offset included: 04:30+03:00 is 01:30 UTC.
    expect(demo.events[2]?.at).toBe(at('2026-10-06T01:30:00Z'))
    const other = parseJournal(journalText(join(CRITICAL_PATH, 'journals'), '2026-10-07T00-00-00-000Z-bbbbbb.jsonl'))
    expect(other).toMatchObject({ lines: 4, notJson: 0, unknownKind: 0, badFields: 1 })
  })

  it('takes a time from an ISO text and nothing else', () => {
    expect(time('2026-10-06T04:30:00+03:00')).toBe(at('2026-10-06T01:30:00Z'))
    expect(time('not a time')).toBeNull()
    expect(time(1_000)).toBeNull()
  })
})

describe('journal-walk: one Run', () => {
  it('gives the Run, its Waves, the Limits wait, the stops inside a Wave and the stop of the Run', () => {
    const [demo = []] = fixtureFiles()
    const run = walkRun(demo)
    expect(run.started).toEqual({ at: at('2026-10-06T01:00:00Z'), epic: 'demo-epic', project: 'demo-1a2b3c4d', origin: 'github.com/owner/demo' })
    expect(run.waves).toEqual([
      { epic: 'demo-epic', wave: 1, tickets: ['01', '02', '03'], start: at('2026-10-06T01:00:00Z'), end: at('2026-10-06T03:00:00Z') },
      { epic: 'demo-epic', wave: 2, tickets: ['03'], start: at('2026-10-06T03:00:05Z'), end: null },
    ])
    expect(run.waits).toEqual([{ epic: 'demo-epic', cause: 'limits-hit', start: at('2026-10-06T01:30:00Z'), end: at('2026-10-06T02:00:00Z'), tickets: ['01', '02', '03'] }])
    expect(run.stops).toEqual([
      { kind: 'session-error', at: at('2026-10-06T02:30:00Z'), reason: null, epic: 'demo-epic', tickets: ['01', '02', '03'] },
      { kind: 'run-stopped', at: at('2026-10-06T03:10:00Z'), reason: 'no-progress', epic: 'demo-epic', tickets: ['03'] },
    ])
    expect(run.narrowRounds).toEqual([{ at: at('2026-10-06T02:21:00Z'), epic: 'demo-epic', ticket: '01', outcome: 'started' }])
    expect(run.stopped).toEqual({ at: at('2026-10-06T03:10:00Z'), reason: 'no-progress' })
  })

  it('leaves a wait open and the Run without a stop when the Journal ends while it waits', () => {
    const [, other = []] = fixtureFiles()
    const run = walkRun(other)
    expect(run.waves).toEqual([{ epic: 'other-epic', wave: 1, tickets: ['01'], start: at('2026-10-07T00:00:20Z'), end: null }])
    expect(run.waits).toEqual([{ epic: 'other-epic', cause: 'waiting-until', start: at('2026-10-07T00:10:00Z'), end: null, tickets: ['01'] }])
    expect(run.started?.origin).toBeNull()
    expect(run.stopped).toBeNull()
  })

  it('ends a wait at the stop of the Run, and a stop outside a Wave names no Ticket', () => {
    const base = { run: 'r', project: 'p', epic: 'e' }
    const run = walkRun([
      { ...base, kind: 'run-started', at: 0 },
      { ...base, kind: 'wave-started', at: 1_000, wave: 1, tickets: ['01'] },
      { ...base, kind: 'wave-finished', at: 2_000, wave: 1, tickets: ['01'] },
      { ...base, kind: 'session-error', at: 2_500 },
      { ...base, kind: 'waiting-until', at: 3_000, until: '2026-10-07T05:00:00Z' },
      { ...base, kind: 'run-stopped', at: 4_000, reason: 'stopped-by-user' },
    ])
    expect(run.waits).toEqual([{ epic: 'e', cause: 'waiting-until', start: 3_000, end: 4_000, tickets: [] }])
    expect(run.stops).toEqual([
      { kind: 'session-error', at: 2_500, reason: null, epic: 'e', tickets: [] },
      { kind: 'run-stopped', at: 4_000, reason: 'stopped-by-user', epic: 'e', tickets: [] },
    ])
  })

  it('starts the Run at its first run-started', () => {
    const base = { run: 'r', epic: 'e' }
    const run = walkRun([
      { ...base, kind: 'run-started', at: 0, project: 'p', origin: 'github.com/owner/repo' },
      { ...base, kind: 'run-started', at: 5_000, project: 'q', origin: '' },
    ])
    expect(run.started).toEqual({ at: 0, epic: 'e', project: 'p', origin: 'github.com/owner/repo' })
  })

  it('gives the night Run: two Waves, no Limits wait and the stop blocked-tickets after 4 h 48 min', () => {
    const run = walkRun(nightEvents())
    expect(run.started).toMatchObject({ epic: 'worfy-pipeline', at: at('2026-10-17T22:29:32.707Z') })
    expect(run.waves.map(({ wave, tickets, start, end }) => ({ wave, tickets, start, end }))).toEqual([
      { wave: 1, tickets: ['03', '07'], start: at('2026-10-17T22:29:33.879Z'), end: at('2026-10-18T01:13:01.175Z') },
      { wave: 2, tickets: ['04', '05'], start: at('2026-10-18T01:13:02.542Z'), end: at('2026-10-18T03:17:34.592Z') },
    ])
    expect(run.waits).toEqual([])
    expect(run.stopped).toEqual({ at: at('2026-10-18T03:17:34.592Z'), reason: 'blocked-tickets' })
    const minutes = Math.round(((run.stopped?.at ?? 0) - (run.started?.at ?? 0)) / 60_000)
    expect(minutes).toBe(4 * 60 + 48)
  })
})

describe('journal-walk: every Run of the Journals, by Ticket and Epic', () => {
  it('gives each Ticket its first start, its Limits wait, its rework rounds and the stops of its Wave', () => {
    const { tickets, epics } = walkJournals(fixtureFiles())
    expect(tickets.get('demo-epic/01')).toEqual({ start: at('2026-10-06T01:00:00Z'), wait: 30 * 60_000, openWait: false, stops: ['session-error'], narrow: { started: 1, rejected: 0 } })
    expect(tickets.get('demo-epic/03')).toMatchObject({ start: at('2026-10-06T01:00:00Z'), wait: 30 * 60_000, stops: ['session-error', 'run-stopped: no-progress'] })
    expect(tickets.get('other-epic/01')).toMatchObject({ start: at('2026-10-07T00:00:20Z'), wait: 0, openWait: true, stops: [] })
    expect(epics.get('demo-epic')).toEqual({ origin: 'github.com/owner/demo', project: 'demo-1a2b3c4d', wait: 30 * 60_000, openWait: false })
    expect(epics.get('other-epic')).toEqual({ origin: null, project: 'other-5e6f7a8b', wait: 0, openWait: true })
  })

  it('takes the repository of a later Run of the same Project when the Epic’s Runs name none', () => {
    const base = { run: 'r', project: 'p-1' }
    const { epics } = walkJournals([
      [{ ...base, epic: 'old', kind: 'run-started', at: 0 }],
      [{ ...base, epic: 'new', kind: 'run-started', at: 1_000, origin: 'github.com/owner/repo' }],
    ])
    expect(epics.get('old')?.origin).toBe('github.com/owner/repo')
  })
})

describe('pr-facts: one PR from gh', () => {
  it('asks gh for the fields of scripts/critical-path.mjs, and the app also for labels and the merge commit', () => {
    expect(GH_FIELDS).toBe('number,headRefName,state,createdAt,mergedAt,statusCheckRollup,comments,commits,files')
    expect(GH_APP_FIELDS).toBe(`${GH_FIELDS},labels,mergeCommit`)
    expect(GH_RUN_FIELDS).toBe('status,conclusion,event,createdAt,updatedAt')
  })

  it('gives the PR, its CI runs, its verdicts, the merge and the first commit', () => {
    const facts = prFacts(prOf(join(CRITICAL_PATH, 'prs.json'), 11))
    expect(facts).toMatchObject({ number: 11, branch: 'demo-epic/01', state: 'MERGED', opened: at('2026-10-06T01:40:00Z'), merged: at('2026-10-06T03:00:00Z'), firstCommit: at('2026-10-06T01:20:00Z'), labels: [] })
    expect(facts.ciRuns).toEqual([
      { status: 'completed', conclusion: 'failure', event: 'pull_request', created: at('2026-10-06T01:40:10Z'), updated: at('2026-10-06T01:50:00Z') },
      { status: 'completed', conclusion: 'success', event: 'pull_request', created: at('2026-10-06T02:15:00Z'), updated: at('2026-10-06T02:35:00Z') },
      { status: 'completed', conclusion: 'success', event: 'workflow_dispatch', created: at('2026-10-06T02:36:00Z'), updated: at('2026-10-06T02:45:00Z') },
      { status: 'completed', conclusion: 'success', event: 'pull_request', created: at('2026-10-06T02:52:00Z'), updated: at('2026-10-06T02:58:00Z') },
    ])
    expect(facts.verdicts).toEqual([
      { at: at('2026-10-06T02:10:00Z'), verdict: 'REJECTED', narrow: false },
      { at: at('2026-10-06T02:20:00Z'), verdict: null, narrow: true },
      { at: at('2026-10-06T02:50:00Z'), verdict: 'VERIFIED', narrow: false },
    ])
    expect(facts.ci).toEqual({ at: at('2026-10-06T02:35:00Z') })
    expect(facts.headCi).toEqual({ at: at('2026-10-06T02:35:00Z') })
  })

  it('gives the night Run’s PR #460: REJECTED then VERIFIED, merged, no CI runs on its branch', () => {
    const facts = prFacts(prOf(join(NIGHT, 'prs.json'), 460))
    expect(facts).toMatchObject({ number: 460, branch: 'worfy-pipeline/07', state: 'MERGED', opened: at('2026-10-18T00:11:54Z'), merged: at('2026-10-18T00:53:06Z'), ciRuns: [], labels: [] })
    expect(facts.verdicts).toEqual([
      { at: at('2026-10-18T00:19:24Z'), verdict: 'REJECTED', narrow: false },
      { at: at('2026-10-18T00:39:35Z'), verdict: 'VERIFIED', narrow: false },
    ])
    expect(verdicts(prOf(join(NIGHT, 'prs.json'), 460))).toEqual({ gate: at('2026-10-18T00:39:35Z'), rejected: 1, narrow: 0 })
  })

  it('gives the merge marks on the head: the review and check/windows statuses of the night Run’s PR #468', () => {
    const facts = prFacts(prOf(join(NIGHT, 'prs.json'), 468))
    expect(facts.headMarks).toEqual([
      { name: 'check/windows', state: 'SUCCESS', at: at('2026-10-18T15:58:23Z') },
      { name: 'review', state: 'SUCCESS', at: at('2026-10-18T15:58:22Z') },
    ])
    expect(facts.merged).toBe(at('2026-10-18T15:58:40Z'))
  })

  it('reads the gh answer of `pr view` as the --prs file holds it', () => {
    const answer = JSON.parse(readFileSync(join(NIGHT, 'gh', 'pr-view-457.json'), 'utf8')) as GhPr
    expect(prFacts(answer)).toMatchObject({ number: 457, branch: 'worfy-pipeline/03', merged: at('2026-10-17T23:51:19Z'), labels: [] })
  })

  it('gives the names of the PR’s labels, as the cross-machine gate marks a PR', () => {
    const pr: GhPr = { number: 1, labels: [{ id: 'L_1', name: 'needs-pc-gate', description: '', color: 'ededed' }, { name: 'docs' }, { color: 'no name' }] }
    expect(labelNames(pr)).toEqual(['needs-pc-gate', 'docs'])
    expect(prFacts(pr).labels).toEqual(['needs-pc-gate', 'docs'])
    expect(labelNames({ number: 2 })).toEqual([])
  })

  it('tells a check run (CI) from a commit status (a merge mark), always as a boolean', () => {
    expect(isCheckRun({ __typename: 'CheckRun', name: 'ci-ok', status: 'COMPLETED', conclusion: 'SUCCESS' })).toBe(true)
    expect(isCheckRun({ __typename: 'StatusContext', context: 'review', state: 'SUCCESS' })).toBe(false)
    expect(isCheckRun({ context: 'review', state: 'SUCCESS' })).toBe(false)
    expect(isCheckRun(null)).toBe(false)
    expect(isCheckRun(undefined)).toBe(false)
  })

  it('of several PRs of one Ticket picks the merged one, else the newest', () => {
    const prs = prsOf(join(CRITICAL_PATH, 'prs.json'))
    expect(pick(prs.filter((pr) => pr.headRefName?.startsWith('demo-epic/04')))?.number).toBe(14)
    expect(pick([{ number: 3, state: 'CLOSED' }, { number: 5, state: 'OPEN' }])?.number).toBe(5)
    expect(pick([])).toBeNull()
  })
})

describe('the night-Run fixture: what the Tickets of the Epic read from it', () => {
  it('ties the batch CI runs on main to the PRs by their merge commit', () => {
    const runs = JSON.parse(readFileSync(join(NIGHT, 'gh', 'run-list-main.json'), 'utf8')) as { headSha: string; event: string }[]
    const heads = new Set(runs.map((run) => run.headSha))
    const merges = Object.fromEntries([457, 460, 467, 468].map((n) => [n, prFacts(prOf(join(NIGHT, 'prs.json'), n)).mergeCommit]))
    expect(merges).toEqual({
      457: '8f0f945fbe948747df606a4aa02cfa65f77c0777',
      460: '62a4c4ab2456d342a243a33de8ee67ea72a161a6',
      467: 'e074b41f7f1ed5fd641b2595fee051fbfab3ae93',
      468: '786aee9709da7075f465cea45e33569ea17770f4',
    })
    expect(heads.has(merges[460] ?? '')).toBe(true)
    expect(heads.has(merges[467] ?? '')).toBe(true)
    expect(runs.every((run) => run.event === 'workflow_dispatch')).toBe(true)
    expect(prFacts({ number: 1 }).mergeCommit).toBeNull()
  })

  it('keeps the Journal’s project the id of the anonymised path', () => {
    const projects = new Set(nightEvents().map((event) => event.project))
    expect([...projects]).toEqual([projectId('/Users/someone/Stuff/CanvasForAI')])
  })

  it('keeps every task-notification readable: each Subagent the Orchestrator started ends with its call id and status', () => {
    const dir = join(NIGHT, 'claude', 'projects', '-Users-someone-Stuff-CanvasForAI')
    const lines = readFileSync(join(dir, 'f6ab7045-416c-471a-a78d-433567aefa5a.jsonl'), 'utf8').split('\n').filter(Boolean)
    const signals = subagentSignalsOfLines(lines)
    const finished = signals.filter((signal) => signal.kind === 'finished')
    expect(finished.length).toBeGreaterThan(0)
    for (const signal of finished) {
      expect(signal.toolUseId).toMatch(/^toolu_/)
      expect(signal.status).not.toBeNull()
    }
    // Every Subagent of the fixture (meta.json) is started by a call in the excerpt and reported back.
    const metas = readdirSync(join(dir, 'f6ab7045-416c-471a-a78d-433567aefa5a', 'subagents')).filter((name) => name.endsWith('.meta.json'))
    const calls = new Set(metas.map((name) => (JSON.parse(readFileSync(join(dir, 'f6ab7045-416c-471a-a78d-433567aefa5a', 'subagents', name), 'utf8')) as { toolUseId: string }).toolUseId))
    expect(calls.size).toBe(12)
    // The Bash tasks run in the background report the same way, so the finished set is larger than the calls.
    const reported = new Set(finished.map((signal) => signal.toolUseId))
    expect([...calls].filter((call) => !reported.has(call))).toEqual([])
  })

  it('is checked out byte for byte on every system: git keeps CRLF conversion off for it', () => {
    const result = spawnSync('git', ['check-attr', 'text', '--', 'test/fixtures/flight-recorder/night-run/prs.json'], { cwd: join(FIXTURES, '..', '..'), encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('test/fixtures/flight-recorder/night-run/prs.json: text: unset')
  })
})

