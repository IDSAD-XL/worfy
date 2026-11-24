# 08 — Отрисовка Mind map: «дерево» и «граф», отклонённые, zoom и pan

Type: task
Status: blocked 2026-11-08T09:15Z
Blocked reason: manual check on Mac Stable: the screen with a fixture topic, both views, struck-out rejected Decisions, zoom and pan
Waits: owner
Blocked by: 03, 05, 07
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 5, 6; «Что видит владелец»; «Риски», п. 3; карта [worfy-product](../../worfy-product/map.md), решение 06 (Q1, Q2), «Not yet specified» (Mind map на 100+ узлах); прототип — Card «Прототип: Product Session + Mind map» (`card-2dffdc46`)

Не платформенный Ticket. Глубина ревью — `medium`.

## Что происходит

- Для графов в зависимостях уже есть `@xyflow/react` 12.12.0 и `elkjs` 0.12.0 (`package.json:35`, `:39`); ELK
  раскладывает Epic frame-ы Canvas в Web Worker (`src/renderer/canvas/elk/client.ts`).
- Состояние темы приходит хуком `useMindMap` (Ticket 05), место на экране — левая часть `ProductSessionPanel`
  (Ticket 07).
- Прототип: виды «дерево» и «граф», цвет и значок по виду узла, Решение ✓ / ✕, отклонённое зачёркнуто и серое,
  стрелка «заменило», карточка узла по click, легенда, zoom «−», «+», «Вписать», колесо — zoom, drag фона — pan.

## Что делаем

1. `MindMap` на React Flow: корень — тема; Ticket-ы карты — крупные узлы; мелкие узлы `mind-map.json` — под ними по
   `from`. Стрелки «из чего выросло»; связь `replaces` — отдельная пунктирная стрелка.
2. Виды: «дерево» (по умолчанию; раскладка ELK `mrtree` или `layered` сверху вниз, текст крупнее) и «граф»
   (ELK `layered` слева направо, текст обычный). Выбор вида запоминается в localStorage окна по теме.
3. Узел: значок и цвет вида; Решение — ✓ принято / ✕ отклонено; отклонённое — зачёркнуто. Переключатель «скрыть
   отклонённые» убирает отклонённые Решения и их ветки с экрана (данные не меняются).
4. Карточка узла по click — поля прототипа: вид и статус, текст, «Причина», «Источник», «История», «Выросло из»,
   «Сообщение» (ссылка прокручивает чат к сообщению по `message`).
5. Zoom (колесо, «−», «+», процент), pan (drag фона), «Вписать». Положения узлов из файла (`x`, `y`), если они есть;
   иначе — раскладка.
6. Файл с ошибкой формата — схема рисуется по верным узлам, сверху строка с ошибками и id узлов.
7. Fixture на 150 узлов: время раскладки и первого кадра — в «Итог».

## Готово, когда

- [ ] Unit test: fixture-тема рисует корень, Ticket-ы карты и узлы с видами; Решение `rejected` — зачёркнуто.
  - evidence: test-run pass · `vitest run test/unit/mind-map-view.test.tsx` exit 0 · mac - · 5a04a9e9c16a2ebab38ff26fc89940f6b32da188
- [ ] Unit test: «скрыть отклонённые» убирает отклонённое Решение и его ветку; выключатель возвращает.
  - evidence: test-run pass · `vitest run test/unit/mind-map-view.test.tsx` exit 0 · mac - · 5a04a9e9c16a2ebab38ff26fc89940f6b32da188
- [ ] Unit test: «дерево» по умолчанию, текст крупнее, чем в «граф»; выбор вида запоминается.
  - evidence: test-run pass · `vitest run test/unit/mind-map-view.test.tsx` exit 0 · mac - · 5a04a9e9c16a2ebab38ff26fc89940f6b32da188
- [ ] Unit test: click по узлу открывает карточку с причиной или источником; «Вписать» вписывает все узлы.
  - evidence: test-run pass · `vitest run test/unit/mind-map-view.test.tsx` exit 0 · mac - · 5a04a9e9c16a2ebab38ff26fc89940f6b32da188
- [ ] Unit test раскладки: `replaces` не создаёт цикла в дереве; 150 узлов раскладываются, время записано в «Итог».
  - evidence: test-run pass · `vitest run test/unit/mind-map-layout.test.ts` exit 0 · mac - · 5a04a9e9c16a2ebab38ff26fc89940f6b32da188
