#!/usr/bin/env bash
# Tests of gate.mjs and the Stop hook stop.mjs for a repository outside the gate/config.json registry.
# Run: bash harness/hooks/tests/gate-unregistered.test.sh; exit code 0 means everything passed.
#
# The registry, the state directory and the repositories are temporary (CLAUDE_GATE_CONFIG, CLAUDE_GATE_STATE):
# the test does not touch the live markers in $HARNESS_HOME/gate/state.
set -u
# The hooks under test are the copies next to this test (harness/hooks).
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; a path like
# /c/… or /tmp/… means nothing to node. Elsewhere there is no -W.
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"   # HOOKS_DIR runs the test on another copy of the hooks
GATE="$HOOKS/gate.mjs"
STOP="$HOOKS/stop.mjs"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
# The test sets the session itself through the hook JSON; the session it was started from does not count.
unset CLAUDE_CODE_SESSION_ID
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()   { pass=$((pass + 1)); echo "ok   $1"; }
bad()  { fail=$((fail + 1)); echo "FAIL $1"; }

# The home folder is a temporary one, so that the registry below is not under it and the gate
# prints its path whole, not with ~. node takes the home folder from HOME, on Windows from
# USERPROFILE. Git in an empty home has no identity: it comes from the environment.
export HOME="$T/home" USERPROFILE="$T/home"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export CLAUDE_GATE_STATE="$T/state" CLAUDE_GATE_CONFIG="$T/config.json"
mkdir -p "$T/home" "$T/state" "$T/unreg" "$T/reg"
git -C "$T/unreg" init -q && git -C "$T/unreg" commit -q --allow-empty -m init
git -C "$T/reg" init -q && git -C "$T/reg" commit -q --allow-empty -m init
printf '{"repos":[{"key":"t","match":"%s","pm":"npm","root":{},"workspace":{}}]}\n' "$T/reg" >"$CLAUDE_GATE_CONFIG"
# node, not shasum: Git Bash has shasum only where perl is on PATH.
tag() { node -e 'process.stdout.write(require("node:crypto").createHash("sha1").update(process.argv[1]).digest("hex").slice(0, 8))' "$1"; }

payload='{"session_id":"test-session"}'

# 1. gate.mjs in an unregistered repository: the message line and code 3, a marker for stop.mjs.
#    The line names the registry the gate read — here the temporary one from CLAUDE_GATE_CONFIG
#    (the gate shortens a path under the home folder to ~, so the expectation does the same).
out="$(cd "$T/unreg" && printf '%s' "$payload" | node "$GATE" fast 2>&1)"; rc=$?
tilde='~'
line="[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: проект не зарегистрирован в ${CLAUDE_GATE_CONFIG/#$HOME/$tilde}"
if [ "$rc" -eq 3 ] && printf '%s\n' "$out" | grep -qxF "$line"; then ok "gate unregistered -> exit 3 + message"
else bad "gate unregistered: exit $rc, out: ${out:0:300}"; fi
[ -s "$T/state/nokey-unregistered-$(tag "$T/unreg")-test-session" ] && ok "gate unregistered -> marker written" || bad "gate unregistered: no marker"

# 2. stop.mjs after code 3: does not hold the turn (code 0, not 2), but says "not verified" and removes the marker.
out="$(cd "$T/unreg" && printf '%s' "$payload" | node "$STOP" 2>"$T/stop.err")"; rc=$?
if [ "$rc" -eq 0 ] && [[ "$out" == *additionalContext* ]] && [[ "$out" == *"not verified"* ]] && [[ "$out" != *'"decision"'* ]] && [ ! -s "$T/stop.err" ]; then
    ok "stop after gate exit 3 -> not blocking (exit 0), says 'not verified'"
else bad "stop after exit 3: exit $rc, out: ${out:0:300}, err: $(head -c 200 "$T/stop.err")"; fi
[ ! -e "$T/state/nokey-unregistered-$(tag "$T/unreg")-test-session" ] && ok "stop consumed the marker" || bad "stop left the marker"

# 3. A second Stop without a new gate run stays silent.
out="$(cd "$T/unreg" && printf '%s' "$payload" | node "$STOP" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "stop again -> silent exit 0" || bad "stop again: exit $rc, out: ${out:0:200}"

# 4. A non-git directory is still code 0 with no output (outside the scope of Q56).
out="$(cd "$T/state" && node "$GATE" fast </dev/null 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "gate outside git -> exit 0 (unchanged)" || bad "gate outside git: exit $rc, out: ${out:0:200}"

# 5. Regression: in a registered repository the red marker still holds the turn (code 2).
date -u +%Y-%m-%dT%H:%M:%SZ >"$T/state/red-t-$(tag "$T/reg")"
out="$(cd "$T/reg" && printf '%s' "$payload" | node "$STOP" 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$out" == *"The quality gate is red"* ]] && ok "stop registered + red -> exit 2 (unchanged)" || bad "stop registered red: exit $rc, out: ${out:0:200}"

