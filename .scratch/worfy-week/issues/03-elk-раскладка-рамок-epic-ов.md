# 03 — Рамку Epic-а раскладывает ELK: Edge-и Blocked by идут по коридорам, порядок без пересечений

Type: task
Status: done — 2026-10-07, [PR #85](https://github.com/IDSAD-XL/worfy/pull/85)
Blocked by: —
Source: решения владельца 2026-10-07, вопросы 14–17, 28 и 29 ([spec.md](../spec.md), раздел «Решения владельца по Canvas»); [spec.md](../spec.md), этап 2

## Что происходит

- Места Ticket-ов в рамке считает своя функция `layoutEpic` (`src/renderer/canvas/epic-layout.ts:176`).
  Колонки — по уровню зависимостей (`placeOpenTickets`, `:127`). Внутри уровня порядок «сначала
  ready, потом номер» (`:192`). Пересечения Edge-ей никто не уменьшает.
- Edge Blocked by (`src/renderer/canvas/edges/blocking.ts:15`) — кривая React Flow по умолчанию
  (bezier) от handle к handle со стрелкой `ArrowClosed`. Edge через уровень (Level 1 → Level 3) идёт
  напрямую и проходит через Ticket-ы средней колонки.
- Ready Ticket-ы стоят первыми в колонке Level 1, чтобы их обвела одна пунктирная рамка
  `ready-wave` (`src/renderer/canvas/nodes/EpicFrameNode.tsx:78`).
- Ticket и Node Subagent-а можно перетащить. Смещение Ticket-а пишется в Node `epic-frame` ключом
  `offset:<NN>` (`src/renderer/canvas/sources/epics.ts:9`, `moved` — `:399`). Смещение Node-а
  Subagent-а — в Node `subagent-tree` ключом `offset:<key>` (`src/renderer/canvas/sources/subagents.ts:9`,
  `moved` — `:349`). Так решено в [ADR-0011](../../../docs/adr/0011-epic-frames-derived-nodes.md).
- Библиотек раскладки в зависимостях нет, `@xyflow/react` — 12.12.0. Своих типов Edge-ей нет:
  `Canvas.tsx` не передаёт React Flow `edgeTypes` (`src/renderer/canvas/Canvas.tsx:255`).

## Что делаем

1. **Сначала ADR.** Номер — следующий свободный в момент взятия Ticket-а (по плану 0037). ADR
   записывает решение 28:
   - зависимость `elkjs` (ELK — Eclipse Layout Kernel): версия, размер, лицензия. Пакет выходит
     под «EPL-2.0 OR GPL-3.0-or-later», worfy берёт его на условиях EPL-2.0;
   - кто размещает Derived Node-ы: внутренность рамки считает ELK в Web Worker renderer-а; колонка
     рамок остаётся правилом [ADR-0032](../../../docs/adr/0032-epic-frames-avoid-nodes.md);
   - дополнение к ADR-0011: Layout хранит на Epic только смещение рамки и `collapsed`. Смещения
     Ticket-ов и Node-ов Subagent-ов сняты (решение 17);
   - `## Considered Options`: своя эвристика порядка и свой обход Node-ов; dagre (нет ортогональной
     маршрутизации в обход Node-ов); ELK в main process; ELK в главном потоке renderer-а.

   ADR — первый коммит PR, до кода.
2. **Зависимость.** `pnpm add elkjs@0.12.0` с точной версией, как у остальных зависимостей, и
   обновлённый `pnpm-lock.yaml`. Install-скриптов у `elkjs` 0.12.0 нет (`npm view elkjs scripts`,
   2026-10-07), поэтому `allowBuilds` в `pnpm-workspace.yaml` не меняется.
3. **Раскладка рамки — ELK layered.** Колонки и их смысл прежние: Done (стопка или колонка),
   Level 1…N, Needs attention. Колонку Ticket-у задаёт наш уровень, а не слои ELK (подсказка:
   `elk.partitioning.activate` и номер колонки в `partition`). ELK упорядочивает Ticket-ы внутри
   колонок с минимизацией пересечений. Edge-и он прокладывает ортогонально
   (`elk.edgeRouting: ORTHOGONAL`) по коридорам между колонками, в обход Node-ов Ticket-ов. Edge
   выходит из правого handle блокера и входит в левый handle блокируемого, как сейчас. Промежутки —
   не меньше нынешних `COLUMN_GAP` и `ROW_GAP` (`epic-layout.ts:25-26`). Ширина рамки по заголовку
   (`headerWidth`, `:173`) — как сейчас.
4. **Edge рисуется по маршруту ELK.** Точки маршрута лежат в данных Edge-а, относительно рамки.
   Новый тип Edge-а рисует путь через них отрезками по горизонтали и вертикали со скруглёнными
   углами; стрелка на конце прежняя. Радиус скругления — не больше половины более короткого из двух
   соседних отрезков. Сдвиг рамки целиком сдвигает маршрут без нового расчёта ELK.
5. **Типы Edge-ей — точка расширения.** Тип Edge-а — файл в `src/renderer/canvas/edge-types/`,
   найденный так же, как типы Node-ов (`extensions.ts`). `Canvas.tsx` один раз передаёт их React
   Flow. Так Ticket 05 добавит свой тип без правки `Canvas.tsx`.
6. **Ready — chip-ом, а не местом** (решение 16). У ready Ticket-а — chip «Ready» и цвет ready из
   F-SPEC (`docs/design/F-SPEC.md`, строка ready в таблице токенов). Пунктирная рамка `ready-wave`
   уходит. Chip колонки «Ready wave · N» остаётся.
7. **ELK считает в Web Worker** (решение 29). Один worker на окно, запрос на каждый изменившийся
   Epic; ответ на устаревший запрос отбрасывается. Пока ответа нет, рамка показывает прежние места.
   До первого ответа для Epic-а рамка рисуется нынешним синхронным `layoutEpic` — с порядком по
   номеру и прямыми Edge-ами; ответ ELK его заменяет. Анимации нет.
8. **Ticket-ы и Node-ы Subagent-ов не перетаскиваются** (решение 17). `draggable: false` у Node-ов
   Ticket-ов (`ticketNodes`, `sources/epics.ts:211`) и Subagent-ов (`flowNode`,
   `sources/subagents.ts:226`). Выделение Ticket-а остаётся: оно нужно Ticket-у 05. Рамка
   перетаскивается целиком за заголовок (`.w-epic__drag`), её смещение пишется как сейчас. `moved`
   источника Epic-ов принимает только рамку, у источника Subagent-ов сохранять нечего. Дерево
   Subagent-ов без смещений сдвигается от Node-ов Layout-а целиком, кроме anchor-а (`clearShift`,
   `sources/subagents.ts:200`).
9. **Смещения снимаются один раз.** При первом чтении `layout.json` main убирает из каждого Node-а
   `epic-frame` ключи `offset:*` и удаляет Node-ы `subagent-tree`. Смещение рамки (`x`, `y`) и
   `collapsed` остаются. Если что-то убрано — одна строка в лог на Project и запись файла; если нет —
   файл не переписывается. Нормализация идемпотентна и в историю ⌘Z не попадает. Код — новый
   `src/main/layout/upgrade.ts`; вызов — там, где `LayoutStore` читает файл
   (`src/main/layout/store.ts:118`). Ticket 04 добавит туда снятие перекрытий.

## Готово, когда

- [x] ADR (по плану 0037) лежит в `docs/adr/`, статус «принят», есть `## Considered Options`; это первый коммит PR.
- [x] `elkjs` 0.12.0 — в `dependencies` файла `package.json` с точной версией; `pnpm install --frozen-lockfile` на чистом checkout-е — код 0.
- [x] Фикстура из шести Ticket-ов: порядок по номеру даёт 2 пересечения Edge-ей между Level 1 и Level 2, а порядок без пересечений существует. В раскладке рамки пересечений 0. Unit-test считает пары Edge-ей между соседними колонками, у которых концы идут в обратном порядке.
- [x] Ни один маршрут Edge Blocked by не проходит через Node Ticket-а, кроме своих концов у handle-ов. Unit-test на фикстурах, среди них Edge Level 1 → Level 3 мимо Ticket-а Level 2 на той же высоте и открытая стопка done.
- [x] Каждый отрезок маршрута горизонтальный или вертикальный. Путь SVG скруглён радиусом не больше половины более короткого соседнего отрезка. Unit-test функции, которая строит путь.
- [x] Колонки прежние: test-ы уровней, стопки done и «Needs attention» (`test/unit/epic-layout.test.ts:85`, `:98`, `:110`, `:128`) зелёные против новой раскладки.
- [x] У ready Ticket-а есть chip «Ready» и `data-ready="true"`; `data-testid="ready-wave"` на Canvas нет; chip «Ready wave · N» на месте.
- [x] Ticket и Node Subagent-а не двигаются: e2e тянет каждый на 200 px — Node на месте, `layout.json` не изменился. Рамка тянется целиком, её смещение переживает перезапуск.
- [x] Contract test: `layout.json` с `offset:3` в Node-е `epic-frame` и с Node-ом `subagent-tree`. После чтения ключей `offset:*` и Node-а `subagent-tree` нет, `x`, `y` и `collapsed` рамки прежние, в логе одна строка. Второе чтение файл не пишет.
- [x] ELK считает в worker-е: e2e против собранного приложения видит запущенный worker раскладки (`page.on('worker')`), и рамки получают места ELK. Unit-test с медленным подменённым ELK: после смены статуса Ticket-а и до ответа места прежние, после ответа — новые, промежуточных нет.
- [x] Бюджет `test/e2e/epic-frame.spec.ts:814` держится: interactive ≤ 3 с; с `WORFY_PERF=1` на Mac — медиана ≥ 55 fps, самый долгий кадр ≤ 100 ms. Цифры до и после — в «Итог».
- [x] Снимки рамки Epic-а `worfy-mvp` из e2e `test/e2e/epic-frame.spec.ts:209` в светлой и тёмной теме (helper `test/e2e/snapshots.ts`) сверены с F-SPEC: маршруты Edge-ей, скругления, chip-ы ready. Ссылка из «Итог» — `../evidence/03-рамка-elk.png`.
- [ ] (вручную) Stable copy, обновлённая после влития: Canvas Project-а Auction, самая большая рамка — ни один Edge не проходит через Ticket, Ticket не тянется, рамка тянется целиком. Как проверить: окно приложения, снимок в «Итог». 2026-10-07: все три условия выполнены, но после перетаскивания рамки ⌘Z её не возвращает, а отменяет прошлый шаг истории — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).

