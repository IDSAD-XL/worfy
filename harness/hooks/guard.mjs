#!/usr/bin/env node
// PreToolUse: refuses commands that destroy uncommitted work, pipes that swallow the exit code of
// checks, and — in a Silent project or with `attribution: off` — commit messages, branch names and PR
// texts that carry traces of the workflow (section 3, bin/silent-check).
//
// The decision is returned in the permissionDecision field. We always exit with zero: an error in
// the hook itself must neither break the session nor silently let a call through unnoticed.
//
// The parsing goes by the segments of the command and by its arguments, not by a string match:
// `git -C /p checkout HEAD -- .` and `git checkout -f .` are the same action,
// and they must be caught the same way.

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// bin/silent-check of this Harness: the folder above hooks/, found from this script's real file.
const SILENT_CHECK =
    process.env.CLAUDE_SILENT_CHECK_BIN || path.join(path.dirname(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))), "bin", "silent-check")

let raw = ""
process.stdin.setEncoding("utf8")
for await (const chunk of process.stdin) raw += chunk

const ok = () => process.exit(0)
const deny = (reason) => {
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
if (payload?.tool_name !== "Bash") ok()
const cmd = String(payload?.tool_input?.command ?? "")
if (!cmd.trim()) ok()

// --- normalization ------------------------------------------------------------

// A heredoc body is data (in these repositories it is used to write documentation about these very
// commands), not calls.
const noHeredoc = cmd.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?^\s*\1\s*$/gm, " <<данные>> ")

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
    if (why) deny(why + HOWTO)
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
                "Or save the output to a file, print `echo $?` and look at the tail separately."
        )
    }
}

// --- 3. Traces of the workflow (Silent mode, attribution off) -------------------
// In a Silent project the repository and its PRs show no epic names, ticket and ADR numbers, Workflow folder
// paths, `.scratch` or `HANDOFF`; with `attribution: off` (any mode) no Claude attribution lines. What counts
// as a trace and whether the project checks anything at all is bin/silent-check's call (a Full project with
// attribution on — exit 0 at once). Here: which commands publish text, what text, and from which directory.
// Checked: git commit (-m, -F, and what the commit takes from the index), the branch name of git checkout -b,
// git switch -c, git branch <name>, git worktree add -b, and gh pr create|edit|comment|review|merge (--title,
// --body, --body-file, --subject).
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
    const base = typeof payload?.cwd === "string" && payload.cwd ? payload.cwd : process.cwd()
    // Heredoc bodies are the text of `-F -`, `--body-file -` and `-m "$(cat <<'EOF' … EOF)"`. The rest of the
    // line after `<<EOF` stays a command.
    const bodies = []
    const HEREDOC = /<<-?[ \t]*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)^[ \t]*\2[ \t]*$/gm
    const flat = cmd.replace(HEREDOC, (_m, _q, _tag, rest, body) => {
        bodies.push(body)
        return " " + rest
    })
    const checks = [] // {dir, what, command, texts: [], diff: []}
    let dir = base
    for (const words of lex(flat)) {
        let w = words
        while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || /^(sudo|env|command|nohup|time)$/.test(w[0]))) w = w.slice(1)
        if (!w.length) continue
        const prog = w[0].replace(/.*\//, "")
        if (prog === "cd") {
            const to = w[1] === undefined || w[1] === "~" ? process.env.HOME || dir : w[1].replace(/^~(?=\/)/, process.env.HOME || "~")
            if (w[1] !== "-") dir = path.resolve(dir, to)
            continue
        }
        if (prog === "git") gitCommand(w.slice(1), dir, checks, bodies, flat)
        else if (prog === "gh") ghCommand(w.slice(1), dir, checks, bodies)
    }
    const deadline = Date.now() + 2 * SILENT_TRY_MS
    for (const c of checks) {
        const notRun = `\`${c.command}\` was not run: `
        if (!fs.existsSync(SILENT_CHECK))
            deny(
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
        const args = [SILENT_CHECK, "-C", dir, "--file", "-", ...c.diff]
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
            deny(
                notRun +
                    "the check for workflow traces (bin/silent-check) did not finish in " +
                    (tries.length ? tries.map((t) => `${Math.round(t / 100) / 10} s`).join(" and then ") : "the time left") +
                    `, so nothing tells whether ${lowerFirst(c.what)} carries traces. Nothing was published. ` +
                    "Run the same command again. If the check keeps running out of time, the machine is likely overloaded: " +
                    `look at its load, and run the check by hand on the same text to see how long it takes: ${byHand}.`
            )
        if (r.error)
            deny(
                notRun +
                    `the check for workflow traces (bin/silent-check) failed (${r.error.code || "error"}: ${r.error.message}), ` +
                    `so nothing tells whether ${lowerFirst(c.what)} carries traces. Run the same command again; ` +
                    `if it fails the same way, run the check by hand and fix what it reports: ${byHand}.`
            )
        if (r.status === 0) continue
        if (r.status === 2 && /^silent-check: profile not read\b/m.test(r.stderr || "")) continue
        if (r.status === 1 && r.stdout.trim())
            deny(
                `${c.what} carries traces of the workflow, and this project keeps them out of its repository and PRs ` +
                    "(Silent mode: no epic names, ticket or ADR numbers, Workflow folder paths, `.scratch`, `HANDOFF`; " +
                    "attribution off: no Claude attribution lines). Found:\n" +
                    r.stdout.trim() +
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
        deny(
            notRun +
                `the check for workflow traces (bin/silent-check) failed (${r.signal ? `signal ${r.signal}` : `exit ${r.status}`}), ` +
                `so nothing tells whether ${lowerFirst(c.what)} carries traces.` +
                (errText ? ` Its error output:\n${errText}\n` : " It printed no error. ") +
                `Run the same command again; if it fails the same way, run the check by hand and fix what it reports: ${byHand}.`
        )
    }
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1)

// A shell lexer good enough for the commands above: words with quotes removed, commands split on ; & | && ||
// newlines and parentheses, `$( … )` and backticks kept as raw text inside a word, redirections dropped.
function lex(src) {
    const cmds = []
    let words = []
    let cur = null
    let dropNext = false
    const pushWord = () => {
        if (cur !== null) {
            if (dropNext) dropNext = false
            else words.push(cur)
            cur = null
        }
    }
    const endCmd = () => {
        pushWord()
        dropNext = false
        if (words.length) cmds.push(words)
        words = []
    }
    const add = (t) => (cur = (cur ?? "") + t)
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
            while (i < src.length && "<>&".includes(src[i])) i++
            dropNext = true
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

function ghCommand(w, dir, checks, bodies) {
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

// The text of a -F / --body-file argument read from disk. `-` is stdin — a heredoc body, which every check
// takes anyway.
function fileText(f, dir) {
    if (f === undefined || f === "-") return []
    try {
        return [fs.readFileSync(path.resolve(dir, f), "utf8")]
    } catch {
        return []
    }
}

silentCheck()

ok()
