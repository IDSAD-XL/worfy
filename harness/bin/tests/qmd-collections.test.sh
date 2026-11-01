#!/usr/bin/env bash
# Tests of harness/bin/qmd-collections on temporary directories: origin is
# a local bare repository, qmd is a Node stand-in that writes its arguments, HOME, CLAUDE_CONFIG_DIR and
# HARNESS_HOME are temporary. The real profile, qmd-sync-main and gate resolver next to this test run.
#   - Full mode: the copy of main is cloned; three collections with their paths and `update:` on the
#     plugin's qmd-sync-main; the names in the profile; qmd update ran, qmd embed did not (no consent);
#     the `update:` line pulls the copy under `bash -c`, the way qmd runs it;
#   - a second run: index.yml and the profile byte for byte the same;
#   - Silent mode: paths in the Workflow folder, no `update:`; with consent qmd embed starts;
#   - someone else's collection under one of the names: exit != 0, index.yml and the profile untouched;
#   - a profile like acme's (collections already named): only `update:` changes, a copy next to it;
#   - what runs a file: a text file without a #! line is not run by node, a binary starts as it is;
#   - the project's repository stays clean (`git status --porcelain` empty) in every case.
# Run: bash harness/bin/tests/qmd-collections.test.sh; exit code 0 — everything passed.
set -u
unset QMD_INDEX_YML QMD_CONFIG_DIR XDG_CONFIG_HOME XDG_CACHE_HOME # the folders of qmd are always under the temporary HOME
shopt -u patsub_replacement 2>/dev/null # the backslashes of a Windows path stay as they are in ${x//a/b}
BIN="$(cd "$(dirname "$0")/.." && pwd)"
BINF="$(cd "$BIN" && { pwd -W 2>/dev/null || pwd -P; })" # C:/… on Windows: the form the `update:` line has
SCRIPT="$BIN/qmd-collections"
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })" # C:/… on Windows: node reads the registry's paths
# A folder as PATH takes it: /c/… in Git Bash, where the colon of C:/… splits the entry; unchanged elsewhere.
onpath() { cygpath -u "$1" 2>/dev/null || printf '%s' "$1"; }
# A path as the script prints it: with backslashes on Windows (cygpath exists there), unchanged elsewhere.
printed() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
. "$(dirname "$0")/no-real-qmd.sh"
# A path as index.yml holds it: on Windows with backslashes, which make it a quoted JSON string; plain elsewhere.
yp() { if [ "$WIN" = 1 ]; then printf '"%s"' "$(printed "$1" | sed 's/\\/\\\\/g')"; else printf '%s' "$1"; fi; }
# No line of index.yml gives a path with both separators.
no_mixed_paths() { [ -z "$(grep -E '^ +path:' "$INDEX" | grep '/' | grep '\\')" ]; }
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
cat >"$T/fakebin/qmd" <<'EOF'
#!/usr/bin/env node
require("fs").appendFileSync(process.env.QMD_CALLS, process.argv[2] + " emb=" + (process.env.QMD_EMBED_MODEL || "unset") + "\n")
EOF
chmod +x "$T/fakebin/qmd"
# A process that writes its pid to $1 and runs until the file $1.go appears, at most 60 s: what the shell knows as
# $! is another process on Windows.
cat >"$T/holder" <<'EOF'
const fs = require("fs"), sleeper = new Int32Array(new SharedArrayBuffer(4))
fs.writeFileSync(process.argv[2], String(process.pid))
for (let n = 0; n < 600 && !fs.existsSync(process.argv[3]); n++) Atomics.wait(sleeper, 0, 0, 100)
EOF

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
    HOME="$H" HARNESS_HOME="$HH" CLAUDE_CONFIG_DIR="$CL" PATH="$(onpath "$T/fakebin"):$PATH" \
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
    path: $(yp "$COPY")
    pattern: \"docs/adr/**/*.md,CONTEXT.md,HANDOFF.md,docs/lessons/**/*.md\"
    update: \"node \\\"$BINF/qmd-sync-main\\\" x\"
  x-tickets:
    path: $(yp "$COPY/.scratch")
    pattern: \"**/*.md\"
    update: \"node \\\"$BINF/qmd-sync-main\\\" x\"
  x-memory:
    path: $(yp "$MEM")
    pattern: \"**/*.md\"
