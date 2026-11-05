# 09 — Ticket умершего Run-а остаётся `claimed`: следующий Run называет его в команде Wave

Type: task
Status: open
Blocked by: 03
Source: [spec.md](../spec.md), «Решено без владельца», п. 6, и «Вопросы владельцу», Q4 (найденный дефект — новый Ticket Epic-а с «Инцидент»); «Итог» [Ticket-а 03](03-убитый-orchestrator-и-упавший-implementer.md), сценарий 1; решение владельца 2026-11-05; [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md) (worfy не пишет статус Ticket-а), [ADR-0050](../../../docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md) (`resumable` после Force stop)

## Что происходит

- Сценарий 1 Ticket-а 03 (`test/contract/autopilot-faults-process.test.ts:82`): Claude Code Orchestrator-а умирает
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
4. Поправка ADR-0050 (`resumable` и после `session-error`) — у Orchestrator-а, по `rules-adr.md`.
5. `docs/features/autopilot.md`: раздел о Force stop и следующем Run (строка «The next run of the same Epic takes the
   Tickets interrupted by a Force stop…») и строка `autopilot-faults-process.test.ts` таблицы `#### Tests`. Перевод
   `docs/features/ru/` в этом PR не обязателен (ADR-0088).

Ticket правит `src/` — по решению владельца 2026-11-05 (дефект чинит новый Ticket этого Epic-а, Q4 (а)). Пункт spec-а
«`src/` не изменён ни одним PR Epic-а» и третий пункт «Готово, когда» Ticket-а 08 с этим PR расходятся: формулировку
уточняет Orchestrator при приёмке.

Не входит:
- Перезапуск приложения: `resumable` в памяти, хранение в журнале отложено в ADR-0050.
- Другие причины остановки (`turn-error`, `session-closed`). Если при них Ticket-ы тоже остаются за умершими
  implementer-ами — это находка в «Итог», не правка в этом PR.

## Готово, когда

- [ ] Сценарий 1 `test/contract/autopilot-faults-process.test.ts` ждёт новое: вторая команда Wave —
      `/epic-wave Ticket-ы 01, 02 эпика demo`, `wave-started` второго Run-а — `['01', '02']`; `checkRecovery` пустой.
      Красный на нынешнем `main`, зелёный после правки.
- [ ] После `session-error` посреди Wave состояние Run-а `resumable` — Ticket-ы этой Wave; после `session-error` до
      первой Wave — как раньше.
- [ ] Unit test cycle: `session-error` в фазах `turn` и `tasks` даёт `stopped` с Ticket-ами Wave.
- [ ] Force stop, graceful Stop и остальные причины остановки ведут себя как раньше: `test/contract/autopilot.test.ts`,
      `test/contract/autopilot-background.test.ts`, `test/unit/autopilot-cycle.test.ts`, `test/unit/autopilot-run.test.ts`
      зелёные без правки их ожиданий.
- [ ] worfy не пишет `Status:` Ticket-а (ADR-0002): И7 в `checkRecovery` сценария 1 пустой.
- [ ] `docs/features/autopilot.md` описывает новое поведение.
- [ ] «Итог» с подразделом «Инцидент»: класс — дефект кода (процесс worfy-reliability 03), ссылки на PR #1439 и «Итог»
      Ticket-а 03.
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

Только читать: `src/shared/actions/render-template.ts` (`resumedTickets`, `:95-96`), `src/main/actions/launch.ts`
(`autopilotWave`, `sendWave`, `:272-298`), `src/renderer/canvas/actions/AutopilotAction.tsx:383-384`,
`test/contract/autopilot-faults-setup.ts` (`faultRun`, `startAgain`), `harness/skills/epic-wave/SKILL.md`
(«How to resume a wave»).
