# 83 — Другие e2e на Windows: stand-in-ы `#!/bin/sh`, как было в `projects-connect.spec.ts`

Type: task
Status: claimed 2026-10-21T08:58Z
Blocked by: —
Source: ревью PR #671, Session на Mac, 2026-10-21.

## Что происходит

Тикет 82 (`projects-connect.spec.ts` и `select.spec.ts` на Windows) нашёл причину: stand-in Claude
Code был скриптом `#!/bin/sh`. Windows такой скрипт как программу не запускает, проверка Harness
падала, и диалог останавливался на стадии `harness`. Тикет 82 заменил stand-in общим `.mjs`
(`test/e2e/claude-plugin-stub.ts`, `claudePluginStub`); `.mjs` worfy запускает своим Node на любой
системе (`src/main/program.ts`, `programStart`).

Другие e2e spec-и всё ещё пишут свои stand-in-ы `#!/bin/sh` и на Windows упадут так же:

- `test/e2e/harness-migrate.spec.ts:~24` (`STUB`) — почти копия stand-in-а, который убрал тикет 82:
  пишет каждую команду в `STUB_CLAUDE_LOG` и отвечает на `plugin list --json`. Его даёт `WORFY_CLAUDE`.
- `test/e2e/harness-install.spec.ts:~70` — обёртка `#!/bin/sh` (`exec node claude-stub.mjs "$@"`)
  вокруг `.mjs`, который ведёт состояние установки (marketplace, plugin-ы), журнал команд и журнал
  окружения. Обёртка больше не нужна: `.mjs` worfy запускает сам.
- `test/e2e/epics-reading.spec.ts:~65` — другой случай: stand-in `#!/bin/sh` там один — медленная
  login shell (`SHELL`). `epic-status` Harness-а в `<claude home>/bin` (`:89`, `catScript`) — Node-скрипт
  без расширения и без `#!`, его переводить не нужно. Stand-in Claude Code тут ни при чём. На Windows
  worfy читает окружение не из login shell (`src/main/agent/env.ts`), так что сценарий «медленная
  login shell» там, возможно, не воспроизводится вовсе — не проверено.

## Что делаем

1. Дать `claudePluginStub` (`test/e2e/claude-plugin-stub.ts`) опцию журнала: путь файла, куда
   stand-in дописывает строку каждой команды (как `STUB_CLAUDE_LOG` сейчас). Без опции — как сейчас.
2. `harness-migrate.spec.ts` — перевести на `claudePluginStub` с журналом; свой `STUB` убрать.
3. `harness-install.spec.ts` — давать в `WORFY_CLAUDE` сам `claude-stub.mjs`, без обёртки `sh`. Его
   состояние установки `claudePluginStub` не повторяет; переносить на него только если это не
   усложнит общий stand-in.
4. `epics-reading.spec.ts` — выяснить, что этот spec проверяет на Windows: если login shell там не
   читается, test пропускать на `win32` с причиной в комментарии.

## Готово, когда

- [x] ~~У `claudePluginStub` есть опция журнала~~ — не понадобилась (см. Итог);
      `projects-connect.spec.ts` и `select.spec.ts` зелёные.
- [x] В `harness-migrate.spec.ts` и `harness-install.spec.ts` нет stand-in-ов `#!/bin/sh`.
- [x] `harness-migrate.spec.ts` и `harness-install.spec.ts` на Windows — зелёные, под watcher-ом
      `gh.exe` 0 запусков gh.
- [ ] Они же на macOS — зелёные. Не проверено на ПК: Mac checks в PR.
- [x] Для `epics-reading.spec.ts` названо, что он проверяет на Windows, и сделан либо перевод, либо
      пропуск на `win32` с причиной.
- [x] `pnpm typecheck`, `pnpm lint` — exit 0.

## Вне скоупа

- `test/e2e/silent-project.spec.ts:~147` (свой `gh` с обёрткой `sh` и скрипты Harness `#!/bin/sh`) —
  уже в тикете 14 (gate full на Windows).
- Код worfy: запуск `.mjs` stand-in-ов (`src/main/program.ts`) уже есть, его не меняем.

## Итог

