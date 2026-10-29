# The world of the skill block tests, sourced by skill-blocks.test.sh and skill-blocks-gate.test.sh after `set -u`:
# the temporary folder, ok/bad, the shells, render and the block cutters, and a Silent project in a temporary
# HARNESS_HOME whose blocks call the real profile, ticket, epic-status and silent-check next to the tests.
# Not a test of its own (no .test.sh).
# The SKILL.md files under test are the copies in harness/skills, next to this test.
SKILLS="$(cd "$(dirname "$0")/../.." && pwd)/skills"
SKILL="${SKILL_FILE:-$SKILLS/overnight-fix-loop/SKILL.md}"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
. "$(dirname "$0")/real-home.sh"
home_before="$(real_home_snapshot "$HOME" "$T")"
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
# The shells every block runs under. Git Bash on Windows has no zsh: there the zsh cases are
# skipped with one line. On macOS and Linux a missing zsh is a failure, not a skip.
SHELLS=(bash zsh)
# native <dir>: the path as a Node script on Windows reads it (C:/…, `pwd -W` of Git Bash); unchanged elsewhere.
# Paths written into the temporary registry and profiles go through it: the Node profile cannot match /tmp/….
native() { (cd "$1" && pwd -W 2>/dev/null) || printf '%s' "$1"; }
# jq for Windows ends its lines with CRLF. The test's own jq calls drop the CR; the skill blocks must drop it
# themselves, and the CRLF section below runs them with a jq that writes CRLF on any system.
jq() { command jq "$@" | tr -d '\r'; return "${PIPESTATUS[0]}"; }
case "$(uname -s)" in
    MINGW* | MSYS*) command -v zsh >/dev/null 2>&1 || { SHELLS=(bash); echo "skip zsh: Git Bash on Windows has no zsh, the zsh cases run on macOS and Linux"; } ;;
esac
# Off Windows the zsh cases always run: a skip that fired there would leave them out and the file would stay green.
case "$(uname -s)" in
    MINGW* | MSYS*) ;;
    *) [[ " ${SHELLS[*]} " == *" zsh "* ]] && ok "the shells of the blocks include zsh off Windows" || bad "the shells of the blocks lack zsh off Windows: [${SHELLS[*]}]" ;;
esac

