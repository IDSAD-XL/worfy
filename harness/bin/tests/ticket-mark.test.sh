#!/usr/bin/env bash
# Tests of `ticket mark` — an agent's mark (a review verdict, a check) bound to a commit SHA (worfy ADR-0067):
#   Full mode   — a GitHub commit status through `gh api -X POST repos/<owner>/<repo>/statuses/<sha>`;
#   Silent mode — <HARNESS_HOME>/runs/<project>/marks/<epic>-<NN>.json, and never a call to gh.
# Everything runs in a temporary HOME and HARNESS_HOME with a registry of temporary repositories; gh is a stub
# that records its arguments and never reaches GitHub (the tokens are unset as well).
# Run: bash harness/bin/tests/ticket-mark.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$(cd "$HERE/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
TICKET="$BIN/ticket"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$HERE/real-home.sh"
home_before="$(real_home_snapshot "$HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN GH_HOST CLAUDE_GATE_CONFIG CLAUDE_PROFILES_DIR CLAUDE_PROFILE_BIN
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-t}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-t@t}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-t}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-t@t}"

# --- the gh stub: one line per call, the arguments separated by " | "; $GH_FAIL — exit 1 with a message -------
STUBS="$T/stubs"; mkdir -p "$STUBS"
cat >"$STUBS/gh" <<'EOF'
#!/usr/bin/env bash
line=""; for a in "$@"; do line="$line${line:+ | }$a"; done
echo "$line" >>"$GH_LOG"
[ -n "${GH_FAIL:-}" ] && { echo "HTTP 422: No commit found for SHA" >&2; exit 1; }
echo '{"state":"ok"}'
EOF
chmod +x "$STUBS/gh"
export PATH="$STUBS:$PATH" GH_LOG="$T/gh.log"
# On Windows node runs the stub through a node stand-in named by $TICKET_GH; the guard stops the test
# before anything runs if any gh it can start is not the stub.
. "$HERE/gh-stand-in.sh"
if on_windows; then node_stand_in "$STUBS/gh" "$STUBS/gh.mjs"; export TICKET_GH="$STUBS/gh.mjs"; fi
gh_guard TICKET_GH "$STUBS/gh" "$STUBS/gh.mjs"

# --- the machine: HOME, HARNESS_HOME, the registry and the profiles -------------------------------------
H="$T/home" HH="$T/hh"
mkdir -p "$H" "$HH/gate" "$HH/projects" "$T/r/multi" "$T/wf"
repo() { # repo <dir> <origin url or "">: a git repository with one commit
    git init -q -b main "$1"
    echo x >"$1/README.md"; git -C "$1" add -A; git -C "$1" commit -q -m init
    [ -z "$2" ] || git -C "$1" remote add origin "$2"
}
repo "$T/r/shop" "git@github.com:acme/shop.git"
repo "$T/r/quiet" "https://github.com/acme/quiet.git"
repo "$T/r/local" "$T/elsewhere.git"
repo "$T/r/multi/front" "https://github.com/acme/front"
repo "$T/r/multi/back" "ssh://git@github.com/acme/back.git"
repo "$T/r/plain" ""
# Paths written into files node reads are in node's spelling: C:/… in Git Bash on Windows (pwd -W), where node
# reads /tmp/… as C:\tmp\…; the same as $T elsewhere.
TN="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
printf '{"repos":[%s]}\n' "$(printf '{"key":"shop","match":"%s","profile":"shop"},{"key":"quiet","match":"%s","profile":"quiet"},{"key":"local","match":"%s","profile":"local"},{"key":"front","match":"%s","profile":"multi"},{"key":"back","match":"%s","profile":"multi"}' \
    "$TN/r/shop" "$TN/r/quiet" "$TN/r/local" "$TN/r/multi/front" "$TN/r/multi/back")" >"$HH/gate/config.json"
newp() { mkdir -p "$HH/projects/$1" && printf '%s\n' "$2" >"$HH/projects/$1/profile.json"; }
newp shop '{"schema":2,"name":"shop","mode":"full"}'
newp quiet "{\"schema\":2,\"name\":\"quiet\",\"mode\":\"silent\",\"workflow\":{\"folder\":\"$TN/wf\"}}"
newp local '{"schema":2,"name":"local","mode":"full"}'
newp multi '{"schema":2,"name":"multi","mode":"full"}'

