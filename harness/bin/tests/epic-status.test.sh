#!/usr/bin/env bash
# Characterization test of harness/bin/epic-status: the «Этап» (stage) line, the --json slice, the
# --ref reader of a branch's tree, the flags and the exit codes. The expectations were printed by the
# bash version of origin/main on this fixture; a rewrite of the script must keep every one of them
# byte for byte (ADR-0055 item 3: the contract of the Harness scripts does not change).
# Run: bash harness/bin/tests/epic-status.test.sh; exit code 0 — everything passed.
#
# The fixture is a temporary git repository with epics in .scratch. The script is started by its
# path (its #! line), as skills start it; the tickets root comes from --root or from `ticket root`
# next to it, with a stub profile, so the live registry is never read.
set -u
HARNESS="${HARNESS_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"   # HARNESS_DIR — run against another copy
STATUS="$HARNESS/bin/epic-status"
# Git Bash on Windows: `pwd -W` prints C:/…, the spelling git prints and node reads; a path like
# /tmp/… means nothing to node. Elsewhere there is no -W.
T="$(mktemp -d)"; T="$(cd "$T" && { pwd -W 2>/dev/null || pwd -P; })"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

# Stubs, in JavaScript: started by their #! line from bash and through node from a Node script alike.
mkdir -p "$T/stub"
printf '#!/usr/bin/env node\nprocess.exit(3)\n' >"$T/stub/profile-unregistered"
printf '#!/usr/bin/env node\nprocess.stdout.write(process.argv.slice(2).join(" ") === "--field _resolved.mode" ? "silent\\n" : "{}\\n")\n' >"$T/stub/profile-silent"
printf '#!/usr/bin/env node\nprocess.stderr.write("ticket stub: no root here\\n")\nprocess.exit(1)\n' >"$T/stub/ticket-broken"
chmod +x "$T/stub/"*
# The ticket script is the one next to epic-status (no CLAUDE_TICKET_BIN), as in a real run.
unset CLAUDE_TICKET_BIN
export CLAUDE_PROFILE_BIN="$T/stub/profile-unregistered"
export CLAUDE_GATE_CONFIG="$T/no-registry.json" CLAUDE_PROFILES_DIR="$T/no-profiles"
unset CLAUDE_GATE_STATE CLAUDE_PLUGIN_ROOT

g() { git -C "$R" -c user.name=t -c user.email=t@example.invalid -c core.autocrlf=false "$@"; }
tk() { # <epic> <file> <printf format> [args] — one ticket file
    mkdir -p "$S/$1/issues"
    local e="$1" f="$2" fmt="$3"; shift 3
    # shellcheck disable=SC2059
    printf "$fmt" "$@" >"$S/$e/issues/$f"
}

# --- fixture ----------------------------------------------------------------------------
R="$T/repo"; S="$R/.scratch"
mkdir -p "$R"
g init -q -b main
g commit -q --allow-empty -m init
g branch nosc                      # a branch without .scratch

