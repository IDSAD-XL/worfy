# 06 — MCP-серверы Session по списку из Profile

Type: task
Status: done 2026-10-06
PR: #43
Blocked by: 05, 29
Source: [spec.md](../spec.md), тема B, риски 8 и 13; [ADR-0021](../../../docs/adr/0021-mcp-servers-allowlist-in-profile.md); [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md); [ADR-0020](../../../docs/adr/0020-profile-shared-and-personal-parts.md)

## Что делаем

ADR-0021: Session-ы, которые запускает worfy, получают только MCP-серверы из списка в Profile. По
умолчанию в списке `qmd` и `worfy-canvas`.

**Что сейчас.** `settingSources: ['user', 'project', 'local']` зашит жёстко
(`src/main/agent/options.ts:72`). Свой сервер `worfy-canvas` добавляется к серверам пользователя,
когда Session запущена в Project (`options.ts:90-92`). В итоге каждая Session получает 634 tools. На
haiku от этого падает «Prompt too long». Profile worfy не читает: `git grep` по `bin/profile`,
`profile.json` и `.claude/profiles` даёт 0 совпадений.

**Где сейчас лежит Profile.** Вне репозитория: `~/.claude/profiles/<имя>/profile.json`. Читает его
скрипт `~/.claude/bin/profile -C <root> --field a.b`. Коды выхода: 0 — поле есть, 3 — Project не
зарегистрирован, 4 — поля нет. Profile из двух частей и plugin Harness появятся только в E3
(ADR-0019, ADR-0020).

**Первый шаг — проверка, итог в «Итог» до кода.** Надо найти, как в SDK оставить `settingSources`
пользователя и при этом не отдать Session серверы вне списка. От пользователя должны по-прежнему
приходить `CLAUDE.md`, hooks и skills (ADR-0002). Проверка — на живой Session и на fixture-е
`system/init`: список tools и `mcp_servers`. Записать версии Claude Code и SDK. Заменить
`mcpServers` целиком нельзя: пропадёт нужный `qmd`.

**`src/main/workflow/profile.ts`** — runner по образцу runner-а `epic-status`
(`src/main/workflow/reader.ts:62-77`):

- `execFile` с `cwd` = корень Project; путь — `<claudeHome>/bin/profile` (`claudeHome` уже есть в
  `WatchOptions`);
- подставной `run` для test-ов (параметр `run` есть в `src/main/workflow/watch.ts:32`);
- коды 3 и 4, отсутствие скрипта и сломанный JSON — мягкий отказ: список по умолчанию, причина в
  лог.

**Поле списка в Profile.** Имя предлагает Ticket, например `mcp.allowed`, и записывает его в
«Итог». Поле в свой Profile и в `~/.claude/profiles/README.md` владелец вносит вручную: worfy в
`~/.claude` не пишет.

**`options.ts`.** Набор серверов Session = список Profile ∩ (серверы пользователя ∪
`worfy-canvas`). Список передаётся при создании Session (`src/main/agent/app-registry.ts`). Session
вне Project работает как раньше. Subagent-ы Session и Subagent-ы workflow-скриптов получают тот же
набор — наследование проверяется вживую.

**Замер.** Число tools в `system/init` до и после на Project worfy — в «Итог».

## Готово, когда

- [x] В «Итог» записан способ ограничить серверы в SDK при `settingSources` пользователя, с версиями Claude Code и SDK.
- [x] `profile.ts` покрыт test-ами на каждый случай: код 0 со списком, код 3, код 4, нет скрипта, сломанный JSON. Во всех отказных случаях — список по умолчанию `qmd` и `worfy-canvas`.
- [x] Session в Project получает только серверы из списка, `worfy-canvas` — если он в списке. Session вне Project работает как раньше.
- [x] (вручную) Живая Session на Project worfy: в `system/init` только серверы из списка. Число tools до и после — в «Итог». Проверено 2026-10-07: 12 MCP tools вместо 634 tools всего — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).
- [x] (вручную) Subagent этой Session и Subagent workflow-скрипта видят тот же набор серверов — по tools в их транскриптах. Итог — в «Итог». Проверено 2026-10-07 — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).
- [x] worfy не пишет в `~/.claude` и в репозиторий Project: test сравнивает деревья временных папок до и после.

