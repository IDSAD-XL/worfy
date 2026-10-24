# 36 — Долг после review PR #530: Ticket в focus mode

Type: task
Status: claimed 2026-10-24T02:16Z
Branch: worfy-polish/36
Blocked by: —
Source: ревью PR [#530](https://github.com/IDSAD-XL/worfy/pull/530) (Ticket 33, Ticket целиком в focus
mode), круг 1: линза «корректность» и линза «тесты» (52 мутанта: 38 убито, 6 эквивалентных, 8 пробелов).
Все находки — low: мерж они не держали (правило глубины ревью владельца 2026-10-12). Строки перечитаны
по main `2af91b51`; номера строк ревью в `ticket-text.ts` (`:335`, `:338`, `:345`) — опечатка, на main
это `:35`, `:38`, `:45`.

## Что происходит

Каждый пункт ниже — пробел, который ревью нашло и оставило на потом. Один пункт — одна строка
«Готово, когда». Находка security того же круга (ссылка на `.command` / `.app` запускает его) —
отдельный Ticket [35](35-ссылка-в-markdown-запускает-command-и-app.md).

## Что делаем

Закрыть каждый пункт правкой или test-ом. Если пункт оказался не нужен — строка в «Итог» с причиной.

## Готово, когда

- [x] **Silent mode: «Open in editor» и ссылки в теле ничего не делают.** В Silent mode Ticket-ы лежат в
      Workflow folder вне Project-а. `tickets.read` разрешает места «корень Project-а, `ticketsRoot`,
      Workflow folder» (`src/main/ipc/tickets.ts:39`), а `shell.openInEditor` — только корень Project-а
      и его worktree (`src/main/ipc/shell.ts:126-127`). Кнопка «Open in editor»
      (`src/renderer/canvas/nodes/TicketNode.tsx:161-169`, вызов `:128`) и ссылки тела Ticket-а получают
      отказ, а окно пишет его только в console. Правка: Workflow folder — разрешённое место
      `shell.openInEditor` (вместе с проверкой вида файла Ticket-а 35); пока её нет — причина на плитке, а
      не молчание.
- [x] **Относительные ссылки тела считаются от абсолютной папки.** `TicketBody.tsx:16` даёт `Markdown`
      `baseDir` = `folderOf(path)` (`src/renderer/canvas/nodes/ticket-text.ts:50`) — абсолютный путь, а
      `classifyLink` ждёт папку относительно корня Project-а (`src/renderer/markdown/links.ts:70-75`).
      Ссылка работает, пока Ticket внутри Project-а, но путь UNC (`\\host\share\…`) теряет ведущие `\\`.
      Правка: `tickets.read` отдаёт ещё и путь относительно корня Project-а, как `docs.read`; `baseDir`
      берётся из него.
- [x] **Правка тела Ticket-а стоит пересчёта Stages и чтения Autopilot.** С PR #530 у Ticket-а есть
      `version` — hash текста (`src/main/workflow/reader.ts:308-310`), и правка одного тела — delta
      workflow. На delta Stages читают профиль заново (`src/main/workflow/stages.ts:117`, `bin/profile
      --json` через `src/main/ipc/pipeline.ts:21-26`, без кэша), Autopilot перечитывает workflow
      (`src/main/autopilot/run.ts:547`, `:808`, `:826`). Замерить цену на Project-е с сотнями Ticket-ов
      или пропускать пересчёт, когда изменилась только `version`; решение — в «Итог».
- [x] **Test: `ticketsRoot` в Silent mode вне Workflow folder.** `readTicketFile`
      (`src/main/ipc/tickets.ts:35-48`): случай, когда `ticketsRoot` лежит вне Workflow folder, не
      проверен (`test/contract/tickets-read.test.ts`).
- [x] **Test: Esc закрывает focus mode.** Обработка Esc — `src/renderer/focus/FocusMode.tsx:155-156`
      (`escapePress`) и `:347-369`; покрыто только e2e — добавить unit.
- [x] **Test: устаревший ответ `tickets.read`.** `ticket-text.ts:35` (`if (!live) return`) — мутант без
      проверки выживает: ответ про прошлый Ticket, пришедший после смены фокуса, перезаписал бы текст.
