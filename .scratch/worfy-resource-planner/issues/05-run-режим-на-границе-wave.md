# 05 — Run: режим запуска на границе Wave

Type: task
Status: open
Branch: worfy-resource-planner/05
Blocked by: 02, 04
Source: [spec.md](../spec.md), «Решения» (Q2, Q3, Q11–Q13, Q15), «Режим запуска» («Выбор», «Граница Wave»), «five_hour», «Что видит пользователь» (строка статуса), «Journal» (`run-started.mode`, `start-window`), «Не решено» (выбрано без решения, п. 1, 3, 9, 10), «Риски», п. 3; [ADR-0093](../../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md), п. 1–3, 5

## Что происходит

- Перед каждым «Run wave» `sendWave` (`src/main/autopilot/run.ts:1188`) спрашивает свежие Limits и budget
  (`budgetCheck`, `:1194`, `:1310`; budget выключен — `go`, `:1315`). Стоп budget — `budgetWait` (`:1333`): строки
  `budget-stop` и `waiting-until`, Run `waiting`, таймер по `limits.schedule`, потом `budgetResume` (`:1351`) —
  `resumed` и снова `sendWave`. Stop во время этого ожидания кончает Run сразу (`:903-904`).
- `AutopilotStartOptions` (`run.ts:357`) — `override`, `tickets`, `by`; режима нет. Канал `autopilot.start`
  (`src/shared/ipc/autopilot.ts:118`) режима не принимает.
- Состояние Run: `waitingFor` — `limits`, `daily-share`, `five-hour` (`src/shared/ipc/autopilot.ts:47`), слова
  ожидания — `message` (`:49`), строка статуса — `autopilotStatusLine` (`:172`, слова `:187`).
- Зависимости Run в приложении: `budget.settings`, `budget.runs` (`src/main/ipc/autopilot.ts:182-185`).
- После Ticket-а 04 есть `autopilotRunOf` (режим по умолчанию, окно) и расчёт окна в `src/shared/autopilot/run-mode.ts`;
  после 02 — `waveDurationP90(runs)`.

## Что делаем

1. **Режим Run.** `AutopilotStartOptions.mode?` и `mode?` в `autopilot.start`; без него — режим по умолчанию из
   Settings в момент старта. Режим — в `run-started.mode` (`openRun`, `src/main/autopilot/journal.ts:122`; схема
   `src/shared/autopilot/journal.ts:309`). Кнопка Autopilot и команда в чате режим не передают — значит, по умолчанию.
2. **Решение окна** — чистая `windowDecision({ window, now, p90 })` в `run-mode.ts`: `go`; `go` с пометкой «мало
   данных о длительности» (`p90: null`); `wait` с `reason` (`outside` или `wave-too-long`) и `until` =
   `nextWindowStart`.
3. **Граница Wave** в `sendWave` (spec, «Граница Wave»):
   - `fastest` — ни окна, ни budget;
   - `start-window` — сначала окно (окно и p90 — по `budget.runs`, те же Journal-ы), потом budget, только если
     переключатель budget в Settings включён;
   - `budget-aware` — budget с reserve из Settings, даже при выключенном переключателе.
   Окно и budget читаются перед каждой Wave: изменение Settings действует со следующей Wave, режим Run — нет.
4. **Ожидание окна** — как `budgetWait`: строки `start-window` (`reason`, `until`, `text`, `durationP90Ms?`) и
   `waiting-until`, `waitingFor: 'start-window'`, `message` — tooltip из spec; по таймеру — `resumed` и `sendWave`
   заново (окно, потом budget). Ожидание окна и ожидание budget — одно место ожидания перед Wave: Stop, Force stop,
   выход из приложения и новое ожидание отменяют его таймер так же. Keep-awake держится.
5. **Мало данных.** Wave пошла без проверки длительности — `message` на время Wave:
   `Not enough data on Wave duration: Wave N started without the window check`.
6. **Строка статуса**: `outside start window · resumes 23:00`, `wave too long for window · resumes 23:00`.
7. **Journal.** Вид `start-window` — в `JOURNAL_EVENT_KINDS` (`src/shared/autopilot/journal.ts:220`), в шапке формата
   и в `JOURNAL_KINDS` (`src/shared/flight-recorder/journal-walk.mjs:9`; равенство держит
   `test/unit/critical-path.test.ts:263`). `run-started.mode` другого значения читается как отсутствующий, строка
   остаётся (как `by`).

## Готово, когда

- [ ] Unit test `windowDecision`: вне окна — `wait outside` до начала; внутри, `now + p90` после конца — `wait
      wave-too-long`; ровно в конец — `go`; `p90: null` — `go` с пометкой.
