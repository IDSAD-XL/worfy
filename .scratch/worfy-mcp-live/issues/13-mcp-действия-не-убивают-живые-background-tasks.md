# 13 — MCP-действия не убивают живые background tasks

Type: bug
Status: open
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
- [ ] Test: без живых задач действия перезапускают Session, как раньше.
- [ ] Строка отказа видна в списке MCP; unit test renderer-а.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Где в коде

- `src/main/agent/session.ts` (~:788 `restartFor`, ~:824), как живые background tasks видны Session-у (ADR-0029).
- `src/renderer/session/McpChip.tsx` — только если отказ не показывается существующим путём ошибок.
- При landing добавить 13 в `Blocked by` у `08-приёмка-владельцем.md`.
