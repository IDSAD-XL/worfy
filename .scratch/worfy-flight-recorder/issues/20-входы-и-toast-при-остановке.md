# 20 — Входы и toast при остановке

Type: task
Status: claimed 2026-11-01T14:19Z
Branch: worfy-flight-recorder/20
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

- [x] Unit test `stop-toast`: состояние `stopped` с `run`, причиной, счётом и длительностью даёт текст
      «Run stopped: blocked-tickets · 5 done, 1 blocked · 4 h 48 min» и кнопку «Open history»; toast без
      таймера; второе состояние того же Run не даёт второго toast (тот же `key`).
- [x] Unit test `palette-commands`: команда «Open Run history» есть и зовёт `openRunHistory` с Project-ом.
- [x] e2e `autopilot.spec.ts` (`WORFY_AGENT=fake`): Run остановился — toast с итогом; через минуту он на месте;
      «Open history» открывает вид этого Run; «History» в строке статуса ведёт туда же и пропадает со стартом
      следующего Run.
- [x] e2e: «Run history» в меню «⋯» на рамке Epic открывает вид с фильтром по Epic; «Open Run history» из Command
      palette открывает вид.
- [x] e2e: Run из чата (после Ticket-а 21) при остановке даёт такой же toast.
- [x] Снимки в светлой и тёмной теме в `.scratch/worfy-flight-recorder/evidence/20/`: toast, «History» в строке
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

## Итог

Сделано (PR — см. ветку `worfy-flight-recorder/20`):

- `AutopilotState` получил `run` (id Journal-а, `runIdSchema`) и `ended` — `at`, `duration`, `done`, `blocked` (`src/shared/ipc/autopilot.ts:97`, `:104`). `resumable` теперь `ticketNumSchema` (долг #1185, `:67`).
- Main пишет их в `snapshot` (`src/main/autopilot/run.ts:2023`). Время остановки — `run.stoppedAt` в `end()` (`:1805`). Счёт — Ticket-ы Wave этого Run (`waveTickets`) по последнему чтению статусов (`waveTicketCounts`, `:518`): после Stop и прочих причин это чтение перед `run-stopped`, после Force stop и app-quit — последнее чтение watch. Tests: `test/unit/autopilot-run.test.ts`, describe «the state names the run…».
- Toast при остановке — `src/renderer/flight-recorder/stop-toast.ts:48`: action toast «Run stopped: <reason> · N done, M blocked · <duration>» и «Open history». Сам не исчезает, `key` — `run-stopped:<run id>`, один на Run в окне. Показывается только в своём Project-е. Не показывается для Run, остановленного до открытия окна: main шлёт старое stopped-состояние снова при новом ответе Harness mark. Подписка — `installStopToasts` в `src/renderer/main.tsx:112`. Opener экрана передаётся аргументом, чтобы модуль читался в Node test-е. Покрыты все причины `AUTOPILOT_STOP_REASONS`, включая `window-too-short` (`test/unit/flight-recorder-stop-toast.test.ts`, `it.each`).
- «History» справа от строки статуса остановленного Run этого Epic (`AutopilotAction.tsx:427`, `:463`): открывает этот Run и пропадает со стартом следующего.
- «Run history» в «⋯» (`AutopilotAction.tsx:400`): вид с фильтром по Epic. «⋯» теперь есть всегда, когда есть кнопка Autopilot; Force stop в нём только пока Run этого Epic идёт. Пункт активен и на read-only экране. Обновлены F-SPEC (раздел Autopilot и «Entries» в Run history) и прежние test-ы, ждавшие отсутствия «⋯» после остановки.
- «Open Run history» в Command palette, группа View (`src/renderer/palette/commands.ts:396`): последний Run активного Project-а.
- Таблица e2e: правило `src/renderer/flight-recorder/**` теперь гоняет и `autopilot.spec.ts`, `autopilot-chat.spec.ts` (`scripts/e2e-specs.table.json`). `stop-toast.ts` добавлен в `tsconfig.test.node.json`.
- Комментарии про `resumable` в `AutopilotAction.tsx` (долг #1185) исправлены.

Проверки: `pnpm lint`, `pnpm typecheck`, unit и contract test-ы Autopilot и flight-recorder, `canvas-actions`, `toasts`, `palette-commands`, `critical-path` — exit 0. e2e `autopilot.spec.ts`, `autopilot-chat.spec.ts`, `flight-recorder.spec.ts` — exit 0. Новый e2e (`test/e2e/autopilot.spec.ts:412`) проверяет toast со счётом «1 done, 1 blocked», сдвигает часы окна на минуту (`clock.fastForward`), открывает Run из toast-а, «History», «⋯ → Run history» (с «Epic filter»), palette, сравнивает со вторым Project-ом (toast скрыт, palette открывает его пустую историю) и проверяет, что «History» пропадает со стартом следующего Run. Контраст текста toast-а, «Open history» и «History» в обеих темах — не меньше 4.5:1. Run из чата даёт тот же toast (`test/e2e/autopilot-chat.spec.ts:246`).

Mutants: 17 unit mutants (toast без таймера, один на Run, граница окна, формат длительности, run в «Open history», projectId toast-а; счёт только Ticket-ов Wave, `run` в состоянии, длительность, blocked против done; «History» только после остановки, Epic в «Run history», Run в «History», «Run history» на read-only, «Run history» без Run; команда palette) — убиты все. e2e mutant: toast вида `info` — убит.

Снимки (обе темы): [toast](../evidence/20-toast-light.png) ([dark](../evidence/20-toast-dark.png)), [«History»](../evidence/20-status-history-light.png) ([dark](../evidence/20-status-history-dark.png)), [меню «⋯»](../evidence/20-menu-light.png) ([dark](../evidence/20-menu-dark.png)), [Command palette](../evidence/20-palette-light.png) ([dark](../evidence/20-palette-dark.png)). Ticket просил папку `evidence/20/`, бриф — `evidence/20-*.png`: взято по брифу.

Не проверено:
- CI PR — после открытия PR.
- Окно на Linked machine с часами, отстающими больше, чем на возраст окна, не покажет toast (`shortcut:` в `stop-toast.ts`).
- После перезапуска приложения «History» не показывается: последнее состояние Run хранится в памяти main.
- `docs/features/` не правился: его в этой Wave правит Resource Planner 10. Описание входов — задача Ticket-а 24.
