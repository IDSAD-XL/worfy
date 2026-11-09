# 23 — Mind map: размер, текст и карточка узла как в прототипе

Type: task
Status: claimed 2026-11-09T03:23Z
Branch: worfy-product-session/23
Blocked by: 21
Source: сравнение собранного экрана с прототипом 2026-11-09 (строки 2, 3, 12, 13, 14 таблицы отличий); [spec.md](../spec.md),
«Решения владельца 2026-11-08: экран как в прототипе»; прототип — Card «Прототип: Product Session + Mind map» (`card-2dffdc46`)

Не платформенный Ticket. Глубина ревью — `medium`; снимки экрана и взгляд владельца.

## Что происходит

Сравнение 2026-11-09 положило рядом снимки собранного экрана Product Session и прототипа с теми же данными
(25 узлов, 8 сообщений). После Ticket-а 21 вид узлов и связей совпадает, но в Mind map остались пять отличий:

- **Строка 2, окно меньше.** Когда окно сужается (или двигается разделитель), карта остаётся в прежнем zoom (47 %),
  и правый столбец узлов обрезан у разделителя. Прототип вписывает карту заново при каждом изменении размера (43 %),
  пока владелец сам не двигал и не менял zoom. `MindMap.tsx` вызывает `fitView` только при смене темы, вида или
  раскладки ELK.
- **Строка 3, длинный текст узла.** Третья строка длинного текста вылезает за нижний край узла: высоту узла
  `nodeSize` считает по оценке 0,55 em на знак, а кириллица шире. Прототип меряет текст (canvas `measureText`) и рисует
  до 4 строк внутри узла.
- **Строка 12, место карточки.** Карточка узла всегда открывается в правом верхнем углу карты, поверх других узлов.
  Прототип ставит её рядом с выбранным узлом: справа, а если там не помещается — слева, и прижимает к краям карты.
- **Строка 13, строка вида в карточке.** У нас серый текст «⊗ Decision · rejected». В прототипе — плашка вида с
  рамкой в цвете вида, у отклонённого Решения зачёркнутая. Ссылки у нас лаймовые и подчёркнутые, в прототипе синие
  (`--working`) без подчёркивания.
- **Строка 14, история в карточке.** У нас история показывает только прежние состояния («1. accepted — …»). Прототип
  показывает все шаги, отмену — красным, и строку «Изменило» со ссылкой на сообщение, которое отменило Решение.

## Что делаем

1. Карта вписывается заново, когда меняется размер её области (окно, разделитель), — если владелец не двигал карту
   и не менял zoom руками. После ручного pan или zoom вид владельца сохраняется; «Fit», смена темы или вида снова
   включают вписывание.
2. Высота узла считается по измеренному тексту: canvas `measureText` шрифтом узла, перенос по словам, как у
   браузера, с запасом в сторону лишней строки. Не больше 4 строк, как в прототипе; длиннее — многоточие, полный текст
   в карточке и в `title`. Место метки сворачивания учитывается в ширине текста.
3. Карточка узла открывается рядом с выбранным узлом: справа от него, если не помещается — слева, если и там нет
   места — под узлом; всегда внутри карты. Следует за узлом при pan и zoom.
4. Строка вида в карточке — плашка с рамкой цвета вида; у отклонённого Решения зачёркнута. Ссылки карточки — цвета
   `--working-text`, без подчёркивания (подчёркивание при наведении).
5. История Решения — все шаги по порядку: прежние состояния из `history` и текущее; шаг, который отклонил Решение, —
   красным. «Message» — сообщение, где узел появился; «Changed by» — сообщение каждого следующего шага. Только из
   данных файла `mind-map.json`.

Не трогаем (вопросы владельца или другие ticket-ы): радиальную раскладку Graph, «Hide rejected», метки
сворачивания, место панели инструментов, чипы в чате (Ticket 22). Слова UI — английские.

## Готово, когда

