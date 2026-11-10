// The Stage of a Ticket from the facts about it (worfy-pipeline ticket 03, ADR-0067): a pure
// function, no Electron, no git, no gh. The table covers every kind of the catalogue and both
// Pipelines of the epic's spec — worfy's and Atalaya's.
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
  type ReleaseFact,
  type RepoStageFacts,
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

/** Atalaya's Pipeline from the spec (Silent mode): Queued → Implementing → Agent review → CI → Human review → Awaiting merge → Done. */
const ATALAYA: PipelineStage[] = [
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
  ['a mark on the head SHA passes Implementing without a PR (Atalaya: review before the PR)', ATALAYA, facts({ mode: 'silent', marks: [mark('review', 'pending')] }), { stage: 'agent-review' }],
  ['a mark on an old SHA does not count: still Implementing', ATALAYA, facts({ mode: 'silent', marks: [mark('review', 'success', OLD)] }), { stage: 'implementing' }],
  ['review failure on the head SHA → Implementing with rework', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'failure')] }), { stage: 'implementing', rework: true, enteredAt: '2026-10-17T11:00:00.000Z' }],
  ['check/windows failure on the head SHA → Implementing with rework', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'success'), mark('check/windows', 'failure')] }), { stage: 'implementing', rework: true }],
  ['review failure on an old SHA, new push → past Implementing, review waits again', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'failure', OLD)] }), { stage: 'agent-review', rework: false }],
  ['a later success after a failure on the same SHA → no rework', WORFY, facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'failure'), mark('review', 'success', HEAD, '2026-10-17T11:30:00Z')] }), { stage: 'check/windows', rework: false }],
  ['a closed PR is no PR', WORFY, facts({ pr: pr({ state: 'CLOSED' }) }), { stage: 'implementing' }],
  // ── CI ──
  ['PR with CI running → CI', WORFY, facts({ pr: pr({ checks: [green, running] }) }), { stage: 'ci', sub: null }],
  ['PR with red CI → CI failing', WORFY, facts({ pr: pr({ checks: [green, red] }) }), { stage: 'ci', sub: 'failing' }],
  ['PR with no CI at all (batch CI) → CI passed', WORFY, facts({ pr: pr() }), { stage: 'agent-review' }],
  ['Atalaya: review passed, no PR yet → CI waits for the PR', ATALAYA, facts({ mode: 'silent', marks: [mark('review', 'success')] }), { stage: 'ci' }],
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
  // ── Atalaya ──
  ['Atalaya: review and CI green → Human review, waits for the team', ATALAYA, facts({ mode: 'silent', pr: pr({ checks: [green] }), marks: [mark('review', 'success')] }), { stage: 'human-review', waits: 'team' }],
  ['Atalaya: changes requested → still Human review', ATALAYA, facts({ mode: 'silent', pr: pr({ checks: [green], reviewDecision: 'CHANGES_REQUESTED' }), marks: [mark('review', 'success')] }), { stage: 'human-review' }],
  ['Atalaya: approved → Awaiting merge, waits for the team', ATALAYA, facts({ mode: 'silent', pr: pr({ checks: [green], reviewDecision: 'APPROVED' }), marks: [mark('review', 'success')] }), { stage: 'awaiting-merge', waits: 'team' }],
  ['Atalaya: Waits: owner wins over the kind of the Stage', ATALAYA, facts({ mode: 'silent', waits: 'owner', pr: pr({ checks: [green], reviewDecision: 'APPROVED' }), marks: [mark('review', 'success')] }), { stage: 'awaiting-merge', waits: 'owner' }],
  ['Atalaya: merged by people past the Pipeline → Done', ATALAYA, facts({ mode: 'silent', pr: merged() }), { stage: 'done' }],
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
    expect(ATALAYA.map((stage) => stageLabel(stage))).toContain('Human review')
    expect(ATALAYA.map((stage) => stageLabel(stage))).toContain('Awaiting merge')
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
    expect(pipelineSchema.safeParse(ATALAYA).success).toBe(true)
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

