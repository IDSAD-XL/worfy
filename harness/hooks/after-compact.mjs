#!/usr/bin/env node
// SessionStart of the branch `compact` (matcher "compact" in hooks.json): hands the agent its state back after a
// compaction, so the summary is not the only memory of the epic, the ticket and the work in the tree. The summary
// instructions (rules/compaction.md, PreCompact) ask the model to keep that state; this hook gives it again from the
// files, whatever the summary kept.
//
// Prints, on stdout,
//   {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<text>"}}
// where the text depends on where the session works (the `cwd` of the input):
//   - a linked worktree whose branch is a ticket's branch (the profile's form `tickets.branch`, or the `Branch:`
//     line of a ticket in Silent mode) — an implementer: how the ticket ends (`workflow.finish` of the profile,
//     FINISH), `git status --short` of the worktree (STATUS_LIMIT characters), the ticket file, then the commits
//     of the branch since `worktree.base` of the profile with their files (COMMIT_LIMIT characters) and
//     `git diff HEAD` (DIFF_LIMIT). Over the limit the commits and the diff go first; a ticket over the limit by
//     itself loses lines of its middle, never its done section (fittedTicket). The text states where the work stands and names no command to
//     run now (an agent told to answer from memory read an order to re-check the files into it); the re-check of
//     the done items is asked for before the report;
//   - the main checkout of the project — the Orchestrator: `bin/wave-brief <epic>`, its head (the Stage line) and
//     the sections Waiting (tickets in work) and Open PRs first, the rest after. The epic is WORFY_EPIC (worfy
//     sets it for the Orchestrator of a wave), when a ticket of that epic exists; otherwise the epic of the
//     checkout's branch; otherwise the first of the Epics in play, as hooks/stage-lines.mjs orders them.
// The input of a Subagent's hook carries no agent_id and the transcript of the main session (Claude Code 2.1.322),
// so the hook cannot tell an implementer from the Orchestrator by the input: the place of the work decides.
//
// Nothing, and exit 0, when: the source is not "compact"; the Session is a Product Session
// (WORFY_SESSION_KIND=product); the directory belongs to no registered project, or its profile keeps no tickets;
// a linked worktree has no ticket of its own (a reviewer's detached worktree); the main checkout has no epic.
//
// The text is at most LIMIT characters (code points): Claude Code shows a longer additionalContext only as a
// preview. On Codex (the same hooks.json; its sessionStart has the matcher compact too) it is also at most LIMIT
// bytes: Codex spills a context over 2,500 tokens, about that many bytes, to a file. A longer text is cut after a
// whole line, and its last line names the command or the file with the whole text.
//
// Every failure — stdin that is not JSON, a `cwd` that is not a directory, bin/profile failing (other than exit
// 3), a program running past its time (then it is killed) — is one line on stderr and exit 0. Writes nothing.
//
// For tests: CLAUDE_HOOK_STDIN_WAIT_MS shortens the wait for the input (hook-stdin.mjs); CLAUDE_PROFILE_BIN
// replaces bin/profile, CLAUDE_EPIC_STATUS_BIN bin/epic-status, CLAUDE_TICKET_BIN bin/ticket, CLAUDE_WAVE_BRIEF_BIN
// bin/wave-brief. Tests:
// hooks/tests/session-hooks.test.sh.

import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { isCodexInput } from "./codex-input.mjs"
import { git as GIT } from "./eval-env.cjs"
import { firstByteWait, readStdin } from "./hook-stdin.mjs"

// The done section the way bin/ticket reads it: the profile's heading, the default one, the old Russian one.
const { parseDoneSection } = createRequire(import.meta.url)("../lib/evidence.cjs")

