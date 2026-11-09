#!/usr/bin/env bash
# Tests of bin/review-history — the reader of a project's pull request reviews (fetch, estimate, probe, stats,
# clean). gh is a stand-in that answers from GraphQL fixtures (fixtures/review-history/: invented repositories,
# logins and texts) and records every call with the GH_TOKEN it saw; nothing reaches GitHub. Each case runs in a
# project of its own in a temporary HOME and Harness home.
# Covered: the filter (a Bot, a [bot] login, a service User and an agent's report from ignore.json, the author of the
# pull request — dropped; authors outside the team — context; a person's reply to a bot — kept); the window
# (older than 12 months and the 501st pull request are not read, a silent approval counts, --since reads only the
# new and keeps the history's counts and the cursor in meta.json); the voice threshold (29 and 30); probe stops at
# the 30th substantive comment and writes no file; a plain approval of any length is not substantive and has a line of
# its own in the estimate; a rate limit is retried only after retry-after has passed and
# gives up after three retries with raw/ untouched, and never makes the page smaller; GitHub's failures a retry may
# get past (worfy-human-review 14): HTTP 504, a GraphQL timeout and an answer cut short halve the page of pull
# requests from the same cursor, keep the smaller page, lose and repeat no pull request, and at the smallest page
# give up after three retries naming the page size and the cursor; HTTP 502, bare or with GitHub's GraphQL timeout
# error, and the owner's answer (headers, no body, "unexpected end of JSON input") halve the page too; HTTP 503 retries
# the same page after a pause of 1×, then 2× the wait; HTTP 400 is not retried; a rate limit keeps a count of its own,
# at most 3 for a page across its sizes; a read-on request is retried too; the global gh account
# is never switched; clean removes raw/ and nothing else; stats names no login; profiles/README.md names the folder.
# Run: bash harness/bin/tests/review-history.test.sh; exit code 0 — everything passed.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${BIN_DIR:-$(cd "$HERE/.." && pwd)}"
RH="$BIN/review-history"
FIX="$HERE/fixtures/review-history"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$HERE/real-home.sh"
home_before="$(real_home_snapshot "$HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
unset GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN GH_HOST CLAUDE_GATE_CONFIG CLAUDE_PROFILES_DIR CLAUDE_PROFILE_BIN REVIEW_HISTORY_GH
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-t}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-t@t}"
export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-t}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-t@t}"
export REVIEW_HISTORY_NOW="2026-06-01T00:00:00Z"

# --- the gh stand-in -------------------------------------------------------------------------------------------
# One line per call into $GH_LOG: the call number, the GraphQL operation, the cursor, the GH_TOKEN it saw and its
# first two arguments. Answers like `gh api --include`: headers, a blank line, the body of the fixture file
# $GH_FIX/<page|reviews-N|…>-<cursor>.json. $RL_CALLS (",2,3,") — the call numbers answered with a rate limit
# (HTTP 403, retry-after 1), and with it or $ERR_CALLS set the time of each call in ms goes to $GH_TIMES; $DENY — a GraphQL
# NOT_FOUND, as for a repository the token cannot see. $ERR_CALLS (",1:504,2:trunc,") — a failure of GitHub's side for
# those call numbers: 504, 502 and 503 (the status line, no body, "gh: HTTP 50x" on stderr), 502timeout (HTTP 502 with
# GitHub's GraphQL timeout error in the body), trunc (an answer cut short, "unexpected end of JSON input"), cutquiet
# (the same, gh saying nothing), emptycut (the headers, no body, "unexpected end of JSON input": what gh printed in the
# owner's report), 400html (HTTP 400 with an HTML page), gqltimeout (GitHub's GraphQL "Something went wrong … timeout" error); $ERR_FROM
# ("2:504") — that failure for every call from that number on. A fixture folder with nodes.json is one list of pull
# requests: the stand-in pages it by the page size asked for ($GH_SERVE, serve-page.cjs).
STUBS="$T/stubs"; mkdir -p "$STUBS"
cat >"$STUBS/gh" <<'EOF'
#!/usr/bin/env bash
n=$(( $(cat "$GH_COUNT" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$GH_COUNT"
op=none cursor=1 number="" id="" first=""
for a in "$@"; do
    case "$a" in
        query=*) [[ "$a" =~ ^query=query\ ([A-Za-z]+) ]] && op="${BASH_REMATCH[1]}" ;;
        endCursor=*) cursor="${a#endCursor=}" ;;
        number=*) number="${a#number=}" ;;
        id=*) id="${a#id=}" ;;
        first=*) first="${a#first=}" ;;
    esac
done
echo "call=$n op=$op cursor=$cursor token=${GH_TOKEN:-unset} args=${1:-} ${2:-} first=$first" >>"$GH_LOG"
[ -z "${RL_CALLS:-}${ERR_CALLS:-}" ] || node -e 'process.stdout.write(Date.now() + "\n")' >>"$GH_TIMES"
case ",${RL_CALLS:-}," in *",$n,"*)
    printf 'HTTP/2.0 403 Forbidden\r\nRetry-After: 1\r\nX-Ratelimit-Remaining: 0\r\n\r\n{"message":"You have exceeded a secondary rate limit."}\n'
    echo "gh: You have exceeded a secondary rate limit. (HTTP 403)" >&2; exit 1 ;;
