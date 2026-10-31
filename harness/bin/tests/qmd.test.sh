#!/usr/bin/env bash
# Tests of harness/bin/qmd-sync-main, qmd-refresh and qmd-mcp on temporary directories (no network needed: origin is a local bare repository).
# The scripts run as `node <script>`, as harness/.mcp.json and harness/hooks/hooks.json start them; the
# stand-ins they start are Node scripts too, so the file runs the same on macOS, Linux and in Git Bash.
#   - qmd-sync-main: a copy that is not the root of its own repository — refusal without fetch/checkout;
#   - qmd-refresh: one broken profile / one missing copy do not stop the run —
#     qmd update is still called; with --quiet (Stop hook) exit 0, without --quiet — 1;
#     qmd embed only after the consent to the models;
#   - qmd-mcp: without the answer "downloaded", without qmd or on a node qmd dies on no server and one
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
# The Harness home comes from os.homedir(), which on Windows is USERPROFILE and not the HOME of a case: no case
# reads the real one. A case that is about the Harness home sets its own.
export HARNESS_HOME="$T/hh-default"
unset EVAL_HARNESS_HOME QMD_RERUN_ON_NVM
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
  prefixed:
    path: $T/z
    update: /opt/bin/node "/x/qmd-sync-main" prefixed
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
[[ "$out" == *"profile prefixed not resolved"* ]] \
    && ok "refresh: an update line that starts with a node's full path is read as a git copy" || bad "refresh, update line with a full node path: out=${out:0:300}"
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
# The marker lies in qmd's cache folder, where qmd-refresh looks for it, also when XDG_CACHE_HOME moves that folder.
XDG_CACHE_HOME="$T/xdg" HOME="$T/home-xdg" TMPDIR="$T/tmp-sync" CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile-reason" \
    node "$BIN/qmd-sync-main" x 2>/dev/null
[ -s "$T/xdg/qmd/sync-failed-x" ] && [ ! -e "$T/home-xdg/.cache/qmd/sync-failed-x" ] \
    && ok "sync: the marker follows XDG_CACHE_HOME" || bad "sync: the marker is not in the XDG cache folder"
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
# SIGTERM while qmd update runs: the signal to this process alone waits for the update to end, and the lock is gone.
mkdir -p "$T/sigbin"
node_stub "$T/sigbin/qmd" 'fs.appendFileSync(T + "/sig.calls", A[0] + "\n")
const sleeper = new Int32Array(new SharedArrayBuffer(4))
for (let n = 0; n < 300 && A[0] === "update" && !fs.existsSync(T + "/sig.go"); n++) Atomics.wait(sleeper, 0, 0, 100)'
HOME="$H" PATH="$(onpath "$T/sigbin"):$PATH" QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-warn" \
    node "$BIN/qmd-refresh" --wait --force --quiet >/dev/null 2>&1 &
sig_pid=$!
n=0; while [ ! -s "$T/sig.calls" ] && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n + 1)); done
held=no; [ -d "$H/.cache/qmd/refresh.lock" ] && held=yes
kill -TERM "$sig_pid" 2>/dev/null
: >"$T/sig.go"
wait "$sig_pid" 2>/dev/null
[ "$held" = yes ] && [ ! -e "$H/.cache/qmd/refresh.lock" ] \
    && ok "refresh: SIGTERM during qmd update -> the lock is gone once the update ends" || bad "refresh: SIGTERM during qmd update: held=$held, lock left=$([ -e "$H/.cache/qmd/refresh.lock" ] && echo yes || echo no)"
fi
# The listener of a signal runs only after the synchronous update, when the lock is let go and another holder may
# have it. It only ends the process with the signal's code. process.emit runs the listener on every system.
LIB="$BIN/../lib/qmd-common.cjs"
cat >"$T/emit-signal.cjs" <<'EOF'
const q = require(process.argv[2])
q.takeLock()
q.runUpdate(process.argv[3], "", false)
q.takeLock() // another holder
process.emit("SIGTERM", "SIGTERM")
EOF
HOME="$H" node "$T/emit-signal.cjs" "$LIB" "$T/fakebin/qmd" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 143 ] && [ -d "$H/.cache/qmd/refresh.lock" ] \
    && ok "the signal listener only ends the process: exit 143, the lock another holder took stays" || bad "signal listener: rc=$rc, lock left=$([ -e "$H/.cache/qmd/refresh.lock" ] && echo yes || echo no)"
rm -rf "$H/.cache/qmd/refresh.lock"

# --- 6a. qmd-refresh --quiet always exits 0 --------------------------------------------------
# A file where qmd's cache folder should be: nothing can be written, not even the log.
QB="$T/home-broken"; mkdir -p "$QB/.cache"; : >"$QB/.cache/qmd"
out="$(HOME="$QB" PATH="$FAKEBIN:$PATH" QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-warn" node "$BIN/qmd-refresh" --force --quiet 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "refresh --quiet: the cache folder is a file -> exit 0, no output" || bad "refresh --quiet, broken cache folder: rc=$rc out=${out:0:300}"
# A failure with a working log: the reason goes there.
QL="$T/home-logged"; mkdir -p "$QL/.cache/qmd/last-check"
touch -t 201001010000 "$QL/.cache/qmd/last-check"; : >"$QL/.cache/qmd/last-index"
out="$(HOME="$QL" PATH="$FAKEBIN:$PATH" QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-warn" node "$BIN/qmd-refresh" --quiet 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && grep -q 'qmd-refresh: .*last-check' "$QL/.cache/qmd/refresh.log" 2>/dev/null \
    && ok "refresh --quiet: an error -> exit 0, the reason in the log" || bad "refresh --quiet, error: rc=$rc out=${out:0:200} log=[$(cat "$QL/.cache/qmd/refresh.log" 2>/dev/null)]"

