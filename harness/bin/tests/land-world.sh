# The world of the land tests, sourced by land.test.sh and land-story.test.sh after `set -u` and HERE: the temporary
# folder, ok/bad, the node stubs for gh, ticket, evidence-check, the wait between tries (sleep), the documents check,
# the documents-only rule and bin/profile, and new_world, state, edit and the other helpers of the cases. Not a test of
# its own (no .test.sh).
LAND="$HERE/../land"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
# A path under $T as node reads it: C:/… in Git Bash on Windows (pwd -W); unchanged elsewhere.
TN="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
tn() { case "$1" in "$T"/*) printf '%s' "$TN${1#"$T"}" ;; *) printf '%s' "$1" ;; esac; }
. "$HERE/real-home.sh"
home_before="$(real_home_snapshot "$HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-t}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-t@t}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-t}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-t@t}"
q() { node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const v=new Function("s","return ("+process.argv[2]+")")(s); process.stdout.write(typeof v==="string"?v:JSON.stringify(v) ?? "undefined")' "$1" "$2"; }

# --- stubs: node scripts, so they run the same on Windows ------------------------------------------
STUBS="$T/stubs"; mkdir -p "$STUBS"
# gh. Its world is $GHD: log — one line per call; pr-<N>.json — {state, mergeStateStatus} of PR N (OPEN, CLEAN by
# default); mergeable-<N> — lines, the first is used and dropped while more than one is left (MERGEABLE without
# the file); runs-<sha> — the JSON list of `gh run list` for that head ([] without it); checks-<sha> — the JSON
# list of check runs (one ci-ok completed success without it); status-<sha>.json — {context: state} (review
# success without it); main-runs — the JSON list of the push runs on main ([] without it), main-runs-fail — reading
# them fails; issues — the JSON list `gh issue list` prints ([] without it), issues-fail — reading them fails;
# pulls-<sha> — the JSON list of the PRs of a commit; merge-fail-<N> — `pr merge` refused; kill-after-merge-<N> — after the merge of N it
# kills its parent (land) with SIGKILL. `pr merge` squash-merges refs/pull/<N>/head into main of $GH_ORIGIN and
# logs whether $LAND_TEST_LOCK was held. `pr create` gives numbers from 900 and points refs/pull/<n>/head at the
# pushed branch; kill-before-create — it kills its parent (land) with SIGKILL first and creates nothing.
cat >"$STUBS/gh.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
const D = process.env.GHD, O = process.env.GH_ORIGIN, a = process.argv.slice(2)
fs.appendFileSync(path.join(D, "log"), a.join(" ") + "\n")
const f = (n) => path.join(D, n)
const has = (n) => fs.existsSync(f(n))
const read = (n, d) => (has(n) ? fs.readFileSync(f(n), "utf8") : d)
const g = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const headOf = (n) => g("-C", O, "rev-parse", `refs/pull/${n}/head`)
const out = (v) => process.stdout.write(JSON.stringify(v) + "\n")
const prJson = (n) => ({ state: "OPEN", mergeStateStatus: "CLEAN", ...JSON.parse(read(`pr-${n}.json`, "{}")) })
const setPr = (n, v) => fs.writeFileSync(f(`pr-${n}.json`), JSON.stringify({ ...prJson(n), ...v }))
const cmd = a.slice(0, 2).join(" ")
// gh-down: every call fails, as with no network
if (has("gh-down")) { process.stderr.write("error connecting to api.github.com\n"); process.exit(1) }
if (cmd === "pr view") {
    const n = a[2], p = prJson(n)
    let mergeable = "MERGEABLE"
    if (has(`mergeable-${n}`)) {
        const lines = read(`mergeable-${n}`).split("\n").filter(Boolean)
        mergeable = lines[0]
        if (lines.length > 1) fs.writeFileSync(f(`mergeable-${n}`), lines.slice(1).join("\n") + "\n")
    }
    // moved-<N>: a push to the PR after its first view — every later view shows that SHA as the head
    const views = +read(`views-${n}`, "0") + 1
    fs.writeFileSync(f(`views-${n}`), String(views))
    const head = views > 1 && has(`moved-${n}`) ? read(`moved-${n}`).trim() : headOf(n)
    // isDraft and headRefName from pr-<N>.json: not a draft, the branch e/0<N> (the ticket e 0<N>) without them
    out({ number: +n, state: p.state, headRefOid: head, mergeable, mergeStateStatus: p.mergeStateStatus, mergeCommit: p.mergeCommit || null, isDraft: !!p.isDraft, headRefName: p.headRefName || `e/0${n}` })
} else if (cmd === "run list" && a.includes("--event")) {
    // the push runs of main: main-runs — their JSON list ([] without it); main-runs-fail — gh fails
    if (has("main-runs-fail")) { process.stderr.write("HTTP 502: Bad Gateway\n"); process.exit(1) }
    const limit = a.includes("--limit") ? +a[a.indexOf("--limit") + 1] : 20
    out(JSON.parse(read("main-runs", "[]")).slice(0, limit))
} else if (a[0] === "api" && /\/commits\/[0-9a-f]{40}\/pulls$/.test(a[1])) {
    // the PRs of a commit: pulls-<sha> — their JSON list ([] without it)
    process.stdout.write(read(`pulls-${/commits\/([0-9a-f]{40})\//.exec(a[1])[1]}`, "[]") + "\n")
} else if (cmd === "run list") {
    const sha = a[a.indexOf("--commit") + 1]
    process.stdout.write(read(`runs-${sha}`, "[]") + "\n")
} else if (a[0] === "api" && a[1] === "-X") {
    const sha = /statuses\/([0-9a-f]{40})$/.exec(a[3])[1]
    const fields = Object.fromEntries(a.filter((_, i) => a[i - 1] === "-f").map((x) => x.split(/=(.*)/s).slice(0, 2)))
    const s = JSON.parse(read(`status-${sha}.json`, '{"review":"success"}'))
    s[fields.context] = fields.state
    fs.writeFileSync(f(`status-${sha}.json`), JSON.stringify(s))
    fs.appendFileSync(f("posted"), `${sha} ${fields.context} ${fields.state} ${fields.description}\n`)
    out({})
} else if (a[0] === "api") {
    const [, sha, what] = /commits\/([0-9a-f]{40})\/(check-runs|status)/.exec(a[1])
    if (what === "check-runs") out({ check_runs: JSON.parse(read(`checks-${sha}`, '[{"id":1,"name":"ci-ok","status":"completed","conclusion":"success","started_at":"2026-10-28T10:00:00Z"}]')) })
    else out({ statuses: Object.entries(JSON.parse(read(`status-${sha}.json`, '{"review":"success"}'))).map(([context, state]) => ({ context, state, description: state })) })
} else if (cmd === "pr merge") {
    const n = a[2], sha = a[a.indexOf("--match-head-commit") + 1]
    fs.appendFileSync(f("locks"), `${n} ${process.env.LAND_TEST_LOCK && fs.existsSync(process.env.LAND_TEST_LOCK) ? "held" : "free"}\n`)
    if (has(`merge-fail-${n}`)) { process.stderr.write(`Pull request #${n} is not mergeable\n`); process.exit(1) }
    if (sha !== headOf(n)) { process.stderr.write("head mismatch\n"); process.exit(1) }
    // the squash commit is made in the origin itself, without a clone: one parent (main), the merged tree
    const main = g("-C", O, "rev-parse", "refs/heads/main")
    const tree = g("-C", O, "merge-tree", "--write-tree", main, `refs/pull/${n}/head`)
    const oid = g("-C", O, "commit-tree", tree, "-p", main, "-m", `squash #${n}`)
    g("-C", O, "update-ref", "refs/heads/main", oid, main)
    setPr(n, { state: "MERGED", mergeCommit: { oid } })
    if (has(`kill-after-merge-${n}`)) process.kill(process.ppid, "SIGKILL")
} else if (cmd === "issue list") {
    // the open issues of a label (red_elsewhere): issues — their JSON list ([] without it); issues-fail — gh fails
    if (has("issues-fail")) { process.stderr.write("HTTP 502: Bad Gateway\n"); process.exit(1) }
    out(JSON.parse(read("issues", "[]")))
} else if (cmd === "pr list") {
    const br = a[a.indexOf("--head") + 1], made = JSON.parse(read("created.json", "{}"))
    out(made[br] && prJson(made[br]).state === "OPEN" ? [{ number: made[br] }] : [])
} else if (cmd === "pr create") {
    if (has("kill-before-create")) { process.kill(process.ppid, "SIGKILL"); process.exit(1) }
    const br = a[a.indexOf("--head") + 1], made = JSON.parse(read("created.json", "{}"))
    const n = 900 + Object.keys(made).length
    made[br] = n
    fs.writeFileSync(f("created.json"), JSON.stringify(made))
    g("-C", O, "update-ref", `refs/pull/${n}/head`, `refs/heads/${br}`)
    process.stdout.write(`https://github.com/o/r/pull/${n}\n`)
} else {
    process.stderr.write(`stub gh: unexpected ${a.join(" ")}\n`)
    process.exit(1)
}
EOF
# The shell's gh is the stub too: nothing in this file can reach a real gh.
printf '#!/usr/bin/env bash\nexec node "%s" "$@"\n' "$STUBS/gh.mjs" >"$STUBS/gh"; chmod +x "$STUBS/gh"
# ticket: `done <epic> <NN> --pr <N> --root <root>` writes <root>/<epic>/issues/<NN>.md (with the text of $GHD/ticket-leak
# appended when it is there) and logs the call and its cwd; with $GHD/ticket-fail it writes nothing and exits 1.
# `evidence … --root <root>` writes nothing and logs its arguments before --root and the root relative to its cwd.
# `root` prints the text of $GHD/tickets-root (the tickets root outside the repository, as in Silent mode).
cat >"$STUBS/ticket.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const a = process.argv.slice(2), root = a[a.indexOf("--root") + 1], D = process.env.GHD
if (a[0] === "root") {
    process.stdout.write(fs.readFileSync(path.join(D, "tickets-root"), "utf8"))
    process.exit(0)
}
if (a[0] === "evidence") {
    fs.appendFileSync(path.join(D, "ticket.log"), `${a.slice(0, a.indexOf("--root")).join(" ")} root=${path.relative(process.cwd(), root).split(path.sep).join("/")}\n`)
    process.exit(0)
}
fs.appendFileSync(path.join(D, "ticket.log"), `${a.slice(0, 5).join(" ")} root-in-cwd=${path.resolve(root).startsWith(process.cwd())}\n`)
if (fs.existsSync(path.join(D, "ticket-fail"))) { process.stderr.write("ticket: no such ticket\n"); process.exit(1) }
const leak = path.join(D, "ticket-leak")
fs.mkdirSync(path.join(root, a[1], "issues"), { recursive: true })
fs.writeFileSync(path.join(root, a[1], "issues", `${a[2]}.md`), `Status: done\nPR: #${a[4]}\n${fs.existsSync(leak) ? fs.readFileSync(leak, "utf8") : ""}`)
EOF
# evidence-check (only where LAND_EVIDENCE_CHECK names it; elsewhere land runs the real one): logs its arguments with
# the --root value relative to its cwd and the name of that cwd, exits 0.
cat >"$STUBS/evidence-check.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const a = process.argv.slice(2), i = a.indexOf("--root")
const args = a.map((x, j) => (j === i + 1 ? path.relative(process.cwd(), x).split(path.sep).join("/") : x))
fs.appendFileSync(path.join(process.env.GHD, "evidence-check.log"), `${args.join(" ")} cwd=${path.basename(process.cwd())}\n`)
EOF
# sleep: logs the seconds, and kills land at the 201st wait; $GHD/unlock-on-sleep — removes $LAND_TEST_LOCK at the second wait; $GHD/runs-done-on-sleep —
# removes every runs-<sha> file (the CI runs finish); every file in $GHD/on-sleep/ moves into $GHD at the first wait (a mark or
# a PR that changes while land waits for the lock).
cat >"$STUBS/sleep.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const D = process.env.GHD
fs.appendFileSync(path.join(D, "sleep.log"), process.argv[2] + "\n")
const n = fs.readFileSync(path.join(D, "sleep.log"), "utf8").split("\n").filter(Boolean).length
// a wait that never ends (a lock nobody releases) ends the run instead of hanging the file
if (n > 200) process.kill(process.ppid, "SIGKILL")
if (fs.existsSync(path.join(D, "unlock-on-sleep")) && n >= 2) fs.rmSync(process.env.LAND_TEST_LOCK, { recursive: true, force: true })
if (fs.existsSync(path.join(D, "on-sleep"))) for (const x of fs.readdirSync(path.join(D, "on-sleep"))) fs.renameSync(path.join(D, "on-sleep", x), path.join(D, x))
if (fs.existsSync(path.join(D, "runs-done-on-sleep"))) for (const x of fs.readdirSync(D)) if (x.startsWith("runs-")) fs.rmSync(path.join(D, x))
EOF
# the documents-only rule of a project (docs_only): the changed paths on stdin; exit 0 when every one ends in .md, 1
# otherwise (an empty list too); logs the paths and its cwd; $GHD/docs-only-rc — that exit code instead.
cat >"$STUBS/docs-only.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const D = process.env.GHD
const paths = fs.readFileSync(0, "utf8").split("\n").filter(Boolean)
fs.appendFileSync(path.join(D, "docs-only.log"), `${paths.join(" ")} cwd=${path.basename(process.cwd())}\n`)
const p = path.join(D, "docs-only-rc")
process.exit(fs.existsSync(p) ? +fs.readFileSync(p, "utf8") : paths.length && paths.every((x) => x.endsWith(".md")) ? 0 : 1)
EOF
# the scope command of red_elsewhere (which PRs a red main branch on another machine holds): `<base> <head>`; logs them
# and its cwd; exit code from $GHD/scope-<head> (1 without it: the PR needs that machine).
cat >"$STUBS/scope.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const D = process.env.GHD, [base, head] = process.argv.slice(2)
fs.appendFileSync(path.join(D, "scope.log"), `${base} ${head} cwd=${path.basename(process.cwd())}\n`)
const p = path.join(D, `scope-${head}`)
process.exit(fs.existsSync(p) ? +fs.readFileSync(p, "utf8") : 1)
EOF
# the documents check: exit code from $GHD/docs-check-rc (0 without it).
cat >"$STUBS/docs-check.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const D = process.env.GHD
fs.appendFileSync(path.join(D, "docs-check.log"), process.cwd() + "\n")
const p = path.join(D, "docs-check-rc")
process.exit(fs.existsSync(p) ? +fs.readFileSync(p, "utf8") : 0)
EOF
# bin/profile: `-C <dir> --field code_stories.pr` prints $GHD/code-stories ("off" without it); `-C <dir> --json` prints
# the profile of the world — workflow.ci_check ci-ok, worktree.base origin/main, the tickets of .scratch/<epic>/issues/NN-*.md
# on the branches <epic>/<NN> with the trail "## Where in the code", the default verification paths and scripts/check-*,
# no Check in the Pipeline, _resolved.checkout <dir> — with each top-level object of $GHD/profile.json merged over its
# own. Exits with $GHD/profile-rc (0 without it); logs its arguments.
cat >"$STUBS/profile.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const D = process.env.GHD
fs.appendFileSync(path.join(D, "profile.log"), process.argv.slice(2).join(" ") + "\n")
const read = (n, d) => (fs.existsSync(path.join(D, n)) ? fs.readFileSync(path.join(D, n), "utf8").trim() : d)
const rc = +read("profile-rc", "0")
const a = process.argv.slice(2)
if (rc) process.stderr.write(`profile: stub exit ${rc}\n`)
else if (a.includes("--json")) {
    const dir = a[a.indexOf("-C") + 1]
    const p = {
        workflow: { ci: "pr", ci_check: "ci-ok" },
        worktree: { base: "origin/main" },
        tickets: { root: ".scratch/", path: ".scratch/<epic>/issues/NN-*.md", branch: "<epic>/<NN>", trail_section: "## Where in the code" },
        verification: { paths: [".github/workflows/**", ".github/actions/**", "CLAUDE.md", "AGENTS.md", ".claude/**", ".codex/**", ".mcp.json", "scripts/check-*"] },
        code_stories: { pr: read("code-stories", "off") },
        _resolved: { checkout: dir, repo_root: dir, mode: "full", pipeline: [{ kind: "queued" }, { kind: "ci" }] },
    }
    const over = JSON.parse(read("profile.json", "{}"))
    for (const [k, v] of Object.entries(over)) p[k] = v && typeof v === "object" && !Array.isArray(v) && p[k] && typeof p[k] === "object" ? { ...p[k], ...v } : v
    process.stdout.write(JSON.stringify(p) + "\n")
} else process.stdout.write(read("code-stories", "off") + "\n")
process.exit(rc)
EOF
# Environment values: Git Bash turns a path in them into the Windows form for node itself.
export PATH="$STUBS:$PATH" LAND_GH="$STUBS/gh.mjs" LAND_TICKET="$STUBS/ticket.mjs" LAND_SLEEP="$STUBS/sleep.mjs" LAND_PROFILE="$STUBS/profile.mjs"
. "$HERE/gh-stand-in.sh"
gh_guard LAND_GH "$STUBS/gh" "$STUBS/gh.mjs"

# --- a world -------------------------------------------------------------------------------------------
# new_world <name> <N>…: main has base.txt (lines 1 to 40); PR N forks off main and adds the file f<N>.txt.
# Each set of PRs is built once, in $T/tpl-<N>-…; every world is a fresh copy of it with the remotes pointed at
# its own origin, so no two cases share a repository.
new_world() {
    W="$T/$1"; shift
    [ ! -e "$W" ] || { echo "new_world: $W is already there"; exit 1; }
    local tpl="$T/tpl$(printf -- '-%s' "$@")"
    [ -d "$tpl" ] || build_world "$tpl" "$@"
    cp -r "$tpl" "$W"
    git -C "$W/seed" remote set-url origin "$W/origin.git"
    git -C "$W/repo" remote set-url origin "$W/origin.git"
    export GHD="$W/gh" GH_ORIGIN="$W/origin.git" LAND_TEST_LOCK="$W/repo/.git/main.lock"
    S="$W/state.json"
}
build_world() {
    local W="$1"; shift
    mkdir -p "$W/gh"
    git init -q --bare -b main "$W/origin.git"
    # no gc while a push is received: a race once came from it (GIT_CONFIG does not reach receive-pack, so the bare repo's own config)
    git -C "$W/origin.git" config receive.autogc false
    git clone -q "$W/origin.git" "$W/seed" 2>/dev/null
    seq 1 40 >"$W/seed/base.txt" && git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m base
    local refs=(main:main)
    for n in "$@"; do
        git -C "$W/seed" checkout -q -b "pr$n" main
        echo "$n" >"$W/seed/f$n.txt" && git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m "pr $n"
        refs+=("pr$n:refs/pull/$n/head")
    done
    [ $# -eq 0 ] || git -C "$W/seed" checkout -q main
    git -C "$W/seed" push -q origin "${refs[@]}"
    git clone -q "$W/origin.git" "$W/repo"
    # GitHub lets a fetch name any commit of the repository by its SHA, an old PR head included
    git -C "$W/origin.git" config uploadpack.allowAnySHA1InWant true
}
head_of() { git -C "$W/origin.git" rev-parse "refs/pull/$1/head"; }
# state <N>[:<head>][/<check>,…]…: the state file of the world; each PR has epic e, ticket 0<N> and the Check marks
# after the slash as its "checks" ([] without them).
state() {
    local items="" sep=""
    for p in "$@"; do
        local checks="" head=""
        [[ "$p" == */* ]] && checks="\"${p#*/}\"" && checks="${checks//,/\",\"}" && p="${p%%/*}"
        local n="${p%%:*}"
        [[ "$p" == *:* ]] && head=",\"head\":\"${p#*:}\""
        items="$items$sep{\"number\":$n,\"epic\":\"e\",\"ticket\":\"0$n\"$head,\"checks\":[$checks]}"; sep=","
    done
    printf '{"repo":"%s","branch":"main","ci":"pr","ci_check":"ci-ok","ci_workflow":"ci.yml","docs_check":"node \\"%s\\"","prs":[%s]}\n' \
        "$(tn "$W/repo")" "$(tn "$STUBS/docs-check.mjs")" "$items" >"$S"
}
merges() { { grep '^pr merge' "$GHD/log" 2>/dev/null || true; } | wc -l | tr -d ' '; }
merged_of() { grep "^pr merge $1 " "$GHD/log" | wc -l | tr -d ' '; }
running() { printf '[{"databaseId":7,"status":"%s","conclusion":""}]' "${2:-in_progress}" >"$GHD/runs-$1"; }

# edit <js>: runs <js> on the state file $S as `s` and writes it back
edit() { node -e "const fs=require('fs'),s=JSON.parse(fs.readFileSync(process.argv[1]));$1;fs.writeFileSync(process.argv[1],JSON.stringify(s))" "$S"; }
