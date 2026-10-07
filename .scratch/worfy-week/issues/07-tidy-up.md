# 07 — «Tidy up»: Node-ы пользователя раскладываются без перекрытий, один ⌘Z отменяет

Type: task
Status: done — 2026-10-07, [PR #90](https://github.com/IDSAD-XL/worfy/pull/90)
Blocked by: 03, 04
Source: решения владельца 2026-10-07, вопросы 19, 25 и 28 ([spec.md](../spec.md), раздел «Решения владельца по Canvas»); [spec.md](../spec.md), этап 2

## Что происходит

- Разложить Canvas можно только руками. Палитра команд (⌘K, `src/renderer/palette/commands.ts`) и
  контекстное меню Canvas (`src/renderer/canvas/overlays/CanvasMenu.tsx`) создают Node-ы и ведут к
  ним, но не раскладывают.
- Палитра живёт вне React Flow. Изменения Layout-а она передаёт Canvas-у запросом
  (`src/renderer/find/canvas-requests.ts`), а выполняет их `src/renderer/find/CanvasFind.tsx` через
  `LayoutOps` Canvas-а — так «New …» из палитры попадает в историю ⌘Z (`CanvasFind.tsx:109`).
- После Ticket-ов 03 и 04 есть worker ELK (`src/renderer/canvas/elk/`) и групповое перемещение —
  одна операция Layout, которую main проверяет целиком, а ⌘Z отменяет одним шагом.

## Что делаем

1. **Команда «Tidy up»** (решение 19) — в палитре ⌘K, в группе `Action`, и пунктом контекстного
   меню Canvas (правый щелчок по пустому месту) под пунктами «New …», через разделитель.
2. **Что раскладывается** (решение 25): Node-ы Layout-а на плоскости — Session, Card, Note,
   Terminal, Orchestrator, HANDOFF. Закреплённые и скрытые Node-ы не трогаются. Session вместе со
   своим деревом Subagent-ов — один прямоугольник: дерево висит справа от Session (Ticket 03). Рамки
   Epic-ов «Tidy up» не двигает: их колонка сама уходит от Node-ов
   ([ADR-0032](../../../docs/adr/0032-epic-frames-avoid-nodes.md)), смещения рамок не меняются.
3. **Как** (решение 28): ELK rectpacking (`org.eclipse.elk.rectpacking`) в worker-е Ticket-а 03.
   Порядок входа — порядок чтения по нынешним местам: сверху вниз, слева направо. Промежуток между
   прямоугольниками — 24 px, это три шага сетки Ticket-а 06 и больше зазора 16 px. Раскладка
   начинается в левом верхнем углу прямоугольника, который охватывает раскладываемые Node-ы сейчас.
   Углы — на сетке 8 px, размеры Node-ов не меняются.
4. **Один шаг истории.** Новые места уходят одной групповой операцией Ticket-а 04 через `LayoutOps`
   Canvas-а: из меню — напрямую, из палитры — запросом, который выполняет `CanvasFind.tsx`, как «New …».
   Один ⌘Z возвращает все места, ⇧⌘Z раскладывает снова.
5. **Ничего лишнего.** Повторный «Tidy up» сразу после первого операцию не отправляет. С нулём или
   одним Node-ом команда ничего не делает.

## Готово, когда

- [x] Unit `test/unit/tidy.test.ts`: фикстура из 12 разбросанных Node-ов — Session с деревом из трёх Subagent-ов, Card-ы, Note-ы, Terminal, закреплённый Node, скрытый Node. После «Tidy up» никакие два участника не ближе 16 px; закреплённый и скрытый на месте; дерево Subagent-ов не лежит на соседях; размеры прежние; углы на сетке 8 px; Node-ы идут в порядке чтения.
- [x] Unit: повторный «Tidy up» на результате не отправляет операцию.
- [x] Unit `test/unit/palette-commands.test.tsx`: команда «Tidy up» есть в палитре, её запуск оставляет Canvas-у запрос.
- [x] Unit `test/unit/canvas-menu.test.tsx`: пункт «Tidy up» в контекстном меню Canvas, под пунктами «New …».
- [x] e2e `test/e2e/tidy-up.spec.ts`: Canvas с разбросанными Node-ами → «Tidy up» из ⌘K → Node-ы стоят плотно и без перекрытий; один ⌘Z возвращает каждое место до единицы; ⇧⌘Z раскладывает снова. То же из контекстного меню.
- [x] Расчёт вне главного потока: Canvas из 200 Node-ов раскладывается не дольше 2 с от команды до последнего места на экране; e2e печатает время и проверяет предел.
- [x] Бюджет `test/e2e/epic-frame.spec.ts:779` держится.
- [x] Снимки в светлой и тёмной теме (helper `test/e2e/snapshots.ts`) до и после «Tidy up» на фикстуре e2e; пункт меню и строка палитры выглядят как соседние. Сверены с F-SPEC; ссылка из «Итог» — `../evidence/07-tidy-up.png`.
- [x] (вручную) Stable copy после влития: «Tidy up» на Canvas Project-а worfy — Node-ы без перекрытий, рамки справа от них, ⌘Z возвращает всё. Как проверить: окно приложения.
  Проверено 2026-10-07 на Stable copy из 6df9791 — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).

