#!/usr/bin/env node
// PreToolUse: refuses commands that destroy uncommitted work, pipes that swallow the exit code of
// checks, and — in a Silent project or with `attribution: off` — commit messages, branch names and PR
// texts that carry traces of the workflow (section 3, bin/silent-check). Section 4 refuses a subagent's
// write of a verification path that the trail of its ticket on the base branch does not name, a
// subagent's `ticket mark`, and `profile-set` of the fields the merge condition depends on.
//
// The matcher of hooks.json is Bash, apply_patch (Codex) and the file tools of Claude Code (Edit, Write,
// MultiEdit, NotebookEdit). A file tool meets section 4 only; a shell command meets every section.
//
// Section 4, a verification path (lib/verification-paths.cjs: its defaults and the profile's
// verification.paths). The file a call writes: tool_input.file_path of Edit, Write and MultiEdit,
// notebook_path of NotebookEdit, the `*** Add File:`, `*** Update File:`, `*** Delete File:` and
// `*** Move to:` headers of an apply_patch, and the write targets of a shell command (shellTargets).
// It is taken through symbolic links of its nearest existing folder and compared from the root of the
// work tree it is in (git rev-parse there), so a worktree under .claude/worktrees/ of a main checkout
// is its own repository. A subagent (agent_id on Claude Code; agent_type or agent_id on Codex) writes
// it only when the trail of its ticket names it: the ticket of the tree's branch by tickets.branch,
// the trail read by lib/ticket-trail.cjs at the tip of worktree.base, or in the tickets folder when the
// tickets live outside the repository — the rule bin/land merges by; as there, a symbolic link a command
// makes (`ln -s`) counts wherever it is, and so does a folder above a verification path a command may
// write or remove whole (`rm -r .github`, `cp -R tmpl .github`, `mv`, `rsync`). Refused: a path outside the
// trail, a branch that names no ticket, a ticket with no trail at the base branch (a ticket only on its
// branch), and any verification path in a tree on a detached HEAD (a review tree: mutate a copy outside
// the repository). The main Session is not refused; a folder no profile covers, a project of several
// repositories and a profile without a tickets.branch template are not checked (checksPaths). With the
// tickets outside the repository (Silent mode) a subagent's edit that changes the trail section of a
// ticket there is refused too. A read that fails or runs out of the section's 8 s budget (bin/profile,
// git, the trail read), and a failure inside the section, let the call through, as the spec has it
// («Риски»: «Сбой guard открывает проход»): bin/land checks the PR's diff at merge.
//
// The refusal log. With WORFY_GUARD_LOG set (a later ticket of the Harness guarantees epic, Journal and
// Run history, has worfy set it for the Sessions it starts), every refusal appends one line of JSON to
// that file; without it — a terminal, say — the guard writes nothing:
//   {"time":"<ISO 8601>","rule":"<id>","agent":"<agent_type>"|null,"agent_id":"<id>"|null,
//    "ticket":"<epic>/<NN>"|null,"tool":"<tool_name>","command":"<the command, or `<tool> <path>`, one
//    line, at most 200 characters>","session":"<session_id>"|null,"cwd":"<directory>"}
// agent_id null — the main Session (agent is agent_type, which the main thread of a Session started with
// --agent carries too, so it does not tell a subagent); ticket — the ticket section 4 read for the
// decision, else null. The rule ids: read-only-agent, interactive-shell, uncommitted-work, pipe-exit-code,
// workflow-traces, verification-path, verification-path-no-ticket, verification-path-detached,
// ticket-trail-edit, ticket-mark-subagent, profile-set-merge-fields.
//
// The decision is returned in the permissionDecision field. We always exit with zero: an error in
// the hook itself must neither break the session nor silently let a call through unnoticed.
//
// The parsing goes by the segments of the command and by its arguments, not by a string match:
// `git -C /p checkout HEAD -- .` and `git checkout -f .` are the same action,
// and they must be caught the same way.
//
// On Codex (the input tells, codex-input.mjs) the hook gets Codex's
// tools: `Bash` for a shell command, as under Claude Code, and `apply_patch` for a file edit (the
// matcher of hooks.json names both; Claude Code has no apply_patch). Two rules hold there besides the
// ones below:
//   - worfy-reviewer and worfy-scout edit no file: their apply_patch is denied by `agent_type`, as
//     Claude Code gives them no Edit or Write tool; their shell commands go through the rules below,
//     as their Bash does under Claude Code;
//   - an agent of the Harness opens no interactive shell or interpreter: what it would type there
//     later goes through Codex's write_stdin, which runs no PreToolUse hook (codex-rs/core/src/tools/
//     handlers/unified_exec/write_stdin.rs at rust-v0.166.0), so none of these rules would see it.
//     This deny is best effort and lexical, as every rule here is: it catches the plain starts
//     (`bash`, `node`, `python3`, `tmux`), and a program that reads its input can still be driven
//     (`cat | bash`, `sh /dev/stdin`, a REPL module, a wrapper it does not know). Closing it fully
//     takes Codex itself: no write_stdin for these agents, or a sandbox.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { codexAgent, isCodexInput, isHarnessAgent, READ_ONLY_AGENTS } from "./codex-input.mjs"
import { git as GIT } from "./eval-env.cjs"
import { gateConfigFile } from "./gate-paths.mjs"

// bin/ of this Harness: the folder above hooks/, found from this script's real file.
const BIN = path.join(path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))), "bin")
const SILENT_CHECK = process.env.CLAUDE_SILENT_CHECK_BIN || path.join(BIN, "silent-check")
// bin/profile: which project's workspace a directory is (a gh api write sent from there), and the profile section 4
// reads its verification paths and tickets from.
const PROFILE = process.env.CLAUDE_PROFILE_BIN || path.join(BIN, "profile")
// The list of verification paths and the reader of a ticket's trail: the same modules bin/land decides by.
const require = createRequire(import.meta.url)
const { verificationPaths, isVerificationParent, normalizePath, touchesVerificationPath } = require("../lib/verification-paths.cjs")
const { trailPaths, namedByTrail, readTrail } = require("../lib/ticket-trail.cjs")

let raw = ""
process.stdin.setEncoding("utf8")
for await (const chunk of process.stdin) raw += chunk

const ok = () => process.exit(0)
// The ticket a refusal is about, once section 4 has read it from the branch: `<epic>/<NN>`.
let refusedTicket = null
// The one way to refuse: the reason (what and why, then the next step, in English) goes back to the agent, and with
// WORFY_GUARD_LOG set one JSON line is appended to that file (the format is in the header). A log that cannot be
// written changes nothing: the refusal holds.
const deny = (reason, rule) => {
    const log = process.env.WORFY_GUARD_LOG
    if (log)
        try {
            fs.appendFileSync(log, JSON.stringify(denial(rule)) + "\n")
        } catch {}
    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason,
            },
        })
    )
    process.exit(0)
}

let payload
try {
    payload = JSON.parse(raw)
} catch {
    ok()
}
const codex = isCodexInput(payload)
const agent = codex ? codexAgent(payload) : ""
const tool = payload?.tool_name
// A subagent: Claude Code gives `agent_id` inside a subagent only (`agent_type` is also on the main thread of a
// Session started with --agent, as a recorded run of the pinned Claude Code showed), Codex gives both inside a subagent only.
const agentId = typeof payload?.agent_id === "string" ? payload.agent_id : ""
const agentName = typeof payload?.agent_type === "string" ? payload.agent_type : ""
const subagent = agentId !== "" || (codex && agent !== "")
if (codex && tool === "apply_patch" && READ_ONLY_AGENTS.has(agent))
    deny(
        `${agent} edits no file: on Codex its apply_patch is refused, as Claude Code gives a reviewer and a scout no Edit or Write tool. ` +
            "Name the change in your report instead of making it; shell commands that only read and check stay allowed.",
        "read-only-agent"
    )
// The file tools only meet section 4; a shell command meets every section.
const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"])
const bash = tool === "Bash"
if (!bash && !FILE_TOOLS.has(tool)) ok()
const cmd = bash ? String(payload?.tool_input?.command ?? "") : ""
if (bash && !cmd.trim()) ok()

// --- normalization ------------------------------------------------------------

// A heredoc body is data (in these repositories it is used to write documentation about these very
// commands), not calls.
const noHeredoc = cmd.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?^\s*\1\s*$/gm, " <<data>> ")

const unquoted = noHeredoc.replace(/'[^']*'/g, " ").replace(/"[^"]*"/g, " ")

