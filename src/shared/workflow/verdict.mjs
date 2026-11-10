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
// reviewer checked — is a lead-in and is dropped. A word inside a sentence does not count, nor does a word with
// markup or a label in front (`**REJECTED`, `## REJECTED`, `Verdict: REJECTED`) or the label `VERIFIED/REJECTED:`,
// whose first word is followed by a slash: the reviewer writes the verdict bare (harness/agents/reviewer.md). An answer without such a line has no verdict; the rule never guesses one.

const VERDICT_LINE = /^([ \t]*)(NARROW:[ \t]*)?(VERIFIED|REJECTED)(?![\w/])/

/**
 * The verdict of `answer`, or null when no line carries one (null for a value that is not text, too).
 * { verdict: 'VERIFIED' | 'REJECTED', narrow, text, line }: `narrow` — the line starts with `NARROW:`; `text` — the
 * answer from the verdict line on, without the spaces in front of it; `line` — the first line of `text`, without
 * its line end.
 */
export function findVerdict(answer) {
  if (typeof answer !== 'string') return null
  let at = 0
  while (at <= answer.length) {
    const end = answer.indexOf('\n', at)
    const raw = answer.slice(at, end === -1 ? answer.length : end)
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const match = VERDICT_LINE.exec(line)
    if (match) return { verdict: match[3], narrow: match[2] !== undefined, text: answer.slice(at + match[1].length), line: line.slice(match[1].length) }
    if (end === -1) break
    at = end + 1
  }
  return null
}
