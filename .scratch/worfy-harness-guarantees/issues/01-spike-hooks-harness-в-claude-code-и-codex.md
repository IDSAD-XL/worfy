# 01: Spike: hooks Harness в Claude Code и Codex

Type: spike
Status: claimed 2026-11-28T01:32Z
Branch: worfy-harness-guarantees/01
Blocked by: None — can start immediately
Source: [spec.md](../spec.md), «Ticket-ы», 01; «Решения по реализации» («guard: путь проверки — только по trail-у»,
«guard: защищённые области», «Проверка Harness при старте на Claude Code», «Contract set без модели», «Health: Harness
на версии Claude Code»); «Вопросы владельцу», Q2 (решение (в) зависит от ответа spike-а); «Волны», Wave 1;
[critic 2026-11-28](../../../docs/product/critic/worfy-harness-guarantees-2026-11-28.md), «What the critic cannot know»
(`agent_type` против `agent_id`)

Кто: агент. Глубина ревью — `low`. Кода продукта не вливает: PR несёт факты в «Итог» этого Ticket-а и fixture-ы.

## Что происходит

- Ticket-ы 03, 06, 07, 08 и 09 строят на поведении Claude Code, которого никто не проверял на настоящем binary: какие
  поля приходят в `system/init`, срабатывает ли PreToolUse hook на Edit и Write в `bypassPermissions`, как отличить
  Subagent от главной Session, спрашивает ли `permissionDecision: "ask"` человека в этом режиме.
- worfy читает из `system/init` только session_id, model, permissionMode, apiKeySource, cwd, claude_code_version и
  slash_commands (`sdkInit`, `src/shared/vendors/claude/events.ts:25-33`); поля `plugins` и `plugin_errors` выброшены.
- Matcher PreToolUse Harness — `Bash|apply_patch` (`harness/hooks/hooks.json:187`).
- Critic 2026-11-28: по типу SDK 0.3.289 в `node_modules` `agent_type` есть и у главного потока Session с `--agent`, а
  Subagent отличает `agent_id`. В `package.json:29` закреплён SDK 0.3.322; ответ нужен с binary этой версии.
- Contract test-ы уже гоняют настоящий Claude Code без модели: stand-in Messages API
  (`test/contract/messages-api-stand-in.ts`, `startMessagesApiStandIn`, `claudeEnv` `:157`).

## Что строить

Опыты на Claude Code из SDK 0.3.322 (`package.json:29`) со stand-in Messages API — без модели и без денег. На Codex —
только по записанным fixture-ам hook-ов (`test/fixtures/codex-messages/hooks/`): настоящий Codex binary не запускать.

1. Копия Harness со сломанным `hooks.json` (и отдельно — с отсутствующим скриптом hook-а): что приходит в `plugins` и
   `plugin_errors` `system/init`. Поток записать fixture-ом `test/fixtures/sdk-messages/init-plugin-errors.jsonl`
   (имя — предложение) и строкой в `test/fixtures/sdk-messages/README.md`.
2. Ответ control request `get_hooks_listing` (тип — в `sdk.d.ts` пакета SDK): есть ли в нём hooks PreToolUse и Stop
   plugin-а `worfy` и признак, что hook выключен.
3. Matcher `Edit|Write|MultiEdit|NotebookEdit` в `bypassPermissions`: срабатывает ли hook у главной Session и у
   Subagent-а; какие `agent_type` и `agent_id` приходят в обоих случаях, и в Session с `--agent` тоже.
4. `permissionDecision: "ask"` из PreToolUse hook-а в `bypassPermissions`: спрашивает ли Claude Code человека (через
   `canUseTool` SDK) или пропускает. Этот ответ выбирает ветку Q2 (в) для Ticket-а 06.
5. `engines["claude-code"]` в `plugin.json` выше версии binary: ошибка в `plugin_errors` или plugin молча пропущен.
6. Ведёт ли stand-in ход Subagent-а в `claude -p --output-format stream-json --verbose` (нужен case 6 Ticket-а 08).
7. Какие пути `~/.claude` Claude Code сам пишет инструментами Session (todos, план, память и другие): список
   исключений Ticket-а 06.
