# 20 — SessionHandle Codex

Type: task
Status: open
Blocked by: 14, 19
Source: [spec.md](../spec.md), «Модель» (SessionHandle, Нейтральные события — соответствие Codex), «Цель», п. 3–5; решение 06 ([06-граница-vendor.md](06-граница-vendor.md), часть session); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); Ticket 02 ([02-codex-управление-сессией.md](02-codex-управление-сессией.md), таблица механизмов)

## Что делаем

1. `src/main/vendors/codex/session.ts` — SessionHandle Codex: `start` — `thread/start {cwd}`, `resume` —
   `thread/resume {threadId}`; `send` — `turn/start`, а во время хода — `turn/steer {expectedTurnId}`;
   `interrupt` — `turn/interrupt`; `setModel`, `setEffort`, `setPermissionPreset` — значения следующего
   `turn/start` (stable-поверхность; смена посреди хода — нет); `close` — конец процесса. Очередь сообщений —
   worfy (`src/main/agent/queue.ts`), не `thread/queue/*`.
2. Presets → approval policy + sandbox: «Read only» — `read-only` + `on-request`; «Auto» — `workspace-write` +
   `on-request`; «Full access» — `danger-full-access` + `never`.
3. `src/main/vendors/codex/items.ts` — item-ы и notification-ы → `AgentEvent`: `item/agentMessage/delta` → `delta`;
   `agentMessage` → `text`; `reasoning` (summary) → `thinking`; `commandExecution`, `fileChange`, `mcpToolCall` →
   `tool_use` и `tool_result`; `turn/completed` → `result` (`interrupted` и `failed` — с текстом);
   `error` → `result` с ошибкой; `thread/tokenUsage/updated` → `context`; незнакомое — `unknown`.
4. `src/main/vendors/codex/approvals.ts` — `item/commandExecution/requestApproval` и
   `item/fileChange/requestApproval` → `permission_request` с `subject` (команда или файлы) и вариантами `accept`,
   `acceptForSession`, `decline`, `cancel`; Interrupt и закрытие отвечают `cancel`.
5. Изменения — только в `session.ts`, `items.ts`, `approvals.ts`; `index.ts` driver-а Codex не правится.
6. Модель и effort: список — `model/list` (`supportedReasoningEfforts`, `defaultReasoningEffort`), отдаётся
   capabilities по версии.

Глубина review — `high` (driver Codex).

## Готово, когда

- [ ] Unit test перевода item-ов: каждый вид из п. 3 на записях сценариев фейка даёт ожидаемые события.
- [ ] Contract test на фейке: ход, steer во время хода, interrupt, resume, смена Model, effort и preset со
      следующего хода (видно в логе request-ов).
- [ ] Contract test approval-а: команда и правка файлов → `permission_request` с четырьмя вариантами; ответ уходит
      в фейк; Interrupt отвечает `cancel`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/main/vendors/codex/items.ts`, `approvals.ts` (новые)
- `src/main/vendors/codex/session.ts` — stub Ticket-а 17 заменяется; `index.ts` не правится
- `test/unit/codex-items.test.ts`, `test/contract/codex-session.test.ts` (новые)

Только читать: `src/main/vendors/session.ts` и `src/main/vendors/claude/session.ts` (Ticket 14),
`src/shared/agent/events.ts:67-274`, `src/main/agent/queue.ts`.
