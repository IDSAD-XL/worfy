#!/usr/bin/env node
// A cheap Stop gate: it runs nothing itself (otherwise it would fire on every turn).
// It only stops the turn from finishing while the last gate run is known to be red,
// and once per session it speaks up about an unverified state.
//
// Self-limit: it blocks at most MAX_BLOCKS times per session. Without that,
// a red state the model cannot fix (a broken environment,
// missing dependencies) turns into an endless loop, and a headless run of
// `claude -p` simply goes silent. The counter is cleared by a green gate run.
//
// Messages to the model go through additionalContext: the turn is not held, but the model
// gets an extra turn to answer them. So each such message is said
// at most once per session per repository ("once" files in stop-blocks).
//
// The worktree tag, the repository path the registry knows and the state folder come from
// gate-paths.mjs, as the gate's own do: otherwise one would not find the markers the other left.
// If the registry cannot be read, the red marker of this tree still holds the turn.
//
// Exit codes: 2 holds the turn (the message is on stderr), 0 otherwise. A failure inside the hook
// is one line on stderr and code 0: a broken hook must not hold every turn of the session.
//
// For tests: CLAUDE_GATE_STATE (the state folder), CLAUDE_GATE_RESOLVE (the resolver),
// CLAUDE_GATE_CONFIG (read by the resolver). Tests: hooks/tests/gate-notverified.test.sh,
// gate-unregistered.test.sh, bin/tests/harness-home.test.sh.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gateStateDir, repositoryRoot, worktreeRoot, worktreeTag } from "./gate-paths.mjs"

const MAX_BLOCKS = 2

function readStdin() {
    if (process.stdin.isTTY) return ""
    try {
        return fs.readFileSync(0, "utf8")
    } catch {
        return ""
    }
}

// A top-level string field of the hook JSON, or "".
function field(payload, name) {
    const value = payload && typeof payload === "object" ? payload[name] : undefined
    return typeof value === "string" ? value : ""
}

function size(p) {
    try {
        return fs.statSync(p).size
    } catch {
        return -1
    }
}

const exists = (p) => size(p) >= 0

// The file's text with its line breaks as spaces, as `tr '\n' ' '` gave it.
const flat = (p) => fs.readFileSync(p, "utf8").replaceAll("\n", " ")

// The names in `dir` that start with `prefix` and end with `suffix`, with at least the two of them
// in the name (the glob <prefix>*<suffix>), sorted.
function matching(dir, prefix, suffix) {
    let names
    try {
        names = fs.readdirSync(dir)
    } catch {
        return []
    }
    return names.filter((n) => n.length >= prefix.length + suffix.length && n.startsWith(prefix) && n.endsWith(suffix)).sort()
}

// Writes an empty file, as `: >file`; a failure is left alone, as in the shell.
function touch(p) {
    try {
        fs.writeFileSync(p, "")
    } catch {}
}

// The context for the model without blocking the turn. Control characters other than tab and line
// breaks are dropped.
function say(text) {
    const kept = (ch) => ch >= " " || ch === "\t" || ch === "\n" || ch === "\r"
    const clean = [...text].filter(kept).join("")
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: clean } }))
}

