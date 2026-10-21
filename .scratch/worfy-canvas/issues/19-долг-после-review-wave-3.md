# 19 — Долг после review Wave 3: PR #654, #656, #657, #659, #662, #664, #668

Type: task
Status: claimed 2026-10-21T08:11Z
Blocked by: —
Source: ревью PR [#654](https://github.com/IDSAD-XL/worfy/pull/654) (Ticket 14, архивные Node-ы вне Find,
истории и canvas MCP, круги 1–2), [#656](https://github.com/IDSAD-XL/worfy/pull/656) (Ticket 09, история
Session-ов и popover Archive, круги 1–3), [#657](https://github.com/IDSAD-XL/worfy/pull/657) (Ticket 05,
полоса и иконка типа в шапке Node-а, круги 1–2), [#659](https://github.com/IDSAD-XL/worfy/pull/659)
(follow-up Ticket-а 18, e2e перекрытия карточек), 2026-10-21. Все четыре влиты; строки — по main `d207756b`.
Добавлено после Wave 4: ревью PR [#662](https://github.com/IDSAD-XL/worfy/pull/662) (Ticket 15, круги 1–2),
[#664](https://github.com/IDSAD-XL/worfy/pull/664) (Ticket 08) и [#668](https://github.com/IDSAD-XL/worfy/pull/668)
(Ticket 06); все три влиты, строки — по main `306bf09e`.

## Что происходит

Каждый пункт ниже — пробел, который ревью нашло и оставило на потом: test, которого нет, дублирование или
редкий случай, который ведёт себя не так. Находки low мерж не держали (правило глубины ревью владельца
2026-10-12). Первый пункт — настоящая ошибка вне диффов этих PR, ревью нашло её попутно.

## Что делаем

Закрыть каждый пункт правкой или test-ом. Если пункт оказался не нужен — строка в «Итог» с причиной.

**Ошибка вне диффов — первой:**

- [x] `src/main/agent/node-sessions.ts:225-237`: на Resume внешней Session Node пересоздаётся без `keep`,
      `touchedAt` и `locked` — отметка Keep теряется. Архивный Node, который worfy запустил сам, на Resume
      остаётся в архиве, пока main не увидит Session живой.

**#654 (Ticket 14), low:**

- [x] `src/shared/layout/types.ts:173`: `at` операции `archive` не ограничен текущим временем; нет test-а
      на отрицательное значение и на не-число.
- [x] `src/renderer/canvas/history.ts:619`: нет test-а, что `sendInOrder` останавливается на первом отказе
      main.
- [x] `history.ts:478`: нет test-а на ветку undo с закреплённым (pinned) Node-ом.
- [x] `test/contract/canvas-tools.test.ts:41`: очередь mock-а `node:crypto` не очищается между test-ами.
- [ ] `src/renderer/canvas/show-node.ts` повторяет канал записанных операций из `Canvas.tsx` (send с
      `screenId` плюс `currentLayout`) без общей фабрики.
- [ ] Show архивного Node-а из sidebar-а и палитры на read-only экране не показывает подсказку (как на
      main для скрытого Node-а).

**#657 (Ticket 05), low:**

- [ ] Цвет типа объявлен трижды в файле каждого Node-а (`minimapColor`, литерал в `KindBand`, литерал
      tint); свести в одну константу KIND.
- [ ] У Node-ов React Flow нет `ariaLabel`, поэтому фокус по Tab попадает на безымянный «node»; ставить
      `node.ariaLabel` там, где строятся Node-ы React Flow.
- [x] Комментарий в шапке `src/renderer/canvas/node-chrome.css` устарел.
- [ ] Test-ы: случаи regex `sessionLabel` (session не в начале, «Sessions…»); состояние, когда registry ещё
      не прочитан (`live === undefined`); сброс при уходе указателя ловит только e2e; порядок загрузки CSS
      в unit test-е — соглашение, к bundle-у не привязан.

**#656 (Ticket 09), low:**

- [x] `src/renderer/canvas/overlays/ArchivePopover.tsx:73`: `sessionIds` создаётся заново на каждой ревизии
      Layout-а, поэтому неудачные transcript-ы спрашиваются снова на любой операции Layout-а; ключ — строка
      id.
- [x] `SessionHistoryButton` живёт в `overlays/ArchivePopover.tsx`, но его импортируют `badges/` и
      `actions/`; вынести в свой модуль.
- [x] `useCanvasStore` повторён в `ArchivePopover.tsx` и `TicketActions.tsx`.
- [x] `ArchiveOps` выписан руками вместо `Pick<LayoutOps,'apply'>` (`Pick` ломал typecheck node test-ов);
      найти способ только на уровне типов.
- [x] `src/renderer/binding/store.ts`: `manualError` не очищается, когда Binding-и приходят (на поведение
      сейчас не влияет).
- [x] Нет test-а уровня popover-а на «Restore all from today» для скрытого Node-а.

**#659 (follow-up Ticket-а 18), low:**

- [ ] `expectSettledWithoutOverlaps` (`test/e2e/helpers.ts:820`) без своего test-а и проходит на пустом
      списке и на прямоугольниках нулевого размера; добавить guard-ы.
- [ ] `helpers.ts:801`: `querySelector` молча берёт первое совпадение; требовать ровно одно.
- [ ] Другие e2e всё ещё читают несколько прямоугольников по одному: `epic-frame.spec.ts:888-898` и `:523`,
      `tidy-up.spec.ts:112`, `no-overlap.spec.ts:128/140/196/258`, `selection-toolbar-frame.spec.ts:163`
      и `:186-201`, `done-stack.spec.ts:96`.

**#662 (Ticket 15, живые агенты при первом открытии за день), low:**

- [x] `src/renderer/canvas/sources/epics.ts:589`: `dayWrites.delete` снимает отметку, не проверив, что она
      от этого вызова (запоздавшая вчерашняя запись плюс запись дня D+1); проверять день перед
      `saveArrangement`.
- [x] `epics.ts:628`: полночь во время ожидания пропускает запись K или порядка раньше записи дня;
      проверять `dayWrites.has`.
- [x] Переключение Project-а во время ожидания Binding-ов: `nodes()` читает `nodeLookup` другого
      Project-а.
- [ ] Границы модулей: `bindingsRead` читает сырое состояние store; разрешение сигналов повторяет
      `session-spots.ts`; прямой `invoke('claudeHome.live')`; поле model продублировано; планировщик
      upkeep вынести в свой модуль.
- [ ] `epics.ts` вырос до 1104 строк (gate предупреждает выше 1000): вынести запись и upkeep расстановки
      рамок в свой модуль.
- [x] Test (medium, без разрушений): `epics.ts:530` — то, что `useRepack` передаёт состояние store в
      `activityNow`, не проверено (`canvas-menu.test` подменяет `useRepack` mock-ом).
- [x] Test-ы: два mount-а, оба запускают запись дня; `whenSettled` просыпается при удалении расстановки;
      `clearTimeout` в `whenBindingsRead`; ошибка `claudeHome.live` → нет живых Session-ов.

**#664 (Ticket 08, настройка автоархива и команда), low:**

- [x] `src/main/layout/archive.ts:288`: условие `sessionId !== null` в `archiveFromScreen` без test-а —
      только что запущенный Session Node без `sessionId`, названный archive-ом с экрана или Linked, был бы
      заархивирован; добавить Node без `data.sessionId` в test «came back to life».
- [x] `src/renderer/canvas/history.ts:468`: undo «Archive now» строит `restore` по локальному Layout-у для
      всех id, в том числе отклонённых main; строить `restore` по Node-ам с `archived.batch === op.batch`
      после ответа main.

**#668 (Ticket 06, semantic zoom), low:**

- [ ] `test/unit/zoom-level.test.tsx:184-198`: перечень Node-ов ищет текст `{...NODE_HEADER}`; проверять,
      что каждый ключ `EXCEPTIONS` существует и что пометка — прямой потомок `.w-node-surface`.
- [ ] `test/e2e/semantic-zoom.spec.ts`: размер Terminal читается один раз, без ожидания кадра (на голове
      PR — `:264` и `:304`; на main `306bf09e` сравнения на `:267` и `:309` уже через `expect.poll`, а
      исходный `terminalFull` на `:249` — одно чтение); перечитать и при нужде брать `expect.poll`.
- [ ] `shortcut:` в `src/renderer/canvas/epic-frame.css:443`: на far шапка короткой рамки выходит за её
      нижний край; если рамка — последняя в самой высокой колонке, шапка закрывает подпись done shelf и
      первый ряд chip-ов и забирает их клики.

**Flaky test в полных прогонах:**

- [ ] `test/contract/workflow-reader.test.ts` (test file watcher-а) дважды упал в полном `pnpm test` у
      implementer-ов под нагрузкой и прошёл отдельно.

## Готово, когда

- [ ] Каждый пункт выше исправлен или осознанно закрыт с причиной в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `src/main/agent/node-sessions.ts`
- `src/shared/layout/types.ts`, `src/renderer/canvas/history.ts`, `src/renderer/canvas/show-node.ts`,
  `src/renderer/canvas/Canvas.tsx`, `test/contract/canvas-tools.test.ts`
- `src/renderer/canvas/kind-icons.tsx`, `src/renderer/canvas/nodes/`, `src/renderer/canvas/node-chrome.css`
- `src/renderer/canvas/overlays/ArchivePopover.tsx`, `src/renderer/canvas/archive-list.ts`,
  `src/renderer/binding/store.ts`
- `test/e2e/helpers.ts` и spec-и из пункта #659
- `test/contract/workflow-reader.test.ts`
- `src/renderer/canvas/sources/epics.ts`, `src/renderer/canvas/overlays/session-spots.ts`, `src/main/layout/archive.ts`,
  `src/renderer/canvas/epic-frame.css`, `test/unit/zoom-level.test.tsx`, `test/e2e/semantic-zoom.spec.ts`

## Итог

PR первой части (2026-10-21, ветка `worfy-canvas/19`): ошибки корректности, test-ы к ним и часть границ
модулей. Дифф подошёл к пределу одного PR (~600 строк), поэтому остальные пункты остаются открытыми — они
не отмечены выше и ждут следующего PR этого Ticket-а.

Сделано:

- Resume read-only Node-а переносит `keep` и `touchedAt`; архивный Node (read-only или Node worfy) на
  Resume сначала возвращается на Canvas операцией `restore`, она же ставит `touchedAt`. Locked
  read-only Node не становится живым (его `remove` запрещён): Resume отклоняется сразу, до `restore`, и
  ничего не меняет. Session Node-ы на деле не бывают locked (`session-nodes.ts` создаёт их с
  `locked: false`). Test-ы — `test/contract/node-sessions.test.ts`, describe «Resume».
- Undo «Archive now» строит `restore` в момент undo по Node-ам с `archived.batch` этой операции:
  Node, который main отклонил, а таймер позже заархивировал своим batch-ем, остаётся в архиве.
- Test «came back to life» включает Session Node без `data.sessionId`.
- `at` операции `archive` в будущем отклоняет `apply` в main по своим часам (`store.ts`), а не общая
  схема: её же читает `layout.changed` на Linked machine, чьи часы могут отставать. Test-ы на будущее,
  отрицательное значение, NaN и строку, и что `layout.changed` с `at` в будущем читается.
- `dayWrites`: каждая запись дня снимает только свою отметку; запись, начатая до полуночи, после неё
  ничего не пишет; upkeep молчит, пока идёт любая запись дня (`dayWrites.has`). Test «midnight during
  the wait» и test-ы: два mount-а, `whenSettled` при удалении расстановки, `clearTimeout` в
  `whenBindingsRead`, ошибка и исключение `claudeHome.live`, `useRepack` со store React Flow.
- `ArchivePopover`: список `sessionIds` держится по строке id; test, что неудачный transcript не
  спрашивается снова на операции Layout-а без изменения архива; test «Restore all from today» со скрытым
  Node-ом.
- `SessionHistoryButton` и popover истории — в `src/renderer/canvas/session-history.tsx`, `useDismiss` —
  в `use-dismiss.ts`, `useCanvasStore` — в `canvas-store.ts`; `LayoutOps` — в `layout-ops.ts` без React,
  и `ArchiveOps` теперь `Pick<LayoutOps, 'apply'>`.
- `sendInOrder` и undo Restore закреплённого Node-а — test-ы в `test/unit/history.test.ts`.
- Очередь mock-а `node:crypto` очищается перед каждым test-ом; шапка `node-chrome.css` обновлена.

Закрыто с причиной:

- `manualError` в `binding/store.ts`: уже очищается в `setManual` на main.
- Переключение Project-а во время ожидания: `Canvas` монтирует `ProjectCanvas` с `key={projectId}`, у
  каждого Project-а свой `ReactFlowProvider`, так что `nodes()` читает store того же Project-а (после
  unmount — его последнее состояние), а не другого.

Осталось (следующий PR): `show-node.ts` и общая фабрика канала; подсказка Show на read-only экране;
#657 (KIND, `ariaLabel`, test-ы); границы модулей #662 и вынос записи расстановки из `epics.ts`
(сейчас 1109 строк); #659; #668; flaky test `workflow-reader`.