"
[ "$(cat "$INDEX" 2>/dev/null)" = "$(printf '%s' "$want")" ] \
    && ok "full: three collections with their paths, update: on the plugin's qmd-sync-main" || bad "full: index.yml:
$(cat "$INDEX" 2>/dev/null)"
no_mixed_paths && ok "full: no path in index.yml mixes / and \\" || bad "full: paths with both separators: $(grep -E '^ +path:' "$INDEX")"
[ "$(jq -c '.qmd.collections' "$PROFILE")" = '["x-docs","x-tickets","x-memory"]' ] && [ "$(jq -S 'del(.qmd)' "$PROFILE")" = "$before_rest" ] \
    && [ "$(jq -c '.qmd.fallback_grep' "$PROFILE")" = '["docs/adr"]' ] && [[ "$(jq -r '.qmd.covers' "$PROFILE")" == *"x-docs: ADRs"* ]] \
    && ok "full: names and covers in the profile, nothing else in it changed" || bad "full: profile $(jq -c .qmd "$PROFILE")"
grep -qx "update emb=hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf" "$QMD_CALLS" 2>/dev/null && ! grep -q '^embed' "$QMD_CALLS" \
    && ok "full: qmd update ran with the embedding model of qmd-mcp, no qmd embed without consent" || bad "full: qmd calls [$(cat "$QMD_CALLS" 2>/dev/null)]"
# The update: line really pulls the copy, run the way qmd runs it (`bash -c <line>`): a new commit in origin reaches it.
echo "# 0050" >"$T/seed/docs/adr/0050-new.md"; gq -C "$T/seed" add -A && gq -C "$T/seed" commit -q -m new && gq -C "$T/seed" push -q origin HEAD:main 2>/dev/null
update_line="$(sed -n 's/^    update: //p' "$INDEX" | head -n 1 | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8"))')"
HOME="$H" HARNESS_HOME="$HH" bash -c "$update_line" >/dev/null 2>"$C/update.err"; rc=$?
[ "$rc" -eq 0 ] && [ -f "$COPY/docs/adr/0050-new.md" ] && ok "full: the update: line under bash -c pulls the copy" \
    || bad "full: the update: line [$update_line]: rc=$rc err=[$(cat "$C/update.err")]"
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
    path: $(yp "$WF")
    pattern: \"docs/adr/**/*.md,HANDOFF.md\"
  y-tickets:
    path: $(yp "$WF/.scratch")
    pattern: \"**/*.md\"
  y-memory:
    path: $(yp "$MEM2")
    pattern: \"**/*.md\"
"
[ "$rc" -eq 0 ] && [ "$(cat "$INDEX" 2>/dev/null)" = "$(printf '%s' "$want")" ] && [ ! -e "$H/.cache/qmd/y-main" ] \
    && ok "silent: paths in the Workflow folder, no update:, no copy cloned" || bad "silent: rc=$rc out=[$(cat "$C/out")] index:
$(cat "$INDEX" 2>/dev/null)"
no_mixed_paths && ok "silent: no path in index.yml mixes / and \\" || bad "silent: paths with both separators: $(grep -E '^ +path:' "$INDEX")"
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

# --- a profile like acme's: only update: moves to the plugin -------------------------------
setup acme x "$(printf '%s' "$FULL" | sed 's/"collections": \[\]/"collections": ["acme", "tickets", "memory"]/')"
mkdir -p "$H/.config/qmd" "$HH/plugin/bin"
: >"$HH/plugin/bin/qmd-sync-main"
cat >"$INDEX" <<EOF
collections:
  acme:
    path: $H/.cache/qmd/acme-main
    pattern: docs/**/*.md,HANDOFF.md,CONTEXT.md,CLAUDE.md
    update: /home/someone/.claude/bin/qmd-sync-main x
  memory:
    path: /home/someone/.claude/projects/-x/memory
    pattern: "**/*.md"
  other:
    path: /elsewhere
    update: /home/someone/.claude/bin/qmd-sync-main other
  tickets:
    path: $H/.cache/qmd/acme-main/.scratch
    pattern: "**/*.md"
    update: /home/someone/.claude/bin/qmd-sync-main x
