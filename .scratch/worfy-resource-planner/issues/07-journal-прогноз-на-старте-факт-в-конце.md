# 07 — Journal: прогноз на старте Run, факт в конце

Type: task
Status: open
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

- [ ] Unit test Run (`test/unit/autopilot-run.test.ts`): порядок `run-started`, `forecast`, `wave-started`; с отставшим
      Harness — `run-started`, `harness-behind`, `forecast`; поля `forecast` по Journal-ам test-а (5 выборок —
      `low`/`high`, 4 — `null`); Journal-ы не читаются — `samples: 0`, Run идёт.
- [ ] Unit test Run: две Wave с ростом 0.04 и 0.06 — `actual.share` 0.10, `waves` 2, `counted` 2; Wave со сбросом недели
      внутри — `waves` 2, `counted` 1; Run без Wave — поля нет; Force stop — поле есть.
- [ ] Unit и contract test Journal: `forecast` и `run-stopped.actual` проходят схему; строка до этого Ticket-а читается
      как раньше; `actual` чужой формы — отсутствующее поле.
- [ ] `test/unit/critical-path.test.ts:263` зелёный (списки видов равны).
- [ ] Test-ы краснеют на mutant-ах: `forecast` после `wave-started`; `actual` считает Wave со сбросом; `low`/`high` при
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
