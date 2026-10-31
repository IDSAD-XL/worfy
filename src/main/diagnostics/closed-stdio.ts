// A write to a stdout or stderr nobody reads any more must not stop main (worfy-link ticket 38).
// When worfy was started by a shell, a script or a console that has since gone away, the next
// console.log fails with `write EPIPE`. Node reports that as an `error` event of process.stdout,
// and an `error` event without a listener is an uncaught exception: Electron then shows its modal
// error box, which blocks the main thread and with it quitting the app (seen on the PC on
// 2026-10-31: a `[link]` line of LinkService, `Socket._write`, `Error: write EPIPE`).
//
// One listener per stream, whatever the stream is (a pipe, a socket, a console, a terminal): an error
// that says the stream is closed, or EIO, is dropped, since there is nowhere left to write; any other
// error is thrown on, and stays the uncaught exception it was without the listener. The link journal
// (src/main/link/log-file.ts) writes its file before console does, so its lines still arrive.
// Written in plain TypeScript with no import: test/contract/stdout-epipe.test.ts loads this file in a
// node child as it is.

/**
 * The error codes of a write to stdout or stderr that are dropped: those of a stream whose reader has
 * gone, and EIO. A write error of these streams is never worth Electron's modal box.
 * - EPIPE: the reader of a pipe or socket closed it. On Windows libuv gives it for a failed write with
 *   ERROR_BROKEN_PIPE or ERROR_NO_DATA (uv_translate_write_sys_error) and for ERROR_PIPE_NOT_CONNECTED
 *   (uv_translate_sys_error), both in libuv's src/win/error.c.
 * - EOF: what uv_translate_sys_error makes of ERROR_BROKEN_PIPE, for a path of libuv that does not go
 *   through the write translation above (same file).
 * - ERR_STREAM_DESTROYED: a write Node refuses because the stream was already destroyed.
 * - EIO: a write to a terminal that has hung up (the window that started worfy was closed). POSIX
 *   write() gives EIO in two more cases where the stream is still there: a background process group
 *   that is orphaned writes to its controlling terminal while TOSTOP is set, and a physical I/O error
 *   of the file stdout was redirected to. Dropped all the same: the line is lost, the app goes on.
 */
export const CLOSED_STREAM_CODES: readonly string[] = ['EPIPE', 'EOF', 'ERR_STREAM_DESTROYED', 'EIO']

/** Whether `error` only says that the stream it came from has nowhere left to write. */
export function isClosedStreamError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && CLOSED_STREAM_CODES.includes(code)
}

/** The part of a stream ignoreClosedStdio uses; the unit test passes an EventEmitter. */
export interface ErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown
}

/** Drops the errors of a closed stream on each of `streams` (process.stdout and process.stderr by default). */
export function ignoreClosedStdio(streams: readonly ErrorSource[] = [process.stdout, process.stderr]): void {
  for (const stream of streams) {
    stream.on('error', (error) => {
      if (isClosedStreamError(error)) return
      throw error
    })
  }
}