- [x] (manual) Экран на Mac Stable с fixture-темой: виды, зачёркнутые, zoom и pan — снимок с проверкой пикселей.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-08-6-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-08-6-2.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-08-6-3.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Dev build 2e96e91ac, fixture topic (LONG_MAP + 2 map Tickets), dark 1440: kinds and struck rejected Decision drawn; wheel zoom 44→67 %, background drag pans; screenshots differ pixel-wise before/after each. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 5a04a9e9c16a2ebab38ff26fc89940f6b32da188
  - evidence: gate pass · `gate fast` exit 0 · mac - · 5a04a9e9c16a2ebab38ff26fc89940f6b32da188

Шаги приёмки владельца — из `.scratch/owner-acceptance-guides.md` (перенесены 2026-11-24, `worfy-acceptance` 08): подготовка Orchestrator-а — пункты без метки, шаги владельца — пункты с меткой, по одному на шаг.

- [ ] Orchestrator: проверит CI и evidence всех десяти PR приёмки (Ticket-ы 08, 21, 23, 26–32) и что unit/e2e test-ы
      Ticket-ов есть на `main`.
- [ ] Orchestrator: положит в `worfy-sandbox` тему `acceptance-demo` (папка Product Session Project-а): узлы `LONG_MAP` из
      `test/e2e/product-session.spec.ts` (все четыре вида узлов, отклонённое Решение с историей, стрелка «Replaces»,
      очень длинный текст, совет без решения) и два Ticket-а карты из `test/fixtures/product-topic`.
- [ ] Orchestrator: через CDP (Chrome DevTools Protocol: Orchestrator сам щёлкает и читает экран Stable) откроет Command
      palette → «New Product Session», тронет файл темы, чтобы карта показала её, поставит окно Stable 1440 px в тёмной
      теме, «Tree».
- [ ] Orchestrator: откроет `index.html` прототипа (Card «Прототип: Product Session + Mind map», `card-2dffdc46`, в
      папке Card-ов Project-а worfy; у него только тёмная тема) в окне браузера слева и проиграет его разговор до конца
      («▶ Проиграть разговор»).
- [ ] Orchestrator: проверит, что Settings → Sessions → «Live summary while the advisor works» включён.
- [x] (manual) Сделай: посмотри на карту слева → Должно быть: выбран «Tree»; тема у левого края, два Ticket-а карты —
      крупные узлы с номером; у каждого узла значок вида в круге; Решение «Сначала проверить советника в Harness…»
      серое, зачёркнутое, с пунктирным контуром.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-08-13-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Tree pressed; topic is the leftmost node; two Ticket nodes 17 px bold with number capsule; every kind node has its icon in a 999px circle; rejected Decision grey, <s> struck, dashed 4 3 outline. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [ ] (manual) Сделай: над картой прокрути двумя пальцами и сведи-разведи пальцы на trackpad, потом протащи пустой фон
      → Должно быть: zoom плавный, процент между «−» и «+» меняется и держится в 10–250 %; карта едет за пальцем.
  - needs: mac stable
- [x] (manual) Сделай: нажми «−», «+», затем «Fit» → Должно быть: «−» и «+» меняют процент шагом; после «Fit» все узлы
      в панели.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-08-15-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: «−»/«+» step the percent 44→37→31→37→44→53 %; «Fit» → 44 %, every node box inside the map pane. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: нажми «Hide rejected», потом ещё раз → Должно быть: отклонённое Решение и красная стрелка к нему
      пропали; второй щелчок их вернул.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-08-16-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: «Hide rejected»: rejected Decision and the red Replaces edge go (0/0); second click brings both back (1/1). · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: щёлкни узел-Решение → Должно быть: карточка с плашкой вида и статуса, текстом, Reason, History,
      Grew from, Message; у Objection вместо Reason — Source.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-08-17-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-08-17-2.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-08-17-3.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Rejected Decision card: kind-status pill, text, Reason, History, Grew from, Message. Objection card shows Source, no Reason. Accepted Decision without history shows no History row (by design). · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: щёлкни по карте, затем Tab несколько раз, Enter, Escape → Должно быть: фокус идёт по узлам с
      видимой обводкой; Enter открывает карточку; Escape закрывает её и возвращает фокус на тот же узел.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-08-18-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Click on empty map, Tab walks topic→Tickets→nodes, each :focus-visible with 2 px outline; Enter opened the card, Escape closed it, focus back on the same node. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763

## Тесты

- Unit `test/unit/mind-map-view.test.tsx`, `test/unit/mind-map-layout.test.ts` (новые).
- Сначала падающий: test отрисовки fixture-темы до появления `MindMap`.

## Где в коде

