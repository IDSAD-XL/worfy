#!/usr/bin/env bash
# Tests of harness/bin/preflight outside Auction. Run: bash harness/bin/tests/preflight.test.sh;
# exit code 0 — everything passed.
#
# The registry and profiles are temporary (CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR, bin/profile understands them).
# Behaviour on Auction is checked by comparison with earlier output, not here: it depends on
# the live origin/main.
set -u
# The scripts under test are the copies next to this test (harness/); BIN_DIR and HOOKS_DIR
# point it at another copy.
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
PF="$BIN/preflight"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/profiles"
mkdir -p "$T/nogit" "$T/unreg" "$T/reg" "$T/profiles/t"
git -C "$T/unreg" init -q && git -C "$T/unreg" commit -q --allow-empty -m init
# A registered project without ADRs and migrations, with one epic "x" of one open ticket, with
# origin in a local bare repository.
git init -q --bare "$T/origin.git"
git -C "$T/reg" init -q -b main
mkdir -p "$T/reg/.scratch/x/issues"
printf '# 01 — a ticket\n\nStatus: open\n' >"$T/reg/.scratch/x/issues/01-a.md"
git -C "$T/reg" add -A && git -C "$T/reg" -c user.email=t@t -c user.name=t commit -q -m init
git -C "$T/reg" remote add origin "$T/origin.git" && git -C "$T/reg" push -q origin main 2>/dev/null
git -C "$T/reg" fetch -q origin
printf '{"repos":[{"key":"t","match":"%s","profile":"t","pm":"npm"}]}\n' "$T/reg" >"$CLAUDE_GATE_CONFIG"
printf '{"schema":1,"name":"t","worktree":{"base":"origin/main"},"numbering":{"adr":null,"migrations":null},"docs":{"adr_dir":null},"tickets":{"epic_status":null}}\n' \
    >"$T/profiles/t/profile.json"
: >"$T/profiles/t/rules.md"

# 1. An unregistered git repository: usage error, exit 2, a clear message.
err="$(cd "$T/unreg" && bash "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"project not registered"* ]] && ok "unregistered repo -> exit 2 + message" \
    || bad "unregistered repo: exit $rc, err: ${err:0:300}"

# 1a. An unregistered git repository inside a profile's common directory (next to two
# repositories of the profile, itself not in the registry): also "not registered", not the neighbours' profile.
mkdir -p "$T/ws/a" "$T/ws/b" "$T/ws/foreign" "$T/profiles/w"
for d in a b foreign; do git -C "$T/ws/$d" init -q -b main && git -C "$T/ws/$d" commit -q --allow-empty -m init; done
printf '{"schema":1,"name":"w"}\n' >"$T/profiles/w/profile.json"
printf '{"repos":[{"key":"a","match":"%s","profile":"w"},{"key":"b","match":"%s","profile":"w"}]}\n' "$T/ws/a" "$T/ws/b" >"$T/ws.json"
err="$(cd "$T/ws/foreign" && CLAUDE_GATE_CONFIG="$T/ws.json" bash "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"project not registered"* ]] && ok "unregistered repo inside a workspace -> exit 2" \
    || bad "foreign repo in workspace: exit $rc, err: ${err:0:300}"

# 2. A non-git directory — also exit 2.
err="$(cd "$T/nogit" && bash "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"not a git repository"* ]] && ok "non-git dir -> exit 2" || bad "non-git dir: exit $rc, err: ${err:0:200}"

# 3. A registered project without ADRs/migrations: steps skipped with a line, the epics come from the
# Harness's own epic-status (the profile names none), verdict GO.
out="$(cd "$T/reg" && CLAUDE_SESSION_ID= bash "$PF" --no-fetch 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = GO ] \
   && [[ "$out" == *"ADR: no ADR directory in the profile"* ]] && [[ "$out" == *"migrations: no migrations journal in the profile"* ]] \
   && [[ "$out" == *"epics: 1, in progress 1"* ]] && [[ "$out" != *"no epic summary"* ]] && [[ "$out" == *"origin/main: "* ]]; then
    ok "registered, no numbering -> steps skipped aloud, GO exit 0"
else bad "registered no numbering: exit $rc, out: ${out:0:600}"; fi

# 4. The same project with --epic, its profile without tickets.epic_status: the epic is checked through
# the Harness's own epic-status, not BLOCKED.
out="$(cd "$T/reg" && CLAUDE_SESSION_ID= bash "$PF" --no-fetch --epic x 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = GO ] && [[ "$out" == *"epic: "*"x 0/1"* ]] \
    && ok "--epic without epic_status in the profile -> checked by the Harness's epic-status, GO" \
    || bad "--epic without epic_status: exit $rc, out: ${out:0:400}"

# 4a. An epic that does not exist: epic-status refuses, preflight BLOCKED with its reason, exit 1.
out="$(cd "$T/reg" && CLAUDE_SESSION_ID= bash "$PF" --no-fetch --epic nope 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$(printf '%s\n' "$out" | tail -1)" == "BLOCKED: epic-status nope: "* ]] \
    && ok "--epic of a missing epic -> BLOCKED by epic-status, exit 1" || bad "--epic missing epic: exit $rc, out: ${out:0:400}"

# 4b. A profile that still names an epic summary of its own (schema 1, a stale path) is not consulted.
printf '{"schema":1,"name":"t","worktree":{"base":"origin/main"},"numbering":{"adr":null,"migrations":null},"docs":{"adr_dir":null},"tickets":{"epic_status":"/nonexistent/epic-status"}}\n' \
    >"$T/profiles/t/profile.json"
out="$(cd "$T/reg" && CLAUDE_SESSION_ID= bash "$PF" --no-fetch --epic x 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = GO ] && [[ "$out" != *"/nonexistent/"* ]] \
    && ok "tickets.epic_status in the profile is ignored" || bad "stale epic_status: exit $rc, out: ${out:0:400}"

# 5. A broken profile (invalid JSON) — exit 2, not GO.
printf '{broken' >"$T/profiles/t/profile.json"
err="$(cd "$T/reg" && bash "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"profile unreadable"* ]] && ok "broken profile -> exit 2" || bad "broken profile: exit $rc, err: ${err:0:200}"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
