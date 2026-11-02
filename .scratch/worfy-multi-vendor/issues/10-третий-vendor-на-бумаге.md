# 10 — Третий Vendor на бумаге: Gemini CLI и OpenCode против границы

Type: research
Status: done 2026-11-02
Blocked by: 06
Source: [map.md](../map.md), Ticket 01, ответ 7

## Question

Ложатся ли Gemini CLI и OpenCode на границу Vendor-а из ADR Ticket-а 06 без её правки: управление Session, поток событий, resume, разрешения, транскрипты, Limits подписки, расширения? Что не ложится и какой ценой граница это примет — или почему не примет?

## Answer

Проверено 2026-11-02 по первичным источникам. Версии: Gemini CLI `v0.66.0` (2026-10-27, [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli/releases/tag/v0.66.0)); OpenCode `v2.2.5` (2026-10-30, [anomalyco/opencode](https://github.com/anomalyco/opencode/releases/tag/v2.2.5); `sst/opencode` теперь redirect туда); ACP — [agent-client-protocol](https://github.com/agentclientprotocol/agent-client-protocol) `v1.15.0` (schema `v1.29.0`, 2026-11-01). Граница — раздел 06 решений Orchestrator-а (Vendor driver). Метки: **ложится** / **флаг** (ложится, если capability описывает отсутствие) / **не ложится** (нужна правка границы).

### Gemini CLI — через ACP (`gemini --acp`, JSON-RPC по stdio)

| Часть границы | Механизм Gemini CLI | Метка |
|---|---|---|
| start / resume | `session/new`; `session/load` по id + cwd (история приходит повтором `session/update`) | ложится |
| send во время хода | новый `session/prompt` во время хода прерывает ход; очереди и steer по ACP нет (steer — только в TUI, experimental) | флаг `steer: false`, очередь держит worfy (как у Codex) |
| interrupt / close | `session/cancel`; `session/close` не реализован — конец процесса | ложится |
| setModel | `unstable_setSessionModel` (нестабильный метод) | флаг (unstable) |
| setEffort | нет: thinking budget только в settings | флаг `effortLevels: []` |
| setPermissionPreset | `session/set_mode`: `default`, `auto_edit`, `yolo`, `plan` | ложится |
| events | `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `available_commands_update`, `usage_update`; plan-события нет; смена режима приходит текстом `[MODE_UPDATE] <mode>` | ложится (разбор текста — внутри driver-а) |
| permission_request | client-метод `session/request_permission`, варианты `allow_once`, `allow_always`, `cancel` (без `reject_always`) | ложится |
| account | authMethods: `oauth-personal` (Google), `gemini-api-key`, `vertex-ai`, gateway; в ACP CLI сам открывает браузер, URL клиенту не передаёт; токены в `~/.gemini/oauth_creds.json` или keychain | **не ложится** частично: `startLogin()` ждёт URL от Vendor-а |
| limits | дневные квоты запросов по Model (free 1000, AI Pro 1500, Ultra 2000 в день) из внутреннего `retrieveUserQuota`; ни ACP, ни headless их не отдают; при исчерпании CLI может перейти на другую Model | **не ложится**: окон с `usedPercent` нет |
| history list(cwd) / read(id) | `session/list` в ACP нет; есть `--list-sessions` и файлы `~/.gemini/tmp/<project-id>/chats/session-*.jsonl` (формат не документирован); read — повтор через `session/load` | флаг: list — из CLI или файлов, как раз то, от чего граница отказалась для Codex |
| commands | `available_commands_update` даёт 6 встроенных; свои команды (`commands/*.toml`) по ACP не видны | флаг (неполный список) |
| mcp | `session/new` / `session/load` принимают `mcpServers` stdio, SSE, HTTP — localhost HTTP endpoint worfy подходит; in-process нет | ложится (путь Codex, release 2) |
| oneShot | отдельного метода нет; `gemini -p --output-format stream-json` (headless) или отдельная Session в `plan` | флаг (без гарантии «без tool-ов») |
| Harness-расширения | `gemini-extension.json`, hooks (`BeforeTool`, `AfterTool`, `BeforeAgent`, `AfterAgent`, `SessionStart`, `SessionEnd`, `PreCompress`…), skills `SKILL.md`, Subagent-ы `.gemini/agents/*.md` | вне границы; capability-флаги `hooks`, `subagents` |

Риск: ToS Gemini Code Assist (редакция 2026-04-10) запрещает стороннему ПО ходить в backend Code Assist напрямую с OAuth CLI. Запуск настоящего бинарника по ACP — путь Zed и JetBrains, но прямого разрешения для сторонних клиентов в тексте нет. SDK-пакет на npm не опубликован (404), так что ACP — единственный путь управления.

### OpenCode — через `opencode serve` (HTTP + SSE) или `opencode acp`

| Часть границы | Механизм OpenCode | Метка |
|---|---|---|
| start / resume | HTTP API `/api/session` (OpenAPI в `packages/protocol/openapi.json`); ACP: `session/new`, `load`, `list`, `resume`, `fork`, `close` | ложится |
| send во время хода | prompt async с `delivery: steer \| queue` (steer по умолчанию) | ложится (лучше, чем у Codex) |
| interrupt / close | interrupt-endpoint; ACP `session/close` | ложится |
| setModel / setEffort | `{providerID, id, variant}`, `variant` = effort; ACP `set_config_option` (model, effort, mode) | ложится |
| setPermissionPreset | правила `{action, resource, effect: allow \| ask \| deny}` + агенты `build` / `plan`; смена посреди Session по документации неясна | флаг (preset = агент; смену проверить) |
| events | SSE `/api/event`: `session.text`, `session.reasoning`, `session.tool.*`, `permission.asked` / `replied`, `session.inbox.*`, `session.usage.updated`, `session.execution.*` | ложится |
| permission_request | event `permission.asked`, ответ `POST …/permission/{rid}/reply` с `once \| always \| reject` | ложится |
| account | OAuth по HTTP: `connect/oauth` → `{url}`, затем poll; провайдеры с подпиской: ChatGPT Plus/Pro, GitHub Copilot, OpenCode Console (Zen/Go), GitLab; встроенный OAuth Anthropic удалён по требованию Anthropic (PR #18186), вход Gemini по подписке нет; токены в SQLite `~/.local/share/opencode/opencode.db` | **не ложится** частично: у одного Vendor-а несколько аккаунтов провайдеров; и OpenCode принимает API-ключи — driver обязан их не показывать (ADR-0009) |
| limits | `/api/experimental/usage/limits` — только OpenCode Console (rolling / weekly / monthly, percent + `resetsAt`); для ChatGPT и Copilot нет ничего, кроме типизированной ошибки usage limit; токены и стоимость — на каждый шаг | флаг: окна по провайдеру, у части провайдеров пусто |
| history | `GET /api/session?directory=…`, messages по id; ACP `session/list` | ложится |
| commands | список команд в API | ложится |
| mcp | local и remote (url) в config; добавление на лету `PUT /api/experimental/mcp/{name}`; MCP на стороне клиента через WebSocket (experimental) — ближе всех к in-process | ложится |
| oneShot | `POST /api/experimental/generate/text` (experimental) | флаг |
| Harness-расширения | plugin-ы с hooks (session, `permission.evaluate`, tool `execute.before/after`, shell); skills из `.opencode`, `.claude`, `.agents`; только `AGENTS.md`, `CLAUDE.md` в v2 не читает | вне границы; флаги |

Особенность: OpenCode — сам multi-provider harness, а не подписка одного Vendor-а. «Claude Agent» в нём запускает claude пользователя через Agent SDK — для worfy это бессмысленная вложенность. Ценность OpenCode для worfy — доступ к Copilot и OpenCode Console, а Codex по ChatGPT worfy и так ведёт напрямую.

### ACP как общий driver

ACP v1 stable даёт `initialize`, `authenticate`, `session/new|load|list|resume|close|delete`, `session/prompt`, `session/cancel`, `session/set_mode`, `session/set_config_option` (категории `model`, `thought_level`, `mode`), client-методы `session/request_permission` (`allow_once`, `allow_always`, `reject_once`, `reject_always`), `elicitation/create` (есть URL-режим), `session/update` (14 видов, включая `available_commands_update`, `usage_update`, `plan`), `mcpCapabilities.http/sse` ([schema v1](https://github.com/agentclientprotocol/agent-client-protocol/blob/v1.15.0/schema/v1/meta.json)). Адаптеры под ACP есть у Claude ([claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) v0.99.1, 2026-10-29) и Codex ([codex-acp](https://github.com/agentclientprotocol/codex-acp) v2.5.0, 2026-10-29).

Вывод: ACP годится как **общая реализация части `session` + `permission_request` + `commands` + `mcp` (HTTP)** — один `AcpDriver`, который Vendor-ы на ACP переиспользуют. Целиком driver-ом он быть не может:
- Limits подписки: `usage_update` — только контекст и стоимость (`used`, `size`, `cost`), окон с `resetsAt` нет; каждому Vendor-у нужен свой `limits`.
- account: `authenticate` по id метода; агент сам открывает браузер или требует TUI-вход (`AuthMethodTerminal`); `auth/status` — только unstable. `check()` с планом подписки ACP не даёт.
- in-process MCP, Subagent-ы на Canvas, hooks Harness, steer в ACP не описаны; `session/list` реализуют не все (Gemini — нет).
- Claude и Codex через ACP-адаптеры потеряли бы то, что граница берёт напрямую (`rate_limit_event`, `account/rateLimits/*`, in-process SDK MCP). Поэтому для двух первых Vendor-ов — свои driver-ы, ACP — для третьего и дальше.

### Какие правки нужны границе

1. **account.startLogin()** — результат не только «URL от Vendor-а», а один из трёх: `{url}` (Codex, OpenCode), `{vendorOpensBrowser}` (Gemini по ACP), `{terminal}` (вход в TUI, ACP `AuthMethodTerminal`). `check()` — список подключений `{provider, plan}`, а не один аккаунт (OpenCode).
2. **limits** — `LimitWindow.usedPercent` и `resetsAt` могут быть неизвестны, плюс нейтральное событие «лимит исчерпан» из ошибки хода (Gemini quota error, OpenCode usage-limit error, Codex `usageLimitExceeded`). Иначе Autopilot по Vendor-у без окон не узнает, что ждать. Для дневных квот Gemini — окно `windowMinutes: 1440` без процента.
3. **capabilities** — добавить `steer`, `historyList`, `modelSwitchStable`, `oneShotToolFree`, `commandsComplete`, `limitSource: windows | errorOnly | none`. Это расширение списка, не правка формы.
4. **Vendor vs provider** — для OpenCode Vendor = OpenCode, Model = `{provider, model}`; `LimitWindow` получает необязательный `provider`. Для Gemini и Codex не меняется ничего.

Чего не знаем: работает ли Gemini quota по ACP-ошибке так же, как в TUI (переход на другую Model без вопроса ломает выбор Model пользователем); можно ли менять permission-правила OpenCode посреди Session; допустим ли запуск Gemini CLI с OAuth из стороннего desktop-приложения — нужно прямое подтверждение Google.

**Вердикт: граница требует правки:** account (три вида входа, несколько подключений), limits (неизвестный процент, событие «лимит исчерпан», provider в окне), расширенный список capabilities; session, permission_request, history, commands, mcp и oneShot выдерживают оба Vendor-а. Нужно ли переходить на ACP: нет, ACP — общая реализация driver-а для третьего Vendor-а и дальше, а не замена границы.
