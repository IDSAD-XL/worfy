#!/usr/bin/env bash
# Tests of the gh override of wave-gate, on every OS: WAVE_GATE_GH set to a .mjs file runs it with node, set to
# any other program runs that program as given; both for the run lookup (gh run list) and for a leading gh of
# the ci_batch_run dispatch, while a dispatch that starts with another word (ghx, xgh) runs as written; and for
# `gh pr merge` of a checked set. Without the variable wave-gate starts gh from PATH: checked with a logging stub
# named gh first on PATH where node can start a shell script (not on Windows, where it would find a gh.exe
# instead: that case is skipped there). Every program the cases start is a logging stub; a refusing gh is first on
# PATH behind gh_guard, so a case where the override were not used reaches no real gh.
# Run: bash harness/bin/tests/gh-override.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${BIN_DIR:-$(cd "$HERE/.." && pwd)}"
WG="$BIN/wave-gate"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$HERE/gh-stand-in.sh"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-t}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-t@t}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-t}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-t@t}"
unset WAVE_GATE_GH GH_TOKEN GITHUB_TOKEN
export GH_CONFIG_DIR="$T/gh-config" WAVE_GATE_CI_TRIES=1 WAVE_GATE_CI_POLL_S=0

# The checkout wave-gate ci fetches main into, and the state file (the repository in node's spelling).
git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/repo" 2>/dev/null
echo x >"$T/repo/x.txt" && git -C "$T/repo" add -A && git -C "$T/repo" commit -q -m x && git -C "$T/repo" push -q origin HEAD:main
TIP="$(git -C "$T/repo" rev-parse HEAD)"
ci_file() { # ci_file <file> <ci_batch_run>
    node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ repo: process.argv[2], branch: "main", ci: "batch", ci_batch_run: process.argv[3] }))' \
        "$1" "$(node_path "$T/repo")" "$2"
}
log_has() { grep -qF -- "$2" "$1" 2>/dev/null; }

# The logging programs: log.mjs (a node script) appends its arguments to $OVR_LOG; ghx and xgh (a shell script,
# and a .cmd for cmd.exe on Windows) append theirs to $WORD_LOG; workflow and run in the checkout append theirs
# to $PLAIN_LOG, for bash given as a plain program (bash <word> runs ./<word> of its working directory).
L="$T/bin"; mkdir -p "$L"
printf '%s\n' 'import { appendFileSync } from "node:fs"' 'appendFileSync(process.env.OVR_LOG, process.argv.slice(2).join(" ") + "\n")' >"$L/log.mjs"
for w in ghx xgh; do
    printf '#!/usr/bin/env bash\necho "%s $*" >>"$WORD_LOG"\n' "$w" >"$L/$w"; chmod +x "$L/$w"
    printf '@echo %s %%*>>"%%WORD_LOG%%"\r\n' "$w" >"$L/$w.cmd"
done
for w in workflow run; do printf 'echo "%s $*" >>"$PLAIN_LOG"\n' "$w" >"$T/repo/$w"; done
export PATH="$L:$PATH" OVR_LOG="$T/ovr.log" WORD_LOG="$T/word.log" PLAIN_LOG="$T/plain.log"
# A refusing gh first on PATH, for any case where wave-gate would start gh itself instead of the override: a shell
# stub that logs to $REFUSED_LOG and exits 1, and on Windows a copy of false as gh.exe next to it, which node's own
# lookup of a bare gh finds there. The guard stops the test before any case if another gh could be started.
STUBS="$T/stubs"; mkdir -p "$STUBS"
printf '#!/usr/bin/env bash\necho "$*" >>"$REFUSED_LOG"\necho "refusing gh stub: the override was not used" >&2\nexit 1\n' >"$STUBS/gh"
chmod +x "$STUBS/gh"; refusing_gh_exe "$STUBS/gh"
export PATH="$STUBS:$PATH" REFUSED_LOG="$T/refused.log"
gh_guard WAVE_GATE_GH "$STUBS/gh" ""

# 1. WAVE_GATE_GH = a .mjs file: the dispatch and the run lookup both run it with node
ci_file "$T/c1.json" 'gh workflow run ci.yml --ref $ref -f job=check'
WAVE_GATE_GH="$L/log.mjs" "$WG" ci "$T/c1.json" >"$T/out" 2>&1; rc=$?
[ "$rc" -eq 3 ] && log_has "$OVR_LOG" "workflow run ci.yml --ref main -f job=check" \
    && ok ".mjs override: the dispatch's leading gh runs the .mjs with node" || bad ".mjs dispatch: exit $rc log [$(cat "$OVR_LOG" 2>/dev/null)] out $(cat "$T/out")"
log_has "$OVR_LOG" "run list --branch main --commit $TIP --event workflow_dispatch" \
    && ok ".mjs override: the run lookup runs the .mjs with node" || bad ".mjs lookup: log [$(cat "$OVR_LOG" 2>/dev/null)]"
# leading blanks before gh are still the leading gh
: >"$OVR_LOG"
ci_file "$T/c1b.json" '  gh workflow run ci.yml --ref $ref'
WAVE_GATE_GH="$L/log.mjs" "$WG" ci "$T/c1b.json" >"$T/out" 2>&1; rc=$?
log_has "$OVR_LOG" "workflow run ci.yml --ref main" && ok ".mjs override: a gh after leading blanks is rewritten too" || bad "leading blanks: exit $rc log [$(cat "$OVR_LOG")]"

