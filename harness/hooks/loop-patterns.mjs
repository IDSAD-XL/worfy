// The loop patterns of the call log (worfy-stuck-agents/07): which repeat the newest call of an agent
// completes. A pure module: calls.mjs gives it the records of one agent's call log, newest last, and writes
// what it finds to calls/loops.jsonl — would-hint on the 3rd repeat, would-deny on the 4th. Nothing here
// reaches the agent: the log is a measurement of how often agents loop, before any hint or refusal is built.
//
// A record (calls.mjs writes it): { tool, in, out, fail, files? }
//   - tool — the tool's name;
//   - in   — the hash of the normalised input (a command without spaces at its ends; an edit's files with
//            the hash of their content after it);
//   - out  — the outcome: "ok", "fail:<hash of the error>" (Claude Code), "exit:<code>:<hash of the output>"
//            or "out:<hash of the output>" (Codex, with and without an exit code);
//   - fail — true for a failure, false for a success, null when the outcome does not say (a Codex shell
//            call: its hook input carries the output only). An unknown outcome is no failure here: a shell
//            call that succeeds the same way again (a `cat`, an `ls`) would look like a loop. It is no
//            success either: an edit of unknown outcome is not counted as one;
//   - files — for an edit, [[hash of the path, hash of the content after the edit], …].

/** How many calls of an agent the log keeps, and the patterns look at. */
export const MAX_CALLS = 20
/** The repeat that gives would-hint, and the one from which it is would-deny. */
export const HINT_AT = 3
export const DENY_AT = 4

/** The level of a repeat: would-hint on the 3rd, would-deny from the 4th, null before. */
export function levelOf(count) {
    if (count >= DENY_AT) return "would-deny"
    if (count >= HINT_AT) return "would-hint"
    return null
}

// A command that waits for CI: its non-zero exit code means "still running", so its repeats are no loop.
const CI_WAIT = /(?:^|[\s;&|(])gh\s+(?:pr\s+checks|run\s+watch|run\s+view)\b/

/** True when `command` waits for CI (gh pr checks, gh run watch, gh run view). */
export function isCiWait(command) {
    return typeof command === "string" && CI_WAIT.test(command)
}

const failed = (call) => call.fail === true
const succeeded = (call) => call.fail === false
const key = (call) => `${call.tool}\u0000${call.in}\u0000${call.out}`

// The same call with the same failed outcome: how many of `calls` repeat the newest one.
function sameFailure(calls) {
    const last = calls[calls.length - 1]
    if (!failed(last)) return 0
    const k = key(last)
    return calls.filter((call) => key(call) === k).length
}

// An edit back and forth: for a file of the newest edit, the run of returns at the end of its successful
// edits — an edit that left the content of two edits before, after one that did not. Two returns (A, B, A,
// B) are the 3rd repeat: the count is the returns plus one.
function editBackAndForth(calls) {
    const last = calls[calls.length - 1]
    if (!succeeded(last) || !Array.isArray(last.files)) return 0
    let most = 0
    for (const [file] of last.files) {
        const contents = []
        for (const call of calls) {
            if (!succeeded(call) || !Array.isArray(call.files)) continue
            for (const [f, content] of call.files) if (f === file) contents.push(content)
        }
        let returns = 0
        for (let k = contents.length - 1; k >= 2; k--) {
            if (contents[k] !== contents[k - 2] || contents[k] === contents[k - 1]) break
            returns++
        }
        if (returns > 0) most = Math.max(most, returns + 1)
    }
    return most
}

// A-B-A-B: how many times the pair of the two newest calls repeats in a row at the end, each call with the
// same outcome. Two different calls, one of them failed: two successes in turn are work, not a loop, and so
// are two calls of unknown outcome.
function abab(calls) {
    const n = calls.length
    if (n < 2) return 0
    const a = key(calls[n - 2])
    const b = key(calls[n - 1])
    if (a === b || (!failed(calls[n - 2]) && !failed(calls[n - 1]))) return 0
    let pairs = 0
    for (let i = n; i >= 2 && key(calls[i - 2]) === a && key(calls[i - 1]) === b; i -= 2) pairs++
    return pairs
}

const PATTERNS = [
    ["same-failure", sameFailure],
    ["edit-back-and-forth", editBackAndForth],
    ["abab", abab],
]

/**
 * The repeats the newest of `calls` completes: [{ pattern, count }] for each pattern it repeats at least
 * twice. Only the last MAX_CALLS calls count.
 */
export function repeats(calls) {
    if (!Array.isArray(calls) || calls.length === 0) return []
    const recent = calls.slice(-MAX_CALLS)
    const found = []
    for (const [pattern, count] of PATTERNS) {
        const n = count(recent)
        if (n >= 2) found.push({ pattern, count: n })
    }
    return found
}
