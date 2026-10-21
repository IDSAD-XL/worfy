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
