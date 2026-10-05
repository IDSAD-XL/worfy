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
    check "auction --field modules.heavy (key with /)" 0 '"apps/api": 3' "$PROFILE" -C "$AUCTION" --field modules.heavy
    check "auction --field commands.package.names" 0 '"apps/api": "@auction/api"' "$PROFILE" -C "$AUCTION" --field commands.package.names
    check "auction --field commands.package.test_one" 0 "pnpm --filter <пакет> exec vitest run <файл>" "$PROFILE" -C "$AUCTION" --field commands.package.test_one
    check "auction --field tests.globs" 0 '"*.test.ts*"' "$PROFILE" -C "$AUCTION" --field tests.globs
    check "auction --field tests.new_file" 0 "apps/api/test/<имя>.hardening.spec.ts" "$PROFILE" -C "$AUCTION" --field tests.new_file
    check "auction --field github.account" 0 "IDSAD-XL" "$PROFILE" -C "$AUCTION" --field github.account
    check "auction --field tickets.root" 0 ".scratch/" "$PROFILE" -C "$AUCTION" --field tickets.root
    check "auction language.reports ru" 0 "ru" "$PROFILE" -C "$AUCTION" --field language.reports
    check "auction language.team ru" 0 "ru" "$PROFILE" -C "$AUCTION" --field language.team
    # пароль стенда не должен попадать в аргументы curl: пара идёт через stdin (curl -K -)
    check "auction production_check: no -u in args" 1 "" bash -c "'$PROFILE' -C '$AUCTION' --field deploy.production_check | grep -q -- ' -u '"
    check "auction production_check: curl -K - and pipefail" 0 "" bash -c "c=\$('$PROFILE' -C '$AUCTION' --field deploy.production_check) && [[ \$c == 'set -o pipefail;'* && \$c == *'curl -K -'* ]]"
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

ATAKAMA=/Users/alexey/Work/Atakama
if [ -d "$ATAKAMA/Atakama-Browser-Server" ]; then
    for r in Atakama-Browser-Extension Atakama-Browser-Server Atakama-Browser-Shared; do
        check "atakama $r --name" 0 "atakama" "$PROFILE" -C "$ATAKAMA/$r" --name
    done
    check "atakama --field parallel" 0 "single" "$PROFILE" -C "$ATAKAMA/Atakama-Browser-Server" --field parallel
    check "atakama --field workflow.finish" 0 "local-green" "$PROFILE" -C "$ATAKAMA/Atakama-Browser-Server" --field workflow.finish
    check "atakama language.reports ru" 0 "ru" "$PROFILE" -C "$ATAKAMA/Atakama-Browser-Server" --field language.reports
    check "atakama language.team en" 0 "en" "$PROFILE" -C "$ATAKAMA/Atakama-Browser-Server" --field language.team
    check "atakama --field lessons" 0 "profile" "$PROFILE" -C "$ATAKAMA/Atakama-Browser-Shared" --field lessons
    check "atakama --field layout.repos (3 repos)" 0 '"Atakama-Browser-Shared"' "$PROFILE" -C "$ATAKAMA/Atakama-Browser-Extension" --field layout.repos
    check "atakama workspace root (not git) -> atakama" 0 "atakama" "$PROFILE" -C "$ATAKAMA" --name
    check "atakama workspace root _resolved.workspace" 0 "$ATAKAMA" "$PROFILE" -C "$ATAKAMA" --field _resolved.workspace
    check "atakama repo _resolved.workspace null" 0 "null" "$PROFILE" -C "$ATAKAMA/Atakama-Browser-Server" --field _resolved.workspace
    check "atakama workspace briefing names workspace" 0 "workspace: $ATAKAMA" "$PROFILE" -C "$ATAKAMA"
    check "atakama --rules" 0 "## Обязательное чтение исполнителя" "$PROFILE" -C "$ATAKAMA" --rules
    if [ -d "$ATAKAMA/flux-config-platform" ]; then
        check "atakama: unregistered flux-config-platform -> 3" 3 "" "$PROFILE" -C "$ATAKAMA/flux-config-platform" --name
    fi
    check "parent of two profiles (/Users/alexey/Work) -> 3" 3 "" "$PROFILE" -C /Users/alexey/Work
else
    echo "skip live Atakama checks: $ATAKAMA missing"
fi