# Tickets: Full mode — in the working tree; Silent mode — in the Workflow folder; the multi project — in the
# folder above its repositories, with the ticket's `Repo:` line naming the repository.
ticket() { mkdir -p "$1/.scratch/shopfront/issues" && printf '%s\n' "# $2 — a ticket" '' 'Type: task' 'Status: claimed 2026-10-17T09:00Z' "${@:3}" '' '## Что делаем' '' 'text' >"$1/.scratch/shopfront/issues/$2-a-ticket.md"; }
ticket "$T/r/shop" 02
ticket "$T/wf" 02
ticket "$T/r/local" 02
ticket "$T/r/multi" 03 'Repo: back'
ticket "$T/r/multi" 04
SHA="$(git -C "$T/r/shop" rev-parse HEAD)"
OTHER="$(printf '%040d' 7)"

# tk <dir> <args…>: ticket run from <dir> on this machine; stdout and stderr go to $T/out, the exit code is returned.
tk() { local d="$1"; shift; (cd "$d" && env HOME="$H" HARNESS_HOME="$HH" node "$TICKET" "$@") >"$T/out" 2>&1; }
calls() { [ -f "$GH_LOG" ] && wc -l <"$GH_LOG" | tr -d ' ' || echo 0; }
last_call() { tail -n 1 "$GH_LOG" 2>/dev/null; }

# --- Full mode: a commit status on GitHub ----------------------------------------------------------------
: >"$GH_LOG"
tk "$T/r/shop" mark shopfront 02 review pending --sha "$SHA"; rc=$?
c="$(last_call)"
[ "$rc" -eq 0 ] && [ "$(calls)" = 1 ] && [[ "$c" == "api | -X | POST | repos/acme/shop/statuses/$SHA | -f | state=pending | -f | context=review | -f | description="* ]] \
    && ok "full: review pending -> gh api -X POST repos/acme/shop/statuses/<sha>, context review, state pending" || bad "full: review pending: exit $rc, calls [$(cat "$GH_LOG")], out $(cat "$T/out")"
[[ "$c" != *shopfront* && "$c" != *02-a-ticket* ]] && ok "full: the status names neither the epic nor the ticket" || bad "full: the status names the ticket: $c"
tk "$T/r/shop" mark shopfront/02 review success --sha "$SHA"; rc=$?
[ "$rc" -eq 0 ] && [[ "$(last_call)" == *"state=success | -f | context=review"* ]] && ok "full: epic/NN, review success -> state success" || bad "full: review success: exit $rc [$(last_call)]"
tk "$T/r/shop" mark shopfront 2 review failure --sha "$SHA"; rc=$?
[ "$rc" -eq 0 ] && [[ "$(last_call)" == *"state=failure | -f | context=review"* ]] && ok "full: number without the zero, review failure -> state failure" || bad "full: review failure: exit $rc [$(last_call)]"
tk "$T/r/shop" mark shopfront 02 check/windows skipped --sha "$SHA"; rc=$?
[ "$rc" -eq 0 ] && [[ "$(last_call)" == *"statuses/$SHA | -f | state=success | -f | context=check/windows | -f | description=skipped" ]] \
    && ok "full: check/windows skipped -> state success with the description skipped" || bad "full: skipped: exit $rc [$(last_call)]"