# 6. A "not registered" marker was written, then the repository was added to the registry: stop.mjs
#    does not say the stale "not verified" and silently removes the marker.
mkdir -p "$T/later"
git -C "$T/later" init -q && git -C "$T/later" commit -q --allow-empty -m init
out="$(cd "$T/later" && printf '%s' "$payload" | node "$GATE" fast 2>&1)"; rc=$?
lm="$T/state/nokey-unregistered-$(tag "$T/later")-test-session"
[ "$rc" -eq 3 ] && [ -s "$lm" ] && ok "later: gate while unregistered -> marker" || bad "later: gate exit $rc, marker missing"
printf '{"repos":[{"key":"t","match":"%s","pm":"npm","root":{},"workspace":{}},{"key":"later","match":"%s","pm":"npm","root":{},"workspace":{}}]}\n' "$T/reg" "$T/later" >"$CLAUDE_GATE_CONFIG"
out="$(cd "$T/later" && printf '%s' "$payload" | node "$STOP" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && ok "registered afterwards -> stop silent" || bad "registered afterwards: exit $rc, out: ${out:0:300}"
[ ! -e "$lm" ] && ok "registered afterwards -> stale marker dropped" || bad "registered afterwards: marker left"

# 7. Windows paths in the registry: `match` may be spelled with `\` or `/` and in any letter case,
#    and so may a file against a package folder. The comparison takes the platform as a
#    parameter, so the Windows rule is checked on every system; elsewhere it stays exact.
if node -e '
    import(require("node:url").pathToFileURL(process.argv[1]).href).then(({ isSameOrInside: same }) => {
        const ok =
            same("C:\\Users\\x\\worfy", "c:/users/x/worfy", "win32") &&
            same("C:\\Users\\x\\worfy\\.claude\\worktrees\\03", "C:/Users/x/worfy", "win32") &&
            same("c:/users/x/worfy/src", "C:\\Users\\x\\worfy", "win32") &&
            same("packages\\Shared\\a.ts", "packages/shared", "win32") &&
            !same("C:\\Users\\x\\worfy-2", "C:/Users/x/worfy", "win32") &&
            // a name that only starts like the base is another folder
            !same("C:/a/repo2", "C:/a/repo", "win32") &&
            !same("/a/repo2", "/a/repo", "linux") &&
            // a network path, with either separator
            same("\\\\srv\\share\\repo\\src", "//srv/share/repo", "win32") &&
            !same("\\\\srv\\share\\repo2", "//srv/share/repo", "win32") &&
            // a separator at the end: of the target it changes nothing; a base that already ends
            // with one does not get a second, so the folders under it still lie under it
            same("C:\\a\\repo\\", "C:/a/repo", "win32") &&
            same("C:/a/repo/src", "C:/a/repo/", "win32") &&
            same("C:\\a\\repo", "C:/a/repo/", "win32") &&
            same("/Users/x/repo", "/Users/x/repo/", "darwin") &&
            !same("C:", "C:/", "win32") &&
            !same("", "/", "linux") &&
            !same("C:/a/repo2", "C:/a/repo/", "win32") &&
            // the root of a disk ends with a separator as it is written
            same("C:\\a\\b", "C:\\", "win32") &&
            same("c:/a", "C:/", "win32") &&
            !same("D:\\a", "C:\\", "win32") &&
            same("/a", "/", "darwin") &&
            same("/a/b", "/", "linux") &&
            same("/Users/x/worfy/src", "/Users/x/worfy", "darwin") &&
            !same("/Users/x/Worfy", "/Users/x/worfy", "darwin") &&
            !same("/Users/x/a\\b", "/Users/x/a", "linux")
        process.exit(ok ? 0 : 1)
    })' "$HOOKS/gate-paths.mjs"; then ok "registry paths: on Windows either separator and any letter case, elsewhere exact"
else bad "registry paths: the comparison of gate-paths.mjs gave a wrong answer"; fi

# 8. Windows: a `match` in an 8.3 short spelling (C:\PROGRA~1, as the TEMP of an account with a long
#    name, C:\Users\RUNNER~1\…) covers the folder in its long spelling, the one git and the native
#    realpath give; a `match` through a junction stays as written and does not cover the junction's
#    target. Needs the short name C:\PROGRA~1 (made when Windows was installed) and cmd's mklink.
if [ "$(node -p 'process.platform')" != win32 ]; then
    echo "skip 8.3 and junction spellings of a registry match: Windows only"
elif [ "$(node -p 'try { require("node:fs").realpathSync.native("C:\\PROGRA~1") } catch { "" }')" != 'C:\Program Files' ]; then
    echo "skip 8.3 spelling of a registry match: this disk has no short name C:\\PROGRA~1"
else
    which8() { CLAUDE_GATE_CONFIG="$T/config8.json" node "$CLAUDE_GATE_RESOLVE" --which "$1" | cut -f1; }
    node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ repos: [{ key: "short", match: "C:\\PROGRA~1" }] }))' "$T/config8.json"
    [ "$(which8 'C:\Program Files')" = short ] && ok "8.3 spelling: match C:\\PROGRA~1 covers C:\\Program Files" \
        || bad "8.3 spelling: match C:\\PROGRA~1 does not cover C:\\Program Files"
    MSYS2_ARG_CONV_EXCL='*' cmd /c mklink /J "$(cygpath -w "$T/jn")" "$(cygpath -w "$T/reg")" >/dev/null
    node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ repos: [{ key: "junction", match: process.argv[2] }] }))' "$T/config8.json" "$T/jn"
    # Without the junction the check below would pass for nothing: first, $T/jn must lead to $T/reg.
    if [ "$(node -p 'const fs = require("node:fs"); fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(process.argv[2])' "$T/jn" "$T/reg" 2>/dev/null)" != true ]; then
        bad "junction: mklink /J made no junction $T/jn to $T/reg"
    elif [ -z "$(which8 "$T/reg")" ]; then ok "junction: a match through a junction stays as written"
    else bad "junction: a match through a junction covered the junction's target"; fi
    cmd //c rmdir "$(cygpath -w "$T/jn")"
fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
