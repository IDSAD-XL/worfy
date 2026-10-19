#!/usr/bin/env bash
# skills/gate-queue/SKILL.md (worfy-windows ticket 17): the text contract of the cross-machine gate queue, and its
# blocks cut out of SKILL.md and run under bash and zsh — the role of this machine (a stub bin/profile) and the
# choice of the waiting PRs (a stub F and a stub gh that applies the block's --jq filter with jq to $GH_JSON). The
# rebase, checks section and report-and-merge blocks are run by skill-blocks.test.sh against a bare origin.
# Run: bash harness/bin/tests/gate-queue.test.sh; exit code 0 — everything passed.
# GATE_QUEUE_FILE — check another copy of SKILL.md.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$(cd "$HERE/../.." && pwd)"
GQ="${GATE_QUEUE_FILE:-$HARNESS/skills/gate-queue/SKILL.md}"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$HERE/real-home.sh"
. "$HERE/gh-stand-in.sh"
home_before="$(real_home_snapshot "$HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
check() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }
has()   { grep -qF -- "$2" "$1"; }
lacks() { ! grep -qF -- "$2" "$1"; }
[ -f "$GQ" ] || { echo "FAIL missing $GQ"; echo "passed $pass, failed 1"; exit 1; }
# The shells every block runs under; Git Bash on Windows has no zsh (worfy ADR-0055), elsewhere a missing zsh fails.
SHELLS=(bash zsh)
case "$(uname -s)" in
    MINGW* | MSYS*) command -v zsh >/dev/null 2>&1 || { SHELLS=(bash); echo "skip zsh: Git Bash on Windows has no zsh, the zsh cases run on macOS and Linux"; } ;;
esac
# Off Windows the zsh cases always run: a skip that fired there would leave them out and the file would stay green
# (worfy-windows ticket 59, the review of PR #481).
case "$(uname -s)" in
    MINGW* | MSYS*) ;;
    *) [[ " ${SHELLS[*]} " == *" zsh "* ]] && ok "the shells of the blocks include zsh off Windows" || bad "the shells of the blocks lack zsh off Windows: [${SHELLS[*]}]" ;;
esac
command -v jq >/dev/null 2>&1 || { echo "FAIL no jq on PATH: the stub gh applies the --jq filter with it"; exit 1; }

# 1. The text. The label and the section name come from the profile, never from the text (worfy ADR-0069).
for w in cross_machine_gate --label --force-with-lease checks_section 'report: green' 'report: red' --remove-label 'gh pr comment <N>' \
    'queue empty' 'waits for the requesting machine' '`/worfy:epic-wave`, section 4'; do
    check "gate-queue has '$w'" has "$GQ" "$w"
