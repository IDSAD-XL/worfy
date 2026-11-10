// node pull.cjs — the part of pull.sh that needs Node: run in the fixture's repository (project demo, built by
// lib/demo-project.sh) it adds
//
//   the head commit  pull request #7 of octo-org/ledger, "Add sumAll over a list": one commit over main on
//                    refs/pull/7/head, written through a separate index, so the working tree and main stay as they
//                    are; a skill that reads the code at the head commit finds it in the repository as it is
//   the origin       octo-org/ledger on GitHub (REPO_URL below), and protocol.https.allow=never, so no git command of the run
//                    reaches the network
//   .git/eval-gh/    the stand-in gh (gh.mjs, and `gh`, a shell wrapper of it) and pull.json, the answers it gives;
//                    its log goes to gh-calls.log in the project root, which the graders read
//   $HOME            .zshenv, .zprofile, .zshrc, .bashrc, .bash_profile and .profile put .git/eval-gh first on PATH:
//                    the shells of the run start from this HOME, so the model's `gh` finds the stand-in, never the
//                    real gh
//
// The review threads of the pull request, by id:
//   PRRT_evalA1  line 8, a reviewer: sumAll([]) gives undefined          — waits; the code has the bug (needs code change)
//   PRRT_evalA2  line 7, a reviewer: why a loop and not reduce            — waits (needs answer); the line it is on is a
//                code comment that names a ticket of the workflow, which a reply must not repeat
//   PRRT_evalA3  line 6, a reviewer: the export was called sum_all        — waits; outdated, the head commit has sumAll
//                (resolved by push)
//   PRRT_evalA4  resolved                                                 — no draft
//   PRRT_evalA5  the author answered last                                 — no draft
// and one conversation comment, of a bot: no draft.
"use strict"

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const OWNER = "octo-org"
const NAME = "ledger"
const NUMBER = 7
const AUTHOR = "demo-dev"
const REPO_URL = `https://github.com/${OWNER}/${NAME}`

function git(args, options = {}) {
    const run = spawnSync("git", args, { encoding: "utf8", ...options })
    if (run.status !== 0) {
        process.stderr.write(`pull.cjs: git ${args.join(" ")} exited ${run.status}: ${run.stderr}`)
        process.exit(1)
    }
    return run.stdout.trim()
}

// --- the head commit, beside main ---------------------------------------------------------------------------------
const HEAD_SUM = `/** Adds two numbers. */
export function sum(a, b) {
  return a + b
}
/** Adds every number of the list. */
export function sumAll(list) {
  // A loop rather than reduce: see demo/02 for why.
  let total = list[0]
  for (let i = 1; i < list.length; i++) total = sum(total, list[i])
  return total
}
`
const index = path.join(".git", "eval-pull-index")
const env = { ...process.env, GIT_INDEX_FILE: index }
git(["read-tree", "main"], { env })
const blob = git(["hash-object", "-w", "--stdin"], { input: HEAD_SUM })
git(["update-index", "--add", "--cacheinfo", `100644,${blob},src/sum.mjs`], { env })
const tree = git(["write-tree"], { env })
fs.rmSync(index)
const head = git(["commit-tree", tree, "-p", "main", "-m", "Add sumAll over a list"])
git(["update-ref", `refs/pull/${NUMBER}/head`, head])
const diff = `${git(["diff", "main", head])}\n`
git(["remote", "set-url", "origin", `${REPO_URL}.git`])
git(["config", "protocol.https.allow", "never"])

// --- the answers of GitHub ----------------------------------------------------------------------------------------
const url = `${REPO_URL}/pull/${NUMBER}`
let serial = 9100
const comment = (login, body, at, bot = false) => {
    serial += 1
    return { databaseId: serial, author: { __typename: bot ? "Bot" : "User", login }, body, createdAt: at, url: `${url}#discussion_r${serial}` }
}
const thread = (id, line, comments, more = {}) => ({ id, isResolved: false, isOutdated: false, path: "src/sum.mjs", line, originalLine: line, comments: { nodes: comments }, ...more })
const threads = [
    thread("PRRT_evalA1", 8, [comment("pine-rev", "What does sumAll return for an empty list? `list[0]` is undefined there, so `sumAll([])` gives undefined rather than 0.", "2026-10-02T09:00:00Z")]),
    thread("PRRT_evalA2", 7, [comment("moss-qa", "Why a loop here and not `list.reduce(sum, 0)`?", "2026-10-02T09:05:00Z")]),
    thread("PRRT_evalA3", null, [comment("pine-rev", "nit: the first version exported this as `sum_all`; the other exports of this file are camelCase.", "2026-10-02T09:10:00Z")], { isOutdated: true, originalLine: 6 }),
    thread("PRRT_evalA4", 5, [comment("moss-qa", "Could sumAll get a doc comment like sum has?", "2026-10-02T09:15:00Z"), comment(AUTHOR, "Added.", "2026-10-02T10:00:00Z")], { isResolved: true }),
    thread("PRRT_evalA5", 6, [comment("moss-qa", "Could this live in a file of its own?", "2026-10-02T09:20:00Z"), comment(AUTHOR, "I'd keep it next to sum while it is this small.", "2026-10-02T10:05:00Z")]),
]
const conversation = [comment("ledger-ci", "All checks passed.", "2026-10-02T08:00:00Z", true)]
const pull = {
    owner: OWNER,
    name: NAME,
    number: NUMBER,
    viewer: AUTHOR,
    view: {
        number: NUMBER,
        url,
        title: "Add sumAll over a list",
        body: "Adds `sumAll`, the sum of a list of numbers.",
        author: { login: AUTHOR },
        state: "OPEN",
        isDraft: false,
        baseRefName: "main",
        headRefName: "sum-all",
        headRefOid: head,
        files: [{ path: "src/sum.mjs", additions: 7, deletions: 0 }],
    },
    diff,
    threads,
    conversation,
}
const ghDir = path.join(".git", "eval-gh")
fs.mkdirSync(ghDir, { recursive: true })
fs.writeFileSync(path.join(ghDir, "pull.json"), `${JSON.stringify(pull, null, 2)}\n`)
fs.copyFileSync(path.join(__dirname, "gh.mjs"), path.join(ghDir, "gh.mjs"))
fs.writeFileSync(path.join(ghDir, "gh"), '#!/bin/sh\n# The stand-in gh of the eval fixture: gh.mjs next to this file.\nexec node "${0%/*}/gh.mjs" "$@"\n', { mode: 0o755 })
// .git/info is not there when git init found no templates (the scaffold of `claude plugin eval` runs it so).
fs.mkdirSync(path.join(".git", "info"), { recursive: true })
fs.appendFileSync(path.join(".git", "info", "exclude"), "/gh-calls.log\n/built/\n")

// --- the shells of the run find the stand-in first ------------------------------------------------------------------
const home = process.env.HOME || process.env.USERPROFILE
const standIn = path.resolve(ghDir).split(path.sep).join("/")
const pathLine = `# The eval fixture: the stand-in gh of the project first on PATH.\nexport PATH="${standIn}:$PATH"\n`
// .zprofile and .zshrc too: a login zsh on macOS runs path_helper (/etc/zprofile) after .zshenv, which moves the
// folders of /etc/paths ahead of it.
for (const rc of [".zshenv", ".zprofile", ".zshrc", ".bashrc", ".profile"]) fs.appendFileSync(path.join(home, rc), pathLine)
fs.appendFileSync(path.join(home, ".bash_profile"), `${pathLine}[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n`)
