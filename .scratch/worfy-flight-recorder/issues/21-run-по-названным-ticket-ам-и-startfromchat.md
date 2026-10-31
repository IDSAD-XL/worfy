# 21 — Run по названным Ticket-ам и `startFromChat`

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Запуск Autopilot из чата» («Run по названным Ticket-ам», «Отказ, пока Run идёт», «Вне Run», общая точка входа `chat-start.ts`; про старт после конца хода — «Инструмент `autopilot_start`»), «Решено без владельца» (`tickets-done`; ADR Ticket-а 21), «Ticket-ы» (21), «Готово, когда» (пункт про запуск из чата); решение 09, Q1, Q4, Q5, Q7 ([09-что-значит-autopilot-из-чата.md](09-что-значит-autopilot-из-чата.md)); решение 02 ([02-autopilot-из-чата-тот-же-run.md](02-autopilot-из-чата-тот-же-run.md))

## Что происходит

- Кнопка запускает Autopilot так: `AutopilotAction.tsx` → канал `autopilot.start` (`src/shared/ipc/autopilot.ts:112`)
  → `Autopilot.start(projectId, epic, { override? })` (`src/main/autopilot/run.ts:626`). Run всегда берёт весь Epic.
- Cycle (`src/shared/autopilot/cycle.ts`) берёт в Wave все готовые Ticket-ы Epic-а; причины остановки —
  `AUTOPILOT_STOP_REASONS` (`:38`), среди них `blocked-tickets` и `no-ready-wave`.
- Второй запуск при живом Run отклоняется только у «Run wave» (`AUTOPILOT_RUNNING_HINT`,
  `src/main/actions/launch.ts:126`).
- Запуска из чата нет: команда `/worfy:epic-wave …` и просьба словами уходят агенту, который ведёт Wave сам, без Run,
  Journal и строки статуса.

## Что делаем

1. **Run по названным Ticket-ам** (решение 09, Q4): `Autopilot.start(projectId, epic, { tickets })` и канал
   `autopilot.start` с необязательным `tickets`. Cycle берёт в Wave только готовые Ticket-ы из списка. Все названные
   `done` — Run останавливается с новой причиной `tickets-done` (в `AUTOPILOT_STOP_REASONS`; обычный конец).
   Заблокированный названный Ticket останавливает Run как сейчас (`blocked-tickets`). Без списка — весь Epic, как
   кнопка.
2. **`src/main/autopilot/chat-start.ts`, `startFromChat`** — общая точка входа для команды (Ticket 22) и инструмента
   (Ticket 23):
   - проверка Epic-а и Ticket-ов: Epic есть в Project-е, названные Ticket-ы есть в нём;
   - живой Run в Project-е — отказ «Autopilot is already running Epic X. Stop it first.»; в Journal ничего не
     пишется (до Run дело не дошло);
   - иначе — `Autopilot.start` с тем же поведением, что у кнопки;
   - зовёт Orchestrator этого Project-а — Run стартует после конца его хода (Session idle), ответ — «Autopilot
     starts after this turn».
   Кто начал Run (`command` или `tool`) `startFromChat` принимает и передаёт в `Autopilot.start`; поле
   `run-started.by` в Journal пишет Ticket 11.
3. **ADR** «запуск Autopilot из чата»: команда и просьба словами — тот же Run, что кнопка; Run по названным
   Ticket-ам и `tickets-done`; отказ при живом Run; «Run wave» и Wave из Claude в терминале вне worfy остаются без
   Run (решение 09, Q7). Номер — следующий свободный на момент claim (`docs/adr/`, открытые PR), заранее не
   резервируется.

Не входит: разбор команды и перехват в чате (Ticket 22), инструмент `autopilot_start` и диалог (Ticket 23).

## Готово, когда

- [ ] Unit test cycle: Epic с готовыми 05, 06, 07 и списком `["05", "06"]` — в Wave только 05 и 06; оба `done` —
      остановка `tickets-done`; без списка — Wave 05, 06, 07.
- [ ] Unit test cycle: названный Ticket `blocked` — остановка `blocked-tickets`, как без списка.
- [ ] Unit test `autopilot-run`: `Autopilot.start` со списком передаёт его в cycle; `tickets-done` в Journal
      (`run-stopped`) и в `AutopilotState.reason`.
- [ ] Unit test `chat-start`: нет Epic-а или названного Ticket-а — отказ с именем; живой Run — отказ «Autopilot is
      already running Epic X. Stop it first.» и ни одной строки в Journal; иначе — `Autopilot.start` с теми же
      аргументами, что у кнопки.
- [ ] Unit test `chat-start`: вызов из хода Orchestrator-а этого Project-а — ответ «Autopilot starts after this
      turn», `Autopilot.start` зовётся только после idle Session.
- [ ] ADR о запуске Autopilot из чата в `docs/adr/` с номером, свободным на момент claim.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/autopilot-cycle.test.ts`: список Ticket-ов и `tickets-done`.
- Unit `test/unit/autopilot-run.test.ts`: `start` со списком.
- Unit `test/unit/autopilot-chat-start.test.ts` (новый): проверки, отказ, старт после конца хода (подменённые
  Autopilot и Orchestrator-ы).
- Сначала падающий: unit test cycle — со списком `["05", "06"]` в Wave попадает и 07.
- Прогнать все unit и contract test-ы модуля Autopilot: `test/unit/autopilot-*.test.ts` (`budget`, `cycle`,
  `journal`, `limits-estimate`, `origin`, `power`, `resume-at`, `run`) и `test/contract/autopilot*.test.ts`
  (`autopilot`, `-background`, `-journal`, `-limits`, `-wiring`), и `test/unit/launch.test.ts`.

## Где в коде

- `src/shared/autopilot/cycle.ts` (`AUTOPILOT_STOP_REASONS`, `:38`)
- `src/main/autopilot/run.ts` (`start`, `:626`)
- `src/main/autopilot/chat-start.ts` (новый)
- `src/shared/ipc/autopilot.ts` (`autopilotStart`, `:112`)
- `src/main/ipc/autopilot.ts`
- `docs/adr/<NNNN>-autopilot-from-chat.md` (новый)
- `test/unit/autopilot-cycle.test.ts`
- `test/unit/autopilot-run.test.ts`
- `test/unit/autopilot-chat-start.test.ts` (новый)

Только читать: `src/main/actions/launch.ts` (`AUTOPILOT_RUNNING_HINT`), `src/main/agent/orchestrator.ts`,
`src/renderer/canvas/actions/AutopilotAction.tsx`.
