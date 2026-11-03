# 34 — Subagent-ы Codex на Canvas

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Цель и что видит пользователь» (второй выпуск); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); Ticket 05 ([05-codex-транскрипты.md](05-codex-транскрипты.md), «Sub-агенты»); ADR-0030, ADR-0031, ADR-0085 (Subagent-ы на Canvas)

## Что происходит

- Дерево Subagent-ов Claude строится из файлов `<session>/subagents/` (`src/main/claude-home/subagents.ts`,
  `src/shared/transcript/subagents.ts:660` `buildSubagentTree`); renderer — `src/renderer/claude-home/subagents.ts`.
- У Codex каждый sub-агент — свой thread с `parent_thread_id` и общим `session_id`; в родителе — вызовы
  `spawn_agent` и item-ы `collabAgentToolCall` / `subAgentActivity`.

## Что делаем

1. `src/main/vendors/codex/subagents.ts`: дерево thread-ов Session Codex по `parent_thread_id` (`thread/list`), имя
   и роль (`agent_nickname`, `agent_role`), статус из notification-ов родителя (идёт, готов, ошибка, прерван) →
   `SubagentInfo` (`src/shared/transcript/subagents.ts:133`).
2. Дети вида `review`, `compact`, `memory_consolidation`, `guardian` на Canvas не показываются.
3. capabilities Codex: `subagents` — да.
4. Снимки в обеих темах — `.scratch/worfy-multi-vendor/evidence/34/`.

## Готово, когда

- [ ] Contract test (фейк): Session Codex с двумя sub-агентами — два Node-а Subagent-а со статусами; служебные дети
      скрыты.
- [ ] Test-ы Subagent-ов Claude проходят без правок ожиданий.
- [ ] Снимки обеих тем в `evidence/34/`.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы Subagent-ов — exit 0.

## Где в коде

- `src/main/vendors/codex/subagents.ts` (новый)
- `src/renderer/claude-home/subagents.ts`
- `test/contract/codex-subagents.test.ts` (новый)

Только читать: `src/shared/transcript/subagents.ts:133`, `:660`; `src/main/claude-home/subagents.ts`.