## Тесты

- `test/contract/workflow-profile.test.ts` (новый) — подставной `run`: коды 0, 3, 4, нет скрипта, сломанный JSON. Образец — `test/contract/workflow-reader.test.ts`.
- `test/unit/agent-options.test.ts` — набор серверов: со списком, по умолчанию, Session вне Project.
- Сначала падающий test: Session в Project со списком `[qmd]` получает и серверы пользователя вне списка.

## Где в коде

- `src/main/workflow/profile.ts` (новый)
- `src/main/agent/options.ts`
- `src/main/agent/app-registry.ts`
- `test/contract/workflow-profile.test.ts` (новый)
- `test/unit/agent-options.test.ts` (из 02: файл создаёт Ticket 02)

## Итог

Сделано в ветке `worfy-daily/06`.

- **Способ (проверка до кода).** Claude Code 2.1.289, `@anthropic-ai/claude-agent-sdk` 0.3.289.
  Список уходит в Claude Code как policy-уровень настроек — опция SDK `managedSettings`:
  `{ allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: <имя> }, …] }`.
  `settingSources` остаются `['user', 'project', 'local']`, поэтому `CLAUDE.md`, hooks и skills
  пользователя приходят как раньше (ADR-0002); `strictMcpConfig` и замена `mcpServers` не нужны,
  и `qmd` из конфигурации пользователя остаётся.
- **Как проверено.** Скрипт на SDK в изолированном `HOME` и `CLAUDE_CONFIG_DIR` во временной папке
  (не в `~/.claude`): три stdio-сервера пользователя (`qmd`, `github`, `datadog`), сервер проекта из
  `.mcp.json` и in-process `worfy-canvas`; читалось сообщение `system/init` (`mcp_servers`, `tools`),
  до ответа модели.
  - Без `managedSettings`: все пять серверов, MCP tools у четырёх подключённых.
  - С `allowedMcpServers` [`qmd`, `worfy-canvas`]: в `mcp_servers` только `qmd` и `worfy-canvas`;
    сервер проекта тоже отфильтрован.
  - `allowedMcpServers` в `settings.json` пользователя (`github`) **расширяет** список из
    `managedSettings`: списки разрешённых объединяются по уровням. `allowManagedMcpServersOnly: true`
    это закрывает — `github` снова отфильтрован.
  - In-process сервер из опции `mcpServers` (`worfy-canvas`) политикой **не фильтруется**: он
    остаётся, даже когда его нет в списке. Поэтому `options.ts` передаёт `worfy-canvas` (и
    инструкции Canvas в system prompt) только тогда, когда список его называет.
- **Поле Profile — `mcp.allowed`**: массив имён MCP-серверов, например `["qmd", "worfy-canvas"]`.
  Пустой массив `[]` — ни одного сервера. Поле в свой Profile и в `~/.claude/profiles/README.md`
  владелец вносит вручную: worfy в `~/.claude` не пишет.
- **`src/main/workflow/profile.ts`** — `readMcpAllowlist` запускает
  `<claudeHome>/bin/profile -C <cwd> --field mcp.allowed` с cwd Session и с окружением login
  shell (`agentEnv()`, то же, что получает Session): скрипт начинается с `#!/usr/bin/env node`, а у
  `.app`, запущенного из Finder, в PATH только системные каталоги, и node там нет. Список по умолчанию
  `qmd`, `worfy-canvas` с причиной в логе (`[profile] MCP servers for <cwd>: the default list …,
  because …`) — при коде 3, коде 4, отсутствии скрипта, другом коде, таймауте, ответе не-JSON,
  `null` и не списке имён.
- **`app-registry.ts`.** Список читается, только когда Session в Project (к ней подключён Canvas).
  Session вне Project, а также Session, чей Canvas не поднялся, получает серверы пользователя
  как раньше: `managedSettings` не передаётся.