// What the hook does; the exit code it returns.
function main() {
    // The scripts next to this one: the folder of its real file, not of a symlink to it.
    const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))
    const state = gateStateDir()
    const resolver = process.env.CLAUDE_GATE_RESOLVE || path.join(here, "gate-resolve.mjs")

    const input = readStdin()
    let payload = null
    try {
        payload = JSON.parse(input)
    } catch {}

    const repo = worktreeRoot()
    if (!repo) return 0
    const canon = repositoryRoot(repo)
    if (!canon) return 0

    const session = field(payload, "session_id") || "unknown"
    const safe = session.replace(/[^A-Za-z0-9_-]/g, "_")
    const transcript = field(payload, "transcript_path")
    const counterDir = path.join(state, "stop-blocks")
    try {
        fs.mkdirSync(counterDir, { recursive: true })
    } catch {}

    // The same tree key as the gate's: red in a neighbouring worktree is none of our business.
    const tag = worktreeTag(repo)
    // The key of the whole repository (all its worktrees) — for "once per session per repository".
    const rtag = worktreeTag(canon)

    let notes = ""
    const note = (s) => {
        notes += (notes ? " " : "") + s
    }
    const flushNotes = () => {
        if (notes) say(`${notes} This is not a green result — say "not verified", not "done".`)
        return 0
    }

    // The project key. The resolver's exit code is looked at before an empty key is taken as "not
    // registered": a broken registry gives empty output, but the project may be registered and red.
    let resolved = false
    const which = spawnSync(process.execPath, [resolver, "--which", canon], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
    })
    if (!which.error && !which.signal && which.status === 0) resolved = true
    let key = String(which.stdout ?? "").replace(/\n+$/, "").split("\t")[0]

    // Gate markers without a project key (code 3: not registered, the registry cannot be read,
    // no node). Take only our own: of this tree and this session. A marker without a session
    // ("anon" — the gate was run outside a session) — only if it is newer than the start of our
    // session (the birth time of the transcript, in whole seconds); a birth time of 0 means the
    // system does not know it, and then no anon marker is taken: otherwise it is someone else's
    // work. Other markers are left alone: their own session will take them, or the gate will clean
    // them up after a week.
    const consumeNokey = () => {
        let start = null
        if (transcript) {
            try {
                start = sessionStart(fs.statSync(transcript))
            } catch {}
        }
        const markers = [...matching(state, "nokey-", `-${tag}-${safe}`), ...matching(state, "nokey-", `-${tag}-anon`)]
        for (const name of markers) {
            const m = path.join(state, name)
            let st
            try {
                st = fs.statSync(m)
            } catch {
                continue
            }
            if (!st.isFile()) continue
            if (name.endsWith("-anon")) {
                if (start === null) continue
                if (!(Math.floor(st.mtimeMs / 1000) >= start)) continue
            }
            const kind = name.slice("nokey-".length).split("-")[0]
            let msg = ""
            try {
                msg = flat(m)
            } catch {}
            try {
                fs.rmSync(m, { force: true })
            } catch {}
            // "Not registered" goes stale: the repository may have been added to the registry after
            // the gate run. The resolver now finds it — drop the marker silently, otherwise
            // the model would hear "not verified" about a project that is already registered.
            if (kind === "unregistered" && resolved && key) continue
            const once = path.join(counterDir, `${safe}__nokey-${kind}__${rtag}`)
            if (exists(once)) continue
            touch(once)
            note(`The quality gate exited with code 3 (not verified): ${msg}`)
        }
    }

    if (!resolved) {
        // The project cannot be determined. Look for this tree's markers by file name:
        // red-<key>-<tree> (first — it holds the turn), then unverified-<key>-<tree>;
        // the tree is ours, so the marker is ours too.
        for (const prefix of ["red-", "unverified-"]) {
            const found = matching(state, prefix, `-${tag}`).find((n) => size(path.join(state, n)) > 0)
            if (found) {
                key = found.slice(found.indexOf("-") + 1, found.length - tag.length - 1)
                break
            }
        }
    }
    if (!key) {
        // Outside the registry (or the registry cannot be read and there is no red): do not hold the turn —
        // there is nothing for the model to fix — but say the gate's code-3 marker once.
        consumeNokey()
        return flushNotes()
    }
    const redMarker = path.join(state, `red-${key}-${tag}`)
    const unverifiedMarker = path.join(state, `unverified-${key}-${tag}`)

    // Before red: if the gate cannot work (code 3 — registry, node), the model must learn
    // the reason on a red turn too, otherwise it fixes the code and the gate still does not turn green.
    consumeNokey()

    if (size(redMarker) > 0) {
        const counter = path.join(counterDir, `${safe}__${key}-${tag}`)
        let count = 0
        try {
            count = Number.parseInt(fs.readFileSync(counter, "utf8"), 10) || 0
        } catch {}
        count += 1
        try {
            fs.writeFileSync(counter, `${count}\n`)
        } catch {}

        if (count > MAX_BLOCKS) {
            // Enough hammering, but the unverified state must be named out loud —
            // once per session per tree, not on every turn.
            const giveup = path.join(counterDir, `${safe}__redgiveup__${key}-${tag}`)
            if (!exists(giveup)) {
                touch(giveup)
                note(`The quality gate is still red and was not cleared in ${MAX_BLOCKS} attempts. Do not describe this work as verified — say plainly that the gate fails.`)
            }
            if (notes) say(notes)
            return 0
        }

        let failedAt = ""
        try {
            failedAt = fs.readFileSync(redMarker, "utf8").replace(/\n+$/, "")
        } catch {}
        // The command the model runs, with / on Windows too: it reads the same in Git Bash and PowerShell.
        const gate = path.join(here, "gate.mjs")
        const shown = process.platform === "win32" ? gate.replaceAll("\\", "/") : gate
        process.stderr.write(
            `The quality gate is red (failed at ${failedAt}). Run \`node "${shown}" fast </dev/null; echo "EXIT=$?"\` and fix what it points to before finishing. If it cannot be fixed here, say so instead of reporting the work as done.${notes ? ` Also: ${notes}` : ""}\n`,
        )
        return 2
    }

    if (size(unverifiedMarker) > 0) {
        // Do not block: an unavailable Docker or unbuilt dependencies cannot be fixed
        // by the model. But this must not pass silently either — otherwise "not verified"
        // turns into "done".
        const once = path.join(counterDir, `${safe}__unv__${key}-${tag}`)
        if (!exists(once)) {
            touch(once)
            let text = ""
            try {
                text = flat(unverifiedMarker)
            } catch {}
            note(`The last gate run could not verify the work: ${text}.`)
        }
    }

    return flushNotes()
}

// The start of the session in whole epoch seconds: the birth time of its transcript, given the
// transcript's fs.Stats. null when it is not a file or the birth time is 0 — the system does not
// know it (some Linux file systems), and then no marker without a session is taken.
export function sessionStart(stats) {
    return stats && stats.isFile() && stats.birthtimeMs > 0 ? Math.floor(stats.birthtimeMs / 1000) : null
}

// Run as the hook, not when a test imports sessionStart.
function isMain() {
    try {
        return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
    } catch {
        return false
    }
}

if (isMain()) {
    let code = 0
    try {
        code = main()
    } catch (e) {
        // code stays 0: a broken hook must not hold the turn.
        process.stderr.write(`stop: ${String(e?.message ?? e).split("\n")[0]}\n`)
    }
    process.exitCode = code
}
