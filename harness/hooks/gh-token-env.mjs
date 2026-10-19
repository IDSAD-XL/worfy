#!/usr/bin/env node
// SessionStart: gives the session's Bash commands the GH_TOKEN of the project's GitHub account.
//
// The project is found by bin/profile of this plugin from the session directory (the `cwd` field of
// the hook JSON, else the current folder), the account is its `github.account`. When the account is a
// GitHub login and `gh auth token -u <account>` succeeds, one line is appended to $CLAUDE_ENV_FILE:
//
//   export GH_TOKEN="$(gh auth token -u <account> 2>/dev/null)"
//
// Claude Code runs that file before every Bash command of the session and of its subagents,
// so the token is computed on each command and is never written to disk,
// to stdout, to stderr or into additionalContext — this script only checks the exit code of gh.
// The project's account wins over a GH_TOKEN the user exported: the line overrides it.
// The global gh account is never touched: no `gh auth switch`, no `gh auth login`, no gh config.
//
// Nothing to do — exit 0 without output: no $CLAUDE_ENV_FILE, no profile script, no project or no
// account (profile exit 3 or 4, null, empty), a value that is not a GitHub login.
// The account is there but gh is missing or has no login under it — no line; one line of
// additionalContext tells the session, exit 0: the session is not stopped. A failure inside the
// hook is one line on stderr and code 0.
//
// bin/profile runs as `node <script>` (process.execPath), not by its #! line.
// For tests: CLAUDE_PROFILE_BIN replaces bin/profile; GH_TOKEN_ENV_GH names the program run instead
// of gh from PATH (a .mjs file runs with this node). Tests: hooks/tests/gh-token-env.test.sh.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// A GitHub login (the same rule as the worfy app's check of github.account): letters, digits
// and single inner hyphens, at most 39 characters. Anything else would land in a shell line that
// runs before every Bash command, or be read by gh as an option.
const GITHUB_LOGIN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/

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

// The program for gh and the arguments before gh's own: GH_TOKEN_ENV_GH when set, else gh from PATH.
function ghProgram() {
    const override = process.env.GH_TOKEN_ENV_GH
    if (!override) return ["gh", []]
    return override.endsWith(".mjs") ? [process.execPath, [override]] : [override, []]
}

// Tell the session why GH_TOKEN is not set: one line, no token in it. The account is a checked
// login, so it needs no escaping beyond JSON's own.
function note(account, why) {
    const additionalContext = `GitHub account ${account} of this project (profile github.account): ${why}, so GH_TOKEN is not set and gh and git against origin run as the active gh account. The owner runs gh auth login for ${account}, then starts a new session; do not switch the global gh account.`
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }) + "\n")
}

function main() {
    const envFile = process.env.CLAUDE_ENV_FILE || ""
    if (!envFile) return

    // bin/profile of this plugin: the folder above hooks/, found from this script's real file.
    const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))
    const profileBin = process.env.CLAUDE_PROFILE_BIN || path.join(path.dirname(here), "bin", "profile")
    if (!fs.existsSync(profileBin)) return

    const cwd = sessionDir(readStdin())
    const run = spawnSync(process.execPath, [profileBin, "-C", cwd, "--field", "github.account"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
    })
    if (run.error) throw run.error
    if (run.status !== 0) return
    let account = String(run.stdout ?? "").replace(/\n+$/, "")
    // A JSON-quoted string is taken too, as the worfy app's reader of github.account does.
    if (account.length >= 2 && account.startsWith('"') && account.endsWith('"')) account = account.slice(1, -1)
    if (!account || account === "null") return
    if (!GITHUB_LOGIN.test(account) || account.length > 39) return

    // The check reads only the exit code. A GH_TOKEN of the hook's own environment must not decide it.
    const env = { ...process.env }
    delete env.GH_TOKEN
    delete env.GITHUB_TOKEN
    const [gh, ghArgs] = ghProgram()
    const check = spawnSync(gh, [...ghArgs, "auth", "token", "-u", account], { env, stdio: "ignore", windowsHide: true })
    if (check.error?.code === "ENOENT") return note(account, "gh is not installed")
    if (check.error) throw check.error
    if (check.status !== 0) return note(account, "no gh login under it")

    const line = `export GH_TOKEN="$(gh auth token -u ${account} 2>/dev/null)"`
    let current = ""
    try {
        current = fs.readFileSync(envFile, "utf8")
    } catch {}
    // SessionStart fires again on resume and /clear: the line is added once.
    if (current.split("\n").includes(line)) return
    // A file that does not end with a newline would glue the export to its last line.
    const lead = current && !current.endsWith("\n") ? "\n" : ""
    try {
        fs.appendFileSync(envFile, `${lead}${line}\n`)
    } catch {}
}

try {
    main()
} catch (e) {
    process.stderr.write(`gh-token-env: ${String(e?.message ?? e).split("\n")[0]}\n`)
}
process.exitCode = 0