tk "$T/r/shop" mark shopfront 02 check/windows success --sha "$SHA"; rc=$?
[ "$rc" -eq 0 ] && grep -q "check/windows success" "$T/out" && ok "full: says which mark it set" || bad "full: output: $(cat "$T/out")"
[ -z "$(git -C "$T/r/shop" status --porcelain -- . ':!.scratch')" ] && [ ! -e "$HH/runs" ] && ok "full: nothing written into the repository or the Harness home" || bad "full: wrote: $(git -C "$T/r/shop" status --porcelain) $(ls -R "$HH/runs" 2>/dev/null)"
# The repository of a project of several repositories is the ticket's Repo: line (ADR-0045)
tk "$T/r/multi" mark shopfront 03 review success --sha "$OTHER"; rc=$?
[ "$rc" -eq 0 ] && [[ "$(last_call)" == *"repos/acme/back/statuses/$OTHER"* ]] && ok "full: the Repo: line picks the repository (acme/back)" || bad "full: Repo: line: exit $rc [$(last_call)] $(cat "$T/out")"
n="$(calls)"
tk "$T/r/multi" mark shopfront 04 review success --sha "$OTHER"; rc=$?
[ "$rc" -eq 1 ] && [ "$(calls)" = "$n" ] && grep -q "Repo:" "$T/out" && ok "full: several repositories, no Repo: line, outside git -> exit 1 naming Repo:, no gh" || bad "full: no Repo: line: exit $rc $(cat "$T/out")"
tk "$T/r/multi/front" mark shopfront 04 review success --sha "$OTHER" --root "$T/r/multi/.scratch"; rc=$?
[ "$rc" -eq 0 ] && [[ "$(last_call)" == *"repos/acme/front/statuses/$OTHER"* ]] && ok "full: no Repo: line, run in a repository -> its origin" || bad "full: cwd repository: exit $rc [$(last_call)] $(cat "$T/out")"
# origin not on GitHub; gh failing; gh missing
n="$(calls)"
tk "$T/r/local" mark shopfront 02 review success --sha "$SHA"; rc=$?
[ "$rc" -eq 1 ] && [ "$(calls)" = "$n" ] && grep -q "not on GitHub" "$T/out" && ok "full: origin not on GitHub -> exit 1, no gh" || bad "full: local origin: exit $rc $(cat "$T/out")"
GH_FAIL=1 tk "$T/r/shop" mark shopfront 02 review success --sha "$SHA"; rc=$?
[ "$rc" -eq 1 ] && grep -q "HTTP 422" "$T/out" && ok "full: gh fails -> exit 1 with its message" || bad "full: gh fails: exit $rc $(cat "$T/out")"
# TICKET_GH on every OS: a node script named there runs for a Full mark, with gh's arguments; a missing one is
# named in the refusal (not "gh is not in PATH")
printf '%s\n' 'import { appendFileSync } from "node:fs"' 'appendFileSync(process.env.OVR_LOG, process.argv.slice(2).join(" | ") + "\n")' >"$T/log-gh.mjs"
n="$(calls)"
OVR_LOG="$T/ovr.log" TICKET_GH="$T/log-gh.mjs" tk "$T/r/shop" mark shopfront 02 review success --sha "$SHA"; rc=$?
[ "$rc" -eq 0 ] && grep -q "^api | -X | POST | repos/acme/shop/statuses/$SHA | " "$T/ovr.log" 2>/dev/null && [ "$(calls)" = "$n" ] \
    && ok "full: TICKET_GH names a node script -> it runs with gh's arguments, not gh" || bad "full: TICKET_GH: exit $rc log [$(cat "$T/ovr.log" 2>/dev/null)] $(cat "$T/out")"
TICKET_GH="$T/no-such-gh" tk "$T/r/shop" mark shopfront 02 review success --sha "$SHA"; rc=$?
[ "$rc" -eq 1 ] && grep -q "TICKET_GH names a program that is not there: .*no-such-gh" "$T/out" && ! grep -q "not in PATH" "$T/out" \
    && ok "full: TICKET_GH naming a missing program -> exit 1 naming it" || bad "full: missing TICKET_GH: exit $rc $(cat "$T/out")"
MINBIN="$T/minbin"; mkdir -p "$MINBIN"; MINPATH="$MINBIN"
if on_windows; then
    # Git Bash's ln -s copies the program. ticket starts bin/profile with process.execPath, and Windows starts no
    # program without an extension by its path: a copy named "node" fails with ENOENT there, and ticket reads that as
    # "no profile". A copied git.exe cannot load the DLLs of its own folder, so git's folder goes on PATH instead;
    # the guard below checks that it has no gh.
    ln -s "$(command -v node)" "$MINBIN/node.exe"
    MINPATH="$MINBIN:$(dirname "$(type -P git)")"
