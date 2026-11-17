// The call log of the Harness (worfy-stuck-agents/07): a PostToolUse and PostToolUseFailure hook that
// only writes. It keeps the last 20 calls of each agent in <gate state>/calls/<owner>.jsonl and, when the
// newest call completes a loop pattern (loop-patterns.mjs), appends a line to <gate state>/calls/loops.jsonl:
// would-hint on the 3rd repeat, would-deny on the 4th, once per pattern and owner. bin/loop-log reads them.
//
// The agent gets nothing: the hook prints nothing on stdout, always exits 0, and swallows any error of
// reading or writing. It runs on every tool call of every agent, so it starts no process, and the state
// folder is that of the gate (gate-paths.mjs: CLAUDE_GATE_STATE, else <Harness home>/gate/state).
//
// The owner of a log is the Session (session_id), and for a Subagent the Session and its agent_id: Claude
// Code puts agent_id into a hook input inside a Subagent only (BaseHookInput of the Agent SDK), Codex too
// (test/fixtures/codex-messages/hooks/PostToolUse.jsonl). Both Vendors run this same hook (hooks.json).
//
// The outcome of a call:
//   - Claude Code: PostToolUse is a success ("ok"); PostToolUseFailure a failure with the hash of its `error`
//     text, which carries no exit code. An interrupt (is_interrupt) is the person's, not logged;
//   - Codex has no PostToolUseFailure: its tool_response is the output, and apply_patch's starts with
//     "Exit code: N". With an exit code the outcome is it and the hash of the output, without one (a shell
//     call) the hash of the output alone, of unknown success.
// The input is hashed as normalised: a command without spaces at its ends; an edit (Edit, Write, MultiEdit,
// NotebookEdit, apply_patch) as its files with the hash of their content after it. Paths are hashed too;
// only loops.jsonl keeps the start of a command (200 characters), on this machine.
//
// Files: owner logs older than 7 days are removed when a new owner's log is written; loops.jsonl, which
// the measurement two weeks later reads, is kept, at its last 2000 lines.
// Tests: harness/hooks/tests/calls.test.sh; Codex inputs in test/contract/harness-codex-hooks.test.ts;
// the patterns in test/unit/loop-patterns.test.ts.

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { isCodexInput } from "./codex-input.mjs"
import { gateStateDir } from "./gate-paths.mjs"
import { isCiWait, levelOf, MAX_CALLS, repeats } from "./loop-patterns.mjs"

const KEEP_MS = 7 * 24 * 60 * 60 * 1000
const MAX_LOOPS = 2000
const HEAD = 200
/** The longest the hook waits for its input: well inside the 5 s hooks.json gives it. */
const INPUT_MS = 2000
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])
const LOOPS = "loops.jsonl"

const hash = (text) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 16)
const str = (value) => (typeof value === "string" ? value : "")
const safe = (name) => name.replace(/[^A-Za-z0-9_-]/g, "_")

// JSON with the keys of every object sorted: the same input gives the same text.
function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
    if (value && typeof value === "object")
        return `{${Object.keys(value)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
            .join(",")}}`
    return JSON.stringify(value) ?? "null"
}

// The files an apply_patch names: its Add, Update and Delete headers and a Move target.
function patchFiles(patch) {
    const files = []
    for (const m of str(patch).matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)) files.push(m[1].trim())
    return files
}

// The paths an edit changed, as written in its input, or null for a call that is no edit.
function editedPaths(tool, input) {
    if (EDIT_TOOLS.has(tool)) {
        const file = str(input?.file_path) || str(input?.notebook_path)
        return file ? [file] : []
    }
    if (tool === "apply_patch") return patchFiles(input?.command ?? input?.patch ?? input?.input)
    return null
}

function contentHash(file) {
    try {
        return hash(fs.readFileSync(file))
    } catch {
        return "none"
    }
}

// The outcome of a Codex call from its tool_response: [out, fail].
function codexOutcome(response) {
    const text = typeof response === "string" ? response : stable(response)
    const exit = /^Exit code: (-?\d+)/.exec(text)
    if (!exit) return [`out:${hash(text)}`, null]
    // The wall time differs from run to run; the rest is the output.
    const output = text.replace(/^Wall time: .*$/m, "")
    return [`exit:${exit[1]}:${hash(output)}`, exit[1] !== "0"]
}

