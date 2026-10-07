# 04 — Node-ы не перекрываются: main поправляет каждую операцию Layout, Derived Node-ы уступают

Type: task
Status: open
Blocked by: 02, 03
Source: требование владельца 2026-10-07 «Node-ы никогда не перекрываются» и решения 19, 22–27 ([spec.md](../spec.md), раздел «Решения владельца по Canvas»); HANDOFF, «Риски и долги» — долг Ticket-а 12 `worfy-daily` (Orchestrator и HANDOFF в (40, 40)); [spec.md](../spec.md), этап 2

## Что происходит

- Main применяет операции Layout как есть (`applyOp`, `src/main/layout/store.ts:43`). `create`,
  `move` и `resize` кладут Node поверх другого, если так попросили.
- Свободное место ищут только для новых Node-ов: те, что ставит сам main (`placeNewNode` и
  `placeDownFrom`, `src/main/layout/place.ts:15`, `:31`), и Card или Note из MCP-tools без x, y
  (`placeNear`, `src/shared/canvas/tools.ts:116`). С x, y место берётся как есть
  (`src/main/mcp/canvas-server.ts:136`).
- Долг из HANDOFF: `placeNewNode` не видит скрытых Node-ов, поэтому Orchestrator и HANDOFF могут
  лечь друг на друга в (40, 40). Когда HANDOFF.md возвращается, main показывает скрытый Node HANDOFF
  операцией `hide` (`src/main/ipc/docs.ts:35`), и место не проверяется.
- Перетаскивание нескольких Node-ов шлёт по операции `move` на Node (`onNodeDragStop`,
  `src/renderer/canvas/Canvas.tsx:194-209`). Если main начнёт поправлять каждый `move` отдельно,
  первый Node выделения может лечь на соседа из того же выделения, который ещё не сдвинут, и main
  отодвинет его не туда.
- Derived Node-ы уже уступают часть места: колонка рамок уходит вправо от Node-ов Layout-а и
  деревьев Subagent-ов ([ADR-0032](../../../docs/adr/0032-epic-frames-avoid-nodes.md)), дерево
  Subagent-ов сдвигается от Node-ов Layout-а (`clearShift`, `src/renderer/canvas/sources/subagents.ts:200`).
  Но рамку со смещением пользователя worfy не двигает, даже если она лежит на Node-е (ADR-0032,
  пункт 6). Деревья Subagent-ов двух Session-ов друг друга не обходят.

## Что делаем

1. **Сначала ADR.** Номер — следующий свободный в момент взятия Ticket-а (по плану 0038). ADR
   записывает правило «Node-ы не перекрываются»:
   - участники и зазор (решение 25): Node-ы пользователя, Orchestrator, HANDOFF, рамки Epic-ов
     целиком, дерево Subagent-ов одним блоком; не участвуют закреплённые Node-ы, скрытые Node-ы и
     Ticket-ы внутри рамки; зазор — 16 px;
   - где живёт правило (решение 24): для Node-ов Layout-а на плоскости — в main, в
     `LayoutStore.apply`. Это единственный вход для операций renderer-а по IPC, MCP-tools, Node-ов,
     которые main ставит сам, и восстановления из корзины. Main по-прежнему не знает размеров рамок
     и деревьев;
   - Derived Node-ы уступают (решение 26), в renderer-е. Порядок уступок: Node-ы Layout-а не
     двигаются. Дерево Subagent-ов обходит Node-ы Layout-а и деревья Session-ов, стоящих раньше в
     Layout-е. Рамки без смещения (колонка ADR-0032) обходят Node-ы Layout-а и деревья. Рамки со
     смещением, в порядке своих Node-ов `epic-frame`, обходят всё перечисленное и рамки раньше себя;
   - что меняется в принятых ADR: ADR-0032, пункт 6 отменён — рамка со смещением уступает; пункт 4
     уточнён — main не знает размеров рамок, но поправляет места Node-ов Layout-а. ADR-0003 —
     контракт MCP-tools: место может быть поправлено, ответ несёт настоящие x, y. ADR-0016 — undo и
     redo шлют операцию заново, и main поправляет её так же;
   - `## Considered Options`: проверка только в renderer-е; main раздвигает соседей; main
     отклоняет операцию вместо поправки; renderer сообщает main прямоугольники Derived Node-ов.

   ADR — первый коммит PR, до кода.
2. **Один модуль на main и renderer.** Новый `src/shared/layout/free-place.ts` — чистые функции
   без IPC и React:
   - кто участник среди Node-ов Layout-а (правило `onThePlane`, `src/shared/layout/derived.ts:35`);
   - ближайшее свободное место прямоугольника с зазором 16 px;
   - край при изменении размера, остановленный у соседа;
   - место группы Node-ов целиком, с сохранением их взаимного расположения;
   - снятие перекрытий в сохранённом Layout-е.

   Выбор между равноудалёнными местами детерминирован: одинаковый вход даёт одинаковый ответ в main
   и в renderer-е. Ticket 06 рисует этим же модулем контур места, куда встанет Node.
