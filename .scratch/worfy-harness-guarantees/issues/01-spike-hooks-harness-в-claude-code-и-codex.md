# 01: Spike: hooks Harness в Claude Code и Codex

Type: spike
Status: open
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
