# 01 — Harness: `timings.json` gate живёт 31 день

Type: task
Status: claimed 2026-11-06T09:47Z
Blocked by: —
Source: [spec.md](../spec.md), «Решения владельца», 4; «Как работает» → «Источники»; [research 04](../../worfy-autopilot-queue/issues/04-данные-work-track.md), «Пробелы», 1, «Рекомендация» (а); [06](../../worfy-autopilot-queue/issues/06-объём-и-доступ-work-track.md), Q2

## Что происходит

- `pruneLogs` (`harness/hooks/gate-log.mjs:51-75`) оставляет 10 последних run-ов worktree (`LOG_RUNS_KEPT`, `:24`) и
  удаляет папку чужого worktree, не тронутую 8 дней (`STALE_MS`, `:25`), со всем содержимым — и с `timings.json`.
- Логи gate на практике покрывают 8–13 дней; за месяц история run-ов gate неполная. `timings.json` весит ~1 KB на run.

## Что делаем

1. `pruneLogs` удаляет выводы скриптов (`<NN>-<label>.log`) по-прежнему, а `timings.json` каждого run-а оставляет 31 день
   по его `at` (новая константа `TIMINGS_KEPT_MS`); папку run-а, где остался только `timings.json`, не удаляет до
   срока; папку worktree — когда в ней не осталось ни одного `timings.json` моложе 31 дня.
2. Шапка модуля — новый срок и причина (Work track читает run-ы gate за месяц).

## Готово, когда

- [ ] `harness/hooks/tests/gate-log.test.sh`: run старше 10-го — выводы удалены, `timings.json` есть; worktree, не тронутый
      9 дней, — выводы удалены, `timings.json` есть; `timings.json` старше 31 дня — удалён вместе с папкой.
  - evidence: test-run pass · `bash harness/hooks/tests/gate-log.test.sh` exit 0 · mac - · 539d5a7e5bc5a7d1536ee76a38dd4af5b274691e
- [ ] Test-ы — с `HOME` и `HARNESS_HOME` во временном каталоге. PR ждёт Windows (ADR-0056); `ci-ok` зелёный.

## Тесты

- Shell test `harness/hooks/tests/gate-log.test.sh`. Сначала падающий: `timings.json` 11-го run-а удалён.

## Где в коде

- `harness/hooks/gate-log.mjs`
- `harness/hooks/tests/gate-log.test.sh`

Только читать: `harness/hooks/gate.mjs`, `src/main/flight-recorder/gate-logs.ts` (зеркало констант правит Ticket 08).