describe('a snapshot across the link between Machines (worfy-pipeline ticket 06)', () => {
  it('a Linked machine on an older build sends no statusAt: its snapshot still reads, and statusAt is absent', async () => {
    const { pipelineSnapshotSchema } = await import('../../src/shared/ipc/pipeline')
    const ticket = { epic: 'worfy-link', num: 16, stage: 'ci', index: 2, kind: 'ci', passed: ['queued', 'implementing'], skipped: [], blocked: null, rework: false, sub: null, waits: 'agent', enteredAt: null }
    const parsed = pipelineSnapshotSchema.safeParse({ root: '/projects/worfy', pipeline: [], tickets: [ticket], error: null })
    expect(parsed.error?.issues).toBeUndefined()
    expect(parsed.data?.tickets[0]?.statusAt).toBeUndefined()
    // A snapshot of this build keeps its time, and null stays null.
    expect(pipelineSnapshotSchema.parse({ root: '/r', pipeline: [], tickets: [{ ...ticket, statusAt: '2026-10-18T10:00Z' }], error: null }).tickets[0]?.statusAt).toBe('2026-10-18T10:00Z')
    expect(pipelineSnapshotSchema.parse({ root: '/r', pipeline: [], tickets: [{ ...ticket, statusAt: null }], error: null }).tickets[0]?.statusAt).toBeNull()
  })
})

// ── a Ticket over several repositories (worfy-multi-repo-ticket 04, ADR-0104 items 4, 5, 8) ─────────

