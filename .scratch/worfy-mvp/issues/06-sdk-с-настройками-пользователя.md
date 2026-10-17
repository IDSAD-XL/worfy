# 06 — Как Agent SDK ведёт себя в Electron main с настройками пользователя

Type: research
Status: done 2026-10-05
PR: #6
Blocked by: 01
Source: [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md), абзац про `settingSources: user + project + local`; [spec.md](../spec.md), «Риски и открытые технические вопросы», пункты 1–3 и 5

## Что делаем

Движок Сессий (тикет 07) строится на предположениях, которые никто не проверял. Здесь их
проверяют одним spike-скриптом из Electron main (не из обычного Node: окружение отличается) на
репозитории самого worfy. Итог — факты с выводом команд, а не код для продакшена.

Ответить на вопросы:

1. `settingSources: ['user', 'project', 'local']` — подхватываются ли `~/.claude/CLAUDE.md`,
   hooks из `~/.claude/settings.json` (SessionStart `worktree-lock claim` пишет в реестр), skills
   (`/ship-ticket`, `/epic-wave` в `slash_commands` сообщения `system/init`), subagent-ы и
   MCP-сервера.
2. Stop hook `~/.claude/hooks/stop.sh` с exit 2 (воспроизвести: положить красный маркер Gate для
   worktree spike-а). Что приходит в поток SDK: продолжение хода, `system` с `stop_hook_summary`,
   результат с ошибкой? Чем кончается после двух блокировок?
3. Вход: с вычищенными `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` поле `apiKeySource` в
   `system/init` показывает вход по подписке. Что приходит, если Claude Code не залогинен.
4. `PATH`: приложение из Finder (запуск двойным щелчком) — находят ли hooks `node`, `pnpm`, `gh`.
   Сравнить с `PATH`, взятым из `$SHELL -lc env`. Для этого вопроса — отдельный spike
   `scripts/spikes/path-probe/`: своя точка входа Electron main и свой конфиг electron-builder,
   собирается в отдельную папку. `src/main/index.ts` и сборка приложения (тикет 32) не трогаются.
   Заодно: находит ли SDK `node` для запуска Claude Code и работает ли `cli.js` из `app.asar`
   без распаковки.
5. Поток событий: какие типы сообщений приходят за ход (`system/init`, `assistant`, `user`,
   `result`, `rate_limit_event`, события состояния сессии), есть ли `includePartialMessages` и
   нужно ли оно для живого текста.
6. Управление на ходу: `interrupt()`, `setPermissionMode()`, `setModel()`, как задаётся effort,
   `supportedCommands()`, `supportedModels()`.
7. Пишет ли SDK-сессия запись в `~/.claude/sessions/*.json` и транскрипт в
   `~/.claude/projects/<cwd>/` — то есть увидит ли её чтение внешних Сессий (тикет 13) как чужую.
8. `canUseTool`: форма запроса. Как разрешить инструмент до конца текущей Сессии, ничего не
   записав на диск: свой список в памяти main или `updatedPermissions` с `destination: 'session'`.
   Какие `destination` у `suggestions` пишут в файлы (`localSettings`, `projectSettings`,
   `userSettings`) — такие worfy не применяет никогда (тикет 21).
9. `permissionMode: 'bypassPermissions'` — нужен ли вдобавок `allowDangerouslySkipPermissions: true`,
   и что будет без него (ошибка, молчаливый откат в `default`, запросы разрешений). Ответ
   определяет опции тикета 07.

Если ответ меняет решение из spec или ADR — записать ADR со следующим свободным номером (0006
занят тикетом 02, значит 0007 и дальше) и назвать, что меняется.

## Готово, когда

- [x] На каждый из девяти вопросов в «Итог» есть ответ с выводом spike-а (команда, код выхода, фрагмент сообщения).
- [x] Spike лежит в `scripts/spikes/sdk-probe.ts`, spike `PATH` — в `scripts/spikes/path-probe/`; каждый запускается одной командой, описанной в его шапке.
- [x] Перечислены поля сообщений SDK, на которые опирается тикет 07, с версией SDK и Claude Code.
- [x] Если вывод противоречит spec или ADR — записан ADR-0007 или следующий свободный, и в «Итог» названы затронутые тикеты.

## Тесты

