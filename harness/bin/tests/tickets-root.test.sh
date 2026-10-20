#!/usr/bin/env bash
# Tests of the tickets root in harness/bin/ticket and harness/bin/epic-status: the profile's tickets.root
# field, the --root flag and the old behaviour outside the registry (<git top-level>/.scratch).
# Run: bash harness/bin/tests/tickets-root.test.sh; exit code 0 — everything passed.
#
# The registry and profiles are temporary (CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR); the live registry is not read.
set -u
# The scripts under test are the copies next to this test (harness/).
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"   # BIN_DIR — run the test against another copy of the tools
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
TICKET="$BIN/ticket"
STATUS="$BIN/epic-status"
export CLAUDE_TICKET_BIN="$TICKET"
export CLAUDE_PROFILE_BIN="$BIN/profile"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
# T in node's spelling (C:/… in Git Bash on Windows, pwd -P elsewhere): it goes into the registry and profiles.
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
# A path as ticket and epic-status print it: with backslashes on Windows (cygpath exists there), unchanged elsewhere.
printed() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }
trap 'rm -rf "$T"' EXIT
. "$(dirname "$0")/real-home.sh"
home_before="$(real_home_snapshot "$HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/profiles"
WS="$T/ws"            # a common directory, like ~/work/suite: not git itself
mkdir -p "$WS/Repo-A/src" "$WS/Repo-B" "$T/rel" "$T/unreg" "$CLAUDE_PROFILES_DIR/multi" "$CLAUDE_PROFILES_DIR/rel"
for r in "$WS/Repo-A" "$WS/Repo-B" "$T/rel" "$T/unreg"; do
    git -C "$r" init -q -b main && git -C "$r" commit -q --allow-empty -m init
done
cat >"$CLAUDE_GATE_CONFIG" <<EOF
{"repos":[
 {"key":"A","match":"$WS/Repo-A","profile":"multi","pm":"npm","root":{},"workspace":{}},
 {"key":"B","match":"$WS/Repo-B","profile":"multi","pm":"npm","root":{},"workspace":{}},
 {"key":"rel","match":"$T/rel","profile":"rel","pm":"npm","root":{},"workspace":{}}
]}
EOF
printf '{"schema":1,"name":"multi","tickets":{"root":"%s/.scratch/"}}\n' "$WS" >"$CLAUDE_PROFILES_DIR/multi/profile.json"
printf '{"schema":1,"name":"rel","tickets":{"root":".scratch/"}}\n' >"$CLAUDE_PROFILES_DIR/rel/profile.json"
: >"$CLAUDE_PROFILES_DIR/multi/rules.md"; : >"$CLAUDE_PROFILES_DIR/rel/rules.md"

mk() { # <tickets root> <epic> <NN-slug> <Status>
    mkdir -p "$1/$2/issues"
    printf '# %s — title\n\nStatus: %s\nBlocked by: none\n' "${3%%-*}" "$4" >"$1/$2/issues/$3.md"
}
mk "$WS/.scratch" ep 01-first open
mk "$WS/.scratch" ep 02-second done
mk "$WS/Repo-A/.scratch" ep 01-decoy claimed   # decoy: git top-level/.scratch, the old root

# 1. From inside a profile repository with an absolute tickets.root — the root is in the common directory.
got="$(cd "$WS/Repo-A/src" && "$TICKET" root 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "$(printed "$WS/.scratch")" ] && ok "ticket root inside repo -> workspace .scratch" || bad "ticket root: exit $rc, got: $got"
got="$(cd "$WS/Repo-A/src" && "$TICKET" show ep 01 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "01-first.md:3  Status: open" ] && ok "ticket show inside repo reads workspace ticket" || bad "ticket show: exit $rc, got: $got"
got="$(cd "$WS/Repo-B" && "$TICKET" claim ep/01 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && grep -q '^Status: claimed 20' "$WS/.scratch/ep/issues/01-first.md" \
   && grep -q '^Status: claimed$' "$WS/Repo-A/.scratch/ep/issues/01-decoy.md" && [[ "$got" == ".scratch/ep/issues/01-first.md:3"* ]]; then
    ok "ticket claim from second repo writes the workspace file only"
else bad "ticket claim: exit $rc, got: $got"; fi
"$TICKET" open ep 01 --root "$WS/.scratch" >/dev/null 2>&1

