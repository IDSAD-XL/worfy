# 02 — Journal как checkpoint Run-а: `run-suspended`, `run-continued`, `resumable` из Journal-а

Type: task
Status: claimed 2026-11-17T23:32Z
Blocked by: none
Source: [spec.md](../spec.md), «Ticket-ы», 2; «Решения по реализации» → «Journal Run-а — его checkpoint»;
«Решения по test-ам», Unit и Recovery invariants; «Риски», 7

Кто: агент.

Не платформенный Ticket (чистые модули и main process). Глубина ревью — `high`.

## Что происходит

- `resumable` — Ticket-ы, которые следующий Run продолжит сам, — живёт в памяти main: Run берёт его из `last`
  (`src/main/autopilot/run.ts:1185`), состояние отдаёт его в `resumable` (`:3598`). После перезапуска список пуст
  (`docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md:67`); хранить его в Journal-е ADR-0050 отложил (`:86`).
- Поле `interrupted` заполняется только при `user-force-stop` и `session-error` (`src/main/autopilot/run.ts:3080`).
- Событий приостановки и продолжения в Journal-е нет: список событий — `src/shared/autopilot/journal.ts:569–623`.
  Имя `resumed` занято концом Wait-а Limits (`:600`).
- Чтение Journal-а пропускает строку незнакомого вида и рваную последнюю строку и считает их (`journal.ts:403–404`;
  `parseJournal` — `:900`).
- Journal дописывается одним `appendFile` (O_APPEND): `src/main/autopilot/journal.ts:6`, `:84`.
- После падения Flight Recorder даёт Run-у без `run-stopped` исход `cut-off` (`src/shared/flight-recorder/facts.ts:22`).

## Что делаем

1. Новые события в `src/shared/autopilot/journal.ts`:
   - `run-suspended {cause: quit | update | shutdown, wave, tickets, wait}` — Ticket-ы Wave в работе и открытый Wait с
     его `until`;
   - `run-continued {after: quit | update | shutdown | crash}`.
2. Чистый reader `src/shared/autopilot/checkpoint.ts` поверх `parseJournal`: Epic-и и очередь (`run-started`,
   `queue-changed`, `epic-started`, `epic-finished`), названные Ticket-ы, Run mode, Vendor, Auto-approval, номер Wave,
   Ticket-ы Wave в работе (`wave-started`, `ticket-status`), `resumable`, открытый Wait (`waiting-until`,
   `start-window`, `budget-stop`, `limits-hit`), счёт повторов (`turn-retry`) и счёт лестницы застрявших Ticket-ов
   (`ticket-continued`, `ticket-set-aside` — их ввёл worfy-stuck-agents после черновика spec-а).
3. Run оборван, если последняя строка его Journal-а — `run-suspended` или `run-stopped` нет вовсе. Reader это говорит
   полем, а не догадкой вызывающего.
4. `resumable` берётся из checkpoint, а не из `last` в памяти (`run.ts:1185`). Для Run-ов этого запуска worfy
   поведение не меняется.
5. Причина остановки `discarded` (к списку в `src/shared/autopilot/cycle.ts:86`): Ticket-ы Wave в работе становятся
   `resumable`, как после Force stop. `app-quit` остаётся для старых Journal-ов.
6. Test: `parseJournal` пропускает незнакомое событие — сборка старее после отката на `worfy-stable.previous` читает
   новые Journal-ы (риск 7).
7. Страница `docs/features/autopilot-faults.md` (английская): причина `discarded` в таблице причин и новые строки
   Journal-а; перевод — Ticket 14.

## Готово, когда

- [ ] Unit test `checkpoint.ts` на fixture-Journal-ах в `test/fixtures/autopilot-faults/`: Run, приостановленный
      посреди Wave; в Wait Limits; в Wait Start window; Run без конца после падения; с рваной последней строкой; после
      Discard. Каждый — ожидаемое состояние и признак «оборван».
- [ ] Unit test: `resumable` после Force stop одинаков из памяти и из checkpoint (тот же fixture).
- [ ] Unit test: `parseJournal` пропускает строку незнакомого вида и считает её.
- [ ] Contract test (`faultRun()`, `test/contract/autopilot-faults-setup.ts`): Run после Force stop, затем новый
      `Autopilot` над тем же Journal-ом — следующий Run Epic-а берёт `resumable` из checkpoint.
- [ ] Recovery invariants (`test/autopilot-invariants.ts`, `checkRecovery`) зелёные на новых fixture-ах.
- [ ] Английская страница `docs/features/autopilot-faults.md` называет `discarded`, `run-suspended` и
      `run-continued`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- Новый `test/unit/autopilot-checkpoint.test.ts`; fixture-Journal-ы в `test/fixtures/autopilot-faults/`; contract рядом
  с `test/contract/autopilot-faults-setup.ts`. Каждый test сначала красный.

## Где в коде

- `src/shared/autopilot/journal.ts`
- `src/shared/autopilot/checkpoint.ts` (новый)
- `src/shared/autopilot/cycle.ts`
- `src/main/autopilot/run.ts`
- `test/fixtures/autopilot-faults/` (новые fixture-ы)
- `test/unit/autopilot-checkpoint.test.ts` (новый)
- `test/autopilot-invariants.ts`
- `docs/features/autopilot-faults.md`

Только читать: `src/main/autopilot/journal.ts`, `src/shared/flight-recorder/facts.ts`.

## Вне скоупа

- Запись `run-suspended` при выходе — Ticket 04; продолжение Run-а по checkpoint — Ticket 06; Span Wait-а `restart` —
  Ticket 09.
