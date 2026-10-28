#!/usr/bin/env bash
# Tests of harness/bin/land: the merge condition (the CI check of the head, no CI run in progress, the review
# mark and its carry over a rebase, the scope rule), mergeable UNKNOWN asked again, BEHIND and DIRTY, the
# main-branch lock, one documents PR per run with `ticket done` for every merged PR, a run broken off by a kill
# and resumed, and --watch.
# The world: a bare origin with PR refs (refs/pull/<N>/head), a clone of it as the orchestrator's checkout, and
# node stubs for gh, ticket, the wait between tries (sleep), the scope command and the documents check. gh is
# always the stub: no network, no real gh, no credential.
# Run: bash harness/bin/tests/land.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
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
# success without it); merge-fail-<N> — `pr merge` refused; kill-after-merge-<N> — after the merge of N it
# kills its parent (land) with SIGKILL. `pr merge` squash-merges refs/pull/<N>/head into main of $GH_ORIGIN and
# logs whether $LAND_TEST_LOCK was held. `pr create` gives numbers from 900 and points refs/pull/<n>/head at the
# pushed branch.
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
    out({ number: +n, state: p.state, headRefOid: head, mergeable, mergeStateStatus: p.mergeStateStatus, mergeCommit: p.mergeCommit || null })
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
    const w = fs.mkdtempSync(path.join(D, "m-"))
    g("clone", "-q", O, w)
    g("-C", w, "fetch", "-q", "origin", `refs/pull/${n}/head`)
    g("-C", w, "merge", "-q", "--squash", "FETCH_HEAD")
    g("-C", w, "commit", "-q", "--allow-empty", "-m", `squash #${n}`)
    g("-C", w, "push", "-q", "origin", "HEAD:main")
    setPr(n, { state: "MERGED", mergeCommit: { oid: g("-C", w, "rev-parse", "HEAD") } })
    if (has(`kill-after-merge-${n}`)) process.kill(process.ppid, "SIGKILL")
} else if (cmd === "pr list") {
    const br = a[a.indexOf("--head") + 1], made = JSON.parse(read("created.json", "{}"))
    out(made[br] && prJson(made[br]).state === "OPEN" ? [{ number: made[br] }] : [])
} else if (cmd === "pr create") {
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
# ticket: `done <epic> <NN> --pr <N> --root <root>` writes <root>/<epic>/issues/<NN>.md and logs the call and its cwd.
cat >"$STUBS/ticket.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const a = process.argv.slice(2), root = a[a.indexOf("--root") + 1]
fs.appendFileSync(path.join(process.env.GHD, "ticket.log"), `${a.slice(0, 5).join(" ")} root-in-cwd=${path.resolve(root).startsWith(process.cwd())}\n`)
fs.mkdirSync(path.join(root, a[1], "issues"), { recursive: true })
fs.writeFileSync(path.join(root, a[1], "issues", `${a[2]}.md`), `Status: done\nPR: #${a[4]}\n`)
EOF
# sleep: logs the seconds, and kills land at the 201st wait; $GHD/unlock-on-sleep — removes $LAND_TEST_LOCK at the second wait; $GHD/runs-done-on-sleep —
# removes every runs-<sha> file (the CI runs finish).
cat >"$STUBS/sleep.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const D = process.env.GHD
fs.appendFileSync(path.join(D, "sleep.log"), process.argv[2] + "\n")
const n = fs.readFileSync(path.join(D, "sleep.log"), "utf8").split("\n").filter(Boolean).length
// a wait that never ends (a lock nobody releases) ends the run instead of hanging the file
if (n > 200) process.kill(process.ppid, "SIGKILL")
if (fs.existsSync(path.join(D, "unlock-on-sleep")) && n >= 2) fs.rmSync(process.env.LAND_TEST_LOCK, { recursive: true, force: true })
if (fs.existsSync(path.join(D, "runs-done-on-sleep"))) for (const x of fs.readdirSync(D)) if (x.startsWith("runs-")) fs.rmSync(path.join(D, x))
EOF
# the scope command: exit code from $GHD/scope-<head> (0 without it); the documents check: from $GHD/docs-check-rc.
cat >"$STUBS/scope.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const D = process.env.GHD, [base, head] = process.argv.slice(2)
fs.appendFileSync(path.join(D, "scope.log"), `${base} ${head}\n`)
const p = path.join(D, `scope-${head}`)
process.exit(fs.existsSync(p) ? +fs.readFileSync(p, "utf8") : 0)
EOF
cat >"$STUBS/docs-check.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const D = process.env.GHD
fs.appendFileSync(path.join(D, "docs-check.log"), process.cwd() + "\n")
const p = path.join(D, "docs-check-rc")
process.exit(fs.existsSync(p) ? +fs.readFileSync(p, "utf8") : 0)
EOF
# Environment values: Git Bash turns a path in them into the Windows form for node itself.
export PATH="$STUBS:$PATH" LAND_GH="$STUBS/gh.mjs" LAND_TICKET="$STUBS/ticket.mjs" LAND_SLEEP="$STUBS/sleep.mjs"
. "$HERE/gh-stand-in.sh"
gh_guard LAND_GH "$STUBS/gh" "$STUBS/gh.mjs"

# --- a world -------------------------------------------------------------------------------------------
# new_world <name> <N>…: main has base.txt (lines 1 to 40); PR N forks off main and adds the file f<N>.txt.
new_world() {
    W="$T/$1"; shift
    mkdir -p "$W/gh"
    git init -q --bare -b main "$W/origin.git"
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
    export GHD="$W/gh" GH_ORIGIN="$W/origin.git" LAND_TEST_LOCK="$W/repo/.git/main.lock"
    S="$W/state.json"
}
head_of() { git -C "$W/origin.git" rev-parse "refs/pull/$1/head"; }
# state [scope|noscope] <N>[:<head>]…: the state file of the world; each PR has epic e and ticket 0<N>.
state() {
    local scope=null items="" sep=""
    if [ "$1" = scope ]; then scope="{\"command\":\"node \\\"$(tn "$STUBS/scope.mjs")\\\"\",\"check\":\"check/windows\"}"; fi
    shift
    for p in "$@"; do
        local n="${p%%:*}" head=""
        [[ "$p" == *:* ]] && head=",\"head\":\"${p#*:}\""
        items="$items$sep{\"number\":$n,\"epic\":\"e\",\"ticket\":\"0$n\"$head}"; sep=","
    done
    printf '{"repo":"%s","branch":"main","ci":"pr","ci_check":"ci-ok","ci_workflow":"ci.yml","scope":%s,"docs_check":"node \\"%s\\"","prs":[%s]}\n' \
        "$(tn "$W/repo")" "$scope" "$(tn "$STUBS/docs-check.mjs")" "$items" >"$S"
}
merges() { { grep '^pr merge' "$GHD/log" 2>/dev/null || true; } | wc -l | tr -d ' '; }
merged_of() { grep "^pr merge $1 " "$GHD/log" | wc -l | tr -d ' '; }
running() { printf '[{"databaseId":7,"status":"%s","conclusion":""}]' "${2:-in_progress}" >"$GHD/runs-$1"; }

# --- two green PRs: both merged, one documents PR with both tickets, no batch CI ----------------------------
new_world green 1 2
state noscope 1 2
h1="$(head_of 1)" h2="$(head_of 2)"
"$LAND" "$S" >"$W/out" 2>"$W/err"; rc=$?
[ "$rc" = 0 ] && tail -n 1 "$W/out" | grep -qx 'LAND=green' && ok "green: two PRs and the documents PR merged, LAND=green, exit 0" || bad "green: exit $rc: $(cat "$W/out" "$W/err")"
grep -q "^pr merge 1 --squash --match-head-commit $h1\$" "$GHD/log" && grep -q "^pr merge 2 --squash --match-head-commit $h2\$" "$GHD/log" \
    && ok "green: gh pr merge --squash --match-head-commit <head> for each PR" || bad "green: merges $(grep '^pr merge' "$GHD/log")"
m1="$(q "$S" 's.prs[0].result.sha')"
grep -qx "#1 merged $m1" "$W/out" && grep -q '^#2 merged [0-9a-f]\{40\}$' "$W/out" && ok "green: one line per PR, '#N merged <sha>'" || bad "green: output $(cat "$W/out")"
[ "$(grep -c '^pr create' "$GHD/log")" = 1 ] && grep -qx '#900 merged [0-9a-f]\{40\}' "$W/out" && [ "$(merged_of 900)" = 1 ] \
    && ok "green: one documents PR, merged" || bad "green: documents PR: $(grep '^pr create\|^pr merge 900' "$GHD/log")"
[ "$(cat "$GHD/ticket.log")" = "$(printf 'done e 01 --pr 1 root-in-cwd=true\ndone e 02 --pr 2 root-in-cwd=true')" ] \
    && ok "green: ticket done for both PRs, in the documents worktree" || bad "green: ticket calls $(cat "$GHD/ticket.log")"
docs_head="$(git -C "$W/origin.git" rev-parse refs/pull/900/head)"
[ "$(git -C "$W/origin.git" show --name-only --format= "$docs_head" | sort | tr '\n' ' ')" = ".scratch/e/issues/01.md .scratch/e/issues/02.md " ] \
    && [ "$(git -C "$W/origin.git" rev-parse "$docs_head^")" = "$(q "$S" 's.prs[1].result.sha')" ] \
    && ok "green: one documents commit with both tickets, on main after the merges" || bad "green: documents commit $(git -C "$W/origin.git" show --stat --format=%s "$docs_head")"
[ -s "$GHD/docs-check.log" ] && [[ "$(cat "$GHD/docs-check.log")" == *state.json.docs ]] && ok "green: the documents check ran in the documents worktree" || bad "green: docs check $(cat "$GHD/docs-check.log" 2>/dev/null)"
[ "$(cat "$GHD/locks")" = "$(printf '1 held\n2 held\n900 held')" ] && [ ! -e "$LAND_TEST_LOCK" ] \
    && ok "green: every merge under the main-branch lock, released at the end" || bad "green: lock $(cat "$GHD/locks") left=$([ -e "$LAND_TEST_LOCK" ] && echo yes)"
! grep -q '^workflow run\|^run rerun' "$GHD/log" && ok "green: no CI dispatch with workflow.ci pr" || bad "green: dispatched $(grep '^workflow' "$GHD/log")"
[ -s "$W/state.log" ] && grep -q "took the main-branch lock" "$W/state.log" && ok "green: the full log is next to the state file" || bad "green: no log next to the state file"
[ ! -e "$W/state.json.docs" ] && ! git -C "$W/repo" worktree list | grep -q 'state.json.docs' && ok "green: the documents worktree is removed" || bad "green: documents worktree left"
# a second run on the same file merges nothing again
: >"$GHD/log"
"$LAND" "$S" >"$W/out2" 2>&1; rc=$?
[ "$rc" = 0 ] && ! grep -q '^pr merge\|^pr create' "$GHD/log" && [ "$(head -n 3 "$W/out2")" = "$(head -n 3 "$W/out")" ] \
    && ok "green: a second run repeats nothing and prints the same lines" || bad "green: second run exit $rc, gh $(cat "$GHD/log")"

# --- a red ci-ok waits; a cancelled one too; the other PR merges -----------------------------------------------
new_world red 1 2
state noscope 1 2
echo '[{"id":1,"name":"ci-ok","status":"completed","conclusion":"success","started_at":"2026-10-28T09:00:00Z"},{"id":2,"name":"ci-ok","status":"completed","conclusion":"failure","started_at":"2026-10-28T10:00:00Z"}]' >"$GHD/checks-$(head_of 2)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && grep -qx "#2 waits: ci-ok failure on $(head_of 2 | cut -c1-8)" "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=red' \
    && ok "red: the latest ci-ok failure -> '#2 waits', LAND=red, exit 2" || bad "red: exit $rc: $(cat "$W/out")"
[ "$(merged_of 2)" = 0 ] && [ "$(merged_of 1)" = 1 ] && ok "red: PR 2 not merged, PR 1 merged" || bad "red: merges $(grep '^pr merge' "$GHD/log")"
new_world cancelled 1
state noscope 1
echo '[{"id":2,"name":"ci-ok","status":"completed","conclusion":"cancelled","started_at":"2026-10-28T10:00:00Z"}]' >"$GHD/checks-$(head_of 1)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: ci-ok cancelled' "$W/out" && ok "red: a cancelled ci-ok is not merged" || bad "cancelled: exit $rc: $(cat "$W/out")"
new_world nocheck 1
state noscope 1
echo '[{"id":3,"name":"lint-typecheck","status":"completed","conclusion":"success","started_at":"2026-10-28T10:00:00Z"}]' >"$GHD/checks-$(head_of 1)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: no ci-ok check' "$W/out" && tail -n 1 "$W/out" | grep -qx 'LAND=unverified' \
    && ok "no ci-ok on the head: waits, LAND=unverified, exit 3" || bad "nocheck: exit $rc: $(cat "$W/out")"

# --- a pending run waits, even with an older green ci-ok; ci-ok in progress waits ---------------------------
new_world pending 1
state noscope 1
running "$(head_of 1)" queued
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: ci.yml run 7 is queued' "$W/out" \
    && ok "pending: a queued ci.yml run on the head waits although an older ci-ok is green" || bad "pending: exit $rc: $(cat "$W/out")"
rm -f "$GHD/runs-$(head_of 1)"
echo '[{"id":2,"name":"ci-ok","status":"in_progress","conclusion":null,"started_at":"2026-10-28T10:00:00Z"}]' >"$GHD/checks-$(head_of 1)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: ci-ok is in_progress' "$W/out" && ok "pending: ci-ok in progress waits" || bad "pending ci-ok: exit $rc: $(cat "$W/out")"

# --- review: missing waits; a failure is red; carried over a rebase that changed nothing --------------------
new_world review 1
state noscope 1
echo '{}' >"$GHD/status-$(head_of 1).json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: review is missing' "$W/out" && ok "review: no review mark -> waits" || bad "review missing: exit $rc: $(cat "$W/out")"
echo '{"review":"failure"}' >"$GHD/status-$(head_of 1).json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: review is failure' "$W/out" && ok "review: a failed review is red" || bad "review failure: exit $rc: $(cat "$W/out")"
# the carry: PR 1 (which also changes line 1 of base.txt) verified at old, then rebased onto a main that changed
# line 40 of base.txt: the same diff, but its `index` line names other blobs
new_world carry 1
git -C "$W/seed" checkout -q pr1 && sed -i.bak '1s/.*/one/' "$W/seed/base.txt" && rm -f "$W/seed/base.txt.bak" && git -C "$W/seed" commit -qam line1 \
    && git -C "$W/seed" push -q -f origin pr1:refs/pull/1/head && git -C "$W/seed" checkout -q main
old="$(head_of 1)"
sed -i.bak '40s/.*/forty/' "$W/seed/base.txt" && rm -f "$W/seed/base.txt.bak" && echo other >"$W/seed/other.txt" \
    && git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m other && git -C "$W/seed" push -q origin main
git -C "$W/seed" checkout -q pr1 && git -C "$W/seed" rebase -q main && mkdir -p "$W/seed/.scratch" && echo note >"$W/seed/.scratch/n.md" \
    && git -C "$W/seed" add -A && git -C "$W/seed" commit -q -m notes && git -C "$W/seed" push -q -f origin pr1:refs/pull/1/head && git -C "$W/seed" checkout -q main
new="$(head_of 1)"
state noscope "1:$old"
echo '{}' >"$GHD/status-$new.json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && grep -q "^$new review success carried from $(echo "$old" | cut -c1-8)" "$GHD/posted" \
    && ok "review carry: same diff outside .scratch after a rebase -> review carried to the new head, merged" || bad "carry: exit $rc: $(cat "$W/out") posted $(cat "$GHD/posted" 2>/dev/null)"
new_world nocarry 1
old="$(head_of 1)"
git -C "$W/seed" checkout -q pr1 && echo changed >"$W/seed/f1.txt" && git -C "$W/seed" commit -qam more && git -C "$W/seed" push -q -f origin pr1:refs/pull/1/head && git -C "$W/seed" checkout -q main
state noscope "1:$old"
echo '{}' >"$GHD/status-$(head_of 1).json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && [ ! -e "$GHD/posted" ] && ok "review carry: a changed diff is not carried, the PR waits" || bad "nocarry: exit $rc: $(cat "$W/out") posted $(cat "$GHD/posted" 2>/dev/null)"

# --- scope: exit 1 (pc) needs check/windows success; exit 0 needs nothing; another code waits ----------------
new_world scope 1 2 3
state scope 1 2 3
echo 1 >"$GHD/scope-$(head_of 1)"; echo 1 >"$GHD/scope-$(head_of 2)"; echo 2 >"$GHD/scope-$(head_of 3)"
echo '{"review":"success","check/windows":"success"}' >"$GHD/status-$(head_of 2).json"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
grep -q "^#1 waits: scope pc, check/windows is missing" "$W/out" && [ "$(merged_of 1)" = 0 ] && ok "scope pc without check/windows: waits" || bad "scope pc: $(cat "$W/out")"
[ "$(merged_of 2)" = 1 ] && ok "scope pc with check/windows success: merged" || bad "scope pc with mark: $(cat "$W/out")"
grep -q "^#3 waits: the scope command exited 2" "$W/out" && [ "$(merged_of 3)" = 0 ] && ok "scope exit 2: waits, not read as runner" || bad "scope exit 2: $(cat "$W/out")"
head -n 1 "$GHD/scope.log" | grep -qx "origin/main $(head_of 1)" && ok "scope: the command gets origin/main and the head" || bad "scope: args $(head -n 1 "$GHD/scope.log")"
new_world runner 1
state scope 1
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && ok "scope exit 0 (runner): merged without check/windows" || bad "scope runner: exit $rc: $(cat "$W/out")"

# --- mergeable UNKNOWN: asked again 6 times, 10 s apart, then waits; BEHIND and DIRTY wait ----------------------
new_world unknown 1
state noscope 1
echo UNKNOWN >"$GHD/mergeable-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q '^#1 waits: mergeable UNKNOWN after 6 retries' "$W/out" \
    && ok "UNKNOWN: waits after the retries, no merge" || bad "unknown: exit $rc: $(cat "$W/out")"
[ "$(tr '\n' ' ' <"$GHD/sleep.log")" = "10 10 10 10 10 10 " ] && [ "$(grep -c '^pr view 1 ' "$GHD/log")" = 8 ] \
    && ok "UNKNOWN: 6 waits of 10 s, 7 views under the lock (8 with the first)" || bad "unknown: sleeps [$(cat "$GHD/sleep.log")] views $(grep -c '^pr view 1 ' "$GHD/log")"
[ ! -e "$LAND_TEST_LOCK" ] && ok "UNKNOWN: the lock is released" || bad "unknown: lock left"
new_world unknown3 1
state noscope 1
printf 'MERGEABLE\nUNKNOWN\nUNKNOWN\nUNKNOWN\nMERGEABLE\n' >"$GHD/mergeable-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ "$(wc -l <"$GHD/sleep.log" | tr -d ' ')" = 3 ] && ok "UNKNOWN 3 times, then MERGEABLE: merged after 3 waits" || bad "unknown3: exit $rc sleeps $(cat "$GHD/sleep.log" 2>/dev/null): $(cat "$W/out")"
new_world moved 1
state noscope 1
echo 0123456789abcdef0123456789abcdef01234567 >"$GHD/moved-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q "^#1 waits: the head moved from $(head_of 1 | cut -c1-8) to 01234567" "$W/out" \
    && ok "a push between the check and the merge: waits, no gh pr merge" || bad "moved: exit $rc: $(cat "$W/out")"
for st in BEHIND DIRTY; do
    new_world "mss-$st" 1
    state noscope 1
    echo "{\"mergeStateStatus\":\"$st\"}" >"$GHD/pr-1.json"
    "$LAND" "$S" >"$W/out" 2>&1; rc=$?
    [ "$rc" = 3 ] && [ "$(merges)" = 0 ] && grep -q "^#1 waits: $st: " "$W/out" && [ ! -e "$LAND_TEST_LOCK" ] && ok "$st: waits, no rebase, no merge" || bad "$st: exit $rc: $(cat "$W/out")"
    ! grep -q "update-branch\|push" "$GHD/log" && ok "$st: land does not update the branch" || bad "$st: gh $(cat "$GHD/log")"
done

# --- the lock: waited for while another holds it, a stuck one removed, released on a refused merge -------------------
new_world lockwait 1
state noscope 1
mkdir "$LAND_TEST_LOCK"; : >"$GHD/unlock-on-sleep"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(head -n 2 "$GHD/sleep.log" | tr '\n' ' ')" = "30 30 " ] && [ "$(head -n 1 "$GHD/locks")" = "1 held" ] \
    && ok "lock: a held lock is waited for (30 s polls), then taken for the merge" || bad "lockwait: exit $rc sleeps $(cat "$GHD/sleep.log" 2>/dev/null) locks $(cat "$GHD/locks" 2>/dev/null)"
new_world lockstale 1
state noscope 1
mkdir "$LAND_TEST_LOCK"; touch -t 202001010000 "$LAND_TEST_LOCK"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ ! -s "$GHD/sleep.log" ] && grep -q "stuck, removed" "$W/state.log" && ok "lock: one older than 90 min is removed as stuck" || bad "lockstale: exit $rc: $(cat "$W/out")"
new_world lockfail 1 2
state noscope 1 2
: >"$GHD/merge-fail-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
grep -q '^#1 waits: gh pr merge failed (exit 1): Pull request #1 is not mergeable' "$W/out" && [ "$(cat "$GHD/locks")" = "$(printf '1 held\n2 held\n900 held')" ] && [ ! -e "$LAND_TEST_LOCK" ] \
    && ok "lock: released after a refused merge, the next PR takes it again" || bad "lockfail: $(cat "$W/out") locks $(cat "$GHD/locks")"

