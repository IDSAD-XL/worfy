# 61 — Run не считает живую долгую фоновую задачу зависшей

Type: task
Status: open
Blocked by: —
Source: приёмка [worfy-windows 16](../../worfy-windows/issues/16-приёмка-worfy-windows.md), пункт 9

## Что происходит

- На Windows-ПК владельца 2026-11-06 Run Autopilot `2026-11-06T11-47-32-575Z-bc80b1` (Epic worfy-polish, Ticket 48)
  остановился в 16:15:10Z событием `run-stopped` с причиной `background-stalled`.
- В этот момент его единственная background task (работа, которую Session запустила и не ждёт в своём ходе) — «Run
  full gate on main merge commit», gate full с `GATE_SCOPE=all`, начата около 15:14Z — была жива и шла на шаге e2e.
- Gate full на Windows идёт дольше часа: в тот день — 3725 s.
- Причина: Run считает background task зависшей, если за `BACKGROUND_STALL_MS` = 60 min от неё не пришло ни одного
  события (`src/shared/autopilot/cycle.ts:80`, [ADR-0029](../../../docs/adr/0029-autopilot-waits-for-background-tasks.md)).
  Одна долгая task, которая молча работает, событий не шлёт и выглядит так же, как зависшая.
- [worfy-autopilot-queue 08](../../worfy-autopilot-queue/issues/08-остановка-ошибкой-сразу-отдаёт-session.md)
  (PR #1512, в review) после такой остановки отдаёт Session на месте, не перезапуская её. Это смягчает последствия,
  но не убирает ложную остановку.

## Что делаем

1. Отличить живую долгую task от зависшей. Варианты для implementer-а — выбрать с доказательством в «Итог»:
   - признак жизни от самой task: растёт её output file, жив её процесс или дерево процессов;
   - или Wave запускает gate full не одной молчащей task, а так, чтобы события шли (например, по шагам).
2. Просто поднять `BACKGROUND_STALL_MS` — не решение: зависшая task тогда держит Run ещё дольше.
3. Зависшая task (нет ни событий, ни признака жизни) по-прежнему останавливает Run с `background-stalled`.
4. Если меняется правило ADR-0029 — новый ADR или правка в нём, и `docs/features/autopilot.md` с переводом.

Глубина review — `medium`. Платформенный, если признак жизни читает процессы ОС: Windows-часть — на ПК.

## Готово, когда

- [ ] Contract test: task без событий дольше `BACKGROUND_STALL_MS`, но с признаком жизни — Run ждёт и не
      останавливается. До правки — красный (`background-stalled`).
- [ ] Contract test: task без событий и без признака жизни дольше `BACKGROUND_STALL_MS` — Run останавливается с
      `background-stalled`, как раньше.
- [ ] Все unit и contract test-ы `src/shared/autopilot/` и `src/main/autopilot/`, `pnpm typecheck`, `pnpm lint`,
      gate fast — exit 0.

## Где в коде

- `src/shared/autopilot/cycle.ts:80` — `BACKGROUND_STALL_MS`; причина `background-stalled` — `:62`.
- `src/main/autopilot/run.ts` — ожидание background task-ов Run-а.
- `docs/adr/0029-autopilot-waits-for-background-tasks.md`
