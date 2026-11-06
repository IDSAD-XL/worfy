# 14 — Ticket умершего Run-а остаётся `claimed`: следующий Run называет его в команде Wave

Type: task
Status: claimed 2026-11-06T08:27Z
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 14; решения владельца 2026-11-05: Q8 — Ticket перенесён из Epic-а [worfy-faults](../../worfy-faults/spec.md) (там был 09; тот Epic остаётся только test-ами), Q9 — поправка ADR-0050 входит в этот Ticket; дефект найден сценарием 1 Ticket-а [worfy-faults 03](../../worfy-faults/issues/03-убитый-orchestrator-и-упавший-implementer.md) (влит #1439), его «Итог»; [worfy-faults](../../worfy-faults/spec.md), «Вопросы владельцу», Q4 (найденный дефект — Ticket с «Инцидент»); [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md) (worfy не пишет статус Ticket-а), [ADR-0050](../../../docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md) (`resumable` после Force stop)

## Что происходит

- Сценарий 1 Ticket-а worfy-faults 03 (`test/contract/autopilot-faults-process.test.ts:82`): Claude Code Orchestrator-а умирает
  при двух живых implementer-ах, Run останавливается с `session-error`. 01 остаётся `claimed` за умершим
  implementer-ом. Новый Run шлёт Wave только с 02 (`:115-116`; `WAVE_OF_02`, `:31`; `:121`). 01 так и висит: ready
  Wave берёт только `open` Ticket-ы, и вернуть 01 в работу может только человек.
- Путь для такого Ticket-а уже есть, но только после Force stop. `resumableOf` (`src/main/autopilot/run.ts:563-568`)
  отдаёт Ticket-ы прерванной Wave (`run.interrupted`) только при `reason === 'user-force-stop'`; `run.interrupted`
  пишет только `end()` при Force stop (`run.ts:1967-1968`). Cycle передаёт Ticket-ы Wave в эффект `stopped` тоже только
  у Force stop (`src/shared/autopilot/cycle.ts:262`); `session-error` останавливает без них (`cycle.ts:265-266`).
- Новый Run того же Epic-а берёт `resumable` прошлого Run-а из `this.last` (`run.ts:870-876`) и отдаёт их первой Wave
  (`run.ts:1393-1396`, `autopilotWave`). `resumedTickets` (`src/shared/actions/render-template.ts:95-96`) оставляет из
  них те, что ещё в работе, и они попадают в текст команды Wave (`sendWave`, `src/main/actions/launch.ts:286`). Кнопка
  Autopilot считает их готовыми (`src/renderer/canvas/actions/AutopilotAction.tsx:383-384`).
- `this.last` живёт в памяти main: после перезапуска приложения `resumable` пуст (ADR-0050).

## Что делаем

1. Run, остановленный `session-error` посреди Wave, оставляет `resumable` — Ticket-ы своей последней Wave, как Force
   stop: cycle передаёт их в `stopped`, `end()` запоминает их, `resumableOf` отдаёт. Следующий Run возьмёт из них
   только те, что ещё `claimed` (`resumedTickets`).
2. Первая команда Wave следующего Run-а называет эти Ticket-ы вместе с ready Ticket-ами — тем же путём, что после
   Force stop. Orchestrator доводит их, как при возобновлении Wave (skill epic-wave, «How to resume a wave»): по
   ветке, PR и «Итог» решает, продолжить работу или отдать Ticket заново.
3. worfy статус Ticket-а сам не пишет (ADR-0002): ни `open`, ни `blocked`. Он только называет Ticket в команде Wave.
4. Поправка ADR-0050 в PR этого Ticket-а (решение владельца 2026-11-05, Q9): `resumable` остаётся и после
   `session-error` посреди Wave, не только после Force stop. По правилам ADR проекта (`rules-adr.md` в папке Profile-а)
   текст принятого ADR не переписывается: в конец `docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md`
   дописывается раздел `## Amendments` со строкой «ГГГГ-ММ-ДД — что изменилось, worfy-retry 14, PR #…». Прежний текст,
   включая отвергнутый вариант «Возобновлять любой Ticket в `work`», остаётся как был: Ticket-ы берутся только из
   последней Wave Run-а, как после Force stop.
5. `docs/features/autopilot.md`: раздел о Force stop и следующем Run (строка «The next run of the same Epic takes the
   Tickets interrupted by a Force stop…») и строка `autopilot-faults-process.test.ts` таблицы `#### Tests`. Перевод
   `docs/features/ru/` в этом PR не обязателен (ADR-0088).

Ticket перенесён в worfy-retry решением владельца 2026-11-05 (Q8): worfy-faults остаётся Epic-ом только test-ов, его
пункт «`src/` не изменён ни одним PR Epic-а» верен, и приёмка worfy-faults (Ticket 08) этот Ticket не ждёт. Ожидание
сценария 1 в test-е worfy-faults 03 меняет PR этого Ticket-а. Пункт spec-а worfy-retry «`cycle.ts` не меняется» — о
повторе хода; этот Ticket правит в `cycle.ts` только остановку `session-error`. Relaunch умершего процесса он не делает
(«Не в этом Epic-е» spec-а): он только называет Ticket-ы в команде Wave следующего Run-а.

Не входит:
- Перезапуск приложения: `resumable` в памяти, хранение в журнале отложено в ADR-0050.
- Другие причины остановки (`turn-error`, `session-closed`). Если при них Ticket-ы тоже остаются за умершими
  implementer-ами — это находка в «Итог», не правка в этом PR.

## Готово, когда

- [ ] Сценарий 1 `test/contract/autopilot-faults-process.test.ts` ждёт новое: вторая команда Wave —
      `/epic-wave Ticket-ы 01, 02 эпика demo`, `wave-started` второго Run-а — `['01', '02']`; `checkRecovery` пустой.
      Красный на нынешнем `main`, зелёный после правки.
  - evidence: test-run pass · `vitest run test/contract/autopilot-faults-process.test.ts` exit 0 (red on c0a7a766a: resumable [], exit 1) · mac - · 4a232a36b
- [ ] После `session-error` посреди Wave состояние Run-а `resumable` — Ticket-ы этой Wave; после `session-error` до
      первой Wave — как раньше.
  - evidence: test-run pass · `vitest run test/contract/autopilot-faults-process.test.ts test/unit/autopilot-cycle.test.ts` exit 0 · mac - · 4a232a36b
- [ ] Unit test cycle: `session-error` в фазах `turn` и `tasks` даёт `stopped` с Ticket-ами Wave.
  - evidence: test-run pass · `vitest run test/unit/autopilot-cycle.test.ts` exit 0 · mac - · 4a232a36b
- [ ] Force stop, graceful Stop и остальные причины остановки ведут себя как раньше: `test/contract/autopilot.test.ts`,
      `test/contract/autopilot-background.test.ts`, `test/unit/autopilot-cycle.test.ts`, `test/unit/autopilot-run.test.ts`
      зелёные без правки их ожиданий.
  - evidence: test-run pass · `vitest run test/contract/autopilot test/unit/autopilot- test/unit/canvas-actions.test.tsx` exit 0 · mac - · 4a232a36b
- [ ] worfy не пишет `Status:` Ticket-а (ADR-0002): И7 в `checkRecovery` сценария 1 пустой.
  - evidence: test-run pass · `vitest run test/contract/autopilot-faults-process.test.ts` exit 0 · mac - · 4a232a36b
- [ ] `docs/features/autopilot.md` описывает новое поведение.
  - evidence: commit pass · Autopilot: a session-error during a Wave leaves its Tickets resumable (worfy-retry 14) · - - · 4a232a36b
- [ ] ADR-0050: в конце файла раздел `## Amendments` с датированной строкой — `resumable` и после `session-error`
      посреди Wave, worfy-retry 14 и номер PR; прежний текст ADR не изменён.
- [ ] «Итог» с подразделом «Инцидент»: класс — дефект кода (процесс worfy-reliability 03), ссылки на PR #1439 и «Итог»
      Ticket-а worfy-faults 03.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Сначала падающий: сценарий 1 в `autopilot-faults-process.test.ts` с ожиданием Wave `01, 02` у второго Run-а —
  красный на нынешнем `main` (там Wave только с 02).
- Unit: `test/unit/autopilot-cycle.test.ts` — `session-error` в фазах `turn` и `tasks` даёт `stopped` с `tickets`.
- Прогнать `test/contract/autopilot*.test.ts`, `test/unit/autopilot-*.test.ts`, `test/unit/canvas-actions.test.tsx`
  (кнопка читает `resumable`).

## Где в коде

- `src/shared/autopilot/cycle.ts` — `session-error` (`:265-266`), `stop` (`:210-213`)
- `src/main/autopilot/run.ts` — `resumableOf` (`:559-569`), поле `interrupted` (`:619-620`), `end()` (`:1945-1968`),
  шапка файла о Force stop (`:46-54`)
- `src/shared/ipc/autopilot.ts` — комментарий поля `resumable` (`:59-67`)
- `test/contract/autopilot-faults-process.test.ts` — сценарий 1 (`:82-124`; ожидания `:115-121`; `WAVE_OF_02`, `:31`)
- `test/unit/autopilot-cycle.test.ts`
- `docs/features/autopilot.md`
- `docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md` — новый раздел `## Amendments` в конце файла

Только читать: `src/shared/actions/render-template.ts` (`resumedTickets`, `:95-96`), `src/main/actions/launch.ts`
(`autopilotWave`, `sendWave`, `:272-298`), `src/renderer/canvas/actions/AutopilotAction.tsx:383-384`,
`test/contract/autopilot-faults-setup.ts` (`faultRun`, `startAgain`), `harness/skills/epic-wave/SKILL.md`
(«How to resume a wave»).

## Итог

PR #1480. `session-error` после отправки Wave теперь останавливает Run так же, как Force stop, в части `resumable`:

- `src/shared/autopilot/cycle.ts` — `session-error` даёт `stopped` с Ticket-ами последней Wave (`waveOf`: копия
  `state.tickets`, `undefined` до первой Wave). Force stop берёт их через тот же `waveOf`, поведение прежнее.
- `src/main/autopilot/run.ts` — `end()` запоминает Ticket-ы в `run.interrupted` и при `session-error`; `resumableOf`
  отдаёт `run.interrupted` без своей проверки причины: её делает только `end()` (вторая проверка давала эквивалентный
  мутант). Следующий Run того же Epic-а берёт их тем же путём, что после Force stop
  (`run.resume` → `autopilotWave` → `resumedTickets`: только те, что ещё в работе).
- Журнал: `run-stopped` с `session-error` после первой Wave несёт `tickets`, как `user-force-stop`. Строку читает
  только `journal-walk.mjs`/`from-journal.ts`, и `tickets` этой строки они не используют; формат описан в
  `src/shared/autopilot/journal.ts`.
- worfy `Status:` не пишет (ADR-0002): И7 в `checkRecovery` сценария 1 пустой.
- Сценарий 1 `test/contract/autopilot-faults-process.test.ts`: после первой остановки `resumable: [1, 2]`; вторая
  команда Wave — `/epic-wave Ticket-ы 01, 02 эпика demo`, `wave-started` второго Run-а — `['01', '02']`. На
  `c0a7a766a` красный (`resumable: []`, exit 1), после правки зелёный.
- `test/unit/autopilot-cycle.test.ts` — новый test: `session-error` в фазах `turn` и `tasks` даёт `stopped` с `[1, 2]`;
  до первой Wave (`starting`, `sending`) — без `tickets`.
- ADR-0050 — раздел `## Amendments`; `docs/features/autopilot.md` — абзац о следующем Run-е, строка `run-stopped`
  таблицы журнала, строка `autopilot-faults-process.test.ts` таблицы `#### Tests`. Перевод `docs/features/ru/` — нет
  (ADR-0088).

Mutation testing изменённых строк `cycle.ts` и `run.ts` (8 мутантов; test-ы — `autopilot-cycle`, `autopilot-run`,
`autopilot-faults-process`, `autopilot.test.ts`): убито 7. Выжил один — `end()` запоминает `tickets` при любой причине:
другая причина с `tickets` только `blocked-tickets`, и ни один test не проверяет `resumable: []` после неё (такая
проверка была бы в `autopilot-faults-github.test.ts:237`, вне «Где в коде» этого Ticket-а).

Решено без владельца:

- Правлено ожидание одного прежнего case-а `test/unit/autopilot-cycle.test.ts` — «a Session in error stops the run
  with session-error and its message»: он из фазы `turn` ждал `stopped` без `tickets`, а это ровно то, что меняет
  Ticket. Остальные case-ы файла и `autopilot.test.ts`, `autopilot-background.test.ts`, `autopilot-run.test.ts` не
  правились.
- Условие для `session-error` — как у Force stop: Ticket-ы есть, если Wave уже отправлялась (`state.tickets` не пуст),
  в любой фазе, не только `turn`/`tasks`. В фазе `sending` после законченной Wave это её Ticket-ы; в работе их нет,
  и `resumedTickets` их отбрасывает.
- `src/shared/autopilot/journal.ts` (вне «Где в коде») — одна строка комментария формата `run-stopped`.

### Инцидент

- **Симптом.** Run Autopilot-а остановлен `session-error` (Claude Code Orchestrator-а умер при живых implementer-ах);
  Ticket 01 остался `claimed` за умершим implementer-ом, и следующий Run слал Wave без него — вернуть его в работу
  мог только человек.
- **Ссылки.** PR #1439 (worfy-faults 03), его «Итог»: [03-убитый-orchestrator-и-упавший-implementer.md](../../worfy-faults/issues/03-убитый-orchestrator-и-упавший-implementer.md),
  сценарий 1 `test/contract/autopilot-faults-process.test.ts`; исправление — PR #1480.
- **Воспроизведение.** На чистом `main` (`c0a7a766a`), детерминированно: сценарий 1 на fake-агенте.
- **Корневая причина.** `cycle.ts` передавал Ticket-ы Wave в `stopped`, а `run.ts` (`end()`, `resumableOf`) запоминал
  их только у Force stop; `session-error` посреди Wave оставлял `resumable` пустым.
- **Дубликат.** Нет.
- **Класс.** Дефект кода (процесс worfy-reliability 03): воспроизводится на fixture, причина — строки `src/`.
- **Вывод.** Детерминированный test — сценарий 1 `test/contract/autopilot-faults-process.test.ts` и case cycle-а
  `session-error` в фазах `turn` и `tasks` (`test/unit/autopilot-cycle.test.ts`): красный на `c0a7a766a`, зелёный
  на ветке `worfy-retry/14`. Урока нет: вывод не выходит за этот Ticket.