- Test-ов нет: результат — знание. Фрагменты реальных сообщений SDK сохраняются в `test/fixtures/sdk-messages/` для contract test-ов тикета 07 (без текста промптов и путей, которые нельзя публиковать).

## Где в коде

- `scripts/spikes/sdk-probe.ts`
- `scripts/spikes/path-probe/`
- `test/fixtures/sdk-messages/`

## Итог

PR: https://github.com/IDSAD-XL/worfy/pull/6 (ветка `worfy-mvp/06`).

Версии: `@anthropic-ai/claude-agent-sdk` 0.3.289, Claude Code 2.1.289 (нативный бинарник из
пакета SDK, поле `claudeCodeVersion` его `package.json`), Electron 44.5.1 (Node 24.21.0), macOS
arm64, вход по подписке Claude Max. Spike-и идут из Electron main: `sdk-probe.ts` — не собранный
(`pnpm exec electron …`, Node из Electron снимает типы TypeScript сам), `path-probe` — собранный
`.app`, открытый через Finder. Модель всех вызовов — haiku, кроме проверки `setModel` (sonnet).

Команды (код выхода у всех 0; spike всегда выходит с 0, итог сценария — в `summary.json`):

- `pnpm exec electron scripts/spikes/sdk-probe.ts --out <scratch> --fixtures test/fixtures/sdk-messages` —
  все сценарии; потом отдельно `… controls …` и `… permissions …` после правок этих сценариев
  (fixtures `controls.jsonl` и `permissions.jsonl` — из этих повторов).
- `pnpm exec electron scripts/spikes/sdk-probe.ts init --switch-model sonnet` (первый прогон, тогда
  смена модели была внутри `init`) и `… init --env ENABLE_TOOL_SEARCH=true`.
- `bash scripts/spikes/path-probe/run.sh` — три раза: открытие через `open` (отброшено, см. вопрос 4),
  через Finder без `asarUnpack` и через Finder с `asarUnpack`.
- После ревью: `bash scripts/spikes/path-probe/run.sh` в четвёртый раз (shell из минимального
  окружения, `env -0`, в SDK — всё окружение `-ilc`); `… sdk-probe.ts permissions --out <scratch>
  --fixtures test/fixtures/sdk-messages` (записал `can-use-tool.json` и новый `permissions.jsonl`);
  `… sdk-probe.ts --rescrub test/fixtures/sdk-messages` (имена MCP-серверов, их tools и плагинов в
  остальных fixtures, без вызовов модели; повторный запуск файлов не меняет).

### 1. `settingSources: ['user', 'project', 'local']`

Подхватывается всё. `system/init`: `slash_commands` — 136 штук, среди них `ship-ticket` и
`epic-wave`; `skills` — 94; `agents` — `claude, Explore, general-purpose, implementer, Plan,
reviewer, scout, statusline-setup` (subagent-ы пользователя `implementer`, `reviewer`, `scout`);
`mcp_servers` — 12 серверов пользователя (`user:connected` ×3, `claudeai:connected` ×7, по одному
`pending` и `needs-auth`); `plugins` — 6. `~/.claude/CLAUDE.md` загружен: на вопрос, есть ли в
системном контексте раздел «Workflow: orchestrator + subagents», модель ответила `YES`
(`controls`, ход 1). Hooks: оба SessionStart (`session-start.sh`, `worktree-lock claim`) —
`hook_response` с `exit_code: 0`; во время сессии файл в `~/.claude/worktree-sessions/` содержит
её `session_id` (`worktree_lock_files_with_session: 1`), после выхода — нет (`0`): SessionEnd
`worktree-lock release` тоже отработал, хотя в поток SDK SessionEnd не попадает. На каждом ходу
идут три Stop hook-а пользователя (`stop.sh`, `worktree-lock beat`, `qmd-refresh`).

