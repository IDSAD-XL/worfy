# 44 — Фейк app-server исполняет hook-и по правилам Codex

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Фейк и test-ы», «Гарантии workflow на Codex», «Решения владельца» (Q5 — parity suite на фейке); Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), таблица и «Гарантии Harness без механизма в Codex»); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Фейк app-server (Ticket 18) играет сценарии, но hook-ов plugin-ов не запускает. Гарантии Harness на Codex
  (Ticket 36) держатся hook-ами, поэтому parity suite (Ticket 45) нужен фейк, который исполняет hook-и так, как их
  исполняет Codex.
- Ticket 36 выбирает один из двух путей read-only для reviewer и scout: отказ `PreToolUse` по `agent_type` или
  отдельный thread Codex с sandbox `read-only`. Оба пути должны проверяться на фейке до этого выбора.

## Что делаем

1. `test/fixtures/codex-app-server/hook-runner.mjs`: фейк читает `hooks/hooks.json` установленного plugin-а
   (временный `CODEX_HOME`) и исполняет его по правилам Codex закреплённой версии (источник —
   `codex-rs/hooks` той же версии, ссылки — в шапке файла):
   - события, которые Codex знает: `SessionStart`, `SubagentStart`, `PreToolUse`, `Stop`, `SubagentStop`,
     `SessionEnd`; незнакомые (`TaskCompleted`, `TeammateIdle`) — молча пропускаются;
   - matcher-ы `Bash`, `apply_patch` (алиасы `Edit`, `Write`), MCP tool-ы;
   - `PreToolUse`: `permissionDecision: "deny"` или exit 2 — действие не выполняется;
   - `Stop` / `SubagentStop`: `decision: "block"` или exit 2 — ход продолжается, `reason` — новый prompt;
   - `SessionEnd`: timeout 3 s;
   - вход hook-а — как у Codex: `agent_type`, `agent_id` у Subagent-а, `cwd`, `tool_name`, `tool_input`; форма —
     из записей входа hook-ов Ticket-а 30 (`test/fixtures/codex-messages/hooks/`);
   - доверие: hook-и исполняются, только если hash папки plugin-а подтверждён (файл подтверждения во временном
     `CODEX_HOME`); иначе — пропуск, как у Codex.
2. Sandbox `read-only` thread-а — как у Codex: thread, открытый с `sandbox: "read-only"`, не применяет правку файла
   (`apply_patch`, item `fileChange`) и не выполняет команду, которая пишет на диск; форма отказа — по сгенерированной
   JSON Schema протокола (Ticket 17). Запись команды фейк определяет по списку сценария (команда помечена «пишет»), а не
   разбором shell. Чтение и команды без записи идут как обычно.
3. Шаги сценариев: «агент вызывает tool X как `agent_type` Y», «агент заканчивает ход», «Subagent заканчивает ход»,
   «thread открыт с sandbox S».

Платформенный: запуск hook-команд (`node …`) на Windows.

## Готово, когда

- [ ] Contract test: hook `PreToolUse` с deny — tool не выполнен; `Stop` с block — ход продолжен с `reason`;
      `TaskCompleted` в `hooks.json` — пропущен; без подтверждения hash — hook-и не запускаются.
- [ ] Contract test: в thread-е с sandbox `read-only` правка файла и команда, помеченная «пишет», получают отказ, файл
      не меняется; чтение проходит; в thread-е с `workspace-write` та же правка проходит. Так оба пути read-only
      Ticket-а 36 проверяемы до его выбора.
- [ ] Contract test: поля входа hook-ов фейка (`PreToolUse`, `Stop`, `SubagentStop`) совпадают с полями записей
      Ticket-а 30 в `test/fixtures/codex-messages/hooks/`. Если в записях нет `agent_type` (настоящий Codex перестал
      его присылать) — test красный.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `test/fixtures/codex-app-server/hook-runner.mjs` (новый)
- `test/fixtures/codex-app-server/fake-app-server.mjs` (Ticket 18) — вызов hook-runner-а и sandbox `read-only`
- `test/contract/codex-fake-hooks.test.ts` (новый)

Только читать: `test/fixtures/codex-messages/hooks/` (записи Ticket-а 30).
