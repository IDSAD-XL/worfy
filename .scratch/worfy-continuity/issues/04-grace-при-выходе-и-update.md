# 04 — Grace при выходе и при Update: координатор выхода, окно «Quitting worfy», `run-suspended`

Type: task
Status: claimed 2026-11-18T01:26Z
Blocked by: 02, 03
Source: [spec.md](../spec.md), «Ticket-ы», 4; «Решения по реализации» → «Grace при выходе и при Update»;
«Вопросы владельцу», Q1 и Q2 (оба — (а), решено без владельца, подтвердить); «Решено без владельца», 3;
«Решения по test-ам», Contract и Recovery invariants; «Риски», 4

Кто: агент.

Платформенный Ticket (ADR-0056, пункт 2): выключение системы — `powerMonitor` `shutdown` на macOS и Linux, `session-end`
окна на Windows; ожидание выхода процессов. Глубина ревью — `high`; снимок экрана окна.

## Что происходит

- Выход ведут независимые обработчики:
  - `before-quit` Autopilot-а останавливает каждый Run с `app-quit` и ждёт не дольше 3 с
    (`src/main/ipc/autopilot.ts:143`, `:276`, `:281`; `stopAll` — `src/main/autopilot/run.ts:1862`);
  - `before-quit` Update-а только снимает ожидание "Restart when idle" (`src/main/ipc/update.ts:374`);
  - `will-quit` закрывает Session-ы (`src/main/agent/app-registry.ts:67`) и ждёт shell-ы Terminal-а до 3 с
    (`src/main/ipc/terminal.ts:145`).
- Внешние вызовы без результата верхнего уровня уже распознаёт `externalActions`
  (`src/shared/agent/continue-plan.ts:330`); вызовы Subagent-ов (`parentToolUseId` не `null`) он пропускает (`:336`).
- Прервать turn умеет `halt()` (`src/main/agent/session.ts:540`).
- Выключение системы worfy не замечает: `powerMonitor` в `src/main` слушает только `suspend` и `resume` для Linked
  machine (`src/main/link/service.ts:1184`).
- "Restart now" у Update уходит через `src/main/update/restart.ts`; swap-helper ждёт выхода worfy до двух минут
  (`docs/features/updates.md:127–128`).

## Что делаем

1. Новый модуль `src/main/quit-grace.ts` — один координатор выхода. Встаёт первым в `before-quit`, делает
   `preventDefault` и ведёт выход по шагам:
   1. Состояние «уходим»: registry не шлёт новых сообщений, очереди держатся; Run получает событие цикла `suspend`
      (не `stop`; `src/shared/autopilot/cycle.ts`) и не начинает Wave; Auto-continue и `LimitsWait` не шлют
      продолжений.
   2. Ждёт, пока у Session-ов не останется вызовов верхнего уровня без результата (`externalActions` с
      `done: false`), не дольше 60 с. Вызовы Subagent-ов к ожиданию подключает Ticket 07 (функцией Ticket-а 16).
   3. Прерывает turn-ы (`halt()`) и ждёт выхода процессов по ADR-0064: 7,5 с, затем SIGKILL и ещё 2 с.
   4. Пишет каждому Run-у `run-suspended` (событие Ticket-а 02) с причиной `quit`, `update` или `shutdown` и отпускает
      выход. `live-sessions.json` (Ticket 03) к этому моменту уже записан наблюдателем.
2. Нынешнее ожидание `stopAll()` в `src/main/ipc/autopilot.ts` уходит: Run не останавливается, а приостанавливается.
   Новый выход `app-quit` не пишет.
3. Окно «Quitting worfy» на Dialog kit-а (`src/renderer/theme/kit/Dialog.tsx`): команды без результата, счётчик времени,
   кнопка Quit now (сразу к шагу 3). Без таких команд выход идёт сразу, без окна.
