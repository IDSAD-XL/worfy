# 22 — History и slash-команды Codex

Type: task
Status: done 2026-11-03T04:03Z
PR: #1264
Blocked by: 20
Source: [spec.md](../spec.md), «Модель» (History, таблица частей); решение 06 ([06-граница-vendor.md](06-граница-vendor.md), части history и commands); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); Ticket 05 ([05-codex-транскрипты.md](05-codex-транскрипты.md)); Ticket 02 ([02-codex-управление-сессией.md](02-codex-управление-сессией.md), строка «Список slash-команд»)

## Что делаем

1. `src/main/vendors/codex/history.ts`: `list(cwd)` — `thread/list` с фильтром `cwd` и `sourceKinds`, без
   архивных; у каждой Session — id, название, время, откуда начата (`source`, `originator`: `worfy` — своя).
   `read(id, cwd)` — `thread/read {includeTurns: true}` (`cwd` Codex-у не нужен: thread находится по id; spec,
   «Решено без владельца», п. 13) → `TranscriptEntry` (`src/shared/transcript/parse.ts:38`) через
   перевод item-ов Ticket-а 20. Rollout-файлы worfy не читает.
2. `src/main/vendors/codex/commands.ts`: строки slash-меню — `skills/list` (обновление по `skills/changed`) и
   встроенные, у которых есть метод app-server: `/compact` — `thread/compact/start`, `/review` — `review/start`.
   Встроенные TUI без метода в список не входят.
3. Правятся только `codex/history.ts` и `codex/commands.ts` (stub-и Ticket-а 17); `index.ts` — нет.

Платформенный: `cwd` Session-ов сравнивается с путями Project-а (`isInsidePath`, разные разделители и регистр на Windows).

Глубина review — `high` (driver Codex).

## Готово, когда

- [ ] Contract test на фейке (`threads`): `list` по `cwd` Project-а находит thread-ы, начатые в worfy и в терминале,
      и отличает их; `read` даёт записи с сообщениями, мыслями, командами и их выводом.
