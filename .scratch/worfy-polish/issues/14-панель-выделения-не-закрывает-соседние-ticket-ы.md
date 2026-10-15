# 14 — Панель выделения встаёт туда, где ничего не закрывает: сбоку или под выделением

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-15 по Gate Ticket-а [01](01-панель-выделения-не-закрывает-шапку-рамки-epic-а.md)
(раздел «Gate оркестратора (2026-10-15)», Consider [low]: отступ снизу 48 px вместо 12 px, «решено
без владельца, подтвердить»; Noted [low]: комментарий `FocusEntry.tsx`); «Итог» Ticket-а 01;
[spec.md](../spec.md), кандидат U4.

## Что происходит

Панель выделения — Pin, Tags, Delete над выбранными Node-ами (`SelectionToolbar.tsx`). Ticket 01
научил её не закрывать шапку рамки Epic-а и подписи колонок.

- **Выбор стороны — из двух мест.** `clearToolbarPlacement()` (`src/renderer/canvas/pinning.ts:272-288`)
  берёт «сверху», если панель там не закрывает полосу шапки, иначе «снизу»; если закрывает и там —
  снова «сверху». Сверху отступ 12 px (`TOP_OFFSET`, `SelectionToolbar.tsx:239`), снизу — 48 px
  (`BOTTOM_OFFSET = 12 + 28 + 8`, `:244`): под кнопкой Focus с зазором 8 px.
- **Что нельзя закрывать, знает только шапку.** Запретные зоны — полосы шапок рамок Epic-ов
  (`epicHeaderBand()`, `pinning.ts:248-250`; сборка — `headerBandsKey`, `SelectionToolbar.tsx:249-260`).
  Другие Node-ы и кнопку Focus правило не видит.
- **Снизу панель закрывает соседний Ticket.** Ticket-ы в рамке стоят рядами через 12 px (`ROW_GAP`,
  `src/renderer/canvas/epic-layout.ts:31`), высота Ticket-а — 160 (`TICKET_HEIGHT`, `:29`). Над
  Ticket-ом верхнего ряда панель уходит вниз и закрывает заголовок Ticket-а следующего ряда и строку
  «no blockers» (`src/renderer/canvas/nodes/TicketNode.tsx:93`). При zoom 0,6 — ещё и его кнопку
  «Ship ticket»: отступ и высота панели в единицах Canvas делятся на zoom.
- **12 px снизу нельзя.** На 12 px под выделением стоит кнопка Focus:
  `usePlaneToolbar(selected, 'bottom', 12)` (`src/renderer/canvas/overlays/FocusEntry.tsx:103`).
- **Комментарий устарел.** `FocusEntry.tsx:101` говорит, что панель выделения «holds the top». После
  Ticket-а 01 это верно не всегда.

## Что делаем

1. **Сначала красный unit test** в `test/unit/pinning.test.tsx`: выделен Ticket верхнего ряда, под
   ним через `ROW_GAP` — Ticket следующего ряда. Панель не пересекает ни шапку рамки, ни соседний
   Ticket, ни кнопку Focus — при zoom 1 и 0,6. Сегодня он красный: снизу панель ложится на соседа.
2. **Выбор места — чистая функция в `pinning.ts`.** Расширить `clearToolbarPlacement()` (или
   заменить её):
   - кандидаты по порядку — сверху, сбоку справа, сбоку слева, снизу под кнопкой Focus;
   - запретные зоны — полосы шапок рамок, прямоугольники других видимых Node-ов (не выбранных) и
     кнопка Focus;
   - берётся первый кандидат, который не задевает ни одной зоны.
3. **Если свободного места нет.** Панель шириной около 200 px (`DEFAULT_SIZE`,
   `SelectionToolbar.tsx:246`), а колонки Ticket-ов стоят через 24 px (`COLUMN_GAP`,
   `epic-layout.ts:30`). У Ticket-а в середине сетки свободной стороны может не быть. Правило на
   этот случай выбирает исполнитель: например, место с наименьшей площадью пересечения, или внутри
   выделения у его нижнего края. Записать в «Итог» с пометкой «решено без владельца, подтвердить».
4. **Сбоку** — панель у верхнего края выделения, на `TOP_OFFSET` от его боковой стороны. Для этого
   `ToolbarSide` (`pinning.ts:202`) и `planeToolbarStyle()` (`pinning.ts:297-315`) получают стороны
   `left` и `right`.
5. **Константа `BOTTOM_OFFSET` остаётся** только как место «снизу под Focus». Отступ больше не
   подбирается вслепую: пересечения решает правило из пункта 2.
6. **Комментарий** `FocusEntry.tsx:101` — переписать по новому правилу.
7. **e2e** `test/e2e/selection-toolbar-frame.spec.ts`: новый случай — Ticket верхнего ряда с соседом
   снизу, zoom 1 и 0,6. Панель не пересекает шапку, подписи колонок, кнопку Focus, заголовок,
   «no blockers» и «Ship ticket» соседа.

## Готово, когда

- [ ] Unit test пункта 1 красный на main и зелёный с правкой (вывод обоих прогонов — в «Итог»).
- [ ] Мутанты на копии краснят свои test-ы: «всегда снизу 48 px» (как сейчас); «другие Node-ы не в
      запретных зонах»; «кнопка Focus не в запретных зонах»; «высота панели без деления на zoom».
- [ ] e2e `selection-toolbar-frame.spec.ts` зелёный, новый случай на main красный.
- [ ] Снимки в светлой и тёмной теме: Ticket верхнего ряда с соседом снизу, zoom 1 и 0,6 —
      `.scratch/worfy-polish/evidence/14-*.png`, ссылки в «Итог».
- [ ] Правило для случая «свободного места нет» записано в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/unit/pinning.test.tsx` — выбор места: каждый кандидат, запретные зоны, оба zoom, случай без
  свободного места.
- `test/e2e/selection-toolbar-frame.spec.ts` — настоящая раскладка рамки Epic-а: прямоугольники
  панели и соседей через `boundingBox()`.
- e2e `pin-tags` и `focus` — без изменений, но зелёные (их гонял verifier Ticket-а 01).

## Где в коде

- `src/renderer/canvas/pinning.ts`
- `src/renderer/canvas/overlays/SelectionToolbar.tsx`
- `src/renderer/canvas/overlays/FocusEntry.tsx`
- `test/unit/pinning.test.tsx`
- `test/e2e/selection-toolbar-frame.spec.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/nodes/TicketNode.tsx`,
`src/renderer/canvas/actions/TicketActions.tsx`, `test/e2e/pin-tags.spec.ts`, `test/e2e/focus.spec.ts`.

## Вне скоупа

- Раскладка рамки Epic-а: `ROW_GAP`, `COLUMN_GAP` и размеры Ticket-а не меняются.
- Место кнопки Focus — оно остаётся на 12 px под выделением.
- Панели других Node-ов (Terminal, Session) — только если их задевает общая функция выбора места.

## Итог

—
