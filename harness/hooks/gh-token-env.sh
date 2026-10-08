#!/usr/bin/env bash
# SessionStart: gives the session's Bash commands the GH_TOKEN of the project's GitHub account.
#
# The project is found by bin/profile of this plugin from the session directory (the `cwd` field of
# the hook JSON, else $PWD), the account is its `github.account`. When the account is a GitHub login
# and `gh auth token -u <account>` succeeds, one line is appended to $CLAUDE_ENV_FILE:
#
#   export GH_TOKEN="$(gh auth token -u <account> 2>/dev/null)"
#
# Claude Code runs that file before every Bash command of the session and of its subagents
# (ADR-0048, question 2), so the token is computed on each command and is never written to disk,
# to stdout, to stderr or into additionalContext — this script only checks the exit code of gh.
# The project's account wins over a GH_TOKEN the user exported: the line overrides it.
# The global gh account is never touched: no `gh auth switch`, no `gh auth login`, no gh config.
#
# Nothing to do — exit 0 without output: no $CLAUDE_ENV_FILE, no profile script, no project or no
# account (profile exit 3 or 4, null, empty), a value that is not a GitHub login.
# The account is there but gh is missing or has no login under it — no line; one line of
# additionalContext tells the session, exit 0: the session is not stopped.
#
# For tests: CLAUDE_PROFILE_BIN replaces bin/profile. Tests: hooks/tests/gh-token-env.test.sh.

set -uo pipefail

env_file="${CLAUDE_ENV_FILE:-}"
[ -n "$env_file" ] || exit 0

# bin/profile of this plugin: the folder above hooks/, found from this script's real file.
PROFILE_BIN="${CLAUDE_PROFILE_BIN:-$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/.." && pwd -P)/bin/profile}"
[ -x "$PROFILE_BIN" ] || exit 0

input=""
[ -t 0 ] || input="$(cat 2>/dev/null || true)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$cwd" ] && [ -d "$cwd" ] || cwd="$PWD"

account="$("$PROFILE_BIN" -C "$cwd" --field github.account 2>/dev/null)" || exit 0
# A JSON-quoted string is taken too, as readGithubAccount in src/main/workflow/profile.ts does.
if [[ "$account" == \"*\" ]]; then account="${account#\"}"; account="${account%\"}"; fi
[ -n "$account" ] && [ "$account" != null ] || exit 0
# A GitHub login (the same rule as GITHUB_LOGIN in src/main/workflow/profile.ts): letters, digits
# and single inner hyphens, at most 39 characters. Anything else would land in a shell line that
# runs before every Bash command, or be read by gh as an option.
[[ "$account" =~ ^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$ ]] && [ "${#account}" -le 39 ] || exit 0

# Tell the session why GH_TOKEN is not set: one line, no token in it. The account is a checked
# login, so it needs no JSON escaping.
note() {
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' \
        "GitHub account $account of this project (profile github.account): $1, so GH_TOKEN is not set and gh and git against origin run as the active gh account. The owner runs gh auth login for $account, then starts a new session; do not switch the global gh account."
    exit 0
}

command -v gh >/dev/null 2>&1 || note "gh is not installed"
# The check reads only the exit code. A GH_TOKEN of the hook's own environment must not decide it.
env -u GH_TOKEN -u GITHUB_TOKEN gh auth token -u "$account" >/dev/null 2>&1 || note "no gh login under it"

line="export GH_TOKEN=\"\$(gh auth token -u $account 2>/dev/null)\""
# SessionStart fires again on resume and /clear: the line is added once.
grep -qxF -- "$line" "$env_file" 2>/dev/null && exit 0
{
    # A file that does not end with a newline would glue the export to its last line.
    [ -s "$env_file" ] && [ -n "$(tail -c 1 "$env_file" 2>/dev/null)" ] && printf '\n'
    printf '%s\n' "$line"
} >>"$env_file" 2>/dev/null
exit 0
