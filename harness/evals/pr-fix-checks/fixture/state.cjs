#!/usr/bin/env node
// node .git/eval-gh/state.cjs — the end of a pr-fix-* eval run: the prompt asks the run to start it once the skill has
// finished. pr-fix.cjs copies it into <project>/.git/eval-gh/. It writes one line into <project>/built/state.txt (and
// prints it), which the grader fixed-in-worktree reads:
//
//   worktree=<ledger-pr-7|missing> ahead=<yes|no> clean=<yes|no> tests=<exit code> empty=<sumAll([])> checkout=<untouched|changed>
//
//   worktree  .claude/worktrees/ledger-pr-7 is a worktree of this repository (the path step 2 of the skill names for a
//             profile without worktree.root)
//   ahead     its HEAD is a commit after the head of the pull request (the fix is committed)
//   clean     `git status --porcelain` there prints nothing: the tests below ran on what is committed
//   tests     the exit code of `node --test` there; empty — what sumAll([]) gives there
//   checkout  the person's checkout is on main at the commit the fixture left, with no change to a tracked file
//
// In mode conflicts (pull.json `fix.mode`) the line says how the commits of the worktree stand on main instead:
//
//   worktree=<ledger-pr-7|missing> onto=<yes|no> head=<yes|no> commits=<n> merges=<n> clean=<yes|no> tests=<exit code> both=<yes|no> checkout=<untouched|changed>
//
//   onto      the head of main (baseRefOid) is an ancestor of its HEAD: the conflict is settled on the current base
//   head      the old head of the pull request is an ancestor of its HEAD: yes after a merge, no after a rebase
//   commits   the commits of main..HEAD there; merges — the merge commits among them
//   both      src/sum.mjs there exports both sumAll of the pull request and difference of main, and no tracked file
//             holds a conflict marker
//
// The line is the state of the folders, not of the session: no git hook runs in an eval run, so nothing else records
// where a commit was made. Reads only; writes nothing but built/state.txt.
"use strict"

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const project = path.join(__dirname, "..", "..")
const pull = JSON.parse(fs.readFileSync(path.join(__dirname, "pull.json"), "utf8"))
const worktree = path.join(project, ".claude", "worktrees", "ledger-pr-7")
const git = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" })
const out = (run) => (run.status === 0 ? run.stdout.trim() : null)

const common = (dir) => {
    const found = out(git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    return found === null ? null : fs.realpathSync(found)
}
const isWorktree = fs.existsSync(worktree) && common(worktree) === common(project) && common(project) !== null
const head = pull.view.headRefOid
let ahead = "no"
let clean = "no"
let tests = "none"
let empty = "none"
if (isWorktree) {
    const top = out(git(worktree, "rev-parse", "HEAD"))
    if (top !== null && top !== head && git(worktree, "merge-base", "--is-ancestor", head, top).status === 0) ahead = "yes"
    if (out(git(worktree, "status", "--porcelain")) === "") clean = "yes"
    tests = String(spawnSync(process.execPath, ["--test"], { cwd: worktree, encoding: "utf8" }).status)
    const probe = spawnSync(
        process.execPath,
        ["-e", 'import(require("node:url").pathToFileURL(process.argv[1]).href).then((m) => process.stdout.write(String(m.sumAll([]))))', path.join(worktree, "src", "sum.mjs")],
        { encoding: "utf8" },
    )
    empty = probe.status === 0 ? probe.stdout : "none"
}
const untouched =
    out(git(project, "rev-parse", "--abbrev-ref", "HEAD")) === "main" &&
    out(git(project, "rev-parse", "HEAD")) === pull.view.baseRefOid &&
    out(git(project, "status", "--porcelain", "--untracked-files=no")) === ""
const conflicts = pull.fix?.mode === "conflicts"
let onto = "no"
let fromHead = "no"
let commits = "none"
let merges = "none"
let both = "no"
if (conflicts && isWorktree) {
    const base = pull.view.baseRefOid
    if (git(worktree, "merge-base", "--is-ancestor", base, "HEAD").status === 0) onto = "yes"
    if (git(worktree, "merge-base", "--is-ancestor", head, "HEAD").status === 0) fromHead = "yes"
    commits = out(git(worktree, "rev-list", "--count", `${base}..HEAD`)) ?? "none"
    merges = out(git(worktree, "rev-list", "--count", "--merges", `${base}..HEAD`)) ?? "none"
    const probe = spawnSync(
        process.execPath,
        ["-e", 'import(require("node:url").pathToFileURL(process.argv[1]).href).then((m) => process.stdout.write(String(typeof m.sumAll === "function" && typeof m.difference === "function")))', path.join(worktree, "src", "sum.mjs")],
        { encoding: "utf8" },
    )
    // git grep exits 1 when no line matches: no conflict marker in a tracked file.
    const markers = git(worktree, "grep", "-n", "-E", "^(<<<<<<<|>>>>>>>|=======$)")
    if (probe.status === 0 && probe.stdout === "true" && markers.status === 1) both = "yes"
}
const line = conflicts
    ? `worktree=${isWorktree ? "ledger-pr-7" : "missing"} onto=${onto} head=${fromHead} commits=${commits} merges=${merges} clean=${clean} tests=${tests} both=${both} checkout=${untouched ? "untouched" : "changed"}\n`
    : `worktree=${isWorktree ? "ledger-pr-7" : "missing"} ahead=${ahead} clean=${clean} tests=${tests} empty=${empty} checkout=${untouched ? "untouched" : "changed"}\n`
fs.mkdirSync(path.join(project, "built"), { recursive: true })
fs.writeFileSync(path.join(project, "built", "state.txt"), line)
process.stdout.write(line)