// The leading word of the command — skipping environment assignments and wrappers.
const leadingWord = (s) => {
    for (const t of s.trim().split(/\s+/)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue
        if (/^(sudo|env|command|nohup|time|xargs)$/.test(t)) continue
        return t.replace(/.*\//, "")
    }
    return ""
}

// For search and text utilities the contents of quotes are data: searching for a string about
// a dangerous command and writing documentation about it is allowed.
const TEXT_ONLY =
    /^(grep|rg|ack|ag|cat|echo|printf|sed|awk|less|head|tail|find|jq|wc|diff|comm|bat|column|sort|uniq)$/
const textual = TEXT_ONLY.test(leadingWord(noHeredoc))

// `git -C <path>` and `git -c k=v` do not change the nature of the action — strip them.
const normalizeGit = (s) =>
    s
        .replace(/\bgit\s+((?:-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+)\s+)+/g, "git ")
        .replace(/[ \t]+/g, " ")

const segments = (s) => s.split(/;|&&|\|\||\||\n/)

// --- 0. Codex: an interactive shell of an agent of the Harness ------------------
// A command whose first stage reads the session's input as commands: a shell, a language
// interpreter or a terminal multiplexer started without a script, a command given on the line or a
// redirected input. On Codex such a command opens an exec Session that write_stdin then types into
// unguarded. A command given is -c for a shell (-Command, -File, /c for PowerShell and cmd) and
// -c, -e, -p, -m for an interpreter; -v, --version, --help, --test and bash -n run no prompt.
// shortcut: the operand test takes any word that is not an option as a script (`bash --rcfile x`
// passes) and the lists name the common programs only; widen them when a refused start is seen to
// pass in a recording of Codex (test/fixtures/codex-messages/hooks/PreToolUse.jsonl).
const SHELLS = /^(sh|bash|zsh|dash|ksh|mksh|fish|csh|tcsh|ash|pwsh|powershell|cmd)$/
const INTERPRETERS = /^(node|nodejs|deno|bun|python|python2|python3|py|ipython|irb|ruby|perl|php|lua)$/
const MULTIPLEXERS = /^(tmux|screen|script)$/
const SHELL_GIVEN = /^(-c|-command|-file|-encodedcommand|\/c)$/i
const INTERPRETER_GIVEN = /^(-c|-e|-p|-m|--eval|--print)$/
const NO_PROMPT = /^(-v|-V|--version|-h|--help|--test|-n)$/
const WRAPPERS = /^(sudo|env|command|nohup|time|exec|nice|stdbuf|caffeinate)$/
// `form` is the command with each quoted string as the word Q: a quoted script is an operand, and a
// quoted text is no command.
const interactiveStart = (form) => {
    for (const command of form.split(/&&|\|\||[;\n]|(?<![<>&])&(?![<>&])/)) {
        // Only the first stage of a pipeline reads the session's input, and not when it is redirected.
        const first = command.split("|")[0]
        if (/<<data>>|<<<|(^|\s)\d*<(?!<)/.test(first)) continue
        const words = first.trim().split(/\s+/).filter(Boolean)
        while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || WRAPPERS.test(words[0]))) words.shift()
        if (!words.length) continue
        const name = words[0].replace(/.*[\\/]/, "").replace(/\.exe$/i, "")
        const args = words.slice(1)
        if (MULTIPLEXERS.test(name)) return name
        if (!SHELLS.test(name) && !INTERPRETERS.test(name)) continue
        if (args.some((a) => NO_PROMPT.test(a))) continue
        const lower = args.map((a) => a.toLowerCase())
        if (lower.includes("-i") || lower.includes("-s") || lower.includes("-") || lower.includes("/k") || lower.includes("-noexit")) return name
        if (args.some((a) => (SHELLS.test(name) ? SHELL_GIVEN : INTERPRETER_GIVEN).test(a))) continue
        if (args.some((a) => !/^[-+]/.test(a) && !(name === "cmd" && a.startsWith("/")))) continue
        return name
    }
    return null
}
if (codex && isHarnessAgent(agent)) {
    const opened = interactiveStart(noHeredoc.replace(/'[^']*'/g, "Q").replace(/"[^"]*"/g, "Q"))
    if (opened)
        deny(
            `On Codex an agent of the Harness opens no interactive \`${opened}\`: what it would type into it later (write_stdin) passes no guard. ` +
                "Run each command as a shell command of its own, or give the program its script: `bash -c '…'`, `node script.mjs`, `python3 -c '…'`.",
            "interactive-shell"
        )
}

// --- 1. Destroying uncommitted work -------------------------------------------
const HOWTO =
    "\nThe right way: set the work aside with a temporary commit (`git commit -m wip`), and if a stash " +
    'cannot be avoided — `git stash push -u -m "<label>"`, note the SHA via ' +
    "`git stash list --format='%H %gs'` and bring it back with `git stash apply <sha>`.\n" +
    "If the edits really must be thrown away — tell the user so and give the command to them."

const WIPES_ALL = (a) => a === "." || a === "./" || a === "*"

const inspect = (form) => {
    for (const seg of segments(form)) {
        const t = seg.trim().split(/\s+/).filter(Boolean)
        if (t[0] !== "git") continue
        const sub = t[1]
        const args = t.slice(2)

        if ((sub === "checkout" || sub === "restore") && args.some(WIPES_ALL))
            return (
                "`git " +
                sub +
                "` over the whole tree wipes uncommitted edits without a trace. Work has already been lost this way."
            )

        if (sub === "reset" && args.some((a) => a === "--hard"))
            return "`git reset --hard` wipes both the index and the working tree."

        if (sub === "clean" && args.some((a) => a === "--force" || /^-[a-zA-Z]*f/.test(a)))
            return "`git clean` with the force flag deletes untracked files irreversibly."

        if (sub === "stash") {
            const first = args[0]
            if (first === "pop" || first === "drop")
                return (
                    "The stash stack is shared with all worktrees: `" +
                    first +
                    "` may take someone else's entry."
                )
            const BARE = ["-u", "--include-untracked", "-k", "--keep-index", "-a", "--all", "save"]
            if (!first || BARE.includes(first))
                return "A bare `git stash` puts an unnamed entry onto the stack shared by all worktrees."
        }
    }
    return null
}

const forms = textual ? [normalizeGit(unquoted)] : [normalizeGit(noHeredoc), normalizeGit(unquoted)]
for (const form of forms) {
    const why = inspect(form)
    if (why) deny(why + HOWTO, "uncommitted-work")
}

// --- 2. A pipe that eats the exit code ----------------------------------------
// Filtering long output is right and necessary — the context is not unlimited. The only thing
// not allowed is losing the exit code while doing it: pipefail returns the code of the first failed
// command in the pipeline, without it only the code of the last one is visible (grep, tail, head).
const VERIFY =
    /\b(pnpm|yarn|npm)\b[^|]*\b(lint|test|typecheck|check|build)\b|\b(vitest|eslint|tsc|jest|pytest)\b|\bgh\s+pr\s+checks\b/

const pipeline = noHeredoc.replace(/\|\|/g, " ")
const firstPipe = pipeline.indexOf("|")
if (firstPipe !== -1 && !textual) {
    // The first segment is taken raw: `pnpm "test" | tail` is a check.
    const before = pipeline.slice(0, firstPipe)
    // pipefail counts only if it is declared before the pipe itself.
    if (!/pipefail/.test(before) && VERIFY.test(before)) {
        deny(
            "The pipe eats the exit code: what is visible is the code of the last command in the pipeline, not of the check.\n" +
                "This is exactly how lint was declared clean while it was red: `pnpm lint | grep` returned grep's code.\n" +
                "The right way: `set -o pipefail; <command> | tail -n 20` — the filter stays, the exit code survives.\n" +
                "Or save the output to a file, print `echo $?` and look at the tail separately.",
            "pipe-exit-code"
        )
    }
}

// --- 3. Traces of the workflow (Silent mode, attribution off) -------------------
// In a Silent project the repository and its PRs show no epic names, ticket and ADR numbers, Workflow folder
// paths, `.scratch` or `HANDOFF`; with `attribution: off` (any mode) no Claude attribution lines. What counts
// as a trace and whether the project checks anything at all is bin/silent-check's call (a Full project with
// attribution on — exit 0 at once). Here: which commands publish text, what text, and from which directory.
// Checked: git commit (-m, -F, and what the commit takes from the index), the branch name of git checkout -b,
// git switch -c, git branch <name>, git worktree add -b, gh pr create|edit|comment|review|merge (--title,
// --body, --body-file, --subject), and gh api: a write (POST, PATCH, PUT, or gh's implicit POST when fields or
// --input are given) into a PR or an issue — a new PR or issue, its title and description, a comment, a reply, a
// review, its dismissal, a merge (the body, title, commit_title, commit_message and message fields, the same fields
// in an --input JSON payload) — and a GraphQL mutation (the query and every field). A gh api read (GET, DELETE, a
// GraphQL query) asks nothing. A file a command sends is read the way its shell would find it (`~`, `$HOME`,
// `$TMPDIR`, variables the command sets; Git Bash paths on Windows); a gh api file that cannot be read is refused.
// bin/silent-check gets one try of SILENT_TRY_MS; a try that does not answer in time is repeated once. All the
// checks of one command share a budget of two tries, so the hook ends within its own limit in hooks.json (30 s)
// even when every try times out: a hook that overruns its limit is stopped, and the command runs unchecked.
// The command goes on only when the check says it is clean (exit 0), or when it cannot read the profile
// (exit 2 with that reason): the guard must not break a session because a profile is unreadable. Everything
// else is refused with the reason: traces found, no answer after the retry, a check that cannot start, a
// signal, an unknown exit code, exit 2 for any other reason (the tickets root, git, the input).
const SILENT_TRY_MS = (() => {
    const DEFAULT = 10000
    // A test may shorten a try, never lengthen it past the hook's limit.
    const v = Number(process.env.CLAUDE_SILENT_CHECK_TIMEOUT_MS)
    return Number.isInteger(v) && v > 0 ? Math.min(v, DEFAULT) : DEFAULT
})()
const silentCheck = () => {
    const refuse = (reason) => deny(reason, "workflow-traces")
    const base = cwdOf()
    // Heredoc bodies are the text of `-F -`, `--body-file -` and `-m "$(cat <<'EOF' … EOF)"`.
    const { flat, bodies } = flattenHeredocs(cmd)
    const checks = [] // {dir, what, command, texts: [], diff: []}
    let dir = base
    // The paths the commands before the current one name (their words and redirection targets, resolved against the
    // directory each ran in), and the raw text before it: a file a gh api call sends that an earlier command names may
    // be one that command writes.
    const named = new Set()
    for (const words of lex(flat)) {
        const before = { text: flat.slice(0, words.at), paths: new Set(named) }
        for (const x of [...words, ...words.redirects]) for (const p of namedPaths(x, dir)) named.add(p)
        let w = words
        // `T=/x` alone or `export T=/x` sets a variable a later file path may name; `T=/x cmd` sets it for cmd only.
        if (words.every((x) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(x))) words.forEach(setShellVar)
        else if (words[0] === "export") words.slice(1).forEach(setShellVar)
        while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || /^(sudo|env|command|nohup|time)$/.test(w[0]))) w = w.slice(1)
        if (!w.length) continue
        const prog = w[0].replace(/.*\//, "")
        if (prog === "cd") {
            const to = w[1] === undefined || w[1] === "~" ? process.env.HOME || dir : w[1].replace(/^~(?=\/)/, process.env.HOME || "~")
            if (w[1] !== "-") dir = path.resolve(dir, to)
            continue
        }
        if (prog === "git") gitCommand(w.slice(1), dir, checks, bodies, flat)
        else if (prog === "gh") ghCommand(w.slice(1), dir, checks, bodies, before)
    }
    const deadline = Date.now() + 2 * SILENT_TRY_MS
    for (const c of checks) {
        const notRun = `\`${c.command}\` was not run: `
        if (!fs.existsSync(SILENT_CHECK))
            refuse(
                notRun +
                    `the check for workflow traces could not start: ${SILENT_CHECK} does not exist, ` +
                    `so nothing tells whether ${lowerFirst(c.what)} carries traces. The Harness installation is incomplete; ` +
                    "restore bin/silent-check, then run the same command again."
            )
        // bin/silent-check refuses a directory that does not exist yet (`mkdir x && cd x && git …`); the
        // repository the command works in is the one around its nearest existing parent.
        // shortcut: a new repository the command itself creates inside a project repository (`git init x && cd x
        // && git commit`) is checked from the parent, with the parent's index; redo when such nested repositories
        // become a real case (the check would then need to run after `git init`, which a PreToolUse hook cannot).
        let dir = c.dir
        while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir)
        // A file the command sends but the guard could not read goes to the check as it is: a project that checks
        // nothing answers 0 before it reads any file, and one that checks fails with "cannot read" below.
        const unread = c.unread || []
        const args = [SILENT_CHECK, "-C", dir, "--file", "-", ...unread.flatMap((u) => ["--file", u.abs]), ...c.diff]
        const byHand = `\`${["silent-check", "-C", dir, "--file", "<a file with the same text>", ...c.diff].join(" ")}\``
        const tries = []
        let r
        while (tries.length < 2) {
            const left = deadline - Date.now()
            if (left <= 0) break
            const t = Math.min(SILENT_TRY_MS, left)
            tries.push(t)
            r = spawnSync(process.execPath, args, { input: c.texts.join("\n"), encoding: "utf8", timeout: t, maxBuffer: 1 << 26 })
            if (r.error?.code !== "ETIMEDOUT") break
        }
        const errText = (r?.stderr || "").trim().split("\n").slice(0, 5).join("\n")
        if (!r || r.error?.code === "ETIMEDOUT")
            refuse(
                notRun +
                    "the check for workflow traces (bin/silent-check) did not finish in " +
                    (tries.length ? tries.map((t) => `${Math.round(t / 100) / 10} s`).join(" and then ") : "the time left") +
                    `, so nothing tells whether ${lowerFirst(c.what)} carries traces. Nothing was published. ` +
                    "Run the same command again. If the check keeps running out of time, the machine is likely overloaded: " +
                    `look at its load, and run the check by hand on the same text to see how long it takes: ${byHand}.`
            )
        if (r.error && !unreadStdin(r.error, r.status, r.signal))
            refuse(
                notRun +
                    `the check for workflow traces (bin/silent-check) failed (${r.error.code || "error"}: ${r.error.message}), ` +
                    `so nothing tells whether ${lowerFirst(c.what)} carries traces. Run the same command again; ` +
                    `if it fails the same way, run the check by hand and fix what it reports: ${byHand}.`
            )
        // A file read with its old text: refused only where the project checks texts at all (a clean verdict), not
        // where silent-check had nothing to check (a Full project with attribution on, a folder outside a project).
        const stale = c.stale || []
        if (r.status === 0 && stale.length && /^silent-check: clean\b/m.test(r.stdout || ""))
            refuse(
                notRun +
                    stale
                        .map(
                            (u) =>
                                `an earlier part of this same command names \`${u.written}\`, a file it sends: the guard reads that file before any ` +
                                "part of the command runs, so it checked the text the file had before, not the one that part may write into it, " +
                                "and running the same command again ends the same way. "
                        )
                        .join("") +
                    "Nothing was published. Write the file in one command, then send it in the next one."
            )
        if (r.status === 0) continue
        if (r.status === 2 && /^silent-check: profile not read\b/m.test(r.stderr || "")) continue
        if (r.status === 2 && unread.length && /^silent-check: cannot read /m.test(r.stderr || ""))
            refuse(
                notRun +
                    `a file it sends could not be read (${errText.replace(/^silent-check: /, "")}), ` +
                    `so nothing tells whether ${lowerFirst(c.what)} carries traces. Nothing was published. ` +
                    unread
                        .map((u) =>
                            u.unresolved
                                ? `\`${u.written}\` names a shell variable or a command substitution the guard cannot expand: ` +
                                  "write the path out, or start it with ~, $HOME, $TMPDIR or a variable this command sets to a plain value. "
                                : u.earlier
                                  ? `An earlier part of this same command names \`${u.written}\`: if it writes that file, the file does not exist yet ` +
                                    "when the guard reads it, before any part of the command runs, and running the same command again ends the same way. " +
                                    "Write the file in one command, then send it in the next one. "
                                  : `Check the path \`${u.written}\` (a relative one is read from the directory the command runs in), then run the same command again. `
                        )
                        .join("")
                        .trim()
            )
        if (r.status === 1 && r.stdout.trim())
            refuse(
                `${c.what} carries traces of the workflow, and this project keeps them out of its repository and PRs ` +
                    "(Silent mode: no epic names, ticket or ADR numbers, Workflow folder paths, `.scratch`, `HANDOFF`; " +
                    "attribution off: no Claude attribution lines). Found:\n" +
                    capLines(r.stdout.trim(), 50) +
                    "\nDescribe the change itself, the way any commit, branch or PR of this repository would; " +
                    "workflow files go to the Workflow folder (`profile --field _resolved.workflow_folder`), not into the index." +
                    // An agent adds these lines by its general instructions; nothing in a Silent profile may say `off`.
                    // The guard does not know the mode, so the sentence holds for a Full project with `off` too.
                    (/: Claude attribution "/.test(r.stdout)
                        ? "\nLeave the Claude attribution lines out (`Co-Authored-By: Claude …`, `Generated with [Claude Code]`), " +
                          "whatever other instructions ask for them: `attribution` is off for this project " +
                          "(`profile --field attribution`) — either its profile says so, or the profile does not set it " +
                          "and off is the default of Silent mode."
                        : "")
            )
        refuse(
            notRun +
                `the check for workflow traces (bin/silent-check) failed (${r.signal ? `signal ${r.signal}` : `exit ${r.status}`}), ` +
                `so nothing tells whether ${lowerFirst(c.what)} carries traces.` +
                (errText ? ` Its error output:\n${errText}\n` : " It printed no error. ") +
                `Run the same command again; if it fails the same way, run the check by hand and fix what it reports: ${byHand}.`
        )
    }
}

