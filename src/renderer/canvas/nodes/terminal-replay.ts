import type { ReplaySize } from '../../../shared/ipc/terminal'

// How a new view of a Terminal writes the output main kept (worfy-windows ticket 89): in pieces,
// each at the size of the pty it came at. Output is right only at its own size: on Windows ConPTY
// does not redraw the screen after a resize, and PSReadLine draws its line at absolute positions
// for the new size, so all of the kept output written at one size draws those lines in the wrong
// places (`marker-onene'` instead of `marker-one`). On macOS and Linux the shell redraws its line
// after a resize itself, and the same pieces draw the same screen the live view had.

/** What this module uses of an xterm.js Terminal. */
export interface ReplayTerminal {
  readonly cols: number
  readonly rows: number
  resize(cols: number, rows: number): void
  write(data: string, callback?: () => void): void
}

export interface KeptOutput {
  /** The kept output; it ends at `end` of the whole stream. */
  replay: string
  end: number
  /** The sizes of the pty it came at (terminal.open); without them it is written at the view's size. */
  sizes?: readonly ReplaySize[] | undefined
}

/**
 * Writes `kept` into `terminal`: each piece once xterm.js has parsed the one before it, after a
 * resize to the size it came at. The terminal ends at the last size, the size the pty has now;
 * `done` is called once all of it is parsed. Stops, without calling `done`, once `live` turns false
 * (the view went: its terminal is disposed).
 */
export function writeReplay(terminal: ReplayTerminal, kept: KeptOutput, done: () => void, live: () => boolean = () => true): void {
  const start = kept.end - kept.replay.length
  // Each piece: the size to take first (none for output before the first size), and its output.
  const pieces: { size?: ReplaySize; data: string }[] = []
  const sizes = kept.sizes ?? []
  // Where each size begins in `replay`, held within it and never before the size before it: sizes
  // out of order (from a main of another version) cannot write any output twice.
  const offsets: number[] = []
  for (const size of sizes) offsets.push(Math.max(offsets.at(-1) ?? 0, Math.min(Math.max(size.at - start, 0), kept.replay.length)))
  const first = offsets[0] ?? kept.replay.length
  if (sizes.length === 0 || first > 0) pieces.push({ data: kept.replay.slice(0, first) })
  sizes.forEach((size, index) => pieces.push({ size, data: kept.replay.slice(offsets[index], offsets[index + 1] ?? kept.replay.length) }))

  const next = (index: number): void => {
    if (!live()) return
    const piece = pieces[index]
    if (piece === undefined) {
      done()
      return
    }
    try {
      // xterm.js resizes at once, before the output still waiting to be parsed: so only between pieces.
      if (piece.size !== undefined && (piece.size.cols !== terminal.cols || piece.size.rows !== terminal.rows)) terminal.resize(piece.size.cols, piece.size.rows)
      if (piece.data !== '') {
        terminal.write(piece.data, () => next(index + 1))
        return
      }
    } catch (error) {
      // The view still attaches: what was written stays, the rest of the kept output is not drawn.
      console.warn('[terminal] the replay of the kept output stopped', error)
      done()
      return
    }
    next(index + 1)
  }
  next(0)
}
