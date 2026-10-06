# 10 — Рамки Epic не ложатся на Node-ы

Type: task
Status: done — 2026-10-06, [PR #53](https://github.com/IDSAD-XL/worfy/pull/53)
Blocked by: 06, 07, 08, 09
Source: [spec.md](../spec.md), тема C, риск 10; [ADR-0011](../../../docs/adr/0011-epic-frames-derived-nodes.md) — рамки Epic как производные Node-ы; [ADR-0003](../../../docs/adr/0003-cards-as-files-canvas-via-tools.md)

## Что делаем

Владелец видел массовое наложение рамок Epic на Node-ы.

**Почему так происходит (по коду):**

- Рамки Epic считает renderer. `stackFrames` (`src/renderer/canvas/epic-layout.ts:246-255`) кладёт
  их стопкой, начиная с точки (0,0). В Layout хранится только offset, а размер — `w=1, h=1`
  (`src/renderer/canvas/sources/epics.ts:142`).
- Main размера рамок не знает. `placeNewNode` (`src/main/layout/place.ts:23`) берёт точку (40,40),
  если её не занимает Node «на плоскости». Но `onThePlane` (`place.ts:14-16`) пропускает
  производные виды Node-ов, среди них `epic-frame` (`src/shared/layout/derived.ts:27`).
- Поэтому New session, Orchestrator и HANDOFF встают в (40,40) прямо поверх рамки. Места вызова:
  `src/main/agent/node-sessions.ts:74` и `:215`, `src/main/agent/orchestrator.ts:41`,
  `src/main/ipc/docs.ts:19`.
- `create_card` и `create_note` без x,y ставят Node справа от Node-а вызывающей Session:
  `src/main/mcp/canvas-server.ts:135-142` → `placeNear` (`src/shared/canvas/tools.ts:116`). Список
  Node-ов там (`canvas-server.ts:111`) тоже без рамок.
- Рамка становится выше, когда раскрывается стопка done (`epic-layout.ts:252`). Место, которое
  раньше выбрал main, при этом не пересматривается.
- Сами рамки тоже не обходят Node-ы: `stackFrames` начинает стопку с (0,0), что бы там ни лежало.
  Поэтому одной правки размещения новых Node-ов мало:
  - у Auction в сохранённом Layout Orchestrator и HANDOFF уже стоят в (40,40), и рамки ложатся на
    них при каждом открытии;
  - Ticket-ы приходят из `epic-status` асинхронно, уже после того как main поставил Orchestrator.
    В момент размещения рамок ещё нет, учитывать нечего.

**Решение до кода — ADR (номер с 0022): кто знает размер рамок и как рамки и Node-ы не
пересекаются.** Опора — ADR-0011. Два вопроса.

Кто знает размер рамок при размещении новых Node-ов:

- (а) main сам считает `layoutEpic`. Код чистый, но лежит в `src/renderer`: перенести его в
  `src/shared`.
- (б) renderer сохраняет настоящие w/h рамки в Layout.
- (в) размещение новых Node-ов переходит в renderer.

Как рамки обходят Node-ы, которые уже стоят:

- (г) стопка рамок встаёт в свою колонку, которая не пересекается с Node-ами на плоскости
  (например, левее самого левого из них). Рост рамки при раскрытии стопки done идёт вниз внутри
  колонки и на Node-ы не надвигается.
- (д) рамки остаются от (0,0), а Node на плоскости, который оказался под рамкой, переносится из-под
  неё.

Предложение — (г) для размещения рамок и (д) только для остатка: Node, который всё равно лежит под
рамкой (например, под рамкой с ручным смещением пользователя).

**Правки:**

- Размещение рамок (`stackFrames`) учитывает прямоугольники Node-ов на плоскости и не начинается
  слепо с (0,0). Она пересчитывается на каждое `workflow.changed`, поэтому Ticket-ы, пришедшие после
  Orchestrator-а, тоже обходят его.
- Рост рамки при раскрытии стопки done не надвигает её на Node-ы. Механизм выбирает ADR: колонка
  рамок по (г) или перенос Node-а по (д).
- Перенос из сохранённого Layout. Node на плоскости, который при открытии Project лежит под рамкой
  (Auction: Orchestrator и HANDOFF в (40,40)), переносится вне рамок один раз. Перенос — обычная
  операция `move` в Layout worfy (dataRoot), не запись в репозиторий Project. Ручное смещение рамки
  пользователем сохраняется.
- `placeNewNode` и `placeNear` учитывают прямоугольники рамок Epic.
- Точка (40,40) остаётся, если она свободна. Так задумано: Node виден при viewport по умолчанию, и
  test `layout-place` это фиксирует.
- Контракт `create_card` / `create_note` с явными x,y не меняется.

**Что известно из ручных проверок 2026-10-06, ночь** (номера Ticket-ов — `worfy-mvp`): рамка
рисуется поверх Node-а, а не только занимает его место. Рамка `worfy-daily` перехватывает двойной
щелчок по Node-у Orchestrator-а (Ticket 33), свёрнутая рамка закрывает его заголовок, а Terminal,
созданный щелчком над свёрнутой рамкой, оказался под ней (Ticket 27).

## Готово, когда

- [x] ADR о размере рамок и об обходе Node-ов принят. После него «Где в коде» и строка Ticket-а в таблице Wave-ов `spec.md` сокращены до файлов выбранного варианта. — ADR-0032 принят исполнителем, ждёт подтверждения владельца.
- [x] New session при рамке Epic в (0,0) встаёт вне рамки. Без рамок — в (40,40), как раньше. — Node встаёт по правилу `placeNewNode`, колонка рамок уходит из-под него; `test/e2e/new-session.spec.ts`.
- [x] `create_card` и `create_note` без x,y не перекрывают рамку. С явными x,y Node стоит ровно там, где сказано. — заменено ADR-0032: `placeNear` и контракт tool-ов не меняются, Card встаёт по-старому, а колонка рамок уходит из-под неё при пересчёте; `test/unit/epic-layout.test.ts` («moves out of the way of a Card placed next to a Session»).
- [x] Project с Epic-ами при первом открытии: рамки не перекрывают Orchestrator и HANDOFF. e2e проверяет: пересечение их boundingBox равно 0.
- [x] Ticket-ы приходят после того, как Orchestrator уже стоит в (40,40): рамки всё равно его не перекрывают. e2e задерживает ответ `epic-status`.
- [x] Сохранённый Layout, где Orchestrator и HANDOFF стоят в (40,40) под будущей рамкой: после открытия Project пересечение равно 0, и новое положение сохранено в Layout. — заменено ADR-0032: Node-ы не переносятся, уходит колонка рамок; e2e проверяет пересечение 0 и что Layout не изменился.
- [x] Раскрытие стопки done не надвигает рамку на Node-ы, поставленные раньше. e2e проверяет то же пересечение после раскрытия.
- [x] Снимки Canvas с Epic-ами и новыми Node-ами в светлой и тёмной теме сверены с F-SPEC.
- [ ] (вручную) Открыть Auction на стабильной копии: рамки не лежат на Orchestrator и HANDOFF. Снимок — в «Итог». — не проверено: стабильная копия собирается из `main`, а правка ещё в ветке PR #53; пересобирать стабильную копию бриф запретил.

## Тесты

- `test/unit/layout-place.test.ts` — `placeNewNode` с прямоугольником рамки.
- `test/unit/epic-layout.test.ts` — `stackFrames` с прямоугольниками Node-ов на плоскости; рост рамки при раскрытии стопки done.
- `test/contract/canvas-tools.test.ts` — `create_card` / `create_note` рядом с рамкой (`:223-250`).
- `test/e2e/new-session.spec.ts` — New session при открытой рамке.
- `test/e2e/epic-frame.spec.ts` — Orchestrator и HANDOFF не под рамками, в том числе после раскрытия стопки done.
- Сначала падающий test: при рамке Epic (0,0)–(800,600) `placeNewNode` всё равно отдаёт (40,40).

## Где в коде

Сокращено по [ADR-0032](../../../docs/adr/0032-epic-frames-avoid-nodes.md): колонка рамок обходит
Node-ы на плоскости в renderer, main размещает Node-ы без размера рамок.

- `src/shared/layout/derived.ts` — правило «Node на плоскости» (`onThePlane`), общее для main и renderer
- `src/main/layout/place.ts` — берёт `onThePlane` из `derived.ts`
- `src/renderer/canvas/epic-layout.ts` — `frameColumnX`, `stackFrames` с прямоугольниками Node-ов
- `src/renderer/canvas/sources/epics.ts` — запас под открытую стопку done, `publishPlaneRects`
- `src/renderer/canvas/sources/subagents.ts` — публикует прямоугольники Node-ов Subagent-ов
- `test/unit/epic-layout.test.ts`
- `test/unit/epic-canvas.test.tsx`
- `test/unit/subagent-nodes.test.tsx`
- `test/e2e/new-session.spec.ts`
- `test/e2e/epic-frame.spec.ts`
- `test/e2e/subagent-tree.spec.ts`
- `docs/adr/0032-epic-frames-avoid-nodes.md`

## Итог

PR #53, ветка `worfy-daily/10`. Решение — [ADR-0032](../../../docs/adr/0032-epic-frames-avoid-nodes.md)
(принято исполнителем, ждёт подтверждения владельца).

- Рамки Epic-ов стоят в одной колонке. Её левый край — первое место от `x = 0` вправо, где полоса
  шириной самой широкой рамки и высотой стопки (с запасом под открытую стопку done) не задевает
  ни Node Layout-а на плоскости, ни Node Subagent-а (`frameColumnX`, `stackFrames` в
  `src/renderer/canvas/epic-layout.ts`).
- Main размещает Node-ы по-старому, без размера рамок: (40, 40), если свободно. Node-ы пользователя
  не переносятся, Layout при открытии Project-а не меняется.
- Правило «Node на плоскости» общее для main и renderer: `onThePlane` в
  `src/shared/layout/derived.ts`. Дерево Subagent-ов публикует свои прямоугольники
  (`publishPlaneRects`), колонка их учитывает.
- Цена: колонка прыгает вправо, когда в полосу встаёт новый Node; запас под открытую стопку done
  держит место и при свёрнутой стопке. Подробно — ADR-0032, раздел «Цена».
- Тесты: `test/unit/epic-layout.test.ts`, `test/unit/epic-canvas.test.tsx`,
  `test/unit/subagent-nodes.test.tsx`, `test/e2e/epic-frame.spec.ts`, `test/e2e/new-session.spec.ts`,
  `test/e2e/subagent-tree.spec.ts`. Каждое новое поведение краснеет на своём мутанте.
- Снимки Canvas в светлой и тёмной теме (рамка `demo` правее Orchestrator-а и HANDOFF, стопка done
  открыта) сделаны на e2e-фикстуре и сверены с F-SPEC глазами: токены цветов и вид рамки не
  менялись, менялось только положение. Снимки проверяющего после круга доработки:
  [10-canvas-subagents-frame-light.png](../evidence/10-canvas-subagents-frame-light.png), [10-canvas-subagents-frame-dark.png](../evidence/10-canvas-subagents-frame-dark.png) — рамка Epic
  правее дерева Subagent-ов, колонка его не накрывает.
- Не проверено: Auction на стабильной копии (пункт выше).
