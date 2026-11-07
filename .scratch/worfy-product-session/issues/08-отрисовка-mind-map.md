# 08 — Отрисовка Mind map: «дерево» и «граф», отклонённые, zoom и pan

Type: task
Status: open
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
- [ ] Unit test: «скрыть отклонённые» убирает отклонённое Решение и его ветку; выключатель возвращает.
- [ ] Unit test: «дерево» по умолчанию, текст крупнее, чем в «граф»; выбор вида запоминается.
- [ ] Unit test: click по узлу открывает карточку с причиной или источником; «Вписать» вписывает все узлы.
- [ ] Unit test раскладки: `replaces` не создаёт цикла в дереве; 150 узлов раскладываются, время записано в «Итог».
- [ ] (manual) Экран на Mac Stable с fixture-темой: виды, зачёркнутые, zoom и pan — снимок с проверкой пикселей.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

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
