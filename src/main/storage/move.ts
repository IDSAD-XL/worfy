// A move of a file or folder within one disk (rename). Windows refuses it while another process
// has a file in the folder open — an antivirus, the indexer, a page that reads the file — and that
// passes in a moment; the move is tried again there a few times. Elsewhere it is one call.
import { renameSync } from 'node:fs'

/**
 * How often and how long apart a move is tried again on Windows when it meets a busy file: half a
 * second of the calling thread at most, as one removal of src/main/storage/remove.ts.
 */
export const MOVE_RETRIES = 5
export const MOVE_RETRY_MS = 100
/** What Windows answers while another process holds a file of the moved folder, or the moved file. */
const BUSY = ['EBUSY', 'EPERM', 'EACCES']

export interface MoveOptions {
  /** The system worfy runs on; that of this process by default. */
  platform?: NodeJS.Platform
  /** The move itself; renameSync by default. */
  rename?: (from: string, to: string) => void
  /** A wait between two tries; by default the thread sleeps. */
  wait?: (ms: number) => void
}

const sleep = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Moves `from` to `to`; on Windows waits out a busy file, then throws what the last try met. */
export function moveWhenFree(from: string, to: string, options: MoveOptions = {}): void {
  const rename = options.rename ?? renameSync
  const wait = options.wait ?? sleep
  const windows = (options.platform ?? process.platform) === 'win32'
  for (let waits = 0; ; waits++) {
    try {
      rename(from, to)
      return
    } catch (error) {
      const busy = BUSY.includes((error as NodeJS.ErrnoException | null)?.code ?? '')
      if (!windows || !busy || waits === MOVE_RETRIES) throw error
      wait(MOVE_RETRY_MS)
    }
  }
}
