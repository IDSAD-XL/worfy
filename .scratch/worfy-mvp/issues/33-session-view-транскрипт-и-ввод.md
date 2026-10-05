# 33 — Session view: полный транскрипт Сессии, markdown и поле ввода

Type: task
Status: claimed — 2026-10-05
Blocked by: 08, 11
Source: [BRIEF.md](../../../docs/design/BRIEF.md), Screen 2; макеты `docs/design/F-session-*.dc.html`; [spec.md](../spec.md), «Точки расширения вместо центральных файлов»

## Что делаем

Вторая половина бывшего тикета 08: экран одной Сессии. Узел Оркестратора (08) уже живёт на Холсте;
здесь — то, что видно после двойного щелчка по нему.

- Session view (переключатель Canvas / Session из тикета 03): полный транскрипт выбранной
  Сессии — сообщения пользователя, текст ассистента (markdown), свёрнутое thinking, строки
  tool-вызовов одной строкой с ✓ или ошибкой, строки hook-ов, строки запуска Subagent-ов. Шапка:
  модель, effort, режим разрешений, стоимость, кнопка «Interrupt».
- Справа — панель из блоков `src/renderer/session/rail/*.tsx`; `rail/index.ts` собирает их через
  `import.meta.glob`. Здесь панель пустая, её заполнят 15, 16, 22.
- `Transcript.tsx` получает транскрипт как список событий из 07 и не знает, откуда они: тикет 14
  подаст туда события, разобранные из файла.
- `src/renderer/markdown/Markdown.tsx` — общий рендер markdown, впервые нужен здесь:
  `react-markdown` + `remark-gfm` (таблицы, списки задач), сырой HTML не исполняется, ссылки
  `https://` открываются в браузере (`shell.openExternal`), относительные ссылки на файлы
  репозитория — в редакторе по умолчанию (`shell.openInEditor`). Оба канала вводит тикет 11.
  Шрифты и цвета — токены темы. Им же пользуются HANDOFF и ADR (тикет 12).
- Поле ввода (`MessageInput.tsx`): Enter — отправить, Shift+Enter — новая строка, ↑/↓ — история
  промптов, автоувеличение высоты. Пока Сессия занята, кнопка отправки становится «Interrupt».
  Очередь, выбор модели и slash-меню — тикеты 19 и 20.
- Двойной щелчок по Узлу Оркестратора открывает Session view этой Сессии.

## Готово, когда

- [x] На fake-агенте: сообщение из поля ввода → статус `busy` → текст ответа в транскрипте → `idle`; стоимость из `result` видна в шапке.
- [x] «Interrupt» посреди хода останавливает его; транскрипт показывает пометку прерывания.
- [x] ↑/↓ в пустом поле листают прошлые промпты этой Сессии.
- [x] `<script>` и `<img onerror>` в markdown не исполняются (test).
- [x] Новый блок правой панели добавляется одним файлом в `rail/` без правки `SessionView.tsx`.
- [x] Ручной прогон на репозитории worfy с настоящим SDK: сообщение «ответь блоком состояния» даёт блок в транскрипте и на Узле Оркестратора; снимок в «Итог».

## Тесты

- `test/unit/markdown.test.tsx` — рендер таблицы, списка задач, отключённый HTML, обе ветки ссылок (новый).
- `test/e2e/session-view.spec.ts` — fake-сценарий: двойной щелчок, отправка, Interrupt, история промптов (новый).
- Сначала падающий test: `markdown.test.tsx` на `<img onerror>`.

## Где в коде

- `src/renderer/session/SessionView.tsx`, `src/renderer/session/Transcript.tsx`, `src/renderer/session/MessageInput.tsx`
- `src/renderer/session/rail/index.ts`
- `src/renderer/markdown/Markdown.tsx`
- `src/renderer/canvas/nodes/OrchestratorNode.tsx` — двойной щелчок

## Итог

Сделано в ветке `worfy-mvp/33`. Проверено тестами: `test/unit/markdown.test.tsx`,
`test/unit/session-view.test.tsx`, `test/e2e/session-view.spec.ts` (fake-сценарий
`test/fixtures/agent-scripts/session-view.jsonl`: ход с tool-вызовом и markdown за $0.0021, затем
ход, который ждёт прерывания).

