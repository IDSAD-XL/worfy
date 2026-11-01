# 06 — Диалог старта и tooltip кнопки Autopilot

Type: task
Status: open
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
   и число выборок, `waveDurationP90`); старые поля остаются (ими пользуется budget). Схема — с верхними пределами длины.
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

- [ ] Contract test (`test/contract/autopilot-start-tool.test.ts`, box — stub): четыре кнопки в порядке spec, ` (default)`
      у режима из Settings, `Cancel` по умолчанию; ответ «Start: Start window» запускает Run, чей `run-started.mode` —
      `start-window`; «Cancel» — ничего; `detail` содержит строки `Forecast:` и `Fastest:` для Journal-ов fixture.
- [ ] Test `confirmationOptions` (там же): «мало данных» — без строк Budget-aware и Fastest; Run по названным — прогноз по ним.
- [ ] Unit test `chat-start`: `mode` доходит до `AutopilotStartOptions`; без него — без поля.
- [ ] Unit test `estimateAnswer` (`test/unit/autopilot-limits-estimate.test.ts`): `samples` и `durations` по Journal-ам
      test-а; Journal-ы без Wave — пустые; прежние поля — как раньше.
- [ ] e2e (`test/e2e/autopilot.spec.ts`): строка tooltip кнопки без прошлых Wave — режим и «Not enough data for a
      forecast…» (меняет ожидание `:272-275`); с пятью прошлыми Wave в `WORFY_DATA_DIR` и `limits.json` — `This Epic: …`
      и `Recommended: …`; Start window в Settings — строка окна. Снимки обеих тем в
      `.scratch/worfy-resource-planner/evidence/06/`.
- [ ] Test-ы краснеют на mutant-ах: кнопка `Cancel` перестаёт быть по умолчанию; ответ кнопки сопоставлен не тому режиму;
      tooltip берёт режим не из Settings.
- [ ] `node scripts/check-cyrillic.mjs` — exit 0.
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
