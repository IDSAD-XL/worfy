# 04 — Codex: расширения, на которых стоит Harness

Type: research
Status: done 2026-11-02
Blocked by:
Source: [map.md](../map.md), Ticket 01

## Question

Чем Codex расширяется и что из этого покрывает Harness, который сейчас — plugin Claude Code (`harness/`: `hooks/hooks.json`, skills, agents, `bin`; ставится `claude plugin`, ADR-0019/0040): файлы инструкций (`AGENTS.md`, глобальный и проектный), skills, пользовательские команды и prompts, hooks или `notify` (какие события, может ли hook отказать в действии, как Stop/TaskCompleted gate), Subagent-ы или параллельные агенты, MCP (stdio, HTTP; можно ли подать MCP-сервер из процесса worfy, как `createSdkMcpServer`), профили и конфиг (`~/.codex/config.toml`), plugin или marketplace для доставки. Для каждой части Harness — есть ли у Codex аналог, частичный аналог или нет.

## Answer

Проверено 2026-11-02. Состояние Codex: последний стабильный выпуск `rust-v0.166.0` (2026-10-29), source — ветка `main` репозитория `openai/codex` на 2026-11-02. Все части ниже есть в release notes как минимум с `0.138.0` (2026-06-08) — более ранние выпуски не просматривались. Codex локально не установлен, `--help` не запускался: всё — по докам и source.

Что использует Harness (`harness/`): hook-и `SessionStart` (правила, учёт Session, `GH_TOKEN`, worktree lock), `SubagentStart` (общие правила), `TaskCompleted` и `TeammateIdle` (gate fast; exit 2 не даёт закрыть задачу), `Stop` (`stop.mjs` блокирует конец хода, пока gate красный; heartbeat lock-а; обновление индекса qmd), `SessionEnd`, `PreToolUse` с matcher `Bash` (`guard.mjs` отвечает `permissionDecision: "deny"`). Кроме того: 10 skills, 3 Subagent-а (`implementer`, `reviewer`, `scout` — `.md` с `model`, `effort`, у двух — список `tools`), MCP-сервер `qmd` (stdio, `.mcp.json`), скрипты `bin/` через `${CLAUDE_PLUGIN_ROOT}`, локальный marketplace (`.claude-plugin/marketplace.json`) и зависимость от plugin-а `mattpocock-skills`.

| Часть Harness | Аналог в Codex | Есть? | Источник |
|---|---|---|---|
| Правила в `SessionStart` (`inject-rules`) | `~/.codex/AGENTS.md` (или `AGENTS.override.md`) + `AGENTS.md` по пути от корня репозитория до cwd, предел `project_doc_max_bytes` = 32 KiB; ключ `developer_instructions`; hook `SessionStart` с `additionalContext` | есть | [S1], [S2], [S3] |
| Правила для Subagent-ов (`SubagentStart`) | hook `SubagentStart`, `additionalContext` становится developer-контекстом Subagent-а | есть | [S1], [C1] |
| Учёт Session, worktree lock, `GH_TOKEN` | `SessionStart` (matcher по `startup`/`resume`/`clear`/`compact`/`fork`); может ли hook выставить env для shell всей Session, как `CLAUDE_ENV_FILE`, — не нашёл | частично | [S1] |
| gate на `TaskCompleted` / `TeammateIdle` | таких событий нет: в Codex нет общего списка задач и agent teams. Unknown event names в `hooks.json` — по source молча пропускаются (`HookEventsToml` без `deny_unknown_fields`) | нет | [C2] |
| `Stop`: блок конца хода, пока gate красный | `Stop`: `"decision": "block"` или exit 2 — Codex продолжает работу, `reason` становится новым prompt-ом пользователя. Есть и `SubagentStop` | есть | [S1], [C3] |
| `SessionEnd` (учёт, снятие lock-а) | есть, но timeout по умолчанию 1 s, максимум 3 s; для Subagent-ов не запускается | частично | [S1] |
| `PreToolUse` Bash guard с `deny` | `PreToolUse`: `permissionDecision: "deny"` или exit 2; matcher `Bash`, `apply_patch` (алиасы `Edit`/`Write`), MCP tools. Оговорка: `write_stdin` в уже открытую unified-exec Session hook повторно не проходит | есть | [S1] |
| Skills (`/worfy:epic-wave` и др.) | skills: папка с `SKILL.md` (`name`, `description`), `scripts/`, `references/`; вызов `$name` или `/skills`, плюс неявный вызов по `description`; источники `.agents/skills`, `~/.agents/skills`, `/etc/codex/skills`, plugin-ы. Custom prompts (`~/.codex/prompts`) — deprecated в пользу skills | есть | [S4], [S5] |
| Subagent-ы `implementer` / `reviewer` / `scout` | custom agents: TOML в `~/.codex/agents/` или `.codex/agents/` (`name`, `description`, `developer_instructions`, `model`, `model_reasoning_effort`); встроенные `default`, `worker`, `explorer`; параллельный запуск, лимит `agents.max_concurrent_threads_per_session`. Списка `tools` нет — только отключение возможностей (`features.shell_tool` и т. п.); sandbox и approval наследуются от родителя и не переопределяются | частично | [S6], [S2] |
| MCP `qmd` из plugin-а (stdio) | plugin читает `.mcp.json` в корне по умолчанию (`DEFAULT_MCP_CONFIG_FILE`); stdio поддержан | есть | [C4], [S7] |
| MCP `worfy-canvas` / `worfy-browser` в процессе worfy | in-process SDK-сервера нет; `dynamicTools` в `thread/start` протокола app-server, вызовы приходят клиенту как `item/tool/call` — experimental; либо streamable HTTP-сервер, который поднимает worfy | частично | [S8], [C5] |
| Доставка: `claude plugin marketplace add` + локальная папка | `codex plugin marketplace add ./local-root` (также `owner/repo`, git URL, `--ref`), `list`/`upgrade`/`remove`; читаются `.claude-plugin/marketplace.json` и `.claude-plugin/plugin.json` | есть | [S9], [C6] |
| Зависимость `dependencies: [mattpocock-skills]` | в manifest Codex поля зависимостей нет (`name`, `version`, `description`, `keywords`, `skills`, `mcpServers`, `apps`, `hooks`, `interface`) | нет | [C7] |
| `bin/` через `${CLAUDE_PLUGIN_ROOT}` | hook-и plugin-а получают `PLUGIN_ROOT`, а также `CLAUDE_PLUGIN_ROOT` и `CLAUDE_PLUGIN_DATA` — по комментарию в source, «for OOTB compat with existing plugins». Подставляется ли переменная в текст skills и в `.mcp.json` — не нашёл | частично | [C8] |
| `notify` | `notify` в `config.toml`: команда получает JSON на событие; только уведомление, отказать в действии не может | есть (слабее hook-ов) | [S2] |
| Профили и конфиг | `~/.codex/config.toml`, `$CODEX_HOME/<имя>.config.toml` + `--profile`, `CODEX_HOME` переносит весь домашний каталог; `requirements.toml` для managed-настроек (experimental); `-c key=value` и `config` в `thread/start` | есть | [S2], [C5] |

