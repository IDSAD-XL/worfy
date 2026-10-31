# 20 — Входы и toast при остановке

Type: task
Status: open
Blocked by: 18, 21
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 1, 2, 7, «Экран» («Входы»; `run` и счёт Ticket-ов в `AutopilotState`), «Ticket-ы» (20), «Готово, когда» (toast, «History», «Run history», «Open Run history»); решение 06, Q1–Q3 ([06-предложение-после-остановки-и-прошлые-run.md](06-предложение-после-остановки-и-прошлые-run.md)); решение 09, Q1 ([09-что-значит-autopilot-из-чата.md](09-что-значит-autopilot-из-чата.md))

## Что происходит

- После Ticket-а 18 вид `history` открывает `openRunHistory(projectId, run?, epic?)`
  (`src/renderer/flight-recorder/open.ts`); входов в него нет.
- `AutopilotState` (`src/shared/ipc/autopilot.ts`, схема — `autopilotStateSchema`) знает причину остановки
  (`reason`) и Ticket-ы в работе, но не id Run и не счёт Ticket-ов при остановке.
- Строка статуса Autopilot — `src/renderer/canvas/actions/AutopilotAction.tsx`; меню «⋯» на рамке Epic с Force
  stop — `src/renderer/canvas/actions/action-menu.ts`; команды Command palette — `src/renderer/palette/commands.ts`.
- Action toast — `showToast` (`src/renderer/toast/toasts.ts`): один toast на `key`, тот же `key` заменяет его.
- После Ticket-а 21 Run, начатый из чата, — тот же `Autopilot.start` с той же остановкой.

## Что делаем

1. **`AutopilotState`** получает `run` (id) и счёт Ticket-ов при остановке (`done`, `blocked`); пишет main
   (`src/main/autopilot/run.ts`).
2. **Toast при остановке Run по любой причине** (`stop-toast.ts`): «Run stopped: <reason> · N done, M blocked ·
   <duration>» и кнопка «Open history» (`openRunHistory(projectId, run)`). Не исчезает сам, пока не закроют; один на
   Run (`key` — run id). Одинаково для Run с кнопки и из чата. Уведомлений ОС нет (решение 06, Q3).
3. **«History»** в строке статуса Autopilot над кнопкой — до следующего Run; открывает историю этого Run.
4. **«Run history»** в меню «⋯» Autopilot на рамке Epic (рядом с Force stop) — вид с фильтром по этому Epic.
5. **«Open Run history»** в Command palette — вид с последним Run Project-а.

Вид Ticket-а 18 этот Ticket не правит: открывает его через `open.ts`.

## Готово, когда

- [ ] Unit test `stop-toast`: состояние `stopped` с `run`, причиной, счётом и длительностью даёт текст
      «Run stopped: blocked-tickets · 5 done, 1 blocked · 4 h 48 min» и кнопку «Open history»; toast без
      таймера; второе состояние того же Run не даёт второго toast (тот же `key`).
- [ ] Unit test `palette-commands`: команда «Open Run history» есть и зовёт `openRunHistory` с Project-ом.
- [ ] e2e `autopilot.spec.ts` (`WORFY_AGENT=fake`): Run остановился — toast с итогом; через минуту он на месте;
      «Open history» открывает вид этого Run; «History» в строке статуса ведёт туда же и пропадает со стартом
      следующего Run.
- [ ] e2e: «Run history» в меню «⋯» на рамке Epic открывает вид с фильтром по Epic; «Open Run history» из Command
      palette открывает вид.
- [ ] e2e: Run из чата (после Ticket-а 21) при остановке даёт такой же toast.
- [ ] Снимки в светлой и тёмной теме в `.scratch/worfy-flight-recorder/evidence/20/`: toast, «History» в строке
      статуса, пункт меню «⋯», команда в Command palette.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (e2e по таблице).

## Тесты

- Unit `test/unit/flight-recorder-stop-toast.test.ts` (новый).
- Unit `test/unit/palette-commands.test.tsx`.
- e2e `test/e2e/autopilot.spec.ts`.
- Сначала падающий: unit test `stop-toast` — в `AutopilotState` нет `run`, toast не строится.
- Прогнать все unit и contract test-ы модуля Autopilot (`test/unit/autopilot-*.test.ts`,
  `test/contract/autopilot*.test.ts`) и `test/unit/canvas-actions.test.tsx`, `test/unit/toasts.test.ts`.

## Где в коде

- `src/renderer/flight-recorder/stop-toast.ts` (новый)
- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `src/renderer/canvas/actions/action-menu.ts` — пункт «Run history» (spec называет его в «Входы», но не в списке
  файлов Ticket-а)
- `src/renderer/palette/commands.ts`
- `src/shared/ipc/autopilot.ts`
- `src/main/autopilot/run.ts`
- `test/unit/flight-recorder-stop-toast.test.ts` (новый)
- `test/unit/palette-commands.test.tsx`
- `test/e2e/autopilot.spec.ts`

Только читать: `src/renderer/flight-recorder/open.ts`, `src/renderer/toast/toasts.ts`.
