// A failed write to stdout or stderr must not stop main (worfy-link ticket 38). When worfy was started
// by a shell, a script or a console that has since gone away, the next console.log fails, on the PC on
// 2026-10-31 with `write EPIPE` from a `[link]` line of LinkService (`Socket._write`). Node reports such
// a failure as an `error` event of process.stdout or process.stderr, and an `error` event with no
// listener is an uncaught exception: Electron then shows its modal error box, which blocks the main
// thread and with it quitting the app.
//
// Every error of these two streams is dropped, whatever its code and whatever the stream is (a pipe,
// a socket, a file, a terminal, a Windows console). The codes cannot be listed: a pipe gives EPIPE or
// EOF (libuv src/win/error.c), a terminal that hung up EIO, and a Windows console (UV_TTY) passes the
// system error through uv_translate_sys_error (libuv src/win/tty.c), so a console whose owner has gone
// may give EAGAIN (ERROR_NO_DATA) or EBADF (ERROR_INVALID_HANDLE). worfy is a GUI app: nobody reads its
// stdout, and a lost log line is better than a box that holds main. A code list would also be worse
// than no listener for a code it misses: with no `error` listener on the stream, Node's Console
// swallows the error of its own write, of any code, at least the first time; any listener on the
// stream turns that off.
//
// The link journal (src/main/link/log-file.ts, teeLinkConsole) copies a `[link]` line to its file
// right after console has printed it. A failed write to the stream surfaces later, as the `error`
// event, so the file gets the line either way, and with this listener the process lives on to write
// the next ones.
//
// Written in plain TypeScript with no import: test/contract/stdout-epipe.test.ts loads this file in a
// node child as it is.

/** The `error` listener ignoreStdioErrors puts on each stream: it drops the error. */
export function dropStdioError(): void {
  // Nowhere to report a failed write of stdout or stderr: the line is lost, the app goes on.
}

/** The part of a stream ignoreStdioErrors uses; the unit test passes an EventEmitter. */
export interface ErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown
}

/** Drops every error of each of `streams` (process.stdout and process.stderr by default). */
export function ignoreStdioErrors(streams: readonly ErrorSource[] = [process.stdout, process.stderr]): void {
  for (const stream of streams) stream.on('error', dropStdioError)
}
