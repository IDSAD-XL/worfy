#!/usr/bin/env bash
# Тесты ~/.claude/bin/preflight вне Auction. Запуск: bash harness/bin/tests/preflight.test.sh;
# код выхода 0 — всё прошло.
#
# Реестр и профили — временные (CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR, их понимает bin/profile).
# Поведение на Auction проверяется сравнением с прошлым выводом, а не здесь: оно зависит от
# живого origin/main.
set -u
# The scripts under test are the copies next to this test (harness/); BIN_DIR and HOOKS_DIR
# point it at another copy.
HARNESS="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN_DIR:-$HARNESS/bin}"
HOOKS="${HOOKS_DIR:-$HARNESS/hooks}"
PF="$BIN/preflight"
export CLAUDE_GATE_RESOLVE="$HOOKS/gate-resolve.mjs"
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }

export CLAUDE_GATE_CONFIG="$T/config.json" CLAUDE_PROFILES_DIR="$T/profiles"
mkdir -p "$T/nogit" "$T/unreg" "$T/reg" "$T/profiles/t"
git -C "$T/unreg" init -q && git -C "$T/unreg" commit -q --allow-empty -m init
# Зарегистрированный проект без ADR, миграций и эпиков, с origin в локальном bare-репозитории.
git init -q --bare "$T/origin.git"
git -C "$T/reg" init -q -b main && git -C "$T/reg" commit -q --allow-empty -m init
git -C "$T/reg" remote add origin "$T/origin.git" && git -C "$T/reg" push -q origin main 2>/dev/null
git -C "$T/reg" fetch -q origin
printf '{"repos":[{"key":"t","match":"%s","profile":"t","pm":"npm"}]}\n' "$T/reg" >"$CLAUDE_GATE_CONFIG"
printf '{"schema":1,"name":"t","worktree":{"base":"origin/main"},"numbering":{"adr":null,"migrations":null},"docs":{"adr_dir":null},"tickets":{"epic_status":null}}\n' \
    >"$T/profiles/t/profile.json"
: >"$T/profiles/t/rules.md"

# 1. Незарегистрированный git-репозиторий: ошибка вызова, код 2, понятное сообщение.
err="$(cd "$T/unreg" && bash "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"проект не зарегистрирован"* ]] && ok "unregistered repo -> exit 2 + message" \
    || bad "unregistered repo: exit $rc, err: ${err:0:300}"

# 1a. Незарегистрированный git-репозиторий внутри общего каталога профиля (рядом два
# репозитория профиля, сам в реестре не записан): тоже «не зарегистрирован», а не профиль соседей.
mkdir -p "$T/ws/a" "$T/ws/b" "$T/ws/foreign" "$T/profiles/w"
for d in a b foreign; do git -C "$T/ws/$d" init -q -b main && git -C "$T/ws/$d" commit -q --allow-empty -m init; done
printf '{"schema":1,"name":"w"}\n' >"$T/profiles/w/profile.json"
printf '{"repos":[{"key":"a","match":"%s","profile":"w"},{"key":"b","match":"%s","profile":"w"}]}\n' "$T/ws/a" "$T/ws/b" >"$T/ws.json"
err="$(cd "$T/ws/foreign" && CLAUDE_GATE_CONFIG="$T/ws.json" bash "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"проект не зарегистрирован"* ]] && ok "unregistered repo inside a workspace -> exit 2" \
    || bad "foreign repo in workspace: exit $rc, err: ${err:0:300}"

# 2. Не git-каталог — тоже код 2.
err="$(cd "$T/nogit" && bash "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"не git-репозиторий"* ]] && ok "non-git dir -> exit 2" || bad "non-git dir: exit $rc, err: ${err:0:200}"

# 3. Зарегистрированный проект без ADR/миграций/эпиков: шаги пропущены строкой, итог GO.
out="$(cd "$T/reg" && CLAUDE_SESSION_ID= bash "$PF" --no-fetch 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ "$(printf '%s\n' "$out" | tail -1)" = GO ] \
   && [[ "$out" == *"ADR: каталога ADR в профиле нет"* ]] && [[ "$out" == *"migrations: журнала миграций в профиле нет"* ]] \
   && [[ "$out" == *"сводки эпиков в профиле нет"* ]] && [[ "$out" == *"origin/main: "* ]]; then
    ok "registered, no numbering -> steps skipped aloud, GO exit 0"
else bad "registered no numbering: exit $rc, out: ${out:0:600}"; fi

# 4. Тот же проект с --epic, но без tickets.epic_status — эпик не проверить: BLOCKED, код 1.
out="$(cd "$T/reg" && CLAUDE_SESSION_ID= bash "$PF" --no-fetch --epic x 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$(printf '%s\n' "$out" | tail -1)" == "BLOCKED: "*"эпик x не проверить"* ]] \
    && ok "--epic without epic_status -> BLOCKED exit 1" || bad "--epic without tool: exit $rc, out: ${out:0:400}"

# 5. Сломанный профиль (невалидный JSON) — код 2, не GO.
printf '{broken' >"$T/profiles/t/profile.json"
err="$(cd "$T/reg" && bash "$PF" --no-fetch 2>&1 >/dev/null)"; rc=$?
[ "$rc" -eq 2 ] && [[ "$err" == *"профиль не читается"* ]] && ok "broken profile -> exit 2" || bad "broken profile: exit $rc, err: ${err:0:200}"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
