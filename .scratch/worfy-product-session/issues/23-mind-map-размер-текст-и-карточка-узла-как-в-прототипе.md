# 23 — Mind map: размер, текст и карточка узла как в прототипе

Type: task
Status: blocked 2026-11-09T04:52Z
Blocked reason: code merged (#1714); waits for the owner's look at the Mind map size, node text and node card in Mac Stable after the next update, next to the prototype
Waits: owner
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

Шаги приёмки владельца — из `.scratch/owner-acceptance-guides.md` (перенесены 2026-11-24, `worfy-acceptance` 08): подготовка Orchestrator-а — пункты без метки, шаги владельца — пункты с меткой, по одному на шаг.

- [ ] Orchestrator: вернёт тёмную тему и нажмёт «Fit».
- [ ] (manual) Сделай: найди узел «Очень длинный текст узла…» и наведи на него → Должно быть: в узле 4 строки и «…», ни
      одна буква не выходит за контур; tooltip — полный текст. У других узлов текст целиком, без обрезки.
  - needs: mac stable
  - evidence: owner-check fail · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); the Orchestrator saw on a dev build of 2e96e91ac: Very long node: 4 lines + «…», inside, title = full text. But short nodes «Отдельный экран продуктовой работы…» and «Файл в docs/product/ правит tool…» are cut with «…» too (both have fold marks). · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: потяни разделитель между картой и чатом вправо и влево → Должно быть: карта каждый раз
      вписывается заново в новую ширину.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-23-11-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-23-11-2.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Divider dragged right (map 77 %, zoom 34→44 %) and left (43 %, 24 %): map refit each time, all nodes inside the pane. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: нажми «+», потом снова потяни разделитель; затем «Fit» → Должно быть: после «+» карта держит твой
      zoom и не вписывается сама; «Fit» снова вписывает. Двойной щелчок по разделителю — назад к 60 / 40.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-23-12-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: After «+» (29 %) a divider drag kept 29 %; «Fit» refit to 38 % with all nodes in; divider double-click returned map to 60 %. · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: открой карточки узлов у левого края, в середине и у правого края карты, затем протащи фон при
      открытой карточке → Должно быть: карточка справа от узла, без места — слева, без места с обеих сторон — под
      узлом; всегда внутри карты; при pan едет вместе с узлом.
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-23-13-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-23-13-2.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: screenshot pass · `../evidence/acc1124-23-13-3.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Left node (Ticket 01) card on the right, middle node card below (no room either side), right node card on the left; all inside the map; on pan the card follows its node (re-placed beside it). · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763
- [x] (manual) Сделай: открой карточку отклонённого Решения → Должно быть: плашка вида с рамкой, серая и зачёркнутая;
      History — два шага «accepted — дешевле начать без экрана», «rejected — экран Mind map и есть суть…», второй
      красный; ссылки синие, подчёркнуты только при наведении; Message и Changed by — «Show in the chat» (сообщений
      fixture-темы нет в этом чате, поэтому без цитаты и без «step N»).
  - needs: mac
  - evidence: screenshot pass · `../evidence/acc1124-23-14-1.jpg` · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763 · scrub: 2026-11-24
  - evidence: owner-check pass · 2026-11-24: Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); checked by the Orchestrator on a dev build of 2e96e91ac: Rejected card: bordered grey struck pill; History «accepted — дешевле начать без экрана», «rejected — экран Mind map и есть суть…» (second red); links blue, underline only on hover; Message and Changed by «Show in the chat». · mac dev · 2e96e91ac62a3c679526aaa613a069ed60803763

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

Ревью, раунд 2: `MindMapFlow` читал камеру (`useStore(state => state.transform)`) ради места карточки и поэтому
рисовался заново на каждый шаг колеса и каждый кадр pan, а с ним — каждый узел: значение контекста `actions`
создавалось заново. Камеру теперь читает только открытая карточка (`NodeCard`), `actions` — `useMemo` по правам записи,
`layoutKey` — `useMemo` по графу и виду. Test `test/unit/mind-map-renders.test.tsx` считает узлы, нарисованные после
шага колеса без открытой карточки: 5 до правки, 0 после.