# --- a kill after the first merge, then the same command again --------------------------------------------------
new_world resume 1 2
state noscope 1 2
: >"$GHD/kill-after-merge-1"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
# exit 137 (128 + SIGKILL); on Windows a killed process ends with exit code 1
{ [ "$rc" = 137 ] || { on_windows && [ "$rc" = 1 ]; }; } && [ "$(merged_of 1)" = 1 ] && [ "$(merged_of 2)" = 0 ] && ok "resume: killed right after the merge of PR 1 (exit $rc)" || bad "resume: first run exit $rc: $(cat "$GHD/log")"
rm -f "$GHD/kill-after-merge-1"
# the killed run left its lock (SIGKILL runs no handler): it counts as stuck once older than LAND_LOCK_STALE_S
[ -d "$LAND_TEST_LOCK" ] && touch -t 202001010000 "$LAND_TEST_LOCK"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ "$(merged_of 2)" = 1 ] && grep -q '^#1 merged [0-9a-f]\{40\}$' "$W/out" && grep -q '^#2 merged ' "$W/out" \
    && ok "resume: PR 2 merged, PR 1 not merged again" || bad "resume: exit $rc: $(cat "$W/out") merges $(grep '^pr merge' "$GHD/log")"
[ "$(grep -c '^pr create' "$GHD/log")" = 1 ] && [ "$(wc -l <"$GHD/ticket.log" | tr -d ' ')" = 2 ] && ok "resume: one documents PR for both tickets" || bad "resume: docs $(grep '^pr create' "$GHD/log") tickets $(cat "$GHD/ticket.log")"

