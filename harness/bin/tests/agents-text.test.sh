#!/usr/bin/env bash
# Text of the Harness agents (harness/agents/{implementer,reviewer,scout}.md) after the move to the
# plugin (ticket worfy-harness/07): English text, paths through ${CLAUDE_PLUGIN_ROOT}, the worfy:
# prefix for skills and agents, EXIT=$? instead of the old Russian exit-code line, an unchanged
# JSON report of the implementer, the English brief labels shared with skill epic-wave, and
# Cyrillic only in the strings other programs and files still expect.
# Run: bash harness/bin/tests/agents-text.test.sh; exit code 0 means every check passed.
# AGENTS_DIR checks another copy of the agents.
set -u
AGENTS="${AGENTS_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/agents}"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
has() { grep -qF -- "$2" "$AGENTS/$1.md"; } # $1 = agent, $2 = literal text
# strip FILE STRING...: print FILE without every literal STRING. Perl, not ${t//"$s"/}: bash 3.2
# (macOS) mangles a quoted ~ in that pattern.
strip() {
    local f="$1"; shift
    STRIP="$(printf '%s\n' "$@")" perl -CSD -0777 -pe \
        'BEGIN { @s = grep { length } split /\n/, $ENV{STRIP}; utf8::decode($_) for @s } for my $s (@s) { s/\Q$s\E//g }' "$f"
}

ALL="implementer reviewer scout"
for a in $ALL; do
    [ -f "$AGENTS/$a.md" ] || { bad "$a.md not found in $AGENTS"; echo "passed $pass, failed $fail"; exit 1; }
done

# The one sentence that may name ~/.claude/bin: Profile values of schema 1 that start with it.
BIN_RULE='`~/.claude/bin/` (schema 1)'
# --- 1. ~/.claude only as transcripts, the brief label and the schema-1 rule ------------------
for a in $ALL; do
    left="$(strip "$AGENTS/$a.md" '~/.claude/projects' 'Write to ~/.claude' "$BIN_RULE" | grep -nE '~/\.claude|\$HOME/\.claude|\$\{HOME\}/\.claude')"
    [ -z "$left" ] && ok "$a: ~/.claude only as ~/.claude/projects, 'Write to ~/.claude' and the schema-1 rule" \
        || bad "$a: other ~/.claude paths: $left"
done

# --- 2. Profile and Gate through ${CLAUDE_PLUGIN_ROOT} ----------------------------------------
for a in $ALL; do
    has "$a" '`${CLAUDE_PLUGIN_ROOT}/bin/profile -C <' && has "$a" '`${CLAUDE_PLUGIN_ROOT}/bin/profile` in the current directory' \
        && ok "$a: first action runs \${CLAUDE_PLUGIN_ROOT}/bin/profile" || bad "$a: no \${CLAUDE_PLUGIN_ROOT}/bin/profile call"
    sed -n '/^---$/,/^---$/p' "$AGENTS/$a.md" | grep '^description:' | grep -qF '${CLAUDE_PLUGIN_ROOT}/bin/profile' \
        && ok "$a: description names \${CLAUDE_PLUGIN_ROOT}/bin/profile" || bad "$a: description does not name \${CLAUDE_PLUGIN_ROOT}/bin/profile"
done
has implementer 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh fast </dev/null; echo "EXIT=$?"' \
    && ok "implementer: gate through \${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh" || bad "implementer: no \${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh fast call"
for a in implementer reviewer; do
    grep -F -- "$BIN_RULE" "$AGENTS/$a.md" | grep -qF '`${CLAUDE_PLUGIN_ROOT}/bin/`' \
        && ok "$a: rule for Profile values starting with ~/.claude/bin/" || bad "$a: no rule for Profile values starting with ~/.claude/bin/"
done

# --- 3. name:, description, the worfy: prefix -------------------------------------------------
for a in $ALL; do
    fm="$(sed -n '1,/^---$/{1d;/^---$/d;p;}' "$AGENTS/$a.md")"
    [ "$(printf '%s\n' "$fm" | sed -n 's/^name: //p')" = "$a" ] && ok "$a: name: is $a" || bad "$a: name: is not $a"
    d="$(printf '%s\n' "$fm" | sed -n 's/^description: //p')"
    if [ -z "$d" ]; then bad "$a: no description"
    elif printf '%s\n' "$d" | perl -CSD -ne 'exit 1 if /\p{Cyrillic}/'; then ok "$a: description has no Cyrillic"
    else bad "$a: description has Cyrillic"; fi
    left="$(grep -n '/ship-ticket\|/epic-wave' "$AGENTS/$a.md")"
    [ -z "$left" ] && ok "$a: no skill call without worfy:" || bad "$a: skill call without worfy:: $left"
done
has implementer '`/worfy:ship-ticket`, step 8' && ok "implementer: CI wait block is in /worfy:ship-ticket" \
    || bad "implementer: no /worfy:ship-ticket step 8"
