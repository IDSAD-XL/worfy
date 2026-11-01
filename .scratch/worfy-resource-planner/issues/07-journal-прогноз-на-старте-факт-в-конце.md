# 07 — Journal: прогноз на старте Run, факт в конце

Type: task
Status: claimed 2026-11-01T13:08Z
Branch: worfy-resource-planner/07
Blocked by: 01, 03, 05
Source: [spec.md](../spec.md), «Решения» (Q10), «Journal» (`forecast`, `run-stopped.actual`), «Риски», п. 4, «Не решено» (выбрано без решения, п. 9); [ADR-0093](../../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md), п. 6

## Что происходит

- Run пишет `run-started` (`src/main/autopilot/journal.ts:122`), после него — `harness-behind`, если Harness отстал,
  потом Wave-ы; конец — `run-stopped` (`src/main/autopilot/run.ts:1537`). Ни прогноза, ни итоговой доли Limits в
  Journal нет: сравнить их утром не с чем.
- После Ticket-а 05 у Run есть режим (`run-started.mode`), после 01 и 03 — `epicForecast`, `waveGrowth`,
  `fitBeforeReset`.

## Что делаем

1. **Вид `forecast`** — одна строка после `run-started` (и `harness-behind`, если он есть), до первого `wave-started`.
   Поля — spec, «Journal»: `mode`, `waves`, `tickets`, `uncounted`, `samples`, `low`, `high`, `fit`, `week`,
   `durationP90Ms`, `durationSamples`, `window?`. Считает Run из того, что уже читает на старте: модель Epic-а,
   `budget.runs` (Journal-ы Project-а), снимок Limits, Settings. Не прочитались Journal-ы — строка с `samples: 0`,
   `low`/`high`/`fit` — `null`; Run от этого не останавливается.
2. **`run-stopped.actual?`** — `share`, `waves`, `counted`: по строкам Wave этого Run, `waveGrowth` Ticket-а 01 (то же
   правило свежести и сброса, что у выборок). Без законченных Wave поля нет. Force stop и выход из приложения пишут
   его тоже: строки Wave уже в памяти Run, ждать нечего.
3. Шапка формата `src/shared/autopilot/journal.ts`, `JOURNAL_EVENT_KINDS` (`:220`), схема (`:309`), `JOURNAL_KINDS`
   (`src/shared/flight-recorder/journal-walk.mjs:9`). Поле другой формы читается как отсутствующее, строка остаётся.

## Готово, когда

- [x] Unit test Run (`test/unit/autopilot-run.test.ts`): порядок `run-started`, `forecast`, `wave-started`; с отставшим
      Harness — `run-started`, `harness-behind`, `forecast`; поля `forecast` по Journal-ам test-а (5 выборок —
      `low`/`high`, 4 — `null`); Journal-ы не читаются — `samples: 0`, Run идёт.
- [x] Unit test Run: две Wave с ростом 0.04 и 0.06 — `actual.share` 0.10, `waves` 2, `counted` 2; Wave со сбросом недели
      внутри — `waves` 2, `counted` 1; Run без Wave — поля нет; Force stop — поле есть.
- [x] Unit и contract test Journal: `forecast` и `run-stopped.actual` проходят схему; строка до этого Ticket-а читается
      как раньше; `actual` чужой формы — отсутствующее поле.