- [x] **Test: ключ при смене slug.** `ticket-text.ts:38` и `:45` сравнивают ключ
      `projectId/epic/num/slug`; переименование slug Ticket-а (тот же номер) не проверено.
- [x] **Test: «Open in editor» на Linked machine без `path`.** `TicketNode.tsx:187-190`: кнопка
      выключена, пока нет `read.path`; случай Linked machine (путь не пришёл) не проверен.
- [x] **Test: нет `version`, когда файл не прочитан.** `reader.ts:309`: `markdown === null` даёт Ticket без
      `version` — не проверено.
- [x] **Много слушателей `will-quit`.** Log Stable `e61cb1fe` 2026-10-19:
      `MaxListenersExceededWarning: 11 will-quit listeners added to [App]`. Каждый модуль main вешает
      свой (например, архив Session-ов — `src/main/index.ts:150`). Одна точка выхода, которая зовёт
      остановки по списку, или `setMaxListeners` с комментарием, сколько их и почему.
- [x] **Ревью #692 (Ticket 35), круг 2, low.** Строки — по main `81ea31cd`.
  - `src/main/ipc/shell.ts:133,139-140` — диалог показывает имя файла как есть: U+202E (RTL override) делает
    `setup<RLO>dm.command` похожим на `.md`. Убрать управляющие символы bidi (U+202A–202E, U+2066–2069) или
    показать расширение отдельной строкой.
  - `test/contract/link-access.test.ts:454` — отказ Linked machine проверен на `HANDOFF.md` (документ); взять путь `.term`.
  - `src/main/ipc/shell.ts:80` — `.jsx` в `DOCUMENTS_POSIX` без test-а.
  - Вопрос: Finder alias с именем `x.md` — обычный файл; LaunchServices, вероятно, идёт по нему к цели (zip
    сохраняет xattr). Проверить и решить.
  - `test/contract/shell.test.ts` на Windows-runner-е (run 39636532876 на `4d661620`): 12 падений, все — ожидаемый
    путь в форме 8.3 (`C:/Users/RUNNER~1` против `runneradmin`), test строит пути от `os.tmpdir()` без
    `realpath.native`; на main те же 4 старых (run 39637861605). Поля логики совпадают. Правка: `realpath.native`
    временного корня в `shell.test.ts`.
- [x] **Ревью #716 (worfy-ui 24), остаток low.** Строки — по main `b1e7ce39`.
  - `src/renderer/claude-home/useClaudeHome.ts:432` (`readFromStart`) — мутант «собрать все события файла, обрезать
    до `KEEP_EVENTS` в конце» вместо `keepNewest` на каждом chunk-е проходит test-ы: что между chunk-ами держатся
    только новейшие события, не проверено.
- [x] **Ревью #705 (worfy-windows 72), находка вне диффа, low.** Строки — по head PR `8fd99b9f`.
  - `harness/bin/tests/wave-gate.test.sh:246-253` — `finish` по timeout останавливает только процесс `wave-gate`;
    его дочерние процессы остаются без родителя. Останавливать группу процессов или дерево целиком.
- [x] **Ревью #727 (worfy-windows 47), low.** Строки — по main `b1700b18`.
  - `src/main/storage/remove.ts:86` — шапка модуля говорит, что ошибка просмотра хранит только code и path. После
    #727 она хранит ещё `errno` и `syscall`, исходная ошибка — в `cause`. Поправить фразу.
- [x] **Ревью #705 (worfy-windows 72), low.** Строки — по main `b1700b18`.
  - `test/contract/login-shell-capture.test.ts:96` — resolve hook дописывает `.ts` к каждому относительному
    specifier-у без расширения и не проверяет, что такой файл есть. Сломается, если `env.ts` когда-нибудь
    импортирует CJS-пакет с внутренним `require('./x')`. Дописывать `.ts` только когда файл `.ts` существует.
