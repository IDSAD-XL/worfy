#!/usr/bin/env bash
# Tests of harness/bin/qmd-sync-main, qmd-refresh and qmd-mcp on temporary directories (no network needed: origin is a local bare repository).
# The scripts run as `node <script>`, as harness/.mcp.json and harness/hooks/hooks.json start them; the
# stand-ins they start are Node scripts too, so the file runs the same on macOS, Linux and in Git Bash.
#   - qmd-sync-main: a copy that is not the root of its own repository — refusal without fetch/checkout;
#   - qmd-refresh: one broken profile / one missing copy do not stop the run —
#     qmd update is still called; with --quiet (Stop hook) exit 0, without --quiet — 1;
#     qmd embed only after the consent to the models;
#   - qmd-mcp: without the answer "downloaded", without qmd or on node below 22.14 no server and one
#     stderr line that names the grep fallback; the Russian query expansion model only for a project
#     with language.docs ru; the plugin's .mcp.json, the agents' qmd tools and the Stop hook.
# Run: bash harness/bin/tests/qmd.test.sh; exit code 0 — everything passed.
# BIN_DIR — run the test against another copy of the scripts.
set -u
unset QMD_INDEX_YML QMD_CONFIG_DIR XDG_CONFIG_HOME XDG_CACHE_HOME # the folders of qmd are always under the temporary HOME
BIN="${BIN_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"   # the scripts next to this test (harness/bin)
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })" # C:/… on Windows: node reads these paths
# A folder as PATH takes it: /c/… in Git Bash, where the colon of C:/… splits the entry; unchanged elsewhere.
onpath() { cygpath -u "$1" 2>/dev/null || printf '%s' "$1"; }
# A path as the scripts print it: with backslashes on Windows (cygpath exists there), unchanged elsewhere.
printed() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
gq() { git -c user.email=t@t -c user.name=t "$@"; }
# node_stub <file> <JavaScript>: a stand-in started by its #! line naming node; `fs`, T (the temporary
# folder) and A (the arguments) are in scope.
export STUB_DIR="$T"
node_stub() { printf '#!/usr/bin/env node\nconst fs = require("fs"), T = process.env.STUB_DIR, A = process.argv.slice(2)\n%s\n' "$2" >"$1"; chmod +x "$1"; }

# --- 5. qmd-sync-main: the copy must be the root of its own repository ---------------
gq init -q --bare -b main "$T/origin.git"
gq clone -q "$T/origin.git" "$T/seed" 2>/dev/null
gq -C "$T/seed" commit -q --allow-empty -m one && gq -C "$T/seed" push -q origin HEAD:main 2>/dev/null
gq clone -q "$T/origin.git" "$T/outer" 2>/dev/null
gq -C "$T/seed" commit -q --allow-empty -m two && gq -C "$T/seed" push -q origin HEAD:main 2>/dev/null
mkdir -p "$T/outer/sub"
printf '{"repos":[{"key":"x","match":"%s","profile":"x"}]}\n' "$T/outer" >"$T/config.json"
node_stub "$T/profile" 'console.log(JSON.stringify({ name: "x", worktree: { base: "origin/main" } }))'
before="$(git -C "$T/outer" rev-parse HEAD) $(git -C "$T/outer" symbolic-ref -q HEAD)"
out="$(CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile" QMD_SYNC_MARK="$T/mark" \
    QMD_SYNC_COPY="$T/outer/sub" node "$BIN/qmd-sync-main" x 2>&1)"; rc=$?
after="$(git -C "$T/outer" rev-parse HEAD) $(git -C "$T/outer" symbolic-ref -q HEAD)"
[ "$before" = "$after" ] && ok "sync: copy inside another repo -> enclosing repo untouched" \
    || bad "sync: enclosing repo changed: $before -> $after"
[ -s "$T/mark" ] && grep -q "is not the root" "$T/mark" && [[ "$out" == *"SYNC FAILED"* ]] \
    && ok "sync: refusal leaves marker + loud message" || bad "sync refusal: rc=$rc out=${out:0:200}"
rm -f "$T/mark"
# Regression: a real copy (a root) gets pulled.
out="$(CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile" QMD_SYNC_MARK="$T/mark" \
    QMD_SYNC_COPY="$T/outer" node "$BIN/qmd-sync-main" x 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ ! -e "$T/mark" ] && [ "$(git -C "$T/outer" rev-parse HEAD)" = "$(git -C "$T/seed" rev-parse HEAD)" ] \
    && ok "sync: real copy root -> fetched and checked out" || bad "sync real copy: rc=$rc out=${out:0:200}"
# No profile name: a usage error.
node "$BIN/qmd-sync-main" >/dev/null 2>"$T/usage.err"; rc=$?
[ "$rc" -eq 2 ] && grep -q "no profile named" "$T/usage.err" && ok "sync: no profile name -> exit 2" || bad "sync usage: rc=$rc"

