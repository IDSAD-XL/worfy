// The verdict of a reviewer's answer: the one rule by which worfy reads it — from a Subagent's answer in a
// transcript (Claude Code and Codex), in the facts of the Flight Recorder and the work-track, and from the Gate's
// comments on a PR. Plain JavaScript without Node modules, so scripts/ can import it without a build (types in
// verdict.d.mts); src/shared/flight-recorder/pr-facts.mjs, which scripts/critical-path.mjs runs, does.
//
// This is the second copy of the rule of harness/lib/verdict.cjs (worfy-polish 91; the owner's decision of
// 2026-11-10); test/contract/verdict-rules-agree.test.ts holds the two together on the Harness's shared fixtures
// (harness/bin/tests/fixtures/verdict/cases.json). A change of the rule goes into both.
//
// The verdict is the first line that starts, after spaces or tabs, with the whole word VERIFIED or REJECTED,
// optionally after `NARROW:` (the narrow round's verdict). Any text before that line — a sentence about what the
// reviewer checked — is a lead-in and is dropped. Markdown in front of the word still counts: a heading mark
// (`## REJECTED`), emphasis (`**REJECTED**`, `__VERIFIED__`, `*REJECTED*`, `_VERIFIED_`) or a code span
// (`` `REJECTED: …` ``), a heading mark with one of the others too. That markup is not part of the verdict: the text
// starts at the word, and the closing mark is dropped where it stands right after the word (or after the word and
// its colon, `**REJECTED:**`) or at the end of the line. Not a verdict: a word inside a sentence, a word behind a
// label (`Verdict: REJECTED`), a quote or a list item (`> REJECTED`, `- REJECTED`, `* REJECTED`, `1. REJECTED`), a
// word glued to a letter, a digit, `_` or `/` (`VERIFIED/REJECTED:` is a label), and any line of a fenced code block
// (the rule of harness/lib/code-fence.cjs: an old verdict quoted in a block is not the answer's). A UTF-8 byte order
// mark at the start is ignored. An answer without a verdict line has no verdict; the rule never guesses one. The
// reviewer itself writes the verdict bare (harness/agents/reviewer.md), and the eval grader rejected-first holds it to
// that; the readers are lenient so that an answer in another form still reads the same everywhere.

// Spaces, then an optional heading mark, then an optional emphasis or code-span mark. Always matches.
const LEAD = /^([ \t]*)(#{1,6}[ \t]+)?(\*\*|__|\*|_|`)?/
const WORD = /^(NARROW:[ \t]*)?(VERIFIED|REJECTED)/
const GLUED = /^[\p{L}\p{N}_/]/u
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/

/**
 * A reader of code lines fed the lines of one text in order, the rule of harness/lib/code-fence.cjs: a block opens
 * with a line of indentation and three or more ` or ~, and closes only with a line of the same character, at least
 * as long, followed by nothing but spaces and tabs. True for a fence line and a line inside a block.
 */
function codeLines() {
  let open = ''
  return (line) => {
    const fence = FENCE.exec(line)
    if (open !== '') {
      if (fence && fence[1][0] === open[0] && fence[1].length >= open.length && /^[ \t]*$/.test(fence[2])) open = ''
      return true
    }
    if (fence) {
      open = fence[1]
      return true
    }
    return false
  }
}

/** The verdict line `line` (without its line end) cleaned of its markup, or null when it carries none. */
function verdictLine(line) {
  const lead = LEAD.exec(line)
  const after = line.slice(lead[0].length)
  const word = WORD.exec(after)
  if (!word) return null
  const mark = lead[3]
  let rest = after.slice(word[0].length)
  if (mark !== undefined) {
    if (rest.startsWith(mark)) rest = rest.slice(mark.length)
    else if (rest.startsWith(`:${mark}`)) rest = `:${rest.slice(1 + mark.length)}`
    else if (rest.trimEnd().endsWith(mark)) rest = rest.trimEnd().slice(0, -mark.length)
  }
  if (GLUED.test(rest)) return null
  return { narrow: word[1] !== undefined, verdict: word[2], line: word[0] + rest }
}

/**
 * The verdict of `answer`, or null when no line carries one (null for a value that is not text, too).
 * { verdict: 'VERIFIED' | 'REJECTED', narrow, text, line }: `narrow` — the line has `NARROW:` before the word;
 * `line` — the verdict line from the word on, its markup dropped, without its line end; `text` — that line and the
 * rest of the answer after it, as it is.
 */
export function findVerdict(answer) {
  if (typeof answer !== 'string') return null
  if (answer.startsWith('\uFEFF')) answer = answer.slice(1)
  const isCode = codeLines()
  let at = 0
  while (at <= answer.length) {
    const end = answer.indexOf('\n', at)
    const raw = answer.slice(at, end === -1 ? answer.length : end)
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const found = isCode(line) ? null : verdictLine(line)
    if (found) return { verdict: found.verdict, narrow: found.narrow, text: found.line + answer.slice(at + line.length), line: found.line }
    if (end === -1) break
    at = end + 1
  }
  return null
}