models:
  embed: hf:e
EOF
cp "$INDEX" "$C/index.0"; cp "$PROFILE" "$C/profile.0"
collect x; rc=$?
expected="$(sed "s#update: /home/someone/.claude/bin/qmd-sync-main x#update: \"node \\\\\"$HH/plugin/bin/qmd-sync-main\\\\\" x\"#" "$C/index.0")"
copies=("$H/.config/qmd/index.yml."*)
[ "$rc" -eq 0 ] && [ "$(cat "$INDEX")" = "$expected" ] && [ "$(diff "$C/index.0" "$INDEX" | grep -c '^>')" = 2 ] \
    && ok "already-named: only the two update: lines of this project point at the plugin's qmd-sync-main" || bad "already-named: rc=$rc out=[$(cat "$C/out")] diff:
$(diff "$C/index.0" "$INDEX")"
[ "${#copies[@]}" = 1 ] && [ -f "${copies[0]}" ] && cmp -s "${copies[0]}" "$C/index.0" && [[ "${copies[0]}" == *index.yml.20* ]] \
    && ok "already-named: a dated copy of the old index.yml next to it" || bad "already-named: copies [${copies[*]}]"
cmp -s "$PROFILE" "$C/profile.0" && [ ! -e "$H/.cache/qmd/x-main" ] && [ ! -e "$QMD_CALLS" ] \
    && ok "already-named: the profile unchanged, no new collections, no copy cloned, no qmd run" || bad "already-named: profile or copy changed"
clean_repos && ok "already-named: the project's repository is untouched" || bad "already-named: git status dirty"

# --- refresh.lock left by a killed holder ----------------------------
# worfy kills qmd-collections with its process group at a time limit or on quit; the lock it held stays. qmd-mcp
# drops such a lock only when it starts, so qmd-collections looks at the holder itself: a pid that is not running,
# or no pid after two minutes, is an abandoned lock and is taken; a running holder is waited for.
setup lockdead x "$FULL"
LK="$H/.cache/qmd/refresh.lock"; mkdir -p "$LK"
node -p process.pid >"$LK/pid" # a process that has ended
start=$(date +%s); collect x; rc=$?; took=$(( $(date +%s) - start ))
[ "$rc" -eq 0 ] && [ "$took" -lt 20 ] && grep -q '^update ' "$QMD_CALLS" 2>/dev/null && [ ! -e "$LK" ] \
    && [ -z "$(ls -d "$LK".abandoned-* 2>/dev/null)" ] \
    && ok "refresh.lock of a pid that is not running: moved aside and deleted, qmd update ran, the lock released" \
    || bad "dead holder: rc=$rc took=${took}s calls [$(cat "$QMD_CALLS" 2>/dev/null)] out=[$(cat "$C/out")]"
setup lockold x "$FULL"
LK="$H/.cache/qmd/refresh.lock"; mkdir -p "$LK"; touch -t 202601010000 "$LK"
start=$(date +%s); collect x; rc=$?; took=$(( $(date +%s) - start ))
[ "$rc" -eq 0 ] && [ "$took" -lt 20 ] && grep -q '^update ' "$QMD_CALLS" 2>/dev/null && [ ! -e "$LK" ] \
    && [ -z "$(ls -d "$LK".abandoned-* 2>/dev/null)" ] \
    && ok "refresh.lock without a pid, older than two minutes: moved aside and deleted, qmd update ran" \
    || bad "old lock without pid: rc=$rc took=${took}s out=[$(cat "$C/out")]"
for holder in live young; do
    setup "lock$holder" x "$FULL"
    LK="$H/.cache/qmd/refresh.lock"; mkdir -p "$LK"
    if [ "$holder" = live ]; then
        node "$T/holder" "$LK/pid" "$C/holder.go" &
        for _ in $(seq 1 100); do [ -s "$LK/pid" ] && break; sleep 0.1; done
    fi
    collect x & cp_pid=$!
    for _ in $(seq 1 30); do grep -q "added to" "$C/out" 2>/dev/null && break; sleep 0.2; done
    sleep 2
    waiting=no; kill -0 "$cp_pid" 2>/dev/null && [ ! -e "$QMD_CALLS" ] && [ -d "$LK" ] && waiting=yes
    : >"$C/holder.go"; rm -rf "$LK"
    wait "$cp_pid"; rc=$?
    [ "$waiting" = yes ] && [ "$rc" -eq 0 ] && grep -q '^update ' "$QMD_CALLS" 2>/dev/null \
        && ok "refresh.lock of a $holder holder: waited for, then taken once it was released" \
        || bad "$holder holder: waiting=$waiting rc=$rc out=[$(cat "$C/out")]"