# --- 5b. qmd-sync-main --describe: profile warnings on stderr stay out of the JSON -------------
# bin/profile warns on stderr (a broken user.json, a malformed language) and still exits 0 with the
# JSON on stdout: the warning reaches the caller's stderr, the JSON is still read. A failing profile:
# exit 1 and one line with its own error (the last stderr line), not an earlier warning.
node_stub "$T/profile-warn" 'console.error("profile: /x/profile.json: language.docs must be a language code such as \"en\", got null — ignored")
console.log(JSON.stringify({ name: "x", worktree: { base: "origin/trunk" }, github: { account: "octo" } }))'
node_stub "$T/profile-fail" 'console.error("profile: /x/user.json is not JSON — ignored")
console.error("profile: /x/profile.json is not valid JSON: Unexpected end")
process.exit(1)'
out="$(HOME="$T/home-d" CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile-warn" \
    node "$BIN/qmd-sync-main" --describe x 2>"$T/describe.err")"; rc=$?
[ "$rc" -eq 0 ] && [ "$out" = "$(printed "$T/home-d/.cache/qmd/x-trunk")"$'\t'"trunk"$'\t'"octo" ] \
    && ok "describe: a profile warning on stderr does not break the JSON" || bad "describe with a profile warning: rc=$rc out='${out:0:200}' err='$(head -c 200 "$T/describe.err")'"
grep -q 'language.docs must be a language code' "$T/describe.err" \
    && ok "describe: the profile warning reaches stderr" || bad "describe: the profile warning is lost"
out="$(HOME="$T/home-d" CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile-fail" \
    node "$BIN/qmd-sync-main" --describe x 2>"$T/describe.err")"; rc=$?
[ "$rc" -eq 1 ] && [ -z "$out" ] && [ "$(wc -l <"$T/describe.err" | tr -d ' ')" = 1 ] \
    && grep -q "^qmd-sync-main: profile -C .*: profile: /x/profile.json is not valid JSON" "$T/describe.err" \
    && ok "describe: a failing profile -> exit 1, one line with its own error" || bad "describe with a failing profile: rc=$rc out='${out:0:100}' err='$(head -c 300 "$T/describe.err")'"

# --- 6. qmd-refresh: a partial failure does not stop the run ----------------------
H="$T/home"; mkdir -p "$H/.cache/qmd" "$T/fakebin" "$T/mem"
echo note >"$T/mem/a.md"
FAKEBIN="$(onpath "$T/fakebin")"
node_stub "$T/fakebin/qmd" 'fs.appendFileSync(T + "/qmd.calls", A[0] + "\n")'
node_stub "$T/sync" 'if (A[0] !== "--describe") process.exit(0)
if (A[1] === "good") process.stdout.write(T + "/outer\tmain\t\n")
else if (A[1] === "missing") process.stdout.write(T + "/no-such-copy\tmain\t\n")
else { console.log("profile " + A[1] + " is not in the registry"); process.exit(1) }'
# The three forms of an `update:` line: the older one, the current one as a plain value and as qmd-collections quotes it.
cat >"$T/index.yml" <<EOF
collections:
  bad:
    path: $T/x
    update: /x/qmd-sync-main bad
  missing:
    path: $T/y
    update: node "/x/qmd-sync-main" missing
  good:
    path: $T/outer
    update: "node \"/x/qmd-sync-main\" good"
  memory:
    path: $T/mem
EOF
run_refresh() {
    HOME="$H" PATH="$FAKEBIN:$PATH" QMD_INDEX_YML="$T/index.yml" QMD_REFRESH_SYNC="$T/sync" \
        node "$BIN/qmd-refresh" --wait "$@" 2>&1
}
rm -f "$T/qmd.calls"
out="$(run_refresh --quiet)"; rc=$?
[ "$rc" -eq 0 ] && ok "refresh --quiet (Stop hook): bad profile + missing copy -> exit 0" || bad "refresh --quiet: rc=$rc out=${out:0:200}"
grep -qx update "$T/qmd.calls" 2>/dev/null && ok "refresh --quiet: qmd update still ran" || bad "refresh --quiet: qmd update not called"
grep -q "profile bad not resolved" "$H/.cache/qmd/refresh.log" 2>/dev/null && ok "refresh --quiet: warning logged" || bad "refresh --quiet: no warning in log"
rm -f "$T/qmd.calls" "$H/.cache/qmd/last-index"
out="$(run_refresh)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"profile bad not resolved"* ]] && [[ "$out" == *"no-such-copy"* ]] \
    && ok "refresh (manual): warns about both, exit 1 (partial failure)" || bad "refresh manual: rc=$rc out=${out:0:300}"
grep -qx update "$T/qmd.calls" 2>/dev/null && ok "refresh (manual): qmd update still ran" || bad "refresh manual: qmd update not called"