## Тесты

Сначала падающий test — `test/unit/palette-commands.test.tsx`: test ищет в палитре команду «Tidy
up». На нынешнем main её нет — test падает. В «Итог» — как он падал.

- `test/unit/tidy.test.ts` — новый: что раскладывается, без перекрытий, порядок, сетка, повтор.
- `test/unit/palette-commands.test.tsx` — команда и запрос Canvas-у.
- `test/unit/canvas-menu.test.tsx` — пункт меню.
- `test/e2e/tidy-up.spec.ts` — новый: палитра, меню, ⌘Z и ⇧⌘Z, время на 200 Node-ах.

В test-ах jsdom нет Worker-а: rectpacking вызывается напрямую, с ELK без worker-а, как в test-ах
Ticket-а 03.

## Где в коде

- `src/renderer/canvas/tidy.ts` — новый: что раскладывается, вход и выход rectpacking, групповая операция
- `src/renderer/canvas/elk/`
- `src/renderer/canvas/overlays/CanvasMenu.tsx`
- `src/renderer/palette/commands.ts`
- `src/renderer/find/canvas-requests.ts`
- `src/renderer/find/CanvasFind.tsx`
- `test/unit/tidy.test.ts` — новый
- `test/unit/palette-commands.test.tsx`
- `test/unit/canvas-menu.test.tsx`
- `test/e2e/tidy-up.spec.ts` — новый

`history.ts` этот Ticket не меняет: один шаг ⌘Z даёт групповая операция Ticket-а 04, а её обратную
операцию заводит 04. Поэтому прямого ребра к Ticket-у 02 нет: 04 сам ждёт 02. Общих файлов с
Ticket-ом 06 нет, он в той же Wave.

## Итог

Сделано в ветке `worfy-week/07`, база `origin/main` 11b0b2b. ADR не заводился: решение 28 и
ADR-0037/0038 его покрывают.