# Claude Code hands the model SKILL.md with the skill's arguments put in: $N becomes the N-th word of the
# arguments ($0 the first; a $N past the last word stays), $ARGUMENTS[N] the same, $ARGUMENTS the whole
# string, and \$ before a digit or ARGUMENTS stands for a plain $. Code blocks are not spared, and a skill
# called with arguments gets its blocks in that form. So every block below runs on the text as Claude Code
# renders it for the arguments SKILL_ARGS (default ten words, so every $0 ... $9 is replaced), under every shell of SHELLS; the cut also checks
# that the rendered block equals the block in the file, so the file's own text gives the same result.
# SKILL_ARGS= (empty) renders the text of a call without arguments.
SKILL_ARGS="${SKILL_ARGS-a b c d e f g h i j}"
render() { # [file]; prints the skill text as Claude Code renders it for the arguments SKILL_ARGS (no $ in them)
    SKILL_ARGS="$SKILL_ARGS" perl -pe 'BEGIN { $all = $ENV{SKILL_ARGS}; @a = split " ", $all }
        s/(?<!\\)\\\$(?=\d|ARGUMENTS)/\x01/g;
        s/\$ARGUMENTS\[(\d+)\]/defined $a[$1] ? $a[$1] : "\x01ARGUMENTS[$1]"/ge;
        s/\$(\d+)(?!\w)/defined $a[$1] ? $a[$1] : "\x01$1"/ge;
        s/\$ARGUMENTS/$all/g;
        s/\x01/\$/g' "$@"
}
got="$(printf '%s\n' 'F() { p --field "$1"; }' "awk '{w=substr(\$0,10)} \$3==b'" '\$1 $ARGUMENTS $ARGUMENTS[2] $10 $1x "$@" ${1}' | SKILL_ARGS='a b c' render)"
want="$(printf '%s\n' 'F() { p --field "b"; }' "awk '{w=substr(a,10)} \$3==b'" '$1 a b c c $10 $1x "$@" ${1}')"
[ "$got" = "$want" ] && ok "render puts the arguments in as Claude Code does" || bad "render: got [$got] want [$want]"
# The blocks whose rendered text differs from the file's, one line each; checked at the end.
CHANGED="$T/changed-blocks"; : >"$CHANGED"
cut_block() { # $1 = a string that identifies the ```bash block; reads markdown on stdin
    awk -v m="$1" '/^```bash/{inb=1; buf=""; next} /^```/{if(inb && index(buf,m)) printf "%s", buf; inb=0; next} inb{buf=buf $0 "\n"}'
}
# blockf <marker>: the ```bash block of $SKILL that contains the marker, as Claude Code renders it.
blockf() {
    local own rendered
    own="$(cut_block "$1" <"$SKILL")"; rendered="$(render "$SKILL" | cut_block "$1")"
    [ "$own" = "$rendered" ] || printf '%s: the block with [%s] changes when the skill is called with the arguments [%s]\n' "$SKILL" "$1" "$SKILL_ARGS" >>"$CHANGED"
    printf '%s\n' "$rendered"
}
block() { # $1 = a string that identifies the ```bash block; prints it without the `F() {…profile…}` line
    blockf "$1" | grep -v '^F() { "\${CLAUDE_PLUGIN_ROOT}/bin/profile"'
}
# The harness next to this test, for the blocks that call ${CLAUDE_PLUGIN_ROOT}/bin/….
PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# A Silent project in a temporary HARNESS_HOME; the blocks call the real profile, ticket, epic-status and
# silent-check next to this test (CLAUDE_PLUGIN_ROOT = harness/).
SH="$T/silent"; SR="$SH/repo"; SW="$SH/wf"; SHH="$SH/hh"
mkdir -p "$SH/home" "$SHH/gate" "$SHH/projects/sp" "$SW/.scratch/pay-flow/issues"
git -C "$SH" init -q -b main repo && git -C "$SR" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$SR" branch fix/local-only && git -C "$SR" update-ref refs/remotes/origin/fix/pushed HEAD
printf '{"repos":[{"key":"sp","match":"%s","profile":"sp"}]}\n' "$(native "$SR")" >"$SHH/gate/config.json"
printf '{"schema":2,"name":"sp","mode":"silent","workflow":{"folder":"%s"}}\n' "$(native "$SW")" >"$SHH/projects/sp/profile.json"
tk() { printf '# %s — t\n\nStatus: %s\n%b' "$1" "$2" "${3:-}" >"$SW/.scratch/pay-flow/issues/$1-t.md"; }
# These blocks define F themselves (the real profile), so the F line stays in: blockf, not block.
reset_tickets() {
    tk 01 open; tk 02 claimed 'Branch: fix/local-only\n'; tk 03 claimed 'Branch: fix/pushed\nRepo: repo\n'; tk 04 claimed; tk 05 claimed 'Branch: fix/gone\n'
}
git -C "$SW" init -q -b main
SENV=(env -u CLAUDE_GATE_CONFIG -u CLAUDE_PROFILES_DIR -u CLAUDE_PROFILE_BIN -u CLAUDE_TICKET_BIN HOME="$SH/home" HARNESS_HOME="$SHH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
      GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t)
# ship-ticket as an agent reads it in full: SKILL.md with its step files in place (skill-text.sh).
. "$(dirname "$0")/skill-text.sh"
skill_text "$SKILLS/ship-ticket/SKILL.md" "$T/ship-ticket.md" || { echo "FAIL cannot assemble ship-ticket"; exit 1; }
SHIP="$T/ship-ticket.md" WAVE="$SKILLS/epic-wave/SKILL.md" GQF="$SKILLS/gate-queue/SKILL.md"
sub() { local c="$1"; c="${c//<repo>/$SR}"; c="${c//<epic>/pay-flow}"; printf '%s' "$c"; }
# The checks at the end of each file: no block changed by the arguments, and the real home untouched.
finish_blocks() {
    [ -s "$CHANGED" ] && bad "blocks that Claude Code changes when the skill is called with arguments (a \$N in the text):"$'\n'"$(cat "$CHANGED")" \
        || ok "every block checked here is the same text with and without the arguments [$SKILL_ARGS]"
    home_after="$(real_home_snapshot "$HOME" "$T")"
    [ "$home_before" = "$home_after" ] && ok "the real ~/.claude and ~/.claude/worfy-harness are unchanged" || bad "the real home changed"
    echo "passed $pass, failed $fail"
    [ "$fail" -eq 0 ]
}
