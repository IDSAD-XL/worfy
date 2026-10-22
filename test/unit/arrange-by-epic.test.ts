import { describe, expect, it } from 'vitest'
import { ARRANGE_GAP, arrangeByEpic, CLUSTER_GAP, type ArrangeInput } from '../../src/renderer/canvas/arrange-by-epic'
import { FRAME_GAP } from '../../src/renderer/canvas/epic-layout'
import type { SpotInputs } from '../../src/renderer/canvas/session-spot'
import { crowds, type Rect } from '../../src/shared/layout/free-place'
import type { LayoutNode, LayoutOpInput } from '../../src/shared/layout/types'

// "Arrange by Epic" (worfy-canvas ticket 12): the Sessions stand in a column right of the strip of
// Epic frames, each Epic's Sessions (bound to it or to its Tickets) at the height of its frame,
// the Sessions without a Binding under them; pinned and kept Nodes and the other kinds stay.

const base = { hidden: false, locked: false, pinned: false, tags: [] as string[] }
const session = (id: string, x: number, y: number, over: Partial<LayoutNode> = {}): LayoutNode => ({ id, kind: 'session', x, y, w: 300, h: 120, ...base, data: { sessionId: id }, ...over })
const other = (id: string, kind: string, x: number, y: number, w = 300, h = 200): LayoutNode => ({ id, kind, x, y, w, h, ...base, data: {} })

/** Two frames in a strip 800 wide and 1200 tall from the left edge of the plane: alpha at the top, beta under it. */
const drawn = (over: Partial<SpotInputs> = {}): SpotInputs => ({
  frames: [
    { epic: 'alpha', y: 0, tickets: new Map([[7, 140]]) },
    { epic: 'beta', y: 600, tickets: new Map() },
  ],
  strip: { x: 0, right: 800, top: 0, bottom: 1200 },
  moved: [],
  ...over,
})
const COLUMN = 800 + FRAME_GAP

type Moves = Extract<LayoutOpInput, { op: 'moveMany' }>['moves']

function movesOf(input: ArrangeInput): Moves {
  const op = arrangeByEpic(input)
  if (op === undefined) return []
  if (op.op !== 'moveMany') throw new Error(`expected moveMany, got ${op.op}`)
  return op.moves
}

const placesOf = (moves: Moves): Record<string, [number, number]> => Object.fromEntries(moves.map((move) => [move.id, [move.x, move.y]]))

/** The Nodes with the moves applied, as main applies a `moveMany` that lands on nothing. */
function applied(nodes: readonly LayoutNode[], moves: Moves): LayoutNode[] {
  const at = new Map(moves.map((move) => [move.id, move]))
  return nodes.map((node) => (at.has(node.id) ? { ...node, x: at.get(node.id)!.x, y: at.get(node.id)!.y } : node))
}

const rectOf = (node: LayoutNode): Rect => ({ x: node.x, y: node.y, w: node.w, h: node.h })

