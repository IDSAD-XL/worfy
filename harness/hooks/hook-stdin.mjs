// The hook input: stdin read as a stream to its end, for the hooks that also need to know whether stdin
// is a terminal.
//
// Not fs.readFileSync(0) after a look at process.stdin: once process.stdin has been touched (its isTTY,
// say), Node holds a pipe on descriptor 0 in non-blocking mode, and a synchronous read of it fails with
// EAGAIN when the input has not arrived yet — under load the writer is late. The hook then took the
// input for empty (PR #1464 found it in stop.mjs). A hook that never touches process.stdin may keep its
// synchronous read: the pipe stays blocking and the read waits for the writer (inject-rules.mjs).
//
// A pipe that stays open and sends nothing gets the hook's FIRST_BYTE_MS for its first byte, then the
// input is empty: without a limit the hook would wait until its own limit in hooks.json and be killed
// with nothing done. Once the first byte has come, the input is read to its end. A terminal gives "":
// a hook always gets its input on a pipe, and a person at a terminal sends none.
//
// Tests: test/contract/harness-hook-stdin.test.ts; for stop.mjs test/contract/harness-codex-hooks.test.ts.

/**
 * How long each hook waits for the first byte of its input, in milliseconds: at most half of its limit
 * in hooks.json, so the other half is left for its own work.
 *   - stop.mjs (900 s): 30 s, not the 2 s of silence gate.mjs allows a manual run: a late hook input is
 *     exactly what this reader is for.
 *   - session-start.mjs (15 s) and gh-token-env.mjs (10 s): 5 s; then bin/profile, and gh for
 *     gh-token-env, take well under a second.
 *   - session-end.mjs (10 s; on Codex 3 s at most): 1 s; the bin/profile call gets what is left of its
 *     2 s on Codex (CODEX_PROFILE_MS there), so the hook ends inside the 3 s.
 */
export const FIRST_BYTE_MS = {
    "stop.mjs": 30_000,
    "session-start.mjs": 5_000,
    "gh-token-env.mjs": 5_000,
    "session-end.mjs": 1_000,
}

/** `defaultMs`, or the variable `name` when it is a positive whole number below it: a test may shorten the wait, never lengthen it. */
export function firstByteWait(defaultMs, name) {
    const v = Number(process.env[name])
    return Number.isInteger(v) && v > 0 ? Math.min(v, defaultMs) : defaultMs
}

/** The hook input as text; "" from a terminal, a closed descriptor 0, a read error or no first byte within `firstByteMs`. */
export function readStdin(firstByteMs) {
    let stdin
    try {
        stdin = process.stdin // a closed descriptor 0 makes this getter throw
    } catch {
        return Promise.resolve("")
    }
    if (stdin.isTTY) return Promise.resolve("")
    return new Promise((resolve) => {
        let text = ""
        const done = (value) => {
            clearTimeout(timer)
            stdin.removeAllListeners("data")
            stdin.removeAllListeners("end")
            stdin.removeAllListeners("error")
            // An open pipe would keep the process alive after the hook has decided.
            stdin.destroy()
            resolve(value)
        }
        const timer = setTimeout(() => done(""), firstByteMs)
        stdin.setEncoding("utf8")
        stdin.on("data", (chunk) => {
            clearTimeout(timer)
            text += chunk
        })
        stdin.on("end", () => done(text))
        stdin.on("error", () => done(""))
    })
}