8. Codex по fixture-ам: где в PreToolUse `apply_patch` лежат пути (`*** Add File:`, `*** Update File:`,
   `*** Delete File:`, `*** Move to:`) и `agent_type` Subagent-а (`harness/hooks/codex-input.mjs:8-9`, `:23-33`).
9. Ответы — факты с выводом запусков в «Итог» этого Ticket-а, по пункту на вопрос. Скрипт опыта, если нужен, — в
   `scripts/spikes/` (имя — предложение).

## Где в коде

- `.scratch/worfy-harness-guarantees/issues/01-spike-hooks-harness-в-claude-code-и-codex.md` — «Итог»
- `test/fixtures/sdk-messages/` — новый fixture `init-plugin-errors.jsonl` (имя — предложение) и строка в
  `test/fixtures/sdk-messages/README.md`
- `scripts/spikes/` — скрипт опыта, если нужен (новый)
- Только читать: `test/contract/messages-api-stand-in.ts`, `test/contract/harness-plugin.test.ts` (SessionStart на
  настоящем binary, `:103`), `harness/hooks/hooks.json` (`:185-196`), `harness/hooks/codex-input.mjs`,
  `test/fixtures/codex-messages/hooks/PreToolUse.jsonl`, `src/shared/vendors/claude/events.ts` (`:25-33`),
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, `harness/.claude-plugin/plugin.json`

## Test-ы

- Spike кода продукта не меняет. Fixture проходит `test/contract/sdk-compat.test.ts` (сверка `claude_code_version`
  каждого `system/init` с манифестом).
- Без модели и без денег: только stand-in Messages API; настоящий Codex binary не запускается.

## Готово, когда

- [ ] «Итог»: что приходит в `plugins` и `plugin_errors` при сломанном `hooks.json` и при отсутствующем скрипте hook-а;
      fixture `system/init` лежит в `test/fixtures/sdk-messages/`.
- [ ] «Итог»: ответ `get_hooks_listing` — видны ли hooks PreToolUse и Stop plugin-а `worfy` и их выключение.
- [ ] «Итог»: срабатывает ли matcher `Edit|Write|MultiEdit|NotebookEdit` в `bypassPermissions` у главной Session и у
      Subagent-а; какое поле отличает Subagent (`agent_type` или `agent_id`), с выводом обоих случаев.
- [ ] «Итог»: спрашивает ли `permissionDecision: "ask"` человека в `bypassPermissions` — да или нет, с выводом.
- [ ] «Итог»: что делает Claude Code при невыполненном `engines["claude-code"]`; ведёт ли stand-in ход Subagent-а;
      список путей `~/.claude`, которые Claude Code пишет инструментами Session.
- [ ] «Итог»: пути `apply_patch` и `agent_type` в PreToolUse Codex по fixture-ам.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Итог

Снято 2026-11-28 на `@anthropic-ai/claude-agent-sdk` 0.3.322 (`package.json:29`), Claude Code 2.1.322 — нативный
binary из пакета SDK, macOS arm64, обычный Node 24 (без Electron). Модели, ключа и входа нет: все запросы идут в
scripted stand-in Messages API скрипта `scripts/spikes/harness-hooks/probe.ts`, окружение — `claudeEnv` из
`test/contract/messages-api-stand-in.ts` (фиктивный ключ, HOME и `CLAUDE_CONFIG_DIR` во временной папке,
`settingSources: []`). Свой stand-in в скрипте нужен потому, что stand-in contract test-ов пишет один tool_use на
весь прогон, а Write Subagent-а — это два вызова в двух разговорах (Agent у главного потока, Write у Subagent-а);
скрипт пишет цепочку вызовов на разговор, по метке в его первом сообщении. Настоящий Codex не запускался.
Повторить: `node scripts/spikes/harness-hooks/probe.ts [init-errors|listing|edit-hooks|ask|cli|claude-home]`.