# --- 6c. the path of the Stop hook: no --force, last-index present -----------------------------
SH="$T/home-stop"; SC="$SH/.cache/qmd"; mkdir -p "$SC" "$T/stopbin" "$T/stop-mem/deep"
node_stub "$T/stopbin/qmd" 'fs.appendFileSync(T + "/stop.calls", A[0] + "\n")'
gq clone -q "$T/origin.git" "$T/stop-copy" 2>/dev/null
node_stub "$T/sync-stop" 'if (A[0] === "--describe") process.stdout.write(T + "/stop-copy\tmain\t\n")'
cat >"$T/index-stop.yml" <<EOF
collections:
  copy:
    path: $T/stop-copy
    update: node "/x/qmd-sync-main" stop
  memory:
    path: $T/stop-mem
EOF
# Dates far apart, so that no case depends on the clock: a note before the last update, the update, a note after it.
BEFORE=200501010000 UPDATED=201001010000 AFTER=201501010000
touch -t "$BEFORE" "$T/stop-mem/old.md"
main_moves() { gq -C "$T/seed" commit -q --allow-empty -m moved && gq -C "$T/seed" push -q origin HEAD:main 2>/dev/null; }
copy_at_main() { gq -C "$T/stop-copy" fetch -q origin main 2>/dev/null; gq -C "$T/stop-copy" checkout -q --detach origin/main 2>/dev/null; }
stop_state() { # $1: recent — the last network check just now; old — long ago; none
    rm -f "$T/stop.calls" "$SC/last-check"
    touch -t "$UPDATED" "$SC/last-index"
    case "$1" in recent) : >"$SC/last-check" ;; old) touch -t "$UPDATED" "$SC/last-check" ;; esac
}
stop_hook() { # the arguments of qmd-refresh; --wait, because a test reads what ran
    HOME="$SH" PATH="$(onpath "$T/stopbin"):$PATH" QMD_INDEX_YML="${STOP_INDEX:-$T/index-stop.yml}" QMD_REFRESH_SYNC="${STOP_SYNC:-$T/sync-stop}" \
        node "$BIN/qmd-refresh" --wait "$@" 2>&1
}
ran_update() { grep -qx update "$T/stop.calls" 2>/dev/null; }
copy_at_main
# No last-index: the first update, whatever the rate limit says.
# Without a local collection: a note with any date would also read as newer than no last-index at all.
cat >"$T/index-stop-copy.yml" <<EOF
collections:
  copy:
    path: $T/stop-copy
    update: node "/x/qmd-sync-main" stop
EOF
stop_state recent; rm -f "$SC/last-index"; STOP_INDEX="$T/index-stop-copy.yml" stop_hook --quiet >/dev/null
ran_update && ok "stop hook: no last-index -> update, under the rate limit too" || bad "stop hook, no last-index: no update"
stop_state none; out="$(stop_hook)"
! ran_update && [ -e "$SC/last-check" ] && [[ "$out" == *"the index is already at"* ]] \
    && ok "stop hook: main has not moved, no newer note -> no update, the check is recorded" || bad "stop hook, main not moved: out=${out:0:200} calls=[$(cat "$T/stop.calls" 2>/dev/null)]"
stop_state old; stop_hook --quiet >/dev/null
! ran_update && ok "stop hook: an old check, main has not moved -> no update" || bad "stop hook, old check, main not moved: update ran"
main_moves
stop_state recent; out="$(stop_hook)"
! ran_update && [[ "$out" == *"s ago, skipping"* ]] \
    && ok "stop hook: main moved, but checked just now -> the rate limit skips the network and the update" || bad "stop hook, rate limit: out=${out:0:200} calls=[$(cat "$T/stop.calls" 2>/dev/null)]"
stop_state old; stop_hook --quiet >/dev/null
ran_update && ok "stop hook: main moved, an old check -> update" || bad "stop hook, main moved: no update"
stop_state none; stop_hook --quiet >/dev/null
ran_update && ok "stop hook: main moved, no check yet -> update" || bad "stop hook, main moved, no check yet: no update"
copy_at_main
touch -t "$AFTER" "$T/stop-mem/deep/new.md"
stop_state recent; stop_hook --quiet >/dev/null
ran_update && ok "stop hook: a note newer than last-index, in a subfolder -> update, under the rate limit too" || bad "stop hook, newer note: no update"
rm -f "$T/stop-mem/deep/new.md"
touch -t "$AFTER" "$T/stop-mem/new.txt"
stop_state recent; stop_hook --quiet >/dev/null
! ran_update && ok "stop hook: a newer file that is not .md -> no update" || bad "stop hook, newer .txt: update ran"
rm -f "$T/stop-mem/new.txt"
# The marker of a failed pull: shown by hand, under the rate limit too, and not by the hook.
printf 'pull failed for a reason\n' >"$SC/sync-failed-stop"; printf 'not a marker\n' >"$SC/other-file"
stop_state recent; out="$(stop_hook)"
[[ "$out" == *"WARNING"*"pull failed for a reason"* ]] && [[ "$out" != *"not a marker"* ]] \
    && ok "refresh by hand: the marker of a failed pull is shown as a warning" || bad "refresh, sync-failed: out=${out:0:300}"
