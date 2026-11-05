# 03 — Очередь Epic-ов в одном Run-е

Type: grilling
Status: open
Blocked by: 01
Source: [map.md](../map.md); Ticket 01, Q3

## Question

Run идёт по списку Epic-ов по порядку. Как устроена очередь?

- Как задаётся: список при запуске (кнопка Canvas, команда чата, MCP tool `autopilot_start` — сейчас `{epic, tickets?}`, `src/shared/canvas/tools.ts:87-88`), «все принятые Epic-и с готовыми Ticket-ами» — какой порядок (план, приоритет в HANDOFF, дата принятия) и что значит «принятый» (строка `Status:` spec-а?).
- Можно ли менять очередь во время Run-а (добавить, убрать, переставить)?
- Когда Run переходит к следующему Epic-у: все Ticket-ы `done`; а если остались только `blocked`, ждущие владельца (приёмка, `Waits: owner`) или Ticket-ы «не в Autopilot» — пропустить с записью в журнал, или остановиться?
- Названные Ticket-ы (`tickets`) — только для одного Epic-а или по Ticket-ам в каждом Epic-е очереди.
- Остановки Run-а (красный CI на main, `tickets-done`, Limits-timeout): одна на весь Run или Run идёт к следующему Epic-у.
- Журнал (`epic` в каждой строке, `journal.ts:415`), Run history (заголовок с одним Epic-ом, фильтр Epic-а, `RunHistoryView.tsx:24,96,111`), `RunningElsewhere` по Epic-у (`run.ts:982`), строка Autopilot на Canvas — что показывают при очереди.
- Слово «Run» в глоссарии («Один запуск Autopilot над одним Epic», `CONTEXT.md:104`) — новое определение.
- Codex Orchestrator и бюджет Wave — меняется ли что-то при очереди.
