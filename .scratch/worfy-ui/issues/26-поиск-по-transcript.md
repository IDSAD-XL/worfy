# 26 — Поиск по Transcript в Session view (⌘F, Ctrl+F)

Type: task
Status: claimed 2026-10-23T15:16Z
Blocked by: —
Source: просьба владельца 2026-10-23: «нужен поиск по чату на ctrl + f». Владелец принял все пять
пунктов (раздел «Что делаем»). Идёт раньше Ticket-а 22 (виртуализация Transcript): оба меняют
`Transcript.tsx`, и 22 строит виртуализацию уже на строках с поиском; ключи строк остаются
прежними, чтобы 22 мог прокрутить к строке по её индексу.

## Что происходит

- ⌘F (Ctrl+F на Windows и Linux) есть только на Canvas: запись `find` в
  `src/shared/shortcuts.ts` (scope `canvas`), обработчик `src/renderer/find/CanvasFind.tsx`
  выходит, когда Canvas скрыт. В Session view клавиша ничего не делает (по main `0c4789b7`).
- Поиск Canvas ищет по данным (`src/renderer/find/search-index.ts`), а не по DOM. Поиска по
  Transcript одной Session нет ни в Session view живой Session (`SessionView.tsx`, `SessionPanel`),
  ни в Session view внешней Session и Subagent-а (`ExternalSessionPanel.tsx`).
- Transcript показывает не всё: tool calls свёрнуты в строку «N tools» (Ticket 25), thinking, hook и
  notice спрятаны в закрытую строку (`Disclosure`), а начало длинного транскрипта не прочитано
  вовсе — оно за «Load earlier» (Ticket 21, окно 4 MiB в конце файла). Поиск по DOM
  (`findInPage`) не нашёл бы ни то, ни другое.

## Что делаем

Решения владельца 2026-10-23 и implementer-а.

1. **⌘F (Ctrl+F на Windows и Linux) открывает find bar Session view.** Новая запись
   `session.find` в группе Find (scope `session view`), не `find` Canvas-а. Bar прикреплён к шапке
   Session view справа, под её строкой, поверх верха Transcript: в самой строке шапки при окне
   1280 px нет места (заголовок, Model, Effort, Permissions, Cost, Hide tools, Interrupt). В bar —
   поле, «3 of 12», кнопки «Previous match», «Next match», «Close». Enter — следующее совпадение,
   Shift+Enter — предыдущее (по кругу), Esc закрывает bar и снимает подсветку; повторный ⌘F
   выделяет текст поля. Совпадения подсвечены, текущее — ярче; Transcript прокручивается к
   текущему. Поиск без учёта регистра, с двух символов (как на Canvas, `MIN_FIND_QUERY`).
   - Подсветка — CSS Custom Highlight API (`CSS.highlights`): диапазоны поверх текста, без правки
     DOM, который рисует React; так подсвечивается и текст, нарисованный markdown-ом.
   - Порядок совпадений — порядок Transcript, «1» — самое старое. При вводе текущим становится
     последнее совпадение не ниже нижнего края видимой части лога: у читателя внизу это самое
     новое, Shift+Enter идёт к более старым.
2. **Что ищется.** Текст ответа модели (и строки «claude code»), сообщения пользователя, thinking,
   у tool call — имя tool и его строка (команда, файл, pattern: то, что видно в строке call),
   описание Subagent-а, имя hook-а и его вывод, текст notice и ошибки.
   - **Не ищутся полные input и result tool call-ов** (JSON входа, вывод Bash, файл из Read). Это
     основная масса байт транскрипта (в транскрипте Orchestrator-а 43,5 MB почти всё — результаты
     tools): почти любой запрос находил бы десятки совпадений в выводе, и каждое пришлось бы
     показывать раскрытием строки call с `<pre>`, обрезанным до 20 000 символов (`TEXT_LIMIT`).
     Что call делал, видно по его строке, а она ищется.
   - Совпадение в свёрнутой строке «N tools» раскрывает её; в закрытой строке thinking, hook или
     notice — открывает её. Раскрытая так строка остаётся раскрытой.
