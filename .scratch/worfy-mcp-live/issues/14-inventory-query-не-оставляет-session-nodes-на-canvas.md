# 14 — Inventory-query не оставляет Session Nodes на Canvas

Type: bug
Status: open
Blocked by: 12
Source: аудит смёрженных PR 2026-11-13, находка 29 (high), `.scratch/audit-pr-rereview-2026-11-13/spec.md`; передана
Orchestrator-у 2026-11-13

Кто: агент.

## Что происходит

Служебный запрос, который читает список MCP-серверов (inventory-query, `src/main/vendors/claude/query.ts:424`,
PR #1822), запускается в папке Project и регистрируется в `~/.claude/sessions` как обычная Session. Каждый такой
запрос оставляет на Canvas read-only Session Node.

## Что делаем

1. Inventory-query запускается вне папки Project, как запросы Limits и narrator (найти, как они это делают, и
   повторить тот же путь), так что в `~/.claude/sessions` Project-а он не попадает.
2. Список серверов, который он возвращает, остаётся тем же: настройки Project-а (`.mcp.json`, settings Project-а)
   должны по-прежнему читаться — проверить, не теряются ли они при запуске вне папки; если теряются, передать их явно.
3. Уже накопленные Node-ы этим Ticket-ом не чистим; если нужна чистка — сказать в отчёте.

## Готово, когда

- [ ] Test, красный на нынешнем коде: inventory-query не запускается с cwd папки Project / не пишет запись Session
      Project-а (temp HOME).
- [ ] Contract test: список серверов Project-а (из `.mcp.json` Project-а) по-прежнему приходит в инвентарь.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Где в коде

- `src/main/vendors/claude/query.ts:424`, `src/main/vendors/claude/mcp-inventory.ts`.
- Запросы Limits и narrator: `src/main/vendors/claude/limits.ts`, `src/main/agent/narrator.ts`.
- При landing добавить 14 в `Blocked by` у `08-приёмка-владельцем.md`.
