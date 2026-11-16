# 09 — `turn-hung` в Autopilot: замолчавший ход останавливает Run, ничего не прерывая

Type: task
Status: open
Blocked by: 03, 08
Source: [spec.md](../spec.md), «Ticket-ы», 9; «Решение», 2; «Путь пользователя», B, шаг 3; «Решения по реализации» →
«Признаки жизни Session и тишина», пункты «Пороги» и «`turn-hung` в Autopilot»; «Решения по test-ам», Fault scenario 7;
«Вопросы владельцу», 3 (ответ (а)); «Решено без владельца», 7

Кто: агент.

Не платформенный Ticket (цикл и main process Autopilot). Глубина ревью — `high`.

## Что происходит

- У фазы `turn` цикла нет таймера: из неё выводят только конец хода, ошибка, закрытие Session и Stop
  (`src/shared/autopilot/cycle.ts:101`; вход — `wave-sent`, `:302–305`; конец хода — `:311–319`; остановки —
  `:283–292`).
- После Ticket-а 03 Session знает `quietSince` — с какого момента ход без признаков жизни (`src/shared/agent/quiet.ts`).
- Остановка по любой причине, кроме Stop человека, отдаёт Session человеку: ход не прерван, background tasks живут
  (`docs/features/autopilot-faults.md:111–120`, «After any other stop»; ADR-0050).
- Run двигает таймеры test-ов через deps, как `settleMs` и `backgroundStallMs` (`src/main/autopilot/run.ts:402–403`,
  `:439–440`).

## Что делаем

1. Цикл: событие `turn-quiet` в фазе `turn` → `stop(state, 'turn-hung')`; в других фазах — без изменений. Причина
   `turn-hung` — в `AUTOPILOT_STOP_REASONS` (`cycle.ts:52`) и в `STOP_OUTCOMES` как `failed`
   (`src/shared/flight-recorder/from-journal.ts:148`).
2. Run: порог `QUIET_HUNG_MS` = 30 минут рядом с `SETTLE_MS` (`cycle.ts:78`), dep `quietHungMs`; пока цикл в фазе `turn`,
   Run следит за `quietSince` Session Orchestrator-а и при тишине дольше порога шлёт циклу `turn-quiet`.
3. Остановка `turn-hung` идёт по правилу «After any other stop»: ход не прерывается, процесс не перезапускается,
   background tasks живут. Тишина background implementer-а — не `turn-hung` (это `background-stalled`, Ticket 08).
4. Слова Run history для `turn-hung` — `src/renderer/flight-recorder/span-words.ts`.
5. `docs/features/autopilot-faults.md`: строка `turn-hung` таблицы «Why a run stops».

## Готово, когда

- [ ] Unit test `test/unit/autopilot-cycle.test.ts`: `turn-quiet` в фазе `turn` — `stop` `turn-hung`; в фазах `settling`
      и `tasks` — без изменений.
- [ ] Unit test `test/unit/flight-recorder-journal.test.ts`: `turn-hung` даёт исход `failed`.
- [ ] Fault scenario 7 (contract): ход fake agent без признаков жизни дольше порога test-а → `run-stopped` `turn-hung`;
      Interrupt не вызывался, процесс Session тот же, background task жива, Session снова attended.
- [ ] Fault scenario 7 на Codex (`test/contract/autopilot-faults-codex.test.ts`).
- [ ] Fault scenario: ход с открытым запросом разрешения или идущим hook-ом дольше порога — `turn-hung` нет.
- [ ] И1–И9 держатся (`test/autopilot-invariants.ts`).
- [ ] Unit test `span-words`: слова для `turn-hung`.
- [ ] `docs/features/autopilot-faults.md` описывает `turn-hung`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- `test/unit/autopilot-cycle.test.ts`, `test/unit/flight-recorder-journal.test.ts`, Fault scenarios в
  `test/contract/autopilot-faults-ladder.test.ts` и `test/contract/autopilot-faults-codex.test.ts`, unit test
  `span-words` — каждый новый test сначала красный.

## Где в коде

- `src/shared/autopilot/cycle.ts`
- `src/shared/flight-recorder/from-journal.ts`
- `src/main/autopilot/run.ts`
- `src/renderer/flight-recorder/span-words.ts`
- `test/unit/autopilot-cycle.test.ts`
- `test/unit/flight-recorder-journal.test.ts`
- `test/contract/autopilot-faults-ladder.test.ts`
- `test/contract/autopilot-faults-codex.test.ts`
- `test/fixtures/agent-scripts/`
- `docs/features/autopilot-faults.md`

Только читать: `src/shared/agent/quiet.ts` (Ticket 03), `src/main/agent/session.ts`,
`docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md`.

## Вне скоупа

- Автоматический Interrupt замолчавшего хода — только при ответе (б) на вопрос 3 spec-а, с Amendment-ом к ADR-0050.
- Пометка тишины в UI — Ticket-ы 04 и 06.