describe('Arrange by Epic', () => {
  // s3 reads before s1 (it is higher), so alpha's Sessions stand s3, s1.
  const nodes = [
    session('s1', 100, 2000),
    session('s2', 1500, 1500),
    session('s3', 500, 1800),
    session('s4', -900, 300),
    other('card', 'card', 3000, 3000),
  ]
  const epics = new Map([
    ['s1', 'alpha'],
    ['s2', 'beta'],
    ['s3', 'alpha'],
  ])

  it('puts each Epic’s Sessions in a column right of the strip, at the height of its frame, one under another', () => {
    const places = placesOf(movesOf({ nodes, epics, drawn: drawn() }))
    expect(places['s3']).toEqual([COLUMN, 0])
    expect(places['s1']).toEqual([COLUMN, 120 + ARRANGE_GAP])
    expect(places['s2']).toEqual([COLUMN, 600])
  })

  it('puts the Sessions without a Binding in a cluster of their own under the others', () => {
    const places = placesOf(movesOf({ nodes, epics, drawn: drawn() }))
    expect(places['s4']).toEqual([COLUMN, 600 + 120 + CLUSTER_GAP])
  })

  it('counts a Session bound to an Epic without a frame in the strip (on the done shelf) as unbound', () => {
    const places = placesOf(movesOf({ nodes, epics: new Map([...epics, ['s4', 'gamma']]), drawn: drawn() }))
    expect(places['s4']).toEqual([COLUMN, 600 + 120 + CLUSTER_GAP])
  })

  it('leaves pinned and kept Sessions where they are, and every Node that is not a Session', () => {
    const kept = session('kept', -900, 900, { keep: true })
    const pinned = session('pinned', 10, 10, { pinned: true })
    const hidden = session('hidden', 40, 40, { hidden: true })
    const archived = session('archived', 70, 70, { archived: { at: 1, rule: 'idle', batch: 'b1' } })
    const kinds = ['card', 'note', 'terminal', 'handoff', 'orchestrator'].map((kind, index) => other(kind, kind, 3000 + index * 400, 3000))
    const all = [...nodes.filter((node) => node.kind === 'session'), kept, pinned, hidden, archived, ...kinds]
    const moves = movesOf({ nodes: all, epics: new Map([...epics, ['kept', 'alpha'], ['pinned', 'alpha']]), drawn: drawn() })
    expect(moves.map((move) => move.id).sort()).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('a second Arrange by Epic on its result moves nothing', () => {
    const tree = new Map([['s2', { x: 310, y: 0, w: 400, h: 300 }]])
    const first = movesOf({ nodes, epics, drawn: drawn(), trees: tree })
    expect(first.length).toBeGreaterThan(0)
    expect(arrangeByEpic({ nodes: applied(nodes, first), epics, drawn: drawn(), trees: tree })).toBeUndefined()
  })

  it('moves only the Sessions off their place; nothing when every one stands in it', () => {
    const half = applied(nodes, movesOf({ nodes, epics, drawn: drawn() }).filter((move) => move.id !== 's4'))
    expect(movesOf({ nodes: half, epics, drawn: drawn() }).map((move) => move.id)).toEqual(['s4'])
  })

  it('pushes a cluster down when the one above reaches past its frame, so clusters never overlap', () => {
    const many = [...Array.from({ length: 6 }, (_, index) => session(`a${index}`, -2000, index * 200)), session('b', -2000, 5000), session('u', -2000, 6000)]
    const bound = new Map<string, string>([...many.slice(0, 6).map((node) => [node.id, 'alpha'] as [string, string]), ['b', 'beta']])
    const after = applied(many, movesOf({ nodes: many, epics: bound, drawn: drawn() }))
    const alphaBottom = Math.max(...after.filter((node) => node.id.startsWith('a')).map((node) => node.y + node.h))
    expect(alphaBottom).toBeGreaterThan(600)
    expect(after.find((node) => node.id === 'b')!.y).toBe(alphaBottom + CLUSTER_GAP)
    expect(after.find((node) => node.id === 'u')!.y).toBe(alphaBottom + CLUSTER_GAP + 120 + CLUSTER_GAP)
    for (const a of after) for (const b of after) if (a.id < b.id) expect(crowds(rectOf(a), rectOf(b)), `${a.id} and ${b.id}`).toBe(false)
  })

  it('keeps each Session’s Subagent tree in its rectangle: the next Session stands under the tree', () => {
    const trees = new Map([['s3', { x: 310, y: -20, w: 400, h: 500 }]])
    const places = placesOf(movesOf({ nodes, epics, drawn: drawn(), trees }))
    // The tree reaches 20 above its Session: the rectangle's top goes to the frame's height.
    expect(places['s3']).toEqual([COLUMN, 20])
    expect(places['s1']).toEqual([COLUMN, 500 + ARRANGE_GAP])
  })

  it('keeps clear of a Node that stays in the column: the Session goes under it', () => {
    const block = other('note', 'note', COLUMN + 100, 200, 220, 120)
    const kept = session('kept', COLUMN, 300, { keep: true })
    const all = [...nodes, block, kept]
    const after = applied(all, movesOf({ nodes: all, epics, drawn: drawn() }))
    expect(after.find((node) => node.id === 's3')!.y).toBe(0)
    // s1 would stand at 144: the note (200..320) and the kept Session (300..420) are in the way.
    expect(after.find((node) => node.id === 's1')!.y).toBe(420 + 16)
    for (const a of after.filter((node) => ['s1', 's2', 's3', 's4'].includes(node.id)))
      for (const b of [block, kept]) expect(crowds(rectOf(a), rectOf(b)), `${a.id} and ${b.id}`).toBe(false)
  })

  it('keeps clear of a frame the user moved off the strip', () => {
    const frame = { x: COLUMN, y: 0, w: 500, h: 400 }
    const places = placesOf(movesOf({ nodes, epics, drawn: drawn({ moved: [frame] }) }))
    expect(places['s3']).toEqual([COLUMN, 400 + 16])
  })

  it('stands right of where the strip goes once the Sessions left its band, not right of where it stands now', () => {
    // The strip stands at 400 because s0 is in its band; once s0 joins the column, nothing keeps it from x = 0.
    const crowded = [session('s0', 0, 100), ...nodes]
    const places = placesOf(movesOf({ nodes: crowded, epics: new Map([...epics, ['s0', 'alpha']]), drawn: drawn({ strip: { x: 400, right: 1200, top: 0, bottom: 1200 } }) }))
    expect(places['s0']![0]).toBe(COLUMN)
    // A Node that stays in the band keeps the strip where it is.
    const stays = [other('card-in-band', 'card', 0, 100), ...nodes]
    expect(placesOf(movesOf({ nodes: stays, epics, drawn: drawn({ strip: { x: 348, right: 1148, top: 0, bottom: 1200 } }) }))['s3']).toEqual([1148 + FRAME_GAP, 0])
  })

  it('keeps clear of the Subagent tree of a Session that stays (Keep): the tree is in the column', () => {
    // The kept Session is far left; its tree hangs out into the column, 0..300 high.
    const kept = session('kept', -700, 0, { keep: true })
    const trees = new Map([['kept', { x: COLUMN + 700, y: 0, w: 400, h: 300 }]])
    const places = placesOf(movesOf({ nodes: [...nodes, kept], epics, drawn: drawn(), trees }))
    expect(places['kept']).toBeUndefined()
    expect(places['s3']).toEqual([COLUMN, 300 + 16])
  })

  it('counts the tree of a Session that stays where the Canvas draws it, not where it would hang (as placeStrip does)', () => {
    const kept = session('kept', -700, 0, { keep: true })
    // Where the tree would hang is in the column; something was in its way, so it is drawn far below.
    const trees = new Map([['kept', { x: COLUMN + 700, y: 0, w: 400, h: 300 }]])
    const drawnTrees = new Map([['kept', [{ x: COLUMN, y: 5000, w: 400, h: 300 }]]])
    const places = placesOf(movesOf({ nodes: [...nodes, kept], epics, drawn: drawn(), trees, drawnTrees }))
    expect(places['s3']).toEqual([COLUMN, 0])
    // A moving Session's tree goes with it as it hangs: its drawn place does not count.
    const moving = placesOf(movesOf({ nodes, epics, drawn: drawn(), drawnTrees: new Map([['s1', [{ x: COLUMN, y: 0, w: 400, h: 300 }]]]) }))
    expect(moving['s3']).toEqual([COLUMN, 0])
  })

  it('starts the "Unbound" cluster at the top of the strip when no Session is bound', () => {
    const places = placesOf(movesOf({ nodes, epics: new Map(), drawn: drawn({ strip: { x: 0, right: 800, top: 40, bottom: 1200 } }) }))
    // Reading order: s4 (y 300), s2 (1500), s3 (1800), s1 (2000).
    expect(places['s4']).toEqual([COLUMN, 40])
    expect(places['s2']).toEqual([COLUMN, 40 + 120 + ARRANGE_GAP])
  })

  it('moves a frame the user moved along with the strip when the strip comes back left', () => {
    // The strip stands at 400 because s0 is in its band; it comes back to 0, and the moved frame with it.
    const crowded = [session('s0', 0, 100), ...nodes]
    const frame = { x: 400 + COLUMN, y: 0, w: 500, h: 400 }
    const places = placesOf(movesOf({ nodes: crowded, epics: new Map([...epics, ['s0', 'alpha']]), drawn: drawn({ strip: { x: 400, right: 1200, top: 0, bottom: 1200 }, moved: [frame] }) }))
    expect(places['s0']).toEqual([COLUMN, 400 + 16])
  })

  it('orders two clusters whose frames stand at the same height by the strip’s order, not by their Sessions', () => {
    const side = drawn({
      frames: [
        { epic: 'alpha', y: 0, tickets: new Map() },
        { epic: 'beta', y: 0, tickets: new Map() },
      ],
    })
    // beta's Session reads first (it is higher); alpha's frame comes first in the strip.
    const two = [session('a', -2000, 900), session('b', -2000, 100)]
    const places = placesOf(movesOf({ nodes: two, epics: new Map([['a', 'alpha'], ['b', 'beta']]), drawn: side }))
    expect(places['a']).toEqual([COLUMN, 0])
    expect(places['b']).toEqual([COLUMN, 120 + CLUSTER_GAP])
  })

  it('moves nothing without a strip of Epic frames', () => {
    expect(arrangeByEpic({ nodes, epics, drawn: { frames: [], strip: undefined, moved: [] } })).toBeUndefined()
  })
})