grep -F 'workflow.ticket_skill' "$AGENTS/implementer.md" | grep -F '`ship-ticket`' | grep -qF '`/worfy:ship-ticket`' \
    && ok "implementer: bare ship-ticket in workflow.ticket_skill means /worfy:ship-ticket" \
    || bad "implementer: no rule for a bare ship-ticket in workflow.ticket_skill"
has implementer '`worfy:reviewer`' && ok "implementer: names the reviewer agent as worfy:reviewer" || bad "implementer: no worfy:reviewer"
has reviewer '`worfy:implementer`' && ok "reviewer: names the implementer agent as worfy:implementer" || bad "reviewer: no worfy:implementer"

# --- 4. EXIT=$? instead of the old exit-code line ---------------------------------------------
for a in $ALL; do
    left="$(grep -n 'КОД=' "$AGENTS/$a.md")"
    [ -z "$left" ] && ok "$a: no КОД=" || bad "$a: КОД= left: $left"
done
[ "$(grep -oF 'echo "EXIT=$?"' "$AGENTS/implementer.md" | wc -l)" -ge 2 ] \
    && ok "implementer: verify and gate print EXIT=\$?" || bad "implementer: fewer than two echo \"EXIT=\$?\""
has reviewer '<commands.verify>; echo "EXIT=$?"' && ok "reviewer: verify prints EXIT=\$?" || bad "reviewer: no <commands.verify>; echo \"EXIT=\$?\""

# --- 5. JSON report of the implementer and its steps 1-6 --------------------------------------
awk '/^## Report/{r=1} r && /^```json$/{j=1; next} j && /^```$/{exit} j' "$AGENTS/implementer.md" >"$T/report.json"
want='["branch","claims","commands","files_changed","not_verified","out_of_scope","pr","removed","ticket","worktree"]'
got="$(jq -c 'keys' "$T/report.json" 2>&1)"
[ "$got" = "$want" ] && ok "implementer: JSON report example parses with jq and has the ten keys" \
    || bad "implementer: JSON report example: got [$got] want [$want]"
got="$(jq -c '[(.commands[0] | keys), (.claims[0] | keys)]' "$T/report.json" 2>&1)"
[ "$got" = '[["cmd","exit_code"],["evidence","text"]]' ] && ok "implementer: commands[] and claims[] keep their keys" \
    || bad "implementer: commands[]/claims[] keys: [$got]"
steps="$(awk '/^## Order/{o=1; next} o && /^## /{exit} o && /^[1-6]\. /{print substr($0,1,2)}' "$AGENTS/implementer.md" | tr -d '\n')"
[ "$steps" = "1.2.3.4.5.6." ] && ok "implementer: steps 1. to 6. in section Order" || bad "implementer: steps in Order: [$steps]"

# --- 6. brief labels and tools: ---------------------------------------------------------------
# The rule is general: any write to ~/.claude needs the brief's permission, not only a test with a
# real Claude Code (that test is just an example of such a write).
WRITE_RULE='Write to the Claude configuration directory only if the brief says `Write to ~/.claude: allowed`.'
for a in implementer reviewer; do
    has "$a" 'Write to ~/.claude: allowed' && ok "$a: brief label 'Write to ~/.claude'" || bad "$a: no brief label 'Write to ~/.claude: allowed'"
    grep -E '^- ' "$AGENTS/$a.md" | grep -qF -- "$WRITE_RULE" \
        && ok "$a: general rule: write to ~/.claude only when the brief allows it" \
        || bad "$a: no general rule '$WRITE_RULE' at the start of a list item"
    # GH_TOKEN comes from the plugin's SessionStart hook (worfy-harness ticket 18), not from the brief.
    has "$a" 'is set by the plugin'"'"'s `SessionStart` hook' && has "$a" '"Could not resolve to a Repository", compare `gh auth status` with `github.account`' \
        && ok "$a: GH_TOKEN from the SessionStart hook, 'Could not resolve' check kept" \
        || bad "$a: no rule about GH_TOKEN from the SessionStart hook"
    has "$a" 'gh auth token -u' && bad "$a: still has the manual GH_TOKEN=\$(gh auth token -u …) prefix" \
        || ok "$a: no manual gh auth token prefix"
done
# The qmd server of the plugin (harness/.mcp.json, worfy-harness ticket 17): its tools are mcp__plugin_worfy_qmd__*.
TOOLS='tools: Read, Grep, Glob, Bash, mcp__plugin_worfy_qmd__query, mcp__plugin_worfy_qmd__get, mcp__plugin_worfy_qmd__multi_get, mcp__plugin_worfy_qmd__status'
for a in reviewer scout; do
    [ "$(sed -n '1,/^---$/{1d;/^---$/d;p;}' "$AGENTS/$a.md" | grep '^tools:')" = "$TOOLS" ] \
        && ok "$a: tools: is the plugin qmd list" || bad "$a: tools: changed"
