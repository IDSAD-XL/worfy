# 34 — Subagent-ы Codex на Canvas

Type: task
Status: done 2026-11-03T15:29Z
PR: #1299
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

## Итог

- `src/main/vendors/codex/subagents.ts` (новый): в одном коротком процессе app-server — `thread/read {includeTurns: true}`
  thread-а Session, затем `thread/list` источников Subagent-ов (`subAgent*`, новые первыми по `created_at`, страницы до
  первой, где есть thread старше Session, не больше 20). Дерево — по `parentThreadId` (или `parent_thread_id` из
  `source.subAgent.thread_spawn`) до thread-а Session. Имя — `agentNickname`, тип — `agentRole`, описание — первая строка
  `preview`, модель — из `subAgentActivity`. Статус — из item-ов родителя, последний побеждает: `subAgentActivity`
  (started/interacted → running, completed → done, interrupted → interrupted) и `agentsStates` у `collabAgentToolCall`
  (running/pendingInit, completed/shutdown, errored/notFound, interrupted), с ответом из `message`. Thread в `systemError` —
  error. Subagent без конца, когда последний turn Session прерван, — interrupted. Для Subagent-а со своими детьми читается
  и его thread (`thread/read`). Служебные дети — `review`, `compact`, `memory_consolidation`, `guardian` (строкой или
  `{other}`) — не показываются, и всё под ними тоже.
- Канал `claudeHome.subagents` (`src/main/ipc/claude-home.ts`): Session, которой нет в Claude home, но которую назвал
  последний список Codex Session-ов Project-а, получает дерево в новом поле `tree` (`src/shared/ipc/claude-home.ts`,
  `subagentInfoSchema`); `signals` и `files` пустые. Для Session вне обоих списков Codex не запускается. Codex не ответил —
  остаётся последнее дерево, причина один раз в log.
- Renderer (`src/renderer/claude-home/subagents.ts`): дерево из `tree` показывается как есть. Пока в нём идёт Subagent,
  оно спрашивается снова каждые 5 s (`TREE_POLL_MS`; файлы Claude — по-прежнему каждые 2 s). Кроме того, Session с `tree`
  спрашивается снова, когда в истории Project-а изменился её `modifiedAt` (список Codex окно спрашивает каждые 30 s), а
  ненайденная Session — и когда история называет её впервые. Session-ы Claude ведут себя как раньше: их test-ы без правок
  ожиданий.
- capabilities Codex: `subagents: true`, причина в `unsupported` убрана.
- Сценарий фейка `test/fixtures/codex-scripts/subagents.jsonl`: Session с двумя Subagent-ами (Ada done, Bo error), четыре
  служебных ребёнка и Subagent чужой Session. В `test/contract/codex-compat.test.ts` — исключения для формы thread-а
  Subagent-а (`parentThreadId`, `agentNickname`, `agentRole` строкой, `source.subAgent`) и `subAgentActivity` в
  `thread/read`: живая запись этой версии не читала и не перечисляла thread-ы Subagent-ов.
- Test-ы: `test/contract/codex-subagents.test.ts` (фейк: два Node-а со статусами, служебные скрыты, запросы и закрытие
  процесса; дерево: running, interrupted, agent states, вложенность, все виды служебных; канал), новые случаи в
  `test/unit/subagent-trees.test.tsx`, e2e `test/e2e/codex-subagents.spec.ts` (правило в `scripts/e2e-specs.table.json`).
- Снимки обеих тем: [светлая](../evidence/34/34-codex-subagents-light.png), [тёмная](../evidence/34/34-codex-subagents-dark.png).

Решено без владельца, подтвердить:

- Дерево строит main и отдаёт готовым (`tree`), а не через `signals`/`files` Claude: у Codex четыре статуса, и
  `interrupted` в модели файлов Claude значит другое (ADR-0085).
- Служебный ребёнок прячется вместе со всем, что под ним.
- Дерево Codex спрашивается каждые 5 s, пока Subagent идёт: каждый запрос запускает процесс Codex.
- Subagent Codex не открывает транскрипт (`transcript: false`): кнопка Transcript неактивна.

Для Ticket-а 42 (устаревшие строки документации): `docs/features/vendors.md:83` («A Codex Session shows no Subagents on the
Canvas»), `docs/features/vendors.md:112` (список флагов — `subagents` у Codex теперь да), `docs/features/vendors.md:140`
(события Subagent-а не показываются в транскрипте — верно, но Subagent-ы теперь есть на Canvas).

### Долги gate (Wave 12, PR #1299)

- [low] `src/shared/ipc/claude-home.ts:178`: `subagentInfoSchema` ограничивает `name`, `subagentType`, `model` 500 символами, а `codexSubagentTree` передаёт значения Codex без обрезки; слишком длинный nickname уронит проверку всего ответа. Обрезать до 500 в `codexSubagentTree`.
- [low] `src/renderer/canvas/nodes/SubagentNode.tsx:119`: tooltip «No transcript of this Subagent yet» вводит в заблуждение для Subagent-а Codex, у которого транскрипта не будет.
- Для Ticket-а 42: устарели `docs/features/vendors.md:83`, `:112`, `:140`.