### MCP подробнее

- Транспорты: stdio (`command`, `args`, `env`, `env_vars`, `cwd`) и streamable HTTP (`url`, `bearer_token_env_var`, `http_headers`, `env_http_headers`, OAuth через `codex mcp login`). SSE в доках не упомянут. Общие ключи: `startup_timeout_sec`, `tool_timeout_sec`, `enabled`, `required`, `enabled_tools`, `disabled_tools`, `tools.<tool>.approval_mode` [S7].
- Подать tools из процесса host-приложения: прямого аналога `createSdkMcpServer` нет. TypeScript SDK `@openai/codex-sdk` управляет только thread-ами и config, своих tools не регистрирует [S10]. Ближайший путь — app-server: `thread/start.dynamicTools` (нужен `capabilities.experimentalApi = true`), вызов приходит клиенту запросом `item/tool/call`, tools сохраняются в rollout и восстанавливаются при `thread/resume` [S8], [C5]. В `0.166.0` добавлена замена dynamic tools между шагами модели (#57553). Без experimental-флага остаётся только вынести `worfy-canvas` и `worfy-browser` в отдельный stdio-процесс или в HTTP endpoint внутри worfy.
- Codex как MCP-сервер: `codex mcp-server` удалён в `0.154.0` (2026-09-09, #42993) [R].
- MCP-tools проходят `PreToolUse` [S1].

### Как доставить и версионировать набор skills и правил

- Пакет — plugin: `skills/`, `hooks/hooks.json`, `.mcp.json` — те же пути по умолчанию, что и у Claude Code (`loader.rs`: `DEFAULT_SKILLS_DIR_NAME = "skills"`, `DEFAULT_HOOKS_CONFIG_FILE = "hooks/hooks.json"`, `DEFAULT_MCP_CONFIG_FILE = ".mcp.json"`) [C4]. Manifest ищется в `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`; новый переносимый формат — `plugin.json` в корне со `$schema` agent-plugins.org 1.0.0 [C6], [S9]. Значит, папка `harness/` в нынешнем виде, скорее всего, грузится в Codex частично: skills, hook-и с известными Codex событиями, `qmd`. Agents в manifest не входят.
- Установка: worfy копирует папку и выполняет `codex plugin marketplace add <папка>`. Кэш — `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`, у локального источника версия `local`. Обновление — `codex plugin marketplace upgrade` [S9]. Включение — `plugins.<plugin>.enabled` в `config.toml` [S2].
- Правила (`rules/common.md` и др.) доставляются тремя путями: hook `SessionStart`/`SubagentStart` с `additionalContext` (как сейчас); `~/.codex/AGENTS.md`, но это файл пользователя; или `developer_instructions` через `-c` / `config` в `thread/start` от worfy.
- Subagent-ы plugin не несёт: их TOML нужно класть в `~/.codex/agents/` или `.codex/agents/` проекта отдельным шагом установки.
- Hook trust: hook не из managed-конфига запускается только после того, как пользователь проверил и подтвердил точное определение. Доверие хранится как hash; новый или изменённый hook помечается к проверке и пропускается, пока его не подтвердят [S1], [C9]. Для hook-ов plugin-а доверие привязано к SHA-256 всей папки plugin-а (`codex-rs/hooks/src/engine/plugin_trust.rs:28-44`, `plugin_fingerprint.rs:15`, проверено ревью PR #1233): при несовпадении Codex отвечает «plugin contents changed; hook approval required». Поэтому любое обновление Harness — даже правка текста skill-а, правил или `bin/` — выключает все hook-и Harness (gate на `Stop`, guard Bash на `PreToolUse`) до нового подтверждения в `/hooks`. Для Autopilot без человека это значит: после обновления Harness hook-и не работают, пока пользователь их не подтвердит.
- `/import` (с `0.140.0`, 2026-06-15; в `0.145.0` расширен до plugins, commands, MCP-серверов) переносит настройки Claude Code в Codex [R].

### Гарантии Harness без механизма в Codex

1. Gate на закрытии задачи (`TaskCompleted`, `TeammateIdle`): этих событий нет. Gate можно перенести на `Stop` / `SubagentStop`: блок там продолжает ход, но не отказывает в действии.
2. Запрет записи у `reviewer` и `scout`: список `tools` не задать, sandbox `read-only` для одного Subagent-а не задать — он наследует sandbox родителя. `features.shell_tool = false` убирает shell целиком, а reviewer-у shell нужен, чтобы прогнать проверки. Возможный обход: `PreToolUse` на `apply_patch` с отказом по `agent_type` во входе hook-а. Поля `agent_id` и `agent_type` есть в schema hook-ов [C2], но в `PreToolUse` это не проверено.
3. Hook-и работают без участия человека: в Codex это неверно, пока hook-и не подтверждены (hook trust). Исключение — managed hook-и через `requirements.toml` (experimental).
4. Зависимость одного plugin-а от другого (`mattpocock-skills`): механизма нет.
5. Длинный `SessionEnd`: потолок 3 s против нынешних 10 s.

### Чего не знаем

- Выставляет ли hook `SessionStart` переменные окружения для shell всей Session (нужно для `gh-token-env`).
- Подставляется ли `${CLAUDE_PLUGIN_ROOT}` в текст skills и в `args` из `.mcp.json`. Для hook-ов переменная выставлена как env.
- Что Codex делает с Claude-специфичными полями frontmatter skills и с Claude-форматом `agents/*.md` в plugin-е — по manifest, скорее всего, игнорирует.
- Запускаются ли hook-и в `codex exec` и в Session-ах app-server так же, как в TUI; есть ли там UI для hook trust (в app-server есть метод `hooks/list` [S8]).
- Могут ли Subagent-ы запускать своих Subagent-ов и на какую глубину.
- Как ведут себя `dynamicTools` при `thread/fork` и после рестарта app-server; когда протокол перестанет быть experimental.
- Когда что появилось до `0.138.0`: release notes раньше 2026-06-08 не просмотрены.
- Ничего не проверено запуском: Codex на машине нет.

Источники (docs: developers.openai.com/codex/* редиректит на learn.chatgpt.com/docs/*; source: github.com/openai/codex, `main` на 2026-11-02):
[S1] learn.chatgpt.com/docs/hooks · [S2] …/docs/config-file/config-reference · [S3] …/docs/agent-configuration/agents-md · [S4] …/docs/build-skills · [S5] …/docs/custom-prompts · [S6] …/docs/agent-configuration/subagents · [S7] …/docs/extend/mcp?surface=cli · [S8] …/docs/app-server · [S9] developers.openai.com/plugins/build/plugins и …/docs/plugins · [S10] …/docs/codex-sdk ·
[C1] `codex-rs/hooks/src/schema.rs` (`SubagentStartHookSpecificOutputWire.additional_context`) · [C2] `codex-rs/protocol/src/hooks.rs` (`HookEventsToml`), `hooks/src/schema.rs` (`HookEventNameWire`, `SubagentCommandInputFields`) · [C3] `hooks/src/events/stop.rs` (`should_block`) · [C4] `core-plugins/src/loader.rs:74-76` · [C5] `app-server-protocol/src/protocol/common.rs` (`DynamicToolCall => "item/tool/call"`), `…/v2/thread.rs` (`#[experimental("thread/start.dynamicTools")]`, `config`) · [C6] `exec-server-protocol/src/protocol.rs:55` (`DISCOVERABLE_PLUGIN_MANIFEST_PATHS`), `core-plugins/src/marketplace.rs:20` · [C7] `plugin/src/manifest.rs` · [C8] `hooks/src/engine/discovery.rs:314-319` · [C9] `hooks/src/engine/plugin_trust.rs` ·
[R] github.com/openai/codex/releases — `0.138.0` … `0.166.0`.
