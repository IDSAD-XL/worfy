#!/usr/bin/env bash
# The call log hook calls.mjs (PostToolUse and PostToolUseFailure, worfy-stuck-agents/07): it keeps
# the last 20 calls of each agent in <gate state>/calls/<owner>.jsonl and writes a loop it sees to
# <gate state>/calls/loops.jsonl — would-hint on the 3rd repeat, would-deny on the 4th, once per pattern
# and owner. The agent gets nothing: every run exits 0 with nothing on stdout, whatever the input or the
# disk. Inputs here are Claude Code's (PostToolUse, PostToolUseFailure with its `error`); Codex's recorded
# inputs are run by test/contract/harness-codex-hooks.test.ts.
# Run: bash harness/hooks/tests/calls.test.sh; exit code 0 means every check passed.
#
# The gate state and HOME are temporary (CLAUDE_GATE_STATE): the test does not touch the live Harness home.
set -u
case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) WIN=1 ;; *) WIN=0 ;; esac
HOOKS="${HOOKS_DIR:-$(cd "$(dirname "$0")/.." && { pwd -W 2>/dev/null || pwd; })}"   # HOOKS_DIR runs the test on another copy of the hooks
CALLS="$HOOKS/calls.mjs"
unset CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID HARNESS_HOME EVAL_HARNESS_HOME
T="$(mktemp -d)" || exit 1
T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'chmod -R u+w "$T" 2>/dev/null; rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export HOME="$T/home" USERPROFILE="$T/home"
mkdir -p "$T/home" "$T/work"
W="$T/work"
S="$T/state"
export CLAUDE_GATE_STATE="$S"
C="$S/calls"
L="$C/loops.jsonl"

# A JSON string of $1: quotes, backslashes and line breaks escaped.
js() { node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' -- "$1"; }

# Runs the hook with the input $1 in the work folder; every run must exit 0 and print nothing.
quiet=1
hook() {
    (cd "$W" && printf '%s' "$1" | node "$CALLS" >"$T/out" 2>"$T/err")
    local rc=$?
    if [ "$rc" -ne 0 ] || [ -s "$T/out" ]; then
        quiet=0
        echo "  hook: exit $rc, stdout: $(head -c 300 "$T/out"), stderr: $(head -c 300 "$T/err")"
    fi
}

# The input of a Bash call of Claude Code. $1 session, $2 agent id or "", $3 command, $4 "" for a success
# (PostToolUse), else the error text of a failure (PostToolUseFailure).
bash_call() {
    local agent="" tail
    [ -n "$2" ] && agent="\"agent_id\":\"$2\",\"agent_type\":\"general-purpose\","
    if [ -z "$4" ]; then
        tail="\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":$(js "$3")},\"tool_response\":{\"stdout\":\"\",\"stderr\":\"\",\"interrupted\":false},\"tool_use_id\":\"t\""
    else
        tail="\"hook_event_name\":\"PostToolUseFailure\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":$(js "$3")},\"tool_use_id\":\"t\",\"error\":$(js "$4")"
    fi
    hook "{\"session_id\":\"$1\",\"transcript_path\":$(js "$T/$1.jsonl"),\"cwd\":$(js "$W"),$agent$tail}"
}

# A Write of Claude Code that left $2 in the file $1 (relative to the work folder): the file is written first,
# as the tool would, then the hook runs. $3 is the session.
write_call() {
    printf '%s' "$2" >"$W/$1"
    hook "{\"session_id\":\"$3\",\"transcript_path\":$(js "$T/$3.jsonl"),\"cwd\":$(js "$W"),\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":$(js "$W/$1"),\"content\":$(js "$2")},\"tool_response\":{\"type\":\"update\"},\"tool_use_id\":\"t\"}"
}

# The lines of loops.jsonl with all the words given (a session, a pattern, a level).
loops() {
    [ -f "$L" ] || { echo 0; return; }
    local n
    n="$(node -e '
        const [file, ...want] = process.argv.slice(1)
        const lines = require("fs").readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
        console.log(lines.filter((l) => want.every((w) => [l.session, l.pattern, l.level, l.agent_id].includes(w))).length)
    ' -- "$L" "$@")"
    echo "$n"
}
lines() { if [ -f "$1" ]; then awk 'END { print NR }' "$1"; else echo 0; fi; }

