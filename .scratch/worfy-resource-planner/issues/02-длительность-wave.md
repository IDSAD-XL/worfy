# 02 — Длительность Wave

Type: task
Status: open
Branch: worfy-resource-planner/02
Blocked by: 01
Source: [spec.md](../spec.md), «Решения» (Q11, Q12), «Прогноз Epic-а» («Длительность Wave»), «Не решено» (выбрано без решения, п. 5); [ADR-0093](../../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md), п. 3, 4

## Что происходит

- Journal Run-а хранит `wave-started` и `wave-finished` с номером Wave и временем, ожидания Limits — `limits-hit`,
  `waiting-until`, `resumed` (`src/shared/autopilot/journal.ts:220`, схема `:309`).
- Ожидание budget (`budget-stop` … `resumed`) внутрь пары `wave-started` … `wave-finished` не попадает: оно решается
  до «Run wave» (`src/main/autopilot/run.ts:1206-1207`), а `wave-started` пишется после него (`:1094`). Так же будет и
  с ожиданием окна Ticket-а 05. Внутри Wave бывают только ожидания Limits.
- Длительность Wave никто не считает; окно запуска (Ticket 05) не может решить, успеет ли Wave.
- `percentile` (nearest-rank) — в `src/shared/autopilot/forecast.ts` (Ticket 01).

## Что делаем

Новый чистый модуль `src/shared/autopilot/wave-duration.ts`.

1. `waveDurations(runs)` — по каждому Run: для пары `wave-started` … `wave-finished` одного номера — разница `at`
   минус ожидания Limits внутри неё: от `limits-hit` до `resumed`; ожидание без `resumed`
   до `wave-finished` — до него. Wave без `wave-finished` (Run оборвался, Force stop) выборки не даёт. Ход «Process
   gate queue» — не Wave.
2. 10 последних выборок по времени конца (`DURATION_WAVES = 10`).
3. `waveDurationP90(runs)` — p90 через `percentile` Ticket-а 01 и число выборок; меньше 5
   (`DURATION_MIN_SAMPLES = 5`) — `p90: null` («мало данных о длительности»).

## Готово, когда

- [ ] Unit test: Wave 40 минут без ожиданий — 40 минут; Wave с `limits-hit` 10:00 → `resumed` 12:00 внутри — минус
      2 часа; ожидание без `resumed` — до `wave-finished`; Wave без `wave-finished` — нет выборки; две Wave в разных Run.
- [ ] Unit test: 4 выборки — `p90: null`; 10 выборок 1…10 минут — p90 9 минут (nearest-rank); 12 выборок — берутся 10
      последних.
- [ ] Test-ы краснеют на mutant-ах: ожидания не вычитаются; порог 5 → 4; берутся первые 10, а не последние.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/autopilot-wave-duration.test.ts` (новый).
- Сначала падающий: Wave с ожиданием Limits внутри.
- Прогнать `test/unit/autopilot-forecast.test.ts`, `test/unit/autopilot-journal.test.ts`.

## Где в коде

- `src/shared/autopilot/wave-duration.ts` (новый)
- `test/unit/autopilot-wave-duration.test.ts` (новый)

Только читать: `src/shared/autopilot/journal.ts` (виды `:220`, схема `:309`), `src/shared/autopilot/forecast.ts`
(Ticket 01, `percentile`), `src/main/autopilot/run.ts` (`wave-started` `:1094`, ожидание budget `:1206-1207`).