3. **Вся история, а не только экран.** Совпадения в прочитанной части считает renderer по
   элементам `foldTranscript`. Непрочитанную часть файла (байты до `earlier`, за «Load earlier»)
   ищет main: новый канал `claudeHome.transcriptFind` читает файл от начала до `before`, разбирает
   строки тем же `parseTranscriptLine` и считает совпадения в тех же полях (общая функция
   `src/shared/transcript/find.ts`). Ответ — байт строки и число совпадений в ней (не больше
   20 000 строк, самые поздние; ранние — одним числом `skipped`). «N of M»: M = совпадения до
   `earlier` + совпадения в прочитанной части. Переход к совпадению в непрочитанной части нажимает
   «Load earlier», пока окно не дойдёт до байта его строки, и прокручивает к нему.
   - **Почему так, а не прочитать всё в renderer.** Прочитать в renderer весь файл 40 MB значит
     держать и рисовать десятки тысяч строк (до Ticket-а 22 все в DOM) — именно то, что Ticket 21
     убрал. Main читает файл без React и отдаёт только позиции; renderer грузит окна только до
     нужного совпадения.
   - **Без зависания.** Main разбирает файл кусками около 1 MiB с ходом event loop между ними,
     как `claudeHome.search`; строку без запроса в тексте (с учётом `\u` и `\/` в JSON) он не
     разбирает. Запрос в main идёт после паузы ввода 150 ms; ответ на старый запрос
     отбрасывается. Замер на транскрипте 40 MB — в «Итог».
   - Совпадения той же строки после её загрузки считает уже renderer; если cap `KEEP_EVENTS`
     выбросил старые события и `earlier` сдвинулся вперёд, main ищет заново.
   - Ключи строк (`e<N>` из `fold.ts`) не меняются; у каждой строки лога есть `data-row` с её
     ключом, текущее совпадение находится по ключу строки и части — это пригодится Ticket-у 22.
4. **Где работает:** Session view живой Session (`SessionView.tsx`) и `ExternalSessionPanel.tsx`
   (внешние Session-ы и Subagent-ы, у Subagent-а — его собственный файл). Только пока на экране
   Session view. ⌘F и Ctrl+F в Terminal не забирает: на Windows и Linux Ctrl+F внутри Terminal
   остаётся у shell (`match.ts`), а Canvas со своими Terminal Node-ами в это время скрыт.
5. Epic `worfy-ui`; раньше Ticket-а 22.

## Готово, когда

- [x] ⌘F на macOS и Ctrl+F на Windows и Linux открывают bar в Session view обоих видов, в том
      числе при русской раскладке; Esc закрывает; Enter и Shift+Enter ходят по кругу.
- [x] Поиск без учёта регистра, кириллица, несколько совпадений в одном сообщении; «N of M».
- [x] Совпадение в свёрнутой строке «N tools» раскрывает её; в thinking, hook, notice — открывает.
- [x] Совпадение за «Load earlier» входит в M; переход к нему подгружает окна до него и
      прокручивает к нему.
- [x] Main ищет по транскрипту 40 MB, отдавая ход event loop; замер в «Итог».
- [x] Ctrl+F внутри Terminal на Windows остаётся у shell.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, e2e `test/e2e/session-view.spec.ts` и
      `test/e2e/session-history-tail.spec.ts` — exit 0.

## Тесты

- Unit `test/unit/session-find.test.tsx` (новый): совпадения без учёта регистра, кириллица,
  несколько в одном сообщении, совпадение в «N tools» раскрывает строку, в thinking — открывает;
  клавиши по платформам и с русской раскладкой, Esc, Enter, Shift+Enter; совпадения до `earlier`
  из ответа main входят в M, переход подгружает окна.
- Unit `test/unit/transcript-find.test.ts` (новый): поиск main по файлу — байты строк, `before`,
  `skipped`, разбор только строк с запросом, ход event loop.
- Contract `test/contract/transcript-find.test.ts` (новый): настоящий обработчик и файл 40 MB,
  замер.
- E2e: в `test/e2e/session-view.spec.ts` — Orchestrator возобновляет Session с транскриптом
  10 MB: ⌘F, ввод, «N of M», переход, совпадение за «Load earlier» найдено и прокручено, Esc;
  окно 1280 px через `setContentSize`, снимки обеих тем. В `test/e2e/session-history-tail.spec.ts`
  — то же для внешней Session.

## Где в коде

- `src/shared/shortcuts.ts` (запись `session.find`)
- `src/shared/transcript/find.ts` (новый)
- `src/shared/transcript/parse.ts` (`INTERRUPT_NOTICE` переезжает сюда)
- `src/shared/ipc/claude-home.ts` (канал `claudeHome.transcriptFind`)
- `src/main/claude-home/transcript-find.ts` (новый)
- `src/main/ipc/claude-home.ts`
- `src/renderer/claude-home/useClaudeHome.ts` (состояние транскрипта вне React для подгрузки)
- `src/renderer/session/transcript-find.ts` (новый)
- `src/renderer/session/SessionFind.tsx` (новый)
- `src/renderer/session/Transcript.tsx`
- `src/renderer/session/history.ts`
- `src/renderer/session/SessionView.tsx`
- `src/renderer/session/ExternalSessionPanel.tsx`
- `src/renderer/session/session.css`
- `test/big-transcript.ts` (текст ответа по номеру хода)
- `test/unit/session-find.test.tsx` (новый)
- `test/unit/transcript-find.test.ts` (новый)
- `test/unit/shortcuts.test.tsx`
- `test/unit/link-access.test.ts`
- `test/contract/transcript-find.test.ts` (новый)
- `test/contract/claude-home-registry.test.ts`
- `test/contract/claude-home-link-root.test.ts`
- `test/e2e/session-view.spec.ts`
- `test/e2e/session-history-tail.spec.ts`

