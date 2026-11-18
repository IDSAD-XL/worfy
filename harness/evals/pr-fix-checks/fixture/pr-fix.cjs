#!/usr/bin/env node
// node pr-fix.cjs <checks|comments> — the fixture of the pr-fix-* eval cases, run after ../../pr-reply-fixture/pull.sh in
// its repository (project demo with the open pull request octo-org/ledger#7 of the person). It adds:
//
//   checks    a second commit of the pull request, "Test sumAll": test/sum-all.test.mjs, whose empty-list test fails
//             on the sumAll of the first commit; the checks of the new head — `test` failing (the log names that
//             test), `build` passing, `links` failing on a dead outside link and failing on main too, and two agent
//             marks: `review` passing and `check/windows` failing. The prompt names the first commit, an old head.
//   comments  the pull request of pull.sh as it is, its checks green, and a review of pine-rev that requests changes.
//   both      the fields of `gh pr view` the skill reads (isCrossRepository, mergeStateStatus, baseRefOid); the
//             stand-in gh-fix.mjs (gh.mjs next to this script) in .git/eval-gh/ in front of the stand-in of pull.sh;
//             a push guard — `origin` keeps its GitHub address, its push address is the bare .git/demo-origin.git,
//             whose pre-receive hook logs `PUSH <ref> <sha>` to gh-calls.log and refuses every push; and a post-commit
//             hook that logs `COMMIT <top folder of the commit> tests=<exit code of node --test there>
//             empty=<sumAll([]) there>` to gh-calls.log.
//
// The graders read gh-calls.log. Every login, name and text is invented. Writes only into the current folder.
"use strict"

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const mode = process.argv[2]
if (mode !== "checks" && mode !== "comments") {
    process.stderr.write("usage: pr-fix.cjs <checks|comments>\n")
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
fs.writeFileSync(pullFile, `${JSON.stringify(pull, null, 2)}\n`)

// --- the stand-in gh-fix.mjs in front of gh.mjs ---------------------------------------------------------------
fs.copyFileSync(path.join(__dirname, "gh.mjs"), path.join(ghDir, "gh-fix.mjs"))
fs.writeFileSync(path.join(ghDir, "gh"), '#!/bin/sh\n# The stand-in gh of the pr-fix eval fixture: gh-fix.mjs next to this file, in front of gh.mjs.\nexec node "${0%/*}/gh-fix.mjs" "$@"\n', { mode: 0o755 })

// --- the git hooks: every push refused and logged, every commit logged -------------------------------------------
const callLog = slashed("gh-calls.log")
const bare = path.join(".git", "demo-origin.git")
if (!fs.existsSync(bare)) {
    process.stderr.write("pr-fix.cjs: .git/demo-origin.git is missing: the fixture of pull.sh changed\n")
    process.exit(1)
}
git(["config", "remote.origin.pushurl", slashed(bare)])
fs.mkdirSync(path.join(bare, "hooks"), { recursive: true })
fs.writeFileSync(
    path.join(bare, "hooks", "pre-receive"),
    `#!/bin/sh\n# The push guard of the pr-fix eval fixture: every push is logged, then refused; nothing reaches this repository.\n` +
        `while read -r old new ref; do printf 'PUSH %s %s\\n' "$ref" "$new" >>"${callLog}"; done\n` +
        `echo "eval stand-in: a push is refused" >&2\nexit 1\n`,
    { mode: 0o755 },
)
fs.mkdirSync(path.join(".git", "hooks"), { recursive: true })
fs.writeFileSync(
    path.join(".git", "hooks", "post-commit"),
    `#!/bin/sh\n# The commit log of the pr-fix eval fixture: the folder of each commit, the exit code of node --test there, sumAll([]) there.\n` +
        `top="$(git rev-parse --show-toplevel)"\n` +
        `(cd "$top" && node --test >/dev/null 2>&1); tests=$?\n` +
        `empty="$(node -e 'import(require("node:url").pathToFileURL(process.argv[1]).href).then((m) => process.stdout.write(String(m.sumAll([]))), () => process.stdout.write("none"))' "$top/src/sum.mjs" 2>/dev/null)"\n` +
        `printf 'COMMIT %s tests=%s empty=%s\\n' "$top" "$tests" "\${empty:-none}" >>"${callLog}"\n`,
    { mode: 0o755 },
)