# A profile warning on the stderr of --describe (bin/profile warns and still answers): the copy is
# used, the warning passes through, and it is not read as part of the copy path.
node_stub "$T/sync-warn" 'if (A[0] !== "--describe") process.exit(0)
console.error("profile: /x/profile.json: language.docs must be a language code such as \"en\", got null — ignored")
process.stdout.write(T + "/outer\tmain\t\n")'
cat >"$T/index-warn.yml" <<EOF
collections:
  warns:
    path: $T/outer
    update: /x/qmd-sync-main warns
EOF
rm -f "$H/.cache/qmd/last-index"
out="$(HOME="$H" PATH="$FAKEBIN:$PATH" QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-warn" \
    node "$BIN/qmd-refresh" --wait 2>"$T/refresh.err")"; rc=$?
[ "$rc" -eq 0 ] && [[ "$out" != *"is missing"* ]] && [[ "$out" != *"not resolved"* ]] \
    && ok "refresh: a profile warning on --describe's stderr -> the copy is used, exit 0" || bad "refresh with a profile warning: rc=$rc out=${out:0:300}"
grep -q 'language.docs must be a language code' "$T/refresh.err" \
    && ok "refresh: the profile warning passes through to stderr" || bad "refresh: the profile warning is lost: '$(head -c 200 "$T/refresh.err")'"
# A failure reported on --describe's stderr (the real qmd-sync-main): the reason reaches the warning.
node_stub "$T/sync-fail" 'if (A[0] !== "--describe") process.exit(0)
console.error("profile: /x/user.json is not JSON — ignored")
console.error("qmd-sync-main: profile " + A[1] + " is not in the registry /x/config.json")
process.exit(1)'
out="$(HOME="$H" PATH="$FAKEBIN:$PATH" QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-fail" \
    node "$BIN/qmd-refresh" --wait 2>/dev/null)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"profile warns not resolved, its copy skipped — qmd-sync-main: profile warns is not in the registry"* ]] \
    && ok "refresh: a --describe failure on stderr -> its reason in the warning, exit 1" || bad "refresh with a failing --describe: rc=$rc out=${out:0:300}"

# The real qmd-sync-main between qmd-refresh and a failing profile: the profile's reason (not its
# warning before it, not a bare "failed") reaches the qmd-refresh warning, refresh.log under --quiet
# and the sync-failed marker. qmd-sync-main leaves no temporary file behind.
node_stub "$T/profile-reason" 'console.error("profile: /x/user.json is not JSON — ignored")
console.error("profile: /x/profile.json is not valid JSON: Unexpected end")
process.exit(1)'
mkdir -p "$T/tmp-sync"
REASON="profile -C $T/outer: profile: /x/profile.json is not valid JSON: Unexpected end"
real_sync() { # $@ qmd-refresh arguments; stdout+stderr of qmd-refresh
    HOME="$H" TMPDIR="$T/tmp-sync" PATH="$FAKEBIN:$PATH" QMD_INDEX_YML="$T/index-x.yml" CLAUDE_GATE_CONFIG="$T/config.json" \
        QMD_SYNC_PROFILE_BIN="$T/profile-reason" QMD_REFRESH_SYNC="$BIN/qmd-sync-main" node "$BIN/qmd-refresh" --wait "$@" 2>&1
}
cat >"$T/index-x.yml" <<EOF
collections:
  x:
    path: $T/outer
    update: /x/qmd-sync-main x
EOF
out="$(real_sync --force)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"profile x not resolved, its copy skipped — qmd-sync-main: $REASON"* ]] \
    && ok "refresh + real qmd-sync-main: the profile's reason in the warning" || bad "refresh + real qmd-sync-main: rc=$rc out=${out:0:400}"
rm -f "$H/.cache/qmd/refresh.log"
real_sync --force --quiet >/dev/null
grep -qF -- "$REASON" "$H/.cache/qmd/refresh.log" 2>/dev/null \
    && ok "refresh --quiet + real qmd-sync-main: the profile's reason in refresh.log" || bad "refresh --quiet: no reason in refresh.log: '$(tail -c 300 "$H/.cache/qmd/refresh.log" 2>/dev/null)'"
HOME="$H" TMPDIR="$T/tmp-sync" CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile-reason" QMD_SYNC_MARK="$T/mark-x" \
    node "$BIN/qmd-sync-main" x 2>/dev/null
grep -qF -- "[x] $REASON" "$T/mark-x" 2>/dev/null \
    && ok "sync + failing profile: the profile's reason in the marker" || bad "sync + failing profile: marker '$(head -c 300 "$T/mark-x" 2>/dev/null)'"
out="$(HOME="$H" TMPDIR="$T/tmp-sync" CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile-reason" \
    node "$BIN/qmd-sync-main" --describe x 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 1 ] && [ "$out" = "qmd-sync-main: $REASON" ] \
    && ok "describe + failing profile: exit 1, one line with the profile's reason" || bad "describe + failing profile: rc=$rc stderr='${out:0:300}'"
HOME="$H" TMPDIR="$T/tmp-sync" CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile-warn" \
    node "$BIN/qmd-sync-main" --describe x >/dev/null 2>&1
