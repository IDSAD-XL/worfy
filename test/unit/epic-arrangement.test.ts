// The order of the Epic frames and their number of columns (ADR-0075): pure functions every
// screen of a Project computes the same way from the Layout's `epic-arrangement` record. How
// sources/epics.ts writes the record: epic-arrangement-record.test.tsx.
import { describe, expect, it } from 'vitest'
import {
  arrange,
  ASPECT_TOLERANCE,
  columnsFor,
  orderFor,
  readArrangement,
  repack,
  sameDay,
  stripSize,
  TARGET_ASPECT,
  type ArrangedFrame,
} from '../../src/renderer/canvas/epic-arrangement'
import { FRAME_GAP } from '../../src/renderer/canvas/epic-layout'

/** A frame as wide and tall as a usual open Epic: a few columns of Tickets, two rows. */
const usual = (n: number): ArrangedFrame[] => Array.from({ length: n }, () => ({ width: 900, height: 450, reserve: 500 }))

const aspect = (frames: readonly ArrangedFrame[], columns: number): number => {
  const { width, height } = stripSize(frames, columns)
  return width / height
}

describe('columnsFor', () => {
  it('without a previous K: max(1, round(sqrt(S × 1.6) / W)), S the frames\' areas with the open done stack, W the widest frame plus the gap', () => {
    // S = n × 900 × 500, W = 948: sqrt(n × 720000) / 948 = 0.895 × sqrt(n).
    expect(columnsFor(usual(1), null)).toBe(1)
    expect(columnsFor(usual(4), null)).toBe(2)
    expect(columnsFor(usual(11), null)).toBe(3)
    expect(columnsFor(usual(30), null)).toBe(5)
    const formula = (n: number) => Math.max(1, Math.round(Math.sqrt(n * 900 * 500 * TARGET_ASPECT) / (900 + FRAME_GAP)))
    for (const n of [1, 4, 11, 30]) expect(columnsFor(usual(n), null)).toBe(formula(n))
  })

  it('counts a frame with its done stack open (`reserve`), not the folded height', () => {
    const folded = Array.from({ length: 11 }, () => ({ width: 900, height: 200 }))
    const reserved = folded.map((frame) => ({ ...frame, reserve: 900 }))
    expect(columnsFor(folded, null)).toBe(2)
    expect(columnsFor(reserved, null)).toBe(4)
  })

  it('never has more columns than frames, and one for no frames', () => {
    // One very wide and short frame: the formula alone would give 0, a narrow tall pair more than 2.
    expect(columnsFor([{ width: 3000, height: 56 }], null)).toBe(1)
    expect(columnsFor([{ width: 100, height: 5000 }, { width: 100, height: 5000 }], null)).toBe(2)
    expect(columnsFor([], null)).toBe(1)
    expect(columnsFor([], 4)).toBe(1)
  })

  it('keeps the previous K while the strip\'s aspect ratio is within 30 % of 16:10, and computes it again past that', () => {
    // 11 frames 580 tall with the open done stack: 3 and 4 columns are both near 16:10.
    const frames = Array.from({ length: 11 }, () => ({ width: 900, height: 550, reserve: 580 }))
    expect(columnsFor(frames, null)).toBe(3)
    // K = 4 is within the tolerance: kept although the formula says 3; so is K = 3.
    expect(Math.abs(aspect(frames, 4) / TARGET_ASPECT - 1)).toBeLessThanOrEqual(ASPECT_TOLERANCE)
    expect(columnsFor(frames, 4)).toBe(4)
    expect(columnsFor(frames, 3)).toBe(3)
    // K = 2 is not: 2 × 900 + 48 wide, 6 frames tall; K = 5 neither.
    expect(Math.abs(aspect(frames, 2) / TARGET_ASPECT - 1)).toBeGreaterThan(ASPECT_TOLERANCE)
    expect(columnsFor(frames, 2)).toBe(3)
    expect(Math.abs(aspect(frames, 5) / TARGET_ASPECT - 1)).toBeGreaterThan(ASPECT_TOLERANCE)
    expect(columnsFor(frames, 5)).toBe(3)
  })

  it('keeps K while a frame grows a little, and lets it go once the strip is far from 16:10', () => {
    const frames = usual(11)
    expect(columnsFor(frames, 3)).toBe(3)
    // One frame gets two more rows of Tickets: K stays.
    const grown = frames.map((frame, index) => (index === 0 ? { ...frame, height: 650, reserve: 700 } : frame))
    expect(columnsFor(grown, 3)).toBe(3)
    // Every frame twice as tall: the strip is far too tall for 3 columns.
    const tall = frames.map((frame) => ({ ...frame, height: 1400, reserve: 1500 }))
    expect(columnsFor(tall, 3)).toBe(columnsFor(tall, null))
    expect(columnsFor(tall, 3)).not.toBe(3)
  })

  it('the boundary of the hysteresis is the 30 % itself', () => {
    // Two frames side by side (K = 2): width 2 × 100 + 48 = 248; the height decides the aspect ratio.
    const at = (ratio: number): ArrangedFrame[] => {
      const height = 248 / (TARGET_ASPECT * ratio)
      return [{ width: 100, height }, { width: 100, height }]
    }
    expect(columnsFor(at(1 + ASPECT_TOLERANCE - 0.001), 2)).toBe(2)
    expect(columnsFor(at(1 - ASPECT_TOLERANCE + 0.001), 2)).toBe(2)
    expect(columnsFor(at(1 + ASPECT_TOLERANCE + 0.01), 2)).toBe(columnsFor(at(1 + ASPECT_TOLERANCE + 0.01), null))
  })

  it('ignores a previous K that is not a whole number of columns', () => {
    const frames = Array.from({ length: 11 }, () => ({ width: 900, height: 550, reserve: 580 }))
    for (const bad of [0, -2, 2.5, Number.NaN]) expect(columnsFor(frames, bad)).toBe(3)
  })
})

