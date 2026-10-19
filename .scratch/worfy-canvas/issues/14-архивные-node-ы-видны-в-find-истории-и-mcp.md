# 14 — Архивные Node-ы видны в Find, в истории Session, в разделе Sessions, в палитре и в canvas MCP

Type: bug
Status: open
Blocked by: —
Source: ревью PR [#536](https://github.com/IDSAD-XL/worfy/pull/536) (Ticket 07, правило автоархива в
main), круг 1, находки вне диффа; [ADR-0076](../../../docs/adr/0076-auto-archive-of-finished-sessions.md)
(автоархив законченных Session-ов), пункты 4 и 10. Код перечитан по main `2af91b51`.

## Что происходит

С Ticket-а 07 у Node-а Layout-а есть поле `archived` (`{ at, rule, batch }` или null). Архивный Node не
рисуется на Canvas (`src/renderer/canvas/Canvas.tsx:123-125`). Но остальные места, которые перебирают
Node-ы Layout-а, смотрят только на `hidden` и про `archived` не знают:

- **Find.** `src/renderer/find/search-index.ts:337` пропускает только `node.hidden` и виды без заголовка.
  Архивный Node попадает в результаты поиска, а `rectOf` (`src/renderer/find/CanvasFind.tsx:60`) не находит
  его на экране — фокус уходит на Node, которого нет.
- **История Session.** `src/renderer/session/HistoryPopover.tsx:151-155` при «Show» снимает только `hidden`
  и фокусирует Node; `showWrites` на `:181` тоже считается только по `hidden`. Архивный Node так не
  возвращается.
- **Раздел Sessions в sidebar.** `src/renderer/shell/sidebar/SessionsSection.tsx:100-108` находит Node
  через `nodeOf()` без проверки `archived` и снимает только `hidden` (`:107`).
- **Палитра команд.** `goToNode` в `src/renderer/palette/commands.ts:93-96` снимает только `hidden`.
- **canvas MCP server.** `src/main/mcp/canvas-server.ts:151` собирает `nodes()` без проверки `archived`;
  `list_nodes` (`:185`) отдаёт агенту архивные Node-ы, `place()` (`:174`) отсеивает только `hidden`.
  Агент видит и может трогать Node-ы, которых пользователь не видит.
- **Tidy up — уже правильно.** `src/renderer/canvas/tidy.ts:54` берёт `nodes.filter(onThePlane)`, а
  `onThePlane` отсеивает архивные (`src/shared/layout/derived.ts:38-39`). Это образец для остальных мест.

Пока порог автоархива «Never» (Ticket 08, ADR-0076 пункт 10), архивных Node-ов почти нет. Ticket 10
включает автоархив по умолчанию — до него эти места должны знать про `archived`.

## Что делаем

1. Одно правило «Node виден на Canvas» — `onThePlane` (`src/shared/layout/derived.ts`) или его
   обёртка — во всех местах выше вместо проверки одного `hidden`.
2. **Find** не индексирует архивные Node-ы. Найти архивную Session — дело истории и popover «Archive»
   (Ticket 09); если 09 уже влит, Find может показывать её отдельной строкой «Archived», которая
   возвращает Node через Restore 09, а не фокусирует невидимый.
3. **«Show» в истории Session, в разделе Sessions и в палитре** для архивного Node-а возвращает его
   (операция `restore` Ticket-а 07, через LayoutOps — ⌘Z её отменяет) и потом фокусирует.
4. **canvas MCP**: `list_nodes` не отдаёт архивные Node-ы; операции над архивным Node-ом отвечают
   ошибкой с причиной («Node is archived»).

## Готово, когда

- [ ] Unit `test/unit/search-index.test.ts`: архивный Node не попадает в индекс; мутант «проверка только
      `hidden`» — красный.
- [ ] Unit на «Show» (`HistoryPopover`, `SessionsSection`, `goToNode`): архивный Node возвращается через
      `restore` и получает фокус; ⌘Z снова убирает его в архив.
- [ ] Test canvas MCP server (новый файл или рядом с теми, что уже зовут `canvas-server`): `list_nodes` без архивных
      Node-ов; `place` архивного Node-а — ошибка с причиной.
- [ ] Поиск по `src/` на `.hidden` в местах, которые перебирают Node-ы Layout-а, — в «Итог» список: где
      заменено на общее правило, где `hidden` нужен сам по себе и почему.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: unit `search-index` с архивным Node-ом — красный на main.
- Unit: `test/unit/search-index.test.ts`, test-ы popover-а истории, раздела Sessions и палитры.
- Contract: canvas MCP server.

## Где в коде

- `src/shared/layout/derived.ts` (`onThePlane`, `:38-39`)
- `src/renderer/find/search-index.ts` (`:337`), `src/renderer/find/CanvasFind.tsx` (`:60`)
- `src/renderer/session/HistoryPopover.tsx` (`:151-155`, `:181`)
- `src/renderer/shell/sidebar/SessionsSection.tsx` (`:100-108`)
- `src/renderer/palette/commands.ts` (`:93-96`)
- `src/main/mcp/canvas-server.ts` (`:151`, `:174`, `:185`)

Только читать: `src/renderer/canvas/tidy.ts` (`:54`, образец), `src/main/layout/archive.ts`.

## Вне скоупа

- Сам список архива и Restore из него — Ticket 09.
- Toast с Undo и порог по умолчанию — Ticket 10.

## Итог

Заполняется при закрытии.
