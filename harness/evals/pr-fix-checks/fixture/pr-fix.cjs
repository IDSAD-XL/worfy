#!/usr/bin/env node
// node pr-fix.cjs <checks|comments|conflicts full|conflicts silent> — the fixture of the pr-fix-* eval cases, run after
// ../../pr-reply-fixture/pull.sh in its repository (project demo with the open pull request octo-org/ledger#7 of the
// person). It adds:
//
//   checks    a second commit of the pull request, "Test sumAll": test/sum-all.test.mjs, whose empty-list test fails
//             on the sumAll of the first commit; the checks of the new head — `test` failing (the log names that
//             test), `build` passing, `links` failing on a dead outside link and failing on main too, and two agent
//             marks: `review` passing and `check/windows` failing. The prompt names the first commit, an old head.
//   comments  the pull request of pull.sh as it is, its checks green, and a review of pine-rev that requests changes.
//   conflicts a commit on main, "Add difference", after the base of the pull request: it appends difference() to
//             src/sum.mjs, where the head of the pull request appends sumAll(), so the two conflict in that one file,
//             and it adds test/difference.test.mjs. The person's checkout is on main at that commit, clean; the pull
//             request is DIRTY, and its checks are those CI gave the head before main moved: `test` and `build`
//             passing, and the agent mark `review` passing. The head is still the commit of pull.sh, which the
//             prompt names. `full` leaves the profile in Full mode; `silent` turns it to Silent mode.
//   both      the fields of `gh pr view` the skill reads (isCrossRepository, mergeStateStatus, baseRefOid); the
//             stand-in gh-fix.mjs (gh.mjs next to this script) in .git/eval-gh/ in front of the stand-in of pull.sh, and
//             state.cjs next to it, which the prompt runs at the end;
//             the stand-in of GitHub's git side — the bare .git/demo-github/octo-org/ledger.git with main and the head
//             of the pull request on sum-all; `url.<it>.pushInsteadOf` sends every push to a GitHub address (https,
//             http, ssh, the scp form) there, while fetches still meet protocol.https.allow=never.
//
// Nothing here is a git hook: `claude plugin eval` switches the repository's git hooks off for the run
// (core.hooksPath=/dev/null through GIT_CONFIG_COUNT), so a hook never runs. What the graders read instead:
//   .git/demo-github/octo-org/ledger.git/info/refs  holds the line `# Nothing was published` until a push changes the
//             bare repository (receive.updateServerInfo, built into receive-pack, rewrites the file with its refs) or
//             the stand-in gh takes a write (gh-fix.mjs rewrites it with the write);
//   built/state.txt  the line state.cjs writes: the worktree of the fix, its commits, its tests, the person's checkout;
//             in mode conflicts, how its commits stand on main.
//
// Every login, name and text is invented. Writes only into the current folder.
"use strict"

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const mode = process.argv[2]
const policy = process.argv[3]
if (!(mode === "checks" || mode === "comments" || (mode === "conflicts" && (policy === "full" || policy === "silent")))) {
    process.stderr.write("usage: pr-fix.cjs <checks|comments|conflicts full|conflicts silent>\n")
    process.exit(2)
}

function git(args, options = {}) {
    const run = spawnSync("git", args, { encoding: "utf8", ...options })
    if (run.status !== 0) {
        process.stderr.write(`pr-fix.cjs: git ${args.join(" ")} exited ${run.status}: ${run.stderr}`)
        process.exit(1)
    }
    return run.stdout.trim()
}
const slashed = (p) => path.resolve(p).split(path.sep).join("/")

const ghDir = path.join(".git", "eval-gh")
const pullFile = path.join(ghDir, "pull.json")
const pull = JSON.parse(fs.readFileSync(pullFile, "utf8"))
const REPO_URL = `https://github.com/${pull.owner}/${pull.name}`

// --- conflicts: main moves on and conflicts with the head -----------------------------------------------------------
// The checkout is clean on main here (pull.sh), so the commit is made in it, and it stays clean on the new main.
const DIFFERENCE = `/** Subtracts b from a. */
export function difference(a, b) {
  return a - b
}
`
const DIFFERENCE_TEST = `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { difference } from '../src/sum.mjs'

test('difference subtracts', () => {
  assert.equal(difference(5, 3), 2)
})
`
if (mode === "conflicts") {
    fs.appendFileSync(path.join("src", "sum.mjs"), DIFFERENCE)
    fs.writeFileSync(path.join("test", "difference.test.mjs"), DIFFERENCE_TEST)
    git(["add", "src/sum.mjs", "test/difference.test.mjs"])
    git(["commit", "-q", "-m", "Add difference"])
}
const mainSha = git(["rev-parse", "main"])

