#!/usr/bin/env bash
# Tests of harness/bin/preflight outside Auction. Run: bash harness/bin/tests/preflight.test.sh;
# exit code 0 — everything passed.
#
# The registry and profiles are temporary (CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR, bin/profile understands them),
# and so are HOME, HARNESS_HOME and CLAUDE_CONFIG_DIR: the lock step (worktree-lock) writes under HARNESS_HOME,
# which used to be the real ~/.claude/worfy-harness. The real one is compared with a snapshot at the end.
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
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; the registry's "match"
# and the profiles' paths must be in it. TP is the same folder for PATH, where C:/… cannot stand.
T="$(mktemp -d)"; TP="$(cd "$T" && pwd -P)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
. "$(dirname "$0")/real-home.sh"
REAL_HOME="$HOME"
home_before="$(real_home_snapshot "$REAL_HOME" "$T")"
export HOME="$T/home" HARNESS_HOME="$T/hh" CLAUDE_CONFIG_DIR="$T/claude-config"
mkdir -p "$HOME" "$HARNESS_HOME" "$CLAUDE_CONFIG_DIR"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
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

# 4c. Repositories whose main branch is master, in a profile with worktree.base null (Atakama):
# the base is not guessed as origin/main. ext — a clone, origin/HEAD -> origin/master; srv — no
# origin/HEAD, layout.repos.srv.default_branch is master; bare — neither, so origin/main as before.
mkdir -p "$T/m" "$T/profiles/m"
for r in ext srv bare; do
    git init -q --bare -b master "$T/m/$r.git"
    git -C "$T/m" init -q -b master "seed-$r" && git -C "$T/m/seed-$r" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
    git -C "$T/m/seed-$r" push -q "$T/m/$r.git" master 2>/dev/null
done
git clone -q "$T/m/ext.git" "$T/m/ext" 2>/dev/null
for r in srv bare; do
    git -C "$T/m" init -q -b master "$r" && git -C "$T/m/$r" remote add origin "$T/m/$r.git" && git -C "$T/m/$r" fetch -q origin
    git -C "$T/m/$r" reset -q --hard origin/master
    # git 2.48+ sets origin/HEAD on fetch; these two must have none.
    git -C "$T/m/$r" remote set-head origin -d >/dev/null 2>&1
    git -C "$T/m/$r" config remote.origin.followRemoteHEAD never
done
printf '{"schema":1,"name":"m","worktree":{"base":null},"layout":{"repos":{"srv":{"default_branch":"master"}}},"numbering":{"adr":null,"migrations":null},"docs":{"adr_dir":null}}\n' \
    >"$T/profiles/m/profile.json"
printf '{"repos":[{"key":"ext","match":"%s","profile":"m"},{"key":"srv","match":"%s","profile":"m"},{"key":"bare","match":"%s","profile":"m"}]}\n' \
    "$T/m/ext" "$T/m/srv" "$T/m/bare" >"$T/m.json"
for r in ext srv; do
    out="$(cd "$T/m/$r" && CLAUDE_GATE_CONFIG="$T/m.json" CLAUDE_SESSION_ID= bash "$PF" --no-fetch 2>&1)"; rc=$?
    [ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = GO ] && [[ "$out" == *"origin/master: "* ]] \
        && ok "worktree.base null, main branch master ($r) -> base origin/master, GO" \
        || bad "master base ($r): exit $rc, out: ${out:0:500}"
done
out="$(cd "$T/m/bare" && CLAUDE_GATE_CONFIG="$T/m.json" CLAUDE_SESSION_ID= bash "$PF" --no-fetch 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$(printf '%s\n' "$out" | tail -1)" == "BLOCKED: "*"no ref origin/main"* ]] \
    && ok "worktree.base null, no origin/HEAD, no layout.repos -> origin/main (BLOCKED here)" \
    || bad "no hint for the base: exit $rc, out: ${out:0:500}"

# 4d. Silent mode (worfy-harness ticket 22): the ADR numbers are counted from the files of the ADR directory in
# the Workflow folder, not from git ls-tree of branches; a duplicate number there is BLOCKED, exit 1.
mkdir -p "$T/wf/docs/adr" "$T/profiles/s"
printf '{"schema":2,"name":"s","mode":"silent","workflow":{"folder":"%s"},"worktree":{"base":"origin/main"},"numbering":{"adr":{"dir":"docs/adr","check":null},"migrations":null}}\n' "$T/wf" \
    >"$T/profiles/s/profile.json"
: >"$T/profiles/s/rules.md"
printf '{"repos":[{"key":"s","match":"%s","profile":"s","pm":"npm"}]}\n' "$T/reg" >"$T/s.json"
touch "$T/wf/docs/adr/0001-a.md" "$T/wf/docs/adr/0007-b.md"
mkdir -p "$T/reg/docs/adr" && touch "$T/reg/docs/adr/0042-in-repo.md"   # a decoy: Silent mode does not count the repository
out="$(cd "$T/reg" && CLAUDE_GATE_CONFIG="$T/s.json" CLAUDE_SESSION_ID= bash "$PF" --no-fetch 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = GO ] && [[ "$out" == *"ADR: Silent mode, highest 0007 in the Workflow folder ($T/wf/docs/adr) → next free 0008"* ]] \
    && ok "silent: ADR numbers from the Workflow folder -> next free 0008, GO" || bad "silent ADR: exit $rc, out: ${out:0:600}"
touch "$T/wf/docs/adr/0007-c.md"
out="$(cd "$T/reg" && CLAUDE_GATE_CONFIG="$T/s.json" CLAUDE_SESSION_ID= bash "$PF" --no-fetch 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$(printf '%s\n' "$out" | tail -1)" == "BLOCKED: duplicate ADR 0007 in the Workflow folder"* ]] \
    && ok "silent: a duplicate ADR number in the Workflow folder -> BLOCKED, exit 1" || bad "silent ADR dup: exit $rc, out: ${out:0:600}"
rm -rf "$T/reg/docs"

# 5. A broken profile (invalid JSON) — exit 2, not GO.
printf '{broken' >"$T/profiles/t/profile.json"
err="$(cd "$T/reg" && bash "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"profile unreadable"* ]] && ok "broken profile -> exit 2" || bad "broken profile: exit $rc, err: ${err:0:200}"

home_after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" \
    || bad "the real home changed: $(diff <(printf '%s\n' "$home_before") <(printf '%s\n' "$home_after") | head -5)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
