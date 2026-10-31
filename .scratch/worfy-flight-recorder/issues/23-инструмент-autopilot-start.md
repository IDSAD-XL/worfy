# 23 — Инструмент `autopilot_start`

Type: task
Status: open
Blocked by: 21
Source: [spec.md](../spec.md), «Запуск Autopilot из чата» (вступление — просьба словами, «Инструмент `autopilot_start(epic, tickets?)`», «Отказ, пока Run идёт»), «Ticket-ы» (23), «Решения владельца при приёмке», п. 2 (где подтверждать, 10 минут, «No one confirmed», не из окна Linked machine-а) и п. 4 (необязательный `tickets`), «Готово, когда» (пункт про запуск из чата); решение 09, Q1, Q2, Q5, Q6 ([09-что-значит-autopilot-из-чата.md](09-что-значит-autopilot-из-чата.md)); [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md)

## Что происходит

- Сервер `worfy-canvas`: форма и описание инструментов — `src/shared/canvas/tools.ts`, вызов —
  `src/main/mcp/canvas-server.ts`, когда звать — `src/main/mcp/agent-instructions.md`. Инструмента запуска Autopilot
  нет: просьба «запусти на автопилоте», «работай автономно», «работай автоматически» агент выполняет сам, без Run.
- Card спрашивает подтверждение `session.ask` нативным диалогом на окне, которое спросило (`confirmCardMessage`,
  `src/main/ipc/card-api.ts:51`; ADR-0053). У вызова инструмента своего экрана нет.
- После Ticket-а 21 есть `startFromChat` (`src/main/autopilot/chat-start.ts`): проверка Epic-а и Ticket-ов, отказ
  при живом Run, старт после конца хода Orchestrator-а с ответом «Autopilot starts after this turn».
- Session без человека (Autopilot) уже отличается в MCP-серверах (`unattended` у `src/main/mcp/browser-server.ts:87`).

## Что делаем

1. **Инструмент `autopilot_start(epic, tickets?)`** в `tools.ts`: `epic` обязателен, `tickets` — необязательный
   список номеров (приёмка, Q4). Описание и `agent-instructions.md`: звать, когда пользователь словами просит
   запустить Epic или Ticket-ы на автопилоте; «прогони 05 и 06 на автопилоте» — с `tickets`.
2. **Подтверждение** (`src/main/autopilot/chat-confirm.ts`), как `session.ask` у Card: диалог называет Epic,
   Project и названные Ticket-ы, если есть; кнопки «Start Autopilot» / «Cancel». Диалог — в окне worfy на Machine
   Project-а (приёмка, Q2); ждёт до 10 минут; без ответа — отказ «No one confirmed». Из окна Linked machine-а
   подтвердить нельзя. «Cancel» — отказ.
3. **После «Start Autopilot»** — `startFromChat` (кто начал — `tool`): ровно то же, что кнопка. Позвал Orchestrator
   этого Project-а — Run стартует после конца его хода, ответ «Autopilot starts after this turn».
4. **Unattended Session** получает отказ без диалога. **Живой Run** — отказ «Autopilot is already running Epic X.
   Stop it first.» без диалога; в Journal ничего.

## Готово, когда

- [ ] Unit test формы: `autopilot_start` с `epic` и без `tickets` и с `tickets: ["05", "06"]` проходит; без `epic` —
      ошибка формы; описание называет, когда звать.
- [ ] Contract test (`WORFY_AGENT=fake`, диалог — подменённый `showMessageBox`): «Start Autopilot» — `startFromChat`
      с Epic-ом, Ticket-ами и `tool`; текст диалога называет Epic, Project и Ticket-ы; «Cancel» — отказ, Run нет.
- [ ] Contract test (подменённые часы): нет ответа 10 минут — отказ «No one confirmed», Run нет.
- [ ] Contract test: диалог открывается на окне Machine Project-а; окно Linked machine-а диалога не получает и
      подтвердить не может.
- [ ] Contract test: вызов из unattended Session — отказ без диалога; при живом Run — отказ с подсказкой без
      диалога, Journal без новой строки.
- [ ] Contract test: вызов из хода Orchestrator-а этого Project-а — ответ «Autopilot starts after this turn», Run
      стартует после idle.
- [ ] `agent-instructions.md` говорит, когда звать `autopilot_start` и что передавать `tickets`.
- [ ] Снимки диалога подтверждения в светлой и тёмной теме в `.scratch/worfy-flight-recorder/evidence/23/`: с
      Ticket-ами и без.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/canvas-tools.test.ts` (новый): форма и описание `autopilot_start`.
- Contract `test/contract/canvas-tools.test.ts`: инструмент в списке сервера `worfy-canvas`.
- Contract `test/contract/autopilot-start-tool.test.ts` (новый): подтверждение, ожидание, отказы, старт после хода.
- Сначала падающий: contract test — сервер `worfy-canvas` не знает `autopilot_start`.
- Прогнать `test/contract/canvas-tools.test.ts`, `test/contract/card-api.test.ts`, `test/unit/autopilot-*.test.ts`,
  `test/contract/autopilot*.test.ts`.

## Где в коде

- `src/shared/canvas/tools.ts`
- `src/main/mcp/canvas-server.ts`
- `src/main/mcp/agent-instructions.md`
- `src/main/autopilot/chat-confirm.ts` (новый)
- `test/unit/canvas-tools.test.ts` (новый)
- `test/contract/canvas-tools.test.ts`
- `test/contract/autopilot-start-tool.test.ts` (новый)

Только читать: `src/main/autopilot/chat-start.ts` (зовётся, не правится), `src/main/ipc/card-api.ts`
(`confirmCardMessage`), `src/main/mcp/browser-server.ts` (`unattended`), `docs/adr/0053-several-screens-on-one-project.md`.