# --- SIGTERM while the lock is held: released -----------------------------------------------------------------
new_world term 1
state noscope 1
echo UNKNOWN >"$GHD/mergeable-1"
unset LAND_SLEEP
LAND_RETRY_S=30 "$LAND" "$S" >"$W/out" 2>&1 & lp=$!
n=100; until [ -d "$LAND_TEST_LOCK" ] || [ "$n" = 0 ]; do sleep 0.1; n=$((n - 1)); done
kill -TERM "$lp" 2>/dev/null; wait "$lp"; rc=$?
export LAND_SLEEP="$STUBS/sleep.mjs"
if on_windows; then
    echo "skip SIGTERM: a kill from Git Bash ends node on Windows without running its signal handlers"
else
    [ "$rc" = 143 ] && [ ! -e "$LAND_TEST_LOCK" ] && [ "$(merges)" = 0 ] && ok "SIGTERM while waiting under the lock: exit 143, lock released" || bad "term: exit $rc lock $([ -e "$LAND_TEST_LOCK" ] && echo left)"
fi

# --- --watch: a run in progress finishes, the next pass merges ---------------------------------------------------
new_world watch 1
state noscope 1
running "$(head_of 1)"; : >"$GHD/runs-done-on-sleep"
"$LAND" "$S" --watch >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ "$(head -n 1 "$GHD/sleep.log")" = 300 ] && ok "watch: waits 300 s while CI runs, merges on the next pass" || bad "watch: exit $rc sleeps $(cat "$GHD/sleep.log" 2>/dev/null): $(cat "$W/out")"
new_world nowatch 1
state noscope 1
running "$(head_of 1)"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 3 ] && [ ! -e "$GHD/sleep.log" ] && ok "without --watch: one pass, no wait" || bad "nowatch: exit $rc sleeps $(cat "$GHD/sleep.log" 2>/dev/null)"

