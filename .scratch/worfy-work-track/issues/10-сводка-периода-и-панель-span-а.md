# 10 — Сводка периода и панель Span-а

Type: task
Status: open
Blocked by: 09
Source: [spec.md](../spec.md), «Что видит владелец», п. 3, 7, 8; «Вид (прототип)»; «Решения владельца», 7, 10, 11; [05](../../worfy-autopilot-queue/issues/05-вид-work-track.md), Q4, Q5

## Что происходит

- После 09 лента есть, сводки и панели нет. Сводка модели — `src/shared/work-track/summary.ts` (Ticket 04).
- Открыть Run в Run history — `openRunHistory` (`src/renderer/flight-recorder/open.ts:12`); панель Run history — образец
  (`src/renderer/flight-recorder/DetailPanel.tsx`).

## Что делаем

1. `SummaryRow.tsx` — одна строка: «Hours by Epic» (до трёх столбцов полос с часами, остальное — «+N»), KPI «of work in
   total», «PRs merged», «Autopilot Runs», «no-data gaps» с подсказкой.
2. `SpanPanel.tsx` — щелчок по Span-у: заголовок, таблица (When, Duration, Epic, Ticket, PR, Outcome), кнопки «Open
   Session» (Session на Canvas или её транскрипт в Session view), «Open Run» (Run history этого Run-а), «Open PR»
   (GitHub), строка «Source: …»; Esc и ✕ закрывают; только названия.
3. `WorkTrackView.tsx` — место сводки и панели, выбор Span-а.

## Готово, когда

- [ ] Unit test панели: Span Subagent-а, Wave вне Run-а (Open Run недоступна), PR; сводка — часы параллельных
      Subagent-ов без двойного счёта.
- [ ] e2e: щелчок по Wave Run-а → «Open Run» → Run history этого Run-а.
- [ ] Снимки сводки и панели в обеих темах — `../evidence/10-*.png`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/work-track-panel.test.tsx` (новый), e2e `test/e2e/work-track.spec.ts`.
- Сначала падающий: щелчок по Span-у ничего не открывает.

## Где в коде

- `src/renderer/work-track/SummaryRow.tsx`, `src/renderer/work-track/SpanPanel.tsx` (новые)
- `src/renderer/work-track/WorkTrackView.tsx`, `src/renderer/work-track/work-track.css`
- `test/unit/work-track-panel.test.tsx` (новый), `test/e2e/work-track.spec.ts`

Только читать: `src/renderer/flight-recorder/DetailPanel.tsx`, `src/renderer/flight-recorder/open.ts`.
