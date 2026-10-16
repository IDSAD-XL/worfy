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
has implementer 'node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"' \
    && ok "implementer: gate through \${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" || bad "implementer: no \${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs fast call"
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
# for the implementer's required reading (Profile contract, ticket 11), the Russian metaphor
# examples of the section on terms, and the name a Profile gives the lens "simplification"
# (ticket worfy-review/02).
ALLOWED=(
    '[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ' 'ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение недоступно' '[gate] зелено' 'ничего не прогналось'
    '<эпик>' '<ветка>' '<что-ревьюишь>' '## Обязательное чтение исполнителя'
    '«ручка»' '«проба»' '«выкат»' '«прогон»' '«диверсия»' '«сторож»' '«ворота»' '«врезка»' '«грабли»' '«ложная зелень»'
    'упрощение'
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
rv "intended breakage: the ticket on the base branch, the spec or the brief says so" \
    '"Intended" means stated in the ticket as it reads on the base branch (`git show <base>:<ticket path>`), in the epic'"'"'s spec or in the brief'
rv "intended breakage: a guess from the diff or a commit message does not count" \
    'in the brief — not guessed from the diff or from a commit message.'
rv "intended breakage: a line the diff adds to the ticket does not count" \
    'A line the diff itself adds to the ticket, to its result section for example, does not make a removal intended: the implementer writes there.'
rv "intended breakage: without such a statement the removal is a finding" \
    'With no such statement to read, the removal is a finding as usual.'
rv "intended breakage: the two exceptions are findings" 'Two exceptions, where it is still a finding:'
rv "intended breakage, exception 1: underestimated consequences" 'underestimated the consequences — the finding says what was underestimated'
rv "intended breakage, exception 2: malicious or harmful" 'looks malicious or harmful — the finding says how'
rv "scope: the change, three kinds of finding" '**Scope — the change, not the code around it.** A finding is about one of three things:'
rv "scope: added, changed and removed lines" '- a line the diff adds, changes or removes; removed lines are part of the diff'
rv "scope: an unmet item of the ticket" '- an item of the ticket the change leaves unmet;'
rv "scope: evidence that does not hold" \
    '- evidence that does not hold: a claim of the implementer'"'"'s report, an attached screenshot or command output that does not show what is claimed, screenshots of a UI ticket that could not be taken'
rv "scope: an unchanged line the change breaks is in scope" \
    'An unchanged line that the change breaks — a caller of a function whose behaviour moved — is in scope too: the finding names the changed line that breaks it.'
rv "scope: an old defect goes on the 'outside the diff' line, without a severity" \
    'one the change neither causes nor was asked to fix, is not a finding: it goes on a separate "outside the diff: …" line, without a severity.'
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

# --- 9. reviewer: the lens "simplification" (ticket worfy-review/02) ---------------------------
# Lens descriptions live in reviewer.md, in the section "Lens descriptions" before the section on
# terms. Every sentence of the lens is looked up inside its own section, so a rule that moves out
# of the section fails the check too.
rv "a lens is read by its description, and by its name without one" \
    'What a lens looks for is in the section "Lens descriptions" below, when the lens is described there; a lens without a description is read by its name.'
line_of() { grep -nxF -- "$1" "$AGENTS/reviewer.md" | head -n 1 | cut -d: -f1; }
descriptions="$(line_of '## Lens descriptions')" lens_at="$(line_of '### Lens: simplification')" terms="$(line_of '## Terms')"
[ -n "$descriptions" ] && [ -n "$lens_at" ] && [ -n "$terms" ] && [ "$descriptions" -lt "$lens_at" ] && [ "$lens_at" -lt "$terms" ] \
    && ok "reviewer: 'Lens: simplification' is inside 'Lens descriptions', before the section on terms" \
    || bad "reviewer: no '### Lens: simplification' between '## Lens descriptions' and '## Terms' (lines: [$descriptions] [$lens_at] [$terms])"
# section HEADING: the text under that heading, up to the next heading of any level.
section() { awk -v h="$1" '$0 == h { s = 1; next } s && /^##* / { exit } s' "$AGENTS/reviewer.md"; }
in_text() { printf '%s\n' "$1" | tr '\n' ' ' | tr -s ' ' | grep -qF -- "$2"; } # $1 = text, $2 = literal sentence
# sentences TEXT WHERE [whole]: every line "label :: sentence" on stdin must be in TEXT; with
# `whole`, the sentences in their order, joined by spaces, must also be all of TEXT.
sentences() {
    local line all=""
    while IFS= read -r line; do
        if in_text "$1" "${line#* :: }"; then ok "reviewer, $2: ${line%% :: *}"; else bad "reviewer, $2: ${line%% :: *} — no '${line#* :: }'"; fi
        all="${all:+$all }${line#* :: }"
    done
    [ "${3:-}" = whole ] || return 0
    [ "$(printf '%s\n' "$1" | tr '\n' ' ' | tr -s ' ' | sed 's/^ //; s/ $//')" = "$all" ] \
        && ok "reviewer, $2: nothing but these sentences, in this order" || bad "reviewer, $2: the text is not exactly these sentences in this order"
}
sentences "$(section '## Lens descriptions')" "lens descriptions" <<'EOF'
the general rules hold for every lens :: The rules above — the scope, the rules of evidence, the answer format — hold for every lens.
a description adds what the lens looks for and leaves out :: A description below adds what its lens looks for and what it leaves out.
a lens without a description is read by its name :: A lens that has no description here is read by its name.
EOF
LENS="$(section '### Lens: simplification')"
sentences "$LENS" "lens simplification" <<'EOF'
the profile's name of the lens :: The profile may name this lens `упрощение`: `упрощение` and `simplification` are one and the same lens.
the question of the lens :: The question of the lens: what in the diff can be deleted, reused or made simpler while the behaviour stays the same. Look for:
a restructuring that makes code disappear :: - **A restructuring that makes code disappear.** Another arrangement of the change, with the same behaviour, after which a branch, a mode, a layer or a wrapper is no longer needed. Complexity that only moves to another place does not count.
thin wrappers and identity functions :: - **Thin wrappers and identity functions.** A function, a class or a type that only passes its input on and adds nothing: no check, no conversion, no clearer name for the caller.
types looser than the code needs :: - **Types looser than the code needs.** A type cast, `any` or `unknown` where the real type is known; an optional field or parameter that every caller sets, or that none sets.
logic in the wrong layer :: - **Logic in the wrong layer.** Feature logic added to a shared path, or an implementation detail that shows through an interface, when the module that owns the concept already exists.
a repeat of an existing helper, with its path :: - **A repeat of a helper that already exists.** The finding gives the path to the existing helper.
delete :: - **Delete.** Dead code, an option nobody sets, a feature nobody asked for.
the standard library or an installed dependency :: - **Take it from the standard library or an installed dependency.** Code written by hand although the language, its standard library, the platform or a package the project already installs offers the same; and the reverse, a package brought in to save a handful of lines.
not needed now :: - **Not needed now.** Generality with a single case behind it: an interface only one class implements, a parameter that always gets the same value, an extension point for a case that does not exist yet.
merge :: - **Merge.** Pieces of code that differ only in a detail, where an edit to one has to be repeated in the others.
split by task, not by length :: - **Split by task.** A function that mixes tasks which have nothing to do with each other. The parts follow the tasks: the number of lines is no reason to cut, and a helper cut out only so that its caller looks shorter is itself a thin wrapper.
three filters :: Three filters, each of which takes a suggestion out of the findings:
the lens keeps the scope rule :: The lens stays inside the scope rule above: it asks about lines the diff adds or changes. Code the diff did not touch that could be simpler goes on the "outside the diff: …" line.
EOF
# Every filter is checked on its own text: a sentence that moves under another filter fails, and so
# does a sentence added to a filter.
filter() { printf '%s\n' "$LENS" | awk -v n="$1." '/^[0-9]+\. / { cur = $1 } /^$/ { cur = "" } cur == n'; }
sentences "$(filter 1)" "lens simplification, filter 1" whole <<'EOF'
nothing to point at, no finding :: 1. **A suggestion with nothing to point at is not a finding.**
a finding shows what it rests on :: A finding of this lens shows what it rests on: the line, and with it the input that never arrives, the caller that does not exist, the second copy, or the existing helper with its path.
without that nothing is written, not even a question :: A suggestion that rests on nothing of the kind — "this could be cleaner", a name or a style you would choose differently — is not written at all, not even as a question: here the lens is stricter than the general rule of evidence.
EOF
sentences "$(filter 2)" "lens simplification, filter 2" whole <<'EOF'
a shortcut comment is the author's decision :: 2. **A `shortcut:` comment records the author's decision; it is not a finding.**
the form of the comment :: An author who simplifies knowingly marks the code with a comment of this form, in the comment syntax of the language: `shortcut: <limit>, <when to redo>`.
the two parts of the comment :: `<limit>` is what the simple code does not handle; `<when to redo>` is the condition under which it has to be replaced.
an example whose limit is what the code does not handle :: Example: `// shortcut: no more than two formats, redo when a third format appears`.
the marked code is not reported as a simplification :: For the code such a comment marks: do not report it as a simplification, and do not propose to build what the comment postpones.
any other defect in the marked code is reported :: Any other defect in that code is reported as usual.
a comment without a limit or a condition decides nothing :: The filter has two limits. A comment without a limit or without a condition (`shortcut: fix later`) decides nothing: the code under it is reviewed as usual.
a condition the diff already meets is a low finding :: And when the diff itself already meets the condition, that is a `[low]` finding, never a higher one: it names the line that meets it.
EOF
sentences "$(filter 3)" "lens simplification, filter 3" whole <<'EOF'
outside the ticket's files, a proposal for a new ticket :: 3. **A restructuring outside the ticket's files is a proposal for a new ticket, not a blocking finding.**
the ticket's files :: The ticket's files are those of its trail section (`tickets.trail_section` of the profile); with no ticket, the files the diff changes.
written as a low finding, never higher :: A simplification that needs edits outside them is written as `path:line: [low] new ticket: <what to restructure, in which files>` — never as `[high]` or `[med]`.
EOF
steps="$(printf '%s\n' "$LENS" | awk '/^[0-9]+\. /{print substr($0,1,2)}' | tr -d '\n')"
[ "$steps" = "1.2.3." ] && ok "reviewer, lens simplification: the filters are items 1. to 3. of the section" \
    || bad "reviewer, lens simplification: numbered items of the section: [$steps]"
# The sources close the section: project, file, commit and licence of each, and what was taken from
# it (spec of worfy-review, owner's decision 1). The paragraph is nothing but these three sentences.
sentences "$(printf '%s\n' "$LENS" | awk 'BEGIN { RS = "" } { p = $0 } END { print p }')" "the last paragraph of lens simplification" whole <<'EOF'
names Thermos, the file, the commit, the licence and what was taken :: Source: Thermos, `thermos/skills/thermo-nuclear-code-quality-review/SKILL.md`, commit `ccb5507cec1546dc88135c1139c811e6c59115ba` of `cursor/plugins` (MIT, Copyright (c) 2026 Cursor) — the restructuring that makes code disappear, thin wrappers, loose types, logic in the wrong layer and the repeat of an existing helper.
names ponytail, the files, the commit, the licence and what was taken :: Source: ponytail, `skills/ponytail-review/SKILL.md` and `skills/ponytail/SKILL.md`, commit `9cc65d03aa2da1db7121b912d03596409ee340b8` of `DietrichGebert/ponytail` (tag v5.1.0; MIT, Copyright (c) 2026 DietrichGebert) — delete, the standard library, not needed now, merge and split; the first filter and the `shortcut:` comment.
says what is reworded and what is taken as it is :: The rules are reworded, not copied: taken as they are only the marker `shortcut:` and the category names delete, merge and split. The third filter is this project's own rule.
EOF
# --- 10. implementer: the smallest complete change (ticket worfy-review/04) ---------------------
# Step 4 of section Order: the order of options, the two rules before the edit, what is never cut,
# the `shortcut:` comment and the script that lists such comments; the source and its licence
# close the section. Sentences are looked up in the section with line breaks folded into spaces.
ORDER="$(awk '/^## Order/{o=1; next} o && /^## /{exit} o' "$AGENTS/implementer.md")"
im() { if in_text "$ORDER" "$2"; then ok "implementer, Order: $1"; else bad "implementer, Order: $1 — no '$2'"; fi; }
im "step 4 is the smallest complete change, after the failing test" \
    "4. Implementation inside the ticket's trail: the smallest change that does the whole ticket. It comes after step 3 — the failing test stays first — and it never drops an item of the ticket's list of what \"done\" means."
im "before the edit: every place the change has to reach" \
    '- Before the edit, list every place the change has to reach: callers, tests, fixtures, configuration, exports.'
im "a bug: grep every caller, fix once in the shared code" \
    '- For a bug, grep every caller of the function you change and fix the cause once, in the shared code.'
im "the order of options is introduced" '- Then take the first of these options that solves the whole task:'
# The six options are a nested list: indented, so the check of steps 1. to 6. above still sees only
# the steps of Order. Each option is checked on its own line, in its place.
options="$(printf '%s\n' "$ORDER" | grep -E '^ +[1-6]\. ' | sed -E 's/^ +//')"
want_options='1. Nothing: the task does not need this code.
2. Code the repository already has — a helper, a component, a pattern; use it the way the code around it does.
3. The standard library or a feature of the platform.
4. A dependency the project already installs; a new dependency for a few lines is not an option.
5. One line that a reader understands at a glance.
6. The least new code that works.'
[ "$options" = "$want_options" ] && ok "implementer, Order: the six options of step 4, indented, in their order" \
    || bad "implementer, Order: the six options:"$'\n'"$options"
im "what is never cut" \
    '- Never cut, whatever the size of the change: checks of input at a trust boundary, error handling that keeps data from being lost, security, accessibility, anything the ticket asks for.'
im "the shortcut comment and its form" \
    '- A simplification with a known limit gets a comment in the comment syntax of the language: `shortcut: <limit>, <when to redo>` — what the simple code does not handle, then the condition under which it has to be replaced.'
im "a comment without the condition is incomplete" \
    'A comment without the part after the comma is incomplete: nobody will know when to redo the code.'
im "the script that lists the comments" \
    '`${CLAUDE_PLUGIN_ROOT}/bin/shortcut-ledger` lists the `shortcut:` comments of a work tree and marks the incomplete ones `no-trigger`.'
im "the source: ponytail, the files, the commit and what was taken" \
    'Source of step 4: ponytail, `skills/ponytail/SKILL.md` and `skills/ponytail-debt/SKILL.md`, commit `9cc65d03aa2da1db7121b912d03596409ee340b8` of `DietrichGebert/ponytail` (tag v5.1.0) — the order of options, the list of places before the edit, the rule for a bug, what is never cut, the `shortcut:` comment and the `no-trigger` mark.'
im "what is reworded and why the licence goes with it" \
    'The rules are reworded; the marker `shortcut:` and the mark `no-trigger` are taken as they are. The order of options follows the source closely, so its licence goes with it — `LICENSE` of the source at that commit:'
# The licence is the source's LICENSE at that commit, whole, as the last block of the section.
licence="$(printf '%s\n' "$ORDER" | awk '/^```text$/{b=1; t=""; next} b && /^```$/{b=0; last=t; next} b{t = t $0 "\n"} END{printf "%s", last}')"
MIT_PONYTAIL='MIT License

Copyright (c) 2026 DietrichGebert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.'
[ "$licence" = "$MIT_PONYTAIL" ] && ok "implementer, Order: the full MIT licence of ponytail, with its copyright line" \
    || bad "implementer, Order: the licence block is not the MIT licence of ponytail:"$'\n'"$licence"
last_line="$(printf '%s\n' "$ORDER" | grep -v '^$' | tail -n 1)"
[ "$last_line" = '```' ] && ok "implementer, Order: the licence closes the section" || bad "implementer, Order: the section ends with [$last_line], not the licence block"
# The script the text names is in harness/bin.
[ -x "$AGENTS/../bin/shortcut-ledger" ] && ok "implementer: bin/shortcut-ledger exists" || bad "implementer: bin/shortcut-ledger is missing"

# The Profile contract points at the descriptions (harness/profiles/README.md, the row of review.lenses).
README="${PROFILES_README_FILE:-$AGENTS/../profiles/README.md}"
LENSES_ROW='the project'"'"'s review lenses; the orchestrator gives each reviewer one. What a lens looks for is described in `agents/reviewer.md`, section "Lens descriptions"; a lens that has no description there is read by its name. The lens `simplification` described there may be named `упрощение` in a profile |'
if [ ! -f "$README" ]; then bad "profiles/README.md not found at $README"
elif grep -F -- '| `review.lenses` | strings |' "$README" | grep -qF -- "$LENSES_ROW"; then ok "profiles/README.md: the row of review.lenses points at the lens descriptions"
else bad "profiles/README.md: the row of review.lenses has no '$LENSES_ROW'"; fi

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