const LIMIT = 10000
// Of the 30 s hooks.json gives the hook, the wait for the first byte of the input (hook-stdin.mjs).
const FIRST_BYTE_MS = 5000
// bin/profile, git, epic-status and ticket each. stage-lines.mjs runs bin/profile and epic-status itself, 2.5 s
// at most each; wave-brief reads gh. On a slow Windows runner a program of the Harness takes seconds to start.
const STEP_MS = 8000
const STAGE_MS = 10000
const BRIEF_MS = 15000
const NOT_REGISTERED = 3
// git status goes before the ticket: at most this many lines and characters, so the ticket keeps its room.
const STATUS_LINES = 50
const STATUS_LIMIT = 1500
// The commits of the branch: lines of `git log --name-status`, a subject or a file each, in at most COMMIT_LIMIT
// characters. They go after the ticket, as the diff does: a branch of many files never pushes the ticket's done
// items out of the limit.
const COMMIT_LINES = 40
const COMMIT_LIMIT = 2000
// The diff of the work not committed yet goes last, after the ticket and the commits, in at most this many
// characters.
const DIFF_LIMIT = 3000
// File names as they are: without it git prints a name outside ASCII as octal escapes.
const PLAIN_NAMES = ["-c", "core.quotePath=false"]
// How a ticket ends, by workflow.finish of the profile: the goal of the work, which the ticket file does not state.
const FINISH = {
    "pr-green-ci": "ends with a pull request whose CI goes green",
    "local-green": "ends with green local checks and the implementer's report, with no pull request",
}
// The sections of wave-brief that go first, after its head: the tickets in work and the open PRs.
const FIRST_SECTIONS = ["Waiting", "Open PRs"]

class Quiet extends Error {}

const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))
const bin = path.join(path.dirname(here), "bin")
const slashes = (p) => (process.platform === "win32" ? p.replaceAll("\\", "/") : p)

const isDir = (p) => {
    try {
        return fs.statSync(p).isDirectory()
    } catch {
        return false
    }
}

/** Runs `command args` in `cwd` with `input` on stdin: {code, out, timedOut}; code null when it did not start or ran past `ms`. */
function run(command, args, cwd, { ms = STEP_MS, input = "" } = {}) {
    return new Promise((resolve) => {
        let child
        try {
            child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "ignore"], windowsHide: true })
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
            resolve({ code, out: out.replace(/\r\n/g, "\n"), timedOut })
        }
        const timer = setTimeout(() => {
            child.kill("SIGKILL")
            done(null, true)
        }, ms)
        child.stdin.on("error", () => {})
        child.stdin.end(input)
        child.stdout.setEncoding("utf8")
        child.stdout.on("data", (chunk) => {
            out += chunk
        })
        child.on("error", () => done(null))
        child.on("close", (code) => done(code))
    })
}
const node = (script, args, cwd, options) => run(process.execPath, [script, ...args], cwd, options)
const why = (r) => (r.timedOut ? "ran past its time" : r.code === null ? "did not start" : `exit ${r.code}`)

/** The profile's branch form (`<epic>/<NN>`, `<epic>/<NN>-<slug>`) as a matcher: branch -> {epic, num} or null. */
function branchForm(template) {
    if (typeof template !== "string" || !template.includes("<epic>") || !template.includes("<NN>")) return () => null
    const epicFirst = template.indexOf("<epic>") < template.indexOf("<NN>")
    const source = template
        .split(/(<[A-Za-z-]+>)/)
        .map((part) =>
            part === "<epic>" ? "([^/\\s]+)" : part === "<NN>" ? "(\\d+)" : /^<[A-Za-z-]+>$/.test(part) ? ".*" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("")
    const re = new RegExp(`^${source}$`)
    return (name) => {
        const m = re.exec(name)
        if (!m) return null
        return epicFirst ? { epic: m[1], num: Number(m[2]) } : { epic: m[2], num: Number(m[1]) }
    }
}

const chars = (s) => [...s].length
/** Whether `text` fits the limit: characters, and on Codex bytes too. */
const fitter = (codex) => (text) => chars(text) <= LIMIT && (!codex || Buffer.byteLength(text, "utf8") <= LIMIT)

/** `text` as it is when it fits; otherwise its first whole lines that fit together with the closing line `note`. */
function cut(text, note, fits) {
    if (fits(text)) return text
    const lines = text.split("\n")
    let lo = 0
    let hi = lines.length
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (fits(`${lines.slice(0, mid).join("\n")}\n${note}`)) lo = mid
        else hi = mid - 1
    }
    if (lo > 0) return `${lines.slice(0, lo).join("\n").trimEnd()}\n${note}`
    // The first line alone is over the limit: as many of its characters as fit.
    const first = [...lines[0]]
    let n = first.length
    while (n > 0 && !fits(`${first.slice(0, n).join("")}\n${note}`)) n = Math.floor(n * 0.9)
    return `${first.slice(0, n).join("")}\n${note}`
}

