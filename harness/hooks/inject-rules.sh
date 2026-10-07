#!/usr/bin/env bash
# Hook SessionStart / SubagentStart: hands one part of the Harness rules to the session as
# additionalContext (ADR-0041). Usage in hooks.json: "${CLAUDE_PLUGIN_ROOT}/hooks/inject-rules.sh" <part>,
# where <part> names rules/<part>.md next to this script.
#
# Reads the hook event JSON on stdin and prints
#   {"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":"<text of the part>"}}
# Claude Code does not expand ${CLAUDE_PLUGIN_ROOT} inside additionalContext, so this script does:
# with the value from the environment, or, without it, with the plugin folder (the one above hooks/).
#
# Always exits 0: a broken hook must not break the session. When it cannot do its job (no part
# file, empty or unreadable stdin, no jq) it prints nothing on stdout and one line on stderr.
set -u

fail() {
    echo "inject-rules: $*" >&2
    exit 0
}

part="${1:-}"
case "$part" in
    '' ) fail "no part name given (usage: inject-rules.sh <part>)" ;;
    */* | .* ) fail "bad part name '$part'" ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || fail "cannot find the script folder"
file="$here/rules/$part.md"
[ -f "$file" ] || fail "no rules part '$part' ($file)"
command -v jq >/dev/null 2>&1 || fail "jq is not installed; rules part '$part' not injected"

root="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$root" ] || root="$(cd "$here/.." && pwd)" || fail "cannot find the plugin folder"

input="$(cat)"
[ -n "$input" ] || fail "empty stdin; rules part '$part' not injected"
event="$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null)" \
    || fail "stdin is not JSON; rules part '$part' not injected"
[ -n "$event" ] || fail "no hook_event_name on stdin; rules part '$part' not injected"

# split/join replaces the placeholder literally: no regex, no special characters in the path.
out="$(jq -Rsc --arg event "$event" --arg root "$root" --arg token '${CLAUDE_PLUGIN_ROOT}' \
    '{hookSpecificOutput: {hookEventName: $event,
        additionalContext: (sub("\n+$"; "") | split($token) | join($root))}}' <"$file")" \
    || fail "jq failed on rules part '$part'"
printf '%s\n' "$out"
exit 0
