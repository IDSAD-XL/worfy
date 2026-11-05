# 15 — Очередь из чата и из `autopilot_start`

Type: task
Status: open
Blocked by: 11, 13, 14
Source: [spec.md](../spec.md), «Как работает» → «Очередь Epic-ов», «Точки входа»; «Решения владельца», 16, 19; «Решено без владельца», 4; [03](03-очередь-epic-ов.md), Q1, Q4

## Что происходит

- MCP tool `autopilot_start` — `{ epic, tickets? }` (`src/shared/canvas/tools.ts:87-90`); описание tool-а для агента —
  `src/main/mcp/canvas-server.ts:13-…` и `src/main/mcp/agent-instructions.md`.
- Команда чата — формы `tickets`, `wave`, `epic`, голое имя Epic-а (`src/shared/autopilot/chat-command.ts:5-13`, тип
  `ChatCommand`, `:23-…`); старт — `ChatStarts.startFromChat` (`src/main/autopilot/chat-start.ts:103`).
- Окно агента (Ticket 11) получает `prompt` с одним Epic-ом (`src/shared/ipc/autopilot-confirm.ts`).

## Что делаем

1. **MCP tool**: `epics: string[]` (1–`MAX_QUEUE_EPICS`) рядом с `epic`; ровно одно из двух; `tickets` — только с одним
   Epic-ом; `epics: ["accepted"]` не вводим — список принятых агент читает сам, если нужно. Описание tool-а и
   `agent-instructions.md` — про очередь и про то, что окно покажет её человеку.
2. **Команда чата**: `/worfy:epic-wave epics A, B, C` (разделители — как у `tickets`) и `/worfy:epic-wave accepted` —
   все принятые (`acceptedEpics`, Ticket 13) по дате. Старт без окна, как сейчас.
3. **`startFromChat`** и `chat-confirm.ts` — список Epic-ов до `Autopilot.start({ epics })`; `prompt` окна — с
   очередью (вид «Queue» окна делает Ticket 16).
4. Отказ, пока Run ждёт или идёт, — как сейчас, с подсказкой про «Add to queue» (spec, «Решено без владельца», 4).

## Готово, когда

- [ ] Unit test команды: `epics A, B`, `accepted`, неверное имя, повтор Epic-а, больше 10 — отказ со словами.
- [ ] Contract test tool-а: `epics` → окно с очередью → старт с `epics`; `epics` + `tickets` — ошибка формы.
- [ ] Contract test `agent.send`: `/worfy:epic-wave epics A, B` стартует Run очереди, сообщение не уходит агенту.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/autopilot-chat-command.test.ts`; contract `test/contract/autopilot-start-tool.test.ts`,
  `test/contract/agent-send-autopilot.test.ts`.
- Сначала падающий: `/worfy:epic-wave epics A, B` — сейчас не команда.

## Где в коде

- `src/shared/canvas/tools.ts`, `src/main/mcp/canvas-server.ts`, `src/main/mcp/agent-instructions.md`
- `src/shared/autopilot/chat-command.ts`
- `src/main/autopilot/chat-start.ts`, `src/main/autopilot/chat-confirm.ts`, `src/shared/ipc/autopilot-confirm.ts`
- `test/unit/autopilot-chat-command.test.ts`, `test/contract/autopilot-start-tool.test.ts`,
  `test/contract/agent-send-autopilot.test.ts`

Только читать: `src/shared/workflow/accepted-epics.ts`, `src/shared/autopilot/epic-queue.ts`.
