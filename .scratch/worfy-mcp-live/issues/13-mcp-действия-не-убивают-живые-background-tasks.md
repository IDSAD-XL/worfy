# 13 — MCP-действия не убивают живые background tasks

Type: bug
Status: done 2026-11-15T02:54Z
PR: #1876
Blocked by: 12
Source: аудит смёрженных PR 2026-11-13, находка 28 (high), `.scratch/audit-pr-rereview-2026-11-13/spec.md`; передана
Orchestrator-у 2026-11-13

Кто: агент.

## Что происходит

Turn off, Turn on, Restart и Allow в списке MCP-серверов перезапускают process agent-а Session
(`src/main/agent/session.ts:824`, PR #1816). Если agent запустил в фоне долгие команды (background tasks), они
убиваются без отказа и без предупреждения. ADR-0029 запрещает перезапуск Session с живыми background tasks.

## Что делаем

1. Пока у Session есть живые background tasks, эти четыре действия не перезапускают process: main отвечает отказом с
   причиной, renderer показывает её у кнопки (toast или строка ошибки — как у других отказов списка MCP).
2. Когда задачи закончились, действие снова доступно без перезагрузки списка.
3. Session без человека (Autopilot) ведёт себя так же: отказ, а не убийство задач.

## Готово, когда

- [ ] Test, красный на нынешнем коде: Session с живой background task, Restart (и Allow, Turn off, Turn on) — задача
      жива, process не перезапущен, ответ — отказ с причиной.
  - evidence: test-run pass · `pnpm test test/contract/claude-mcp-turn-off.test.ts test/contract/claude-mcp-allow.test.ts` exit 0 · mac - · eda1bb53d2ce48975c1203126397563467c85016
- [ ] Test: без живых задач действия перезапускают Session, как раньше.
  - evidence: test-run pass · `pnpm test test/contract/claude-mcp-turn-off.test.ts test/contract/claude-mcp-allow.test.ts` exit 0 · mac - · eda1bb53d2ce48975c1203126397563467c85016
- [ ] Строка отказа видна в списке MCP; unit test renderer-а.
  - evidence: test-run pass · `pnpm test test/unit/mcp-chip.test.tsx` exit 0 · mac - · eda1bb53d2ce48975c1203126397563467c85016
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.
  - evidence: ci-check pass · CI green on PR #1876 (ci-ok); local gate fast red only from file-watcher tests in untouched files (fseventsd load), re-run alone; owner rule 2026-11-13 Q1 · mac - · 184de8e8fb52195b42f49fa3bab2cca0a0347829

## Где в коде

- `src/main/agent/session.ts` (~:788 `restartFor`, ~:824), как живые background tasks видны Session-у (ADR-0029).
- `src/renderer/session/McpChip.tsx` — только если отказ не показывается существующим путём ошибок.
- При landing добавить 13 в `Blocked by` у `08-приёмка-владельцем.md`.
