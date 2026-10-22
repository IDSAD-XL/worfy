// The output a Terminal keeps for redrawing it. Moved out of pty.ts unchanged (worfy-windows ticket
// 42); pty.ts exports these names as before.
import { OscCutScanner } from './osc'

/** Output kept per terminal for redrawing it, in UTF-16 code units (one per character of ASCII). */
export const REPLAY_LIMIT = 256 * 1024

/**
 * The last REPLAY_LIMIT units of a stream, and the length of the whole stream. When the start of
 * what is kept falls inside an OSC sequence, the start is cut further, to the end of that sequence:
 * a new screen would print its tail (with the nonce of the shell) as text.
 */
export class ReplayBuffer {
  private chunks: string[] = []
  private kept = 0
  private total = 0
  /** Follows the part of the stream already dropped. */
  private readonly dropped = new OscCutScanner()

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
