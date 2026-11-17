// The two diagrams of the Guide's Topic Autopilot (worfy-guide ticket 06): a thing drawn in both has
// the same colour group in both, so the reader sees one Orchestrator, not two.
import { describe, expect, it } from 'vitest'
import en from '../../src/renderer/guide/topics/autopilot/en.json'
import ru from '../../src/renderer/guide/topics/autopilot/ru.json'
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

// worfy-stuck-agents ticket 10: a Ticket still in work no longer stops the run at once. The limit of
// the Under the hood section names the ladder (two continuations, a set-aside), main-red and turn-hung
// in both languages, and background-stalled stays a stop.
describe('the limit of a stuck run in the Topic Autopilot', () => {
  const line = (limits: readonly string[]): string => limits.find((limit) => limit.includes('wave-unfinished')) ?? ''

  it.each([
    ['en', en.underTheHood.limits, /continu/, /aside/],
    ['ru', ru.underTheHood.limits, /продолж/, /отлож/],
  ])('%s names the ladder, main-red, turn-hung and background-stalled', (_language, limits, continuation, setAside) => {
    const text = line(limits)
    expect(text).toMatch(continuation)
    expect(text).toMatch(setAside)
    for (const reason of ['wave-unfinished', 'main-red', 'turn-hung', 'background-stalled']) expect(text).toContain(reason)
  })
})
