# 07 — Codex: Integration-ы через endpoint worfy на `127.0.0.1` ключами `mcp_servers.<имя>`, строки Codex в chip-е

Type: task
Status: open
Blocked by: 06
Source: [spec.md](../spec.md), «Ticket-ы», 7; «Волны», Wave 4; «Решение», 1; «Факты», 4а–4в; «Решения по реализации»
→ Session Codex, Статус; «Решения по test-ам»; «Вопросы владельцу», Q1 и Q8;
[critic](../../../docs/product/critic/worfy-integrations-2026-11-20.md), возражение 1

Кто: агент.

Не платформенный Ticket (`src/main/vendors/codex/`, `src/shared/agent/`; endpoint `127.0.0.1` уже работает на всех
платформах). Глубина ревью — `medium`.

## Что происходит

- Q8 (а): Codex — в этом Epic-е, тем же proxy. worfy уже отдаёт Codex свои серверы через endpoint
  `src/main/mcp/http-server.ts` (`initialize`, `ping`, `tools/list`, `tools/call` — `http-server.ts:20-23`) ключами
  `mcp_servers.<имя>` с `url` и `bearer_token_env_var` Session в `config` `thread/start`
  (`src/main/vendors/codex/mcp.ts:168`, `:286-287`; Факт 4в). Этого хватает tools-only proxy.
- Свой OAuth Codex (`codex mcp login`, ключ «имя + hash адреса», Факт 4б) не используется: вход держит worfy.
- `McpServer` Integration-а и proxy — Ticket 06 (`src/main/integrations/proxy.ts`).
- Возражение 1 critic-а: этот Ticket и Ticket 09 правят один файл `src/shared/agent/mcp-status.ts`, поэтому 09 ждёт 07.
- Серверы пользователя Codex берёт из своего `config.toml`; worfy его не пишет («Не в этом Epic-е»).

## Что делаем

1. `src/main/vendors/codex/mcp.ts`: включённые Integration-ы Project-а идут через endpoint
   `src/main/mcp/http-server.ts` ключами `mcp_servers.<имя>` (имя — из Ticket-а 06) с `url` endpoint-а и
   `bearer_token_env_var` Session; token сервиса Codex не получает.
2. `src/main/mcp/http-server.ts` отдаёт tools Integration-а с фильтром Project-а и меткой в описании — тот же
   `McpServer`, что у Claude.
3. Строки Codex в chip-е «MCP n/m» (`src/shared/agent/mcp-status.ts`): источник `integration` и метка; статус
   `needs-sign-in` виден в строке.
4. Session Codex вне Project-а Integration-ов не получает.

## Готово, когда

- [ ] Contract `test/contract/integrations-codex.test.ts` (новый) на fake app-server-е
      (`test/fixtures/codex-app-server/`): `thread/start` Session Project-а держит `mcp_servers.<имя>` каждой
      включённой Integration-ы с `bearer_token_env_var`; две Integration-ы на одном адресе сервиса — два имени, каждая
      отвечает своими данными через stub `test/fixtures/integrations/`. Красный до правки — в «Итог».
- [ ] Тот же contract: значение token-а сервиса не появляется в аргументах процесса Codex, в `config` `thread/start`, в
      логе main, в Journal и в Flight recorder; фильтр tools режет `tools/list` и `tools/call` endpoint-а.
- [ ] `test/unit/codex-mcp-row.test.ts`: строка Integration с источником `integration` и меткой.
- [ ] Настоящий binary Codex test-ы не запускают (`grep` по новым test-ам: только fake app-server).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/vendors/codex/mcp.ts`, `src/main/mcp/http-server.ts`
- `src/shared/agent/mcp-status.ts`
- `test/contract/integrations-codex.test.ts` (новый), `test/unit/codex-mcp-row.test.ts`

Только читать: `src/main/integrations/proxy.ts` (06), `src/main/vendors/codex/protocol/`, `test/contract/mcp-http.test.ts`,
`test/contract/codex-session-mcp.test.ts`.

## Вне скоупа

- Применение `mcp.allowed` к серверам пользователя в Codex (Q8 worfy-mcp-live) и запись `config.toml` — вне Epic-а.
  Sign in у строки в chip-е — Ticket 09.

## Итог

Пусто до завершения Ticket-а.
