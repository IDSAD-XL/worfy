// The Stage of a Ticket from the facts about it (worfy-pipeline ticket 03, ADR-0067): a pure
// function, no Electron, no git, no gh. The table covers every kind of the catalogue and both
// Pipelines of the epic's spec — worfy's and Atakama's.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PIPELINE,
  onStageFor,
  pipelineSchema,
  stageId,
  stageLabel,
  stageOf,
  stuckAfterMs,
  stuckOf,
  type PipelineStage,
  type PullFacts,
  type StageFacts,
  type TicketStage,
} from '../../src/shared/workflow/pipeline'

const HEAD = 'a'.repeat(40)
const OLD = 'b'.repeat(40)
const MERGE = 'c'.repeat(40)
const LATER = 'd'.repeat(40)

/** worfy's Pipeline from the spec: Queued → Implementing → CI → Agent review → Check «windows» → Gate & merge → Deploy → Closing → Done. */
const WORFY: PipelineStage[] = [
  { kind: 'queued' },
  { kind: 'implementing' },
  { kind: 'ci' },
  { kind: 'agent-review' },
  { kind: 'check', name: 'windows' },
  { kind: 'gate-merge' },
  { kind: 'deploy' },
  { kind: 'closing' },
  { kind: 'done' },
]

/** Atakama's Pipeline from the spec (Silent mode): Queued → Implementing → Agent review → CI → Human review → Awaiting merge → Done. */
const ATAKAMA: PipelineStage[] = [
  { kind: 'queued' },
  { kind: 'implementing' },
  { kind: 'agent-review' },
  { kind: 'ci' },
  { kind: 'human-review' },
  { kind: 'awaiting-merge' },
  { kind: 'done' },
]

const facts = (extra: Partial<StageFacts> = {}): StageFacts => ({
  mode: 'full',
  status: 'work',
  statusAt: '2026-10-17T09:00Z',
  blockedReason: null,
  waits: null,
  headSha: HEAD,
  pr: null,
  marks: [],
  deploys: [],
  lock: null,
  ...extra,
})

const pr = (extra: Partial<PullFacts> = {}): PullFacts => ({
  number: 7,
  state: 'OPEN',
  headSha: HEAD,
  checks: [],
  reviewDecision: null,
  mergedAt: null,
  mergeCommit: null,
  ...extra,
})

const green = { name: 'check', state: 'success' as const, startedAt: '2026-10-17T10:00:00Z', completedAt: '2026-10-17T10:05:00Z' }
const running = { name: 'check', state: 'pending' as const, startedAt: '2026-10-17T10:00:00Z', completedAt: null }
const red = { name: 'check', state: 'failure' as const, startedAt: '2026-10-17T10:00:00Z', completedAt: '2026-10-17T10:03:00Z' }
const mark = (kind: string, verdict: 'pending' | 'success' | 'failure' | 'skipped', sha = HEAD, at = '2026-10-17T11:00:00Z') => ({ kind, verdict, sha, at })
const merged = (extra: Partial<PullFacts> = {}) => pr({ state: 'MERGED', mergedAt: '2026-10-17T12:00:00Z', mergeCommit: MERGE, ...extra })

type Case = [name: string, pipeline: readonly PipelineStage[], facts: StageFacts, expected: Partial<TicketStage>]

