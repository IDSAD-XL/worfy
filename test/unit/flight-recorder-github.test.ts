// Facts from GitHub for the span model (src/shared/flight-recorder/from-github.ts; worfy-flight-recorder
// ticket 15): a PR opened and its new heads, CI runs and their retries `#N` linked to the run before, the
// Gate's verdict comments, the agents' marks on the head, the approval, the merge and the CI of the merge
// commit, the Wait `other-machine` from the cross-machine gate's label to the report, the PRs of the Run's
// window, and the label «GitHub did not answer» when gh gave nothing. The gh answers are literals.
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { githubFacts, githubNoAnswer, type GithubFactsInput, type GithubPr, type GithubRun } from '../../src/shared/flight-recorder/from-github'
import { buildTimeline, LOST_SOURCE_LABELS, type RunFacts, type StageEventFact } from '../../src/shared/flight-recorder/spans'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'

const T = (hhmm: string): string => `2026-10-17T${hhmm}:00Z`
const HEAD = 'a'.repeat(40)
const NEXT = 'b'.repeat(40)
const MERGE = 'c'.repeat(40)

const input = (over: Partial<GithubFactsInput> = {}): GithubFactsInput => ({
  tickets: [{ ticket: '01', branch: 'e/01' }],
  window: { start: T('10:00'), end: T('14:00') },
  ...over,
})

const pr = (over: Partial<GithubPr> = {}): GithubPr => ({
  number: 7,
  headRefName: 'e/01',
  state: 'OPEN',
  createdAt: T('10:30'),
  mergedAt: null,
  headRefOid: HEAD,
  commits: [{ oid: HEAD, authoredDate: T('10:20'), committedDate: T('10:20') }],
  comments: [],
  statusCheckRollup: [],
  labels: [],
  ciRuns: [],
  ...over,
})

const run = (id: number, created: string, updated: string, over: Partial<GithubRun> = {}): GithubRun => ({
  databaseId: id,
  attempt: 1,
  name: 'CI',
  headSha: HEAD,
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
  createdAt: T(created),
  updatedAt: T(updated),
  ...over,
})

const comment = (at: string, body: string, login = 'owner') => ({ createdAt: T(at), body, author: { login } })
const status = (context: string, state: string, at: string) => ({ __typename: 'StatusContext', context, state, startedAt: T(at) })
const events = (prs: GithubPr[], over: Partial<GithubFactsInput> = {}): StageEventFact[] => [...githubFacts({ prs }, input(over)).ticketEvents]
const kinds = (prs: GithubPr[], kind: StageEventFact['event']) => events(prs).filter((event) => event.event === kind)

function runFacts(over: Partial<RunFacts> = {}): RunFacts {
  return {
    run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: T('14:00'), live: false, outcome: 'ok' },
    now: T('14:00'),
    pipeline: DEFAULT_PIPELINE,
    waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('14:00'), tickets: ['01'] }],
    ticketEvents: [{ ticket: '01', at: T('10:05'), source: 'journal', event: 'status', state: 'claimed' }],
    work: [],
    retryCauses: [],
    waits: [],
    turns: [],
    lost: [],
    orchestratorMarks: [],
    ...over,
  }
}