describe('orderFor', () => {
  const epics = ['worfy-week', 'worfy-canvas', 'worfy-link', 'worfy-harness']

  it('without a previous order: the Epics with work first, then the others, each part by name', () => {
    expect(orderFor(epics, new Set(['worfy-link', 'worfy-canvas']), null)).toEqual(['worfy-canvas', 'worfy-link', 'worfy-harness', 'worfy-week'])
    expect(orderFor(epics, new Set(), null)).toEqual(['worfy-canvas', 'worfy-harness', 'worfy-link', 'worfy-week'])
  })

  it('with a previous order: keeps it whatever the activity; a new Epic goes to the end, one that is gone drops out', () => {
    const previous = ['worfy-week', 'worfy-gone', 'worfy-link', 'worfy-canvas']
    expect(orderFor(epics, new Set(['worfy-harness']), previous)).toEqual(['worfy-week', 'worfy-link', 'worfy-canvas', 'worfy-harness'])
    // Several new Epics go to the end by name.
    expect(orderFor([...epics, 'worfy-a', 'worfy-z'], new Set(), previous)).toEqual(['worfy-week', 'worfy-link', 'worfy-canvas', 'worfy-a', 'worfy-harness', 'worfy-z'])
  })

  it('sorts by code unit, not by the locale, and counts each Epic once', () => {
    expect(orderFor(['b', 'B', 'a', 'a'], new Set(), null)).toEqual(['B', 'a', 'b'])
    expect(orderFor(['a', 'b'], new Set(), ['b', 'b', 'a'])).toEqual(['b', 'a'])
  })

  it('gives the same output for the same input and does not change its input (pure)', () => {
    const input = [...epics]
    const activity = new Set(['worfy-link'])
    const previous = ['worfy-link', 'worfy-week']
    const first = orderFor(input, activity, previous)
    expect(orderFor([...input], new Set(activity), [...previous])).toEqual(first)
    expect(input).toEqual(epics)
    expect(previous).toEqual(['worfy-link', 'worfy-week'])
    const frames = usual(11)
    const copy = frames.map((frame) => ({ ...frame }))
    expect(columnsFor(frames, 4)).toBe(columnsFor(copy, 4))
    expect(frames).toEqual(copy)
  })
})

