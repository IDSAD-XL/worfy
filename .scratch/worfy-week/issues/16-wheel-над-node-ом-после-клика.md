# 16 — Wheel над Node-ом двигает Canvas; прокрутка содержимого — только после клика по Node-у

Type: task
Status: done 2026-10-07
PR: #123
Blocked by: —
Source: замечание владельца 2026-10-07 («если курсор стоит на некоторых нодах типа оркестратора или handoff, то свайпами двумя пальцами не работает перемещение. с handoff понятно, потому что там скролл, поэтому возможность скроллить нужно сделать только после клика на ноду»); [spec.md](../spec.md), этап 3

## Что происходит

Canvas двигается wheel-ом и свайпом двумя пальцами (`panOnScroll`), zoom — ⌘+wheel и pinch
(`src/renderer/canvas/Canvas.tsx:426-428`; pinch на macOS — wheel с `ctrlKey`). Обработчик React Flow
стоит на `.react-flow__renderer` и ловит wheel, всплывающий из Node-ов.

- Если target внутри `.nowheel`, обработчик pan-on-scroll выходит сразу, а при `ctrlKey` только
  гасит zoom страницы (`@xyflow/system`, `dist/esm/index.js:2766-2770`). Обработчик ⌘+wheel для
  `.nowheel` тоже ничего не делает (`:2819-2833`).
- `nowheel` стоит постоянно, от выделения не зависит:
  - HANDOFF — тело с прокруткой (`src/renderer/canvas/nodes/HandoffNode.tsx:97`): wheel прокручивает
    текст, pinch ничего не делает, ⌘+wheel прокручивает вместо zoom;
  - Orchestrator — блок состояния на почти весь Node (`OrchestratorNode.tsx:142`). Четыре строки
    помещаются, прокручивать нечего: над блоком wheel, pinch и ⌘+wheel не делают ничего. Это
    «мёртвая зона» из замечания;
  - Note — textarea на всю высоту Node-а (`NoteNode.tsx:74`), как HANDOFF;
  - Session — ответ `<pre>` с прокруткой (`SessionNode.tsx:293`), тот же путь, что у HANDOFF.
- Card — iframe (`CardNode.tsx:155-167`). Страница Card-а на другом origin: wheel, pinch и ⌘+wheel
  получает она, окно worfy их не видит. Мышь у iframe отключается только на время нажатия, drag,
  resize или pan (`src/renderer/canvas/canvas.css:26-31`).
- Terminal — экран `nodrag nowheel nopan nokey` (`TerminalNode.tsx:242`). xterm ловит wheel на своих
  элементах раньше React Flow; в alt buffer (less, vim) превращает wheel в стрелки ↑/↓ программе.
- Ticket, Subagent и рамка Epic-а без `nowheel`: над ними wheel двигает Canvas.
- Замер на своей сборке: над заголовком Orchestrator wheel сдвигает viewport на 60 px, над блоком
  состояния, телом HANDOFF, textarea Note, Card и Terminal — нет. После клика внутрь Node-а —
  то же самое.

## Что делаем

Понятие «активный Node» и один wheel router для всех Node-ов. Сами Node-ы не меняются, кроме Card.

1. **Активный Node.** `activeNodeId` в `Canvas.tsx` (плюс ref для обработчиков). Активен Node, у
   которого `activeNodeId === id` и `selected`: любое снятие выделения средствами React Flow
   деактивирует его само.
   - Ставит `onNodeClick` без модификаторов. После drag клик подавлен, поэтому drag и выделение
     рамкой Node не активируют.
   - Снимают: клик по пустому Canvas (`onPaneClick`); pointerdown вне активного Node-а (window,
     capture phase); Esc на window в bubble phase при `!defaultPrevented`. Esc с фокусом внутри
     `.w-terminal` активность не снимает: там Esc нужен shell-у.
   - Вид: класс `w-node--active` на объекте только активного Node-а, под `useMemo` по
     [nodes, activeNodeId] — не новые объекты всех Node-ов на каждый кадр drag. Отдельный стиль
     рядом с кольцом выделения (`canvas.css:34`): кольцо 2 px `--accent` вместо 1 px. Выделенный, но
     не активный Node (рамкой, ⌘-кликом, после drag) выглядит как сейчас.