describe('CI runs and their retries', () => {
  it('two CI runs on one head: the second is a retry of the first, and the model draws it as #2 linked to it', () => {
    const facts = githubFacts({ prs: [pr({ ciRuns: [run(2, '11:10', '11:20'), run(1, '10:40', '10:50', { conclusion: 'failure' })] })] }, input())
    const ci = facts.work.filter((work) => work.kind === 'ci')
    expect(ci.map(({ id, name, start, end, outcome, sha, retryOf, ticket, pr: number }) => ({ id, name, start, end, outcome, sha, retryOf, ticket, pr: number }))).toEqual([
      { id: 'gh-run:1', name: 'CI', start: T('10:40'), end: T('10:50'), outcome: 'failed', sha: HEAD, retryOf: undefined, ticket: '01', pr: 7 },
      { id: 'gh-run:2', name: 'CI', start: T('11:10'), end: T('11:20'), outcome: 'ok', sha: HEAD, retryOf: { kind: 'ci', id: 'gh-run:1' }, ticket: '01', pr: 7 },
    ])
    expect(ci.every((work) => work.startSource === 'github' && work.endSource === 'github')).toBe(true)

    const spans = buildTimeline(runFacts({ ticketEvents: [...runFacts().ticketEvents, ...facts.ticketEvents], work: facts.work })).spans.filter((span) => span.kind === 'ci')
    expect(spans.map(({ id, attempt, retryOf, outcome }) => ({ id, attempt, retryOf, outcome }))).toEqual([
      { id: 'ci:gh-run:1', attempt: 1, retryOf: null, outcome: 'failed' },
      { id: 'ci:gh-run:2', attempt: 2, retryOf: 'ci:gh-run:1', outcome: 'ok' },
    ])
  })

  it('a run on a new head is no retry of a run on the old head; a re-run attempt GitHub keeps alone is noted', () => {
    const ci = githubFacts({ prs: [pr({ ciRuns: [run(1, '10:40', '10:50'), run(2, '11:10', '11:20', { headSha: NEXT, attempt: 3 })] })] }, input()).work
    expect(ci.map((work) => [work.id, work.retryOf, work.note])).toEqual([
      ['gh-run:1', undefined, undefined],
      ['gh-run:2', undefined, 'attempt 3 on GitHub'],
    ])
  })

  it('a run gives ci-started and ci-finished on its head; one still running gives no finish and no end', () => {
    const prs = [pr({ ciRuns: [run(1, '10:40', '10:50', { conclusion: 'cancelled' }), run(2, '11:10', '11:15', { status: 'in_progress', conclusion: '' })] })]
    expect(events(prs).filter((event) => event.event === 'ci-started' || event.event === 'ci-finished')).toEqual([
      { ticket: '01', at: T('10:40'), source: 'github', event: 'ci-started', name: 'CI', sha: HEAD },
      { ticket: '01', at: T('10:50'), source: 'github', event: 'ci-finished', name: 'CI', sha: HEAD, conclusion: 'failure' },
      { ticket: '01', at: T('11:10'), source: 'github', event: 'ci-started', name: 'CI', sha: HEAD },
    ])
    const work = githubFacts({ prs }, input()).work
    expect(work.map(({ outcome, end, lastSeenAt, reason }) => ({ outcome, end, lastSeenAt, reason }))).toEqual([
      { outcome: 'stopped', end: T('10:50'), lastSeenAt: undefined, reason: 'cancelled' },
      { outcome: undefined, end: null, lastSeenAt: T('11:15'), reason: undefined },
    ])
  })

  it('a branch without runs: the check runs of the head are the CI, each a work span and its events', () => {
    const check = { __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: T('10:40'), completedAt: T('10:55') }
    const facts = githubFacts({ prs: [pr({ statusCheckRollup: [check, status('review', 'PENDING', '10:41')] })] }, input())
    expect(facts.work.map(({ id, name, start, end, outcome, sha }) => ({ id, name, start, end, outcome, sha }))).toEqual([{ id: 'gh-check:7:unit', name: 'unit', start: T('10:40'), end: T('10:55'), outcome: 'failed', sha: HEAD }])
    expect(facts.ticketEvents.filter((event) => event.event === 'ci-finished')).toEqual([{ ticket: '01', at: T('10:55'), source: 'github', event: 'ci-finished', name: 'unit', sha: HEAD, conclusion: 'failure' }])
  })
})