// True when the only error of a finished check is that it exited before it read all of its stdin (an answer
// that needs no text, such as exit 0 of a Full project, or a crash). The write into the closed pipe fails with
// EPIPE on macOS and Linux and with EOF on Windows, where libuv reports ERROR_BROKEN_PIPE as EOF. The exit code
// or signal is still the verdict, read after this check; any other error, or a check that never ended (no exit
// code and no signal), has no verdict.
const unreadStdin = (error, status, signal) =>
    (error?.code === "EPIPE" || error?.code === "EOF") && (status !== null || signal !== null)

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1)
// The first <max> lines of a long text, and how many more there are: a refusal stays readable.
const capLines = (text, max) => {
    const lines = text.split("\n")
    return lines.length > max ? [...lines.slice(0, max), `… ${lines.length - max} more lines`].join("\n") : text
}

// The command with each heredoc body taken out: `flat` keeps the rest of the line after `<<EOF` as a command,
// `bodies` holds the bodies, data and not calls.
function flattenHeredocs(src) {
    const bodies = []
    const HEREDOC = /<<-?[ \t]*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm
    const flat = src.replace(HEREDOC, (_m, _q, _tag, rest, body) => {
        bodies.push(body)
        return " " + rest
    })
    return { flat, bodies }
}

// A shell lexer good enough for the commands above: words with quotes removed, commands split on ; & | && ||
// newlines and parentheses, `$( … )` and backticks kept as raw text inside a word, redirections left out of the
// words. Each command also carries `redirects`, the targets of its redirections, `writes`, those of them that write
// a file (`>`, `>>`, `&>`, `<>`; not `<`, `<<<`, nor a descriptor copy such as `2>&1`), and `at`, the offset in `src`
// where it starts.
function lex(src) {
    const cmds = []
    let words = []
    let redirects = []
    let writes = []
    let at = null
    let cur = null
    let dropNext = false
    let dropOp = ""
    const pushWord = () => {
        if (cur !== null) {
            if (dropNext) {
                dropNext = false
                redirects.push(cur)
                if (dropOp.includes(">") && !(dropOp.endsWith("&") && /^(\d+|-)$/.test(cur))) writes.push(cur)
            } else words.push(cur)
            cur = null
        }
    }
    const endCmd = () => {
        pushWord()
        dropNext = false
        if (words.length || redirects.length) cmds.push(Object.assign(words, { redirects, writes, at: at ?? src.length }))
        words = []
        redirects = []
        writes = []
        at = null
    }
    const add = (t) => {
        at ??= i
        cur = (cur ?? "") + t
    }
    const skipSubst = (i) => {
        let depth = 1
        while (i < src.length) {
            const ch = src[i]
            if (ch === "\\") i += 2
            else if (ch === "'") i = closeAt(src.indexOf("'", i + 1))
            else if (ch === '"') i = skipDq(i + 1)
            else {
                if (ch === "(") depth++
                else if (ch === ")" && --depth === 0) return i + 1
                i++
            }
        }
        return src.length
    }
    const closeAt = (j) => (j === -1 ? src.length : j + 1)
    const skipDq = (i) => {
        while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1
        return i + 1
    }
    let i = 0
    while (i < src.length) {
        const c = src[i]
        if (c === "\\") {
            if (src[i + 1] !== "\n") add(src[i + 1] ?? "")
            i += 2
        } else if (c === "'") {
            const j = src.indexOf("'", i + 1)
            add(src.slice(i + 1, j === -1 ? src.length : j))
            i = closeAt(j)
        } else if (c === "$" && src[i + 1] === "'") {
            let j = i + 2
            let t = ""
            while (j < src.length && src[j] !== "'") {
                if (src[j] === "\\") {
                    const e = src[j + 1]
                    t += e === "n" ? "\n" : e === "t" ? "\t" : e ?? ""
                    j += 2
                } else t += src[j++]
            }
            add(t)
            i = j + 1
        } else if (c === '"') {
            let j = i + 1
            let t = ""
            while (j < src.length && src[j] !== '"') {
                if (src[j] === "\\" && '"\\$`\n'.includes(src[j + 1] ?? "")) {
                    if (src[j + 1] !== "\n") t += src[j + 1]
                    j += 2
                } else if (src[j] === "$" && src[j + 1] === "(") {
                    const k = skipSubst(j + 2)
                    t += src.slice(j, k)
                    j = k
                } else t += src[j++]
            }
            add(t)
            i = j + 1
        } else if (c === "$" && src[i + 1] === "(") {
            const k = skipSubst(i + 2)
            add(src.slice(i, k))
            i = k
        } else if (c === "`") {
            const j = closeAt(src.indexOf("`", i + 1))
            add(src.slice(i, j))
            i = j
        } else if (c === "#" && cur === null) {
            while (i < src.length && src[i] !== "\n") i++
        } else if (c === " " || c === "\t") {
            pushWord()
            i++
        } else if (c === "<" || c === ">" || (c === "&" && src[i + 1] === ">")) {
            if (cur !== null && /^\d+$/.test(cur)) cur = null // the fd of 2>
            pushWord()
            at ??= i
            const from = i
            while (i < src.length && "<>&".includes(src[i])) i++
            // `>|` writes even under noclobber: the bar is part of the operator, not a pipe
            if (src[i] === "|" && src[i - 1] === ">") i++
            dropNext = true
            dropOp = src.slice(from, i)
        } else if (";&|\n()".includes(c)) {
            endCmd()
            i++
        } else {
            add(c)
            i++
        }
    }
    endCmd()
    return cmds
}