# --- 1. The same failed call: would-hint on the 3rd, would-deny on the 4th, nothing more after ------------
for i in 1 2; do bash_call s1 "" "pnpm test" $'Exit code 1\nTests 1 failed'; done
[ "$(loops s1)" = 0 ] && ok "two equal failures: no loop line" || bad "two equal failures wrote $(loops s1) loop lines"
bash_call s1 "" "pnpm test" $'Exit code 1\nTests 1 failed'
[ "$(loops s1 same-failure would-hint)" = 1 ] && [ "$(loops s1)" = 1 ] && ok "3rd equal failure: one would-hint line" || bad "3rd equal failure: $(cat "$L" 2>/dev/null)"
bash_call s1 "" "pnpm test" $'Exit code 1\nTests 1 failed'
[ "$(loops s1 same-failure would-deny)" = 1 ] && [ "$(loops s1)" = 2 ] && ok "4th equal failure: one would-deny line" || bad "4th equal failure: $(cat "$L" 2>/dev/null)"
bash_call s1 "" "pnpm test" $'Exit code 1\nTests 1 failed'
[ "$(loops s1)" = 2 ] && ok "5th equal failure: once per pattern and owner, no new line" || bad "5th equal failure: $(loops s1) lines"
line="$(node -e '
    const l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8").split("\n")[0])
    console.log([Object.keys(l).sort().join(","), l.session, l.agent_id, l.tool, l.command, Number.isNaN(Date.parse(l.t))].join("|"))
' -- "$L")"
[ "$line" = "agent_id,command,level,pattern,session,t,tool,vendor|s1||Bash|pnpm test|false" ] && ok "a loop line: time, Session, agent_id, pattern, level, tool, start of the command" || bad "loop line: $line"
[ "$quiet" = 1 ] && ok "the agent got nothing: exit 0 and an empty stdout on every call" || bad "a call exited non-zero or printed"

# --- 2. A repeat with a new outcome, a success, CI waits: no loop -------------------------------------------
quiet=1
for i in 1 2 3 4; do bash_call s2 "" "pnpm lint" "Exit code 1 lint error $i"; done
[ "$(loops s2)" = 0 ] && ok "the same call with a new outcome each time: no line" || bad "new outcomes: $(loops s2) lines"
for i in 1 2 3 4; do bash_call s2 "" "pnpm typecheck" ""; done
[ "$(loops s2)" = 0 ] && ok "four equal successes: no line" || bad "successes: $(loops s2) lines"
for i in 1 2 3 4; do bash_call s3 "" "gh pr checks 12" $'Exit code 8\nsome checks are still pending'; done
for i in 1 2 3 4; do bash_call s3 "" 'gh pr checks 12 --watch; echo "EXIT=$?"' 'Exit code 1'; done
[ "$(loops s3)" = 0 ] && ok "gh pr checks four times with a non-zero exit code: no line" || bad "gh pr checks: $(loops s3) lines"
[ "$(lines "$C/s3.jsonl")" = 0 ] && ok "a CI wait is not in the call log" || bad "CI wait logged: $(cat "$C/s3.jsonl")"
# An interrupt is the person's, not a failure of the agent.
for i in 1 2 3 4; do
    hook "{\"session_id\":\"s3\",\"cwd\":$(js "$W"),\"hook_event_name\":\"PostToolUseFailure\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"pnpm build\"},\"tool_use_id\":\"t\",\"error\":\"Interrupted by user\",\"is_interrupt\":true}"
done
[ "$(loops s3)" = 0 ] && ok "four interrupts: no line" || bad "interrupts: $(loops s3) lines"
[ "$quiet" = 1 ] && ok "no output there either" || bad "a call exited non-zero or printed"

# --- 3. A-B-A-B, and an edit back and forth ---------------------------------------------------------------
quiet=1
for i in 1 2; do
    bash_call s4 "" "pnpm test" "Exit code 1 same"
    write_call notes.txt "fixed" s4
done
[ "$(loops s4 abab)" = 0 ] && ok "A-B-A-B twice: no abab line" || bad "two pairs: $(cat "$L")"
bash_call s4 "" "pnpm test" "Exit code 1 same"
write_call notes.txt "fixed" s4
[ "$(loops s4 abab would-hint)" = 1 ] && ok "A-B-A-B three times: would-hint" || bad "three pairs: $(cat "$L")"
write_call a.txt "one" s5
write_call a.txt "two" s5
write_call a.txt "one" s5
[ "$(loops s5)" = 0 ] && ok "an edit there and back once: no line" || bad "one return: $(cat "$L")"
write_call a.txt "two" s5
[ "$(loops s5 edit-back-and-forth would-hint)" = 1 ] && ok "an edit there and back twice: would-hint" || bad "two returns: $(cat "$L")"
cmd="$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    console.log(ls.find((l) => l.session === "s5").command)
' -- "$L")"
[ "$cmd" = "$W/a.txt" ] && ok "an edit's loop line names the file" || bad "edit command: $cmd"
[ "$quiet" = 1 ] && ok "no output there either" || bad "a call exited non-zero or printed"