# 2. epic-status from inside a repository — the same root, without the repository's branch in the line.
got="$(cd "$WS/Repo-A" && "$STATUS" ep 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "/implement · ep 1/2 · ticket 01 — title" ] && ok "epic-status inside repo -> workspace epic, no branch" || bad "epic-status ep: exit $rc, got: $got"
got="$(cd "$WS/Repo-A" && "$STATUS" --json 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s' "$got" | jq -r '[.tickets[].slug]|join(",")')" = "first,second" ] && ok "epic-status --json inside repo -> workspace tickets" || bad "epic-status --json: exit $rc, got: ${got:0:200}"
got="$(cd "$WS" && "$STATUS" ep 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "/implement · ep 1/2 · ticket 01 — title" ] && ok "epic-status from workspace root" || bad "epic-status from ws: exit $rc, got: $got"

# 3. --json --ref with a root outside git: refusal with exit 3 and words, not an empty answer.
out="$(cd "$WS/Repo-A" && "$STATUS" --json --ref main 2>"$T/err")"; rc=$?
[ "$rc" -eq 3 ] && [ -z "$out" ] && grep -q 'not in a git repository' "$T/err" && ok "--json --ref with non-git root -> exit 3 + reason" || bad "--ref non-git: exit $rc, out: ${out:0:100}, err: $(head -c 200 "$T/err")"

# 4. --root overrides the profile.
got="$(cd "$WS/Repo-A" && "$TICKET" show ep 01 --root .scratch 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "01-decoy.md:3  Status: claimed" ] && ok "ticket --root overrides profile" || bad "ticket --root: exit $rc, got: $got"
got="$(cd "$WS/Repo-A" && "$STATUS" --root "$WS/Repo-A/.scratch" ep 2>&1)"; rc=$?
[[ "$rc" -eq 0 && "$got" == "/implement · ep 0/1 · main · ticket 01"* ]] && ok "epic-status --root overrides profile" || bad "epic-status --root: exit $rc, got: $got"

got="$(cd "$WS/Repo-A" && "$STATUS" ep --root "$WS/Repo-A/.scratch" 2>&1)"; rc=$?
[[ "$rc" -eq 0 && "$got" == "/implement · ep 0/1 · main · ticket 01"* ]] && ok "epic-status <epic> --root (flag after epic)" || bad "epic-status ep --root: exit $rc, got: $got"
# MSYS: a real symlink in Git Bash on Windows (its plain ln -s copies the directory); ignored elsewhere.
MSYS=winsymlinks:nativestrict ln -s "$WS/Repo-A/src" "$T/link"
a="$(cd "$T/link" && "$TICKET" root --root ../.scratch 2>&1)"; b="$(cd "$T/link" && "$TICKET" show ep 01 --root ../.scratch 2>&1)"
[ "$a" = "$(printed "$WS/Repo-A/.scratch")" ] && [ "$b" = "01-decoy.md:3  Status: claimed" ] && ok "relative --root through a symlink: root and show agree" || bad "symlink --root: root=$a show=$b"

# 5. A relative tickets.root is taken from the current tree's root; a worktree has its own, and --ref reads the branch.
mk "$T/rel/.scratch" ep 01-main open
git -C "$T/rel" add .scratch && git -C "$T/rel" commit -q -m tickets
git -C "$T/rel" worktree add -q -b feat "$T/rel-wt" 2>/dev/null
mk "$T/rel-wt/.scratch" ep 02-branch open
git -C "$T/rel-wt" add .scratch && git -C "$T/rel-wt" commit -q -m more
got="$(cd "$T/rel-wt" && "$TICKET" root 2>&1)"
[ "$got" = "$(printed "$T/rel-wt/.scratch")" ] && ok "relative root in worktree -> worktree .scratch" || bad "relative root wt: $got"
got="$(cd "$T/rel" && "$STATUS" --json --ref feat 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(printf '%s' "$got" | jq -r '[.tickets[].slug]|join(",")')" = "main,branch" ] && ok "--json --ref reads branch tickets (git root)" || bad "--ref git: exit $rc, got: ${got:0:200}"
got="$(cd "$T/rel" && "$STATUS" --json --ref no-such 2>&1)"; rc=$?
[ "$rc" -eq 3 ] && ok "--json --ref unknown ref -> exit 3 (unchanged)" || bad "--ref unknown: exit $rc"

# 6. Outside the registry — as before: <git top-level>/.scratch, and "outside tickets" without the directory.
mkdir -p "$T/unreg/sub"
got="$(cd "$T/unreg/sub" && "$TICKET" root 2>&1)"
[ "$got" = "$(printed "$T/unreg/.scratch")" ] && ok "unregistered -> git top-level/.scratch" || bad "unregistered root: $got"
got="$(cd "$T/unreg/sub" && "$STATUS" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ "$got" = "outside tickets (no $(printed "$T/unreg/.scratch"))" ] && ok "unregistered epic-status unchanged" || bad "unregistered status: exit $rc, got: $got"

