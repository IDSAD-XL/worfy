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

/** What the page reports for one element to measure: how many elements its selector found, and the box of the one when it found exactly one. */
export interface BoxRead {
  name: string
  count: number
  box: Omit<Box, 'name'> | null
}

/** One pass from what the page read: a selector that found nothing is missing, one that found several is ambiguous. */
export function passOf(reads: readonly BoxRead[]): BoxPass {
  const pass: BoxPass = { boxes: [], missing: [], ambiguous: [] }
  for (const { name, count, box } of reads) {
    if (count === 0) pass.missing.push(name)
    else if (count > 1) pass.ambiguous.push(name)
    else if (box !== null) pass.boxes.push({ name, ...box })
  }
  return pass
}

/** Refuses fewer than two elements: no two boxes of such a list overlap, so the check would pass without checking anything. */
export function checkTargets(targets: readonly unknown[], message: string): void {
  if (targets.length < 2) throw new Error(`expectSettledWithoutOverlaps: ${message}: needs at least two elements, got ${targets.length}`)
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

/** A box as the page reads it, without a name. */
export type Rect = Omit<Box, 'name'>

/**
 * How many elements each selector of a pass of box lists must find: `one` exactly one, `some` at
 * least one, `any` any number, none included.
 */
export type ListRule = 'one' | 'some' | 'any'

/** What makes a pass of box lists unusable under `rule`: a selector that found no element, or several where one is meant. */
export function listProblems(lists: Readonly<Record<string, readonly Rect[]>>, rule: ListRule): string[] {
  const problems: string[] = []
  for (const [name, list] of Object.entries(lists)) {
    if (list.length === 0 && rule !== 'any') problems.push(`${name}: not found`)
    else if (list.length > 1 && rule === 'one') problems.push(`${name}: the selector finds ${list.length} elements`)
  }
  return problems
}

/** A Node's place on the Canvas from its element's style `transform`, as React Flow writes it; null without a translate. */
export function translateOf(transform: string): { x: number; y: number } | null {
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform)
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null
}