const cases: Case[] = [
  // ── Queued ──
  ['Status open → Queued', WORFY, facts({ status: 'open', headSha: null }), { stage: 'queued', index: 0, passed: [], waits: 'agent' }],
  ['no Status line (old header) → Queued', WORFY, facts({ status: 'none', headSha: null }), { stage: 'queued' }],
  // ── Implementing ──
  ['claimed, no PR, no mark → Implementing', WORFY, facts(), { stage: 'implementing', index: 1, passed: ['queued'], rework: false }],
  ['a mark on the head SHA passes Implementing without a PR (Atakama: review before the PR)', ATAKAMA, facts({ mode: 'silent', marks: [mark('review', 'pending')] }), { stage: 'agent-review' }],
  ['a mark on an old SHA does not count: still Implementing', ATAKAMA, facts({ mode: 'silent', marks: [mark('review', 'success', OLD)] }), { stage: 'implementing' }],
  ['review failure on the head SHA → Implementing with rework', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'failure')] }), { stage: 'implementing', rework: true, enteredAt: '2026-10-17T11:00:00.000Z' }],
  ['check/windows failure on the head SHA → Implementing with rework', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'success'), mark('check/windows', 'failure')] }), { stage: 'implementing', rework: true }],
  ['review failure on an old SHA, new push → past Implementing, review waits again', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'failure', OLD)] }), { stage: 'agent-review', rework: false }],
  ['a later success after a failure on the same SHA → no rework', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'failure'), mark('review', 'success', HEAD, '2026-10-17T11:30:00Z')] }), { stage: 'check/windows', rework: false }],
  ['a closed PR is no PR', WORFY, facts({ pr: pr({ state: 'CLOSED' }) }), { stage: 'implementing' }],
  // ── CI ──
  ['PR with CI running → CI', WORFY, facts({ pr: pr({ checks: [green, running] }) }), { stage: 'ci', sub: null }],
  ['PR with red CI → CI failing', WORFY, facts({ pr: pr({ checks: [green, red] }) }), { stage: 'ci', sub: 'failing' }],
  ['PR with no CI at all (batch CI) → CI passed', WORFY, facts({ pr: pr() }), { stage: 'agent-review' }],
  ['Atakama: review passed, no PR yet → CI waits for the PR', ATAKAMA, facts({ mode: 'silent', marks: [mark('review', 'success')] }), { stage: 'ci' }],
  ['blocked on CI: the flag with its reason, the Stage stays CI', WORFY, facts({ status: 'blocked', blockedReason: 'waits for the owner', waits: 'owner', pr: pr({ checks: [red] }) }), { stage: 'ci', sub: 'failing', blocked: { reason: 'waits for the owner' }, waits: 'owner' }],
  // ── Agent review ──
  ['CI green, no review mark → Agent review', WORFY, facts({ pr: pr({ checks: [green] }) }), { stage: 'agent-review', enteredAt: '2026-10-17T10:05:00.000Z' }],
  ['review pending → Agent review', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'pending')] }), { stage: 'agent-review' }],
  ['review success on an old SHA → Agent review again', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'success', OLD)] }), { stage: 'agent-review' }],
  // ── Check «windows» ──
  ['review success → Check «windows»', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'success')] }), { stage: 'check/windows', enteredAt: '2026-10-17T11:00:00.000Z' }],
  ['check/windows skipped is passed, and named as skipped', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'success'), mark('check/windows', 'skipped')] }), { stage: 'gate-merge', skipped: ['check/windows'] }],
  ['check/windows success → Gate & merge', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'success'), mark('check/windows', 'success')] }), { stage: 'gate-merge', skipped: [], waits: 'agent' }],
  // ── Gate & merge ──
  [
    'gate running: the PR is in holder.json',
    WORFY,
    facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'success'), mark('check/windows', 'success')], lock: { prs: [5, 7] } }),
    { stage: 'gate-merge', sub: 'gate running' },
  ],
  [
    'waiting for gate: the lock holds another PR',
    WORFY,
    facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'success'), mark('check/windows', 'success')], lock: { prs: [5] } }),
    { stage: 'gate-merge', sub: 'waiting for gate' },
  ],
  [
    'the lock is held, holder.json empty or unreadable: gate busy, PR unknown',
    WORFY,
    facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'success'), mark('check/windows', 'success')], lock: { prs: null } }),
    { stage: 'gate-merge', sub: 'gate busy' },
  ],
  // ── after the merge ──
  [
    'PR merged without any mark → past every Stage before the merge: Deploy',
    WORFY,
    facts({ pr: merged() }),
    { stage: 'deploy', passed: ['queued', 'implementing', 'ci', 'agent-review', 'check/windows', 'gate-merge'], enteredAt: '2026-10-17T12:00:00.000Z' },
  ],
  ['Deploy: a commit with the deploy mark that has the merge commit as its ancestor', WORFY, facts({ pr: merged(), deploys: [{ sha: LATER, at: '2026-10-17T13:00:00Z', environment: null, containsMerge: true }] }), { stage: 'closing', enteredAt: '2026-10-17T13:00:00.000Z' }],
  ['Deploy: a deploy mark on a commit before the merge does not count', WORFY, facts({ pr: merged(), deploys: [{ sha: OLD, at: '2026-10-17T13:00:00Z', environment: null, containsMerge: false }] }), { stage: 'deploy' }],
  [
    'Deploy with an environment: only a Deployment of that environment counts',
    [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'gate-merge' }, { kind: 'deploy', environment: 'production' }, { kind: 'done' }],
    facts({ pr: merged(), deploys: [{ sha: LATER, at: null, environment: null, containsMerge: true }, { sha: LATER, at: null, environment: 'staging', containsMerge: true }] }),
    { stage: 'deploy' },
  ],
  [
    'Deploy with an environment: its Deployment on a descendant passes',
    [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'gate-merge' }, { kind: 'deploy', environment: 'production' }, { kind: 'done' }],
    facts({ pr: merged(), deploys: [{ sha: LATER, at: null, environment: 'production', containsMerge: true }] }),
    { stage: 'done' },
  ],
  [
    'Silent mode: the commit status deploy does not count, only a Deployment',
    [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'gate-merge' }, { kind: 'deploy' }, { kind: 'done' }],
    facts({ mode: 'silent', pr: merged(), deploys: [{ sha: LATER, at: null, environment: null, containsMerge: true }] }),
    { stage: 'deploy' },
  ],
  ['merged and deployed, Status not done → Closing', WORFY, facts({ pr: merged(), deploys: [{ sha: MERGE, at: null, environment: null, containsMerge: true }] }), { stage: 'closing', waits: 'agent' }],
  ['Status done → Done, whatever else is missing', WORFY, facts({ status: 'done', statusAt: '2026-10-17T15:00Z', pr: null }), { stage: 'done', index: 8, waits: null, enteredAt: '2026-10-17T15:00:00.000Z' }],
  // ── the default Pipeline ──
  ['default Pipeline: merged, Status claimed → Closing', DEFAULT_PIPELINE, facts({ pr: merged() }), { stage: 'closing' }],
  // ── Atakama ──
  ['Atakama: review and CI green → Human review, waits for the team', ATAKAMA, facts({ mode: 'silent', pr: pr({ checks: [green] }), marks: [mark('review', 'success')] }), { stage: 'human-review', waits: 'team' }],
  ['Atakama: changes requested → still Human review', ATAKAMA, facts({ mode: 'silent', pr: pr({ checks: [green], reviewDecision: 'CHANGES_REQUESTED' }), marks: [mark('review', 'success')] }), { stage: 'human-review' }],
  ['Atakama: approved → Awaiting merge, waits for the team', ATAKAMA, facts({ mode: 'silent', pr: pr({ checks: [green], reviewDecision: 'APPROVED' }), marks: [mark('review', 'success')] }), { stage: 'awaiting-merge', waits: 'team' }],
  ['Atakama: Waits: owner wins over the kind of the Stage', ATAKAMA, facts({ mode: 'silent', waits: 'owner', pr: pr({ checks: [green], reviewDecision: 'APPROVED' }), marks: [mark('review', 'success')] }), { stage: 'awaiting-merge', waits: 'owner' }],
  ['Atakama: merged by people past the Pipeline → Done', ATAKAMA, facts({ mode: 'silent', pr: merged() }), { stage: 'done' }],
]