done
# qmd-refresh without --wait leaves the update to a background process. The pid in the lock must be that
# process's, not the pid of the qmd-refresh that has already exited: a dead pid reads as an abandoned lock.
setup lockrefresh x "$FULL"
mkdir -p "$H/.cache/qmd" "$C/slowbin" "$C/mem"; LK="$H/.cache/qmd/refresh.lock"
printf '#!/usr/bin/env node\nif (process.argv[2] === "update") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 8000)\n' >"$C/slowbin/qmd"; chmod +x "$C/slowbin/qmd"
printf 'collections:\n  mem:\n    path: %s\n' "$C/mem" >"$C/refresh.yml"
HOME="$H" HARNESS_HOME="$HH" PATH="$(onpath "$C/slowbin"):$PATH" QMD_INDEX_YML="$C/refresh.yml" \
    node "$BIN/qmd-refresh" --force --quiet; rc_refresh=$?
sleep 1
collect x & cp_pid=$!
for _ in $(seq 1 30); do grep -q "added to" "$C/out" 2>/dev/null && break; sleep 0.2; done
sleep 2
waiting=no; kill -0 "$cp_pid" 2>/dev/null && [ ! -e "$QMD_CALLS" ] && [ -d "$LK" ] && waiting=yes
wait "$cp_pid"; rc=$?
[ "$rc_refresh" -eq 0 ] && [ "$waiting" = yes ] && [ "$rc" -eq 0 ] && grep -q '^update ' "$QMD_CALLS" 2>/dev/null && [ ! -e "$LK" ] \
    && ok "a background qmd-refresh holds refresh.lock: qmd-collections waits for it, then runs qmd update" \
    || bad "background qmd-refresh: refresh rc=$rc_refresh waiting=$waiting rc=$rc out=[$(cat "$C/out")]"
# worfy ends a running Harness script on its exit with SIGTERM to the script's process group. qmd-collections then
# lets go of refresh.lock, so the next qmd-refresh or qmd-collections is not kept waiting for a holder that is gone.
# Not on Windows: worfy ends a script there with taskkill /T /F, no signal reaches it, and the abandoned-lock cases
# above cover the lock it leaves.
[ "$WIN" = 1 ] && echo "skip the signal cases: Windows has no process-group signals, worfy uses taskkill /F there"
for sig in $([ "$WIN" = 1 ] || echo TERM INT HUP); do
    setup "lock$sig" x "$FULL"
    mkdir -p "$C/slowbin"; LK="$H/.cache/qmd/refresh.lock"
    printf '#!/bin/sh\n[ "$1" = update ] && { echo update >>"%s"; sleep 30; }\nexit 0\n' "$C/updating" >"$C/slowbin/qmd"
    chmod +x "$C/slowbin/qmd"
    set -m   # the run gets its own process group, as worfy starts it
    ( HOME="$H" HARNESS_HOME="$HH" CLAUDE_CONFIG_DIR="$CL" PATH="$(onpath "$C/slowbin"):$PATH" exec node "$SCRIPT" x >"$C/out" 2>&1 ) &
    np=$!
    set +m
    for _ in $(seq 1 100); do [ -e "$C/updating" ] && break; sleep 0.1; done
    held=no; [ -d "$LK" ] && held=yes
    kill -s "$sig" -- "-$np" 2>/dev/null
    wait "$np"; rc=$?
    [ "$held" = yes ] && [ "$rc" -ne 0 ] && [ ! -e "$LK" ] \
        && ok "SIG$sig to the process group of qmd-collections during qmd update: refresh.lock released (exit $rc)" \
        || bad "SIG$sig: held=$held rc=$rc lock left=$([ -e "$LK" ] && echo yes || echo no) out=[$(cat "$C/out")]"
    kill -s KILL -- "-$np" 2>/dev/null