# states: the spellings of the old header (a tail after the word, bold, Russian, other words): each is
# state none with statusError "old header", not a guess; only 06 has the new form.
tk states 01-done.md       '# 01 — Done one\n\nStatus: done — 2026-01-01, PR #1\n'
tk states 02-shipped.md    '# 02 — Shipped\n\nStatus: Выкачено 2026-01-02\n'
tk states 03-claimed.md    '# 03 — Claimed\n\n**Status:** claimed — 2026-01-03\n'
tk states 04-blocked.md    '# 04 — Blocked\n\nStatus: blocked — waits for the lawyer\n'
tk states 05-none.md       '# 05 — No status\n\nJust text.\n'
tk states 06-open.md       '# 06 — Open\n\nStatus: open\n'
tk states 07-resolved.md   '# 07 — Resolved\n\nStatus: Resolved.\n'
tk states 08-progress.md   '# 08 — In progress\n\nstatus : in-progress\n'
tk states 09-ru-blocked.md '# 09 — Заблокирован\n\nStatus: Заблокирован (ждёт)\n'
tk states README.md        '# Not a ticket\n\nStatus: done\n'
# last: the last occurrence wins; fences; CRLF; escaping.
tk last 01-footer.md  '# 01 — Header and footer\n\nStatus: open\nBlocked by: 07\n\nText.\n\n**Status:** done\n**Blocked by:** none\n'
tk last 02-fenced.md  '# 02 — Fenced\n\nStatus: open\n\n```md\nStatus: done\n```\n\n  ~~~\nStatus: done\nBlocked by: 05\n~~~\n'
tk last 03-crlf.md    '# 03 — CRLF title\r\n\r\nStatus: claimed\r\nBlocked by: 01, 02\r\nBranch: feat/crlf\r\n'
tk last 04-escape.md  '# 04 — Quote " back \\ ctl\001here\ttab\n\nStatus: open "q" \\ x\n'
tk last 05-noheading.md 'No heading here\n\nStatus: open\n'
tk last 6-short.md    '# Six short\n\nStatus: open\n'
# blk: Blocked by spellings; Branch and Repo.
tk blk 01-comma.md    '# 01 — Comma\n\nStatus: open\nBlocked by: 01, 02\nBranch: `feat/one`\n**Repo:** app\n'
tk blk 02-and.md      '# 02 — And\n\nStatus: open\nBlocked by: 01 и 02\n**Branch:** feat/two\nRepo: `lib` \n'
tk blk 03-semi.md     '# 03 — Semicolon\n\nStatus: open\nBlocked by: 01; 02.\n'
tk blk 04-dash.md     '# 04 — Dash\n\nStatus: open\nBlocked by: —\n'
tk blk 05-none.md     '# 05 — None can start\n\nStatus: open\nBlocked by: None — can start immediately\n'
tk blk 06-lawyer.md   '# 06 — Lawyer\n\nStatus: open\nBlocked by: Пакет юристу\n'
tk blk 07-mixed.md    '# 07 — Mixed\n\nStatus: open\nBlocked by: 03 — all the moves, Пакет юристу\n'
tk blk 08-bold.md     '# 08 — Bold\n\nStatus: open\n**Blocked by:** **04**, 5 (later)\n'
tk blk 09-empty.md    '# 09 — Empty\n\nStatus: open\nBlocked by:\n'
tk blk 10-nyet.md     '# 10 — Net\n\nStatus: open\nBlocked by: нет\n'
# Epics without tickets: with spec.md, with map.md, with neither (ebare, made after the branches below:
# git keeps no empty directory); an epic named with a dot is skipped.
mkdir -p "$S/espec/issues" "$S/emap" "$S/.trash/issues"
: >"$S/espec/spec.md"; : >"$S/espec/map.md"; : >"$S/emap/map.md"
tk espec notes.md '# notes\n\nStatus: open\n'
tk .trash 01-gone.md '# 01 — Gone\n\nStatus: open\n'
# Line cases: waits for, blocked, N without Status, closed, /to-tickets.
tk wait 01-first.md   '# 01 — First\n\nStatus: done\n'
tk wait 02-second.md  '# Second without number\n\nStatus: open\nBlocked by: 01, 03, 09\n'
tk wait 03-third.md   '# 03 — Third\n\nStatus: claimed\n'
tk blkd 01-stuck.md   '# 01 — Stuck\n\nStatus: blocked\nBlocked reason: lawyer\n'
tk blkd 02-a.md       '# 02 — A\n'
tk blkd 03-b.md       '# 03 — B\n'
tk fin 01-a.md        '# 01 — A\n\nStatus: done\n'
tk fin 02-b.md        '# 02 — B\n\nStatus: done 2026-01-02\nPR: #12\n'
tk fresh 01-a.md      '# 01 — A\n\nStatus: open\nBlocked by: 02\n'
tk fresh 02-b.md      '# 02 — B\n\nStatus: open\n'
# hdr: the header of one fact per line — the time after the state, Blocked reason / Waits / PR: #N (the
# first of each, up to the first "## " heading after Status, outside code), and the forms that are not it.
tk hdr 01-time.md      '# 01 — Time\n\nStatus: claimed 2026-03-04T05:06Z\nBranch: feat/t\n'
tk hdr 02-blocked.md   '# 02 — Blocked\n\nStatus: blocked 2026-03-05\nBlocked reason: the keys \t\nWaits: owner\nBlocked reason: second\n'
tk hdr 03-pr.md        '# 03 — PR\n\nStatus: done 2026-03-06T07:08Z\nPR: #0042\n\n## Result\n\nPR: #99\n'
tk hdr 04-prurl.md     '# 04 — PR url\n\nStatus: done\nPR: https://example.invalid/pull/5\n'
tk hdr 05-heading.md   '# 05 — After the heading\n\nStatus: open\n\n## Notes\n\nWaits: nobody\nBlocked reason: none\n'
tk hdr 06-oldtail.md   '# 06 — Old tail\n\nStatus: done — 2026-01-01, PR #1\nPR: #1\n'
tk hdr 07-twice.md     '# 07 — Twice\n\nStatus: open\n\n**Status:** done\n'
tk hdr 08-lower.md     '# 08 — Lower case\n\nstatus: open\n'
tk hdr 09-fenced.md    '# 09 — Fenced\n\nStatus: open   \n\n```\nStatus: done\nPR: #7\n```\n'
tk hdr 10-crlf.md      '# 10 — CRLF\r\n\r\nStatus: blocked 2026-03-07\r\nBlocked reason: r\r\nWaits: \r\n'
tk hdr 11-badtime.md   '# 11 — Bad time\n\nStatus: open 2026-3-7\n'
tk hdr 12-prfirst.md   '# 12 — PR first\n\nPR: #5\nStatus: done\n'
# Not a ticket: a .md file of an epic outside issues/ (here and on branch old, read with --ref).
mkdir -p "$S/fin/evidence" && printf '# 01 — Evidence\n\nStatus: open\n' >"$S/fin/evidence/01-x.md"
g add -A && g commit -q -m tickets
# Branch old: a different state of the same tree.
g checkout -q -b old
tk fin 02-b.md '# 02 — B\n\nStatus: open\n'
rm -rf "$S/blk" "$S/states" "$S/last" "$S/wait" "$S/blkd" "$S/fresh" "$S/espec" "$S/hdr"
g add -A && g commit -q -m old
# Branch moved: the tickets under sub/.scratch, which does not exist in the working tree of main.
g checkout -q -b moved
mkdir -p "$R/sub" && g mv .scratch sub/.scratch && g commit -q -m moved
g checkout -q main
mkdir -p "$S/ebare"
[ ! -e "$R/sub" ] || { echo "FAIL fixture: sub/ is left in the working tree of main"; exit 1; }
# A tickets root whose name starts with two dots is inside the repository (on main, read with --ref).
mkdir -p "$R/..t/dd/issues" && printf '# 01 — Dots\n\nStatus: open\n' >"$R/..t/dd/issues/01-a.md"
g add -A -- "..t" && g commit -q -m dots
# A tickets root outside git.
NG="$T/nogit/.scratch"; mkdir -p "$NG/solo/issues"
printf '# 01 — Solo\n\nStatus: open\n' >"$NG/solo/issues/01-solo.md"