- [ ] Contract test: slash-меню — skills сценария и `/compact`, `/review`; вызов skill уходит item-ом `skill` в
      `turn/start`.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/main/vendors/codex/history.ts`, `commands.ts` (stub-и Ticket-а 17 заменяются)
- `test/unit/codex-history.test.ts`, `test/contract/codex-history.test.ts` (новые)

Только читать: `src/shared/transcript/parse.ts:26-50`, `src/main/agent/commands.ts:1-12`,
`src/main/vendors/codex/items.ts` (Ticket 20).

## Итог

- `src/main/vendors/codex/history.ts` — часть history driver-а Codex. Каждый запрос — свой короткоживущий
  `codex app-server`, как у account (`withCodex`, `account.ts`); без папки CODEX_HOME процесс не запускается, у такого
  Codex thread-ов нет.
  - `list(cwd)` — `thread/list {sourceKinds: cli, vscode, exec, appServer; archived: false; sortKey: updated_at, desc}`
    постранично (100 × до 20 страниц, `shortcut:` в коде). Thread-ы Subagent-ов (`subAgent*`) не входят.
    Папку сравнивает worfy, `isInsidePath` (`src/main/claude-home/registry.ts:80`) в NFC: папка Project-а или папка
    внутри неё, на Windows — любой разделитель и без учёта регистра. Фильтр `cwd` самого Codex сравнивает путь точно и
    теряет подпапки и другой регистр, поэтому он не передаётся — отличие от п. 1 «Что делаем» (решено без владельца,
    подтвердить). Название — `name`, иначе `preview`; время — `updatedAt` × 1000; `origin` — `originator`: `worfy` —
    своя, другой — `external`, нет — `null`.
  - `read(id, cwd)` — `thread/read {threadId, includeTurns: true}`, `cwd` не нужен. Item-ы переводит `CodexItems`
    Ticket-а 20 (как `item/completed` живой Session); сообщение пользователя — `notice` `user`, как в транскрипте
    Claude; у записи — id item-а и время начала его хода.
- `src/main/vendors/codex/commands.ts` — slash-меню: `/compact`, `/review`, затем включённые skills `skills/list` по
  имени, каждый один раз (описание — `interface.shortDescription`, `shortDescription`, `description`). Разбор
  сообщения: `/compact` → `thread/compact/start`; `/review` → `review/start` inline (`uncommittedChanges`, с текстом —
  `custom`); skill → текст `$name …` и item `skill {name, path}` в том же `turn/start`. Встроенная команда с вложениями
  уходит обычным сообщением, чтобы вложения не потерялись (решено без владельца, подтвердить).
- `src/main/vendors/codex/session.ts` — п. 3 «Что делаем» («правятся только history.ts и commands.ts») неверен: разбор
  команды и item `skill` — в `deliver`/`userInput` Session; `skills/list` спрашивается раз на процесс и снова после
  `skills/changed`; `commands()` отдаёт строки меню (без skills, если `skills/list` не ответил; пусто после close).
  `/compact` или `/review` во время хода — notice «только между ходами» (решено без владельца, подтвердить); отказ
  Codex — `result` с ошибкой `Codex did not run /compact: …`.
- `commandsComplete` у Codex остаётся `false`: команды TUI без метода (`/model`, `/plan` …) в меню не входят.
- Тесты: `test/unit/codex-history.test.ts`, `test/contract/codex-history.test.ts` (сценарии `threads`, `thread-read`),
  новые случаи в конце `test/contract/codex-session.test.ts` (сценарии `skills`, `compact`, `review`);
  `test/unit/codex-capabilities.test.ts` — убраны проверки stub-ов history и commands.
- Rework, раунд 1 (замечания проверки PR #1264):
  - `/review`: Codex отдаёт ревью в item `exitedReviewMode.review`, а не в `agentMessage`. `CodexItems.itemCompleted`
    (`items.ts`) делает из него событие `text` и ответ хода, так что `result.text` — текст ревью. Сценарий `review`
    теперь шлёт `exitedReviewMode` вместо выдуманного `agentMessage`.
  - Короткоживущий процесс history закрывается и после timeout запроса (`CODEX_ASK_TIMEOUT_MS`, 30 s), и после отказа
    `thread/read`, и после 20-й страницы `thread/list`: contract test-ы с молчащим stand-in (timeout подменяется на
    200 ms в обёртке `StartCodex`, а запрошенный остаётся проверен — 30 000), со сценарием `threads` для отказа
    `thread/read` и с новым сценарием `threads-pages` (21 страница, ровно 20 запросов).
  - Test-ы проверяют литералы `sourceKinds` и размер страницы (100), а не константы модуля.
  - Unit test: skill с картинкой и файлом не теряет их (`userInput`). Contract test-ы: `/compact` и `/review` во время
    хода дают notice и ничего не шлют; меню без skills (`/compact`, `/review`), когда `skills/list` не ответил.
  - Skill с `/` в имени в меню не попадает: `slashName` такое имя не прочтёт, строка меню его бы не запустила.

Ревью (PR #1264):

- Ступень `high` по тексту Epic-а (spec.md:440). Круг 1 — verifier, два reviewer-а, sceptic: REJECTED, пять пунктов
  (закрыты доработкой «Rework, раунд 1» выше), 348 394 subagent-токена. Круг 2 — verifier и reviewer (`medium`):
  VERIFIED; debt, 130 566 токенов. После rebase на `d977ed503` (head `780336468`) — повторная проверка (`low`):
  `git range-diff` — оба commit-а те же, `ci-ok` зелёный; вердикт круга 2 в силе, токены не измерены.
- Act on круга 1 (исправлено):
  - не доказано, что короткоживущий app-server history закрывается по timeout, при отказе `thread/read` и на пределе
    страниц (`history.ts:127`, `:131`, `:143`; mutant-ы timeout и бесконечного цикла выживали);
  - `/review` терял результат: Codex отдаёт ревью в item `exitedReviewMode.review`, `items.ts:236-240` делал из него
    `unknown`; фикстура `review.jsonl:6,10` выдумывала `agentMessage`;
  - test сверял `sourceKinds` и размер страницы с той же константой (`history.ts:35`,
    `test/contract/codex-history.test.ts:79`);
  - skill с вложениями без test-а — картинки и файлы могли теряться (`session.ts:127`);
  - ветки команд без test-ов: `/compact` или `/review` во время хода (`session.ts:373`), меню `/compact` + `/review`
    при отказе `skills/list` (`session.ts:276`).
- Consider (low), долг:
  - нет фильтра `cwd` в `thread/list`: список Project-а пуст, если его thread-ы старше 2000 новейших в других папках;
    запуски `exec` видны как Session-ы (`history.ts:35`, `:45`, `:130`);
  - Interrupt между ответом `thread/compact/start` и `turn/started` теряется молча (`session.ts:377-379`, `:223`);
  - slash-меню пусто после смерти процесса, а main держит для него `lastHandle` (`session.ts:270-271`);
  - `read` теряет `image`/`localImage` сообщений пользователя, «Attached files:» не становятся вложениями
    (`history.ts:76-84`, `:100`);
  - skill с `/` в имени был в меню, а `slashName` его не находил (`commands.ts:57`, `:66`) — закрыто в доработке выше.
- Noted (low), долг:
  - встроенная команда с вложениями уходит обычным текстом без notice (`commands.ts:79-80`);
  - комментарий `history.ts:18` «worfy writes nothing into CODEX_HOME» слишком силён: `thread/list` чинит state db;
  - без test-ов: повтор после отказа `skills/list` (`session.ts:285`), `activeTurn` после `review/start` (`:382`), текст
    ошибки skill (`:335`), `shortDescription`, фильтр пустого имени и `trimStart` (`commands.ts:47`, `:57`, `:77`),
    мелкие ветки `history.ts:52`, `:58`, `:70`, `:83`, `:94`.
- Debt круга 2 (low):
  - `agentMessage` и `exitedReviewMode` в одном ходе `/review` дают два события `text`, ответ — ревью (оно последнее);
    фикстуры на пару нет, на настоящем Codex не проверено (`src/main/vendors/codex/items.ts:229-235`);
  - `enteredReviewMode` по-прежнему приходит событием `unknown` (`items.ts`, ветка `default`);
  - строка, которая делает ход `/review` текущим (и её проверка `lastEnded`), без test-а: сообщение или Interrupt во
    время ревью не проверены (`src/main/vendors/codex/session.ts:450`);
  - `codexSkills()` после закрытия handle-а без test-а (`session.ts:350`).
- Dismissed: нет.
- Решено без владельца, подтвердить: `exec` в `sourceKinds` `thread/list` (`history.ts:35`) — запуски `codex exec` в
  папке Project-а видны в списке Session-ов. Остальные решения этого «Итог» уже отмечены выше: нет фильтра `cwd`
  (предел 2000 новейших thread-ов), встроенная команда с вложениями — обычным текстом, `/compact` или `/review` во
  время хода — notice.