describe('stageOf', () => {
  it.each(cases)('%s', (_name, pipeline, input, expected) => {
    expect(stageOf(input, pipeline)).toMatchObject(expected)
  })

  it('names the Stage by its index in the Pipeline and lists the passed ones in order', () => {
    const stage = stageOf(facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'success')] }), WORFY)
    expect(stage).toEqual({
      stage: 'check/windows',
      index: 4,
      kind: 'check',
      passed: ['queued', 'implementing', 'ci', 'agent-review'],
      skipped: [],
      blocked: null,
      rework: false,
      sub: null,
      waits: 'agent',
      enteredAt: '2026-10-17T11:00:00.000Z',
      statusAt: '2026-10-17T09:00Z',
    })
  })

  it('a date without a time reads as 00:00 UTC', () => {
    expect(stageOf(facts({ status: 'open', statusAt: '2026-10-17', headSha: null }), WORFY).enteredAt).toBe('2026-10-17T00:00:00.000Z')
  })

  it('an unreadable time is no time, not a throw', () => {
    expect(stageOf(facts({ statusAt: 'soon' }), WORFY).enteredAt).toBeNull()
  })
})

describe('the catalogue', () => {
  it('the default Pipeline is the one of ADR-0067', () => {
    expect(DEFAULT_PIPELINE.map(stageId)).toEqual(['queued', 'implementing', 'ci', 'agent-review', 'gate-merge', 'closing', 'done'])
  })

  it('labels: the catalogue name, a Check by its name, and the Profile label first', () => {
    expect(WORFY.map((stage) => stageLabel(stage))).toEqual(['Queued', 'Implementing', 'CI', 'Agent review', 'Check «windows»', 'Gate & merge', 'Deploy', 'Closing', 'Done'])
    expect(ATAKAMA.map((stage) => stageLabel(stage))).toContain('Human review')
    expect(ATAKAMA.map((stage) => stageLabel(stage))).toContain('Awaiting merge')
    expect(stageLabel({ kind: 'ci', label: 'Tests' })).toBe('Tests')
  })

  it.each([
    ['queued not first', [{ kind: 'implementing' }, { kind: 'queued' }, { kind: 'done' }]],
    ['done not last', [{ kind: 'queued' }, { kind: 'done' }, { kind: 'closing' }]],
    ['a kind twice', [{ kind: 'queued' }, { kind: 'ci' }, { kind: 'ci' }, { kind: 'done' }]],
    ['a check without a name', [{ kind: 'queued' }, { kind: 'check' }, { kind: 'done' }]],
    ['the same check twice', [{ kind: 'queued' }, { kind: 'check', name: 'windows' }, { kind: 'check', name: 'windows' }, { kind: 'done' }]],
    ['gate-merge and awaiting-merge together', [{ kind: 'queued' }, { kind: 'gate-merge' }, { kind: 'awaiting-merge' }, { kind: 'done' }]],
    ['a kind outside the catalogue', [{ kind: 'queued' }, { kind: 'script' }, { kind: 'done' }]],
  ])('the schema refuses a Pipeline with %s', (_name, pipeline) => {
    expect(pipelineSchema.safeParse(pipeline).success).toBe(false)
  })

  it('the schema takes both Pipelines of the spec and two different checks', () => {
    expect(pipelineSchema.safeParse(WORFY).success).toBe(true)
    expect(pipelineSchema.safeParse(ATAKAMA).success).toBe(true)
    expect(pipelineSchema.safeParse([{ kind: 'queued' }, { kind: 'check', name: 'windows' }, { kind: 'check', name: 'linux' }, { kind: 'done' }]).success).toBe(true)
  })
})

