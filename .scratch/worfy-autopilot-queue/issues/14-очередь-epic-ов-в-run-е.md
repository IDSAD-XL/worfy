# 14 — Очередь Epic-ов в Run-е: Run, журнал и правка между Wave-ами

Type: task
Status: done 2026-11-06T20:29Z
PR: #1523
Blocked by: 07, 08, 12
Source: [spec.md](../spec.md), «Что видит владелец», п. 4–5; «Как работает» → «Очередь Epic-ов», «Run»; «Решения владельца», 17–21, 23; «ADR»; «Решено без владельца», 2, 4, 6, 8; [03](03-очередь-epic-ов.md), Q2–Q6, Q8

Начинать после merge worfy-retry 05 и 14 (общие run.ts, cycle.ts, журнал; worfy-retry 04 влит 2026-11-06, PR #1468).

## Что происходит

- Run знает один Epic: `Run.epic` (`src/main/autopilot/run.ts:682`), `initialCycle(epic, named)` (`:689`;
  `src/shared/autopilot/cycle.ts:173`), один Run на Project (`Autopilot.starting`, `run.ts:741`), отказ второго
  старта — `alreadyRunning` (`:457`). Run того же Epic-а на другой Machine — `checkElsewhere` (`:982`), ключ Run-а —
  `keys()` по Epic-у.
- Каждая строка журнала несёт `epic` (`common`, `src/shared/autopilot/journal.ts:413-417`); `run-started` — `:422`.
- Вход `autopilot.start` — `{ projectId, epic, override?, tickets?, mode? }` (`src/shared/ipc/autopilot.ts:150`,
  обработчик `src/main/ipc/autopilot.ts:92-94`).

## Что делаем

1. **Run над списком.** `AutopilotStartOptions.epics?: string[]` (1–`MAX_QUEUE_EPICS`); `epic` — первый. `tickets` —
   только при одном Epic-е, иначе отказ. Run держит `queue`, `index`, `outcomes`; на каждый Epic — новый
   `initialCycle`. Остановка цикла → `epicOutcome` (Ticket 12): `next` — `epic-finished` и следующий Epic через
   `epic-started`; `stop` — `run-stopped`, как сейчас. Очередь кончилась — `run-stopped` с причиной последнего Epic-а.
2. **Журнал.** `run-started.epics`; `epic-started` (`index`, `of`); `epic-finished` (`outcome`: `done` | `waits-owner` |
   `elsewhere` | `removed`, `tickets?`); `queue-changed` (`added?`, `removed?`); `epic` каждой строки — текущий Epic.
   Описание в шапке `journal.ts`, схема через `event(…)`.
3. **Другая Machine.** `checkElsewhere` — при старте для каждого Epic-а очереди и заново в начале каждого Epic-а; занят
   — `epic-finished` `elsewhere`, дальше.
4. **Правка между Wave-ами.** `Autopilot.editQueue(projectId, { add?: string, remove?: string })`, канал
   `autopilot.queue` (`write`): добавить в конец (Epic Project-а, не в очереди), убрать не начатый; применяется на
   границе Wave; во время Wave — ставится в ожидание и применяется на её конце. Переставлять нельзя.
5. **Состояние Autopilot.** `queue: { epic, status: 'done'|'running'|'next'|'waits-owner'|'elsewhere' }[]`, `index`;
   прогноз — сумма оставшихся Wave всех не начатых Epic-ов; budget проверяется на каждой границе Wave, как сейчас
   (`boundaryCheck`, `run.ts:1551`; решение владельца Q8).
6. **ADR.** Номер — `preflight` при claim. Новый ADR «Run ведёт очередь Epic-ов»: очередь в одном Run-е, правило
   перехода и пропуска (Ticket 12), стоп всего Run-а, события журнала, правка между Wave-ами, принятый Epic через
   `epic-status` (Ticket 13); «Considered Options» — смешанные Wave-ы, отдельный Run на Epic, перестановка во время
   Run-а.

## Готово, когда

- [ ] Contract test: очередь из двух Epic-ов — первый кончился (`done`), `epic-finished`, `epic-started` второго,
      Wave-ы второго; `run-stopped` один на весь Run.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-queue.test.ts` exit 0 · mac - · 58ba29fe316894a5d9ea74800a45062de1b86213
  - evidence: review pass · PR #1523 · - - · 8cead0f861bc6e3337a8f7253651637424e361bd
- [ ] Contract test: в первом Epic-е остался `blocked` `Waits: owner` — `epic-finished` `waits-owner`, второй идёт.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-queue.test.ts` exit 0 · mac - · 58ba29fe316894a5d9ea74800a45062de1b86213
  - evidence: review pass · PR #1523 · - - · 8cead0f861bc6e3337a8f7253651637424e361bd
- [ ] Contract test: `limits-timeout` и `no-progress` в первом Epic-е — весь Run стоп, второй не начат.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-queue.test.ts` exit 0 · mac - · 58ba29fe316894a5d9ea74800a45062de1b86213
  - evidence: review pass · PR #1523 · - - · 8cead0f861bc6e3337a8f7253651637424e361bd
- [ ] Contract test: второй Epic идёт на другой Machine (stub `linkedRuns`) — `elsewhere`, третий идёт.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-queue.test.ts` exit 0 · mac - · 58ba29fe316894a5d9ea74800a45062de1b86213
  - evidence: review pass · PR #1523 · - - · 8cead0f861bc6e3337a8f7253651637424e361bd
- [ ] Contract test: `editQueue` add/remove во время Wave — применено на её границе, `queue-changed`; убрать идущий —
      отказ.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-queue.test.ts` exit 0 · mac - · 58ba29fe316894a5d9ea74800a45062de1b86213
  - evidence: review pass · PR #1523 · - - · 8cead0f861bc6e3337a8f7253651637424e361bd
- [ ] Contract test: `epics` + `tickets` — отказ; старый вход `{ epic }` работает как сейчас.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-queue.test.ts` exit 0 · mac - · 58ba29fe316894a5d9ea74800a45062de1b86213
  - evidence: review pass · PR #1523 · - - · 8cead0f861bc6e3337a8f7253651637424e361bd
- [ ] Новый ADR. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный. Ревью не ниже `high`.
  - evidence: review pass · PR #1523 · - - · 8cead0f861bc6e3337a8f7253651637424e361bd
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42283474714 · ci - · 8cead0f861bc6e3337a8f7253651637424e361bd

## Тесты

- Contract `test/contract/autopilot-queue.test.ts`, fixture-ы `test/fixtures/agent-scripts/autopilot-queue-*.jsonl`
  (новые); setup — по образцу `test/contract/autopilot.test.ts`.
- Сначала падающий: `start` с `epics` — второй Epic не начинается.
- Прогнать `test/contract/autopilot*.test.ts`, `test/unit/autopilot-*.test.ts`.

## Где в коде

- `src/main/autopilot/run.ts`
- `src/shared/autopilot/journal.ts`
- `src/shared/ipc/autopilot.ts`, `src/main/ipc/autopilot.ts`
- `test/contract/autopilot-queue.test.ts`, `test/fixtures/agent-scripts/autopilot-queue-*.jsonl` (новые)
- `docs/adr/<номер>-run-epic-queue.md` (новый)

Только читать: `src/shared/autopilot/epic-queue.ts`, `src/shared/autopilot/cycle.ts`, `src/shared/workflow/accepted-epics.ts`.

## Итог

ADR-0100. Run ведёт очередь Epic-ов: `AutopilotStartOptions.epics` (1–10, первый — `epic`), `queue`, `index`,
`outcomes`, свой `initialCycle` на каждый Epic. Остановка цикла → `epicOutcome` (Ticket 12) на свежем чтении workflow:
`next` — `epic-finished` и `epic-started` следующего, `stop` — `run-stopped` всего Run-а. Журнал: `run-started.epics`,
`epic-started`, `epic-finished`, `queue-changed`, `epic` строки — Epic, о котором она. Канал `autopilot.queue`
(`Autopilot.editQueue`), в состоянии `queue` и `index`, прогноз — по всем Epic-ам очереди.

Сначала падающий: с отключённым переходом к следующему Epic-у (`moveOn`) 13 из 28 test-ов
`test/contract/autopilot-queue.test.ts` падали, первый — «второй Epic не начинается» (`epic-started` нет, Run кончается
на первом Epic-е).

Решено без владельца:

- При старте занятый на другой Machine Epic очереди — отказ старта (как для одного Epic-а), «Start anyway» снимает
  проверку на весь Run; без него проверка повторяется в начале каждого следующего Epic-а и даёт `elsewhere`.
- `epic-started` нет у первого Epic-а; `epic-finished` нет у Epic-а, на котором Run остановился; Run из одного Epic-а
  не пишет `epics` и новых событий.
- Убранный Epic получает `epic-finished` `removed` на своей строке сразу после `queue-changed`.
- Wave-ы считаются с 1 в каждом Epic-е; сведение по номеру Wave в Flight Recorder и Run history — Ticket 18.
- Правка во время Wave применяется после `wave-finished`; не применённая к остановке Run-а — отбрасывается; добавить к
  Run-у с named Ticket-ами нельзя; добавление, которое ждёт, забирается обратно удалением того же Epic-а.
- Статус `running` в состоянии остаётся у Epic-а, на котором Run остановился.
- `epics`, где первый не `epic`, — отказ.

Вне списка файлов: `src/main/autopilot/journal.ts` (`append` со своим `epic`, `epics` в `run-started`),
`src/main/agent/auto-approve/run-approval.ts` (ветки Wave — от Epic-а этой Wave, не первого),
`src/shared/flight-recorder/journal-walk.mjs` (три новых вида событий), test-ы `autopilot-journal` (unit и contract),
`auto-approve-run`. Feature page `docs/features/autopilot.md` не менялась: точек входа для очереди ещё нет
(Ticket-ы 15–17), описание — Ticket 19.

### Раунд 2

Ревью high (раунд 1, REJECTED за два пробела в test-ах) — добавлены test-ы в `test/contract/autopilot-queue.test.ts`, каждый
сначала красный на своей мутации, потом зелёный:

- Очередь и «Process gate queue» на машине с `serve`: gate-queue — один раз, после последнего Epic-а; конец первого
  Epic-а ведёт к следующему. Мутация «gate-queue раньше перехода» — красный.
- Auto-approval: `setWave` второго Epic-а получает его Epic. Мутация «`setWave` без Epic-а» — красный.
- Одинаковые номера Ticket-ов в двух Epic-ах: счёт `ended`, ветки PR и строки `narrow-round` — свои у каждого Epic-а
  (сброс `waveTickets` и `narrowJournaled`); Ticket-ы, данные первому Epic-у, не становятся resumable у второго
  (сброс `given`). Три мутации — красный.
- Канал `autopilot.queue` с `remove`. Мутация «канал теряет `remove`» — красный.
- Правка очереди после Stop теперь отказ (`STOPPING_MESSAGE`): следующий Epic уже не начнётся. Мутация «правка
  принята» — красный.

Документация приведена к коду: правка применяется сразу только пока Run ждёт Orchestrator-а, budget или окна Start;
`wave` считается с 1 заново в каждом Epic-е (`src/shared/ipc/autopilot.ts`, шапка `src/shared/autopilot/cycle.ts` —
только комментарий).

Открытый вопрос владельцу: при старте Epic очереди, занятый на другой Machine, отказывает старт, а «Start anyway»
снимает проверку для всех Epic-ов очереди. Spec («Решено без владельца», 6) говорит о пропуске занятого Epic-а в
середине очереди, о старте молчит. Сделано строже; если
владелец выберет пропуск и при старте — это правка `checkElsewhere` в `Autopilot.start`.