# --- 4. Broken input, a state folder that cannot be written: exit 0, nothing on stdout --------------------
quiet=1
hook '{"session_id": "broken'
hook ''
hook '[1, 2]'
hook '{"session_id":"s6","hook_event_name":"PostToolUse"}'
(cd "$W" && node "$CALLS" </dev/null >"$T/out" 2>&1) && [ ! -s "$T/out" ] || quiet=0
[ "$quiet" = 1 ] && ok "broken JSON, empty input, no tool: exit 0, empty stdout" || bad "broken input"
[ ! -e "$C/s6.jsonl" ] && ok "an input without a tool logs nothing" || bad "s6 logged"
quiet=1
printf 'not a folder' >"$T/state-file"
for i in 1 2 3 4; do CLAUDE_GATE_STATE="$T/state-file" bash_call s7 "" "pnpm test" "Exit code 1"; done
[ "$quiet" = 1 ] && [ "$(cat "$T/state-file")" = "not a folder" ] && ok "a state path that is a file: exit 0, empty stdout, the file untouched" || bad "state path is a file"
if [ "$WIN" -eq 0 ] && [ "$(id -u)" != 0 ]; then
    mkdir -p "$T/ro"
    chmod 555 "$T/ro"
    quiet=1
    for i in 1 2 3 4; do CLAUDE_GATE_STATE="$T/ro" bash_call s7 "" "pnpm test" "Exit code 1"; done
    [ "$quiet" = 1 ] && [ -z "$(ls -A "$T/ro")" ] && ok "a state folder without write permission: exit 0, empty stdout, nothing written" || bad "read-only state folder"
    chmod 755 "$T/ro"
    mkdir -p "$T/ro2/calls"
    chmod 555 "$T/ro2/calls"
    quiet=1
    for i in 1 2 3 4; do CLAUDE_GATE_STATE="$T/ro2" bash_call s7 "" "pnpm test" "Exit code 1"; done
    [ "$quiet" = 1 ] && ok "a calls folder without write permission: exit 0, empty stdout" || bad "read-only calls folder"
    chmod 755 "$T/ro2/calls"
else
    echo "skip the read-only folder checks: no POSIX permissions here (Windows) or running as root"
fi

# --- 5. Owners: a Subagent has its own log; a log keeps 20 calls -------------------------------------------
quiet=1
bash_call s8 "" "pnpm test" "Exit code 1"
bash_call s8 agent-a "pnpm test" "Exit code 1"
bash_call s8 agent-a "pnpm test" "Exit code 1"
bash_call s8 agent-b "pnpm test" "Exit code 1"
bash_call s8 agent-b "pnpm test" "Exit code 1"
[ "$(lines "$C/s8.jsonl")" = 1 ] && [ "$(lines "$C/s8.agent-a.jsonl")" = 2 ] && [ "$(lines "$C/s8.agent-b.jsonl")" = 2 ] \
    && ok "two Subagents of one Session keep logs of their own, apart from the Session's" || bad "owners: $(ls "$C")"
