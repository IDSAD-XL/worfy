// The verdict of a reviewer's answer: the one rule by which the Harness reads it (bin/verdict, which a
// skill or a script runs before it saves or posts a verdict). The worfy app keeps a copy of the rule
// (src/shared/workflow/verdict.mjs), and a contract test of the app holds the two together on the shared
// fixtures bin/tests/fixtures/verdict/cases.json, with the grader rejected-first of the eval case
// reviewer-verdict.
//
// The verdict is the first line that starts, after spaces or tabs, with the whole word VERIFIED or
// REJECTED, optionally after `NARROW:` (the narrow round's verdict, skills/epic-wave/SKILL.md). Any text
// before that line — a sentence about what the reviewer checked — is a lead-in and is dropped. A word
// inside a sentence does not count, nor does a word with markup or a label in front (`**REJECTED`,
// `## REJECTED`, `Verdict: REJECTED`) or the label `VERIFIED/REJECTED:`, whose first word is followed by
// a slash: the reviewer writes the verdict bare (agents/reviewer.md). An
// answer without such a line has no verdict; the rule never guesses one.
"use strict"

const VERDICT_LINE = /^([ \t]*)(NARROW:[ \t]*)?(VERIFIED|REJECTED)(?![\w/])/

/**
 * The verdict of `answer`, or null when no line carries one (null for a value that is not text, too).
 * { verdict: "VERIFIED" | "REJECTED", narrow, text, line }: `narrow` — the line starts with `NARROW:`;
 * `text` — the answer from the verdict line on, without the spaces in front of it; `line` — the first
 * line of `text`, without its line end.
 */
function findVerdict(answer) {
    if (typeof answer !== "string") return null
    let at = 0
    while (at <= answer.length) {
        const end = answer.indexOf("\n", at)
        const stop = end === -1 ? answer.length : end
        const raw = answer.slice(at, stop)
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
        const match = VERDICT_LINE.exec(line)
        if (match) {
            const start = at + match[1].length
            return { verdict: match[3], narrow: match[2] !== undefined, text: answer.slice(start), line: line.slice(match[1].length) }
        }
        if (end === -1) break
        at = end + 1
    }
    return null
}

module.exports = { findVerdict }