## Итог

Сделано по решениям «Что делаем», без отступлений. Bar стоит справа вверху области Transcript,
под строкой шапки; снимки 1280 px (светлая и тёмная тема) — в e2e `session-view.spec.ts`
(`session-find-light.png`, `session-find-dark.png` в его `test-results`).

- **Непрочитанная история.** Main (`src/main/claude-home/transcript-find.ts`) читает байты
  `[0, before)` кусками по 1 MiB, разбирает только строки, где может быть запрос (сырой текст в
  нижнем регистре, строки с `\u`, с `\/` для запроса со `/`; запрос с кавычкой, `\` или
  управляющим символом — разбирает всё), и считает совпадения теми же полями, что renderer
  (`eventFindTexts`). Ответ — байт строки и число совпадений; не больше 20 000 строк, самые
  поздние, ранние — числом `skipped`. Переход к такому совпадению жмёт «Load earlier», пока
  `earlier` не станет не больше байта его строки; потом совпадение берётся уже из строк лога.
- **Замер** (contract `test/contract/transcript-find.test.ts`, транскрипт 40,0 MB, 6198 turns):
  запрос «zebra» — 20 ms и 305 ходов event loop за поиск; запрос «xx», который есть в каждой
  сырой строке (разбирается всё), — 26 ms и 308 ходов. Renderer не ждёт main: строки на экране
  считаются сразу, «N of M+» до ответа.
- **Тесты.** Unit `test/unit/transcript-find.test.ts` (9), `test/unit/session-find.test.tsx` (11),
  contract `test/contract/transcript-find.test.ts` (3), e2e — по одному в `session-view.spec.ts` и
  `session-history-tail.spec.ts` (read-only view terminal Session через
  `ExternalSessionPanel`). Mutation testing: prefilter без `\u`, `skipped` всегда 0, раскрытие
  строки выключено, одна загрузка окна вместо цикла, клавиша по букве вместо `code` — каждый
  mutant красный.
- **Границы.** Полные input и result tool call-ов не ищутся (почему — пункт 2). Выбор стартового
  совпадения по положению в окне проверен только e2e (в jsdom нет layout). Subagent в
  `ExternalSessionPanel` ищет свой файл (contract с `agentId`); отдельного e2e для Subagent-а нет.

**Fix round 1 (review PR #805).**

- **Что считается.** Считается видимый текст строки, поэтому каждое посчитанное совпадение подсвечено.
  - Ответ Claude считается так, как его рисует markdown (`src/shared/markdown/visible-text.ts`). Это тот же pipeline, что у react-markdown: unified, remark-parse, remark-gfm, soft breaks, remark-rehype.
  - Для этого в `package.json` прямыми зависимостями добавлены `unified`, `remark-parse` и `remark-rehype`. Эти версии и так стояли в `node_modules` транзитивно.
  - Сам React не используется: его типы в node-программе tsc ломают DOM-типы e2e-спеков.
  - Вывод hook-а и добавленный notice считаются по тексту после обрезки до 20 000 символов (`clipText`, общий с Transcript).
- **Prefilter в main.** Запрос с разметкой посередине (`**foo** bar`) иначе не нашёлся бы. Теперь достаточно, чтобы буквы запроса шли в сырой строке по порядку (`mayShow`).
- **Замер (40 MB, 6198 turns).**
  - «zebra» — 27 ms;
  - каждая строка разобрана — 35 ms;
  - каждый ответ прочитан как markdown — 194 ms;
  - во всех трёх случаях event loop получает больше 300 ходов.
- **Живая Session после Resume.** Пока окно не показывает ни одного turn-а из файла до Resume, main не спрашивается (`pastSettled`), и окна дочитываются так же, как по «Load earlier».
- **Окно ушло вперёд.** Когда cap событий сдвигает `earlier`, main ищет только новую часть `[before, earlier)` (параметр `from`). Ответ дополняется (`extendAnswer`).
- **Subagent за краем окна.** Строка Subagent-а, чей Agent call лежит до окна, не считается: её уже посчитал main в call-е.
- **Повторный переход.** Каждый шаг и каждый ⌘F снова открывают строку текущего совпадения и снова прокручивают к нему (`TranscriptFind.seq`).

**Fix round 2.**

- **Живая Session после Resume (доработка round 1).** Окно считается дошедшим до turn-ов до Resume, только если в оставленной `joinPastAndLive` части есть событие с id или prompt (`keepsTurnBeforeResume` в `store.ts`). События без id, например добавленный notice или вывод hook-а, могут быть и после Resume, поэтому их мало.
- **Файл открыт заново.** Если файл заменили или обрезали, reader открывает его заново с конца и выдаёт новый `TranscriptState.opening`. Ключ find включает `opening`, поэтому ответ main о старом файле отбрасывается и поиск идёт с начала.
- **Кэш видимого текста.** Ограничен 4 000 000 символов ключей и значений. Ответ больше десятой части лимита не кэшируется.
