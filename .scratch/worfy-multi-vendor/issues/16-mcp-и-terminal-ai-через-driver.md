# 16 — MCP-серверы и Terminal AI через driver Claude; contract test строгий

Type: task
Status: open
Blocked by: 12, 14, 15
Source: [spec.md](../spec.md), «Модель» (части mcp и oneShot), «Решено без владельца», п. 2, «Готово, когда»; решение 06 ([06-граница-vendor.md](06-граница-vendor.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- MCP-серверы `worfy-canvas` и `worfy-browser` строит SDK (`createSdkMcpServer`, `tool`):
  `src/main/mcp/canvas-server.ts:317-324`, `src/main/mcp/browser-server.ts:425-432`.
- Terminal AI грузит SDK сам (`src/main/terminal-ai/assist.ts:34`, `:70-105`), опции —
  `src/main/terminal-ai/options.ts:15`, фейк — `fake-backend.ts:21`.
- После Ticket-ов 13–15 других импортов SDK вне `src/main/vendors/claude/` не остаётся.

## Что делаем

1. `src/main/vendors/mcp.ts` — описание сервера worfy в типах worfy: имя, tool-ы (имя, описание, zod-форма,
   вызов). `canvas-server.ts` и `browser-server.ts` отдают такое описание; SDK-сервер из него строит
   `src/main/vendors/claude/mcp.ts`. Tool-ы, описания и вызовы не меняются.
2. Terminal AI: загрузка SDK, `claim` запасного процесса и опции переезжают в
   `src/main/vendors/claude/terminal-ai.ts`; `assist.ts` зовёт driver Claude. Terminal AI остаётся только на Claude
   (решение 07, «позже»).
3. Список исключений `test/contract/vendor-sdk-imports.test.ts` пуст; исключение, которое уже не импортирует SDK,
   теперь — красный test.

Глубина review — `high` (граница). Платформенный: `src/main/terminal-ai/**`.

## Готово, когда

- [ ] Contract test-ы tool-ов Canvas и Browser и test-ы Terminal AI проходят без правок ожиданий.
- [ ] `test/contract/vendor-sdk-imports.test.ts` строгий и зелёный; SDK импортирует только `src/main/vendors/claude/`.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, unit и contract test-ы модулей `src/main/mcp` и `src/main/terminal-ai` — exit 0.

## Где в коде

- `src/main/vendors/mcp.ts`, `src/main/vendors/claude/mcp.ts`, `src/main/vendors/claude/terminal-ai.ts`
- `src/main/mcp/canvas-server.ts` — `:317-324`; `src/main/mcp/browser-server.ts` — `:425-432`
- `src/main/terminal-ai/assist.ts` — `:34`, `:70-105`, `:464-473`
- `src/main/terminal-ai/options.ts` — `:15`, `:66-113`; `src/main/terminal-ai/fake-backend.ts` — `:21`
- `test/contract/vendor-sdk-imports.test.ts`
- Test-ы: `test/contract/canvas-tools.test.ts`, `test/contract/terminal-ai-assist.test.ts`
