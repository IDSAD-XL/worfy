#!/usr/bin/env bash
# Tests of the Harness rules that reach a session through hooks:
# the parts in hooks/rules/, hooks/inject-rules.mjs and the hook wiring in hooks/hooks.json.
# Run: bash harness/hooks/tests/rules-hooks.test.sh; exit code 0 means every check passed.
#
# Everything is found next to this file (harness/); nothing under $HOME is read or written.
# JSON is read with node, not jq: Git Bash on Windows has no jq.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd -P)"
# The plugin folder as node prints it: C:/… in Git Bash on Windows (`pwd -W`), the same path elsewhere.
HARNESS_N="$(cd "$HARNESS" && { pwd -W 2>/dev/null || pwd -P; })"
HOOKS="$HARNESS/hooks"
RULES="$HOOKS/rules"
INJECT="$HOOKS/inject-rules.mjs"
# Git Bash hands a native program a variable that looks like a POSIX path in Windows spelling
# (/opt/x becomes C:/Program Files/Git/opt/x). Claude Code itself gives CLAUDE_PLUGIN_ROOT as C:/…;
# the plain roots below must reach node as they are written.
export MSYS2_ENV_CONV_EXCL=CLAUDE_PLUGIN_ROOT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
# The Harness state folder, where inject-rules looks for the user's own rules file: a temporary one,
# so the real user rules never reach these checks. Empty until section 3b puts a rules file there.
export HARNESS_HOME="$T/hh"
USER_RULES="$HARNESS_HOME/user/rules.md"

# One additionalContext string is cut to a preview above this many characters.
LIMIT=10000
# A plugin root as long as a real install path is likely to get; the parts must fit with it.
LONG_ROOT="/home/someone-with-a-longer-name/.claude/plugins/cache/worfy-local-marketplace/worfy/10.20.30-build.12345"

