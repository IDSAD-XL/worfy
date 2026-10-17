#!/usr/bin/env node
// SessionStart: mixes the project's context from its profile into a new session.
//
// Which project it is, is decided by bin/profile of this plugin from the session directory (the `cwd` field of
// the hook JSON, else the current folder): the registry $HARNESS_HOME/gate/config.json, the entry's "profile"
// field. A directory outside the registered projects, a project without a profile, or a profile without
// `session.inject_rules: true` and without `session.retro_reminder_after` — print nothing, code 0. That way the
// Auction session start stays empty, as it was.
//
// What is mixed in (the format is profiles/README.md, the `session` field); item 0 in a Silent project or with
// `attribution: off`, items 1–3 only with session.inject_rules: true, item 4 with any session.retro_reminder_after:
//   0. the workflow mode: in Silent mode (mode "silent") where the workflow files live (the Workflow folder)
//      and that branches, commits and PRs carry no trace of the workflow; with `attribution: off` that commits
//      and PRs carry no Claude attribution lines. A Full project with attribution on gets nothing here;
//   1. the profile's rules.md without the section «## Sources» / «## Источники» (it is for the maintainer,
//      not for the agent), under the heading session.rules_heading;
//   2. the lessons index <profile>/lessons/lessons-index.md, if the lessons live in the profile
//      (`lessons: "profile"`);
//   3. the active epic's map: <profile>/state/active-epic -> <profile>/epics/<epic>/map.md;
//   4. a reminder about /retro, if <profile>/state/pending-retro.log has at least
//      session.retro_reminder_after lines (hooks/session-end.mjs appends them).
// Each section is at most CLAUDE_SESSION_SECTION_CAP bytes (20000 by default); a longer one is
// cut at a line boundary, and the last line is "… truncated, full text: <path>".
// A path under the home folder (os.homedir(); on Windows that is USERPROFILE) is shown as ~/….
// Nothing is written into the repository.
//
// bin/profile runs as `node <script>` (process.execPath), not by its #! line: Windows starts no
// script that way. A failure inside the hook is one line on stderr and code 0: a broken hook must
// not break the session.
//
// For tests: CLAUDE_PROFILE_BIN replaces bin/profile; CLAUDE_GATE_CONFIG and
// CLAUDE_PROFILES_DIR go to profile as they are. Tests: hooks/tests/session-hooks.test.sh.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_CAP = 20000