esac
err=""
case ",${ERR_CALLS:-}," in *",$n:"*) err="${ERR_CALLS#*",$n:"}"; err="${err%%,*}" ;; esac
[ -n "${ERR_FROM:-}" ] && [ "$n" -ge "${ERR_FROM%%:*}" ] && err="${ERR_FROM#*:}"
case "$err" in
    "") ;;
    504|502|503) printf 'HTTP/2.0 %s Bad Gateway\r\nContent-Length: 0\r\n\r\n' "$err"; echo "gh: HTTP $err" >&2; exit 1 ;;
    502timeout) printf 'HTTP/2.0 502 Bad Gateway\r\nContent-Type: application/json\r\n\r\n{"data":null,"errors":[{"message":"Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug."}]}\n'
        echo "gh: Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug. (HTTP 502)" >&2; exit 1 ;;
    emptycut) printf 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n'; echo "unexpected end of JSON input" >&2; exit 1 ;;
    400html) printf 'HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\n\r\n<html><body>Bad request</body></html>\n'; echo "gh: HTTP 400" >&2; exit 1 ;;
    trunc) printf 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"data":{"repository":{"pullRequests":{"pageInfo":{"hasNex'; echo "unexpected end of JSON input" >&2; exit 1 ;;
    cutquiet) printf 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"data":{"repository":{"pullRequest":{"rev'; exit 1 ;;
    gqltimeout) printf 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"data":null,"errors":[{"message":"Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug."}]}\n'
        echo "gh: Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug." >&2; exit 1 ;;
    *) echo "stand-in: unknown failure $err" >&2; exit 1 ;;
esac
if [ -n "${DENY:-}" ]; then
    printf 'HTTP/2.0 200 OK\r\n\r\n{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","message":"Could not resolve to a Repository with the name acme/x."}]}\n'
    echo "GraphQL: Could not resolve to a Repository with the name acme/x. (repository)" >&2; exit 1
fi
case "$op" in
    ReviewHistoryPage) f="page-$cursor.json" ;;
    ReviewHistoryReviews) f="reviews-$number-$cursor.json" ;;
    ReviewHistoryThreads) f="threads-$number-$cursor.json" ;;
    ReviewHistoryComments) f="comments-$number-$cursor.json" ;;
    ReviewHistoryThreadComments) f="thread-$id-$cursor.json" ;;
    *) echo "stand-in: not a review-history query: $*" >&2; exit 1 ;;
esac
if [ "$op" = ReviewHistoryPage ] && [ -f "$GH_FIX/nodes.json" ]; then
    list="$GH_FIX/nodes.json"; command -v cygpath >/dev/null 2>&1 && list="$(cygpath -m "$list")"
    body="$(node "$GH_SERVE" "$list" "$cursor" "$first")" || exit 1
    printf 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n%s\n' "$body"; exit 0
fi
[ -f "$GH_FIX/$f" ] || { echo "stand-in: no fixture $f" >&2; exit 1; }
printf 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\nX-Ratelimit-Remaining: 4990\r\n\r\n'
cat "$GH_FIX/$f"
EOF
chmod +x "$STUBS/gh"
export PATH="$STUBS:$PATH"
# On Windows node runs the stub through a node stand-in named by $REVIEW_HISTORY_GH; the guard stops the test
# before anything runs if any gh it can start is not the stub. It sets GH_TOKEN to a fixed invalid value.
. "$HERE/gh-stand-in.sh"
if on_windows; then node_stand_in "$STUBS/gh" "$STUBS/gh.mjs"; export REVIEW_HISTORY_GH="$STUBS/gh.mjs"; fi
gh_guard REVIEW_HISTORY_GH "$STUBS/gh" "$STUBS/gh.mjs"
TOKEN="$GH_TOKEN"

# --- the machine: HOME, HARNESS_HOME, one project per case ---------------------------------------------------------
H="$T/home" HH="$T/hh"
mkdir -p "$H" "$HH/gate" "$HH/projects"
TN="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
entries=""
project() { # project <name> <origin url or "">
    git init -q -b main "$T/r/$1"
    echo x >"$T/r/$1/README.md"; git -C "$T/r/$1" add -A; git -C "$T/r/$1" commit -q -m init
    [ -z "$2" ] || git -C "$T/r/$1" remote add origin "$2"
    mkdir -p "$HH/projects/$1" && printf '{"schema":2,"name":"%s","mode":"full"}\n' "$1" >"$HH/projects/$1/profile.json"
    entries="$entries${entries:+,}{\"key\":\"$1\",\"match\":\"$TN/r/$1\",\"profile\":\"$1\"}"
}
for p in filt v29 v30 chars cap since probe probe2 rl rlmid deny nogh clean trbase tr504 trtrunc trshrink trfloor tr502 tr502b tr503 trempty tr400 trrl trrlpage trrlmix tron; do project "$p" "git@github.com:acme/$p.git"; done
project local "$T/elsewhere.git"
printf '{"repos":[%s]}\n' "$entries" >"$HH/gate/config.json"
state() { echo "$HH/projects/$1/state/human-review"; }

# rh <project> <fixture dir> <args…>: review-history from the project's checkout; stdout to $T/out, stderr to
# $T/err, the calls to $T/gh-<project>.log; returns the exit code.
rh() {
    local p="$1" fx="$2"; shift 2
    (cd "$T/r/$p" && env HOME="$H" HARNESS_HOME="$HH" GH_FIX="$fx" GH_LOG="$T/gh-$p.log" GH_COUNT="$T/count-$p" GH_TIMES="$T/times-$p" node "$RH" "$@") >"$T/out" 2>"$T/err"
}
calls() { [ -f "$T/gh-$1.log" ] && wc -l <"$T/gh-$1.log" | tr -d ' ' || echo 0; }
raw_has() { grep -qF -- "$2" "$(state "$1")/raw/prs.jsonl"; }
jfield() { node -e 'let v=JSON.parse(require("fs").readFileSync(0,"utf8")); for (const k of process.argv[1].split(".")) v=v?.[k]; process.stdout.write(typeof v==="object"?JSON.stringify(v):String(v))' "$1"; }
make() { node "$FIX/make-pages.cjs" "$@"; }
export GH_SERVE="$(node_path "$FIX/serve-page.cjs")"
# The pause before a retry after a failure of GitHub's side, in seconds: none in the tests, except where one is timed.
export REVIEW_HISTORY_RETRY_WAIT=0

