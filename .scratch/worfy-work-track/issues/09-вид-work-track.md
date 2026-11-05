# 09 — Вид Work track: переключатель, период, дорожки, плотность

Type: task
Status: open
Blocked by: 08
Source: [spec.md](../spec.md), «Что видит владелец», п. 1–2, 4–6; «Вид (прототип)»; «Решения владельца», 1, 8, 9; «Открытые вопросы», 1; [05](../../worfy-autopilot-queue/issues/05-вид-work-track.md), Q1–Q3, Q6

## Что происходит

- Вкладка Runs (`src/renderer/shell/Toolbar.tsx:63-73`) открывает Run history: `history={<RunHistoryView … />}`
  (`src/renderer/main.tsx:94`), вид в `AppShell` (`src/renderer/shell/AppShell.tsx:107`).
- Шкала Run history — `src/renderer/flight-recorder/Timeline.tsx`; ленты по дням нет.

## Что делаем

1. `src/renderer/flight-recorder/RunsView.tsx` — сегменты «Run history | Work track» над видом; выбор помнится на
   Project в памяти renderer-а; `main.tsx` монтирует `RunsView` вместо `RunHistoryView`.
2. `src/renderer/work-track/WorkTrackView.tsx` + `store.ts` — строка управления: Period «Day | Week | Month» (по
   умолчанию Week), ‹ › и подпись периода; Lanes «by Session | by Epic»; Density «compact | comfortable».
3. `Lanes.tsx` — столбец имён (▸ разворачивает Subagent-ов, чипы `hidden`, `archived`, Vendor) и полосы: Run и Wave,
   ходы, Subagent-ы по видам, исход `failed`/`rejected`, ромбы PR, штриховка «no data · <источник>» с подсказкой, линия
   «now»; ось с днями, щелчок по дню — Day. Tooltip Span-а — название, время, длительность.
4. `MonthGrid.tsx` — Month: клетки дней с часами и merged, закраска по часам, щелчок — Day.
5. Ход загрузки — по `loading` ответа; ошибка источника — пробел, не пустой экран. Цвета — токены F-SPEC, обе темы.

## Готово, когда

- [ ] Unit test вида: переключатель, период и сдвиг, «by Epic», развёртка Subagent-ов, пробел с подсказкой; Month →
      щелчок → Day.
- [ ] e2e: Runs → Work track → Week на fixture-данных (stub канала) → Day → Month; Run history по-прежнему открывается.
- [ ] Снимки Week, Day, Month в обеих темах — `../evidence/09-*.png`, сверка с прототипом `card-dcf3918a` в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/work-track-view.test.tsx`, e2e `test/e2e/work-track.spec.ts` (новые).
- Сначала падающий: во вкладке Runs нет «Work track».

## Где в коде

- `src/renderer/flight-recorder/RunsView.tsx` (новый), `src/renderer/main.tsx`
- `src/renderer/work-track/WorkTrackView.tsx`, `src/renderer/work-track/Lanes.tsx`, `src/renderer/work-track/MonthGrid.tsx`,
  `src/renderer/work-track/store.ts`, `src/renderer/work-track/work-track.css` (новые)
- `test/unit/work-track-view.test.tsx`, `test/e2e/work-track.spec.ts` (новые)

Только читать: `src/renderer/flight-recorder/RunHistoryView.tsx`, `src/renderer/flight-recorder/Timeline.tsx`,
`docs/design/F-SPEC.md`, прототип `card-dcf3918a` (путь — spec, «Вид»).
