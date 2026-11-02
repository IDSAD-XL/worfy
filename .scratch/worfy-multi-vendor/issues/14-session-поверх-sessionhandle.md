# 14 — Session поверх SessionHandle

Type: task
Status: claimed 2026-11-02T10:12Z
Blocked by: 11, 13
Source: [spec.md](../spec.md), «Модель» (SessionHandle, Нейтральные события), «Риски», п. 4; решение 06 ([06-граница-vendor.md](06-граница-vendor.md), часть session); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), «Последствия»

## Что происходит

- Session (`src/main/agent/session.ts`) сама читает сообщения SDK: `for await` по query (`:618`), `accountInfo()`
  (`:630`), перевод `sdkMessageToEvents` и `isCompactBoundary` (`:677-678`), slash-команды (`:449`), `canUseTool`
  (`:154-178`, `:516`).
- Ввод — `AsyncIterable<SDKUserMessage>` (`src/main/agent/session/run.ts:2`, `session.ts:56`,
  `src/main/agent/attachments.ts:25`).
- Запрос подтверждения — `permission_request` с постоянными вариантами `allow` / `always_allow` / `deny`
  (`src/shared/agent/events.ts:54`, `:91-103`); ответ готовит `src/main/agent/permissions.ts`.

## Что делаем

1. `src/main/vendors/session.ts` (типы созданы Ticket-ом 13) — `SessionHandle`: `send({text, attachments})`, `interrupt()`, `close()`,
   `setModel()`, `setEffort()`, `setPermissionPreset()`, `events: AsyncIterable<AgentEvent>`; `start(opts)` и
   `resume(id)` у части session driver-а. Модель Vendor-а по умолчанию — `setModel(null)` (нейтральное имя,
   `src/main/vendors/session.ts`); driver Claude переводит свою строку `'default'` в `null` и обратно. Решено
   Orchestrator-ом 2026-11-02 по поручению владельца, подтвердить при приёмке.
2. `src/main/vendors/claude/session.ts` (обёртка Ticket-а 13; `claude/index.ts` не правится) — SessionHandle Claude: держит поток `SDKUserMessage`, зовёт `query()`,
   переводит сообщения в `AgentEvent`, отдаёт `account`, `context`, `commands` событиями, переводит `canUseTool` в
   `permission_request`. Разбор сообщений SDK (`sdkMessageToEvents` и схемы, `events.ts:290-685`) переезжает в
   `src/shared/vendors/claude/events.ts`: чистый модуль без импорта SDK; в shared — потому что разбор транскриптов
   Claude (`src/shared/transcript/parse.ts:23`) зовёт его helper-ы (`toolResultText`, `hookSaidSomething`,
   `LOCAL_COMMAND`). В `events.ts` остаётся только модель.
3. `permission_request` получает `options: {id, label, kind}[]` и `subject`; у Claude — те же три варианта и
   `toolName`. `permission_resolved` несёт id выбранного варианта. Канал ответа `agent.permission` принимает id
   варианта вместо `permissionDecisionSchema` (`src/shared/ipc/agent.ts:108-114`); обработчик —
   `src/main/ipc/agent.ts:313`. Renderer (`PermissionCard.tsx`) рисует варианты из события — те же три кнопки.
4. Session, `session/run.ts`, `input-queue.ts` работают только с SessionHandle и `AgentEvent`; импортов SDK в них
   нет.
5. Фейк Claude остаётся на уровне `QueryHandle` под SessionHandle Claude: все сценарии `test/fixtures/agent-scripts/`
   идут как раньше.

Глубина review — `high` (граница; «Риски», п. 4).

## Готово, когда

- [ ] Contract и e2e test-ы Session на `WORFY_AGENT=fake` проходят без правок ожиданий; `test/contract/sdk-compat.test.ts`
      зелёный.
- [ ] Unit test перевода: записанные сообщения SDK (`test/fixtures/sdk-messages/`) дают те же события, что до переноса.
- [ ] Unit test: `permission_request` Claude несёт три варианта; ответ каждым из них даёт тот же ответ `canUseTool`,
      что раньше.
- [ ] В `src/main/agent/session.ts`, `session/run.ts`, `session/types.ts`, `attachments.ts` нет импорта SDK.
- [ ] `pnpm typecheck`, `pnpm lint`, все unit и contract test-ы модуля `src/main/agent` и e2e Session — exit 0.

## Где в коде

- `src/main/vendors/session.ts`, `src/main/vendors/claude/session.ts`, `src/shared/vendors/claude/events.ts`
- `src/shared/transcript/parse.ts` — `:23` (import helper-ов)
- `src/main/agent/session.ts` — `:56`, `:154-178`, `:239`, `:449`, `:516`, `:618-680`
- `src/main/agent/session/run.ts` — `:2`; `src/main/agent/session/types.ts` — `:39-91`;
  `src/main/agent/session/registry.ts`; `src/main/agent/session/input-queue.ts`
- `src/main/agent/permissions.ts` — `:57` и ответы
- `src/shared/ipc/agent.ts` — `:108-114`; `src/main/ipc/agent.ts` — `:313`
- `src/main/agent/attachments.ts` — `:25`
- `src/shared/agent/events.ts` — `:54`, `:91-103`, `:290-685`
- `src/renderer/session/PermissionCard.tsx`
- Test-ы: `test/contract/agent-session.test.ts`, `test/contract/agent-events.test.ts`,
  `test/contract/permissions.test.ts`, `test/unit/permission-card.test.tsx`, `test/contract/sdk-compat.test.ts`