- [x] **Ревью #726 (worfy-windows 69), вопрос для worfy-link, не найденный дефект.** Строки — по main `b1700b18`.
  - `src/main/ipc/linked.ts:159` — после переподключения link счётчики окон подписок не сбрасываются, и окна не
    шлют `docs.open` заново. Это общее для всех строк `SUBSCRIBING` (`claudeHome`, `workflow`, `pipeline`, `docs`).
    Спросить в worfy-link, что должно быть после переподключения; правка — только по ответу.
- [x] **Ревью #729 (worfy-windows 84), три low.** Строки — по head PR `73ea9833`.
  - `PROFILE_VARS` и `profileVars` лежат в `test/e2e/terminal-shell.ts:56-63`, а берут их и contract-test-ы
    (`test/contract/link-access.test.ts:44`, `test/contract/terminal-profile-isolation.test.ts:13`). Перенести в
    общий `test/windows-profile.ts`.
  - `test/e2e/launch-env.ts:9-11` — комментарий говорит, что у git приложения нет глобального config-а. Это верно,
    только когда `HOME` не задан. Под Git Bash `HOME` задан, и git читает глобальный config владельца. Поправить
    комментарий (или задать git свой `HOME`).
  - `test/e2e/launch-env.ts:119-125` — `DIRECT_START_PROFILE` — одна папка на все запуски без Playwright, и её
    никто не удаляет. `afterAll` в `test/contract/terminal-profile-isolation.test.ts:27` может удалить её, пока
    другой запуск ещё ею пользуется. Когда запуск без Playwright откроет Terminal — дать каждому запуску свою папку.
- [x] **Ревью #732 (worfy-windows 87), low.** Строки — по main `206b8aea`.
  - `test/contract/linked-shared-subscriptions.test.ts:30` — папка test-а берётся из `os.tmpdir()` как есть. Сведение
    разных написаний корня к одному проверяется только на runner-ах, где у `%TEMP%` есть короткое имя 8.3. На win32
    писать папку test-а в другом регистре, чтобы эту проверку проходила каждая машина Windows.