Stand-in-ов `#!/bin/sh` в `harness-migrate.spec.ts` и `harness-install.spec.ts` больше нет.

- `harness-migrate.spec.ts` берёт общий `claudePluginStub`. Опцию журнала ему не добавили: spec только
  писал журнал команд (`STUB_CLAUDE_LOG`) и ни разу его не читал, так что журнал ничего не проверял.
- `harness-install.spec.ts` даёт в `WORFY_CLAUDE` сам `claude-stub.mjs`, без обёртки `sh`. Его
  состояние установки остаётся в этом spec-е: в общий stand-in его не переносили.
- `epics-reading.spec.ts` на `win32` пропускается с причиной. Он проверяет строку «Reading epics…»,
  пока медленная login shell (`$SHELL -ilc`) отдаёт окружение. На Windows worfy login shell не
  запускает: окружение читается из реестра (`src/main/agent/env.ts`), медленного шага нет.

Что ещё понадобилось, чтобы `harness-migrate.spec.ts` прошёл на Windows:
- fixture `claude-home-legacy` подставляет корень песочницы вместо `__SANDBOX__`. В `.json` путь
  Windows с `\` ломал разбор `settings.json`: теперь в `.json` корень экранируется для JSON (так же в
  `select.spec.ts`);
- id строки миграции собирается разделителем системы (`file:agents\scout.md`), селектор — через `join`;
- секция «done» появляется дольше 5 s: ожидание 30 s;
- первый запуск с переносом на Windows берёт песочницу реестра `writeSandbox` (тикет 81) вместо
  `.profile`;
- команда отката на Windows в кавычках (`node "C:\…\restore.mjs"`).

Баг продукта, найденный этим spec-ом: диалог согласия на перенос (`src/main/ipc/harness-migration.ts`,
`migrationConfirmationText`) писал команду отката без кавычек, а форма после переноса — в кавычках
(`restoreCommand`). Путь Windows с пробелом из диалога не запускался. Теперь диалог берёт тот же
`restoreCommand`. Это правка кода worfy вне скоупа выше: её нашёл test, она в одну строку. Contract
test в `test/contract/harness-migrate.test.ts` проверяет кавычки строки диалога для пути с пробелом на
любой системе; e2e сравнивает форму и диалог с `restoreCommand`.

Три low из ревью #675 (по указанию Mac — в первый тикет, который тронет эти файлы):
- `test/contract/github-accounts.test.ts`: ожидание подсказки `10_000 * timeScale`;
- ошибка `programStartInPty` без имени переменной («the .mjs stand-in … needs it on Windows»),
  `WORFY_GH:` добавляет `signInCommand`;
- регулярное выражение полного пути Windows одно: `WINDOWS_FULL_PATH` в `src/main/agent/env.ts`,
  `program.ts` его импортирует.

На ПК 2026-10-21: под watcher-ом `gh.exe` spec-и `harness-migrate`, `harness-install`, `epics-reading`,
`projects-connect`, `select` — 15 passed, 1 skipped (`epics-reading` на `win32`), gh.exe 0, настоящих
claude/qmd от приложения 0, EXIT=0. Unit/contract (`program`, `github-accounts`, `agent-env`,
`e2e-gh-stub`, `no-rmsync`, `harness-migrate`, `harness-migrate-restore-command`,
`harness-migration-form`) — 212 passed, 4 skipped (login shell, не Windows), EXIT=0. `pnpm typecheck`,
`pnpm lint` — 0.

## Где в коде

- `test/e2e/claude-plugin-stub.ts` — общий stand-in Claude Code (`claudePluginStub`).
- `test/e2e/harness-migrate.spec.ts`, `test/e2e/harness-install.spec.ts`, `test/e2e/select.spec.ts`,
  `test/e2e/epics-reading.spec.ts` — spec-и.
- `src/main/ipc/harness-migration.ts` — `migrationConfirmationText`, команда отката в диалоге.
- `src/main/harness/migrate/restore.ts` — `restoreCommand`, кавычки по системе.
- `src/main/program.ts` — `programStartInPty`; `src/main/github/accounts.ts` — `signInCommand`;
  `src/main/agent/env.ts` — `WINDOWS_FULL_PATH`, `findOnPath`.