stop_state recent; out="$(stop_hook --quiet)"
[ -z "$out" ] && ok "stop hook: the marker of a failed pull prints nothing" || bad "stop hook, sync-failed: out=${out:0:300}"
rm -f "$SC/sync-failed-stop" "$SC/other-file"
# A warning goes to the log only past the rate limit: otherwise the log grows by a line on every turn.
rm -f "$SC/refresh.log"
stop_state recent; STOP_SYNC="$T/sync-fail" STOP_INDEX="$T/index-warn.yml" stop_hook --quiet >/dev/null
[ ! -e "$SC/refresh.log" ] && ok "stop hook: under the rate limit a warning is not logged" || bad "stop hook: logged under the rate limit: [$(cat "$SC/refresh.log")]"
stop_state old; STOP_SYNC="$T/sync-fail" STOP_INDEX="$T/index-warn.yml" stop_hook --quiet >/dev/null
grep -q 'profile warns not resolved' "$SC/refresh.log" 2>/dev/null && ok "stop hook: past the rate limit the warning is logged" || bad "stop hook: no warning in the log past the rate limit"

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
# A Stop hook starts in a session's worktree, and on Windows a process's current folder cannot be moved or removed.
if [ "$WIN" = 1 ]; then
    mkdir -p "$T/hook-cwd"; rm -f "$T/slow.go" "$T/slow.calls"
    (cd "$T/hook-cwd" && HOME="$H" PATH="$(onpath "$T/slowbin"):$PATH" QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-warn" \
        node "$BIN/qmd-refresh" --force --quiet >/dev/null 2>&1)
    n=0; while [ ! -e "$T/slow.calls" ] && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n + 1)); done
    moved=no; mv "$T/hook-cwd" "$T/hook-cwd-moved" 2>/dev/null && moved=yes
    : >"$T/slow.go"
    n=0; while [ -e "$LK" ] && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n + 1)); done
    [ "$moved" = yes ] && ok "refresh in the background: the update does not hold the folder the hook started in" || bad "refresh in the background: the folder of the hook is held (EBUSY)"
fi

# qmd-refresh that cannot run qmd: without --quiet one stderr line with the grep fallback, with --quiet nothing and 0.
EMPTY_PREFIX="$T/empty-prefix"; mkdir -p "$EMPTY_PREFIX/bin"
# link_node <folder>: this node under its name in the folder, as a link where the system allows it. A folder with only
# that on the PATH has no qmd, also on a Mac where qmd lies next to the node of nvm.
link_node() {
    local real; real="$(onpath "$(node -p process.execPath)")"
    mkdir -p "$1"
    if [ "$WIN" = 1 ]; then ln "$real" "$1/node.exe" 2>/dev/null || cp "$real" "$1/node.exe"; else ln -s "$real" "$1/node"; fi
}
link_node "$T/node-only"; NODE_ONLY="$(onpath "$T/node-only")"
no_qmd_env() { env HOME="$H" PATH="$NODE_ONLY" QMD_NPM_PREFIX="$EMPTY_PREFIX" QMD_INDEX_YML="$T/index-warn.yml" "$@"; }
no_qmd_env node "$BIN/qmd-refresh" >"$T/nq.out" 2>"$T/nq.err"; rc=$?
[ "$rc" -eq 127 ] && [ ! -s "$T/nq.out" ] && [ "$(wc -l <"$T/nq.err" | tr -d ' ')" = 1 ] && grep -q 'qmd.fallback_grep' "$T/nq.err" \
    && ok "refresh without qmd: exit 127, one stderr line with the grep fallback" || bad "refresh without qmd: rc=$rc err=[$(cat "$T/nq.err")]"
no_qmd_env node "$BIN/qmd-refresh" --quiet >"$T/nq.out" 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ ! -s "$T/nq.out" ] && ok "refresh --quiet without qmd: exit 0, no output" || bad "refresh --quiet without qmd: rc=$rc out=[$(cat "$T/nq.out")]"
# Under --quiet grep being the fallback leaves one line in the log, at most once a day, and nothing on a stream.
QF="$T/home-fallback"; FL="$QF/.cache/qmd/refresh.log"; mkdir -p "$QF"
quiet_no_qmd() { env HOME="$QF" PATH="$NODE_ONLY" QMD_NPM_PREFIX="$EMPTY_PREFIX" QMD_INDEX_YML="$T/index-warn.yml" "$@" node "$BIN/qmd-refresh" --quiet 2>&1; }
out="$(quiet_no_qmd)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && [ "$(wc -l <"$FL" | tr -d ' ')" = 1 ] && grep -q 'qmd not found' "$FL" && grep -q 'qmd.fallback_grep' "$FL" \
    && ok "refresh --quiet without qmd: one line in the log with the grep fallback, nothing on a stream" || bad "refresh --quiet, fallback line: rc=$rc out=[$out] log=[$(cat "$FL" 2>/dev/null)]"
