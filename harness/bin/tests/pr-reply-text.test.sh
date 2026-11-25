#!/usr/bin/env bash
# The text contract of skills/pr-reply, section "3. What waits for an answer": which review threads get a draft.
# A thread waits for the person (the viewer) by the rule of worfy's "Needs my answer" group (owesAnswer,
# src/main/github/inbox-groups.ts): unresolved, its last comment (`latest`) not the viewer's, and on someone else's
# pull request only a thread the viewer wrote in. Without the last part the skill drafts replies on a colleague's
# pull request in threads the viewer owes no answer (worfy-polish 141).
# Run: bash harness/bin/tests/pr-reply-text.test.sh; exit code 0 means every check passed.
# PR_REPLY_FILE points it at another copy of the SKILL.md.
set -u
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
FILE="${PR_REPLY_FILE:-$HARNESS/skills/pr-reply/SKILL.md}"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
# check <name> <condition command...>
check() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
# The text is wrapped: phrases are looked up with line breaks folded into spaces.
flat() { tr '\n' ' ' | tr -s ' '; }
in_text() { [[ "$1" == *"$2"* ]]; }
section() { awk -v re="^## $2" '$0 ~ re {p=1; next} /^## /{p=0} p' "$1"; }    # section <file> <heading start>

[ -f "$FILE" ] || { echo "FAIL missing $FILE"; echo "passed $pass, failed $((fail + 1))"; exit 1; }
waits="$(section "$FILE" '3\. What waits for an answer' | flat)"
thread="$(printf '%s' "$waits" | sed -n 's/.*\(\*\*A review thread\*\*.*\)\*\*A comment in the conversation\*\*.*/\1/p')"
has() { in_text "$thread" "$1"; }

check "pr-reply: section 3 has the rule of a review thread" test -n "$thread"
check "pr-reply: a thread waits only while unresolved" has '`isResolved` is false'
check "pr-reply: a thread whose last comment is the viewer's does not wait" has "its last comment is not the viewer's"
check "pr-reply: the last comment is the one in latest" has 'the one in `latest`, never the last of `comments`'
check "pr-reply: on the viewer's own pull request every such thread waits" has "on the viewer's own pull request (its \`author.login\` is the viewer) every such thread"
check "pr-reply: on someone else's pull request only a thread the viewer wrote in waits" has "on someone else's pull request only a thread the viewer wrote in"
check "pr-reply: such a thread is one with a comment of the viewer's in comments" has "a comment of the viewer's in \`comments\`"
check "pr-reply: a colleague's thread the viewer never wrote in gets no draft" has "a thread on someone else's pull request the viewer never wrote in get no draft"
check "pr-reply: the rule is the one of the Needs my answer group" has 'Needs my answer'
# Step 2 reads what the rule needs: the author of the pull request and the viewer.
read2="$(section "$FILE" '2\. Read, only read' | flat)"
check "pr-reply: step 2 reads the author of the pull request" in_text "$read2" '--json number,url,title,body,author,'
check "pr-reply: step 2 keeps viewer.login and author.login" in_text "$read2" '`viewer.login`, the person; and `author.login` of the pull request'

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
