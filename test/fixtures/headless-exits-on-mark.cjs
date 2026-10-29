// A stand-in of @xterm/headless for test/contract/terminal-cursor.test.ts (worfy-windows ticket 67):
// the real xterm.js, with two marks a screen may be given in its output:
// - CRASH: the worker thread ends, as a crash would end it. Only the worker of that screen ends;
//   the screens of other workers go on.
// - THREAD: the screen answers `ESC[<threadId>;1R`, the id of the worker thread it lives in, shaped
//   as a cursor-position answer so that main writes it to the pty. Two shells whose answers carry the
//   same id share a worker.
// CommonJS, as the worker loads it with require().
/* global module, process, require */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS script */
const { threadId } = require('node:worker_threads')
const headless = require('@xterm/headless')

const CRASH = '\x1b]worfy-crash\x07'
const THREAD = '\x1b]worfy-thread\x07'

class Terminal extends headless.Terminal {
  onData(listener) {
    ;(this.dataListeners ??= []).push(listener)
    return super.onData(listener)
  }
  write(data, done) {
    if (typeof data === 'string' && data.includes(CRASH)) process.exit(7)
    if (typeof data === 'string' && data.includes(THREAD)) for (const listener of this.dataListeners ?? []) listener(`\x1b[${threadId};1R`)
    return super.write(data, done)
  }
}

module.exports = { Terminal, CRASH, THREAD }
