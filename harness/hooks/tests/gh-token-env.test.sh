#!/usr/bin/env bash
# Tests of hooks/gh-token-env.mjs (worfy-harness ticket 18, on Node since worfy-windows ticket 04):
# the SessionStart hook that appends to $CLAUDE_ENV_FILE the line which sets GH_TOKEN of the
# project's GitHub account (github.account).
# Run: bash harness/hooks/tests/gh-token-env.test.sh; exit code 0 means everything passed.
#
# `gh` and `profile` are replaced by stubs in a temporary directory: no network, no real gh login,
# no registry, runs on Linux in CI. The stub `gh auth token` prints the marker gho_TESTSENTINEL
# instead of a token; every case checks that the marker never reaches the env file, stdout or
# stderr, and that the hook never calls `gh auth switch` or `gh auth login`. No case can start a
# real gh: gh_guard (bin/tests/gh-stand-in.sh) stops the test first if one could be reached. On
# Windows node starts only gh.com or gh.exe from PATH, never the shell stub, so the hook is pointed
# at a node stand-in of the stub through GH_TOKEN_ENV_GH there.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
HOOK="$HOOKS/gh-token-env.mjs"
MARK=gho_TESTSENTINEL
LINE='export GH_TOKEN="$(gh auth token -u IDSAD-XL 2>/dev/null)"'
NODE="$(command -v node)"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

# TP — the temporary directory for PATH and the shell (/tmp/…); T — the same directory as node
# spells it (C:/… in Git Bash on Windows, `pwd -W`), for paths that go into JSON or to node.
T="$(mktemp -d)"; TP="$(cd "$T" && pwd -P)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
# A path as node prints it: C:\… on Windows, unchanged elsewhere.
printed() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }
mkdir -p "$T/bin" "$T/project" "$T/elsewhere"
GH_LOG="$T/gh.log" PROFILE_LOG="$T/profile.log"
export PROFILE_LOG
: >"$GH_LOG"

# gh stub: logs its arguments; `auth token -u <account>` (or --user) prints the marker when the
# account is in $FAKE_GH_LOGGED_IN, otherwise fails like gh does without a login.
cat >"$T/bin/gh" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$GH_LOG"
if [ "\${1:-}" = auth ] && [ "\${2:-}" = token ] && { [ "\${3:-}" = -u ] || [ "\${3:-}" = --user ]; }; then
    for a in \${FAKE_GH_LOGGED_IN:-}; do
        [ "\$a" = "\${4:-}" ] && { printf '%s\n' $MARK; exit 0; }
    done
    echo "no oauth token found for github.com account \${4:-}" >&2
    exit 1
fi
exit 1
EOF
# profile stub: logs its arguments; answers by $FAKE_PROFILE: "code:N" exits N with nothing on
# stdout, anything else is printed as the field's value with exit 0. It is a Node script: the hook
# runs bin/profile as `node <script>`.
cat >"$T/profile.mjs" <<'EOF'
import fs from "node:fs"
fs.appendFileSync(process.env.PROFILE_LOG, process.argv.slice(2).join(" ") + "\n")
const value = process.env.FAKE_PROFILE ?? ""
const code = /^code:(.*)$/.exec(value)
if (code) process.exit(Number(code[1]))
process.stdout.write(value + "\n")
EOF
chmod +x "$T/bin/gh"
export PATH="$TP/bin:$PATH" CLAUDE_PROFILE_BIN="$T/profile.mjs"
unset GH_TOKEN GITHUB_TOKEN GH_TOKEN_ENV_GH
. "$HARNESS/bin/tests/gh-stand-in.sh"
if on_windows; then node_stand_in "$TP/bin/gh" "$TP/bin/gh.mjs"; export GH_TOKEN_ENV_GH="$TP/bin/gh.mjs"; fi
gh_guard GH_TOKEN_ENV_GH "$TP/bin/gh" "$TP/bin/gh.mjs"
# gh_guard sets GH_TOKEN to an invalid value, so that a real gh reached anyway gets no credential;
# the hook must not read it, and the cases below set their own.

