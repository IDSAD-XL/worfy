// The logic of the worfy Guide's live diagrams (worfy-guide ticket 04, ADR-0090 point 9), apart from
// the DOM so the unit tests can reach it: the description of a diagram, the geometry of its Edges,
// what a block or a step lights, where the moving dots stand, the step player and the break of a long
// note. LivingScene.tsx draws a diagram from it, motion.ts moves its dots. The sizes are those of the
// Living Canvas style in the epic's spec (.scratch/worfy-guide/spec.md, its section on that style).

/** The groups a block takes its colour from (scene-colours.ts). */
export type SceneGroup = 'machine' | 'project' | 'workflow' | 'agents' | 'tools' | 'harness'

/**
 * What a block looks like: `node` — a Node, NODE_WIDTH × NODE_HEIGHT; `tab` — the tab on the top edge
 * of a frame (SceneFrame), which is the frame's block; `chip` — a pill for a thing that is computed
 * and stored nowhere, drawn dashed (the Wave of an Epic).
 */
export type BlockShape = 'node' | 'tab' | 'chip'

export interface SceneBlock {
  /** Its key in the Topic's `scene.labels`: the title is `labels[id]`, the note `labels[id + 'Note']`. */
  readonly id: string
  /** The top left corner, in units of the viewBox; every block is placed by hand. */
  readonly x: number
  readonly y: number
  readonly group: SceneGroup
  /** The Topic a click on the block opens; none — the block only highlights. */
  readonly topic?: string
  /**
   * A page of docs/features/ a click opens on GitHub while the Guide does not show the block's Topic
   * (it is not written yet): the Full page of that Topic (blockTarget).
   */
  readonly page?: string
  /** `node` when not given. */
  readonly shape?: BlockShape
  /** The width of a tab or a chip, which fits its title; a Node is always NODE_WIDTH wide. */
  readonly width?: number
}

/** A side of a block an Edge leaves or enters by. */
export type Side = 'left' | 'right' | 'top' | 'bottom'

export interface SceneEdge {
  readonly from: string
  readonly to: string
  /** The key of its label in `scene.labels`, shown on the line while the Edge is lit. */
  readonly label?: string
  /** The sides the Edge leaves `from` and enters `to` by; by default the two that face each other across the larger gap. */
  readonly fromSide?: Side
  readonly toSide?: Side
  /** How far an end moves from the middle of its side (right or down is positive), so two Edges of one side do not meet. */
  readonly fromShift?: number
  readonly toShift?: number
}

/**
 * A frame drawn behind blocks to say they are inside something: `canvas` — a Canvas, the dotted field
 * with its border; `epic` — an Epic frame, tinted with the Workflow colour. Nesting is drawn by
 * position, never by a line. The frame's block is its tab (a block of shape `tab` on its top edge):
 * the frame lights and fades with it.
 */
export interface SceneFrame {
  /** The id of its tab block. */
  readonly block: string
  readonly kind: 'canvas' | 'epic'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The caption of an area outside the Canvas ("THIS MACHINE"): its key in `scene.labels` and where its text starts. */
export interface SceneRegion {
  readonly label: string
  readonly x: number
  readonly y: number
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
  /**
   * The frames behind the blocks, drawn in order (an Epic frame after the Canvas frame it lies in).
   * A diagram with a `canvas` frame draws no Canvas field behind the whole of it: the frame is the Canvas.
   */
  readonly frames?: readonly SceneFrame[]
  /** The captions of the areas outside the Canvas. */
  readonly regions?: readonly SceneRegion[]
  /** The steps of the player, in order; none — the diagram has no player. */
  readonly steps?: readonly SceneStep[]
}

export const NODE_WIDTH = 160
export const NODE_HEIGHT = 58
export const HEADER_HEIGHT = 26
export const TAB_HEIGHT = 32
export const CHIP_HEIGHT = 26
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

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The rectangle a block takes on the diagram. */
export function boxOf(block: SceneBlock): Box {
  const shape = block.shape ?? 'node'
  if (shape === 'node') return { x: block.x, y: block.y, width: NODE_WIDTH, height: NODE_HEIGHT }
  return { x: block.x, y: block.y, width: block.width ?? NODE_WIDTH, height: shape === 'tab' ? TAB_HEIGHT : CHIP_HEIGHT }
}

/** The way out of a block through each side. */
const OUTWARD: Readonly<Record<Side, Point>> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } }
/** Where an arrowhead points when it enters a block by each side: 0 right, 90 down. */
const ENTRY_ANGLE: Readonly<Record<Side, number>> = { left: 0, right: 180, top: 90, bottom: -90 }