function gitCommand(w, dir, checks, bodies, flat) {
    let i = 0
    for (; i < w.length; i++) {
        if (w[i] === "-C" && w[i + 1] !== undefined) dir = path.resolve(dir, w[++i])
        else if (w[i] === "-c" || w[i] === "--git-dir" || w[i] === "--work-tree" || w[i] === "--namespace") i++
        else if (!w[i].startsWith("-")) break
    }
    const sub = w[i]
    const args = w.slice(i + 1)
    if (sub === "commit") {
        const texts = []
        let all = false
        for (let k = 0; k < args.length; k++) {
            const a = args[k]
            const val = () => args[++k]
            if (a === "-m" || a === "--message") texts.push(val() ?? "")
            else if (a.startsWith("--message=")) texts.push(a.slice(10))
            else if (a === "-F" || a === "--file") texts.push(...fileText(val(), dir))
            else if (a.startsWith("--file=")) texts.push(...fileText(a.slice(7), dir))
            else if (a === "--all") all = true
            else if (/^-[A-Za-z]/.test(a)) {
                // A cluster of short flags: -am "msg", -amsg, -aF file.
                for (let p = 1; p < a.length; p++) {
                    const f = a[p]
                    if (f === "a") all = true
                    else if (f === "m" || f === "F" || f === "c" || f === "C" || f === "t") {
                        const v = p + 1 < a.length ? a.slice(p + 1) : val()
                        if (f === "m") texts.push(v ?? "")
                        else if (f === "F") texts.push(...fileText(v, dir))
                        break
                    }
                }
            }
        }
        // `git add … && git commit` in one command: the index is not filled yet, so look at the whole tree,
        // the untracked files included.
        const adds = /(^|[;&|\n(]\s*)git(\s+-C\s+\S+)*\s+add\b/.test(flat)
        checks.push({ dir, what: "This commit", command: "git commit", texts: [...texts, ...bodies], diff: ["--cached", ...(all || adds ? ["--diff", "HEAD"] : []), ...(adds ? ["--untracked"] : [])] })
        return
    }
    const branchOf = (flags) => {
        for (let k = 0; k < args.length; k++) {
            const a = args[k]
            for (const f of flags) {
                if (a === f) return args[k + 1]
                if (f.startsWith("--") && a.startsWith(f + "=")) return a.slice(f.length + 1)
            }
        }
        return undefined
    }
    let name
    if (sub === "checkout") name = branchOf(["-b", "-B", "--orphan"])
    else if (sub === "switch") name = branchOf(["-c", "-C", "--create", "--force-create", "--orphan"])
    else if (sub === "worktree" && args[0] === "add") name = branchOf(["-b", "-B"])
    else if (sub === "branch") {
        const LIST = /^(-d|-D|--delete|-l|--list|-a|--all|-r|--remotes|-v|-vv|--verbose|--contains|--no-contains|--merged|--no-merged|--show-current|--points-at|--format.*|--sort.*|-u|--set-upstream-to.*|--unset-upstream|--edit-description)$/
        if (!args.some((a) => LIST.test(a))) {
            const plain = args.filter((a) => !a.startsWith("-"))
            // git branch <new> [<start>]; git branch -m|-M|-c|-C [<old>] <new>
            const rename = args.some((a) => /^(-m|-M|-c|-C|--move|--copy)$/.test(a))
            name = rename ? plain[plain.length - 1] : plain[0]
        }
    }
    if (name) checks.push({ dir, what: `The branch name "${name}"`, command: sub === "worktree" ? "git worktree add" : `git ${sub}`, texts: [name], diff: [] })
}

function ghCommand(w, dir, checks, bodies, before) {
    if (w[0] === "api") return ghApi(w.slice(1), dir, checks, bodies, before)
    if (w[0] !== "pr" || !["create", "edit", "comment", "review", "merge"].includes(w[1])) return
    const texts = []
    const args = w.slice(2)
    for (let k = 0; k < args.length; k++) {
        const a = args[k]
        const m = a.match(/^(--title|--body|--subject|--body-file)=(.*)$/s)
        if (m) texts.push(...(m[1] === "--body-file" ? fileText(m[2], dir) : [m[2]]))
        else if (["-t", "--title", "-b", "--body", "--subject"].includes(a)) texts.push(args[++k] ?? "")
        else if (a === "-F" || a === "--body-file") texts.push(...fileText(args[++k], dir))
    }
    if (texts.length) checks.push({ dir, what: `This PR text (gh pr ${w[1]})`, command: `gh pr ${w[1]}`, texts: [...texts, ...bodies], diff: [] })
}

// gh api writes that publish text into a PR or an issue. <o>/<r> and the numbers are any word, a shell variable
// too (`repos/$OWNER/$REPO/pulls/$N/comments`).
const GH_API_WRITES = [
    /^repos\/[^/]+\/[^/]+\/(pulls|issues)$/, // a new PR or issue
    /^repos\/[^/]+\/[^/]+\/(pulls|issues)\/[^/]+$/, // the title and description of one
    /^repos\/[^/]+\/[^/]+\/(pulls|issues)\/[^/]+\/comments$/, // a comment
    /^repos\/[^/]+\/[^/]+\/(pulls|issues)\/comments\/[^/]+$/, // an edit of a comment
    /^repos\/[^/]+\/[^/]+\/pulls\/[^/]+\/comments\/[^/]+\/replies$/, // a reply in a review thread
    /^repos\/[^/]+\/[^/]+\/pulls\/[^/]+\/reviews(\/[^/]+(\/(events|dismissals))?)?$/, // a review: new, edit, submit, dismiss
    /^repos\/[^/]+\/[^/]+\/pulls\/[^/]+\/merge$/, // the title and message of the merge commit
]
// The fields that carry published text; a nested field counts by its last key (`comments[][body]`). `message` is
// the reason of a review dismissal.
const GH_API_TEXT_KEYS = new Set(["body", "title", "commit_title", "commit_message", "message"])
// The long flags of gh api that take a value, and the short ones with their long names; any other flag is a switch
// (--paginate, -i, --silent).
const GH_API_VALUE = new Set(["--method", "--raw-field", "--field", "--header", "--jq", "--template", "--input", "--cache", "--preview", "--hostname"])
const GH_API_SHORT = { X: "--method", f: "--raw-field", F: "--field", H: "--header", q: "--jq", t: "--template", p: "--preview" }

function ghApi(args, dir, checks, bodies, before) {
    let endpoint
    let method
    let input
    const fields = [] // [flag, "key=value"]
    const take = (flag, value) => {
        if (value === undefined) return
        if (flag === "--method") method = value.toUpperCase()
        else if (flag === "--input") input = value
        else if (flag === "--raw-field" || flag === "--field") fields.push([flag, value])
    }
    for (let k = 0; k < args.length; k++) {
        const a = args[k]
        const long = a.match(/^(--[a-z-]+)=([\s\S]*)$/)
        if (long) take(long[1], long[2])
        else if (GH_API_VALUE.has(a)) take(a, args[++k])
        else if (/^-[^-]/.test(a)) {
            // A cluster of short flags, read the way gh's flag parser reads it: switches up to the first flag that
            // takes a value, whose value is the rest of the word (`-XPOST`, `-X=POST`, `-fbody=…`) or the next word
            // (`-iX POST`).
            for (let c = 1; c < a.length; c++) {
                if (!Object.hasOwn(GH_API_SHORT, a[c])) continue
                const rest = a.slice(c + 1).replace(/^=/, "")
                take(GH_API_SHORT[a[c]], rest || args[++k])
                break
            }
        } else if (!a.startsWith("--")) endpoint ??= a
    }
    if (endpoint === undefined) return
    const p = endpoint
        .replace(/^https?:\/\/[^/]+\//, "")
        .replace(/^\/+/, "")
        .replace(/^api\/v3\//, "")
        .replace(/[?#].*$/, "")
        .replace(/\/+$/, "")
    // GitHub Enterprise by full URL: https://<host>/api/graphql.
    const graphql = p === "graphql" || p === "api/graphql"
    // gh sends POST when fields or --input are given and no method is.
    const write = method ? ["POST", "PATCH", "PUT"].includes(method) : fields.length > 0 || input !== undefined
    if (!graphql && !(write && GH_API_WRITES.some((re) => re.test(p)))) return

    const texts = []
    const unread = []
    const read = [] // the files read from disk: {written, abs}
    const send = (f) => {
        const t = fileText(f, dir, unread)
        if (t.length) read.push({ written: f, abs: path.resolve(dir, expandPath(f)) })
        return t
    }
    for (const [flag, kv] of fields) {
        const eq = kv.indexOf("=")
        if (eq === -1) continue
        // A GraphQL request publishes any of its variables; a REST write publishes its text fields.
        if (!graphql && !GH_API_TEXT_KEYS.has(kv.slice(0, eq).match(/([^[\]]*)\]?$/)[1])) continue
        const value = kv.slice(eq + 1)
        // --field reads `@<file>` (`@-` is stdin, a heredoc body taken below); --raw-field takes the value as it is.
        if (flag === "--field" && value.startsWith("@")) texts.push(...send(value.slice(1)))
        else texts.push(value)
    }
    // A JSON payload of a REST write counts by its text fields, from a file or from the heredoc of `--input -`.
    // Any other heredoc (`-F body=@-`, `-f body="$(cat <<EOF …)"`) is published as it is.
    const payload = (t) => (graphql ? t : payloadText(t))
    if (input !== undefined) texts.push(...send(input).map(payload))
    const all = [...texts, ...(input === "-" ? bodies.map(payload) : bodies)]
    // A GraphQL query only reads; a mutation the guard cannot see in full (an unread file) is checked all the same.
    if (graphql && !unread.length && !all.some((t) => /\bmutation\b/.test(t))) return
    if (!all.length && !unread.length) return
    // A file named in an earlier part of the same command may be one that part writes: the guard reads it before
    // anything of the command runs, so it either does not exist yet or still has its old text. Earlier is before this
    // gh api call; named is the same path in any spelling (./x, the absolute path, a quoted part), or the path as
    // written anywhere in the text before the call (inside a script: node -e '…writeFileSync("p.json")').
    const earlier = (u) => before.paths.has(u.abs) || before.text.includes(u.written)
    for (const u of unread) u.earlier = earlier(u)
    const stale = read.filter(earlier)
    // The text lands in the repository the endpoint names, so that repository's project decides. A GraphQL mutation
    // and an endpoint the guard cannot resolve (a shell variable, gh's {owner}, a repository no checkout has) name
    // none: sent from the common folder above a project's repositories (its workspace), they are checked from every
    // repository of that project; anywhere else the directory the command runs in decides.
    // shortcut: such a write sent from a folder outside every registered project (a GraphQL addComment by node id
    // from $HOME) is checked from that folder, which no profile covers, so it goes through; redo when the guard
    // can tell the target repository of a node id without a network call.
    let targets = graphql ? [] : endpointCheckouts(p, dir)
    if (!targets.length) targets = workspaceCheckouts(dir)
    for (const at of targets.length ? targets : [dir])
        checks.push({
            dir: at,
            what: graphql ? "This GraphQL mutation (gh api graphql)" : `This text of gh api ${endpoint}`,
            command: `gh api ${endpoint}`,
            texts: all,
            diff: [],
            unread,
            stale,
        })
}

// One budget of a few seconds for every lookup of a command (git remotes, bin/profile), counted from the first: the
// hook must end within its own limit in hooks.json, and the trace checks after them take up to two tries.
let lookupUntil = 0
const lookupLeft = () => (lookupUntil ||= Date.now() + 4000) - Date.now()

// The registered checkouts (the gate registry's `match` folders) of the GitHub repository a REST endpoint names
// (repos/<owner>/<repo>/…): those with a remote of that owner and name, letter case aside. A write sent from the
// common folder above a project's repositories, or from a folder outside the registry, is checked by the project it
// lands in, not by the folder. None — a shell variable or gh's {owner} placeholder in the path, a repository no
// registered checkout has, an unreadable registry — leaves the check with the folder the command runs in. The git
// calls take from the lookup budget above.
function endpointCheckouts(p, cwd) {
    const m = p.match(/^repos\/([\w.-]+)\/([\w.-]+)\//)
    if (!m) return []
    const want = `${m[1]}/${m[2]}`.toLowerCase()
    let entries
    try {
        entries = JSON.parse(fs.readFileSync(gateConfigFile(process.env, cwd), "utf8")).repos
    } catch {
        return []
    }
    const found = []
    for (const r of Array.isArray(entries) ? entries : []) {
        if (typeof r?.match !== "string" || !r.match || lookupLeft() <= 0) continue
        const repo = path.resolve(r.match)
        if (found.includes(repo) || !fs.existsSync(repo)) continue
        const run = spawnSync(GIT, ["-C", repo, "config", "--get-regexp", "^remote\\..*\\.url$"], {
            encoding: "utf8",
            timeout: Math.max(1, Math.min(2000, lookupLeft())),
            windowsHide: true,
        })
        // `remote.origin.url git@github.com:o/r.git`, `… https://github.com/o/r`, `… ssh://git@host/o/r.git`
        const names = (run.stdout || "").split("\n").map((line) =>
            line
                .slice(line.indexOf(" ") + 1)
                .trim()
                .replace(/\/+$/, "")
                .replace(/\.git$/, "")
                .split(/[/:]/)
                .slice(-2)
                .join("/")
                .toLowerCase()
        )
        if (names.includes(want)) found.push(repo)
    }
    return found
}

// The repositories of the project whose workspace `dir` is (bin/profile: a directory above all the repositories of
// one profile, matched by no registry entry itself — `_resolved.workspace` set, `_resolved.gate_key` null) that exist
// on disk. None for a project repository, a folder outside the registry, or a profile that cannot be read in time:
// the folder the command runs in then decides, as before.
function workspaceCheckouts(dir) {
    let at = dir
    while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at)
    if (!fs.existsSync(PROFILE) || lookupLeft() <= 0) return []
    const run = spawnSync(process.execPath, [PROFILE, "-C", at, "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: Math.max(1, lookupLeft()),
        windowsHide: true,
    })
    if (run.status !== 0) return []
    let r
    try {
        r = JSON.parse(run.stdout)._resolved || {}
    } catch {
        return []
    }
    if (!r.workspace || r.gate_key || !Array.isArray(r.repos)) return []
    const found = []
    for (const repo of r.repos)
        if (typeof repo?.path === "string" && !found.includes(repo.path) && fs.existsSync(repo.path)) found.push(repo.path)
    return found
}

// The published text of a JSON payload of a REST write: its text fields at any depth (a review's body and
// comments[].body). The rest — a file path, a line, a commit — is not published text, and a file path often names
// the code area an epic is named after. A text that is not JSON counts whole. The walk keeps its own stack: a
// payload nested deeper than the call stack must not end the hook with an error, which would let the command run.
function payloadText(text) {
    let data
    try {
        data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) // a byte order mark first
    } catch {
        return text
    }
    const out = []
    const stack = [[data, ""]]
    while (stack.length) {
        const [v, key] = stack.pop()
        if (typeof v === "string") {
            if (GH_API_TEXT_KEYS.has(key)) out.push(v)
        } else if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], key])
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v).reverse()) stack.push([x, k])
    }
    return out.join("\n")
}