3. **Main поправляет каждую операцию,** после которой Node Layout-а оказывается на плоскости:
   `create`, `move`, `resize`, `hide` с `hidden: false`, `pin` с `pinned: false` и групповое
   перемещение (пункт 4). Node встаёт на ближайшее свободное место, соседи не двигаются (решение
   22). `resize` в соседа останавливает край у соседа минус 16 px, остальные края на месте (решение
   23). Закреплённые и скрытые Node-ы и Node-ы источников (`SOURCE_NODE_KINDS`) не двигаются и
   препятствием не считаются. Поправка живёт внутри `LayoutStore.apply`
   (`src/main/layout/store.ts:138`), поэтому её получают все: renderer, MCP-tools, Orchestrator,
   HANDOFF, новые Session-ы (`placeNewNode` остаётся подсказкой места), восстановление из корзины
   (`src/main/layout/trash.ts:196`). Долг (40, 40) закрывается: показанный снова Node HANDOFF встаёт
   на свободное место (решение 19).
4. **Групповое перемещение — одна операция Layout** (имя выбирает исполнитель, например
   `moveMany`): новые места нескольких Node-ов. Main проверяет группу целиком. Если группа ложится на
   Node вне неё, вся группа сдвигается на ближайшее свободное место, взаимное расположение
   сохраняется. `onNodeDragStop` (`Canvas.tsx:194`) шлёт её для Node-ов Layout-а одного
   перетаскивания; Derived Node-ы, как сейчас, идут в свой источник. Обратная операция для ⌘Z — та
   же групповая операция со старыми местами (`inverseOf` в `src/renderer/canvas/history.ts`). Одно
   перетаскивание — один шаг истории, как сейчас.
5. **MCP-tools возвращают настоящие координаты.** `create_card`, `create_note` (с x, y и без),
   `move_node`, `resize_node` отвечают местом после поправки: `apply` в `canvas-server.ts` уже
   отдаёт Node из Layout-а после операции, test это закрепляет. Описания tools
   (`canvasToolDescriptions`, `src/shared/canvas/tools.ts:77`) и инструкция агенту
   (`src/main/mcp/agent-instructions.md`) говорят: место может быть поправлено до ближайшего
   свободного, настоящие x, y — в ответе.
6. **Derived Node-ы уступают** (решение 26) в renderer-е, тем же модулем и в порядке из пункта 1.
   Рамка со смещением, которая легла на Node Layout-а, дерево Subagent-ов или другую рамку,
   рисуется на ближайшем свободном месте; сохранённое смещение не меняется. Дерево Subagent-ов
   обходит деревья Session-ов, стоящих раньше в Layout-е. Колонка рамок (ADR-0032) и сдвиг дерева от
   Node-ов Layout-а остаются. Расчёт дважды подряд даёт тот же ответ: уступки не гоняют Node-ы по
   кругу.
7. **Перекрытия в сохранённых Layout-ах** (решение 27) снимаются при чтении `layout.json`, в
   нормализации Ticket-а 03 (`src/main/layout/upgrade.ts`). Node-ы Layout-а на плоскости проходят в
   порядке `layout.nodes`, то есть в порядке создания. Node, который перекрывает уже пройденные,
   встаёт на ближайшее свободное место. В лог — строка на каждый сдвинутый Node: id, откуда, куда. В
   историю ⌘Z это не попадает. Второе чтение ничего не меняет.

## Готово, когда