done
text="$(tr '\n' ' ' <"$GQ" | tr -s ' ')"
before() { local a="${1%%"$2"*}" b="${1%%"$3"*}"; [[ "$1" == *"$2"* && "$1" == *"$3"* ]] && [ ${#a} -lt ${#b} ]; }   # before <text> <first> <second>
check "gate-queue: gh pr comment comes before gh pr merge" before "$text" 'gh pr comment <N>' 'gh pr merge <N>'
check "gate-queue: the PRs go one at a time" has "$GQ" '**one at a time**'
check "gate-queue: no merge without the report" has "$GQ" '**No merge without the report.**'
check "gate-queue: exit code 4 — one machine, no queue" has "$GQ" 'Exit code 4 or `null` — the project has one machine and no queue'
check "gate-queue: request — the other machine processes the queue" has "$GQ" '`request` — the other machine processes the queue: say so and stop.'
check "gate-queue: the list filters with gh's own --jq, without an external jq" has "$GQ" "The block filters with \`gh\`'s own \`--jq\`, without an external \`jq\`"
check "gate-queue: tickets of the other machine's epic are not taken" has "$GQ" 'This session takes no tickets of
the other machine'"'"'s epic and does not change their status.'
check "gate-queue: the merge is under the main-branch lock" before "$text" 'main.lock"' 'gh pr merge <N>'
check "gate-queue: a PR without the checks section is red" has "$GQ" 'red, with the reason "no `<checks_section>` section"'
check "gate-queue: no label name in the text" lacks "$GQ" 'needs-mac-gate'
check "gate-queue: no section name in the text" lacks "$GQ" 'Mac checks'
left="$(perl -CSD -ne 'print "$.: $_" if /\p{Cyrillic}/' "$GQ" | head -n 3)"
check "gate-queue: no Cyrillic${left:+ — first: $left}" test -z "$left"

block() { # $1 = a string that identifies the ```bash block; prints it without the `F() {…profile…}` line
    awk -v m="$1" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}' "$GQ" \
        | grep -v '^F() { "\${CLAUDE_PLUGIN_ROOT}/bin/profile"'
}

# 2. The role block, with a stub bin/profile under a temporary CLAUDE_PLUGIN_ROOT: its answer is $P_OUT, its exit code $P_EXIT.
BR="$(block 'cross_machine_gate.role 2>/dev/null')"
[ -n "$BR" ] || bad "role block not found in $GQ"
BR="${BR//<repo>/$T/repo}"
mkdir -p "$T/plugin/bin"
printf '#!/usr/bin/env bash\necho "$*" >>"$P_LOG"\n[ -n "$P_OUT" ] && printf "%%s\\n" "$P_OUT"\nexit "$P_EXIT"\n' >"$T/plugin/bin/profile"; chmod +x "$T/plugin/bin/profile"
role_case() { # role_case <exit> <answer> <want> <name>
    local sh got
    for sh in "${SHELLS[@]}"; do
        : >"$T/p.log"
        got="$(env CLAUDE_PLUGIN_ROOT="$T/plugin" P_LOG="$T/p.log" P_EXIT="$1" P_OUT="$2" $sh -c "$BR" 2>&1)"
        [ "$got" = "$3" ] && [ "$(cat "$T/p.log")" = "-C $T/repo --field cross_machine_gate.role" ] \
            && ok "$sh: role block, $4" || bad "$sh: role block, $4: got [$got] want [$3]"
    done
}
role_case 0 serve "role serve: processing the queue" "serve -> the queue is processed"
role_case 0 $'serve\r' "role serve: processing the queue" "serve with CRLF (Node on Windows) -> the queue is processed"
role_case 0 request "queue skipped: role request, the machine with serve processes the queue" "request -> skipped"
role_case 4 "" "queue skipped: the profile has no cross_machine_gate, one machine, no queue" "no cross_machine_gate (exit 4) -> skipped"
role_case 0 null "queue skipped: the profile has no cross_machine_gate, one machine, no queue" "null -> skipped"
role_case 1 "" "profile error: exit 1" "a broken profile (exit 1) -> an error, not a skip"

# 3. The choice of the waiting PRs: a stub F (the profile of the serve machine) and a stub gh. Every gh call is logged;
# gh_guard stops the test unless the gh the shell and node find is the stub, and keeps every credential from it.
GHX="$T/ghx"; mkdir -p "$GHX"
cat >"$GHX/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$GH_LOG"; echo "$*" >>"$GH_ALL"
f=""; prev=""
for a in "$@"; do [ "$prev" = --jq ] && f=$a; prev=$a; done
[ -n "${GH_FAIL:-}" ] && { echo "HTTP 502: Bad Gateway (https://api.github.com/graphql)" >&2; exit 1; }
if [ -n "$f" ]; then set -o pipefail; jq -r "$f" "$GH_JSON" | tr -d '\r'; exit $?; fi
exit 0
EOF
chmod +x "$GHX/gh"
refusing_gh_exe "$GHX/gh"
( PATH="$GHX:$PATH"; gh_guard - "$GHX/gh" "$GHX/gh" ) || exit 1
: >"$T/ghx-all.log"
XENV=(env -u GH_TOKEN -u GITHUB_TOKEN PATH="$GHX:$PATH" GH_LOG="$T/ghx.log" GH_ALL="$T/ghx-all.log" GH_JSON="$T/ghx.json" GH_CONFIG_DIR="$T/gh-config")
STUB='F() { case "$1" in
  cross_machine_gate.label) echo needs-mac-gate ;;
  cross_machine_gate.checks_section) echo "Mac checks" ;;
  github.account) echo mac-bot ;;
  *) return 4 ;;