# --- the documents: a red documents check is red, nothing pushed; the input is checked -----------------------------
new_world docsred 1
state noscope 1
echo 1 >"$GHD/docs-check-rc"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 2 ] && [ "$(merged_of 1)" = 1 ] && ! grep -q '^pr create' "$GHD/log" && grep -q '^documents land-docs/.* waits: .* exited 1' "$W/out" \
    && ok "docs: a red documents check -> no documents PR, LAND=red" || bad "docsred: exit $rc: $(cat "$W/out")"
rm -f "$GHD/docs-check-rc"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(grep -c '^pr create' "$GHD/log")" = 1 ] && [ "$(merged_of 1)" = 1 ] && ok "docs: the next run opens and merges the documents PR, PR 1 not merged again" || bad "docsred rerun: exit $rc: $(cat "$W/out")"
new_world silent 1
state noscope 1
node -e 'const fs=require("fs"),s=JSON.parse(fs.readFileSync(process.argv[1]));s.tickets_root=null;fs.writeFileSync(process.argv[1],JSON.stringify(s))' "$S"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && ! grep -q '^pr create' "$GHD/log" && [ ! -e "$GHD/ticket.log" ] && ok "docs: tickets_root null -> merged, no documents PR, no ticket done" || bad "silent: exit $rc: $(cat "$W/out")"
new_world input 1
state noscope 1
node -e 'const fs=require("fs"),s=JSON.parse(fs.readFileSync(process.argv[1]));s.ci="batch";fs.writeFileSync(process.argv[1],JSON.stringify(s))' "$S"
"$LAND" "$S" >"$W/out" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q 'batch' "$W/out" && [ ! -s "$GHD/log" ] && ok "input: workflow.ci batch is refused before any gh call" || bad "input batch: exit $rc: $(cat "$W/out")"
"$LAND" >"$W/out" 2>&1; rc=$?
[ "$rc" = 1 ] && grep -q 'usage: land' "$W/out" && ok "input: no state file -> usage, exit 1" || bad "input usage: exit $rc"

# --- the state-file block of skill epic-wave ("Merge with land") writes a file land takes -------------------------
SKILL="${SKILL_FILE:-$HERE/../../skills/epic-wave/SKILL.md}"
awk '/^\*\*Merge with land\*\*/{s=1} s && /<<.NODE.$/{n=1; next} n && /^NODE$/{exit} n' "$SKILL" >"$T/skill-state.js"
new_world skill 1
node "$T/skill-state.js" "$(tn "$S")" "$(tn "$W/repo")" main pr ci-ok ci.yml "" "" "node \"$(tn "$STUBS/docs-check.mjs")\"" "1:e:01:$(head_of 1)" >"$W/out" 2>&1
"$LAND" "$S" >>"$W/out" 2>&1; rc=$?
[ -s "$T/skill-state.js" ] && [ "$rc" = 0 ] && [ "$(merged_of 1)" = 1 ] && [ "$(q "$S" 's.prs[0].head')" = "$(head_of 1)" ] && [ "$(q "$S" 's.scope')" = null ] \
    && ok "skill: the state file of the epic-wave block is one land merges from" || bad "skill block: exit $rc: $(cat "$W/out")"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
