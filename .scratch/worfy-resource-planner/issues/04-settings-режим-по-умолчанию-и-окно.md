# 04 — Settings: режим по умолчанию и окно запуска

Type: task
Status: open
Branch: worfy-resource-planner/04
Blocked by: —
Source: [spec.md](../spec.md), «Термины», «Решения» (Q6′, Q14, Q15), «Режим запуска» («Выбор»), «Что видит пользователь» (Settings → Autopilot), «Не решено» (выбрано без решения, п. 3, 8), «Риски», п. 2; [ADR-0093](../../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md), п. 1

## Что происходит

- Settings → Autopilot (`src/renderer/settings/AutopilotSection.tsx`) держат budget Ticket-а 41: переключатель
  «Daily budget of the Limits» (`BUDGET_LABEL`, `:17`; `:43`) и «Reserve for your own work» (`:45`, неактивен при
  выключенном budget).
- Поле `autopilotBudget` в app settings хранит только выбранное человеком (`src/shared/settings/app-settings.ts:38-42`,
  схема выбора `:175`, умолчания `:190` — выключен, 15 %; `autopilotBudgetOf` `:308`). Main читает файл мягко: чужое
  значение — «не выбрано» (`src/main/settings/store.ts:84-87`), patch сливается по полям (`budgetChoice`, `:121`).
- Режима запуска и окна нет. Местный день budget считает через `setHours` (`localDayStart`,
  `src/shared/autopilot/budget.ts:53`).

## Что делаем

1. **Режимы.** Новый чистый модуль `src/shared/autopilot/run-mode.ts`: `RUN_MODES = ['fastest', 'budget-aware',
   'start-window']`, подписи `Fastest`, `Budget-aware`, `Start window`.
2. **Окно — расчёт.** В том же модуле: окно `{ from, to }` — целые часы местного времени (`HH:00`), `from ≠ to`,
   окно может переходить через полночь. `inWindow(now, window)`, `windowEnd(now, window)` (конец окна, внутри
   которого `now`), `nextWindowStart(now, window)` (ближайшее начало позже `now`). Через `setHours`, как
   `localDayStart`: переход на летнее время — день 23 или 25 часов, часы окна — по стенным часам.
3. **Настройка.** Новое поле app settings `autopilotRun` — только выбранное: `mode?`, `windowFrom?`, `windowTo?`;
   `autopilotRunOf(settings)` заполняет остальное: окно 23:00–07:00; режим, пока не выбран, — `budget-aware` при
   включённом budget (`autopilotBudgetOf(...).enabled`) и `fastest` при выключенном. Patch с `windowFrom = windowTo`
   отклоняется. Мягкое чтение и слияние по полям в `store.ts`, как у `autopilotBudget`.
4. **Раздел Settings → Autopilot.** Строки `Default run mode` (Select, описания режимов — spec), `Start window from`,
   `Start window to` (Select по часам `00:00` … `23:00`; неактивны, пока режим по умолчанию не Start window).
   Reserve активен и при режиме по умолчанию Budget-aware. Выбор окна, равный другому краю, не сохраняется, строка
   `Not saved: …` говорит почему.

## Готово, когда

- [ ] Unit test `run-mode`: 23:00–07:00 — 22:59 вне, 23:00 внутри, 06:59 внутри, 07:00 вне; `windowEnd` в 01:00 — 07:00
      следующего утра; `nextWindowStart` в 08:00 — 23:00 того же дня, в 23:30 — 23:00 следующего дня; 09:00–17:00 без
      перехода через полночь; дни перехода на летнее и зимнее время в `TZ=Europe/Kyiv` — начало и конец по стенным часам.
- [ ] Unit test `autopilotRunOf`: ничего не выбрано и budget выключен — `fastest`, 23:00–07:00; budget включён —
      `budget-aware`; выбор сохраняется после смены умолчаний.
- [ ] Contract test `app-settings`: patch `autopilotRun` сливается по полям; `windowFrom = windowTo` отклонён; чужое
      значение в файле — «не выбрано», остальной файл цел.
- [ ] Unit test раздела (`settings-autopilot.test.tsx`): три строки, Select окна неактивны вне Start window, reserve
      активен при Budget-aware и выключенном переключателе.
- [ ] e2e (`test/e2e/settings.spec.ts`): выбор Start window и окна 22:00–06:00 переживает перезапуск приложения; снимки
      обеих тем в `.scratch/worfy-resource-planner/evidence/04/`.
- [ ] Test-ы краснеют на mutant-ах: `<` вместо `≤` на начале окна; умолчание режима не смотрит на budget; окно без
      перехода через полночь.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (e2e по таблице).

## Тесты

- Unit `test/unit/autopilot-run-mode.test.ts` (новый), `test/unit/settings-autopilot.test.tsx`.
- Contract `test/contract/app-settings.test.ts`.
- e2e `test/e2e/settings.spec.ts`.
- Сначала падающий: `inWindow` в 06:59 для 23:00–07:00.
- Прогнать `test/unit/settings-plan.test.tsx`, `test/unit/plan-preset.test.ts`, `test/contract/plan-preset.test.ts`
  (preset Pro включает budget, а значит меняет режим по умолчанию, пока он не выбран).

## Где в коде

- `src/shared/autopilot/run-mode.ts` (новый)
- `src/shared/settings/app-settings.ts` — комментарий поля `:38-42`, `autopilotBudgetChoiceSchema` `:175`,
  `AUTOPILOT_BUDGET_DEFAULTS` `:190`, `appSettingsSchema` `:220`, patch `:255`, `autopilotBudgetOf` `:308`
- `src/main/settings/store.ts` — мягкое чтение `:84-87`, `budgetChoice` `:121`, patch `:196`
- `src/renderer/settings/AutopilotSection.tsx` — `:17-18`, `:43`, `:45`
- `test/unit/autopilot-run-mode.test.ts` (новый), `test/unit/settings-autopilot.test.tsx`,
  `test/contract/app-settings.test.ts`, `test/e2e/settings.spec.ts`

Только читать: `src/shared/autopilot/budget.ts` (`localDayStart` `:53`, `nextLocalDayStart` `:60`),
`src/shared/agent/plan-preset.ts`.
