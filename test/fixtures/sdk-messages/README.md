# Сообщения Agent SDK, снятые spike-ом тикета 06

Каждый файл — поток сообщений одного сценария `scripts/spikes/sdk-probe.ts`, по одному JSON на
строку, в том порядке, в каком их отдал `query()`. Снято 2026-10-05: `@anthropic-ai/claude-agent-sdk`
0.3.289, Claude Code 2.1.289 (нативный бинарник из пакета SDK), Electron 44.5.1, Node 24.21.0,
macOS arm64, вход по подписке.

| Файл | Что внутри |
| --- | --- |
| `init.jsonl` | Сессия с `settingSources: user + project + local` и MCP-серверами пользователя: `system/init`, SessionStart hooks, `commands_changed`, `rate_limit_event`, partial-события; ход 1 — ответ модели, ход 2 — синтетический ответ «Prompt is too long» и `status: compacting`: к ходу 2 подключились MCP-серверы, и контекст перерос окно haiku. В конце — `probe_error`: итератор SDK бросает исключение, если последний `result` сессии был ошибкой. |
| `controls.jsonl` | Без MCP пользователя: ход, `setPermissionMode` / `setModel` / `applyFlagSettings` между ходами (видно в `system/init`, `system/status`, `user` с `local-command-stdout`), `interrupt()` посреди ответа (`result/error_during_execution`) и следующий ход после него. |
| `stop-hook.jsonl` | Stop hook пользователя с exit 2 при красном маркере Gate: два `hook_response` с `exit_code: 2`, синтетические `user` («Stop hook feedback», `isSynthetic: true`), `system/notification` `stop-hook-error`, третье продолжение после `additionalContext` и один `result` на весь ход. |
| `no-login.jsonl` | Claude Code без входа (пустой `CLAUDE_CONFIG_DIR`): `apiKeySource: none`, синтетический `assistant` («Not logged in · Please run /login», модель `<synthetic>`), `result` с `is_error: true`, затем `probe_error`. |
| `permissions.jsonl` | `permissionMode: default` и `canUseTool`: запрос на Bash, ответ «Always allow» правилом на весь инструмент в слое `session`, второй вызов Bash с другой командой проходит без запроса. |
| `bypass.jsonl` | `bypassPermissions` без `allowDangerouslySkipPermissions`: две сессии подряд, первая — с настройками пользователя, вторая — с `settingSources: []`. В обоих `canUseTool` не вызывается, команда выполняется. |

Обезличено при записи (`sanitize` в spike-е): пути — `~`, `<repo>`, `<tmp>`, `/Users/<user>`;
UUID заменены на `00000000-0000-4000-8000-…` по порядку появления; email, организация, аккаунт,
подпись thinking, `request_id` и путь сокета — `<redacted>`; списки skills, команд, агентов и
tools обрезаны до пяти элементов и строки «<N more>»; имена MCP-серверов и плагинов — `server-N`,
`plugin-N`; строки длиннее 600 символов обрезаны. Partial-событий (`stream_event`) — не больше 12
на файл. Поля `t` (время) и `turn` здесь нет: это только сообщения SDK.

Пересоздать: `pnpm exec electron scripts/spikes/sdk-probe.ts --fixtures test/fixtures/sdk-messages`
(настоящие вызовы модели; содержимое потоков будет другим, форма — та же).
