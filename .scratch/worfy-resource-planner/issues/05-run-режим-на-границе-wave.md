# 05 — Run: режим запуска на границе Wave

Type: task
Status: claimed 2026-11-01T11:06Z
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

- [x] Unit test `windowDecision`: вне окна — `wait outside` до начала; внутри, `now + p90` после конца — `wait
      wave-too-long`; ровно в конец — `go`; `p90: null` — `go` с пометкой.
- [x] Contract test (часы test-а, `test/contract/autopilot-limits.test.ts`): Start window, старт в 20:00 при окне
      23:00–07:00 — `run-started`, `start-window outside`, `waiting-until 23:00`; в 23:00 — `resumed`, `wave-started`.
- [x] Contract test: 5 прошлых Wave по 2 часа, сейчас 06:00 — `start-window wave-too-long` до 23:00; 4 прошлые Wave —
      Wave идёт, `message` — «Not enough data on Wave duration…».
- [x] Contract test: Wave, начатая в 06:50, доходит до `wave-finished` в 08:00; следующая ждёт окна.
- [x] Contract test: Fastest при включённом budget и использованной дневной доле — Wave идёт, `budget-stop` нет.
      Budget-aware при выключенном переключателе — `budget-stop`. Start window при выключенном budget — только окно.
- [x] Contract test `five_hour` (stub Limits): Start window, budget включён, окно `five_hour` полно до 07:30 — сначала
      `budget-stop five-hour`; после `resumed` в 07:32 — `start-window outside` до 23:00. Без окна `five_hour` в
      Limits — ни ожидания, ни строки о нём.
- [x] Contract test: Stop во время ожидания окна — сразу `run-stopped user-stop`; Force stop — своей причиной, таймер
      отменён.
- [x] Unit test `autopilotStatusLine`: обе строки ожидания окна; unit test Journal — `start-window` и
      `run-started.mode` проходят схему, чужой `mode` читается как отсутствующий.
- [x] e2e (`test/e2e/autopilot.spec.ts`, `WORFY_AGENT=fake`, Settings и Journal в `WORFY_DATA_DIR`): Start window с окном,
      которое начнётся через 2 часа, — строка статуса `outside start window · resumes HH:00`, её tooltip, строки
      Journal `run-started`, `start-window`, `waiting-until`; Stop кончает Run сразу. Снимки обеих тем в
      `.scratch/worfy-resource-planner/evidence/05/`.
- [x] Test-ы краснеют на mutant-ах: Fastest проверяет budget; окно не проверяется после `resumed`; Budget-aware
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

## Итог

- `src/shared/autopilot/run-mode.ts` — чистая `windowDecision({ window, now, p90 })`: вне окна — `wait outside` до
  `nextWindowStart`; внутри, `now + p90` позже `windowEnd` — `wait wave-too-long` до `nextWindowStart`; ровно в конец —
  `go`; `p90: null` — `go` с `unknownDuration`. Тексты: `windowWaitText` (tooltip и `text` строки Journal, слова spec),
  `unknownDurationText`. Проверка окна заново после пробуждения — это сам вызов `windowDecision` на следующей границе:
  пробуждение в пропущенный час (03:00–04:00 Europe/Kyiv в ночь перевода вперёд) снова даёт `wait outside` до
  следующего дня, а не Wave; unit test на обоих днях перевода, край 03:00.
- `src/main/autopilot/run.ts` — режим Run (`AutopilotStartOptions.mode`, иначе режим по умолчанию из Settings в момент
  старта, `deps.runSettings`; без него — как `autopilotRunOf`), в `run-started.mode`. Граница Wave — `boundaryCheck`:
  Fastest — `go`; Start window — окно (p90 по тем же Journal-ам, что budget, читаются один раз), потом budget, если
  переключатель включён; Budget-aware — budget с `enabled: true`. Ожидание budget и ожидание окна — одно поле
  `run.boundary` (бывшее `run.budget`): один таймер, одна отмена (Stop, Force stop, выход, новое ожидание), `resumed`
  только для текущего ожидания и только в фазе `sending`, поэтому после `run-stopped` его нет. Wave без проверки
  длительности — `message` на время Wave, снимается на `wave-finished` и в конце Run.
- `src/shared/ipc/autopilot.ts` — `waitingFor: 'start-window'`, новое поле `windowReason` (`outside` /
  `wave-too-long`: по одному `waitingFor` строка статуса причину не различит), `mode?` в `autopilot.start`, строки
  статуса `outside start window · resumes 23:00`, `wave too long for window · resumes 23:00`.
- Journal: вид `start-window` (`reason`, `until`, `text`, `durationP90Ms?`) в шапке формата, в `JOURNAL_EVENT_KINDS` и
  в `JOURNAL_KINDS` (`journal-walk.mjs`, только список; чтение Wait окна во Flight Recorder — Ticket 08);
  `run-started.mode` чужого значения читается как отсутствующий.
- `docs/features/autopilot.md` — строки статуса, раздел «The Run mode», `start-window` и `run-started.mode` в таблице
  Journal (переезд в `run-planning.md` — Ticket 10).
- Долг #1212 в `test/contract/autopilot-limits.test.ts`: test ждёт строку `resumed`, а не `status === 'running'`.
- Снимки обеих тем: [`../evidence/05/`](../evidence/05/) — строка статуса `outside start window · resumes HH:00`.
  Контраст текста строки к фону: 8.0:1 светлая, 7.9:1 тёмная.

Решено без владельца, подтвердить:
- Поле состояния `windowReason` рядом с `waitingFor: 'start-window'`.
- Если p90 длительности длиннее всего окна, Start window ждёт каждую ночь и Wave не начнётся никогда (Run жив,
  keep-awake держится); spec этого случая не называет, предела нет.

Mutant-ы (каждый — красный test, скрипт в scratchpad):
- Fastest проверяет budget — красный «Fastest with the budget on…».
- Окно не проверяется после `resumed` — 2 красных: «after the wait the window is asked again…», «five_hour…».
- Budget-aware смотрит на переключатель — красный «Budget-aware with the budget's switch off…».
- Wave, начатая внутри окна, останавливается в его конце (стоп на конце хода вне окна) — красный «a Wave started at
  06:50…».
- Поздний таймер пишет `resumed` после конца Run — 5 красных (в том числе «Stop during the wait for the window…»).
- Stop во время ожидания окна идёт как graceful — красный «Stop during the wait for the window…».
- `>=` вместо `>` на конце окна — 3 красных unit.
- Wave без проверки длительности молчит — красный «4 past Waves…».

Оценка токенов автора: около 450 тысяч.
