// What expectSettledWithoutOverlaps (helpers.ts) checks in each pass of boxes, kept apart from
// Playwright so unit tests can run it: test/unit/e2e-box-checks.test.ts.

export interface Box {
  name: string
  x: number
  y: number
  width: number
  height: number
}

/** One pass of boxesInOnePass: the boxes found, and the names whose selector found no element or several. */
export interface BoxPass {
  boxes: Box[]
  missing: string[]
  ambiguous: string[]
}

/** The pairs of boxes that overlap, by name; boxes that only touch do not. */
export function overlaps(boxes: readonly Box[]): string[] {
  const found: string[] = []
  boxes.forEach((a, i) => {
    for (const b of boxes.slice(i + 1)) {
      if (a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5) found.push(`${a.name} and ${b.name}`)
    }
  })
  return found
}

/**
 * What makes a pass say nothing about overlaps: an element not found, a selector that finds more
 * than one (the box read might not be the element meant), and a box of zero width or height, which
 * overlaps nothing.
 */
export function passProblems({ boxes, missing, ambiguous }: BoxPass): string[] {
  return [
    ...missing.map((name) => `${name}: not found`),
    ...ambiguous.map((name) => `${name}: the selector finds several elements`),
    ...boxes.filter((box) => box.width <= 0 || box.height <= 0).map((box) => `${box.name}: an empty box`),
  ]
}
