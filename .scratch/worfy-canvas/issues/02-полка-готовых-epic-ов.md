# 02 — Done shelf: готовые Epic-и — chip-ы под рамками, клик разворачивает рамку

Type: task
Status: done 2026-10-21T03:29Z
PR: #554
Blocked by: 01
Source: [spec.md](../spec.md), решение владельца 3;
[ADR-0075](../../../docs/adr/0075-epic-frames-in-columns-and-done-shelf.md) (рамки — полоса из K колонок
и полка готовых), пункт 5; исследование
[2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md), P1, вариант 1d.
Код перечитан по main `7dab925f`.

## Что происходит

- Epic, у которого все Ticket-ы done, по умолчанию свёрнут: флаг `collapsed` Node-а `epic:<epic>`
  (`src/renderer/canvas/sources/epics.ts:9-10`). Свёрнутая рамка всё равно стоит в колонке рамок.
- У Project-а CanvasForAI три таких Epic-а (worfy-reliability 9/9, worfy-review 8/8, worfy-week 20/20) —
  три строки колонки.

## Что делаем

1. **Кто на полке.** Epic, у которого есть Ticket-ы, все они done и рамка свёрнута (`collapsed` из
   Layout или по умолчанию), в полосу рамок не идёт (`sources/epics.ts`, вход `stackFrames`).
2. **Полка — Derived Node** `done-shelf` (новый тип `src/renderer/canvas/nodes/DoneShelfNode.tsx`, вид —
   в `SOURCE_NODE_KINDS`, `src/shared/layout/derived.ts:30`). Стоит у левого края полосы, `FRAME_GAP` под
   самой высокой колонкой. Chip-ы «✓ <epic> N/N» идут по порядку ADR-0075 и переносятся по ширине полосы.
   Высота полки входит в высоту полосы для `frameColumnX`.
3. **Клик по chip-у** ставит `collapsed = false` той же операцией, что кнопка сворачивания рамки (шаг ⌘Z).
   Рамка встаёт в полосу в конец порядка. Свернуть её — она уходит на полку.
4. Chip — `<button>` с `aria-label` «Expand <epic>, N of N done»; клавиатура: Tab и Enter.
5. Пустая полка не рисуется.
6. **F-SPEC** — раздел «Done shelf (Epic frames)» рядом с «Done stack (Epic frame)»
   (`docs/design/F-SPEC.md:84`): вид chip-а, место полки, роли из таблицы Tokens.

## Готово, когда

- [ ] Unit `test/unit/done-shelf.test.tsx`: какие Epic-и на полке (все done и свёрнут — да; все done и
      развёрнут — нет; не все done и свёрнут — нет; без Ticket-ов — нет); место полки под самой высокой
      колонкой; перенос chip-ов по ширине полосы; chip — кнопка с `aria-label`.
- [ ] e2e `test/e2e/done-shelf.spec.ts`: три готовых Epic-а фикстуры стоят chip-ами; клик разворачивает
      рамку, ⌘Z сворачивает обратно на полку; второе окно того же Project-а видит то же; снимок
      `done-shelf` в обеих темах.
- [ ] Мутант красный: Epic уходит на полку без проверки `collapsed`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit «готовый свёрнутый Epic не в полосе».
- Unit `test/unit/done-shelf.test.tsx` (новый); e2e `test/e2e/done-shelf.spec.ts` (новый).

## Где в коде

- `src/renderer/canvas/sources/epics.ts` (`collapsed` `:9-10`, вход `stackFrames` `:440`)
- `src/shared/layout/derived.ts` (`SOURCE_NODE_KINDS` `:30`)
- `src/renderer/canvas/nodes/DoneShelfNode.tsx` (новый)
- `src/renderer/canvas/done-shelf.css` (новый)
- `docs/design/F-SPEC.md` (рядом с «Done stack», `:84`)
- `test/unit/done-shelf.test.tsx` (новый)
- `test/e2e/done-shelf.spec.ts` (новый)