# --- helpers ------------------------------------------------------------------------------
run() { # [cd <dir>] <args…> — sets out, err, rc
    local dir="$R"
    if [ "${1:-}" = cd ]; then dir="$2"; shift 2; fi
    out="$(cd "$dir" && "$STATUS" "$@" 2>"$T/err")"; rc=$?
    err="$(cat "$T/err")"
}
is() { # <name> <exit code> <stdout exactly>
    if [ "$rc" -eq "$2" ] && [ "$out" = "$3" ]; then ok "$1"
    else bad "$1"; echo "     exit $rc (want $2)"; echo "     got:  $out" | head -40; echo "     want: $3" | head -40; echo "     err:  $err" | head -5; fi
}
# A path the way `ticket root` prints it: C:\… on Windows, unchanged elsewhere.
native() { node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$1"; }
fails() { # <name> <exit code> <stderr substring> — stdout empty
    if [ "$rc" -eq "$2" ] && [ -z "$out" ] && [ "${err#*"$3"}" != "$err" ]; then ok "$1"
    else bad "$1"; echo "     exit $rc (want $2), out: ${out:0:200}"; echo "     err: ${err:0:300}"; fi
}

# --- 1. --json of the working tree, byte for byte ---------------------------------------
run --json --root "$S"
want='{"ref":"main","epics":[{"epic":"blk","hasSpec":false,"hasMap":false},{"epic":"blkd","hasSpec":false,"hasMap":false},{"epic":"ebare","hasSpec":false,"hasMap":false},{"epic":"emap","hasSpec":false,"hasMap":true},{"epic":"espec","hasSpec":true,"hasMap":true},{"epic":"fin","hasSpec":false,"hasMap":false},{"epic":"fresh","hasSpec":false,"hasMap":false},{"epic":"hdr","hasSpec":false,"hasMap":false},{"epic":"last","hasSpec":false,"hasMap":false},{"epic":"states","hasSpec":false,"hasMap":false},{"epic":"wait","hasSpec":false,"hasMap":false}],"tickets":[{"epic":"blk","num":1,"slug":"comma","title":"01 — Comma","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"01, 02","blockedNums":[1,2],"blockedParsed":true,"branch":"feat/one","repo":"app","ref":"main"},{"epic":"blk","num":2,"slug":"and","title":"02 — And","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"01 и 02","blockedNums":[1,2],"blockedParsed":true,"branch":"feat/two","repo":"lib","ref":"main"},{"epic":"blk","num":3,"slug":"semi","title":"03 — Semicolon","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"01; 02.","blockedNums":[1,2],"blockedParsed":true,"branch":null,"repo":null,"ref":"main"},{"epic":"blk","num":4,"slug":"dash","title":"04 — Dash","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"—","blockedNums":[],"blockedParsed":true,"branch":null,"repo":null,"ref":"main"},{"epic":"blk","num":5,"slug":"none","title":"05 — None can start","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"None — can start immediately","blockedNums":[],"blockedParsed":true,"branch":null,"repo":null,"ref":"main"},{"epic":"blk","num":6,"slug":"lawyer","title":"06 — Lawyer","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"Пакет юристу","blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"blk","num":7,"slug":"mixed","title":"07 — Mixed","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"03 — all the moves, Пакет юристу","blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"blk","num":8,"slug":"bold","title":"08 — Bold","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"**04**, 5 (later)","blockedNums":[4,5],"blockedParsed":true,"branch":null,"repo":null,"ref":"main"},{"epic":"blk","num":9,"slug":"empty","title":"09 — Empty","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"blk","num":10,"slug":"nyet","title":"10 — Net","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"нет","blockedNums":[],"blockedParsed":true,"branch":null,"repo":null,"ref":"main"},{"epic":"blkd","num":1,"slug":"stuck","title":"01 — Stuck","statusRaw":"blocked","state":"blocked","statusAt":null,"statusError":null,"blockedReason":"lawyer","waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"blkd","num":2,"slug":"a","title":"02 — A","statusRaw":null,"state":"none","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"blkd","num":3,"slug":"b","title":"03 — B","statusRaw":null,"state":"none","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"fin","num":1,"slug":"a","title":"01 — A","statusRaw":"done","state":"done","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"fin","num":2,"slug":"b","title":"02 — B","statusRaw":"done 2026-01-02","state":"done","statusAt":"2026-01-02","statusError":null,"blockedReason":null,"waits":null,"pr":12,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"fresh","num":1,"slug":"a","title":"01 — A","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"02","blockedNums":[2],"blockedParsed":true,"branch":null,"repo":null,"ref":"main"},{"epic":"fresh","num":2,"slug":"b","title":"02 — B","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"hdr","num":1,"slug":"time","title":"01 — Time","statusRaw":"claimed 2026-03-04T05:06Z","state":"work","statusAt":"2026-03-04T05:06Z","statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":"feat/t","repo":null,"ref":"main"},{"epic":"hdr","num":2,"slug":"blocked","title":"02 — Blocked","statusRaw":"blocked 2026-03-05","state":"blocked","statusAt":"2026-03-05","statusError":null,"blockedReason":"the keys","waits":"owner","pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"hdr","num":3,"slug":"pr","title":"03 — PR","statusRaw":"done 2026-03-06T07:08Z","state":"done","statusAt":"2026-03-06T07:08Z","statusError":null,"blockedReason":null,"waits":null,"pr":42,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"hdr","num":4,"slug":"prurl","title":"04 — PR url","statusRaw":"done","state":"done","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"hdr","num":5,"slug":"heading","title":"05 — After the heading","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"hdr","num":6,"slug":"oldtail","title":"06 — Old tail","statusRaw":"done — 2026-01-01, PR #1","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"hdr","num":7,"slug":"twice","title":"07 — Twice","statusRaw":"open","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"hdr","num":8,"slug":"lower","title":"08 — Lower case","statusRaw":"open","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"hdr","num":9,"slug":"fenced","title":"09 — Fenced","statusRaw":"open   ","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"hdr","num":10,"slug":"crlf","title":"10 — CRLF","statusRaw":"blocked 2026-03-07","state":"blocked","statusAt":"2026-03-07","statusError":null,"blockedReason":"r","waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"hdr","num":11,"slug":"badtime","title":"11 — Bad time","statusRaw":"open 2026-3-7","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"hdr","num":12,"slug":"prfirst","title":"12 — PR first","statusRaw":"done","state":"done","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":5,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"last","num":1,"slug":"footer","title":"01 — Header and footer","statusRaw":"open","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":"none","blockedNums":[],"blockedParsed":true,"branch":null,"repo":null,"ref":"main"},{"epic":"last","num":2,"slug":"fenced","title":"02 — Fenced","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"last","num":3,"slug":"crlf","title":"03 — CRLF title","statusRaw":"claimed","state":"work","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"01, 02","blockedNums":[1,2],"blockedParsed":true,"branch":"feat/crlf","repo":null,"ref":"main"},{"epic":"last","num":4,"slug":"escape","title":"04 — Quote \" back \\ ctl here tab","statusRaw":"open \"q\" \\ x","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"last","num":5,"slug":"noheading","title":"","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"last","num":6,"slug":"short","title":"Six short","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"states","num":1,"slug":"done","title":"01 — Done one","statusRaw":"done — 2026-01-01, PR #1","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"states","num":2,"slug":"shipped","title":"02 — Shipped","statusRaw":"Выкачено 2026-01-02","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"states","num":3,"slug":"claimed","title":"03 — Claimed","statusRaw":"claimed — 2026-01-03","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"states","num":4,"slug":"blocked","title":"04 — Blocked","statusRaw":"blocked — waits for the lawyer","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"states","num":5,"slug":"none","title":"05 — No status","statusRaw":null,"state":"none","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"states","num":6,"slug":"open","title":"06 — Open","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"states","num":7,"slug":"resolved","title":"07 — Resolved","statusRaw":"Resolved.","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"states","num":8,"slug":"progress","title":"08 — In progress","statusRaw":"in-progress","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"states","num":9,"slug":"ru-blocked","title":"09 — Заблокирован","statusRaw":"Заблокирован (ждёт)","state":"none","statusAt":null,"statusError":"old header","blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"wait","num":1,"slug":"first","title":"01 — First","statusRaw":"done","state":"done","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"},{"epic":"wait","num":2,"slug":"second","title":"Second without number","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":"01, 03, 09","blockedNums":[1,3,9],"blockedParsed":true,"branch":null,"repo":null,"ref":"main"},{"epic":"wait","num":3,"slug":"third","title":"03 — Third","statusRaw":"claimed","state":"work","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"}]}'
is "--json: the whole slice" 0 "$want"
# The same slice from inside the repository with no --root: the root comes from `ticket root`
# (not registered: <git top-level>/.scratch).
run cd "$R/.scratch/states" --json
is "--json without --root: the root from ticket root" 0 "$want"
printf '%s' "$out" | jq -e . >/dev/null 2>&1 && ok "--json: valid JSON (quote, backslash, control characters)" || bad "--json: not valid JSON"
# The rules one by one, so that a failure names the rule.
field() { printf '%s' "$out" | jq -c "[.tickets[] | select(.epic == \"$1\") | $2]"; }
run --json --root "$S"
w() { local got; got="$(field "$1" "$2")"; [ "$got" = "$3" ] && ok "$4" || { bad "$4"; echo "     got:  $got"; echo "     want: $3"; }; }
w states '[.num, .state, .statusError]' '[[1,"none","old header"],[2,"none","old header"],[3,"none","old header"],[4,"none","old header"],[5,"none",null],[6,"open",null],[7,"none","old header"],[8,"none","old header"],[9,"none","old header"]]' \
    "old Status spellings -> state none with statusError, no Status -> none without it; README.md is not a ticket"
w last '.statusRaw' '["open","open","claimed","open \"q\" \\ x","open","open"]' \
    "the first Status is statusRaw; Status inside \`\`\` and ~~~ does not count; CRLF stripped"
w last '[.state, .statusError]' '[["none","old header"],["open",null],["work",null],["none","old header"],["open",null],["open",null]]' \
    "a second Status line in the footer or a tail after the word is an old header"
w hdr '[.num, .state, .statusAt, .statusError]' '[[1,"work","2026-03-04T05:06Z",null],[2,"blocked","2026-03-05",null],[3,"done","2026-03-06T07:08Z",null],[4,"done",null,null],[5,"open",null,null],[6,"none",null,"old header"],[7,"none",null,"old header"],[8,"none",null,"old header"],[9,"open",null,null],[10,"blocked","2026-03-07",null],[11,"none",null,"old header"],[12,"done",null,null]]' \
    "new header: the state and its time; a tail, a second Status, lower case or a bad date is an old header"
w hdr '[.num, .blockedReason, .waits, .pr]' '[[1,null,null,null],[2,"the keys","owner",null],[3,null,null,42],[4,null,null,null],[5,null,null,null],[6,null,null,null],[7,null,null,null],[8,null,null,null],[9,null,null,null],[10,"r",null,null],[11,null,null,null],[12,null,null,5]]' \
    "Blocked reason / Waits / PR: #N: the first line of the header, outside code, only with a new Status line"
w last '.title' '["01 — Header and footer","02 — Fenced","03 — CRLF title","04 — Quote \" back \\ ctl here tab","","Six short"]' \
    "titles: CRLF stripped, control characters became spaces, quote and backslash escaped"
w blk '[.blockedNums, .blockedParsed]' '[[[1,2],true],[[1,2],true],[[1,2],true],[[],true],[[],true],[[],false],[[],false],[[4,5],true],[[],false],[[],true]]' \
    "Blocked by: comma, и, semicolon, dash, None —, Пакет юристу, mixed, bold, empty, нет"
w blk '[.branch, .repo]' '[["feat/one","app"],["feat/two","lib"],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null],[null,null]]' \
    "Branch and Repo: bold markers and backticks are not part of the value"

# --- 2. The «Этап» line --------------------------------------------------------------------
run --root "$S" states
is "line: old headers are counted apart from N without Status and are not done; ticket NN — title, branch" 0 '/to-tickets · states 0/9 · main · ticket 01 — Done one · 1 without Status · 7 with an old header — run ticket migrate'
run --root "$S" hdr
is "line: new headers give the stage, old ones are counted" 0 '/implement · hdr 3/12 · main · ticket 01 — Time · 4 with an old header — run ticket migrate'
run --root "$S" wait
is "line: a title without a number gets NN —; waits for the open blockers only" 0 '/implement · wait 1/3 · main · ticket 02 — Second without number · waits for 03'
run --root "$S" blkd
is "line: blocked" 0 '/implement · blkd 0/3 · main · ticket 01 — Stuck · blocked · 2 without Status'
run --root "$S" fin
is "line: closed" 0 'closed · fin 2/2 · main'
run --root "$S" fresh
is "line: /to-tickets" 0 '/to-tickets · fresh 0/2 · main · ticket 01 — A · waits for 02'
run --root "$S" espec
is "line: no tickets, spec.md -> /to-spec" 0 '/to-spec · espec · main — no tickets'
run --root "$S" emap
is "line: no tickets, map.md -> /wayfinder" 0 '/wayfinder · emap · main — no tickets'
run --root "$S" ebare
is "line: no tickets, neither -> —" 0 '— · ebare · main — no tickets'
run --root "$S"
is "no epic: the branch heading and one line per epic" 0 'main:
/to-tickets · blk 0/10 · ticket 01 — Comma · waits for 01 02
/implement · blkd 0/3 · ticket 01 — Stuck · blocked · 2 without Status
— · ebare — no tickets
/wayfinder · emap — no tickets
/to-spec · espec — no tickets
closed · fin 2/2
/to-tickets · fresh 0/2 · ticket 01 — A · waits for 02
/implement · hdr 3/12 · ticket 01 — Time · 4 with an old header — run ticket migrate
/implement · last 0/6 · ticket 01 — Header and footer · 2 with an old header — run ticket migrate
/to-tickets · states 0/9 · ticket 01 — Done one · 1 without Status · 7 with an old header — run ticket migrate
/implement · wait 1/3 · ticket 02 — Second without number · waits for 03'
run cd "$R/.scratch" fin
is "no --root: the root from ticket root" 0 'closed · fin 2/2 · main'
run cd "$T/nogit" --root "$NG"
is "root outside git: no branch heading" 0 '/to-tickets · solo 0/1 · ticket 01 — Solo'
run cd "$T/nogit" --root "$NG" solo
is "root outside git: no branch in the line" 0 '/to-tickets · solo 0/1 · ticket 01 — Solo'
run cd "$T/nogit" --json --root "$NG"
is "root outside git: --json labels the slice ." 0 '{"ref":".","epics":[{"epic":"solo","hasSpec":false,"hasMap":false}],"tickets":[{"epic":"solo","num":1,"slug":"solo","title":"01 — Solo","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"."}]}'

# --- 3. Flags ------------------------------------------------------------------------------
run fin --root "$S"
is "--root after the epic name" 0 'closed · fin 2/2 · main'
run --root "$S" fin --json
is "--json after the epic name prints the line" 0 'closed · fin 2/2 · main'
run --root "$S" -- fin
is "-- ends the flags" 0 'closed · fin 2/2 · main'
run --root "$S" some/path/fin/
is "an epic given as a path with a trailing slash" 0 'closed · fin 2/2 · main'
run --root "$S" nope
is "no such epic -> exit 1" 1 "no epic \"nope\" in $(native "$S")"
run --root "$T/missing"
is "no tickets root -> outside tickets, exit 0" 0 "outside tickets (no $(native "$T/missing"))"
run --json --root "$T/missing"
is "no tickets root, --json -> empty slice" 0 '{"ref":".","epics":[],"tickets":[]}'
run --ref main
fails "--ref without --json -> exit 2" 2 "--ref only together with --json"
run --json --ref
fails "--ref without a value -> exit 2" 2 "--ref without a value"
run --root
fails "--root without a value -> exit 2" 2 "--root without a value"
run --root ""
fails "--root with an empty value -> exit 2" 2 "--root without a value"
run fin --root
fails "--root without a value after the epic -> exit 2" 2 "--root without a value"
out="$(cd "$R" && CLAUDE_TICKET_BIN="$T/stub/ticket-broken" "$STATUS" 2>"$T/err")"; rc=$?; err="$(cat "$T/err")"
fails "ticket root fails -> its exit code and its words" 1 "ticket stub: no root here"
# CLAUDE_TICKET_BIN is asked even with --root: this stub ignores --root and names the root outside git.
printf '#!/usr/bin/env node\nconsole.log(%s)\n' "\"$NG\"" >"$T/stub/ticket-elsewhere"; chmod +x "$T/stub/ticket-elsewhere"
out="$(cd "$R" && CLAUDE_TICKET_BIN="$T/stub/ticket-elsewhere" "$STATUS" --root "$S" solo 2>"$T/err")"; rc=$?; err="$(cat "$T/err")"
is "CLAUDE_TICKET_BIN: the root comes from the given ticket script" 0 '/to-tickets · solo 0/1 · ticket 01 — Solo'

# --- 4. --ref: the tree of a branch ----------------------------------------------------------
run --json --ref old --root "$S"
is "--ref old: the branch's tree, labelled by the ref" 0 '{"ref":"old","epics":[{"epic":"emap","hasSpec":false,"hasMap":true},{"epic":"fin","hasSpec":false,"hasMap":false}],"tickets":[{"epic":"fin","num":1,"slug":"a","title":"01 — A","statusRaw":"done","state":"done","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"old"},{"epic":"fin","num":2,"slug":"b","title":"02 — B","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"old"}]}'
run --json --ref moved --root "$R/sub/.scratch"
is "--ref: a root missing in the working tree is read from the branch" 0 '{"ref":"moved","epics":[{"epic":"emap","hasSpec":false,"hasMap":true},{"epic":"fin","hasSpec":false,"hasMap":false}],"tickets":[{"epic":"fin","num":1,"slug":"a","title":"01 — A","statusRaw":"done","state":"done","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"moved"},{"epic":"fin","num":2,"slug":"b","title":"02 — B","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"moved"}]}'
run --json --ref nosc --root "$S"
is "--ref of a branch without .scratch -> an empty slice" 0 '{"ref":"nosc","epics":[],"tickets":[]}'
run --json --ref main --root "$R/..t"
is "--ref: a root named ..t is inside the repository, not above it" 0 '{"ref":"main","epics":[{"epic":"dd","hasSpec":false,"hasMap":false}],"tickets":[{"epic":"dd","num":1,"slug":"a","title":"01 — Dots","statusRaw":"open","state":"open","statusAt":null,"statusError":null,"blockedReason":null,"waits":null,"pr":null,"blockedRaw":null,"blockedNums":[],"blockedParsed":false,"branch":null,"repo":null,"ref":"main"}]}'
run --json --ref no-such-branch --root "$S"
fails "--ref of a missing ref -> exit 3" 3 "no such ref: no-such-branch"
run cd "$T/nogit" --json --ref main --root "$NG"
fails "--ref with a root outside git -> exit 3" 3 "is not in a git repository"
run --json --ref main --root "$R"
fails "--ref with the repository root as the tickets root -> exit 3" 3 "--ref is not supported"
out="$(cd "$R" && CLAUDE_PROFILE_BIN="$T/stub/profile-silent" "$STATUS" --json --ref main --root "$S" 2>"$T/err")"; rc=$?; err="$(cat "$T/err")"
fails "--ref in Silent mode -> exit 3" 3 "in Silent mode the status does not live in branches"

# --- summary ------------------------------------------------------------------------------
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
