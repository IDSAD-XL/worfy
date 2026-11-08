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
//     (`tickets.path` of `bin/profile --json`), Silent mode included;
//   - bin/epic-status answers, and some Epic is in play.
//
// Epics in play, in this order, at most MAX_LINES:
//   1. the Epic of the current branch, when the branch has the profile's form (`tickets.branch`, e.g.
//      `<epic>/<NN>`); its line comes from `epic-status <epic>`, which also names the branch;
//   2. Epics with a claimed ticket in this tree (Silent mode, or a claim committed where the session is);
//   3. Epics of the local branches of that form, newest commit first, whose ticket is not done in this tree:
//      a claim lives on its ticket branch, so the main checkout sees only the branch, not the claim;
//   4. only when 1–3 found none: the Epics that are not closed, those whose next ticket is blocked last.
// Each line is the line epic-status prints for that Epic, cut to MAX_LINE characters with "…"; so the
// whole text is at most the heading and MAX_LINES × (MAX_LINE + 1) characters.
//
// Codex runs the same hooks.json and has the event too (UserPromptSubmit, with additionalContext): the hook
// answers there as it does under Claude Code.
//
// A broken hook must not hold the prompt back: every failure — stdin that is not JSON, bin/profile failing
// (other than exit 3, a directory of no registered project) or epic-status failing, or either running past
// STEP_MS (then it is killed) — is one line on stderr and exit 0. Nothing is written anywhere.
//
// For tests: CLAUDE_HOOK_STDIN_WAIT_MS shortens the wait for the input (hook-stdin.mjs);
// CLAUDE_PROFILE_BIN replaces bin/profile, CLAUDE_EPIC_STATUS_BIN replaces bin/epic-status, and
// CLAUDE_STAGE_STEP_MS shortens STEP_MS. Tests: hooks/tests/rules-hooks.test.sh, section 9.

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { git as GIT } from "./eval-env.cjs"
import { FIRST_BYTE_MS, firstByteWait, readStdin } from "./hook-stdin.mjs"

const MAX_LINES = 3
const MAX_LINE = 300
// Each program the hook starts gets this long: 2 s for the input, bin/profile and git, then the epic-status
// runs side by side stay within the 10 s hooks.json gives the hook.
const STEP_MS = 2500
// bin/profile: the directory belongs to no registered project.
const NOT_REGISTERED = 3
const HEADING =
    "Stage lines of bin/epic-status for this turn. Copy the line of the epic of the work at hand into the Stage line of the status block. If that epic has no line here, or a ticket status changed in this turn, run epic-status <epic> and copy its line:"

class Quiet extends Error {}

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
 * Runs `command args` in `cwd`: {code, out}, code null when it could not start or ran past stepMs() (then it
 * is killed and not waited for: a hung program must not hold the prompt).
 */
function run(command, args, cwd) {
    return new Promise((resolve) => {
        let child
        try {
            child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "ignore"], windowsHide: true })
        } catch {
            resolve({ code: null, out: "", timedOut: false })
            return
        }
        let out = ""
        let settled = false
        const done = (code, timedOut = false) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            child.stdout?.destroy()
            child.unref()
            resolve({ code, out, timedOut })
        }
        const timer = setTimeout(() => {
            child.kill("SIGKILL")
            done(null, true)
        }, stepMs())
        child.stdout.setEncoding("utf8")
        child.stdout.on("data", (chunk) => {
            out += chunk
        })
        child.on("error", () => done(null))
        child.on("close", (code) => done(code))
    })
}

const node = (script, args, cwd) => run(process.execPath, [script, ...args], cwd)
const why = (r) => (r.timedOut ? `ran past ${stepMs()} ms` : r.code === null ? "did not start" : `exit ${r.code}`)

/** The Epic a bare epic-status line is about: the first word of its second field. */
function epicOf(line) {
    const field = line.split(" · ")[1] ?? ""
    return field.split(" ")[0] ?? ""
}

