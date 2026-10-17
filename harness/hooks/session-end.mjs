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
// For tests: CLAUDE_PROFILE_BIN, CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR — as with session-start.mjs.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

function readStdin() {
    if (process.stdin.isTTY) return ""
    try {
        return fs.readFileSync(0, "utf8")
    } catch {
        return ""
    }
}

function isDir(p) {
    try {
        return fs.statSync(p).isDirectory()
    } catch {
        return false
    }
}

// The session directory: `cwd` of the hook JSON when it is a folder, else the current folder.
function sessionDir(input) {
    let cwd = ""
    try {
        const value = JSON.parse(input)?.cwd
        if (typeof value === "string") cwd = value
    } catch {}
    return cwd && isDir(cwd) ? cwd : process.cwd()
}

// A JSON value as `jq -r '<path> // empty'` printed it: null and false are "", a string as it is.
function str(value) {
    if (value === null || value === undefined || value === false) return ""
    return typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value)
}

function main() {
    // bin/profile of this plugin: the folder above hooks/, found from this script's real file.
    const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))
    const profileBin = process.env.CLAUDE_PROFILE_BIN || path.join(path.dirname(here), "bin", "profile")

    const cwd = sessionDir(readStdin())
    const run = spawnSync(process.execPath, [profileBin, "-C", cwd, "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
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
    main()
} catch (e) {
    process.stderr.write(`session-end: ${String(e?.message ?? e).split("\n")[0]}\n`)
}
process.exitCode = 0
