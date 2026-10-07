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

- [x] ADR (по плану 0038) лежит в `docs/adr/`, статус «принят», есть `## Considered Options`; это первый коммит PR.
- [x] Contract test на каждую операцию — `create`, `move`, `resize`, `hide` с `hidden: false`, `pin` с `pinned: false`, групповое перемещение — на фикстуре, где операция кладёт Node на соседа. После операции никакие два участника не ближе 16 px, сосед не сдвинулся, закреплённые и скрытые Node-ы не тронуты.
- [x] `resize` в соседа справа и слева: край останавливается в 16 px от соседа, противоположный край на месте.
- [x] Долг (40, 40): Layout с Orchestrator-ом в (40, 40) и скрытым там же HANDOFF. HANDOFF.md возвращается — Node HANDOFF показан на свободном месте, Orchestrator на месте. В «Итог» — что пункт долга в HANDOFF, «Риски и долги», можно снять.
- [x] MCP: `create_card` и `create_note` с x, y на занятом месте отвечают x, y ближайшего свободного места, и Layout с ответом совпадает; `move_node` и `resize_node` — так же. Описания tools и инструкция агенту говорят о поправке.
- [x] Два соседних Node-а, перетащенные вместе на +100 px по x, стоят ровно на +100 px. Renderer послал одну операцию Layout, один ⌘Z возвращает оба.
- [x] Contract test нормализации: Layout с перекрытыми Node-ами A (создан раньше) и B (позже). После чтения B на ближайшем свободном месте, A на месте, в логе строка с id, откуда и куда. Второе чтение не пишет файл. История ⌘Z пуста.
- [x] Unit-test-ы уступок: рамка со смещением поверх Card рисуется рядом с ней, Card на месте, смещение в Layout прежнее; деревья Subagent-ов двух Session-ов не перекрываются; расчёт дважды подряд даёт тот же ответ.
- [x] Один модуль: unit-test функции из `src/shared/layout/free-place.ts` и contract test main на той же фикстуре получают одно и то же место.
- [x] e2e `test/e2e/no-overlap.spec.ts`: Note, брошенный на Card, встаёт рядом, Card не двигается, после перезапуска так же. Запуск с `layout.json`, где два Node-а перекрыты: на экране перекрытия нет, в выводе main есть строка лога.
- [x] Бюджет `test/e2e/epic-frame.spec.ts:779` держится. Test-ы `:467` и `:496` (рамка не ложится на Orchestrator и HANDOFF) зелёные без правок. Contract test: поправка одной операции и нормализация на Layout-е из 500 Node-ов — меньше 1 с вместе; цифры — в «Итог».
- [x] Снимки в светлой и тёмной теме (helper `test/e2e/snapshots.ts`): Note после броска на Card; рамка со смещением рядом с Card. Сверены с F-SPEC; ссылка из «Итог» — `../evidence/04-без-перекрытий.png`.
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

## Итог

Сделано в ветке `worfy-week/04`, база `origin/main` 73e8b52. Решение — [ADR-0038](../../../docs/adr/0038-nodes-never-overlap.md),
первый коммит PR.

**Как падал первый test.** `test/contract/layout-store.test.ts`, «a move of a Note onto a Card …»: на
`origin/main` `move` Note-а в (40, 40) клал его на Card в (0, 0), и проверка «никакие два Node-а на
плоскости не ближе 16 px» получала `["card~note"]` вместо `[]`.

**Что сделано.**

- `src/shared/layout/free-place.ts` — чистые функции без IPC и React: `freeShift` (ближайший сдвиг
  прямоугольника или группы, зазор `NODE_GAP` = 16 px), `freePlace`, `stopResize` (край,
  остановленный у соседа), `removeOverlaps` (снятие перекрытий в порядке `layout.nodes`). Кандидаты —
  стороны препятствий по x и по y; выбор между равными — ближе, потом меньше по вертикали, потом
  правее, потом ниже. Unit-test сверяет ответ с полным перебором кандидатов на 400 случайных входах.
- `LayoutStore.apply` поправляет `create`, `move`, `resize`, `hide` с `hidden: false`, `pin` с
  `pinned: false` и новую групповую операцию `moveMany`. Перетаскивание нескольких Node-ов Layout-а
  шлёт один `moveMany` (`dropOperation`, `src/renderer/canvas/history.ts`), обратная операция —
  `moveMany` со старыми местами; один Node по-прежнему шлёт `move`.
- Нормализация при чтении `layout.json` (`src/main/layout/upgrade.ts`) снимает перекрытия; строка
  лога на каждый сдвинутый Node: `[layout] <project>: moved Node <id> from (x, y) to (x, y) …`.