## Вне скоупа

- Порядок рамок и K — Ticket 01.
- Цвет chip-а по типу — Ticket 05 (полоса Epic-а), если понадобится.

## Итог

Ветка `worfy-canvas/02`. PR #554 влит squash-ом 50063ee7 2026-10-20 03:35 UTC.

- Epic уходит на полку, когда у него есть Ticket-ы, все они done и рамка свёрнута (пользователем или
  по умолчанию). Epic с незавершённым Ticket-ом, Epic без Ticket-ов и открытая рамка готового Epic-а
  остаются в полосе.
- Полка — производный Node `done-shelf`: его рисует источник Node-ов Epic-ов, в Layout он не хранится.
  Стоит у левого края полосы, на `FRAME_GAP` ниже самой высокой колонки (высота колонки считает каждый
  done stack открытым). Chip — «галочка, `<epic>`, `N/N`»; порядок — по записи раскладки, потом по
  имени; перенос по ширине полосы. Высота полосы в `frameColumnX` включает полку. Пустая полка не
  рисуется.
- Chip — `<button>` с `aria-label` «Expand <epic>, N of N done». Клик ставит `collapsed = false` и
  переносит Epic в конец порядка записи — один шаг ⌘Z. Свернуть рамку снова — Epic возвращается на
  полку. На read-only экране chip неактивен. Epic-и на полке не входят в порядок и в K.
- `epic-layout.ts`: `placeStrip` (`stackFrames` плюс полка), `layoutShelf`, `shelfChipWidth`,
  `onDoneShelf`. Фокус Epic-а из sidebar и Find: Canvas центрируется на полке (`find/node-rect.ts`,
  `rectOf` с chip-ом как запасным прямоугольником). Binding к Epic-у на полке крепится к его chip-у.
  F-SPEC: раздел «Done shelf (Epic frames)».
- Test-ы: новый unit `done-shelf.test.tsx` (19 test-ов: какие Epic-и на полке, место под самой высокой
  колонкой, перенос и порядок chip-ов, клик и ⌘Z) и `done-shelf-binding.test.tsx`; мутант без проверки
  `collapsed` в `onDoneShelf` — 5 test-ов красные. Новый e2e `done-shelf.spec.ts` (три готовых Epic-а,
  клик, ⌘Z, Enter с клавиатуры, второе окно, снимок `done-shelf` в светлой и тёмной теме).
  `epic-columns.spec.ts` ждёт 9 рамок и 2 chip-а; в `epic-canvas.test.tsx` три test-а ждут полку.
- Ревью: круг 1 (high) — якорь Binding-а на chip-е, разворот всегда в конец порядка, запасной
  прямоугольник Find; круг 2 (medium) — свернуть рамку готового Epic-а и убрать его из порядка одним
  шагом undo; круг 3 — правка и узкая проверка, high и med не осталось.
- Gate full Mac на 6c1b03de + main e1daa395 зелёный: lint, typecheck, test, e2e, package.
- Не покрыто e2e (только unit): свернуть рамку и ⌘Z; Binding к chip-у на полке.
- Вопрос владельцу (ушёл в утренний отчёт): ADR-0075, пункт 6, и третий случай автозаписи — Epic,
  свёрнутый по умолчанию, уходит из порядка, когда попадает на полку.

- Заметка ревью PR #554, круг 1. На настоящем Project-е (worfy-week 20/20) полка может уйти за экран
  после того, как развернулась большая рамка. Причина: полка стоит под высотой каждой колонки с
  открытыми стопками done, а React Flow не рисует Node-ы вне видимой области
  (`onlyRenderVisibleElements`, `src/renderer/canvas/Canvas.tsx:543`). Поэтому e2e
  `test/e2e/done-shelf.spec.ts` берёт worfy-week 12/12 и камеру с zoom 0.2.
