# 07 — «Tidy up»: Node-ы пользователя раскладываются без перекрытий, один ⌘Z отменяет

Type: task
Status: open
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

- [ ] Unit `test/unit/tidy.test.ts`: фикстура из 12 разбросанных Node-ов — Session с деревом из трёх Subagent-ов, Card-ы, Note-ы, Terminal, закреплённый Node, скрытый Node. После «Tidy up» никакие два участника не ближе 16 px; закреплённый и скрытый на месте; дерево Subagent-ов не лежит на соседях; размеры прежние; углы на сетке 8 px; Node-ы идут в порядке чтения.
- [ ] Unit: повторный «Tidy up» на результате не отправляет операцию.
- [ ] Unit `test/unit/palette-commands.test.tsx`: команда «Tidy up» есть в палитре, её запуск оставляет Canvas-у запрос.
- [ ] Unit `test/unit/canvas-menu.test.tsx`: пункт «Tidy up» в контекстном меню Canvas, под пунктами «New …».
- [ ] e2e `test/e2e/tidy-up.spec.ts`: Canvas с разбросанными Node-ами → «Tidy up» из ⌘K → Node-ы стоят плотно и без перекрытий; один ⌘Z возвращает каждое место до единицы; ⇧⌘Z раскладывает снова. То же из контекстного меню.
- [ ] Расчёт вне главного потока: Canvas из 200 Node-ов раскладывается не дольше 2 с от команды до последнего места на экране; e2e печатает время и проверяет предел.
- [ ] Бюджет `test/e2e/epic-frame.spec.ts:779` держится.
- [ ] Снимки в светлой и тёмной теме (helper `test/e2e/snapshots.ts`) до и после «Tidy up» на фикстуре e2e; пункт меню и строка палитры выглядят как соседние. Сверены с F-SPEC; ссылка из «Итог» — `../evidence/07-tidy-up.png`.
- [ ] (вручную) Stable copy после влития: «Tidy up» на Canvas Project-а worfy — Node-ы без перекрытий, рамки справа от них, ⌘Z возвращает всё. Как проверить: окно приложения.

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