ENVF="$T/env-file"
PRE='export SOMETHING_ELSE=1'
reset_env() { printf '%s\n' "$PRE" >"$ENVF"; cp "$ENVF" "$T/env-before"; }
# Runs the hook from $T/elsewhere with cwd=$T/project in the JSON; stdout and stderr go to files.
run() {
    (cd "$T/elsewhere" && printf '{"session_id":"t-1","cwd":"%s","hook_event_name":"SessionStart"}' "$T/project" \
        | "$NODE" "$HOOK" >"$T/out" 2>"$T/err")
}
# A field of the hook output in $T/out ("" when it is not JSON or has no such field).
out_ctx() {
    node -e '
let o
try { o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")) } catch { process.exit(0) }
const h = (o && o.hookSpecificOutput) || {}
if (h.hookEventName === "SessionStart" && typeof h.additionalContext === "string") process.stdout.write(h.additionalContext + "\n")' "$T/out" 2>/dev/null
}
# Checks shared by every case: exit 0, no marker anywhere, no gh auth switch/login.
common() { # $1 case name, $2 exit code
    [ "$2" -eq 0 ] && ok "$1: exit 0" || bad "$1: exit $2"
    local where leaked=""
    for where in "$ENVF" "$T/out" "$T/err"; do
        [ -f "$where" ] && grep -qF "$MARK" "$where" && leaked+=" ${where##*/}"
    done
    [ -z "$leaked" ] && ok "$1: marker not in env file, stdout, stderr" || bad "$1: marker leaked into:$leaked"
    grep -qE '^auth (switch|login)' "$GH_LOG" && bad "$1: gh auth switch/login called" || ok "$1: no gh auth switch/login"
}
unchanged() { # $1 case name
    cmp -s "$ENVF" "$T/env-before" && ok "$1: env file unchanged" || bad "$1: env file changed"
}
quiet() { # $1 case name
    [ ! -s "$T/out" ] && ok "$1: nothing on stdout" || bad "$1: stdout: $(head -c 200 "$T/out")"
}

[ -f "$HOOK" ] && ok "hook exists: hooks/gh-token-env.mjs" || bad "hook missing: $HOOK"

# 1. The account is there and gh has a login under it: one line, sourced it gives the token.
reset_env; : >"$PROFILE_LOG"
export CLAUDE_ENV_FILE="$ENVF" FAKE_PROFILE=IDSAD-XL FAKE_GH_LOGGED_IN="IDSAD-XL someone-else"
run; rc=$?
common "account with login" "$rc"
[ "$(sed -n 1p "$ENVF")" = "$PRE" ] && ok "account with login: earlier lines of the env file kept" \
    || bad "account with login: earlier line lost"
added="$(sed -n '2,$p' "$ENVF")"
[ "$added" = "$LINE" ] && ok "account with login: exactly one new line, the literal export" \
    || bad "account with login: new lines: [$added]"
got="$(bash -c 'source "$1"; printf %s "$GH_TOKEN"' _ "$ENVF")"
[ "$got" = "$MARK" ] && ok "account with login: sourcing the env file gives GH_TOKEN from gh" \
    || bad "account with login: sourced GH_TOKEN is not the gh stub's output"
grep -qxF -- "-C $T/project --field github.account" "$PROFILE_LOG" \
    && ok "account with login: project found by cwd from the hook JSON" || bad "account with login: profile args: $(cat "$PROFILE_LOG")"
quiet "account with login"

# 1a. The project's account wins over a GH_TOKEN the user exported by hand.
got="$(GH_TOKEN=user-own-token bash -c 'source "$1"; printf %s "$GH_TOKEN"' _ "$ENVF")"
[ "$got" = "$MARK" ] && ok "account with login: project account overrides the user's GH_TOKEN" \
    || bad "account with login: the user's GH_TOKEN survived"

# 1b. A second SessionStart into the same env file (resume, /clear) does not add a second line.
run; rc=$?
common "second run" "$rc"
[ "$(grep -cxF -- "$LINE" "$ENVF")" = 1 ] && ok "second run: still one export line" \
    || bad "second run: $(grep -cxF -- "$LINE" "$ENVF") export lines"

# 1c. A user GH_TOKEN in the hook's own environment does not change what the hook checks or writes.
reset_env
GH_TOKEN=user-own-token run; rc=$?
common "user GH_TOKEN in hook env" "$rc"
[ "$(sed -n '2,$p' "$ENVF")" = "$LINE" ] && ok "user GH_TOKEN in hook env: line written" \
    || bad "user GH_TOKEN in hook env: no line"

# 1d. No cwd in the JSON: the project is found by $PWD.
reset_env; : >"$PROFILE_LOG"
(cd "$T/project" && printf '{"session_id":"t-1","hook_event_name":"SessionStart"}' | "$NODE" "$HOOK" >"$T/out" 2>"$T/err"); rc=$?
common "no cwd in JSON" "$rc"
grep -qxF -- "-C $(printed "$T/project") --field github.account" "$PROFILE_LOG" \
    && ok "no cwd in JSON: project found by \$PWD" || bad "no cwd in JSON: profile args: $(cat "$PROFILE_LOG")"

# 1e. An env file without a trailing newline: the export still lands on a line of its own.
printf '%s' "$PRE" >"$ENVF"
run; rc=$?
common "env file without trailing newline" "$rc"
[ "$(sed -n 1p "$ENVF")" = "$PRE" ] && [ "$(sed -n '2,$p' "$ENVF")" = "$LINE" ] \
    && ok "env file without trailing newline: export on its own line" || bad "env file without trailing newline: $(cat "$ENVF")"

# 2. Nothing to do — the env file stays as it was, nothing on stdout, exit 0.
for c in code:3 code:4 null empty; do
    reset_env; : >"$GH_LOG"
    v="$c"; [ "$c" = empty ] && v=""
    FAKE_PROFILE="$v" run; rc=$?
    common "profile $c" "$rc"; unchanged "profile $c"; quiet "profile $c"
    [ ! -s "$GH_LOG" ] && ok "profile $c: gh not called" || bad "profile $c: gh called: $(cat "$GH_LOG")"
done

reset_env
(unset CLAUDE_ENV_FILE; run); rc=$?
common "no CLAUDE_ENV_FILE" "$rc"; unchanged "no CLAUDE_ENV_FILE"; quiet "no CLAUDE_ENV_FILE"

reset_env
CLAUDE_PROFILE_BIN="$T/no-such-profile" run; rc=$?
common "no profile script" "$rc"; unchanged "no profile script"; quiet "no profile script"

# 3. The account is there, gh has no login under it: no line, one line of context, exit 0.
reset_env
FAKE_GH_LOGGED_IN="someone-else" run; rc=$?
common "account without login" "$rc"; unchanged "account without login"
ctx="$(out_ctx)"
[[ "$ctx" == *IDSAD-XL* && "$ctx" == *"gh auth login"* ]] \
    && ok "account without login: additionalContext names the account and gh auth login" \
    || bad "account without login: stdout: $(head -c 300 "$T/out")"
[ "$(printf '%s' "$ctx" | wc -l | tr -d ' ')" = 0 ] && ok "account without login: context is one line" \
    || bad "account without login: context has several lines"

# 3a. The account is there, gh is not installed: no line, a context line, exit 0.
# PATH is an empty folder: node runs by its full path and the hook needs no other tool, so gh is
# found nowhere. GH_TOKEN_ENV_GH is unset, so the hook looks for gh itself.
mkdir -p "$T/nogh"
reset_env
(PATH="$TP/nogh"; unset GH_TOKEN_ENV_GH; run); rc=$?
common "gh not installed" "$rc"; unchanged "gh not installed"
ctx="$(out_ctx)"
[[ "$ctx" == *IDSAD-XL* && "$ctx" == *gh* ]] && ok "gh not installed: context names the account and gh" \
    || bad "gh not installed: stdout: $(head -c 300 "$T/out")"

# 4. A value that is not a GitHub login never reaches a shell line or gh.
rm -f "$T/project/pwned" "$T/elsewhere/pwned" "$T/pwned"
for v in 'x; touch pwned' '-u' 'a--b' 'trailing-' "$(printf 'a%.0s' {1..40})"; do
    reset_env; : >"$GH_LOG"
    FAKE_PROFILE="$v" run; rc=$?
    common "account [$v]" "$rc"; unchanged "account [$v]"; quiet "account [$v]"
    [ ! -s "$GH_LOG" ] && ok "account [$v]: gh not called" || bad "account [$v]: gh called: $(cat "$GH_LOG")"
done
# Source the env file too, as Claude Code would: still nothing runs.
(cd "$T/elsewhere" && bash -c 'source "$1"' _ "$ENVF")
[ ! -e "$T/project/pwned" ] && [ ! -e "$T/elsewhere/pwned" ] && [ ! -e "$T/pwned" ] \
    && ok "account [x; touch pwned]: no file pwned" || bad "account [x; touch pwned]: pwned created"

# 5. hooks.json runs the hook under SessionStart.
node -e '
const h = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).hooks
const want = "node \"${CLAUDE_PLUGIN_ROOT}/hooks/gh-token-env.mjs\""
process.exit(h.SessionStart.some((g) => g.hooks.some((k) => k.command === want)) ? 0 : 1)' "$HOOKS/hooks.json" 2>/dev/null; rc=$?
[ "$rc" -eq 0 ] && ok "hooks.json: SessionStart runs node \"\${CLAUDE_PLUGIN_ROOT}/hooks/gh-token-env.mjs\"" \
    || bad "hooks.json: no SessionStart command node \"\${CLAUDE_PLUGIN_ROOT}/hooks/gh-token-env.mjs\" (exit $rc)"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