[ -z "$(ls -A "$T/tmp-sync")" ] && ok "qmd-sync-main and qmd-refresh leave no temporary file" || bad "temporary files left: $(ls -A "$T/tmp-sync" | head -n 3 | tr '\n' ' ')"
# --quiet (the Stop hook, every turn) prints nothing, a profile warning included.
out="$(HOME="$H" PATH="$FAKEBIN:$PATH" QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-warn" \
    node "$BIN/qmd-refresh" --wait --force --quiet 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "refresh --quiet: a profile warning is not printed" || bad "refresh --quiet with a profile warning: rc=$rc out='${out:0:200}'"
# SIGTERM while --describe runs: qmd-refresh ends and leaves neither a temporary file nor the lock.
# The stand-in of --describe writes its pid and then waits for $T/sync-slow.go (at most 30 s), so the SIGTERM lands
# while it runs however late qmd-refresh reaches it. The test waits up to 30 s for the pid, polling: on a loaded
# machine qmd-refresh took more than the 2 s the test once gave it, and the check failed with nothing left behind.
# Not on Windows: a signal from Git Bash reaches its own wrapper of node, not node, and worfy ends a process
# there with taskkill, which no handler sees; the lock left that way is the abandoned lock tested in part 7.
if [ "$WIN" = 0 ]; then
mkdir -p "$T/tmp-term"
node_stub "$T/sync-slow" 'if (A[0] !== "--describe") process.exit(0)
fs.writeFileSync(T + "/sync-slow.pid", String(process.pid))
const sleeper = new Int32Array(new SharedArrayBuffer(4))
for (let n = 0; n < 300 && !fs.existsSync(T + "/sync-slow.go"); n++) Atomics.wait(sleeper, 0, 0, 100)
fs.writeFileSync(T + "/sync-slow.ended", "")
process.stdout.write(T + "/outer\tmain\t\n")'
rm -f "$T/sync-slow.pid" "$T/sync-slow.go"
HOME="$H" TMPDIR="$T/tmp-term" PATH="$FAKEBIN:$PATH" QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-slow" \
    node "$BIN/qmd-refresh" --wait --force --quiet >/dev/null 2>&1 &
refresh_pid=$!
n=0; while [ ! -s "$T/sync-slow.pid" ] && [ "$n" -lt 300 ] && kill -0 "$refresh_pid" 2>/dev/null; do sleep 0.1; n=$((n + 1)); done
described=no; [ -s "$T/sync-slow.pid" ] && kill -0 "$refresh_pid" 2>/dev/null && described=yes
kill -TERM "$refresh_pid" 2>/dev/null
wait "$refresh_pid" 2>/dev/null
# release the stand-in and wait for it (at most 30 s) so nothing is left running
: >"$T/sync-slow.go"
n=0; while [ "$n" -lt 300 ] && [ ! -e "$T/sync-slow.ended" ]; do sleep 0.1; n=$((n + 1)); done
[ "$described" = yes ] && [ -z "$(ls -A "$T/tmp-term")" ] && [ ! -e "$H/.cache/qmd/refresh.lock" ] \
    && ok "refresh: SIGTERM during --describe leaves no temporary file and no lock" \
    || bad "refresh: SIGTERM during --describe: the stand-in was running at the signal: $described; left: $(ls -A "$T/tmp-term" | head -n 3 | tr '\n' ' ')"
fi

# --- 6b. qmd-refresh: qmd embed only with the consent to the models -----------------------
HH="$T/hh"; mkdir -p "$HH"
rm -f "$T/qmd.calls" "$H/.cache/qmd/last-index"
HARNESS_HOME="$HH" run_refresh --force --quiet >/dev/null; rc=$?
grep -qx embed "$T/qmd.calls" 2>/dev/null && bad "refresh without consent: qmd embed ran" \
    || { grep -qx update "$T/qmd.calls" 2>/dev/null && ok "refresh without consent: update ran, embed did not"; } \
    || bad "refresh without consent: rc=$rc calls=[$(cat "$T/qmd.calls" 2>/dev/null)]"
printf 'downloaded\n' >"$HH/qmd-models"
rm -f "$T/qmd.calls"
HARNESS_HOME="$HH" run_refresh --force --quiet >/dev/null
grep -qx embed "$T/qmd.calls" 2>/dev/null && ok "refresh with consent: qmd embed ran" || bad "refresh with consent: no embed: [$(cat "$T/qmd.calls" 2>/dev/null)]"
rm -f "$HH/qmd-models"

# qmd-refresh goes to the background: the lock holds the pid of the update, which is still running
# after qmd-refresh has exited, and the update lets the lock go when it ends.
mkdir -p "$T/slowbin"
node_stub "$T/slowbin/qmd" 'fs.appendFileSync(T + "/slow.calls", A[0] + "\n")
const sleeper = new Int32Array(new SharedArrayBuffer(4))
for (let n = 0; n < 300 && A[0] === "update" && !fs.existsSync(T + "/slow.go"); n++) Atomics.wait(sleeper, 0, 0, 100)'
rm -f "$H/.cache/qmd/last-index" "$H/.cache/qmd/refresh.log"
start=$(date +%s)
HOME="$H" PATH="$(onpath "$T/slowbin"):$PATH" QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-warn" \
    node "$BIN/qmd-refresh" --force --quiet >/dev/null 2>&1; rc=$?