esac; }'
BL="$(block 'isCrossRepository')"
[ -n "$BL" ] || bad "list block not found in $GQ"
BL="${BL//<repo>/$T/repo}"
pr() { # pr <number> <createdAt> <last committedDate> [<comment json>...]
    local n="$1" c="$2" d="$3"; shift 3
    jq -n --argjson n "$n" --arg c "$c" --arg d "$d" --argjson cm "[$(IFS=,; echo "$*")]" \
        '{number: $n, headRefName: "feature-\($n)", headRefOid: "oid\($n)", isCrossRepository: false, createdAt: $c, commits: [{committedDate: "2026-10-18T05:00:00Z"}, {committedDate: $d}], comments: $cm}'
}
comment() { jq -nc --arg a "$1" --arg t "$2" --arg b "$3" '{author: {login: $a}, createdAt: $t, body: $b}'; }
RED=$'Mac checks report: red\nreason: pnpm icons exit 1'
list_case() { # list_case <name> <want> <PR json lines...>
    local name="$1" want="$2" sh got; shift 2
    printf '%s\n' "$@" | jq -s . >"$T/ghx.json"
    for sh in "${SHELLS[@]}"; do
        : >"$T/ghx.log"
        got="$("${XENV[@]}" $sh -c "$STUB"$'\n'"$BL" 2>&1)"
        [ "$got" = "$want" ] && [ "$(grep -c '^pr ' "$T/ghx.log")" = 1 ] \
            && grep -q -- '^pr list --state open --label needs-mac-gate --limit 100 --json number,headRefName,headRefOid,isCrossRepository,createdAt,commits,comments --jq ' "$T/ghx.log" \
            && ok "$sh: list block, $name" || bad "$sh: list block, $name: got [$got] want [$want] gh [$(cat "$T/ghx.log")]"
    done
}
# Three labelled PRs: #21 without a report; #22 with a red report newer than its last commit; #23 with the same report
# older than its last commit. #21 and #23 wait, the older wait first (#23 since its commit at 07:30, #21 since its
# creation at 08:00, which is later than its commit); #22 waits for the requesting machine.
list_case "three PRs: no report, a red report newer and one older than the last commit" \
    "23 feature-23 oid23 since 2026-10-18T07:30:00Z
21 feature-21 oid21 since 2026-10-18T08:00:00Z
22 waits for the requesting machine: its red report is newer than its last commit
EXIT=0" \
    "$(pr 21 2026-10-18T08:00:00Z 2026-10-18T07:00:00Z)" \
    "$(pr 22 2026-10-18T06:00:00Z 2026-10-18T09:00:00Z "$(comment mac-bot 2026-10-18T10:00:00Z "$RED")")" \
    "$(pr 23 2026-10-18T06:00:00Z 2026-10-18T07:30:00Z "$(comment mac-bot 2026-10-18T07:00:00Z "$RED")")"
# A report by another account does not count (anyone can write one); a comment that only mentions the report is not one;
# a green report newer than the last commit ends no wait: the PR is still open, so its merge failed (a conflict with
# main, the network, the lock), and the next pass takes it again; a fork PR is skipped, never checked out.
list_case "a report by another account, a comment that is not a report, a green report whose merge failed, a fork" \
    "31 feature-31 oid31 since 2026-10-18T06:00:00Z
32 feature-32 oid32 since 2026-10-18T06:30:00Z
34 fork: skipped
33 feature-33 oid33 since 2026-10-18T09:00:00Z
EXIT=0" \
    "$(pr 31 2026-10-18T06:00:00Z 2026-10-18T05:30:00Z "$(comment mallory 2026-10-18T07:00:00Z "$RED")")" \
    "$(pr 32 2026-10-18T06:00:00Z 2026-10-18T06:30:00Z "$(comment mac-bot 2026-10-18T07:00:00Z $'See the Mac checks report: red above')")" \
    "$(pr 33 2026-10-18T06:00:00Z 2026-10-18T09:00:00Z "$(comment mac-bot 2026-10-18T09:30:00Z $'Mac checks report: green\nall fine')")" \
    "$(pr 34 2026-10-18T06:00:00Z 2026-10-18T08:00:00Z | jq -c '.isCrossRepository = true')"