## Тесты

Сначала падающий test — `test/unit/epic-layout.test.ts`: фикстура из шести Ticket-ов, test
считает пересечения Edge-ей в раскладке рамки и ждёт 0. На нынешнем main `layoutEpic` ставит
Ticket-ы по номеру (`epic-layout.ts:192`), и test падает с 2. В «Итог» — как он падал.

В test-ах jsdom нет Worker-а. Модуль раскладки в них вызывается напрямую, с ELK без worker-а
(сборка `elk.bundled.js` из пакета).

- `test/unit/epic-layout.test.ts` — пересечения, маршруты в обход Ticket-ов, путь со скруглениями,
  колонки.
- `test/unit/epic-canvas.test.tsx` — Ticket не перетаскивается; прежние места до ответа ELK; chip ready.
- `test/unit/subagent-nodes.test.tsx` — Node Subagent-а не перетаскивается, дерево сдвигается целиком.
- `test/contract/layout-store.test.ts` — снятие смещений при чтении.
- `test/e2e/epic-frame.spec.ts`, `test/e2e/subagent-tree.spec.ts` — ниже.

Test-ы, которые меняются вместе с поведением:

- `test/unit/epic-layout.test.ts:66` (смещение Ticket-а) — уходит; `:135` (ready Wave первой в
  колонке) — становится test-ом chip-а; `:165` (размер рамки) — против размеров ELK; `:213` — остаётся
  только смещение рамки.
