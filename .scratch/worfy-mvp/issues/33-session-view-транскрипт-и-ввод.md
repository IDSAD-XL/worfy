# 33 — Session view: полный транскрипт Сессии, markdown и поле ввода

Type: task
Status: done — 2026-10-05, [PR #19](https://github.com/IDSAD-XL/worfy/pull/19)
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
- [x] Ручной прогон на репозитории worfy с настоящим SDK: сообщение «ответь блоком состояния» даёт блок в транскрипте и на Узле Оркестратора; снимок в «Итог». (Повтор 2026-10-06 ночью: блок совпал дословно, но Session view не открывался двойным щелчком по Node-у Orchestrator-а — подраздел [«Ручная проверка 2026-10-06, ночь»](#ручная-проверка-2026-10-06-ночь); исправил Ticket 10 `worfy-daily`, проверено 2026-10-07 — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).)

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
  Ключ строки — позиция её события во всей Сессии (`SessionLog.first` + индекс), а не индекс в
  оставшемся массиве: когда store отбрасывает старые события сверх 5000, строки не пересоздаются,
  раскрытые tool-вызовы и Thinking не сворачиваются.
  Транскрипт держится внизу, пока читатель внизу: после новых строк (layout effect) и при смене
  размера лога (`ResizeObserver`). Второе нужно для строк, пришедших, пока был виден Canvas: у
  скрытого лога нет высоты, прокрутить его нельзя, и без наблюдателя после возврата на Session
  view последний ответ оставался ниже видимой области (это показало ревью; e2e теперь повторяет
  этот путь).
- `src/renderer/session/MessageInput.tsx` — Return отправляет (`agent.send`), Shift+Return —
  новая строка, ↑/↓ в пустом поле (или пока в нём промпт из истории) листают промпты этой Сессии,
  поле растёт до 200 px. Пока Сессия `busy`, кнопка отправки — «Interrupt» (`agent.interrupt`),
  Escape — то же самое, Return не отправляет. Неотправленное сообщение возвращается в поле с
  текстом ошибки. Строка «you» появляется сразу при отправке (`recordPrompt`), до ответа
  `agent.send`; если `agent.send` вернул ошибку, Session view убирает её из транскрипта и истории
  промптов (`retractPrompt`). Записывать после ответа хуже: события хода и эхо промпта могут прийти
  раньше ответа на `invoke`, и строка встала бы не на своё место.
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
  панель не рисуется совсем. Что glob действительно находит файл, проверяет
  `test/unit/session-rail-discovery.test.tsx`: кладёт временный блок в `rail/` и заново
  импортирует `rail/index.ts` (так же, как `shell-discovery.test.tsx` для sidebar и toolbar).
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
— текст блока со снимка Session view:

```
— Этап: worfy-mvp/33, окно сессии с транскриптом и полем ввода. Работа идёт в worktree на ветке worfy-mvp/33, коммитов по тикету ещё нет.
— Сейчас: по снимку git на старте сессии в ветке есть незакоммиченные правки. Изменены OrchestratorNode.tsx, main.tsx, AppShell.tsx и файл тикета. Добавлены src/renderer/session/ и src/renderer/markdown/, unit-тесты, e2e-тест и fixture. Тесты и gate в этой сессии я не запускал, так что статус проверки неизвестен.
— Дальше: прогнать ~/.claude/hooks/gate.sh fast и e2e-тест session-view.spec.ts, затем отдать дифф reviewer-агенту.
— Жду: команду продолжать. Сейчас, как вы просили, я ничего не запускал.
```

Шапка на том же снимке: `idle`, `claude-opus-5-5[1m]`, `bypass`, `$0.2118`, «Turn finished · 5.6 s».
Тот же блок на Узле Оркестратора после возврата на Canvas: на снимке `real-node.png` Узел
наполовину закрыт рамкой эпика `worfy-mvp`, видны только куски текста (« `AppShell.tsx` и файл
тикет…», « `main.tsx` »), и они совпадают с блоком выше. Дословное совпадение целиком
сверялось по выводу консоли того прогона, а он не сохранён; по сохранённому его уже не проверить.
Снимки (`real-session-light.png`, `real-node.png`) в репозиторий не добавлены и лежат только в
scratchpad сессии, который будет удалён. Повторить прогон с настоящим SDK в круге доработки
не стал: Claude Code пишет транскрипт в `~/.claude/projects`, а менять `~/.claude` агенту
запрещено. Двойным щелчком в этом прогоне открыть не удалось: на Холсте репозитория worfy рамка
эпика `worfy-mvp` лежит поверх Узла Оркестратора и перехватывает щелчок (Playwright: «w-epic__drag
… intercepts pointer events»). Это раскладка тикета 11, не этого тикета; двойной щелчок проверен
в e2e на Проекте без эпиков.

Снимки fake-сценария в обеих темах — `session-view-busy-{light,dark}.png` (ход идёт, кнопка
«Interrupt» в поле ввода) и `session-view-{light,dark}.png` (после прерывания, многострочное поле)
в `test-results/` после `pnpm test:e2e`.

### Ручная проверка 2026-10-06, ночь

Сборка `main` @ 92c00a5, проверял агент. Режим Б: собранный `worfy.app`, запущенный через
LaunchServices с окружением launchd, настоящий Claude Code с входом владельца. Project CanvasForAI.
Console renderer читался через CDP и сохранён (`16-console.log`). Снимки лежат в scratchpad Session оркестратора, в репозиторий не положены.

**Блок состояния на Node-е Orchestrator-а и в транскрипте — не прошло (проверка 16 гайда).** Блок
совпадает дословно, но Session view не открывается двойным щелчком по Node-у Orchestrator-а.

- ⌘K → Orchestrator → Return центрирует Node (40,40, 360×200). Его целиком закрывает рамка Epic-а
  `worfy-daily` (0,0, 1832×676): `elementFromPoint` во всех четырёх точках Node-а возвращает рамку.
- Двойной щелчок по заголовку «Orchestrator» Session view не открыл. Открыт кнопкой «Session» в toolbar.
- Ответ — четыре строки «— Этап / Сейчас / Дальше / Жду» за 3,6 с, без tools. Первое сравнение —
  `verbatim: false`: вся разница в обратных кавычках, Node показывает сырой текст, транскрипт рисует
  Markdown. Повтор с припиской «без Markdown», как велит гайд, — `verbatim: true`, на Node-е четыре
  строки.
- Дефекты:
  - рамка Epic-а закрывает Node Orchestrator-а и перехватывает двойной щелчок. Свёрнутая рамка тоже
    лежит поверх: шапка `worfy-daily` — на строке заголовка Node-а, свёрнутая `worfy-mvp` — на блоке
    состояния. Причина — размещение: рамки стопкой от (0,0) (`src/renderer/canvas/epic-layout.ts:246-255`),
    `placeNewNode` не видит рамок (`src/main/layout/place.ts:14-16`). Исправляет Ticket 10 `worfy-daily`;
  - блок состояния не помещается в Node 360×200: это `pre` с `overflow: auto`
    (`src/renderer/canvas/nodes/OrchestratorNode.tsx:50-55`), scrollHeight 169 при clientHeight 148,
    строка «— Жду:» видна только после прокрутки.
- Попутно, в этой и других проверках той же ночи: ответы обычной Session, не Orchestrator-а, подписаны
  «orch» — `assistantLabel="orch"` для любой Session (`src/renderer/session/SessionView.tsx:191`).
- Рамку сворачивали и разворачивали обратно, вид восстановлен. Cost Orchestrator-а $0.3124 → $0.3445.
  `git status --porcelain` основного checkout пуст до и после.
- Снимки: `16-03-step1-orchestrator-covered.png`, `16-05-step2-after-dclick.png`,
  `16-08-step3-reply-idle.png`, `16-10-step5-node-crop.png`, `16-13-step5-repeat-node-crop.png`,
  `16-14-extra-epic-collapsed-node-uncovered.png`.

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M8 второго круга ручных проверок). Stable copy из 5060858
(pid 74430, CDP 9351) после прогона Autopilot `2026-10-07T00-32-09-524Z-66ddaf` (кончился
`run-stopped` в 04:38:34Z). Node Orchestrator-а был за краем Canvas — сдвинут прокруткой.

- Контроль: кнопка «Transcript» у Subagent-а impl-09 переключила Session view на него, потом возврат
  на Canvas. Значит, до щелчка Session view не показывал Orchestrator.
- Один двойной щелчок мышью ОС (CGEvent) по заголовку «Orchestrator» (`elementFromPoint` подтвердил
  цель) открыл Session view «Orchestrator · CanvasForAI · idle», Canvas скрыт.
- Последний ответ Orchestrator-а (04:38:33Z) уже кончался блоком состояния из 4 строк, поэтому новый
  ход не отправлялся.
- На Node-е 4 строки блока: `textContent` и `title` дословно равны тексту ответа в транскрипте
  `f6ab7045-416c-471a-a78d-433567aefa5a.jsonl`. В Session view тот же текст, `6df9791` отрисован как code.
- Блок на Node-е: `scrollHeight` 148 = `clientHeight` 148, `scrollTop` 0, строка «— Жду:» в видимой
  области. Три длинные строки обрезаны «…» (вариант (б) Ticket-а 27 `worfy-daily`), полный текст —
  в `title`.
- Попутно: пунктирный Edge Binding идёт поверх текста Node-а Orchestrator-а, и без выделения тоже.
  Не разбиралось.
- Вердикт: проверено.
- Снимки: Session view — [33-orchestrator-session-view.png](../evidence/33-orchestrator-session-view.png), блок
  на Node-е — [33-orchestrator-node-block.png](../evidence/33-orchestrator-node-block.png). Остальное — в
  scratchpad Session Orchestrator-а: `M8-before-dblclick.png`, `M8-node-window.png`, `M8-block.json`.
