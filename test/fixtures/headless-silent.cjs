// A stand-in of @xterm/headless for test/contract/terminal-cursor.test.ts (worfy-windows ticket 39):
// a screen that parses nothing, so the worker acks nothing, until an empty write (the worker
// writes one for each resize) parses everything kept. CommonJS, as the worker of the screens
// loads it with require().
/* global module */
class Terminal {
  constructor() {
    this.waiting = []
  }
  onData() {
    return { dispose() {} }
  }
  write(data, done) {
    if (done) this.waiting.push(done)
    if (data !== '') return
    for (const callback of this.waiting.splice(0)) callback()
  }
  resize() {}
  dispose() {}
}

module.exports = { Terminal }