# --- регистр букв в пути: на нечувствительной к регистру ФС (APFS по умолчанию) ---------------
# /users/alexey/work/... — тот же каталог, что /Users/alexey/Work/...; резолвер и profile должны
# узнавать его, а не отвечать «не зарегистрирован».
RES="$HOME/.claude/hooks/gate-resolve.mjs"
if [ -d "$AUCTION" ] && [ -d "$(printf '%s' "$AUCTION" | tr '[:upper:]' '[:lower:]')" ]; then
    lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
    check "case-insensitive FS: resolver --which lowercased Auction" 0 "auction"$'\t'"$AUCTION" node "$RES" --which "$(lc "$AUCTION")/apps"
    check "case-insensitive FS: profile -C lowercased Auction" 0 "auction" "$PROFILE" -C "$(lc "$AUCTION")/apps" --name
    if [ -d "$ATAKAMA" ]; then
        check "case-insensitive FS: profile -C lowercased Atakama workspace" 0 "atakama" "$PROFILE" -C "$(lc "$ATAKAMA")" --name
    fi
else
    echo "skip case-insensitive checks: case-sensitive filesystem or no Auction"
fi

# --- синтетика ---------------------------------------------------------------------
T="$(mktemp -d)"
T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T" /tmp/profile-test-err.$$' EXIT
mkdir -p "$T/repo/sub" "$T/profiles/demo" "$T/plain" "$T/repo2"
git -C "$T/repo" init -q -b main
git -C "$T/repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$T/repo" worktree add -q --detach "$T/elsewhere-wt" 2>/dev/null
git -C "$T/repo2" init -q -b main
printf '{"schema":1,"name":"demo","language":"en","commands":{"test":"make test"},"parallel":"single","modules":{"heavy":{"pkg/a":2}},"tests":{"globs":["*_test.go"]}}\n' >"$T/profiles/demo/profile.json"
printf '# demo rules\n' >"$T/profiles/demo/rules.md"
cat >"$T/config.json" <<EOF
{"repos":[
 {"key":"demo","match":"$T/repo","profile":"demo"},
 {"key":"noprof","match":"$T/repo2"}
]}
EOF
export CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/profiles"
check "synthetic root --field" 0 "make test" "$PROFILE" -C "$T/repo" --field commands.test
# старая форма language — строка: читается как {reports, team} с одним языком
check "legacy string language -> language.team" 0 "en" "$PROFILE" -C "$T/repo" --field language.team
check "legacy string language -> language.reports" 0 "en" "$PROFILE" -C "$T/repo" --field language.reports
check "synthetic modules.heavy" 0 '"pkg/a": 2' "$PROFILE" -C "$T/repo" --field modules.heavy
check "synthetic tests.globs" 0 '"*_test.go"' "$PROFILE" -C "$T/repo" --field tests.globs
check "synthetic absent github.account -> 4" 4 "" "$PROFILE" -C "$T/repo" --field github.account
check "synthetic absent modules.deep -> 4" 4 "" "$PROFILE" -C "$T/repo" --field modules.deep
check "worktree outside match prefix" 0 "demo" "$PROFILE" -C "$T/elsewhere-wt" --name
check "worktree flagged" 0 "true" "$PROFILE" -C "$T/elsewhere-wt" --field _resolved.in_worktree
check "root not flagged" 0 "false" "$PROFILE" -C "$T/repo" --field _resolved.in_worktree
check "unregistered dir -> 3" 3 "" "$PROFILE" -C "$T/plain"
# -C <каталог> разрешает так, будто profile запущен из <каталога>, независимо от cwd
check "-C from unregistered cwd" 0 "demo" bash -c "cd '$T/plain' && '$PROFILE' -C '$T/repo' --name"
check "-C relative to cwd" 0 "demo" bash -c "cd '$T' && '$PROFILE' -C repo/sub --name"
check "-C overrides registered cwd -> 3" 3 "" bash -c "cd '$T/repo' && '$PROFILE' -C '$T/plain' --name"
check "-C subdir == cd subdir (--json)" 0 "" bash -c "a=\$(cd '$T/repo/sub' && '$PROFILE' --json) && b=\$(cd / && '$PROFILE' -C '$T/repo/sub' --json) && [ \"\$a\" = \"\$b\" ]"
check "-C worktree from other cwd" 0 "true" bash -c "cd '$T/plain' && '$PROFILE' -C '$T/elsewhere-wt' --field _resolved.in_worktree"
check "-C after mode flag" 0 "make test" "$PROFILE" --field commands.test -C "$T/repo"
check "-C empty -> 2" 2 "" "$PROFILE" -C ""
check "-C without value -> 2" 2 "" "$PROFILE" -C
check "-C file, not dir -> 2" 2 "" "$PROFILE" -C "$T/config.json"
check "registered without profile -> 3" 3 "" "$PROFILE" -C "$T/repo2"
check "no such dir -> 2" 2 "" "$PROFILE" -C "$T/nope"
check "unknown flag -> 2" 2 "" "$PROFILE" --bogus
check "two modes -> 2" 2 "" "$PROFILE" --json --dir
check "--field without path -> 2" 2 "" "$PROFILE" --field
rm "$T/profiles/demo/profile.json"
check "profile dir missing file -> 3" 3 "" "$PROFILE" -C "$T/repo"
echo '{broken' >"$T/profiles/demo/profile.json"
check "broken profile.json -> 1" 1 "" "$PROFILE" -C "$T/repo"