# Characters (code points, as Claude Code counts a string), of a file or of stdin.
chars() { node -e 'process.stdout.write(String([...require("fs").readFileSync(0, "utf8")].length))' <"${1:-/dev/stdin}"; }
# A field of the hook output in $T/out ("" when it is not JSON or has no such field).
out_field() {
    node -e '
let o
try { o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")) } catch { process.exit(0) }
const v = (o && o.hookSpecificOutput || {})[process.argv[2]]
if (typeof v === "string") process.stdout.write(v + "\n")' "$T/out" "$1" 2>/dev/null
}

# --- 1. The parts: size and label --------------------------------------------------------------

[ -f "$RULES/orchestrator.md" ] && ok "orchestrator.md exists" || bad "orchestrator.md missing"
[ -f "$RULES/common.md" ] && ok "common.md exists" || bad "common.md missing"

parts=()
for f in "$RULES"/*.md; do [ -f "$f" ] && parts+=("$f"); done
[ "${#parts[@]}" -ge 2 ] && ok "at least two parts (${#parts[@]})" || bad "fewer than two parts (${#parts[@]})"

# "${parts[@]+…}": bash 3.2 (macOS) treats an empty array as unbound under set -u.
for f in ${parts[@]+"${parts[@]}"}; do
    name="$(basename "$f" .md)"
    n="$(chars "$f")"
    [ "$n" -le "$LIMIT" ] && ok "$name.md: $n characters <= $LIMIT" || bad "$name.md: $n characters > $LIMIT"
    first="$(head -n 1 "$f")"
    case "$name" in
        orchestrator) want="# worfy Harness — orchestrator rules" ;;
        common) want="# worfy Harness — common rules" ;;
        *) want="# worfy Harness — $name rules" ;;
    esac
    [ "$first" = "$want" ] && ok "$name.md: first line is the label" || bad "$name.md: first line is '$first'"
    # A part arrives in an order no one controls (hooks of one event run in parallel), so it may
    # not point at text in another part.
    if grep -qiE '\((see )?(above|below)\)|see (above|below)' "$f"; then
        bad "$name.md: points at text outside itself (above/below)"
    else
        ok "$name.md: no 'see above' pointers"
    fi
done

# --- 2. inject-rules.mjs: output for SessionStart and SubagentStart ---------------------------

[ -f "$INJECT" ] && ok "inject-rules.mjs exists" || bad "inject-rules.mjs missing"
# The bash hooks are gone; only the gate launcher gate.sh and the
# unregistered worktree-create.sh stay.
for old in inject-rules session-start session-end stop gh-token-env; do
    [ ! -e "$HOOKS/$old.sh" ] && ok "bash hook $old removed" || bad "bash hook $old still there"
done

# $1 part, $2 stdin, then env assignments; stdout -> $T/out, stderr -> $T/err, sets rc
run_inject() {
    local part="$1" input="$2"; shift 2
    (printf '%s' "$input" | env "$@" node "$INJECT" "$part" >"$T/out" 2>"$T/err"); rc=$?
}
ctx() { out_field additionalContext; }
event() { out_field hookEventName; }

for ev in SessionStart SubagentStart; do
    for part in orchestrator common; do
        input="{\"session_id\":\"t-1\",\"transcript_path\":\"/tmp/t.jsonl\",\"cwd\":\"/tmp\",\"hook_event_name\":\"$ev\",\"source\":\"startup\",\"agent_id\":\"a-1\",\"agent_type\":\"general-purpose\"}"
        run_inject "$part" "$input" CLAUDE_PLUGIN_ROOT=/opt/worfy-plugin
        [ "$rc" -eq 0 ] && ok "$ev/$part: exit 0" || bad "$ev/$part: exit $rc"
        [ "$(event)" = "$ev" ] && ok "$ev/$part: hookEventName is $ev" || bad "$ev/$part: hookEventName '$(event)'"
        expected="$(sed 's#${CLAUDE_PLUGIN_ROOT}#/opt/worfy-plugin#g' "$RULES/$part.md")"
        [ -n "$expected" ] && [ "$(ctx)" = "$expected" ] \
            && ok "$ev/$part: additionalContext is the part with the plugin root substituted" \
            || bad "$ev/$part: additionalContext differs from the part"
        if grep -qF '${CLAUDE_PLUGIN_ROOT}' "$T/out"; then
            bad "$ev/$part: \${CLAUDE_PLUGIN_ROOT} left in the output"
        else
            ok "$ev/$part: no \${CLAUDE_PLUGIN_ROOT} in the output"
        fi
        [ ! -s "$T/err" ] && ok "$ev/$part: nothing on stderr" || bad "$ev/$part: stderr '$(head -c 200 "$T/err")'"
    done
done

# The parts still fit when the plugin root is a long install path.
for part in orchestrator common; do
    run_inject "$part" '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT="$LONG_ROOT"
    n="$(ctx | chars)"
    [ "$n" -le "$LIMIT" ] && ok "$part: $n characters with a long plugin root" || bad "$part: $n characters > $LIMIT with a long plugin root"
done

# The plugin root goes in literally: a Windows path (Claude Code spells it C:/…) and characters a
# replacement pattern would read ($&, $1) arrive as they are.
WROOT='C:/Work/x/plugin $& $1'
run_inject common '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT="$WROOT"
c="$(ctx)"
[ "$rc" -eq 0 ] && [[ "$c" == *"node \"$WROOT/hooks/gate.mjs\" fast"* ]] \
    && ok "plugin root C:/… with \$& and \$1: substituted literally" || bad "plugin root not substituted literally: rc=$rc"

# --- 3. Plugin root from the script's own path; failures stay quiet ----------------------------

run_inject common '{"hook_event_name":"SubagentStart"}' -u CLAUDE_PLUGIN_ROOT
c="$(ctx)"
[ "$rc" -eq 0 ] && [[ "$c" == *"$HARNESS_N/hooks/gate.mjs"* ]] && [[ "$c" != *'${CLAUDE_PLUGIN_ROOT}'* ]] \
    && ok "no env: plugin root is the folder above hooks/ ($HARNESS_N)" \
    || bad "no env: rc=$rc, plugin root not substituted from the script path"

run_inject common '{"hook_event_name":"SubagentStart"}' CLAUDE_PLUGIN_ROOT=
c="$(ctx)"
[ "$rc" -eq 0 ] && [[ "$c" == *"$HARNESS_N/hooks/gate.mjs"* ]] \
    && ok "empty env: treated as unset" || bad "empty env: rc=$rc, plugin root not from the script path"

# $1 description: exit 0, no additionalContext, exactly one line on stderr
expect_quiet_failure() {
    local what="$1" lines
    lines="$(wc -l <"$T/err" | tr -d ' ')"
    [ "$rc" -eq 0 ] && ok "$what: exit 0" || bad "$what: exit $rc"
    if grep -q additionalContext "$T/out"; then bad "$what: additionalContext printed"; else ok "$what: no additionalContext"; fi
    [ "$lines" = 1 ] && [ -s "$T/err" ] && ok "$what: one line on stderr" || bad "$what: $lines lines on stderr"
}

run_inject no-such-part '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "missing part file"
run_inject common '' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "empty stdin"
run_inject common 'not json' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "stdin is not JSON"
run_inject common '{"session_id":"t-1"}' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "no hook_event_name"
run_inject '' '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "no part argument"
run_inject ../hooks/hooks '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT=/x
expect_quiet_failure "part name with a path"

# --- 3b. The user's own rules ($HARNESS_HOME/user/rules.md) ------------------------------------
# inject-rules appends the file to the part "common" under "## User rules", in SessionStart and in
# SubagentStart, without reading its meaning. Without the file the part is unchanged (section 2).

part_with_root() { sed 's#${CLAUDE_PLUGIN_ROOT}#/opt/worfy-plugin#g' "$RULES/$1.md"; }
mkdir -p "$HARNESS_HOME/user"
printf 'Write reports in Klingon.\n\nKeep the token ${CLAUDE_PLUGIN_ROOT} as written.\n\n' >"$USER_RULES"
for ev in SessionStart SubagentStart; do
    run_inject common "{\"hook_event_name\":\"$ev\",\"cwd\":\"/tmp\"}" CLAUDE_PLUGIN_ROOT=/opt/worfy-plugin
    want="$(part_with_root common)"$'\n\n## User rules\n\nWrite reports in Klingon.\n\nKeep the token ${CLAUDE_PLUGIN_ROOT} as written.'
    [ "$rc" -eq 0 ] && [ "$(event)" = "$ev" ] && [ "$(ctx)" = "$want" ] \
        && ok "$ev/common + user rules: the part, then '## User rules' and the file as written" \
        || bad "$ev/common + user rules: rc=$rc, additionalContext differs: $(ctx | tail -n 4 | tr '\n' '|')"
    [ ! -s "$T/err" ] && ok "$ev/common + user rules: nothing on stderr" || bad "$ev/common + user rules: stderr '$(head -c 200 "$T/err")'"
done
# Only the common part carries the user rules: it reaches the main session and every subagent.
run_inject orchestrator '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT=/opt/worfy-plugin
[ "$(ctx)" = "$(part_with_root orchestrator)" ] && ok "orchestrator part: no user rules" || bad "orchestrator part: changed by the user rules"

# An empty file adds nothing.
: >"$USER_RULES"
run_inject common '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT=/opt/worfy-plugin
[ "$(ctx)" = "$(part_with_root common)" ] && [ ! -s "$T/err" ] \
    && ok "empty user rules file: the part as before" || bad "empty user rules file: output changed"

# A file the hook cannot read (a folder at that path): the part as before and one line on stderr.
rm -f "$USER_RULES"
mkdir "$USER_RULES"
run_inject common '{"hook_event_name":"SubagentStart"}' CLAUDE_PLUGIN_ROOT=/opt/worfy-plugin
lines="$(wc -l <"$T/err" | tr -d ' ')"
[ "$rc" -eq 0 ] && [ "$(ctx)" = "$(part_with_root common)" ] && [ "$lines" = 1 ] \
    && ok "unreadable user rules: the part as before, one line on stderr" || bad "unreadable user rules: rc=$rc, $lines stderr lines"
rmdir "$USER_RULES"

# A file longer than the limit: the whole additionalContext stays within LIMIT, the file is cut
# after a whole line, and a closing line names the file.
node -e 'for (let i = 1; i <= 600; i++) process.stdout.write(`Rule ${i}: keep the Klingon words as they are in every report.\n`)' >"$USER_RULES"
HH_N="$(cd "$HARNESS_HOME" && { pwd -W 2>/dev/null || pwd -P; })" # node's spelling of the folder
for ev in SessionStart SubagentStart; do
    run_inject common "{\"hook_event_name\":\"$ev\"}" CLAUDE_PLUGIN_ROOT="$LONG_ROOT"
    c="$(ctx)"
    n="$(printf '%s' "$c" | chars)"
    [ "$rc" -eq 0 ] && [ "$n" -le "$LIMIT" ] && ok "$ev: long user rules: $n characters <= $LIMIT" || bad "$ev: long user rules: rc=$rc, $n characters"
    # On Windows the hook joins the path with "\", pwd -W spells it with "/": compare with "/" only.
    [[ "$c" == *"$HARNESS_HOME/user/rules.md"* || "${c//\\//}" == *"$HH_N/user/rules.md"* ]] \
        && ok "$ev: long user rules: the path to the file is named" || bad "$ev: long user rules: no path to the file"
    [[ "$c" == *$'\n## User rules\n\nRule 1: keep'* ]] && ok "$ev: long user rules: the start of the file is kept" || bad "$ev: long user rules: the start of the file is missing"
    # The last kept rule is whole: the cut falls between lines, not inside one.
    last="$(printf '%s\n' "$c" | grep '^Rule ' | tail -n 1)"
    [[ "$last" =~ ^Rule\ [0-9]+:\ keep\ the\ Klingon\ words\ as\ they\ are\ in\ every\ report\.$ ]] \
        && ok "$ev: long user rules: cut after a whole line (${last%%:*})" || bad "$ev: long user rules: cut inside a line: '$last'"
    [[ "$c" != *'Rule 600:'* ]] && ok "$ev: long user rules: the tail is cut" || bad "$ev: long user rules: nothing was cut"
done

# The exact text, without the trailing-newline loss of $(…): additionalContext of $T/out into $1.
ctx_raw() {
    node -e '
let o = {}
try { o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")) } catch {}
process.stdout.write(String((o && o.hookSpecificOutput || {}).additionalContext ?? ""))' "$T/out" >"$1"
}
# The head (the part and "## User rules") and the closing note of the cut output in $T/out, into
# $T/head and $T/note; their lengths in code points into HEAD_N and NOTE_N.
ctx_raw "$T/ctx"
node -e '
const fs = require("fs")
const c = fs.readFileSync(process.argv[1], "utf8")
const h = c.indexOf("\n\n## User rules\n\n") + "\n\n## User rules\n\n".length
const n = c.lastIndexOf("\n\n(The user rules are cut here")
fs.writeFileSync(process.argv[2], c.slice(0, h))
fs.writeFileSync(process.argv[3], c.slice(n))
process.stdout.write(`${[...c.slice(0, h)].length} ${[...c.slice(n)].length}`)' "$T/ctx" "$T/head" "$T/note" >"$T/sizes"
read -r HEAD_N NOTE_N <"$T/sizes"
[ "${HEAD_N:-0}" -gt 0 ] && [ "${NOTE_N:-0}" -gt 0 ] && ok "cut output: head $HEAD_N and note $NOTE_N characters" || bad "cut output: no head or note"
# Fixtures for the cut, $T/fixture.js <mode> <head> <note> <limit> <rules file> <expected rules text>.
# Every line holds characters outside the Basic Multilingual Plane (one code point, two UTF-16 units),
# so a hook that counted UTF-16 units would keep less than the limit allows.
cat >"$T/fixture.js" <<'EOF'
const fs = require("fs")
const [mode, head, note, limit, file, want] = process.argv.slice(2).map((v, i) => (i < 4 && i > 0 ? Number(v) : v))
const len = (s) => [...s].length
const make = (i, n) => {
    let s = `Rule ${i}: `
    while (len(s) < n) s += len(s) % 2 ? "\u{1F600}" : "a"
    return s
}
// lines whose text (joined with "\n", plus `extra` per line) is exactly `total` code points
const fill = (total, extra) => {
    const lines = []
    let rem = total
    while (rem > 0) {
        const sep = lines.length && !extra ? 1 : 0
        let n = Math.min(80, rem - sep - extra)
        if (rem - sep - extra - n > 0 && rem - sep - extra - n < 20) n = rem - sep - extra - 20
        lines.push(make(lines.length + 1, n))
        rem -= sep + extra + n
    }
    return lines
}
const budget = limit - head - note
let lines, kept
if (mode === "exact" || mode === "over") {
    // the whole file is the limit (exact) or one more (over); only "exact" arrives whole
    lines = fill(limit - head + (mode === "over" ? 1 : 0), 0)
    kept = mode === "exact" ? lines : null
} else if (mode === "fill") {
    // whole lines that use the budget to the last character, then lines that cannot fit
    kept = fill(budget, 1)
    lines = [...kept, ...Array.from({ length: 5 }, (_, i) => make(kept.length + i + 1, 80))]
} else {
    // alternate: long and short lines; the cut keeps the longest run of whole lines from the start
    lines = Array.from({ length: 80 }, (_, i) => make(i + 1, i % 2 ? 12 : 300))
    kept = []
    let b = budget
    for (const l of lines) {
        if (len(l) + 1 > b) break
        kept.push(l)
        b -= len(l) + 1
    }
}
fs.writeFileSync(file, lines.join("\n") + "\n")
if (mode === "over") {
    // cut: a run of whole lines from the start; nothing more is checked here
    fs.writeFileSync(want, "")
} else fs.writeFileSync(want, kept.join("\n"))
EOF
# $1 name, $2 mode: the output is exactly head + the expected text (+ the note, when cut)
expect_cut() {
    local name="$1" mode="$2" n
    node "$T/fixture.js" "$mode" "$HEAD_N" "$NOTE_N" "$LIMIT" "$USER_RULES" "$T/want-rules"
    run_inject common '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT="$LONG_ROOT"
    ctx_raw "$T/ctx"
    if [ "$mode" = exact ]; then cat "$T/head" "$T/want-rules" >"$T/want"; else cat "$T/head" "$T/want-rules" "$T/note" >"$T/want"; fi
    n="$(chars "$T/ctx")"
    [ "$rc" -eq 0 ] && cmp -s "$T/want" "$T/ctx" && [ "$n" -le "$LIMIT" ] && [ ! -s "$T/err" ] \
        && ok "$name ($n characters)" || bad "$name: rc=$rc, $n characters, stderr '$(head -c 200 "$T/err")'"
}
expect_cut "user rules of exactly the limit with the part: arrive whole, no note" exact
expect_cut "user rules filling the budget to the last character: every fitting line kept (cost = budget fits)" fill
expect_cut "long and short lines: the cut keeps whole lines from the start, no later short line" alternate
node "$T/fixture.js" over "$HEAD_N" "$NOTE_N" "$LIMIT" "$USER_RULES" "$T/want-rules"
run_inject common '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT="$LONG_ROOT"
ctx_raw "$T/ctx"
[ "$rc" -eq 0 ] && [[ "$(cat "$T/ctx")" == *'(The user rules are cut here'* ]] && [ "$(chars "$T/ctx")" -le "$LIMIT" ] \
    && ok "user rules one character over the limit: cut, with the note" || bad "user rules one character over the limit: not cut"

# Trailing white space of the file is dropped, spaces and tabs too, not only newlines.
printf 'Rule A.\n\nRule B. \t \n \n\t\n' >"$USER_RULES"
run_inject common '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT="$LONG_ROOT"
ctx_raw "$T/ctx"
printf 'Rule A.\n\nRule B.' | cat "$T/head" - >"$T/want"
cmp -s "$T/want" "$T/ctx" && ok "user rules: trailing spaces, tabs and newlines dropped" || bad "user rules: trailing white space kept: '$(tail -c 40 "$T/ctx" | od -c | head -n 2 | tr '\n' ' ')'"
# The same at the cut: a kept line of spaces before the cut is dropped.
node -e 'process.stdout.write("Rule 1.\n   \n" + "x".repeat(12000) + "\n")' >"$USER_RULES"
run_inject common '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT="$LONG_ROOT"
ctx_raw "$T/ctx"
printf 'Rule 1.' | cat "$T/head" - "$T/note" >"$T/want"
cmp -s "$T/want" "$T/ctx" && ok "cut user rules: trailing white space before the note dropped" || bad "cut user rules: white space kept before the note"

# A file whose first line alone does not fit: the part as before and one line on stderr naming the
# file, not a note with no rules under it. A leading line of spaces changes nothing.
part_root() { sed "s#\${CLAUDE_PLUGIN_ROOT}#$2#g" "$RULES/$1.md"; } # $1 part, $2 plugin root (no '#')
stderr_names_file() { local e; e="$(cat "$T/err")"; [[ "$e" == *"$HARNESS_HOME/user/rules.md"* || "${e//\\//}" == *"$HH_N/user/rules.md"* ]]; }
for lead in '' '  \n'; do
    node -e 'process.stdout.write(process.argv[1].replace("\\n", "\n") + "y".repeat(20000) + "\n")' "$lead" >"$USER_RULES"
    run_inject common '{"hook_event_name":"SubagentStart"}' CLAUDE_PLUGIN_ROOT="$LONG_ROOT"
    lines="$(wc -l <"$T/err" | tr -d ' ')"
    [ "$rc" -eq 0 ] && [ "$(ctx)" = "$(part_root common "$LONG_ROOT")" ] && [ "$lines" = 1 ] && stderr_names_file \
        && ok "first line longer than the budget (lead '$lead'): the part as before, one stderr line naming the file" \
        || bad "first line longer than the budget (lead '$lead'): rc=$rc, $lines stderr lines, $(ctx | chars) characters"
done

# No room at all (the part and the note already reach the limit): the part as before, one stderr line.
HUGE_ROOT="/$(node -e 'process.stdout.write("r".repeat(5200))')"
printf 'Rule 1.\n' >"$USER_RULES"
run_inject common '{"hook_event_name":"SessionStart"}' CLAUDE_PLUGIN_ROOT="$HUGE_ROOT"
lines="$(wc -l <"$T/err" | tr -d ' ')"
[ "$rc" -eq 0 ] && [ "$(ctx)" = "$(part_root common "$HUGE_ROOT")" ] && [ "$lines" = 1 ] && stderr_names_file && grep -q 'no room' "$T/err" \
    && ok "no room for user rules: the part as before, one stderr line naming the file" \
    || bad "no room for user rules: rc=$rc, $lines stderr lines: '$(head -c 200 "$T/err")'"

# Trailing white space is dropped in linear time: a long run of spaces before a last character
# made the old regular expression take seconds (quadratic backtracking).
node -e 'process.stdout.write(" ".repeat(300000) + "x\n")' >"$USER_RULES"
node -e '
const r = require("child_process").spawnSync(process.execPath, [process.argv[1], "common"], {
    input: JSON.stringify({ hook_event_name: "SessionStart" }), timeout: 10000, env: { ...process.env, CLAUDE_PLUGIN_ROOT: "/opt/worfy-plugin" },
})
process.exit(r.status === 0 && !r.signal ? 0 : 1)' "$INJECT" \
    && ok "user rules with 300000 spaces before the last character: done within 10 s" || bad "user rules with 300000 spaces: the hook took over 10 s or failed"
rm -f "$USER_RULES"

# --- 4. Paths and names inside the parts -------------------------------------------------------

all="$T/all.md"
cat "$RULES"/*.md >"$all" 2>/dev/null
for p in '~/.claude/bin' '~/.claude/hooks' '~/.claude/profiles' '$HOME/.claude'; do
    if grep -qF "$p" "$all"; then bad "parts mention $p"; else ok "parts do not mention $p"; fi
done
for p in '${CLAUDE_PLUGIN_ROOT}/bin/profile' '${CLAUDE_PLUGIN_ROOT}/profiles/README.md' \
    '${CLAUDE_PLUGIN_ROOT}/bin/epic-status' '${CLAUDE_PLUGIN_ROOT}/bin/ticket' \
    'node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"' \
    'worfy:scout' 'worfy:implementer' 'worfy:reviewer' 'worfy:qmd'; do
    grep -qF -- "$p" "$all" && ok "parts name $p" || bad "parts do not name $p"
done
for p in '`scout`' '`implementer`' '`reviewer`' '`qmd` query' 'skill `qmd`'; do
    if grep -qF -- "$p" "$all"; then bad "parts use the bare name $p"; else ok "no bare $p"; fi
done
[ -f "$HARNESS/profiles/README.md" ] && ok "profiles/README.md exists in the plugin" || bad "profiles/README.md missing"

# --- 5. No rule lost ---------------------------------------------------------------------------

# Every topic of the old global rules (~/.claude/CLAUDE.md, imported as rules/global.md), from
# "Default loop" to "Context hygiene", except "Standing authorization" (the user's own consent,
# which stays with the user). Each line: a topic and phrases that carry its rules.
ORCH_TOPICS=(
    'Orchestrator role|orchestrator|main context'
    'Project profile|profile|`-C <path>`|--field|exit code|`0`|`3`|`1` / `2`|`4`'
    'Default loop|Default loop|Restate the task|Phase 0|Phase 2|Phase 3|summaries'
    'Answering, not exploring|Answering, not exploring|confidence|hypothesis|lead with the number'
    'Phase 0|Phase 0|read-only|entry points|call chain|exact files to touch|qmd.collections'
    'Delegate by default|Delegate by default|>200 lines|grep/glob|research|First draft|several agents in one message|side quests'
    'Your own hands|closed list|Single-file edit|targeted read|Trivial follow-ups|Coupled sequential chains|raw output drives'
    'Quota|Quota|Before a phase|fifth|out loud'
    'Long output|Long output|~15 lines|needs interpretation'
    'Subagent contract|Subagent contract|exact output format|30 lines|"not found"|repo or worktree path'
    'Phase 2|Phase 2|one file and under ~20 lines|review.lenses|leaked secrets|self-check'
    'Phase 3: status block|status block|purely conversational|Four lines|Only verified state goes in'
    'Phase 3: ticket status|`claim`|`block <reason>`|`done <epic> <NN>`|--pr <N>|tickets.path'
    'Phase 3: state file|docs.handoff|phase boundaries|second state file'
    'Phase 3: ADR vs state file|immutable|links only|docs.adr_dir'
)
COMMON_TOPICS=(
    'Plain language|Plain language|never seen this project|smoke test|gloss it'
    'Metaphors|Metaphors|plainly'
    'Codes carry their meaning|Codes carry their meaning|backlog/18|next message explains again'
    "Restate, don't point back|Restate, don't point back|as above"
    'Short sentences|Short sentences'
    'Self-check before sending|Self-check before sending|joined today'
    'Scope|Casual chat'
    "Which language|language.reports|language.team|With no profile|Personal language rules, if any, come from the user's rules file."
    'Evidence before "green"|Evidence before "green"|set -o pipefail|PreToolUse|exit code|not from reading the diff|Neither is reported as done'
    'Gate verdict|`2` is red|`3`|never green|is green only when|nothing ran|commands.verify|gate did not run'
    'Deployed|live endpoint'
    'Subagent claims|is a claim, not a fact|Re-read the line'
    'Context hygiene|Context hygiene|minimal fragment|`Edit`|compress|Unbounded output|only what changed'
    'Shell commands without a confirmation|Shell commands without a confirmation|`bypassPermissions`|no allow rule|without a human|the request is denied'
    'Delete by a literal path|Delete only by a literal path|no glob after `cd`|no `$VAR` in an `rm` target|even when the folder came from `mktemp -d`|make a new one with `mktemp -d`; do not clean the old one'
    'Multi-line -c script from a file|A multi-line script for `sh -c`, `bash -c` or `zsh -c` goes into a file|scratchpad subdirectory|run the file (`zsh -f <file>`)'
)

# $1 file to search, topics follow. The text is searched as one line with whitespace runs
# collapsed, so a phrase may wrap across lines.
check_topics() {
    local file="$T/flat.txt" line topic phrase missing
    tr '\n' ' ' <"$1" 2>/dev/null | tr -s ' ' >"$file"
    shift
    for line in "$@"; do
        topic="${line%%|*}"
        missing=""
        IFS='|' read -r -a phrases <<<"${line#*|}"
        for phrase in "${phrases[@]}"; do
            grep -qF -- "$phrase" "$file" || missing="$missing [$phrase]"
        done
        [ -z "$missing" ] && ok "topic kept: $topic" || bad "topic $topic: missing$missing"
    done
}
check_topics "$all" "${ORCH_TOPICS[@]}"
check_topics "$RULES/common.md" "${COMMON_TOPICS[@]}"

# The decision log of a wave that runs without a human is not a second
# state file, and the rule against a second state file says so itself: the caveat is the paragraph
# right after it. Whole sentences, one after another, with line breaks folded into spaces.
flat="$(tr '\n' ' ' <"$RULES/orchestrator.md" 2>/dev/null | tr -s ' ')"
[[ "$flat" == *'Two files describing where we are means one of them is lying. The decision log of a wave that runs without a human (`decisions.tsv`, skill `worfy:epic-wave`) is not a state file.'* ]] \
    && ok "orchestrator.md: the decision log is not a state file — said right after the rule against a second state file" \
    || bad "orchestrator.md: no caveat about the decision log right after the rule against a second state file"
[[ "$flat" == *'is not a state file. The state file says where the work stands; the log says why one run decided what it did. The log is not committed and is not read when work resumes.'* ]] \
    && ok "orchestrator.md: the log says why, is not committed and is not read on resume" \
    || bad "orchestrator.md: the caveat does not say what the log is for, that it is not committed or that it is not read on resume"

# common.md holds exactly Plain language, Evidence before "green", Context hygiene and Shell commands
# without a confirmation (the agents point at that section by its name).
heads="$(grep '^## ' "$RULES/common.md" 2>/dev/null | tr '\n' '|')"
[ "$heads" = '## Plain language|## Evidence before "green"|## Context hygiene|## Shell commands without a confirmation|' ] \
    && ok "common.md sections: Plain language, Evidence, Context hygiene, Shell commands" || bad "common.md sections: $heads"
for p in 'Phase 0' 'Quota' 'Default loop' 'Phase 2' 'Phase 3' 'Delegate by default' 'Subagent contract'; do
    if grep -qF "$p" "$RULES/common.md" 2>/dev/null; then bad "common.md carries the orchestrator topic $p"; else ok "common.md has no $p"; fi
done

# --- 6. Machine-read strings and Cyrillic --------------------------------------------------------

# The status block lines as worfy parses them: LINE in src/shared/agent/status-block.ts.
# The dashes are an alternation, not a bracket: in the C locale (Git Bash without LANG) grep reads a
# bracket byte by byte and a multibyte dash never matches.
for label in Stage Now Next Waiting; do
    grep -qE "^[[:space:]]*(—|–|-)[[:space:]]*$label[[:space:]]*:" "$RULES/orchestrator.md" 2>/dev/null \
        && ok "orchestrator.md: status line '— $label:'" || bad "orchestrator.md: no status line '— $label:'"
done
# The old labels worfy still reads for one release; no rule, skill, agent or eval case of the
# plugin writes them any more. This line is the only place they stay.
for label in Этап Сейчас Дальше Жду; do
    old="$(grep -rlE --include='*.md' "(—|–|-)[[:space:]]*$label[[:space:]]*:" "$HARNESS" 2>/dev/null | sed "s|^$HARNESS/||")"
    if [ -n "$old" ]; then
        bad "old status line '— $label:' in: $(printf '%s ' $old)"
    else
        ok "no harness/**/*.md has the old status line '— $label:'"
    fi
done
grep -qF 'The four labels are fixed English tokens' "$RULES/orchestrator.md" 2>/dev/null \
    && ok "orchestrator.md: the labels are fixed tokens worfy parses" || bad "orchestrator.md: no fixed-token rule for the labels"
for p in '[gate] зелено (…)' 'ничего не прогналось' 'ПРОВЕРИТЬ НЕ УДАЛОСЬ'; do
    grep -qF -- "$p" "$all" && ok "gate verdict words kept: $p" || bad "gate verdict words missing: $p"
done

# Cyrillic only in the gate verdict words. Rules for writing in one language
# live in the user's own rules file, not in the plugin.
ALLOWED='["[gate] зелено","ничего не прогналось","ПРОВЕРИТЬ НЕ УДАЛОСЬ"]'
for p in 'Writing in Russian' 'stays in Latin' '## Terms'; do
    if grep -qF -- "$p" "$all"; then bad "parts carry the language rule '$p'"; else ok "parts carry no language rule '$p'"; fi
done
for f in ${parts[@]+"${parts[@]}"}; do
    left="$(node -e '
let s = require("fs").readFileSync(0, "utf8")
for (const a of JSON.parse(process.argv[1])) s = s.split(a).join("")
process.stdout.write([...new Set(s.match(/[Ѐ-ӿ]+/g) || [])].sort().join(" "))' "$ALLOWED" <"$f")"
    [ -z "$left" ] && ok "$(basename "$f"): Cyrillic only in allowed strings" || bad "$(basename "$f"): Cyrillic outside allowed strings: $left"
done

for p in Telegram 'Standing authorization'; do
    # Not -iF: grep of Git Bash on Windows aborts on -i with -F (exit 134), and the check passed
    # without looking. The two names have no regex characters.
    grep -qi -- "$p" "$all"; found=$?
    case "$found" in
        0) bad "parts mention $p" ;;
        1) ok "parts do not mention $p" ;;
        *) bad "grep failed (exit $found) looking for $p" ;;
    esac
