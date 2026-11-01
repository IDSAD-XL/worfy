// Where the label of a bar goes on the Run history timeline (worfy-flight-recorder ticket 18; decision 05,
// point 6: the owner saw bar lines run over the text of labels). Pure: pixels in, places out.
//
// A label sits whole inside its bar, after a padding, or right of the bar's end on the ground of the row;
// with room for neither it is not drawn and stays in the tooltip. In no case does its rectangle cross a bar
// of the row other than its own, or another label: so a short bar with a neighbour close behind it, or a
// bar another one overlaps (parallel Waits on the Wait lane), may have no label at all. A mark's label
// may lie on the bars the mark belongs to (`over`): the block of a Ticket on the Ticket's own bar.

/** Space between a bar's edge and a label inside it, px. */
export const LABEL_PADDING = 4
/** Space between a bar's end and a label right of it, px. */
export const LABEL_GAP = 4

/** One thing drawn in a row: a bar, or a mark (a block «!»), with the width of its label's text. */
export interface LabelItem {
  id: string
  /** The horizontal extent of the bar in the row, px from the row's left edge. */
  left: number
  right: number
  /** The width of the label's text, px; 0 — no label. */
  label: number
  /** Whether the label may sit inside the item; false for a mark, whose label always follows it. */
  inside?: boolean
  /**
   * Items the label may lie on: a block mark's label is a chip over its own Ticket's bar (decision 05,
   * point 7), never over another bar.
   */
  over?: readonly string[]
}

export type LabelPlace = { id: string; placement: 'inside' | 'after'; x: number; width: number } | { id: string; placement: 'none' }

const crosses = (a0: number, a1: number, b0: number, b1: number): boolean => a0 < b1 && a1 > b0

/** The place of each item's label in a row `width` px wide, in the order of the items. */
export function layoutLabels(items: readonly LabelItem[], width: number): LabelPlace[] {
  const taken: [number, number][] = []
  const free = (self: LabelItem, x0: number, x1: number): boolean =>
    x0 >= 0 && x1 <= width && items.every((other) => other === self || self.over?.includes(other.id) === true || !crosses(x0, x1, other.left, other.right)) && taken.every(([t0, t1]) => !crosses(x0, x1, t0, t1))
  // Left to right: an earlier bar's label right of its end is checked against the later bars too.
  const order = [...items].sort((a, b) => a.left - b.left)
  const places = new Map<LabelItem, LabelPlace>()
  for (const item of order) {
    const { label } = item
    let place: LabelPlace = { id: item.id, placement: 'none' }
    if (label > 0) {
      const inside = item.left + LABEL_PADDING
      const after = item.right + LABEL_GAP
      if (item.inside !== false && item.right - item.left >= label + 2 * LABEL_PADDING && free(item, inside, inside + label)) place = { id: item.id, placement: 'inside', x: inside, width: label }
      else if (free(item, after, after + label)) place = { id: item.id, placement: 'after', x: after, width: label }
    }
    if (place.placement !== 'none') taken.push([place.x, place.x + place.width])
    places.set(item, place)
  }
  return items.map((item) => places.get(item) ?? { id: item.id, placement: 'none' })
}
