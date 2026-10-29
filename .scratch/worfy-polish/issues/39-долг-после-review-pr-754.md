# 39 — Долг после review PR #754: worfy-canvas 19, часть 4

Type: task
Status: done 2026-10-29T17:05Z
PR: #1012
Branch: worfy-polish/39
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

- [x] **Две копии группировки Subagent Node-ов по Session.** `drawnTreesOf`
      (`src/renderer/canvas/arrange-by-epic-command.ts:67-74`) повторяет `subagentPlaneRects`
      (`src/renderer/canvas/sources/subagents.ts:298-305`): обе собирают прямоугольники Subagent Node-ов на
      плоскости по Node-у их Session и пропускают anchor. Одна функция группировки в `subagents.ts` для обоих.
- [x] **Вторая подписка `useTreeBlocks`.** `useTidyRequests` (`src/renderer/find/CanvasFind.tsx:129`)
      подписывается на деревья Subagent-ов ещё раз, рядом с подпиской Canvas menu
      (`src/renderer/canvas/overlays/CanvasMenu.tsx:59`). Перенести `useTidyRequests` к Arrange в
      `CanvasMenu`. Это отступает от решения worfy-week
      [Ticket 07](../../worfy-week/issues/07-tidy-up.md) (Tidy up), поэтому сначала решить, а потом править.
- [x] **Реэкспорт `NodeKindColour` без пользователей и неточная шапка `kind-colours.ts`.**
      `src/renderer/canvas/kind-icons.tsx:12` реэкспортирует `NodeKindColour`, и его никто не берёт оттуда.
      `src/renderer/canvas/kind-colours.ts:2` называет себя «единственным местом, где названа роль
      `kind-*`», но `src/renderer/canvas/epic-frame.css:26` пишет `var(--kind-epic-tint)` сам. Убрать
      реэкспорт; CSS брать из `KIND` или поправить шапку.
- [x] **Test: id заголовка внешней Session.** `src/renderer/canvas/nodes/SessionNode.tsx:518` — id
      заголовка (`sessionTitleElementId`) у варианта внешней Session не проверен test-ом: `aria-labelledby`
      обёртки такого Node-а может указать в пустоту.
- [x] **Один id дважды в Focus mode.** `SessionNode.tsx:355` и `:518`: в Focus mode тот же
      `session-title-<nodeId>` стоит в документе дважды (Node на Canvas и плитка), и `aria-labelledby`
      находит первый. Сделать id уникальным для плитки или не ставить его там.
- [x] **`manualRead` считает ответ-ошибку main прочитанными Binding-ами.** `src/renderer/binding/store.ts:247`:
      `manualError` тоже даёт `true`, поэтому Arrange by Epic двигает Session-ы по transcript-у, когда ручные
      Binding-и неизвестны (main ответил ошибкой). Поведение старое, не из #754. Решить: ошибка — «не
      прочитано» для Arrange by Epic, или оставить и записать причину в «Итог».
- [x] **Устаревший комментарий в архиве.** `src/main/layout/archive.ts:456` говорит «a window opened it»:
      первое чтение Layout-а делает и сам main (MCP-инструменты Canvas, docs, корзина, Session-ы Node-ов),
      как уже записано в Amendment ADR-0076 от 2026-10-22. Поправить комментарий.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

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

Ветка `worfy-polish/39` от `origin/main` `cff97d77`. Поведение приложения не меняется, кроме дубля id в Focus mode
(см. ниже). Номера строк в пунктах выше — по `f8041714`, в коде они уже другие.

- **Группировка Subagent Node-ов.** Одна функция `subagentRectsBySession` в `src/renderer/canvas/sources/subagents.ts`:
  она берёт прямоугольники Subagent Node-ов по id Node-а их Session и пропускает anchor, Node-ы других типов и Node
  без Session. Где у Node-а угол на плоскости, решает вызывающий: Epic frame-ы (`subagentPlaneRects`) считают угол
  от Session Node-а Layout-а, «Arrange by Epic» — по `positionAbsolute` React Flow. `drawnTreesOf` удалена.
  Test — `test/unit/subagent-nodes.test.tsx`, describe «subagentRectsBySession»; без пропуска anchor или проверки
  типа он красный. `subagentPlaneRects` теперь отдаёт прямоугольники по Session, а не в порядке Node-ов. Порядок
  ничего не значит: это препятствия для колонки Epic frame-ов, а test-ы смотрят на одну Session.
