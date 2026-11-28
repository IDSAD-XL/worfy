# 08: Блок «Where the Limits went» в Run history

Type: task
Status: open
Blocked by: 07
Source: [spec.md](../spec.md), «Ticket-ы», 08; «Решение», «Где это видно», 1; «Экран»; «Решения по реализации» («Run
history и Work track»); «Решения по test-ам», Seam 3; «Риски» («Оценку примут за факт»); «Волны», Wave 4

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Run history показывает сводку времени «Where the time went» (`src/renderer/flight-recorder/SummaryStrip.tsx:32`,
  место в `RunHistoryView.tsx:231`) и прогноз с фактом доли Run-а «Forecast 18–31% · actual 24%»
  (`docs/features/run-planning.md:185-188`). Чем занята доля Run-а, экран не говорит.
- worfy-harness-guarantees Ticket 10 добавляет в тот же `RunHistoryView.tsx` блок Guard; этот Epic идёт после него.

## Что строить

- `src/renderer/flight-recorder/LimitsBlock.tsx` под `SummaryStrip`: заголовок «Where the Limits went», вкладки Tickets,
  Roles, Rounds, Models, Cache losses.
- Итог: «≈22% of the week by tokens · actual 24% (journal)»; строка «Not counted (journal − estimate)» с tooltip-ом:
  other Machines, claude.ai, Live summary, Terminal AI.
- Без оценки — token-ы и «not enough data yet» с причиной (например, «the week is at 2%»).
- Вкладка Roles: подсказка про Eco mode со ссылкой на Modes (Q6).
- Вкладка Rounds: строка Ticket-а с доработкой ведёт к его попыткам `#2`, `#3` на timeline.
- Доллары — только в tooltip-е строки, «API-equivalent» (Q2). Тексты UI — английские (ADR-0074).

## Где в коде

- `src/renderer/flight-recorder/LimitsBlock.tsx` (новый, имя — предложение)
- `src/renderer/flight-recorder/RunHistoryView.tsx` — место под `SummaryStrip`
- `src/renderer/flight-recorder/store.ts` — запрос канала учёта для Run-а
- `src/renderer/flight-recorder/flight-recorder.css`
- `test/unit/flight-recorder-view.test.tsx`, `test/e2e/flight-recorder.spec.ts`

## Test-ы

- Unit test вида: блок с вкладками и итогом с фактом журнала; «Not counted»; без оценки — token-ы и «not enough data
  yet»; подсказка Eco mode во вкладке Roles.
- e2e: fixture-транскрипты, `limits.json` и журнал Run-а — блок виден под сводкой, итог и вкладки на месте.
- Сначала падающий test: красный до блока, это пишется в «Итог».
- Без моделей и без сети.

## Готово, когда

- [ ] Run history показывает «Where the Limits went» с вкладками Tickets, Roles, Rounds, Models, Cache losses.
- [ ] Итог с фактом журнала и «Not counted»; без оценки — token-ы и «not enough data yet».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
