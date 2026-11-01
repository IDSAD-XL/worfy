# 02 — Длительность Wave

Type: task
Status: done 2026-11-01T11:06Z
PR: #1212
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

- [x] Unit test: Wave 40 минут без ожиданий — 40 минут; Wave с `limits-hit` 10:00 → `resumed` 12:00 внутри — минус
      2 часа; ожидание без `resumed` — до `wave-finished`; Wave без `wave-finished` — нет выборки; две Wave в разных Run.
- [x] Unit test: 4 выборки — `p90: null`; 10 выборок 1…10 минут — p90 9 минут (nearest-rank); 12 выборок — берутся 10
      последних.
- [x] Test-ы краснеют на mutant-ах: ожидания не вычитаются; порог 5 → 4; берутся первые 10, а не последние.
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

## Итог

- `src/shared/autopilot/wave-duration.ts` (новый, чистый, без Node и DOM): `DURATION_WAVES` = 10 (`:18`),
  `DURATION_MIN_SAMPLES` = 5 (`:20`). `waveDurations(runs)` (`:43`) — длительности в ms 10 последних Wave по
  времени `wave-finished`, старшая первой: от `wave-started` до `wave-finished` того же номера в одном Run минус
  ожидания Limits внутри пары (`limits-hit` … `resumed`; не закрытое — до `wave-finished`). `waveDurationP90(runs)`
  (`:72`) — `{ p90, samples }`, p90 через `percentile` Ticket-а 01; меньше 5 выборок — `p90: null` («мало данных о
  длительности»). Время — `at` строк со смещением, поэтому смена часов (DST) и полночь длительность не искажают.
- `src/main/autopilot/run.ts` (ревью, раунд 1, medium): ход, который прошёл без отказа во время ожидания Limits
  (ход человека, уведомление фоновой задачи), закрывал ожидание молча (`LimitsWait.passed()`), без строки в Journal —
  модуль считал бы остаток Wave ожиданием. Теперь в этом случае Run пишет `resumed` перед чтением Ticket-ов
  (`onEvent`, ветка `result`). Ход без открытого ожидания `resumed` не пишет.
- Решено без владельца, подтверждено владельцем 2026-11-01:
  1. Второй `limits-hit` при открытом ожидании ожидание не перезапускает: оно идёт от первого.
  2. Ожидание, начатое до `wave-started` (Run так не пишет, но Journal может), из Wave не вычитается — вычитается
     только ожидание, начатое внутри пары. `resumed` без открытого ожидания ничего не вычитает.
  3. `wave-started` при открытой Wave без `wave-finished` бросает прежнюю: она выборки не даёт, её открытое ожидание
     в новую Wave не переходит. `wave-finished` другого номера, чем открытая Wave, выборки не даёт и закрывает её;
     повторный `wave-finished` даёт одну выборку.
  4. Ответ `waveDurationP90` — `{ p90: number | null, samples: number }`, длительности в миллисекундах.
  5. Строки, время которых идёт назад (часы перевели назад), и выборка меньше 0 — выборки нет: ни отрицательная, ни
     обрезанная до 0 выборка не тянет p90 вниз. Выборка ровно 0 остаётся.
- Test-ы. `test/unit/autopilot-wave-duration.test.ts` — 32 test-а; строки fixture-ов проходят `journalEventSchema`.
  Сначала падали test-ы ожиданий Limits и порядка по концу Wave (заготовка без вычитания и сортировки: 6 из 26
  красные). `test/contract/autopilot-limits.test.ts`: test хода человека во время ожидания теперь требует
  `resumed` сразу после хода, до срабатывания таймера; test позднего таймера — ровно один `resumed`.
- Долг [low] из ревью #1212: `test/contract/autopilot-limits.test.ts:618-621` ждёт `running` до того, как
  дописан `resumed`.
- Mutant-ы, прогнаны скриптами на файлах, test красный на каждом. Модуль (20 из 20): ожидания не вычитаются;
  ожидание без `resumed` не закрывается на `wave-finished`; порог 5 → 4; `<` → `<=`; берутся первые 10; без
  сортировки; сортировка по началу Wave; `DURATION_WAVES` 10 → 11; p90 → p50; p90 → p85 (7 выборок); второй
  `limits-hit` перезапускает ожидание; `resumed` без открытого ожидания; без проверки номера Wave; открытая Wave
  переходит в следующий Run; ожидание прежней Wave переходит в новую; Wave не закрывается после `wave-finished`;
  время по стенным часам без смещения; ожидание вне Wave вычитается; отрицательная выборка остаётся; выборка 0
  отбрасывается. `run.ts` (3 из 3): без записи `resumed` в ходе, который прошёл; `resumed` пишется всегда;
  открытость ожидания проверяется после `passed()`.
- Оценка автора: около 150 тысяч token-ов (с раундом ревью).
