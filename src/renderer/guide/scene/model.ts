// The logic of the worfy Guide's live diagrams (worfy-guide ticket 04, ADR-0090 point 9), apart from
// the DOM so the unit tests can reach it: the description of a diagram, the geometry of its Edges,
// what a block or a step lights, where the moving dots stand, the step player and the break of a long
// note. LivingScene.tsx draws a diagram from it, motion.ts moves its dots. The sizes are those of the
// Living Canvas style in the epic's spec (.scratch/worfy-guide/spec.md, its section on that style).

/** The groups a block takes its colour from (scene-colours.ts). */
export type SceneGroup = 'machine' | 'project' | 'workflow' | 'agents' | 'tools' | 'harness'

export interface SceneBlock {
  /** Its key in the Topic's `scene.labels`: the title is `labels[id]`, the note `labels[id + 'Note']`. */
  readonly id: string
  /** The top left corner, in units of the viewBox; every block is placed by hand. */
  readonly x: number
  readonly y: number
  readonly group: SceneGroup
  /** The Topic a click on the block opens; none — the block only highlights. */
  readonly topic?: string
}

export interface SceneEdge {
  readonly from: string
  readonly to: string
  /** The key of its label in `scene.labels`, shown on the line while the Edge is lit. */
  readonly label?: string
}

export interface SceneStep {
  /** The key of what the step says in `scene.labels`. */
  readonly caption: string
  readonly blocks: readonly string[]
  /** The Edges the step lights, by edgeId; without them, every Edge between two of its blocks. */
  readonly edges?: readonly string[]
}

export interface SceneSpec {
  /** The size of the viewBox. */
  readonly width: number
  readonly height: number
  readonly blocks: readonly SceneBlock[]
  readonly edges: readonly SceneEdge[]
  /** The steps of the player, in order; none — the diagram has no player. */
  readonly steps?: readonly SceneStep[]
}

export const NODE_WIDTH = 160
export const NODE_HEIGHT = 58
export const HEADER_HEIGHT = 26
/** How fast the dots move along an Edge, in units of the viewBox a second. */
export const DOT_SPEED = 55
export const DOTS_PER_EDGE = 2
/** How long the player stays on a step. */
export const STEP_SECONDS = 4
/** How far the line stops before the tip of its arrowhead, which is 9 units deep. */
const TIP_GAP = 3
const MIN_ARM = 26

export function edgeId(edge: Pick<SceneEdge, 'from' | 'to'>): string {
  return `${edge.from}->${edge.to}`
}

export interface Point {
  x: number
  y: number
}

export interface EdgeShape {
  /** The path the line draws and the dots follow. */
  d: string
  /** Where the arrowhead's tip touches the target block. */
  tip: Point
  /** The direction the arrowhead points, in degrees: 0 right, 90 down. */
  angle: number
  /** The middle of the curve (its parameter at one half), where the Edge's label stands. */
  middle: Point
}

const round = (value: number): number => Math.round(value * 10) / 10

/**
 * The Edge between two blocks: a cubic curve from the middle of a side of `from` to the middle of the
 * facing side of `to`, the sides that face each other across the larger gap; each arm is
 * max(26, 0.42 × the distance between the ends) along the normal of its side.
 */