Первый test. `markdown.test.tsx` на `<img onerror>` прогнан против наивной заглушки
`Markdown` (`dangerouslySetInnerHTML`): exit code 1, «expected <img> to be null». С настоящим
`Markdown.tsx` тот же test зелёный.

Как устроено:

- `src/renderer/session/SessionView.tsx` — Session view. Шапка: состояние, модель, effort,
  режим разрешений, стоимость, кнопка «Interrupt». Ниже — транскрипт и поле ввода, справа — rail.
  Состояние, модель (до первого `init`) и стоимость берутся из вида Оркестратора
  (`orchestrator.view` / `orchestrator.changed`, ADR-0010): стоимость там уже сложена по процессам
  Claude Code из `result`. Модель и режим разрешений после хода — из последних `init` и `status`.
- Какую Сессию показывать: двойной щелчок по Узлу Оркестратора кладёт его `nodeId` и `projectId`
  в `src/renderer/session/navigation.ts` и переключает окно на Session. Без щелчка (кнопка
  Session в toolbar) показывается Оркестратор активного Проекта: его `nodeId` даёт
  `orchestrator.open` — тот же вызов main делает сам, повторный ничего не меняет.
- `src/renderer/session/store.ts` — события всех Сессий в renderer, одна подписка на
  `agent.event`. `renamed` переносит события со временного id на id Claude Code; соседние `delta`
  склеиваются; хранится не больше 5000 событий на Сессию. Своё сообщение пользователя Claude Code
  событием не присылает, поэтому Session view записывает его сам как `notice` вида `user` — в той
  же форме, в какой его даст разбор файла транскрипта (тикет 14). Если Claude Code всё же пришлёт
  эхо, оно отбрасывается. Ничего не сохраняется: после перезапуска транскрипт пуст (ADR 0002,
  ADR 0005), прошлые ходы покажет тикет 14.
- `src/renderer/session/fold.ts` — свёртка событий в строки транскрипта; `Transcript.tsx` её
  рисует и не знает, откуда события. Текст ассистента — markdown, пока блок пишется — по `delta`,
  потом заменяется целым блоком на том же месте. Thinking свёрнут. Подряд идущие tool-вызовы — одна
  группа, у каждого одна строка с ✓, «error» или «running»; по щелчку видны вход и результат.
  Subagent, запущенный вызовом Agent, показан на строке этого вызова; без такого вызова — своей
  строкой. Hook-и — строкой, если сказали что-то (так их отдаёт тикет 07). Конец хода — «Turn
  finished · N s», прерванный ход — пометка «Interrupted», ошибка хода или Сессии — строка ошибки.
  Сообщение «[Request interrupted by user]» от Claude Code в транскрипт и в историю промптов не
  попадает: прерывание показывает `result`. Текст и tool-вызовы subagent-ов (`parentToolUseId`)
  в основной транскрипт не идут — это дерево subagent-ов тикета 15.
- `src/renderer/session/MessageInput.tsx` — Return отправляет (`agent.send`), Shift+Return —
  новая строка, ↑/↓ в пустом поле (или пока в нём промпт из истории) листают промпты этой Сессии,
  поле растёт до 200 px. Пока Сессия `busy`, кнопка отправки — «Interrupt» (`agent.interrupt`),
  Escape — то же самое, Return не отправляет. Неотправленное сообщение возвращается в поле с
  текстом ошибки.
- `src/renderer/markdown/Markdown.tsx` — общий рендер: `react-markdown` + `remark-gfm`. Сырой HTML
  без `rehype-raw` становится текстом: `<script>` и `<img onerror>` видны, но не исполняются.
  Картинки markdown не загружаются — вместо них alt-текст. Ссылки (`links.ts`): `https://` — в
  браузер через `shell.openExternal`; путь без схемы — файл Проекта через `shell.openInEditor`
  (относительно `baseDir` документа, для HANDOFF и ADR тикета 12); `http://`, `javascript:`,
  `mailto:`, `//host`, `#якорь` — не ссылка. С `breaks` (так зовёт транскрипт) одиночный перевод
  строки остаётся переводом строки (`soft-breaks.ts`): иначе четыре строки блока состояния
  склеивались в одну — это показал прогон с настоящим SDK.

