#!/usr/bin/env node
// UserPromptSubmit: hands the main session the Stage lines of this turn, as bin/epic-status prints them, so the
// four-line status block of the rules (rules/orchestrator.md, "Phase 3") copies its Stage line instead of
// inventing one. The eval case status-block showed that a session, told to run epic-status before the block,
// skips the run on a small turn and writes a phrase of its own.
//
// Prints, on stdout,
//   {"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":"<heading>\n<line>\n…"}}
// only when all of these hold; otherwise nothing, and exit 0:
//   - the Session is not a Product Session (WORFY_SESSION_KIND=product): its rules have no status block;
//   - the input is not of a Subagent (no agent_id or agent_type): a Subagent reports to its caller;
//   - the session directory (`cwd` of the input) belongs to a project whose profile keeps tickets
//     (`bin/profile --field tickets.path`), Silent mode included;
//   - bin/epic-status answers, and some Epic is in play.
// Epics in play, in this order, at most MAX_LINES: the Epic of the current branch (`<epic>/<NN>`), Epics
// with a claimed ticket, Epics with a blocked ticket; when none of these, the Epics that are not closed.
// Each line is the line bare epic-status prints for that Epic, cut at MAX_LINE characters; the whole text
// stays under MAX_CHARS.
//
// Codex runs the same hooks.json and has the event too (UserPromptSubmit, with additionalContext): the hook
// answers there as it does under Claude Code.
//
// A broken hook must not hold the prompt back: every failure — stdin that is not JSON, a script that fails or
// hangs past STEP_MS — is one line on stderr and exit 0. Nothing is written anywhere.
//
// For tests: CLAUDE_HOOK_STDIN_WAIT_MS shortens the wait for the input (hook-stdin.mjs);
// CLAUDE_EPIC_STATUS_BIN replaces bin/epic-status and CLAUDE_STAGE_STEP_MS shortens STEP_MS.
// Tests: hooks/tests/rules-hooks.test.sh, section 9.

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { FIRST_BYTE_MS, firstByteWait, readStdin } from "./hook-stdin.mjs"

const MAX_LINES = 3
const MAX_LINE = 300
const MAX_CHARS = 1200
// Each script the hook starts gets this long: 2 s for the input, bin/profile, then the two epic-status runs
// side by side stay within the 10 s hooks.json gives the hook.
const STEP_MS = 2500
const HEADING =
    "Stage lines of bin/epic-status for this turn. Copy one into the Stage line of the status block; after a ticket status change in this turn, run epic-status again:"

const isDir = (p) => {
    try {
        return fs.statSync(p).isDirectory()
    } catch {
        return false
    }
}

function stepMs() {
    const v = Number(process.env.CLAUDE_STAGE_STEP_MS)
    return Number.isInteger(v) && v > 0 ? Math.min(v, STEP_MS) : STEP_MS
}

/**
 * stdout of `node <script> <args>` in `cwd`, or null when it failed, exited non-zero or ran past stepMs()
 * (then it is killed and not waited for: a hung script must not hold the prompt).
 */
function run(script, args, cwd) {
    return new Promise((resolve) => {
        let child
        try {
            child = spawn(process.execPath, [script, ...args], { cwd, stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
        } catch {
            resolve(null)
            return
        }
        let out = ""
        let settled = false
        const done = (value) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            child.stdout?.destroy()
            child.unref()
            resolve(value)
        }
        const timer = setTimeout(() => {
            child.kill("SIGKILL")
            done(null)
        }, stepMs())
        child.stdout.setEncoding("utf8")
        child.stdout.on("data", (chunk) => {
            out += chunk
        })
        child.on("error", () => done(null))
        child.on("close", (code) => done(code === 0 ? out : null))
    })
}

/** The Epic a bare epic-status line is about: the first word of its second field. */
function epicOf(line) {
    const field = line.split(" · ")[1] ?? ""
    return field.split(" ")[0] ?? ""
}

/** The Epics in play, in order, without repeats. */
function inPlay(json, lines) {
    const known = new Set(lines.keys())
    const order = []
    const add = (epic) => {
        if (known.has(epic) && !order.includes(epic)) order.push(epic)
    }
    const branch = /^(.+)\/\d+$/.exec(typeof json?.ref === "string" ? json.ref : "")
    if (branch) add(branch[1])
    const tickets = Array.isArray(json?.tickets) ? json.tickets : []
    for (const state of ["work", "blocked"]) for (const t of tickets) if (t?.state === state) add(t.epic)
    if (order.length === 0) for (const [epic, line] of lines) if (!line.startsWith("closed")) add(epic)
    return order
}

async function main() {
    const input = await readStdin(firstByteWait(FIRST_BYTE_MS["stage-lines.mjs"], "CLAUDE_HOOK_STDIN_WAIT_MS"))
    if (process.env.WORFY_SESSION_KIND === "product") return
    if (!input.trim()) return
    let hook
    try {
        hook = JSON.parse(input)
    } catch {
        throw new Error("stdin is not JSON")
    }
    if (hook?.agent_id || hook?.agent_type) return
    const event = typeof hook?.hook_event_name === "string" && hook.hook_event_name ? hook.hook_event_name : "UserPromptSubmit"
    const cwd = typeof hook?.cwd === "string" && isDir(hook.cwd) ? hook.cwd : process.cwd()

    const bin = path.join(path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))), "bin")
    const tickets = await run(path.join(bin, "profile"), ["-C", cwd, "--field", "tickets.path"], cwd)
    if (!tickets || !tickets.trim()) return
    // The lines and the ticket states at once: two runs one after the other cost a second on a large project.
    const epicStatus = process.env.CLAUDE_EPIC_STATUS_BIN || path.join(bin, "epic-status")
    const [bare, raw] = await Promise.all([run(epicStatus, [], cwd), run(epicStatus, ["--json"], cwd)])
    if (bare === null) throw new Error("epic-status gave no answer")
    const lines = new Map()
    for (const line of bare.split("\n")) {
        const epic = line.includes(" · ") ? epicOf(line) : ""
        if (epic && !lines.has(epic)) lines.set(epic, line.trimEnd())
    }
    if (lines.size === 0) return
    let json = null
    try {
        json = raw === null ? null : JSON.parse(raw)
    } catch {}

    const cut = (s) => ([...s].length > MAX_LINE ? `${[...s].slice(0, MAX_LINE - 1).join("")}…` : s)
    let text = HEADING
    for (const epic of inPlay(json, lines).slice(0, MAX_LINES)) {
        const line = cut(lines.get(epic))
        if ([...text].length + 1 + [...line].length > MAX_CHARS) break
        text += `\n${line}`
    }
    if (text === HEADING) return
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }) + "\n")
}

try {
    await main()
} catch (e) {
    process.stderr.write(`stage-lines: ${String(e?.message ?? e).split("\n")[0]}\n`)
}
process.exitCode = 0
