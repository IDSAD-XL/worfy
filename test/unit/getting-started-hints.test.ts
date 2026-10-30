// The hints of the Stages of the demo Ticket (worfy-onboarding ticket 09; spec, decision 10 and
// "Texts (draft)"): which hint a snapshot of the demo's Stages gives, as a pure function.
import { describe, expect, it } from 'vitest'
import type { DemoRecord, GettingStartedSnapshot } from '../../src/shared/ipc/getting-started'
import type { PipelineSnapshot, PipelineTicket } from '../../src/shared/ipc/pipeline'
import type { StageKind } from '../../src/shared/workflow/pipeline'
import { HINT_TEXTS, stageHint } from '../../src/renderer/getting-started/hints'

const DEMO: DemoRecord = { projectId: 'demo-id', path: '/home/user/worfy-demo', profile: 'worfy-demo', cost: 'cheaper' }
const MARKED = '2026-10-30T10:00:00.000Z'

/** The demo Ticket `todo 01` on a Stage of the demo's Pipeline. */
function ticket(kind: StageKind, more: Partial<PipelineTicket> = {}): PipelineTicket {
  return {
    epic: 'todo',
    num: 1,
    stage: kind,
    index: 0,
    kind,
    passed: [],
    skipped: [],
    blocked: null,
    rework: false,
    sub: null,
    waits: null,
    enteredAt: null,
    ...more,
  }
}

function snapshot(tickets: PipelineTicket[], root = DEMO.path): PipelineSnapshot {
  return { root, pipeline: [], tickets } as unknown as PipelineSnapshot
}

/** Steps 1 and 2 marked: the demo is there, step 3 is the current one. */
const DEMO_OPEN: GettingStartedSnapshot['steps'] = { '1': MARKED, '2': MARKED }
/** The Orchestrator has answered: step 4 is the current one. */
const PAST_3: GettingStartedSnapshot['steps'] = { ...DEMO_OPEN, '3': MARKED }

describe('stageHint', () => {
  it('gives the Epic and Ticket hint once the Orchestrator has answered (step 3) while the Ticket waits in Queued, until step 4', () => {
    expect(stageHint({ demo: DEMO, steps: PAST_3, pipeline: snapshot([ticket('queued')]) })).toEqual({ id: 'epic-ticket', text: HINT_TEXTS['epic-ticket'] })
    // Not before the Orchestrator has answered.
    expect(stageHint({ demo: DEMO, steps: DEMO_OPEN, pipeline: snapshot([ticket('queued')]) })).toBeNull()
    // Not once step 4 is marked, whatever the order the steps were marked in.
    expect(stageHint({ demo: DEMO, steps: { ...PAST_3, '4': MARKED }, pipeline: snapshot([ticket('queued')]) })).toBeNull()
    expect(stageHint({ demo: DEMO, steps: { ...DEMO_OPEN, '4': MARKED }, pipeline: snapshot([ticket('queued')]) })).toBeNull()
  })

  it('gives each Stage of the demo its own hint', () => {
    const at = (kind: StageKind, more: Partial<PipelineTicket> = {}) => stageHint({ demo: DEMO, steps: PAST_3, pipeline: snapshot([ticket(kind, more)]) })?.id
    expect(at('implementing')).toBe('implementing')
    expect(at('agent-review')).toBe('agent-review')
    expect(at('implementing', { rework: true })).toBe('rework')
    expect(at('gate-merge')).toBe('gate-merge')
    expect(at('done')).toBe('done')
  })

  it('gives the texts of the spec, word for word, and six different ones', () => {
    expect(HINT_TEXTS).toEqual({
      'epic-ticket': 'An Epic is a goal; a Ticket is one piece of work in it. Both are files in the project, under .scratch/.',
      implementing: 'Implementer started in its own worktree — a separate checkout, so main stays untouched.',
      'agent-review': "The reviewer started. It reads the change and runs the project's checks itself.",
      rework: 'The reviewer found a problem — this is the rework round. The implementer fixes it on the same branch.',
      'gate-merge': "Review passed. The Orchestrator runs the Gate — the project's full checks — and merges.",
      done: 'Merged. The ticket is done.',
    })
    expect(new Set(Object.values(HINT_TEXTS)).size).toBe(6)
  })

  it('answers the rework round, not the first Implementing, when the Ticket is back after a failure mark', () => {
    const hint = stageHint({ demo: DEMO, steps: PAST_3, pipeline: snapshot([ticket('implementing', { rework: true, passed: ['queued', 'implementing', 'agent-review'] })]) })
    expect(hint).toEqual({ id: 'rework', text: HINT_TEXTS.rework })
  })

  it('answers null for the Stages of another Project, without a demo, without a snapshot, and for another Ticket', () => {
    const steps = PAST_3
    expect(stageHint({ demo: DEMO, steps, pipeline: snapshot([ticket('agent-review')], '/home/user/other') })).toBeNull()
    expect(stageHint({ demo: null, steps, pipeline: snapshot([ticket('agent-review')]) })).toBeNull()
    expect(stageHint({ demo: DEMO, steps, pipeline: undefined })).toBeNull()
    expect(stageHint({ demo: DEMO, steps, pipeline: snapshot([ticket('agent-review', { epic: 'other' }), ticket('agent-review', { num: 2 })]) })).toBeNull()
  })

  it('answers null for a Stage the demo has no hint for', () => {
    for (const kind of ['ci', 'check', 'human-review', 'awaiting-merge', 'deploy', 'closing'] as const) {
      expect(stageHint({ demo: DEMO, steps: PAST_3, pipeline: snapshot([ticket(kind)]) })).toBeNull()
    }
  })
})