# 6a. Silent mode: a relative tickets.root — and no tickets.root at all — is taken
# from the Workflow folder, the same from the repository, its worktree and the folder itself.
mkdir -p "$T/silent" "$T/silent2" "$T/wfs" "$T/wfs2" "$CLAUDE_PROFILES_DIR/sil" "$CLAUDE_PROFILES_DIR/sil2"
for r in silent silent2; do git -C "$T/$r" init -q -b main && git -C "$T/$r" commit -q --allow-empty -m init; done
git -C "$T/silent" worktree add -q -b fix/a "$T/silent-wt" 2>/dev/null
jq --arg a "$T/silent" --arg b "$T/silent2" '.repos += [{key: "sil", match: $a, profile: "sil"}, {key: "sil2", match: $b, profile: "sil2"}]' "$CLAUDE_GATE_CONFIG" >"$T/c.json" && mv "$T/c.json" "$CLAUDE_GATE_CONFIG"
printf '{"schema":2,"name":"sil","mode":"silent","workflow":{"folder":"%s"},"tickets":{"root":"tickets/"}}\n' "$T/wfs" >"$CLAUDE_PROFILES_DIR/sil/profile.json"
printf '{"schema":2,"name":"sil2","mode":"silent","workflow":{"folder":"%s"}}\n' "$T/wfs2" >"$CLAUDE_PROFILES_DIR/sil2/profile.json"
mk "$T/wfs/tickets" ep 01-silent open
for d in "$T/silent" "$T/silent-wt"; do
    got="$(cd "$d" && "$TICKET" root 2>&1)"
    [ "$got" = "$(printed "$T/wfs/tickets")" ] && ok "silent: relative tickets.root from ${d##*/} -> the Workflow folder" || bad "silent root from $d: $got"
done
got="$(cd "$T/silent2" && "$TICKET" root 2>&1)"
[ "$got" = "$(printed "$T/wfs2/.scratch")" ] && ok "silent: no tickets.root -> <Workflow folder>/.scratch" || bad "silent default root: $got"
got="$(cd "$T/silent-wt" && "$STATUS" ep 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [[ "$got" == "/to-tickets · ep 0/1 · ticket 01"* ]] && ok "silent: epic-status from a worktree reads the Workflow folder" || bad "silent epic-status: exit $rc, got: $got"

# 7. A broken registry — refusal, not a silent fallback to git top-level.
printf '{broken' >"$CLAUDE_GATE_CONFIG"
got="$(cd "$WS/Repo-A" && "$TICKET" show ep 01 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$got" == *"--root"* ]] && ok "broken registry -> ticket exit 1, names --root" || bad "broken registry: exit $rc, got: $got"

# 8. No node on PATH. epic-status is a Node script: started by its
# #! line with no node on PATH it does not start at all — a non-zero exit, nothing on stdout, node named
# on stderr — in each of its forms, --root included. It never answers from <git top-level>/.scratch:
# for a Silent project that answer is an empty list. PATH is a folder of links to the tools a shell
# needs here, without node: PATH=/usr/bin:/bin would not do, node may live in /usr/bin.
NN="$T/no-node-bin"; mkdir -p "$NN"
for t in bash git awk sed tr xargs realpath dirname head mktemp rm printf cat; do
    p="$(command -v "$t" 2>/dev/null)" && [ "${p#/}" != "$p" ] && ln -sf "$p" "$NN/$t"
done
mkdir -p "$T/nonode"; git -C "$T/nonode" init -q -b main && git -C "$T/nonode" commit -q --allow-empty -m init
mk "$T/nonode/.scratch" nn 01-only open
if PATH="$NN" command -v node >/dev/null 2>&1; then bad "no-node PATH has node: $(PATH="$NN" command -v node)"; else
    for form in "--json" "" "--json --ref main" "--json --root .scratch"; do
        # shellcheck disable=SC2086 # the form is split on purpose
        out="$(cd "$T/nonode" && PATH="$NN" "$STATUS" $form 2>"$T/nn-err")"; rc=$?
        if [ "$rc" -ne 0 ] && [ -z "$out" ] && grep -q 'node' "$T/nn-err"; then
            ok "no node: epic-status ${form:-(line)} -> exit $rc, nothing on stdout, names node"
        else bad "no node: epic-status ${form:-(line)}: exit $rc, out: ${out:0:200}, err: $(head -c 300 "$T/nn-err")"; fi
    done
fi

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