- [x] `test/unit/critical-path.test.ts:263` зелёный (списки видов равны).
- [x] Test-ы краснеют на mutant-ах: `forecast` после `wave-started`; `actual` считает Wave со сбросом; `low`/`high` при
      4 выборках не `null`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/autopilot-run.test.ts`, `test/unit/autopilot-journal.test.ts`, `test/unit/critical-path.test.ts`.
- Contract `test/contract/autopilot-journal.test.ts`.
- Сначала падающий: порядок `run-started`, `forecast`, `wave-started`.
- Прогнать все unit и contract test-ы модуля Autopilot (spec, «Соглашения»).

## Где в коде

- `src/main/autopilot/run.ts` — `start` `:731`, `run-stopped` `:1537`
- `src/shared/autopilot/journal.ts` — шапка формата, `JOURNAL_EVENT_KINDS` `:220`, схема `:309`
- `src/shared/flight-recorder/journal-walk.mjs` — `JOURNAL_KINDS` `:9`
- `test/unit/autopilot-run.test.ts`, `test/unit/autopilot-journal.test.ts`, `test/contract/autopilot-journal.test.ts`

Только читать: `src/main/autopilot/journal.ts` (`run-started` `:122`, `readRecentRuns` `:205`),
`src/shared/autopilot/forecast.ts`, `forecast-lines.ts` (Ticket-ы 01, 03), `src/shared/autopilot/run-mode.ts` (Ticket-ы 04, 05).

## Итог

- `src/main/autopilot/run.ts`: `journalForecast` пишет `forecast` в `start` сразу после `journalHarness`, то есть
  после `run-started` и `harness-behind` и до того, как в очередь Run встаёт первая Wave. Считается из модели при
  старте (`remainingWaves`, у Run по названным Ticket-ам — только названные), `budget.runs`
  (`waveSamples`, `waveDurationP90`), снимка Limits и Settings (`fitBeforeReset`). Journal-ы не прочитались —
  `samples: 0`, Run идёт; любая ошибка расчёта — без строки, Run идёт. `wave-started` и `wave-finished` Run держит в
  памяти (`waveLine`, `at` — по часам Run, тем же, что у Limits); `countActual` на каждой `wave-finished`
  прибавляет `waves`, а рост по `waveGrowth` — в `share` и `counted`. `end` пишет `run-stopped.actual`, когда
  `waves > 0`; Force stop и выход из приложения идут через `end` и пишут его тоже.
- `src/shared/autopilot/journal.ts`: вид `forecast` в шапке, в `JOURNAL_EVENT_KINDS` (после `harness-behind`) и в
  схеме; `run-stopped.actual?` в шапке и схеме. `week` и `window` чужой формы читаются как отсутствующие (`week` —
  `null`), `actual` чужой формы или с `counted > waves` — как отсутствующее; строка остаётся.
  `src/shared/flight-recorder/journal-walk.mjs`: `forecast` в `JOURNAL_KINDS` на том же месте.
- `docs/features/autopilot.md`: строка `forecast` и поле `actual` в таблице видов Journal.
- Решено без владельца, подтвердить:
  1. `fit` — K по правилу режима: с reserve Settings, когда budget действует в Run (Budget-aware; Start window с
     включённым budget), без reserve в Fastest и в Start window без budget, как предупреждение Ticket-а 03. В spec
     «`null` без рекомендации»; здесь `null` — когда K нет вовсе (нет диапазона или свежего числа `seven_day` со
     сбросом впереди).
  2. `week` — только свежее число `seven_day` (не старше 30 минут, `BUDGET_FRESH_MS`), как «Used now» строки
     прогноза; старое — `null`. Usage перед `forecast` отдельно не запрашивается: первая Wave запрашивает его сама.
  3. `forecast` пишется только когда у Run есть источник Journal-ов (`deps.budget`); в приложении он есть всегда.
     Без него (unit-stand-in-ы) строки нет — так прежние test-ы Run не меняются.
  4. `low`, `high` и `actual.share` округлены до миллионных: в файле `0.1`, а не `0.09999999999999998`.
  5. `actual.waves` — все `wave-finished` этого Run; ход Process gate queue — не Wave и не считается.
- Долг #1215 (`run.ts` `limitsHit`, фаза `settling`) оставлен как есть. Отказ Limits в `settling` не доходит: у
  каждого нового хода Session сначала `busy`, и цикл уже в `turn`. Но `cycle.ts` тоже принимает `turn-ended` в
  `settling`, и `limitsHit` с ним в одном ряду; если `busy` когда-нибудь потеряется, Run подождёт Limits, а не
  закончит Wave по `settle-timeout`. Test на недостижимый путь ничего бы не закрепил.
- Файлы вне раздела «Где в коде» (решение Orchestrator-а: правка только литералов списков видов, по строке):
  `test/contract/autopilot-limits.test.ts` — у test-ов с budget в Journal появилась строка `forecast`, сдвинулись
  индексы строк и длины срезов; `test/e2e/autopilot.spec.ts`, `test/e2e/autopilot-chat.spec.ts`,
  `test/e2e/linked-autopilot.spec.ts` — приложение всегда даёт Run `deps.budget`, так что e2e-Journal-ы тоже
  получают `forecast` после `run-started`. `docs/features/autopilot.md` — страница описывает виды Journal.
- Test-ы: `test/unit/autopilot-run.test.ts` — 12 новых (порядок `forecast`, с `harness-behind`, поля при 5 и 4
  выборках, нечитаемые Journal-ы, K по режиму и устаревшее число, окно Start window, без `deps.budget`; `actual`
  при 0.04 + 0.06, со сбросом недели во Wave 2, без законченной Wave, Force stop во Wave 2). Сначала все 10 test-ов
  `forecast`/`actual` были красными. `test/unit/autopilot-journal.test.ts` — 4 новых (схема `forecast`, чужие
  `week`/`window`, `actual` и старые строки, `journal-walk.mjs`); `test/contract/autopilot-journal.test.ts` —
  `forecast` и `actual` в строке каждого вида и новый test записи и чтения.
- Mutant-ы, на каждом test красный: `forecast` после `wave-started` (3 test-а); `actual` считает Wave со сбросом
  (рост — простая разность, 1 test); `low`/`high` при 4 выборках (`FORECAST_MIN_SAMPLES` = 4, 1 test); `actual` без
  законченных Wave (1 test); reserve и в Fastest (1 test); нечитаемые Journal-ы роняют строку (1 test).
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (560 файлов, 12081 test). e2e `autopilot.spec.ts`,
  `autopilot-chat.spec.ts`, `linked-autopilot.spec.ts` под замком — 11 passed.
- Оценка автора: около 300 тыс. token-ов.