quiet_no_qmd >/dev/null
[ "$(wc -l <"$FL" | tr -d ' ')" = 1 ] && ok "refresh --quiet: the second run of the day adds no line" || bad "refresh --quiet: lines in the log: $(wc -l <"$FL")"
touch -t 201001010000 "$QF/.cache/qmd/fallback-logged"
quiet_no_qmd >/dev/null
[ "$(wc -l <"$FL" | tr -d ' ')" = 2 ] && ok "refresh --quiet: a day later one more line" || bad "refresh --quiet, a day later: lines in the log: $(wc -l <"$FL")"
rm -f "$FL" "$QF/.cache/qmd/fallback-logged"
out="$(quiet_no_qmd QMD_NODE_VERSION=22.13.1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && grep -q '22.13.1 is too old for qmd' "$FL" && grep -q 'qmd.fallback_grep' "$FL" \
    && ok "refresh --quiet on an old node: the line in the log" || bad "refresh --quiet on an old node: rc=$rc out=[$out] log=[$(cat "$FL" 2>/dev/null)]"
rm -f "$FL" "$QF/.cache/qmd/fallback-logged"
out="$(quiet_no_qmd QMD_INDEX_YML="$T/no-such.yml")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && grep -q 'no-such.yml' "$FL" && grep -q 'qmd.fallback_grep' "$FL" \
    && ok "refresh --quiet, no index.yml: the line in the log" || bad "refresh --quiet, no index.yml, log: rc=$rc out=[$out] log=[$(cat "$FL" 2>/dev/null)]"
out="$(env HOME="$QB" PATH="$NODE_ONLY" QMD_NPM_PREFIX="$EMPTY_PREFIX" QMD_INDEX_YML="$T/index-warn.yml" node "$BIN/qmd-refresh" --quiet 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "refresh --quiet without qmd, the log cannot be written: exit 0, no output" || bad "refresh --quiet, no log: rc=$rc out=[$out]"
# The Stop hook on a machine without qmd has no index.yml either: it ends before `npm prefix -g`, on every turn.
mkdir -p "$T/npmbin"
printf '#!/bin/sh\necho called >>"$NPM_CALLS"\n' >"$T/npmbin/npm"; chmod +x "$T/npmbin/npm"
printf '@echo called>>"%%NPM_CALLS%%"\r\n' >"$T/npmbin/npm.cmd"
# On Windows node starts npm through cmd.exe: named here, because this PATH does not have it and the empty-HOME
# run of this file has no COMSPEC.
WIN_SHELL=""; [ "$WIN" = 1 ] && WIN_SHELL="$(cygpath -w -S)\\cmd.exe"
npm_env() { env HOME="$H" PATH="$(onpath "$T/npmbin"):$NODE_ONLY" NPM_CALLS="$T/npm.calls" COMSPEC="$WIN_SHELL" "$@"; }
rm -f "$T/npm.calls"
npm_env QMD_INDEX_YML="$T/no-such.yml" node "$BIN/qmd-refresh" --quiet >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] && [ ! -e "$T/npm.calls" ] && ok "refresh --quiet, no index.yml: exit 0, npm is not run" || bad "refresh --quiet, no index.yml: rc=$rc npm calls=[$(cat "$T/npm.calls" 2>/dev/null)]"
npm_env QMD_INDEX_YML="$T/index-warn.yml" node "$BIN/qmd-refresh" --quiet >/dev/null 2>&1
[ -e "$T/npm.calls" ] && ok "refresh --quiet, index.yml and no qmd on the PATH: npm is asked for its folder" || bad "refresh --quiet: the npm stand-in was not reached"
npm_env QMD_INDEX_YML="$T/no-such.yml" node "$BIN/qmd-refresh" >/dev/null 2>"$T/nq.err"; rc=$?
[ "$rc" -eq 127 ] && grep -q 'qmd.fallback_grep' "$T/nq.err" && ok "refresh by hand, no index.yml and no qmd: the reason qmd cannot run comes first" || bad "refresh by hand, no index.yml: rc=$rc err=[$(cat "$T/nq.err")]"
HOME="$H" PATH="$FAKEBIN:$PATH" QMD_NODE_VERSION=22.13.1 QMD_INDEX_YML="$T/index-warn.yml" node "$BIN/qmd-refresh" >"$T/old.out" 2>"$T/old.err"; rc=$?
[ "$rc" -eq 3 ] && [ "$(wc -l <"$T/old.err" | tr -d ' ')" = 1 ] && grep -q '22.13.1 is too old for qmd' "$T/old.err" && grep -q 'qmd.fallback_grep' "$T/old.err" \
    && ok "refresh on node 22.13.1: exit 3, one stderr line with the version and the grep fallback" || bad "refresh on an old node: rc=$rc err=[$(cat "$T/old.err")]"
