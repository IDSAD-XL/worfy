# Сообщения Agent SDK, снятые spike-ом тикета 06

Каждый файл `.jsonl` — поток сообщений одного сценария `scripts/spikes/sdk-probe.ts`, по одному
JSON на строку, в том порядке, в каком их отдал `query()`. `can-use-tool.json` — вызовы
`canUseTool` того же spike-а (это не сообщения потока, их SDK передаёт в callback). Снято заново
2026-11-10 (worfy-polish 100): `@anthropic-ai/claude-agent-sdk` 0.3.322, Claude Code 2.1.322 (нативный
бинарник из пакета SDK), Electron 44.10.2, macOS arm64, вход по подписке. Первое снятие — 2026-10-05,
SDK 0.3.289, Claude Code 2.1.289; что из него новое снятие не повторило, сказано у файлов ниже.

`manifest.json` — с чем сняты эти сообщения: версия SDK (`sdk`), Claude Code внутри него
(`claudeCode`) и методы `Query` из `sdk.d.ts` (`queryMethods`). Contract test
`test/contract/sdk-compat.test.ts` сверяет его с `package.json`, с установленным пакетом SDK и с
`claude_code_version` каждого `system/init` здесь, а сценарии fake SDK (`test/fixtures/agent-scripts/`)
— с формами сообщений отсюда. Поднял SDK — в PR обновления снять сообщения новой версии в отдельную
папку (`sdk-probe.ts --fixtures <папка>`: платный прогон, только по слову владельца), положить туда
её манифест (`node scripts/sdk-compat.mjs manifest > <папка>/manifest.json`), сравнить формы
(`node scripts/sdk-compat.mjs diff test/fixtures/sdk-messages <папка>`; код 1 — есть разница, она
напечатана) и заменить этой папкой здешние файлы.

| Файл | Что внутри |
| --- | --- |
| `init.jsonl` | Сессия с `settingSources: user + project + local` и MCP-серверами пользователя: `system/init`, SessionStart hooks, `commands_changed`, `rate_limit_event`, partial-события; два хода с ответами модели. Снятие 2026-10-05 (haiku 4.5) на ходе 2 получило синтетический ответ «Prompt is too long» и `status: compacting`, а в конце — `probe_error`; у haiku 5.5 окно больше, и снятие 2026-11-10 их не повторило: test-ы на них (`test/contract/agent-events.test.ts`) держат эти сообщения в форме первого снятия у себя. |
| `controls.jsonl` | Без MCP пользователя: ход, `setPermissionMode` / `setModel` / `applyFlagSettings` между ходами (видно в `system/init`, `system/status`, `user` с `local-command-stdout`), `interrupt()` посреди ответа (`result/error_during_execution`) и следующий ход после него. В `rate_limit_event` снятия 2026-11-10 только окно `seven_day`: пятичасового окна у аккаунта нет; форму с обоими окнами (снятие 2026-10-05) test-ы держат у себя, а сценарии Limits fake SDK играют её по исключению в `test/contract/sdk-compat.test.ts`. |
| `stop-hook.jsonl` | Stop hook пользователя с exit 2 при красном маркере Gate: два `hook_response` с `exit_code: 2`, синтетические `user` («Stop hook feedback», `isSynthetic: true`), `system/notification` `stop-hook-error`, третье продолжение после `additionalContext` и один `result` на весь ход. |
| `no-login.jsonl` | Claude Code без входа (пустой `CLAUDE_CONFIG_DIR`): `apiKeySource: none`, синтетический `assistant` («Not logged in · Please run /login», модель `<synthetic>`), `result` с `is_error: true`, затем `probe_error`. |
| `permissions.jsonl` | `permissionMode: default` и `canUseTool`, только сообщения потока: два `tool_use` Bash с разными командами и их `tool_result`, `result`. Самого запроса разрешения в потоке нет — он в `can-use-tool.json`. Запрос был один: после ответа на первый вызов второй прошёл без запроса. |
| `can-use-tool.json` | Тот же прогон `permissions`: каждый вызов `canUseTool` — `request` (`toolName`, `input`, `options` с `suggestions`, `blockedPath`, `toolUseID`, `requestId`…; `signal` записан строкой) и `response`, который spike вернул SDK: «Always allow» = `updatedPermissions` с правилом на весь инструмент и `addDirectories` в слое `session`. Ключи `options` со значением `undefined` (`agentID`, `decisionReason`, `title`…) в JSON не попадают; полный список ключей — в «Итог» тикета 06, вопрос 8. |
| `bypass.jsonl` | `bypassPermissions` без `allowDangerouslySkipPermissions`: две сессии подряд, первая — с настройками пользователя, вторая — с `settingSources: []`. В обоих `canUseTool` не вызывается, команда выполняется. |
| `background-tasks.jsonl` | Сценарий `background-tasks` того же `sdk-probe.ts` (с worfy-polish 100; впервые снят одноразовым скриптом тикета worfy-daily/29, 2026-10-06): модель sonnet, `settingSources: []`, без MCP, `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`, streaming input, один Bash `sleep 5` с `run_in_background: true`. `background_tasks_changed` с задачей перед `task_started`, `result` хода, `session_state_changed: idle` при живой задаче, затем `task_updated`, `task_notification`, `background_tasks_changed []` и ход, который Claude Code начал сам: `init`, ответ, `result`. |
| `plugin-*.jsonl` | Сняты тикетом worfy-harness/01 (2026-10-07), заново — 2026-11-10 (`scripts/spikes/harness-plugin/probe.ts`, сценарии `known`, `workflow-hooks`, `env-file` и `mcp-name`, каждый с `--fixtures`; `mcp-name` — без вызова модели; обезличить заново — `--rescrub`): по одному `system/init` на сценарий и вариант — plugin `worfy` inline и в области пользователя, `plugins`, `mcp_servers`, имена MCP-инструментов при разных `allowedMcpServers`; плагины пользователя — `plugin-N`, только встроенные tools — счётчиком. Что значит каждый файл — ADR-0048 и «Итог» тикета. |

