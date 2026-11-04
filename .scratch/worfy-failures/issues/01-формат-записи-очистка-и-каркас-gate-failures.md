# 01 — Формат записи, очистка и каркас `gate-failures`

Type: task
Status: claimed 2026-11-04T18:47Z
Blocked by: —
Source: [spec.md](../spec.md), «Модель» (файл run-а, запись о падении, файл повтора, компьютер, очистка текста, срок хранения), «Решено без владельца» (CLI с подкомандами, модуль рядом с `gate-log.mjs`, `.d.mts`, очистка поверх `privacy.cjs`), «Импортированные записи», «Риски», п. 4 и 7; [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md), [ADR-0074](../../../docs/adr/0074-harness-neutral-by-language-and-project.md)

## Что происходит

- Gate хранит в своей папке состояния (`gateStateDir`, `harness/hooks/gate-paths.mjs:35-37`) маркеры, verdict-файлы,
  cache и логи run-ов (`harness/hooks/gate-log.mjs:1-7`). Записи о падениях test-ов нет нигде.
- Общие модули gate лежат рядом с ним (`gate-log.mjs`, `gate-paths.mjs`); bin Harness импортируют их как `../hooks/…`
  (например, `harness/bin/profile`). Общие модули bin — в `harness/lib/` (`harness/lib/README.md:1-4`).
- Команды `gate-failures` нет.
- **Ждёт merge Ticket-а `worfy-evidence` 02** — до него этот Ticket не берётся. В `Blocked by` чужой Epic не
  пишется: там читаются только номера этого Epic-а (`harness/bin/epic-status:306-314`), а `Waits:` — для «кто»
  (owner, team, agent, машина; `harness/bin/TICKETS.md:39-41`), и `claim` его снимает.
- `harness/lib/privacy.cjs` даёт Ticket `worfy-evidence` 02: шаблоны утечек, `findLeaks`, разрешённые заглушки и
  маскирование. Своих шаблонов здесь не пишем.
- Импорт `.mjs` из TypeScript test-ов требует объявлений рядом: пример — `test/fixtures/codex-app-server/hook-runner.d.mts`.

## Что делаем

1. `harness/hooks/gate-failures.mjs` — Node only, из зависимостей только `../lib/privacy.cjs`; объявления —
   `harness/hooks/gate-failures.d.mts`:
   - разбор и проверка файла run-а и файла повтора версии 1 (поля — spec, «Модель»); битый файл, другая версия —
     не читается, с одной строкой причины; поле `dirty` (boolean) обязательно в файле run-а;
   - `testId(runner, file, name)` — `<runner> <file> > <name>`;
   - `scrub(text, { repo, home, user, host })` — замены spec-а, «Очистка текста»: путь корня, домашняя папка, имя
     пользователя, hostname — здесь, остальное — маскированием `privacy.cjs`; `scrubRecord(record, ctx)` — `scrub`
     по `error`, `name`, `file`; `findLeaks` — реэкспорт из `privacy.cjs` (для export, Ticket 06);
     `firstLine(text, 200)` без управляющих символов ANSI;
   - `readComputer(harnessHome)` / `ensureComputer(...)` — `<Harness home>/gate/machine.json`, `id` из
     `crypto.randomBytes(4)`, `name` по платформе; запись — временный файл и rename;
   - `writeRunFile(state, record)`, `listRuns(state, { days })`, `pruneFailures(state, now, 60 дней)` — по `at` внутри
     файла, не по mtime;
   - импортированные файлы: `importedDir(state, computerId)` = `<state>/failures/imported/<computer.id>/`,
     `writeImported(state, record)`; `listRuns` читает свои и импортированные (поле `imported: true` в ответе),
     `pruneFailures` чистит обе папки.
2. `harness/bin/gate-failures` — точка входа: `gate-failures <sub> [args]`; `<sub>` — `^[a-z][a-z-]*$`, модуль
   `../lib/gate-failures/<sub>.mjs` с экспортом `run(argv, io)`; неизвестная подкоманда — usage и exit 2; `--help`
   перечисляет найденные модули.
3. Подкоманды этого Ticket-а: `list` (run-ы с падениями: id, время, компьютер, SHA, число записей; `--json`) и
   `machine` (показать; `--name <имя>` — сменить).
4. `harness/lib/README.md` — строка о `gate-failures/`.

## Готово, когда

- [ ] Unit test: файл run-а с двумя записями test-ов и одной записью шага читается; без `version`, с `version: 2`,
      с `at` не датой — не читается, причина названа.
- [ ] Unit test: файл run-а без `dirty` не читается.
- [ ] Unit test очистки: `/Users/jdoe/x`, `C:\Users\jdoe\x`, `C:/Users/jdoe/x`, `/c/Users/jdoe/x`,
      `C:\Users\RUNNER~1\x`, hostname, UUID, email, `ghp_…`, `Bearer …` — заменены; после `scrub` `findLeaks` пуст; `scrubRecord` чистит
      `error`, `name` и `file`.
- [ ] Unit test: `testId` не содержит строки файла; два файла с одинаковым id в разных run-ах — один test.
- [ ] Contract test: `machine.json` создаётся один раз, второй запуск даёт тот же `id`; в файле нет hostname и имени
      пользователя.
- [ ] Contract test: `gate-failures list --json` над временной папкой состояния (`CLAUDE_GATE_STATE`) с тремя
      файлами и одним в `imported/<id>/`; импортированный помечен `imported: true`; файл старше 60 дней удаляет
      `pruneFailures` в обеих папках, моложе — остаётся.