/** wave-brief's text with its head first, then the sections FIRST_SECTIONS, then the others in their order. */
function ordered(brief) {
    const head = []
    const sections = []
    for (const line of brief.split("\n")) {
        if (line.startsWith("## ")) sections.push({ name: line.slice(3).trim(), lines: [line] })
        else if (sections.length > 0) sections[sections.length - 1].lines.push(line)
        else head.push(line)
    }
    const text = (lines) => lines.join("\n").replace(/\n+$/, "")
    const first = FIRST_SECTIONS.flatMap((name) => sections.filter((s) => s.name === name))
    const rest = sections.filter((s) => !first.includes(s))
    return [text(head), ...[...first, ...rest].map((s) => text(s.lines))].filter(Boolean).join("\n\n")
}

/** The Epic of the first Stage line stage-lines.mjs gives for `cwd`, or "". */
async function firstInPlay(cwd) {
    const r = await node(path.join(here, "stage-lines.mjs"), [], cwd, { ms: STAGE_MS, input: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd }) })
    if (r.code !== 0) return ""
    let context
    try {
        context = JSON.parse(r.out)?.hookSpecificOutput?.additionalContext ?? ""
    } catch {
        return ""
    }
    const line = String(context).split("\n")[1] ?? ""
    return (line.split(" · ")[1] ?? "").split(" ")[0] ?? ""
}

/** `text` cut after whole lines to at most `limit` characters, with `note` as its last line when cut. */
function capped(text, limit, note) {
    if (chars(text) <= limit) return text
    const kept = []
    let size = 0
    for (const line of text.split("\n")) {
        size += chars(line) + 1
        if (size > limit) break
        kept.push(line)
    }
    return [...kept, note].join("\n")
}

/** The commits of `branch` since `base` (worktree.base of the profile), each with its files; "" when git cannot tell. */
async function commitsSince(cwd, base) {
    if (typeof base !== "string" || !base.trim()) return ""
    const log = await run(GIT, [...PLAIN_NAMES, "log", "--no-color", "--format=%h %s", "--name-status", `${base}..HEAD`, "--"], cwd)
    if (log.code !== 0) return ""
    let lines = log.out.split("\n").filter(Boolean)
    const more = lines.length - COMMIT_LINES
    if (more > 0) lines = [...lines.slice(0, COMMIT_LINES), `… ${more} more lines: run git log --name-status ${base}..HEAD`]
    return lines.length ? capped(lines.join("\n"), COMMIT_LIMIT, `… the commits are cut; all of them: git log --name-status ${base}..HEAD`) : "(none yet)"
}

