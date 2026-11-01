// The background-tasks Wait in the summary (src/shared/flight-recorder/summary.ts; worfy-flight-recorder
// ticket 26, decision 03 Q5: a Wait is time when work stands for an outside reason). The Orchestrator's
// background tasks are its own agents, gate runs and scripts, so a `background-tasks` Wait counts only
// where no work span of the Run runs; the span itself stays whole on the timeline. The other causes
// count whole.
// The literal cases build their facts by hand; the night-Run case reads the shared fixture in place
// (the Journal, the transcripts, the gate logs and the gh answers), writing nothing.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readGateLogs } from '../../src/main/flight-recorder/gate-logs'
import { readRunTranscripts } from '../../src/main/flight-recorder/transcripts'
import { githubFacts, type GithubPr, type GithubRun } from '../../src/shared/flight-recorder/from-github'
import { journalFacts } from '../../src/shared/flight-recorder/from-journal'
import { buildTimeline, WAIT_CAUSES, type RunFacts, type WaitFact, type WorkFact } from '../../src/shared/flight-recorder/spans'
import { COUNTED_WITHOUT_WORK, summarize, WITHOUT_WORK_NOTE } from '../../src/shared/flight-recorder/summary'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'

const T = (hhmm: string): string => `2026-10-17T${hhmm}:00.000Z`
const MIN = 60_000
const RUN_MIN = 240

function facts(over: Partial<RunFacts> = {}): RunFacts {
  return {
    run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: T('14:00'), live: false, outcome: 'ok' },
    now: T('14:00'),
    pipeline: DEFAULT_PIPELINE,
    waves: [{ number: 1, startedAt: T('10:00'), finishedAt: T('14:00'), tickets: ['e/01'] }],
    ticketEvents: [{ ticket: 'e/01', at: T('10:00'), source: 'journal', event: 'status', state: 'claimed' }],
    work: [],
    retryCauses: [],
    waits: [],
    turns: [],
    lost: [],
    orchestratorMarks: [],
    ...over,
  }
}

const wait = (id: string, cause: WaitFact['cause'], from: string, to: string): WaitFact => ({ id, cause, start: T(from), end: T(to), startSource: 'journal', endSource: 'journal' })
const background = (from: string, to: string, id = 'w'): WaitFact => wait(id, 'background-tasks', from, to)

const agent = (id: string, from: string, to: string, ticket: string | null = 'e/01'): WorkFact => ({
  id,
  kind: 'agent',
  ticket,
  name: `impl-${id}`,
  agentType: 'worfy:implementer',
  start: T(from),
  end: T(to),
  startSource: 'transcript',
  endSource: 'transcript',
})

/** The summary's row of one cause, in minutes. */
function row(input: RunFacts, cause: WaitFact['cause'] = 'background-tasks') {
  const found = summarize(buildTimeline(input)).waits.find((item) => item.cause === cause)
  return found === undefined ? undefined : { total: found.total / MIN, share: found.share }
}