- [ ] ADR (по плану 0038) лежит в `docs/adr/`, статус «принят», есть `## Considered Options`; это первый коммит PR.
- [ ] Contract test на каждую операцию — `create`, `move`, `resize`, `hide` с `hidden: false`, `pin` с `pinned: false`, групповое перемещение — на фикстуре, где операция кладёт Node на соседа. После операции никакие два участника не ближе 16 px, сосед не сдвинулся, закреплённые и скрытые Node-ы не тронуты.
- [ ] `resize` в соседа справа и слева: край останавливается в 16 px от соседа, противоположный край на месте.
- [ ] Долг (40, 40): Layout с Orchestrator-ом в (40, 40) и скрытым там же HANDOFF. HANDOFF.md возвращается — Node HANDOFF показан на свободном месте, Orchestrator на месте. В «Итог» — что пункт долга в HANDOFF, «Риски и долги», можно снять.
- [ ] MCP: `create_card` и `create_note` с x, y на занятом месте отвечают x, y ближайшего свободного места, и Layout с ответом совпадает; `move_node` и `resize_node` — так же. Описания tools и инструкция агенту говорят о поправке.
- [ ] Два соседних Node-а, перетащенные вместе на +100 px по x, стоят ровно на +100 px. Renderer послал одну операцию Layout, один ⌘Z возвращает оба.
- [ ] Contract test нормализации: Layout с перекрытыми Node-ами A (создан раньше) и B (позже). После чтения B на ближайшем свободном месте, A на месте, в логе строка с id, откуда и куда. Второе чтение не пишет файл. История ⌘Z пуста.
- [ ] Unit-test-ы уступок: рамка со смещением поверх Card рисуется рядом с ней, Card на месте, смещение в Layout прежнее; деревья Subagent-ов двух Session-ов не перекрываются; расчёт дважды подряд даёт тот же ответ.
- [ ] Один модуль: unit-test функции из `src/shared/layout/free-place.ts` и contract test main на той же фикстуре получают одно и то же место.
- [ ] e2e `test/e2e/no-overlap.spec.ts`: Note, брошенный на Card, встаёт рядом, Card не двигается, после перезапуска так же. Запуск с `layout.json`, где два Node-а перекрыты: на экране перекрытия нет, в выводе main есть строка лога.
- [ ] Бюджет `test/e2e/epic-frame.spec.ts:779` держится. Test-ы `:467` и `:496` (рамка не ложится на Orchestrator и HANDOFF) зелёные без правок. Contract test: поправка одной операции и нормализация на Layout-е из 500 Node-ов — меньше 1 с вместе; цифры — в «Итог».
- [ ] Снимки в светлой и тёмной теме (helper `test/e2e/snapshots.ts`): Note после броска на Card; рамка со смещением рядом с Card. Сверены с F-SPEC; ссылка из «Итог» — `../evidence/04-без-перекрытий.png`.
- [ ] (вручную) Stable copy после влития: на Canvas Project-ов worfy и Auction ни один Node не лежит на другом; строки лога нормализации — в «Итог». Как проверить: окно приложения и вывод main.

## Тесты

Сначала падающий test — contract test `test/contract/layout-store.test.ts`: `move` Note-а на место
Card, после операции test ждёт зазор не меньше 16 px. На нынешнем main Note ложится на Card, и test
падает. В «Итог» — как он падал.

- `test/unit/free-place.test.ts` — новый: ближайшее место, край при изменении размера, группа,
  снятие перекрытий, детерминированный выбор.
- `test/contract/layout-store.test.ts` — поправка каждой операции, групповое перемещение,
  нормализация, 500 Node-ов.
- `test/contract/canvas-tools.test.ts` — настоящие координаты в ответах MCP-tools.
- `test/contract/layout-pin-tag.test.ts` — открепление на занятое место.
- `test/unit/history.test.ts` — обратная групповая операция.
- `test/unit/canvas.test.tsx` — перетаскивание нескольких Node-ов шлёт одну операцию.
- `test/unit/epic-layout.test.ts`, `test/unit/subagent-nodes.test.tsx` — уступки Derived Node-ов.
- `test/e2e/no-overlap.spec.ts` — новый.

Test-ы, которые меняются вместе с поведением:

- `test/contract/layout-store.test.ts:102` — 100 параллельных `move` на одни и те же места теперь
  поправлялись бы. Test берёт места без перекрытий или ждёт поправку.
- `test/contract/canvas-tools.test.ts:239`, `:269` — плюс случаи занятого места.
- `test/unit/epic-layout.test.ts:213` — рамка со смещением уступает Node-у Layout-а.

`test/e2e/epic-frame.spec.ts` этот Ticket не меняет: в той же Wave его меняет Ticket 05. Если test
из него покраснеет, Ticket ждёт влития 05.

## Где в коде

- `src/shared/layout/free-place.ts` — новый
- `src/shared/layout/types.ts`
- `src/main/layout/store.ts`
- `src/main/layout/upgrade.ts`
- `src/shared/canvas/tools.ts`
- `src/main/mcp/agent-instructions.md`
- `src/renderer/canvas/Canvas.tsx`
- `src/renderer/canvas/history.ts`
- `src/renderer/canvas/epic-layout.ts`
- `src/renderer/canvas/sources/epics.ts`
- `src/renderer/canvas/sources/subagents.ts`
- `test/unit/free-place.test.ts` — новый
- `test/contract/layout-store.test.ts`
- `test/contract/canvas-tools.test.ts`
- `test/contract/layout-pin-tag.test.ts`
- `test/unit/history.test.ts`
- `test/unit/canvas.test.tsx`
- `test/unit/epic-layout.test.ts`
- `test/unit/subagent-nodes.test.tsx`
- `test/e2e/no-overlap.spec.ts` — новый

Не меняются: `src/main/layout/place.ts` (место из `placeNewNode` — подсказка, поправку делает
`apply`), `src/main/mcp/canvas-server.ts` (ответ tool-а уже берётся из Layout-а после операции),
`src/main/ipc/docs.ts`. Если код размещения рамок Ticket 03 перенёс в другой файл, исполнитель
правит этот список до взятия Ticket-а.

`Blocked by`: 02 — этот Ticket меняет `history.ts` и `history.test.ts`, которые правит 02; 03 —
нормализация в `upgrade.ts`, рамки ELK и деревья без смещений, на которых строятся уступки. Общих
файлов с Ticket-ом 05 нет.
