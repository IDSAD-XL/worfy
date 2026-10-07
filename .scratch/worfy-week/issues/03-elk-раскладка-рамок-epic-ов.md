# 03 — Рамку Epic-а раскладывает ELK: Edge-и Blocked by идут по коридорам, порядок без пересечений

Type: task
Status: open
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

- [ ] ADR (по плану 0037) лежит в `docs/adr/`, статус «принят», есть `## Considered Options`; это первый коммит PR.
- [ ] `elkjs` 0.12.0 — в `dependencies` файла `package.json` с точной версией; `pnpm install --frozen-lockfile` на чистом checkout-е — код 0.
- [ ] Фикстура из шести Ticket-ов: порядок по номеру даёт 2 пересечения Edge-ей между Level 1 и Level 2, а порядок без пересечений существует. В раскладке рамки пересечений 0. Unit-test считает пары Edge-ей между соседними колонками, у которых концы идут в обратном порядке.
- [ ] Ни один маршрут Edge Blocked by не проходит через Node Ticket-а, кроме своих концов у handle-ов. Unit-test на фикстурах, среди них Edge Level 1 → Level 3 мимо Ticket-а Level 2 на той же высоте и открытая стопка done.
- [ ] Каждый отрезок маршрута горизонтальный или вертикальный. Путь SVG скруглён радиусом не больше половины более короткого соседнего отрезка. Unit-test функции, которая строит путь.
- [ ] Колонки прежние: test-ы уровней, стопки done и «Needs attention» (`test/unit/epic-layout.test.ts:85`, `:98`, `:110`, `:128`) зелёные против новой раскладки.
- [ ] У ready Ticket-а есть chip «Ready» и `data-ready="true"`; `data-testid="ready-wave"` на Canvas нет; chip «Ready wave · N» на месте.
- [ ] Ticket и Node Subagent-а не двигаются: e2e тянет каждый на 200 px — Node на месте, `layout.json` не изменился. Рамка тянется целиком, её смещение переживает перезапуск.
- [ ] Contract test: `layout.json` с `offset:3` в Node-е `epic-frame` и с Node-ом `subagent-tree`. После чтения ключей `offset:*` и Node-а `subagent-tree` нет, `x`, `y` и `collapsed` рамки прежние, в логе одна строка. Второе чтение файл не пишет.
- [ ] ELK считает в worker-е: e2e против собранного приложения видит запущенный worker раскладки (`page.on('worker')`), и рамки получают места ELK. Unit-test с медленным подменённым ELK: после смены статуса Ticket-а и до ответа места прежние, после ответа — новые, промежуточных нет.
- [ ] Бюджет `test/e2e/epic-frame.spec.ts:779` держится: interactive ≤ 3 с; с `WORFY_PERF=1` на Mac — медиана ≥ 55 fps, самый долгий кадр ≤ 100 ms. Цифры до и после — в «Итог».
- [ ] Снимки рамки Epic-а `worfy-mvp` из e2e `test/e2e/epic-frame.spec.ts:206` в светлой и тёмной теме (helper `test/e2e/snapshots.ts`) сверены с F-SPEC: маршруты Edge-ей, скругления, chip-ы ready. Ссылка из «Итог» — `../evidence/03-рамка-elk.png`.
- [ ] (вручную) Stable copy, обновлённая после влития: Canvas Project-а Auction, самая большая рамка — ни один Edge не проходит через Ticket, Ticket не тянется, рамка тянется целиком. Как проверить: окно приложения, снимок в «Итог».

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