- **Subagent-ы.** Политика действует на весь процесс Claude Code, поэтому Subagent-ы Session и
  Subagent-ы workflow-скриптов должны получать тот же набор; по документации SDK
  `allowedMcpServers` покрывает и серверы из frontmatter агентов, плагинов и коннекторов claude.ai.
  Вживую проверено 2026-10-07 — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).
- **Замер.** В изолированной проверке: 26 tools без списка, 24 со списком (минус два tools
  отфильтрованных серверов). Число tools на Project worfy до и после — не замерено, это ручная
  проверка владельца: нужна живая Session с конфигурацией пользователя.
- **Ограничение.** Если на машине есть админский уровень managed settings (MDM,
  `managed-settings.json`), `managedSettings` от SDK по умолчанию отбрасываются. Сейчас такого
  уровня нет: `/Library/Application Support/ClaudeCode/` отсутствует.
- **Test-ы.** `test/contract/workflow-profile.test.ts` — каждый код выхода, нет скрипта,
  сломанный JSON; настоящий runner против подставного `bin/profile` во временной Claude home;
  снимки деревьев временной Claude home и папки Project до и после совпадают; передача списка из
  `sdkQueryFactory` в `query()`. `test/unit/agent-options.test.ts` — набор серверов со списком
  `[qmd]`, по умолчанию, с пустым списком, без списка, вне Project.

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (второй круг ручных проверок).

**Агенты workflow-скрипта, MCP-серверы и модели — проверка M18.** Stable copy из 6df9791 (pid 2455,
CDP 9351), Project CanvasForAI, настоящий Claude Code. Это замена проверки «во время Wave Autopilot»:
Orchestrator пока не запускает workflow-скрипты.

- В Profile worfy нет поля `mcp` (exit 4), в выводе main — строка «[profile] MCP servers for
  …/CanvasForAI: the default list (qmd, worfy-canvas), because … no mcp.allowed field (profile exit
  code 4)». Она пишется в stderr (`console.warn`, `src/main/workflow/profile.ts:119-121`).
- Новая Session b5c7b667: Claude Code (pid 18181) запущен с `--managed-settings`, где
  `allowManagedMcpServersOnly` и разрешены только qmd и worfy-canvas.
- `/context`: 12 MCP tools (qmd — 4, worfy-canvas — 8). Всего tools 43 против прежних 634: 31
  отложенный (по записи `deferred_tools_delta`) и 12 загруженных (со слов модели).
- Ход «Agent + workflow-скрипт из двух агентов»: по записи `deferred_tools_delta` самого Claude Code у
  Subagent-а и у обоих агентов workflow-скрипта те же 12 `mcp__`, агенты ответили теми же списками.
  `mcp__github` — 0 во всех транскриптах.
- Модели: у Session, Subagent-а и агентов workflow-скрипта — `claude-opus-5-5` (в attachment модели
  у всех `claude-opus-5-5[1m]`). После выбора Sonnet 5.5 в picker Subagent и агент workflow-скрипта
  тоже ответили на `claude-sonnet-5-5`.
- Canvas: под Node-ом Session — дерево из general-purpose и запуска list-mcp-tools с agent-1 и agent-2.
  Второй запуск снят в состоянии running (sleep-1, running 23s), потом — done 1m 05s. Тот же список —
  в панели Subagents Session view.
- Замечание [low]: в превью Node-а агента workflow-скрипта имя tool-а `mcp__qmd__get` показано как
  «mcpqmdget». `summaryLine` снимает `__x__` как выделение даже внутри слова:
  `src/shared/transcript/subagents.ts:401`. По CommonMark подчёркивания внутри слова выделением не
  считаются.
- Вердикт: проверено. Session закрыта кнопкой Close, процесс Claude Code завершён.
- Снимки: дерево workflow-скрипта во время работы — [17-workflow-agents-session.png](../../worfy-daily/evidence/17-workflow-agents-session.png). Остальное — в scratchpad Session
  Orchestrator-а: `M18-context.png`, `M18-canvas-workflow.png`, `M18-canvas-workflow-done.png`,
  `M18-picker-menu.png`, `M18-session-sonnet.png`, `M18-after-close.png`.
