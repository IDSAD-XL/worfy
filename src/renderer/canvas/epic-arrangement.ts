// How the Epic frames share their strip of K columns (ADR-0075): the order of the frames and K.
// Pure functions: no React, no IPC, no clock, no window size or camera. Every screen of a Project
// computes the same answer from the same Layout record (ADR-0053), so the frames stand at the same
// places on a small window and on a large one.
//
// The record is one invisible Layout Node per Project (ADR-0075, point 6):
//
//   id `epic-arrangement`, locked, w = h = 1 (not drawn)
//   data.order    the Epics in the order of the frames
//   data.columns  K the last time it was written: the hysteresis keeps it
//   data.at       when the order was computed (ISO time of the screen that wrote it)
//
// sources/epics.ts reads it, writes it on a screen that may change the Layout, and runs "Re-pack".
import { FRAME_GAP } from './epic-layout'

/** The aspect ratio the strip aims at: 16:10. */
export const TARGET_ASPECT = 1.6
/** How far the strip's aspect ratio may drift from TARGET_ASPECT, as a share of it, before K is computed again. */
export const ASPECT_TOLERANCE = 0.3

/** What K reads of a frame. */
export interface ArrangedFrame {
  width: number
  height: number
  /** The height the strip keeps free for the frame: with its done stack open (ADR-0032, point 2). Defaults to `height`. */
  reserve?: number | undefined
}

export interface ArrangementRecord {
  order: string[]
  columns: number
  at: string
}

export interface Arrangement {
  order: string[]
  columns: number
}

/** The height a frame takes in its column: its height with the done stack open. */
export const reservedHeight = (frame: ArrangedFrame): number => Math.max(frame.height, frame.reserve ?? frame.height)

/** K as a strip can use it: at least 1, at most one column per frame. */
export const usableColumns = (columns: number, frames: number): number => Math.max(1, Math.min(Math.floor(columns) || 1, frames || 1))

/**
 * The strip's size with `columns` columns: frame `i` in column `i mod K`, every column as wide as
 * the widest frame, FRAME_GAP between columns and between frames of a column. The height is the
 * tallest column's, each frame counted with its done stack open.
 */
export function stripSize(frames: readonly ArrangedFrame[], columns: number): { width: number; height: number } {
  const k = usableColumns(columns, frames.length)
  const columnWidth = Math.max(0, ...frames.map((frame) => frame.width))
  const heights = Array<number>(k).fill(0)
  frames.forEach((frame, index) => {
    heights[index % k]! += (index >= k ? FRAME_GAP : 0) + reservedHeight(frame)
  })
  return { width: k * columnWidth + (k - 1) * FRAME_GAP, height: Math.max(0, ...heights) }
}

/** True while the strip with `columns` columns is within ASPECT_TOLERANCE of 16:10. */
function holdsAspect(frames: readonly ArrangedFrame[], columns: number): boolean {
  const { width, height } = stripSize(frames, columns)
  if (height <= 0 || width <= 0) return false
  return Math.abs(width / height / TARGET_ASPECT - 1) <= ASPECT_TOLERANCE
}

/**
 * K for the frames in their order (ADR-0075, point 3). Without a previous K:
 * `max(1, round(sqrt(S × 1.6) / W))`, where S is the sum of the frames' areas (each with its done
 * stack open) and W the widest frame plus FRAME_GAP, and never more columns than frames. With a
 * previous K the strip keeps it while its aspect ratio stays within 30 % of 16:10 (hysteresis), so
 * a new Ticket or a frame that grew rarely moves the frames to other columns.
 */
export function columnsFor(frames: readonly ArrangedFrame[], previous: number | null): number {
  if (frames.length === 0) return 1
  if (previous !== null && Number.isInteger(previous) && previous >= 1) {
    const kept = usableColumns(previous, frames.length)
    if (holdsAspect(frames, kept)) return kept
  }
  const column = Math.max(...frames.map((frame) => frame.width)) + FRAME_GAP
  const area = frames.reduce((sum, frame) => sum + frame.width * reservedHeight(frame), 0)
  return usableColumns(Math.max(1, Math.round(Math.sqrt(area * TARGET_ASPECT) / column)), frames.length)
}

/** By name, by code unit: the same order on every screen, whatever its locale. */
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The order of the frames (ADR-0075, point 4). Without a previous order: the Epics with work first
 * (`activity`: a claimed Ticket, a live agent bound to the Epic or its Ticket, a running Autopilot),
 * then the rest; each part by name. With a previous order the frames keep it: an Epic that is gone
 * drops out, a new one goes to the end (by name when there are several), and activity changes
 * nothing, so a frame does not jump when an agent takes a Ticket.
 */
export function orderFor(epics: readonly string[], activity: ReadonlySet<string>, previous: readonly string[] | null): string[] {
  const present = [...new Set(epics)]
  if (previous === null) {
    const sorted = present.sort(byName)
    return [...sorted.filter((epic) => activity.has(epic)), ...sorted.filter((epic) => !activity.has(epic))]
  }
  const presentSet = new Set(present)
  const kept = [...new Set(previous)].filter((epic) => presentSet.has(epic))
  const keptSet = new Set(kept)
  return [...kept, ...present.filter((epic) => !keptSet.has(epic)).sort(byName)]
}

/**
 * The arrangement every screen draws from the Layout's record: its order (new Epics at the end) and
 * K with hysteresis over its `columns`. Without a record — none written yet, or the first "Re-pack"
 * undone — the Epics go by name and K is computed afresh, the same on every screen.
 */
export function arrange(epics: readonly string[], frames: ReadonlyMap<string, ArrangedFrame>, record: ArrangementRecord | null): Arrangement {
  const order = orderFor(epics, new Set(), record?.order ?? null)
  return { order, columns: columnsFor(framesOf(order, frames), record?.columns ?? null) }
}

/** The arrangement computed again from scratch: on the first opening of the day and by "Re-pack" (active first, K without hysteresis). */
export function repack(epics: readonly string[], frames: ReadonlyMap<string, ArrangedFrame>, activity: ReadonlySet<string>): Arrangement {
  const order = orderFor(epics, activity, null)
  return { order, columns: columnsFor(framesOf(order, frames), null) }
}

const framesOf = (order: readonly string[], frames: ReadonlyMap<string, ArrangedFrame>): ArrangedFrame[] =>
  order.flatMap((epic) => {
    const frame = frames.get(epic)
    return frame === undefined ? [] : [frame]
  })

/**
 * The record kept in a Layout Node's data, or null when it is not one: no Node, or data that is
 * not a whole record (the first "Re-pack" undone leaves its keys null).
 */
export function readArrangement(node: { data: Readonly<Record<string, unknown>> } | undefined): ArrangementRecord | null {
  if (node === undefined) return null
  const { order, columns, at } = node.data
  if (!Array.isArray(order) || !order.every((epic): epic is string => typeof epic === 'string')) return null
  if (typeof columns !== 'number' || !Number.isInteger(columns) || columns < 1) return null
  if (typeof at !== 'string') return null
  return { order, columns, at }
}

/** True when `at` is a time on the same calendar day as `now`, by the clock of this screen. */
export function sameDay(at: string, now: Date): boolean {
  const then = new Date(at)
  if (Number.isNaN(then.getTime())) return false
  return then.getFullYear() === now.getFullYear() && then.getMonth() === now.getMonth() && then.getDate() === now.getDate()
}
