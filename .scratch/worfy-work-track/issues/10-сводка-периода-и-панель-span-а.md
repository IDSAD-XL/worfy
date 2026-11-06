# 10 — Сводка периода и панель Span-а

Type: task
Status: done 2026-11-06T23:55Z
PR: #1534
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
  - evidence: test-run pass · `pnpm test test/unit/work-track-panel.test.tsx test/unit/work-track-view.test.tsx` exit 0 · mac dev · dd5df057abca20c9d477e7182842b678d3e4ddc2
  - evidence: review pass · PR #1534 · - - · 66225836f58fa594e0f634a0a87ef4cb82620737
- [ ] e2e: щелчок по Wave Run-а → «Open Run» → Run history этого Run-а.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/work-track.spec.ts` exit 0 · mac dev · dd5df057abca20c9d477e7182842b678d3e4ddc2
  - evidence: review pass · PR #1534 · - - · 66225836f58fa594e0f634a0a87ef4cb82620737
- [ ] Снимки сводки и панели в обеих темах — `../evidence/10-*.png`.
  - evidence: screenshot pass · `../evidence/10-summary-light.png` · mac dev · f4f1182dd1fc00913aaca81ea0f0b57e3267a85a · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/10-summary-dark.png` · mac dev · f4f1182dd1fc00913aaca81ea0f0b57e3267a85a · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/10-panel-light.png` · mac dev · f4f1182dd1fc00913aaca81ea0f0b57e3267a85a · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/10-panel-dark.png` · mac dev · f4f1182dd1fc00913aaca81ea0f0b57e3267a85a · scrub: 2026-11-06
  - evidence: review pass · PR #1534 · - - · 66225836f58fa594e0f634a0a87ef4cb82620737
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: review pass · PR #1534 · - - · 66225836f58fa594e0f634a0a87ef4cb82620737
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42310194640 · ci - · 66225836f58fa594e0f634a0a87ef4cb82620737

## Тесты

- Unit `test/unit/work-track-panel.test.tsx` (новый), e2e `test/e2e/work-track.spec.ts`.
- Сначала падающий: щелчок по Span-у ничего не открывает.

## Где в коде

- `src/renderer/work-track/SummaryRow.tsx`, `src/renderer/work-track/SpanPanel.tsx` (новые)
- `src/renderer/work-track/WorkTrackView.tsx`, `src/renderer/work-track/work-track.css`
- `test/unit/work-track-panel.test.tsx` (новый), `test/e2e/work-track.spec.ts`

Только читать: `src/renderer/flight-recorder/DetailPanel.tsx`, `src/renderer/flight-recorder/open.ts`.

## Итог

- Сначала падающий: `test/unit/work-track-panel.test.tsx` до реализации — 8 из 8 красные: сводки нет, щелчок по
  Span-у ничего не открывает.
- Сводка — `SummaryRow.tsx`: «Hours by Epic» — до шести полос в три столбца, остальные — «+N» с часами в подсказке;
  KPI «of work in total», «PRs merged», «Autopilot Runs», «no-data gaps» (подсказка называет источники и причины).
  Числа — сводка main (`summary.ts`), часы — объединение интервалов: параллельные Subagent-ы не считаются дважды.
- Панель — `SpanPanel.tsx`: заголовок, что это и чья Session, таблица When, Duration, Epic, Ticket, PR, Outcome (время
  — как в источнике, не обрезанное периодом), кнопки и строка «Source: …»; Esc и ✕ закрывают, Esc при открытой панели
  не уводит на Canvas. Open Session — Node Session на Canvas (живой, если worfy её ведёт), иначе транскрипт в Session
  view; у Subagent-а — его Session. Open Run — `openRunHistory` по Run-у из цепочки `parent` (факт `run:<id>`); у Wave
  без Run-а (маркер) кнопка выключена. Open PR — страница PR по `repoUrl` модели workflow; без страницы — выключена с
  причиной.
- Выбор Span-а — щелчок по любому элементу с `data-span-id` в `WorkTrackView.tsx`; другой период или Project
  снимает выбор. Ромбам PR в `Lanes.tsx` добавлен `data-span-id` (одна строка вне «Где в коде»), чтобы панель
  открывалась и для PR.
- Иначе, чем в прототипе: выбранная полоса не подсвечивается; полосы — не кнопки, с клавиатуры панель не открыть.