// Variables the command sets for itself before it names a file (`T=/tmp/x; … --input "$T/p.json"`), when the guard
// can read the value: no command substitution.
const shellVars = {}
function setShellVar(word) {
    const m = word.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/)
    if (!m) return
    if (/`|\$\(/.test(m[2])) delete shellVars[m[1]]
    else shellVars[m[1]] = expandPath(m[2])
}

// A path as the shell of the command reads it: `~`, `$HOME`, `$TMPDIR` and the variables the command set itself.
// On Windows that shell is Git Bash: `/c/…` is drive C, and `/tmp` is the user's temporary folder.
function expandPath(f) {
    let p = f.replace(/^~(?=[/\\]|$)/, "$HOME")
    p = p.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (m, braced, bare) => {
        const name = braced ?? bare
        if (Object.hasOwn(shellVars, name)) return shellVars[name]
        if (name === "HOME") return process.env.HOME || os.homedir()
        if (name === "TMPDIR") return process.env.TMPDIR || os.tmpdir()
        return m
    })
    if (process.platform === "win32")
        p = p.replace(/^\/tmp(?=\/|$)/, os.tmpdir().replace(/\\/g, "/")).replace(/^\/([A-Za-z])(?=\/|$)/, (_m, d) => `${d.toUpperCase()}:`)
    return p
}

// The paths a word of a command may name, resolved the way fileText resolves a path: the word itself, the value of a
// --flag=value word and of a key=@file field.
function namedPaths(word, dir) {
    const out = []
    for (const x of [word, word.replace(/^--?[\w-]+=/, ""), word.replace(/^[^=@]*=?@/, "")])
        if (x && !/^-/.test(x)) out.push(path.resolve(dir, expandPath(x)))
    return out
}

// The text of a file a command sends (git commit -F, gh pr --body-file, gh api --input and -F key=@file), read from
// disk. `-` is stdin — a heredoc body, which the checks take on their own. A file that cannot be read gives no
// text; with `unread` given it is also noted there, for the check to refuse: {written, abs, unresolved}.
function fileText(f, dir, unread) {
    if (f === undefined || f === "-" || f === "") return []
    const p = expandPath(f)
    const abs = path.resolve(dir, p)
    try {
        return [fs.readFileSync(abs, "utf8")]
    } catch {
        unread?.push({ written: f, abs, unresolved: /[$`]/.test(p) })
        return []
    }
}

