# 33 — MCP worfy по HTTP для Codex

Type: task
Status: open
Blocked by: 16, 20
Source: [spec.md](../spec.md), «Модель» (часть mcp), «Решения владельца» (Q1 — первый выпуск); решение 06 ([06-граница-vendor.md](06-граница-vendor.md), часть mcp); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), «MCP подробнее»)

## Что происходит

- `worfy-canvas` и `worfy-browser` — SDK-серверы в процессе на каждую Session (после Ticket-а 16 — из описаний
  `src/main/vendors/mcp.ts`, SDK-сервер строит `src/main/vendors/claude/mcp.ts`).
- Codex не умеет MCP в процессе; умеет streamable HTTP (`url`, `http_headers`, `bearer_token_env_var`).
- Владелец 2026-11-02 (Q1): tool-ы worfy для Codex — в первом выпуске, до его приёмки.

## Что делаем

1. `src/main/mcp/http-server.ts` — streamable-HTTP MCP endpoint в worfy main: слушает только `127.0.0.1`,
   порт — свободный, выбирается при старте; на каждую Session — свой token, без него — 401; token живёт, пока живёт
   Session. Tool-ы, описания и вызовы — те же описания серверов (`canvas-server.ts`, `browser-server.ts`).
2. `src/main/vendors/codex/mcp.ts` (stub Ticket-а 17 заменяется) — серверы для `config` `thread/start`
   (`mcp_servers.<имя>.url` и заголовок с token-ом); token в файлы не пишется. `src/main/vendors/codex/session.ts`
   (Ticket 20) берёт их при `thread/start` и `thread/resume`.
3. Cards `worfy.ask` доходит до Session Codex по тому же пути, что у Claude (`src/main/cards/ask.ts`).
4. capabilities Codex: `canvasTools` — да; tooltip-ы недоступности Canvas и Browser у Codex уходят.

Глубина review — `high` (новый сетевой endpoint).

## Готово, когда

- [ ] Contract test: endpoint отвечает списком tool-ов Canvas с token-ом Session; без token-а или с чужим — 401;
      адрес — только `127.0.0.1`.
- [ ] Contract test на фейке: `thread/start` несёт серверы worfy; вызов tool-а Canvas через endpoint создаёт Card,
      как у Claude.
- [ ] Contract test: `worfy.ask` Card доходит до Session Codex.
- [ ] Contract test-ы tool-ов Canvas и Browser у Claude проходят без правок ожиданий.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/main/mcp/http-server.ts` (новый)
- `src/main/vendors/codex/mcp.ts` (stub Ticket-а 17), `src/main/vendors/codex/session.ts` — `thread/start`
- `src/main/mcp/canvas-server.ts`, `src/main/mcp/browser-server.ts` — экспорт описаний
- `src/main/vendors/codex/capabilities.ts`
- `test/contract/mcp-http.test.ts` (новый)

Только читать: `src/main/cards/ask.ts`, `src/main/ipc/card-api.ts`.