done

# --- index.yml written by qmd itself on a fresh machine: `collections: {}` ---------------------
# qmd saves its config with `collections: {}` before any collection exists. The script turns that line into the
# block form; any other value on the key's line is refused with one stderr line that says how to fix the file.
# Silent-mode project y; the stub qmd writes no index.yml, so every file is prepared with printf.
SILENT_Y='"mode": "silent", "language": {"reports": "ru", "team": "en"},
  "workflow": {"folder": "'"$WF"'"}, "docs": {"adr_dir": "docs/adr", "handoff": {"path": "'"$WF"'/HANDOFF.md"}},
  "lessons": "profile", "tickets": {"root": ".scratch/"}'
BLOCKS_Y="  y-docs:
    path: $(yp "$WF")
    pattern: \"docs/adr/**/*.md,HANDOFF.md\"
  y-tickets:
    path: $(yp "$WF/.scratch")
    pattern: \"**/*.md\"
  y-memory:
    path: @MEM@
    pattern: \"**/*.md\""
MODELS='models:
  embed: hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf
  generate: hf:tobil/qmd-query-expansion-1.7B-gguf/qmd-query-expansion-1.7B-q4_k_m.gguf
  rerank: hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf'
copies_of() { ls "$H/.config/qmd" | grep -c '^index\.yml\.20'; }
# accepted <case> <index.yml before> <index.yml expected>: exit 0, index.yml byte for byte as expected, one dated
# copy byte for byte the old file, the three names in the profile. @MEM@ stands for the case's memory folder.
accepted() {
    setup "$1" y "$SILENT_Y"
    mkdir -p "$H/.config/qmd"; printf '%s' "$2" >"$INDEX"; cp "$INDEX" "$C/index.0"
    mem="$(yp "$CL/projects/$(printf '%s' "$T/proj2" | sed 's/[^A-Za-z0-9]/-/g')/memory")"
    printf '%s' "${3//@MEM@/$mem}" >"$C/index.want"
    collect y; rc=$?
    copy="$(ls -d "$H/.config/qmd/index.yml.20"* 2>/dev/null | head -1)"
    [ "$rc" -eq 0 ] && cmp -s "$INDEX" "$C/index.want" && [ "$(copies_of)" = 1 ] && cmp -s "$copy" "$C/index.0" \
        && [ "$(jq -c '.qmd.collections' "$PROFILE")" = '["y-docs","y-tickets","y-memory"]' ] \
        && ok "$1: exit 0, index.yml in the block form, the rest byte for byte, a copy of the old file, names in the profile" \
        || bad "$1: rc=$rc copies=$(copies_of) out=[$(cat "$C/out")] index.yml:
$(cat "$INDEX")"
}
accepted fresh-machine "collections: {}
$MODELS
" "collections:
$BLOCKS_Y
$MODELS
"
# A second run on that file: nothing changes, no new copy.
cp "$INDEX" "$C/index.1"; cp "$PROFILE" "$C/profile.1"
collect y; rc=$?
[ "$rc" -eq 0 ] && cmp -s "$INDEX" "$C/index.1" && cmp -s "$PROFILE" "$C/profile.1" && [ "$(copies_of)" = 1 ] \
    && ok "fresh-machine second run: index.yml and the profile byte for byte the same, no new copy" \
    || bad "fresh-machine second run: rc=$rc copies=$(copies_of) out=[$(cat "$C/out")]"
accepted empty-spaced "collections: {  }
$MODELS
" "collections:
$BLOCKS_Y
$MODELS
"
accepted empty-last-line "$MODELS
collections: {}" "$MODELS
collections:
$BLOCKS_Y"
# The forms that already worked keep working: no key, a block under the key, the key with no block, the key on the
# last line with no newline at the end.
accepted no-key "$MODELS
" "collections:
$BLOCKS_Y
$MODELS
"
accepted block-under-key "collections:
  other:
    path: /x
    pattern: \"**/*.md\"
$MODELS
" "collections:
  other:
    path: /x
    pattern: \"**/*.md\"
