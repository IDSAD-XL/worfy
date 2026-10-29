// A stand-in of @xterm/headless for test/contract/terminal-cursor.test.ts (worfy-windows ticket 67):
// the real xterm.js, except that the worker thread ends when a screen is given CRASH, as a crash
// would end it. Only the worker of that screen ends; the screens of other workers go on.
// CommonJS, as the worker loads it with require().
/* global module, process, require */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS script */
const headless = require('@xterm/headless')

const CRASH = '\x1b]worfy-crash\x07'

class Terminal extends headless.Terminal {
  write(data, done) {
    if (typeof data === 'string' && data.includes(CRASH)) process.exit(7)
    return super.write(data, done)
  }
}

module.exports = { Terminal, CRASH }