// The hook JSON on stdin; "" when stdin is a terminal or cannot be read.
function readStdin() {
    if (process.stdin.isTTY) return ""
    try {
        return fs.readFileSync(0, "utf8")
    } catch {
        return ""
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

function isDir(p) {
    try {
        return fs.statSync(p).isDirectory()
    } catch {
        return false
    }
}

// The text of a non-empty file without its trailing line breaks, or "" (no file, empty, unreadable).
function readText(p) {
    try {
        return fs.readFileSync(p, "utf8").replace(/\n+$/, "")
    } catch {
        return ""
    }
}

// A JSON value as `jq -r '<path> // empty'` printed it: null and false are "", a string as it is.
function str(value) {
    if (value === null || value === undefined || value === false) return ""
    return typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value)
}

// `p` with the home folder at its start shown as ~. On Windows the comparison ignores the separator
// and letter case, and the path is spelled with /, so ~/… and D:/… read the same in Git Bash and PowerShell.
function tilde(p, home = os.homedir(), platform = process.platform) {
    if (!p) return p
    const win = platform === "win32"
    if (!home) return win ? p.replaceAll("\\", "/") : p
    const fold = (s) => (win ? s.replaceAll("\\", "/").toLowerCase() : s)
    const base = home.replace(win ? /[\\/]+$/ : /\/+$/, "")
    const h = fold(base)
    const f = fold(p)
    if (f !== h && !f.startsWith(h + "/")) return win ? p.replaceAll("\\", "/") : p
    const rest = p.slice(base.length)
    return "~" + (win ? rest.replaceAll("\\", "/") : rest)
}

// `text` cut to at most `cap` bytes at a line boundary (that way UTF-8 is not torn), plus the line
// that names the file with the full text. Text within the limit comes back as it is.
function capped(text, cap, file) {
    const bytes = Buffer.from(text, "utf8")
    if (bytes.length <= cap) return text
    // Take cap+1 bytes: if the last of them is a newline, the boundary fell exactly on the end of a
    // line and all lines are whole; otherwise the last line is incomplete and is dropped.
    const chunk = bytes.subarray(0, cap + 1)
    let cut
    if (chunk[chunk.length - 1] === 0x0a) cut = chunk.subarray(0, chunk.length - 1).toString("utf8")
    else {
        const nl = chunk.lastIndexOf(0x0a)
        cut = nl < 0 ? "" : chunk.subarray(0, nl).toString("utf8").replace(/\n+$/, "")
    }
    if (!cut) {
        // One line longer than the limit: its first cap bytes, without a character torn at the end.
        let end = cap
        while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
        cut = bytes.subarray(0, end).toString("utf8")
    }
    return `${cut}\n… truncated, full text: ${file || "the source file"}`
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
    const session = json?.session ?? {}
    const resolved = json?._resolved ?? {}
    const inject = session.inject_rules === true || session.inject_rules === "true"
    const after = str(session.retro_reminder_after)
    const mode = str(resolved.mode)
    const attribution = str(json?.attribution)
    if (!inject && !after && mode !== "silent" && attribution !== "off") return

    const name = str(resolved.name)
    const dir = str(resolved.dir)
    if (!dir || !isDir(dir)) return
    const state = path.join(dir, "state")

    // Each section is at most CAP bytes: an epic map or a lessons index grown to hundreds of
    // kilobytes would eat the context of every session.
    const capEnv = process.env.CLAUDE_SESSION_SECTION_CAP ?? ""
    const cap = /^[0-9]+$/.test(capEnv) ? Number(capEnv) : DEFAULT_CAP
    let ctx = ""
    const add = (heading, text, file) => {
        if (!text) return
        ctx += `\n## ${heading}\n${capped(text, cap, file)}\n`
    }

    // The workflow mode goes first: it decides where every document of the session is written.
    let modetext = ""
    if (mode === "silent") {
        const wf = str(resolved.workflow_folder)
        modetext += `This project works in Silent mode. Its workflow files — tickets, epic specs, the state file, ADRs, the glossary, lessons, evidence screenshots — live in the Workflow folder ${tilde(wf)}, not in the repository; relative paths of the profile's tickets and docs fields are taken from that folder, and \`ticket\` writes the status there from any worktree. Documents in the repository are read-only, unless the ticket's own goal is a document for the team.\n`
        modetext += "Branches, commit messages, PR titles, descriptions and comments, and code comments describe the change itself: no epic names, ticket or ADR numbers, Workflow folder paths, `.scratch` or `HANDOFF`. Name a branch by what it changes (`fix/lot-withdraw-button`) and record it with `ticket claim <epic> <NN> --branch <branch>`. The Bash guard refuses commits, branch names and PR texts with such traces (`bin/silent-check` shows them).\n"
    }
    if (attribution === "off") {
        modetext +=
            "Attribution is off for this project: commit messages and PR descriptions carry no Claude attribution lines (`Co-Authored-By: Claude …`, `Generated with [Claude Code]`) — leave them out even where other instructions ask for them; the Bash guard refuses commits and PR texts that carry them.\n"
    }
    add(`Workflow mode (profile ${name})`, modetext.replace(/\n$/, ""))

    const rulesFile = path.join(dir, "rules.md")
    if (inject && readText(rulesFile)) {
        let skip = false
        const kept = []
        for (const line of fs.readFileSync(rulesFile, "utf8").split("\n")) {
            if (line.startsWith("## ")) skip = /^## (Sources|Источники)/.test(line)
            if (!skip) kept.push(line)
        }
        const heading = str(session.rules_heading)
        add(heading || `Project rules (profile ${name})`, kept.join("\n").replace(/\n+$/, ""), rulesFile)
    }

    const lessonsIndex = path.join(dir, "lessons", "lessons-index.md")
    if (inject && str(json?.lessons) === "profile") {
        const text = readText(lessonsIndex)
        const log = tilde(path.join(dir, "lessons", "lessons.md"))
        if (text) add(`Lessons learned so far (one-liners; full log in ${log})`, text, lessonsIndex)
    }

    const active = readText(path.join(state, "active-epic"))
    if (inject && active) {
        const map = path.join(dir, "epics", active, "map.md")
        const text = readText(map)
        if (text) add(`Active epic: ${active}`, text, map)
    }

    if (/^-?[0-9]+$/.test(after)) {
        let pending = 0
        try {
            pending = (fs.readFileSync(path.join(state, "pending-retro.log"), "utf8").match(/\n/g) || []).length
        } catch {}
        if (pending >= Number(after)) {
            add("Housekeeping", `${pending} sessions have ended without a retrospective. Suggest running /retro when this session reaches a natural pause.`)
        }
    }

    if (!ctx) return
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx } }) + "\n")
}

try {
    main()
} catch (e) {
    process.stderr.write(`session-start: ${String(e?.message ?? e).split("\n")[0]}\n`)
}
process.exitCode = 0