describe('the PR, its heads, verdicts, marks and merge', () => {
  it('the PR opened on the head it had then, and each later commit is a push', () => {
    const commits = [
      { oid: HEAD, authoredDate: T('10:20'), committedDate: T('10:20') },
      { oid: NEXT, authoredDate: T('11:30'), committedDate: T('11:31') },
    ]
    expect(events([pr({ commits, headRefOid: NEXT })]).filter((event) => event.event === 'pr-opened' || event.event === 'push')).toEqual([
      { ticket: '01', at: T('10:30'), source: 'github', event: 'pr-opened', pr: 7, sha: HEAD },
      { ticket: '01', at: T('11:31'), source: 'github', event: 'push', sha: NEXT },
    ])
  })

  it('the verdict comments REJECTED then VERIFIED are review marks failure then success when the head has no review status', () => {
    const prs = [pr({ comments: [comment('11:00', 'REJECTED\n[high] a bug'), comment('11:10', 'Pre-merge basis: …'), comment('11:40', 'NARROW: VERIFIED')] })]
    expect(kinds(prs, 'mark')).toEqual([
      { ticket: '01', at: T('11:00'), source: 'github', event: 'mark', mark: 'review', verdict: 'failure', sha: null, reason: 'REJECTED comment' },
      { ticket: '01', at: T('11:40'), source: 'github', event: 'mark', mark: 'review', verdict: 'success', sha: null, reason: 'VERIFIED comment' },
    ])
  })

  it('the agents’ marks on the head are its commit statuses, and with a review status the comments are no marks', () => {
    const prs = [pr({ comments: [comment('11:00', 'REJECTED')], statusCheckRollup: [status('review', 'SUCCESS', '11:50'), status('check/windows', 'FAILURE', '11:55'), status('ci/external', 'SUCCESS', '11:56')] })]
    expect(kinds(prs, 'mark')).toEqual([
      { ticket: '01', at: T('11:50'), source: 'github', event: 'mark', mark: 'review', verdict: 'success', sha: HEAD },
      { ticket: '01', at: T('11:55'), source: 'github', event: 'mark', mark: 'check/windows', verdict: 'failure', sha: HEAD },
    ])
  })

  it('an approved PR gives approved at the last approving review; the merge names the PR and its merge commit', () => {
    const prs = [
      pr({
        state: 'MERGED',
        mergedAt: T('12:30'),
        mergeCommit: { oid: MERGE },
        reviewDecision: 'APPROVED',
        reviews: [
          { state: 'COMMENTED', submittedAt: T('11:00') },
          { state: 'APPROVED', submittedAt: T('12:00') },
        ],
      }),
    ]
    expect(kinds(prs, 'approved')).toEqual([{ ticket: '01', at: T('12:00'), source: 'github', event: 'approved' }])
    expect(kinds(prs, 'merge')).toEqual([{ ticket: '01', at: T('12:30'), source: 'github', event: 'merge', pr: 7, sha: MERGE }])
    expect(kinds([pr({ reviews: [{ state: 'APPROVED', submittedAt: T('12:00') }], reviewDecision: 'CHANGES_REQUESTED' })], 'approved')).toEqual([])
  })

  it('the CI runs of the merge commit (batch CI on main) are the Ticket’s CI, and they change no Stage', () => {
    const facts = githubFacts({ prs: [pr({ state: 'MERGED', mergedAt: T('12:30'), mergeCommit: { oid: MERGE }, baseRefName: 'main', mergeRuns: [run(9, '12:31', '12:50', { headSha: MERGE, event: 'workflow_dispatch' })] })] }, input())
    expect(facts.work.map(({ id, ticket, sha, pr: number, note }) => ({ id, ticket, sha, pr: number, note }))).toEqual([{ id: 'gh-run:9', ticket: '01', sha: MERGE, pr: 7, note: 'CI on main after the merge' }])
    expect(facts.ticketEvents.some((event) => event.event === 'ci-started' || event.event === 'ci-finished')).toBe(false)
  })

  it('every time is GitHub’s: a fact without a time on GitHub is left out', () => {
    const prs = [pr({ createdAt: undefined, comments: [{ body: 'VERIFIED' }], ciRuns: [run(1, '10:40', '10:50', { createdAt: undefined })] })]
    const facts = githubFacts({ prs }, input())
    expect(facts.ticketEvents.some((event) => event.event === 'pr-opened' || event.event === 'mark' || event.event === 'ci-started')).toBe(false)
    expect(facts.work).toEqual([])
  })
})

describe('which PRs are the Run’s', () => {
  it('a PR of a Ticket’s branch only; one merged before the Run or opened after it is left out', () => {
    const prs = [
      pr({ number: 1, headRefName: 'e/02' }),
      pr({ number: 2, state: 'MERGED', createdAt: T('08:00'), mergedAt: T('09:00') }),
      pr({ number: 3, createdAt: T('15:00') }),
      pr({ number: 4, createdAt: T('09:00') }),
    ]
    expect(kinds(prs, 'pr-opened').map((event) => (event.event === 'pr-opened' ? event.pr : null))).toEqual([4])
  })

  it('a live Run has no end: a PR opened just now is the Run’s', () => {
    expect(kinds([pr({ createdAt: T('20:00') })], 'pr-opened').length).toBe(0)
    expect(events([pr({ createdAt: T('20:00') })], { window: { start: T('10:00'), end: null } }).filter((event) => event.event === 'pr-opened').length).toBe(1)
  })
})