done
if grep -qwE '(me|my|I)' "$all"; then
    bad "parts speak as the user (me/my/I): $(grep -nwE '(me|my|I)' "$all" | head -n 3 | tr '\n' ' ')"
else
    ok "parts say 'the user', not me/my/I"
fi

# --- 7. hooks.json ------------------------------------------------------------------------------

HJ="$HOOKS/hooks.json"
# hj <what>: lines read from hooks.json. "valid" prints ok when it is JSON with an object .hooks;
# "hooks" prints event|matcher|command|timeout per hook; "types" the hook types, unique, joined by
# commas; "commands" the commands, unique.
hj() {
    node -e '
const [file, what] = process.argv.slice(1)
let h
try { h = JSON.parse(require("fs").readFileSync(file, "utf8")).hooks } catch { process.exit(1) }
if (!h || typeof h !== "object") process.exit(1)
const all = []
for (const [e, groups] of Object.entries(h)) for (const g of groups) for (const k of g.hooks) all.push([e, g.matcher ?? "", k])
const uniq = (a) => [...new Set(a)].sort()
const out = {
    valid: () => ["ok"],
    hooks: () => all.map(([e, m, k]) => `${e}|${m}|${k.command}|${k.timeout}`),
    types: () => [uniq(all.map(([, , k]) => k.type)).join(",")],
    commands: () => uniq(all.map(([, , k]) => k.command)),
    inject: () => all.filter(([, , k]) => k.command.includes("inject-rules.mjs")).map(([e, , k]) => `${e}|${k.command}`),
}[what]()
for (const l of out) process.stdout.write(l + "\n")' "$HJ" "$1" 2>/dev/null
}
if [ "$(hj valid)" = ok ]; then ok "hooks.json is valid JSON with .hooks"; else bad "hooks.json missing or invalid"; fi

