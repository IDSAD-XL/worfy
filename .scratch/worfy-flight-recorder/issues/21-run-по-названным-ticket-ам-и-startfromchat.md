# 21 — Run по названным Ticket-ам и `startFromChat`

Type: task
Status: claimed 2026-11-01T00:01Z
Branch: worfy-flight-recorder/21
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

## Итог

Сделано (ветка `worfy-flight-recorder/21`, ADR-0091 `docs/adr/0091-autopilot-from-chat.md`):

- **Run по названным Ticket-ам.** `Autopilot.start(projectId, epic, { tickets, by })` (`src/main/autopilot/run.ts`,
  `AutopilotStartOptions`); канал `autopilot.start` принимает необязательный `tickets` — целые положительные, хотя бы
  один (`src/shared/ipc/autopilot.ts:115`), handler передаёт его дальше (`src/main/ipc/autopilot.ts`). Cycle держит список
  в `CycleState.named` (`initialCycle(epic, named)`), готовые и `skipped` считает только по нему
  (`readyWave(tickets, epic, named)`, `src/shared/workflow/waves.ts:175`), подхват после Force stop — тоже только из
  списка.
- **`tickets-done`** — в `AUTOPILOT_STOP_REASONS` (`src/shared/autopilot/cycle.ts:45`); все названные `done` в checkout-е
  (`namedDone`, `cycle.ts:216`) — остановка на старте и после Wave. Заблокированный названный Ticket — `blocked-tickets`,
  как раньше; заблокированный Ticket вне списка Run не останавливает; `sameSet`/`no-progress` не тронут.
- **Wave из списка.** Текст и Ticket-ы Wave собирает launcher, не cycle, поэтому список идёт и туда:
  `deps.waves.autopilotWave(…, named)` → `ActionLauncher.autopilotWave(…, named)` (`src/main/actions/launch.ts`) →
  `runWaveState({ …, named })` (`src/shared/actions/render-template.ts`). `{wave}` считается по плану всего Epic-а.
- **Проверка старта** — `startRefusal(model, epic, tickets)` (`run.ts:358`): нет Epic-а, пустой список, Ticket-а нет в
  Epic-е («Epic demo has no Tickets 07, 09»). Его зовут и `Autopilot.start`, и `startFromChat`. `Autopilot.runningEpic`
  (`run.ts:674`) — Epic живого или стартующего Run-а.
- **`src/main/autopilot/chat-start.ts`** — `ChatStarts.startFromChat` (`:91`): проверки, отказ «Autopilot is already
  running Epic X. Stop it first.» без строк Journal, `Autopilot.start` с `override: false`, списком и `by`
  (`command`/`tool`); из хода Orchestrator-а этого Project-а — ответ «Autopilot starts after this turn» и старт после
  idle Session (`whenIdle`, `:188`); пока старт ждёт, следующий запрос получает свой отказ (`chatWaitingHint`). App-экземпляр — `sharedChatStarts()`
  (`src/main/ipc/autopilot.ts:215`); его зовут Ticket-ы 22 и 23.
- `by` хранится в `Run.by`; в Journal его пишет Ticket 11. Формат Journal этот Ticket не меняет.
- Feature page `docs/features/autopilot.md`: строка `tickets-done`, уточнение `blocked-tickets`, модуль `chat-start.ts`.

Test-ы: `test/unit/autopilot-cycle.test.ts` (блок «over named Tickets», 10 test-ов), `test/unit/autopilot-run.test.ts`
(«a run over named Tickets», 4), `test/unit/autopilot-chat-start.test.ts` (новый, 10), `test/unit/launch.test.ts` (1),
`test/contract/autopilot.test.ts` (1), `test/contract/autopilot-wiring.test.ts` (поправлен под пятый аргумент).
Первый падающий — test cycle со списком 05, 06 (в Wave попадал и 07). 12 ручных mutant-ов по новой логике — все
убиты test-ами.

Круг 1 после ревью (REJECTED, 5 medium):
- Run по списку больше не теряет Ticket-ы прерванной Wave вне списка: они остаются в `resumable` после него
  (`Run.carried`, `resumableOf`, `run.ts:428`); test-ы — `test/unit/autopilot-run.test.ts`, блок «a run over named
  Tickets after a Force stop». Решение — в ADR-0091, пункт 2.
- Перед ответом «Autopilot starts after this turn» — все отказы, известные сейчас: `orchestratorRefusal` (tasks,
  очередь) и `Autopilot.startCheck` (`run.ts:776`: Run, свой репозиторий, шаблон, workflow, Epic, Ticket-ы, Run на Linked
  machine). Отказ после хода показывается на Session Orchestrator-а как notice (`Session.notice`,
  `src/main/agent/session.ts`). Решение — в ADR-0091, пункт 4.
- Test-ы на Ticket-ы вне списка (блокируют и держат файлы), на `skipped` без чужих Ticket-ов, на Card Session в своём
  ходу; гонки: кнопка нажата во время проверок, два запроса в одном ходу, проигранный старт.
- Мелкие: `lastText` пишется и для `tickets-done`; канал берёт `ticketNumSchema` (Ticket 00 допустим) и не больше
  `MAX_NAMED_TICKETS` (500); `orchestratorSession` в `try`.

Не проверено:
- Сужение счёта Ticket-ов для оценки бюджета (`budgetCheck`, `readyWave(…, run.cycle.named)`) test-ом не покрыто: mutant
  там выживет.
- Отказ после хода видит человек в окне Session, но не агент: notice в Claude Code не уходит.
- Ход «Process gate queue» перед остановкой с `tickets-done` не делается (только `no-ready-wave`/`blocked-tickets`, как
  было).