async function implementerContext({ cwd, top, branch, ticket, base, finish, doneSection, fits }) {
    const id = `${ticket.epic}/${String(ticket.num).padStart(2, "0")}`
    const [root, status, commits, diff] = await Promise.all([
        node(process.env.CLAUDE_TICKET_BIN || path.join(bin, "ticket"), ["root"], cwd),
        run(GIT, [...PLAIN_NAMES, "status", "--short"], cwd),
        commitsSince(cwd, base),
        run(GIT, [...PLAIN_NAMES, "diff", "--no-color", "--no-ext-diff", "HEAD", "--"], cwd),
    ])
    if (root.code !== 0) throw new Quiet(`bin/ticket root ${why(root)}`)
    const issues = path.join(root.out.trim(), ticket.epic, "issues")
    let name
    try {
        name = fs.readdirSync(issues).find((f) => f.endsWith(".md") && new RegExp(`^0*${ticket.num}-`).test(f))
    } catch {}
    if (!name) throw new Quiet(`no file of ticket ${id} in ${issues}`)
    const file = slashes(path.join(issues, name))
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "")
    let lines = status.code === 0 ? status.out.split("\n").filter(Boolean) : []
    const more = lines.length - STATUS_LINES
    if (more > 0) lines = [...lines.slice(0, STATUS_LINES), `… ${more} more lines: run git status --short`]
    const statusText =
        status.code !== 0
            ? `(git status failed: ${why(status)})`
            : lines.length
              ? capped(lines.join("\n"), STATUS_LIMIT, "… more lines: run git status --short")
              : "(clean)"
    const section = doneLines(text, doneSection)
    const done = section ? section.heading : "of done items"
    const diffText = diff.code === 0 ? diff.out.replace(/\n+$/, "") : `(git diff failed: ${why(diff)})`
    const ends = FINISH[finish]
    const note = `… cut to fit the hook limit; the whole ticket: ${file}; the diff: git diff HEAD`
    const head = [
        `Context compacted. You are the implementer of ticket ${id}: worktree ${slashes(top)}, branch ${branch}. The Harness read the state of that work for you right after the compaction: the commits of the branch, the changes not committed yet, and the ticket file. Together with the summary above, this is where the work stands now.`,
        ...(ends ? [`The ticket ${ends} (workflow.finish ${finish} of the profile).`] : []),
        "",
        "## Not committed: git status --short",
        statusText,
        "",
        `## Ticket ${file}`,
        `An empty box in its section ${done} is the usual state while the ticket is in work; the commits and the changes below show which items hold now. Before your report, check each done item against the work.`,
        "",
    ].join("\n")
    const ticketText = fittedTicket(text, section, (t) => fits(`${head}\n${t}\n${note}`), file)
    const body = [
        head,
        ticketText,
        ...(commits ? ["", `## Commits of ${branch} since ${base}`, commits] : []),
        ...(diffText ? ["", "## Not committed: git diff HEAD", capped(diffText, DIFF_LIMIT, "… the diff is cut; the whole of it: git diff HEAD")] : []),
    ].join("\n")
    // What has no fixed size comes after the ticket, so this cut takes the commits and the diff first.
    return cut(body, note, fits)
}

/** The done section of `text` as bin/ticket finds it: {heading, from, to}, 0-based lines from its heading to the
 * line before the next heading; null when the ticket has no checkbox item under such a heading. */
function doneLines(text, doneSection) {
    const items = parseDoneSection(text, { doneSection })
    if (!items.length) return null
    const lines = text.split("\n")
    const isHeading = (line) => /^#{1,6}\s/.test(line)
    let from = items[0].line - 1
    while (from > 0 && !isHeading(lines[from])) from--
    let to = items[items.length - 1].end - 1
    while (to + 1 < lines.length && !isHeading(lines[to + 1])) to++
    return { heading: lines[from].trim(), from, to }
}

/** `text` when `fits` takes it; otherwise its first lines that fit, a line that names the cut, and the whole done
 * section after it: the description in the middle gives way, the done items never do. Without a done section,
 * `text` as it is; a done section over the limit by itself comes without the lines before it, and the last cut
 * takes its tail. */
function fittedTicket(text, section, fits, file) {
    if (fits(text) || !section) return text
    const lines = text.split("\n")
    const after = section.to + 1 < lines.length ? [`… the rest of the ticket after this section is cut; the whole ticket: ${file}`] : []
    const build = (k) => {
        const skipped = section.from - k
        const gap = skipped > 0 ? [`… ${skipped} lines of the ticket cut here; the whole ticket: ${file}`, ""] : []
        return [...lines.slice(0, k), ...gap, ...lines.slice(section.from, section.to + 1), ...after].join("\n")
    }
    if (!fits(build(0))) return build(0)
    let lo = 0
    let hi = section.from
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (fits(build(mid))) lo = mid
        else hi = mid - 1
    }
    return build(lo)
}

