// The file of the guard's refusals of a Session (worfy-harness-guarantees ticket 10): worfy gives every Session it
// starts, Claude Code's and Codex's, WORFY_GUARD_LOG — `<WORFY_DATA_DIR>/guard-log/<id>.jsonl`, one file per Session, the
// same over all of its processes — and the Harness's guard hook appends a JSON line to it on each refusal (the format
// is the header of harness/hooks/guard.mjs and of src/shared/autopilot/guard-deny.ts). An Autopilot run reads the
// file of its Session (GuardLogTail) and carries the refusals into its Journal as `guard-deny`.
//
// worfy writes nowhere but its data folder (ADR-0005): the folder is made there, the files are the guard's.
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { parseGuardLine, type GuardRefusal } from '../../shared/autopilot/guard-deny'
import { dataRoot } from '../storage/paths'

type Env = Readonly<Record<string, string | undefined>>

/** The folder of the Sessions' guard files. */
export function guardLogFolder(env: Env = process.env): string {
  return join(dataRoot(env), 'guard-log')
}

/** The folder, made when it is not there; null when it cannot be: the Sessions then start without the variable. */
export function makeGuardLogFolder(env: Env = process.env): string | null {
  const folder = guardLogFolder(env)
  try {
    mkdirSync(folder, { recursive: true })
    return folder
  } catch (error) {
    console.warn(`[agent] no folder for the guard's refusals, ${folder}: the Sessions start without WORFY_GUARD_LOG`, error)
    return null
  }
}

/** A new Session's file in `folder`. */
export const guardLogFile = (folder: string): string => join(folder, `${randomUUID()}.jsonl`)

/** At most this many bytes are read in one go: a run that falls far behind reads the rest the next time. */
const READ_MAX = 1 << 20

/**
 * The refusals a file gains from now on: each read() answers the whole lines appended since the last one, those
 * the guard wrote at or after `since` — a Session a run takes over keeps the refusals of the run before. A file that is
 * not there yet reads as none; one that got shorter is read again from its start.
 */
export class GuardLogTail {
  private offset = 0

  constructor(
    readonly file: string,
    private readonly since: number,
  ) {}

  async read(): Promise<GuardRefusal[]> {
    let handle
    try {
      handle = await open(this.file, 'r')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    try {
      const { size } = await handle.stat()
      if (size < this.offset) this.offset = 0
      if (size === this.offset) return []
      const length = Math.min(size - this.offset, READ_MAX)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, this.offset)
      const chunk = buffer.subarray(0, bytesRead)
      // Whole lines only: the guard may be in the middle of one.
      const end = chunk.lastIndexOf(0x0a)
      if (end < 0) {
        // No line of the guard is this long: something else wrote the file, and it is passed over.
        if (bytesRead === READ_MAX) this.offset += bytesRead
        return []
      }
      this.offset += end + 1
      return chunk
        .subarray(0, end)
        .toString('utf8')
        .split('\n')
        .flatMap((line) => {
          const refusal = parseGuardLine(line)
          return refusal !== null && Date.parse(refusal.time) >= this.since ? [refusal] : []
        })
    } finally {
      await handle.close()
    }
  }
}
