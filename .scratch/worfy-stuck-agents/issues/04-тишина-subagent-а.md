# 04 — Тишина Subagent-а: `quiet N min` на Subagent Node и в rail-е

Type: task
Status: claimed 2026-11-17T07:57Z
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», 4; «Решения по реализации» → «Признаки жизни Session и тишина», пункт
«Subagent Node»; «Истории пользователя», 7; «Решено без владельца», 1 и 9

Кто: агент.

Не платформенный Ticket (renderer и чтение файлов Claude home). Глубина ревью — `medium`.

## Что происходит

- Subagent без записи о конце остаётся `running`, сколько бы его файл ни стоял (`docs/features/sessions.md:423`).
- Subagent Node (`src/renderer/canvas/nodes/SubagentNode.tsx`) показывает тип, модель (`:77`), статус и время работы;
  rail (`src/renderer/session/rail/SubagentsRail.tsx`) тикает время только у `running` (`:225`).
- Файлы Subagent-а Claude Code — `<sessionId>/subagents/agent-<agentId>.jsonl`, их читает
  `src/main/claude-home/subagents.ts` (дерево строит `src/shared/transcript/subagents.ts`). Время изменения файла сейчас
  в данные не попадает.
- Subagent-ы Codex приходят из threads Codex без файла (`sessions.md:397–398`) — для них пометки нет (spec, «Вне
  Epic-а»).

## Что делаем

1. Чтение Subagent-ов Claude Code отдаёт для `running` Subagent-а время последнего изменения его файла (`mtime`) или
   последней прочитанной строки — что позже.
2. Чистая функция в `src/shared/transcript/subagents.ts` (или рядом): тишина Subagent-а — `now − lastChange`, если он
   `running` и тишина не меньше порога пометки — тот же `QUIET_MARK_MS` (10 минут) из `src/shared/agent/quiet.ts`,
   который завёл Ticket 03.
3. Subagent Node: строка статуса `running 52 min · quiet 21 min`. Rail: та же пометка рядом со временем.
4. У Subagent-а Codex пометки нет.
5. `docs/features/sessions.md` (раздел о Subagent-ах, строка 423): `running` с пометкой `quiet N min`, откуда она
   берётся и что у Codex её нет.

## Готово, когда

- [ ] Unit test: `running` Subagent, файл не менялся 21 минуту — тишина 21 минута; 9 минут — пометки нет; `done` —
      пометки нет.
  - evidence: test-run pass · `pnpm test test/unit/subagents.test.ts` exit 0 · mac - · b7e0e6d5f
- [ ] Component test `test/unit/subagent-nodes.test.tsx`: Node молчащего Subagent-а показывает `running 52 min · quiet
      21 min`; Node Subagent-а Codex — без `quiet`.
  - evidence: test-run pass · `pnpm test test/unit/subagent-nodes.test.tsx` exit 0 · mac - · b7e0e6d5f
  - evidence: test-run pass · `pnpm test test/unit/subagent-nodes.test.tsx` exit 0 (round 2: the mark in its own element on the last line) · mac - · 8f96f51704a8a368f1b6c1232ef9dd82748bfa8b
- [ ] Component test rail-а: та же пометка у молчащего Subagent-а.
  - evidence: test-run pass · `pnpm test test/unit/subagent-nodes.test.tsx` exit 0 (SubagentsList, a quiet Subagent) · mac - · b7e0e6d5f
  - evidence: test-run pass · `pnpm test test/unit/subagent-nodes.test.tsx` exit 0 (round 2: the mark on its own line under the name) · mac - · 8f96f51704a8a368f1b6c1232ef9dd82748bfa8b
- [ ] Unit test `test/unit/subagents.test.ts`: чтение отдаёт время последнего изменения файла и ничего не пишет в
      Claude home (ADR-0005).
  - evidence: test-run pass · `pnpm test test/unit/subagents.test.ts` exit 0 (SubagentReader, snapshot of the Claude home) · mac - · b7e0e6d5f
- [ ] `docs/features/sessions.md` описывает пометку `quiet N min` у Subagent-а и что у Codex её нет.
  - evidence: commit pass · Subagent Node and rail mark a quiet Subagent: quiet N min (worfy-stuck-agents 04) · - - · b7e0e6d5f
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- `test/unit/subagents.test.ts`, `test/unit/subagent-trees.test.tsx`, `test/unit/subagent-nodes.test.tsx`, component test
  rail-а (есть — дополнить, нет — новый `test/unit/subagents-rail-quiet.test.tsx`) — пункты выше, каждый test сначала
  красный.

## Где в коде

- `src/main/claude-home/subagents.ts`
- `src/shared/transcript/subagents.ts`
- `src/renderer/canvas/nodes/SubagentNode.tsx`
- `src/renderer/session/rail/SubagentsRail.tsx`
- `docs/features/sessions.md`
- `test/unit/subagents.test.ts`
- `test/unit/subagent-trees.test.tsx`
- `test/unit/subagent-nodes.test.tsx`

Только читать: `src/shared/agent/quiet.ts` (Ticket 03).

## Вне скоупа

- Тишина хода Session (chip, hint line) — Ticket 06.
- Тишина Subagent-а Codex.