const HOUR = 60 * 60_000
const MIN = 60_000

describe('stuck: the threshold of a Stage (worfy-pipeline ticket 06)', () => {
  it.each([
    ['implementing', 2 * HOUR],
    ['agent-review', 2 * HOUR],
    ['ci', 2 * HOUR],
    ['gate-merge', 2 * HOUR],
    ['human-review', 24 * HOUR],
    ['awaiting-merge', 24 * HOUR],
  ] as const)('by default %s: %d ms', (kind, ms) => {
    expect(stuckAfterMs({ kind }, kind === 'human-review' || kind === 'awaiting-merge' ? 'team' : 'agent')).toBe(ms)
  })

  it.each(['queued', 'deploy', 'closing', 'done'] as const)('by default %s has none', (kind) => {
    expect(stuckAfterMs({ kind }, 'agent')).toBeNull()
  })

  it('a Check has none by default', () => {
    expect(stuckAfterMs({ kind: 'check', name: 'windows' }, 'agent')).toBeNull()
  })

  it('Waits: team on CI — 24 h; Waits: owner on Implementing — 24 h; on a Check without a threshold — 24 h', () => {
    expect(stuckAfterMs({ kind: 'ci' }, 'team')).toBe(24 * HOUR)
    expect(stuckAfterMs({ kind: 'implementing' }, 'owner')).toBe(24 * HOUR)
    expect(stuckAfterMs({ kind: 'check', name: 'windows' }, 'owner')).toBe(24 * HOUR)
    // A Machine is waited for like an agent.
    expect(stuckAfterMs({ kind: 'ci' }, 'Windows PC')).toBe(2 * HOUR)
  })

  it("the Profile's stuck_after wins over every default, in hours or minutes", () => {
    expect(stuckAfterMs({ kind: 'ci', stuck_after: '3h' }, 'team')).toBe(3 * HOUR)
    expect(stuckAfterMs({ kind: 'check', name: 'windows', stuck_after: '30m' }, 'agent')).toBe(30 * MIN)
    expect(stuckAfterMs({ kind: 'deploy', stuck_after: '1h' }, 'agent')).toBe(HOUR)
  })

  it('Done is never stuck, whatever the Profile says', () => {
    expect(stuckAfterMs({ kind: 'done', stuck_after: '1h' }, null)).toBeNull()
  })
})