# --- 1. fetch: the filter -------------------------------------------------------------------------------------------
mkdir -p "$(state filt)" && cp "$FIX/filter/ignore.json" "$(state filt)/ignore.json"
rh filt "$FIX/filter" fetch; rc=$?
[ "$rc" -eq 0 ] && [ -f "$(state filt)/raw/prs.jsonl" ] && ok "fetch: exit 0, raw/prs.jsonl written" || bad "fetch: exit $rc $(cat "$T/err")"
for kind in "BOT-REVIEW-TEXT|a review of a Bot with a [bot] login" "BOT-THREAD-TEXT|a line comment of a [bot] login" \
    "BOT-TYPENAME-TEXT|a comment of an author typed Bot without [bot] in the login" "SERVICE-ACCOUNT-TEXT|a service User listed in ignore.json" \
    "AGENT-REPORT-TEXT|an agent's report that starts with a prefix of ignore.json" "AUTHOR-SELF-TEXT|the PR author's review of their own PR" \
    "AUTHOR-REPLY-TEXT|the PR author's reply in a thread of their own PR" "BOT-ONLY-PR-TEXT|a PR only a bot reviewed" \
    "OLD-WINDOW-TEXT|a PR updated more than 12 months ago"; do
    raw_has filt "${kind%%|*}" && bad "fetch drops ${kind#*|}: found in raw/" || ok "fetch drops ${kind#*|}"
done
for kind in "TEAM-APPROVE-TEXT|a team member's review" "TEAM-REPLY-TO-BOT|a team member's reply to a bot" "TEAM-NIT-TEXT|a team line comment" \
    "TEAM-CONVERSATION-TEXT|a team conversation comment" "OVERFLOW-REVIEW-TEXT|a review past the first 30, read by a request of its own"; do
    raw_has filt "${kind%%|*}" && ok "fetch keeps ${kind#*|}" || bad "fetch keeps ${kind#*|}: missing in raw/"
done
roles="$(node -e '
const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse)
const all = lines.flatMap((p) => [...p.reviews, ...p.comments, ...p.threads.flatMap((t) => t.comments)])
const r = (m) => all.find((x) => x.body.includes(m))?.role
process.stdout.write([r("EXTERNAL-CONTEXT-TEXT"), r("NONE-CONTEXT-TEXT"), r("TEAM-NIT-TEXT"), lines.map((p) => p.number).join(",")].join(" "))
' "$(node_path "$(state filt)/raw/prs.jsonl")")"
[ "$roles" = "context context team 41,40,37" ] && ok "fetch: CONTRIBUTOR and NONE kept as context, the team as team; PRs 41, 40 (approved without comments), 37" \
    || bad "fetch roles and PRs: $roles"
grep -q "op=ReviewHistoryReviews cursor=r2" "$T/gh-filt.log" && ok "fetch: a PR with more than 30 reviews is read on by a request of its own" || bad "overflow request: $(cat "$T/gh-filt.log")"
[ "$(grep -c "op=ReviewHistoryPage" "$T/gh-filt.log")" = 1 ] && ok "fetch: a PR older than the window ends the walk, the next page is not requested" \
    || bad "window end: $(cat "$T/gh-filt.log")"
rh filt "$FIX/filter" estimate --json; rc=$?
est="$(cat "$T/out")"
d="$(jfield dropped <<<"$est")"
[ "$rc" -eq 0 ] && [ "$d" = '{"bot":3,"ignored_login":1,"ignored_prefix":1,"pr_author":2}' ] \
    && ok "estimate names each dropped kind: bots 3, ignored login 1, ignored prefix 1, PR author 2" || bad "estimate dropped: exit $rc $d $(cat "$T/err")"
[ "$(jfield pull_requests <<<"$est")" = 3 ] && [ "$(jfield reviews.APPROVED <<<"$est")" = 2 ] && [ "$(jfield context <<<"$est")" = 2 ] && [ "$(jfield reviewers <<<"$est")" = 3 ] \
    && ok "estimate: 3 PRs, 2 approvals (one without comments), 2 context texts, 3 reviewers" || bad "estimate counts: $est"
rh filt "$FIX/filter" estimate --passes 3; rc=$?
out="$(cat "$T/out")"
[ "$rc" -eq 0 ] && grep -q "^pull requests: 3 " "$T/out" && grep -q "^comments of the team: .* line comments 3" "$T/out" && grep -q "^substantive comments of the team: " "$T/out" \
    && grep -q "^reviewers of the team: 3" "$T/out" && grep -q "^characters: " "$T/out" && grep -q "^tokens: ~[0-9 ]* (estimate: .*× 3 passes)" "$T/out" && grep -q "^voice: no (" "$T/out" \
    && ok "estimate prints PRs, comments by kind, substantive, reviewers, characters, the token estimate and voice" || bad "estimate text: exit $rc $out"
[ -f "$(state filt)/meta.json" ] && [ "$(jfield window.months <"$(state filt)/meta.json")" = 12 ] && [ "$(jfield repositories.0.last_pr.number <"$(state filt)/meta.json")" = 41 ] \
    && ok "meta.json: the window and the newest PR read" || bad "meta.json: $(cat "$(state filt)/meta.json" 2>/dev/null)"

# --- 2. the voice threshold -----------------------------------------------------------------------------------------
make "$T/fx-v29" voice 29 && make "$T/fx-v30" voice 30
rh v29 "$T/fx-v29" fetch; rc=$?
[ "$rc" -eq 0 ] && grep -qx "voice: no (29 of 30)" "$T/out" && ok "29 substantive comments (two approvals with a remark counted; LGTM, +1, emoji, a quote, long plain approvals not): voice: no (29 of 30), exit 0" || bad "voice 29: exit $rc $(cat "$T/out") $(cat "$T/err")"
# worfy-human-review 13: a plain approval ("LGTM, thanks for the fix! Looks good to me.") is no substantive comment
# however long, and the estimate counts the plain approvals on a line of their own.
grep -qx "plain approvals of the team (LGTM, thanks, +1, an emoji; not substantive): 6" "$T/out" \
    && ok "estimate: the plain approvals on a line of their own, 6" || bad "plain approvals line: $(cat "$T/out")"