2. **Wheel router** — `src/renderer/canvas/wheel-router.ts`: чистая функция решения и установка
   listener-а на обёртку `.w-canvas` (`Canvas.tsx:412`, ref `wrapper` на `:175`) в capture phase,
   `{ passive: false }`, — раньше xterm и нативной прокрутки. Правило:
   - target не внутри `.react-flow__node` или на пути до Node-а нет `.nowheel` → не вмешиваться;
   - pinch (`ctrlKey`) или ⌘+wheel (`metaKey`) → Canvas;
   - Node не активен → Canvas;
   - Node активен, Terminal → содержимое;
   - Node активен, ближайший `.nowheel` переполнен (`scrollHeight > clientHeight` или
     `scrollWidth > clientWidth`) → содержимое; у края прокрутки жест остаётся у содержимого;
   - Node активен, прокручивать нечего → Canvas (так у Orchestrator-а нет мёртвой зоны и после
     клика).

   «Canvas» — `preventDefault()` и `stopPropagation()` исходного события, затем
   `dispatchEvent(new WheelEvent('wheel', …))` на `.react-flow__renderer` с теми же
   deltaX/deltaY/deltaMode/ctrlKey/metaKey/shiftKey. React Flow сам применит скорость, zoom вокруг
   курсора и `onMoveEnd`, так что сохранение viewport не меняется. clientX/clientY — через getter
   `MouseEvent.prototype`: над Terminal `terminal-mouse.ts` подменяет их на событии
   (`src/renderer/canvas/nodes/terminal-mouse.ts:53-54`).
3. **Card.** Правило в `canvas.css` рядом с `:26-31`:
   `.w-canvas .react-flow__node:not(.w-node--active) iframe { pointer-events: none; }`. Wheel над
   неактивной Card попадает на тело Node-а и двигает Canvas; первый клик активирует Card и до её
   страницы не доходит. Телу Card (`CardNode.tsx:187`) — класс `nodrag`: иначе d3-drag при сдвиге
   мыши на 1 px гасит click (`nodeClickDistance` 0), и `onNodeClick` не срабатывает. Focus mode
   правило не задевает: плитки рисуются вне `.w-canvas`.
4. **Terminal.** Router в capture phase не пускает wheel к xterm, пока Terminal не активен: ни
   прокрутки, ни стрелок в less/vim. Активный Terminal получает обычный wheel.
5. `nowheel` теперь значит «в активном Node-е эта область прокручивается сама»; комментарий
   `HandoffNode.tsx:96` — об этом.

**Решено без владельца, подтвердить:**

- Card до клика не получает мышь вовсе: hover на её странице не работает, первый клик только
  активирует. Вариант дороже — runtime Card-а пересылает wheel в окно через postMessage, Card
  кликабельна с первого раза.
- Pinch внутри активной Card принадлежит Card: iframe забирает `ctrl`+wheel, и до окна он не
  доходит. Пересылка через runtime Card-а — отдельный Ticket, если понадобится.
- Активный Node, которому нечего прокручивать, отдаёт wheel Canvas-у; докрученный до края — не
  отдаёт (без scroll chaining). Terminal строгий всегда.

## Готово, когда

