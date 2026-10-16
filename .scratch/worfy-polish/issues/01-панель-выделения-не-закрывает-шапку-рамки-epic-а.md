# 01 — Панель выделения не закрывает шапку рамки Epic-а и подписи колонок

Type: task
Status: done — 2026-10-15, [PR #348](https://github.com/IDSAD-XL/worfy/pull/348)
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

- [x] Ticket верхнего ряда в рамке выделен — панель под ним, шапка рамки и подписи колонок видны.
- [x] Ticket не верхнего ряда и Node вне рамки — панель сверху, как раньше.
- [x] Unit test-ы на функцию выбора стороны: пересечение с полосой шапки, без пересечения, обе стороны
      пересекают — сверху; zoom 0,5 и 2.
- [x] e2e `test/e2e/selection-toolbar-frame.spec.ts`: выделить Ticket верхнего ряда — прямоугольник
      панели не пересекает шапку рамки и подпись колонки; снимки в светлой и тёмной теме — в «Итог».
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
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

- Выбор стороны — чистая функция `clearToolbarPlacement()` в `src/renderer/canvas/pinning.ts`
  (рядом — `toolbarRect()`, где панель ляжет на плоскости, и `epicHeaderBand()`, полоса рамки
  `[y, y + min(TICKETS_TOP, высота рамки))`). `SelectionToolbar.tsx` собирает полосы из Node-ов
  `epic-frame` хранилища React Flow и меряет панель через `ResizeObserver` (до замера — 200 × 34 px).
  `usePlaneToolbar()` принимает вместо стороны функцию выбора; `FocusEntry.tsx` зовёт его как раньше.
- **Отступ снизу — не 12 px, а 48 px** (владелец 2026-10-15: остаётся до Ticket-а 14, панель ставится туда, где ничего не закрывает). Под выделением на
  12 px уже стоит кнопка Focus (`FocusEntry.tsx`, высота `--row-height` 28 px): на 12 px панель легла бы
  на неё. Панель встаёт под кнопку Focus с зазором 8 px. Цена: снизу панель закрывает верх
  Ticket-а следующего ряда (видно на снимке), как сверху раньше закрывала шапку.
- Ширина панели тоже учитывается: полоса сбоку от панели её не сдвигает.
- Unit test-ы — `test/unit/pinning.test.tsx`, блок «the selection toolbar keeps off the header…».
  Мутанты на копиях, каждый краснит свой test: всегда `'top'`; полоса без подписей колонок
  (`TICKETS_TOP - 36` = `HEADER_HEIGHT`); высота панели без деления на zoom.
- e2e `test/e2e/selection-toolbar-frame.spec.ts`: на коде `origin/main` красный («the toolbar
  covers the frame header»), с правкой зелёный. Снимки после правки:
  [светлая](../evidence/01-selection-toolbar-frame-light.png), [тёмная](../evidence/01-selection-toolbar-frame-dark.png).

### Gate оркестратора (2026-10-15)

- Wave Epic-а под Autopilot: Ticket-ы 01–05, 07–11 параллельно, общих файлов в «Где в коде» нет; 06 и 12 в команду не входили. Worktree — `.claude/worktrees/pol-<NN>`: пути `04`, `10`, `11` заняты деревьями других Epic-ов. Нагрузку CPU (`yes > /dev/null`) по своему «Готово, когда» дают 04 и 05; оркестратор пустил их параллельно с остальными, и timeout-ы под этой нагрузкой краснили gate соседей — ошибка плана, не implementer-ов.
- Гейт — один круг: `VERIFIED` на `bbe28ab` ([комментарий в PR #348](https://github.com/IDSAD-XL/worfy/pull/348#issuecomment-6188875639)). Verifier сам: `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0 (gate fast из кэша); `pinning.test.tsx` — 34; под e2e-замком `selection-toolbar-frame`, `pin-tags`, `focus` — 12 passed; на базе `12b46d8` новый spec красный («the toolbar covers the frame header»); пять мутантов `pinning.ts` — все красные; снимки в обеих темах.
- Мерж: первая попытка — база `be68c08`, head `d5adebf`, gate full зелёный, но CI красный в `test/contract/harness-drift.test.ts` (уборка временной папки, ENOTEMPTY; вне diff); job перезапущен и зелёный, но main ушёл. Вторая: база `9e2a208`, head `7531042`; `GATE_SCOPE=all gate full` — код 0, не из кэша, `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `d494f60`.
- Act on, Dismissed — нет.
- Consider ([low], **владелец 2026-10-15: остаётся до Ticket-а 14, панель ставится туда, где ничего не закрывает**): отступ снизу 48 px вместо 12 px Ticket-а. Над Ticket-ом верхнего ряда панель встаёт под кнопку Focus и закрывает заголовок Ticket-а следующего ряда и «no blockers», при zoom 0,6 — и его кнопку «Ship ticket». С 12 px панель легла бы на Focus (`FocusEntry.tsx:102`), нижний ряд закрыт и так; прежде закрывались подписи колонок и низ шапки.
- Noted ([low]): `src/renderer/canvas/overlays/FocusEntry.tsx:100` — комментарий «the selection toolbar … holds the top» теперь верен не всегда.
