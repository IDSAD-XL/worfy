#!/usr/bin/env bash
# Tests of harness/bin/qmd-collections (worfy-harness ticket 17) on temporary directories: origin is
# a local bare repository, qmd is a stub that writes its arguments, HOME, CLAUDE_CONFIG_DIR and
# HARNESS_HOME are temporary. The real profile, qmd-sync-main and gate resolver next to this test run.
#   - Full mode: the copy of main is cloned; three collections with their paths and `update:` on the
#     plugin's qmd-sync-main; the names in the profile; qmd update ran, qmd embed did not (no consent);
#   - a second run: index.yml and the profile byte for byte the same;
#   - Silent mode: paths in the Workflow folder, no `update:`; with consent qmd embed starts;
#   - someone else's collection under one of the names: exit != 0, index.yml and the profile untouched;
#   - a profile like Auction's (collections already named): only `update:` changes, a copy next to it;
#   - the project's repository stays clean (`git status --porcelain` empty) in every case.
# Run: bash harness/bin/tests/qmd-collections.test.sh; exit code 0 — everything passed.
set -u
BIN="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$BIN/qmd-collections"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
gq() { git -c user.email=t@t -c user.name=t "$@"; }

# origin with the documents of a project, and the project's own checkout (the registry's match).
gq init -q --bare -b main "$T/origin.git"
gq clone -q "$T/origin.git" "$T/seed" 2>/dev/null
mkdir -p "$T/seed/docs/adr" "$T/seed/docs/lessons" "$T/seed/.scratch/e/issues"
echo "# 0043 qmd" >"$T/seed/docs/adr/0043-qmd.md"; echo ctx >"$T/seed/CONTEXT.md"; echo h >"$T/seed/HANDOFF.md"
echo l >"$T/seed/docs/lessons/a.md"; echo t >"$T/seed/.scratch/e/issues/01-t.md"
gq -C "$T/seed" add -A && gq -C "$T/seed" commit -q -m docs && gq -C "$T/seed" push -q origin HEAD:main 2>/dev/null
gq clone -q "$T/origin.git" "$T/proj" 2>/dev/null
mkdir -p "$T/proj2" && gq -C "$T/proj2" init -q -b main && gq -C "$T/proj2" commit -q --allow-empty -m one

mkdir -p "$T/fakebin"
cat >"$T/fakebin/qmd" <<EOF
#!/bin/sh
echo "\$1 emb=\${QMD_EMBED_MODEL:-unset}" >>"\$QMD_CALLS"
EOF
chmod +x "$T/fakebin/qmd"

# setup <case> <profile.json body without name/schema>: a fresh HOME, Claude home and Harness home.
setup() {
    C="$T/$1"; H="$C/home"; HH="$C/hh"; CL="$C/claude"
    mkdir -p "$H" "$HH/gate" "$HH/projects/x" "$HH/projects/y" "$CL"
    printf '{"repos":[{"key":"x","match":"%s","profile":"x"},{"key":"y","match":"%s","profile":"y"}]}\n' "$T/proj" "$T/proj2" >"$HH/gate/config.json"
    printf '{\n  "schema": 2,\n  "name": "%s",\n%s\n}\n' "$2" "$3" | jq . >"$HH/projects/$2/profile.json"
    INDEX="$H/.config/qmd/index.yml"
    PROFILE="$HH/projects/$2/profile.json"
    export QMD_CALLS="$C/qmd.calls"
}
collect() { # $1 = profile name
    HOME="$H" HARNESS_HOME="$HH" CLAUDE_CONFIG_DIR="$CL" PATH="$T/fakebin:$PATH" \
        node "$SCRIPT" "$1" >"$C/out" 2>&1
}
clean_repos() {
    [ -z "$(git -C "$T/proj" status --porcelain)" ] && [ -z "$(git -C "$T/proj2" status --porcelain)" ]
}
FULL='"mode": "full", "language": {"reports": "ru", "team": "en", "docs": "ru"}, "worktree": {"base": "origin/main"},
  "docs": {"adr_dir": "docs/adr", "context": {"path": "CONTEXT.md"}, "handoff": {"path": "HANDOFF.md"}},
  "lessons": "repo:docs/lessons", "tickets": {"root": ".scratch/"},
  "qmd": {"collections": [], "covers": "none yet", "fallback_grep": ["docs/adr"]}'

# --- Full mode --------------------------------------------------------------------------------
setup full x "$FULL"
before_rest="$(jq -S 'del(.qmd)' "$PROFILE")"
collect x; rc=$?
COPY="$H/.cache/qmd/x-main"
MEM="$CL/projects/$(printf '%s' "$T/proj" | sed 's/[^A-Za-z0-9]/-/g')/memory"
[ "$rc" -eq 0 ] && [ -d "$COPY/.git" ] && [ "$(git -C "$COPY" rev-parse HEAD)" = "$(git -C "$T/seed" rev-parse HEAD)" ] \
    && ok "full: the copy of main is cloned into ~/.cache/qmd/x-main" || bad "full: rc=$rc out=[$(cat "$C/out")]"