- [ ] Contract test: неизвестная подкоманда — exit 2 и usage; `--help` называет `list` и `machine`.
- [ ] Ни один test не пишет в настоящую `~/.claude` (`HARNESS_HOME` во временной папке).
- [ ] `pnpm typecheck` принимает импорт `gate-failures.mjs` из test-ов (объявления `.d.mts`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/gate-failures-format.test.ts` (новый): импорт `harness/hooks/gate-failures.mjs`.
- Contract `test/contract/gate-failures-cli.test.ts` (новый): `node harness/bin/gate-failures …` с временными
  `CLAUDE_GATE_STATE` и `HARNESS_HOME`.
- Сначала падающий: `scrub('C:/Users/jdoe/repo/x.ts', …)` возвращает путь без `jdoe`.

## Где в коде

- `harness/hooks/gate-failures.mjs` (новый)
- `harness/hooks/gate-failures.d.mts` (новый)
- `harness/bin/gate-failures` (новый)
- `harness/lib/gate-failures/list.mjs` (новый)
- `harness/lib/gate-failures/machine.mjs` (новый)
- `harness/lib/README.md`
- `test/unit/gate-failures-format.test.ts` (новый)
- `test/contract/gate-failures-cli.test.ts` (новый)

Только читать: `harness/hooks/gate-paths.mjs` (`harnessHome`, `gateStateDir`), `harness/hooks/gate-log.mjs`
(`runLogDir`, `pruneLogs`, `writeScriptLog`), `harness/hooks/gate.mjs:44-61` (поля verdict-файла), `test/flaky.ts:24-31`
(имя test-а через « > »), `test/quarantine.ts:88-102`, `harness/lib/privacy.cjs` (`worfy-evidence` 02),
`test/fixtures/codex-app-server/hook-runner.d.mts` (форма объявлений).

## Итог

Сделано в ветке `worfy-failures/01`.

- `harness/hooks/gate-failures.mjs` (+ `gate-failures.d.mts`): проверка и разбор файла run-а и файла повтора версии 1
  (`parseRunFile`, `parseRerunFile`, `parseRecordFile`, причина — одна строка), `testId`, `firstLine`, `scrub`, `scrubRecord`,
  `findLeaks`, `byTest`, `readComputer` / `ensureComputer` / `setComputerName`, `writeRunFile`, `writeImported`, `importedDir`,
  `listRuns`, `pruneFailures`. Из зависимостей — только `../lib/privacy.cjs` и модули Node.
- `harness/bin/gate-failures` находит подкоманду в `harness/lib/gate-failures/<sub>.mjs`; подкоманды `list` (`--json`, `--days N`)
  и `machine` (`--json`, `--name <имя>`). Неизвестная подкоманда и вызов без подкоманды — usage и exit 2.
- Test-ы: `test/unit/gate-failures-format.test.ts` (31) и `test/contract/gate-failures-cli.test.ts` (6), каждый вызов CLI — с
  `HARNESS_HOME` и `CLAUDE_GATE_STATE` во временной папке.
- Первый падающий test был красным только потому, что модуля ещё не было (ошибка импорта), а не на проверке `scrub` по отдельности.
- Страницы `docs/features` не правились: список bin Harness ни одна страница не ведёт, раздел «Failure records» — Ticket 08.

Решено без владельца, подтвердить:

1. `findLeaks` — тонкая обёртка над `findings` из `privacy.cjs`: функции с именем `findLeaks` там нет, экспорт — `{ findings, mask,
   maskText, personal }`.
2. В файле повтора есть поле `at` (spec его не называл): срок хранения считается по `at` внутри файла, и `<stamp>` в имени файла
   повтора — это `at` с `-` вместо `:`.
3. `pruneFailures` не удаляет битый файл и файл другой версии: его возраст не прочитать, а более новый Harness может его читать.
   `list` называет такие файлы на stderr (в `--json` — массив `skipped`).
4. `scrub` заменяет на `<user>` имя в любом пути домашней папки, не только в своём (`/home/<имя>`, `C:\Users\<имя>`, в том числе
   `RUNNER~1` и заглушки вроде `runner`); имя пользователя как отдельное слово — только если `privacy.cjs` считает его личным
   (не `test`, `runner`, `user`) и в нём не меньше 3 знаков. Hostname — целиком и первой меткой, без учёта регистра.
5. `scrubRecord` заново собирает `test` из очищенных `file` и `name`: иначе id сохранил бы то, что из них убрано.
6. `machine --name` отказывает (exit 2) в имени, равном hostname или имени пользователя, и в имени, где `privacy.cjs` что-то находит;
   имя — от 1 до 40 латинских букв, цифр, пробелов, точек, дефисов и подчёркиваний.
7. `machine.json` создаётся через временный файл и hard link, только если файла ещё нет: два gate-а в один момент кончают с одним
   `id`. Битый `machine.json` заменяется новым (с новым `id`).
8. `--help` перечисляет только модули с экспортом `run`, с их строкой `summary`: общий модуль (`transfer-common.mjs` Ticket-а 06)
   подкомандой не считается.
9. `list` только читает, ничего не удаляет; `--json` печатает объект `{ runs, skipped }`, у run-а — `records`, `tests`, `steps`,
   `reruns` (число файлов повтора этого run-а), `imported`, `dirty`, `file`. Порядок — от нового к старому.
10. `listRuns` возвращает и файлы повтора (`reruns`) — для отчёта Ticket-а 05.
11. Проверка записи строже таблицы spec-а: id run-а — `<tag>/<run>` без `--`; `error` — одна строка не длиннее 200 знаков;
    `outcome` — один из четырёх исходов verdict-файла; если `runner`, `file` и `name` заданы, `test` обязан быть равен
    `testId(runner, file, name)`.
