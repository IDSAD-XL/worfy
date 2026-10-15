# 01 — Панель выделения не закрывает шапку рамки Epic-а и подписи колонок

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), кандидат U4; «Итог» [`worfy-week` 10](../../worfy-week/issues/10-тёмная-тема-стопка-done-и-кольцо-выделения.md),
абзац «Долг» (ревью заметило: панель выделения закрывает шапку рамки Epic-а и подпись «Done 2»);
`HANDOFF.md`, «Дальше» — «Ещё кандидаты».

## Что происходит

- Панель выделения (Pin, Tags, Delete) рисуется над выделенными Node-ами: `SelectionToolbar.tsx:239-243`
  зовёт `usePlaneToolbar(ids, 'top', 12)`, и `planeToolbarStyle` (`src/renderer/canvas/pinning.ts:220`)
  ставит её на 12 px выше верхнего края выделения — всегда сверху.
- Ticket-ы верхнего ряда рамки Epic-а стоят сразу под шапкой рамки (`HEADER_HEIGHT` = 56 px) и
  подписями колонок (`COLUMN_HEADER_HEIGHT` = 36 px; `TICKETS_TOP` = 92 px,
  `src/renderer/canvas/epic-layout.ts:33-54`). Панель над таким Ticket-ом ложится на подпись колонки
  («Done 2», «Wave 1») и на шапку рамки: прогресс, кнопки Epic-а.

## Что делаем

1. Выбор стороны: панель сверху, если её прямоугольник над выделением не пересекает полосу
   `[frame.y, frame.y + TICKETS_TOP)` ни одной рамки Epic-а на Canvas; иначе — снизу (`'bottom'`, тот же
   отступ 12 px). Если и снизу пересекает (очень высокая выделенная группа у нижнего края рамки),
   остаётся сверху — как сейчас.
2. Решение — чистая функция рядом с `planeToolbarStyle` в `pinning.ts` (вход: прямоугольники
   выделения, прямоугольники полос шапок рамок, масштаб, высота панели); `SelectionToolbar.tsx`
   собирает полосы из Node-ов `epic-frame` хранилища React Flow.
3. Высота панели в единицах Canvas — её высота на экране, делённая на zoom (панель не масштабируется).

## Готово, когда

- [ ] Ticket верхнего ряда в рамке выделен — панель под ним, шапка рамки и подписи колонок видны.
- [ ] Ticket не верхнего ряда и Node вне рамки — панель сверху, как раньше.
- [ ] Unit test-ы на функцию выбора стороны: пересечение с полосой шапки, без пересечения, обе стороны
      пересекают — сверху; zoom 0,5 и 2.
- [ ] e2e `test/e2e/selection-toolbar-frame.spec.ts`: выделить Ticket верхнего ряда — прямоугольник
      панели не пересекает шапку рамки и подпись колонки; снимки в светлой и тёмной теме — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/unit/pinning.test.tsx` — новые случаи рядом с `planeToolbarStyle` (`:155`).
- Сначала красный: test «Ticket верхнего ряда — панель снизу» на нынешнем коде.
- Мутанты: всегда `'top'`; полоса шапки без подписей колонок (`HEADER_HEIGHT` вместо `TICKETS_TOP`);
  высота панели без деления на zoom. Каждый краснит свой test.

## Где в коде

- `src/renderer/canvas/pinning.ts`
- `src/renderer/canvas/overlays/SelectionToolbar.tsx`
- `test/unit/pinning.test.tsx`
- `test/e2e/selection-toolbar-frame.spec.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/nodes/EpicFrameNode.tsx`,
`src/renderer/canvas/overlays/selection-toolbar.css`, `test/e2e/pin-tags.spec.ts`.

## Вне скоупа

- Другие панели над Node-ами (toolbar закреплённого Node-а).
- Перенос шапки рамки или подписей колонок.

## Итог

—
