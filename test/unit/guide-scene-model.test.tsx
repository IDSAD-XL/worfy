// The logic of the worfy Guide's live diagrams (src/renderer/guide/scene/model.ts, worfy-guide ticket
// 04, ADR-0090 point 9): where an Edge runs and where its arrow points, what a block or a step lights,
// where the moving dots stand at a moment and under Reduce motion, what the step player does, and how a
// long note of a block breaks into two lines. Pure functions, no DOM.
import { describe, expect, it } from 'vitest'
import {
  DOT_SPEED,
  NODE_HEIGHT,
  NODE_WIDTH,
  dotFraction,
  edgeId,
  edgeShape,
  litParts,
  noteLines,
  playerReducer,
  type Player,
  type SceneBlock,
  type SceneSpec,
} from '../../src/renderer/guide/scene/model'

const block = (id: string, x: number, y: number): SceneBlock => ({ id, x, y, group: 'workflow' })

/** The numbers of an `M x y C x y, x y, x y` path. */
function numbers(d: string): number[] {
  return [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
}

describe('edgeShape: a cubic curve from the middle of a side to the middle of a side', () => {
  it('runs right to left between blocks side by side, the arrow pointing right', () => {
    const shape = edgeShape(block('a', 0, 0), block('b', 400, 100))
    const [sx, sy, c1x, c1y, c2x, c2y, ex, ey] = numbers(shape.d)
    expect([sx, sy]).toEqual([NODE_WIDTH, NODE_HEIGHT / 2])
    expect(shape.tip).toEqual({ x: 400, y: 100 + NODE_HEIGHT / 2 })
    expect(shape.angle).toBe(0)
    // The arm is the larger of 26 and 0.42 of the distance between the ends.
    const arm = 0.42 * Math.hypot(400 - NODE_WIDTH, 100)
    expect(c1x).toBeCloseTo(NODE_WIDTH + arm, 0)
    expect(c1y).toBe(NODE_HEIGHT / 2)
    expect(c2y).toBe(ey)
    // The line stops short of the tip, under the arrowhead, so its square end does not show past it.
    expect(ey).toBe(shape.tip.y)
    expect(ex).toBeLessThan(shape.tip.x)
    expect(ex).toBeGreaterThan(shape.tip.x - 7)
    expect(c2x).toBeLessThan(ex!)
    // The label stands at the middle of the curve.
    expect(shape.middle.x).toBeCloseTo((sx! + 3 * c1x! + 3 * c2x! + ex!) / 8, 0)
    expect(shape.middle.y).toBeCloseTo((sy! + 3 * c1y! + 3 * c2y! + ey!) / 8, 0)
  })

  it('runs the other way when the target is on the left', () => {
    const shape = edgeShape(block('a', 400, 0), block('b', 0, 0))
    expect(numbers(shape.d).slice(0, 2)).toEqual([400, NODE_HEIGHT / 2])
    expect(shape.tip).toEqual({ x: NODE_WIDTH, y: NODE_HEIGHT / 2 })
    expect(shape.angle).toBe(180)
  })

  it('runs bottom to top between blocks one above the other, with the shortest arm of 26', () => {
    const shape = edgeShape(block('a', 0, 0), block('b', 10, 100))
    const [sx, sy, , c1y] = numbers(shape.d)
    expect([sx, sy]).toEqual([NODE_WIDTH / 2, NODE_HEIGHT])
    expect(c1y).toBe(NODE_HEIGHT + 26)
    expect(shape.tip).toEqual({ x: 10 + NODE_WIDTH / 2, y: 100 })
    expect(shape.angle).toBe(90)
    expect(edgeShape(block('a', 0, 100), block('b', 0, 0)).angle).toBe(-90)
  })
})

const SPEC: SceneSpec = {
  width: 800,
  height: 300,
  blocks: [block('menu', 0, 0), block('palette', 0, 200), block('guide', 300, 100), block('topics', 600, 100)],
  edges: [
    { from: 'menu', to: 'guide', label: 'opens' },
    { from: 'palette', to: 'guide' },
    { from: 'guide', to: 'topics' },
  ],
  steps: [
    { caption: 'step1', blocks: ['menu', 'guide'] },
    { caption: 'step2', blocks: ['palette', 'guide', 'topics'], edges: ['palette->guide'] },
  ],
}

describe('litParts: what is highlighted', () => {
  it('lights nothing when no block has the pointer or the focus and no step is chosen', () => {
    const lit = litParts(SPEC, null, null)
    expect(lit.focusing).toBe(false)
    expect([...lit.hot, ...lit.near, ...lit.edges]).toEqual([])
  })

  it('a block lights itself, its neighbours along its Edges and those Edges, and nothing else', () => {
    const lit = litParts(SPEC, 'guide', null)
    expect(lit.focusing).toBe(true)
    expect([...lit.hot]).toEqual(['guide'])
    expect([...lit.near].sort()).toEqual(['menu', 'palette', 'topics'])
    expect([...lit.edges].sort()).toEqual(['guide->topics', 'menu->guide', 'palette->guide'])

    const end = litParts(SPEC, 'topics', null)
    expect([...end.near]).toEqual(['guide'])
    expect([...end.edges]).toEqual(['guide->topics'])
  })

  it('a step lights its blocks and the Edges between them, or the Edges it names', () => {
    const first = litParts(SPEC, null, 0)
    expect([...first.hot].sort()).toEqual(['guide', 'menu'])
    expect([...first.near]).toEqual([])
    expect([...first.edges]).toEqual(['menu->guide'])

    const second = litParts(SPEC, null, 1)
    expect([...second.edges]).toEqual(['palette->guide'])
  })

  it('the block under the pointer wins over the chosen step', () => {
    expect([...litParts(SPEC, 'topics', 0).hot]).toEqual(['topics'])
  })

  it('an unknown block or a step out of range lights nothing', () => {
    expect(litParts(SPEC, 'nowhere', null).focusing).toBe(false)
    expect(litParts(SPEC, null, 5).focusing).toBe(false)
  })

  it('names an Edge by its two ends', () => {
    expect(edgeId({ from: 'a', to: 'b' })).toBe('a->b')
  })
})

describe('dotFraction: where a moving dot stands on its Edge', () => {
  it('moves at 55 units of the viewBox a second, the dots of one Edge spread evenly, round and round', () => {
    expect(DOT_SPEED).toBe(55)
    expect(dotFraction(0, 2, 0, 110, false)).toBe(0)
    expect(dotFraction(1, 2, 0, 110, false)).toBe(0.5)
    expect(dotFraction(0, 2, 1, 110, false)).toBeCloseTo(0.5, 10)
    expect(dotFraction(1, 2, 1, 110, false)).toBeCloseTo(0, 10)
    expect(dotFraction(0, 2, 1.5, 110, false)).toBeCloseTo(0.75, 10)
  })

  it('stands still at (i + 0.5) / n under Reduce motion, whatever the time', () => {
    expect(dotFraction(0, 2, 7.3, 110, true)).toBe(0.25)
    expect(dotFraction(1, 2, 7.3, 110, true)).toBe(0.75)
  })

  it('does not divide by a zero length', () => {
    expect(dotFraction(0, 2, 3, 0, false)).toBe(0.25)
  })
})

describe('playerReducer: the step player', () => {
  const play = playerReducer(3)
  const idle: Player = { step: null, playing: false }

  it('Play starts at the first step, a tick moves on, and the last step stops it', () => {
    let state = play(idle, { type: 'toggle' })
    expect(state).toEqual({ step: 0, playing: true })
    state = play(state, { type: 'tick' })
    expect(state).toEqual({ step: 1, playing: true })
    state = play(state, { type: 'tick' })
    expect(state).toEqual({ step: 2, playing: true })
    state = play(state, { type: 'tick' })
    expect(state).toEqual({ step: 2, playing: false })
  })

  it('Pause keeps the step; Play again goes on from it, and from the first step after the last', () => {
    const paused = play({ step: 1, playing: true }, { type: 'toggle' })
    expect(paused).toEqual({ step: 1, playing: false })
    expect(play(paused, { type: 'toggle' })).toEqual({ step: 1, playing: true })
    expect(play({ step: 2, playing: false }, { type: 'toggle' })).toEqual({ step: 0, playing: true })
  })

  it('a tick while paused changes nothing', () => {
    expect(play({ step: 1, playing: false }, { type: 'tick' })).toEqual({ step: 1, playing: false })
  })

  it('choosing a step stops the play; choosing the step on screen again shows the whole diagram', () => {
    expect(play({ step: 0, playing: true }, { type: 'choose', step: 2 })).toEqual({ step: 2, playing: false })
    expect(play({ step: 2, playing: false }, { type: 'choose', step: 2 })).toEqual({ step: null, playing: false })
  })
})

describe('noteLines: the note under a block header', () => {
  it('keeps a note that fits on one line', () => {
    expect(noteLines('worfy Guide', NODE_WIDTH)).toEqual(['worfy Guide'])
  })

  it('breaks a long note at the space nearest its middle', () => {
    expect(noteLines('texts in EN and RU, and a diagram', NODE_WIDTH)).toEqual(['texts in EN and', 'RU, and a diagram'])
  })

  it('leaves a long note without a space on one line', () => {
    expect(noteLines('src/renderer/guide/topics/skeleton', NODE_WIDTH)).toEqual(['src/renderer/guide/topics/skeleton'])
  })
})