# общий каталог (workspace): родитель всех репозиториев одного профиля, сам не repo
mkdir -p "$T/ws/a" "$T/ws/b" "$T/ws/notes" "$T/ws/c" "$T/profiles/multi" "$T/profiles/multi2" "$T/mixed/x" "$T/mixed/y" "$T/mixed/z"
for d in ws/a ws/b ws/c mixed/x mixed/y mixed/z; do git -C "$T/$d" init -q -b main; done
printf '{"schema":1,"name":"multi","commands":{"test":"yarn test"}}\n' >"$T/profiles/multi/profile.json"
printf '{"schema":1,"name":"multi2"}\n' >"$T/profiles/multi2/profile.json"
printf '{"schema":1,"name":"demo"}\n' >"$T/profiles/demo/profile.json"
printf '{"repos":[{"key":"a","match":"%s","profile":"multi"},{"key":"b","match":"%s","profile":"multi"},{"key":"x","match":"%s","profile":"multi2"},{"key":"y","match":"%s","profile":"multi2"},{"key":"z","match":"%s","profile":"demo"}]}\n' \
    "$T/ws/a" "$T/ws/b" "$T/mixed/x" "$T/mixed/y" "$T/mixed/z" >"$T/ws.json"
export CLAUDE_GATE_CONFIG="$T/ws.json"
check "workspace root -> profile" 0 "multi" "$PROFILE" -C "$T/ws" --name
check "workspace non-git subdir -> profile" 0 "multi" "$PROFILE" -C "$T/ws/notes" --name
# чужой git-репозиторий в общем каталоге, которого нет в реестре, — не проект профиля (код 3);
# профиль общего каталога получают только каталоги вне git
check "workspace: unregistered git repo inside -> 3" 3 "" "$PROFILE" -C "$T/ws/c" --name
mkdir -p "$T/ws/c/deep"
check "workspace: subdir of unregistered git repo -> 3" 3 "" "$PROFILE" -C "$T/ws/c/deep" --name
check "workspace: gate_key null" 0 "null" "$PROFILE" -C "$T/ws" --field _resolved.gate_key
check "workspace: in_worktree false at workspace root" 0 "false" "$PROFILE" -C "$T/ws" --field _resolved.in_worktree
check "registered repo inside workspace: own key" 0 "a" "$PROFILE" -C "$T/ws/a" --field _resolved.gate_key
check "parent holding another profile's repo -> 3" 3 "" "$PROFILE" -C "$T/mixed"
check "parent of the workspace -> 3" 3 "" "$PROFILE" -C "$T"
# общий каталог сам стал git-репозиторием (git init в нём): он и его каталоги вне вложенных
# репозиториев — по-прежнему workspace; незарегистрированный вложенный репозиторий — код 3
git -C "$T/ws" init -q -b main
check "workspace root that is itself git -> profile" 0 "multi" "$PROFILE" -C "$T/ws/notes" --name
check "workspace root that is git: nested foreign repo -> 3" 3 "" "$PROFILE" -C "$T/ws/c" --name
rm -rf "$T/ws/.git"
# match с хвостовым слешем резолвер не находит; workspace это не маскирует — код 3, как раньше
printf '{"repos":[{"key":"a","match":"%s/","profile":"multi"},{"key":"b","match":"%s","profile":"multi"}]}\n' "$T/ws/a" "$T/ws/b" >"$T/ws-slash.json"
check "match with trailing slash stays 3" 3 "" env CLAUDE_GATE_CONFIG="$T/ws-slash.json" "$PROFILE" -C "$T/ws/a" --name
unset CLAUDE_GATE_CONFIG CLAUDE_PROFILES_DIR
check "live registry: unregistered dir -> 3" 3 "" "$PROFILE" -C "$T/plain"

echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