export function edgeShape(from: SceneBlock, to: SceneBlock): EdgeShape {
  const gapX = Math.max(to.x - (from.x + NODE_WIDTH), from.x - (to.x + NODE_WIDTH))
  const gapY = Math.max(to.y - (from.y + NODE_HEIGHT), from.y - (to.y + NODE_HEIGHT))
  let start: Point
  let tip: Point
  let direction: Point
  if (gapX >= gapY) {
    const right = to.x > from.x
    start = { x: right ? from.x + NODE_WIDTH : from.x, y: from.y + NODE_HEIGHT / 2 }
    tip = { x: right ? to.x : to.x + NODE_WIDTH, y: to.y + NODE_HEIGHT / 2 }
    direction = { x: right ? 1 : -1, y: 0 }
  } else {
    const down = to.y > from.y
    start = { x: from.x + NODE_WIDTH / 2, y: down ? from.y + NODE_HEIGHT : from.y }
    tip = { x: to.x + NODE_WIDTH / 2, y: down ? to.y : to.y + NODE_HEIGHT }
    direction = { x: 0, y: down ? 1 : -1 }
  }
  const arm = Math.max(MIN_ARM, 0.42 * Math.hypot(tip.x - start.x, tip.y - start.y))
  const end = { x: tip.x - direction.x * TIP_GAP, y: tip.y - direction.y * TIP_GAP }
  const curve = [start, { x: start.x + direction.x * arm, y: start.y + direction.y * arm }, { x: end.x - direction.x * arm, y: end.y - direction.y * arm }, end].map(
    (point) => ({ x: round(point.x), y: round(point.y) }),
  )
  const [p0, p1, p2, p3] = curve as [Point, Point, Point, Point]
  const middle = { x: round((p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8), y: round((p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8) }
  const angle = (Math.atan2(direction.y, direction.x) * 180) / Math.PI
  return { d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`, tip, angle, middle }
}

export interface Lit {
  /** Something is lit, so the rest fades. */
  focusing: boolean
  /** The blocks lit in full: the one under the pointer or the focus, or the blocks of the step. */
  hot: ReadonlySet<string>
  /** The neighbours of the block under the pointer along its Edges. */
  near: ReadonlySet<string>
  /** The lit Edges, by edgeId. */
  edges: ReadonlySet<string>
}

const NOTHING: Lit = { focusing: false, hot: new Set(), near: new Set(), edges: new Set() }

/**
 * What the diagram lights: the block under the pointer or the keyboard focus (`focus`) with its
 * neighbours and its Edges; else the chosen step's blocks and Edges; else nothing.
 */
export function litParts(spec: SceneSpec, focus: string | null, step: number | null): Lit {
  if (focus !== null && spec.blocks.some((block) => block.id === focus)) {
    const touching = spec.edges.filter((edge) => edge.from === focus || edge.to === focus)
    return {
      focusing: true,
      hot: new Set([focus]),
      near: new Set(touching.map((edge) => (edge.from === focus ? edge.to : edge.from))),
      edges: new Set(touching.map(edgeId)),
    }
  }
  const chosen = step === null ? undefined : spec.steps?.[step]
  if (chosen === undefined) return NOTHING
  const blocks = new Set(chosen.blocks)
  const edges = chosen.edges ?? spec.edges.filter((edge) => blocks.has(edge.from) && blocks.has(edge.to)).map(edgeId)
  return { focusing: true, hot: blocks, near: new Set(), edges: new Set(edges) }
}

/**
 * Where dot `index` of `count` stands on an Edge `length` long, `seconds` into the motion, as a
 * share of the length: the dots run at DOT_SPEED, evenly apart, round and round. Under Reduce motion
 * — and on an Edge of no length — they stand still at (index + 0.5) / count.
 */
export function dotFraction(index: number, count: number, seconds: number, length: number, reduced: boolean): number {
  if (reduced || length <= 0) return (index + 0.5) / count
  return (((seconds * DOT_SPEED) / length + index / count) % 1 + 1) % 1
}

export interface Player {
  /** The step on screen; null — the whole diagram. */
  step: number | null
  playing: boolean
}

export type PlayerAction = { type: 'choose'; step: number } | { type: 'toggle' } | { type: 'tick' }

/**
 * The step player of a diagram with `count` steps. Play starts at the first step, or goes on from
 * the step on screen, and every STEP_SECONDS a tick moves to the next one; the last step stops it.
 * Choosing a step stops the play; choosing the step on screen again shows the whole diagram.
 */
export function playerReducer(count: number): (state: Player, action: PlayerAction) => Player {
  return (state, action) => {
    switch (action.type) {
      case 'choose':
        return { step: action.step === state.step ? null : action.step, playing: false }
      case 'toggle':
        if (state.playing) return { step: state.step, playing: false }
        return { step: state.step === null || state.step >= count - 1 ? 0 : state.step, playing: true }
      case 'tick':
        if (!state.playing) return state
        if (state.step !== null && state.step >= count - 1) return { step: state.step, playing: false }
        return { step: state.step === null ? 0 : state.step + 1, playing: true }
    }
  }
}

/** About how wide a character of the 11 px note is, in units of the viewBox. */
const NOTE_CHAR_WIDTH = 6
const NOTE_PADDING = 24

/**
 * The note under a block header as it is drawn: one line when it fits the block, else two, broken at
 * the space nearest the middle (the style draws them at 10.5 px).
 * shortcut: the width is estimated from the number of characters, not measured; redo with a measured
 * width if a note of wide letters overflows its block.
 */
export function noteLines(note: string, width: number): string[] {
  if (note.length * NOTE_CHAR_WIDTH <= width - NOTE_PADDING) return [note]
  const middle = note.length / 2
  let best = -1
  for (let index = note.indexOf(' '); index !== -1; index = note.indexOf(' ', index + 1)) {
    if (best === -1 || Math.abs(index - middle) < Math.abs(best - middle)) best = index
  }
  if (best === -1) return [note]
  return [note.slice(0, best), note.slice(best + 1)]
}