describe('stageOf: a Ticket over several repositories', () => {
  const LIB = 'e'.repeat(40)
  const APP = 'f'.repeat(40)
  const NEW_APP = '1'.repeat(40)
  /** The facts of one repository: the head of its branch, its PR, and the Ticket's marks (one marks file for all). */
  const repo = (name: string, headSha: string | null, extra: Partial<RepoStageFacts> = {}): RepoStageFacts => ({ repo: name, headSha, pr: null, marks: [], deploys: [], ...extra })
  const both = (lib: Partial<RepoStageFacts>, app: Partial<RepoStageFacts>, extra: Partial<StageFacts> = {}): StageFacts =>
    facts({ mode: 'silent', headSha: null, repos: [repo('lib', LIB, lib), repo('app', APP, app)], ...extra })
  const ATALAYA_INDEX = (id: string) => ATALAYA.findIndex((stage) => stageId(stage) === id)

  it('before the PRs: review on the head of one branch keeps the Ticket before Agent review; on the heads of both it goes on', () => {
    const one = [mark('review', 'success', LIB)]
    const onOne = stageOf(both({ marks: one }, { marks: one }), ATALAYA)
    expect(onOne).toMatchObject({ stage: 'implementing', passed: ['queued'], merged: { count: 0, of: 2 } })
    expect(onOne.index).toBeLessThanOrEqual(ATALAYA_INDEX('agent-review'))
    const all = [mark('review', 'success', LIB), mark('review', 'success', APP, '2026-10-17T11:02:00Z')]
    // Past Agent review, and CI waits for the PRs; the Ticket entered CI with the later of the two marks.
    expect(stageOf(both({ marks: all }, { marks: all }), ATALAYA)).toMatchObject({ stage: 'ci', passed: ['queued', 'implementing', 'agent-review'], enteredAt: '2026-10-17T11:02:00.000Z' })
  })

  it('a pending review on the head of each branch: Agent review', () => {
    const pending = [mark('review', 'pending', LIB), mark('review', 'pending', APP)]
    expect(stageOf(both({ marks: pending }, { marks: pending }), ATALAYA)).toMatchObject({ stage: 'agent-review' })
  })

  it('a new head of one branch after the review takes the verdict off the whole Ticket', () => {
    const reviewed = [mark('review', 'success', LIB), mark('review', 'success', APP)]
    expect(stageOf(both({ marks: reviewed }, { marks: reviewed }), ATALAYA).stage).toBe('ci')
    const after = stageOf(both({ marks: reviewed }, { headSha: NEW_APP, marks: reviewed }), ATALAYA)
    expect(after).toMatchObject({ stage: 'implementing', rework: false })
    expect(after.passed).not.toContain('agent-review')
    // The new review marks the new head too: the Ticket is on Agent review, then past it.
    const again = [...reviewed, mark('review', 'pending', NEW_APP, '2026-10-17T12:00:00Z')]
    expect(stageOf(both({ marks: again }, { headSha: NEW_APP, marks: again }), ATALAYA).stage).toBe('agent-review')
    const passed = [...again, mark('review', 'success', NEW_APP, '2026-10-17T12:10:00Z')]
    expect(stageOf(both({ marks: passed }, { headSha: NEW_APP, marks: passed }), ATALAYA).stage).toBe('ci')
  })

  it('a review failure on the head of either branch sends the whole Ticket back to Implementing with rework', () => {
    const marks = [mark('review', 'success', LIB), mark('review', 'failure', APP, '2026-10-17T11:30:00Z')]
    expect(stageOf(both({ marks }, { marks }), ATALAYA)).toMatchObject({ stage: 'implementing', rework: true, enteredAt: '2026-10-17T11:30:00.000Z' })
    // lib not reviewed yet is on Implementing too, without rework: the failure on app's head still makes it rework.
    const failed = [mark('review', 'failure', APP, '2026-10-17T11:30:00Z')]
    expect(stageOf(both({ marks: failed }, { marks: failed }), ATALAYA)).toMatchObject({ stage: 'implementing', rework: true })
  })

  it('after the PRs: red CI of either PR is red CI of the Ticket', () => {
    const marks = [mark('review', 'success', LIB), mark('review', 'success', APP)]
    const libPr = (checks: PullFacts['checks']) => pr({ number: 41, headSha: LIB, checks })
    const appPr = (checks: PullFacts['checks']) => pr({ number: 118, headSha: APP, checks })
    expect(stageOf(both({ marks, pr: libPr([green]) }, { marks, pr: appPr([red]) }), ATALAYA)).toMatchObject({ stage: 'ci', sub: 'failing' })
    expect(stageOf(both({ marks, pr: libPr([red]) }, { marks, pr: appPr([green]) }), ATALAYA)).toMatchObject({ stage: 'ci', sub: 'failing' })
    // One red and one running: still failing, whichever repository comes first.
    expect(stageOf(both({ marks, pr: libPr([running]) }, { marks, pr: appPr([red]) }), ATALAYA)).toMatchObject({ stage: 'ci', sub: 'failing' })
    expect(stageOf(both({ marks, pr: libPr([green]) }, { marks, pr: appPr([running]) }), ATALAYA)).toMatchObject({ stage: 'ci', sub: null })
    expect(stageOf(both({ marks, pr: libPr([green]) }, { marks, pr: appPr([green]) }), ATALAYA)).toMatchObject({ stage: 'human-review', sub: null })
  })

  it('one PR merged and the other open: the Stage is the open one\'s, 1 of 2 merged; both merged: past the merge', () => {
    const marks = [mark('review', 'success', APP)]
    const libMerged = merged({ number: 41, headSha: LIB })
    const appOpen = pr({ number: 118, headSha: APP, checks: [green] })
    expect(stageOf(both({ marks, pr: libMerged }, { marks, pr: appOpen }), ATALAYA)).toMatchObject({ stage: 'human-review', merged: { count: 1, of: 2 } })
    expect(stageOf(both({ marks, pr: libMerged }, { marks, pr: appOpen }, { mode: 'full' }), DEFAULT_PIPELINE)).toMatchObject({ stage: 'gate-merge', merged: { count: 1, of: 2 } })
    // The order of the Repo: lines does not matter: the earliest Stage of any repository is the Ticket's.
    expect(stageOf(both({ marks, pr: appOpen, headSha: APP }, { marks, pr: libMerged }), ATALAYA)).toMatchObject({ stage: 'human-review', merged: { count: 1, of: 2 } })
    const appMerged = merged({ number: 118, headSha: APP, mergedAt: '2026-10-18T12:00:00Z' })
    expect(stageOf(both({ pr: libMerged }, { pr: appMerged }, { mode: 'full' }), DEFAULT_PIPELINE)).toMatchObject({ stage: 'closing', merged: { count: 2, of: 2 }, enteredAt: '2026-10-18T12:00:00.000Z' })
  })

  it('a repository with no branch yet keeps the Ticket on Implementing', () => {
    const marks = [mark('review', 'success', LIB)]
    expect(stageOf(both({ marks }, { headSha: null, marks }), ATALAYA)).toMatchObject({ stage: 'implementing', merged: { count: 0, of: 2 } })
  })

  it('a Check passed with skipped in one repository is named skipped', () => {
    const marks = [mark('review', 'success', LIB), mark('review', 'success', APP), mark('check/windows', 'success', LIB), mark('check/windows', 'skipped', APP)]
    const open = (sha: string) => pr({ headSha: sha, checks: [green] })
    expect(stageOf(both({ marks, pr: open(LIB) }, { marks, pr: open(APP) }, { mode: 'full' }), WORFY)).toMatchObject({ stage: 'gate-merge', skipped: ['check/windows'] })
  })

  it('the gate lock: the PR of either repository in holder.json is the gate running', () => {
    const marks = [mark('review', 'success', LIB), mark('review', 'success', APP), mark('check/windows', 'success', LIB), mark('check/windows', 'success', APP)]
    const input = both({ marks, pr: pr({ number: 41, headSha: LIB, checks: [green] }) }, { marks, pr: pr({ number: 118, headSha: APP, checks: [green] }) }, { mode: 'full', lock: { prs: [118] } })
    expect(stageOf(input, WORFY)).toMatchObject({ stage: 'gate-merge', sub: 'gate running' })
  })

  it('Status done passes every Stage but Done whatever the repositories say', () => {
    expect(stageOf(both({}, {}, { status: 'done' }), ATALAYA)).toMatchObject({ stage: 'done', merged: { count: 0, of: 2 } })
  })

  it('a Ticket of one repository: the Stage as before, without merged', () => {
    const input = facts({ pr: pr({ checks: [green] }), marks: [mark('review', 'success')] })
    const stage = stageOf(input, WORFY)
    expect('merged' in stage).toBe(false)
    expect(stageOf({ ...input, repos: [] }, WORFY)).toEqual(stage)
  })

  it('a snapshot with merged reads; one without it (a Linked machine\'s older worfy) still reads', async () => {
    const { pipelineSnapshotSchema } = await import('../../src/shared/ipc/pipeline')
    const ticket = { epic: 'demo', num: 5, stage: 'ci', index: 2, kind: 'ci', passed: ['queued', 'implementing'], skipped: [], blocked: null, rework: false, sub: null, waits: 'agent', enteredAt: null }
    expect(pipelineSnapshotSchema.parse({ root: '/r', pipeline: [], tickets: [{ ...ticket, merged: { count: 1, of: 2 } }], error: null }).tickets[0]?.merged).toEqual({ count: 1, of: 2 })
    expect(pipelineSnapshotSchema.parse({ root: '/r', pipeline: [], tickets: [ticket], error: null }).tickets[0]?.merged).toBeUndefined()
  })
})

