# 04 — MCP server `worfy-mind-map`: tools `mind_map_*`

Type: task
Status: open
Blocked by: 02, 03
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 5; «Как работает» → «Tools `mind_map_*`»; «Вопросы владельцу», Q2; research [product-session-основа](../../../docs/research/2026-11-07-product-session-основа.md), разделы 3.1, 3.2

Платформенный Ticket: handler пишет файл Project-а атомарной заменой, на Windows её может отклонить открытый файл;
Windows verdict до merge (ADR-0056). Глубина ревью — `high`: единственный писатель файла Project-а.

## Что происходит

- `worfy-canvas`: схемы — `src/shared/canvas/tools.ts:99-118`, разбор — `parseToolArgs` (`:127-128`); caller
  повторно разбирает и превращает ошибку в результат `isError` (`src/main/mcp/canvas-server.ts:314-326`); сервер —
  `canvasServer` (`:329-336`).
- Нейтральное описание `McpTool` / `McpServer` — `src/main/vendors/mcp.ts:26-39`; Claude получает его через
  `claudeMcpServer` (`src/main/vendors/claude/mcp.ts:22-28`).
- Отдельный сервер только для части Session-ов уже есть: `worfy-browser` добавляется в allowlist этой Session
  (`withBrowserServer`, `src/main/vendors/claude/query.ts:146`) и в `mcpServers` (`options.ts:577-580`).
- Атомарная запись JSON по схеме — `writeJsonFile` (`src/main/storage/json-file.ts:79`).

## Что делаем

1. `src/shared/product/tools.ts` — схемы и описания `mind_map_read`, `mind_map_add`, `mind_map_update`,
   `mind_map_decide`, `mind_map_remove` (spec, «Tools»). Файл — публичный контракт вместе с инструкциями агента.
2. `src/main/mcp/mind-map-server.ts` — handler-ы: прочитать тему (`topic.ts` Ticket-а 03), применить операцию,
   проверить `checkMindMap`, записать атомарно, ответить JSON-ом узла. Ошибка схемы или проверки — `isError` с текстом,
   файл не меняется. `decide` переносит прежний статус и причину в `history`. `message` узла — id события транскрипта,
   если он дошёл до handler-а (иначе пусто).
3. Очередь записей на файл: две операции подряд не теряют друг друга (одна запись за раз на тему).
4. Подключение: только Product Session (вид из 01, 02) получает сервер `worfy-mind-map` и его инструкции в
   `systemPrompt.append` (`src/main/mcp/agent-instructions-mind-map.md`, английский текст).
5. Позже (Ticket 09) через тот же писатель пойдут положения и свёрнутые ветки с экрана — оставить для этого функцию
   main, не только tool.

## Готово, когда

- [ ] Contract test: каждая операция на fixture-теме меняет `mind-map.json` как ожидается; неверный узел — `isError`,
      файл байт в байт прежний.
- [ ] Test: две `mind_map_add` подряд без ожидания — оба узла в файле.
- [ ] Test: Product Session получает сервер `worfy-mind-map`; обычная Session и Orchestrator — нет.
- [ ] Test записи на Windows: файл, открытый на чтение другим процессом, не ломает запись (retry), exit 0.
  - needs: windows
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux, macOS и Windows job-ы).

## Тесты

- Contract `test/contract/mind-map-tools.test.ts` (новый).
- Сначала падающий: вызов `mind_map_add` до появления сервера.

## Где в коде

- `src/shared/product/tools.ts` (новый)
- `src/main/mcp/mind-map-server.ts` (новый)
- `src/main/mcp/agent-instructions-mind-map.md` (новый)
- `src/main/vendors/claude/options.ts`
- `src/main/vendors/claude/query.ts`
- `test/contract/mind-map-tools.test.ts`

Только читать: `src/main/mcp/canvas-server.ts`, `src/main/vendors/mcp.ts`, `src/main/vendors/claude/mcp.ts`,
`src/main/harness/install.ts` (`retriedOnWindows`), `docs/adr/0021-mcp-servers-allowlist-in-profile.md`.
