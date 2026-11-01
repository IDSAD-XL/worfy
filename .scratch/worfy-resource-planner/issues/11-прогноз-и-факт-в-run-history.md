# 11 — Прогноз и факт в Run history

Type: task
Status: claimed 2026-11-01T15:49Z
Branch: worfy-resource-planner/11
Blocked by: 08, 10
Source: [spec.md](../spec.md), «Цель», п. 4, «Решения» (Q10), «Что видит пользователь» (Run history), «Волны» (Wave 6); spec Epic-а `worfy-flight-recorder` ([spec.md](../../worfy-flight-recorder/spec.md), «Экран», п. 1 — шапка Run)

## Что происходит

- **Ждёт merge Ticket-а 18 Epic-а `worfy-flight-recorder`** (экран шкалы,
  [18-экран-шкала.md](../../worfy-flight-recorder/issues/18-экран-шкала.md)): он создаёт вид `history`, шапку Run в
  `src/renderer/flight-recorder/RunHistoryView.tsx` и `test/e2e/flight-recorder.spec.ts`. На 2026-11-01 их нет в `main`.
  `Blocked by` называет только Ticket-ы этого Epic-а, поэтому до merge 18 Ticket стоит в `blocked` (шапка — от
  инструмента `ticket block`), и Autopilot его не берёт. После merge 18 — `ticket open worfy-resource-planner 11`.
- Шапка Run по spec Flight Recorder: Epic, начало → конец, длительность, причина остановки, Wave-ы, счёт Ticket-ов,
  повторы, кто начал Run.
- После Ticket-а 08 разбор Journal отдаёт `mode`, `forecast` и `actual` (`JournalFacts`), а Wait `start-window` — на
  дорожке Wait сам, как любой Wait.
- После Ticket-а 10 есть страница `docs/features/run-planning.md`.

## Что делаем

1. Шапка Run в Run history: режим Run (`Fastest`, `Budget-aware`, `Start window`) и
   `Forecast 18–31% · actual 24%`; без диапазона — `Forecast: not enough data · actual 24%`; без факта —
   `… · actual: unknown` (и при `counted = 0`: ни одна Wave не дала выборку); Run до этого Epic-а (нет `forecast`) — ни того, ни другого. `counted < waves` — tooltip
   `Actual counts 3 of 4 Waves: the week reset inside one` (или сколько их).
2. Поля доходят до экрана тем путём, которым шапка уже получает `by` (сервис и IPC `runs` Ticket-а 17 Epic-а
   `worfy-flight-recorder`); новых каналов нет.
3. Абзац о сравнении — в `docs/features/run-planning.md` (Behaviour).

## Готово, когда

- [ ] Unit test вида (`test/unit/flight-recorder-view.test.tsx`, его создаёт Ticket 18 Flight Recorder): шапка Run с
      `forecast` и `actual` — режим и `Forecast 18–31% · actual 24%`; без `forecast` — строки нет; `counted = 0` — `actual: unknown`; `counted < waves` —
      tooltip.
- [ ] e2e (`test/e2e/flight-recorder.spec.ts`, fixture Journal-а с `forecast` и `run-stopped.actual` через
      `WORFY_DATA_DIR`): шапка показывает прогноз и факт; Wait `start-window` виден на дорожке Wait с причиной словом.
- [ ] Снимки обеих тем в `.scratch/worfy-resource-planner/evidence/11/`.
- [ ] Test-ы краснеют на mutant-ах: факт показывается при `counted = 0`; диапазон без `high`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (e2e по таблице).

## Тесты

- Unit `test/unit/flight-recorder-view.test.tsx` (Ticket 18 Flight Recorder).
- e2e `test/e2e/flight-recorder.spec.ts` (Ticket 18 Flight Recorder).
- Сначала падающий: unit test шапки с `forecast`.
- Прогнать все `test/unit/flight-recorder-*.test.ts`.

## Где в коде

- `src/renderer/flight-recorder/RunHistoryView.tsx` (создаёт Ticket 18 Flight Recorder) — шапка Run
- `docs/features/run-planning.md` (Ticket 10)
- `test/unit/flight-recorder-view.test.tsx`, `test/e2e/flight-recorder.spec.ts` (создаёт Ticket 18 Flight Recorder)

Только читать: `src/shared/flight-recorder/from-journal.ts` (`JournalFacts`, Ticket 08), `src/shared/ipc/runs.ts` и
`src/main/flight-recorder/service.ts` (Ticket 17 Flight Recorder).