describe('the Wait other-machine', () => {
  const gate = { crossMachineGate: { label: 'needs-mac-gate', checksSection: 'Mac checks', account: 'owner' } }
  const labelled = (over: Partial<GithubPr> = {}) => pr({ labels: [{ name: 'needs-mac-gate' }], ...over })
  const waits = (prs: GithubPr[], over: Partial<GithubFactsInput> = gate) => githubFacts({ prs }, input(over)).waits

  it('from the label on the PR to the time of the report: the later of the PR’s opening and its last commit, to the report', () => {
    expect(waits([labelled({ comments: [comment('12:00', 'Mac checks report: green\nhead: x')] })])).toEqual([
      { id: 'other-machine:7:1', cause: 'other-machine', start: T('10:30'), end: T('12:00'), detail: 'needs-mac-gate', tickets: ['01'], startSource: 'github', endSource: 'github' },
    ])
  })

  it('without a report the Wait has no end, and the model cuts it off at the Run’s end', () => {
    const [wait] = waits([labelled()])
    expect(wait).toMatchObject({ start: T('10:30'), end: null })
    const timeline = buildTimeline(runFacts({ waits: wait === undefined ? [] : [wait] }))
    expect(timeline.spans.filter((span) => span.kind === 'wait').map(({ outcome, end }) => ({ outcome, end }))).toEqual([{ outcome: 'cut-off', end: Date.parse(T('10:30')) }])
  })

  it('a red report, a fix commit, a green report: two Waits; the rebase of the serving machine starts none', () => {
    const commits = [
      { oid: HEAD, authoredDate: T('10:20'), committedDate: T('12:59') },
      { oid: NEXT, authoredDate: T('12:10'), committedDate: T('12:59') },
    ]
    const comments = [comment('11:00', 'Mac checks report: red\nunit failed'), comment('13:00', 'Mac checks report: green')]
    expect(waits([labelled({ commits, comments })]).map(({ start, end }) => ({ start, end }))).toEqual([
      { start: T('10:30'), end: T('11:00') },
      { start: T('12:10'), end: T('13:00') },
    ])
  })

  it('the label is gone after the merge: a report still shows the Wait; no label and no report — none; a report of another account counts not', () => {
    expect(waits([pr({ state: 'MERGED', mergedAt: T('12:05'), comments: [comment('12:00', 'Mac checks report: green')] })]).length).toBe(1)
    expect(waits([pr()])).toEqual([])
    expect(waits([labelled({ comments: [comment('12:00', 'Mac checks report: green', 'someone-else')] })]).map((wait) => wait.end)).toEqual([null])
    expect(waits([labelled()], {})).toEqual([])
  })

  it('a labelled PR merged without a report waited until its merge', () => {
    expect(waits([labelled({ state: 'MERGED', mergedAt: T('12:05') })]).map(({ end }) => end)).toEqual([T('12:05')])
  })
})

describe('GitHub did not answer', () => {
  it('the CI of every Ticket with no CI span carries the label, and the local part of the timeline stays', () => {
    const facts = githubNoAnswer()
    expect(facts.lost).toEqual([{ ticket: null, kind: 'ci', name: 'CI', source: 'github-no-answer' }])
    const timeline = buildTimeline(runFacts({ lost: facts.lost }))
    expect(timeline.spans.some((span) => span.kind === 'ticket' && span.name === '01')).toBe(true)
    expect(timeline.spans.filter((span) => span.lost !== null).map((span) => [span.kind, span.links.ticket, LOST_SOURCE_LABELS[span.lost ?? 'github-no-answer']])).toEqual([['ci', '01', 'GitHub did not answer']])
  })
})

describe('the module', () => {
  it('imports neither Node nor the DOM', () => {
    const text = readFileSync(join(import.meta.dirname, '../../src/shared/flight-recorder/from-github.ts'), 'utf8')
    const sources = [...text.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/gmu)].map((match) => match[1] ?? '')
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect([source, source.startsWith('node:') || builtinModules.includes(source.split('/')[0] ?? '') || source.startsWith('electron')]).toEqual([source, false])
      expect([source, source.startsWith('./')]).toEqual([source, true])
    }
    // The code only, and the globals only: the comments and the input speak of the Run's window.
    const code = text.replace(/\/\/.*$/gmu, '').replace(/\/\*[\s\S]*?\*\//gu, '')
    expect(/(?<![.\w])(?:window|document|process|fetch)\s*[.(]/u.test(code)).toBe(false)
  })
})
