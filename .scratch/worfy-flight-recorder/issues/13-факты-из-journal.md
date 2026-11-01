# 13 — Факты из Journal

Type: task
Status: claimed 2026-11-01T04:31Z
Blocked by: 11, 12
Source: [spec.md](../spec.md), «Модель» («Wait, блокировка, повтор», «Неполная история» — каркас Run), «Источники и что меняется в них» (строка Journal), «Ticket-ы» (13), «Соглашения для Ticket-ов этого Epic-а» (fixture ночного Run); решение 03, Q5 ([03-модель-spans.md](03-модель-spans.md)); решение 04, Q4, Q7 ([04-дыры-источников.md](04-дыры-источников.md)); решение 08, Q5 ([08-неполная-история.md](08-неполная-история.md))

## Что происходит

- После Ticket-а 11 Journal (`<data dir>/autopilot/<run>.jsonl`) знает `ticket-status`, `gate-queue-finished` и
  три необязательных поля; после Ticket-а 10 обход событий — `src/shared/flight-recorder/journal-walk.mjs`; после
  Ticket-а 12 есть модель spans (`spans.ts`).
- Виды событий Journal сейчас: `run-started`, `wave-started`, `narrow-round`, `wave-finished`, `budget-stop`,
  `limits-hit`, `waiting-until`, `resumed`, `session-error`, `refused-dialog`, `human-input`, `background-tasks`,
  `run-stopping`, `gate-queue`, `run-stopped`, `orchestrator-returned`, `tasks-killed`
  (`src/shared/autopilot/journal.ts:185`).
- Journal-ы Run-ов до этого Epic-а не имеют `ticket-status`, `gate-queue-finished` и новых полей.

## Что делаем

`src/shared/flight-recorder/from-journal.ts` — чистая функция: строки Journal одного Run → факты модели Ticket-а 12.
Journal задаёт каркас Run (решение 08, Q5).

1. **Run и Wave**: `run-started` … `run-stopped` (причина остановки), `wave-started` … `wave-finished`, номер Wave
   внутри Run, Ticket-ы Wave.
2. **Wait-ы** (решение 03, Q5): `limits` (`limits-hit` → `resumed`), `limits-budget` (`budget-stop` → `resumed`),
   `background-tasks` (из событий `background-tasks`), `gate-queue` (`gate-queue` → `gate-queue-finished`).
3. **Статусы Ticket-ов** из `ticket-status`: claim, блокировка-отметка с `reason` и `waits`, снятие, `done`.
4. **Повторы**: `narrow-round` и перезапуск после `session-error` — новая попытка `#N` со ссылкой на причину.
5. **Отметки на дорожке Orchestrator**: `refused-dialog` и `human-input` — отметки, не Wait (решение 03, Q5).
6. **Старый Journal** (без `ticket-status`): claim Ticket-а — по `wave-started`, где он назван.
7. Fixture ночного Run (соглашения spec-а): обезличенный Journal Run `2026-10-17T22-29-32-707Z-58e783`, пути
   домашней папки заменены. Ticket-ы 14–16 идут раньше (Wave 2) и могли уже положить его; тогда этот Ticket берёт
   тот же файл, иначе кладёт сам.

## Готово, когда

- [ ] Unit test на fixture ночного Run: число Wave, Ticket-ы каждой Wave, причина остановки и длительность Run
      совпадают с Journal.
- [ ] Unit test Wait-ов: по одному Run на каждую причину (`limits`, `limits-budget`, `background-tasks`,
      `gate-queue`) — span Wait с причиной, началом и концом; `gate-queue` без `gate-queue-finished` (старый
      Journal) — обрыв по правилу модели.
- [ ] Unit test статусов: `ticket-status` `claimed` → `blocked` (с `reason`, `waits`) → `claimed` → `done` дают
      claim, отметку блокировки, снятие, `done`.