- `test/unit/epic-canvas.test.tsx:121` — читает смещение рамки и `collapsed`, без смещений
  Ticket-ов; `:199` (смещение брошенного Ticket-а) — становится «Ticket не перетаскивается».
- `test/unit/subagent-nodes.test.tsx:79`, `:132` — смещения Node-ов Subagent-ов уходят.
- `test/e2e/epic-frame.spec.ts:206` — chip-ы вместо пунктирной рамки ready; по-прежнему один Edge на
  каждую запись Blocked by. `:334` — только смещение рамки.
- `test/e2e/subagent-tree.spec.ts:255-274` — Node Subagent-а не двигается.

## Где в коде

- `package.json`
- `pnpm-lock.yaml`
- `src/renderer/canvas/epic-layout.ts`
- `src/renderer/canvas/elk/` — новая папка: worker, клиент worker-а, граф Epic-а для ELK
- `src/renderer/canvas/edge-types/RoutedEdge.tsx` — новый
- `src/renderer/canvas/extensions.ts`
- `src/renderer/canvas/Canvas.tsx`
- `src/renderer/canvas/edges/blocking.ts`
- `src/renderer/canvas/sources/epics.ts`
- `src/renderer/canvas/sources/subagents.ts`
- `src/renderer/canvas/nodes/EpicFrameNode.tsx`
- `src/renderer/canvas/nodes/TicketNode.tsx`
- `src/renderer/canvas/epic-frame.css`
- `src/shared/layout/derived.ts`
- `src/main/layout/upgrade.ts` — новый
- `src/main/layout/store.ts`
- `test/unit/epic-layout.test.ts`
- `test/unit/epic-canvas.test.tsx`
- `test/unit/subagent-nodes.test.tsx`
- `test/contract/layout-store.test.ts`
- `test/e2e/epic-frame.spec.ts`
- `test/e2e/subagent-tree.spec.ts`

