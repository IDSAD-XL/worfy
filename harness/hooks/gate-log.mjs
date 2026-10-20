// The output logs of the gate. gate.mjs prints only the last 40 lines of a failed script, and
// nothing of a script that passed; the whole output of every script it runs goes to a file here:
//   <state>/logs/<worktree tag>/<run>/<NN>-<label>.log
// <run> is the UTC time the run started and the gate's pid (2026-10-20T12-00-00Z-4242), so the
// names sort by time. The newest LOG_RUNS_KEPT runs of a worktree are kept; the folder of another
// worktree untouched for more than eight days is removed with everything in it, as the markers of
// abandoned sessions are (removeOld in gate.mjs).
//
// For output shaped like the list reporter of Playwright, the report of a failed script also gets
// the failure blocks that lie above its last 40 lines: the error text, the locator and the call
// log are printed there, and the last 40 lines hold only the summary. The shape decides, not the
// name of the script: the gate is shared by projects that call their scripts differently.
//
// Node only, no shell utility: the same code runs on macOS, Linux and Windows.

import fs from "node:fs"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"

export const LOG_RUNS_KEPT = 10
const STALE_MS = 8 * 24 * 60 * 60 * 1000
const RUN_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-\d+$/

// The folder of this run's logs. A colon is not allowed in a file name on Windows.
export function runLogDir(state, tag, now = new Date(), pid = process.pid) {
    const stamp = now.toISOString().replace(/\.\d+Z$/, "Z").replaceAll(":", "-")
    return path.join(state, "logs", tag, `${stamp}-${pid}`)
}

// Writes `out` to <dir>/<name> and returns the path, or null when the file could not be written
// (a full disk, a folder without rights): the log is a help to the reader, and the verdict of the
// run does not depend on it.
export function writeScriptLog(dir, name, out) {
    const file = path.join(dir, name)
    try {
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(file, out ? `${out}\n` : "")
        return file
    } catch {
        return null
    }
}

// Removes all run folders of the worktree but the newest `keep - 1` and `current`, and the
// folders of other worktrees not touched for more than eight days. Errors are left alone: a
// folder another gate is writing to at that moment stays for the next run to remove.
export function pruneLogs(state, tag, current, keep = LOG_RUNS_KEPT, now = Date.now()) {
    const root = path.join(state, "logs")
    const rm = (dir) => {
        try {
            fs.rmSync(dir, { recursive: true, force: true })
        } catch {}
    }
    const list = (dir) => {
        try {
            return fs.readdirSync(dir)
        } catch {
            return []
        }
    }
    const mine = path.join(root, tag)
    const runs = list(mine)
        .filter((name) => RUN_NAME.test(name) && path.join(mine, name) !== current)
        .sort()
    for (const name of runs.slice(0, Math.max(0, runs.length - (keep - 1)))) rm(path.join(mine, name))
    for (const other of list(root)) {
        if (other === tag) continue
        try {
            if (now - fs.statSync(path.join(root, other)).mtimeMs > STALE_MS) rm(path.join(root, other))
        } catch {}
    }
}

// The list reporter of Playwright names each failure by a numbered heading with the file, line and
// column of the test: «  1) test/e2e/x.spec.ts:20:3 › suite › title ───» (with projects:
// «  1) [chromium] › test/x.spec.ts:20:3 › title»). The summary after the blocks starts with
// «  2 failed», «  10 passed (2.0m)» and the like.
const PW_HEADING = /^\s*\d+\) \S.*:\d+:\d+ › /
const PW_SUMMARY = /^\s*\d+ (failed|flaky|passed|skipped|interrupted|did not run)\b/
export const PW_BLOCK_LINES_MAX = 60
export const PW_LINES_MAX = 200
const LINE_CHARS_MAX = 500

// The failure blocks of Playwright-shaped output that start above the line `before` (the first
// line of the tail the report prints anyway), each from its heading to the next heading or the
// summary, cut at `before`. At most PW_BLOCK_LINES_MAX lines a block, PW_LINES_MAX lines in all,
// each line at most LINE_CHARS_MAX characters; a cut is said in a line of its own. Empty when the
// output has no such heading above the tail.
export function playwrightFailures(lines, before = lines.length) {
    const plain = lines.map(stripVTControlCharacters)
    const picked = []
    let cut = 0
    for (let i = 0; i < before; i++) {
        if (!PW_HEADING.test(plain[i])) continue
        let end = i + 1
        while (end < before && !PW_HEADING.test(plain[end]) && !PW_SUMMARY.test(plain[end])) end++
        let block = plain.slice(i, end)
        while (block.length && !block.at(-1).trim()) block.pop()
        const room = Math.min(PW_BLOCK_LINES_MAX, PW_LINES_MAX - picked.length)
        if (block.length > room) {
            cut += block.length - room
            block = block.slice(0, room)
        }
        picked.push(...block.map((line) => (line.length > LINE_CHARS_MAX ? `${line.slice(0, LINE_CHARS_MAX)} …` : line)))
        i = end - 1
    }
    if (cut) picked.push(`… ${cut} more lines in the full output`)
    return picked
}
