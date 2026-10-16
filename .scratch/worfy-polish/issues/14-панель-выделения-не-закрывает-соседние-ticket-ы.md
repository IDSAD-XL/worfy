# 14 — Панель выделения встаёт туда, где ничего не закрывает: сбоку или под выделением

Type: task
Status: done — 2026-10-15, [PR #367](https://github.com/IDSAD-XL/worfy/pull/367)
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
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.

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

Реализовано в ветке `worfy-polish/14` (PR — в отчёте исполнителя).

- **Правило выбора места** — `clearToolbarPlacement()` в `src/renderer/canvas/pinning.ts`. Кандидаты по
  порядку: сверху (12 px), справа и слева у верхнего края выделения (12 px от боковой стороны), снизу
  под кнопкой Focus (`BOTTOM_OFFSET` = 48 px). Запретные зоны: полосы шапок рамок Epic-ов, прямоугольники
  других видимых Node-ов (не выбранных) и кнопка Focus (`FOCUS_ENTRY_SIZE` 96 × 28, на
  `FOCUS_ENTRY_OFFSET` 12 px под выделением). Берётся первый кандидат, который не задевает ни одной зоны.
  `ToolbarSide` и `planeToolbarStyle()` получили стороны `left` и `right`.
- **Свободного места нет — правило (решено без владельца, подтверждено владельцем 2026-10-16).** Берётся кандидат с наименьшей
  площадью пересечения, в два яруса: сначала по шапкам рамок и кнопке Focus, потом по другим Node-ам; при
  равенстве — более ранний по порядку. Так шапка рамки и кнопка Focus не закрываются, пока есть кандидат,
  который их не задевает. Ticket в середине сетки получает панель справа: она закрывает 188 × 34 соседа
  справа, сверху и снизу — по 200 × 34.
- **Pinned Node-ы вне правила (решено без владельца, подтверждено владельцем 2026-10-16).** Ticket просил считать запретной зоной
  все другие видимые Node-ы. Pinned Node-ы исключены с обеих сторон: панель не обходит pinned Node, а
  выделение с pinned Node держит панель сверху. Причины: pinned Node стоит на месте на экране, пока
  Canvas под ним двигается, и панель меняла бы сторону при каждом pan; pinned Node рисуется над панелью
  (z-order из pinning.ts). Ещё одна причина: e2e `pin-tags.spec.ts` (только читать в этом Ticket-е)
  проверяет ровно это — панель лежит под pinned Node-ом. С pinned Node-ами в зонах этот test красный.
- **Невидимые Binding anchors** (точки линий Binding, 1 × 1) в зоны не входят.
- **Комментарий** `FocusEntry.tsx` переписан: кнопка Focus всегда снизу, панель выделения её обходит.

### Проверки

- Unit test пункта 1 на main (тот же сценарий через старый API, `clearToolbarPlacement(sel, keepOut, zoom, size, 12, 48)`):
  4 failed of 4 — `header: expected true to be false` (если в зонах сосед и Focus, панель возвращается
  наверх, на шапку) и `neighbour: expected true to be false` (как вызывает SelectionToolbar на main —
  только шапки — панель снизу ложится на соседа), при zoom 1 и 0,6. С правкой
  `test/unit/pinning.test.tsx`: 44 passed.
- Мутанты на копии `pinning.ts` (восстановление через `cmp`), `test/unit/pinning.test.tsx`: «всегда снизу 48 px»
  — 14 failed; «другие Node-ы не в зонах» — 7 failed; «кнопка Focus не в зонах» — 2 failed; «высота
  панели без деления на zoom» — 4 failed; «без ярусов в правиле без места» — 2 failed; «pinned-выделение
  как обычное» — 1 failed. Мутант SelectionToolbar «Node-ы не попадают в зоны» — e2e
  `selection-toolbar-frame.spec.ts` 2 failed («the toolbar covers the Ticket above»).
- e2e `selection-toolbar-frame.spec.ts`: на main новый случай красный — zoom 1 «the toolbar covers the
  neighbour's title», zoom 0,6 «the toolbar covers the neighbour's Ship ticket»; с правкой 2 passed.
  Fixture: Ticket 04 убран, чтобы справа от колонки 02/03 было свободно; Note перенесён на y 360, чтобы
  при zoom 0,6 панель над ним не задевала Orchestrator.
- e2e `pin-tags.spec.ts` и `focus.spec.ts`: 11 passed. В первом прогоне падал
  `focus.spec.ts:341` (размер pty Terminal-а в focus mode, timeout 10 s) — во втором и третьем прогоне зелёный, правка его не касается.
- `pnpm lint` 0, `pnpm typecheck` 0. `pnpm test` и gate fast на этом Mac красные только по timeout-ам
  15 s в contract test-ах (`workflow-reader`, `github-prs`, `harness-install`, `e3-sandbox`, `docs`,
  `harness-script-wiring`), набор меняется от прогона к прогону; load average 8–10 от соседних агентов.
  Эти test-ы не импортируют изменённые файлы. Вердикт — Linux CI PR.
- [ ] gate full — шаг оркестратора перед merge.

### Снимки

Ticket 02 верхнего ряда выделен, под ним Ticket 03; панель справа, кнопка Focus под выделением:

- zoom 1: [светлая](../evidence/14-selection-toolbar-frame-zoom-1-light.png), [тёмная](../evidence/14-selection-toolbar-frame-zoom-1-dark.png)
- zoom 0,6: [светлая](../evidence/14-selection-toolbar-frame-zoom-0_6-light.png), [тёмная](../evidence/14-selection-toolbar-frame-zoom-0_6-dark.png)

Замечено вне скоупа: кнопка Focus (12 px под выделением, высота 28) сама закрывает верх Ticket-а
следующего ряда — номер и состояние (на снимках). Её место Ticket не меняет.

### Gate оркестратора (2026-10-15)

- Wave 3 Epic-а под Autopilot: Ticket-ы 14, 16, 17, 18, 19, 21, 23, 25 параллельно, затем 20 и 15 (их «Готово, когда» требует прогонов под нагрузкой). Один verifier на круг, глубина около low; UI-Ticket-ы — снимки в обеих темах. Worktree — `.claude/worktrees/pol-<NN>`.
- Gate — один круг: `VERIFIED` на `7a4972d` ([комментарий в PR #367](https://github.com/IDSAD-XL/worfy/pull/367#issuecomment-6198560360)). Verifier сам: lint и typecheck — 0; `pnpm test` красный только на 15 s timeout-ах в пяти contract-файлах вне diff, повтор с `pinning.test.tsx` — 230 passed; `pnpm build` — 0; под замком e2e `selection-toolbar-frame`, `pin-tags`, `focus` — 13 passed; три своих мутанта красные; снимки в обеих темах (рамка Epic-а 3×3, zoom 0,6).
- Merge: первый gate full красный на flaky `harness-script-wiring` (файл отдельно — 147 passed); повтор: `GATE_SCOPE=all gate full` — код 0, не из кэша, `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `342b32b`.
- Act on, Dismissed — нет.
- Consider: [low] стопка done рисуется внутри Node рамки и не входит в зоны, куда нельзя ставить панель (`SelectionToolbar.tsx:276`, `EpicFrameNode.tsx:143-150`): Ticket уровня 1 с соседями сверху и справа получает панель слева, поверх «✓ 1 done». Follow-up — `layout.doneStack` в полосы.
- Noted (**решено без владельца, подтверждено владельцем 2026-10-16**): закреплённые (pinned) Node-ы вне правила свободного места (`SelectionToolbar.tsx:285`) — так решено в worfy-daily 12, и это проверяет `pin-tags.spec.ts:401-440`, который Ticket велит не менять.
- Noted: пропуск якорей Binding в зонах не покрыт test-ом; вне diff — кнопка Focus в 12 px под выделением закрывает номер и заголовок Ticket-а следующего ряда (`FocusEntry.tsx:105`).

Решение владельца 2026-10-16: принято, Ticket закрыт как есть. Selection toolbar может
закрывать pinned Node-ы — так решено в worfy-daily 12, это сторожит `pin-tags.spec.ts`. Правило
«свободного места нет» (наименьшее пересечение в два яруса) тоже принято.
