# 23 — Настройки Session Node-а сохраняются; Default — модель и effort пользователя

Type: task
Status: open
Blocked by: 06, 07, 08, 09, 10
Source: [spec.md](../spec.md), тема C; ручная проверка 2026-10-06, ночь — Ticket 19 worfy-mvp (`.scratch/worfy-mvp/issues/19-поле-ввода-модель-и-очередь.md:169`); Ticket 07 этого Epic-а, «Что известно»; HANDOFF, «Риски и долги»

## Что делаем

Три дефекта выбора модели, effort и режима разрешений у Session.

**1. Выбор у Node-а «New session» не сохраняется.** `session-settings.json` в папке данных
Project-а не появился ни после одной из шести смен. Хранилище есть
(`src/main/agent/session-settings.ts`, ключ — id Node-а), но пишет в него только Orchestrator
(`src/main/agent/orchestrator.ts:305` и `:382`). В `src/main/agent/node-sessions.ts` хранилища нет.
Session Node-а стартует без сохранённого выбора: `registry.start` получает только cwd, resume и
обработчик событий (`node-sessions.ts:229`), а Orchestrator передаёт и настройки
(`orchestrator.ts:260`). Поэтому после Resume или перезапуска worfy Session Node-а идёт на
настройках по умолчанию.

Правка:

- `NodeSessions` получает то же хранилище, что Orchestrator (зависимость `settings`,
  `orchestrator.ts:82-86`). Подключается оно в `src/main/agent/app-node-sessions.ts`.
- Событие `settings` Session Node-а сохраняет выбор под id Node-а.
- Старт и Resume передают сохранённый выбор в `registry.start`.

**2. «Default (recommended)» не возвращает Session к модели, на которой она стартовала.** Session
шла на `claude-opus-5-5[1m]` (`model` из `~/.claude/settings.json`). После Sonnet строка default
перевела её на `claude-opus-5-5`. worfy превращает строку default в `null`
(`src/main/agent/session.ts:121`, `src/renderer/session/composer/Pickers.tsx:76`) и зовёт
`query.setModel(undefined)` (`session.ts:191`). Claude Code тогда ставит свою встроенную модель, а
не модель пользователя.

Правка: на живой Session `model: null` значит модель пользователя. Ticket 07 заводит
`src/main/claude-home/user-model.ts` — чтение поля `model` из `<claudeHome>/settings.json`. При
переходе на `null` `pushSettings` (`session.ts:189`) передаёт в `setModel` эту модель. Нет модели
пользователя — `setModel(undefined)`, как сейчас. Правило «минимум sonnet» Ticket-а 07 действует и
здесь.

**3. Effort по умолчанию — не уровень пользователя.** Без выбора Claude Code ставит `medium`
(`CLAUDE_EFFORT=medium` в Bash Session), хотя в `~/.claude/settings.json` `effortLevel: high`.
«effort default» после low тоже вернул `medium`. worfy не передаёт effort, когда он `null`
(`src/main/agent/options.ts:90`).

Первый шаг — выяснить, почему Session через SDK не берёт `effortLevel` из `settings.json`
пользователя. Ответ — в «Итог». Правка по образцу модели: `user-model.ts` читает и `effortLevel`, а
`effort: null` при старте и при «effort default» передаёт SDK этот уровень (`applyFlagSettings`,
`session.ts:199`). Подстановка — в `session.ts`, как у Ticket-а 07; `options.ts` не меняется.
Шапка Session view не меняется: «—» в ней значит «без выбора».

`settings.json` пользователя worfy не меняет
([ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md)).

## Готово, когда

- [ ] Выбор модели, effort и режима у Node-а «New session» пишется в `session-settings.json` под id Node-а: contract-test читает файл во временном `WORFY_DATA_DIR` после смены.
- [ ] После Resume того же Node-а и после перезапуска worfy Session стартует с сохранённым выбором: contract-test читает настройки запроса к fake-query.
- [ ] «Default» на живой Session после другой модели зовёт `setModel` с моделью из `settings.json` временного `WORFY_CLAUDE_HOME`; без поля `model` — `setModel(undefined)`. Contract-test читает вызовы fake-query.
- [ ] При `effortLevel: high` в `settings.json` временного `WORFY_CLAUDE_HOME` Session без выбора effort и после «effort default» передаёт SDK `high`: contract-test. Причина нынешнего `medium` — в «Итог».
- [ ] `settings.json` пользователя не меняется: test сравнивает дерево временного `WORFY_CLAUDE_HOME` до и после.
- [ ] (вручную) Собранное приложение, настоящий Claude Code: Node «New session» → Sonnet → перезапуск worfy → Resume, Session на Sonnet. Затем «Default» → модель из `settings.json`, с `[1m]`. Без выбора effort `echo $CLAUDE_EFFORT` в Bash Session даёт `effortLevel` из `settings.json`. Проверка — транскрипт и вывод команды. Итог — в «Итог».

## Тесты

- `test/contract/node-sessions.test.ts` — сохранение выбора Node-а и старт с ним после Resume.
- `test/contract/agent-controls.test.ts` — «Default» и «effort default» на живой Session с `settings.json` временного `WORFY_CLAUDE_HOME`.
- Сначала падающий test: после смены модели у Node-а «New session» файла `session-settings.json` нет.

## Где в коде

- `src/main/agent/node-sessions.ts`
- `src/main/agent/app-node-sessions.ts`
- `src/main/agent/session.ts`
- `src/main/claude-home/user-model.ts`
- `test/contract/node-sessions.test.ts`
- `test/contract/agent-controls.test.ts`