// The call record of a hook input, with the start of its command for loops.jsonl; null to log nothing.
function recordOf(payload) {
    const event = payload.hook_event_name
    if (event !== "PostToolUse" && event !== "PostToolUseFailure") return null
    const tool = str(payload.tool_name)
    if (!tool) return null
    if (event === "PostToolUseFailure" && payload.is_interrupt === true) return null
    const input = payload.tool_input
    const command = tool === "Bash" ? str(input?.command).trim() : ""
    if (command && isCiWait(command)) return null

    const codex = isCodexInput(payload)
    let out
    let fail
    if (event === "PostToolUseFailure") [out, fail] = [`fail:${hash(str(payload.error))}`, true]
    else if (codex) [out, fail] = codexOutcome(payload.tool_response)
    else [out, fail] = ["ok", false]

    const cwd = str(payload.cwd) || process.cwd()
    const paths = editedPaths(tool, input)
    const record = { t: new Date().toISOString(), tool, in: "", out, fail }
    let head
    if (paths) {
        record.files = paths.map((p) => [hash(path.resolve(cwd, p)), contentHash(path.resolve(cwd, p))])
        record.in = hash(`${tool}\u0000${record.files.map((f) => f.join(":")).join("\u0000")}`)
        head = paths.join(" ")
    } else if (tool === "Bash") {
        record.in = hash(`${tool}\u0000${command}`)
        head = command
    } else {
        head = stable(input ?? null)
        record.in = hash(`${tool}\u0000${head}`)
    }
    return { record, head: Array.from(head).slice(0, HEAD).join(""), vendor: codex ? "codex" : "claude" }
}

const readLines = (file) => {
    try {
        return fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
    } catch {
        return []
    }
}

// Writes `text` to `file` through a file next to it: a reader never sees half of it.
function replace(file, text) {
    const tmp = `${file}.${process.pid}.tmp`
    try {
        fs.writeFileSync(tmp, text)
        fs.renameSync(tmp, file)
    } catch {
        try {
            fs.unlinkSync(tmp)
        } catch {}
    }
}

// Removes the owner logs of `dir` older than 7 days; loops.jsonl stays.
function sweep(dir) {
    const now = Date.now()
    for (const name of fs.readdirSync(dir)) {
        if (name === LOOPS || !/\.(jsonl|tmp)$/.test(name)) continue
        const file = path.join(dir, name)
        try {
            if (now - fs.statSync(file).mtimeMs > KEEP_MS) fs.unlinkSync(file)
        } catch {}
    }
}

function main(input) {
    let payload
    try {
        payload = JSON.parse(input)
    } catch {
        return
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return
    const call = recordOf(payload)
    if (!call) return

    const session = str(payload.session_id) || "unknown"
    const agentId = str(payload.agent_id)
    const owner = agentId ? `${safe(session)}.${safe(agentId)}` : safe(session)
    const dir = path.join(gateStateDir(process.env, str(payload.cwd) || undefined), "calls")
    fs.mkdirSync(dir, { recursive: true })
    const log = path.join(dir, `${owner}.jsonl`)
    const known = fs.existsSync(log)

    const calls = []
    for (const line of readLines(log)) {
        try {
            calls.push(JSON.parse(line))
        } catch {}
    }
    calls.push(call.record)
    const kept = calls.slice(-MAX_CALLS)
    replace(log, `${kept.map((c) => JSON.stringify(c)).join("\n")}\n`)
    if (!known) sweep(dir)

    const found = repeats(kept)
        .map(({ pattern, count }) => ({ pattern, level: levelOf(count) }))
        .filter((f) => f.level)
    if (found.length === 0) return
    const loops = path.join(dir, LOOPS)
    let lines = readLines(loops)
    const seen = new Set()
    for (const line of lines) {
        try {
            const l = JSON.parse(line)
            if (l.session === session && (l.agent_id ?? "") === agentId) seen.add(`${l.pattern}\u0000${l.level}`)
        } catch {}
    }
    const fresh = found
        .filter((f) => !seen.has(`${f.pattern}\u0000${f.level}`))
        .map((f) =>
            JSON.stringify({ t: call.record.t, session, agent_id: agentId || null, pattern: f.pattern, level: f.level, tool: call.record.tool, command: call.head, vendor: call.vendor }),
        )
    if (fresh.length === 0) return
    lines = lines.concat(fresh)
    if (lines.length > MAX_LOOPS) replace(loops, `${lines.slice(-MAX_LOOPS).join("\n")}\n`)
    else fs.appendFileSync(loops, `${fresh.join("\n")}\n`)
}

// A pipe that stays open and sends nothing must not hold the hook until hooks.json's limit kills it.
setTimeout(() => process.exit(0), INPUT_MS).unref()
try {
    let raw = ""
    process.stdin.setEncoding("utf8")
    for await (const chunk of process.stdin) raw += chunk
    main(raw)
} catch {}
process.exitCode = 0
