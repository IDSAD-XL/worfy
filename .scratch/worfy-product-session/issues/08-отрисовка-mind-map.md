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
- [ ] (manual) Экран на Mac Stable с fixture-темой: виды, зачёркнутые, zoom и pan — снимок с проверкой пикселей.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 5a04a9e9c16a2ebab38ff26fc89940f6b32da188
  - evidence: gate pass · `gate fast` exit 0 · mac - · 5a04a9e9c16a2ebab38ff26fc89940f6b32da188

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
