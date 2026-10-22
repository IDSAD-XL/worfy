# 36 — Долг после review PR #530: Ticket в focus mode

Type: task
Status: open
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

- [ ] **Silent mode: «Open in editor» и ссылки в теле ничего не делают.** В Silent mode Ticket-ы лежат в
      Workflow folder вне Project-а. `tickets.read` разрешает места «корень Project-а, `ticketsRoot`,
      Workflow folder» (`src/main/ipc/tickets.ts:39`), а `shell.openInEditor` — только корень Project-а
      и его worktree (`src/main/ipc/shell.ts:126-127`). Кнопка «Open in editor»
      (`src/renderer/canvas/nodes/TicketNode.tsx:161-169`, вызов `:128`) и ссылки тела Ticket-а получают
      отказ, а окно пишет его только в console. Правка: Workflow folder — разрешённое место
      `shell.openInEditor` (вместе с проверкой вида файла Ticket-а 35); пока её нет — причина на плитке, а
      не молчание.
- [ ] **Относительные ссылки тела считаются от абсолютной папки.** `TicketBody.tsx:16` даёт `Markdown`
      `baseDir` = `folderOf(path)` (`src/renderer/canvas/nodes/ticket-text.ts:50`) — абсолютный путь, а
      `classifyLink` ждёт папку относительно корня Project-а (`src/renderer/markdown/links.ts:70-75`).
      Ссылка работает, пока Ticket внутри Project-а, но путь UNC (`\\host\share\…`) теряет ведущие `\\`.
      Правка: `tickets.read` отдаёт ещё и путь относительно корня Project-а, как `docs.read`; `baseDir`
      берётся из него.
- [ ] **Правка тела Ticket-а стоит пересчёта Stages и чтения Autopilot.** С PR #530 у Ticket-а есть
      `version` — hash текста (`src/main/workflow/reader.ts:308-310`), и правка одного тела — delta
      workflow. На delta Stages читают профиль заново (`src/main/workflow/stages.ts:117`, `bin/profile
      --json` через `src/main/ipc/pipeline.ts:21-26`, без кэша), Autopilot перечитывает workflow
      (`src/main/autopilot/run.ts:547`, `:808`, `:826`). Замерить цену на Project-е с сотнями Ticket-ов
      или пропускать пересчёт, когда изменилась только `version`; решение — в «Итог».
- [ ] **Test: `ticketsRoot` в Silent mode вне Workflow folder.** `readTicketFile`
      (`src/main/ipc/tickets.ts:35-48`): случай, когда `ticketsRoot` лежит вне Workflow folder, не
      проверен (`test/contract/tickets-read.test.ts`).
- [ ] **Test: Esc закрывает focus mode.** Обработка Esc — `src/renderer/focus/FocusMode.tsx:155-156`
      (`escapePress`) и `:347-369`; покрыто только e2e — добавить unit.
- [ ] **Test: устаревший ответ `tickets.read`.** `ticket-text.ts:35` (`if (!live) return`) — мутант без
      проверки выживает: ответ про прошлый Ticket, пришедший после смены фокуса, перезаписал бы текст.
- [ ] **Test: ключ при смене slug.** `ticket-text.ts:38` и `:45` сравнивают ключ
      `projectId/epic/num/slug`; переименование slug Ticket-а (тот же номер) не проверено.
- [ ] **Test: «Open in editor» на Linked machine без `path`.** `TicketNode.tsx:187-190`: кнопка
      выключена, пока нет `read.path`; случай Linked machine (путь не пришёл) не проверен.
- [ ] **Test: нет `version`, когда файл не прочитан.** `reader.ts:309`: `markdown === null` даёт Ticket без
      `version` — не проверено.
- [ ] **Много слушателей `will-quit`.** Log Stable `e61cb1fe` 2026-10-19:
      `MaxListenersExceededWarning: 11 will-quit listeners added to [App]`. Каждый модуль main вешает
      свой (например, архив Session-ов — `src/main/index.ts:150`). Одна точка выхода, которая зовёт
      остановки по списку, или `setMaxListeners` с комментарием, сколько их и почему.
- [ ] **Ревью #692 (Ticket 35), круг 2, low.** Строки — по main `81ea31cd`.
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
- [ ] **Ревью #716 (worfy-ui 24), остаток low.** Строки — по main `b1e7ce39`.
  - `src/renderer/claude-home/useClaudeHome.ts:432` (`readFromStart`) — мутант «собрать все события файла, обрезать
    до `KEEP_EVENTS` в конце» вместо `keepNewest` на каждом chunk-е проходит test-ы: что между chunk-ами держатся
    только новейшие события, не проверено.
- [ ] **Ревью #705 (worfy-windows 72), находка вне диффа, low.** Строки — по head PR `8fd99b9f`.
  - `harness/bin/tests/wave-gate.test.sh:246-253` — `finish` по timeout останавливает только процесс `wave-gate`;
    его дочерние процессы остаются без родителя. Останавливать группу процессов или дерево целиком.
- [ ] **Ревью #727 (worfy-windows 47), low.** Строки — по main `b1700b18`.
  - `src/main/storage/remove.ts:86` — шапка модуля говорит, что ошибка просмотра хранит только code и path. После
    #727 она хранит ещё `errno` и `syscall`, исходная ошибка — в `cause`. Поправить фразу.
- [ ] **Ревью #705 (worfy-windows 72), low.** Строки — по main `b1700b18`.
  - `test/contract/login-shell-capture.test.ts:96` — resolve hook дописывает `.ts` к каждому относительному
    specifier-у без расширения и не проверяет, что такой файл есть. Сломается, если `env.ts` когда-нибудь
    импортирует CJS-пакет с внутренним `require('./x')`. Дописывать `.ts` только когда файл `.ts` существует.
- [ ] **Ревью #726 (worfy-windows 69), вопрос для worfy-link, не найденный дефект.** Строки — по main `b1700b18`.
  - `src/main/ipc/linked.ts:159` — после переподключения link счётчики окон подписок не сбрасываются, и окна не
    шлют `docs.open` заново. Это общее для всех строк `SUBSCRIBING` (`claudeHome`, `workflow`, `pipeline`, `docs`).
    Спросить в worfy-link, что должно быть после переподключения; правка — только по ответу.
- [ ] **Ревью #729 (worfy-windows 84), три low.** Строки — по head PR `73ea9833`.
  - `PROFILE_VARS` и `profileVars` лежат в `test/e2e/terminal-shell.ts:56-63`, а берут их и contract-test-ы
    (`test/contract/link-access.test.ts:44`, `test/contract/terminal-profile-isolation.test.ts:13`). Перенести в
    общий `test/windows-profile.ts`.
  - `test/e2e/launch-env.ts:9-11` — комментарий говорит, что у git приложения нет глобального config-а. Это верно,
    только когда `HOME` не задан. Под Git Bash `HOME` задан, и git читает глобальный config владельца. Поправить
    комментарий (или задать git свой `HOME`).
  - `test/e2e/launch-env.ts:119-125` — `DIRECT_START_PROFILE` — одна папка на все запуски без Playwright, и её
    никто не удаляет. `afterAll` в `test/contract/terminal-profile-isolation.test.ts:27` может удалить её, пока
    другой запуск ещё ею пользуется. Когда запуск без Playwright откроет Terminal — дать каждому запуску свою папку.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

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

Заполняется при закрытии.