took=$(( $(date +%s) - start ))
LK="$H/.cache/qmd/refresh.lock"
n=0; while [ ! -e "$T/slow.calls" ] && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n + 1)); done
pid="$(cat "$LK/pid" 2>/dev/null)"
alive=no; node -e 'try { process.kill(Number(process.argv[1]), 0); process.exit(0) } catch { process.exit(1) }' "${pid:-0}" && alive=yes
[ "$rc" -eq 0 ] && [ "$took" -lt 20 ] && [ "$alive" = yes ] \
    && ok "refresh in the background: exit 0 at once, the lock holds the pid of the running update" || bad "refresh in the background: rc=$rc took=${took}s pid=[$pid] alive=$alive"
: >"$T/slow.go"
n=0; while [ -e "$LK" ] && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n + 1)); done
[ ! -e "$LK" ] && grep -q '^update rc=0' "$H/.cache/qmd/refresh.log" && ok "refresh in the background: the update ends and lets the lock go" \
    || bad "refresh in the background: lock left=$([ -e "$LK" ] && echo yes || echo no) log=[$(tail -n 3 "$H/.cache/qmd/refresh.log" 2>/dev/null)]"

# qmd-refresh that cannot run qmd: without --quiet one stderr line with the grep fallback, with --quiet nothing and 0.
EMPTY_PREFIX="$T/empty-prefix"; mkdir -p "$EMPTY_PREFIX/bin"
NODE_DIR="$(dirname "$(node -p process.execPath)")"; NODE_ONLY="$(onpath "$NODE_DIR")"
no_qmd_env() { env HOME="$H" PATH="$NODE_ONLY" QMD_NPM_PREFIX="$EMPTY_PREFIX" QMD_INDEX_YML="$T/index-warn.yml" "$@"; }
# A qmd next to this node (a Mac with qmd in nvm) makes these cases about another machine.
BESIDE_NODE=no; { [ -e "$NODE_DIR/qmd" ] || [ -e "$NODE_DIR/qmd.cmd" ]; } && BESIDE_NODE=yes
if [ "$BESIDE_NODE" = yes ]; then
    echo "skip the cases without qmd: a qmd lies next to this node"
else
    no_qmd_env node "$BIN/qmd-refresh" >"$T/nq.out" 2>"$T/nq.err"; rc=$?
    [ "$rc" -eq 127 ] && [ ! -s "$T/nq.out" ] && [ "$(wc -l <"$T/nq.err" | tr -d ' ')" = 1 ] && grep -q 'qmd.fallback_grep' "$T/nq.err" \
        && ok "refresh without qmd: exit 127, one stderr line with the grep fallback" || bad "refresh without qmd: rc=$rc err=[$(cat "$T/nq.err")]"
    no_qmd_env node "$BIN/qmd-refresh" --quiet >"$T/nq.out" 2>&1; rc=$?
    [ "$rc" -eq 0 ] && [ ! -s "$T/nq.out" ] && ok "refresh --quiet without qmd: exit 0, no output" || bad "refresh --quiet without qmd: rc=$rc out=[$(cat "$T/nq.out")]"
fi
HOME="$H" PATH="$FAKEBIN:$PATH" QMD_NODE_VERSION=22.13.1 QMD_INDEX_YML="$T/index-warn.yml" node "$BIN/qmd-refresh" >"$T/old.out" 2>"$T/old.err"; rc=$?
[ "$rc" -eq 3 ] && [ "$(wc -l <"$T/old.err" | tr -d ' ')" = 1 ] && grep -q '22.13.1 is older than 22.14' "$T/old.err" && grep -q 'qmd.fallback_grep' "$T/old.err" \
    && ok "refresh on node 22.13.1: exit 3, one stderr line with the version and the grep fallback" || bad "refresh on an old node: rc=$rc err=[$(cat "$T/old.err")]"

