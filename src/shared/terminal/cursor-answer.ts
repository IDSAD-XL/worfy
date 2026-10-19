// What an answer to a cursor-position request looks like (worfy-windows ticket 39).
//
// A program asks its terminal where the cursor is with `ESC[6n` (or `ESC[?6n`), and xterm.js
// answers `ESC[<row>;<column>R` (`ESC[?<row>;<column>R`). main answers these requests itself and
// drops a view's marked answer to them (src/main/terminal/cursor-answers.ts); a view whose
// xterm.js does not say which data the user typed takes such data for an answer
// (src/renderer/canvas/nodes/terminal-user-input.ts). The same bytes are also a key: xterm.js
// sends Shift+F3 as `ESC[1;2R`, so only data marked as an answer is dropped.

/** What follows ESC in a cursor-position answer, as xterm.js gives it: `[<row>;<column>R`, or `[?…` for `ESC[?6n`. */
const AFTER_ESC = /^\[\??\d+;\d+R$/

/** Whether `data` is nothing but answers to cursor-position requests (`ESC[<row>;<column>R`, one or more). */
export function isCursorAnswer(data: string): boolean {
  const [before, ...answers] = data.split('\x1b')
  return before === '' && answers.length > 0 && answers.every((answer) => AFTER_ESC.test(answer))
}