else
    for c in node git; do ln -s "$(command -v "$c")" "$MINBIN/$c"; done
fi
# The minimal PATH has no gh, and its node starts itself again by process.execPath, as ticket starts bin/profile.
IFS=: read -ra mindirs <<<"$MINPATH"
for d in "${mindirs[@]}"; do
    if [ -e "$d/gh" ] || [ -e "$d/gh.exe" ]; then echo "REFUSED: the minimal PATH has a gh in $d" >&2; exit 1; fi
done
(cd "$T/r/shop" && env PATH="$MINPATH" "$MINBIN/node" -e 'require("child_process").execFileSync(process.execPath, ["-e", ""])') >"$T/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && ok "full: the node of the minimal PATH starts itself by process.execPath" || bad "full: minimal PATH: exit $rc $(cat "$T/out")"
(cd "$T/r/shop" && env -u TICKET_GH PATH="$MINPATH" HOME="$H" HARNESS_HOME="$HH" "$MINBIN/node" "$TICKET" mark shopfront 02 review success --sha "$SHA") >"$T/out" 2>&1; rc=$?
[ "$rc" -eq 1 ] && grep -q "gh" "$T/out" && ok "full: no gh in PATH -> exit 1 naming gh" || bad "full: no gh: exit $rc $(cat "$T/out")"

# --- Silent mode: a local JSON file, never gh ---------------------------------------------------------------
: >"$GH_LOG"
M="$HH/runs/quiet/marks/shopfront-02.json"
tk "$T/r/quiet" mark shopfront 02 review pending --sha "$SHA"; rc1=$?
tk "$T/r/quiet" mark shopfront/02 review failure --sha "$SHA"; rc2=$?
tk "$T/r/quiet" mark shopfront 2 check/windows skipped --sha "$OTHER"; rc3=$?
[ "$rc1$rc2$rc3" = 000 ] && [ -f "$M" ] && ok "silent: three marks -> exit 0, $M" || bad "silent: exit $rc1 $rc2 $rc3, $(cat "$T/out")"
got="$(jq -r '"\(.epic) \(.num) " + ([.marks[] | "\(.kind)=\(.verdict)@\(.sha[0:7])"] | join(","))' "$M" 2>&1)"
[ "$got" = "shopfront 02 review=pending@${SHA:0:7},review=failure@${SHA:0:7},check/windows=skipped@0000000" ] && ok "silent: {epic, num, marks: [{kind, verdict, sha}]}, in order" || bad "silent: file: $got"
jq -e '[.marks[].at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$")] | all' "$M" >/dev/null && ok "silent: each mark has its time (at, ISO 8601 UTC)" || bad "silent: times: $(jq -c '[.marks[].at]' "$M")"
[ "$(calls)" = 0 ] && ok "silent: gh is never called" || bad "silent: gh called: $(cat "$GH_LOG")"
[ "$(ls -A "$HH/runs/quiet/marks")" = "shopfront-02.json" ] && ok "silent: no temporary or lock file left next to it" || bad "silent: left: $(ls -A "$HH/runs/quiet/marks")"
[ -z "$(git -C "$T/r/quiet" status --porcelain)" ] && ok "silent: nothing written into the repository" || bad "silent: the repository changed: $(git -C "$T/r/quiet" status --porcelain)"
# a broken marks file is not overwritten: the marks in it would be lost
cp "$M" "$T/good.json"; printf '{"epic":' >"$M"
tk "$T/r/quiet" mark shopfront 02 review success --sha "$SHA"; rc=$?
[ "$rc" -eq 1 ] && [ "$(cat "$M")" = '{"epic":' ] && ok "silent: a broken marks file -> exit 1, the file is left as it was" || bad "silent: broken file: exit $rc, now $(cat "$M")"
cp "$T/good.json" "$M"
# a lock left by another mark is waited for, and a stale one is taken over
mkdir "$M.lock"; touch -t 202001010000 "$M.lock"
tk "$T/r/quiet" mark shopfront 02 review success --sha "$SHA"; rc=$?
[ "$rc" -eq 0 ] && [ ! -e "$M.lock" ] && [ "$(jq '.marks | length' "$M")" = 4 ] && ok "silent: a stale lock is taken over, the mark is added" || bad "silent: stale lock: exit $rc $(cat "$T/out")"
mkdir "$M.lock"
( sleep 1; rmdir "$M.lock" ) & holder=$!
tk "$T/r/quiet" mark shopfront 02 review success --sha "$SHA"; rc=$?; wait "$holder"
[ "$rc" -eq 0 ] && [ "$(jq '.marks | length' "$M")" = 5 ] && ok "silent: a live lock is waited for, then the mark is added" || bad "silent: live lock: exit $rc $(cat "$T/out")"
[ "$(calls)" = 0 ] && ok "silent: still no gh call" || bad "silent: gh called: $(cat "$GH_LOG")"

