#!/usr/bin/env node
// SessionEnd: records that a project session ended without a retrospective, so that
// hooks/session-start.mjs reminds about /retro (the threshold is the profile's session.retro_reminder_after).
//
// The project is found by bin/profile of this plugin from the session directory (the `cwd` field of the hook
// JSON, else the current folder). Writes only for a profile with the session.retro_reminder_after field: a line
// "time<TAB>directory" into <profile>/state/pending-retro.log (the state/ directory is not in git). The /retro
// skill clears the log. Otherwise nothing, code 0. Nothing is written into the repository.
//
// bin/profile runs as `node <script>` (process.execPath), not by its #! line. A failure inside the
// hook is one line on stderr and code 0.
//
// On Codex (the input tells, codex-input.mjs) a SessionEnd hook gets 1 s
// by default and 3 s at most, and Codex kills it after that (codex-rs/hooks/src/engine/discovery.rs at
// rust-v0.166.0). The hook has two steps that wait: its input, which gets at most 1 s for its first byte
// (hook-stdin.mjs), and the bin/profile call, which takes about 0.1 s; under Codex the call gets what the
// input left of CODEX_PROFILE_MS, so the hook ends inside the 3 s even when that call hangs. The lock
// is released by its own SessionEnd hook (bin/worktree-lock release).
// shortcut: a profile call that runs out of time under Codex records no line for /retro, so one
// session goes uncounted; move the step to the next SessionStart when session-end gains a step whose
// loss matters, or when the profile call is seen to take a second.
//
// For tests: CLAUDE_PROFILE_BIN, CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR, CLAUDE_HOOK_STDIN_WAIT_MS — as with
// session-start.mjs.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isCodexInput } from "./codex-input.mjs"
import { FIRST_BYTE_MS, firstByteWait, readStdin } from "./hook-stdin.mjs"

// How long the wait for the input and the bin/profile call may take together under Codex, in
// milliseconds: the rest of 3 s goes to starting node twice. A late input leaves the call less.
const CODEX_PROFILE_MS = 2000

function isDir(p) {
    try {
        return fs.statSync(p).isDirectory()
    } catch {
        return false
    }
}

// The parsed hook input, or null.
function parse(input) {
    try {
        return JSON.parse(input)
    } catch {
        return null
    }
}

// The session directory: `cwd` of the hook JSON when it is a folder, else the current folder.
function sessionDir(payload) {
    const value = payload?.cwd
    const cwd = typeof value === "string" ? value : ""
    return cwd && isDir(cwd) ? cwd : process.cwd()
}

// A JSON value as `jq -r '<path> // empty'` printed it: null and false are "", a string as it is.
function str(value) {
    if (value === null || value === undefined || value === false) return ""
    return typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value)
}

async function main() {
    // bin/profile of this plugin: the folder above hooks/, found from this script's real file.
    const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))
    const profileBin = process.env.CLAUDE_PROFILE_BIN || path.join(path.dirname(here), "bin", "profile")

    // The hook JSON on stdin (hook-stdin.mjs); "" when stdin is a terminal, cannot be read or sends nothing in time.
    const reading = Date.now()
    const payload = parse(await readStdin(firstByteWait(FIRST_BYTE_MS["session-end.mjs"], "CLAUDE_HOOK_STDIN_WAIT_MS")))
    const waited = Date.now() - reading
    const cwd = sessionDir(payload)
    const run = spawnSync(process.execPath, [profileBin, "-C", cwd, "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        // At least 1 ms: a timeout of 0 means none.
        ...(isCodexInput(payload) ? { timeout: Math.max(1, CODEX_PROFILE_MS - waited) } : {}),
    })
    if (run.error) throw run.error
    if (run.status !== 0) return
    let json
    try {
        json = JSON.parse(run.stdout)
    } catch {
        throw new Error("profile --json printed no JSON")
    }
    const after = str(json?.session?.retro_reminder_after)
    const dir = str(json?._resolved?.dir)
    if (!after || !dir || !isDir(dir)) return

    const state = path.join(dir, "state")
    fs.mkdirSync(state, { recursive: true })
    const time = new Date().toISOString().replace(/\.\d+Z$/, "Z")
    fs.appendFileSync(path.join(state, "pending-retro.log"), `${time}\t${cwd}\n`)
}

try {
    await main()
} catch (e) {
    process.stderr.write(`session-end: ${String(e?.message ?? e).split("\n")[0]}\n`)
}
process.exitCode = 0