describe('stuckOf', () => {
  const NOW = Date.parse('2026-10-17T15:00:00Z')
  const on = (enteredAt: string | null, waits: string | null = 'agent') => ({ waits, enteredAt })

  it('the time is now − enteredAt; stuck from the threshold on', () => {
    expect(stuckOf({ kind: 'ci' }, on('2026-10-17T12:00:00.000Z'), NOW)).toEqual({ stuck: true, forMs: 3 * HOUR, afterMs: 2 * HOUR })
    expect(stuckOf({ kind: 'ci' }, on('2026-10-17T13:00:00.000Z'), NOW)).toEqual({ stuck: true, forMs: 2 * HOUR, afterMs: 2 * HOUR })
    expect(stuckOf({ kind: 'ci' }, on('2026-10-17T13:00:01.000Z'), NOW)).toMatchObject({ stuck: false })
  })

  it('Waits: team on CI is stuck only after 24 h', () => {
    expect(stuckOf({ kind: 'ci' }, on('2026-10-17T12:00:00.000Z', 'team'), NOW)).toMatchObject({ stuck: false, afterMs: 24 * HOUR })
    expect(stuckOf({ kind: 'ci' }, on('2026-10-16T15:00:00.000Z', 'team'), NOW)).toMatchObject({ stuck: true })
  })

  it('a Stage without a threshold is never stuck, but still says how long', () => {
    expect(stuckOf({ kind: 'deploy' }, on('2026-10-10T15:00:00.000Z'), NOW)).toEqual({ stuck: false, forMs: 7 * 24 * HOUR, afterMs: null })
  })

  it('without enteredAt the Ticket is not stuck: null', () => {
    expect(stuckOf({ kind: 'ci' }, on(null), NOW)).toBeNull()
  })

  it('a stage of the Stages computed from facts: stageOf and stuckOf together', () => {
    const stage = stageOf(facts({ pr: pr({ checks: [running] }) }), WORFY)
    expect(stage.stage).toBe('ci')
    expect(stuckOf(WORFY[stage.index]!, stage, Date.parse('2026-10-17T12:00:01Z'))).toMatchObject({ stuck: true })
    expect(stuckOf(WORFY[stage.index]!, stage, Date.parse('2026-10-17T11:59:59Z'))).toMatchObject({ stuck: false })
  })
})

describe('onStageFor', () => {
  it('says the Stage and the time in minutes, hours or days', () => {
    expect(onStageFor('CI', 3 * HOUR + 59 * MIN)).toBe('on CI for 3 h')
    expect(onStageFor('Agent review', 45 * MIN)).toBe('on Agent review for 45 min')
    expect(onStageFor('Human review', 3 * 24 * HOUR)).toBe('on Human review for 3 d')
    expect(onStageFor('CI', 47 * HOUR)).toBe('on CI for 47 h')
  })
})
