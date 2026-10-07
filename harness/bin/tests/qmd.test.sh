#!/usr/bin/env bash
# Тесты qmd-sync-main и qmd-refresh на временных каталогах (сеть не нужна: origin — локальный bare).
#   - qmd-sync-main: копия, которая не корень своего репозитория, — отказ без fetch/checkout;
#   - qmd-refresh: один битый профиль / одна пропавшая копия не останавливают прогон —
#     qmd update всё равно зовётся; с --quiet (Stop-хук) код 0, без --quiet — 1.
# Запуск: bash harness/bin/tests/qmd.test.sh; код выхода 0 — всё прошло.
# BIN_DIR — прогнать тест на другой копии скриптов.
set -u
BIN="${BIN_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"   # the scripts next to this test (harness/bin)
T="$(mktemp -d)"; T="$(cd "$T" && pwd -P)"
trap 'rm -rf "$T"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; }
gq() { git -c user.email=t@t -c user.name=t "$@"; }

# --- 5. qmd-sync-main: копия должна быть корнем своего репозитория ------------------
gq init -q --bare -b main "$T/origin.git"
gq clone -q "$T/origin.git" "$T/seed" 2>/dev/null
gq -C "$T/seed" commit -q --allow-empty -m one && gq -C "$T/seed" push -q origin HEAD:main 2>/dev/null
gq clone -q "$T/origin.git" "$T/outer" 2>/dev/null
gq -C "$T/seed" commit -q --allow-empty -m two && gq -C "$T/seed" push -q origin HEAD:main 2>/dev/null
mkdir -p "$T/outer/sub"
printf '{"repos":[{"key":"x","match":"%s","profile":"x"}]}\n' "$T/outer" >"$T/config.json"
printf '#!/bin/sh\necho %s\n' "'{\"name\":\"x\",\"worktree\":{\"base\":\"origin/main\"}}'" >"$T/profile"
chmod +x "$T/profile"
before="$(git -C "$T/outer" rev-parse HEAD) $(git -C "$T/outer" symbolic-ref -q HEAD)"
out="$(CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile" QMD_SYNC_MARK="$T/mark" \
    QMD_SYNC_COPY="$T/outer/sub" zsh "$BIN/qmd-sync-main" x 2>&1)"; rc=$?
after="$(git -C "$T/outer" rev-parse HEAD) $(git -C "$T/outer" symbolic-ref -q HEAD)"
[ "$before" = "$after" ] && ok "sync: copy inside another repo -> enclosing repo untouched" \
    || bad "sync: enclosing repo changed: $before -> $after"
[ -s "$T/mark" ] && grep -q "не корень" "$T/mark" && [[ "$out" == *"SYNC FAILED"* ]] \
    && ok "sync: refusal leaves marker + loud message" || bad "sync refusal: rc=$rc out=${out:0:200}"
rm -f "$T/mark"
# Регрессия: настоящая копия (корень) подтягивается.
out="$(CLAUDE_GATE_CONFIG="$T/config.json" QMD_SYNC_PROFILE_BIN="$T/profile" QMD_SYNC_MARK="$T/mark" \
    QMD_SYNC_COPY="$T/outer" zsh "$BIN/qmd-sync-main" x 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && [ ! -e "$T/mark" ] && [ "$(git -C "$T/outer" rev-parse HEAD)" = "$(git -C "$T/seed" rev-parse HEAD)" ] \
    && ok "sync: real copy root -> fetched and checked out" || bad "sync real copy: rc=$rc out=${out:0:200}"

# --- 6. qmd-refresh: частичный сбой не останавливает прогон ------------------------
H="$T/home"; mkdir -p "$H/.cache/qmd" "$T/fakebin" "$T/mem"
echo note >"$T/mem/a.md"
cat >"$T/fakebin/qmd" <<EOF
#!/bin/sh
echo "\$1" >>"$T/qmd.calls"
EOF
cat >"$T/sync" <<EOF
#!/bin/sh
[ "\$1" = --describe ] || exit 0
case "\$2" in
  good)    printf '%s\tmain\t\n' "$T/outer" ;;
  missing) printf '%s\tmain\t\n' "$T/no-such-copy" ;;
  *)       echo "профиля \$2 нет в реестре"; exit 1 ;;
esac
EOF
chmod +x "$T/fakebin/qmd" "$T/sync"
cat >"$T/index.yml" <<EOF
collections:
  bad:
    path: $T/x
    update: /x/qmd-sync-main bad
  missing:
    path: $T/y
    update: /x/qmd-sync-main missing
  good:
    path: $T/outer
    update: /x/qmd-sync-main good
  memory:
    path: $T/mem
EOF
run_refresh() {
    HOME="$H" PATH="$T/fakebin:$PATH" QMD_INDEX_YML="$T/index.yml" QMD_REFRESH_SYNC="$T/sync" \
        zsh "$BIN/qmd-refresh" --wait "$@" 2>&1
}
rm -f "$T/qmd.calls"
out="$(run_refresh --quiet)"; rc=$?
[ "$rc" -eq 0 ] && ok "refresh --quiet (Stop hook): bad profile + missing copy -> exit 0" || bad "refresh --quiet: rc=$rc out=${out:0:200}"
grep -qx update "$T/qmd.calls" 2>/dev/null && ok "refresh --quiet: qmd update still ran" || bad "refresh --quiet: qmd update not called"
grep -q "профиль bad не разобран" "$H/.cache/qmd/refresh.log" 2>/dev/null && ok "refresh --quiet: warning logged" || bad "refresh --quiet: no warning in log"
rm -f "$T/qmd.calls" "$H/.cache/qmd/last-index"
out="$(run_refresh)"; rc=$?
[ "$rc" -eq 1 ] && [[ "$out" == *"профиль bad не разобран"* ]] && [[ "$out" == *"no-such-copy"* ]] \
    && ok "refresh (manual): warns about both, exit 1 (partial failure)" || bad "refresh manual: rc=$rc out=${out:0:300}"
grep -qx update "$T/qmd.calls" 2>/dev/null && ok "refresh (manual): qmd update still ran" || bad "refresh manual: qmd update not called"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