- [ ] Unit test старого Journal: без `ticket-status` claim Ticket-а — время `wave-started`, где он назван.
- [ ] Unit test повторов: `narrow-round` и `session-error` с новой Wave дают `#2` со ссылкой на причину.
- [ ] Unit test: `refused-dialog` и `human-input` — отметки дорожки Orchestrator, не Wait.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/flight-recorder-journal.test.ts` (новый): fixture ночного Run и короткие Journal-ы-литералы на
  каждый случай.
- Сначала падающий: Journal с `limits-hit` и `resumed` — Wait `limits` с этими временами.
- Прогнать `test/unit/flight-recorder-*.test.ts` и `test/unit/critical-path.test.ts`.

## Где в коде

- `src/shared/flight-recorder/from-journal.ts` (новый)
- `test/unit/flight-recorder-journal.test.ts` (новый)
- `test/fixtures/flight-recorder/night-run/` — общий fixture Ticket-а 10, только читать

Только читать: `src/shared/flight-recorder/journal-walk.mjs`, `src/shared/flight-recorder/spans.ts`,
`src/shared/autopilot/journal.ts`.

## Итог

- `src/shared/flight-recorder/from-journal.ts` — чистая функция `journalFacts({ run, lines })` (from-journal.ts:123),
  без Node и DOM (test на импорты). Строки разбирает `parseJournal`, Run и Wave — `walkRun` из `journal-walk.mjs`
  (тикет 10, не изменён). Отдаёт часть `RunFacts`, которую по таблице `facts.ts` заполняет Journal: `run` (без `live`),
  `waves`, `ticketEvents` (`status`), `waits`, `retryCauses`, `orchestratorMarks`, плюс `epic`, `tickets` (все
  Ticket-ы Wave-ов), `by` и `named` из `run-started`, `text` у Wave (по нему reader 14 находит prompt Wave) и
  `skipped` — число пропущенных строк. Journal без единой читаемой строки — `null`.
- Ticket — `<epic>/<NN>`, номер как в `wave-started.tickets`: тот же ключ, что у `walkJournals` и в contract test
  reader-а 14.
- Run кончается на `run-stopped`: строки после него (background tasks, пока Run ждёт вернуть Orchestrator-а,
  `orchestrator-returned`, `tasks-killed`) — не Run-а (from-journal.ts:135), они дают только `lastSeenAt`. Строка
  другого Run (observer дописал не в тот файл) пропускается и считается (from-journal.ts:125). Исход Run — по
  причине остановки, таблица `STOP_OUTCOMES` (from-journal.ts:73) на все `AUTOPILOT_STOP_REASONS` (test сверяет
  ключи): `tickets-done`, `no-ready-wave` — `ok`; `blocked-tickets` — `blocked`; `user-stop`, `user-force-stop`,
  `app-quit` — `stopped`; ошибки, `no-progress`, `wave-unfinished`, `limits-timeout`, `background-stalled` — `failed`.
  Незнакомая причина остаётся `reason`, исход — по умолчанию модели.
- Wave без `wave-finished` (Run остановился внутри, или её сменил следующий `wave-started`) — `finishedAt: null`,
  `lastSeenAt` — её последняя строка до следующего `wave-started` или до `run-stopped` включительно.
- Wait-ы: `limits` — `limits-hit` (или одинокий `waiting-until`) → `resumed`, detail — окно и `until`;
  `limits-budget` — `budget-stop` → `resumed`, detail — причина и `until`, `tickets` — Ticket-ы следующей Wave
  (from-journal.ts:302): `budget-stop` пишется до Wave и часто в ту же миллисекунду, что `wave-finished`, а модель
  считает Wave открытой в момент её конца и иначе отдала бы Wait прошлой Wave; без следующей Wave — `[]`.
  `background-tasks` — от строки с живыми задачами до строки без них, detail — описания задач (from-journal.ts:244);
  Journal не знает, шёл ли ещё ход Orchestrator-а, поэтому Wait начинается с первой живой задачи.
  `gate-queue` → `gate-queue-finished` (from-journal.ts:255). Limits и background tasks, открытые на `run-stopped`,
  кончаются им; `gate-queue` без `gate-queue-finished` (Journal до тикета 11) остаётся открытым с `lastSeenAt` —
  последней строкой до `run-stopped`, и модель обрывает его там (`cut-off`, test через `buildTimeline`). Journal
  оборван без `run-stopped` — открытые Wait-ы с `lastSeenAt` последней строки.
- Статусы из `ticket-status` (from-journal.ts:174): время смены — `statusAt`, если это полный timestamp с зоной
  (`FULL_TIME`, from-journal.ts:97); иначе — `at` (когда worfy увидел смену). Голая дата (`2026-10-17`) и время без
  зоны момента не дают — берётся `at`. `statusAt` не позже `at`, не раньше старта Run и не раньше прошлого статуса
  этого Ticket-а: `Status:` пишет время до минуты, и без этого `blocked` мог встать раньше `claimed`. Блокировка
  с `reason` и `waits`, снятие и `done` проверены через `buildTimeline` (`blocks`, исход Ticket-а).
- Старый Journal (from-journal.ts:189) — нет ни одной строки `ticket-status` и у `run-started` нет `by` (оба
  появились в тикете 11): claim каждого Ticket-а — время первого `wave-started`, где он назван. В новом Journal claim
  по `wave-started` не ставится: Ticket без `ticket-status` весь Run не менял статус; если Run взял его уже в работе,
  claim даст первое его другое событие (правило модели, spans.ts:335). Совместно с этим правилом: событие PR до
  `wave-started` и claim старого Journal дают те же Stage, что одно событие PR, без шага назад (test).
- Повторы: `narrow-round` `started` — причина повтора агента этого Ticket-а «narrow round: <text>»;
  `session-error` — причина без Ticket-а «session-error: <message>» (как в контракте `facts.ts`). Модель ставит
  каждую на первую работу агента после неё: test через `buildTimeline` даёт `#2` со ссылкой на прошлую попытку.
  `verified` и `rejected` причиной не считаются.
- `refused-dialog` (что, агент, причина) и `human-input` (что, кто) — `orchestratorMarks`, не Wait (test).
- Fixture ночного Run уже лежал в `test/fixtures/flight-recorder/night-run/data/autopilot/` (тикет 10), новый не
  нужен. Test на нём: две Wave (03, 07 и 04, 05), `blocked-tickets`, 4 ч 48 мин 1,885 с; Journal старый — claim-ы по
  `wave-started`; Wait-ы — только `background-tasks`.
- Tests: `test/unit/flight-recorder-journal.test.ts` (26 tests). Первым был красный test Wait `limits`. 13 мутантов
  reader-а (statusAt, монотонность, старый Journal, конец `gate-queue`, обрезка после `run-stopped`, чужой Run,
  `narrow-round`, tickets у budget и др.) — все убиты.

Не проверено:
- Journal с `ticket-status` от настоящего Run: такого Run ещё нет (тикет 11 влит только что), строки в test-ах —
  литералы по формату из `src/shared/autopilot/journal.ts`.
- `session-error` «с новой Wave»: в одном Run его не бывает — `session-error` останавливает Run
  (`src/shared/autopilot/cycle.ts:262`), новая Wave идёт уже в следующем Run. Test проверяет reader на литерале с
  Wave после ошибки; в настоящем Journal причина встанет на агента, который начал работу до `run-stopped`.
- `narrow-round` пишется с опозданием до 1–2 минут после комментария, поэтому причина может встать на работу,
  начатую чуть позже, чем доработка; точного времени комментария в строке нет.
