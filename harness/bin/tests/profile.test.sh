#!/usr/bin/env bash
# Тесты ~/.claude/bin/profile. Запуск: bash ~/.claude/bin/tests/profile.test.sh; код выхода 0 — всё прошло.
#
# Часть проверок идёт по живому реестру (gate/config.json) и живому репозиторию Auction;
# часть — по синтетическому репозиторию во временном каталоге со своим конфигом, чтобы
# проверить рабочее дерево ВНЕ префикса match (опознание через git common dir).
set -u
PROFILE="$HOME/.claude/bin/profile"
AUCTION=/Users/alexey/Work/Auction
pass=0
fail=0

check() { # $1 имя, $2 ожидаемый код, $3 ожидаемая подстрока stdout (или ""), дальше — команда
    local name="$1" want_rc="$2" want_out="$3"
    shift 3
    local got rc
    got="$("$@" 2>/tmp/profile-test-err.$$)"
    rc=$?
    if [ "$rc" -eq "$want_rc" ] && { [ -z "$want_out" ] || [[ "$got" == *"$want_out"* ]]; }; then
        pass=$((pass + 1))
        echo "ok   $name (exit $rc)"
    else
        fail=$((fail + 1))
        echo "FAIL $name: exit $rc (want $want_rc); stdout: ${got:0:200}; stderr: $(head -c 200 /tmp/profile-test-err.$$)"
    fi
}

# --- живой реестр ------------------------------------------------------------------
if [ -d "$AUCTION" ]; then
    check "auction root --name" 0 "auction" "$PROFILE" -C "$AUCTION" --name
    check "auction subdir --field commands.test" 0 "pnpm test" "$PROFILE" -C "$AUCTION/apps/api" --field commands.test
    check "auction --field parallel" 0 "worktrees" "$PROFILE" -C "$AUCTION" --field parallel
    check "auction --field nested array" 0 "auction" "$PROFILE" -C "$AUCTION" --field qmd.collections
    check "auction --field absent -> 4" 4 "" "$PROFILE" -C "$AUCTION" --field no.such.field
    check "auction --dir" 0 "/.claude/profiles/auction" "$PROFILE" -C "$AUCTION" --dir
    check "auction --rules" 0 "## Источники" "$PROFILE" -C "$AUCTION" --rules
    check "auction default briefing" 0 "--- rules.md" "$PROFILE" -C "$AUCTION"
    check "auction --json is JSON" 0 "" bash -c "'$PROFILE' -C '$AUCTION' --json | node -e 'JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"))'"
    wt="$(git -C "$AUCTION" worktree list --porcelain | awk '/^worktree /{print $2}' | grep -v "^$AUCTION\$" | while read -r d; do [ -d "$d" ] && echo "$d" && break; done)"
    if [ -n "$wt" ]; then
        check "auction worktree --name" 0 "auction" "$PROFILE" -C "$wt" --name
        check "auction worktree in_worktree" 0 "true" "$PROFILE" -C "$wt" --field _resolved.in_worktree
    else
        echo "skip auction worktree: no live worktree"
    fi
else
    echo "skip live Auction checks: $AUCTION missing"
fi

# --- синтетика ---------------------------------------------------------------------
T="$(mktemp -d)"
T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T" /tmp/profile-test-err.$$' EXIT
mkdir -p "$T/repo" "$T/profiles/demo" "$T/plain" "$T/repo2"
git -C "$T/repo" init -q -b main
git -C "$T/repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$T/repo" worktree add -q --detach "$T/elsewhere-wt" 2>/dev/null
git -C "$T/repo2" init -q -b main
printf '{"schema":1,"name":"demo","commands":{"test":"make test"},"parallel":"single"}\n' >"$T/profiles/demo/profile.json"
printf '# demo rules\n' >"$T/profiles/demo/rules.md"
cat >"$T/config.json" <<EOF
{"repos":[
 {"key":"demo","match":"$T/repo","profile":"demo"},
 {"key":"noprof","match":"$T/repo2"}
]}
EOF
export CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/profiles"
check "synthetic root --field" 0 "make test" "$PROFILE" -C "$T/repo" --field commands.test
check "worktree outside match prefix" 0 "demo" "$PROFILE" -C "$T/elsewhere-wt" --name
check "worktree flagged" 0 "true" "$PROFILE" -C "$T/elsewhere-wt" --field _resolved.in_worktree
check "root not flagged" 0 "false" "$PROFILE" -C "$T/repo" --field _resolved.in_worktree
check "unregistered dir -> 3" 3 "" "$PROFILE" -C "$T/plain"
check "registered without profile -> 3" 3 "" "$PROFILE" -C "$T/repo2"
check "no such dir -> 2" 2 "" "$PROFILE" -C "$T/nope"
check "unknown flag -> 2" 2 "" "$PROFILE" --bogus
check "two modes -> 2" 2 "" "$PROFILE" --json --dir
check "--field without path -> 2" 2 "" "$PROFILE" --field
rm "$T/profiles/demo/profile.json"
check "profile dir missing file -> 3" 3 "" "$PROFILE" -C "$T/repo"
echo '{broken' >"$T/profiles/demo/profile.json"
check "broken profile.json -> 1" 1 "" "$PROFILE" -C "$T/repo"
unset CLAUDE_GATE_CONFIG CLAUDE_PROFILES_DIR
check "live registry: unregistered dir -> 3" 3 "" "$PROFILE" -C "$T/plain"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
