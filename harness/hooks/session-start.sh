#!/usr/bin/env bash
# SessionStart: mixes the project's context from its profile into a new session.
#
# Which project it is, is decided by bin/profile of this plugin from the session directory (the `cwd` field of
# the hook JSON, else $PWD): the registry $HARNESS_HOME/gate/config.json, the entry's "profile" field. A directory
# outside the registered projects, a project without a profile, or a profile without `session.inject_rules: true`
# and without `session.retro_reminder_after` — print nothing, code 0. That way the Auction session
# start stays empty, as it was.
#
# What is mixed in (the format is profiles/README.md, the `session` field); item 0 in a Silent project or with
# `attribution: off`, items 1–3 only with session.inject_rules: true, item 4 with any session.retro_reminder_after:
#   0. the workflow mode: in Silent mode (mode "silent") where the workflow files live (the Workflow folder)
#      and that branches, commits and PRs carry no trace of the workflow; with `attribution: off` that commits
#      and PRs carry no Claude attribution lines. A Full project with attribution on gets nothing here;
#   1. the profile's rules.md without the section «## Sources» / «## Источники» (it is for the maintainer,
#      not for the agent), under the heading session.rules_heading;
#   2. the lessons index <profile>/lessons/lessons-index.md, if the lessons live in the profile
#      (`lessons: "profile"`);
#   3. the active epic's map: <profile>/state/active-epic -> <profile>/epics/<epic>/map.md;
#   4. a reminder about /retro, if <profile>/state/pending-retro.log has at least
#      session.retro_reminder_after lines (hooks/session-end.sh appends them).
# Each section is at most CLAUDE_SESSION_SECTION_CAP bytes (20000 by default); a longer one is
# cut at a line boundary, and the last line is "… truncated, full text: <path>".
# Nothing is written into the repository.
#
# For tests: CLAUDE_PROFILE_BIN replaces bin/profile; CLAUDE_GATE_CONFIG and
# CLAUDE_PROFILES_DIR go to profile as they are. Tests: hooks/tests/session-hooks.test.sh.

set -uo pipefail