want="collections:
  x-docs:
    path: $COPY
    pattern: \"docs/adr/**/*.md,CONTEXT.md,HANDOFF.md,docs/lessons/**/*.md\"
    update: $BIN/qmd-sync-main x
  x-tickets:
    path: $COPY/.scratch
    pattern: \"**/*.md\"
    update: $BIN/qmd-sync-main x
  x-memory:
    path: $MEM
    pattern: \"**/*.md\"
"
[ "$(cat "$INDEX" 2>/dev/null)" = "$(printf '%s' "$want")" ] \
    && ok "full: three collections with their paths, update: on the plugin's qmd-sync-main" || bad "full: index.yml:
$(cat "$INDEX" 2>/dev/null)"
[ "$(jq -c '.qmd.collections' "$PROFILE")" = '["x-docs","x-tickets","x-memory"]' ] && [ "$(jq -S 'del(.qmd)' "$PROFILE")" = "$before_rest" ] \
    && [ "$(jq -c '.qmd.fallback_grep' "$PROFILE")" = '["docs/adr"]' ] && [[ "$(jq -r '.qmd.covers' "$PROFILE")" == *"x-docs: ADRs"* ]] \
    && ok "full: names and covers in the profile, nothing else in it changed" || bad "full: profile $(jq -c .qmd "$PROFILE")"
grep -qx "update emb=hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf" "$QMD_CALLS" 2>/dev/null && ! grep -q '^embed' "$QMD_CALLS" \
    && ok "full: qmd update ran with the embedding model of qmd-mcp, no qmd embed without consent" || bad "full: qmd calls [$(cat "$QMD_CALLS" 2>/dev/null)]"
# The update: command really pulls the copy: a new commit in origin reaches it.
echo "# 0050" >"$T/seed/docs/adr/0050-new.md"; gq -C "$T/seed" add -A && gq -C "$T/seed" commit -q -m new && gq -C "$T/seed" push -q origin HEAD:main 2>/dev/null
HOME="$H" HARNESS_HOME="$HH" zsh "$BIN/qmd-sync-main" x >/dev/null 2>&1
[ -f "$COPY/docs/adr/0050-new.md" ] && ok "full: the collection's update: command pulls the copy" || bad "full: qmd-sync-main x did not pull the copy"
clean_repos && ok "full: the project's repository is untouched" || bad "full: git status: $(git -C "$T/proj" status --porcelain)"

# --- a second run changes nothing -----------------------------------------------------------
cp "$INDEX" "$C/index.1"; cp "$PROFILE" "$C/profile.1"
n_before="$(ls "$H/.config/qmd" | wc -l)"
rm -f "$QMD_CALLS"
collect x; rc=$?
[ "$rc" -eq 0 ] && cmp -s "$INDEX" "$C/index.1" && cmp -s "$PROFILE" "$C/profile.1" && [ "$(ls "$H/.config/qmd" | wc -l)" = "$n_before" ] \
    && ok "second run: index.yml and the profile byte for byte the same, no new copy of index.yml" || bad "second run: rc=$rc out=[$(cat "$C/out")]"
clean_repos && ok "second run: the project's repository is untouched" || bad "second run: git status dirty"

# --- index.yml already has the three, the profile names none (a run stopped before the profile) ---
cp "$C/profile.1" "$C/profile.keep"
jq '.qmd.collections = [] | .qmd.covers = "none yet"' "$C/profile.keep" >"$PROFILE"
rm -f "$QMD_CALLS"
collect x; rc=$?
[ "$rc" -eq 0 ] && cmp -s "$INDEX" "$C/index.1" && cmp -s "$PROFILE" "$C/profile.1" && [ "$(ls "$H/.config/qmd" | wc -l)" = "$n_before" ] && [ ! -e "$QMD_CALLS" ] \
    && ok "collections already in index.yml: it stays byte for byte, no copy of it, the profile gets the names" || bad "already there: rc=$rc out=[$(cat "$C/out")]"

# --- Silent mode, with consent to the models -------------------------------------------------
WF="$T/workflow-y"; mkdir -p "$WF/docs/adr" "$WF/.scratch"
setup silent y '"mode": "silent", "language": {"reports": "ru", "team": "en"},
  "workflow": {"folder": "'"$WF"'"}, "docs": {"adr_dir": "docs/adr", "handoff": {"path": "'"$WF"'/HANDOFF.md"}},
  "lessons": "profile", "tickets": {"root": ".scratch/"}'
printf 'downloaded\n' >"$HH/qmd-models"
collect y; rc=$?
MEM2="$CL/projects/$(printf '%s' "$T/proj2" | sed 's/[^A-Za-z0-9]/-/g')/memory"
want="collections:
  y-docs:
    path: $WF
    pattern: \"docs/adr/**/*.md,HANDOFF.md\"
  y-tickets:
    path: $WF/.scratch
    pattern: \"**/*.md\"
  y-memory:
    path: $MEM2
    pattern: \"**/*.md\"