rh v29 "$T/fx-v29" estimate --json; rc=$?
[ "$rc" -eq 0 ] && [ "$(jfield plain_approvals <"$T/out")" = 6 ] && [ "$(jfield substantive <"$T/out")" = 29 ] \
    && ok "estimate --json: plain_approvals 6, substantive 29" || bad "estimate --json plain approvals: exit $rc $(cat "$T/out")"
# An approval with a remark ("LGTM, but rename retryLimit…", "Thanks! One thing: …") stays substantive: the 29 above
# count both, and a plain approval is only a text with nothing but approval words.
grep -q "LGTM, but rename" "$(state v29)/raw/prs.jsonl" && grep -q "Thanks! One thing" "$(state v29)/raw/prs.jsonl" \
    && ok "fetch keeps the two approvals with a remark in raw/" || bad "approvals with a remark missing in raw/"
rh v30 "$T/fx-v30" estimate; rc=$?
[ "$rc" -eq 1 ] && grep -q "fetch first" "$T/err" && ok "estimate without raw/: exit 1, says to fetch first" || bad "estimate without raw: exit $rc $(cat "$T/err")"
rh v30 "$T/fx-v30" fetch && rh v30 "$T/fx-v30" estimate; rc=$?
[ "$rc" -eq 0 ] && grep -qx "voice: yes" "$T/out" && ok "30 substantive comments: voice: yes, exit 0" || bad "voice 30: exit $rc $(cat "$T/out")"
[ -f "$(state v29)/ignore.json" ] && [ "$(tr -d ' \n' <"$(state v29)/ignore.json")" = '{"logins":[],"body_prefixes":[]}' ] \
    && ok "fetch creates ignore.json with empty lists when it is missing" || bad "ignore.json: $(cat "$(state v29)/ignore.json" 2>/dev/null)"
make "$T/fx-chars" chars
rh chars "$T/fx-chars" fetch --passes 2 --json; rc=$?
[ "$rc" -eq 0 ] && [ "$(jfield estimate.characters.text <"$T/out")" = 80 ] && [ "$(jfield estimate.tokens.estimate <"$T/out")" = 60 ] \
    && ok "token estimate: 40 Cyrillic / 2 + 40 Latin / 4 = 30, times 2 passes = 60" || bad "tokens: exit $rc $(cat "$T/out")"

# --- 3. the window: 500 PRs at most, --since ------------------------------------------------------------------------
make "$T/fx-cap" cap 501
rh cap "$T/fx-cap" fetch --json; rc=$?
n="$(grep -c . "$(state cap)/raw/prs.jsonl" 2>/dev/null)"
[ "$rc" -eq 0 ] && [ "$n" = 500 ] && ! grep -q '"number":1,' "$(state cap)/raw/prs.jsonl" && [ "$(calls cap)" = 5 ] \
    && ok "501 reviewed PRs: 500 kept, the 501st not read, its page not requested (5 requests)" || bad "cap: exit $rc, $n lines, $(calls cap) calls $(cat "$T/err")"
make "$T/fx-since" since
rh since "$T/fx-since" fetch; rc=$?
[ "$rc" -eq 0 ] && grep -q "^pull requests: 4 " "$T/out" && [ "$(calls since)" = 2 ] && ok "fetch without --since reads the whole window (4 PRs, 2 pages)" || bad "no since: exit $rc $(cat "$T/out") calls $(calls since)"
cp "$(state since)/meta.json" "$T/meta-full.json"
rh since "$T/fx-since" fetch --since 2026-05-01; rc=$?
nums="$(node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map((l)=>JSON.parse(l).number).join(","))' "$(node_path "$(state since)/raw/prs.jsonl")")"
M="$(state since)/meta.json"
[ "$rc" -eq 0 ] && [ "$nums" = "3,2" ] && [ "$(calls since)" = 3 ] && [ "$(jfield update.window.since <"$M")" = "2026-05-01T00:00:00.000Z" ] && [ "$(jfield update.counts.pull_requests <"$M")" = 2 ] && [ "$(jfield raw <"$M")" = update ] \
    && ok "fetch --since 2026-05-01: only the PRs updated after it, one request, the slice recorded under update" || bad "since: exit $rc PRs $nums calls $(calls since) $(cat "$M") $(cat "$T/err")"
for k in counts voice window fetched_at; do
    [ "$(jfield "$k" <"$M")" = "$(jfield "$k" <"$T/meta-full.json")" ] && ok "fetch --since keeps the history's $k in meta.json" || bad "fetch --since overwrote $k: $(jfield "$k" <"$M")"
done
rh since "$T/fx-since" estimate --json; rc=$?
[ "$rc" -eq 0 ] && [ "$(jfield pull_requests <"$T/out")" = 2 ] && [ "$(jfield window.since <"$T/out")" = "2026-05-01T00:00:00.000Z" ] \
    && ok "estimate after fetch --since: the slice in raw/ with its own window" || bad "estimate after since: exit $rc $(cat "$T/out")"
rh since "$T/fx-since" fetch --since 2026-05-25; rc=$?
[ "$rc" -eq 0 ] && [ "$(jfield update.counts.pull_requests <"$M")" = 0 ] && [ "$(jfield repositories.0.last_pr.number <"$M")" = 3 ] && [ "$(jfield repositories.0.last_pr.updated_at <"$M")" = "2026-05-20T00:00:00Z" ] \
    && [ "$(jfield counts.pull_requests <"$M")" = 4 ] && ok "fetch --since with nothing new: the cursor last_pr stays at PR 3, the history's counts stay" || bad "empty since: exit $rc $(cat "$M")"