if ! command -v node >/dev/null 2>&1; then
    for d in "$HOME"/.nvm/versions/node/*/bin; do
        [ -d "$d" ] && PATH="$d:$PATH"
    done
fi
PATH="/opt/homebrew/bin:$PATH"
export PATH

# bin/profile of this plugin: the folder above hooks/, found from this script's real file.
PROFILE_BIN="${CLAUDE_PROFILE_BIN:-$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/.." && pwd -P)/bin/profile}"

input=""
[ -t 0 ] || input="$(cat 2>/dev/null || true)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$cwd" ] && [ -d "$cwd" ] || cwd="$PWD"

json="$("$PROFILE_BIN" -C "$cwd" --json 2>/dev/null)" || exit 0
field() { printf '%s' "$json" | jq -r "$1 // empty"; }
inject="$(printf '%s' "$json" | jq -r '.session.inject_rules // false')"
after="$(field '.session.retro_reminder_after')"
mode="$(field '._resolved.mode')"
attribution="$(field '.attribution')"
[ "$inject" = "true" ] || [ -n "$after" ] || [ "$mode" = silent ] || [ "$attribution" = off ] || exit 0

name="$(field '._resolved.name')"
dir="$(field '._resolved.dir')"
[ -n "$dir" ] && [ -d "$dir" ] || exit 0
state="$dir/state"
tilde='~'
short="${dir/#$HOME/$tilde}"

# Each section is at most CAP bytes: an epic map or a lessons index grown to hundreds
# of kilobytes would eat the context of every session. Cut at a line boundary (that way UTF-8 is not torn)
# and append where the full text lives.
CAP="${CLAUDE_SESSION_SECTION_CAP:-20000}"
case "$CAP" in '' | *[!0-9]*) CAP=20000 ;; esac
ctx=""
add() { # $1 heading, $2 text, $3 file with the full text (for the truncation line)
    [ -n "$2" ] || return 0
    local text="$2"
    if [ "$(printf '%s' "$text" | wc -c | tr -d ' ')" -gt "$CAP" ]; then
        local cut chunk
        # Take CAP+1 bytes: if the last of them is a newline, the boundary fell exactly on
        # the end of a line and all lines are whole; otherwise the last line is incomplete and is dropped.
        chunk="$(printf '%s' "$text" | head -c "$((CAP + 1))"; printf x)"
        chunk="${chunk%x}"
        if [[ "$chunk" == *$'\n' ]]; then
            cut="${chunk%$'\n'}"
        else
            cut="$(printf '%s' "$chunk" | sed '$d')"
        fi
        [ -n "$cut" ] || cut="$(printf '%s' "$text" | head -c "$CAP" | iconv -c -f UTF-8 -t UTF-8 2>/dev/null)"
        text="$cut"$'\n'"… truncated, full text: ${3:-the source file}"
    fi
    ctx+=$'\n'"## $1"$'\n'"$text"$'\n'
}

# The workflow mode goes first: it decides where every document of the session is written.
modetext=""
if [ "$mode" = silent ]; then
    wf="$(field '._resolved.workflow_folder')"
    modetext+="This project works in Silent mode. Its workflow files — tickets, epic specs, the state file, ADRs, the glossary, lessons, evidence screenshots — live in the Workflow folder ${wf/#$HOME/$tilde}, not in the repository; relative paths of the profile's tickets and docs fields are taken from that folder, and \`ticket\` writes the status there from any worktree. Documents in the repository are read-only, unless the ticket's own goal is a document for the team."$'\n'
    modetext+="Branches, commit messages, PR titles, descriptions and comments, and code comments describe the change itself: no epic names, ticket or ADR numbers, Workflow folder paths, \`.scratch\` or \`HANDOFF\`. Name a branch by what it changes (\`fix/lot-withdraw-button\`) and record it with \`ticket claim <epic> <NN> --branch <branch>\`. The Bash guard refuses commits, branch names and PR texts with such traces (\`bin/silent-check\` shows them)."$'\n'
fi
if [ "$attribution" = off ]; then
    modetext+="Attribution is off for this project: commit messages and PR descriptions carry no Claude attribution lines (\`Co-Authored-By: Claude …\`, \`Generated with [Claude Code]\`) — leave them out even where other instructions ask for them; the Bash guard refuses commits and PR texts that carry them."$'\n'
fi
add "Workflow mode (profile $name)" "${modetext%$'\n'}"

if [ "$inject" = "true" ] && [ -s "$dir/rules.md" ]; then
    rules="$(awk '/^## /{skip=($0 ~ /^## (Sources|Источники)/)} !skip' "$dir/rules.md")"
    heading="$(field '.session.rules_heading')"
    add "${heading:-Project rules (profile $name)}" "$rules" "$dir/rules.md"
fi

if [ "$inject" = "true" ] && [ "$(field '.lessons')" = "profile" ] && [ -s "$dir/lessons/lessons-index.md" ]; then
    add "Lessons learned so far (one-liners; full log in $short/lessons/lessons.md)" "$(cat "$dir/lessons/lessons-index.md")" "$dir/lessons/lessons-index.md"
fi

active="$(cat "$state/active-epic" 2>/dev/null || true)"
if [ "$inject" = "true" ] && [ -n "$active" ] && [ -s "$dir/epics/$active/map.md" ]; then
    add "Active epic: $active" "$(cat "$dir/epics/$active/map.md")" "$dir/epics/$active/map.md"
fi

if [ -n "$after" ]; then
    pending=0
    [ -f "$state/pending-retro.log" ] && pending="$(wc -l <"$state/pending-retro.log" | tr -d ' ')"
    if [ "${pending:-0}" -ge "$after" ]; then
        add "Housekeeping" "$pending sessions have ended without a retrospective. Suggest running /retro when this session reaches a natural pause."
    fi
fi

[ -n "$ctx" ] || exit 0

jq -n --arg c "$ctx" \
    '{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:$c}}'