async function orchestratorContext({ cwd, epic, fits }) {
    let root = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(here)
    if (!process.env.CLAUDE_PLUGIN_ROOT) root = slashes(root)
    const command = `${root}/bin/wave-brief ${epic}`
    const brief = await node(process.env.CLAUDE_WAVE_BRIEF_BIN || path.join(bin, "wave-brief"), [epic], cwd, { ms: BRIEF_MS })
    if (brief.code !== 0 || !brief.out.trim()) {
        process.stderr.write(`after-compact: wave-brief ${epic} ${why(brief)}\n`)
        return `Context compacted. Your epic is ${epic}; wave-brief could not tell where its waves stand (${why(brief)}). Run \`${command}\` before the next step.`
    }
    const body = `Context compacted. Where epic ${epic} stands now, as \`${command}\` prints it (the Stage line, the tickets in work and the open PRs first):\n\n${ordered(brief.out.replace(/\n+$/, ""))}`
    return cut(body, `… cut to fit the hook limit; the whole brief: ${command}`, fits)
}

async function main() {
    const input = await readStdin(firstByteWait(FIRST_BYTE_MS, "CLAUDE_HOOK_STDIN_WAIT_MS"))
    if (process.env.WORFY_SESSION_KIND === "product") return
    if (!input.trim()) return
    let hook
    try {
        hook = JSON.parse(input)
    } catch {
        throw new Quiet("stdin is not JSON")
    }
    if (hook?.source !== "compact") return
    if (hook?.cwd !== undefined && !(typeof hook.cwd === "string" && isDir(hook.cwd))) throw new Quiet(`cwd ${JSON.stringify(hook.cwd)} is not a directory`)
    const cwd = typeof hook?.cwd === "string" ? hook.cwd : process.cwd()
    const event = typeof hook?.hook_event_name === "string" && hook.hook_event_name ? hook.hook_event_name : "SessionStart"

    const profile = await node(process.env.CLAUDE_PROFILE_BIN || path.join(bin, "profile"), ["-C", cwd, "--json"], cwd)
    if (profile.code === NOT_REGISTERED) return
    if (profile.code !== 0) throw new Quiet(`bin/profile ${why(profile)}`)
    let tickets, base, finish
    try {
        const parsed = JSON.parse(profile.out)
        tickets = parsed?.tickets
        base = parsed?.worktree?.base
        finish = parsed?.workflow?.finish
    } catch {
        throw new Quiet("bin/profile --json printed no JSON")
    }
    if (typeof tickets?.path !== "string" || !tickets.path.trim()) return

    const [where, status] = await Promise.all([
        run(GIT, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel", "--abbrev-ref", "HEAD"], cwd),
        node(process.env.CLAUDE_EPIC_STATUS_BIN || path.join(bin, "epic-status"), ["--json"], cwd),
    ])
    const [gitDir, commonDir, top, branch = ""] = where.code === 0 ? where.out.split("\n") : []
    let model = null
    try {
        model = status.code === 0 ? JSON.parse(status.out) : null
    } catch {}
    if (!model) throw new Quiet(`bin/epic-status --json ${why(status)}`)
    const all = Array.isArray(model.tickets) ? model.tickets : []
    const epics = new Set((Array.isArray(model.epics) ? model.epics : []).map((e) => e?.epic).filter(Boolean))
    const formed = branch && branch !== "HEAD" ? branchForm(tickets.branch)(branch) : null
    const fits = fitter(isCodexInput(hook))

    let additionalContext
    if (gitDir && commonDir && path.resolve(gitDir) !== path.resolve(commonDir)) {
        // A linked worktree: an implementer's when its branch is a ticket's.
        const ticket =
            (formed && all.find((t) => t?.epic === formed.epic && t?.num === formed.num)) || (branch && branch !== "HEAD" && all.find((t) => t?.branch === branch))
        if (!ticket) return
        additionalContext = await implementerContext({ cwd, top, branch, ticket, base, finish, doneSection: tickets.done_section, fits })
    } else {
        const wanted = process.env.WORFY_EPIC ?? ""
        let epic = epics.has(wanted) ? wanted : formed && epics.has(formed.epic) ? formed.epic : ""
        if (!epic) epic = await firstInPlay(cwd)
        if (!epic || !epics.has(epic)) return
        additionalContext = await orchestratorContext({ cwd, epic, fits })
    }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } }) + "\n")
}

try {
    await main()
} catch (e) {
    const message = e instanceof Quiet ? e.message : `internal error: ${String(e?.message ?? e).split("\n")[0]}`
    process.stderr.write(`after-compact: ${message}\n`)
}
process.exitCode = 0
