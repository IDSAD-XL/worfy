// worfy-product-session ticket 33: in the Tree of the Mind map (src/renderer/product/mind-map-layout.ts) the
// accepted Decision sits right under the rejected one it replaces, and the `replaces` arrow between them was an
// 11 px stub, only its arrowhead visible. The arrow now runs round the side of the column.
import ELK from 'elkjs/lib/elk.bundled.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildMindMapGraph, layoutElk, setTextMeasure, treeReplacesPath } from '../../src/renderer/product/mind-map-layout'
import { fontLike, inside, middle, pathLength, pathPoints, topic } from './mind-map-long-map'

beforeEach(() => setTextMeasure(fontLike))
afterEach(() => setTextMeasure(null))

describe('the Tree’s `replaces` arrow (ticket 33)', () => {
  it('runs a visible dashed length round the side of two Decisions one under the other, not an 11 px stub', async () => {
    // ELK's Tree, as the window lays it out (without its worker, as the Canvas's tests run it).
    const placement = await layoutElk(buildMindMapGraph(topic(), { hideRejected: false }), new ELK())
    const [later, overturned] = [placement.get('split')!, placement.get('harness-first')!]
    // The layout puts them in one column, one right under the other: the case the acceptance saw.
    expect(later.x < overturned.x + overturned.width && overturned.x < later.x + later.width).toBe(true)
    expect(Math.abs(middle(later).y - middle(overturned).y)).toBeLessThan((later.height + overturned.height) / 2 + 20)
    const d = treeReplacesPath(later, overturned)
    // Long enough for its dashes (5 px dash, 4 px gap) to read as a line, not only an arrowhead.
    expect(pathLength(d)).toBeGreaterThan(60)
    // It leaves the later Decision, never crosses either box, and ends at the overturned one.
    const points = pathPoints(d)
    expect(points.filter((point) => inside(point, later) || inside(point, overturned))).toEqual([])
    const [start, end] = [points[0]!, points.at(-1)!]
    expect(Math.abs(start.x - (later.x + later.width))).toBeLessThanOrEqual(2)
    expect(start.y).toBeGreaterThan(later.y)
    expect(start.y).toBeLessThan(later.y + later.height)
    expect(end.x - (overturned.x + overturned.width)).toBeGreaterThanOrEqual(0)
    expect(end.x - (overturned.x + overturned.width)).toBeLessThanOrEqual(8)
    expect(end.y).toBeGreaterThan(overturned.y)
    expect(end.y).toBeLessThan(overturned.y + overturned.height)
    // The arrowhead points into the overturned Decision: the path's last step runs left.
    expect(end.x).toBeLessThan(points.at(-2)!.x)
  })

  it('works whichever of the two is on top, and bows further out the further apart they are', () => {
    const upper = { x: 0, y: 0, width: 220, height: 80 }
    const lower = { x: 0, y: 92, width: 220, height: 80 }
    const far = { x: 0, y: 400, width: 220, height: 80 }
    for (const [from, to] of [[lower, upper], [upper, lower], [far, upper]] as const) {
      const points = pathPoints(treeReplacesPath(from, to))
      expect(points.filter((point) => inside(point, from) || inside(point, to))).toEqual([])
      expect(pathLength(treeReplacesPath(from, to))).toBeGreaterThan(60)
    }
    const reach = (d: string) => Math.max(...pathPoints(d).map((point) => point.x))
    expect(reach(treeReplacesPath(far, upper))).toBeGreaterThan(reach(treeReplacesPath(lower, upper)))
  })

  it('keeps the prototype’s red curve between two Decisions in different columns', () => {
    const d = treeReplacesPath({ x: 300, y: 200, width: 220, height: 80 }, { x: 0, y: 0, width: 220, height: 80 })
    expect(d).toMatch(/^M[-\d.]+,[-\d.]+ Q[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+$/)
  })
})