- [x] Unit `test/unit/wheel-router.test.ts`: функция решения на все ветки правила пункта 2, в том числе Session (`.nowheel` у ответа — тот же путь, что у HANDOFF; в e2e Session нет) и активный Node без переполнения.
- [x] e2e `test/e2e/wheel-over-nodes.spec.ts` (локально, в gate full): для HANDOFF, Note, Card и Terminal до клика wheel над содержимым меняет transform `.react-flow__viewport`, прокрутка содержимого прежняя (у Card — счётчик wheel страницы, у Terminal — верхняя строка `.xterm-rows`). После клика у Node-а класс `w-node--active`, тот же wheel прокручивает содержимое, viewport стоит. Для Terminal wheel вверх (`wheel(0, -120)`): после вывода он уже внизу.
- [x] Тот же spec: Orchestrator с блоком без переполнения — wheel над блоком двигает viewport и до клика, и после.
- [x] Тот же spec: pinch (`Control` + wheel) над активными HANDOFF, Note и Terminal меняет scale Canvas; над активной Card — scale прежний, счётчик wheel страницы растёт. ⌘+wheel над активным Terminal с фокусом в xterm меняет scale.
- [x] Тот же spec: Esc снимает активность у HANDOFF и Note, у Terminal — нет; клик по пустому Canvas снимает у всех; после этого wheel снова двигает Canvas.
- [x] Тот же spec: неактивный Terminal с программой в alt buffer (`printf '\033[?1049h'; cat -v`) после wheel не показывает `^[[A`/`^[[B`; активный — показывает.
- [x] Тот же spec: в Focus mode тело HANDOFF в плитке прокручивается от wheel.
- [x] e2e `test/e2e/card-drag.spec.ts` зелёный: helper `clickReachesCard` (`:138`) сначала кликом активирует Card, потом проверяет, что клик дошёл до страницы.
- [x] Прежние e2e зелёные: `test/e2e/canvas-layout.spec.ts`, `test/e2e/terminal.spec.ts`, `test/e2e/focus.spec.ts`, `test/e2e/handoff.spec.ts`, `test/e2e/orchestrator.spec.ts`.
- [x] Снимки активного и выделенного неактивного Node-а в светлой и тёмной теме (helper `test/e2e/snapshots.ts`); ссылка из «Итог» — `../evidence/16-активный-node.png`.
- [x] `pnpm lint`, `pnpm typecheck` и `pnpm test` — exit 0.
- [ ] (вручную) Stable copy после влития, trackpad: свайп двумя пальцами над Orchestrator, HANDOFF, Card и Terminal двигает Canvas до клика и прокручивает содержимое после (Orchestrator — двигает и после); pinch зумит Canvas над любым Node-ом, кроме активной Card. Как проверить: окно приложения.

## Тесты

Сначала падающий test — `test/e2e/wheel-over-nodes.spec.ts`: на нынешнем main шаг «до клика wheel
двигает Canvas» красный для всех пяти типов. В «Итог» — как падал.

- `test/e2e/wheel-over-nodes.spec.ts` — новый. Fixture: HANDOFF.md на 80 строк; Layout с Note на 60
  строк, Card со страницей 3000 px и счётчиком wheel в `body[data-wheels]`, Terminal; вывод Terminal
  — `seq` через IPC `terminal.input`; fake-агент `WORFY_AGENT_SCRIPT=orchestrator` для блока
  состояния. Viewport читать как `viewportTransform` в `test/e2e/card-drag.spec.ts:117-118`.
- `test/unit/wheel-router.test.ts` — новый.
- `test/e2e/card-drag.spec.ts` — helper `clickReachesCard`.

## Где в коде

- `src/renderer/canvas/Canvas.tsx`
- `src/renderer/canvas/wheel-router.ts` — новый
- `src/renderer/canvas/canvas.css`
- `src/renderer/canvas/nodes/CardNode.tsx`
- `src/renderer/canvas/nodes/HandoffNode.tsx`
- `test/unit/wheel-router.test.ts` — новый
- `test/e2e/wheel-over-nodes.spec.ts` — новый
- `test/e2e/card-drag.spec.ts`
- `tsconfig.test.node.json` — правка вне следа, разрешённая оркестратором 2026-10-07: строка
  `src/renderer/canvas/wheel-router.ts` в `include`, чтобы unit test в проекте node проходил typecheck
  (как у `snapping.ts` и `history.ts`).

Остальные Node-ы (`OrchestratorNode.tsx`, `NoteNode.tsx`, `SessionNode.tsx`, `TerminalNode.tsx`) и
`terminal-mouse.ts` не меняются: решение принимает router. Overlay-и с `nowheel` — не Node-ы, router
их не трогает. Общих файлов с Ticket-ами 13, 14 и 17 нет. Ticket 15 тоже вводит Esc на Canvas и
идёт Wave-ой позже: его Esc срабатывает, только когда выделение пусто.

## Итог