# --- usage: exit 2, nothing called, nothing written -------------------------------------------------------
: >"$GH_LOG"
usage() { # usage <name> <args…>
    local name="$1"; shift
    tk "$T/r/shop" mark "$@"; local rc=$?
    [ "$rc" -eq 2 ] && [ "$(calls)" = 0 ] && ok "usage: $name -> exit 2" || bad "usage: $name: exit $rc, calls $(calls): $(cat "$T/out")"
}
usage "no --sha" shopfront 02 review success
usage "--sha without a value" shopfront 02 review success --sha
usage "a short SHA" shopfront 02 review success --sha "${SHA:0:7}"
usage "a SHA with upper case letters" shopfront 02 review success --sha "$(printf '%s' "$SHA" | tr a-f A-F)"
usage "unknown kind" shopfront 02 verdict success --sha "$SHA"
usage "deploy is not an agent's kind" shopfront 02 deploy success --sha "$SHA"
usage "check/ without a name" shopfront 02 check/ success --sha "$SHA"
usage "check/<name> with a space" shopfront 02 "check/two words" success --sha "$SHA"
usage "unknown verdict" shopfront 02 review ok --sha "$SHA"
usage "no verdict" shopfront 02 review --sha "$SHA"
usage "an extra argument" shopfront 02 review success extra --sha "$SHA"
tk "$T/r/shop" show shopfront 02 --sha "$SHA"; rc=$?
[ "$rc" -ne 0 ] && grep -q -- "go only with mark" "$T/out" && ok "usage: --sha with another command -> refused" || bad "usage: --sha with show: exit $rc $(cat "$T/out")"
[ ! -e "$HH/runs/shop" ] && ok "usage: nothing written" || bad "usage: wrote $(ls -R "$HH/runs")"

# --- other refusals ---------------------------------------------------------------------------------------
tk "$T/r/shop" mark shopfront 09 review success --sha "$SHA"; rc=$?
[ "$rc" -eq 1 ] && grep -q "no ticket 9" "$T/out" && ok "no such ticket -> exit 1" || bad "no such ticket: exit $rc $(cat "$T/out")"
tk "$T/r/plain" mark shopfront 02 review success --sha "$SHA" --root "$T/r/shop/.scratch"; rc=$?
[ "$rc" -eq 1 ] && grep -q "profile" "$T/out" && [ "$(calls)" = 0 ] && ok "a directory outside the registry -> exit 1 naming the profile, no gh" || bad "unregistered: exit $rc $(cat "$T/out")"

# --- --contexts: the names of the marks, for the CI filter -------------------------------------------------
(cd "$T" && node "$TICKET" mark --contexts) >"$T/out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ "$(cat "$T/out")" = "$(printf 'review\ncheck/*\ndeploy')" ] && ok "--contexts prints review, check/*, deploy (no profile needed)" || bad "--contexts: exit $rc [$(cat "$T/out")]"
(cd "$T" && node "$TICKET" mark --contexts shopfront) >"$T/out" 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "--contexts with arguments -> exit 2" || bad "--contexts with arguments: exit $rc"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || { bad "the real home changed"; real_home_diff "$home_before" "$home_after"; }

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