# The hooks of ~/.claude/settings.json:5-109, plus the three inject-rules entries; qmd-refresh came
# with the qmd server of the plugin. No WorktreeCreate: hooks/worktree-create.sh stays unregistered until
# a project with a worktree.root outside the repository is connected (decided 2026-10-09). Every Node script runs as an explicit
# `node "${CLAUDE_PLUGIN_ROOT}/…"`: Windows starts no
# script by its #! line. Two exceptions: the gate hooks call the launcher gate.sh, because without
# node only the launcher can say so; qmd-refresh is still a zsh script.
# One line per hook: event|matcher|command|timeout.
R='"${CLAUDE_PLUGIN_ROOT}'
N='node "${CLAUDE_PLUGIN_ROOT}'
# Read outside $(…): macOS bash 3.2 cannot parse a here-document with an odd number of quotes
# inside a command substitution.
IFS= read -r -d '' hooks_expected <<EOF
SessionStart||$N/hooks/session-start.mjs"|15
SessionStart||$N/bin/worktree-lock" claim|10
SessionStart||$N/hooks/inject-rules.mjs" orchestrator|10
SessionStart||$N/hooks/inject-rules.mjs" common|10
SessionStart||$N/hooks/gh-token-env.mjs"|10
SubagentStart||$N/hooks/inject-rules.mjs" common|10
TaskCompleted||$R/hooks/gate.sh" fast|900
TeammateIdle||$R/hooks/gate.sh" fast|900
Stop||$N/hooks/stop.mjs"|10
Stop||$N/bin/worktree-lock" beat|5
Stop||$R/bin/qmd-refresh" --quiet|15
SessionEnd||$N/hooks/session-end.mjs"|10
SessionEnd||$N/bin/worktree-lock" release|5
PreToolUse|Bash|$N/hooks/guard.mjs"|30
EOF
expected="$(printf '%s' "$hooks_expected" | sort)"
actual="$(hj hooks | sort)"
if [ "$actual" = "$expected" ]; then
    ok "hooks.json: events, matchers, commands and timeouts as expected"
