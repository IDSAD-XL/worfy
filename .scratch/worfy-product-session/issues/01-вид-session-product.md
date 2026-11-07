# 01 — Вид Session `product`: данные Node-а и `sessions.new`

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 1; «Как работает» → «Вид Session»; «Решено без владельца», п. 1; research [product-session-основа](../../../docs/research/2026-11-07-product-session-основа.md), разделы 1.4, 1.5

Не платформенный Ticket: данные и IPC, без путей ОС и процессов. Глубина ревью — `medium`.

## Что происходит

- Вида Session нет. У Session Node-а в данных только `origin`, `vendor`, `sessionId`
  (`worfySessionNodeDataSchema`, `src/shared/ipc/sessions.ts:24-33`); вид на экране — `sessionNodeViewSchema`
  (`:69`).
- Вход «New session» — канал `sessions.new` с `{ projectId, vendor? }` (`src/shared/ipc/sessions.ts:96`), handler —
  `sessions().open(projectId, vendor)` (`src/main/ipc/sessions.ts:13`). `NodeSessions.open` (`src/main/agent/node-sessions.ts:166`)
  зовёт `create` (`:193`), который пишет данные Node-а `{ origin: 'worfy', vendor }` (`:201`) и запускает Session
  через `launch` (`:375`).
- Orchestrator отличается только флагом `SessionLaunch.orchestrator` (`src/main/agent/session-settings.ts:31-39`);
  другого признака вида у Session нет.

## Что делаем

1. Необязательное поле `kind: z.literal('product').optional()` в `worfySessionNodeDataSchema` и в
   `sessionNodeViewSchema`. Node без поля — обычная Session; Node с неизвестным значением (сборка новее) читается как
   неизвестный вид, и main его не запускает — как неизвестный Vendor (`sessions.ts:27-29`).
2. `sessions.new` принимает `kind?: 'product'`; handler передаёт его в `NodeSessions.open` → `create` → данные Node-а.
3. `SessionLaunch.kind?: 'product'` — вид доходит до `registry.start` и до Vendor-а (настройки Claude — Ticket 02).
   Возобновление Node-а с `kind: 'product'` (`resume`, `start`) сохраняет вид.
4. `sessions.new` с `kind: 'product'` и Vendor-ом не Claude Code — отказ: «Product Session runs on Claude Code only».
   Текст — английский (ADR-0074).
5. Renderer: вид Session в store (`src/renderer/session/node-sessions.ts`) несёт `kind`.

## Готово, когда

- [ ] Test: `sessions.new` с `kind: 'product'` создаёт Node с `data.kind === 'product'`; вид Session несёт `kind`.
- [ ] Test: Node без `kind` создаётся и возобновляется как раньше; данные Node-а старой сборки читаются.
- [ ] Test: `kind: 'product'` + Vendor `codex` — отказ с текстом, Node не создан.
- [ ] Test: Session Node-а с `kind: 'product'` после перезапуска возобновляется с тем же `kind` в `SessionLaunch`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Contract `test/contract/node-sessions.test.ts`, `test/contract/sessions-vendor.test.ts`.
- Сначала падающий: `sessions.new` с `kind` на `main` теряет поле (zod отбрасывает лишний ключ).

## Где в коде

- `src/shared/ipc/sessions.ts`
- `src/main/ipc/sessions.ts`
- `src/main/agent/node-sessions.ts`
- `src/main/agent/session-settings.ts`
- `src/renderer/session/node-sessions.ts`
- `test/contract/node-sessions.test.ts`
- `test/contract/sessions-vendor.test.ts`

Только читать: `src/main/agent/orchestrator.ts:713` (флаг Orchestrator-а), `src/main/vendors/claude/query.ts`
(Ticket 02), `src/renderer/canvas/nodes/SessionNode.tsx` (Ticket 06).