- [ ] После сужения области карты карта вписана заново; после ручного zoom или pan — нет (test).
  - evidence: test-run pass · `pnpm test -- test/unit/mind-map-view.test.tsx` exit 0 (refit on resize, kept after zoom or wheel by hand; mutants red) · mac - · 4dc2146552812c9bab58428bfa46077e184d4bb1
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 (1440 to 1160: zoom 47 to 35 percent, all nodes in the pane; zoom kept after Zoom in) · mac dev · 4dc2146552812c9bab58428bfa46077e184d4bb1
- [ ] Длинный текст узла (русский и английский) не выходит за край узла (test с измерением текста; снимок).
  - evidence: test-run pass · `pnpm test -- test/unit/mind-map-layout.test.ts test/unit/mind-map-view.test.tsx` exit 0 (long Russian and English labels fit, clamp equals the lines the box holds) · mac - · 4dc2146552812c9bab58428bfa46077e184d4bb1
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 (real font: no node text past its border, only texts over four lines clamped) · mac dev · 4dc2146552812c9bab58428bfa46077e184d4bb1
- [ ] Карточка узла открывается рядом с узлом, переходит на другую сторону у края и не выходит за карту (test).
  - evidence: test-run pass · `pnpm test -- test/unit/mind-map-layout.test.ts test/unit/mind-map-view.test.tsx` exit 0 (cardPlace right, left, under, above, clamped; card beside the clicked node) · mac - · 4dc2146552812c9bab58428bfa46077e184d4bb1
- [ ] Строка вида в карточке — плашка с рамкой; у отклонённого Решения зачёркнута; ссылки синие (test).
  - evidence: test-run pass · `pnpm test -- test/unit/mind-map-view.test.tsx` exit 0 (kind pill classes; e2e checks line-through on the rejected pill) · mac - · 4dc2146552812c9bab58428bfa46077e184d4bb1
- [ ] История показывает все шаги, отмена красным, строка «Changed by» ведёт к сообщению отмены (test).
  - evidence: test-run pass · `pnpm test -- test/unit/mind-map-view.test.tsx` exit 0 (both history steps, overturn marked, Changed by opens the overturning message) · mac - · 4dc2146552812c9bab58428bfa46077e184d4bb1
- [ ] Снимки экрана в тёмной теме при окне 1440 и после сужения до 1160, просмотренные исполнителем.
  - evidence: screenshot pass · `../evidence/23-mind-map-1440.png` dark theme, window 1440, Tree after Fit, long texts inside their nodes · mac dev · 4dc2146552812c9bab58428bfa46077e184d4bb1 · scrub: 2026-11-09
  - evidence: screenshot pass · `../evidence/23-node-card-1440.png` dark theme, window 1440, card of the overturned Decision under its node, no room on either side at this width · mac dev · 4dc2146552812c9bab58428bfa46077e184d4bb1 · scrub: 2026-11-09
  - evidence: screenshot pass · `../evidence/23-mind-map-1160.png` dark theme, window narrowed to 1160, map fitted again at 35 percent · mac dev · 4dc2146552812c9bab58428bfa46077e184d4bb1 · scrub: 2026-11-09
  - evidence: screenshot pass · `../evidence/23-node-card-1160.png` dark theme, window 1160, accepted Decision card with its kind pill under the node · mac dev · 4dc2146552812c9bab58428bfa46077e184d4bb1 · scrub: 2026-11-09
- [ ] (manual) Владелец в Mac Stable: размер, текст узлов и карточка как в прототипе.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 (705 files, 16580 tests) · mac - · 0f8057c1e922efb95dbcdb0acf979cc85e5bd479
  - evidence: gate pass · `gate fast` exit 0 · mac - · 0f8057c1e922efb95dbcdb0acf979cc85e5bd479

## Тесты

- Unit test-ы Mind map: `test/unit/mind-map-view.test.tsx`, `mind-map-hand.test.tsx`, `mind-map-layout.test.ts`,
  `node-chips.test.tsx`, `product-use-mind-map.test.tsx`, `session-view.test.tsx`.
- e2e: `test/e2e/product-session.spec.ts`.

## Где в коде

- `src/renderer/product/MindMap.tsx`, `src/renderer/product/mind-map-layout.ts`, `src/renderer/product/mind-map.css`
  (кроме правил чипов — их правит Ticket 22)
- `test/unit/mind-map*.test.ts*`, `test/e2e/product-session.spec.ts`
- `docs/features/product-session.md` (только если описание поведения меняется)
- `.scratch/worfy-product-session/evidence/23-*.png`

## Итог

Сверено с файлом Card-а прототипа (`card-2dffdc46/index.html`: `ResizeObserver` с `userMoved`, `wrap` и `textWidth`
через canvas `measureText`, `positionDetail`, `.kind-chip`, `renderDetail`). Что сделано по строкам сравнения:

- **Строка 2, окно меньше.** Карта вписывается заново, когда меняется размер её области — React Flow сам меряет её
  (`width` и `height` в store). Ручной zoom («+», «−», колесо) и pan ставят флаг `movedByHand`; «Fit», смена темы или
  вида его снимают. Найдено в e2e: `flow.fitView` в React Flow 12 ждёт следующей смены узлов, а новая ширина панели
  узлы не меняет, и вписывание откладывалось до следующего клика по карте. Поэтому при изменении размера вид
  ставится сразу: `setViewport(getViewportForBounds(…))` с теми же отступом и пределом zoom, что у «Fit». В собранном
  приложении при сужении окна с 1440 до 1160 zoom сменился с 47 % на 35 %, все узлы в панели.
- **Строка 3, длинный текст.** Высота узла считается по тексту, измеренному canvas `measureText` шрифтом приложения
  (`--font-ui` на `body`), перенос по словам, длинное слово рвётся где угодно, как `overflow-wrap: anywhere`. Текст
  переносится на 2 px уже, чем его область, так что ошибка измерения даёт лишнюю строку, а не вылет. До 4 строк, как
  в прототипе (было 3). У узла с детьми учтено место метки сворачивания (40 px и промежуток). Кроме того, у текста
  `-webkit-line-clamp` равен числу строк, которое вмещает его узел, так что даже неточно измеренный текст кончается
  многоточием внутри узла. Полный текст — в карточке и в `title`. Без canvas (jsdom) остаётся прежняя оценка 0,55 em.
  В e2e с настоящим шрифтом: ни один текст не выходит за край узла, обрезаны только тексты длиннее 4 строк.
- **Строка 12, место карточки.** `cardPlace` (`mind-map-layout.ts`) по правилу прототипа: справа от узла, если не
  помещается — слева, если нет места ни там, ни там — под узлом (у нижнего края — над ним), всегда не ближе 8 px к краю
  карты. Карточка следует за узлом при pan, zoom и перетаскивании. При ширине карты около 700 px (окно 1440, Mind map
  60 %) у узлов среднего столбца места сбоку нет, и карточка встаёт под узел — как в прототипе, где она в таком случае
  тоже уходит под узел.
- **Строка 13, строка вида.** Плашка с рамкой цвета вида на его оттенке (`.w-mind__kind-pill`), у отклонённого
  Решения серая и зачёркнутая. В светлой теме текст плашки темнее контура, чтобы мелкая подпись держала контраст.
  Ссылки карточки — `--working-text` (синий прототипа), подчёркивание только при наведении и фокусе.
- **Строка 14, история.** Все шаги Решения: прежние из `history` и текущее состояние; шаг, который отклонил Решение,
  красный (`--span-problem`). «Message» — сообщение, где узел появился (первый шаг истории), «Changed by» — сообщение
  каждого следующего шага (у текущего — `message` узла: «где узел появился или последний раз изменился»). Ссылки
  внутри списка истории убраны: те же сообщения теперь в строках «Message» и «Changed by».

Не сделано, данных нет в `mind-map.json`: номер шага («шаг 5»), номер сообщения и цитата сообщения
(«#5 Советник: «…»»). Файл хранит только uuid события транскрипта; текст и номер сообщения есть только в транскрипте,
которого Mind map не получает. Ссылка по-прежнему «Show in the chat».

Не трогалось (вопросы владельца и Ticket 22): радиальная раскладка Graph, «Hide rejected», метки сворачивания, место
панели инструментов, правила чипов в `mind-map.css`. Первое вписывание до ответа ELK (замечание Ticket 21) — прежнее.

Test-ы: `test/unit/mind-map-view.test.tsx` (вписывание при изменении размера; вид владельца после «+» и после
колеса; clamp по высоте узла; место карточки; плашка, шаги истории и «Changed by»), `test/unit/mind-map-layout.test.ts`
(высота узла по измеренному тексту с кириллицей шире латиницы, место метки сворачивания, перенос, `cardPlace`),
`test/e2e/product-session.spec.ts` (настоящий шрифт, карточка, сужение окна). Шесть mutant-ов красные: без
вписывания, без флага от колеса, без флага от «+», постоянный clamp 4, без отметки отмены, карточка в углу.
В тесте вида React Flow теперь получает размер панели и через `.react-flow__renderer` (раньше его store в jsdom
всегда был 500 × 500); тест ELK сверяет место темы, а не `too-wide`, которое обе раскладки теперь ставят одинаково.

Снимки (тёмная тема, данные fixture без личных данных):
[1440, карта](../evidence/23-mind-map-1440.png) · [1440, карточка](../evidence/23-node-card-1440.png) ·
[1160, карта](../evidence/23-mind-map-1160.png) · [1160, карточка](../evidence/23-node-card-1160.png).
