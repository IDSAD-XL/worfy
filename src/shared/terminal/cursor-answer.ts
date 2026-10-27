// What the answers of a terminal to a program look like (worfy-windows tickets 39 and 68).
//
// A program asks its terminal for something (the cursor position, the device attributes, the state
// of a mode, a colour) and xterm.js answers by sending data to the program, as if typed. Two kinds
// of answer are told apart here:
//   - the answers main gives itself (isMainAnswer): those whose answer is the same from main's
//     screen (@xterm/headless) and from a view's xterm.js, measured with xterm.js 6.0.0 — the
//     device attributes (DA1 `ESC[?1;2c`, DA2 `ESC[>0;276;0c`), the device status (`ESC[0n`), the
//     cursor position (`ESC[<row>;<column>R`, `ESC[?…R`), the state of a mode (DECRPM,
//     `ESC[?<mode>;<state>$y` and `ESC[<mode>;<state>$y`) and a setting (DECRQSS,
//     `ESC P 0|1 $ r … ESC \`). main answers these requests (src/main/terminal/cursor-answers.ts;
//     on Windows the device attributes in console-request.ts) and drops a view's marked answer to
//     them, so the shell gets one answer however many views are open;
//   - the colour answers (colourAnswers): OSC 10, 11, 12 and 4 with a colour, from a view's theme.
//     Only a view knows its theme, so these stay with the views; main passes one per query
//     (ColourAnswers in cursor-answers.ts).
// A view whose xterm.js does not say which data the user typed takes data of either shape for an
// answer (src/renderer/canvas/nodes/terminal-user-input.ts). The same bytes may also be a key:
// xterm.js sends Shift+F3 as `ESC[1;2R`, so main drops only data marked as an answer.

const ESC = '\x1b'

/** One answer main gives itself, as xterm.js gives it; see the head of the file. */
const MAIN_ANSWER = [
  // DA1 and DA2.
  String.raw`\[[?>][\d;]*c`,
  // The device status.
  String.raw`\[0n`,
  // The cursor position, plain and extended.
  String.raw`\[\??\d+;\d+R`,
  // The state of a mode, private and ANSI.
  String.raw`\[\??\d+;\d+\$y`,
  // A setting: `1 $ r <setting>` when valid, `0 $ r` when not, ended by ST.
  String.raw`P[01]\$r[^${ESC}]*${ESC}\\`,
].join('|')

/** Data made of nothing but such answers, one or more. */
const MAIN_ANSWERS = new RegExp(`^(?:${ESC}(?:${MAIN_ANSWER}))+$`)

/** Whether `data` is nothing but answers main gives itself (one or more): see the head of the file. */
export function isMainAnswer(data: string): boolean {
  return MAIN_ANSWERS.test(data)
}

/** One colour answer of xterm.js: `ESC ] <kind> ; rgb:<r>/<g>/<b> ESC \`, the kind 10, 11, 12 or `4;<index>`. */
const COLOUR_ANSWER = new RegExp(`${ESC}\\]((?:1[0-2])|(?:4;\\d+));rgb:[0-9a-f]+/[0-9a-f]+/[0-9a-f]+${ESC}\\\\`, 'gy')

/** A colour answer and which colour it tells: `10` the foreground, `11` the background, `12` the cursor, `4;<n>` a palette entry. */
export interface ColourAnswer {
  kind: string
  text: string
}

/** The colour answers `data` is made of, in order; null when it is empty or holds anything else. */
export function colourAnswers(data: string): ColourAnswer[] | null {
  const answers: ColourAnswer[] = []
  COLOUR_ANSWER.lastIndex = 0
  let at = 0
  for (let match = COLOUR_ANSWER.exec(data); match !== null; match = COLOUR_ANSWER.exec(data)) {
    answers.push({ kind: match[1] ?? '', text: match[0] })
    at = COLOUR_ANSWER.lastIndex
  }
  return answers.length > 0 && at === data.length ? answers : null
}
