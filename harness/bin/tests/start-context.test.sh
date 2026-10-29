#!/usr/bin/env bash
# Tests of bin/start-context: the estimate of each Harness agent's starting context in tokens, red
# when the parts the Harness writes (definition, rules/common.md, skill) are above 15 000.
#   - a fixture Harness whose parts are small: exit 0, every agent ok; each part measured as the agent
#     reads it (the definition without its frontmatter and with the plugin root spelled out, the
#     rules as the SubagentStart hook injects them, split into common.md and the user's rules, the
#     profile's two files, the skill the profile names); tokens = the counted parts' tokens, total =
#     the agent's constant + every part's tokens;
#   - the parts the Harness does not write (the user's rules, the instructions, the profile) blown up:
#     shown with their size, not counted, exit 0; common.md blown up: every agent red;
#   - a part blown up above the threshold: exit 1, the red line names the agent and its largest
#     part — a definition (the reviewer and the verifier, which shares it), then a skill (the
#     implementer only);
#   - the real texts of this Harness with a fixture profile whose rules.md is 23 KB: all four agents
#     within the threshold, exit 0; the test prints each agent's counted tokens;
#   - the skill folders of this Harness: every file next to a SKILL.md is named by that SKILL.md,
#     every file a SKILL.md names in its own folder exists (a step moved out of the skill is still
#     read at its step);
#   - the usual instruction files and the auto memory (its first 200 lines) when --instructions is
#     not given; no profile part and no skill part when bin/profile finds no profile;
#   - --agent, --json, usage errors (exit 2); the run writes nothing into the real home.
# Run: bash harness/bin/tests/start-context.test.sh; exit code 0 means everything passed.
# BIN_DIR points it at another copy of bin/ (a mutant of the script).
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
SC="$BIN/start-context"
REAL_HOME="$HOME"
. "$(dirname "$0")/real-home.sh"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
# A run that stops before the last line (an error under set -u) fails, whatever bash's own exit code.
finished=0
trap 'rm -rf "$T"; [ "$finished" = 1 ] || { echo "FAIL the test stopped before its end"; exit 1; }' EXIT
# A path under $T as node reads it: C:/… in Git Bash on Windows (pwd -W); unchanged elsewhere.
TN="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
tn() { case "$1" in "$T"/*) printf '%s' "$TN${1#"$T"}" ;; *) printf '%s' "$1" ;; esac; }
# The same path as the script spells it: node's path.resolve, C:\… with backslashes on Windows.
np() { node -e 'process.stdout.write(require("path").resolve(process.argv[1]))' "$(tn "$1")"; }
before="$(real_home_snapshot "$REAL_HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export HOME="$T/home" HARNESS_HOME="$T/harness-home" CLAUDE_CONFIG_DIR="$T/home/.claude"
unset CLAUDE_PLUGIN_ROOT
mkdir -p "$HOME" "$HARNESS_HOME/user"

# run <script> <args...> — stdout -> $T/out, stderr -> $T/err, sets rc; runs in $T/work (not a git repository).
mkdir -p "$T/work"
run() { local s="$1"; shift; (cd "$T/work" && node "$s" "$@") >"$T/out" 2>"$T/err"; rc=$?; }
# field <js expression over j> — evaluates it on the JSON of the last run's stdout
field() { node -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = eval(process.argv[2]); process.stdout.write(typeof v === "string" ? v : JSON.stringify(v))' "$(tn "$T/out")" "$1"; }
# num <text> — the text when it is a whole number, else 0 (keeps the arithmetic below from stopping the test)
num() { case "$1" in ''|*[!0-9]*) echo 0 ;; *) echo "$1" ;; esac; }
# bytes <file> — its size in bytes
bytes() { wc -c <"$1" | tr -d ' '; }
# fill <file> <bytes> — appends lines of plain text up to exactly <bytes> bytes
fill() { node -e 'const fs = require("fs"); const [f, n] = [process.argv[1], Number(process.argv[2])]; let s = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; const line = "A rule line of plain prose that the fixture repeats to reach its size.\n"; while (Buffer.byteLength(s) + line.length <= n) s += line; s += "x".repeat(n - Buffer.byteLength(s)); fs.writeFileSync(f, s)' "$(tn "$1")" "$2"; }

# --- 0. The script is there and executable ---------------------------------------------------------
[ -f "$SC" ] && [ -x "$SC" ] && ok "bin/start-context exists and is executable" || bad "bin/start-context is missing or not executable"
mode="$(git -C "$HARNESS" ls-files -s -- bin/start-context 2>/dev/null | cut -c1-6)"
if [ "$BIN" != "$HARNESS/bin" ] || [ -z "$mode" ]; then echo "skip the mode in git: not the tracked copy"
elif [ "$mode" = 100755 ]; then ok "git records bin/start-context as executable (100755)"
else bad "git records bin/start-context as $mode, not 100755"; fi

# --- 1. A fixture Harness: small parts -------------------------------------------------------------
H="$T/h"
mkdir -p "$H/bin" "$H/hooks/rules" "$H/agents" "$H/skills/ship-ticket" "$H/skills/other"
cp "$SC" "$H/bin/start-context"
cp "$HARNESS/hooks/inject-rules.mjs" "$HARNESS/hooks/eval-env.cjs" "$H/hooks/"
printf '%s\n' '# Common rules' '' 'Say what the thing is.' '' >"$H/hooks/rules/common.md"
printf '%s\n' 'Write short sentences.' >"$HARNESS_HOME/user/rules.md"
# agent <name> <body file> — a definition with a frontmatter in front of the body
agent() { { printf '%s\n' '---' "name: $1" 'description: a fixture agent whose frontmatter is not part of the prompt' '---'; cat "$2"; } >"$H/agents/$1.md"; }
printf '%s\n' 'First action: run ${CLAUDE_PLUGIN_ROOT}/bin/profile.' 'Then do the work.' >"$T/body"
for a in implementer reviewer scout; do agent "$a" "$T/body"; done
printf '%s\n' '# Ship a ticket' 'Steps one to eight.' >"$H/skills/ship-ticket/SKILL.md"
printf '%s\n' '# Another skill' >"$H/skills/other/SKILL.md"
P="$T/profile"; mkdir -p "$P"
printf '%s\n' '{ "name": "demo", "workflow": { "ticket_skill": "/demo:ship-ticket" } }' >"$P/profile.json"
printf '%s\n' '# demo rules' 'One fact.' >"$P/rules.md"
: >"$T/instr-empty"
printf '%s\n' 'Use the house style.' >"$T/instr-a"

run "$H/bin/start-context" --profile "$(tn "$P")" --instructions "$(tn "$T/instr-a")" --json
[ "$rc" = 0 ] && ok "small parts: exit 0" || bad "small parts: exit $rc, want 0"$'\n'"$(cat "$T/err")"
[ "$(field 'j.agents.map((a) => a.agent).join(" ")')" = "implementer reviewer verifier scout" ] && ok "small parts: all four agents, in order" || bad "small parts: agents $(field 'j.agents.map((a) => a.agent).join(" ")')"
[ "$(field 'j.threshold')" = 15000 ] && ok "the threshold is 15000" || bad "threshold $(field 'j.threshold')"
[ "$(field 'j.agents.every((a) => !a.over)')" = true ] && ok "small parts: no agent over" || bad "small parts: an agent is over"
# The definition: the body only, ${CLAUDE_PLUGIN_ROOT} spelled as the fixture Harness folder.
root="$(np "$H")"
want_def="$(node -e 'const fs = require("fs"); const s = fs.readFileSync(process.argv[1], "utf8").split("${CLAUDE_PLUGIN_ROOT}").join(process.argv[2]); process.stdout.write(String(Buffer.byteLength(s)))' "$(tn "$T/body")" "$root")"
got_def="$(field 'j.agents[0].parts.find((p) => p.name === "definition agents/implementer.md").bytes')"
[ "$got_def" = "$want_def" ] && ok "definition: body without frontmatter, plugin root spelled out ($got_def B)" || bad "definition: $got_def B, want $want_def"
# The rules: common.md without its trailing newlines, then the user rules after a heading — two parts.
want_rules="$(node -e 'const fs = require("fs"); const c = fs.readFileSync(process.argv[1], "utf8").replace(/\n+$/, ""); const u = fs.readFileSync(process.argv[2], "utf8").trimEnd(); process.stdout.write(Buffer.byteLength(c) + " " + Buffer.byteLength("\n\n## User rules\n\n" + u))' "$(tn "$H/hooks/rules/common.md")" "$(tn "$HARNESS_HOME/user/rules.md")")"
got_rules="$(field '["rules common.md", "rules of the user"].map((n) => j.agents[0].parts.find((p) => p.name.startsWith(n)).bytes).join(" ")')"
[ "$got_rules" = "$want_rules" ] && ok "rules: common.md and the user's rules, as the hook injects them, two parts ($got_rules B)" || bad "rules: $got_rules B, want $want_rules"
got="$(field 'j.agents[0].parts.find((p) => p.name.startsWith("instructions")).bytes')"
[ "$got" = "$(bytes "$T/instr-a")" ] && ok "instructions: the --instructions file" || bad "instructions: $got B, want $(bytes "$T/instr-a")"
want_prof=$(( $(bytes "$P/profile.json") + $(bytes "$P/rules.md") + 200 ))
got="$(field 'j.agents[0].parts.find((p) => p.name.startsWith("profile")).bytes')"
[ "$got" = "$want_prof" ] && ok "profile: profile.json, rules.md and the header bin/profile prints ($got B)" || bad "profile: $got B, want $want_prof"
got="$(field 'j.agents[0].parts.find((p) => p.name.startsWith("skill"))?.name ?? "none"')"
[ "$got" = "skill skills/ship-ticket/SKILL.md" ] && ok "implementer: the skill the profile names (/demo:ship-ticket)" || bad "implementer skill: $got"
got="$(field 'j.agents.slice(1).filter((a) => a.parts.some((p) => p.name.startsWith("skill"))).length')"
[ "$got" = 0 ] && ok "reviewer, verifier, scout: no skill part" || bad "$got of reviewer, verifier, scout have a skill part"
# tokens = the counted parts' tokens; total = constant + every part's tokens; each part bytes / bytesPerToken rounded.
got="$(field 'j.agents.every((a) => a.tokens === a.parts.filter((p) => p.counted).reduce((s, p) => s + p.tokens, 0) && a.total === a.constant + a.parts.reduce((s, p) => s + p.tokens, 0) && a.parts.every((p) => p.tokens === Math.round(p.bytes / j.bytesPerToken)))')"
[ "$got" = true ] && ok "tokens = counted parts, total = constant + every part, bytes / bytes per token" || bad "the token sums do not add up"
# Counted: what the Harness writes. Not counted: the user's rules, the instructions, the brief, the profile.
got="$(field 'j.agents.map((a) => a.parts.filter((p) => p.counted).map((p) => p.name.split(" ")[0] + (p.name.startsWith("rules") ? ":" + p.name.split(" ")[1] : "")).join(",")).join(" ")')"
[ "$got" = "definition,rules:common.md,skill definition,rules:common.md definition,rules:common.md definition,rules:common.md" ] && ok "counted parts: definition, common.md and the implementer's skill" || bad "counted parts: $got"
got="$(field 'j.agents.map((a) => a.parts.filter((p) => !p.counted).map((p) => p.name.split(" ")[0] + (p.name.startsWith("rules") ? ":" + p.name.split(" ")[2] : "")).join(",")).join(" ")')"
[ "$got" = "$(printf 'rules:the,instructions,brief,profile %.0s' 1 2 3 4 | sed 's/ $//')" ] && ok "not counted: the user's rules, the instructions, the brief, the profile" || bad "not counted: $got"
[ "$(field 'j.agents[1].parts.find((p) => p.name.startsWith("definition")).name')" = "definition agents/reviewer.md" ] && [ "$(field 'j.agents[2].parts.find((p) => p.name.startsWith("definition")).name')" = "definition agents/reviewer.md" ] && ok "the verifier reads the reviewer's definition" || bad "the verifier's definition is not agents/reviewer.md"

run "$H/bin/start-context" --profile "$(tn "$P")" --instructions "$(tn "$T/instr-empty")"
[ "$rc" = 0 ] && grep -q '^implementer: .* tokens — ok: .*; whole start about [0-9 ]*$' "$T/out" && grep -q '^scout: .* tokens — ok: ' "$T/out" && ok "text output: an ok line per agent, with the whole start" || bad "text output, exit $rc:"$'\n'"$(cat "$T/out")"
grep -q '^  definition agents/scout.md .* counted$' "$T/out" && ok "text output: the parts under the agent" || bad "text output has no part lines"
grep -q '^  Claude Code constant .* not counted$' "$T/out" && grep -q '^  profile .* not counted$' "$T/out" && grep -q '^  instructions .* not counted$' "$T/out" && ok "text output: the fixed parts are shown, marked not counted" || bad "text output: fixed parts not shown as not counted:"$'\n'"$(cat "$T/out")"

# --- 2. A part above the threshold -----------------------------------------------------------------
cp "$H/agents/reviewer.md" "$T/reviewer.md.small"
fill "$H/agents/reviewer.md" 150000
run "$H/bin/start-context" --profile "$(tn "$P")" --instructions "$(tn "$T/instr-empty")"
[ "$rc" = 1 ] && ok "blown-up definition: exit 1" || bad "blown-up definition: exit $rc, want 1"
grep -q '^reviewer: [0-9 ]* tokens — RED: over the threshold by [0-9 ]*; largest part: definition agents/reviewer.md; whole start about [0-9 ]*$' "$T/out" && ok "the red line names the reviewer and its largest part" || bad "no red reviewer line:"$'\n'"$(cat "$T/out")"
grep -q '^verifier: .* RED: .*largest part: definition agents/reviewer.md; ' "$T/out" && ok "the verifier, which reads the same definition, is red too" || bad "the verifier is not red"
grep -q '^implementer: .* — ok: ' "$T/out" && grep -q '^scout: .* — ok: ' "$T/out" && ok "the other agents stay ok" || bad "another agent went red"
run "$H/bin/start-context" --agent scout --profile "$(tn "$P")" --instructions "$(tn "$T/instr-empty")"
[ "$rc" = 0 ] && [ "$(grep -c '^[a-z]*: [0-9 ]* tokens' "$T/out")" = 1 ] && grep -q '^scout: ' "$T/out" && ok "--agent scout: only the scout, exit 0 while the reviewer is over" || bad "--agent scout: exit $rc"$'\n'"$(cat "$T/out")"
cp "$T/reviewer.md.small" "$H/agents/reviewer.md"
fill "$H/skills/ship-ticket/SKILL.md" 150000
run "$H/bin/start-context" --profile "$(tn "$P")" --instructions "$(tn "$T/instr-empty")" --json
[ "$rc" = 1 ] && [ "$(field 'j.agents.filter((a) => a.over).map((a) => a.agent + ":" + a.largest).join(" ")')" = "implementer:skill skills/ship-ticket/SKILL.md" ] && ok "blown-up skill: exit 1, only the implementer, largest part the skill" || bad "blown-up skill: exit $rc, over: $(field 'j.agents.filter((a) => a.over).map((a) => a.agent + ":" + a.largest).join(" ")')"
printf '%s\n' '# Ship a ticket' >"$H/skills/ship-ticket/SKILL.md"
# Exactly at the threshold is still within it: the scout's definition grows to the last token.
run "$H/bin/start-context" --agent scout --profile "$(tn "$P")" --instructions "$(tn "$T/instr-empty")" --json
deftok=$(num "$(field 'j.agents[0].parts.find((p) => p.name.startsWith("definition")).tokens')")
want_def_tok=$(( 15000 - $(num "$(field 'j.agents[0].tokens')") + deftok ))
cp "$H/agents/scout.md" "$T/scout.md.small"
fill "$H/agents/scout.md" $(( (want_def_tok * 27 + 5) / 10 + $(bytes "$H/agents/scout.md") - $(num "$(field 'j.agents[0].parts.find((p) => p.name.startsWith("definition")).bytes')") ))
run "$H/bin/start-context" --agent scout --profile "$(tn "$P")" --instructions "$(tn "$T/instr-empty")" --json
tok="$(field 'j.agents[0].tokens')"
if [ "$tok" = 15000 ]; then
    [ "$rc" = 0 ] && ok "15000 tokens exactly: within the threshold, exit 0" || bad "15000 tokens exactly: exit $rc"
else bad "could not build an estimate of exactly 15000 (got $tok)"; fi
fill "$H/agents/scout.md" $(( $(bytes "$H/agents/scout.md") + 3 ))
run "$H/bin/start-context" --agent scout --profile "$(tn "$P")" --instructions "$(tn "$T/instr-empty")" --json
[ "$rc" = 1 ] && [ "$(field 'j.agents[0].tokens')" = 15001 ] && ok "15001 tokens: over, exit 1" || bad "15001 tokens: exit $rc, tokens $(field 'j.agents[0].tokens')"
cp "$T/scout.md.small" "$H/agents/scout.md"

# The parts the Harness does not write are shown, never counted: blown up, they turn no agent red.
cp "$P/rules.md" "$T/rules.md.small"; cp "$HARNESS_HOME/user/rules.md" "$T/user-rules.small"
fill "$P/rules.md" 150000; fill "$T/instr-big" 150000; fill "$HARNESS_HOME/user/rules.md" 8000
run "$H/bin/start-context" --profile "$(tn "$P")" --instructions "$(tn "$T/instr-big")" --json
[ "$rc" = 0 ] && [ "$(field 'j.agents.every((a) => !a.over && a.tokens < 1000 && a.total > 100000)')" = true ] && ok "blown-up profile, instructions, user rules: not counted, exit 0, the whole start shows them" || bad "blown-up fixed parts: exit $rc, $(field 'j.agents.map((a) => a.agent + " " + a.tokens + "/" + a.total).join(", ")')"
[ "$(field 'j.agents[0].parts.find((p) => p.name.startsWith("profile")).bytes > 150000 && j.agents[0].parts.find((p) => p.name.startsWith("rules of the user")).bytes > 7000')" = true ] && ok "blown-up fixed parts: their sizes are still measured" || bad "blown-up fixed parts are not measured"
cp "$T/rules.md.small" "$P/rules.md"; cp "$T/user-rules.small" "$HARNESS_HOME/user/rules.md"
# common.md is the Harness's own: blown up, every agent goes red.
cp "$H/hooks/rules/common.md" "$T/common.md.small"
fill "$H/hooks/rules/common.md" 50000
run "$H/bin/start-context" --profile "$(tn "$P")" --instructions "$(tn "$T/instr-empty")" --json
[ "$rc" = 1 ] && [ "$(field 'j.agents.filter((a) => a.over && a.largest === "rules common.md (SubagentStart hook)").length')" = 4 ] && ok "blown-up common.md: counted, all four agents red" || bad "blown-up common.md: exit $rc, $(field 'j.agents.map((a) => a.agent + " " + a.tokens + " " + a.largest).join(", ")')"
cp "$T/common.md.small" "$H/hooks/rules/common.md"

# --- 3. The real texts of this Harness, a fixture rules.md of 23 KB -------------------------------
R="$T/real-profile"; mkdir -p "$R"
cp "$P/profile.json" "$R/profile.json"
fill "$R/rules.md" 23250
run "$SC" --profile "$(tn "$R")" --instructions "$(tn "$T/instr-empty")" --json
over="$(field 'j.agents.filter((a) => a.over).map((a) => a.agent + " " + a.tokens + " (largest part: " + a.largest + ")").join("; ")')"
[ "$rc" = 0 ] && ok "real texts: exit 0" || bad "real texts: exit $rc, want 0"$'\n'"$(cat "$T/err")"
[ "$(field 'j.agents.map((a) => a.agent).join(" ")')" = "implementer reviewer verifier scout" ] && [ -z "$over" ] \
    && ok "real texts: all four agents within the threshold" \
    || bad "real texts: over the threshold: $over — shorten the texts, never raise the threshold for this"
echo "real texts, tokens of the Harness's own parts: $(field 'j.agents.map((a) => a.agent + " " + a.tokens).join(", ")')"

# --- 3a. Step files of the skills: a part moved out of SKILL.md or an agent is still read ----------
# start-context counts only SKILL.md and the agent's definition: a file next to SKILL.md costs nothing at
# the start, so nothing but this check keeps a moved part from being lost. Every file next to a
# SKILL.md must be named as `${CLAUDE_PLUGIN_ROOT}/skills/<skill>/<file>` by that SKILL.md or by an agent
# definition (agents/*.md), and every such name in them must be a file on disk.
SKILLS_DIR="${SKILLS_DIR:-$HARNESS/skills}"
AGENTS_DIR="${AGENTS_DIR:-$HARNESS/agents}"
step_files=0
for d in "$SKILLS_DIR"/*/; do
    d="${d%/}"; sk="$(basename "$d")"; [ -f "$d/SKILL.md" ] || continue
    for f in "$d"/*; do
        n="$(basename "$f")"; [ "$n" = SKILL.md ] && continue
        step_files=$((step_files + 1))
        cat "$d/SKILL.md" "$AGENTS_DIR"/*.md | grep -qF "\${CLAUDE_PLUGIN_ROOT}/skills/$sk/$n\`" \
            && ok "skill $sk: $n is named by SKILL.md or an agent" || bad "skill $sk: $n lies next to SKILL.md, but neither SKILL.md nor an agent names it — the part is lost"
    done
done
for f in "$SKILLS_DIR"/*/SKILL.md "$AGENTS_DIR"/*.md; do
    for p in $(grep -oE '\$\{CLAUDE_PLUGIN_ROOT\}/skills/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+' "$f" | sed 's|^${CLAUDE_PLUGIN_ROOT}/skills/||' | sort -u); do
        [ -f "$SKILLS_DIR/$p" ] && ok "$(basename "$(dirname "$f")")/$(basename "$f") names skills/$p, and it exists" || bad "$f names skills/$p, which is not there"
    done
done
[ "$step_files" -gt 0 ] && ok "the skills have step files ($step_files)" || bad "no step file next to any SKILL.md"
# Claude Code spells out ${CLAUDE_PLUGIN_ROOT} only in SKILL.md and the agents, and Bash may have it empty:
# a step file that uses it says, on its third line, where the plugin root is (a block of step 11 once lost
# the documents silently, F printing nothing).
ROOT_LINE='Plugin root: `CLAUDE_PLUGIN_ROOT` in this file is the folder two levels above it.'
for f in "$SKILLS_DIR"/*/*.md; do
    [ "$(basename "$f")" = SKILL.md ] && continue
    grep -qF '${CLAUDE_PLUGIN_ROOT}' "$f" || continue
    sed -n 3p "$f" | grep -qF -- "$ROOT_LINE" && ok "$(basename "$f"): uses the placeholder and says where the plugin root is" \
        || bad "$(basename "$f"): uses \${CLAUDE_PLUGIN_ROOT} without the line '$ROOT_LINE' on its third line"
done

# --- 4. The usual instruction files, the auto memory, no profile -----------------------------------
G="$T/repo"; mkdir -p "$G"; git -C "$G" init -q
common="$(git -C "$G" rev-parse --path-format=absolute --git-common-dir)"
slug="$(node -e 'const p = require("path"); process.stdout.write(p.dirname(process.argv[1]).replace(/[^A-Za-z0-9]/g, "-"))' "$common")"
mkdir -p "$CLAUDE_CONFIG_DIR/projects/$slug/memory" "$G/.claude"
printf '%s\n' 'User instructions.' >"$CLAUDE_CONFIG_DIR/CLAUDE.md"
printf '%s\n' 'Repository instructions.' >"$G/CLAUDE.md"
printf '%s\n' 'Nested instructions.' >"$G/.claude/CLAUDE.md"
printf '%s\n' 'Local instructions.' >"$G/CLAUDE.local.md"
for i in $(seq 1 250); do printf -- '- memory line %03d\n' "$i"; done >"$CLAUDE_CONFIG_DIR/projects/$slug/memory/MEMORY.md"
mem200="$(head -n 200 "$CLAUDE_CONFIG_DIR/projects/$slug/memory/MEMORY.md" | wc -c | tr -d ' ')"
want=$(( $(bytes "$CLAUDE_CONFIG_DIR/CLAUDE.md") + $(bytes "$G/CLAUDE.md") + $(bytes "$G/.claude/CLAUDE.md") + $(bytes "$G/CLAUDE.local.md") + mem200 - 1 ))
(cd "$G" && node "$H/bin/start-context" --agent scout --json) >"$T/out" 2>"$T/err"; rc=$?
got="$(field 'j.agents[0].parts.find((p) => p.name.startsWith("instructions")).bytes')"
[ "$got" = "$want" ] && [ "$(field 'j.agents[0].parts.find((p) => p.name.startsWith("instructions")).name')" = "instructions (5 files)" ] && ok "default instructions: config CLAUDE.md, the repository's three, the first 200 lines of MEMORY.md ($got B)" || bad "default instructions: $got B, want $want; $(field 'j.agents[0].parts.find((p) => p.name.startsWith("instructions")).name')"
git -C "$G" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$G" worktree add -q "$T/wt" -b wt
(cd "$T/wt" && node "$H/bin/start-context" --agent scout --json) >"$T/out" 2>"$T/err"
got="$(field 'j.agents[0].parts.find((p) => p.name.startsWith("instructions")).bytes')"
want_wt=$(( $(bytes "$CLAUDE_CONFIG_DIR/CLAUDE.md") + mem200 - 1 ))
[ "$got" = "$want_wt" ] && ok "a worktree reads the auto memory of its main checkout" || bad "worktree instructions: $got B, want $want_wt"
# No bin/profile in the fixture Harness: no profile, no skill, a note.
(cd "$G" && node "$H/bin/start-context" --json) >"$T/out" 2>"$T/err"; rc=$?
[ "$(field 'j.agents.some((a) => a.parts.some((p) => /^(profile|bin\/profile|skill)/.test(p.name)))')" = false ] && field 'j.notes.join("\n")' | grep -q 'found no profile' && ok "no profile found: no profile or skill part, and a note says so" || bad "no profile: $(cat "$T/out" | head -c 600)"
# With a bin/profile that answers, its output is the profile part and its ticket_skill the skill.
printf '%s\n' 'const a = process.argv.slice(2)' 'if (a[0] === "--field") { process.stdout.write("ship-ticket\n") } else { process.stdout.write("x".repeat(1000)) }' >"$H/bin/profile"
(cd "$G" && node "$H/bin/start-context" --agent implementer --json) >"$T/out" 2>"$T/err"
[ "$(field 'j.agents[0].parts.filter((p) => /^(bin\/profile|skill)/.test(p.name)).map((p) => p.name + "=" + p.bytes).join(" ")')" = "bin/profile output=1000 skill skills/ship-ticket/SKILL.md=$(bytes "$H/skills/ship-ticket/SKILL.md")" ] && ok "default profile: bin/profile's output and its workflow.ticket_skill" || bad "default profile: $(field 'j.agents[0].parts.map((p) => p.name + "=" + p.bytes).join(" ")')"

# --- 5. Usage errors -------------------------------------------------------------------------------
run "$H/bin/start-context" --agent nobody
[ "$rc" = 2 ] && grep -q "unknown agent 'nobody'" "$T/err" && ok "unknown agent: exit 2" || bad "unknown agent: exit $rc"
run "$H/bin/start-context" --profile "$(tn "$T/no-such")"
[ "$rc" = 2 ] && grep -q 'no profile.json' "$T/err" && ok "missing profile: exit 2" || bad "missing profile: exit $rc"
run "$H/bin/start-context" --instructions "$(tn "$T/no-such")" --profile "$(tn "$P")"
[ "$rc" = 2 ] && grep -q 'cannot read --instructions' "$T/err" && ok "missing instructions file: exit 2" || bad "missing instructions file: exit $rc"
run "$H/bin/start-context" --bogus
[ "$rc" = 2 ] && ok "unknown option: exit 2" || bad "unknown option: exit $rc"
rm "$H/agents/scout.md"
run "$H/bin/start-context" --profile "$(tn "$P")" --instructions "$(tn "$T/instr-empty")"
[ "$rc" = 2 ] && grep -q 'no agent definition' "$T/err" && ok "missing definition: exit 2" || bad "missing definition: exit $rc"

# --- 6. The real home is untouched ------------------------------------------------------------------
after="$(real_home_snapshot "$REAL_HOME" "$T")"
[ "$before" = "$after" ] && ok "nothing written into the real home" || bad "the real home changed:"$'\n'"$(real_home_diff "$before" "$after")"

echo "passed: $pass, failed: $fail"
finished=1
[ "$fail" = 0 ]
