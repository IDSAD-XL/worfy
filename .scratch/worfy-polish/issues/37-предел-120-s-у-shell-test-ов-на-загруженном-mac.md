# 37 — Предел 120 s у shell-test-ов на загруженном Mac

Type: task
Status: open
Blocked by: —
Source: gate full на Mac перед мержем PR #725, #705, #727, #728 (2026-10-22, ночь): красный только на
shell-test-ах `harness/bin/tests/`, отдельно они зелёные. Продолжение
[32](32-wave-gate-test-sh-дольше-предела-harness-scripts-под-нагрузкой.md) (тот же предел, замер 2026-10-18).
Строки — по main `b1700b18`.

## Что происходит

`test/contract/harness-scripts.test.ts` запускает каждый `harness/**/tests/*.test.sh` отдельным процессом с
пределом `FILE_TIMEOUT_MS` (`:37`): 120 s на Mac, 900 s на Windows. Под полным `pnpm test`, пока на Mac работают
другие агенты, этого предела не хватает:

- **`harness/bin/tests/wave-gate.test.sh`.** Один на Mac — 68–93 s; при load average 24–35 — 131 s. В полном
  `pnpm test` его убивает предел 120 s (`× bin/tests/wave-gate.test.sh exits 0 with an empty HOME 120006ms`).
  После PR #705 он уже разделён: случаи замка e2e ушли в `wave-gate-lock.test.sh`, общая подготовка — в
  `wave-gate-world.sh`.
- **`harness/bin/tests/wave-gate-heartbeat.test.sh`.** Красный в gate full PR #725 (10,7 s, не по пределу). Под
  нагрузкой в 1 из 40 запусков на zsh после него остался процесс `sleep` heartbeat-а. Отдельно — 3 из 3 зелёные.
  Это не предел, а остаток процесса; почему он остаётся только под нагрузкой — не выяснено.

Gate full на Mac был красным только из-за этого на PR #725, #705, #727, #728 (2026-10-22). Каждый такой красный —
повтор gate full (7–11 min) или мерж с объяснением, почему красный не от PR.

## Что делаем

Решения нет. Взвесить варианты и записать выбор с замером:

1. **Разбить дальше.** `wave-gate.test.sh` (771 строка) — ещё на файлы по разделам: у каждого файла свой предел.
   Цена: подготовка (`wave-gate-world.sh`) идёт в каждом файле заново.
2. **Ускорить медленные случаи.** Сначала замерить по разделам, как в 32 («Итог», «Где уходило время»):
   какие `sleep` проверяют сам механизм, а какие просто ждут.
3. **Поднять предел на Mac с замеренной ценой.** Как для Windows в PR #705: комментарий рядом с
   `FILE_TIMEOUT_MS` называет, на сколько позже обрывается зависший `.test.sh`.
4. **Запускать shell-test-ы по одному.** Цена — время `pnpm test` целиком; замерить.

Отдельно: остаток `sleep` в `wave-gate-heartbeat.test.sh` — найти, кто не дожидается heartbeat-а, или записать,
почему это не дефект `harness/bin/wave-gate`.

## Готово, когда

- [ ] Выбор из вариантов выше записан в «Итог» с замером: время файла один и под нагрузкой (load average 20+),
      до и после.
- [ ] Под полным `pnpm test` при load average 20+ — 3 прогона из 3 без падения shell-test-ов по пределу.
- [ ] Остаток `sleep` в `wave-gate-heartbeat.test.sh`: причина записана; если это дефект — правка и test,
      красный до неё.
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0; на Windows предел 900 s не меняется без отдельного замера.

## Где в коде

- `test/contract/harness-scripts.test.ts:37` — `FILE_TIMEOUT_MS`; комментарий выше — история пределов Windows.
- `harness/bin/tests/wave-gate.test.sh`, `harness/bin/tests/wave-gate-lock.test.sh`,
  `harness/bin/tests/wave-gate-world.sh`, `harness/bin/tests/wave-gate-heartbeat.test.sh`.

## Итог