// The directory the call runs in: the input's cwd, else the hook's own.
function cwdOf() {
    return typeof payload?.cwd === "string" && payload.cwd ? payload.cwd : process.cwd()
}

// The line deny() appends to WORFY_GUARD_LOG (the format is in the header). It reads the input only: a refusal may
// come before any other part of this script has run.
function denial(rule) {
    const input = payload?.tool_input || {}
    let what
    if (tool === "Bash") what = String(input.command ?? "")
    else if (tool === "apply_patch") what = `apply_patch ${patchOps(String(input.command ?? "")).map((o) => o.file).join(" ")}`
    else what = `${tool} ${input.file_path ?? input.notebook_path ?? ""}`
    what = what.replace(/\s+/g, " ").trim()
    return {
        time: new Date().toISOString(),
        rule: rule || "unnamed",
        agent: agentName || null,
        agent_id: agentId || null,
        ticket: refusedTicket,
        tool: typeof tool === "string" ? tool : null,
        command: what.length > 200 ? `${what.slice(0, 199)}…` : what,
        session: typeof payload?.session_id === "string" ? payload.session_id : null,
        cwd: cwdOf(),
    }
}

// --- 4. Verification paths, ticket mark, profile-set -------------------------------------------------------------
// A subagent writes a verification path only when the trail of its ticket on the base branch names it; the main
// Session is not refused (the Orchestrator writes the Quarantine itself, and its PRs pass bin/land like any other).
// The decision is bin/land's rule (verified): the list of lib/verification-paths.cjs and the profile's
// verification.paths, the ticket of the branch by tickets.branch, its trail by lib/ticket-trail.cjs at the tip of
// worktree.base (refs/remotes/<remote>/<branch>), or in the tickets folder when the tickets live outside the repository
// (Silent mode, a tickets root outside it). Here the branch is the one of the tree the file is in, and the guard never
// fetches: the preflight of each Wave does.
const PATH_STEP = "Write the need into your report; the Orchestrator adds the path to the trail"
// The fields of the profile the merge condition depends on: only the owner changes them (the Edit profile form, or a
// terminal), never an agent's session.
const MERGE_FIELDS = ["workflow.ci_check", "workflow.pipeline", "workflow.merge"]
const guardedField = (f) => f === "verification" || f.startsWith("verification.") || f === "workflow" || MERGE_FIELDS.includes(f)
// The time all the reads of this section share — bin/profile, git rev-parse, git symbolic-ref and the git calls of the
// trail read — well inside the hook's limit with section 3's two tries after it (8 + 2 × 10 s of 30 s). A read that fails
// or runs out of it counts as not answered: the call is let through, as when the hook itself fails (spec, «Риски»:
// «Сбой guard открывает проход»; bin/land checks the PR's diff at merge). A test may shorten it, never lengthen it.
const SECTION4_MS = (() => {
    const DEFAULT = 8000
    const v = Number(process.env.CLAUDE_GUARD_READ_MS)
    return Number.isInteger(v) && v > 0 ? Math.min(v, DEFAULT) : DEFAULT
})()
const section4Until = Date.now() + SECTION4_MS
const section4Left = () => Math.max(1, section4Until - Date.now())
const firstLine = (s) => String(s || "").trim().split("\n")[0]
const baseName = (w) => String(w).replace(/.*[\\/]/, "").replace(/\.(exe|cmd)$/i, "")

// The file operations of a Codex patch: {kind: add|update|delete|move, file, lines} — lines, the body under the header.
function patchOps(text) {
    const ops = []
    for (const line of text.replace(/\r/g, "").split("\n")) {
        const m = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/.exec(line)
        if (m) ops.push({ kind: { "Add File": "add", "Update File": "update", "Delete File": "delete", "Move to": "move" }[m[1]], file: m[2].trim(), lines: [] })
        else if (ops.length && !/^\*\*\* (Begin|End) Patch$/.test(line)) ops[ops.length - 1].lines.push(line)
    }
    return ops
}

// The text of a file after the hunks of an Update of a Codex patch, or null when a hunk does not fit: its old lines
// (context and "-") are looked for from the end of the previous hunk, after the line its "@@ <context>" names.
function applyHunks(text, lines) {
    const out = text.replace(/\r/g, "").split("\n")
    const hunks = [{ at: "", body: [] }]
    for (const line of lines) {
        if (line.startsWith("@@")) hunks.push({ at: line.slice(2).trim(), body: [] })
        else if (line !== "*** End of File") hunks[hunks.length - 1].body.push(line)
    }
    let cursor = 0
    for (const h of hunks) {
        const old = []
        const neu = []
        for (const l of h.body) {
            if (l.startsWith("+")) neu.push(l.slice(1))
            else if (l.startsWith("-")) old.push(l.slice(1))
            else {
                old.push(l.slice(1))
                neu.push(l.slice(1))
            }
        }
        if (!h.body.length) continue
        if (h.at) {
            const k = out.findIndex((l, i) => i >= cursor && l.trim() === h.at)
            if (k !== -1) cursor = k + 1
        }
        let i = -1
        if (!old.length) i = out.length
        else
            for (let k = cursor; k + old.length <= out.length && i === -1; k++)
                if (old.every((l, j) => out[k + j].trimEnd() === l.trimEnd())) i = k
        if (i === -1) return null
        out.splice(i, old.length, ...neu)
        cursor = i + neu.length
    }
    return out.join("\n")
}

// The words of a command that are not options, skipping the values of the options `valued` names; after `--` every
// word is one.
function operands(args, valued = []) {
    const out = []
    for (let k = 0; k < args.length; k++) {
        const a = args[k]
        if (a === "--") {
            out.push(...args.slice(k + 1).filter(Boolean))
            break
        }
        if (valued.includes(a)) k++
        else if (a && !a.startsWith("-")) out.push(a)
    }
    return out
}

