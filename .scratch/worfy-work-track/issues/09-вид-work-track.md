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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/work-track-view.test.tsx` 10 passed, exit 0 · mac - · a5818d042919ea76c451aa643ae76c9d66154973
- [ ] e2e: Runs → Work track → Week на fixture-данных (stub канала) → Day → Month; Run history по-прежнему открывается.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/work-track.spec.ts` 1 passed, exit 0 · mac dev · a5818d042919ea76c451aa643ae76c9d66154973
- [ ] Снимки Week, Day, Month в обеих темах — `../evidence/09-*.png`, сверка с прототипом `card-dcf3918a` в «Итог».
  - evidence: screenshot pass · `../evidence/09-week-light.png` · mac dev · a5818d042919ea76c451aa643ae76c9d66154973 · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/09-week-dark.png` · mac dev · a5818d042919ea76c451aa643ae76c9d66154973 · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/09-day-light.png` · mac dev · a5818d042919ea76c451aa643ae76c9d66154973 · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/09-day-dark.png` · mac dev · a5818d042919ea76c451aa643ae76c9d66154973 · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/09-month-light.png` · mac dev · a5818d042919ea76c451aa643ae76c9d66154973 · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/09-month-dark.png` · mac dev · a5818d042919ea76c451aa643ae76c9d66154973 · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/09-month-before-light.png` · mac dev · a5818d042919ea76c451aa643ae76c9d66154973 · scrub: 2026-11-06
  - evidence: screenshot pass · `../evidence/09-month-before-dark.png` · mac dev · a5818d042919ea76c451aa643ae76c9d66154973 · scrub: 2026-11-06
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

## Итог

- Сначала падающий: `test/unit/work-track-view.test.tsx` до реализации не собирался — во вкладке Runs не было
  `RunsView` и «Work track».
- Вкладка Runs — `src/renderer/flight-recorder/RunsView.tsx`: сегменты «Run history | Work track», выбор помнится на
  Project в памяти renderer-а (`src/renderer/work-track/store.ts`, `tabs`). Run history остаётся смонтированным под Work
  track (скрыт): его Esc → Canvas и переход на Canvas при смене Project-а работают на обеих половинах. Вход, который
  называет Run или Epic (toast остановленного Run-а, «History», меню Epic-а), показывает Run history.
- Вид — `WorkTrackView.tsx`, дорожки — `Lanes.tsx` (модель `lanesBySession` / `lanesByEpic` из
  `src/shared/work-track/lanes.ts`), Month — `MonthGrid.tsx`, стили — `work-track.css` (только токены `tokens.css`).
- Сверка с прототипом `card-dcf3918a` (снимки `../evidence/09-week-*.png`, `09-day-*.png`, `09-month-*.png`,
  `09-month-before-*.png` — Month с «no data» за сроком транскриптов):
  - как в прототипе: строка управления (переключатель, Period с ‹ › и подписью, Lanes, Density), столбец имён 230 px с
    ▸, чипами `hidden`, `archived`, `Codex` и числом Subagent-ов; «Autopilot Runs» сверху, «Gate runs» внизу; Run и
    Wave — полосы с рамкой; цвета Session, implementer, verifier, прочих Subagent-ов, gate; исход `failed`/`rejected` —
    полоса снизу цветом проблемы; штриховка «no data · <источник>» с причиной в подсказке; линия «now»; ромбы PR на
    оси; ось Week — дни (щелчок → Day), Day — часы через 2; Month — клетки дней по часам, на оси число merged,
    щелчок → Day; легенда внизу.
  - иначе, чем в прототипе: Month — календарный месяц с 1-го числа (так `Period` в `facts.ts`), а не 30 последних
    дней; ‹ › двигают и Week, и Month (в прототипе — только Day); Week — 7 дней, кончая выбранным днём; в Month
    Subagent-ы развёрнутой Session — по строке на каждого (в прототипе — одна строка «N Subagents»); дорожки «by
    Epic» — до четырёх рядов полос в дорожке, по одной на перекрытие. Сводка периода и панель Span-а — Ticket 10.
