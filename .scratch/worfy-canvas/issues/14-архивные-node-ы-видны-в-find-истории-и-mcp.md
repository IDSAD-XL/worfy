# 14 — Архивные Node-ы видны в Find, в истории Session, в разделе Sessions, в палитре и в canvas MCP

Type: bug
Status: done 2026-10-21T05:35Z
PR: #654
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

- [x] Unit `test/unit/search-index.test.ts`: архивный Node не попадает в индекс; мутант «проверка только
      `hidden`» — красный.
- [x] Unit на «Show» (`HistoryPopover`, `SessionsSection`, `goToNode`): архивный Node возвращается через
      `restore` и получает фокус; ⌘Z снова убирает его в архив.
- [x] Test canvas MCP server (новый файл или рядом с теми, что уже зовут `canvas-server`): `list_nodes` без архивных
      Node-ов; `place` архивного Node-а — ошибка с причиной.
- [x] Поиск по `src/` на `.hidden` в местах, которые перебирают Node-ы Layout-а, — в «Итог» список: где
      заменено на общее правило, где `hidden` нужен сам по себе и почему.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

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

Ветка `worfy-canvas/14`. Влит squash-ом b53e179b (PR #654).

- `src/shared/layout/derived.ts`: одно правило `shownOnCanvas` — Node не скрыт и не в архиве
  (`isArchived`); `onThePlane` построен на нём.
- Find (`search-index.ts`, `CanvasFind.tsx`): архивный Node не попадает в индекс, у архивной Card не
  просится `card.text`.
- Show в истории Session-ов, в строке раздела Sessions sidebar-а и «go to» в палитре идут через новый
  `src/renderer/canvas/show-node.ts`. `showOps` шлёт `restore` только архивному Node-у (лишний restore
  сдвинул бы `touchedAt`) и `hide: false` только скрытому. Show — один записанный шаг с id экрана, потом
  фокус на Node.
- Undo `restore` (`history.ts`, `restoreInverse`): по одному `archive` на партию, у каждого Node-а — его
  правило и `at` его записи, затем `move`/`moveMany` на прежнее место. Сначала архив, поэтому Node уже не
  на плоскости и move ставит его точно, даже если restore поставил Node в другое место (ADR-0038).
  `applyRecorded` шлёт undo из нескольких операций по порядку и останавливается на первом отказе main.
- Операция `archive` (`types.ts`, `store.ts`): необязательный `at` у Node-а; main берёт его вместо
  текущего времени, поэтому отменённый Restore сохраняет место Node-а в списке архива.
- canvas MCP (`canvas-server.ts`): `list_nodes` пропускает архивные Node-ы; каждый tool, который
  называет архивный Node, отвечает `Node <id> is archived: ...` и ничего не меняет; id нового Node-а
  сверяется со всеми Node-ами Layout-а, архивные включены.
- Поведение изменилось: показать скрытый Node из истории, sidebar-а или палитры раньше было операцией
  без записи, теперь это шаг undo — ⌘Z снова скрывает Node. Палитра по-прежнему показывает архивные
  Session Node-ы в «Go to»; выбор восстанавливает Node.
- Поиск `.hidden` по `src/`. Заменено на `shownOnCanvas` или проверку архива рядом:
  `find/search-index.ts` `findDocs`, `find/CanvasFind.tsx` `cardNodes`, `session/HistoryPopover.tsx`
  `showWrites` (Show архивного Node-а — запись, на read-only экране неактивна), `palette/commands.ts`
  `goToNode`, `shell/sidebar/SessionsSection.tsx` `open`, `main/mcp/canvas-server.ts` `place()`,
  `nodes()`, `nodeOf()`, `shared/layout/derived.ts` `onThePlane`.
  `hidden` остаётся сам по себе:
  - `canvas/Canvas.tsx:132` — передаёт флаг `hidden` самого React Flow; архивные Node-ы отфильтрованы
    раньше, на `:123`;
  - `canvas/tidy.ts:106` — ключ кэша мест Node-ов, не проверка видимости;
  - `overlays/SelectionToolbar.tsx:83, :352`, `overlays/FocusEntry.tsx:30`, `overlays/BindingDrop.tsx:32`,
    `focus/FocusMode.tsx:311`, `find/node-rect.ts:23` — читают Node-ы React Flow, архивных там нет;
  - `claude-home/session-nodes.ts:228` — уже проверяет `isArchived` рядом с `hidden`;
  - `main/ipc/docs.ts:52-55` — скрытие HANDOFF Node-а, пока нет HANDOFF.md; HANDOFF Node не архивируется;
  - `main/agent/node-sessions.ts:234` — копирует поле, когда Node пересоздаётся как живой Session Node;
  - `main/layout/store.ts:219` — сама операция `hide`;
  - `projects/FolderBrowser.tsx` — скрытые папки, не Node-ы.
- Test-ы: `search-index.test.ts` (архивный Node не в индексе), новый `show-archived-node.test.tsx`
  (Show из истории, sidebar-а и палитры восстанавливает и фокусирует Node, ⌘Z возвращает его в архив со
  всей записью на прежнее место; архивный и скрытый Node — один шаг; только скрытый — шаг, ⌘Z снова
  скрывает; без лишнего restore), contract `layout-archive.test.ts` на настоящем Layout store (undo
  Restore возвращает старые x/y и запись `archived`, redo снова восстанавливает; Restore Node-ов из двух
  партий отменяется в свои партии, места и время), contract `canvas-tools.test.ts` (пять tool-ов
  отказывают архивному Node-у, `randomUUID` замокан), `linked-read-only.test.tsx` (Show архивного Node-а
  на read-only экране неактивен с подсказкой).
- Мутанты, 16 за два круга, все красные (отчёты implementer-а). Круг 1: M1 Find проверяет только
  `hidden` (1 test), M2 restore без обратной операции (4), M3–M5 история, sidebar и палитра только
  снимают `hidden` (по 1), M6 MCP перечисляет архивные Node-ы (2), M7 нет отказа архивному Node-у (1),
  M8 `showNode` шлёт без записи (4). Круг 2: undo без move; undo без `at`; main игнорирует `at`; hide
  без записи; лишний restore; подсказка проверяет только `hidden`; `freshId` сверяет только
  перечисленные Node-ы; все Node-ы в одной партии.
- Круг ревью 1 (high): BLOCK на 1 medium — undo Restore терял x/y и `at` Node-а. Исправлено вторым
  коммитом (`restoreInverse`, `at` у `archive`). Круг 2 (medium): PASS.
- Gate full Mac (2026-10-21, main 920caedc + PR): зелёный, 425 s — первый gate с тремя worker-ами e2e.
- Долг (low из ревью) — Ticket [19](19-долг-после-review-wave-3.md).
