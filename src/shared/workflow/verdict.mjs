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
// (`## REJECTED`) and emphasis (`**REJECTED**`, `__VERIFIED__`, `*REJECTED*`, `_VERIFIED_`), both together too. That
// markup is not part of the verdict: the text starts at the word, and the closing emphasis is dropped where it stands
// right after the word (or after the word and its colon, `**REJECTED:**`) or at the end of the line. A word inside a
// sentence does not count, nor does a word behind a label (`Verdict: REJECTED`) or a word glued to a letter, a digit,
// `_` or `/` (`VERIFIED/REJECTED:` is a label). An answer without such a line has no verdict; the rule never guesses
// one. The reviewer itself writes the verdict bare (harness/agents/reviewer.md), and the eval grader rejected-first
// holds it to that; the readers are lenient so that an answer in another form still reads the same everywhere.

// Spaces, then an optional heading mark, then optional emphasis. Always matches.
const LEAD = /^([ \t]*)(#{1,6}[ \t]+)?(\*\*|__|\*|_)?/
const WORD = /^(NARROW:[ \t]*)?(VERIFIED|REJECTED)/
const GLUED = /^[\w/]/

/** The verdict line `line` (without its line end) cleaned of its markup, or null when it carries none. */
function verdictLine(line) {
  const lead = LEAD.exec(line)
  const after = line.slice(lead[0].length)
  const word = WORD.exec(after)
  if (!word) return null
  const emphasis = lead[3]
  let rest = after.slice(word[0].length)
  if (emphasis !== undefined) {
    if (rest.startsWith(emphasis)) rest = rest.slice(emphasis.length)
    else if (rest.startsWith(`:${emphasis}`)) rest = `:${rest.slice(1 + emphasis.length)}`
    else if (rest.trimEnd().endsWith(emphasis)) rest = rest.trimEnd().slice(0, -emphasis.length)
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
  let at = 0
  while (at <= answer.length) {
    const end = answer.indexOf('\n', at)
    const raw = answer.slice(at, end === -1 ? answer.length : end)
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const found = verdictLine(line)
    if (found) return { verdict: found.verdict, narrow: found.narrow, text: found.line + answer.slice(at + line.length), line: found.line }
    if (end === -1) break
    at = end + 1
  }
  return null
}