// The files a shell command writes or removes, as {abs, folder, symlink}: the targets of its write redirections, and the
// operands of the common commands that write files (tee, cp, mv, install, ln, rsync, rm, rmdir, unlink, touch, truncate,
// dd of=, sed -i, perl -i); a folder copy (cp -r, -R, -a), mv and rsync write a whole folder at the destination, and rm
// and the source of mv remove one. A path is read the way its shell reads it (`~`, `$HOME`, `$PWD`, variables the
// command sets, `cd` or `pushd` before it; Git Bash paths on Windows); a word the guard cannot expand ($(…), an unknown
// variable) is skipped.
// shortcut: lexical, as every rule here: a script that writes a file itself (`node -e "…writeFileSync…"`), git
// checkout or git apply are not read; bin/land checks the PR's diff at merge.
function shellTargets(src) {
    const out = []
    const { flat } = flattenHeredocs(src)
    let dir = cwdOf()
    // folder — the command may write or remove a whole folder there, so a folder above a verification path counts too
    const add = (word, folder = false, symlink = false) => {
        const p = expandPath(word.replace(/^\$(?:PWD\b|\{PWD\})/, () => dir.replace(/\\/g, "/")))
        if (!p || /[$`]/.test(p) || /^\/dev\//.test(p)) return
        out.push({ abs: path.resolve(dir, p), folder, symlink })
    }
    for (const words of lex(flat)) {
        if (words.every((x) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(x))) words.forEach(setShellVar)
        else if (words[0] === "export") words.slice(1).forEach(setShellVar)
        for (const t of words.writes) add(t)
        let w = [...words]
        while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || /^(sudo|env|command|nohup|time|exec|nice)$/.test(w[0]))) w = w.slice(1)
        if (!w.length) continue
        const prog = baseName(w[0])
        const args = w.slice(1)
        if (prog === "cd" || prog === "pushd") {
            const to = operands(args)[0] ?? "~"
            if (to !== "-" && !/^[+-]\d+$/.test(to)) dir = path.resolve(dir, expandPath(to))
            continue
        }
        const TARGET = ["-t", "--target-directory", "-S", "--suffix"]
        if (prog === "tee") operands(args).forEach((f) => add(f))
        else if (prog === "cp" || prog === "mv" || prog === "install" || prog === "ln" || prog === "rsync") {
            const RSYNC = ["-e", "--rsh", "--exclude", "--include", "-f", "--filter", "--exclude-from", "--include-from", "--files-from", "--chmod", "--rsync-path", "--log-file", "-T", "--temp-dir", "--backup-dir", "--compare-dest", "--copy-dest", "--link-dest"]
            const valued = prog === "install" ? [...TARGET, "-m", "--mode", "-o", "--owner", "-g", "--group"] : prog === "rsync" ? RSYNC : TARGET
            const ops = operands(args, valued)
            const ti = args.findIndex((a) => a === "-t" || a === "--target-directory")
            const td = args.find((a) => a.startsWith("--target-directory="))
            const into = ti !== -1 ? args[ti + 1] : td ? td.slice(td.indexOf("=") + 1) : null
            const sources = into ? ops : ops.slice(0, -1)
            const dest = into ?? ops[ops.length - 1]
            if (dest === undefined) continue
            // a symbolic link counts wherever it is: it may point anywhere (touchesVerificationPath)
            const symlink = prog === "ln" && args.some((a) => /^-[a-zA-Z]*s/.test(a) || a === "--symbolic")
            if (prog === "ln" && !into && ops.length === 1) {
                add(path.basename(dest), false, symlink)
                continue
            }
            // a folder copy (cp -r, -R, -a), a move and rsync may write a whole folder at the destination: `cp -R tmpl .github`
            const whole = prog === "mv" || prog === "rsync" || (prog === "cp" && args.some((a) => /^-[a-zA-Z]*[rRa]/.test(a) || a === "--recursive" || a === "--archive"))
            add(dest, whole, symlink)
            // the destination may be a folder: the file lands there under its own name
            for (const s of sources) add(`${dest.replace(/[\\/]+$/, "")}/${path.basename(s.replace(/[\\/]+$/, ""))}`, whole, symlink)
            if (prog === "mv") sources.forEach((s) => add(s, true))
        } else if (prog === "rm" || prog === "rmdir" || prog === "unlink") operands(args).forEach((f) => add(f, true))
        else if (prog === "touch") operands(args, ["-t", "-d", "-r", "--date", "--reference"]).forEach((f) => add(f))
        else if (prog === "truncate") operands(args, ["-s", "--size", "-r", "--reference"]).forEach((f) => add(f))
        else if (prog === "dd") args.filter((a) => a.startsWith("of=")).forEach((a) => add(a.slice(3)))
        else if (prog === "sed" && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))) {
            const given = args.some((a) => /^(-e|-f|--expression|--file)(=|$)/.test(a))
            const files = operands(args, ["-e", "-f", "--expression", "--file", "-l"])
            ;(given ? files : files.slice(1)).forEach((f) => add(f))
        } else if (prog === "perl" && args.some((a) => /^-[a-zA-Z]*i/.test(a))) {
            const given = args.some((a) => /^-[a-zA-Z]*[eE]$/.test(a))
            const files = operands(args, args.filter((a) => /^-[a-zA-Z]*[eE]$/.test(a)))
            ;(given ? files : files.slice(1)).forEach((f) => add(f))
        }
    }
    // section 3 reads the variables of the command again, in its own order
    for (const k of Object.keys(shellVars)) delete shellVars[k]
    return out
}

// The program a command runs and its arguments, through `node <script>`: {prog, args}.
function programOf(words) {
    let w = [...words]
    while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || /^(sudo|env|command|nohup|time|exec|nice)$/.test(w[0]))) w = w.slice(1)
    if (!w.length) return null
    let prog = baseName(w[0])
    let args = w.slice(1)
    if (prog === "node" || prog === "nodejs") {
        const k = args.findIndex((a) => !a.startsWith("-"))
        if (k === -1) return null
        prog = baseName(args[k])
        args = args.slice(k + 1)
    }
    return { prog, args }
}

// `ticket mark` from a subagent (a commit status review, check/* or deploy: only the main Session marks), and
// `profile-set` of a field the merge condition depends on from any agent session.
function marksAndFields() {
    for (const words of lex(flattenHeredocs(cmd).flat)) {
        const p = programOf(words)
        if (!p) continue
        if (p.prog === "ticket" && subagent) {
            const positional = operands(p.args, ["--root", "--repo", "--sha", "--waits"])
            if (positional[0] === "mark" && !p.args.includes("--contexts"))
                deny(
                    "`ticket mark` writes the marks the merge condition reads (review, check/*, deploy), and only the main Session writes them. " +
                        "Put the verdict into your report; the Orchestrator marks the head.",
                    "ticket-mark-subagent"
                )
        }
        if (p.prog === "profile-set" && p.args.some((a) => a === "--set" || a === "--reset" || a.startsWith("--set="))) {
            const fields = []
            p.args.forEach((a, k) => {
                if (a === "--field" && p.args[k + 1] !== undefined) fields.push(p.args[k + 1])
                else if (a.startsWith("--field=")) fields.push(a.slice(8))
            })
            const named = fields.length ? fields.filter(guardedField) : ["workflow.pipeline"]
            if (named.length)
                deny(
                    `profile-set would change ${named.join(", ")}, a field the merge condition depends on (verification.*, ${MERGE_FIELDS.join(", ")}): ` +
                        "only the owner changes it, in the Edit profile form of worfy or in a terminal. Name the change and the reason in your report.",
                    "profile-set-merge-fields"
                )
        }
    }
}

// The profile of the project a folder is in (bin/profile -C <folder> --json), read once per folder: null — no project
// (exit 3) or no bin/profile; {profile: null, unread} — it could not be read.
const profileAt = new Map()
function projectProfile(dir) {
    if (profileAt.has(dir)) return profileAt.get(dir)
    let at = dir
    while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at)
    let read = null
    if (fs.existsSync(PROFILE)) {
        const r = spawnSync(process.execPath, [PROFILE, "-C", at, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: section4Left(), windowsHide: true })
        if (r.status === 3) read = null
        else if (r.error || r.status !== 0) read = { profile: null, unread: r.error ? `${r.error.code || r.error.message}` : `exit ${r.status}: ${firstLine(r.stderr)}` }
        else
            try {
                read = { profile: JSON.parse(r.stdout) }
            } catch {
                read = { profile: null, unread: "it printed no JSON" }
            }
    }
    profileAt.set(dir, read)
    return read
}

// A path with its nearest existing folder resolved through symbolic links (a file spelled through a link to the
// worktree is the worktree's file), and that folder: {real, dir}. The native realpath, as for the root of the work tree:
// on Windows it also gives the long name of a short one (RUNNER~1), so both sides of the comparison are spelled alike.
function realTarget(abs) {
    let at = abs
    const rest = []
    while (!fs.existsSync(at) && path.dirname(at) !== at) {
        rest.unshift(path.basename(at))
        at = path.dirname(at)
    }
    let real = at
    try {
        real = fs.realpathSync.native(at)
    } catch {}
    let dir = real
    try {
        if (!fs.statSync(real).isDirectory()) dir = path.dirname(real)
    } catch {}
    return { real: rest.length ? path.join(real, ...rest) : real, dir }
}

// The work tree a folder is in and the branch checked out there: {top, branch}, or null outside git (or no answer).
const treeOfDir = new Map()
function treeOf(dir) {
    if (treeOfDir.has(dir)) return treeOfDir.get(dir)
    const r = spawnSync(GIT, ["-C", dir, "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: section4Left(), windowsHide: true })
    const lines = r.status === 0 ? r.stdout.trim().split("\n") : []
    let tree = null
    if (lines.length === 2) {
        tree = { top: lines[0].trim(), branch: lines[1].trim() }
        try {
            tree.top = fs.realpathSync.native(tree.top)
        } catch {}
    }
    treeOfDir.set(dir, tree)
    return tree
}

// Where the tickets of the project are read: {folder} — a tickets folder outside the repository (Silent mode: under the
// Workflow folder; a tickets root outside the repository), else {folder: null} and git at the base branch. The same
// place bin/land (profileTicketsRoot, ticketsFolder) and bin/ticket root take.
function ticketsPlace(profile, top) {
    const field = profile?.tickets?.root
    let r = typeof field === "string" && field.trim() ? field.trim() : ".scratch"
    if (r === "~" || r.startsWith("~/")) r = path.join(os.homedir(), r.slice(1))
    const resolved = profile?._resolved || {}
    if (resolved.mode === "silent") return { folder: path.resolve(typeof resolved.workflow_folder === "string" ? resolved.workflow_folder : top, r) }
    if (path.isAbsolute(r) && normalizePath(r, { root: top }) === null) return { folder: path.resolve(r) }
    return { folder: null }
}

// The base branch the trail is read at: {name, ref} by worktree.base (origin/main → refs/remotes/origin/main), else the
// branch origin/HEAD points to; null when neither tells (git symbolic-ref failed or ran out of the budget).
function baseOf(profile, top) {
    let base = profile?.worktree?.base
    if (typeof base !== "string" || !base.trim()) {
        const h = spawnSync(GIT, ["-C", top, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { encoding: "utf8", timeout: section4Left(), windowsHide: true })
        base = h.status === 0 ? h.stdout.trim() : ""
    }
    base = base.trim()
    if (!base) return null
    return { name: base, ref: base.includes("/") ? `refs/remotes/${base}` : base }
}

// The ticket and trail of the tree `top` on `branch`, read once per tree (lib/ticket-trail.cjs readTrail).
const trailOfTree = new Map()
function trailOf(profile, tree) {
    if (trailOfTree.has(tree.top)) return trailOfTree.get(tree.top)
    const { folder } = ticketsPlace(profile, tree.top)
    const base = folder ? null : baseOf(profile, tree.top)
    let t
    // no base branch to read the trail at: the guard cannot tell, and land (which refuses such a profile) decides
    if (!folder && !base) t = { ticket: null, trail: null, reason: "the base branch cannot be told", unread: true }
    else {
        t = readTrail({ repo: tree.top, ref: base?.ref, branch: tree.branch, tickets: profile?.tickets || {}, git: GIT, folder, timeout: section4Left() })
        t.where = folder ? "the tickets folder" : base.name
    }
    trailOfTree.set(tree.top, t)
    return t
}

// The files this call writes: {abs, folder?, after?, edit?} — after: the text a ticket file would have (undefined
// when the call does not tell it, null when the file goes away).
function callTargets() {
    const input = payload?.tool_input || {}
    const cwd = cwdOf()
    if (bash) return shellTargets(cmd)
    if (tool === "apply_patch") {
        const out = []
        const ops = patchOps(String(input.command ?? ""))
        ops.forEach((o, k) => {
            const abs = path.resolve(cwd, expandPath(o.file))
            if (o.kind === "add") out.push({ abs, after: o.lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1)).join("\n") })
            else if (o.kind === "delete") out.push({ abs, folder: true, after: null })
            else if (o.kind === "update") {
                const moved = ops[k + 1]?.kind === "move"
                const body = moved ? ops[k + 1].lines : o.lines
                out.push({ abs, folder: moved, edit: (text) => (moved ? null : applyHunks(text, body)) })
            } else out.push({ abs, edit: () => undefined }) // the new place of a moved file
        })
        return out
    }
    const file = tool === "NotebookEdit" ? input.notebook_path : input.file_path
    if (typeof file !== "string" || !file) return []
    const abs = path.resolve(cwd, file)
    const replace = (text, e) => {
        if (typeof e?.old_string !== "string" || typeof e?.new_string !== "string" || !text.includes(e.old_string)) return text
        return e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string)
    }
    if (tool === "Write") return [{ abs, after: String(input.content ?? "") }]
    if (tool === "Edit") return [{ abs, edit: (text) => replace(text, input) }]
    if (tool === "MultiEdit") return [{ abs, edit: (text) => (Array.isArray(input.edits) ? input.edits.reduce(replace, text) : text) }]
    return [{ abs }]
}

// Silent mode (the tickets outside the repository): the trail is read from a file the subagent can reach, so its edit of
// any ticket's trail section is refused. The trail is compared as lib/ticket-trail.cjs reads it; an edit elsewhere in the
// ticket passes. A write whose text the guard cannot tell (a shell command, a patch whose hunks do not fit) is refused when
// the ticket has a trail section.
function trailEdit(t, folder, heading) {
    const rel = normalizePath(t.real, { root: folder })
    if (rel === null || !/\.md$/i.test(rel) || typeof heading !== "string") return
    let text = null
    try {
        text = fs.readFileSync(t.real, "utf8")
    } catch {}
    const before = text === null ? null : trailPaths(text, heading)
    let after
    if ("after" in t) after = t.after
    else if (t.edit && text !== null) after = t.edit(text)
    const afterTrail = after === undefined ? undefined : after === null ? null : trailPaths(after, heading)
    if (afterTrail === undefined ? before === null : JSON.stringify(before) === JSON.stringify(afterTrail)) return
    deny(
        `This edit ${afterTrail === undefined ? "may change" : "changes"} the trail section of ${rel} (${JSON.stringify(heading)}) in the tickets folder: ` +
            "outside the repository the guard and land read the trail from that file, so a subagent does not edit it. " +
            "Write the need into your report; the Orchestrator edits the trail." +
            (afterTrail === undefined ? " Edit the other sections of the ticket with an edit whose old and new text the guard can read (a file edit, not a shell command)." : ""),
        "ticket-trail-edit"
    )
}

// Whether the guard checks verification paths for a project: a ticket branch template (tickets.branch with <epic> and
// <NN>) and one repository.
// shortcut: a project of several repositories is not checked — its trail entries start with the repository's name and
// the guard compares paths from the root of one tree (lib/ticket-trail.cjs, the shortcut on several repositories: redo
// when a project with several repositories gets a verification path check); nor is a profile without a ticket branch
// template, where no branch can name a ticket. bin/land still checks their PRs at merge.
function checksPaths(profile) {
    const template = profile?.tickets?.branch
    const repos = profile?._resolved?.repos
    return typeof template === "string" && template.includes("<epic>") && template.includes("<NN>") && !(Array.isArray(repos) && repos.length > 1)
}

function verificationSection() {
    if (bash) marksAndFields()
    if (!subagent) return
    const targets = callTargets()
    for (const t of targets) {
        Object.assign(t, realTarget(t.abs))
        const tree = treeOf(t.dir)
        // the profile of the tree the file is in; a file outside the project's trees (a ticket in the Workflow folder)
        // is read by the profile of the folder the call runs in
        const read = tree ? projectProfile(tree.top) : null
        const own = read?.profile ? read : projectProfile(cwdOf())
        if (own?.profile && checksPaths(own.profile)) {
            const { folder } = ticketsPlace(own.profile, tree?.top || cwdOf())
            if (folder) trailEdit(t, realTarget(folder).real, own.profile.tickets?.trail_section)
        }
        // a folder no profile covers: the section is silent, as section 3 is; a profile that could not be read (a
        // failure or the end of the budget) lets the call through, and land checks the PR at merge
        if (!tree || !read?.profile || !checksPaths(read.profile)) continue
        const profile = read.profile
        const list = verificationPaths(profile)
        // an absolute root: a relative one would resolve from the working directory (a realpath on macOS)
        const opts = { root: tree.top }
        // the rule of bin/land: a verification path, or any symbolic link; and the folder above one a command may write or remove whole
        if (!(touchesVerificationPath(t.real, list, { ...opts, symlink: t.symlink === true }) || (t.folder && isVerificationParent(t.real, list, opts)))) continue
        const rel = normalizePath(t.real, opts) + (t.symlink ? " (a symbolic link, which may point anywhere)" : "")
        // a detached HEAD is a review tree (worktree.reviewer): no ticket, and a reviewer adds nothing to a trail
        if (tree.branch === "HEAD")
            deny(
                `${rel} is a verification path, and this work tree is on a detached HEAD: a subagent edits no verification path in a review tree. ` +
                    "Mutate a copy outside the repository (copy the folder into a temporary directory and run the test against the copy), " +
                    "or name the change in your report.",
                "verification-path-detached"
            )
        const trail = trailOf(profile, tree)
        // git did not answer (a failure, the end of the budget): the guard cannot tell, land decides at merge
        if (trail.unread) continue
        if (trail.ticket) refusedTicket = `${trail.ticket.epic}/${trail.ticket.nn}`
        if (!trail.ticket)
            deny(
                `${rel} is a verification path, and the branch ${tree.branch} names no ticket (${trail.reason}): a subagent without a ticket edits no verification path. ` +
                    `${PATH_STEP} of a ticket, and the edit is made on that ticket's branch.`,
                "verification-path-no-ticket"
            )
        const name = `${trail.ticket.epic} ${trail.ticket.nn}`
        if (!trail.trail) deny(`${rel} is a verification path, and the trail of ${name} cannot be read at ${trail.where} (${trail.reason}). ${PATH_STEP}.`, "verification-path")
        if (!namedByTrail(t.real, trail.trail, opts)) deny(`${rel} is a verification path, and the trail of ${name} does not name it. ${PATH_STEP}.`, "verification-path")
    }
}

// A failure inside section 4 lets the call through (spec, «Риски»: «Сбой guard открывает проход»; land checks the diff
// at merge), and section 3 still runs: process.exit inside deny() ends the hook before this catch.
try {
    verificationSection()
} catch {}

if (bash) silentCheck()

ok()