# --- 4. probe: stops at the 30th, writes nothing ------------------------------------------------------------------------
make "$T/fx-probe" pages 20 3 1
tree() { node -e '
const fs = require("fs"), path = require("path"); const out = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
  const p = path.join(d, e.name); const st = fs.statSync(p)
  out.push(`${path.relative(process.argv[1], p)} ${e.isDirectory() ? "dir" : st.size + " " + st.mtimeMs}`); if (e.isDirectory()) walk(p) } }
walk(process.argv[1]); process.stdout.write(out.join("\n"))' "$(node_path "$HH")"; }
before="$(tree)"
rh probe "$T/fx-probe" probe; rc=$?
after="$(tree)"
[ "$rc" -eq 0 ] && grep -qx "voice: yes" "$T/out" && ok "probe: 40 substantive comments in the window -> voice: yes, exit 0" || bad "probe yes: exit $rc $(cat "$T/out") $(cat "$T/err")"
[ "$(calls probe)" = 2 ] && ok "probe stops at the 30th substantive comment: page 2 read, page 3 not requested" || bad "probe requests: $(calls probe) $(cat "$T/gh-probe.log")"
[ "$before" = "$after" ] && [ ! -e "$(state probe)" ] && ok "probe writes no file: the Harness home tree is the same before and after" || bad "probe wrote: $(diff <(echo "$before") <(echo "$after") | head -5)"
[ -z "$(git -C "$T/r/probe" status --porcelain)" ] && ok "probe writes nothing into the repository" || bad "probe repo: $(git -C "$T/r/probe" status --porcelain)"
make "$T/fx-probe2" pages 5 1 1
rh probe2 "$T/fx-probe2" probe --json; rc=$?
[ "$rc" -eq 0 ] && [ "$(jfield line <"$T/out")" = "voice: no (5 of 30)" ] && [ "$(jfield voice <"$T/out")" = no ] && [ "$(calls probe2)" = 1 ] && [ ! -e "$(state probe2)" ] \
    && ok "probe: 5 substantive comments to the end of the window -> voice: no (5 of 30), exit 0, nothing written" || bad "probe no: exit $rc $(cat "$T/out")"
rh local "$FIX/filter" probe; rc=$?
[ "$rc" -eq 3 ] && [ "$(wc -l <"$T/err" | tr -d ' ')" = 1 ] && grep -q "no origin on GitHub" "$T/err" && [ "$(calls local)" = 0 ] \
    && ok "probe: origin not on GitHub -> exit 3, one line of reason, no gh" || bad "probe no origin: exit $rc $(cat "$T/err")"
(cd "$T/r/nogh" && env HOME="$H" HARNESS_HOME="$HH" REVIEW_HISTORY_GH="$T/no-such-gh" node "$RH" probe) >"$T/out" 2>"$T/err"; rc=$?
[ "$rc" -eq 3 ] && [ "$(wc -l <"$T/err" | tr -d ' ')" = 1 ] && grep -q "gh not found" "$T/err" && ok "probe: no gh -> exit 3, one line of reason" || bad "probe no gh: exit $rc $(cat "$T/err")"
DENY=1 rh deny "$FIX/filter" probe; rc=$?
[ "$rc" -eq 3 ] && [ "$(wc -l <"$T/err" | tr -d ' ')" = 1 ] && grep -q "no access to acme/deny" "$T/err" && ok "probe: no access to the repository -> exit 3, one line of reason" || bad "probe deny: exit $rc $(cat "$T/err")"

# --- 5. the rate limit ------------------------------------------------------------------------------------------------
RL_CALLS=",1,2," rh rl "$FIX/filter" fetch; rc=$?
# The gaps between the starts of calls 1, 2 and 3 as the stand-in saw them: each retry comes after retry-after (1 s).
gaps="$(node -e 'const t = require("fs").readFileSync(0, "utf8").trim().split("\n").map(Number); process.stdout.write(t.slice(1, 3).map((v, i) => v - t[i]).join(" "))' <"$T/times-rl")"
[ "$rc" -eq 0 ] && grep -q "retry-after 1 s); waiting 1 s, retry 1 of 3" "$T/err" && grep -q "retry 2 of 3" "$T/err" && raw_has rl TEAM-NIT-TEXT \
    && ok "rate limit twice: says it waits retry-after (1 s) before each retry, then reads the page" || bad "rate limit retry: exit $rc $(cat "$T/err")"
[ "$(wc -w <<<"$gaps" | tr -d ' ')" = 2 ] && [ "${gaps% *}" -ge 1000 ] && [ "${gaps#* }" -ge 1000 ] \
    && ok "rate limit twice: each retry starts at least 1000 ms after the limited call (gaps $gaps ms)" || bad "rate limit wait: gaps [$gaps] ms"
cp "$(state rl)/raw/prs.jsonl" "$T/rl-before"
: >"$T/gh-rl.log"; rm -f "$T/count-rl"
RL_CALLS=",1,2,3,4,5," rh rl "$FIX/filter" fetch; rc=$?
[ "$rc" -eq 1 ] && [ "$(calls rl)" = 4 ] && grep -q "still limited after 3 retries" "$T/err" && cmp -s "$T/rl-before" "$(state rl)/raw/prs.jsonl" && [ ! -e "$(state rl)/.raw-next" ] \
    && ok "rate limit four times: exit 1 with the reason after 3 retries, the earlier raw/ untouched, no unfinished copy" || bad "rate limit give up: exit $rc calls $(calls rl) $(cat "$T/err")"