# --- 7. qmd-mcp: consent and the model of the project's language ---------------------------
RU='hf:AGmind/qmd-query-expansion-ru/qmd-query-expansion-ru-q4_k_m.gguf'
DEF='hf:tobil/qmd-query-expansion-1.7B-gguf/qmd-query-expansion-1.7B-q4_k_m.gguf'
EMB='hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf'
mkdir -p "$T/mcpbin" "$T/session"
MCPBIN="$(onpath "$T/mcpbin")"
node_stub "$T/mcpbin/qmd" 'const e = process.env
fs.appendFileSync(T + "/mcp.calls", A[0] + " gen=" + (e.QMD_GENERATE_MODEL || "unset") + " emb=" + (e.QMD_EMBED_MODEL || "unset") + "\n")
fs.writeFileSync(T + "/mcp.cwd", process.cwd())
if (e.MCP_STUB_ECHO) { let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { process.stdout.write(s.toUpperCase()); process.exit(Number(e.MCP_STUB_ECHO)) }) }'
# The profile stub prints the language it is given in LANG_DOCS; "absent" — exit 4 like a missing field.
node_stub "$T/profile-lang" 'if (A.join(" ") !== "--field language.docs") process.exit(2)
if (process.env.LANG_DOCS === "absent") process.exit(4)
console.log(process.env.LANG_DOCS)'
run_mcp() { # $1 = language of the stub; the rest — the answer file lines (none — no file)
    local lang="$1"; shift
    rm -f "$T/mcp.calls" "$HH/qmd-models"
    [ $# -gt 0 ] && printf '%s\n' "$@" >"$HH/qmd-models"
    (cd "$T/session" && HOME="$H" HARNESS_HOME="$HH" PATH="$MCPBIN:$PATH" QMD_MCP_NO_REFRESH=1 \
        QMD_MCP_PROFILE_BIN="$T/profile-lang" LANG_DOCS="$lang" node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null)
}
for answer in none skipped; do
    if [ "$answer" = none ]; then run_mcp ru; else run_mcp ru skipped; fi; rc=$?
    [ "$rc" -eq 3 ] && [ "$(wc -l <"$T/mcp.err" | tr -d ' ')" = 1 ] && grep -q "consent" "$T/mcp.err" && grep -q "qmd.fallback_grep" "$T/mcp.err" && [ ! -e "$T/mcp.calls" ] \
        && ok "qmd-mcp, answer $answer: exit $rc, one line in stderr with the grep fallback, qmd mcp not started" \
        || bad "qmd-mcp, answer $answer: rc=$rc err=[$(cat "$T/mcp.err")] calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
done
run_mcp ru downloaded; rc=$?
[ "$rc" -eq 0 ] && [ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=$RU emb=$EMB" ] \
    && ok "qmd-mcp, downloaded, language.docs ru: qmd mcp with the Russian model" || bad "qmd-mcp ru: rc=$rc calls=[$(cat "$T/mcp.calls" 2>/dev/null)] err=[$(cat "$T/mcp.err")]"
[ "$(printed "$(cat "$T/mcp.cwd" 2>/dev/null)")" = "$(printed "$H")" ] \
    && ok "qmd-mcp: the server runs in the home folder (the global index, not a project's .qmd)" || bad "qmd-mcp cwd: [$(cat "$T/mcp.cwd" 2>/dev/null)]"
for lang in en absent; do
    run_mcp "$lang" downloaded; rc=$?
    [ "$rc" -eq 0 ] && [ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=unset emb=$EMB" ] \
        && ok "qmd-mcp, downloaded, language.docs $lang: qmd mcp with the default expansion model" || bad "qmd-mcp $lang: rc=$rc calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
done
run_mcp en downloaded "$EMB" "$RU"
[ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=$RU emb=$EMB" ] \
    && ok "qmd-mcp: only the Russian model was downloaded -> it, not a new download, for an en project" || bad "qmd-mcp consented list en: [$(cat "$T/mcp.calls" 2>/dev/null)]"
run_mcp ru downloaded "$EMB" "$DEF"
[ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=unset emb=$EMB" ] \
    && ok "qmd-mcp: only the default model was downloaded -> it for a ru project" || bad "qmd-mcp consented list ru: [$(cat "$T/mcp.calls" 2>/dev/null)]"

# The server's stdin and stdout are the wrapper's, nothing else reaches stdout, and its exit code is the wrapper's.
printf 'downloaded\n' >"$HH/qmd-models"
out="$(cd "$T/session" && printf 'hello' | HOME="$H" HARNESS_HOME="$HH" PATH="$MCPBIN:$PATH" QMD_MCP_NO_REFRESH=1 MCP_STUB_ECHO=7 \
    QMD_MCP_PROFILE_BIN="$T/profile-lang" LANG_DOCS=en node "$BIN/qmd-mcp" 2>"$T/mcp.err"; echo "rc=$?")"
[ "$out" = "HELLOrc=7" ] && ok "qmd-mcp: stdin and stdout go to the server, its exit code comes back" || bad "qmd-mcp stdio: out=[$out] err=[$(cat "$T/mcp.err")]"

# node below 22.14: qmd would die without a word, so one line says why, and qmd is not started.
rm -f "$T/mcp.calls"
(cd "$T/session" && HOME="$H" HARNESS_HOME="$HH" PATH="$MCPBIN:$PATH" QMD_MCP_NO_REFRESH=1 QMD_NODE_VERSION=22.13.1 node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null); rc=$?
[ "$rc" -eq 3 ] && [ "$(wc -l <"$T/mcp.err" | tr -d ' ')" = 1 ] && grep -q '22.13.1 is older than 22.14' "$T/mcp.err" && grep -q 'qmd.fallback_grep' "$T/mcp.err" && [ ! -e "$T/mcp.calls" ] \
    && ok "qmd-mcp on node 22.13.1: exit 3, one line with the version and the grep fallback, qmd not started" || bad "qmd-mcp on an old node: rc=$rc err=[$(cat "$T/mcp.err")]"
(cd "$T/session" && HOME="$H" HARNESS_HOME="$HH" PATH="$MCPBIN:$PATH" QMD_MCP_NO_REFRESH=1 QMD_NODE_VERSION=22.14.0 QMD_MCP_PROFILE_BIN="$T/profile-lang" LANG_DOCS=en node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null); rc=$?
[ "$rc" -eq 0 ] && [ -e "$T/mcp.calls" ] && ok "qmd-mcp on node 22.14.0: qmd mcp starts" || bad "qmd-mcp on 22.14.0: rc=$rc err=[$(cat "$T/mcp.err")]"

# No qmd anywhere: exit 127, one line with the grep fallback.
if [ "$BESIDE_NODE" = no ]; then
    (cd "$T/session" && no_qmd_env HARNESS_HOME="$HH" QMD_MCP_NO_REFRESH=1 node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null); rc=$?
    [ "$rc" -eq 127 ] && [ "$(wc -l <"$T/mcp.err" | tr -d ' ')" = 1 ] && grep -q 'qmd not found' "$T/mcp.err" && grep -q 'qmd.fallback_grep' "$T/mcp.err" \
        && ok "qmd-mcp without qmd: exit 127, one line with the grep fallback" || bad "qmd-mcp without qmd: rc=$rc err=[$(cat "$T/mcp.err")]"
fi

# qmd in the global folder of npm and not on the PATH: found there. On Windows the file npm's qmd.cmd
# names runs with this node; the .cmd itself, and the `#!/bin/sh` file npm leaves next to it, do not.
PREFIX="$T/npm-prefix"
if [ "$WIN" = 1 ]; then
    mkdir -p "$PREFIX/node_modules/@tobilu/qmd/bin"
    cp "$T/mcpbin/qmd" "$PREFIX/node_modules/@tobilu/qmd/bin/qmd"
    printf '#!/bin/sh\nexit 9\n' >"$PREFIX/qmd"
    printf '@ECHO off\r\nexit /b 9\r\n"%%_prog%%"  "%%dp0%%\\node_modules\\@tobilu\\qmd\\bin\\qmd" %%*\r\n' >"$PREFIX/qmd.cmd"
else
    mkdir -p "$PREFIX/bin" && cp "$T/mcpbin/qmd" "$PREFIX/bin/qmd"
fi
if [ "$BESIDE_NODE" = no ]; then
    rm -f "$T/mcp.calls"
    (cd "$T/session" && env HOME="$H" HARNESS_HOME="$HH" PATH="$NODE_ONLY" QMD_NPM_PREFIX="$PREFIX" QMD_MCP_NO_REFRESH=1 QMD_MCP_PROFILE_BIN="$T/profile-lang" LANG_DOCS=en \
        node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null); rc=$?
    [ "$rc" -eq 0 ] && [ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=unset emb=$EMB" ] \
        && ok "qmd-mcp: qmd in the global folder of npm is found and started" || bad "qmd-mcp npm folder: rc=$rc err=[$(cat "$T/mcp.err")] calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
fi

# The background update of qmd-mcp: without QMD_MCP_NO_REFRESH it runs update and embed with the models and
# lets the lock go; with the lock taken by someone alive it does not start a second one. On Windows the PATH of
# the update has Git Bash before everything else, because qmd starts `bash -c <update line>`.
node_stub "$T/mcpbin/qmd" 'const e = process.env
fs.appendFileSync(T + "/mcp.calls", A[0] + " emb=" + (e.QMD_EMBED_MODEL || "unset") + "\n")
if (A[0] === "update") { fs.writeFileSync(T + "/update.path", e.PATH || e.Path); fs.writeFileSync(T + "/update.cwd", process.cwd()) }'
mcp_with_update() { (cd "$T/session" && HOME="$H" HARNESS_HOME="$HH" PATH="$MCPBIN:$PATH" QMD_MCP_PROFILE_BIN="$T/profile-lang" LANG_DOCS=en node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null); }
printf 'downloaded\n' >"$HH/qmd-models"
rm -f "$T/mcp.calls"
mcp_with_update; rc=$?
n=0; while [ -e "$LK" ] && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n + 1)); done
grep -q "^mcp emb=$EMB" "$T/mcp.calls" && grep -q "^update emb=$EMB" "$T/mcp.calls" && grep -q "^embed emb=$EMB" "$T/mcp.calls" && [ ! -e "$LK" ] \
    && ok "qmd-mcp: the background update runs update and embed with the embedding model, then lets the lock go" \
    || bad "qmd-mcp background: rc=$rc calls=[$(cat "$T/mcp.calls" 2>/dev/null)] log=[$(tail -n 3 "$H/.cache/qmd/refresh.log" 2>/dev/null)]"
if [ "$WIN" = 1 ]; then
    [ -n "$(node -p 'process.argv[1].split(";").slice(0, 2).filter((d) => require("fs").existsSync(d + "\\bash.exe") && !/system32/i.test(d)).join()' "$(cat "$T/update.path" 2>/dev/null)")" ] \
        && ok "qmd-mcp, Windows: the PATH of qmd update starts with this node and Git Bash" || bad "qmd-mcp PATH of the update: [$(cut -c1-300 "$T/update.path" 2>/dev/null)]"
fi
[ "$(printed "$(cat "$T/update.cwd" 2>/dev/null)")" = "$(printed "$H")" ] \
    && ok "qmd-mcp: the background update runs in the home folder" || bad "qmd-mcp update cwd: [$(cat "$T/update.cwd" 2>/dev/null)]"
# The lock of a live holder: a node process that writes its own pid there (what the shell knows as $! is another
# process on Windows) and waits to be released, at most 30 s. No second update, the server still starts.
mkdir -p "$LK"
node_stub "$T/holder" 'fs.writeFileSync(A[0], String(process.pid))
const sleeper = new Int32Array(new SharedArrayBuffer(4))
for (let n = 0; n < 300 && !fs.existsSync(T + "/holder.go"); n++) Atomics.wait(sleeper, 0, 0, 100)
fs.writeFileSync(T + "/holder.ended", "")'
node "$T/holder" "$LK/pid" &
n=0; while [ ! -s "$LK/pid" ] && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n + 1)); done
rm -f "$T/mcp.calls"
mcp_with_update; rc=$?
[ "$rc" -eq 0 ] && grep -q '^mcp' "$T/mcp.calls" && [ "$(grep -c '^update' "$T/mcp.calls")" = 0 ] && [ -d "$LK" ] \
    && ok "qmd-mcp: a lock of a live holder -> no second update, the server still starts" || bad "qmd-mcp live lock: rc=$rc calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
: >"$T/holder.go"
n=0; while [ "$n" -lt 300 ] && [ ! -e "$T/holder.ended" ]; do sleep 0.1; n=$((n + 1)); done
rm -rf "$LK"
# The lock of a pid that is gone: taken.
mkdir -p "$LK"; printf '999999' >"$LK/pid"
rm -f "$T/mcp.calls"
mcp_with_update; rc=$?
n=0; while { [ -e "$LK" ] || ! grep -q '^embed' "$T/mcp.calls" 2>/dev/null; } && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n + 1)); done
grep -q '^update' "$T/mcp.calls" && ok "qmd-mcp: a lock of a dead pid is abandoned: taken, the update runs" || bad "qmd-mcp dead lock: calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
rm -f "$HH/qmd-models"