- Деревья Subagent-ов обходят деревья Session-ов, стоящих раньше в Layout-е (одним блоком); рамки
  со смещением, в порядке своих Node-ов `epic-frame`, рисуются на ближайшем свободном месте, смещение
  в Layout-е не меняется (`stackFrames`, `src/renderer/canvas/epic-layout.ts`).
- Описания `create_card`, `create_note`, `move_node`, `resize_node` и `agent-instructions.md`
  говорят о поправке; ответ tool-а уже брался из Layout-а после операции, test это закрепляет.

**Долг (40, 40) из HANDOFF.md, «Риски и долги»** (пункт «Долг Ticket-а 12 …»): закрыт. Contract test
«the HANDOFF Node shown again …» поднимает Layout с Orchestrator-ом в (40, 40) и скрытым там же
HANDOFF-ом и зовёт настоящий `syncHandoffNode`: HANDOFF показан на свободном месте, Orchestrator на
месте. Пункт можно снять.

**Производительность.** Contract test на 500 Node-ах (сетка, каждый десятый брошен на соседа):
чтение с нормализацией 10–13 ms, одна поправленная операция 2–3 ms; вместе меньше 1 с. Сдвинуто
50 Node-ов — ровно брошенные: каждый перекрывает соседа, созданного раньше, и меньше сдвинуть
нельзя. Node-ы, которые стоят в 10 px под брошенным, тоже «конфликтуют» с ним, но на исходном
месте брошенного, а он уходит, — их двигать не нужно (так получалось 144 конфликтующих и 205
сдвигов в первой версии, где сдвинутый Node мог встать на место более позднего; круг доработки
ревью). Худший случай — 500 Node-ов в одной точке — 61 ms (ручной замер, в test не вошёл). Бюджет `test/e2e/epic-frame.spec.ts:814` (номер
строки теперь такой) с `WORFY_PERF=1`: до (Ticket 03, `origin/main` f5e9d49) interactive
1067–1570 ms, медиана 120,5 fps, самый долгий кадр 10 ms; после — interactive 1093 ms, медиана
120,5 fps, самый долгий кадр 10 ms. Весь `epic-frame.spec.ts`, включая test-ы «рамка не ложится на
Orchestrator и HANDOFF», зелёный без правок.

**Снимки** — [04-без-перекрытий.png](../evidence/04-без-перекрытий.png): сверху Note, брошенный на
Card (светлая и тёмная тема), снизу рамка Epic-а со смещением на Card, нарисованная под ней. Сверены
с F-SPEC: Node-ы и рамка в своих токенах, зазор между ними виден, Card не сдвинута.

**След расширен** (с разрешения Orchestrator-а): два e2e вне следа краснели от самого правила.
`test/e2e/trash-undo.spec.ts` — фикстура тащила Note на Card, main ставил Note левее Card-а; Card
сдвинута с x 480 на x 620 (правее нельзя: окно 1280 px, и Card ушла бы за край), смысл test-ов тот
же. `test/e2e/palette-find.spec.ts` — «New terminal» в середине вида, где уже стоит Session Node;
проверка «в центре» заменена на «целиком в видимой части Canvas и в 16 px от Session Node».

**Круг доработки.** Сдвигаемый Node обходит и ещё не пройденные Node-ы на их местах: Node,
который ни с чем не конфликтовал, остаётся на месте (пример ревью: A, B поверх A, C в 16 px под A —
сдвинут только B). Test-ы — `test/unit/free-place.test.ts` (пример A/B/C, сетка из 500), contract
test на 500 Node-ах ждёт ровно 50 строк лога; мутант «обходить только пройденные» их краснит.

**Решено без владельца, подтвердить.**

1. Нормализация и поправка сдвигают и Node-ы, которые не перекрыты, но стоят ближе 16 px: правило
   решения 25 «зазор не меньше 16 px» действует и для сохранённых Layout-ов.
2. Дерево Subagent-ов уступает прежним правилом `clearShift` (только вправо и вниз, отступ 24 px);
   к препятствиям добавлены блоки деревьев раньше него. Рамка со смещением уступает в любую сторону
   с зазором 16 px, а не `FRAME_GAP` колонки.
3. Redo шлёт запрошенное место заново: если рядом за это время что-то встало, Node встанет на
   ближайшее свободное место сейчас, а не туда, куда встал в первый раз (ADR-0038, «Цена»).

**Не проверено:** пункт «(вручную) Stable copy после влития» — до влития его не проверить; строки
лога нормализации с Canvas-ов worfy и Auction — после пересборки Stable copy.