make "$T/fx-rlmid" cap 150
RL_CALLS=",2,3,4,5," rh rlmid "$T/fx-rlmid" fetch; rc=$?
[ "$rc" -eq 1 ] && [ ! -e "$(state rlmid)/raw" ] && [ ! -e "$(state rlmid)/.raw-next" ] && ok "a rate limit on the second page: no half-written raw/ is left" || bad "rate limit mid: exit $rc $(ls -a "$(state rlmid)" 2>&1)"

# --- 5a. failures of GitHub's side: retries and the page size (worfy-human-review 14) -----------------------------------
# 230 reviewed pull requests as one list: the stand-in pages it by the page size asked for, so a smaller page reads on
# from the same cursor the way GitHub does. trbase reads it without a failure: the raw/ every other case must equal.
make "$T/fx-dyn" nodes 230
pages_of() { grep "op=ReviewHistoryPage" "$T/gh-$1.log" | sed -E 's/.* cursor=([^ ]*) .* first=([0-9]*)$/\1:\2/' | tr '\n' ' '; }
# same_raw <project> [<base project>]: its raw/prs.jsonl holds what the base's holds (trbase by default), line for line,
# apart from the repository name each project reads under.
same_raw() {
    node -e 'const fs = require("fs"), read = (f) => fs.readFileSync(f, "utf8").replace(/"repo":"acme\/[a-z0-9]+"/g, "\"repo\":\"acme/x\"")
process.exit(read(process.argv[1]) === read(process.argv[2]) ? 0 : 1)' "$(node_path "$(state "${2:-trbase}")/raw/prs.jsonl")" "$(node_path "$(state "$1")/raw/prs.jsonl")" 2>/dev/null
}
rh trbase "$T/fx-dyn" fetch; rc=$?
uniq_n="$(node -e 'const n = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l).number); process.stdout.write(n.length + " " + new Set(n).size)' "$(node_path "$(state trbase)/raw/prs.jsonl")")"
[ "$rc" -eq 0 ] && [ "$uniq_n" = "230 230" ] && [ "$(pages_of trbase)" = "1:100 c100:100 c200:100 " ] \
    && ok "pages of 100 by default: 230 pull requests in 3 requests, each once" || bad "base: exit $rc [$uniq_n] [$(pages_of trbase)] $(cat "$T/err")"

REVIEW_HISTORY_RETRY_WAIT=1 ERR_CALLS=",1:504," rh tr504 "$T/fx-dyn" fetch; rc=$?
gap="$(node -e 'const t = require("fs").readFileSync(0, "utf8").trim().split("\n").map(Number); process.stdout.write(String(t[1] - t[0]))' <"$T/times-tr504")"
[ "$rc" -eq 0 ] && grep -q "^review-history: HTTP 504 on a page of 100 PRs, retrying with 50 (acme/tr504, the first page)$" "$T/err" && same_raw tr504 \
    && [ "$(pages_of tr504)" = "1:100 1:50 c50:50 c100:50 c150:50 c200:50 " ] \
    && ok "HTTP 504, then success: says so, asks the same page with 50, keeps 50 to the end; raw/ the same as without the failure" || bad "504 then success: exit $rc [$(pages_of tr504)] $(cat "$T/err")"
[ "${gap:-0}" -ge 1000 ] && ok "HTTP 504: the smaller page is asked after the pause (${gap} ms with a pause of 1 s)" || bad "504 pause: ${gap:-none} ms"

ERR_CALLS=",1:trunc," rh trtrunc "$T/fx-dyn" fetch; rc=$?
[ "$rc" -eq 0 ] && grep -q "^review-history: an answer cut short (not JSON) on a page of 100 PRs, retrying with 50 " "$T/err" && same_raw trtrunc \
    && [ "$(pages_of trtrunc)" = "1:100 1:50 c50:50 c100:50 c150:50 c200:50 " ] \
    && ok "an answer cut short (unexpected end of JSON input), then success: the page of 50, raw/ the same" || bad "trunc then success: exit $rc [$(pages_of trtrunc)] $(cat "$T/err")"

ERR_CALLS=",2:504,3:gqltimeout,4:504," rh trshrink "$T/fx-dyn" fetch; rc=$?
[ "$rc" -eq 0 ] && same_raw trshrink \
    && [ "$(pages_of trshrink)" = "1:100 c100:100 c100:50 c100:25 c100:12 c112:12 c124:12 c136:12 c148:12 c160:12 c172:12 c184:12 c196:12 c208:12 c220:12 " ] \
    && grep -q "HTTP 504 on a page of 100 PRs, retrying with 50 (acme/trshrink, after cursor c100)" "$T/err" \
    && grep -q "a GraphQL timeout on a page of 50 PRs, retrying with 25 " "$T/err" && grep -q "HTTP 504 on a page of 25 PRs, retrying with 12 " "$T/err" \
    && ok "504, a GraphQL timeout, 504 on page 2: 100 -> 50 -> 25 -> 12 from the same cursor c100, 12 to the end, no PR lost or read twice" \
    || bad "shrink: exit $rc [$(pages_of trshrink)] $(cat "$T/err")"

ERR_FROM="2:504" rh trfloor "$T/fx-dyn" fetch; rc=$?
[ "$rc" -eq 1 ] && [ "$(pages_of trfloor)" = "1:100 c100:100 c100:50 c100:25 c100:12 c100:10 c100:10 c100:10 c100:10 " ] \
    && grep -q "^review-history: gh api graphql failed for acme/trfloor: HTTP 504 on a page of 10 PRs (the smallest page), after cursor c100, still failing after 3 retries — gh: HTTP 504$" "$T/err" \
    && [ ! -e "$(state trfloor)/raw" ] && [ ! -e "$(state trfloor)/.raw-next" ] \
    && ok "HTTP 504 down to the smallest page of 10: 3 retries, then exit 1 naming the page size and the cursor; no raw/ left" || bad "floor: exit $rc [$(pages_of trfloor)] $(cat "$T/err")"