describe('summary: a background-tasks Wait counts only where no work runs', () => {
  it('counts nothing of a Wait that work covers whole, and keeps the cause with 0', () => {
    expect(row(facts({ waits: [background('10:30', '11:30')], work: [agent('a', '10:00', '12:00')] }))).toEqual({ total: 0, share: 0 })
  })

  it('counts a Wait with no work in it whole', () => {
    expect(row(facts({ waits: [background('10:30', '11:30')], work: [agent('a', '12:00', '13:00')] }))).toEqual({ total: 60, share: 60 / RUN_MIN })
  })

  it('counts only the part of a Wait outside the work it overlaps', () => {
    // 10:30–11:30, an agent 11:00–12:00: 11:00–11:30 is work, only its inside part is taken off.
    expect(row(facts({ waits: [background('10:30', '11:30')], work: [agent('a', '11:00', '12:00')] }))).toEqual({ total: 30, share: 30 / RUN_MIN })
  })

  it('takes two overlapping work spans off once, by their union, not their sum', () => {
    // 10:40–11:00 and 10:50–11:10: the union is 30 minutes inside the Wait; the sum would be 40.
    expect(row(facts({ waits: [background('10:30', '11:30')], work: [agent('a', '10:40', '11:00'), agent('b', '10:50', '11:10')] }))).toEqual({ total: 30, share: 30 / RUN_MIN })
  })

  it('takes off work of every kind, and work of the Run that sits in no Stage', () => {
    const gate: WorkFact = { id: 'g', kind: 'gate', ticket: 'e/01', name: 'gate fast', start: T('10:30'), end: T('10:40'), startSource: 'gate-log', endSource: 'gate-log' }
    const ci: WorkFact = { id: 'c', kind: 'ci', ticket: 'e/01', name: 'ci', start: T('10:40'), end: T('10:50'), startSource: 'github', endSource: 'github' }
    const script: WorkFact = { id: 's', kind: 'script', ticket: 'e/01', name: 'merge-once', start: T('10:50'), end: T('11:00'), startSource: 'transcript', endSource: 'transcript' }
    // An agent with no Ticket: work of the Run as a whole.
    const runWork = agent('q', '11:00', '11:10', null)
    expect(row(facts({ waits: [background('10:30', '11:30')], work: [gate, ci, script, runWork] }))).toEqual({ total: 20, share: 20 / RUN_MIN })
  })

  it('does not take off work whose details are gone: it has no real times', () => {
    const lost = { ticket: 'e/01', kind: 'agent' as const, name: 'impl-01', source: 'transcript-deleted' as const, start: T('10:30'), end: T('11:30') }
    expect(row(facts({ waits: [background('10:30', '11:30')], lost: [lost] }))).toEqual({ total: 60, share: 60 / RUN_MIN })
  })

  it('sums several background-tasks Waits each by its own part with no work', () => {
    const input = facts({ waits: [background('10:30', '11:30', 'w1'), background('12:00', '12:30', 'w2')], work: [agent('a', '11:00', '12:10')] })
    // 10:30–11:00 and 12:10–12:30.
    expect(row(input)).toEqual({ total: 50, share: 50 / RUN_MIN })
  })

  it('leaves the other causes whole, work or no work', () => {
    const input = facts({
      waits: [wait('l', 'limits', '10:30', '11:30'), wait('b', 'limits-budget', '11:30', '12:00'), wait('q', 'gate-queue', '12:00', '12:30'), wait('m', 'other-machine', '12:30', '13:00')],
      work: [agent('a', '10:00', '14:00')],
    })
    expect(row(input, 'limits')).toEqual({ total: 60, share: 60 / RUN_MIN })
    expect(row(input, 'limits-budget')).toEqual({ total: 30, share: 30 / RUN_MIN })
    expect(row(input, 'gate-queue')).toEqual({ total: 30, share: 30 / RUN_MIN })
    expect(row(input, 'other-machine')).toEqual({ total: 30, share: 30 / RUN_MIN })
  })

  it('keeps the Wait span whole on the timeline: only the summary counts its part with no work', () => {
    const timeline = buildTimeline(facts({ waits: [background('10:30', '11:30')], work: [agent('a', '11:00', '12:00')] }))
    const span = timeline.spans.find((item) => item.waitCause === 'background-tasks')
    expect(span?.segments).toEqual([{ start: Date.parse(T('10:30')), end: Date.parse(T('11:30')) }])
  })

  it('does not take off an Orchestrator turn: a turn is its own lane, not work', () => {
    const turn = { id: 't', start: T('10:30'), end: T('11:30'), tickets: ['e/01'], startSource: 'transcript' as const, endSource: 'transcript' as const }
    expect(row(facts({ waits: [background('10:30', '11:30')], turns: [turn] }))).toEqual({ total: 60, share: 60 / RUN_MIN })
  })

  it('names its rule for the readers: the causes counted without work, and the note for their row', () => {
    expect([...COUNTED_WITHOUT_WORK]).toEqual(['background-tasks'])
    expect(WITHOUT_WORK_NOTE).toBe('without work')
    // The exported set is the one the summary uses: under work that covers every Wait, exactly
    // the causes in it drop to 0, every other cause stays whole.
    // Back to back from 10:00, 30 minutes each: every cause fits in the Run's four hours.
    const hhmm = (minutes: number): string => `${10 + Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
    const waits = WAIT_CAUSES.map((cause, index) => wait(`w${index}`, cause, hhmm(index * 30), hhmm(index * 30 + 30)))
    const rows = summarize(buildTimeline(facts({ waits, work: [agent('a', '10:00', '14:00')] }))).waits
    for (const cause of WAIT_CAUSES) expect(rows.find((item) => item.cause === cause)?.total).toBe(COUNTED_WITHOUT_WORK.has(cause) ? 0 : 30 * MIN)
  })

  it('takes off work still running in a live Run up to now', () => {
    const live = facts({
      run: { id: 'run-1', startedAt: T('10:00'), stoppedAt: null, live: true },
      now: T('12:00'),
      waves: [{ number: 1, startedAt: T('10:00'), finishedAt: null, tickets: ['e/01'] }],
      waits: [{ id: 'w', cause: 'background-tasks', start: T('10:30'), end: null, startSource: 'journal' }],
      work: [{ ...agent('a', '11:00', '11:00'), end: null }],
    })
    // The Wait 10:30–now, the agent 11:00–now: 30 minutes with no work, of a Run of 120.
    expect(row(live)).toEqual({ total: 30, share: 30 / 120 })
  })
})

describe('summary: the background-tasks Waits of the night Run', () => {
  const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'flight-recorder', 'night-run')
  const NIGHT_RUN = '2026-10-17T22-29-32-707Z-58e783'
  const SESSION = 'f6ab7045-416c-471a-a78d-433567aefa5a'
  const json = (...path: string[]): unknown => JSON.parse(readFileSync(join(FIXTURE, ...path), 'utf8'))

  /** The night Run's facts from the four readers, as the service of ticket 17 joins them; the Journal alone is `journal`. */
  async function night(): Promise<{ journal: RunFacts; all: RunFacts }> {
    const read = journalFacts({ run: NIGHT_RUN, lines: readFileSync(join(FIXTURE, 'data', 'autopilot', `${NIGHT_RUN}.jsonl`), 'utf8').split('\n') })
    if (read === null) throw new Error('no facts')
    const { startedAt, stoppedAt } = read.run
    const journal: RunFacts = {
      run: { ...read.run, live: false },
      now: stoppedAt ?? startedAt,
      pipeline: DEFAULT_PIPELINE,
      waves: read.waves,
      ticketEvents: read.ticketEvents,
      work: [],
      retryCauses: read.retryCauses,
      waits: read.waits,
      turns: [],
      lost: [],
      orchestratorMarks: read.orchestratorMarks,
    }
    const transcripts = await readRunTranscripts(
      { epic: read.epic, root: '/Users/someone/Stuff/CanvasForAI', startedAt, stoppedAt, waves: read.waves.map((wave) => ({ ...wave, session: SESSION })) },
      { env: { WORFY_CLAUDE_HOME: join(FIXTURE, 'claude') } },
    )
    const gate = await readGateLogs({ harnessHome: join(FIXTURE, 'harness'), since: startedAt, until: stoppedAt, now: Date.parse(stoppedAt ?? startedAt) })
    // What gh answers for the Run (src/main/flight-recorder/github.ts): each PR with the runs of its
    // branch and of its merge commit — CI that night ran in batch on main.
    const mainRuns = json('gh', 'run-list-main.json') as GithubRun[]
    const prs = readdirSync(join(FIXTURE, 'gh'))
      .filter((file) => file.startsWith('pr-view-'))
      .map((file) => json('gh', file) as GithubPr & { mergeCommit?: { oid?: string } | null })
      .map((pr) => ({ ...pr, ciRuns: json('gh', `run-list-${(pr.headRefName ?? '').replaceAll('/', '-')}.json`) as GithubRun[], mergeRuns: mainRuns.filter((run) => run.headSha === pr.mergeCommit?.oid) }))
    const github = githubFacts({ prs }, { tickets: read.tickets.map((ticket) => ({ ticket, branch: ticket })), window: { start: startedAt, end: stoppedAt }, account: 'owner' })
    const all: RunFacts = {
      ...journal,
      ticketEvents: [...journal.ticketEvents, ...github.ticketEvents],
      work: [...transcripts.work, ...gate.work, ...github.work],
      waits: [...journal.waits, ...github.waits],
      turns: transcripts.turns,
      lost: [...transcripts.lost, ...gate.lost, ...github.lost],
    }
    return { journal, all }
  }

  it('drop from 0.915 of the Run (the Journal alone, no work known) to the time with no work in any source', async () => {
    const { journal, all } = await night()
    const background = (input: RunFacts) => summarize(buildTimeline(input)).waits.find((row) => row.cause === 'background-tasks')
    // The Journal alone knows no work: the Waits count whole, as the reader's baseline pins them.
    expect(background(journal)).toMatchObject({ total: 15_808_308 })
    expect(background(journal)?.share).toBeCloseTo(0.915, 3)
    // With the agents of the transcripts, the gate runs of the gate log and the CI runs on main, the
    // 13 Waits keep 921.9 s with no work in them (15 min 22 s): 0.053 of the Run of 4 h 48 min.
    expect(background(all)).toMatchObject({ total: 921_911 })
    // The stretches with no work, worked out by hand from the Wait segments and the work spans:
    // mostly the background task «Retry merge of PR #467 with full gate», whose gate log the
    // fixture does not hold (its two gate logs are illustrative).
    const gaps: [string, string][] = [
      ['2026-10-17T23:29:26.508Z', '2026-10-17T23:30:00.601Z'],
      ['2026-10-18T00:39:41.553Z', '2026-10-18T00:40:05.000Z'],
      ['2026-10-18T00:52:50.000Z', '2026-10-18T00:53:09.249Z'],
      ['2026-10-18T01:11:29.000Z', '2026-10-18T01:11:37.826Z'],
      ['2026-10-18T01:12:15.583Z', '2026-10-18T01:12:22.144Z'],
      ['2026-10-18T02:48:14.202Z', '2026-10-18T03:01:53.689Z'],
      ['2026-10-18T03:15:26.000Z', '2026-10-18T03:15:36.248Z'],
    ]
    expect(background(all)?.total).toBe(gaps.reduce((sum, [from, to]) => sum + Date.parse(to) - Date.parse(from), 0))
    // Without the gate runs and scripts (the illustrative part of the fixture): 0.098.
    expect(background({ ...all, work: all.work.filter((fact) => fact.kind !== 'gate' && fact.kind !== 'script') })?.share).toBeCloseTo(0.098, 3)
    expect(background(all)?.share).toBeCloseTo(0.053, 3)
    // The spans themselves stay as the Journal gave them.
    const spans = (input: RunFacts) => buildTimeline(input).spans.filter((span) => span.waitCause === 'background-tasks').map(({ id, segments }) => ({ id, segments }))
    expect(spans(all)).toEqual(spans(journal))
  })
})
