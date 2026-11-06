# 14 — Очередь Epic-ов в Run-е: Run, журнал и правка между Wave-ами

Type: task
Status: open
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
- [ ] Contract test: в первом Epic-е остался `blocked` `Waits: owner` — `epic-finished` `waits-owner`, второй идёт.
- [ ] Contract test: `limits-timeout` и `no-progress` в первом Epic-е — весь Run стоп, второй не начат.
- [ ] Contract test: второй Epic идёт на другой Machine (stub `linkedRuns`) — `elsewhere`, третий идёт.
- [ ] Contract test: `editQueue` add/remove во время Wave — применено на её границе, `queue-changed`; убрать идущий —
      отказ.
- [ ] Contract test: `epics` + `tickets` — отказ; старый вход `{ epic }` работает как сейчас.
- [ ] Новый ADR. `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный. Ревью не ниже `high`.

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
