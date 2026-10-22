# 39 — Долг после review PR #754: worfy-canvas 19, часть 4

Type: task
Status: open
Blocked by: —
Source: ревью PR [#754](https://github.com/IDSAD-XL/worfy/pull/754) (worfy-canvas Ticket 19, часть 4: остаток
долга ревью Wave 3 и Wave 4 Canvas), 2026-10-22. PR влит (`f8041714`). Все находки — low: мерж они не
держали (правило глубины ревью владельца 2026-10-12). Строки перечитаны по main `f8041714`.

## Что происходит

Каждый пункт ниже — пробел, который ревью нашло и оставило на потом. Один пункт — одна строка
«Готово, когда». Amendment-ы ADR-0076 и ADR-0077 из того же ревью уже сделаны — Ticket 19 Epic-а
worfy-canvas, «Итог».

## Что делаем

Закрыть каждый пункт правкой или test-ом. Если пункт оказался не нужен — строка в «Итог» с причиной.

## Готово, когда

- [ ] **Две копии группировки Subagent Node-ов по Session.** `drawnTreesOf`
      (`src/renderer/canvas/arrange-by-epic-command.ts:67-74`) повторяет `subagentPlaneRects`
      (`src/renderer/canvas/sources/subagents.ts:298-305`): обе собирают прямоугольники Subagent Node-ов на
      плоскости по Node-у их Session и пропускают anchor. Одна функция группировки в `subagents.ts` для обоих.
- [ ] **Вторая подписка `useTreeBlocks`.** `useTidyRequests` (`src/renderer/find/CanvasFind.tsx:129`)
      подписывается на деревья Subagent-ов ещё раз, рядом с подпиской Canvas menu
      (`src/renderer/canvas/overlays/CanvasMenu.tsx:59`). Перенести `useTidyRequests` к Arrange в
      `CanvasMenu`. Это отступает от решения worfy-week
      [Ticket 07](../../worfy-week/issues/07-tidy-up.md) (Tidy up), поэтому сначала решить, а потом править.
- [ ] **Реэкспорт `NodeKindColour` без пользователей и неточная шапка `kind-colours.ts`.**
      `src/renderer/canvas/kind-icons.tsx:12` реэкспортирует `NodeKindColour`, и его никто не берёт оттуда.
      `src/renderer/canvas/kind-colours.ts:2` называет себя «единственным местом, где названа роль
      `kind-*`», но `src/renderer/canvas/epic-frame.css:26` пишет `var(--kind-epic-tint)` сам. Убрать
      реэкспорт; CSS брать из `KIND` или поправить шапку.
- [ ] **Test: id заголовка внешней Session.** `src/renderer/canvas/nodes/SessionNode.tsx:518` — id
      заголовка (`sessionTitleElementId`) у варианта внешней Session не проверен test-ом: `aria-labelledby`
      обёртки такого Node-а может указать в пустоту.
- [ ] **Один id дважды в Focus mode.** `SessionNode.tsx:355` и `:518`: в Focus mode тот же
      `session-title-<nodeId>` стоит в документе дважды (Node на Canvas и плитка), и `aria-labelledby`
      находит первый. Сделать id уникальным для плитки или не ставить его там.
- [ ] **`manualRead` считает ответ-ошибку main прочитанными Binding-ами.** `src/renderer/binding/store.ts:247`:
      `manualError` тоже даёт `true`, поэтому Arrange by Epic двигает Session-ы по transcript-у, когда ручные
      Binding-и неизвестны (main ответил ошибкой). Поведение старое, не из #754. Решить: ошибка — «не
      прочитано» для Arrange by Epic, или оставить и записать причину в «Итог».
- [ ] **Устаревший комментарий в архиве.** `src/main/layout/archive.ts:456` говорит «a window opened it»:
      первое чтение Layout-а делает и сам main (MCP-инструменты Canvas, docs, корзина, Session-ы Node-ов),
      как уже записано в Amendment ADR-0076 от 2026-10-22. Поправить комментарий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Unit: `test/unit/arrange-by-epic-command.test.tsx`, `test/unit/node-kind-header.test.tsx`, test-ы
  `SessionNode` и Focus mode.
- Contract: `test/contract/layout-archive.test.ts` — только если правка комментария тянет за собой код.

## Где в коде

- `src/renderer/canvas/arrange-by-epic-command.ts`, `src/renderer/canvas/sources/subagents.ts`
- `src/renderer/find/CanvasFind.tsx`, `src/renderer/canvas/overlays/CanvasMenu.tsx`, `src/renderer/canvas/tidy.ts`
- `src/renderer/canvas/kind-icons.tsx`, `src/renderer/canvas/kind-colours.ts`, `src/renderer/canvas/epic-frame.css`
- `src/renderer/canvas/nodes/SessionNode.tsx`
- `src/renderer/binding/store.ts`
- `src/main/layout/archive.ts`

## Вне скоупа

- Amendment-ы ADR-0076 и ADR-0077 — сделаны вместе с закрытием worfy-canvas Ticket 19.

## Итог

Заполняется при закрытии.
