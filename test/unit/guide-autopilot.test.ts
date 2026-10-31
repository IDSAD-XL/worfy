// The two diagrams of the Guide's Topic Autopilot (worfy-guide ticket 06): a thing drawn in both has
// the same colour group in both, so the reader sees one Orchestrator, not two.
import { describe, expect, it } from 'vitest'
import en from '../../src/renderer/guide/topics/autopilot/en.json'
import { AUTOPILOT_FLOW, AUTOPILOT_SCENE } from '../../src/renderer/guide/topics/autopilot/spec'
import type { SceneSpec } from '../../src/renderer/guide/scene/model'

/** Each block of `spec` by its English title. */
function byTitle(spec: SceneSpec, labels: Readonly<Record<string, string>>): Map<string, string> {
  return new Map(spec.blocks.map((block) => [labels[block.id] ?? block.id, block.group]))
}

describe('the diagrams of the Topic Autopilot', () => {
  const scene = byTitle(AUTOPILOT_SCENE, en.scene.labels)
  const flow = byTitle(AUTOPILOT_FLOW, en.underTheHood.flow.labels)

  it('give a block of the same title the same group in the scene and in the data flow', () => {
    const shared = [...scene.keys()].filter((title) => flow.has(title))
    expect(shared).toEqual(expect.arrayContaining(['Orchestrator', 'Journal']))
    for (const title of shared) expect(flow.get(title), title).toBe(scene.get(title))
  })

  it('draw the Orchestrator in the group of the Harness and the Orchestrator, and worfy code of a run in one group', () => {
    expect(scene.get('Orchestrator')).toBe('harness')
    const code = ['run', 'cycle', 'launcher'].map((id) => AUTOPILOT_FLOW.blocks.find((block) => block.id === id)?.group)
    expect(code).toEqual(['workflow', 'workflow', 'workflow'])
  })
})
