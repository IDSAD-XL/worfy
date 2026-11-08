# 04 — MCP server `worfy-mind-map`: tools `mind_map_*` и сигнал сохранения Orchestrator-у

Type: task
Status: done 2026-11-08T07:03Z
PR: #1647
Blocked by: 02, 03
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 5; «Как работает» → «Tools `mind_map_*`»; «Как работает» → «Сохранение `docs/product/`»; «Вопросы владельцу», Q2, Q5 (уточнение владельца 2026-11-07), Q6; research [product-session-основа](../../../docs/research/2026-11-07-product-session-основа.md), разделы 3.1, 3.2

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
- Сообщение, которое ждёт конца хода Session, — `MessageQueue` (`src/main/agent/queue.ts`); у Orchestrator-а очередь
  переживает передачу Session Autopilot-у и обратно (`src/main/agent/orchestrator.ts:18-25`).
- Закрытие Session Node-а — `NodeSessions.close` (`src/main/agent/node-sessions.ts:265`).

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
5. **Сигнал сохранения (Q5, уточнение владельца 2026-11-07).** Product Session git не трогает никогда.
   - Tool `product_save` (агент зовёт его, когда владелец говорит «сохранить», правило — Ticket 10) и закрытие или
     архив Node-а Product Session зовут одну функцию `src/main/product/save-signal.ts`.
   - Она читает `git status --porcelain -- docs/product` в корне Project-а (только чтение). Есть изменения —
     ставит в очередь Orchestrator-а Project-а сообщение: изменённые файлы, тема и просьба сохранить их обычным docs
     PR-ом (ветка, commit, PR, зелёный CI, merge), не трогая другие изменения дерева. Нет изменений — сигнала нет,
     tool отвечает «nothing to save».
   - Два сигнала подряд без новых изменений — одно сообщение в очереди, не два.
   - Silent mode: файлы в `<Workflow folder>/product/<тема>/` вне git — сигнала нет, tool отвечает «Silent mode:
     nothing to save».
6. Позже (Ticket 09) через тот же писатель пойдут положения и свёрнутые ветки с экрана — оставить для этого функцию
   main, не только tool.

## Готово, когда

- [ ] Contract test: каждая операция на fixture-теме меняет `mind-map.json` как ожидается; неверный узел — `isError`,
      файл байт в байт прежний.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/mind-map-tools.test.ts test/contract/product-save-signal.test.ts test/contract/node-sessions.test.ts` exit 0 · mac - · 1aaf4b9ee12f4d1977e7140b09462ccd5a072e38
  - evidence: review pass · PR #1647 · - - · 3bd820b9a6d6eafd57acd406521ece868e826688
- [ ] Test: две `mind_map_add` подряд без ожидания — оба узла в файле.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/mind-map-tools.test.ts test/contract/product-save-signal.test.ts test/contract/node-sessions.test.ts` exit 0 · mac - · 1aaf4b9ee12f4d1977e7140b09462ccd5a072e38
  - evidence: review pass · PR #1647 · - - · 3bd820b9a6d6eafd57acd406521ece868e826688
- [ ] Test: Product Session получает сервер `worfy-mind-map`; обычная Session и Orchestrator — нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/mind-map-tools.test.ts test/contract/product-save-signal.test.ts test/contract/node-sessions.test.ts` exit 0 · mac - · 1aaf4b9ee12f4d1977e7140b09462ccd5a072e38
  - evidence: review pass · PR #1647 · - - · 3bd820b9a6d6eafd57acd406521ece868e826688
- [ ] Contract test сигнала: изменения под `docs/product/` + `product_save` — одно сообщение в очереди Orchestrator-а
      со списком файлов; закрытие Node-а Product Session — то же; без изменений и в Silent mode — сообщения нет;
      ни одна команда git, кроме `status`, не вызывается.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/mind-map-tools.test.ts test/contract/product-save-signal.test.ts test/contract/node-sessions.test.ts` exit 0 · mac - · 1aaf4b9ee12f4d1977e7140b09462ccd5a072e38
  - evidence: review pass · PR #1647 · - - · 3bd820b9a6d6eafd57acd406521ece868e826688
- [ ] Test записи на Windows: файл, открытый на чтение другим процессом, не ломает запись (retry), exit 0.
  - needs: windows
  - evidence: review pass · PR #1647 · - - · 3bd820b9a6d6eafd57acd406521ece868e826688
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux, macOS и Windows job-ы).
  - evidence: gate pass · `gate fast` exit 0 · mac - · 1aaf4b9ee12f4d1977e7140b09462ccd5a072e38
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42454082317/job/128657603235 · ci - · 3bd820b9a6d6eafd57acd406521ece868e826688

## Тесты

- Contract `test/contract/mind-map-tools.test.ts`, `test/contract/product-save-signal.test.ts` (новые).
- Сначала падающий: вызов `mind_map_add` до появления сервера.

## Где в коде

- `src/shared/product/tools.ts` (новый)
- `src/main/mcp/mind-map-server.ts` (новый)
- `src/main/mcp/agent-instructions-mind-map.md` (новый)
- `src/main/product/save-signal.ts` (новый)
- `src/main/agent/node-sessions.ts`
- `src/main/vendors/claude/options.ts`
- `src/main/vendors/claude/query.ts`
- `test/contract/mind-map-tools.test.ts`
- `test/contract/product-save-signal.test.ts`

Только читать: `src/main/agent/queue.ts`, `src/main/agent/orchestrator.ts`, `src/main/mcp/canvas-server.ts`, `src/main/vendors/mcp.ts`, `src/main/vendors/claude/mcp.ts`,
`src/main/harness/install.ts` (`retriedOnWindows`), `docs/adr/0021-mcp-servers-allowlist-in-profile.md`.