Обезличено при записи (`sanitize` в spike-е): пути — `~`, `<repo>`, `<tmp>`, `/Users/<user>`;
UUID заменены на `00000000-0000-4000-8000-…` по порядку появления; email, организация, аккаунт,
подпись thinking, `request_id` и путь сокета — `<redacted>`; списки skills, команд, агентов и
tools обрезаны до пяти элементов и строки «<N more>»; имена MCP-серверов, их tools и плагинов
пользователя заменены на `server-N`, `tool-N`, `plugin-N` везде, где встречаются: поле `name`,
имена tools `mcp__<сервер>__<tool>`, пути `~/.claude/plugins/cache/<marketplace>/<плагин>/`,
ссылки `<плагин>@<marketplace>` (плагины marketplace `builtin` входят в Claude Code и остаются как
есть); имя skill-а или команды со словом личного списка владельца (deny list guard-а `scripts/check-personal.mjs`,
читается из `~/.claude/worfy-harness/user/privacy.json`) — `skill-N` целиком, текст с таким словом (описание
skill-а) — `<personal text>` целиком, а такие записи стоят в конце своего списка (`scripts/spikes/personal-scrub.mjs`);
временные папки системы и папка Claude Code `/private/tmp/claude-<uid>/<проект>` — `<tmp>`; строки длиннее 600 символов обрезаны. Partial-событий (`stream_event`) — не больше 12
на файл. Поля `t` (время) и `turn` здесь нет: это только сообщения SDK.

Пересоздать: `pnpm exec electron scripts/spikes/sdk-probe.ts --fixtures test/fixtures/sdk-messages`
(настоящие вызовы модели; содержимое потоков будет другим, форма — та же). Обезличить заново уже
записанные файлы: `pnpm exec electron scripts/spikes/sdk-probe.ts --rescrub test/fixtures/sdk-messages`.