# 2. WAVE_GATE_GH = another program (bash): run as given, with gh's arguments
BASH_BIN="$(node_path "$(command -v bash)")"
ci_file "$T/c2.json" 'gh workflow run ci.yml --ref $ref'
WAVE_GATE_GH="$BASH_BIN" "$WG" ci "$T/c2.json" >"$T/out" 2>&1; rc=$?
[ "$rc" -eq 3 ] && log_has "$PLAIN_LOG" "workflow run ci.yml --ref main" \
    && ok "plain override: the dispatch's leading gh runs the program as given" || bad "plain dispatch: exit $rc log [$(cat "$PLAIN_LOG" 2>/dev/null)] out $(cat "$T/out")"
log_has "$PLAIN_LOG" "run list --branch main --commit $TIP" && ok "plain override: the run lookup runs the program as given" || bad "plain lookup: log [$(cat "$PLAIN_LOG" 2>/dev/null)]"

# 3. a dispatch that does not start with the word gh runs as written, never as the override
for w in ghx xgh; do
    : >"$OVR_LOG"; : >"$WORD_LOG"
    ci_file "$T/c3$w.json" "$w workflow run ci.yml --ref \$ref"
    WAVE_GATE_GH="$L/log.mjs" "$WG" ci "$T/c3$w.json" >"$T/out" 2>&1; rc=$?
    log_has "$WORD_LOG" "$w workflow run ci.yml --ref main" && ! log_has "$OVR_LOG" "workflow run" \
        && ok "a dispatch starting with $w runs $w, not the override" || bad "$w: exit $rc word [$(cat "$WORD_LOG")] override [$(cat "$OVR_LOG")] out $(cat "$T/out")"
done

# 3b. merge: after a green check of a set of one PR, `gh pr merge` runs the .mjs with node, with the PR's number,
# --squash and its head. The .mjs only logs, so the main branch does not move and merge stops on the tree
# mismatch: only the call is checked here (wave-gate.test.sh checks the merge itself with the stub gh). The gate is
# a .mjs that reports green. ioreg and caffeinate are stubs where wave-gate would start them (macOS): no real
# screen state is read, the display is not held awake.
if ! on_windows; then
    printf '#!/usr/bin/env bash\necho "\\"IOConsoleLocked\\" = No"\n' >"$STUBS/ioreg"
    printf '#!/usr/bin/env bash\nexit 0\n' >"$STUBS/caffeinate"; chmod +x "$STUBS/ioreg" "$STUBS/caffeinate"
fi
printf '%s\n' 'process.stdout.write("[gate] зелено (full): stub\n")' >"$L/gate.mjs"
git -C "$T/repo" checkout -q -b pr7 && echo seven >"$T/repo/seven.txt" && git -C "$T/repo" add -A && git -C "$T/repo" commit -q -m "pr 7" \
    && git -C "$T/repo" push -q origin "HEAD:refs/pull/7/head" && git -C "$T/repo" checkout -q main
HEAD7="$(git -C "$T/repo" rev-parse pr7)"
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ repo: process.argv[2], branch: "main", e2e_lock: null, prepare: null,
    prs: [{ number: 7, head: process.argv[3], labels: [], platform: false }] }))' "$T/m.json" "$(node_path "$T/repo")" "$HEAD7"
WAVE_GATE_GATE="$L/gate.mjs" "$WG" check "$T/m.json" >"$T/out" 2>&1; rc=$?
: >"$OVR_LOG"
WAVE_GATE_GATE="$L/gate.mjs" WAVE_GATE_GH="$L/log.mjs" "$WG" merge "$T/m.json" >"$T/mout" 2>&1; mrc=$?
[ "$rc" -eq 0 ] && log_has "$OVR_LOG" "pr merge 7 --squash --match-head-commit $HEAD7" \
    && ok ".mjs override: the merge runs the .mjs with node: pr merge <N> --squash --match-head-commit <head>" \
    || bad "merge: check exit $rc, merge exit $mrc, log [$(cat "$OVR_LOG")] check $(tail -n 3 "$T/out") merge $(tail -n 3 "$T/mout")"
# none of the cases above reached the refusing gh: every gh call went to the override. On Windows node would start
# the gh.exe copy of false, which logs nothing, so the check cannot see it there: skipped (a case that reached it
# fails its own log check instead).
if on_windows; then
    echo "skip no case started gh itself: on Windows node starts the refusing gh.exe (a copy of false), which writes no log"
else
    [ ! -s "$REFUSED_LOG" ] && ok "no case started gh itself: the refusing stub was never run" || bad "the refusing gh stub ran: [$(cat "$REFUSED_LOG")]"
fi

# 4. no WAVE_GATE_GH: gh from PATH, here a logging stub first on PATH (the guard checks node would start it)
if on_windows; then
    echo "skip no WAVE_GATE_GH: on Windows node looks up gh.exe on PATH and cannot start the stub; the real gh is never started"
else
    G="$T/ghstub"; mkdir -p "$G"
    printf '#!/usr/bin/env bash\necho "$*" >>"$UNSET_LOG"\n' >"$G/gh"; chmod +x "$G/gh"
    export UNSET_LOG="$T/unset.log"
    ci_file "$T/c4.json" 'gh workflow run ci.yml --ref $ref'
    if ( PATH="$G:$PATH"; gh_guard WAVE_GATE_GH "$G/gh" "$G/gh.mjs" ) >"$T/out" 2>&1; then
        PATH="$G:$PATH" "$WG" ci "$T/c4.json" >"$T/out" 2>&1; rc=$?
        [ "$rc" -eq 3 ] && log_has "$UNSET_LOG" "workflow run ci.yml --ref main" && log_has "$UNSET_LOG" "run list --branch main" \
            && ok "no override: the dispatch and the run lookup start gh from PATH" || bad "no override: exit $rc log [$(cat "$UNSET_LOG" 2>/dev/null)] out $(cat "$T/out")"
    else
        bad "no override: the guard refused the stub setup, not run: $(cat "$T/out")"
    fi
fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