- [x] **Ревью PR #733 (worfy-browser 04), четыре low.** PR #733 ещё не влит; строки — по head PR `9743baa8`.
  - `src/main/ipc/browser.ts:50-56` — handler `browser.page.live` не проверяет, что partition гостевой страницы
    совпадает с профилем Browser-а `nodeId`.
  - Литерал вида Node `'browser'` записан трижды: `src/main/mcp/browser-server.ts:46` (новый файл PR #733),
    `src/renderer/canvas/nodes/browser-frame.ts:9`, `src/renderer/canvas/nodes/BrowserNode.tsx:41`. Размер 640×440
    тоже дважды: `src/shared/browser/tools.ts:16` (новый файл PR #733) и `BrowserNode.tsx:42-43`. Перенести оба
    в `src/shared/browser`.
  - `src/main/browser/cdp.ts:178-181` (новый файл PR #733) — после detach debugger-а состояние CDP сбрасывается не
    полностью: handler обнуляет только `attaching` и `mainFrame`, а `requests` и журналы остаются. Test-а на detach
    нет — мутант M5 выжил.
  - Session может вести любой Browser своего Project-а, чей бы `openedBy` у него ни был. Решить в
    [worfy-browser Ticket 06](../../worfy-browser/issues/06-browser-и-жизнь-session.md).
- [x] **Ревью #736 (worfy-windows 86), два low.** Строки — по main `90cb2fff`.
  - `test/e2e/wheel-over-nodes.spec.ts:326` — комментарий test-а говорит, что без правки он красный «on every
    system». На Mac это не так: проводку доказывает только Windows. Чтобы test был красным и на Mac, напечатать
    больше строк, чем помещается на экране (например, `seq 40`).
  - `test/unit/terminal-alt-buffer.test.tsx:3` — canary идёт на `@xterm/headless`, а приложение рисует
    `@xterm/xterm`. Добавить test, что версии двух пакетов в `package.json` совпадают.
- [x] **Ревью #733 (worfy-browser 04), пять low.** Строки — по main `90cb2fff`.
  - `src/main/browser/cdp.ts:282` — debugger никогда не отключается (`detach`), поэтому обход service worker-а
    (`Network.setBypassServiceWorker`) действует, пока жива страница.
  - `keepWindowFocus` (`src/renderer/browser/control.ts:80`) — нет unit test-а.
  - `src/main/browser/cdp.ts:203` — в полях `email` и `number` курсор остаётся в начале: `setSelectionRange` для
    них бросает исключение.
  - `src/main/browser/cdp.ts:213` — синтетический Enter имеет `isTrusted: false` и не добавляет перевод строки в
    `textarea`.
  - Между нажатием Session и возвратом фокуса (`src/renderer/browser/control.ts:80`) есть окно в несколько ms.
  - Мутант M5 (после detach состояние сбрасывается не полностью) — уже записан выше, в пункте «Ревью PR #733».
- [x] **Ревью #737 (worfy-windows 42), low.** Строки — по main `90cb2fff`.
  - `src/main/first-run/checks.ts:162` — `variable` держит свою копию `getVar` (`src/main/agent/env.ts:209`).
    Заменить на `getVar`.
- [x] **Ревью #738 (worfy-windows 85), low.** PR #738 ещё не влит; строки — по main `90cb2fff`.
  - `harness/bin/tests/wave-gate-heartbeat.test.sh:111` — под zsh случай «40 запусков» иногда находит один
    оставшийся `sleep`: гонка между `pkill -P` и `sleep`, который только запускается. Красный в 1 из 3 прогонов;
    не регрессия.
- [x] **Ревью #740 (worfy-windows 89), два low.** Строки — по main `a371aa41`.
  - `src/renderer/projects/GithubAccount.tsx:327` — вид `gh auth login` («Sign in with gh») пишет replay
    одним `terminal.write` и не берёт `sizes`, историю размеров pty из worfy-windows 89. Перевести его на
    `writeReplay`, как `TerminalNode`.
  - `src/renderer/canvas/nodes/terminal-replay.ts:61` — `console.warn` в `writeReplay` (replay остановлен
    броском xterm.js) остаётся в консоли renderer-а и не доходит до log-а main.
- [x] **Ревью #741 (worfy-browser 05), low.** Строки — по main `a371aa41`.
  - `src/main/browser/live.ts:316-326` — когда `browsersOf` бросает, `browsersNow` отвечает `'unknown'`, и
    запись Asleep Browser-а этого Project-а остаётся, пока ошибка не пройдёт.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Contract: `test/contract/tickets-read.test.ts`, `test/contract/shell.test.ts`.
- Unit: test-ы `ticket-text`, `FocusMode`, `TicketNode`; `test/unit/workflow-reader*` для `version`.

## Где в коде

- `src/main/ipc/tickets.ts`, `src/main/ipc/shell.ts`, `src/shared/ipc/tickets.ts`
- `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/nodes/TicketBody.tsx`,
  `src/renderer/canvas/nodes/ticket-text.ts`, `src/renderer/focus/FocusMode.tsx`
- `src/main/workflow/reader.ts`, `src/main/workflow/stages.ts`, `src/main/autopilot/run.ts` — только читать,
  если правка не нужна
- `src/main/index.ts` (`will-quit`)

## Вне скоупа

- Проверка вида файла перед `shell.openPath` — Ticket 35.

## Итог

Ветка `worfy-polish/36`. По пунктам «Готово, когда»:

- **Silent mode, «Open in editor» и ссылки.** `shell.openInEditor` разрешает ещё Workflow folder и
  Tickets root layout-а (`workflowPlaces`, `src/main/ipc/shell.ts`); у layout-а, который не прочитан
  или не ответил, этих мест нет. Проверка вида файла Ticket-а 35 остаётся. Причина на плитке не
  понадобилась: отказа больше нет. Test-ы — `test/contract/shell.test.ts`, «in a Silent Project».
- **Относительные ссылки.** `tickets.read` отдаёт `relative` — путь от корня Project-а через `/`
  (`relativeToRoot`, `src/main/ipc/tickets.ts`), `baseDir` тела берётся из него (`linkFolderOf`).
  Нет такого пути (другой диск или share на Windows) — `null`, тогда остаётся абсолютная папка
  (комментарий `shortcut:`). Test-ы — `tickets-read.test.ts`, `ticket-focus.test.tsx`.
- **Цена правки тела.** Выбран пропуск, без замера: `onlyTextChanged`
  (`src/shared/workflow/types.ts`) — модели отличаются только `version`; такой change hub не шлёт
  подписчикам с `fieldsOnly` — Stages (`stages.ts`) и Autopilot (`src/main/ipc/autopilot.ts`).
  Stages и цикл Autopilot `version` не читают. Test-ы — `workflow-reader.test.ts` («workflow hub»),
  `workflow-stages.test.ts`.
- **`ticketsRoot` вне Workflow folder**, **устаревший ответ**, **смена slug**, **Linked machine без
  `path`**, **нет `version`** — test-ы в `tickets-read.test.ts`, `ticket-focus.test.tsx`,
  `workflow-reader.test.ts`; каждый красный на своём мутанте.
- **Esc закрывает focus mode** — уже покрыт unit-ом: `test/unit/focus-mode.test.tsx`, describe «Esc»
  (с `:258`). Правки нет.
- **`will-quit`.** `src/main/quit-listeners.ts` — первый import `src/main/index.ts`, поднимает предел
  до 40 (18 мест подписки и по одному на run Autopilot). Одна точка выхода не выбрана: она меняла бы,
  какой listener может задержать выход (`preventDefault` Terminal-а и link-а). Test —
  `test/unit/quit-listeners.test.ts`.
- **Ревью #692.** Диалог показывает имя без управляющих символов bidi (`shownName`); `.term` в отказе
  Linked machine (`link-access.test.ts`); `.jsx` в test-е JavaScript-исходников. Finder alias
  проверен: `NSWorkspace.urlForApplication` для alias `x.md` на `.command` отвечает Terminal, то есть
  LaunchServices идёт к цели. Решение: на macOS файл, данные которого начинаются с bookmark data
  (`book\0\0\0\0mark`), не документ, и main спрашивает. Alias до Mac OS X 10.6 (запись в resource
  fork) не виден — `shortcut:`. `realpath.native` в `shell.test.ts` уже есть (#802, `:59-61`).
- **Ревью #716** — test, что между chunk-ами держатся только новейшие события
  (`session-history-tail.test.tsx`).
- **Ревью #705, вне диффа** — `finish` останавливает всё дерево процессов run-а
  (`harness/bin/tests/wave-gate-world.sh`, случай в `wave-gate.test.sh`).
- **Ревью #727** — шапка `remove.ts` поправлена.
- **Ревью #705, resolve hook** — `.ts` дописывается, только когда такой файл есть.
- **Вопрос #726 (`linked.ts`, счётчики подписок после переподключения)** — правки нет: по тикету
  правка только по ответу worfy-link; вопрос передан orchestrator-у.
- **Ревью #729** — `PROFILE_VARS` и `profileVars` в `test/windows-profile.ts`; комментарий о
  глобальном config-е git поправлен (верно, пока у процесса нет `HOME`). `DIRECT_START_PROFILE` не
  менялся: запуск без Playwright Terminal не открывает, комментарий `shortcut:` в `launch-env.ts` это
  и говорит.
- **Ревью #732** — на win32 папка test-а пишется в верхнем регистре.
- **Ревью #736** — `seq 40` в `wheel-over-nodes.spec.ts`; test, что версии `@xterm/headless` и
  `@xterm/xterm` совпадают.
- **Ревью #733, четыре и пять low.** `browser.page.live` проверяет partition профиля Browser-а; вид
  `'browser'` и размер 640×440 — в `src/shared/browser/tools.ts`. Detach debugger-а: test, что
  следующий вызов подключается заново, а журналы остаются; обход service worker-а на всю жизнь
  страницы — `shortcut:` в `cdp.ts`. `email` и `number` — текст дописывается через `select()`; Enter
  в `textarea` — команда редактирования страницы (e2e `browser-mcp.spec.ts`). Unit на
  `keepWindowFocus` — `browser-window-focus.test.tsx`; окно в несколько ms оставлено намеренно
  (фокус возвращается в конце клика, иначе страница теряет фокус между mousedown и mouseup) —
  комментарий в `control.ts`. Вопрос «Session водит чужой Browser» закрыт в worfy-browser 06.
- **Ревью #737** — `checks.ts` берёт `getVar` из `agent/env.ts`.
- **Ревью #738** — release heartbeat-а повторяет `pkill -P`, пока три прохода подряд не найдут
  потомка (не больше 2 s): в `harness/skills/epic-wave/SKILL.md` и в `scripts/e3-sandbox.sh`
  (решение orchestrator-а); оба закреплены проверкой текста.
- **Ревью #740.** Вид «Sign in with gh» пишет replay через `writeReplay` с `sizes`. `console.warn` в
  `writeReplay` остаётся в консоли renderer-а: способа переслать предупреждение renderer-а в log main
  нет, а такой канал для всех предупреждений — отдельное решение (решение orchestrator-а, без нового
  Ticket-а).
- **Ревью #741** — test: запись Asleep Browser-а держится, пока список не читается, и уходит при
  первом чтении без него (`browser-sleep.test.ts`).

Ревью PR #826, круг 1 (high), исправлено:

- `relative` в ответе `tickets.read` необязателен: Linked machine на старом worfy отвечает без него,
  и тело Ticket-а считает ссылки от абсолютной папки, как раньше.
- Enter в contenteditable проверен e2e `browser-mcp.spec.ts`; вид «Sign in with gh», когда gh уже
  вышел, — unit `signin-replies.test.tsx`.
- Диалог открытия убирает из имени все управляющие символы (C0, DEL, C1), U+2028 и U+2029, а не только
  bidi. `.jsx` больше не документ: на Mac с Adobe это ExtendScript, и открытие его запускает.
- `workflowPlaces` не берёт корень диска и home folder; `tickets.read` берёт свои места из него же.
  Правило «путь выходит из папки» — одна функция `leavesFolder` (`src/main/remote-links.ts`).
- Test-ы: подписчик с `fieldsOnly` получает изменение Epic-а; Autopilot подписан с `fieldsOnly`
  (`workflowWatch`, `src/main/ipc/autopilot.ts`); first-run читает `Path` и `systemroot`.
- `descendants` в `wave-gate-world.sh` читает пары pid и ppid (`ps -A -o pid= -o ppid=`, в Git Bash —
  `/proc/<pid>/ppid`), а не столбцы `ps -ef`, первый из которых — имя пользователя, иногда с пробелом.

`pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (418 файлов). e2e Browser-ов, focus mode,
Terminal, колеса, `projects-connect`, Ticket-а, Linked machine и Autopilot — 67 passed.

Ревью PR #826, круг 2 (medium), исправлено:

- `workflowPlaces` судит место и по пути как написан, и по realpath, и сравнивает с realpath home
  folder: место, которое содержит home folder (папка выше, symlink на него, тот же путь в другом
  регистре на APFS), или корень диска либо share не берётся. Несуществующее место тоже не берётся.
  Раньше сравнение шло по тексту, и Workflow folder `/Users` или symlink на home открывал `~/.ssh/id`.
  Test-ы — `shell.test.ts`: и на `workflowPlaces`, и через `shell.openInEditor` с подменённым HOME.
- Диалог «Open?» показывает U+FFFD на месте каждого управляющего символа, а не убирает его:
  `notes.md<BEL>` не выглядит как `notes.md`, имя из одних управляющих символов не пустое.

Ревью PR #826, круг 3, исправлено:

- realpath на macOS оставляет firmlink `/System/Volumes/Data/Users` и `/.nofollow/Users` как есть,
  поэтому место сверяется ещё и по device и inode (stat). Место не берётся, если это home folder или
  папка выше него, или если имена от такой папки до home (`Users/alexey`) ведут внутри места к home
  folder. Место внутри home folder остаётся. Ошибка stat места — место не берётся; не читается папка
  выше home — не берётся ни одно место. Test-ы — `shell.test.ts` (stat подменён, и на macOS — живые
  `/System/Volumes/Data` и `/.nofollow`), `tickets-read.test.ts` (realpath, который дали
  `readTicketFile`, доходит до `workflowPlaces`).
- Не закрыто: bind mount на Linux, который кладёт home folder в место под другим именем, этой
  проверкой не виден.