describe('arrange and repack', () => {
  const frames = new Map(['d', 'c', 'b', 'a'].map((epic) => [epic, { width: 900, height: 450, reserve: 500 }]))

  it('without a record: by name and K afresh — what every screen draws before the first write', () => {
    expect(arrange(['d', 'c', 'b', 'a'], frames, null)).toEqual({ order: ['a', 'b', 'c', 'd'], columns: 2 })
  })

  it('with a record: its order, new Epics at the end, and its K while it holds', () => {
    const record = { order: ['c', 'a'], columns: 3, at: '2026-10-19T08:00:00.000Z' }
    expect(arrange(['d', 'c', 'b', 'a'], frames, record).order).toEqual(['c', 'a', 'b', 'd'])
    // 3 columns for 4 frames make the strip far wider than 16:10: K is computed again.
    expect(arrange(['d', 'c', 'b', 'a'], frames, record).columns).toBe(2)
    expect(arrange(['d', 'c', 'b', 'a'], frames, { ...record, columns: 2 }).columns).toBe(2)
  })

  it('repack puts the Epics with work first and computes K without the hysteresis', () => {
    expect(repack(['d', 'c', 'b', 'a'], frames, new Set(['d']))).toEqual({ order: ['d', 'a', 'b', 'c'], columns: 2 })
  })
})

describe('the record', () => {
  it('reads a whole record, and nothing else', () => {
    const data = { order: ['a', 'b'], columns: 2, at: '2026-10-19T08:00:00.000Z' }
    expect(readArrangement({ data })).toEqual(data)
    expect(readArrangement(undefined)).toBeNull()
    // The first "Re-pack" undone leaves its keys null.
    expect(readArrangement({ data: { order: null, columns: null, at: null } })).toBeNull()
    expect(readArrangement({ data: { ...data, order: ['a', 1] } })).toBeNull()
    expect(readArrangement({ data: { ...data, columns: 0 } })).toBeNull()
    expect(readArrangement({ data: { ...data, columns: 1.5 } })).toBeNull()
    expect(readArrangement({ data: { ...data, at: 5 } })).toBeNull()
  })

  it('tells the same calendar day by the screen\'s clock', () => {
    const now = new Date(2026, 9, 19, 23, 30)
    expect(sameDay(new Date(2026, 9, 19, 0, 5).toISOString(), now)).toBe(true)
    expect(sameDay(new Date(2026, 9, 18, 23, 59).toISOString(), now)).toBe(false)
    expect(sameDay(new Date(2025, 9, 19, 12).toISOString(), now)).toBe(false)
    expect(sameDay('not a time', now)).toBe(false)
  })
})

describe('stripSize', () => {
  it('is K columns as wide as the widest frame with the gaps, as tall as the tallest column of reserved heights', () => {
    const frames = [
      { width: 500, height: 100 },
      { width: 700, height: 300 },
      { width: 600, height: 100, reserve: 400 },
    ]
    // Column 0: frames 0 and 2; column 1: frame 1.
    expect(stripSize(frames, 2)).toEqual({ width: 2 * 700 + FRAME_GAP, height: 100 + FRAME_GAP + 400 })
    expect(stripSize(frames, 1)).toEqual({ width: 700, height: 100 + FRAME_GAP + 300 + FRAME_GAP + 400 })
    // More columns than frames: one per frame.
    expect(stripSize(frames, 9)).toEqual(stripSize(frames, 3))
  })
})
