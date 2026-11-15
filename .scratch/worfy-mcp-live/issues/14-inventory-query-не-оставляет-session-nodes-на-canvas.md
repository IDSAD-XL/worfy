# 14 — Inventory-query не оставляет Session Nodes на Canvas

Type: bug
Status: done 2026-11-15T02:54Z
PR: #1877
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
  - evidence: test-run pass · `pnpm test -- test/contract/claude-mcp-inventory.test.ts` exit 0; 3 tests red on fa396326f · mac - · 47dfc19806c07ae0e1790a56f6af3c543766d23e
- [ ] Contract test: список серверов Project-а (из `.mcp.json` Project-а) по-прежнему приходит в инвентарь.
  - evidence: test-run pass · `pnpm test -- test/contract/claude-mcp-inventory.test.ts test/unit/claude-project-mcp.test.ts` exit 0 · mac - · 47dfc19806c07ae0e1790a56f6af3c543766d23e
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.
  - evidence: ci-check pass · CI green on PR #1877 (ci-ok); local gate fast red only from file-watcher tests in untouched files (fseventsd load), re-run alone; owner rule 2026-11-13 Q1 · mac - · 5f8fb8a283e301749a63d1e85312d654ed08ae28

## Где в коде

- `src/main/vendors/claude/query.ts:424`, `src/main/vendors/claude/mcp-inventory.ts`.
- Запросы Limits и narrator: `src/main/vendors/claude/limits.ts`, `src/main/agent/narrator.ts`.
- При landing добавить 14 в `Blocked by` у `08-приёмка-владельцем.md`.