ERR_CALLS=",1:502," rh tr502 "$T/fx-dyn" fetch; rc=$?
[ "$rc" -eq 0 ] && same_raw tr502 && [ "$(pages_of tr502)" = "1:100 1:50 c50:50 c100:50 c150:50 c200:50 " ] \
    && grep -q "^review-history: HTTP 502 on a page of 100 PRs, retrying with 50 (acme/tr502, the first page)$" "$T/err" \
    && ok "a bare HTTP 502 on a page: the page of 50, like a 504; raw/ the same" || bad "502: exit $rc [$(pages_of tr502)] $(cat "$T/err")"
ERR_CALLS=",1:502timeout," rh tr502b "$T/fx-dyn" fetch; rc=$?
[ "$rc" -eq 0 ] && same_raw tr502b && [ "$(pages_of tr502b)" = "1:100 1:50 c50:50 c100:50 c150:50 c200:50 " ] \
    && grep -q "^review-history: a GraphQL timeout on a page of 100 PRs, retrying with 50 (acme/tr502b, the first page)$" "$T/err" \
    && ok "HTTP 502 with GitHub's GraphQL timeout error in the body: a timeout, the page of 50; raw/ the same" || bad "502 timeout body: exit $rc [$(pages_of tr502b)] $(cat "$T/err")"
REVIEW_HISTORY_RETRY_WAIT=1 ERR_CALLS=",1:503,2:503," rh tr503 "$T/fx-dyn" fetch; rc=$?
gaps="$(node -e 'const t = require("fs").readFileSync(0, "utf8").trim().split("\n").map(Number); process.stdout.write(t.slice(1, 3).map((v, i) => v - t[i]).join(" "))' <"$T/times-tr503")"
[ "$rc" -eq 0 ] && same_raw tr503 && [ "$(pages_of tr503)" = "1:100 1:100 1:100 c100:100 c200:100 " ] \
    && grep -q "^review-history: HTTP 503 on a page of 100 PRs, retry 1 of 3 in 1 s (acme/tr503, the first page)$" "$T/err" && grep -q "retry 2 of 3 in 2 s" "$T/err" \
    && ok "HTTP 503 twice: the same page of 100 again, not a smaller one; raw/ the same" || bad "503: exit $rc [$(pages_of tr503)] $(cat "$T/err")"
[ "$(wc -w <<<"$gaps" | tr -d ' ')" = 2 ] && [ "${gaps% *}" -ge 1000 ] && [ "${gaps#* }" -ge 2000 ] \
    && ok "HTTP 503 twice with a pause of 1 s: the retries wait 1 s, then 2 s (gaps $gaps ms)" || bad "503 pauses: gaps [$gaps] ms"
ERR_CALLS=",1:emptycut," rh trempty "$T/fx-dyn" fetch; rc=$?
[ "$rc" -eq 0 ] && same_raw trempty && [ "$(pages_of trempty)" = "1:100 1:50 c50:50 c100:50 c150:50 c200:50 " ] \
    && grep -q "^review-history: an answer cut short (not JSON) on a page of 100 PRs, retrying with 50 " "$T/err" \
    && ok "the owner's failure (headers, no body, gh: unexpected end of JSON input) on a page: the page of 50; raw/ the same" || bad "empty cut: exit $rc [$(pages_of trempty)] $(cat "$T/err")"
ERR_CALLS=",1:400html," rh tr400 "$T/fx-dyn" fetch; rc=$?
[ "$rc" -eq 1 ] && [ "$(calls tr400)" = 1 ] && grep -q "^review-history: gh api graphql failed for acme/tr400 (exit 1): gh: HTTP 400$" "$T/err" \
    && ok "HTTP 400 with an HTML page: not retried, exit 1 with the reason" || bad "400: exit $rc calls $(calls tr400) $(cat "$T/err")"

RL_CALLS=",1," rh trrl "$T/fx-dyn" fetch; rc=$?
[ "$rc" -eq 0 ] && same_raw trrl && [ "$(pages_of trrl)" = "1:100 1:100 c100:100 c200:100 " ] && grep -q "GitHub rate limit — .*retry-after 1 s); waiting 1 s, retry 1 of 3" "$T/err" \
    && ok "a rate limit is waited out as before and keeps the page of 100" || bad "rate limit page: exit $rc [$(pages_of trrl)] $(cat "$T/err")"

RL_CALLS=",1,2,4,5," ERR_CALLS=",3:504," rh trrlpage "$T/fx-dyn" fetch; rc=$?
[ "$rc" -eq 1 ] && [ "$(calls trrlpage)" = 5 ] && grep -q "still limited after 3 retries" "$T/err" && grep -q "retry 3 of 3" "$T/err" \
    && ok "a rate limit is retried at most 3 times for a page, across its page sizes, as before" || bad "rate limit across sizes: exit $rc calls $(calls trrlpage) $(cat "$T/err")"
mkdir -p "$(state trrlmix)" && cp "$FIX/filter/ignore.json" "$(state trrlmix)/ignore.json"
ERR_CALLS=",2:502,3:502,4:502," RL_CALLS=",5," rh trrlmix "$FIX/filter" fetch; rc=$?
[ "$rc" -eq 0 ] && same_raw trrlmix filt && [ "$(calls trrlmix)" = 6 ] && grep -q "retry 3 of 3 in 0 s" "$T/err" && grep -q "waiting 1 s, retry 1 of 3" "$T/err" \
    && ok "three HTTP 502 then a rate limit on a read-on request: the rate limit has a count of its own, waited out, then read" || bad "502 then rate limit: exit $rc calls $(calls trrlmix) $(cat "$T/err")"