- **Вторая подписка `useTreeBlocks`. Решено без владельца, подтвердите.** Выбран рекомендованный вариант:
  поведение «Tidy up» то же, лишней подписки нет. Запрос палитры теперь выполняет `useTidyUpRequests`
  (`src/renderer/canvas/tidy.ts`). Его вызывает Canvas menu с тем же `useTidyUp` и той же подпиской, что у пункта
  меню, — так же, как запросы «Arrange by Epic» и «Re-pack». `useTidyRequests` и подписка в
  `src/renderer/find/CanvasFind.tsx` удалены. От worfy-week Ticket 07 отступает только место: там запрос выполнял
  `CanvasFind.tsx`. Оба overlay-я монтируются в одних и тех же условиях (активный Project, внутри React Flow,
  `key` по Project-у), поэтому поведение то же. Запрос, сделанный до монтирования, не выполняется. Запрос
  другого Project-а — тоже. Повтор во время прогона отбрасывает `runTidyUp`. Test-ы:
  `test/unit/tidy.test.tsx` (описание «the palette's Tidy up») и `test/unit/canvas-menu.test.tsx` (menu выполняет
  запросы палитры своим `useTidyUp`). e2e `test/e2e/tidy-up.spec.ts` (палитра и menu) зелёный. Лишний mock tidy
  в `test/unit/palette-new-browser.test.tsx` удалён.
- **`NodeKindColour` и шапка `kind-colours.ts`.** Реэкспорт из `kind-icons.tsx` убран. Шапку поправил, CSS не
  трогал: фон Epic frame-а рисует класс `.w-epic__ground`. Перенос в `KIND` дал бы inline style в
  `EpicFrameNode.tsx` ради одной строки CSS. Шапка теперь говорит: единственный скрипт, который называет роль
  `kind-*`, — `kind-colours.ts`, а из стилей её называет только `epic-frame.css`. Это держит test
  `test/unit/node-kind-header.test.tsx` («outside the theme only kind-colours.ts and … epic-frame.css name a kind-*
  role»): он красный, если ещё один файл renderer-а напишет `var(--kind-…)`.
- **Id заголовка внешней Session.** Бага не было, test добавлен:
  `test/unit/node-kind-header.test.tsx`, «a Session started outside worfy names its wrapper by its title». Обёртка
  с `aria-labelledby` из `flow-nodes.ts` получает имя Session. Без `id` у варианта внешней Session test красный.
- **Один id дважды в Focus mode.** Это был баг: Node на Canvas и плитка давали два элемента
  `session-title-<nodeId>`. Теперь копия в плитке (`useInFocusTile`) id не ставит, у плитки своё имя
  (`aria-label` в `FocusMode.tsx`). Сначала test был красный («expected 2 to have a length of 1») для обоих
  вариантов Session Node-а: `test/unit/node-kind-header.test.tsx`, «… in a focus tile: its title id stays the
  Canvas copy's alone».
- **`manualRead` и ответ-ошибка main. Оставлено как есть.** При ошибке `bindings.get` Canvas тоже не показывает ни
  одного ручного Binding-а: `useManualBindings` и `storedBindings` берут пустой список. Поэтому «Arrange by Epic»
  раскладывает Session-ы так, как их показывают anchor-ы Binding-ов на Canvas. Ошибка как «прочитано» — то же
  правило, что у первого открытия дня (`arrangement-record.ts`) и у Archive (`ArchivePopover.tsx`). Иначе на
  машине, где main не может прочитать Binding-и, команда ждала бы 5 s и молча ничего не двигала. Сдвиг отменяет
  один ⌘Z. Решение держит новый test `test/unit/arrange-by-epic-command.test.tsx`: «places at once by the
  transcripts when main answered bindings.get with an error». Без `manualError` в `manualRead` он красный.
- **Комментарий в `src/main/layout/archive.ts`** перечисляет всех первых читателей Layout-а, как в Amendment
  ADR-0076 от 2026-10-22. Код не менялся, contract test не нужен.
- Проверки: `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (469 файлов, 10269 test-ов), gate fast — green.
  e2e под замком: `arrange-by-epic`, `tidy-up`, `focus`, `epic-frame` — 17 passed. Каждый новый test проверен
  mutant-ом своей правки (8 mutant-ов, все красные). Ничего видимого не менялось, снимков нет.
- Ревью: VERIFIED с двумя low, оба исправлены Orchestrator-ом в `d8795f91`: test «runs once per request»
  перерисовывает hook с новым `run` и краснеет без `handled.current = request.seq`; doc comment
  `LiveSessionNode` снова над ним. Долг вне диффа: `test/unit/node-kind-header.test.tsx:106` — `placed('focus')`
  оборачивает в устаревшую копию `FocusTileContext` (статический import до `vi.resetModules`), поэтому старые
  test-ы «in a focus tile» проверяют только CSS. Merge `2167d13a`.
