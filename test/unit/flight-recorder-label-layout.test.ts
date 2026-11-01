// The labels of the Run history timeline (src/renderer/flight-recorder/label-layout.ts; worfy-flight-recorder
// ticket 18, decision 05, point 6): a label sits whole inside its bar with a padding, or right of the bar's end
// on the ground of the row; with room for neither it is not drawn and stays in the tooltip. In no case does
// the rectangle of a label cross a bar of the row other than its own.
import { describe, expect, it } from 'vitest'
import { LABEL_GAP, LABEL_PADDING, layoutLabels, type LabelItem, type LabelPlace } from '../../src/renderer/flight-recorder/label-layout'

const WIDTH = 600

function place(items: readonly LabelItem[], width = WIDTH): Map<string, LabelPlace> {
  return new Map(layoutLabels(items, width).map((placed) => [placed.id, placed]))
}

/** Every label drawn: inside the row, and crossing no bar but its own. */
function expectNoCrossing(items: readonly LabelItem[], width = WIDTH): void {
  const placed = layoutLabels(items, width)
  for (const label of placed) {
    if (label.placement === 'none') continue
    expect(label.x, label.id).toBeGreaterThanOrEqual(0)
    expect(label.x + label.width, label.id).toBeLessThanOrEqual(width)
    const self = items.find((item) => item.id === label.id)
    for (const bar of items) {
      if (bar.id === label.id || self?.over?.includes(bar.id) === true) continue
      const crosses = label.x < bar.right && label.x + label.width > bar.left
      expect(crosses, `the label of ${label.id} crosses the bar ${bar.id}`).toBe(false)
    }
    for (const other of placed) {
      if (other === label || other.placement === 'none') continue
      const crosses = label.x < other.x + other.width && label.x + label.width > other.x
      expect(crosses, `the labels of ${label.id} and ${other.id} cross`).toBe(false)
    }
  }
}

describe('layoutLabels', () => {
  it('puts a label that fits inside its bar there, after the padding', () => {
    const items = [{ id: 'a', left: 100, right: 300, label: 80 }]
    expect(place(items).get('a')).toEqual({ id: 'a', placement: 'inside', x: 100 + LABEL_PADDING, width: 80 })
    expectNoCrossing(items)
  })

  it('a label one pixel wider than the bar less both paddings goes right of the bar end', () => {
    const items = [{ id: 'a', left: 100, right: 100 + 80 + 2 * LABEL_PADDING - 1, label: 80 }]
    expect(place(items).get('a')).toEqual({ id: 'a', placement: 'after', x: items[0]!.right + LABEL_GAP, width: 80 })
    expectNoCrossing(items)
  })

  it('a short bar with a neighbour close behind it gets no label: right of its end it would cross the neighbour', () => {
    const items = [
      { id: 'short', left: 100, right: 110, label: 60 },
      { id: 'next', left: 140, right: 400, label: 50 },
    ]
    const placed = place(items)
    expect(placed.get('short')).toEqual({ id: 'short', placement: 'none' })
    expect(placed.get('next')?.placement).toBe('inside')
    expectNoCrossing(items)
  })

  it('a label inside its bar does not cross another bar that overlaps it in the same row', () => {
    // Two parallel Waits on the Wait lane: the second starts inside the first.
    const items = [
      { id: 'first', left: 100, right: 400, label: 120 },
      { id: 'second', left: 160, right: 500, label: 40 },
    ]
    const placed = place(items)
    expect(placed.get('first')?.placement).not.toBe('inside')
    expectNoCrossing(items)
  })

  it('a label that would run past the right edge of the row is not drawn', () => {
    const items = [{ id: 'a', left: 560, right: 570, label: 60 }]
    expect(place(items).get('a')).toEqual({ id: 'a', placement: 'none' })
  })

  it('two labels right of their bars do not cross each other', () => {
    const items = [
      { id: 'a', left: 100, right: 102, label: 50 },
      { id: 'b', left: 120, right: 122, label: 50 },
    ]
    const placed = place(items)
    expect(placed.get('a')?.placement).toBe('none')
    expect(placed.get('b')?.placement).toBe('after')
    expectNoCrossing(items)
  })

  it('an item with no label text gets none, and a mark with no room inside takes the place after it', () => {
    const items = [
      { id: 'thin', left: 10, right: 12, label: 0 },
      { id: 'mark', left: 200, right: 214, label: 90, inside: false },
    ]
    const placed = place(items)
    expect(placed.get('thin')).toEqual({ id: 'thin', placement: 'none' })
    expect(placed.get('mark')).toEqual({ id: 'mark', placement: 'after', x: 214 + LABEL_GAP, width: 90 })
    expectNoCrossing(items)
  })

  it('a mark\'s label may lie on the bar it belongs to, never on another one', () => {
    // A block of a Ticket: the mark sits on the Ticket's bar; the next part of another span follows.
    const own = { id: 'ticket@0', left: 0, right: 400, label: 0 }
    const mark = { id: 'block', left: 93, right: 107, label: 120, inside: false, over: ['ticket@0'] }
    expect(place([own, mark]).get('block')).toEqual({ id: 'block', placement: 'after', x: 107 + LABEL_GAP, width: 120 })
    const foreign = { id: 'other', left: 150, right: 160, label: 0 }
    expect(place([own, mark, foreign]).get('block')).toEqual({ id: 'block', placement: 'none' })
  })

  it('no label crosses a foreign bar on a crowded row of random bars', () => {
    let seed = 7
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let round = 0; round < 200; round += 1) {
      const items: LabelItem[] = []
      for (let index = 0; index < 8; index += 1) {
        const left = Math.floor(random() * WIDTH)
        items.push({ id: `b${index}`, left, right: Math.min(WIDTH, left + Math.floor(random() * 120)), label: 10 + Math.floor(random() * 80) })
      }
      expectNoCrossing(items)
    }
  })
})