`derived.ts` меняется только в комментариях: Node `subagent-tree` больше ничего не хранит.

Renderer грузится с `file://` (`src/main/window.ts:142`) под CSP `script-src 'self'` без
`worker-src` (`src/renderer/index.html:5`). Worker должен быть отдельным файлом сборки, а не `blob:`.
Module worker с `file://` может не запуститься, поэтому проверка — в собранном приложении (e2e против
`out/`), а не только в `pnpm dev`. Если для worker-а нужен `worker.format` в
`electron.vite.config.ts`, исполнитель добавляет этот файл в список и проверяет пересечения с
Ticket-ами Wave.

Общих файлов с Ticket-ами 01 и 02 нет. Ticket-ы 04 и 05 строятся на этом коде и идут после него
(`Blocked by: 03`).

## Итог

Сделано в ветке `worfy-week/03`, база `origin/main` f5e9d49. Решение — [ADR-0037](../../../docs/adr/0037-epic-frame-layout-by-elk.md),
первый коммит PR.

**Влито.** [PR #85](https://github.com/IDSAD-XL/worfy/pull/85), merge 140b8d3. Ревью — VERIFIED с
первого круга, без доработки кода: ответ ELK, разбивший колонку, отбрасывается; устаревший ответ
ELK отбрасывается (мутант пойман); один worker на окно; `upgradeLayout` снимает ровно `offset:*` у
`epic-frame` и Node-ы `subagent-tree`. Перед мержем по замечанию ревью исправлены источники
ADR-0037 (коммит d9989e0, правка только ADR): `subagent-tree` — из Ticket-а 15 Epic-а worfy-mvp, а
не из ADR-0011, и названы заменённые правила Ticket-ов 28 и 11 Epic-а worfy-daily. Перед мержем
`GATE_SCOPE=all gate.sh full` — exit 0; gate fast и CI на d9989e0 — зелёные.

**Как падал первый test.** Фикстура из шести Ticket-ов (`test/unit/epic-layout.test.ts`, «orders
the Tickets in a column…»): на main `layoutEpic` ставит Level 2 по номеру (04, 05, 06), и счёт
пересечений между Level 1 и Level 2 — 2 при ожидаемом 0 (`- 0 + 2`). Теперь тот же счёт по
синхронной раскладке остаётся 2 (это проверяется), а по раскладке ELK — 0.

**Что сделано.**

- `elkjs` 0.12.0 в `dependencies`, `pnpm-lock.yaml` — через `pnpm add elkjs@0.12.0 --save-exact`.
- `src/renderer/canvas/elk/layout.ts` — граф рамки для ELK и чтение ответа. Колонки — разбиение
  ELK (`elk.partitioning.partition`); `elk.separateConnectedComponents: false` обязателен: без
  него Ticket без Edge-ей уходил из своей колонки (ELK раскладывал компоненты связности отдельно).
  Если ELK всё же поставит Ticket-ы одной колонки на разные x, ответ отбрасывается, рамка остаётся
  на прежних местах. ELK получает только Edge-и вперёд; Edge внутри колонки и назад прокладывает
  наш код (ADR-0037, пункт 2). Проверено разовым прогоном на 150 случайных Epic-ах до 47 Ticket-ов, со свёрнутой и открытой стопкой done (в репозиторий не вошёл): ни один маршрут не
  прошёл через Ticket, расчёт — до 42 ms.
- `src/renderer/canvas/elk/client.ts` — один worker на окно: worker — собственный
  `elk-worker.min.js` пакета, отдельным файлом сборки (`out/renderer/assets/elk-worker.min-*.js`),
  renderer говорит с ним через `elk-api.js`. Запрос на Epic с изменившимися входами; устаревший
  ответ отбрасывается; один запрос считает рамку со свёрнутой и с открытой стопкой done.
  `electron.vite.config.ts` не менялся: файл worker-а идёт как asset через `?url`.
- `sources/epics.ts`: до первого ответа — синхронный `layoutEpic` (по номеру, Edge-и без маршрута),
  пока новый запрос в пути — места последнего ответа, ready и «Needs attention» — текущие.
- `edge-types/RoutedEdge.tsx` и `extensions.ts` (`collectEdgeTypes`, `edgeTypes`), `Canvas.tsx`
  передаёт `edgeTypes` один раз. Handle-ы Ticket-а — нулевого размера, чтобы концы Edge-а React
  Flow совпали с портами ELK.
- Ready — chip «Ready» на Ticket-е и рамка Ticket-а цвета `--ready-dot`; `ready-wave` убран.
- `src/main/layout/upgrade.ts` и вызов из `LayoutStore`: `offset:*` у `epic-frame` и Node-ы
  `subagent-tree` снимаются при первом чтении, одна строка `console.info` на Project, файл
  пишется сразу; второе чтение файл не трогает.

**Решено без владельца, подтвердить.**

1. Node Subagent-а перетаскивать можно, но только ради ручного Binding-а: при броске Canvas
   возвращает его на место, сохранять нечего. Тикет требовал `draggable: false` и для Subagent-ов,
   но это убило бы ручной Binding Subagent-а (Ticket 16 Epic-а worfy-mvp, `test/e2e/binding.spec.ts`).
   Для этого `NodeSource.moved` отвечает, сохранил ли источник место; `overlays/BindingDrop.tsx`
   (вне следа) больше не пишет смещение Subagent-а. Строка «Done» и anchor не перетаскиваются.
2. Строку «Done» дерева, которую нельзя ни выделить, ни перетащить, React Flow делает прозрачной
   для мыши; ей дан `pointerEvents: 'all'`, иначе щелчок её не открывает.

**Бюджет `test/e2e/epic-frame.spec.ts` (Auction-размер), `WORFY_PERF=1`, этот Mac, по 3 прогона.**
До (`origin/main` f5e9d49): interactive 1067–1072 ms, медиана 120,5 fps, самый долгий кадр 10 ms.
После: interactive 1098–1570 ms, медиана 120,5 fps, самый долгий кадр 10 ms. Бюджет (≤ 3 с, ≥ 55 fps,
≤ 100 ms) держится. Ревью на той же ветке намерило interactive 1065 ms ([комментарий в PR #85](https://github.com/IDSAD-XL/worfy/pull/85#issuecomment-6029459370)). Откуда один прогон
в 1570 ms, не исследовано (долг в HANDOFF.md, «Риски и долги»).

**Снимки** рамки `worfy-mvp` из e2e «the worfy-mvp Epic…» (zoom 0,3, рамка целиком):
[светлая](../evidence/03-рамка-elk.png), [тёмная](../evidence/03-рамка-elk-тёмная.png). Сверено с
F-SPEC: Edge-и ортогональные, со скруглёнными углами, идут по коридорам, ни один не проходит
через Ticket; chip «Ready» у 01 цвета ready, chip колонки «Ready wave · 1» на месте; пунктирной
рамки ready нет.

**Не проверено.** Ручная проверка на Stable copy (Canvas Project-а Auction): копия обновляется
только после влития, а запуск настоящего worfy из агента запрещён (он пишет в `~/.claude`).
Проверено 2026-10-07, не прошло (⌘Z после перетаскивания рамки) — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M21 второго круга ручных проверок). Stable copy из 6df9791
(pid 2455, CDP 9351), Canvas Project-а Auction, мышь ОС (CGEvent).

- Выбор рамки: у backlog больше всех Ticket-ов (97), но Edge-ей у неё 0. Самая большая открытая рамка
  с Edge-ами — notifications-telegram (12 Ticket-ов, 14 Edge-ей). Больше всех Edge-ей у deepening
  (50 Ticket-ов, 51 Edge) — её раскрывали на время проверки.
- **Ticket 03 — условия выполнены.** Через Ticket не проходит ни один Edge: 6 и 14 Edge-ей
  notifications-telegram (стопка done свёрнута и раскрыта), 13 на всём Canvas, 51 у deepening. Все
  318 прямых отрезков — горизонтальные или вертикальные. Ticket 11 тянули трижды (pointerdown на
  Ticket-е, 16–20 pointermove): за 481 кадр он не сдвинулся, sha `layout.json` тот же. Рамку за
  заголовок тянули на 200 px: со snapping вышло 192, все Ticket-ы и пути Edge-ей сдвинулись ровно
  на 192.
- **Ticket 05.** По умолчанию 6 Edge-ей бледные (1 px, пунктир 4 3), а 8 Edge-ей от done-блокеров не
  нарисованы. Наведение на Ticket 08 подсветило ровно его 4 Edge-а: 1.4 ms до DOM, 15.5 ms до кадра.
  При раскрытой стопке наведение на 11 подсветило ровно 5 Edge-ей его цепочки, включая Edge-и от
  done-блокеров. Курсор ушёл — вернулся вид по умолчанию. Линии Binding — не проверено: на Canvas
  Auction нет ни одного Edge-а Binding.
- **Не прошло: ⌘Z после перетаскивания рамки.** ⌘Z не вернул рамку на место, а отменил прошлый шаг
  истории Canvas: вернулся Session Node 99564eee, удалённый в проверке M20, и колонка рамок уехала на
  x=1620. Причина: `moved()` в `src/renderer/canvas/sources/epics.ts:459-465` сохраняет смещение
  рамки через `saveEpicChange` (`:152-166`), а та пишет `applyLayoutOp()` напрямую, без шага истории.
  Комментарий `src/renderer/canvas/history.ts:8-12` относит Epic source к автоматическим писателям,
  хотя перетаскивание рамки — жест пользователя. Сворачивание рамки (`patchData collapsed`) идёт тем
  же путём; его ⌘Z, по коду, тоже не отменит (не проверялось).
- Замечание: при раскрытой стопке done ELK выравнивает открытые Ticket-ы по их done-блокерам. В
  notifications-telegram первый Ticket колонок Level 1–3 встаёт в 780 px от верха рамки против 92 px
  при свёрнутой стопке: верх колонок пуст, а Edge-и, которые объясняют сдвиг, по умолчанию скрыты.
- Состояние возвращено: ⇧⌘Z снова удалил Session Node 99564eee, рамка дотянута до смещения 0, стопки
  и deepening свёрнуты, viewport (0, 0, 1). В `layout.json` остались две явные записи: смещение рамки
  notifications-telegram (0, 0) и `collapsed: true` у deepening.
- Вердикт: не прошло. Условия пункта «(вручную)» выполнены, но перетаскивание рамки ломает
  историю ⌘Z. Пункт остаётся `[ ]`, пока дефект не исправлен или владелец его не примет.
- Снимки (в scratchpad Session Orchestrator-а, в репозиторий не положены): `M21-frame.png`,
  `M21-hover.png`, `M21-hover-zoom.png`, `M21-after-ticket-drag.png`, `M21-frame-dragged.png`,
  `M21-after-undo.png`, `M21-stack-open-default.png`, `M21-all-lit.png`, `M21-hover-done-chain.png`,
  `M21-deepening-lit-zoom.png`, `M21-final.png`; данные — `M21-edges.json`, `M21-drag.txt`.

### Долги из HANDOFF (2026-10-08)

- [low] `test/contract/canvas-tools.test.ts:438`, `:481` — фикстуры ещё создают Node `epic-frame` с ключом
  `offset:3` и Node `subagent-tree` со смещением Subagent-а, которых после ADR-0037 нет: renderer их не
  пишет, main снимает при чтении `layout.json`. Комментарии над фикстурами (`:434-435`, `:476-477`)
  описывают прежнее поведение — renderer хранит смещения Ticket-ов и Node-ов Subagent-ов.
