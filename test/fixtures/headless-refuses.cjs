// A stand-in of @xterm/headless for test/contract/terminal-cursor.test.ts (worfy-windows ticket 39):
// its write throws as xterm.js does once more than 50 MB wait to be parsed. CommonJS, as the
// worker of the screens loads it with require().
/* global module */
class Terminal {
  onData() {
    return { dispose() {} }
  }
  write() {
    throw new Error('write data discarded, use flow control to avoid losing data')
  }
  resize() {}
  dispose() {}
}

module.exports = { Terminal }
