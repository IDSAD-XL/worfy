# 06 — Диалог старта и tooltip кнопки Autopilot

Type: task
Status: claimed 2026-11-01T13:08Z
Branch: worfy-resource-planner/06
Blocked by: 03, 04, 05
Source: [spec.md](../spec.md), «Цель», п. 1, «Решения» (Q7, Q14, Q16), «Режим запуска» («Выбор»), «Что видит пользователь» (строка прогноза, режим, диалог `autopilot_start`), «Не решено» (выбрано без решения, п. 1, 2, 6, 7)

## Что происходит

- Tooltip активной кнопки Autopilot кончается строкой Ticket-а 40 (`src/renderer/canvas/actions/AutopilotAction.tsx`,
  комментарий `:68-73`; `estimateLine` `:288-291`; title `:318`). Ответ main — `autopilot.estimate`
  (`src/shared/ipc/autopilot.ts:150-155`; обработчик `src/main/ipc/autopilot.ts:89`, `estimateAnswer`
  `src/shared/autopilot/limits-estimate.ts:90`): медиана и число `seven_day`, без выборок.
- Кнопка стартует без диалога (`start`, `AutopilotAction.tsx:171-173`).
- Диалог `autopilot_start` (worfy-flight-recorder Ticket 23) — нативный message box: `confirmationOptions`
  (`src/main/autopilot/chat-confirm.ts:71`), кнопки `Start Autopilot` (`START_BUTTON`, `:36`) и `Cancel`, ответ — номер
  кнопки (`confirmAutopilotStart`, `:92`); после «Start» — `startFromChat` с `by: 'tool'` (`:185`), который строит
  `AutopilotStartOptions` (`src/main/autopilot/chat-start.ts:105`; запрос `ChatStartRequest` `:46`).
- После Ticket-ов 03–05: строки прогноза (`forecast-lines.ts`), режим по умолчанию и окно (`autopilotRunOf`), `mode` в
  `autopilot.start` и в `AutopilotStartOptions`.

## Что делаем

1. **Ответ `autopilot.estimate`** получает `samples` (выборки на Ticket, `waveSamples`) и `durations` (p90 длительности
   и число выборок, `waveDurationP90`), а `sevenDay` — `receivedAt` (когда получено число): без него tooltip не может
   проверить свежесть `seven_day` (не старше 30 минут, `BUDGET_FRESH_MS`), а рекомендации и предупреждению она нужна.
   Старые поля остаются (ими пользуется budget). Схема — с верхними пределами длины.
2. **Tooltip кнопки.** Вместо строки Ticket-а 40 — `modeLine`, `forecastLine`, затем для режима по умолчанию:
   рекомендация (budget действует), предупреждение (не действует) и строка окна (Start window). Прогноз считает
   renderer: `remainingWaves` по Ticket-ам, которые кнопка уже держит, и `epicForecast` по `samples`; вычисление —
   один раз на изменение входов (`useMemo`), не на каждую перерисовку.
3. **Диалог `autopilot_start`.** `confirmationOptions` получает прогноз: к `detail` — `dialogLines` (spec, «Диалог
   `autopilot_start`»). Кнопки `Start: Fastest`, `Start: Budget-aware`, `Start: Start window`, `Cancel`; у кнопки
   режима по умолчанию — ` (default)`; `defaultId` и `cancelId` — `Cancel`. Ответ — режим, он идёт в
   `ChatStartRequest.mode` и дальше в `AutopilotStartOptions.mode`. Run по названным Ticket-ам — прогноз только по ним.
4. Прогноз диалога считает main: Journal-ы `readRecentRuns`, модель — тот же свежий `readWorkflow`, что уже читает
   `chat-confirm.ts`, Limits — снимок приложения. Не прочитались Journal-ы — диалог показывается без строк прогноза.
5. Команда в чате (`/worfy:epic-wave …`) режим не передаёт: стартует в режиме по умолчанию.

## Готово, когда

- [x] Contract test (`test/contract/autopilot-start-tool.test.ts`, box — stub): четыре кнопки в порядке spec, ` (default)`
      у режима из Settings, `Cancel` по умолчанию; ответ «Start: Start window» запускает Run, чей `run-started.mode` —
      `start-window`; «Cancel» — ничего; `detail` содержит строки `Forecast:` и `Fastest:` для Journal-ов fixture.
- [x] Test `confirmationOptions` (там же): «мало данных» — без строк Budget-aware и Fastest; Run по названным — прогноз по ним.
- [x] Unit test `chat-start`: `mode` доходит до `AutopilotStartOptions`; без него — без поля.
- [x] Unit test `estimateAnswer` (`test/unit/autopilot-limits-estimate.test.ts`): `samples` и `durations` по Journal-ам
      test-а; Journal-ы без Wave — пустые; `sevenDay.receivedAt` — время числа Limits; прежние поля — как раньше.