1. **`plugins` и `plugin_errors` в `system/init`** (сценарий `init-errors`, копия `harness/` inline-plugin-ом;
   fixture `test/fixtures/sdk-messages/init-plugin-errors.jsonl`, пять строк).
   - Целая копия: `plugins` — `{"name":"worfy","path":"<tmp>/harness-intact","source":"worfy@inline"}`, ключа
     `plugin_errors` нет.
   - `hooks/hooks.json` не JSON: строка в `plugins` остаётся (skills 35 и агенты 4 `worfy:` на месте), появляется
     `plugin_errors: [{"plugin":"harness-broken-hooks-json@inline","type":"hook-load-failed","message":"Hook load
     failed: JSON Parse error: Unexpected EOF"}]`. Поле `plugin` — **имя папки plugin-а** с `@inline`, а не `worfy`
     из манифеста, поля `path` нет. Ни одного hook-а plugin-а нет: PreToolUse Bash в этом прогоне не запускался.
   - Нет скрипта `hooks/guard.mjs` (команда PreToolUse `Bash|apply_patch`): `plugin_errors` нет, `plugins` как у
     целой копии. Ошибка видна только при вызове: `hook_response` `PreToolUse:Bash` с `outcome: "error"`,
     `exit_code: 1`, stderr `Error: Cannot find module '<tmp>/harness-missing-hook-script/hooks/guard.mjs'`, и Bash
     **выполнился** (`tool_result` `"probe"`, `is_error: false`): упавший hook не отказывает.
2. **`get_hooks_listing`** (сценарий `listing`; метод `getHooksListing()` есть в `sdk.mjs` 0.3.322, в `sdk.d.ts` —
   только типы запроса и ответа). На `harness/` строки plugin-а: `{"event":"PreToolUse","matcher":"Bash|apply_patch",
   "source":"pluginHook","pluginName":"worfy@inline","type":"command","command":"node \"${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs\"","timeout":30}`
   и три строки Stop (`hooks/stop.mjs` 900 с, `bin/worktree-lock beat`, `bin/qmd-refresh --quiet`). Здесь
   `pluginName` — имя из манифеста (`worfy@inline`), не имя папки. Выключение: с флагом `settings: {disableAllHooks:
   true}` у каждой строки `"disabled": true` и `policy.allDisabled: true` (без него ключа `disabled` нет,
   `allDisabled: false`). При сломанном `hooks.json` в ответе `events: []`, `hooks: []` — hooks plugin-а пропадают
   из списка целиком.
3. **Matcher `Edit|Write|MultiEdit|NotebookEdit` в `bypassPermissions`** (сценарий `edit-hooks`, свой plugin с
   этим matcher-ом, hook пишет свой вход в файл). Срабатывает везде, файл записан во всех четырёх случаях:
   - главная Session: `{"event":"PreToolUse","tool":"Write","permission_mode":"bypassPermissions"}` и так же `Edit`;
     ни `agent_type`, ни `agent_id`;
   - Subagent (`general-purpose`): `{"event":"PreToolUse","tool":"Write","agent_type":"general-purpose","agent_id":"a4010b9effb32dff6"}`;
   - Session с `agent: "probe-agent"` (как `--agent`), главный поток: `{"tool":"Write","agent_type":"probe-agent"}`
     **без** `agent_id`; Stop этой Session тоже несёт `agent_type: "probe-agent"`;
   - Subagent такой Session: `{"agent_type":"general-purpose","agent_id":"a3022a9582b4a9a89"}`.
   Subagent отличает **`agent_id`**: `agent_type` есть и у главного потока Session с `--agent` (как и пишет
   `sdk.d.ts:185-191`). `MultiEdit` в Claude Code 2.1.322 нет (ни в tools запроса, ни в ответе ToolSearch),
   `NotebookEdit` — отложенный tool (ToolSearch `select:MultiEdit,NotebookEdit` вернул только `NotebookEdit`).
   Tool Subagent-а в 2.1.322 запускается в фоне: `tool_result` Agent — «Async agent launched successfully», Stop
   главного потока приходит раньше PreToolUse Subagent-а.
4. **`permissionDecision: "ask"` в `bypassPermissions` — да, спрашивает** (сценарий `ask`). SDK с
   `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions: true` и `canUseTool`: SDK печатает
   предупреждение `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED … canUseTool will not be invoked`, но после `ask` hook-а
   `canUseTool` вызван: `{"toolName":"Write","decisionReason":"spike ask"}`. Ответ `deny` — файл не записан,
   `tool_result` `"spike: denied by the human"`, `is_error: true`; ответ `allow` — файл записан. Без человека
   (`claude -p … --permission-mode bypassPermissions`, без `--permission-prompt-tool`, сценарий `cli`) `ask` —
   отказ: `tool_result` `"spike ask"` с `is_error: true`, Write в `permission_denials` результата, exit 0.
