# 08 — Flight Recorder читает прогноз, факт и Wait окна запуска

Type: task
Status: open
Branch: worfy-resource-planner/08
Blocked by: 05, 07
Source: [spec.md](../spec.md), «Решения» (Q10, Q13), «Journal» (последний абзац), «Что видит пользователь» (Run history); [ADR-0092](../../../docs/adr/0092-run-history.md) (шкала вычисляется при открытии); [ADR-0093](../../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md), п. 3, 6

## Что происходит

- Разбор Journal для шкалы Run (worfy-flight-recorder Ticket 13) — `src/shared/flight-recorder/from-journal.ts`:
  Wait-ы `limits`, `limits-budget` (от `budget-stop` до `resumed`, `:248-249`), `background-tasks`, `gate-queue`
  (шапка `:12-17`); из `run-started` — `by` и `tickets` (`JournalFacts`, `:65-67`).
- Причины Wait — фиксированный список `WAIT_CAUSES` (`src/shared/flight-recorder/facts.ts:25`); итог «Waits by cause»
  складывает по нему (`src/shared/flight-recorder/summary.ts:140`).
- После Ticket-ов 05 и 07 Journal пишет `run-started.mode`, `forecast`, `start-window` и `run-stopped.actual`; разбор их
  не знает: `start-window` … `resumed` сейчас стал бы Wait `limits` по `waiting-until`.

## Что делаем

1. `WAIT_CAUSES` получает `start-window`; `from-journal.ts` открывает Wait `start-window` по строке `start-window`
   (detail — `reason`) и закрывает по `resumed`, как `limits-budget`. Wait, открытый на `run-stopped`, кончается там.
2. `JournalFacts` получает `mode?` (из `run-started`), `forecast?` (`low`, `high`, `waves`, `tickets`, `uncounted`,
   `samples`, `fit`) и `actual?` (`share`, `waves`, `counted`) — как написано, поле чужой формы — отсутствует.
3. Комментарий-таблица источников в `facts.ts` (`:58`) называет новую причину.
4. Экран не меняется: шапку Run показывает Ticket 11 этого Epic-а, после Ticket-а 18 Epic-а `worfy-flight-recorder`.

## Готово, когда

- [ ] Unit test (`test/unit/flight-recorder-journal.test.ts`): `start-window` → `waiting-until` → `resumed` — один Wait
      `start-window` с detail `outside`, не Wait `limits`; открытый на `run-stopped` — кончается там.
- [ ] Unit test: `mode`, `forecast` и `actual` Journal-а test-а доходят до `JournalFacts`; Journal до этого Epic-а —
      полей нет, остальное как раньше; `forecast` чужой формы — поля нет, `skipped` не растёт за счёт остальных строк.
- [ ] Unit test итога (`test/unit/flight-recorder-summary.test.ts`): строка «Waits by cause» для `start-window`.
- [ ] Test-ы краснеют на mutant-ах: `start-window` открывает Wait `limits-budget`; `resumed` не закрывает Wait окна.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/flight-recorder-journal.test.ts`, `test/unit/flight-recorder-summary.test.ts`.
- Сначала падающий: `start-window` даёт Wait `start-window`.
- Прогнать все `test/unit/flight-recorder-*.test.ts` и `test/unit/critical-path.test.ts`.

## Где в коде

- `src/shared/flight-recorder/facts.ts` — `WAIT_CAUSES` `:25`, таблица источников `:58`
- `src/shared/flight-recorder/from-journal.ts` — шапка `:12-17`, `JournalFacts` `:65-67`, `budget-stop` `:248-249`
- `test/unit/flight-recorder-journal.test.ts`, `test/unit/flight-recorder-summary.test.ts`

Только читать: `src/shared/flight-recorder/summary.ts` (`:140`), `src/shared/flight-recorder/spans.ts`,
`src/shared/autopilot/journal.ts` (виды Ticket-ов 05, 07).