- [x] Unit test tooltip (`test/unit/canvas-actions.test.tsx`): число `seven_day` старше 30 минут — без рекомендации и
      предупреждения; то же число моложе 30 минут — с рекомендацией.
- [x] e2e (`test/e2e/autopilot.spec.ts`): строка tooltip кнопки без прошлых Wave — режим и «Not enough data for a
      forecast…» (меняет ожидание `:272-275`); с пятью прошлыми Wave в `WORFY_DATA_DIR`, свежим `limits.json` и
      режимом по умолчанию Budget-aware в app settings (`autopilotRun.mode: 'budget-aware'`) — `This Epic: …` и
      `Recommended: …`; тот же fixture в режиме Fastest — `Only K of W Waves…` вместо рекомендации; Start window в Settings — строка окна. Снимки обеих тем в
      `.scratch/worfy-resource-planner/evidence/06/`.
- [x] Test-ы краснеют на mutant-ах: кнопка `Cancel` перестаёт быть по умолчанию; ответ кнопки сопоставлен не тому режиму;
      tooltip берёт режим не из Settings.
- [x] `node scripts/check-cyrillic.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (e2e по таблице).

## Тесты

- Contract `test/contract/autopilot-start-tool.test.ts`.
- Unit `test/unit/autopilot-limits-estimate.test.ts` (`estimateAnswer`), `test/unit/autopilot-chat-start.test.ts`,
  `test/unit/canvas-actions.test.tsx` (tooltip кнопки).
- e2e `test/e2e/autopilot.spec.ts`.
- Сначала падающий: contract test ответа «Start: Start window».
- Прогнать все unit и contract test-ы модуля Autopilot (spec, «Соглашения»).

## Где в коде

- `src/shared/ipc/autopilot.ts` — `autopilotEstimateAnswerSchema` `:150-155`
- `src/main/ipc/autopilot.ts` — обработчик `autopilot.estimate` `:89`, `EstimateSources` `:60`
- `src/shared/autopilot/limits-estimate.ts` — `estimateAnswer` `:90`
- `src/renderer/canvas/actions/AutopilotAction.tsx` — `:68-73`, `:171-173`, `:288-291`, `:318`
- `src/main/autopilot/chat-confirm.ts` — `START_BUTTON` `:36`, `confirmationOptions` `:71`, `confirmAutopilotStart` `:92`,
  `startFromChat` `:185`
- `src/main/autopilot/chat-start.ts` — `ChatStartRequest` `:46`, опции старта `:105`
- `test/contract/autopilot-start-tool.test.ts`, `test/unit/autopilot-limits-estimate.test.ts`,
  `test/unit/autopilot-chat-start.test.ts`, `test/unit/canvas-actions.test.tsx`, `test/e2e/autopilot.spec.ts`

Только читать: `src/shared/autopilot/forecast.ts`, `forecast-lines.ts`, `wave-duration.ts`, `run-mode.ts` (Ticket-ы 01–05).

## Итог

- `src/shared/autopilot/limits-estimate.ts` — `estimateAnswer` отвечает ещё `samples` (`waveSamples`), `durations`
  (`waveDurationP90`) и `sevenDay.receivedAt` (время числа окна `seven_day`, не `five_hour`); прежние поля как были.
- `src/shared/ipc/autopilot.ts` — схема ответа `autopilot.estimate`: `samples` не длиннее `ESTIMATE_WAVES`, `durations.samples`
  не больше `DURATION_WAVES`, доли неотрицательные; `sevenDay.receivedAt` обязателен. Ответ старой формы не проходит
  схему — tooltip тогда кончается строкой режима.
- `src/renderer/canvas/actions/AutopilotAction.tsx` — строка Ticket-а 40 заменена: `modeLine` режима по умолчанию из
  Settings (каждое поле — отдельным selector-ом `useAppSettings`), `forecastLine`, затем для режима: рекомендация, когда
  budget действует (Budget-aware, Start window с включённым budget), предупреждение, когда нет, строка окна в Start window
  (`forecastHint`). `remainingWaves` — по Ticket-ам кадра Epic-а; bootstrap — `useMemo` по `samples`, Ticket-ам и Epic-у,
  строки — `useMemo` по входам (и по минуте `useNow`). Из ответа `autopilot.estimate` tooltip берёт только `samples` и
  `durations`; Limits — живые, из `useLimits` (то же состояние, что у toolbar, через `limits.changed`).
- `src/main/autopilot/chat-confirm.ts` — кнопки `Start: Fastest`, `Start: Budget-aware`, `Start: Start window`, `Cancel`
  (порядок `RUN_MODES`), ` (default)` у режима из Settings, `defaultId` и `cancelId` — `Cancel`; ответ — режим
  (`RUN_MODES[response]`, иначе `cancel`). `detail`: первый абзац, строки `dialogLines`, абзац про 10 минут. Прогноз считает
  main: Journal-ы `readRecentRuns`, Ticket-ы — тот же свежий `readWorkflow`, что проверяет старт (у Run по названным —
  только они), Limits — `appLimits().snapshot()`, reserve и окно — Settings. Journal-ы не прочитались — диалог без
  строк прогноза, предупреждение в log. `START_BUTTON` заменён на `startButton(mode, defaultMode)`.
- `src/main/autopilot/chat-start.ts` — `ChatStartRequest.mode` идёт в `AutopilotStartOptions.mode`; без него поля нет
  (команда в чате стартует в режиме по умолчанию).
- `docs/features/autopilot.md` — tooltip кнопки, диалог `autopilot_start`, режим из диалога в «The Run mode».
- Снимки обеих тем: [`../evidence/06/`](../evidence/06/) — шапка кадра Epic-а с активной кнопкой Autopilot при fixture
  e2e (Budget-aware, пять прошлых Wave). Сам tooltip и нативный диалог на снимок Playwright не попадают: текст tooltip
  проверяется по атрибуту `title` в e2e, текст диалога — в contract test. Новых цветов и элементов нет, контраст шапки
  не менялся.

Решено без владельца, подтвердить:
- Строка режима есть в tooltip всегда, когда кнопка активна, и без ответа `autopilot.estimate` (тогда строк прогноза нет).
- Ответ инструмента после старта из диалога прежний (`Autopilot started Epic demo.`), режим в нём не называется.
- Строки tooltip идут через «. » одной строкой, как строка Ticket-а 40, без переносов.

Mutant-ы (каждый — красный test; скрипт в scratchpad, 13 из 13 убиты):
- `Cancel` не по умолчанию (`defaultId: 0`) — 2 красных contract («"Cancel" — and Enter or Escape…», первый test диалога).
- Ответ кнопки сопоставлен не тому режиму (обратный порядок) — 7 красных contract (в том числе «button %i starts in the mode…»).
- Tooltip берёт режим от переключателя budget, а не из Settings — 6 красных unit tooltip.
- Диалог считает весь Epic в Run по названным — красный «a run over named Tickets forecasts only those».
- Прогноз не попадает в `detail` — 4 красных contract; ` (default)` ни у одной кнопки — 3 красных contract.
- `chat-start` теряет `mode` — красный unit; `receivedAt` берётся у `five_hour` — красный unit; пустые `samples` — красный unit.
- Tooltip: Start window без учёта переключателя budget — красный; рекомендация во всех режимах — 3 красных; нет строки
  окна — 2 красных; reserve в процентах вместо доли — 3 красных.

Долг без правки: у `waveEstimateLine` (`limits-estimate.ts`) нет вызовов в `src`; удаление трогает
`test/unit/autopilot-forecast-lines.test.ts` вне следа Ticket-а — оставлено.

Раунд 1 ревью (PR 1218):
- Tooltip брал число `seven_day` из ответа `autopilot.estimate`, который спрашивается только при смене статуса Run: через
  ~30 минут простоя он говорил «Used now: unknown» и терял рекомендацию. Теперь Limits — живые (`useLimits`), строки
  пересчитываются на `limits.changed`; `answerLimits` и `shortcut:`-комментарий убраны.
- Contract test диалога доказывает, что reserve и окно — из Settings: 60 % при reserve 15 % — «no Wave now», при reserve
  5 % в Settings приложения — «1 Wave fits…»; окно 21:00–05:00.
- Unit test-ы tooltip сравнивают полный текст; новый test: смена режима в Settings (`appSettings.changed`) сразу
  перерисовывает tooltip.
- Mutant-ы раунда (все красные): tooltip читает `sevenDay` ответа вместо живых Limits — 10 красных; строки без зависимости
  от Limits — красный «follows limits.changed…»; без зависимости от режима — красный «a change of the mode…»; без
  зависимости от переключателя budget — тот же test; диалог с reserve 0 — красный «the reserve and the Start window are
  those of Settings…»; окно диалога 23–07 — 2 красных; budget Settings не доходит до диалога в приложении — красный test
  проводки. Mutant-ы M1–M13 первого раунда снова прогнаны на новых test-ах — все красные.

Оценка токенов автора: ~190 тыс. (раунд 1 ревью — ещё ~60 тыс.)
