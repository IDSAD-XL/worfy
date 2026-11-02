# 05 — Codex: транскрипты и Session-ы вне worfy

Type: research
Status: done 2026-11-02
Blocked by:
Source: [map.md](../map.md), Ticket 01

## Question

Где и в каком формате Codex хранит историю Session (`~/.codex/sessions/…`, rollout-файлы JSONL или иное), чем она отличается от транскриптов Claude Code, на которых стоят Node Session на Canvas, Subagent-ы (ADR-0030/0031/0085), поиск и Flight Recorder (`src/shared/transcript/parse.ts`, `src/main/claude-home/*`)? Можно ли по ней найти Session, запущенную в терминале, а не в worfy, связать её с папкой Project, продолжить её, увидеть дочерних агентов, если они есть? Стабилен ли формат между версиями?

## Answer

Источники: исходники `openai/codex` на `main` a09812981d (2026-11-01, последний выпуск `rust-v0.166.0` от 2026-10-29), release notes 0.147–0.166 (2026-08-07 … 2026-10-29), справочник CLI на learn.chatgpt.com (бывш. developers.openai.com/codex). Ниже `R:` = `codex-rs/`. Настоящие файлы Session на этой машине не открывались (privacy rule); `codex` здесь не установлен.

**Где лежат и как названы.** Корень — `$CODEX_HOME` (по умолчанию `~/.codex`). Каждая Session (в коде — thread) — свой файл `sessions/YYYY/MM/DD/rollout-YYYY-MM-DDThh-mm-ss-<threadId>.jsonl`; дата и время — локальные, на момент создания; `threadId` — UUIDv7 (`R:rollout/src/recorder.rs` `precompute_new_rollout_path`, `R:rollout/src/rollout_file_name.rs`). У откаченного (revert) thread-а к имени добавляется `_<rolloutId>`. Файл создаётся не сразу, а при первой записи (deferred creation). Заархивированные — в `archived_sessions/` (`R:rollout/src/lib.rs`). С флагом `--ephemeral` файла нет вовсе (справочник CLI). Рядом лежат: `session_index.jsonl` (имена thread-ов, `thread_name`), SQLite `state_5.sqlite` (метаданные thread-ов для списков), `thread_history_1.sqlite` (для paginated-истории), `thread-writer-locks/<threadId>.lock` (`R:rollout/src/session_index.rs`, `R:state/src/sqlite.rs`, `R:rollout/src/writer_lock.rs`). Важно: файлы старше 7 дней могут быть сжаты в `.jsonl.zst` (zstd, уровень 3). Это делает флаг `local_thread_store_compression` (UnderDevelopment, по умолчанию выключен) или вызов app-server `rollout/compress`, который работает и без флага; с 0.164.0 (2026-10-23) resume находит сжатые файлы (`R:rollout/src/compression.rs`, `R:features/src/lib.rs`, `R:app-server/README.md` «Local rollout compression»). Читатель worfy должен понимать и `.jsonl`, и `.jsonl.zst`.

**Строка файла.** `{"timestamp":"…","ordinal":N?,"type":"<kind>","payload":{…}}` (`RolloutLine` и `RolloutItemWire` в `R:history/src/lib.rs`, `R:history/src/rollout_payload.rs`). Значения `type`: `session_meta`, `turn_context`, `response_item`, `event_msg`, `compacted`, `token_usage_record`, `world_state`, `retained_context`, `security_risk_score`, `dynamic_tools_updated`, `inter_agent_communication(_metadata)`, `realtime_item`. Что из этого пишется на диск, решает `R:rollout/src/policy.rs`.
- `session_meta` (первая строка): `id` (thread), `session_id` (id корневого thread-а дерева), `cwd`, `timestamp`, `originator`, `cli_version`, `source`, `thread_source`, `parent_thread_id`, `forked_from_id`, `agent_nickname`/`agent_role`/`agent_path`, `model_provider`, `base_instructions`, `history_mode` (`legacy`|`paginated`), `git` (commit, branch, repository url) (`SessionMeta` в `R:protocol/src/protocol.rs:3418`).
- `turn_context` (на каждый ход): `turn_id`, `cwd`, `model`, `effort`, `approval_policy`, `sandbox_policy`. `cwd` может меняться от хода к ходу.
- `response_item` — элементы OpenAI Responses API (`R:protocol/src/models.rs:1062`): `message` {`role` user/assistant/developer, `content[]` из `input_text`/`output_text`/`input_image`, `phase` commentary|final_answer}; `reasoning` {`summary[]`, `encrypted_content`}; `function_call` {`name`, `arguments` (строка JSON), `call_id`}; `function_call_output` {`call_id`, `output`}; `custom_tool_call(_output)`, `local_shell_call`, `web_search_call`, `tool_search_call`, `agent_message` {`author`, `recipient`}. Команда shell — это `function_call` с `name` `exec_command` (unified exec, есть ещё `write_stdin`). Её вывод в legacy-режиме есть только в `function_call_output`: событие `exec_command_end` на диск не пишется.
- `event_msg` (legacy): `user_message` {`message`, `images`}, `agent_message`, `agent_reasoning`, `task_started` и `task_complete` {`turn_id`, `last_agent_message`, `error`} (alias `turn_started`/`turn_complete`), `turn_aborted`, `token_count`, `item_completed`. Конец хода — `task_complete` или `turn_aborted`.
- В режиме paginated (`history_mode`) `user_message`/`agent_message` не пишутся, вместо них `item_completed` с TurnItem. Вывод команды там лежит в `aggregated_output`, обрезан до 64 KiB (с 0.162.0, 2026-10-08). Перевод старых файлов в paginated — `codex migrate-rollouts` и флаг `background_paginated_rollout_migration` (UnderDevelopment, выключен; инструмент с 0.148.0, 2026-08-18).

