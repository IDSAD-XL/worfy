#!/usr/bin/env bash
# Tests of harness/bin/wave-brief: the summary a fresh orchestrator session reads first. On a fixture epic
# (tickets done, claimed, blocked with Waits:, open with and without done blockers), a state file of bin/land, a
# gh stub that answers `gh pr list`, and run folders of the decision log, the brief shows the merged PRs and the
# last LAND= line, the waiting tickets with their reason, the epic's open PRs with their marks, the next wave
# and the journal; without a state file it says land has not run; a brief saved in the run folder names the
# state file for the next session; an unknown epic is exit 1; the output stays under 12 000 bytes; and the run
# writes nothing and asks gh only to read.
# gh is always the stub: no network, no real gh, no credential.
# Run: bash harness/bin/tests/wave-brief.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
WB="${WAVE_BRIEF:-$HERE/../wave-brief}"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
# A path under $T as node reads it: C:/… in Git Bash on Windows (pwd -W); unchanged elsewhere.
TN="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
tn() { case "$1" in "$T"/*) printf '%s' "$TN${1#"$T"}" ;; *) printf '%s' "$1" ;; esac; }
# The same path as the script prints it: node's path.resolve, C:\… with backslashes on Windows.
np() { node -e 'process.stdout.write(require("path").resolve(process.argv[1]))' "$(tn "$1")"; }
. "$HERE/real-home.sh"
REAL_HOME="$HOME"
home_before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# --- gh: a node stub. `pr list` answers $GHD/prs.json; with $GHD/fail it exits 1; anything else is refused.
# Every call goes to $GHD/log.
STUBS="$T/stubs"; GHD="$T/gh"; mkdir -p "$STUBS" "$GHD"
cat >"$STUBS/gh.mjs" <<'EOF'
import fs from "node:fs"
import path from "node:path"
const D = process.env.GHD, a = process.argv.slice(2)
fs.appendFileSync(path.join(D, "log"), a.join(" ") + "\n")
if (fs.existsSync(path.join(D, "fail"))) { process.stderr.write("could not resolve to a Repository\n"); process.exit(1) }
if (a[0] === "pr" && a[1] === "list") { process.stdout.write(fs.readFileSync(path.join(D, "prs.json"), "utf8")); process.exit(0) }
process.stderr.write(`stub gh: unexpected ${a.join(" ")}\n`)
process.exit(1)
EOF
printf '#!/usr/bin/env bash\nexec node "%s" "$@"\n' "$STUBS/gh.mjs" >"$STUBS/gh"; chmod +x "$STUBS/gh"
export PATH="$STUBS:$PATH" GHD WAVE_BRIEF_GH="$STUBS/gh.mjs"
. "$HERE/gh-stand-in.sh"
gh_guard WAVE_BRIEF_GH "$STUBS/gh" "$STUBS/gh.mjs"

# --- a registry of two projects: t (PRs) and lg (local-green), and a Harness home of the test ---------
export HOME="$T/home" HARNESS_HOME="$T/hh" CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/profiles"
unset CLAUDE_PROFILE_BIN CLAUDE_TICKET_BIN CLAUDE_PLUGIN_ROOT EVAL_HARNESS_HOME
mkdir -p "$HOME" "$HARNESS_HOME" "$T/profiles/t" "$T/profiles/lg"
R="$T/repo"; LG="$T/lg"
printf '{"repos":[{"key":"t","match":"%s","profile":"t","pm":"npm"},{"key":"lg","match":"%s","profile":"lg","pm":"npm"}]}\n' "$(tn "$R")" "$(tn "$LG")" >"$CLAUDE_GATE_CONFIG"
printf '{"schema":1,"name":"t","workflow":{"finish":"pr-green-ci"}}\n' >"$T/profiles/t/profile.json"
printf '{"schema":1,"name":"lg","workflow":{"finish":"local-green"}}\n' >"$T/profiles/lg/profile.json"
: >"$T/profiles/t/rules.md"; : >"$T/profiles/lg/rules.md"

# --- the fixture epic e: 01, 02 done; 03 claimed with an open PR; 04 blocked, waits for the owner, its PR named
# by the PR: line; 05 open behind 03; 06 open behind 01 and 02 (ready); 07 open, no blocker (ready); 08 and 09
# open on main but in work — 08 has an open PR on e/08, 09 a local branch e/09-x (in Full mode `ticket claim`
# writes `claimed` on the ticket's branch, not on main). An epic "other" with a PR of its own that must not show up.
tk() { mkdir -p "$1/.scratch/$2/issues"; printf '%b' "$4" >"$1/.scratch/$2/issues/$3"; }
git init -q -b main "$R"
tk "$R" e 01-a.md '# 01 — first\n\nStatus: done 2026-10-28T10:00Z\nPR: #11\nBlocked by: —\n'
tk "$R" e 02-b.md '# 02 — second\n\nStatus: done 2026-10-28T10:05Z\nPR: #12\nBlocked by: —\n'
tk "$R" e 03-c.md '# 03 — third\n\nStatus: claimed 2026-10-28T09:00Z\nBlocked by: 01\n'
tk "$R" e 04-d.md '# 04 — fourth\n\nStatus: blocked 2026-10-28T09:30Z\nBlocked reason: needs the PC\nWaits: owner\nPR: #21\nBlocked by: —\n'
tk "$R" e 05-e.md '# 05 — fifth\n\nStatus: open\nBlocked by: 03\n'
tk "$R" e 06-f.md '# 06 — sixth\n\nStatus: open\nBlocked by: 01, 02\n'
tk "$R" e 07-g.md '# 07 — seventh\n\nStatus: open\nBlocked by: —\n'
tk "$R" e 08-h.md '# 08 — eighth\n\nStatus: open\nBlocked by: —\n'
tk "$R" e 09-i.md '# 09 — ninth\n\nStatus: open\nBlocked by: 01\n'
tk "$R" other 01-x.md '# 01 — other\n\nStatus: claimed 2026-10-28T09:00Z\nBlocked by: —\n'
git -C "$R" add -A && git -C "$R" commit -q -m tickets
git -C "$R" branch e/09-x
S11=1111111111111111111111111111111111111111 S12=2222222222222222222222222222222222222222
H13=3333333333333333333333333333333333333333 D900=9999999999999999999999999999999999999999
cat >"$GHD/prs.json" <<EOF
[{"number":13,"title":"third","headRefName":"e/03","headRefOid":"$H13","labels":[{"name":"needs-mac-gate"}],
  "statusCheckRollup":[{"__typename":"StatusContext","context":"review","state":"SUCCESS"},
    {"__typename":"StatusContext","context":"check/windows","state":"PENDING"},
    {"__typename":"CheckRun","name":"ci-ok","status":"COMPLETED","conclusion":"SUCCESS"},
    {"__typename":"CheckRun","name":"macos-e2e","status":"COMPLETED","conclusion":"FAILURE"},
    {"__typename":"CheckRun","name":"linux-tests","status":"IN_PROGRESS","conclusion":""}]},
 {"number":20,"title":"other","headRefName":"other/01","headRefOid":"$S11","labels":[],"statusCheckRollup":[]},
 {"number":21,"title":"fourth","headRefName":"fix-the-pc-path","headRefOid":"$S12","labels":[],"statusCheckRollup":[]},
 {"number":22,"title":"eighth","headRefName":"e/08","headRefOid":"$H13","labels":[],"statusCheckRollup":[]}]
EOF
# The state file of land: 11 and 12 merged, 13 waits for its review, one documents PR merged, last run unverified.
S="$T/land-e-1.json"
cat >"$S" <<EOF
{"repo":"$(tn "$R")","branch":"main","ci":"pr","ci_check":"ci-ok","ci_workflow":"ci.yml","docs_check":null,"tickets_root":".scratch",
 "prs":[{"number":11,"epic":"e","ticket":"01","head":"$S11","checks":[],"result":{"status":"merged","sha":"$S11","at":"2026-10-28T10:00:00Z"}},
        {"number":12,"epic":"e","ticket":"02","head":"$S12","checks":["windows"],"result":{"status":"merged","sha":"$S12","at":"2026-10-28T10:04:00Z"}},
        {"number":13,"epic":"e","ticket":"03","head":"$H13","checks":[],"result":{"status":"waits","reason":"no review mark on the head","kind":"waits","at":"2026-10-28T10:05:00Z"}}],
 "docs":[{"branch":"land-docs/1","prs":[11,12],"pr":900,"result":{"status":"merged","sha":"$D900","at":"2026-10-28T10:06:00Z"}}],
 "runs":[{"started":"2026-10-28T09:58:00Z","ended":"2026-10-28T10:06:00Z","land":"red"},{"started":"2026-10-28T10:30:00Z","ended":"2026-10-28T10:31:00Z","land":"unverified"}]}
EOF
# Run folders of the decision log: an older one and the newest of e, and one of an epic "e-x" whose name starts the same way.
RUNS="$HARNESS_HOME/runs/t"; OLD="$RUNS/e-wave-20261027T080000Z"; NEW="$RUNS/e-wave-20261028T080000Z"
mkdir -p "$OLD" "$NEW" "$RUNS/e-x-wave-20261029T080000Z"
printf 'time\tdecision\twhy\tevidence\n1\tplan\twhy\t\n' >"$OLD/decisions.tsv"
printf 'time\tdecision\twhy\tevidence\n1\tplan 03, 04\twhy\t\n2\t04 out\tPC\t\n' >"$NEW/decisions.tsv"

brief() { (cd "$R" && "$WB" "$@") >"$T/out" 2>"$T/err"; }
has() { grep -qF -- "$1" "$T/out"; }
section() { awk -v h="## $1" '$0 == h { on = 1; next } on && /^## / { exit } on' "$T/out"; }
in_section() { section "$1" | grep -qF -- "$2"; }

# --- 1. the full brief on the fixture ----------------------------------------------------------------
# Every file and folder under $T (the repository, the Harness home, the folder of the state file), with the
# contents of each file; only the test's own output files and the gh stub's log are left out.
snap() { (cd "$T" && find . \( -path ./gh -o -path ./out -o -path ./err \) -prune -o -print | sort \
    && find . \( -path ./gh -o -path ./out -o -path ./err \) -prune -o -type f -exec cksum {} + | sort; git -C "$R" status --porcelain) ; }
before="$(snap)"
brief e --land "$(tn "$S")"; rc=$?
[ "$rc" = 0 ] && ok "fixture: exit 0" || bad "fixture: exit $rc: $(cat "$T/err")"
in_section Land 'LAND=unverified at 2026-10-28T10:31:00Z (run 2)' && ok "land: the last LAND= line of the state file" || bad "land: $(section Land)"
in_section Land "#11 e/01 merged ${S11:0:8}" && in_section Land "#12 e/02 merged ${S12:0:8}" \
    && ok "land: the merged PRs with their ticket and merge SHA" || bad "land: merged lines missing: $(section Land)"
in_section Land '#13 e/03 waits (waits): no review mark on the head' && ok "land: a PR that waits, with its reason" || bad "land: waits line: $(section Land)"
in_section Land "documents PR #900 for #11, #12: merged ${D900:0:8}" && ok "land: the documents PR" || bad "land: documents line: $(section Land)"
in_section Land "Land state: $(np "$S")" && in_section Land "log: $(np "$T/land-e-1.log")" && ok "land: names the state file and its log" || bad "land: paths: $(section Land)"
in_section Waiting '03 claimed' && in_section Waiting '04 blocked · waits: owner · needs the PC · PR #21' \
    && ok "waiting: the claimed ticket and the blocked one with Waits:, its reason and PR" || bad "waiting: $(section Waiting)"
in_section Waiting '08 in work: PR #22 (open on main)' && in_section Waiting '09 in work: branch e/09-x (open on main)' \
    && ok "waiting: an open ticket with an open PR or a branch of its own is in work" || bad "waiting, in work: $(section Waiting)"
! in_section Waiting '01 ' && ! in_section Waiting '06 ' && ok "waiting: done and open tickets are not listed" || bad "waiting lists done/open: $(section Waiting)"
in_section 'Open PRs' "#13 e/03 · branch e/03 @ ${H13:0:8} · labels: needs-mac-gate · marks: review=success check/windows=pending · CI: 1 done, 1 pending, 1 failed (macos-e2e)" \
    && ok "open PRs: the epic's PR by its branch, with head, labels, marks and the CI count" || bad "open PRs #13: $(section 'Open PRs')"
in_section 'Open PRs' "#21 e/04 · branch fix-the-pc-path @ ${S12:0:8} · marks: none · CI: no check runs" \
    && ok "open PRs: a PR named by a ticket's PR: line" || bad "open PRs #21: $(section 'Open PRs')"
! in_section 'Open PRs' '#20' && ok "open PRs: another epic's PR is left out" || bad "open PRs shows #20: $(section 'Open PRs')"
in_section 'Next wave' 'ready (open, not in work, every blocker done): 06, 07' && in_section 'Next wave' '05 waits for 03' && in_section 'Next wave' 'done 2/9' \
    && ! in_section 'Next wave' '08' && ! in_section 'Next wave' '09' \
    && ok "next wave: the open tickets not in work with every blocker done, the held one and what it waits for" || bad "next wave: $(section 'Next wave')"
in_section Journal "run folder: $(np "$NEW")" && in_section Journal "(2 rows)" && ok "journal: the newest run folder of the epic and its decision log" || bad "journal: $(section Journal)"
has 'Stage: /implement · e 2/9' && ok "epic: the Stage line of epic-status" || bad "epic: no Stage line: $(head -n 3 "$T/out")"
n="$(wc -c <"$T/out" | tr -d ' ')"
[ "$n" -lt 12000 ] && ok "size: $n bytes < 12000" || bad "size: $n bytes"
[ "$before" = "$(snap)" ] && ok "read-only: the repository and the Harness home are unchanged" || bad "read-only: something was written"
[ "$(grep -cv '^pr list --state open ' "$GHD/log")" = 0 ] && ok "gh: only pr list" || bad "gh calls: $(cat "$GHD/log")"

# --- 2. no state file and no saved brief: land has not run, exit 0 -------------------------------------
brief e; rc=$?
[ "$rc" = 0 ] && in_section Land 'land has not run' && ! has 'LAND=' && ok "no state file: 'land has not run', exit 0" || bad "no state file: exit $rc: $(section Land)"

# --- 3. a brief saved in the run folder names the state file for the next session --------------------------
(cd "$R" && "$WB" e --land "$(tn "$S")") >"$NEW/wave-brief.txt"
brief e; rc=$?
[ "$rc" = 0 ] && in_section Land 'LAND=unverified' && in_section Journal "saved brief: $(np "$NEW/wave-brief.txt")" \
    && ok "saved brief: a bare run reads the state file it names" || bad "saved brief: exit $rc: $(section Land) / $(section Journal)"
# a newer run folder without a brief (the next wave's log already started): the saved brief is still found
mkdir -p "$RUNS/e-wave-20261029T080000Z"
brief e
in_section Land 'LAND=unverified' && in_section Journal "run folder: $(np "$RUNS/e-wave-20261029T080000Z")" && in_section Journal 'decision log: none in it' \
    && ok "saved brief: found in an older run folder when the newest has none" || bad "saved brief, newer folder: $(section Land) / $(section Journal)"

# the next wave merged nothing and saves without --land: the shell creates its wave-brief.txt empty before
# wave-brief runs, and that empty file must not hide the state file the brief before it named
W3="$RUNS/e-wave-20261029T080000Z"
(cd "$R" && "$WB" e) >"$W3/wave-brief.txt"; rc=$?
[ "$rc" = 0 ] && grep -qF "Land state: $(np "$S")" "$W3/wave-brief.txt" && grep -qF 'LAND=unverified' "$W3/wave-brief.txt" \
    && ok "saved brief: a save without --land carries the state file of the brief before it" || bad "saved brief, empty file: exit $rc: $(cat "$W3/wave-brief.txt")"
: >"$W3/wave-brief.txt"
brief e
in_section Land 'LAND=unverified' && in_section Journal "saved brief: $(np "$NEW/wave-brief.txt")" \
    && ok "saved brief: an empty brief in the newest run folder is skipped" || bad "saved brief, empty newest: $(section Land) / $(section Journal)"

# --- 4. state files that cannot be read, and one of the old format: one line each, exit 0 -------------------
printf '{broken' >"$T/broken.json"; printf 'null' >"$T/null.json"; printf '{"prs":[null]}' >"$T/nullpr.json"
printf '{"scope":"all","prs":[],"runs":[{"land":"green","ended":"2026-10-20T10:00:00Z"}]}' >"$T/old.json"
brief e --land "$(tn "$T/broken.json")" --land "$(tn "$T/null.json")" --land "$(tn "$T/nullpr.json")" --land "$(tn "$T/old.json")"; rc=$?
[ "$rc" = 0 ] && [ "$(section Land | grep -c '^  not read — ')" = 3 ] && ok "unreadable state files (broken JSON, null, a null PR): 'not read' each, exit 0" \
    || bad "unreadable state files: exit $rc: $(section Land) $(cat "$T/err")"
in_section Land "outdated: it has the old field \`scope\`, which land refuses" && in_section Land 'LAND=green' \
    && ok "a state file with scope is flagged as outdated" || bad "scope: $(section Land)"

# --- 5. gh fails: the PR section says so, exit 0 ---------------------------------------------------------
: >"$GHD/fail"
brief e; rc=$?
[ "$rc" = 0 ] && in_section 'Open PRs' 'not read — gh exit 1: could not resolve to a Repository' && ok "gh fails: 'not read' with its message, exit 0" || bad "gh fails: exit $rc: $(section 'Open PRs')"
rm -f "$GHD/fail"

# --- 6. an unknown epic: exit 1; no epic: exit 2 ---------------------------------------------------------
brief nosuch; rc=$?
[ "$rc" = 1 ] && grep -qF 'no such epic: nosuch' "$T/err" && [ ! -s "$T/out" ] && ok "unknown epic: exit 1 with a message" || bad "unknown epic: exit $rc: $(cat "$T/err")"
brief; rc=$?
[ "$rc" = 2 ] && grep -qF 'usage: wave-brief' "$T/err" && ok "no epic: exit 2 with the usage" || bad "no epic: exit $rc"

# --- 7. local-green: no gh call ---------------------------------------------------------------------------
git init -q -b main "$LG"
tk "$LG" e 01-a.md '# 01 — first\n\nStatus: open\nBlocked by: —\n'
git -C "$LG" add -A && git -C "$LG" commit -q -m tickets
: >"$GHD/log"
(cd "$LG" && "$WB" e) >"$T/out" 2>"$T/err"; rc=$?
[ "$rc" = 0 ] && in_section 'Open PRs' 'workflow.finish is local-green' && [ ! -s "$GHD/log" ] && ok "local-green: no gh call" || bad "local-green: exit $rc, gh: $(cat "$GHD/log"), $(section 'Open PRs')"

# --- 8. a big epic: the lists are cut and the brief stays under 12 000 bytes -----------------------------------
long="$(printf 'a long reason %.0s' $(seq 1 30))"
for i in $(seq 10 69); do tk "$R" big "$i-t.md" "# $i — ticket $i with a title\n\nStatus: blocked\nBlocked reason: $long\nWaits: team\nBlocked by: —\n"; done
for i in $(seq 70 99); do tk "$R" big "$i-o.md" "# $i — open $i\n\nStatus: open\nBlocked by: 10, 11, 12\n"; done
brief big; rc=$?
n="$(wc -c <"$T/out" | tr -d ' ')"
[ "$rc" = 0 ] && in_section Waiting '… and 35 more' && in_section 'Next wave' '… and 5 more' && [ "$n" -lt 12000 ] \
    && ok "big epic: lists cut at 25 lines, $n bytes < 12000" || bad "big epic: exit $rc, $n bytes: $(section Waiting | tail -n 2)"

# 50 blocked tickets with long reasons, 50 open PRs on branches of the epic that match no ticket and 50 held open tickets: every list fits its
# 25 lines, but together they would pass 12 000 bytes; the lists get shorter and the Journal is still there
for i in $(seq 100 149); do tk "$R" huge "$i-b.md" "# $i — blocked $i\n\nStatus: blocked\nBlocked reason: $long\nWaits: team\nBlocked by: —\n"; done
for i in $(seq 150 199); do tk "$R" huge "$i-o.md" "# $i — open $i\n\nStatus: open\nBlocked by: $(seq -s ', ' 100 124)\n"; done
cp "$GHD/prs.json" "$GHD/prs-e.json"
node -e 'const l=[];for(let i=200;i<250;i++)l.push({number:1000+i,title:"t",headRefName:`huge/${i}-a-long-branch-name`,headRefOid:"4".repeat(40),labels:["needs-mac-gate","awaiting-merge","human-review","platform","flaky-quarantine"].map((name)=>({name})),statusCheckRollup:["review","check/windows","check/pc","deploy"].map((context)=>({__typename:"StatusContext",context,state:"PENDING"}))});process.stdout.write(JSON.stringify(l))' >"$GHD/prs.json"
brief huge; rc=$?
n="$(wc -c <"$T/out" | tr -d ' ')"
[ "$rc" = 0 ] && [ "$n" -lt 12000 ] && in_section Journal 'saved brief: ' && ! has 'the brief is cut' && in_section Waiting '… and ' && in_section 'Open PRs' '… and ' && in_section 'Next wave' '… and ' \
    && ok "huge epic: three long lists together, $n bytes < 12000, the Journal kept" || bad "huge epic: exit $rc, $n bytes"
cp "$GHD/prs-e.json" "$GHD/prs.json"
# 80 state files: even with no list lines the brief is too long; it is cut at a line and says so
args=(); for i in $(seq 1 80); do args+=(--land "$(tn "$S")"); done
brief e "${args[@]}"; rc=$?
n="$(wc -c <"$T/out" | tr -d ' ')"
[ "$rc" = 0 ] && [ "$n" -lt 12000 ] && tail -n 1 "$T/out" | grep -qF 'the brief is cut at 11000 bytes' \
    && ok "80 state files: cut at a line, $n bytes < 12000, the last line says so" || bad "80 state files: exit $rc, $n bytes, last: $(tail -n 1 "$T/out")"

# --- 9. the commands of skill epic-wave run as written: the save at the end of a wave and the first command of a new session
SKILL="${SKILL_FILE:-$HERE/../../skills/epic-wave/SKILL.md}"
save="$(grep -F 'bin/wave-brief' "$SKILL" | grep -F '# a wave without a human')"
first="$(grep -F 'bin/wave-brief" <epic>); echo' "$SKILL")"
fill() { local c="${1//<epic>/e}"; c="${c//<state file>…/$(tn "$S")}"; c="${c//<run folder>/$(tn "$W3")}"; printf '%s' "${c//<repo>/$(tn "$R")}"; }
rm -f "$NEW/wave-brief.txt" "$W3/wave-brief.txt"
# run from outside the repository: the command itself goes there
(cd "$T" && CLAUDE_PLUGIN_ROOT="$(tn "$HERE/../..")" bash -c "$(fill "$save")") >"$T/out" 2>"$T/err"
[ -n "$save" ] && tail -n 1 "$T/out" | grep -qx 'EXIT=0' && grep -qF 'LAND=unverified' "$W3/wave-brief.txt" \
    && ok "skill: the save command of section 5 writes the brief into the run folder" || bad "skill save: '$save': $(cat "$T/out" "$T/err")"
(cd "$T" && CLAUDE_PLUGIN_ROOT="$(tn "$HERE/../..")" bash -c "$(fill "$first")") >"$T/out" 2>"$T/err"
[ -n "$first" ] && tail -n 1 "$T/out" | grep -qx 'EXIT=0' && in_section Land 'LAND=unverified' \
    && ok "skill: the first command of a new session reads the saved brief" || bad "skill first command: '$first': $(cat "$T/out" "$T/err")"

home_after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
