# 02 — Статус MCP-серверов Claude Session: Reconnect и выключение

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», строка 02; «Решения владельца» Q10; «Решения по реализации» (одна форма
строки, seam, событие `mcp`, каналы, приватность); «Решения по test-ам»; «Решено без владельца» 2, 3; истории 3, 5, 6,
12

## Что происходит

- worfy не знает, какие MCP-серверы у Session и работают ли они. Поле `mcp_servers` из `system/init` отбрасывается:
  схема `sdkInit` (`src/shared/vendors/claude/events.ts:24–32`) и событие `init` (`:166–180`).
- В `QueryHandle` (`src/main/agent/session/types.ts:68–85`) нет вызовов MCP; fake query
  (`src/main/agent/fake-query.ts`) их не умеет.
- Образец «спросить query и отдать событием» уже есть: `askContext` (`src/main/vendors/claude/session.ts:498–512`) и
  событие `context` (`src/shared/agent/events.ts:139`).
- После Ticket-а 01 есть fixture-ы ответов `mcpServerStatus`, `reconnectMcpServer` и `toggleMcpServer`
  (`test/fixtures/mcp-live/`).

## Что делаем

1. Схема строки сервера в `src/shared/agent/` (раздел spec-а «Одна форма строки»): статус, tools, ошибка, источник,
   действия. Сведение источников SDK к четырём, незнакомое слово — user config. В схеме уже есть `not-allowed`,
   `allow`, `sign-in` и `restart`; строки с ними дают Ticket-ы 03 и 05.
2. `McpPart` (`src/main/vendors/mcp.ts`) получает необязательные `status` и `act`. Claude реализует их в
   `src/main/vendors/claude/mcp.ts` поверх `mcpServerStatus`, `reconnectMcpServer` и `toggleMcpServer`. `QueryHandle`
   и fake query получают эти вызовы; fake отвечает по fixture-ам `test/fixtures/mcp-live/`.
3. Событие `{ type: 'mcp', servers }`: после `system/init`, после каждого `result`, после действия, по запросу.
   Неудачный запрос — «нет данных», ход не падает.
4. Каналы `agent.mcp` (read) и `agent.mcpAction` (write) в `src/shared/ipc/agent.ts` и их обработчики в main.
   Действия этого Ticket-а — `reconnect`, `turn-off`, `turn-on`; остальные обработчик пока отклоняет понятной ошибкой.
5. Строки статуса не пишутся в Journal, Flight recorder и диагностические выгрузки; `config` ответа SDK дальше driver-а
   не идёт.

## Готово, когда

- [ ] Unit test `test/unit/mcp-status-row.test.ts`: каждый `source` SDK сводится к своему источнику, незнакомый — к
      user config; у failed есть `reconnect`, у connected — `turn-off`, у disabled — `turn-on`. Красный до правки — в
      «Итог».
- [ ] Contract test `test/contract/claude-mcp-status.test.ts` над fake query: событие `mcp` после init и после хода;
      неудачный `mcpServerStatus` — «нет данных», ход идёт; `agent.mcpAction` `reconnect`, `turn-off` и `turn-on`
      зовут нужный вызов query; неизвестное действие отклоняется, Session не меняется.
- [ ] Contract test: строки статуса не попадают в Journal и в диагностическую выгрузку; `config` нет в событии `mcp`.
- [ ] `test/contract/sdk-compat.test.ts` держит форму `mcpServerStatus`, `reconnectMcpServer` и `toggleMcpServer` в SDK
      0.3.322.
- [ ] Все unit и contract test-ы модулей `src/main/vendors/claude/` и `src/main/agent/` зелёные; lint, typecheck и
      gate fast — exit 0.

## Где в коде

- `src/shared/agent/mcp-status.ts` (новый)
- `src/shared/agent/events.ts`
- `src/shared/vendors/claude/events.ts`
- `src/shared/ipc/agent.ts`
- `src/main/vendors/mcp.ts`
- `src/main/vendors/claude/mcp.ts`
- `src/main/vendors/claude/session.ts`
- `src/main/agent/session/types.ts`
- `src/main/agent/fake-query.ts`
- обработчики каналов `agent.*` в `src/main/ipc/` (файл находит implementer)
- `test/unit/mcp-status-row.test.ts` (новый)
- `test/contract/claude-mcp-status.test.ts` (новый)
- `test/contract/sdk-compat.test.ts`

## Вне скоупа

- Подхват нового сервера, Restart с тем же разговором и правило Wave в Autopilot: Ticket 03.
- UI: Ticket 04.
- Строки «не разрешён», query инвентаря, Allow и вход OAuth: Ticket 05.
- Codex: Ticket 06.