mkdir -p "$(state tron)" && cp "$FIX/filter/ignore.json" "$(state tron)/ignore.json"
ERR_CALLS=",2:502,3:cutquiet," rh tron "$FIX/filter" fetch; rc=$?
[ "$rc" -eq 0 ] && same_raw tron filt && [ "$(grep -c "op=ReviewHistoryReviews cursor=r2" "$T/gh-tron.log")" = 3 ] \
    && grep -q "^review-history: HTTP 502 from GitHub for acme/tron, retry 1 of 3 in 0 s$" "$T/err" && grep -q "an answer cut short (not JSON) from GitHub for acme/tron, retry 2 of 3" "$T/err" \
    && ok "a read-on request (reviews past the first 30): HTTP 502 and an answer cut short (gh silent about it) are retried, raw/ as without them" || bad "read-on retry: exit $rc $(cat "$T/err") $(cat "$T/gh-tron.log")"
: >"$T/gh-tron.log"; rm -f "$T/count-tron"
ERR_FROM="2:504" rh tron "$FIX/filter" fetch; rc=$?
[ "$rc" -eq 1 ] && [ "$(calls tron)" = 5 ] && grep -q "^review-history: gh api graphql failed for acme/tron: HTTP 504 after 3 retries — gh: HTTP 504$" "$T/err" \
    && ok "a read-on request failing four times: exit 1 after 3 retries with the reason" || bad "read-on give up: exit $rc calls $(calls tron) $(cat "$T/err")"

# --- 6. the gh account --------------------------------------------------------------------------------------------------
all="$(cat "$T"/gh-*.log)"
! grep -qv "token=$TOKEN " <<<"$all" && ok "every gh call saw the caller's GH_TOKEN" || bad "GH_TOKEN: $(grep -v "token=$TOKEN " <<<"$all" | head -3)"
! grep -q "args=auth" <<<"$all" && ! grep -qv "args=api graphql" <<<"$all" && ok "no gh auth switch: every call is gh api graphql" || bad "gh calls: $(grep -v "args=api graphql" <<<"$all" | head -3)"

# --- 7. stats ------------------------------------------------------------------------------------------------------------
rh filt "$FIX/filter" stats; rc=$?
st="$(cat "$T/out")"
[ "$rc" -eq 0 ] && [ "$(jfield reviewers.count <<<"$st")" = 3 ] && [ "$(jfield reviewers.shares.0.reviewer <<<"$st")" = "reviewer A" ] \
    && [ "$(jfield approved_without_comments.by_size.1-10.approved_without_comments <<<"$st")" = 1 ] && [ "$(jfield repeated_remarks.groups <<<"$st")" = 1 ] \
    && [ "$(jfield threads.outdated_after_comment.count <<<"$st")" = 2 ] && [ "$(jfield review_states.CHANGES_REQUESTED.count <<<"$st")" = 1 ] \
    && ok "stats: reviewers as shares of labels, approvals without comments by size, a remark repeated in two PRs, outdated threads, review states" || bad "stats: exit $rc $st"
! grep -qiE "mira-dev|tomas-k|jun-o|pat-author" <<<"$st" && ok "stats names no login" || bad "stats names a login"

# --- 8. clean ------------------------------------------------------------------------------------------------------------
make "$T/fx-clean" voice 3
rh clean "$T/fx-clean" fetch
C="$(state clean)"
mkdir -p "$C/check" "$C/.claude/skills/human-review" "$C/previous" && echo r >"$C/research.md" && echo s >"$C/.claude/skills/human-review/SKILL.md" && echo c >"$C/check/7.md" && echo l >"$C/lint.json"
mkdir -p "$C/.raw-next" && echo half >"$C/.raw-next/prs.jsonl"
rh clean "$T/fx-clean" clean; rc=$?
left="$(cd "$C" && find . -type f | sort | tr '\n' ' ')"
[ "$rc" -eq 0 ] && [ ! -e "$C/raw" ] && [ ! -e "$C/.raw-next" ] && [ "$left" = "./.claude/skills/human-review/SKILL.md ./check/7.md ./ignore.json ./lint.json ./meta.json ./research.md " ] \
    && ok "clean removes raw/ (and an unfinished copy) and nothing else" || bad "clean: exit $rc left [$left]"
rh clean "$T/fx-clean" clean; rc=$?
[ "$rc" -eq 0 ] && grep -q "nothing to remove" "$T/out" && ok "clean without raw/: exit 0, nothing to remove" || bad "clean again: exit $rc $(cat "$T/out")"

# --- 9. usage ------------------------------------------------------------------------------------------------------------
rh filt "$FIX/filter" probe --since 2026-01-01; rc=$?
[ "$rc" -eq 2 ] && ok "--since with probe: usage, exit 2" || bad "usage since: exit $rc"
rh filt "$FIX/filter" fetch --since yesterday; rc=$?
[ "$rc" -eq 2 ] && ok "--since without a date: usage, exit 2" || bad "usage date: exit $rc"
(cd "$T" && env HOME="$H" HARNESS_HOME="$HH" node "$RH" probe) >"$T/out" 2>"$T/err"; rc=$?
[ "$rc" -eq 3 ] && grep -q "not a registered project" "$T/err" && ok "outside a registered project: exit 3" || bad "unregistered: exit $rc $(cat "$T/err")"

# --- 10. the profile contract ---------------------------------------------------------------------------------------------
README="${PROFILES_README:-$BIN/../profiles/README.md}"
sec="$(awk '/^## Where it lives/{p=1;next} /^## /{p=0} p' "$README")"
grep -q "^    human-review/ " <<<"$sec" && grep -q "(bin/review-history: raw/" <<<"$sec" \
    && ok "profiles/README.md: state/human-review/ in the tree of Where it lives" || bad "profiles/README.md: no human-review/ under state/ in Where it lives"

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "nothing written into the real ~/.claude" || bad "the real home changed: $(real_home_diff "$home_before" "$home_after")"
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