- [ ] Contract test (часы test-а, `test/contract/autopilot-limits.test.ts`): Start window, старт в 20:00 при окне
      23:00–07:00 — `run-started`, `start-window outside`, `waiting-until 23:00`; в 23:00 — `resumed`, `wave-started`.
- [ ] Contract test: 5 прошлых Wave по 2 часа, сейчас 06:00 — `start-window wave-too-long` до 23:00; 4 прошлые Wave —
      Wave идёт, `message` — «Not enough data on Wave duration…».
- [ ] Contract test: Wave, начатая в 06:50, доходит до `wave-finished` в 08:00; следующая ждёт окна.
- [ ] Contract test: Fastest при включённом budget и израсходованной дневной доле — Wave идёт, `budget-stop` нет.
      Budget-aware при выключенном переключателе — `budget-stop`. Start window при выключенном budget — только окно.
- [ ] Contract test `five_hour` (stub Limits): Start window, budget включён, окно `five_hour` полно до 07:30 — сначала
      `budget-stop five-hour`; после `resumed` в 07:32 — `start-window outside` до 23:00. Без окна `five_hour` в
      Limits — ни ожидания, ни строки о нём.
- [ ] Contract test: Stop во время ожидания окна — сразу `run-stopped user-stop`; Force stop — своей причиной, таймер
      отменён.
- [ ] Unit test `autopilotStatusLine`: обе строки ожидания окна; unit test Journal — `start-window` и
      `run-started.mode` проходят схему, чужой `mode` читается как отсутствующий.
- [ ] e2e (`test/e2e/autopilot.spec.ts`, `WORFY_AGENT=fake`, Settings и Journal в `WORFY_DATA_DIR`): Start window с окном,
      которое начнётся через 2 часа, — строка статуса `outside start window · resumes HH:00`, её tooltip, строки
      Journal `run-started`, `start-window`, `waiting-until`; Stop кончает Run сразу. Снимки обеих тем в
      `.scratch/worfy-resource-planner/evidence/05/`.
- [ ] Test-ы краснеют на mutant-ах: Fastest проверяет budget; окно не проверяется после `resumed`; Budget-aware
      смотрит на переключатель; Wave, начатая внутри окна, останавливается в его конце.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (e2e по таблице).

## Тесты

- Unit `test/unit/autopilot-run-mode.test.ts` (`windowDecision`), `test/unit/autopilot-run.test.ts`,
  `test/unit/autopilot-journal.test.ts`, `test/unit/canvas-actions.test.tsx` (строка статуса),
  `test/unit/critical-path.test.ts` (списки видов).
- Contract `test/contract/autopilot-limits.test.ts`, `test/contract/autopilot-journal.test.ts`.
- e2e `test/e2e/autopilot.spec.ts`.
- Сначала падающий: contract test старта в 20:00 при окне 23:00–07:00.
- Прогнать все unit и contract test-ы модуля Autopilot (spec, «Соглашения»).

## Где в коде

- `src/shared/autopilot/run-mode.ts` (Ticket 04) — `windowDecision`
- `src/main/autopilot/run.ts` — `AutopilotStartOptions` `:357`, `start` `:731`, Stop во время ожидания `:903-904`,
  `sendWave` `:1188`, budget `:1194`, `:1206-1208`, `budgetCheck` `:1310`, `budgetWait` `:1333`, `budgetResume` `:1351`;
  комментарий о budget в шапке `:91-99`
- `src/shared/autopilot/journal.ts` — шапка формата, `JOURNAL_EVENT_KINDS` `:220`, схема `:309`
- `src/main/autopilot/journal.ts` — `run-started` `:122`
- `src/shared/flight-recorder/journal-walk.mjs` — `JOURNAL_KINDS` `:9`
- `src/shared/ipc/autopilot.ts` — `waitingFor` `:47`, `autopilotStart` `:118`, `autopilotStatusLine` `:172`, `:187`
- `src/main/ipc/autopilot.ts` — зависимости Run `:182-185`
- `test/unit/autopilot-run-mode.test.ts`, `test/unit/autopilot-run.test.ts`, `test/unit/autopilot-journal.test.ts`,
  `test/unit/canvas-actions.test.tsx`, `test/contract/autopilot-limits.test.ts`, `test/contract/autopilot-journal.test.ts`,
  `test/e2e/autopilot.spec.ts`

Только читать: `src/main/autopilot/limits-wait.ts` (ожидание Limits внутри Wave не меняется), `src/shared/autopilot/budget.ts`
(`budgetDecision` `:170`, полное окно `five_hour` `:181`), `src/shared/autopilot/wave-duration.ts` (Ticket 02).