else
    bad "hooks.json differs: $(diff <(echo "$expected") <(echo "$actual") | grep '^[<>]' | tr '\n' ' ')"
fi
types="$(hj types)"
[ "$types" = command ] && ok "hooks.json: every hook is a command" || bad "hooks.json: hook types '$types'"
# A command that names a Node script (a .mjs file, or bin/worktree-lock, which has no extension)
# starts with `node `: Windows does not start a script by its #! line.
while IFS= read -r cmd; do
    case "$cmd" in
        *.mjs\"* | */bin/worktree-lock\"*)
            case "$cmd" in
                'node "${CLAUDE_PLUGIN_ROOT}/'*) ok "runs through node: $cmd" ;;
                *) bad "a Node script without node: $cmd" ;;
            esac ;;
    esac
done < <(hj commands)
if grep -q 'bin/qmd-refresh.* --quiet' "$HJ" 2>/dev/null; then ok "hooks.json: Stop runs qmd-refresh --quiet"; else bad "hooks.json: no qmd-refresh"; fi

# Every command path, with ${CLAUDE_PLUGIN_ROOT} = harness, exists and is executable. A command
# that starts with `node ` names a file node reads: it must exist, with or without the
# executable bit.
while IFS= read -r cmd; do
    path="$(printf '%s' "$cmd" | sed -n 's#^\(node \)\{0,1\}"\${CLAUDE_PLUGIN_ROOT}\(/[^"]*\)".*#\2#p')"
    if [ -z "$path" ]; then bad "command not of the form [node ]\"\${CLAUDE_PLUGIN_ROOT}/…\": $cmd"; continue; fi
    if [ "${cmd#node }" != "$cmd" ]; then
        [ -f "$HARNESS$path" ] && ok "run by node, exists: $path" || bad "missing: $path"
    else
        [ -x "$HARNESS$path" ] && ok "executable: $path" || bad "not executable or missing: $path"
    fi
done < <(hj commands)

# The inject-rules commands of hooks.json, run the way Claude Code runs them, print their part.
# On Windows Claude Code gives ${CLAUDE_PLUGIN_ROOT} as C:/…; elsewhere it is the plain path.
n=0
while IFS='|' read -r ev cmd; do
    n=$((n + 1))
    printf '{"hook_event_name":"%s"}' "$ev" | CLAUDE_PLUGIN_ROOT="$HARNESS_N" sh -c "$cmd" >"$T/out" 2>/dev/null
    part="${cmd##* }"
    first="$(ctx | head -n 1)"
    [ "$first" = "# worfy Harness — $part rules" ] && ok "hooks.json $ev runs $part" || bad "hooks.json $ev '$cmd': got '$first'"
done < <(hj inject)
[ "$n" -eq 3 ] && ok "hooks.json: three inject-rules.mjs commands run" || bad "hooks.json: $n inject-rules.mjs commands, not 3"

# --- 8. The old rules file is gone --------------------------------------------------------------

[ ! -e "$HARNESS/rules/global.md" ] && ok "rules/global.md removed" || bad "rules/global.md still there"
[ ! -e "$HARNESS/rules" ] && ok "rules/ removed" || bad "rules/ still there"

echo "--- passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
