# 23 — Настройки Session Node-а сохраняются; Default — модель и effort пользователя

Type: task
Status: done — 2026-10-06, [PR #61](https://github.com/IDSAD-XL/worfy/pull/61)
Blocked by: 06, 07, 08, 09, 10, 30
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

- [x] Выбор модели, effort и режима у Node-а «New session» пишется в `session-settings.json` под id Node-а: contract-test читает файл во временном `WORFY_DATA_DIR` после смены.
- [x] После Resume того же Node-а и после перезапуска worfy Session стартует с сохранённым выбором: contract-test читает настройки запроса к fake-query.
- [x] «Default» на живой Session после другой модели зовёт `setModel` с моделью из `settings.json` временного `WORFY_CLAUDE_HOME`; без поля `model` — `setModel(undefined)`. Contract-test читает вызовы fake-query.
- [x] При `effortLevel: high` в `settings.json` временного `WORFY_CLAUDE_HOME` Session без выбора effort и после «effort default» передаёт SDK `high`: contract-test. Причина нынешнего `medium` — в «Итог».
- [x] `settings.json` пользователя не меняется: test сравнивает дерево временного `WORFY_CLAUDE_HOME` до и после.
- [x] (вручную) Собранное приложение, настоящий Claude Code: Node «New session» → Sonnet → перезапуск worfy → Resume, Session на Sonnet. Затем «Default» → модель из `settings.json`, с `[1m]`. Без выбора effort `echo $CLAUDE_EFFORT` в Bash Session даёт `effortLevel` из `settings.json`. Проверка — транскрипт и вывод команды. Итог — в «Итог».
  Проверено 2026-10-07 — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).

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
- `test/contract/orchestrator.test.ts` — расширение следа (разрешено Orchestrator-ом): test-ы ставят `WORFY_CLAUDE_HOME` на временный каталог, иначе локально читают настоящий `~/.claude/settings.json` и получают его `effortLevel`.

## Итог

**Почему Session через SDK шла на `medium`, хотя в `settings.json` `effortLevel: high`.** SDK тут ни
при чём: он передаёт `--effort`, только когда `options.effort` задан (`sdk.mjs`,
`if(this.options.effort)B.push("--effort",…)`), а `settingSources` у worfy включает `user`. Дело в
самом Claude Code из `@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.289`. Он читает верхнее поле
`effortLevel` пользовательского `settings.json` как «legacy user effort» (`legacyUserEffort`) и
применяет его только к моделям из своего списка старых: `claude-3-5-*`, `claude-sonnet-4-*`,
`claude-sonnet-5`, `claude-opus-4-*`, `claude-opus-5`, `claude-fable-5*`, `claude-mythos-5*`.
`claude-opus-5-5` в списке нет, поэтому на ней действует effort модели по умолчанию — `medium`.
Без устаревания поле действует только из `modelSettings.<модель>.effortLevel` или из настроек
проекта. Вывод сделан по строкам бинарника (`strings`), а не запуском настоящего Claude Code;
запуск — в ручном пункте.

**Что сделано.**

- `NodeSessions` получил хранилище выбора (`settings`, то же `SessionSettingsStore`, что у
  Orchestrator-а; подключено в `app-node-sessions.ts`). Событие `settings` Session Node-а
  сохраняет выбор под id Node-а, если он отличается от сохранённого. Каждый старт Node-а — New
  session, Start, Resume, после перезапуска worfy — передаёт сохранённый выбор в
  `registry.start`. Выбор, который не читается, даёт старт с настройками по умолчанию.
- `user-model.ts` читает и `effortLevel` (`readUserEffort`; неизвестный worfy уровень — `null`).
- `session.ts`: `model: null` на живой Session — `setModel` с моделью пользователя (haiku —
  `sonnet`, правило Ticket-а 07); нет модели — `setModel(undefined)`, как раньше. `effort: null` —
  при старте и при «effort default» передаётся `effortLevel` пользователя; нет его — как раньше.
  Старт без выбора модели по-прежнему не называет модель: Claude Code берёт её из `settings.json`
  сам. Настройки Session остаются `null`, шапка показывает «—»; `options.ts` не менялся.
- `settings.json` пользователя worfy не меняет: test сравнивает дерево временного
  `WORFY_CLAUDE_HOME` до и после.

**Решено без владельца, подтвердить.** Берётся только верхнее поле `effortLevel`.
`modelSettings.<модель>.effortLevel` worfy не читает. Если у пользователя есть оба поля, worfy
передаёт верхнее, а Claude Code сам выбрал бы поле модели.

**Ручная проверка** (собранное приложение, настоящий Claude Code) проведена 2026-10-07 — подраздел
[«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверки M10 и M17 второго круга ручных проверок), настоящий Claude
Code. Перезапуском worfy служила пересборка Stable copy: Sonnet выбран на копии из 5060858 (pid 74430),
Resume — на копии из 6df9791 (pid 2455); CDP 9351 у обеих.

- **Выбор Sonnet (5060858).** Session view Node-а «New session» (Node 3273673d, Session 03d83bd0)
  открыт двойным щелчком по заголовку Node-а; в шапке `claude-opus-5-5[1m]`, picker «Default». Picker →
  нативное меню → «Sonnet 5.5» (05:40:32Z). В тот же момент появился `session-settings.json` Project-а:
  `nodes["3273673d-…"] = {model: "sonnet", effort: null, permissionMode: "bypassPermissions"}`; до этого
  файла не было. Claude Code (pid 56399) не перезапускался, в транскрипте — «Set model to `sonnet
  (claude-sonnet-5-5)`». Ход «…sonnet-check…» — ответ «sonnet-check», `assistant.message.model` —
  `claude-sonnet-5-5`.
- **Перезапуск.** Stable copy пересобрана из 6df9791 и запущена заново (проверка M16, «Итог» Ticket-а 03).
- **Resume на Sonnet (6df9791).** ⌘K «Одно слово» → Go to → щелчок по Resume на Node-е (06:34:58Z).
  Claude Code (pid 7917) запущен с `--model sonnet --effort high --resume=03d83bd0`, picker
  «Sonnet 5.5». На ход «after-restart» шапка и `assistant.message.model` — `claude-sonnet-5-5`.
- **«Default (recommended)».** В `session-settings.json` `model` стал null, в транскрипте `/model
  opus[1m]` и «Set model to `opus[1m] (claude-opus-5-5[1m])`». На ход «default» шапка —
  `claude-opus-5-5[1m]`, модель хода — `claude-opus-5-5`.
- **Effort без выбора.** `echo $CLAUDE_EFFORT` в Bash Session дал `high` — `effortLevel` из
  `~/.claude/settings.json`. В шапке Effort «—», то есть «без выбора», как задумано.
- Замечание [low]: после выбора модели в picker шапка Session view до следующего хода показывает
  прежнюю модель — и при Sonnet, и при «Default». Шапка берёт модель из событий `init`:
  `src/renderer/session/SessionView.tsx:128` (`facts.model ?? view?.model ?? null`). После хода шапка
  верна.
- Вердикт: проверено. Session закрыта кнопкой Close, процесс Claude Code завершён.
- Улики (в scratchpad Session Orchestrator-а, в репозиторий не положены): `M10-picker-menu.png`,
  `M10-after-turn.png`, `M10-settings.json`, `M10-model.txt`, `M17-resume.png`, `M17-resume-view.png`,
  `M17-picker-menu.png`, `M17-default.png`, `M17-effort.png`, `M17-models.txt`, `M17-effort.txt`.
