# 83 — Другие e2e на Windows: stand-in-ы `#!/bin/sh`, как было в `projects-connect.spec.ts`

Type: task
Status: open
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

- [ ] У `claudePluginStub` есть опция журнала; `projects-connect.spec.ts` и `select.spec.ts` без
      изменений и зелёные.
- [ ] В `harness-migrate.spec.ts` и `harness-install.spec.ts` нет stand-in-ов `#!/bin/sh`.
- [ ] `harness-migrate.spec.ts` и `harness-install.spec.ts` на Windows — зелёные, под watcher-ом
      `gh.exe` 0 запусков gh; на macOS — зелёные.
- [ ] Для `epics-reading.spec.ts` названо, что он проверяет на Windows, и сделан либо перевод, либо
      пропуск на `win32` с причиной.
- [ ] `pnpm typecheck`, `pnpm lint` — exit 0.

## Вне скоупа

- `test/e2e/silent-project.spec.ts:~147` (свой `gh` с обёрткой `sh` и скрипты Harness `#!/bin/sh`) —
  уже в тикете 14 (gate full на Windows).
- Код worfy: запуск `.mjs` stand-in-ов (`src/main/program.ts`) уже есть, его не меняем.