**Влито.** [PR #123](https://github.com/IDSAD-XL/worfy/pull/123), merge 12faaee. Ревью — VERIFIED с
первого круга, без доработки: двойной прокрутки нет, listener снимается при unmount, правило iframe
Ticket-а 09 и snapping/resize Ticket-а 06 целы; остальные изменения поведения требует тикет (⌘+wheel
зумит, первый клик активирует Card, неактивный Terminal не получает wheel). Перед мержем ветка
перебазирована на `origin/main` e566ec2, head 93d9cc9: `GATE_SCOPE=all gate.sh full` — exit 0 (прогон
ниже, в «Проверки», — до rebase), CI — зелёный.

- **Активный Node** — `Canvas.tsx`: `activeNodeId` и ref; ставит `onNodeClick` без модификаторов, снимают
  `onPaneClick`, pointerdown вне активного Node-а (window, capture), Esc на window (кроме фокуса в
  `.w-terminal`) и снятие выделения средствами React Flow (изменение `select` в `onNodesChange`: выделенный
  потом рамкой или клавиатурой Node активным не становится). Класс `w-node--active` получает только объект
  активного Node-а. Кольцо 2 px — `canvas.css`, в том числе у закреплённого Node-а (`.w-pinned-frame`).
- **Wheel router** — `wheel-router.ts`: `routeWheel` (решение) и `routeWheels` (listener на `.w-canvas`,
  capture, `passive: false`; копия события уходит на `.react-flow__renderer`, clientX/clientY — getter-ом
  `MouseEvent.prototype`). Модуль не называет типов DOM, как `card-bridge.ts`: unit test гоняет его на
  простых объектах в проекте node.
- **Card** — правило `:not(.w-node--active) iframe { pointer-events: none }`; телу Card `nodrag` дан только
  когда рисуется страница (`live`): заглушка при zoom < 0.4 по-прежнему тянет Node.
- **Как падал test первым** (на коде origin/main 3bf0abb): `wheel-over-nodes.spec.ts` — 5 из 6 красные; шаг
  «до клика wheel двигает Canvas» над телом HANDOFF — `Expected: not "translate(20px, 20px) scale(1)"`
  (viewport стоял), над Terminal в alt buffer — то же; остальные — нет класса `w-node--active`. Focus mode
  зелёный и до правки (так и должно быть).
- **e2e-наблюдение:** страница Card — в другом процессе; окно отдаёт ей мышь только после кадра без
  `pointer-events: none`. Клик сразу за активацией (в тот же кадр) до страницы не доходит; test-ы ждут два
  кадра (`clickReachesCard`, `expectActive`). Человек так быстро не кликает.
- Снимки: [активный Node, светлая](../evidence/16-активный-node.png),
  [тёмная](../evidence/16-активный-node-dark.png); [выделенный неактивный, светлая](../evidence/16-выделенный-node.png),
  [тёмная](../evidence/16-выделенный-node-dark.png).
- **Решено без владельца, подтвердить** — три пункта из «Что делаем» приняты как записаны: Card до клика не
  получает мышь (hover и первый клик); pinch над активной Card принадлежит Card; активный Node без
  прокрутки отдаёт wheel Canvas-у, докрученный до края — не отдаёт; Terminal строгий.
- Проверки: `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (2344 test-а); gate fast — `[gate] зелено`;
  `GATE_SCOPE=all gate full` — 137 из 138, красный только известный нестабильный
  `epic-frame.spec.ts:721` («long names»), повтор отдельно — passed. `wheel-over-nodes.spec.ts` и
  `card-drag.spec.ts` с `--repeat-each=3` — 33 из 33.
- Пункт «(вручную) Stable copy после влития, trackpad» — не проверено: нужна сборка после мержа и trackpad
  владельца; e2e проверяет те же ветки колесом мыши Playwright.

**Долг** (все low, из вердикта ревью).

- `src/renderer/canvas/nodes/CardNode.tsx:191` — `nodrag` у тела Card зависит только от zoom: Card в
  состоянии error, files-missing или loading нельзя тянуть за тело. `nodrag` нужен только когда
  рисуется iframe.
- `src/renderer/canvas/Canvas.tsx:297` — снятие активности при снятии выделения (unselect) не покрыто
  test-ом: мутант выживает. Проверка — ⌘-клик дважды, Node должен остаться неактивным.
- `src/renderer/canvas/wheel-router.ts:140` — координаты переотправленного события колеса не покрыты
  test-ом: мутант с `event.clientX` выживает. Нужен ⌘+wheel над Terminal при zoom ≠ 1.

### Долги из HANDOFF (2026-10-08)

- Три решения «Решено без владельца, подтвердить» из «Что делаем» владелец подтвердил 2026-10-07, ещё до
  мержа, вместе с решениями Ticket-ов 15 и 17 ([PR #125](https://github.com/IDSAD-XL/worfy/pull/125));
  файл этого Ticket-а тогда не трогали, потому что он был в работе. Реализация приняла их как записаны,
  так что подтверждать заново нечего.