4. Выключение системы: обработчики `powerMonitor` `shutdown` (macOS, Linux) и `session-end` окна (Windows) пишут записи
   и выходят без grace.
5. "Restart now" у Update идёт через тот же координатор, причина `update`.
6. Recovery invariant И4 (`test/autopilot-invariants.ts`): выход оставляет `run-suspended`, а не `run-stopped` с
   `app-quit`.
7. Английские страницы `docs/features/autopilot-faults.md` (абзац о выходе, `:108`) и `docs/features/sessions.md`
   (выход): новое поведение; перевод — Ticket 14.

## Готово, когда

- [ ] Contract test (`faultRun()`): выход посреди Wave → в Journal-е `run-suspended` с Ticket-ами Wave, `run-stopped`
      нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-quit.test.ts` exit 0 · mac - · 513bfa31b55a135135435074b41bb925c4e8ca60
- [ ] Contract test: fake agent держит `git push` без результата → выход ждёт его, но не дольше 60 с по часам test-а;
      результат пришёл раньше — выход сразу после него; Quit now — выход сразу.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-quit.test.ts` exit 0 · mac - · 513bfa31b55a135135435074b41bb925c4e8ca60
- [ ] Contract test: выход в Wait Limits → `run-suspended` несёт Wait с его `until`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-quit.test.ts` exit 0 · mac - · 513bfa31b55a135135435074b41bb925c4e8ca60
- [ ] Contract test: без внешних вызовов выход не ждёт и окно не открывается.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-faults-quit.test.ts test/unit/quit-grace.test.ts` exit 0 · mac - · 513bfa31b55a135135435074b41bb925c4e8ca60
- [ ] Unit test шагов координатора (часы test-а): порядок «уходим» → ожидание → `halt` → записи.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/quit-grace.test.ts` exit 0 · mac - · 513bfa31b55a135135435074b41bb925c4e8ca60
- [ ] Recovery invariants (И4) обновлены и зелёные во всех Fault scenario-ах.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-invariants.test.ts test/contract/autopilot-faults-*.test.ts` exit 0 · mac - · 513bfa31b55a135135435074b41bb925c4e8ca60
- [ ] e2e test: окно «Quitting worfy» с командой fake agent-а и Quit now (рядом с `test/e2e/autopilot-faults.spec.ts`).
- [ ] Английские страницы `autopilot-faults.md` и `sessions.md` описывают grace, окно и `run-suspended`.
  - evidence: commit pass · worfy-continuity/04: one quit coordinator with a grace for external calls, «Quitting worfy», run-suspended · - - · 513bfa31b55a135135435074b41bb925c4e8ca60
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0071): job Windows в составе `ci-ok` зелёный на head PR до merge.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- Новый `test/unit/quit-grace.test.ts`; contract рядом с `test/contract/autopilot-faults-setup.ts`; e2e рядом с
  `test/e2e/autopilot-faults.spec.ts`. Каждый test сначала красный.

## Где в коде

- `src/main/quit-grace.ts` (новый)
- `src/main/ipc/autopilot.ts`
- `src/main/ipc/update.ts`
- `src/main/agent/app-registry.ts`
- `src/main/autopilot/run.ts`
- `src/shared/autopilot/cycle.ts`
- `src/main/agent/orchestrator-continue.ts`
- `src/main/update/restart.ts`
- `src/renderer/` — окно «Quitting worfy» на `src/renderer/theme/kit/Dialog.tsx`
- `test/unit/quit-grace.test.ts` (новый)
- `test/autopilot-invariants.ts`
- `docs/features/autopilot-faults.md`, `docs/features/sessions.md`

Только читать: `src/shared/agent/continue-plan.ts`, `src/main/agent/session.ts`, `src/main/ipc/terminal.ts`.

## Вне скоупа

- Ожидание вызовов Subagent-ов при выходе — Ticket 07; "Restart now" во время работы и Run в Wait у Update —
  Ticket 08; продолжение после старта — Ticket-ы 05 и 06.
