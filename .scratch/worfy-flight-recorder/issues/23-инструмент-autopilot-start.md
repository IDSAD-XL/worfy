# 23 — Инструмент `autopilot_start`

Type: task
Status: done 2026-11-01T07:06Z
PR: #1191
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

- **Форма и описание** — `src/shared/canvas/tools.ts:86` (`autopilot_start`: `epic` обязателен, `tickets` — 1…100 номеров
  строкой `"05"` или числом, без 0) и `:116` (описание: звать, только когда пользователь словами просит autopilot /
  autonomously / automatically; для названных — `tickets: ["05", "06"]`; пользователь подтверждает в диалоге, вызов
  может ждать до 10 минут; в unattended Session — отказ). `autopilotTicketNums` (`:69`) превращает список в номера без
  повторов.
- **Вызов в сервере `worfy-canvas`** — `src/main/mcp/canvas-server.ts:287`: Layout не трогает, передаёт Project, Epic,
  номера и id Session (тот же SDK id, по которому её знает registry Session-ов) в `CanvasContext.autopilotStart`.
  У app его даёт `appDeps()` (`:465`): один starter на все Session-ы (`:457`), поэтому на Project один диалог за раз;
  `canvasForSession` передаёт его дальше (`:496`); без него — отказ `NO_AUTOPILOT_MESSAGE`.
- **`src/main/autopilot/chat-confirm.ts`** (новый): `autopilotStarter` (`:165`) по порядку — Session неизвестна или id ещё
  нет → отказ; unattended Session → `UNATTENDED_MESSAGE` (`:171`) без диалога; Run идёт или старт из чата ждёт конца
  хода Orchestrator-а → отказ `ChatStarts` (`chatRunningHint` / `chatWaitingHint`, `:173`) без диалога, в Journal
  ничего; workflow не читается, Epic-а или Ticket-а нет → отказ без диалога; второй вызов, пока диалог этого Project-а
  ждёт → отказ; на Machine нет окна worfy → `NO_WINDOW_MESSAGE` (`:182`); иначе диалог. «Start Autopilot» →
  `sharedChatStarts().startFromChat` с `by: 'tool'` и `session`: Orchestrator этого Project-а в ходе получает «Autopilot
  starts after this turn», Run стартует после idle; отказ `startFromChat` (например, человек нажал кнопку Autopilot,
  пока диалог был открыт) уходит агенту как отказ. «Cancel» — отказ. Unattended проверяется в момент вызова по registry
  (`appAutopilotStarter`, `:200`), а не флагом, записанным при создании canvas-сервера.
- **`chat-start.ts`** — одна строка доступа `ChatStarts.busyRefusal` (`:143`, разрешено orchestrator-ом в круге 1):
  инструмент спрашивает то же «занято», что и `startFromChat`, до диалога.
- **Диалог** — `confirmAutopilotStart` (`chat-confirm.ts:92`): нативный `showMessageBox` main process-а Machine Project-а,
  всегда с родительским окном. Окно выбирает `dialogOwner` (`:122`): окно в фокусе, если оно на экране, иначе первое
  на экране, иначе свёрнутое или скрытое окно — его сначала разворачивают (`restore`) и показывают (`show`); окон нет
  вовсе — отказ. Без родителя box на macOS идёт синхронно, держит main process до клика, и `signal` его не закрывает
  (Electron, `MessageBoxOptions.signal`) — поэтому такого box-а нет. Текст называет Project, Epic и Ticket-ы; кнопки
  «Start Autopilot» / «Cancel», по умолчанию — Cancel (`:77`, Enter ничего не запускает). Через 10 минут
  (`CONFIRM_WAIT_MS`) диалог закрывается через `signal`, ответ — «No one confirmed the start of Autopilot within 10
  minutes. Nothing started.». Экран Linked machine-а — клиент без окна (`src/main/clients.ts`): диалога не получает,
  канала ответить нет.
- `src/main/mcp/agent-instructions.md:48` — раздел «Autopilot»: когда звать, что передавать `tickets`, что вызов может
  ждать до 10 минут, что unattended Session получает отказ, что делать с «Autopilot starts after this turn».
- Feature pages: `docs/features/autopilot.md` (абзац «From a chat, by the agent», модуль `chat-confirm.ts`, test),
  `docs/features/cards.md` (строка таблицы инструментов).

Test-ы: `test/unit/canvas-tools.test.ts` (новый, 8: форма, отказы формы, описание),
`test/contract/autopilot-start-tool.test.ts` (новый, 21: через MCP-сервер, как Claude Code; настоящий `ChatStarts`,
Autopilot — stand-in с journal; диалог — подменённый `showMessageBox`; 10 минут — fake timers; выбор окна через
настоящий `dialogOwner`; проводка app — `appDeps().autopilotStart` и `appAutopilotStarter` над подменёнными registry,
`sharedChatStarts`, списком Project-ов и чтением workflow), `test/contract/canvas-tools.test.ts` (список из девяти
инструментов; проводка `canvasForSession` → starter). Первым падал contract test — сервер не знал `autopilot_start`.
Ручные mutant-ы: 10 в круге 0 и 13 в круге 1 (box без родителя, нет `show`/`restore`, окно в фокусе вне экрана,
`defaultId: 0`, проглоченный отказ `startFromChat`, нет отказа без окна, `busy` в проводке, «никогда не unattended»,
неизвестная Session как attended, ошибка workflow, starter на каждый вызов, `busyRefusal` без ожидающего старта) — все
убиты.

Не проверено:
- Снимки диалога в светлой и тёмной теме (`.scratch/worfy-flight-recorder/evidence/23/`) — решение orchestrator-а:
  пункт остаётся «не проверено», потому что диалог — нативный системный (NSAlert на macOS); его вид задаёт тема
  macOS, а не тема worfy, и снимок не проверяет ничего из кода worfy.
- Живой Claude Code не запускался: держит ли он вызов MCP-инструмента 10 минут без своего timeout-а, не проверено.
- Поведение настоящего Electron не проверено: что `show()` скрытого окна при спрятанном приложении (⌘H) делает его
  видимым и что sheet на окне, закрытом во время ожидания, отвечает; в обоих случаях box с родителем асинхронный, и
  10 минут его закрывают.
- Окно, где открыт именно этот Project, main не знает: диалог идёт на окно в фокусе или первое на экране.
- Отказ unattended Session не пишет событие `refused_dialog`: в `src/main/agent/session.ts` (`refuseDialog`) и
  `src/shared/agent/events.ts` только `permission_request` и `card_ask`, а запись в Journal делает `run.ts`
  (Ticket 11) — это долг вне этого Ticket-а.

**Долг (low, 2026-11-01).** Из ревью #1191, не исправлено:
- Приоритет окна в фокусе (`chat-confirm.ts:124`) без test-а: мутант `void focused` выживает.
- Отказ unattended `autopilot_start` не доходит до Journal (абзац выше): нужно `session.ts`, `events.ts` и `run.ts:327` —
  кандидат в brief Ticket-а 18 или 20.