done
sed -n '1,/^---$/{1d;/^---$/d;p;}' "$AGENTS/implementer.md" | grep -q '^tools:' && bad "implementer: got a tools: line" \
    || ok "implementer: no tools: line (all tools, as before)"

# --- 7. Cyrillic only where other programs and files still expect it -------------------------
# Gate verdict words (their new text is ticket 09), Profile placeholders and the Profile heading
# for the implementer's required reading (Profile contract, ticket 11), and the Russian metaphor
# examples of the section on terms.
ALLOWED=(
    '[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ' 'ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение недоступно' '[gate] зелено' 'ничего не прогналось'
    '<эпик>' '<ветка>' '<что-ревьюишь>' '## Обязательное чтение исполнителя'
    '«ручка»' '«проба»' '«выкат»' '«прогон»' '«диверсия»' '«сторож»' '«ворота»' '«врезка»' '«грабли»' '«ложная зелень»'
)
for a in $ALL; do
    left="$(strip "$AGENTS/$a.md" "${ALLOWED[@]}" | perl -CSD -ne 'print "$.: $_" if /\p{Cyrillic}/')"
    [ -z "$left" ] && ok "$a: Cyrillic only in the allowed strings" || bad "$a: Cyrillic outside the allowed strings:"$'\n'"$left"
done
# The metaphor examples stay in the section on terms of every agent.
for a in $ALL; do
    has "$a" '«ложная зелень»' && ok "$a: Russian metaphor examples kept" || bad "$a: Russian metaphor examples lost"
done

# --- 8. reviewer: checks for a broken local build and a feature-flag leak, scope by the diff ---
# (ticket worfy-review/01). The text is wrapped, so a phrase is looked up in the file with its line
# breaks folded into spaces.
flat() { tr '\n' ' ' <"$AGENTS/$1.md" | tr -s ' '; }
has_flat() { flat "$1" | grep -qF -- "$2"; } # $1 = agent, $2 = literal text
rv() { if has_flat reviewer "$2"; then ok "reviewer: $1"; else bad "reviewer: $1 — no '$2'"; fi; }
rv "broken local build: environment variables" 'renames or adds an environment variable'
rv "broken local build: where secrets are read" 'reads secrets from another place'
rv "broken local build: ports" 'moves a port'
rv "broken local build: a new required script" 'adds a script that has to be run before'
rv "an ordinary new dependency is not a finding" 'a dependency the package manager installs the usual way is not a finding'
rv "leak from behind a feature flag or an internal check" 'leaks from behind its feature flag or an internal-only check'
rv "no unfinished research" '**No unfinished research.**'
rv "no unfinished research: read the other side of the call" 'read it before you conclude'
rv "intended breakage is not a finding" '**Intended breakage is not a finding.**'
rv "intended breakage: only when the ticket says so" 'means written in the ticket'
rv "intended breakage, exception 1: underestimated consequences" 'underestimated the consequences — the finding says what was underestimated'
rv "intended breakage, exception 2: malicious or harmful" 'looks malicious or harmful — the finding says how'
rv "scope: added, changed and removed lines" 'A finding is about a line the diff adds, changes or removes'
rv "scope: an old defect goes on the 'outside the diff' line" 'is not a finding: it goes on a separate "outside the diff: …" line'
rv "answer format has the 'outside the diff' line" '"outside the diff: `path:line` — <an old defect next to the change>"'
rv "the question about what the change removed is kept" 'what did the change remove.**'
# The borrowed rules name their source: project, file and commit (spec of worfy-review, owner's decision 1).
THERMOS_SOURCE='Source: Thermos, `thermos/skills/thermo-nuclear-review/SKILL.md`, commit `ccb5507cec1546dc88135c1139c811e6c59115ba`'
rv "the borrowed rules name Thermos, the file and the commit" "$THERMOS_SOURCE"

# No word written wholly in capitals: such pressure gives newer models false alarms. A word here is
# a run of four or more capital Latin letters; the allowed ones are names of the protocol and of files.
CAPS_ALLOWED='VERIFIED REJECTED NARROW EXIT JSON CLAUDE PLUGIN ROOT AGENTS TOKEN SKILL'
caps="$(CAPS_ALLOWED="$CAPS_ALLOWED" perl -ne 'BEGIN { %ok = map { $_ => 1 } split " ", $ENV{CAPS_ALLOWED} }
    while (/(?<![A-Z])([A-Z]{4,})(?![A-Z])/g) { print "$.: $1\n" unless $ok{$1} }' "$AGENTS/reviewer.md")"
[ -z "$caps" ] && ok "reviewer: no word of four or more capital letters outside the allowed names" \
    || bad "reviewer: words in capitals:"$'\n'"$caps"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
