# 21 — Done shelf под видимыми рамками: minimap не уменьшает Canvas из-за полки

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-22, [ADR-0082](../../../docs/adr/0082-done-shelf-under-visible-frames.md).
Код перечитан по main `e08465ff`.

## Что происходит

Minimap Canvas уменьшает всё очень сильно: рамки Epic-ов в нём — мелкие полоски. Причина — Done shelf
(полка готовых Epic-ов, ряд chip-ов под полосой рамок). Она стоит на тысячи px ниже видимых рамок.

`placeStrip` ставит полку `FRAME_GAP` под самой высокой колонкой, а высоту колонки считает с запасом на
открытую стопку done каждой рамки (`reserve` — высота рамки с открытой стопкой). Видимая рамка с
закрытой стопкой намного ниже запаса. Полка — обычный не скрытый Node `done-shelf`, и MiniMap
`@xyflow/react` 12.12 включает её в свои границы. Фильтра Node-ов у MiniMap нет.

Решение (ADR-0082): полка стоит `FRAME_GAP` под самой высокой колонкой по видимым высотам рамок.
Открытая стопка done, которая дошла до полки, опускает её под свою открытую высоту. Запас на открытые
стопки остаётся для поиска `x` полосы (`frameColumnX`); меняется только `y` полки.

## Где в коде

- `src/renderer/canvas/epic-layout.ts:504-516` — `placeStrip`: `reserved` по колонкам (`:510`),
  `tallest` и `shelfTop` (`:513-514`), высота для `frameColumnX` (`:516`). Нужна вторая сумма по колонкам —
  по `frame.height`; `shelfTop` — от неё, высота для `frameColumnX` — большее из `tallest` по запасу и
  низа полки.
- `src/renderer/canvas/sources/epics.ts:417` — `frameLayout`, откуда `reserve`; `:470-488` —
  `doneShelfNode`, Node полки; `:629` — вызов `placeStrip`. Ожидается, что здесь правок нет.
- `test/unit/done-shelf.test.tsx:173-181` — test «at the strip's left edge, FRAME_GAP under its tallest
  column of reserved heights» проверяет прежнее правило; переписать.
- `src/renderer/canvas/overlays/MiniMapOverlay.tsx` — minimap, для test-а границ.

## Готово, когда

- [ ] Unit на `placeStrip`: у рамки с `reserve` больше `height` полка стоит на `FRAME_GAP` под самой
      высокой колонкой по `height`, а не по `reserve`.
- [ ] Unit: рамка с открытой стопкой done (её `height` равен открытой высоте), чья колонка стала ниже
      полки, опускает полку на `FRAME_GAP` под эту колонку; закрытая стопка возвращает полку наверх.
- [ ] Unit: запас на открытую стопку по-прежнему входит в поиск `x` полосы — Node под видимыми рамками,
      но в пределах запаса, сдвигает полосу вправо, как сейчас.
- [ ] Если проверяется: границы minimap (или границы всех Node-ов, по которым MiniMap их считает) не
      тянутся до прежнего места полки. Если test-а без e2e не получается — строка в «Итог» с причиной.
- [ ] Мутант красный: вернуть `shelfTop` от суммы по `reserve`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: новый unit в `test/unit/done-shelf.test.tsx` — полка под видимыми высотами.
- Существующие test-ы полки и `test/unit/epic-layout.test.ts` остаются зелёными, кроме переписанного
  test-а прежнего правила.

## Вне скоупа

- Фильтр Node-ов в minimap — в `@xyflow/react` 12.12 его нет (ADR-0082, Considered Options).
- Предел запаса на открытую стопку done — отвергнут (ADR-0082).