"
[ "$rc" -eq 0 ] && [ "$(cat "$INDEX" 2>/dev/null)" = "$(printf '%s' "$want")" ] && [ ! -e "$H/.cache/qmd/y-main" ] \
    && ok "silent: paths in the Workflow folder, no update:, no copy cloned" || bad "silent: rc=$rc out=[$(cat "$C/out")] index:
$(cat "$INDEX" 2>/dev/null)"
for _ in 1 2 3 4 5 6 7 8 9 10; do grep -q '^embed' "$QMD_CALLS" 2>/dev/null && break; sleep 0.5; done
grep -qx "embed emb=hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf" "$QMD_CALLS" 2>/dev/null \
    && ok "silent with consent: qmd embed in the background with the embedding model of qmd-mcp" || bad "silent: qmd calls [$(cat "$QMD_CALLS" 2>/dev/null)]"
clean_repos && ok "silent: the project's repository is untouched" || bad "silent: git status dirty"

# --- someone else's collection under one of the names ----------------------------------------
setup foreign x "$FULL"
mkdir -p "$H/.config/qmd"
printf 'collections:\n  x-tickets:\n    path: /somewhere/else\n    pattern: "**/*.md"\nmodels:\n  embed: e\n' >"$INDEX"
cp "$INDEX" "$C/index.0"; cp "$PROFILE" "$C/profile.0"
collect x; rc=$?
[ "$rc" -ne 0 ] && cmp -s "$INDEX" "$C/index.0" && cmp -s "$PROFILE" "$C/profile.0" && grep -q "someone else" "$C/out" \
    && [ "$(ls "$H/.config/qmd" | wc -l | tr -d ' ')" = 1 ] \
    && ok "foreign collection: exit $rc, index.yml and the profile unchanged" || bad "foreign: rc=$rc out=[$(cat "$C/out")]"
clean_repos && ok "foreign: the project's repository is untouched" || bad "foreign: git status dirty"

# --- a profile like Auction's: only update: moves to the plugin -------------------------------
setup auction x "$(printf '%s' "$FULL" | sed 's/"collections": \[\]/"collections": ["auction", "tickets", "memory"]/')"
mkdir -p "$H/.config/qmd" "$HH/plugin/bin"
: >"$HH/plugin/bin/qmd-sync-main"
cat >"$INDEX" <<EOF
collections:
  auction:
    path: $H/.cache/qmd/auction-main
    pattern: docs/**/*.md,HANDOFF.md,CONTEXT.md,CLAUDE.md
    update: /Users/someone/.claude/bin/qmd-sync-main x
  memory:
    path: /Users/someone/.claude/projects/-x/memory
    pattern: "**/*.md"
  other:
    path: /elsewhere
    update: /Users/someone/.claude/bin/qmd-sync-main other
  tickets:
    path: $H/.cache/qmd/auction-main/.scratch
    pattern: "**/*.md"
    update: /Users/someone/.claude/bin/qmd-sync-main x
models:
  embed: hf:e
EOF
cp "$INDEX" "$C/index.0"; cp "$PROFILE" "$C/profile.0"
collect x; rc=$?
expected="$(sed "s#update: /Users/someone/.claude/bin/qmd-sync-main x#update: $HH/plugin/bin/qmd-sync-main x#" "$C/index.0")"
copies=("$H/.config/qmd/index.yml."*)
[ "$rc" -eq 0 ] && [ "$(cat "$INDEX")" = "$expected" ] && [ "$(diff "$C/index.0" "$INDEX" | grep -c '^>')" = 2 ] \
    && ok "auction-like: only the two update: lines of this project point at the plugin's qmd-sync-main" || bad "auction-like: rc=$rc out=[$(cat "$C/out")] diff:
$(diff "$C/index.0" "$INDEX")"
[ "${#copies[@]}" = 1 ] && [ -f "${copies[0]}" ] && cmp -s "${copies[0]}" "$C/index.0" && [[ "${copies[0]}" == *index.yml.20* ]] \
    && ok "auction-like: a dated copy of the old index.yml next to it" || bad "auction-like: copies [${copies[*]}]"
cmp -s "$PROFILE" "$C/profile.0" && [ ! -e "$H/.cache/qmd/x-main" ] && [ ! -e "$QMD_CALLS" ] \
    && ok "auction-like: the profile unchanged, no new collections, no copy cloned, no qmd run" || bad "auction-like: profile or copy changed"
clean_repos && ok "auction-like: the project's repository is untouched" || bad "auction-like: git status dirty"

# --- usage ------------------------------------------------------------------------------------
node "$SCRIPT" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "no project name: exit 2" || bad "no project name: exit $rc"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
