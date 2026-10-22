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
 * Resizes closer together than this are one run (a drag of the Node's corner sends one per frame):
 * the run keeps one size, the last, from where it began. No one resizes a Node and runs a command
 * within 0.1 s, so the output of a command is not merged this way; within a run it is the shell's
 * redraw after each resize, which the live view, too, mostly wrote at a later size than the pty's
 * (the view resizes before main does, and the redraw comes after main's resize).
 */
export const RESIZE_RUN_MS = 100

/**
 * The most sizes kept. Each is one resize of xterm.js when a new view writes the replay, and one
 * resize over a full scrollback of 5000 lines took 2.3 ms in @xterm/headless on the Windows PC
 * (2026-10-22): 64 of them are about 0.15 s, while live output and typing wait.
 */
export const SIZES_LIMIT = 64

/** A size and when the pty took it (for the runs of resizes). */
type KeptSize = ReplaySize & { when: number }

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
  private readonly resizes: KeptSize[] = []

  /**
   * `size`: the size the pty was made with. Without it the sizes start at the first resize.
   * `now`: the clock of the runs of resizes, in ms.
   */
  constructor(
    size?: { cols: number; rows: number },
    private readonly now: () => number = () => Date.now(),
  ) {
    if (size !== undefined) this.resizes.push({ at: 0, cols: size.cols, rows: size.rows, when: this.now() })
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
    const when = this.now()
    const last = this.resizes.at(-1)
    // A size that got no output is not needed to draw any; one in a run of resizes gives way to the
    // run's last (RESIZE_RUN_MS).
    if (last !== undefined && (last.at === this.total || when - last.when < RESIZE_RUN_MS)) Object.assign(last, { cols, rows, when })
    else if (last === undefined || last.cols !== cols || last.rows !== rows) this.resizes.push({ at: this.total, cols, rows, when })
    // Back to the size before: one size covers both.
    const [before, merged] = this.resizes.slice(-2)
    if (before !== undefined && merged !== undefined && before.cols === merged.cols && before.rows === merged.rows) {
      before.when = merged.when
      this.resizes.pop()
    }
    // shortcut: past SIZES_LIMIT the oldest output is replayed at the size that came after it, which
    // can draw the first lines of the scrollback wrong; redo when a replay must be exact that far back.
    if (this.resizes.length > SIZES_LIMIT) {
      const [first, second] = this.resizes
      if (first !== undefined && second !== undefined) second.at = first.at
      this.resizes.shift()
    }
  }

  /**
   * The size of the pty at the start of `text()` and at each resize after it, by their place in the
   * whole stream (as `end`); the last one is the size the pty has now.
   */
  sizes(): ReplaySize[] {
    const start = this.total - this.kept
    return this.resizes.map(({ at, cols, rows }) => ({ at: Math.max(at, start), cols, rows }))
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