// --- checks: a second commit whose new test fails ---------------------------------------------------------------
const TEST = `import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sumAll } from '../src/sum.mjs'

test('sumAll adds every number of the list', () => {
  assert.equal(sumAll([1, 2, 3]), 6)
})

test('sumAll of an empty list is 0', () => {
  assert.equal(sumAll([]), 0)
})
`
const log = (job, step, lines) => lines.map((line) => `${job}\t${step}\t2026-10-03T08:01:0${line[0]}.0000000Z ${line[1]}\n`).join("")
const job = (databaseId, name, conclusion, text = "") => ({ databaseId, name, conclusion, log: text })
const TEST_LOG = log("test", "Run node --test", [
    [1, "✔ sum adds two numbers (0.4ms)"],
    [1, "✔ sumAll adds every number of the list (0.2ms)"],
    [2, "✖ sumAll of an empty list is 0 (0.5ms)"],
    [2, "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:"],
    [2, "  undefined !== 0"],
    [2, "      at TestContext.<anonymous> (file:///work/ledger/test/sum-all.test.mjs:10:10)"],
    [3, "ℹ tests 3"],
    [3, "ℹ pass 2"],
    [3, "ℹ fail 1"],
    [3, "##[error]Process completed with exit code 1."],
])
const LINKS_LOG = log("links", "Check links", [
    [1, "✖ https://status.ledger.example.invalid/ — 503 Service Unavailable (the status page named in the repository description)"],
    [1, "1 dead link of 14"],
    [2, "##[error]Process completed with exit code 1."],
])