Точки расширения (бриф: MessageInput потом расширят 19 и 20, Transcript — 14 и 21, rail — 15, 16,
22):

- `src/renderer/session/rail/<Имя>.tsx` — блок правой панели (`order` + компонент с
  `RailBlockProps`), собирается `rail/index.ts` через `import.meta.glob`. Сейчас блоков нет, и
  панель не рисуется совсем.
- `src/renderer/session/composer/<Имя>.tsx` — элемент нижней строки поля ввода (очередь, выбор
  модели, вложения), `composer/index.ts`.
- `src/renderer/session/rows/<Имя>.tsx` — строка транскрипта для своего типа события
  (`eventType`), например запрос разрешения тикета 21; `rows/index.ts`. Файл перекрывает
  встроенную отрисовку того же типа.

Решения вне следа «Где в коде»:

- `src/renderer/shell/AppShell.tsx` (тикет 03): вид Canvas / Session теперь можно задать снаружи
  (`view`, `onViewChange`); без них AppShell, как раньше, держит его сам. Без этого двойной щелчок
  по Узлу не мог переключить окно. `main.tsx` берёт вид из `session/navigation.ts`.
- `src/renderer/canvas/nodes/OrchestratorNode.tsx`: таблица состояний и формат стоимости
  переехали в `src/renderer/session/format.ts` — ими пользуются и Узел, и шапка Session view;
  поведение Узла то же. Узел получил двойной щелчок.
- Вспомогательные файлы рядом со следом: `session/store.ts`, `fold.ts`, `history.ts`,
  `navigation.ts`, `format.ts`, `session.css`, `markdown/links.ts`, `markdown/soft-breaks.ts`,
  `markdown/markdown.css`; fixture `test/fixtures/agent-scripts/session-view.jsonl`.

Чего нет:

- Effort в шапке — «—»: ни `system/init`, ни другие события SDK его не сообщают. Выбор модели и
  effort — тикет 19.
- Времени у строк транскрипта нет: события тикета 07 не несут времени.
- Ссылка вида `src/x.ts:12` (с номером строки) не открывается: `:` читается как схема.

Ручной прогон с настоящим SDK. Не руками, а Playwright-скриптом в scratchpad: собранное
приложение без `WORFY_AGENT=fake`, временный `WORFY_DATA_DIR`, Проект — worktree этого тикета,
настоящий `~/.claude`. Session view открыт кнопкой Session в toolbar, в поле ввода отправлено
«ответь блоком состояния (четыре строки: Этап, Сейчас, Дальше, Жду), ничего не делай и не
запускай инструментов». Итог: `busy` → `idle` за 5.6 s, модель `claude-opus-5-5[1m]`, режим
`bypass`, стоимость в шапке; в транскрипте свёрнутый Thinking и блок из четырёх строк
(«— Этап: worfy-mvp/33, окно сессии…», «— Сейчас: …», «— Дальше: …», «— Жду: команду
продолжать…»); тот же блок дословно на Узле Оркестратора после возврата на Canvas. Снимки
(`real-session-light.png`, `real-node.png`) лежат в scratchpad сессии, в репозиторий не
добавлены. Двойным щелчком в этом прогоне открыть не удалось: на Холсте репозитория worfy рамка
эпика `worfy-mvp` лежит поверх Узла Оркестратора и перехватывает щелчок (Playwright: «w-epic__drag
… intercepts pointer events»). Это раскладка тикета 11, не этого тикета; двойной щелчок проверен
в e2e на Проекте без эпиков.

Снимки fake-сценария в обеих темах — `session-view-busy-{light,dark}.png` (ход идёт, кнопка
«Interrupt» в поле ввода) и `session-view-{light,dark}.png` (после прерывания, многострочное поле)
в `test-results/` после `pnpm test:e2e`.