// ── the Stage release (worfy-multi-repo-ticket 05, ADR-0104 items 5, 6) ──────────────────────────────

describe('stageOf: the Stage release', () => {
  const LIB = 'e'.repeat(40)
  const APP = 'f'.repeat(40)
  /** A Pipeline of a Project over several repositories with release between CI and the review of people. */
  const WITH_RELEASE: PipelineStage[] = [
    { kind: 'queued' },
    { kind: 'implementing' },
    { kind: 'agent-review' },
    { kind: 'ci' },
    { kind: 'release' },
    { kind: 'human-review' },
    { kind: 'awaiting-merge' },
    { kind: 'done' },
  ]
  /** The same with release before CI. */
  const RELEASE_FIRST: PipelineStage[] = [{ kind: 'queued' }, { kind: 'implementing' }, { kind: 'agent-review' }, { kind: 'release' }, { kind: 'ci' }, { kind: 'human-review' }, { kind: 'awaiting-merge' }, { kind: 'done' }]
  const tag = (state: ReleaseFact['state']): ReleaseFact => ({ repo: 'lib', kind: 'tag', ref: 'lib-v1.4.0', state })
  const pkg = (state: ReleaseFact['state']): ReleaseFact => ({ repo: 'lib', kind: 'package', ref: '@acme/lots@1.4.0', state })
  const repo = (name: string, headSha: string | null, extra: Partial<RepoStageFacts> = {}): RepoStageFacts => ({ repo: name, headSha, pr: null, marks: [], deploys: [], ...extra })
  const reviewed = [mark('review', 'success', LIB), mark('review', 'success', APP)]
  /** lib merged; app's PR open on its head with `checks`; both reviewed. */
  const libMergedAppOpen = (checks: PullFacts['checks'], releases: ReleaseFact[]): StageFacts =>
    facts({
      mode: 'silent',
      headSha: null,
      repos: [repo('lib', LIB, { marks: reviewed, pr: merged({ number: 41, headSha: LIB }) }), repo('app', APP, { marks: reviewed, pr: pr({ number: 118, headSha: APP, checks }) })],
      releases,
    })

  it('is in the catalogue, with its label, and a Pipeline with it is valid', () => {
    expect(stageLabel({ kind: 'release' })).toBe('Release')
    expect(pipelineSchema.safeParse(WITH_RELEASE).success).toBe(true)
    expect(pipelineSchema.safeParse([{ kind: 'queued' }, { kind: 'release', name: 'x' }, { kind: 'done' }]).success).toBe(false)
  })

  it('a Release: line not met holds the Ticket on release, and the Stage carries what it waits for; met — passed', () => {
    const waiting = stageOf(libMergedAppOpen([green], [tag('waiting')]), WITH_RELEASE)
    expect(waiting).toMatchObject({ stage: 'release', kind: 'release', waits: 'team', merged: { count: 1, of: 2 } })
    expect(waiting.release).toEqual([tag('waiting')])
    const released = stageOf(libMergedAppOpen([green], [tag('released')]), WITH_RELEASE)
    expect(released).toMatchObject({ stage: 'human-review', passed: ['queued', 'implementing', 'agent-review', 'ci', 'release'] })
    expect(released.release).toEqual([tag('released')])
  })

  it('every line must be met: one of two released keeps the Ticket on release; a line not checked holds it too', () => {
    expect(stageOf(libMergedAppOpen([green], [tag('released'), pkg('waiting')]), WITH_RELEASE).stage).toBe('release')
    const unchecked = stageOf(libMergedAppOpen([green], [pkg('not checked')]), WITH_RELEASE)
    expect(unchecked.stage).toBe('release')
    expect(unchecked.release).toEqual([pkg('not checked')])
    expect(stageOf(libMergedAppOpen([green], [tag('released'), pkg('released')]), WITH_RELEASE).stage).toBe('human-review')
  })

  it("the library's repository does not wait for its own release: before its merge it goes through review, CI and the merge", () => {
    // Both PRs open, both green: lib is past release (its own line), app waits on it.
    const input = facts({
      mode: 'silent',
      headSha: null,
      repos: [repo('lib', LIB, { marks: reviewed, pr: pr({ number: 41, headSha: LIB, checks: [red] }) }), repo('app', APP, { marks: reviewed, pr: pr({ number: 118, headSha: APP, checks: [green] }) })],
      releases: [tag('waiting')],
    })
    // Red CI of the library is the library's own red: the Ticket is on CI, failing.
    expect(stageOf(input, WITH_RELEASE)).toMatchObject({ stage: 'ci', sub: 'failing' })
  })

  it("red CI of the consumer before the release does not paint the Ticket; after the release it is the usual red", () => {
    const before = stageOf(libMergedAppOpen([red], [tag('waiting')]), WITH_RELEASE)
    expect(before).toMatchObject({ stage: 'release', sub: null })
    const after = stageOf(libMergedAppOpen([red], [tag('released')]), WITH_RELEASE)
    expect(after).toMatchObject({ stage: 'ci', sub: 'failing' })
    // With release before CI the Ticket waits on release, and CI is judged only after it.
    expect(stageOf(libMergedAppOpen([red], [tag('waiting')]), RELEASE_FIRST)).toMatchObject({ stage: 'release', sub: null })
    expect(stageOf(libMergedAppOpen([red], [tag('released')]), RELEASE_FIRST)).toMatchObject({ stage: 'ci', sub: 'failing' })
    // A line not checked is not a release either: the red CI still does not paint the Ticket.
    expect(stageOf(libMergedAppOpen([red], [tag('not checked')]), WITH_RELEASE)).toMatchObject({ stage: 'release', sub: null })
  })

  it('a Ticket without Release: lines passes release at once, and its Stage carries no release', () => {
    const stage = stageOf(libMergedAppOpen([green], []), WITH_RELEASE)
    expect(stage).toMatchObject({ stage: 'human-review' })
    expect(stage.passed).toContain('release')
    expect('release' in stage).toBe(false)
  })

  it('a Pipeline without release: no such Stage, and the release facts change nothing', () => {
    const without = WITH_RELEASE.filter((stage) => stage.kind !== 'release')
    const stage = stageOf(libMergedAppOpen([red], [tag('waiting')]), without)
    expect(stage).toMatchObject({ stage: 'ci', sub: 'failing' })
    expect(stage.passed).not.toContain('release')
    expect('release' in stage).toBe(false)
    expect(stageOf(libMergedAppOpen([green], [tag('waiting')]), without).stage).toBe('human-review')
  })

  it("a Ticket of one repository waits for every line; the consumer's merged PR passes release", () => {
    const one = (pull: PullFacts, releases: ReleaseFact[]) => facts({ mode: 'silent', headSha: APP, marks: [mark('review', 'success', APP)], pr: pull, releases })
    expect(stageOf(one(pr({ headSha: APP, checks: [red] }), [tag('waiting')]), WITH_RELEASE)).toMatchObject({ stage: 'release', sub: null })
    expect(stageOf(one(merged({ headSha: APP }), [tag('waiting')]), WITH_RELEASE)).toMatchObject({ stage: 'done' })
    // The Ticket's one repository is the library: it does not wait for its own line.
    const lib = facts({ mode: 'silent', headSha: LIB, marks: [mark('review', 'success', LIB)], pr: pr({ headSha: LIB, checks: [green] }), releases: [tag('waiting')] })
    expect(stageOf({ ...lib, repo: 'lib' }, WITH_RELEASE)).toMatchObject({ stage: 'human-review', release: [tag('waiting')] })
    expect(stageOf({ ...lib, repo: 'app' }, WITH_RELEASE)).toMatchObject({ stage: 'release' })
  })

  it('stuck: 24 h by default as a Stage of the team, the Profile\'s stuck_after when set', () => {
    expect(stuckAfterMs({ kind: 'release' }, 'team')).toBe(24 * 3_600_000)
    expect(stuckAfterMs({ kind: 'release' }, 'agent')).toBe(24 * 3_600_000)
    expect(stuckAfterMs({ kind: 'release', stuck_after: '3h' }, 'team')).toBe(3 * 3_600_000)
    const waiting = stageOf(libMergedAppOpen([green], [tag('waiting')]), WITH_RELEASE)
    const entered = Date.parse(waiting.enteredAt!)
    expect(stuckOf({ kind: 'release', stuck_after: '3h' }, waiting, entered + 3 * 3_600_000)?.stuck).toBe(true)
    expect(stuckOf({ kind: 'release', stuck_after: '3h' }, waiting, entered + 3_600_000)?.stuck).toBe(false)
  })

  it('a snapshot with release reads; one without it (an older worfy) still reads', async () => {
    const { pipelineSnapshotSchema } = await import('../../src/shared/ipc/pipeline')
    const ticket = { epic: 'demo', num: 5, stage: 'release', index: 4, kind: 'release', passed: ['queued', 'implementing', 'agent-review', 'ci'], skipped: [], blocked: null, rework: false, sub: null, waits: 'team', enteredAt: null }
    expect(pipelineSnapshotSchema.parse({ root: '/r', pipeline: [], tickets: [{ ...ticket, release: [tag('waiting')] }], error: null }).tickets[0]?.release).toEqual([tag('waiting')])
    expect(pipelineSnapshotSchema.parse({ root: '/r', pipeline: [], tickets: [ticket], error: null }).tickets[0]?.release).toBeUndefined()
  })
})
