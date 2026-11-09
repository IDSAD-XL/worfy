# 79 — Удаление Project-а освобождает его пути; перенос между Full и Silent mode

Type: task
Status: claimed 2026-11-09T16:49Z
Blocked by: —
Source: решение владельца 2026-11-09 (отзыв тестера): репозиторий нельзя подключить своим Project-ом и ещё раз — частью
папки над несколькими репозиториями; удаление Project-а путь не освобождает. Строки перечитаны по main `964061f9a`.

## Что происходит

**Один путь — один Project.** `project-connect` отказывает пути, который уже есть в registry Gate:
`harness/bin/project-connect:593` — «`<path>` is already in the gate registry» (сравнение по realpath с `knownMatches`,
:577); :588 — то же для ключа. Правило нужно: Profile находится по пути. `bin/profile` спрашивает
`hooks/gate-resolve.mjs --which` (`harness/bin/profile:19`), тот читает registry (`harness/hooks/gate-resolve.mjs:25`)
и берёт самый длинный префикс `match` (:56); папка над несколькими репозиториями одного Profile-а — `workspaceOf`
(`harness/bin/profile:195`). Если бы один путь принадлежал двум Project-ам, hook-и, gate и skill-ы в этом репозитории не
знали бы, чей Profile, команды и ticket-ы брать. Правило остаётся.

**«Remove from list» путь не освобождает.** Кнопка — `src/renderer/shell/sidebar/ProjectsSection.tsx:273–274`, вызов
`projects.remove` — :422. Handler (`src/main/ipc/projects.ts:392–397`) сбрасывает Layout и зовёт `ProjectStore.remove`
(`src/main/projects/store.ts:312`): Project уходит только из списка worfy, папка данных остаётся (комментарий :308).
registry Gate `~/.claude/worfy-harness/gate/config.json`, папка Profile-а `~/.claude/worfy-harness/projects/<name>/` и
`runs/<name>/` не трогаются. Вопроса перед удалением нет (`docs/features/projects.md:259`: «acts at once, without a
question»). Поэтому путь остаётся занятым, и повторное подключение того же репозитория получает отказ :593.

**Полное удаление в Harness-е уже есть.** `project-connect --remove <name>` (`harness/bin/project-connect:24–37`, код с
:306) одним commit-ом убирает папку Profile-а (с Workflow folder Silent mode по умолчанию внутри), все записи registry с
`profile: <name>`, `runs/<name>/`, затем коллекции qmd. Репозитории не трогает; при сбое откатывает. Если Workflow
folder по умолчанию хранит ticket-ы проекта, отказывает и ничего не удаляет (:333). Приложение зовёт `--remove` только
для демо-проекта (`src/main/getting-started/demo.ts:247`).

**Переноса Full ↔ Silent нет.** `mode` задаётся один раз при подключении (`src/renderer/projects/ConnectProject.tsx`,
шаг Mode; отказ Full для папки над несколькими репозиториями — `src/main/projects/connect.ts:569` и
`harness/bin/project-connect:598`). Workflow folder по умолчанию — `<папка Profile-а>/workflow` (:557, :608), своя — :613;
Full требует `workflow.folder: null` (:606). `profile-set` `mode` не пишет.

## Что делаем

Этот ticket — **удаление**. Перенос Full ↔ Silent большой (копия ticket-ов, spec, ADR и файла состояния между
репозиторием и Workflow folder, commit в двух git, новый `mode` и `workflow.folder`, проверка, что ни одна Session не
работает) — отдельный ticket после этого; номер даст Orchestrator. Ниже он описан, чтобы его можно было завести.

Удаление:

- В меню Project-а две строки: «Remove from list» (как сейчас: только список worfy) и «Remove project…» — полное
  удаление.
- «Remove project…» спрашивает: что уйдёт (Profile, записи registry Gate для путей …, отметки агентов `runs/<name>`,
  коллекции qmd) и что останется (репозитории, ticket-ы в репозитории в Full mode). Кнопка подтверждения —
  «Remove project».