**Риск для 07 — размер контекста.** MCP-серверы пользователя стартуют, не блокируя первый ход, и
приносят 634 tools (`tools` в `init`: 5 показаны, `<629 more>`). Замеры (`usage` в транскрипте):
ход 1 на haiku, пока часть серверов `pending`, — `cache_creation_input_tokens: 143945`; первый
ход на sonnet после подключения серверов — `507658` токенов, `costUSD: 2.03` по прайсу. На haiku
ход 2 (и ход 1, если серверы успели подключиться) — синтетический ответ `Prompt is too long ·
the request is ~236657 tokens (limit 200000)`, `status: compacting`, `compact_result: failed`. С
`ENABLE_TOOL_SEARCH=true` на haiku — `~353280 tokens`, не помогает. Без MCP пользователя
(`strictMcpConfig: true, mcpServers: {}`) ход на haiku стоит $0.002–0.016. Не проверено: сколько
весит ход на модели, которую возьмёт 07 (в настройках пользователя `opus[1m]`), и откладывает ли
там Claude Code MCP tools через tool search. Решение (оставлять MCP пользователя, отключать
connectors claude.ai или включать tool search) — за 07 по замеру; ADR-0002 (`settingSources`
пользователя) этот замер не меняет, но делает дорогим.

### 2. Stop hook с exit 2

Воспроизведено без записи в `~/.claude`: `stop.sh` читает каталог состояния Gate из
`CLAUDE_GATE_STATE`, spike кладёт туда `red-worfy-<tag>` во временной папке. Поток одного хода
(`stop-hook.jsonl`): `assistant` «ok» → три Stop hook-а, у `stop.sh` `hook_response` с
`exit_code: 2`, `outcome: "error"`, `stderr: "Гейт качества красный (упал lint (sdk-probe red
marker)). Прогони …"` → `user` с `isSynthetic: true` и текстом `Stop hook feedback:\n[$HOME/.claude/hooks/stop.sh]: Гейт качества красный …`
→ `system/notification` `{"key":"stop-hook-error","text":"Stop hook error occurred · ctrl+o to see"}`
(только при первой блокировке) → новый ответ модели → вторая блокировка так же → третий ответ →
третий `stop.sh` выходит с 0, но печатает `{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"Гейт качества всё ещё красный и не был вычищен за 2 попытки …"}}`,
и модель получает ещё один ответ → четвёртый `stop.sh` — 0 без вывода → один `result/success`,
`num_turns: 3`, `is_error: false`. Итого на один ход пользователя — три продолжения подряд (две
блокировки и одно `additionalContext`), один `result` в конце. Следующий ход Сессии не
блокируется (счётчик `stop-blocks/<session>__worfy-<tag>` = 5). Сообщения
`stop_hook_summary` в потоке SDK нет: оно есть только в транскрипте (`type: system, subtype:
stop_hook_summary`). Для 07: `busy` держится до `result`; событие `hook` строится из
`hook_response` (`includeHookEvents: true`) и синтетического `user`.

### 3. Вход

`apiKeySource` в `system/init` — `"none"` и при входе по подписке, и без входа, признаком не
служит. При входе `accountInfo()` отдаёт ключи `apiProvider, email, organization,
subscriptionType` (`subscriptionType: "Claude Max"`). Без входа (пустой `CLAUDE_CONFIG_DIR`):
`accountInfo()` — `{"apiProvider": …, "tokenSource": "none"}`; ход — `assistant` с моделью
`<synthetic>` и текстом `Not logged in · Please run /login`, `result` с `is_error: true`,
`terminal_reason: "api_error"`, `total_cost_usd: 0`; после закрытия входа итератор `query()`
бросает `Error: Claude Code returned an error result: Not logged in · Please run /login`. Сам
spike запущен из окна Claude Code: в окружении было 29 переменных родительской сессии
(`ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_SCOPES`, `CLAUDE_CODE_SESSION_ID` …), spike их
убирает. Противоречит спецификации (риск 3) — ADR-0009.

### 4. `PATH` из Finder

`bash scripts/spikes/path-probe/run.sh` (Finder через `osascript`, код 0; первый вариант с
`open -W` отброшен: `open` передал приложению окружение вызывающего shell, вместе с 29
переменными `CLAUDE_*`). Результат (`~/Library/Application Support/worfy-path-probe/result.json`):

