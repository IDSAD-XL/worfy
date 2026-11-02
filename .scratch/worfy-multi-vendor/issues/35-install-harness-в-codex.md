# 35 — Install Harness в Codex

Type: task
Status: open
Blocked by: 32
Source: [spec.md](../spec.md), «Windows» (Harness на Codex); решение 08 ([08-harness-для-codex.md](08-harness-для-codex.md)); Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), «Как доставить и версионировать»); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Install Harness ставит копию `harness/` как локальный marketplace командами `claude plugin`
  (`src/main/harness/install.ts:6-24`, `:50-60`, папка — `:403`).
- Codex читает plugin-ы формата Claude: `codex plugin marketplace add <папка>`, `upgrade`, `list`; агентов plugin не
  несёт — TOML в `~/.codex/agents/` или `.codex/agents/`.

## Что делаем

1. `src/main/harness/codex-install.ts`: при входе в Codex Install Harness ставит ту же папку и в Codex
   (`codex plugin marketplace add`, при новой версии — `upgrade`); бинарник — закреплённый Codex (Ticket 17).
2. Проверка версии — аналог `claude plugin list` у Codex; расхождение версий показывает тот же статус Harness.
3. `src/main/harness/codex-agents.ts`: из `harness/agents/implementer.md`, `reviewer.md`, `scout.md` — TOML агентов
   Codex (`name`, `description`, `developer_instructions`, `model`, `model_reasoning_effort`); в `.codex/agents/`
   Project-а, если Project это разрешает (настройка Project-а), иначе в `~/.codex/agents/`. Пишет только installer.
4. После установки или обновления installer сообщает, что hook-и нужно подтвердить в Codex (шаг — Ticket 39).
5. Ошибки команды Codex — тот же отчёт, что у установки в Claude Code; повтор на Windows — `retriedOnWindows`
   (`install.ts:164`).

Платформенный: пути установки и повтор на Windows.

## Готово, когда

- [ ] Contract test (stand-in `codex` через env, как test-ы установки Claude): первая установка, обновление, версия;
      TOML агентов совпадают с fixture; запись — только в разрешённую папку.
- [ ] Test-ы установки в Claude Code проходят без правок ожиданий.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы `src/main/harness` — exit 0.

## Где в коде

- `src/main/harness/codex-install.ts`, `src/main/harness/codex-agents.ts` (новые)
- `src/main/harness/install.ts` — `:6-24`, `:164`, `:403`
- `src/main/ipc/harness.ts`
- `test/contract/harness-codex-install.test.ts` (новый)

Только читать: `harness/agents/implementer.md`, `reviewer.md`, `scout.md`, `harness/.claude-plugin/plugin.json`.