$BLOCKS_Y
$MODELS
"
accepted key-without-block "collections:
$MODELS
" "collections:
$BLOCKS_Y
$MODELS
"
accepted key-last-line "$MODELS
collections:" "$MODELS
collections:
$BLOCKS_Y"

# A dictionary with content on the key's line: refused, nothing written, one stderr line that names the file, says
# nothing changed and describes the block form.
setup inline-content y "$SILENT_Y"
mkdir -p "$H/.config/qmd"
printf 'collections: {other: {path: /x, pattern: "**/*.md"}}\n%s\n' "$MODELS" >"$INDEX"
cp "$INDEX" "$C/index.0"; cp "$PROFILE" "$C/profile.0"
HOME="$H" HARNESS_HOME="$HH" CLAUDE_CONFIG_DIR="$CL" PATH="$(onpath "$T/fakebin"):$PATH" node "$SCRIPT" y >"$C/stdout" 2>"$C/err"; rc=$?
err="$(cat "$C/err")"
[ "$rc" -eq 1 ] && cmp -s "$INDEX" "$C/index.0" && cmp -s "$PROFILE" "$C/profile.0" && [ "$(copies_of)" = 0 ] \
    && ok "inline content: exit 1, index.yml and the profile unchanged, no copy" || bad "inline content: rc=$rc copies=$(copies_of) err=[$err]"
[ "$(wc -l <"$C/err" | tr -d ' ')" = 1 ] && [[ "$err" == *"$(printed "$INDEX")"* ]] && [[ "$err" == *"nothing changed"* ]] && [[ "$err" == *"edits only the block form"* ]] \
    && [[ "$err" == *'"collections:" alone on its line'* ]] && [[ "$err" == *"two spaces"* ]] \
    && [[ "$err" == *"path: and pattern:"* ]] && [[ "$err" == *"four"* ]] && [[ "$err" == *"run qmd-collections again"* ]] \
    && ok "inline content: one stderr line with the file, nothing changed, the block form and what to do next" \
    || bad "inline content: stderr [$err]"

# The profile already names collections and index.yml has `collections: {}`: the profile's refusal, not the inline one.
setup named-empty y "$(printf '%s' "$SILENT_Y" | sed 's/"lessons": "profile",/"lessons": "profile", "qmd": {"collections": ["y-docs"]},/')"
mkdir -p "$H/.config/qmd"; printf 'collections: {}\n%s\n' "$MODELS" >"$INDEX"; cp "$INDEX" "$C/index.0"
collect y; rc=$?
[ "$rc" -eq 1 ] && grep -qF "the profile names collections that $(printed "$INDEX") does not have: y-docs" "$C/out" && ! grep -q "inline" "$C/out" \
    && cmp -s "$INDEX" "$C/index.0" && [ "$(copies_of)" = 0 ] \
    && ok "profile names collections, index.yml has collections: {}: the profile's refusal, nothing written" \
    || bad "named-empty: rc=$rc out=[$(cat "$C/out")]"

# --- what runs a file (scriptCommand of lib/qmd-common.cjs) ----------------------------------
# A text file without a #! line is not given to node: it is valid JavaScript here, and the marker says whether it ran.
setup script-command x "$FULL"
cat >"$C/text-profile" <<EOF
require("fs").writeFileSync("$C/ran", "")
EOF
HOME="$H" HARNESS_HOME="$HH" CLAUDE_CONFIG_DIR="$CL" PATH="$(onpath "$T/fakebin"):$PATH" QMD_COLLECTIONS_PROFILE_BIN="$C/text-profile" \
    node "$SCRIPT" x >"$C/stdout" 2>"$C/err"; rc=$?
[ "$rc" -eq 1 ] && grep -q 'text-profile' "$C/err" && [ ! -e "$C/ran" ] \
    && ok "a text file without #! as the profile: exit 1, the message names it, node did not run it" || bad "text file without #!: rc=$rc ran=$([ -e "$C/ran" ] && echo yes || echo no) err=[$(cat "$C/err")]"
# A binary starts as it is: it answers nothing, so the message is about its answer, not a SyntaxError of node.
cp "$(type -P true)" "$C/x.exe"
HOME="$H" HARNESS_HOME="$HH" CLAUDE_CONFIG_DIR="$CL" PATH="$(onpath "$T/fakebin"):$PATH" QMD_COLLECTIONS_PROFILE_BIN="$C/x.exe" \
    node "$SCRIPT" x >"$C/stdout" 2>"$C/err"; rc=$?