- `src/renderer/product/MindMap.tsx` (новый)
- `src/renderer/product/mind-map-layout.ts` (новый)
- `src/renderer/product/mind-map.css` (новый)
- `src/renderer/session/ProductSessionPanel.tsx`
- `test/unit/mind-map-view.test.tsx`
- `test/unit/mind-map-layout.test.ts`

Только читать: `src/renderer/canvas/elk/client.ts`, `src/renderer/canvas/Canvas.tsx`, `src/shared/product/mind-map.ts`,
`src/renderer/product/useMindMap.ts`.

## Итог

- **Где.** `src/renderer/product/MindMap.tsx` — React Flow, как Canvas: корень — тема, Ticket-ы карты — крупные узлы,
  узлы `mind-map.json` под ними по `from`; стрелки «из чего выросло» (`smoothstep`) и пунктирная стрелка `replaces` между
  боковыми сторонами двух Решений. Сверху — «Tree · Graph» (`SegmentedControl`), «Hide rejected», «−», процент, «+», «Fit»;
  колесо — zoom, drag фона — pan (по умолчанию React Flow). Легенда сворачивается. Карточка узла по click: вид и статус,
  текст, Reason, Source, History, Grew from (ссылка на карточку родителя), Message. Ничего не пишет: drag узлов — Ticket 09.
- **Раскладка** — `src/renderer/product/mind-map-layout.ts`: граф строится из темы; в ELK идут только связи `from`, поэтому
  `replaces` цикла в дереве не делает. «Tree» — ELK `mrtree` сверху вниз, текст 15 px; «Graph» — ELK `layered` слева
  направо, текст 12 px. ELK — тот же Web Worker окна, что у Epic frame-ов (`elkEngine()` из `canvas/elk/client.ts`); до его
  ответа и без Worker-а рисует синхронная раскладка «аккуратного дерева». У карты в Worker-е один запрос за раз: по ответу
  уходят самые новые входы, промежуточные пропускаются. Пока запрос идёт, остаются места прошлого ответа, а узел, которого
  в нём нет, стоит у своего родителя (смещение от родителя — из синхронной раскладки). Синхронная раскладка и построение
  графа — циклы, не рекурсия: цепочка в 4000 узлов раскладывается. Узел с `x`, `y` в файле стоит там, где сказано.
- **Клавиатура.** Узел — кнопка с именем «вид · статус: текст» (`Decision · rejected: …`); Tab переходит по узлам,
  Enter и Space открывают карточку, Escape её закрывает и возвращает фокус на узел. Zoom держится в 10–250 %.
- **Ошибка чтения.** Если `product.topic` не прочитал тему, панель пишет «Could not read the Mind map: <причина>»
  вместо пустой заглушки.
- **Вид** запоминается по теме в localStorage окна (`worfy.mindMap.view:<projectId>:<тема>`); «Hide rejected» живёт, пока
  карта открыта, и данные не меняет.
- **Файл с ошибкой.** Строка ошибок над картой (`role="alert"`): файл и текст с id узла. Узел, названный ошибкой, не
  рисуется; узел, чей родитель не нарисован, висит от корня. Сегодня main (`src/main/product/topic.ts`, Ticket 03) при
  ошибке формата отдаёт `nodes: []`, поэтому на экране — корень, Ticket-ы карты и строка ошибок; верные узлы рисуются,
  как только main станет их отдавать.
- **Какая тема на экране.** У Product Session в данных темы нет. Панель (`ProductSessionPanel.tsx`) показывает тему
  Project-а, файлы которой поменялись последними, пока панель открыта (`product.changed`), и помнит её имя по Node в
  localStorage окна. До первого такого события — прежняя пустая заглушка.
- **«Сообщение».** Карточка зовёт `onShowMessage(message)`; панель его пока не передаёт: строки транскрипта не несут uuid
  события (`fold.ts` даёт ключи `e<N>`), поэтому без него показывается id сообщения. Прокрутку чата — вместе с чипами
  Ticket-а 09, который правит `Transcript.tsx`.
- **150 узлов** (Mac, Apple M5 Pro, vitest под Electron Node, `WORFY_MIND_MAP_TIMING=1`): ELK «Tree» (`mrtree`) — 54 ms,
  ELK «Graph» (`layered`) — 195 ms, синхронная раскладка — 0,3 ms; первый render 150 узлов в jsdom — 53 ms. ELK работает в
  Worker-е, первый кадр рисует синхронная раскладка.
- **Снимки** компонента отдельно от приложения (offscreen Electron, демо-тема, обе темы) — только для ревью, в
  репозиторий не положены. Снимок на Mac Stable — пункт «вручную» остаётся за Orchestrator-ом.
