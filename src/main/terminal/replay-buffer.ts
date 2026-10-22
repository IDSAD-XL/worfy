// The output a Terminal keeps for redrawing it, and the sizes of the pty it came at. Moved out of
// pty.ts (worfy-windows ticket 42); pty.ts exports these names as before.
//
// The sizes are kept because output is right only at the size it came at (worfy-windows ticket 89).
// On Windows ConPTY does not redraw the screen after a resize: it asks for the cursor position, and
// PSReadLine then draws its line at absolute positions for the new size. A new view that writes all
// of the kept output at one size draws those lines in the wrong places; written with the resizes in
// their places, it draws the screen the live view had.
import type { ReplaySize } from '../../shared/ipc/terminal'
import { OscCutScanner } from './osc'

/** Output kept per terminal for redrawing it, in UTF-16 code units (one per character of ASCII). */
export const REPLAY_LIMIT = 256 * 1024

/**
 * The last REPLAY_LIMIT units of a stream, and the length of the whole stream. When the start of
 * what is kept falls inside an OSC sequence, the start is cut further, to the end of that sequence:
 * a new screen would print its tail (with the nonce of the shell) as text.
 *
 * Also the size of the pty at the start of what is kept and at every resize after it (`sizes`).
 */
export class ReplayBuffer {
  private chunks: string[] = []
  private kept = 0
  private total = 0
  /** Follows the part of the stream already dropped. */
  private readonly dropped = new OscCutScanner()
  /** In the order of `at`; the first one is the size at the start of what is kept, or before it. */
  private readonly resizes: ReplaySize[] = []

  /** `size`: the size the pty was made with. Without it the sizes start at the first resize. */
  constructor(size?: { cols: number; rows: number }) {
    if (size !== undefined) this.resizes.push({ at: 0, cols: size.cols, rows: size.rows })
  }

  get end(): number {
    return this.total
  }

  push(data: string): void {
    this.chunks.push(data)
    this.kept += data.length
    this.total += data.length
    while (this.kept > REPLAY_LIMIT && this.chunks.length > 0) {
      const first = this.chunks[0] ?? ''
      this.dropFirst(Math.min(first.length, this.kept - REPLAY_LIMIT))
    }
    // The start fell inside a sequence: drop on to its end, or all of it while the end has not come.
    while (this.dropped.inside && this.chunks.length > 0) this.removeFirst(this.dropped.skip(this.chunks[0] ?? ''))
    // A size whose output is all dropped goes; the one in force at the new start stays.
    const start = this.total - this.kept
    while (this.resizes.length > 1 && (this.resizes[1]?.at ?? Infinity) <= start) this.resizes.shift()
  }

  /** The pty now has `cols`×`rows`: the output from here on comes at that size. */
  resize(cols: number, rows: number): void {
    // A size that got no output is not needed to draw any.
    if (this.resizes.at(-1)?.at === this.total) this.resizes.pop()
    const last = this.resizes.at(-1)
    if (last !== undefined && last.cols === cols && last.rows === rows) return
    this.resizes.push({ at: this.total, cols, rows })
  }

  /**
   * The size of the pty at the start of `text()` and at each resize after it, by their place in the
   * whole stream (as `end`); the last one is the size the pty has now.
   */
  sizes(): ReplaySize[] {
    const start = this.total - this.kept
    return this.resizes.map((size) => ({ ...size, at: Math.max(size.at, start) }))
  }

  /** Drops `count` units from the start of the first chunk, reading them. */
  private dropFirst(count: number): void {
    const first = this.chunks[0] ?? ''
    this.dropped.read(count >= first.length ? first : first.slice(0, count))
    this.removeFirst(count)
  }

  private removeFirst(count: number): void {
    const first = this.chunks[0] ?? ''
    if (count >= first.length) this.chunks.shift()
    else this.chunks[0] = first.slice(count)
    this.kept -= Math.min(count, first.length)
  }

  text(): string {
    const joined = this.chunks.join('')
    this.chunks = joined === '' ? [] : [joined]
    return joined
  }
}