- Подтверждение: main закрывает Orchestrator и Session-ы Project-а, затем `project-connect --remove <name>`, затем
  `ProjectStore.remove`. Сбой скрипта — Project остаётся в списке, текст скрипта виден в диалоге.
- Silent mode, ticket-ы в Workflow folder по умолчанию: скрипт отказывает (:333). Диалог показывает этот отказ и
  предлагает «Show in Finder» для папки: пользователь сам переносит ticket-ы. worfy ticket-ы пользователя не удаляет.
- После удаления тот же репозиторий подключается снова — своим Project-ом или частью папки над несколькими
  репозиториями.

Перенос (следующий ticket, не этот):

- Full → Silent: ticket-ы, `spec.md`, ADR, файл состояния переезжают из репозитория в Workflow folder; в репозитории —
  commit удаления этих файлов, в Workflow folder — commit добавления; `mode: silent`, `workflow.folder`.
- Silent → Full: обратный путь; запрещён для Project-а над несколькими репозиториями (ADR-0045, пункт о Silent mode).
- Оба: только когда у Project-а нет работающих Session-ов и открытых PR тикетов; иначе отказ с причиной.

## Готово, когда

- [ ] «Remove project…» с подтверждением зовёт `project-connect --remove <name>`; после успеха записей registry с этим
  Profile-ом нет, папки Profile-а нет, Project-а нет в списке.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/projects-connect.spec.ts` exit 0 · mac - · 5f636c185
  - evidence: gate pass · `gate fast` exit 0 (test/contract/projects-remove.test.ts, test/contract/projects.test.ts) · mac - · 5f636c185
  - evidence: gate pass · `gate fast` exit 0 (round 1: projects-remove, projects contract tests) · mac - · d02b622cb
  - evidence: gate pass · gate fast exit 0 (Windows rename rule: projects-remove, projects contract tests) · mac - · f0ca8d9ed
  - evidence: gate pass · gate fast exit 0 (round 2: hub hold tests, projects-remove) · mac - · ff510cc79
- [ ] Повторное подключение того же репозитория после «Remove project…» проходит без отказа «already in the gate
  registry».
  - evidence: test-run pass · `bash harness/bin/tests/project-connect.test.sh` exit 0 · mac - · 5f636c185
  - evidence: test-run pass · `pnpm test:e2e test/e2e/projects-connect.spec.ts` exit 0 · mac - · 5f636c185
  - evidence: test-run pass · `pnpm test:e2e test/e2e/projects-connect.spec.ts` exit 0 (round 1) · mac - · d02b622cb
  - evidence: test-run pass · pnpm test:e2e test/e2e/projects-connect.spec.ts exit 0 (Windows fix round) · mac - · f0ca8d9ed
  - evidence: test-run pass · pnpm test:e2e test/e2e/projects-connect.spec.ts exit 0 (round 2) · mac - · ff510cc79
- [ ] Silent mode с ticket-ами в Workflow folder по умолчанию: отказ виден, ничего не удалено.
  - evidence: gate pass · `gate fast` exit 0 (test/contract/projects-remove.test.ts, test/unit/remove-project.test.tsx) · mac - · 5f636c185
  - evidence: gate pass · `gate fast` exit 0 (round 1: commits-only Workflow folder refused before any stop) · mac - · d02b622cb
- [ ] «Remove from list» — прежнее поведение.
  - evidence: gate pass · `gate fast` exit 0 (test/contract/projects.test.ts projects.remove, test/unit/use-projects.test.tsx) · mac - · 5f636c185
  - evidence: gate pass · `gate fast` exit 0 (round 1: use-projects dialog Remove from list) · mac - · d02b622cb
- [ ] `docs/features/projects.md:259` (и перевод в `docs/features/ru/`) описывает обе строки меню.
  - evidence: commit pass · Remove project frees the Project's paths in the Harness (worfy-polish 79) · - - · 1949a9caf

## Тесты

- contract: `projects.remove` с полным удалением зовёт `project-connect --remove` (stub Harness-а, как у демо в
  `src/main/getting-started/demo.ts`), порядок «скрипт, потом список», отказ скрипта оставляет Project в списке.
- unit (jsdom): диалог подтверждения — что уйдёт и что останется, отказ скрипта.
- `harness/test/` — `project-connect --remove`, затем подключение того же пути: проходит (если такого test-а нет).

## Где в коде

- `src/renderer/shell/sidebar/ProjectsSection.tsx:273–274` — «Remove from list»; :420–425 — `remove`; :490 — `onRemove`.
- `src/main/ipc/projects.ts:392–397` — handler `projects.remove`; `src/shared/ipc/projects.ts:101` — канал.
- `src/main/projects/store.ts:308–316` — `ProjectStore.remove`.
- `harness/bin/project-connect:24–37`, :306, :333 — `--remove`; :577, :588, :593 — отказ занятому пути; :557, :598,
  :606, :608, :613 — `mode` и Workflow folder (для ticket-а переноса).
- `src/main/getting-started/demo.ts:247` — образец вызова `--remove`.
- `harness/bin/profile:19`, :195; `harness/hooks/gate-resolve.mjs:25`, :56 — поиск Profile-а по пути (только читаются).
- `docs/features/projects.md`, `docs/features/ru/projects.md`.

## Вне скоупа

- Перенос Full ↔ Silent — следующий ticket (см. выше).
- Правило «один путь — один Project» не меняется.
- Удаление ticket-ов, репозиториев или веток пользователя.

## Итог

- В меню Project-а этой Machine — вторая строка «Remove project…» (`src/renderer/shell/sidebar/ProjectsSection.tsx`).
  На строках Linked machine её нет: Harness чужой Machine отсюда не удаляется. «Remove from list» — как раньше, сразу,
  без вопроса.
- Диалог `src/renderer/projects/RemoveProject.tsx` перечисляет, что уходит из Harness-а этой Machine (Profile и его
  папка, записи registry Gate с путями, отметки агентов `runs/<profile>/`, коллекции qmd, пустая Workflow folder по
  умолчанию), и что остаётся (репозитории и все файлы в них; ticket-ы, spec, ADR и файл состояния в репозитории в Full
  mode; своя Workflow folder пользователя; настройки worfy). Кнопки: Cancel, «Remove from list» (выбор из брифа:
  только список), «Remove project».
- Main — `src/main/projects/remove.ts`: preview через `bin/profile -C <folder> --dir` и registry; отказ, если у папки
  нет Profile-а, или Profile покрывает пути вне папки Project-а (репозиторий, который отдельно в списке, но входит в
  Project над несколькими репозиториями: удаление унесло бы соседей). Ticket-ы в Workflow folder по умолчанию —
  отказ до того, как что-то закрыто, с «Show in Finder». Затем: Orchestrator закрыт и удержан, Session-ы внутри папки
  закрыты, `project-connect --remove <profile>`, потом `ProjectStore.remove`. Отказ скрипта оставляет Project в
  списке, текст скрипта виден в диалоге. Сам worfy ничего не удаляет.
- Каналы `projects.removal.preview`, `projects.removeProject`, `projects.removal.reveal` — `local`.
- Тесты: `test/contract/projects-remove.test.ts` (настоящие `bin/profile` и `bin/project-connect` во временном
  Harness home: что уходит, что остаётся, порядок «Session-ы, скрипт, список», отказы, повторное подключение),
  `test/contract/projects.test.ts` (IPC со stub-ами), `test/unit/remove-project.test.tsx` (диалог),
  `test/unit/use-projects.test.tsx` (строка меню), `harness/bin/tests/project-connect.test.sh` (`--remove`, затем те же
  пути подключаются снова — своим Project-ом и частью папки над двумя репозиториями; своя Workflow folder и её ticket
  остаются), e2e в `test/e2e/projects-connect.spec.ts` (подключить, удалить, подключить снова).
- `docs/features/projects.md` описывает обе строки меню. Перевод `docs/features/ru/` не правился (ADR-0088: в PR с
  поведением правится только английская страница).
- Перенос Full ↔ Silent не сделан — следующий ticket (раздел «Вне скоупа»).

Round 1 ревью (PR #1741), commit `d02b622cb`:

- Profile в старой папке Harness-а (`~/.claude/profiles/<name>`, её ещё находит `bin/profile`) — отказ в preview:
  `project-connect --remove` ищет только в `<Harness home>/projects`. «no profile» от скрипта считается успехом, только
  если в registry не осталось записей этого Profile-а. Путь `runs` берётся из Harness home.
- Workflow folder по умолчанию только с commit-ами (без файлов) — отказ до остановки Orchestrator-а и Session-ов, как
  отказал бы сам Harness; test проверяет, что ни stop, ни close не было.
- Диалог и `docs/features/projects.md` говорят вынести саму папку, а не файлы.
- Мелочи: оставшиеся коллекции qmd названы в notice; другой Project списка внутри той же папки (тот же Profile)
  удерживается закрытым и назван в диалоге и notice; понятная причина без «exit code 3»; сравнение Workflow folder по
  обоим написаниям и с `~/`; test «Remove from list» внутри диалога.
- Mutation testing в отдельной копии под /tmp (`pnpm install --frozen-lockfile`): 7 mutant-ов, все убиты.

Windows CI (PR #1741, run 42688371258, job `windows-e2e (3/4)`), commit `f0ca8d9ed`:

- Root cause: на Windows `project-connect --remove` откатывался с `EPERM: operation not permitted, rename
  '…\projects\fake-project' -> '…\.remove-…\profile'` (текст из скриншота artifact-а). Workflow folder Silent mode лежит
  в папке Profile-а, и worfy держит на нём два watch-а: ticket-ы (link-safe-watch на Windows) и документы (рекурсивный
  `fs.watch`). Windows не переименовывает папку, пока внутри открыт handle; macOS переименовывает, поэтому на Mac было
  зелёно. Сравнение путей (8.3, регистр диска, `\`) ни при чём: preview прошёл, отказал сам скрипт.
- Fix: `WorkflowHub.hold` и `DocsHub.hold` закрывают watch Project-а и сохраняют подписчиков; удаление держит оба
  watch-а Project-а (и Project-ов списка внутри его папки) после закрытия Session-ов и снова следит за папкой при любом
  ответе Harness-а.
- Contract test `projects-remove.test.ts` гоняет настоящие hub-ы над Silent Project-ом с Harness-ом, который отказывает,
  как Windows, пока watch держит папку внутри Profile-а; без fix-а он падает с тем же текстом EPERM. Mutation testing в
  копии под /tmp: 6 mutant-ов, все убиты. Сам Windows проверит только CI.

Round 2 ревью Windows fix-а, commit `ff510cc79`:

- Чтение epic-status, которое шло в момент hold, обновляло модель закрытого watcher-а и ничего не отправляло; release
  сравнивал с этой моделью и тоже молчал. Теперь первый hold запоминает модель, которую подписчики получили последней
  (до close), и release отправляет разницу от неё с тем же правилом для изменения только текста Ticket-а, что и
  `onChange` (подписчик только полей, Autopilot, его не получает).
- Ответ удаления не ждёт первого полного чтения watch-ей после release.
- Отказ rename с EPERM или EBUSY дополнен фразой о папке, которую держит Windows, и о том, что закрыть.
- Test-ы обоих hub-ов: доставка после release, чтение во время hold, вложенные hold, `open` во время hold, уход
  последнего подписчика. Mutation testing в копии под /tmp: 13 mutant-ов, все убиты.