**Sub-агенты.** Есть, флаг `multi_agent` — Stable, включён по умолчанию (`R:features/src/lib.rs:1592`). Каждый дочерний агент — отдельный thread и отдельный rollout-файл в той же папке по дате, без вложенной папки, как у Claude. У ребёнка: `source: {"subagent":{"thread_spawn":{parent_thread_id, depth, agent_path, agent_nickname, agent_role}}}`, поле `parent_thread_id`, общий `session_id` с корнем. Бывают и другие дети: `review`, `compact`, `memory_consolidation`, `internal: guardian`. В родителе вызов виден как `function_call` `spawn_agent` / `send_message` / `followup_task` (`R:core/src/tools/router.rs:74`) и строки `inter_agent_communication`. Дерево собирается по `parent_thread_id`. Это требует прочитать `session_meta` каждого файла или спросить индекс (state DB или app-server `thread/list`).

**Терминал или приложение.** Отличаются по `source` и `originator` в `session_meta`. TUI в терминале пишет `source "cli"` и `originator "codex_cli_rs"` (`R:tui/src/lib.rs:752`, `R:login/src/auth/default_client.rs:42`). `codex exec` пишет `"exec"` и `"codex_exec"`. Любой клиент `codex app-server` (расширение VS Code, приложение Codex, и worfy, если пойдёт этим путём) получает `source "vscode"` (значение по умолчанию app-server, `R:app-server/src/lib.rs:462`). Его `originator` равен `clientInfo.name` из `initialize` (`R:app-server/src/request_processors/initialize_processor.rs:127`). Значит, worfy может метить свои Session собственным `clientInfo.name`, как Claude Code ставит `entrypoint`. Переопределение — env `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`.

**Связь с Project.** Есть только поле `session_meta.cwd` (и `turn_context.cwd`). Папки «по cwd», как `projects/<dir>` у Claude, нет. Найти Session-ы Project-а можно тремя путями: обойти все файлы по датам, спросить `state_5.sqlite` или вызвать app-server `thread/list` с фильтрами cwd, `sourceKinds`, archived (`R:app-server-protocol/schema/typescript/v2/ThreadListParams.ts`).

**Resume по id.** `codex resume <uuid|имя>`, `--last` (последняя Session в текущем cwd), `--all`. Также `codex fork <uuid>` и `codex exec resume <uuid|имя>` (справочник CLI). Через app-server: `thread/resume {threadId}` (или path, или history) и `thread/fork`. Resume открывает тот же файл и дописывает в него. Fork создаёт новый файл с `forked_from_id`.

**Стабильность формата.** Формат файла официально не документирован: справочник упоминает только «session rollout files» у `--ephemeral`. Версии формата нет, есть только `cli_version` и `history_mode` в `session_meta`. Совместимость держат serde-alias-ы и `#[serde(other)]`. Формат меняется часто: выпуски идут 1–2 раза в неделю, и с 2026-08 по 2026-10 в них были сжатие (0.152–0.164), paginated-миграция (0.148), обрезка вывода (0.162), личность создателя (0.157). Поддерживаемый контракт — JSON-RPC v2 app-server со сгенерированной TS-схемой в репо: `thread/list`, `thread/read {includeTurns}`, `thread/turns/list`, `thread/items/list`. Он прячет `.zst`, paginated-режим и индексы.

| Что worfy берёт | Claude Code (`~/.claude/projects`) | Codex (`~/.codex`) |
|---|---|---|
| Файл Session | `projects/<cwd-dir>/<sessionId>.jsonl` | `sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl[.zst]` |
| cwd / Project | имя папки + `cwd` записей | `session_meta.cwd`, `turn_context.cwd` |
| Сообщения | `user`/`assistant`, `message.content[]` | `response_item` `message` (+ legacy `event_msg user_message`/`agent_message`) |
| Мысли | блок `thinking` (текст) | `reasoning`: `summary` + шифрованный `encrypted_content` |
| Инструменты | `tool_use` / `tool_result` по `id` | `function_call` / `function_call_output` по `call_id` |
| Вывод команд | `tool_result` | `function_call_output`; paginated — `aggregated_output` ≤64 KiB |
| Subagent | `<sessionId>/subagents/agent-<id>.jsonl`, `isSidechain`, `agentId` | отдельный rollout, `source.subagent.thread_spawn`, `parent_thread_id` |
| Откуда запущена | `entrypoint` (`claude-desktop`, `sdk-ts`, …) | `source` + `originator` |
| Название | записи `custom-title`/`ai-title` | `session_index.jsonl` `thread_name`, state DB |
| Живая Session | `sessions/<pid>.json` | аналога нет; есть `thread-writer-locks/<id>.lock` |
| Конец хода | явной записи в `parse.ts` нет | `task_complete` / `turn_aborted` |
| Формат описан | нет | нет; описан только app-server v2 |

**Чего не знаем.**
- Какой `originator` ставит закрытое приложение Codex (desktop): `codex_work_desktop` есть в `R:models-manager/src/originator.rs`, но связь не подтверждена.
- Когда сжатие и paginated включатся по умолчанию.
- Берёт ли TUI writer lock. Без этого признак «Session жива» не проверен; пробовать занять lock нельзя, это вмешательство.
- Набор имён shell-инструмента по моделям (`exec_command` или `shell_command`, `apply_patch` как custom tool).
- Пишет ли Codex текст reasoning открытым при подписке ChatGPT, или только summary.
- Пути и поведение на Windows: кроме `$CODEX_HOME` не проверено.
- Каким окажется настоящий файл на диске. Всё выше выведено из исходников; живые файлы не читались, а `codex` здесь не установлен, его версию не проверить.