- приложение из Finder: `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, `node`, `pnpm`, `gh` — не найдены;
- `$SHELL -lc env`: добавились Homebrew и `~/.local/bin`, `gh=/opt/homebrew/bin/gh`, `node` и
  `pnpm` не найдены (nvm подключается в `~/.zshrc`);
- `$SHELL -ilc env` (393 мс): `node=/Users/<user>/.nvm/versions/node/v24.19.0/bin/node`, `pnpm` там же,
  `gh=/opt/homebrew/bin/gh`;
- после ревью shell запускается из минимального окружения (`env -i HOME USER LOGNAME SHELL TMPDIR
  LANG SSH_AUTH_SOCK __CF_USER_TEXT_ENCODING PATH=/usr/bin:/bin:/usr/sbin:/sbin`) и печатает
  `env -0`: из Finder `-ilc` — 324 мс, 17 переменных, `node`, `pnpm`, `gh` найдены,
  `parent_session_vars: []`; `-lc` — 9 мс, только `gh`. Та же команда из окна Claude Code (у
  вызывающего shell 29 переменных `CLAUDE_*`/`ANTHROPIC_*`) дала 15 переменных, среди них ни одной
  `CLAUDE_*`/`ANTHROPIC_*`, `node`, `pnpm`, `gh` найдены. SDK со всем окружением `-ilc` (не только
  его `PATH`): `result: ok`, hook видит `node`, `pnpm`, `gh`;
- command hook Claude Code (SessionStart, переданный через `settings` SDK) видит тот `PATH`,
  который задан в `env` SDK: с `PATH` приложения — `node=`, `pnpm=`, `gh=` пусто; с `-ilc` — все
  найдены. Hooks пользователя (`stop.sh`) сами добавляют nvm и Homebrew, но команды модели в Bash —
  нет.
- SDK и бинарник: `node` для запуска Claude Code не нужен — `cli.js` в SDK 0.3.289 нет, SDK
  запускает нативный `@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`; запуск с голым
  `PATH` прошёл (`result: ok`). Своим поиском SDK находит путь внутри `app.asar` и падает:
  `spawn ENOTDIR`. С `pathToClaudeCodeExecutable`, указывающим в `app.asar.unpacked`, — `init` и
  `result: ok`, `claude_code_version: 2.1.289`. Копия в `app.asar.unpacked` появилась и без
  `asarUnpack` (smart unpack electron-builder), и с явным
  `asarUnpack: node_modules/@anthropic-ai/claude-agent-sdk-*/**` (текущий конфиг spike-а).

Противоречит спецификации (риски 2 и 11) и тикету 07 (`$SHELL -lc env`, `cli.js`, `executable`,
`asarUnpack` для `claude-agent-sdk/**`) — ADR-0007 (окружение) и ADR-0008 (бинарник).

### 5. Поток событий

За ход приходят (`controls`, `init`): `system/hook_started` и `system/hook_response`
(SessionStart — всегда, остальные — с `includeHookEvents: true`), `system/commands_changed`
(до 6 раз в начале: skills подгружаются), `rate_limit_event` (один раз за Сессию, перед первым
запросом: `rate_limit_info.status`, `resetsAt`, `unifiedWindows.five_hour.utilization`,
`seven_day.utilization`), `system/init` — **на каждом ходу заново** (с текущими `model` и
`permissionMode`), `system/status` (`requesting`, `compacting`, `null`; после
`setPermissionMode` — с полем `permissionMode`), `system/thinking_tokens`, `assistant` (по
сообщению на каждый блок: отдельно `thinking`, отдельно `text`, отдельно `tool_use`; текст
`thinking` у haiku пустой, есть только `signature`), `user` (`tool_result`; синтетические с
`isSynthetic: true`; `local-command-stdout` после `setModel`), `system/notification`, `result`.
`system/session_state_changed` не пришло ни разу. С `includePartialMessages: true` добавляются
`stream_event` (`message_start`, `content_block_start`, `content_block_delta` с `text_delta` /
`thinking_delta`, `content_block_stop`, `message_delta`, `message_stop`). Без них `assistant`
приходит только целым блоком, поэтому для живого текста `includePartialMessages` нужен.

### 6. Управление на ходу

Между ходами (`controls`): `setPermissionMode('default')`, `setModel('sonnet')`,
`applyFlagSettings({ effortLevel: 'low' })` — все без ошибки, возвращают `undefined`. Следующий
ход: `system/init` с `permissionMode: "default"`, `model: "claude-sonnet-5-5"`, ответ
`assistant` с `model: "claude-sonnet-5-5"`; в поток приходит `user` с
`` <local-command-stdout>Set model to `sonnet (claude-sonnet-5-5)`</local-command-stdout> ``. Effort:
опция `effort` у `query()` и `applyFlagSettings({ effortLevel })` в ходе. Поля `effort` в
`system/init` нет вовсе — ни в одном из шести fixtures (`grep -c '"effort"'` — 0 в каждом), есть
только `per_turn_effort_active` (`true` после `applyFlagSettings`). По `sdk.d.ts` SDK 0.3.289
`effort` в `init` бывает только у кадров Remote Control bridge, у остальных хостов его нет. Значит,
по `init` нельзя узнать уровень effort и нельзя проверить, что `low` применился; это не проверено.
`interrupt()` на первом `text_delta`: возвращает `{"still_queued": []}`, ход кончается
`assistant` с куском текста (`"1 2 3 4 "`), `user` `[Request interrupted by user]` и `result`
`error_during_execution`, `is_error: true`, `errors: ["[ede_diagnostic] result_type=user …"]`;
следующий ход той же Сессии проходит (`result: ok`). `supportedCommands()` — 136 записей
`{name, description, argumentHint, builtin?}`; `supportedModels()` — 12 записей `{value, displayName,
supportsEffort, supportedEffortLevels}`: `default`, `opus`, `fable`, `sonnet`, `haiku`,
`claude-sonnet-5`, `claude-opus-5` …; уровни `low … max`, у haiku уровней нет. Итератор `query()` бросает
исключение `Claude Code returned an error result: …`, если последний `result` перед закрытием
входа был ошибкой; посреди Сессии ошибка хода исключения не бросает. `updateSettings()` пишет в
файлы настроек — worfy его не зовёт (ADR-0005).

### 7. Следы SDK-сессии в `~/.claude`

Пока процесс жив, есть `~/.claude/sessions/<pid>.json` с `sessionId`, `kind: "interactive"`,
`entrypoint: "sdk-ts"`, `status: "busy" | "idle"`; после выхода файл удаляется
(`registry_entry: null`). Транскрипт `~/.claude/projects/<cwd, где не буквы и цифры — "-">/<sessionId>.jsonl`
пишется и остаётся, записи с `entrypoint: "sdk-ts"`. Значит, чтение внешних Сессий (13) увидит
Сессию worfy как обычную интерактивную; отличить можно по `entrypoint: "sdk-ts"` и по
`sessionId`, который worfy знает из `init` — дедупликация по `sessionId` (14), как в
спецификации. С `persistSession: false` (path-probe) транскрипт не пишется — запись в реестре при
этом не проверялась.

### 8. `canUseTool`

Запрос (`permissions`, `permissionMode: 'default'`, Bash `mkdir -p <tmp>/perm/one`):
`toolName: "Bash"`, `input: {command, description}`, ключи `options`: `agentID, blockedPath,
decisionReason, defaultToNo, description, displayName, requestId, signal, suggestions,
suppressAlwaysAllowRule, title, toolUseID`. `suggestions`:
`{type: "addRules", rules: [{toolName: "Bash", ruleContent: "mkdir -p <tmp>/perm/one"}], behavior: "allow", destination: "localSettings"}`,
`{type: "addDirectories", directories: ["<tmp>/perm"], destination: "session"}`,
`{type: "setMode", mode: "acceptEdits", destination: "session"}`. То есть предложенное правило —
на одну точную команду и пишется в файл (`localSettings`), а `setMode` переключил бы Сессию в
`acceptEdits`. Три прогона:

- все `suggestions` с `destination: 'session'` — 1 запрос на две разные команды (но вместе с
  `setMode acceptEdits`);
- только `addRules` → `session`, одна и та же команда дважды — 2 запроса: для пути вне `cwd`
  правила мало, нужен `addDirectories`;
- правило на весь инструмент `{type: "addRules", rules: [{toolName: "Bash"}], behavior: "allow",
  destination: "session"}` плюс `addDirectories` → `session`, две разные команды — 1 запрос,
  обе выполнены (`permissions.jsonl`).

Запрос и ответ последнего прогона записаны в `test/fixtures/sdk-messages/can-use-tool.json`
(повтор после ревью: 1 запрос, обе команды выполнены, файлы настроек не изменились). Ключи
`options` со значением `undefined` в JSON не попадают, поэтому там их меньше, чем в списке выше.

Во всех трёх `~/.claude/settings.json` и `<repo>/.claude/settings*.json` не изменились
(отпечаток mtime + sha256 до и после совпал). Ответ для 21: «Always allow» = `updatedPermissions`
с `destination: 'session'` — правило на весь инструмент (без `ruleContent`) и `addDirectories`
из `suggestions`; свой список в памяти main не нужен, SDK держит слой `session` сам и до конца
процесса. `localSettings`/`projectSettings`/`userSettings` и `setMode` из `suggestions` worfy не
применяет. Не проверено: переживает ли слой `session` `resume`.

### 9. `bypassPermissions` без `allowDangerouslySkipPermissions`

В SDK 0.3.289 флаг не нужен: и с настройками пользователя (в них
`skipDangerousModePermissionPrompt: true`), и с `settingSources: []` `init` показывает
`permissionMode: "bypassPermissions"`, `canUseTool` не вызывается, `mkdir` выполнен, ошибок нет.
Документация SDK флаг требует (`Must be set to true when using permissionMode:
'bypassPermissions'`), поэтому 07 передаёт `allowDangerouslySkipPermissions: true` вместе с
`bypassPermissions`: сейчас это ничего не меняет, а при ужесточении SDK не даст молчаливого отката.

### Поля сообщений SDK, на которые опирается 07

SDK 0.3.289, Claude Code 2.1.289. Все сообщения: `type`, `subtype` (у `system` и `result`),
`session_id`, `uuid`.

- `system/init`: `session_id`, `model`, `permissionMode`, `cwd`, `claude_code_version`,
  `slash_commands`, `skills`, `agents`, `tools`, `mcp_servers[{name, status, source}]`, `plugins`,
  `apiKeySource` (только для показа, не признак входа), `per_turn_effort_active`. Приходит на
  каждом ходу. Поля `effort` в `system/init` у SDK-хоста нет (вопрос 6): текущий уровень effort
  07 берёт из того, что сам передал (`effort` в `query()`, `applyFlagSettings({ effortLevel })`).
  По `sdk.d.ts` уровень хода есть ещё в поле `effort.level` входа hooks внутри хода (`PreToolUse`,
  `PostToolUse`, `Stop`…) и в переменной `CLAUDE_EFFORT` у hooks и команд Bash; в spike-е это не
  проверялось.
- `system/status`: `status` (`requesting | compacting | null`), `permissionMode?`,
  `compact_result?`, `compact_error?`.
- `system/hook_started` / `system/hook_response`: `hook_id`, `hook_name`, `hook_event`,
  `exit_code`, `outcome`, `stdout`, `stderr`.
- `system/notification`: `key`, `text`, `priority`.
- `system/commands_changed`: `commands` (заменяет кэш slash-команд).
- `rate_limit_event`: `rate_limit_info.{status, resetsAt, rateLimitType, unifiedWindows.{five_hour,seven_day}.{utilization, resetsAt}}`.
- `assistant`: `message.{id, model, content[{type: text | thinking | tool_use, …}], stop_reason, usage}`,
  `parent_tool_use_id`; `model: "<synthetic>"` — ответ самого Claude Code, не модели.
- `user`: `message.content` (строка или блоки `tool_result`), `isSynthetic?`, `parent_tool_use_id`.
- `stream_event`: `event.type`, `event.delta.{type, text}`.
- `result`: `subtype` (`success | error_during_execution | error_max_turns | …`), `is_error`
  (бывает `true` при `subtype: success`), `result`, `errors?`, `num_turns`, `total_cost_usd`,
  `usage`, `modelUsage`, `permission_denials`, `terminal_reason`, `stop_reason`.

Fixtures — `test/fixtures/sdk-messages/` (описание в README рядом).

### ADR и затронутые тикеты

Три решения, по одному на файл (после ревью первая редакция ADR-0007, где они были вместе,
разделена):

- ADR-0007 (`docs/adr/0007-claude-code-launch-environment.md`) — окружение Claude Code из
  `$SHELL -ilc`, запущенного из минимального окружения, `env -0` между маркерами, из результата
  убираются только `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN`;
- ADR-0008 (`docs/adr/0008-claude-code-native-binary-path.md`) — нативный бинарник платформенного
  пакета SDK, `pathToClaudeCodeExecutable` в `app.asar.unpacked` без `executable`, `asarUnpack`
  добавляет тикет 07;
- ADR-0009 (`docs/adr/0009-claude-code-login-check-account-info.md`) — вход проверяется через
  `accountInfo()`, не через `apiKeySource`.

Затронуты:

- 07 — `env.ts` (`-ilc` из минимального окружения, маркеры, `env -0`, удаление ровно двух ключей
  API), `options.ts` (`pathToClaudeCodeExecutable`, без `executable`,
  `allowDangerouslySkipPermissions: true`, `includePartialMessages: true`,
  `includeHookEvents: true`), `test/unit/agent-executable.test.ts` (путь к бинарнику
  платформенного пакета, не к `cli.js`), `electron-builder.yml` (`asarUnpack` для
  `node_modules/@anthropic-ai/claude-agent-sdk-*/**`: тикет 32 оставляет эту строку тикету 07),
  события `hook` без `stop_hook_summary`, три продолжения после Stop hook, «Готово, когда» про
  вход по подписке — через `accountInfo()`, effort не из `init` (вопрос 6); риск размера контекста
  от MCP пользователя;
- 21 — «Always allow» через слой `session` (вопрос 8), `setMode` из `suggestions` не применять;
- 13, 14 — Сессии worfy в реестре с `kind: "interactive"`, `entrypoint: "sdk-ts"`;
- 22 — `rate_limit_event` приходит один раз за Сессию, перед первым запросом;
- спецификация эпика — риски 2, 3 и 11 устарели (правку spec.md делает оркестратор).

Не проверено: вес контекста и tool search на модели по умолчанию (`opus[1m]`); применился ли
`effortLevel: low` и видно ли его в `effort` входа hooks и в `CLAUDE_EFFORT`; переживает ли слой разрешений `session` `resume`; запись в
`~/.claude/sessions` при `persistSession: false`; уведомления и вид окна в этом тикете не
затрагиваются.

### Ручная проверка 2026-10-06, ночь

Сборка `main` @ 92c00a5, проверял агент. Собранный `worfy.app` запущен из shell агента командой
`SHELL=/bin/bash "$APP/Contents/MacOS/worfy" --remote-debugging-port=9339`, то есть с «грязным»
окружением: `ANTHROPIC_BASE_URL` и около 30 переменных `CLAUDE_*`. Порт DevTools — только чтобы читать
DOM. Лог main и снимки лежат в scratchpad Session оркестратора, в репозиторий не положены.

**Минимальное окружение с `SHELL=/bin/bash` — проверено (проверка 31 гайда).**

- «New session» → Bash `echo $PATH; which gh pnpm node jq; echo $SHELL`. `PATH` собран из `/etc/paths`
  и `/etc/paths.d` (`/usr/local/bin:…:/usr/bin:/bin:/usr/sbin:/sbin:…:/opt/homebrew/bin`),
  `gh=/opt/homebrew/bin/gh`, `jq=/usr/bin/jq`, `node` и `pnpm` не найдены (nvm подключается в
  `~/.zshrc`, bash его не читает), `SHELL=/bin/bash`. Совпало с ожиданием гайда.
- Строки `[agent] using the minimal environment` (её пишет `src/main/agent/env.ts:113`, когда запуск
  shell не удался) в логе main нет: `grep -c` = 0 до ⌘Q и после.
- `ps -E` у процессов Claude Code Orchestrator-а и Session: `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`,
  `SSH_AUTH_SOCK`, `__CF_USER_TEXT_ENCODING`, `PATH`, `PWD`, `SHLVL`, `_` и 3 переменные SDK.
  `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDECODE`,
  `CLAUDE_CODE_SESSION_ID` нет.
- ⌘Q: worfy завершился с exit code 0, процессов этой сборки не осталось. `git status --porcelain`
  основного checkout пуст до и после.
- Не проверено: fish и rc-файлы, которым нужен `TERM`.
- Попутно из других проверок той же ночи: выбранный effort применяется — `CLAUDE_EFFORT=low` в Bash
  Session после выбора low, без выбора `medium` (проверка 22, Ticket 19); ход Orchestrator-а на
  `claude-opus-5-5[1m]` с 634 tools и вызовом `create_card` стоил $0.1041, «Prompt is too long» не было
  (проверка 25, Ticket 24).
- Снимки: `31-01-start.png`, `31-02-new-session.png`, `31-03-answer.png`.

### Долги из HANDOFF (2026-10-08)

- Окружение запуска shell с fish (`SSH_AUTH_SOCK`, `__CF_USER_TEXT_ENCODING` и другие, ADR-0007) не
  проверено, потому что fish на машине нет (`which fish` — not found), а ставить программы решает
  владелец. zsh и `SHELL=/bin/bash` проверены раньше.
