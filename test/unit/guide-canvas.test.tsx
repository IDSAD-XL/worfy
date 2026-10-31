// The diagram of the Topic Canvas (src/renderer/guide/topics/canvas/spec.ts, worfy-guide ticket 07)
// against the Epic frame it draws: the "Ready wave · N" chip stands over the Level 1 column, the only
// one that has it (src/renderer/canvas/nodes/EpicFrameNode.tsx, docs/features/epic-frames.md:26),
// and no Edge leads to the Done shelf: an Epic goes there as a whole, all its Tickets done and its
// frame folded (epic-frames.md:106), never from one of its Tickets.
import { describe, expect, it } from 'vitest'
import { boxOf } from '../../src/renderer/guide/scene/model'
import { CANVAS_SPEC } from '../../src/renderer/guide/topics/canvas/spec'

const block = (id: string) => {
  const found = CANVAS_SPEC.blocks.find((each) => each.id === id)
  if (found === undefined) throw new Error(`no block ${id}`)
  return boxOf(found)
}

describe('the diagram of the Topic Canvas', () => {
  it('puts the Ready wave chip over the Level 1 column, Ticket 01, left of Level 2', () => {
    const wave = block('wave')
    const level1 = block('ticket1')
    const level2 = block('ticket2')
    expect(level2.x).toBeGreaterThan(level1.x + level1.width)
    expect(wave.x).toBeGreaterThanOrEqual(level1.x)
    expect(wave.x + wave.width).toBeLessThanOrEqual(level1.x + level1.width)
    expect(wave.y + wave.height).toBeLessThanOrEqual(level1.y)
  })

  it('draws no Edge into or out of the Done shelf', () => {
    expect(CANVAS_SPEC.edges.filter((edge) => edge.from === 'shelf' || edge.to === 'shelf')).toEqual([])
  })
})