out="$(HOME="$H" PATH="$FAKEBIN:$PATH" QMD_NODE_VERSION=22.13.1 QMD_INDEX_YML="$T/index-warn.yml" node "$BIN/qmd-refresh" --quiet 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "refresh --quiet on node 22.13.1: exit 0, no output" || bad "refresh --quiet on an old node: rc=$rc out=${out:0:200}"
HOME="$H" PATH="$FAKEBIN:$PATH" QMD_NODE_VERSION=23.5.0 QMD_INDEX_YML="$T/index-warn.yml" node "$BIN/qmd-refresh" >/dev/null 2>"$T/old.err"; rc=$?
[ "$rc" -eq 3 ] && grep -q '23.5.0 is too old for qmd' "$T/old.err" && ok "refresh on node 23.5.0: exit 3, the 23 line got N-API 10 in 23.6" || bad "refresh on node 23.5.0: rc=$rc err=[$(cat "$T/old.err")]"

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
QMD_GENERATE_MODEL=left-from-the-shell run_mcp en downloaded; rc=$?
[ "$rc" -eq 0 ] && [ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=unset emb=$EMB" ] \
    && ok "qmd-mcp, language.docs en: a QMD_GENERATE_MODEL of the environment is deleted" || bad "qmd-mcp, QMD_GENERATE_MODEL in the environment: rc=$rc calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
# The update log: emptied above one megabyte when the server starts, left alone up to it.
head -c 1000001 /dev/zero >"$H/.cache/qmd/refresh.log"
run_mcp en downloaded
[ "$(wc -c <"$H/.cache/qmd/refresh.log" | tr -d ' ')" = 0 ] && ok "qmd-mcp: a log above 1 MB is emptied" || bad "qmd-mcp: a log above 1 MB stays, $(wc -c <"$H/.cache/qmd/refresh.log") bytes"
head -c 1000000 /dev/zero >"$H/.cache/qmd/refresh.log"
run_mcp en downloaded
[ "$(wc -c <"$H/.cache/qmd/refresh.log" | tr -d ' ')" = 1000000 ] && ok "qmd-mcp: a log of 1 MB stays" || bad "qmd-mcp: a log of 1 MB changed, $(wc -c <"$H/.cache/qmd/refresh.log") bytes"
rm -f "$H/.cache/qmd/refresh.log"
# The Harness home is the one hooks/eval-env.cjs names: EVAL_HARNESS_HOME counts, and on Windows the folder is
# under USERPROFILE, not under a HOME set by Git Bash or a user.
mcp_answer_in() { # env assignments for the run; HARNESS_HOME is not set
    rm -f "$T/mcp.calls"
    (cd "$T/session" && env -u HARNESS_HOME HOME="$T/home-a" PATH="$MCPBIN:$PATH" QMD_MCP_NO_REFRESH=1 QMD_MCP_PROFILE_BIN="$T/profile-lang" LANG_DOCS=en "$@" \
        node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null)
}
mkdir -p "$T/evalh" "$T/home-a"; printf 'downloaded\n' >"$T/evalh/qmd-models"
mcp_answer_in EVAL_HARNESS_HOME="$T/evalh"; rc=$?
[ "$rc" -eq 0 ] && [ -e "$T/mcp.calls" ] && ok "qmd-mcp: the answer is read from EVAL_HARNESS_HOME" || bad "qmd-mcp, EVAL_HARNESS_HOME: rc=$rc err=[$(cat "$T/mcp.err")]"
if [ "$WIN" = 1 ]; then OS_HOME="$T/home-b"; else OS_HOME="$T/home-a"; fi
mkdir -p "$OS_HOME/.claude/worfy-harness"; printf 'downloaded\n' >"$OS_HOME/.claude/worfy-harness/qmd-models"
mcp_answer_in USERPROFILE="$T/home-b"; rc=$?
[ "$rc" -eq 0 ] && [ -e "$T/mcp.calls" ] && ok "qmd-mcp: the default Harness home is under the system's home folder" || bad "qmd-mcp, default Harness home: rc=$rc err=[$(cat "$T/mcp.err")]"
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
[ "$rc" -eq 3 ] && [ "$(wc -l <"$T/mcp.err" | tr -d ' ')" = 1 ] && grep -q '22.13.1 is too old for qmd' "$T/mcp.err" && grep -q 'qmd.fallback_grep' "$T/mcp.err" && [ ! -e "$T/mcp.calls" ] \
    && ok "qmd-mcp on node 22.13.1: exit 3, one line with the version and the grep fallback, qmd not started" || bad "qmd-mcp on an old node: rc=$rc err=[$(cat "$T/mcp.err")]"
(cd "$T/session" && HOME="$H" HARNESS_HOME="$HH" PATH="$MCPBIN:$PATH" QMD_MCP_NO_REFRESH=1 QMD_NODE_VERSION=22.14.0 QMD_MCP_PROFILE_BIN="$T/profile-lang" LANG_DOCS=en node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null); rc=$?
[ "$rc" -eq 0 ] && [ -e "$T/mcp.calls" ] && ok "qmd-mcp on node 22.14.0: qmd mcp starts" || bad "qmd-mcp on 22.14.0: rc=$rc err=[$(cat "$T/mcp.err")]"

# No qmd anywhere: exit 127, one line with the grep fallback.
(cd "$T/session" && no_qmd_env HARNESS_HOME="$HH" QMD_MCP_NO_REFRESH=1 node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null); rc=$?
[ "$rc" -eq 127 ] && [ "$(wc -l <"$T/mcp.err" | tr -d ' ')" = 1 ] && grep -q 'qmd not found' "$T/mcp.err" && grep -q 'qmd.fallback_grep' "$T/mcp.err" \
    && ok "qmd-mcp without qmd: exit 127, one line with the grep fallback" || bad "qmd-mcp without qmd: rc=$rc err=[$(cat "$T/mcp.err")]"

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
rm -f "$T/mcp.calls"
(cd "$T/session" && env HOME="$H" HARNESS_HOME="$HH" PATH="$NODE_ONLY" QMD_NPM_PREFIX="$PREFIX" QMD_MCP_NO_REFRESH=1 QMD_MCP_PROFILE_BIN="$T/profile-lang" LANG_DOCS=en \
    node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null); rc=$?
[ "$rc" -eq 0 ] && [ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=unset emb=$EMB" ] \
    && ok "qmd-mcp: qmd in the global folder of npm is found and started" || bad "qmd-mcp npm folder: rc=$rc err=[$(cat "$T/mcp.err")] calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"

# qmd of nvm, a Mac app started without the user's PATH: found in $HOME/.nvm/versions/node/<version>/bin.
NVM_V="$T/home-nvm/.nvm/versions/node/v24.1.0/bin"; mkdir -p "$NVM_V"; cp "$T/mcpbin/qmd" "$NVM_V/qmd"
mkdir -p "$T/home-nvm/.nvm/versions/node/v9.0.0/bin"; printf '#!/usr/bin/env node\nprocess.exit(9)\n' >"$T/home-nvm/.nvm/versions/node/v9.0.0/bin/qmd"; chmod +x "$T/home-nvm/.nvm/versions/node/v9.0.0/bin/qmd"
nvm_mcp() { # $1: the HOME; the rest: env assignments
    local home="$1"; shift
    rm -f "$T/mcp.calls"
    (cd "$T/session" && env HOME="$home" HARNESS_HOME="$HH" PATH="$NODE_ONLY" QMD_NPM_PREFIX="$EMPTY_PREFIX" QMD_MCP_NO_REFRESH=1 QMD_MCP_PROFILE_BIN="$T/profile-lang" LANG_DOCS=en "$@" \
        node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null)
}
nvm_mcp "$T/home-nvm"; rc=$?
[ "$rc" -eq 0 ] && [ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=unset emb=$EMB" ] \
    && ok "qmd-mcp: qmd of nvm is found, the newest version first" || bad "qmd-mcp, qmd of nvm: rc=$rc err=[$(cat "$T/mcp.err")] calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
# The first node on the PATH is too old. A node of nvm at or above the limit that has qmd runs the script again.
nvm_mcp "$T/home-nvm" QMD_NODE_VERSION=22.13.1; rc=$?
[ "$rc" -eq 3 ] && grep -q '22.13.1 is too old for qmd' "$T/mcp.err" && [ ! -e "$T/mcp.calls" ] \
    && ok "qmd-mcp on an old node, nvm has qmd but no node there: exit 3" || bad "qmd-mcp, nvm without a node: rc=$rc err=[$(cat "$T/mcp.err")]"
link_node "$NVM_V"
nvm_mcp "$T/home-nvm" QMD_NODE_VERSION=22.13.1; rc=$?
[ "$rc" -eq 0 ] && [ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=unset emb=$EMB" ] \
    && ok "qmd-mcp on an old node: the node of nvm that has qmd runs it" || bad "qmd-mcp, rerun on nvm: rc=$rc err=[$(cat "$T/mcp.err")] calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
rm -f "$T/mcp.calls"
env HOME="$T/home-nvm" HARNESS_HOME="$T/hh-default" PATH="$NODE_ONLY" QMD_NPM_PREFIX="$EMPTY_PREFIX" QMD_NODE_VERSION=22.13.1 QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-warn" \
    node "$BIN/qmd-refresh" --wait --force >/dev/null 2>"$T/nvm.err"; rc=$?
[ "$rc" -eq 0 ] && grep -q '^update' "$T/mcp.calls" 2>/dev/null && ok "qmd-refresh on an old node: the node of nvm that has qmd runs it" || bad "qmd-refresh, rerun on nvm: rc=$rc err=[$(cat "$T/nvm.err")] calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
# The newest node of nvm cannot start: the next version runs it. With no node that starts, the usual exit.
if [ "$WIN" = 1 ]; then NODE_NAME=node.exe; else NODE_NAME=node; fi
NVM_BAD="$T/home-nvm-bad/.nvm/versions/node"; mkdir -p "$NVM_BAD/v24.1.0/bin"
printf 'not a program\n' >"$NVM_BAD/v24.1.0/bin/$NODE_NAME"; chmod +x "$NVM_BAD/v24.1.0/bin/$NODE_NAME"; cp "$T/mcpbin/qmd" "$NVM_BAD/v24.1.0/bin/qmd"
nvm_mcp "$T/home-nvm-bad" QMD_NODE_VERSION=22.13.1; rc=$?
[ "$rc" -eq 3 ] && [ "$(wc -l <"$T/mcp.err" | tr -d ' ')" = 1 ] && grep -q 'qmd.fallback_grep' "$T/mcp.err" && [ ! -e "$T/mcp.calls" ] \
    && ok "qmd-mcp on an old node, the only node of nvm cannot start: exit 3, one line" || bad "qmd-mcp, broken node of nvm: rc=$rc err=[$(cat "$T/mcp.err")]"
out="$(env HOME="$T/home-nvm-bad" HARNESS_HOME="$T/hh-default" PATH="$NODE_ONLY" QMD_NPM_PREFIX="$EMPTY_PREFIX" QMD_NODE_VERSION=22.13.1 QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-warn" node "$BIN/qmd-refresh" --quiet 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "qmd-refresh --quiet on an old node, the only node of nvm cannot start: exit 0, no output" || bad "qmd-refresh --quiet, broken node of nvm: rc=$rc out=[$out]"
mkdir -p "$NVM_BAD/v22.20.0/bin"; cp "$T/mcpbin/qmd" "$NVM_BAD/v22.20.0/bin/qmd"; link_node "$NVM_BAD/v22.20.0/bin"
nvm_mcp "$T/home-nvm-bad" QMD_NODE_VERSION=22.13.1; rc=$?
[ "$rc" -eq 0 ] && [ "$(cat "$T/mcp.calls" 2>/dev/null)" = "mcp gen=unset emb=$EMB" ] \
    && ok "qmd-mcp on an old node, the newest node of nvm cannot start: the next version runs it" || bad "qmd-mcp, next version of nvm: rc=$rc err=[$(cat "$T/mcp.err")] calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
rm -f "$T/mcp.calls"
out="$(env HOME="$T/home-nvm-bad" HARNESS_HOME="$T/hh-default" PATH="$NODE_ONLY" QMD_NPM_PREFIX="$EMPTY_PREFIX" QMD_NODE_VERSION=22.13.1 QMD_INDEX_YML="$T/index-warn.yml" QMD_REFRESH_SYNC="$T/sync-warn" node "$BIN/qmd-refresh" --wait --force --quiet 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && grep -q '^update' "$T/mcp.calls" 2>/dev/null && ok "qmd-refresh --quiet, the newest node of nvm cannot start: the next version runs it, exit 0" || bad "qmd-refresh --quiet, next version of nvm: rc=$rc out=[$out] calls=[$(cat "$T/mcp.calls" 2>/dev/null)]"
NVM_OLD="$T/home-nvm-old/.nvm/versions/node/v22.13.0/bin"; mkdir -p "$NVM_OLD"; cp "$T/mcpbin/qmd" "$NVM_OLD/qmd"; link_node "$NVM_OLD"
nvm_mcp "$T/home-nvm-old" QMD_NODE_VERSION=22.13.1; rc=$?
[ "$rc" -eq 3 ] && [ ! -e "$T/mcp.calls" ] && ok "qmd-mcp on an old node, the node of nvm is below the limit too: exit 3" || bad "qmd-mcp, old node of nvm: rc=$rc err=[$(cat "$T/mcp.err")]"

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
# qmd runs an update line that starts with `node`: the first entry of the PATH is the folder of this node.
first_on_path="$(node -p 'require("fs").readFileSync(process.argv[1], "utf8").split(require("path").delimiter)[0]' "$T/update.path" 2>/dev/null)"
[ "$first_on_path" = "$(node -p 'require("path").dirname(process.execPath)')" ] \
    && ok "qmd-mcp: the first entry of the PATH of qmd update is the folder of this node" || bad "qmd-mcp, first entry of the PATH: [$first_on_path]"
if [ "$WIN" = 1 ]; then
    [ -n "$(node -p 'process.argv[1].split(";").slice(1, 2).filter((d) => require("fs").existsSync(d + "\\bash.exe") && !/system32/i.test(d)).join()' "$(cat "$T/update.path" 2>/dev/null)")" ] \
        && ok "qmd-mcp, Windows: Git Bash comes next on the PATH of qmd update" || bad "qmd-mcp PATH of the update: [$(cut -c1-300 "$T/update.path" 2>/dev/null)]"
fi
# Git Bash is found whatever the case of the variables: a copy of process.env keeps the key `Path` on Windows.
GB="$T/git-root"; mkdir -p "$GB/cmd" "$GB/bin" "$T/pf/Git/bin" "$T/lad/Programs/Git/bin"
: >"$GB/cmd/git.exe"; : >"$GB/bin/bash.exe"; : >"$T/pf/Git/bin/bash.exe"; : >"$T/lad/Programs/Git/bin/bash.exe"
cat >"$T/git-bash.cjs" <<'EOF'
const { gitBashDir } = require(process.argv[2])
const name = process.argv[3]
process.stdout.write(String(gitBashDir({ [name]: process.argv[4] })))
EOF
for row in "Path|$GB/cmd|$GB/bin" "programfiles|$T/pf|$T/pf/Git/bin" "localappdata|$T/lad|$T/lad/Programs/Git/bin"; do
    IFS='|' read -r name value want <<<"$row"
    got="$(node "$T/git-bash.cjs" "$LIB" "$name" "$value")"
    [ "$(printed "$got")" = "$(printed "$want")" ] && ok "Git Bash: the variable spelled $name is read" || bad "Git Bash, $name: [$got], not [$want]"
done
if [ "$WIN" = 1 ]; then
    cat >"$T/git-bash-win.cjs" <<'EOF'
const { gitBashDir } = require(process.argv[2])
process.stdout.write(String(gitBashDir({ Path: process.argv[3], systemroot: process.argv[4] })))
EOF
    [ "$(node "$T/git-bash-win.cjs" "$LIB" "$GB/cmd" "$(printed "$GB")")" = null ] && ok "Git Bash: a bash under the Windows folder of a lowercase systemroot does not count" || bad "Git Bash, lowercase systemroot"
fi
[ "$(printed "$(cat "$T/update.cwd" 2>/dev/null)")" = "$(printed "$H")" ] \
    && ok "qmd-mcp: the background update runs in the home folder" || bad "qmd-mcp update cwd: [$(cat "$T/update.cwd" 2>/dev/null)]"
# A relative EVAL_HARNESS_HOME resolves from the session's directory, before qmd-mcp goes to the home folder: the
# background update finds the answer there, and embed runs.
EV="$T/home-eval"; mkdir -p "$EV"; gq init -q "$T/session-git"; mkdir -p "$T/session-git/.git/worfy-harness"
printf 'downloaded\n' >"$T/session-git/.git/worfy-harness/qmd-models"
rm -f "$T/mcp.calls"
(cd "$T/session-git" && env -u HARNESS_HOME HOME="$EV" USERPROFILE="$EV" EVAL_HARNESS_HOME=worfy-harness PATH="$MCPBIN:$PATH" QMD_MCP_PROFILE_BIN="$T/profile-lang" LANG_DOCS=en \
    node "$BIN/qmd-mcp" 2>"$T/mcp.err" </dev/null); rc=$?
n=0; while [ -e "$EV/.cache/qmd/refresh.lock" ] && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n + 1)); done
[ "$rc" -eq 0 ] && grep -q '^embed' "$T/mcp.calls" 2>/dev/null \
    && ok "qmd-mcp: a relative EVAL_HARNESS_HOME reaches the background update" || bad "qmd-mcp, relative EVAL_HARNESS_HOME: rc=$rc calls=[$(cat "$T/mcp.calls" 2>/dev/null)] log=[$(tail -n 2 "$EV/.cache/qmd/refresh.log" 2>/dev/null)]"
# Which update lines count as the script of a profile: only a line that is that and nothing else.
cat >"$T/sync-of.cjs" <<'EOF'
const { syncOf } = require(process.argv[2])
const lines = [
    ['node "/x/qmd-sync-main" demo', "demo"],
    ["node /x/qmd-sync-main demo", "demo"],
    ["/x/qmd-sync-main demo", "demo"],
    ["qmd-sync-main demo", "demo"],
    ['"/a folder/qmd-sync-main" demo', "demo"],
    ['node.exe "/x/qmd-sync-main" demo', "demo"],
    ['/opt/bin/node "/x/qmd-sync-main" demo', "demo"],
    ["C:/nodejs/node.exe /x/qmd-sync-main demo", "demo"],
    ['C:\\nodejs\\node.exe "C:\\x\\qmd-sync-main" demo', "demo"],
    ['"/opt x/node" "/x/qmd-sync-main" demo', "demo"],
    ['"$NODE" "/x/qmd-sync-main" demo', "demo"],
    ["cd /x && git pull && qmd-sync-main demo && ./build-docs.sh", null],
    ["echo qmd-sync-main demo", null],
    ["qmd-sync-main demo && ./build-docs.sh", null],
    ["qmd-sync-main demo; ./build-docs.sh", null],
    ["x;qmd-sync-main demo", null],
    ["node /x/qmd-sync-main demo extra", null],
    ["node /x/qmd-sync-main --describe demo", null],
    ["python /x/qmd-sync-main demo", null],
    ["notnode /x/qmd-sync-main demo", null],
    ["/x/not-qmd-sync-main demo", null],
    ["/x/qmd-sync-main", null],
    ["", null],
]
const wrong = lines.filter(([line, profile]) => (syncOf(line)?.[1] ?? null) !== profile).map(([line]) => line)
if (syncOf(undefined) !== null) wrong.push("undefined")
process.stdout.write(wrong.join(" | "))
EOF
out="$(node "$T/sync-of.cjs" "$LIB")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "update lines: each form of the script is read, a compound line is not" || bad "update lines read wrong: rc=$rc [$out]"
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
[ "$(node -p 'require(process.argv[1]).mcpServers.qmd.command' "$PLUGIN/.mcp.json" 2>/dev/null)" = node ] \
    && [ "$(node -p 'require(process.argv[1]).mcpServers.qmd.args.join(" ")' "$PLUGIN/.mcp.json" 2>/dev/null)" = '${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp' ] && [ -f "$PLUGIN/bin/qmd-mcp" ] \
    && ok ".mcp.json: server qmd runs node \${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp" || bad ".mcp.json: $(cat "$PLUGIN/.mcp.json" 2>/dev/null)"
for a in scout reviewer; do
    line="$(grep -m1 '^tools:' "$PLUGIN/agents/$a.md")"
    n=0; for t in query get multi_get status; do [[ "$line" == *"mcp__plugin_worfy_qmd__$t"* ]] && n=$((n + 1)); done
    [ "$n" = 4 ] && ok "$a: tools name the four mcp__plugin_worfy_qmd__ tools" || bad "$a: tools: $line"
done
# The old tool prefix is spelled in two halves, so this file does not match itself.
grep -rn 'mcp__''qmd__' "$PLUGIN" >/dev/null; rc=$?
[ "$rc" -eq 1 ] && ok "no old qmd tool names (mcp__ + qmd__) left in the plugin (grep exit 1)" || bad "old qmd tool names in the plugin: grep exit $rc"
node -e 'process.exit(require(process.argv[1]).hooks.Stop.flatMap((h) => h.hooks.map((c) => c.command)).includes(process.argv[2]) ? 0 : 1)' "$PLUGIN/hooks/hooks.json" 'node "${CLAUDE_PLUGIN_ROOT}/bin/qmd-refresh" --quiet' \
    && ok "hooks.json: Stop runs node bin/qmd-refresh --quiet" || bad "hooks.json: no Stop hook bin/qmd-refresh --quiet"
for s in qmd-mcp qmd-refresh qmd-sync-main; do
    [ "$(head -n 1 "$PLUGIN/bin/$s")" = '#!/usr/bin/env node' ] && ok "bin/$s starts with #!/usr/bin/env node" || bad "bin/$s: $(head -n 1 "$PLUGIN/bin/$s")"
done

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