[ "$(loops s8)" = 0 ] && ok "five equal failures spread over three owners: no line (none of them repeated three times)" || bad "owners mixed: $(loops s8)"
bash_call s8 agent-a "pnpm test" "Exit code 1"
[ "$(loops s8 agent-a same-failure would-hint)" = 1 ] && ok "the 3rd failure of one Subagent: would-hint with its agent_id" || bad "agent-a: $(cat "$L")"
hook "{\"session_id\":\"../s9\",\"cwd\":$(js "$W"),\"agent_id\":\"a/../../b\",\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"x\"},\"tool_response\":{},\"tool_use_id\":\"t\"}"
# -mindepth 1: the temporary folder's own name may hold "s9".
outside="$(find "$T" -mindepth 1 -name '*s9*' ! -path "$C/*")"
[ -z "$outside" ] && ls "$C" | grep -q '^___s9\.a_*b\.jsonl$' && ok "an owner name keeps to letters, digits, _ and -: no path out of calls/" || bad "owner name: $(ls "$C")"
for i in $(seq 1 25); do bash_call s10 "" "echo $i" ""; done
[ "$(lines "$C/s10.jsonl")" = 20 ] && ok "the call log keeps the last 20 calls" || bad "s10 has $(lines "$C/s10.jsonl") lines"
[ "$quiet" = 1 ] && ok "no output there either" || bad "a call exited non-zero or printed"

# --- 6. Clean-up: logs older than 7 days go, loops.jsonl stays and keeps its last 2000 lines ----------------
old="$C/old-session.jsonl"
printf '{"t":"2020-01-01T00:00:00.000Z","tool":"Bash","in":"x","out":"ok","fail":false}\n' >"$old"
touch -t 202001010000 "$old" "$L"
fresh="$C/fresh-session.jsonl"
printf '{"t":"2020-01-01T00:00:00.000Z","tool":"Bash","in":"x","out":"ok","fail":false}\n' >"$fresh"
# Ages around the 7 days: a log of 8 days goes, one of 6 days stays; a leftover temporary file of an old write
# goes; a file of another kind stays, however old.
for name in eight-days.jsonl six-days.jsonl old-write.jsonl.123.tmp x.txt; do printf '{}\n' >"$C/$name"; done
age() { node -e 'const t = (Date.now() - Number(process.argv[2]) * 86400000) / 1000; require("fs").utimesSync(process.argv[1], t, t)' -- "$1" "$2"; }
age "$C/eight-days.jsonl" 8
age "$C/six-days.jsonl" 6
age "$C/old-write.jsonl.123.tmp" 8
age "$C/x.txt" 30
bash_call s11 "" "ls" ""
[ ! -e "$old" ] && [ -e "$fresh" ] && [ -e "$L" ] && ok "a new log removes logs older than 7 days, keeps a newer one and loops.jsonl" || bad "clean-up: $(ls "$C")"
[ ! -e "$C/eight-days.jsonl" ] && [ -e "$C/six-days.jsonl" ] && ok "the limit is 7 days: a log of 8 days goes, one of 6 days stays" || bad "7 days: $(ls "$C")"
[ ! -e "$C/old-write.jsonl.123.tmp" ] && [ -e "$C/x.txt" ] && ok "an old temporary file of a write goes; an old file of another kind stays" || bad "kinds: $(ls "$C")"
node -e '
    const lines = []
    for (let i = 0; i < 2005; i++) lines.push(JSON.stringify({ t: "2020-01-01T00:00:00.000Z", session: "filler", agent_id: null, pattern: "same-failure", level: "would-hint", tool: "Bash", command: String(i), vendor: "claude" }))
    require("fs").writeFileSync(process.argv[1], lines.join("\n") + "\n")
' -- "$L"
for i in 1 2 3; do bash_call s12 "" "pnpm e2e" "Exit code 1"; done
last="$(tail -n 1 "$L" | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).session))')"
[ "$(lines "$L")" = 2000 ] && [ "$last" = s12 ] && ok "loops.jsonl keeps the last 2000 lines, the new one last" || bad "loops.jsonl: $(lines "$L") lines, last $last"

# --- 7. The wait for the input: a closed stdin ends it at once, a silent open pipe after 2 s -----------------
# The hook runs on every tool call: a closed stdin must not cost the 2 s a silent pipe gets. A pipe that stays
# open and sends nothing must end the hook by itself, well inside the 5 s of hooks.json. $1: "closed" (stdin is
# the null device, at its end at once) or "open" (a pipe never written to nor closed). Prints "exit ms stdout".
timed() {
    node -e '
        const { spawn } = require("child_process")
        const [hook, mode] = process.argv.slice(1)
        const started = Date.now()
        const child = spawn(process.execPath, [hook], { stdio: [mode === "closed" ? "ignore" : "pipe", "pipe", "ignore"] })
        let out = ""
        child.stdout.setEncoding("utf8").on("data", (d) => (out += d))
        child.on("close", (code) => {
            console.log(`${code} ${Date.now() - started} ${JSON.stringify(out)}`)
            child.stdin?.destroy()
        })
    ' -- "$CALLS" "$1"
}
read -r rc ms out <<<"$(cd "$W" && timed closed)"
[ "$rc" = 0 ] && [ "$ms" -lt 1500 ] && [ "$out" = '""' ] && ok "a closed stdin: exit 0, empty stdout, done in ${ms} ms (under 1.5 s, not the 2 s wait)" || bad "closed stdin: exit $rc in $ms ms, stdout $out"
read -r rc ms out <<<"$(cd "$W" && timed open)"
[ "$rc" = 0 ] && [ "$ms" -ge 1900 ] && [ "$ms" -lt 4500 ] && [ "$out" = '""' ] && ok "an open pipe that sends nothing: the hook ends by itself after its 2 s wait (${ms} ms), exit 0, empty stdout" || bad "silent pipe: exit $rc in $ms ms, stdout $out"

echo
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