# Two green reports on the PR's current head (worfy-windows ticket 59): the merge failed twice on one head, so a third
# gate full would change nothing. The report names its head on the second line (`head: <SHA>`), and the count matches
# it against headRefOid, not dates: a rebase may keep an older commit date, and then reports of the old head would
# count. One green report on the head still waits; so does a PR whose reports name another head (66: its commit date
# is older than both reports), a report without a head line, and a report by another account.
green() { printf 'Mac checks report: green\nhead: %s\nall fine' "$1"; }
list_case "two green reports on the current head -> needs owner; one, or reports of another head -> still waits" \
    "62 feature-62 oid62 since 2026-10-18T07:00:00Z
63 feature-63 oid63 since 2026-10-18T08:00:00Z
66 feature-66 oid66 since 2026-10-18T08:15:00Z
64 feature-64 oid64 since 2026-10-18T08:30:00Z
61 needs owner: the merge failed after two green reports on head oid61, the gate is not run again
EXIT=0" \
    "$(pr 61 2026-10-18T06:00:00Z 2026-10-18T09:00:00Z "$(comment mac-bot 2026-10-18T09:30:00Z "$(green oid61)")" "$(comment mac-bot 2026-10-18T10:30:00Z "$(green oid61)")")" \
    "$(pr 62 2026-10-18T06:00:00Z 2026-10-18T07:00:00Z "$(comment mac-bot 2026-10-18T07:30:00Z "$(green oid62)")")" \
    "$(pr 63 2026-10-18T06:00:00Z 2026-10-18T08:00:00Z "$(comment mac-bot 2026-10-18T08:30:00Z "$(green oid63)")" "$(comment mac-bot 2026-10-18T09:30:00Z $'Mac checks report: green\nall fine')")" \
    "$(pr 64 2026-10-18T06:00:00Z 2026-10-18T08:30:00Z "$(comment mallory 2026-10-18T09:00:00Z "$(green oid64)")" "$(comment mac-bot 2026-10-18T09:30:00Z "$(green oid64)")")" \
    "$(pr 66 2026-10-18T06:00:00Z 2026-10-18T08:15:00Z "$(comment mac-bot 2026-10-18T09:30:00Z "$(green oid-old)")" "$(comment mac-bot 2026-10-18T10:30:00Z "$(green oid-old)")")"
# A red report at the same second as the last commit is not newer than it: the PR waits (the same rule as worfy's reader).
list_case "a red report at the same second as the last commit -> still waits" \
    "35 feature-35 oid35 since 2026-10-18T09:00:00Z
EXIT=0" \
    "$(pr 35 2026-10-18T06:00:00Z 2026-10-18T09:00:00Z "$(comment mac-bot 2026-10-18T09:00:00Z "$RED")")"
list_case "a PR whose commits list is empty waits since its creation" \
    "41 feature-41 oid41 since 2026-10-18T06:00:00Z
EXIT=0" \
    "$(pr 41 2026-10-18T06:00:00Z 2026-10-18T05:00:00Z | jq -c '.commits = []')"
list_case "no labelled PR -> nothing before EXIT=0 (queue empty)" "EXIT=0"
# No github.account: no report counts, every labelled PR waits.
printf '%s\n' "$(pr 51 2026-10-18T06:00:00Z 2026-10-18T07:00:00Z "$(comment mac-bot 2026-10-18T08:00:00Z "$RED")")" | jq -s . >"$T/ghx.json"
for sh in "${SHELLS[@]}"; do
    got="$("${XENV[@]}" $sh -c "${STUB//'github.account) echo mac-bot ;;'/}"$'\n'"$BL" 2>&1)"
    [ "$got" = $'51 feature-51 oid51 since 2026-10-18T07:00:00Z\nEXIT=0' ] \
        && ok "$sh: list block, no github.account -> no report counts, the PR waits" || bad "$sh: list block, no github.account: [$got]"
done
# gh fails: the exit code reaches EXIT=, no PR line is printed.
for sh in "${SHELLS[@]}"; do
    got="$("${XENV[@]}" GH_FAIL=1 $sh -c "$STUB"$'\n'"$BL" 2>/dev/null)"
    [ "$got" = EXIT=1 ] && ok "$sh: list block, gh fails -> EXIT=1 and no PR" || bad "$sh: list block, gh fails: [$got]"
done
echo "stub gh calls: $(grep -c '^pr ' "$T/ghx-all.log")"   # one line a call: the --jq filter spans several lines

home_after="$(real_home_snapshot "$HOME" "$T")"
[ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