[ "$rc" -eq 1 ] && grep -q 'is not JSON' "$C/err" && ! grep -q 'SyntaxError: Invalid' "$C/err" \
    && ok "a binary as the profile: it starts, and its empty answer is not JSON" || bad "binary: rc=$rc err=[$(cat "$C/err")]"
# A #! line naming another interpreter runs by that line, through bash on Windows.
printf '#!/bin/sh\n: >"%s"\necho nope\n' "$C/ran-sh" >"$C/sh-profile"; chmod +x "$C/sh-profile"
HOME="$H" HARNESS_HOME="$HH" CLAUDE_CONFIG_DIR="$CL" PATH="$(onpath "$T/fakebin"):$PATH" QMD_COLLECTIONS_PROFILE_BIN="$C/sh-profile" \
    node "$SCRIPT" x >"$C/stdout" 2>"$C/err"; rc=$?
[ "$rc" -eq 1 ] && [ -e "$C/ran-sh" ] && grep -q 'is not JSON' "$C/err" \
    && ok "a #!/bin/sh file as the profile: it runs" || bad "#!/bin/sh file: rc=$rc err=[$(cat "$C/err")]"

# --- an update line with more than the script is the owner's own command: left as it is ------------
setup compound x "$FULL"
mkdir -p "$H/.config/qmd"
cat >"$INDEX" <<EOF
collections:
  compound:
    path: /elsewhere
    update: cd /x && git pull && qmd-sync-main x && ./build-docs.sh
  echoed:
    path: /elsewhere/too
    update: echo qmd-sync-main x
  plain:
    path: /elsewhere/three
    update: /old/qmd-sync-main x
  other:
    path: /elsewhere/four
    update: cd /x && qmd-sync-main other-profile && ./build-docs.sh
EOF
collect x; rc=$?
[ "$rc" -eq 0 ] && grep -qF 'update: cd /x && git pull && qmd-sync-main x && ./build-docs.sh' "$INDEX" && grep -qF 'update: echo qmd-sync-main x' "$INDEX" && ! grep -qF '/old/qmd-sync-main' "$INDEX" \
    && ok "update lines: compound lines stay, a plain line of the script is rewritten" || bad "update lines: rc=$rc index=[$(cat "$INDEX")]"
# The same compound line, unrewritten, is a git copy for qmd-refresh.
cat >"$C/sync-log" <<'EOF'
#!/usr/bin/env node
require("fs").appendFileSync(process.env.SYNC_LOG, process.argv.slice(2).join(" ") + "\n")
process.exit(1)
EOF
chmod +x "$C/sync-log"
HOME="$H" HARNESS_HOME="$HH" PATH="$(onpath "$T/fakebin"):$PATH" SYNC_LOG="$C/sync.calls" QMD_REFRESH_SYNC="$C/sync-log" \
    node "$BIN/qmd-refresh" --force --wait >"$C/out" 2>&1
grep -qx -- '--describe other-profile' "$C/sync.calls" 2>/dev/null && grep -qF 'update: cd /x && qmd-sync-main other-profile && ./build-docs.sh' "$INDEX" \
    && ok "update lines: qmd-refresh reads a compound line as a git copy of the profile after the script" || bad "update lines, git copy: calls=[$(cat "$C/sync.calls" 2>/dev/null)] out=[$(tail -n 3 "$C/out")]"