# --- 8. the plugin: .mcp.json, the agents' tools, the Stop hook ----------------------------
PLUGIN="$(cd "$BIN/.." && pwd)"
[ "$(jq -r '.mcpServers.qmd.command' "$PLUGIN/.mcp.json" 2>/dev/null)" = node ] \
    && [ "$(jq -r '.mcpServers.qmd.args | join(" ")' "$PLUGIN/.mcp.json" 2>/dev/null)" = '${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp' ] && [ -f "$PLUGIN/bin/qmd-mcp" ] \
    && ok ".mcp.json: server qmd runs node \${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp" || bad ".mcp.json: $(cat "$PLUGIN/.mcp.json" 2>/dev/null)"
for a in scout reviewer; do
    line="$(grep -m1 '^tools:' "$PLUGIN/agents/$a.md")"
    n=0; for t in query get multi_get status; do [[ "$line" == *"mcp__plugin_worfy_qmd__$t"* ]] && n=$((n + 1)); done
    [ "$n" = 4 ] && ok "$a: tools name the four mcp__plugin_worfy_qmd__ tools" || bad "$a: tools: $line"
done
# The old tool prefix is spelled in two halves, so this file does not match itself.
grep -rn 'mcp__''qmd__' "$PLUGIN" >/dev/null; rc=$?
[ "$rc" -eq 1 ] && ok "no old qmd tool names (mcp__ + qmd__) left in the plugin (grep exit 1)" || bad "old qmd tool names in the plugin: grep exit $rc"
jq -e '[.hooks.Stop[].hooks[].command] | index("node \"${CLAUDE_PLUGIN_ROOT}/bin/qmd-refresh\" --quiet") != null' "$PLUGIN/hooks/hooks.json" >/dev/null \
    && ok "hooks.json: Stop runs node bin/qmd-refresh --quiet" || bad "hooks.json: no Stop hook bin/qmd-refresh --quiet"
for s in qmd-mcp qmd-refresh qmd-sync-main; do
    [ "$(head -n 1 "$PLUGIN/bin/$s")" = '#!/usr/bin/env node' ] && ok "bin/$s starts with #!/usr/bin/env node" || bad "bin/$s: $(head -n 1 "$PLUGIN/bin/$s")"
done

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
