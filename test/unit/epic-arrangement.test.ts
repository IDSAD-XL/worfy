// The order of the Epic frames and their number of columns (ADR-0075): pure functions every
// screen of a Project computes the same way from the Layout's `epic-arrangement` record. How
// sources/epics.ts writes the record: epic-arrangement-record.test.tsx.
import { describe, expect, it } from 'vitest'
import {
  arrange,
  ASPECT_TOLERANCE,
  columnsFor,
  offAspect,
  orderFor,
  readArrangement,
  repack,
  sameDay,
  stripSize,
  SWITCH_MARGIN,
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

  it('W counts the gap between columns: narrow frames, where the gap is half a frame, get fewer columns than without it (review of PR #539)', () => {
    // S = 10 × 100 × 400, sqrt(S × 1.6) = 800: 800 / (100 + 48) = 5.4 gives 5; without the gap 800 / 100 would give 8.
    const narrow = Array.from({ length: 10 }, () => ({ width: 100, height: 400 }))
    expect(FRAME_GAP).toBe(48)
    expect(columnsFor(narrow, null)).toBe(5)
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
    // 11 frames 900 wide in 4 columns: 4 × 900 + 3 × 48 = 3744 wide, three frames and two gaps tall;
    // the frames' height sets the aspect ratio of that strip. Above 30 % the K afresh, 3, is within it.
    const at = (ratio: number): ArrangedFrame[] => {
      const height = (3744 / (TARGET_ASPECT * ratio) - 2 * FRAME_GAP) / 3
      return Array.from({ length: 11 }, () => ({ width: 900, height }))
    }
    for (const ratio of [1.299, 1.31]) expect(columnsFor(at(ratio), null)).toBe(3)
    expect(columnsFor(at(1 + ASPECT_TOLERANCE - 0.001), 4)).toBe(4)
    expect(columnsFor(at(1 - ASPECT_TOLERANCE + 0.001), 4)).toBe(4)
    expect(columnsFor(at(1 + ASPECT_TOLERANCE + 0.01), 4)).toBe(3)
  })

  it('the tolerance is 30 % of 16:10, and a K outside it gives way only to one 1.3 times closer', () => {
    expect(TARGET_ASPECT).toBe(1.6)
    expect(ASPECT_TOLERANCE).toBe(0.3)
    expect(SWITCH_MARGIN).toBe(1.3)
  })

  describe('frames of very different widths, where no K the formula gives is within 30 %', () => {
    // Ten frames 700 wide and one 2400 wide: every column is 2400 wide, so the formula's K = 1
    // makes a strip five times too tall, and K = 2 a strip still twice too tall.
    const frames = (grow: number): ArrangedFrame[] =>
      [700, 700, 700, 700, 700, 700, 700, 700, 700, 700, 2400].map((width, index) => ({ width, height: 400 + index * 60 + (index === 0 ? grow : 0) }))
    const small = frames(47 * 40)
    const grown = frames(48 * 40)

    it('the formula alone flips between 1 and 2 columns as one frame grows by 40 and shrinks back', () => {
      expect(columnsFor(small, null)).toBe(1)
      expect(columnsFor(grown, null)).toBe(2)
      expect(offAspect(small, 1)).toBeGreaterThan(1 + ASPECT_TOLERANCE)
      expect(offAspect(grown, 2)).toBeGreaterThan(1 + ASPECT_TOLERANCE)
    })

    it('a kept K does not flip as the frame grows and shrinks back', () => {
      let k = 2
      for (const step of [small, grown, small, grown, small]) {
        k = columnsFor(step, k)
        expect(k).toBe(2)
      }
    })

    it('K = 1 gives way once to the clearly closer K = 2 and does not come back', () => {
      expect(columnsFor(small, 1)).toBe(1)
      const seen = [grown, small, grown, small].map((step) => columnsFor(step, 1))
      expect(seen).toEqual([2, 1, 2, 1])
      let k = 1
      const kept = [grown, small, grown, small].map((step) => (k = columnsFor(step, k)))
      expect(kept).toEqual([2, 2, 2, 2])
    })

    it('the fresh K replaces a K outside 30 % only past the margin: 1.37 times closer does, 1.12 times does not', () => {
      const close = frames(60 * 40)
      expect(columnsFor(close, null)).toBe(2)
      expect(offAspect(close, 6) / offAspect(close, 2)).toBeCloseTo(1.12, 2)
      expect(columnsFor(close, 6)).toBe(6)
      const far = frames(49 * 40)
      expect(columnsFor(far, null)).toBe(2)
      expect(offAspect(far, 6) / offAspect(far, 2)).toBeCloseTo(1.37, 2)
      expect(columnsFor(far, 6)).toBe(2)
    })
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

  it('passes the record\'s K to the hysteresis: 4 columns are kept for 11 frames where afresh it is 3', () => {
    const eleven = 'abcdefghijk'.split('')
    const even = new Map(eleven.map((epic) => [epic, { width: 900, height: 550, reserve: 580 }]))
    expect(arrange(eleven, even, null).columns).toBe(3)
    expect(arrange(eleven, even, { order: eleven, columns: 4, at: '2026-10-19T08:00:00.000Z' }).columns).toBe(4)
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
    // A week before (the same day of the week) and a month before (the same day of the month).
    expect(sameDay(new Date(2026, 9, 12, 12).toISOString(), now)).toBe(false)
    expect(sameDay(new Date(2026, 8, 19, 12).toISOString(), now)).toBe(false)
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
