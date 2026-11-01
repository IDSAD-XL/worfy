# 23 — Инструмент `autopilot_start`

Type: task
Status: claimed 2026-11-01T01:52Z
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

## Итог

Сделано (ветка `worfy-flight-recorder/23`, ADR-0091 п. 1 и 4; ADR не менялся):

- **Форма и описание** — `src/shared/canvas/tools.ts:85` (`autopilot_start`: `epic` обязателен, `tickets` — 1…100 номеров
  строкой `"05"` или числом, без 0) и `:115` (описание: звать, только когда пользователь словами просит autopilot /
  autonomously / automatically; для названных — `tickets: ["05", "06"]`; пользователь подтверждает в диалоге).
  `autopilotTicketNums` (`:68`) превращает список в номера без повторов.
- **Вызов в сервере `worfy-canvas`** — `src/main/mcp/canvas-server.ts:287`: Layout не трогает, передаёт Project, Epic,
  номера и id Session (тот же SDK id, по которому её знает registry Session-ов) в `CanvasContext.autopilotStart`.
  У app его даёт `appDeps()` (`:465`), `canvasForSession` передаёт дальше (`:496`); без него — отказ
  `NO_AUTOPILOT_MESSAGE`.
- **`src/main/autopilot/chat-confirm.ts`** (новый): `autopilotStarter` (`:147`) по порядку — Session неизвестна или id ещё
  нет → отказ; unattended Session → отказ `UNATTENDED_MESSAGE` (`:153`) без диалога; живой Run → `chatRunningHint`
  (`:155`) без диалога, в Journal ничего; Epic-а или Ticket-а нет → `startRefusal` без диалога; второй вызов, пока
  диалог этого Project-а ждёт → отказ; иначе диалог. «Start Autopilot» → `sharedChatStarts().startFromChat` с
  `by: 'tool'` и `session` (`chat-start.ts` не менялся): Orchestrator этого Project-а в ходе получает «Autopilot starts
  after this turn», Run стартует после idle. «Cancel» — отказ. Unattended проверяется в момент вызова по registry
  (`appAutopilotStarter`, `:181`), а не флагом, записанным при создании canvas-сервера.
- **Диалог** — `confirmAutopilotStart` (`:85`): нативный `showMessageBox` main process-а Machine Project-а, на окне из
  `dialogOwner` (`:111`: окно в фокусе, иначе первое видимое, иначе без окна). Текст называет Project, Epic и
  Ticket-ы; кнопки «Start Autopilot» / «Cancel», по умолчанию — Cancel (Enter ничего не запускает). Через 10 минут
  (`CONFIRM_WAIT_MS`) диалог закрывается через `signal` (AbortController), ответ — «No one confirmed the start of
  Autopilot within 10 minutes. Nothing started.». Экран Linked machine-а — клиент без окна (`src/main/clients.ts`):
  диалога не получает, канала ответить нет.
- `src/main/mcp/agent-instructions.md:48` — раздел «Autopilot»: когда звать, что передавать `tickets`, что делать с
  «Autopilot starts after this turn».
- Feature pages: `docs/features/autopilot.md` (абзац «From a chat, by the agent», модуль `chat-confirm.ts`, test),
  `docs/features/cards.md` (строка таблицы инструментов).

Test-ы: `test/unit/canvas-tools.test.ts` (новый, 8: форма, отказы формы, описание),
`test/contract/autopilot-start-tool.test.ts` (новый, 14: через MCP-сервер, как Claude Code; настоящий
`ChatStarts`, Autopilot — stand-in с journal; диалог — подменённый `showMessageBox`; 10 минут — fake timers),
`test/contract/canvas-tools.test.ts` (список из девяти инструментов; проводка `canvasForSession` → starter). Первым
падал contract test — сервер не знал `autopilot_start`. 10 ручных mutant-ов `chat-confirm.ts` (без проверки
unattended, неизвестной Session, живого Run, timeout, abort, Cancel, второго диалога, окна в фокусе, `by: 'tool'`,
`startRefusal`) — все убиты.

Не проверено:
- Снимки диалога в светлой и тёмной теме (`.scratch/worfy-flight-recorder/evidence/23/`) не сделаны: brief волны —
  «GUI checks: none (22 has them)». Нативный message box следует теме macOS, не теме worfy.
- Живой Claude Code не запускался: держит ли он вызов MCP-инструмента 10 минут без своего timeout-а, не проверено.
- Окно, где открыт именно этот Project, main не знает: диалог идёт на окно в фокусе или первое видимое.