/** A matcher of the profile's branch form (`<epic>/<NN>`): branch name -> {epic, num}, or null. */
function branchForm(template) {
    if (typeof template !== "string" || !template.includes("<epic>") || !template.includes("<NN>")) return () => null
    const epicFirst = template.indexOf("<epic>") < template.indexOf("<NN>")
    const source = template
        .split(/(<epic>|<NN>)/)
        .map((part) => (part === "<epic>" ? "([^/\\s]+)" : part === "<NN>" ? "(\\d+)" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("")
    const re = new RegExp(`^${source}$`)
    return (name) => {
        const m = re.exec(name)
        if (!m) return null
        return epicFirst ? { epic: m[1], num: Number(m[2]) } : { epic: m[2], num: Number(m[1]) }
    }
}

/** The Epics in play, in order, without repeats (see the header). */
function inPlay({ lines, tickets, current, branches }) {
    const order = []
    const add = (epic) => {
        if (lines.has(epic) && !order.includes(epic)) order.push(epic)
    }
    if (current) add(current.epic)
    for (const t of tickets) if (t?.state === "work") add(t.epic)
    const done = new Set(tickets.filter((t) => t?.state === "done").map((t) => `${t.epic}/${t.num}`))
    for (const b of branches) if (!done.has(`${b.epic}/${b.num}`)) add(b.epic)
    if (order.length > 0) return order
    const open = [...lines].filter(([, line]) => !line.startsWith("closed"))
    for (const [epic, line] of open) if (!line.endsWith(" · blocked")) add(epic)
    for (const [epic] of open) add(epic)
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
        throw new Quiet("stdin is not JSON")
    }
    if (hook?.agent_id || hook?.agent_type) return
    const event = typeof hook?.hook_event_name === "string" && hook.hook_event_name ? hook.hook_event_name : "UserPromptSubmit"
    const cwd = typeof hook?.cwd === "string" && isDir(hook.cwd) ? hook.cwd : process.cwd()

    const bin = path.join(path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))), "bin")
    const profile = await node(process.env.CLAUDE_PROFILE_BIN || path.join(bin, "profile"), ["-C", cwd, "--json"], cwd)
    if (profile.code === NOT_REGISTERED) return
    if (profile.code !== 0) throw new Quiet(`bin/profile ${why(profile)}`)
    let tickets
    try {
        tickets = JSON.parse(profile.out)?.tickets
    } catch {
        throw new Quiet("bin/profile --json printed no JSON")
    }
    if (typeof tickets?.path !== "string" || !tickets.path.trim()) return

    const form = branchForm(tickets.branch)
    const [head, refs] = await Promise.all([
        run(GIT, ["rev-parse", "--abbrev-ref", "HEAD"], cwd),
        run(GIT, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"], cwd),
    ])
    const current = head.code === 0 ? form(head.out.trim()) : null
    const branches = refs.code === 0 ? refs.out.split("\n").map((name) => form(name.trim())).filter(Boolean) : []

    // The lines, the ticket states and the current branch's own line at once: one after the other they cost
    // a second on a large project.
    const epicStatus = process.env.CLAUDE_EPIC_STATUS_BIN || path.join(bin, "epic-status")
    const [bare, raw, own] = await Promise.all([
        node(epicStatus, [], cwd),
        node(epicStatus, ["--json"], cwd),
        current ? node(epicStatus, [current.epic], cwd) : Promise.resolve(null),
    ])
    if (bare.code !== 0) throw new Quiet(`bin/epic-status ${why(bare)}`)
    const lines = new Map()
    for (const line of bare.out.split("\n")) {
        const epic = line.includes(" · ") ? epicOf(line) : ""
        if (epic && !lines.has(epic)) lines.set(epic, line.trimEnd())
    }
    if (lines.size === 0) return
    const ownLine = own?.code === 0 ? own.out.split("\n").find((l) => epicOf(l) === current.epic) : undefined
    if (ownLine) lines.set(current.epic, ownLine.trimEnd())
    let all = []
    try {
        const parsed = raw.code === 0 ? JSON.parse(raw.out) : null
        if (Array.isArray(parsed?.tickets)) all = parsed.tickets
    } catch {}

    const cut = (s) => ([...s].length > MAX_LINE ? `${[...s].slice(0, MAX_LINE - 1).join("")}…` : s)
    const chosen = inPlay({ lines, tickets: all, current, branches }).slice(0, MAX_LINES)
    if (chosen.length === 0) return
    const additionalContext = [HEADING, ...chosen.map((epic) => cut(lines.get(epic)))].join("\n")
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }) + "\n")
}

try {
    await main()
} catch (e) {
    const message = e instanceof Quiet ? e.message : `internal error: ${String(e?.message ?? e).split("\n")[0]}`
    process.stderr.write(`stage-lines: ${message}\n`)
}
process.exitCode = 0