5. **`engines["claude-code"]` выше версии binary — plugin молча загружен.** `engines: {"claude-code": ">=99.0.0"}`:
   `plugins` с `worfy`, `plugin_errors` нет, PreToolUse Bash работает (`outcome: success`) — так же, как с
   `>=2.1.322`. `claude plugin validate` на таком манифесте: «engines: Unknown field 'engines' (commonly seen in a
   VS Code/Cursor extension manifest). Claude Code ignores unrecognized fields at load time», exit 0. Поля
   `engines` Claude Code 2.1.322 не знает.
6. **Stand-in ведёт ход Subagent-а в `claude -p --output-format stream-json --verbose`** (сценарий `cli`,
   `--permission-mode bypassPermissions --plugin-dir <plugin>`), exit 0: в потоке `assistant (parent
   toolu_agent_cli)` с Write, `user (parent toolu_agent_cli)` с его результатом, `task_started` / `task_progress` /
   `task_notification`; hook-и `SubagentStart` и `PreToolUse` Write с `agent_type: "general-purpose"` и
   `agent_id`; файл записан. Нужна цепочка вызовов на разговор (Agent у главного потока, Write у Subagent-а): с
   одним вызовом stand-in-а contract test-ов Subagent получает только текст. После `task_notification` Claude Code
   сам начинает ещё один ход: второй `system/init` и второй `result/success`.
7. **Пути `~/.claude` (в опыте — `CLAUDE_CONFIG_DIR` временной папки), которые пишет Session** (сценарий
   `claude-home`):
   - Через Write/Edit (их видит PreToolUse `Edit|Write|…`): файл плана — в `permissionMode: "plan"` Claude Code
     велит модели «create your plan at `<config>/plans/<slug>.md` using the Write tool» (slug случайный, например
     `home-probe-joyful-toucan.md`). Память — `system/init` несёт `memory_paths.auto`:
     `<config>/projects/<cwd с '-'>/memory/`; указаний модели про память в этой Session нет (auto memory выключена
     и с `CLAUDE_CODE_DISABLE_AUTO_MEMORY=0`, и со слоем `user`): что модель пишет туда Write-ом, здесь не
     проверено.
   - Сам, своими tool-ами, не через Write/Edit: `TaskCreate` (отложенный, после ToolSearch) пишет
     `<config>/tasks/<session_id>/1.json` и `.lock`. `TodoWrite` в 2.1.322 нет.
   - Сам, не tool-ами Session: транскрипт `<config>/projects/<cwd с '-'>/<session_id>.jsonl`, `.claude.json`,
     `backups/.claude.json.backup.<ms>`, `plugins/store/cc-plugin-agents-md_builtin-<hash>.json`.
   Список исключений для Ticket-а 06 — `plans/` и `projects/*/memory/` (пишет модель Write/Edit); `tasks/`
   matcher `Edit|Write|…` не видит вовсе.
8. **Codex по fixture-ам** (`test/fixtures/codex-messages/hooks/PreToolUse.jsonl`, Codex 0.166.0). Путь лежит в
   тексте patch-а — `tool_input.command` у `tool_name: "apply_patch"`, отдельного поля пути нет: строки 4 и 13 —
   `*** Add File: card.md` и `*** Add File: sub.txt` (относительно `cwd`), строка 6 — `*** Update File:
   /capture/project/notes.txt` (абсолютный). `*** Delete File:` и `*** Move to:` в записанных fixture-ах нет — их
   форма не проверена. `agent_type` и `agent_id` есть только внутри Subagent-а: строки 13 (`apply_patch`) и 14
   (`Bash`) — `"agent_type":"default","agent_id":"01a19fd3-…"`, у главного потока (строки 1–12, 15, 16) обоих
   полей нет; так же в `SubagentStart.jsonl` и `SubagentStop.jsonl`. Записанный Subagent запущен без агента
   Harness, поэтому `agent_type` — `default`; что Codex ставит туда `worfy-implementer`/`worfy-reviewer`, fixture-ы
   не показывают.
