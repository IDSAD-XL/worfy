#!/usr/bin/env node
// PreToolUse: refuses commands that destroy uncommitted work, and
// pipes that swallow the exit code of checks.
//
// The decision is returned in the permissionDecision field. We always exit with zero: an error in
// the hook itself must neither break the session nor silently let a call through unnoticed.
//
// The parsing goes by the segments of the command and by its arguments, not by a string match:
// `git -C /p checkout HEAD -- .` and `git checkout -f .` are the same action,
// and they must be caught the same way.

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

ok()
