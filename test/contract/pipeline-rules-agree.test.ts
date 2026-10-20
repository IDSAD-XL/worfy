// The rules of a Pipeline exist twice: in the Harness (harness/lib/pipeline.cjs, used by bin/profile
// and bin/profile-set) and in worfy (src/shared/workflow/pipeline.ts, used by the Pipeline editor in
// Settings before it writes). The editor must refuse what the Harness refuses and accept what it
// accepts, so both copies get the same Pipelines here and must give the same verdict.
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PIPELINE, pipelineSchema, STAGE_KINDS } from '../../src/shared/workflow/pipeline'

interface HarnessPipelineRules {
  STAGE_KINDS: string[]
  DEFAULT_PIPELINE: { kind: string }[]
  pipelineProblem: (pipeline: unknown) => string | null
}

const harness = createRequire(join(process.cwd(), 'package.json'))('./harness/lib/pipeline.cjs') as HarnessPipelineRules

const valid: Record<string, unknown> = {
  'the default Pipeline': DEFAULT_PIPELINE,
  'queued and done only': [{ kind: 'queued' }, { kind: 'done' }],
  'every optional field where it belongs': [
    { kind: 'queued', label: 'Backlog' },
    { kind: 'implementing', stuck_after: '3h' },
    { kind: 'check', name: 'windows', label: 'Windows', stuck_after: '30m' },
    { kind: 'check', name: 'linux-2' },
    { kind: 'awaiting-merge' },
    { kind: 'deploy', environment: 'production' },
    { kind: 'done' },
  ],
}

const invalid: Record<string, unknown> = {
  'not a list': 'queued,done',
  'an empty list': [],
  'one Stage': [{ kind: 'done' }],
  'a Stage that is not an object': [{ kind: 'queued' }, null, { kind: 'done' }],
  'an unknown kind': [{ kind: 'queued' }, { kind: 'lint' }, { kind: 'done' }],
  'queued not first': [{ kind: 'implementing' }, { kind: 'queued' }, { kind: 'done' }],
  'done not last': [{ kind: 'queued' }, { kind: 'done' }, { kind: 'ci' }],
  'a check without a name': [{ kind: 'queued' }, { kind: 'check' }, { kind: 'done' }],
  'a check name with capitals': [{ kind: 'queued' }, { kind: 'check', name: 'Windows' }, { kind: 'done' }],
  'a check name that is not a string': [{ kind: 'queued' }, { kind: 'check', name: 5 }, { kind: 'done' }],
  'a name on a kind other than check': [{ kind: 'queued' }, { kind: 'ci', name: 'ci' }, { kind: 'done' }],
  'an environment on a kind other than deploy': [{ kind: 'queued' }, { kind: 'ci', environment: 'prod' }, { kind: 'done' }],
  'a blank environment': [{ kind: 'queued' }, { kind: 'deploy', environment: '  ' }, { kind: 'done' }],
  'a blank label': [{ kind: 'queued', label: ' ' }, { kind: 'done' }],
  'a label that is not a string': [{ kind: 'queued', label: 7 }, { kind: 'done' }],
  'stuck_after from 0': [{ kind: 'queued' }, { kind: 'ci', stuck_after: '0h' }, { kind: 'done' }],
  'stuck_after in days': [{ kind: 'queued' }, { kind: 'ci', stuck_after: '2d' }, { kind: 'done' }],
  'a kind twice': [{ kind: 'queued' }, { kind: 'ci' }, { kind: 'ci' }, { kind: 'done' }],
  'a check name twice': [{ kind: 'queued' }, { kind: 'check', name: 'a' }, { kind: 'check', name: 'a' }, { kind: 'done' }],
  'gate-merge with awaiting-merge': [{ kind: 'queued' }, { kind: 'gate-merge' }, { kind: 'awaiting-merge' }, { kind: 'done' }],
}

describe('the Pipeline rules of the Harness and of worfy agree', () => {
  it('have the same catalogue of Stage kinds', () => {
    expect([...STAGE_KINDS]).toEqual(harness.STAGE_KINDS)
  })

  it('have the same default Pipeline', () => {
    expect(DEFAULT_PIPELINE.map((stage) => ({ ...stage }))).toEqual(harness.DEFAULT_PIPELINE)
  })

  it.each(Object.entries(valid))('both accept %s', (_title, pipeline) => {
    expect(harness.pipelineProblem(pipeline)).toBeNull()
    expect(pipelineSchema.safeParse(pipeline).success).toBe(true)
  })

  it.each(Object.entries(invalid))('both refuse %s', (_title, pipeline) => {
    expect(harness.pipelineProblem(pipeline)).not.toBeNull()
    expect(pipelineSchema.safeParse(pipeline).success).toBe(false)
  })

  // The one known difference: the Harness refuses a field it does not know, worfy's schema drops it.
  // The editor writes only what the schema gives back, so an unknown field never reaches the Harness.
  it('an unknown field: the Harness refuses it, worfy drops it before a write', () => {
    const pipeline = [{ kind: 'queued', colour: 'red' }, { kind: 'done' }]
    expect(harness.pipelineProblem(pipeline)).toMatch(/unknown field "colour"/u)
    const parsed = pipelineSchema.safeParse(pipeline)
    expect(parsed.success && parsed.data).toEqual([{ kind: 'queued' }, { kind: 'done' }])
    expect(harness.pipelineProblem(parsed.success ? parsed.data : null)).toBeNull()
  })
})
