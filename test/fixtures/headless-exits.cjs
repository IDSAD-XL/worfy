// A stand-in of @xterm/headless for test/contract/terminal-cursor.test.ts (worfy-windows ticket 39):
// the worker thread of the screens ends at the first output it is given, as a crash would end it.
// CommonJS, as the worker loads it with require().
/* global module, process */
class Terminal {
  onData() {
    return { dispose() {} }
  }
  write() {
    process.exit(7)
  }
  resize() {}
  dispose() {}
}

module.exports = { Terminal }