**Влито.** [PR #90](https://github.com/IDSAD-XL/worfy/pull/90), merge bc38674. Ревью — VERIFIED с первого
круга, без доработки. Перед мержем ветка перебазирована на `origin/main` 11b0b2b, head 5a382ce:
`GATE_SCOPE=all gate.sh full` — exit 0, CI — зелёный.

**Как падал первый test.** `test/unit/palette-commands.test.tsx`, «has Tidy up in the Action
group…»: на `origin/main` в палитре нет команды `tidy-up`, `expect(tidy).toMatchObject({ group:
'Action', title: 'Tidy up' })` получал `undefined`.

**Что сделано.**

- `src/renderer/canvas/tidy.ts` — новый. `tidyItems`: участники — Node-ы Layout-а на плоскости
  (`onThePlane`), закреплённые и скрытые не трогаются, рамки Epic-ов не участвуют. Session с деревом
  Subagent-ов — один прямоугольник: дерево берётся там, где оно висит без помех
  (`placeSubagents` без `around`, `naturalTreeBlocks`), поэтому после раскладки оно ни от кого не
  уходит и повторный «Tidy up» видит те же прямоугольники. `tidyOperation`: порядок чтения по
  нынешним местам (y, потом x), размеры вверх до сетки 8 px, промежуток 24 px, начало — левый
  верхний угол охватывающего прямоугольника на сетке; результат — один `moveMany` со всеми
  участниками или ничего, если все уже на месте или участников меньше двух. `runTidyUp`: один
  запуск на Project за раз; если Node-ы сдвинулись, пока ELK считал, раскладка считается заново (до
  трёх раз); ошибка ELK — ничего не двигается. `useTidyUp` — то же через `LayoutOps` Canvas-а, то есть
  один шаг ⌘Z.
- `src/renderer/canvas/elk/pack.ts` — новый: граф `rectpacking` со стратегией `SIMPLE`. Стратегия по
  умолчанию (`COMPACTION`) складывает прямоугольники внутри ряда и меняет порядок: на 200 случайных
  наборах в 77 повторная раскладка давала другой ответ; `SIMPLE` — 0 из 200, порядок входа равен
  порядку чтения ответа. `elk/client.ts` отдаёт свой worker наружу (`elkEngine`): один worker на окно.
- Палитра: команда `Tidy up` в группе `Action` после «New …»; запуск оставляет запрос
  `requestTidyUp` (`find/canvas-requests.ts`), его выполняет `find/CanvasFind.tsx`
  (`useTidyRequests`). Меню Canvas: под пунктами «New …» разделитель и «Tidy up», вызывает
  `useTidyUp` напрямую.
- Main не менялся: `moveMany` проверяет группу целиком; в группе все участники, препятствий вне неё
  нет, поэтому поправка ADR-0038 места не меняет. Обратная операция — `moveMany` со старыми местами
  (Ticket 04), ⇧⌘Z шлёт раскладку заново.

**Отступление от следа.** Unit-test лежит в `test/unit/tidy.test.tsx`, а не `tidy.test.ts`:
`tidy.ts` тянет React, источник Node-ов Subagent-ов и типы из `.tsx`, а проект типов
`tsconfig.test.node.json` перечисляет файлы renderer-а поштучно и `.tsx` исключает. Поэтому в test-е
нет `LayoutStore` из main (он вне проекта типов jsdom); вместо него — заменитель, который
поправляет `moveMany` той же общей функцией `freeShift`, что и main. Настоящий main проверяет e2e.

**Проверки.** `pnpm lint && pnpm typecheck && pnpm test` — код 0 (120 файлов, 2129 test-ов);
`gate.sh fast` — код 0, «зелено»; `GATE_SCOPE=all gate.sh full` — код 0, «зелено» (lint, typecheck,
test, test:e2e, test:package), в том числе бюджет Project-а размера Auction
(`test/e2e/epic-frame.spec.ts`, test «an Auction-sized Project is interactive within 3 s…», сейчас
строка 885). e2e `test/e2e/tidy-up.spec.ts`: 200 Node-ов — 92 ms от Enter в палитре до последнего
места на экране (предел 2000 ms).

**Снимки.** После раскладки, светлая тема — [07-tidy-up.png](../evidence/07-tidy-up.png), тёмная —
[07-tidy-up-dark.png](../evidence/07-tidy-up-dark.png); до —
[07-tidy-up-before.png](../evidence/07-tidy-up-before.png),
[07-tidy-up-before-dark.png](../evidence/07-tidy-up-before-dark.png); меню —
[07-tidy-up-menu.png](../evidence/07-tidy-up-menu.png),
[07-tidy-up-menu-dark.png](../evidence/07-tidy-up-menu-dark.png); палитра —
[07-tidy-up-palette.png](../evidence/07-tidy-up-palette.png),
[07-tidy-up-palette-dark.png](../evidence/07-tidy-up-palette-dark.png). Пункт меню — та же строка
`w-row` 28 px, что «New terminal», разделитель — линия 1 px цвета `--border` (F-SPEC: «compact 28px
rows», «hairline 1px borders»). Строка палитры — как «New session»: заголовок и пояснение, метка
`Action`. Закреплённая Note на снимке лежит поверх Card-а: закреплённый Node — слой поверх экрана и
не участник (решение 25), так и задумано.

**Решено без владельца, подтвердить.** Пояснение строки палитры — «lay out the Nodes without
overlaps»; запрос из палитры, пришедший, пока идёт прежний «Tidy up», отбрасывается.

**Долг** (все low, из вердикта ревью).

- На Canvas больше чем с 5000 собственных Node-ов «Tidy up» молча ничего не делает: main отклоняет
  `moveMany` сверх `MOVES_PER_OP_MAX` (`src/shared/layout/types.ts:34`), а `src/renderer/canvas/tidy.ts:138-141`
  только пишет в лог — ни сообщения, ни разбиения на части.
- На снимке «после» (`07-tidy-up.png`) закреплённая Note закрывает Card, поэтому снимок слабо показывает
  «без перекрытий на экране».

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M24 второго круга ручных проверок). Stable copy из 6df9791
(pid 2455, CDP 9351), Canvas Project-а CanvasForAI (выбран через `projects.select`, Node-ы при этом
не изменились). Копия `layout.json` до проверки сохранена.

- Палитра открыта ⌘K. При русской раскладке нужен key code 40: keystroke «k» палитру не открывает, а
  выделяет текст (особенность автоматизации; Layout от этого не изменился). «Tidy up» → Enter в 08:13Z.
- Сдвинулись все Node-ы Layout-а. В store React Flow 46 прямоугольников: Node-ы, 15 Subagent-ов и 3
  рамки. Пересечений 0, минимальный зазор 24 px (до этого 16). Рамки правее Node-ов: левый край рамок
  не меньше 1849, правый край Node-ов не больше 1812.
- Один ⌘Z: разница x, y по id пуста, `.nodes` полностью совпадают с копией до проверки, снимок после
  ⌘Z совпадает со снимком до. Viewport владельца возвращён.
- Вердикт: проверено.
- Снимки (в scratchpad Session Orchestrator-а, в репозиторий не положены): `M24-before.png`,
  `M24-before-bottom.png`, `M24-palette.png`, `M24-after.png`, `M24-undo.png`, `M24-final.png`.
