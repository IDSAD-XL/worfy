// The order of the Epic frames and their number of columns (ADR-0075): pure functions every
// screen of a Project computes the same way from the Layout's `epic-arrangement` record. How
// arrangement-record.ts writes the record: epic-arrangement-record.test.tsx.
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

/** True when `columns` is the K a fresh pick must give: no K of 1 … n closer to 16:10, every smaller K farther. */
const isClosest = (frames: readonly ArrangedFrame[], columns: number): boolean =>
  Array.from({ length: frames.length }, (_, index) => index + 1).every((k) =>
    k < columns ? offAspect(frames, k) > offAspect(frames, columns) : offAspect(frames, k) >= offAspect(frames, columns),
  )

describe('columnsFor', () => {
  it('without a previous K: the K of 1 … n whose strip is closest to 16:10', () => {
    expect(columnsFor(usual(1), null)).toBe(1)
    expect(columnsFor(usual(4), null)).toBe(2)
    expect(columnsFor(usual(11), null)).toBe(3)
    expect(columnsFor(usual(30), null)).toBe(5)
  })

  it('checked against every K on several sets of frames: equal ones, narrow ones with one wide, with the done stack open', () => {
    const sets: ArrangedFrame[][] = [
      ...[1, 2, 3, 5, 8, 12, 20].map(usual),
      [...Array.from({ length: 10 }, (_, index) => ({ width: 700, height: 400 + index * 60 })), { width: 2400, height: 400 }],
      [...Array.from({ length: 6 }, () => ({ width: 300, height: 900 })), { width: 1800, height: 200 }],
      Array.from({ length: 9 }, (_, index) => ({ width: 900, height: 300, reserve: index % 3 === 0 ? 1500 : 300 })),
      Array.from({ length: 11 }, () => ({ width: 900, height: 200, reserve: 900 })),
    ]
    for (const frames of sets) expect(isClosest(frames, columnsFor(frames, null))).toBe(true)
  })

  it('on a tie takes the smaller K', () => {
    // Two frames 128 × 76: one column is 128 × 200, two are 304 × 76; both strips are 2.5 times off 16:10.
    const frames = [
      { width: 128, height: 76 },
      { width: 128, height: 76 },
    ]
    expect(offAspect(frames, 1)).toBe(2.5)
    expect(offAspect(frames, 2)).toBe(2.5)
    expect(columnsFor(frames, null)).toBe(1)
  })

  it('the gap between columns counts in the strip\'s width: ten frames 100 wide get 9 columns, not the 5 the old formula gave (review of PR #539)', () => {
    // 9 columns: 9 × 100 + 8 × 48 = 1284 wide, two frames and a gap tall (848); 10 columns are one frame tall.
    const narrow = Array.from({ length: 10 }, () => ({ width: 100, height: 400 }))
    expect(FRAME_GAP).toBe(48)
    expect(stripSize(narrow, 9)).toEqual({ width: 1284, height: 848 })
    expect(columnsFor(narrow, null)).toBe(9)
    expect(offAspect(narrow, 5)).toBeGreaterThan(1.9)
  })

  it('counts a frame with its done stack open (`reserve`), not the folded height', () => {
    const folded = Array.from({ length: 11 }, () => ({ width: 900, height: 200 }))
    const reserved = folded.map((frame) => ({ ...frame, reserve: 900 }))
    expect(columnsFor(folded, null)).toBe(2)
    expect(columnsFor(reserved, null)).toBe(5)
  })

  it('never has more columns than frames, and one for no frames', () => {
    // One very wide and short frame: K = 1 although the strip is far too wide; a narrow tall pair: 2 although still too tall.
    expect(columnsFor([{ width: 3000, height: 56 }], null)).toBe(1)
    expect(columnsFor([{ width: 100, height: 5000 }, { width: 100, height: 5000 }], null)).toBe(2)
    expect(columnsFor([], null)).toBe(1)
    expect(columnsFor([], 4)).toBe(1)
  })

  it('keeps the previous K while the strip\'s aspect ratio is within 30 % of 16:10, and computes it again past that', () => {
    // 11 frames 580 tall with the open done stack: 3 and 4 columns are both within 30 %, 4 is closer.
    const frames = Array.from({ length: 11 }, () => ({ width: 900, height: 550, reserve: 580 }))
    expect(columnsFor(frames, null)).toBe(4)
    // K = 3 is within the tolerance: kept although K = 4 is closer; so is K = 4.
    expect(offAspect(frames, 3)).toBeGreaterThan(offAspect(frames, 4))
    expect(Math.abs(aspect(frames, 3) / TARGET_ASPECT - 1)).toBeLessThanOrEqual(ASPECT_TOLERANCE)
    expect(columnsFor(frames, 3)).toBe(3)
    expect(columnsFor(frames, 4)).toBe(4)
    // K = 2 is not: 2 × 900 + 48 wide, 6 frames tall; K = 5 neither.
    expect(Math.abs(aspect(frames, 2) / TARGET_ASPECT - 1)).toBeGreaterThan(ASPECT_TOLERANCE)
    expect(columnsFor(frames, 2)).toBe(4)
    expect(Math.abs(aspect(frames, 5) / TARGET_ASPECT - 1)).toBeGreaterThan(ASPECT_TOLERANCE)
    expect(columnsFor(frames, 5)).toBe(4)
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
    // 11 frames 900 wide: 4 and 5 columns are both three frames and two gaps tall, so the frames'
    // height sets the aspect ratio of both strips. `at(ratio, k)`: the strip with k columns is `ratio` × 16:10.
    const at = (ratio: number, k: number): ArrangedFrame[] => {
      const height = ((k * 900 + (k - 1) * FRAME_GAP) / (TARGET_ASPECT * ratio) - 2 * FRAME_GAP) / 3
      return Array.from({ length: 11 }, () => ({ width: 900, height }))
    }
    // Too tall with 4 columns: 5 columns are closer, 4 stay up to 30 %.
    for (const ratio of [1 - ASPECT_TOLERANCE + 0.001, 1 - ASPECT_TOLERANCE - 0.001]) expect(columnsFor(at(ratio, 4), null)).toBe(5)
    expect(columnsFor(at(1 - ASPECT_TOLERANCE + 0.001, 4), 4)).toBe(4)
    expect(columnsFor(at(1 - ASPECT_TOLERANCE - 0.001, 4), 4)).toBe(5)
    // Too wide with 5 columns: 4 columns are closer, 5 stay up to 30 %.
    for (const ratio of [1 + ASPECT_TOLERANCE - 0.001, 1 + ASPECT_TOLERANCE + 0.01]) expect(columnsFor(at(ratio, 5), null)).toBe(4)
    expect(columnsFor(at(1 + ASPECT_TOLERANCE - 0.001, 5), 5)).toBe(5)
    expect(columnsFor(at(1 + ASPECT_TOLERANCE + 0.01, 5), 5)).toBe(4)
  })

  it('the tolerance is 30 % of 16:10, and a K outside it gives way only to one 1.3 times closer', () => {
    expect(TARGET_ASPECT).toBe(1.6)
    expect(ASPECT_TOLERANCE).toBe(0.3)
    expect(SWITCH_MARGIN).toBe(1.3)
  })

  describe('frames of very different widths: ten 700 wide and one 2400 wide', () => {
    // Every column is 2400 wide, so the old formula, which counted each frame with its own width,
    // gave too few columns.
    const frames = (grow: number): ArrangedFrame[] =>
      [700, 700, 700, 700, 700, 700, 700, 700, 700, 700, 2400].map((width, index) => ({ width, height: 400 + index * 60 + (index === 0 ? grow : 0) }))
    const formula = (set: readonly ArrangedFrame[]): number =>
      Math.max(1, Math.round(Math.sqrt(set.reduce((sum, frame) => sum + frame.width * frame.height, 0) * TARGET_ASPECT) / (2400 + FRAME_GAP)))
    const review = frames(47 * 40)

    it('the review example gets K = 3: one column is more than 5 times off 16:10, three are within 30 %', () => {
      expect(columnsFor(review, null)).toBe(3)
      expect(offAspect(review, 1)).toBeGreaterThan(5)
      expect(Math.abs(aspect(review, 3) / TARGET_ASPECT - 1)).toBeLessThanOrEqual(ASPECT_TOLERANCE)
      expect([1, 2, 3, 4, 5].map((k) => Number(offAspect(review, k).toFixed(2)))).toEqual([6.71, 2.09, 1.03, 1.56, 1.87])
    })

    it('the old formula flipped between 1 and 2 as the first frame grew by 40 and shrank back; the candidates stay at 3', () => {
      const grown = frames(48 * 40)
      expect([formula(review), formula(grown)]).toEqual([1, 2])
      expect([review, grown, review, grown].map((step) => columnsFor(step, null))).toEqual([3, 3, 3, 3])
      let k = 3
      for (const step of [grown, review, grown, review]) {
        k = columnsFor(step, k)
        expect(k).toBe(3)
      }
    })

    it('a previous K outside 30 % gives way to the K afresh within it', () => {
      expect(offAspect(review, 2)).toBeGreaterThan(1 + ASPECT_TOLERANCE)
      expect(columnsFor(review, 2)).toBe(3)
      expect(columnsFor(review, 4)).toBe(3)
    })

    describe('shorter frames, where no K is within 30 %', () => {
      const short = frames(1 * 40)
      const taller = frames(2 * 40)
      const noneHolds = (set: readonly ArrangedFrame[]) =>
        Array.from({ length: set.length }, (_, index) => Math.abs(aspect(set, index + 1) / TARGET_ASPECT - 1)).every((off) => off > ASPECT_TOLERANCE)

      it('the K afresh flips between 2 and 3 as the first frame grows by 40 and shrinks back; a kept K does not', () => {
        expect(noneHolds(short) && noneHolds(taller)).toBe(true)
        expect([short, taller, short, taller].map((step) => columnsFor(step, null))).toEqual([2, 3, 2, 3])
        for (const start of [2, 3]) {
          let k = start
          const kept = [short, taller, short, taller].map((step) => (k = columnsFor(step, k)))
          expect(kept).toEqual([start, start, start, start])
        }
      })

      it('K = 1 gives way once to the clearly closer K afresh and does not come back', () => {
        expect([taller, short, taller, short].map((step) => columnsFor(step, 1))).toEqual([3, 2, 3, 2])
        let k = 1
        expect([taller, short, taller, short].map((step) => (k = columnsFor(step, k)))).toEqual([3, 3, 3, 3])
      })

      it('the K afresh replaces a K outside 30 % only past the margin: 1.74 times closer does, 1.30 times does not', () => {
        const set = frames(17 * 40)
        expect(noneHolds(set)).toBe(true)
        expect(columnsFor(set, null)).toBe(3)
        expect(offAspect(set, 2) / offAspect(set, 3)).toBeCloseTo(1.298, 3)
        expect(columnsFor(set, 2)).toBe(2)
        expect(offAspect(set, 4) / offAspect(set, 3)).toBeCloseTo(1.736, 3)
        expect(columnsFor(set, 4)).toBe(3)
      })
    })
  })

  it('ignores a previous K that is not a whole number of columns', () => {
    const frames = Array.from({ length: 11 }, () => ({ width: 900, height: 550, reserve: 580 }))
    for (const bad of [0, -2, 2.5, Number.NaN]) expect(columnsFor(frames, bad)).toBe(4)
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

  it('passes the record\'s K to the hysteresis: 3 columns are kept for 11 frames where afresh it is 4', () => {
    const eleven = 'abcdefghijk'.split('')
    const even = new Map(eleven.map((epic) => [epic, { width: 900, height: 550, reserve: 580 }]))
    expect(arrange(eleven, even, null).columns).toBe(4)
    expect(arrange(eleven, even, { order: eleven, columns: 3, at: '2026-10-19T08:00:00.000Z' }).columns).toBe(3)
  })

  it('the same frames give the same arrangement, whatever order the Map was filled in', () => {
    const wide = new Map<string, ArrangedFrame>([
      ...'abcdefghij'.split('').map((epic, index): [string, ArrangedFrame] => [epic, { width: 700, height: 400 + index * 60 }]),
      ['k', { width: 2400, height: 1000 }],
    ])
    const backwards = new Map([...wide].reverse())
    const epics = [...wide.keys()]
    expect(arrange(epics, backwards, null)).toEqual(arrange(epics, wide, null))
    expect(arrange([...epics].reverse(), backwards, null)).toEqual(arrange(epics, wide, null))
    expect(repack(epics, backwards, new Set(['k']))).toEqual(repack(epics, wide, new Set(['k'])))
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