# --- a plugin path with characters bash reads inside double quotes: the line runs as qmd runs it, `bash -c <line>` --
setup odd-path x "$FULL"
ODD='pl$ug`in'; [ "$WIN" = 1 ] || ODD="$ODD\"x" # Windows allows no quote in a file name
mv "$HH" "$C/$ODD"; HH="$C/$ODD"
mkdir -p "$HH/plugin/bin"
cat >"$HH/plugin/bin/qmd-sync-main" <<'EOF'
require("fs").writeFileSync(process.env.SYNC_RAN, process.argv.slice(2).join(" "))
EOF
collect x; rc=$?
line="$(node -e 'const q = require(process.argv[1]); const m = /^ +update: (.*)$/m.exec(require("fs").readFileSync(process.argv[2], "utf8")); process.stdout.write(q.unquote(m[1]))' "$BIN/../lib/qmd-common.cjs" "$INDEX" 2>/dev/null)"
(cd "$C" && SYNC_RAN="$C/sync.ran" bash -c "$line" >/dev/null 2>&1)
[ "$rc" -eq 0 ] && [ "$(cat "$C/sync.ran" 2>/dev/null)" = x ] \
    && ok "update line: a plugin path with \$, a backtick and a quote runs through bash -c" || bad "update line, odd path: rc=$rc line=[$line] out=[$(tail -n 3 "$C/out")]"

# --- tickets.root on another drive of Windows: path.relative gives an absolute path, and that is not inside the source ---
if [ "$WIN" = 1 ]; then
    setup other-drive x "$(printf '%s' "$FULL" | sed 's#"tickets": {"root": ".scratch/"}#"tickets": {"root": "Q:/tickets/"}#')"
    collect x; rc=$?
    tickets_block="$(sed -n '/^  x-tickets:/,/^  x-memory:/p' "$INDEX")"
    [ "$rc" -eq 0 ] && [[ "$tickets_block" == *'Q:'* ]] && [[ "$tickets_block" != *'update:'* ]] \
        && ok "tickets.root on another drive: the tickets collection has no update: line" || bad "tickets.root on another drive: rc=$rc out=[$(tail -n 3 "$C/out")] block=[$tickets_block]"
fi

# --- qmd cannot run: the collections are recorded, one stderr line names the grep fallback ------
setup no-qmd y "$SILENT_Y"
# A folder with only links to node and git on the PATH has no qmd, also on a Mac where qmd lies next to the node of
# nvm. Git for Windows finds its files from the folder of git.exe, so there the PATH has the folder of git itself.
mkdir -p "$C/empty-prefix/bin" "$C/tools"
real_node="$(onpath "$(node -p process.execPath)")"
if [ "$WIN" = 1 ]; then
    ln "$real_node" "$C/tools/node.exe" 2>/dev/null || cp "$real_node" "$C/tools/node.exe"
    NO_QMD_PATH="$(onpath "$C/tools"):$(dirname "$(type -P git)")"
else
    ln -s "$real_node" "$C/tools/node"; ln -s "$(type -P git)" "$C/tools/git"
    NO_QMD_PATH="$C/tools"
fi
HOME="$H" HARNESS_HOME="$HH" CLAUDE_CONFIG_DIR="$CL" PATH="$NO_QMD_PATH" QMD_NPM_PREFIX="$C/empty-prefix" \
    node "$SCRIPT" y >"$C/stdout" 2>"$C/err"; rc=$?
[ "$rc" -eq 0 ] && [ -f "$INDEX" ] && [ "$(wc -l <"$C/err" | tr -d ' ')" = 1 ] && grep -q 'qmd not found' "$C/err" && grep -q 'qmd.fallback_grep' "$C/err" \
    && ok "no qmd: exit 0, index.yml written, one stderr line with the grep fallback" || bad "no qmd: rc=$rc err=[$(cat "$C/err")]"
setup old-node y "$SILENT_Y"
HOME="$H" HARNESS_HOME="$HH" CLAUDE_CONFIG_DIR="$CL" PATH="$(onpath "$T/fakebin"):$PATH" QMD_NODE_VERSION=22.13.1 node "$SCRIPT" y >"$C/stdout" 2>"$C/err"; rc=$?
[ "$rc" -eq 0 ] && [ -f "$INDEX" ] && [ ! -e "$QMD_CALLS" ] && [ "$(wc -l <"$C/err" | tr -d ' ')" = 1 ] && grep -q '22.13.1 is too old for qmd' "$C/err" && grep -q 'qmd.fallback_grep' "$C/err" \
    && ok "node 22.13.1: exit 0, index.yml written, qmd not started, one stderr line with the grep fallback" || bad "old node: rc=$rc err=[$(cat "$C/err")]"

# --- usage ------------------------------------------------------------------------------------
node "$SCRIPT" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 2 ] && ok "no project name: exit 2" || bad "no project name: exit $rc"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