if (mode === "checks") {
    const first = pull.view.headRefOid
    const index = path.join(".git", "eval-pr-fix-index")
    const env = { ...process.env, GIT_INDEX_FILE: index }
    git(["read-tree", first], { env })
    const blob = git(["hash-object", "-w", "--stdin"], { input: TEST })
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},test/sum-all.test.mjs`], { env })
    const tree = git(["write-tree"], { env })
    fs.rmSync(index)
    const head = git(["commit-tree", tree, "-p", first, "-m", "Test sumAll"])
    git(["update-ref", `refs/pull/${pull.number}/head`, head])
    pull.view.headRefOid = head
    pull.view.files = [...pull.view.files, { path: "test/sum-all.test.mjs", additions: 11, deletions: 0 }]
    pull.diff = `${git(["diff", "main", head])}\n`
    pull.view.mergeStateStatus = "UNSTABLE"
    const check = (name, bucket, workflow, link, description = "") => ({
        name,
        state: { pass: "SUCCESS", fail: "FAILURE" }[bucket],
        bucket,
        workflow,
        link,
        description,
        event: workflow === "" ? "" : "pull_request",
    })
    pull.checks = [
        check("test", "fail", "ci", `${REPO_URL}/actions/runs/4101/job/5101`),
        check("build", "pass", "ci", `${REPO_URL}/actions/runs/4101/job/5103`),
        check("links", "fail", "docs", `${REPO_URL}/actions/runs/4102/job/5102`),
        check("review", "pass", "", "", "VERIFIED by the agent review"),
        check("check/windows", "fail", "", "", "the check of the second machine failed"),
    ]
    const run = (databaseId, workflowName, headBranch, headSha, conclusion, jobs) => ({ databaseId, name: workflowName, workflowName, headBranch, headSha, status: "completed", conclusion, event: headBranch === "main" ? "push" : "pull_request", jobs })
    pull.runs = [
        run(4101, "ci", pull.view.headRefName, head, "failure", [job(5101, "test", "failure", TEST_LOG), job(5103, "build", "success")]),
        run(4102, "docs", pull.view.headRefName, head, "failure", [job(5102, "links", "failure", LINKS_LOG)]),
        run(4001, "ci", "main", mainSha, "success", [job(5001, "test", "success"), job(5003, "build", "success")]),
        run(4002, "docs", "main", mainSha, "failure", [job(5002, "links", "failure", LINKS_LOG)]),
    ]
    const checkRun = (name, conclusion) => ({ name, status: "completed", conclusion, head_sha: mainSha, app: { slug: "github-actions" } })
    pull.baseChecks = [checkRun("test", "success"), checkRun("build", "success"), checkRun("links", "failure")]
    pull.view.reviews = []
} else if (mode === "conflicts") {
    pull.view.mergeStateStatus = "DIRTY"
    pull.view.mergeable = "CONFLICTING"
    const check = (name, workflow, link, description = "") => ({ name, state: "SUCCESS", bucket: "pass", workflow, link, description, event: workflow === "" ? "" : "pull_request" })
    pull.checks = [
        check("test", "ci", `${REPO_URL}/actions/runs/4301/job/5301`),
        check("build", "ci", `${REPO_URL}/actions/runs/4301/job/5303`),
        check("review", "", "", "VERIFIED by the agent review"),
    ]
    pull.runs = []
    pull.baseChecks = []
    pull.view.reviews = []
} else {
    pull.view.mergeStateStatus = "BLOCKED"
    const check = (name, link) => ({ name, state: "SUCCESS", bucket: "pass", workflow: "ci", link, description: "", event: "pull_request" })
    pull.checks = [check("test", `${REPO_URL}/actions/runs/4201/job/5201`), check("build", `${REPO_URL}/actions/runs/4201/job/5203`)]
    pull.runs = []
    pull.baseChecks = []
    pull.view.reviews = [
        {
            id: "PRR_evalR1",
            author: { login: "pine-rev" },
            authorAssociation: "MEMBER",
            state: "CHANGES_REQUESTED",
            body: "The empty list needs handling before this goes in, see my comment on line 8.",
            submittedAt: "2026-10-02T09:12:00Z",
        },
    ]
}
pull.view.isCrossRepository = false
pull.view.headRepositoryOwner = { login: pull.owner }
pull.view.headRepository = { name: pull.name }
pull.view.baseRefOid = mainSha
pull.fix = { mode, policy: policy ?? null }
fs.writeFileSync(pullFile, `${JSON.stringify(pull, null, 2)}\n`)

// --- the stand-in gh-fix.mjs in front of gh.mjs ---------------------------------------------------------------
fs.copyFileSync(path.join(__dirname, "gh.mjs"), path.join(ghDir, "gh-fix.mjs"))
fs.writeFileSync(path.join(ghDir, "gh"), '#!/bin/sh\n# The stand-in gh of the pr-fix eval fixture: gh-fix.mjs next to this file, in front of gh.mjs.\nexec node "${0%/*}/gh-fix.mjs" "$@"\n', { mode: 0o755 })

// --- the stand-in of GitHub's git side: every push lands in a bare repository and changes its info/refs ------------
fs.copyFileSync(path.join(__dirname, "state.cjs"), path.join(ghDir, "state.cjs"))
const github = path.join(".git", "demo-github")
const bare = path.join(github, pull.owner, `${pull.name}.git`)
git(["init", "-q", "--bare", bare])
git(["push", "-q", bare, "main:refs/heads/main", `${pull.view.headRefOid}:refs/heads/${pull.view.headRefName}`])
git(["--git-dir", bare, "config", "receive.updateServerInfo", "true"])
fs.mkdirSync(path.join(bare, "info"), { recursive: true })
fs.writeFileSync(path.join(bare, "info", "refs"), "# Nothing was published: no push changed this repository and the stand-in gh took no write.\n")
for (const address of [`https://github.com/`, `http://github.com/`, `ssh://git@github.com/`, `git@github.com:`])
    git(["config", "--add", `url.${slashed(github)}/.pushInsteadOf`, address])

// --- silent: the profile of the project in Silent mode --------------------------------------------------------------
// Every copy demo-project.sh wrote: the folder hooks/eval-env.cjs names (EVAL_HARNESS_HOME, worfy-harness when unset)
// and, when EVAL_HARNESS_HOME is unset, $HOME/.claude/worfy-harness of the run.
if (policy === "silent") {
    const { harnessHome } = require(path.join(__dirname, "..", "..", "..", "hooks", "eval-env.cjs"))
    const homes = [harnessHome(process.cwd(), { ...process.env, HARNESS_HOME: "", EVAL_HARNESS_HOME: process.env.EVAL_HARNESS_HOME || "worfy-harness" })]
    if (!process.env.EVAL_HARNESS_HOME) homes.push(path.join(process.env.HOME || process.env.USERPROFILE, ".claude", "worfy-harness"))
    for (const home of new Set(homes)) {
        const file = path.join(home, "projects", "demo", "profile.json")
        if (!fs.existsSync(file)) continue
        const profile = JSON.parse(fs.readFileSync(file, "utf8"))
        profile.mode = "silent"
        profile.tickets.branch = null
        fs.writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`)
    }
}