/** The middle of `side` of `box`, moved `shift` along the side. */
function anchor(box: Box, side: Side, shift: number): Point {
  switch (side) {
    case 'left':
      return { x: box.x, y: box.y + box.height / 2 + shift }
    case 'right':
      return { x: box.x + box.width, y: box.y + box.height / 2 + shift }
    case 'top':
      return { x: box.x + box.width / 2 + shift, y: box.y }
    case 'bottom':
      return { x: box.x + box.width / 2 + shift, y: box.y + box.height }
  }
}

/** The sides of `from` and `to` that face each other across the larger gap between them. */
function facingSides(from: Box, to: Box): [Side, Side] {
  const gapX = Math.max(to.x - (from.x + from.width), from.x - (to.x + to.width))
  const gapY = Math.max(to.y - (from.y + from.height), from.y - (to.y + to.height))
  if (gapX >= gapY) return to.x > from.x ? ['right', 'left'] : ['left', 'right']
  return to.y > from.y ? ['bottom', 'top'] : ['top', 'bottom']
}

/**
 * The Edge between two blocks: a cubic curve from the middle of a side of `from` to the middle of a
 * side of `to` — the sides that face each other across the larger gap, unless `route` names them —
 * each arm max(26, 0.42 × the distance between the ends) along the outward normal of its side.
 */
export function edgeShape(from: SceneBlock, to: SceneBlock, route: Pick<SceneEdge, 'fromSide' | 'toSide' | 'fromShift' | 'toShift'> = {}): EdgeShape {
  const fromBox = boxOf(from)
  const toBox = boxOf(to)
  const [exitSide, entrySide] = facingSides(fromBox, toBox)
  const exit = route.fromSide ?? exitSide
  const entry = route.toSide ?? entrySide
  const start = anchor(fromBox, exit, route.fromShift ?? 0)
  const tip = anchor(toBox, entry, route.toShift ?? 0)
  const out = OUTWARD[exit]
  const back = OUTWARD[entry]
  const arm = Math.max(MIN_ARM, 0.42 * Math.hypot(tip.x - start.x, tip.y - start.y))
  const end = { x: tip.x + back.x * TIP_GAP, y: tip.y + back.y * TIP_GAP }
  const curve = [start, { x: start.x + out.x * arm, y: start.y + out.y * arm }, { x: end.x + back.x * arm, y: end.y + back.y * arm }, end].map((point) => ({
    x: round(point.x),
    y: round(point.y),
  }))
  const [p0, p1, p2, p3] = curve as [Point, Point, Point, Point]
  const middle = { x: round((p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8), y: round((p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8) }
  return { d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`, tip: { x: round(tip.x), y: round(tip.y) }, angle: ENTRY_ANGLE[entry], middle }
}

/** Where a click on a block leads: a Topic of the Guide, a page on GitHub, or nowhere. */
export type BlockTarget = { kind: 'topic'; topic: string } | { kind: 'page'; page: string } | null

/**
 * Where a click on `block` leads: its Topic while the Guide shows it (`shown`), else its Full page;
 * a block with a Topic and no page always opens the Topic, one with neither leads nowhere.
 */
export function blockTarget(block: SceneBlock, shown: (topic: string) => boolean): BlockTarget {
  if (block.topic !== undefined && (block.page === undefined || shown(block.topic))) return { kind: 'topic', topic: block.topic }
  if (block.page !== undefined) return { kind: 'page', page: block.page }
  return null
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
