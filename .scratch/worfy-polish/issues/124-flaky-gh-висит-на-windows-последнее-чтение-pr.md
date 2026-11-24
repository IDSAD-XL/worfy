# 124 — Flaky test «gh hangs the whole Run» на Windows: последнее чтение PR не дожидается test

Type: bug
Status: done 2026-11-18T05:37Z
PR: #1985
Blocked by: none
Source: три CI run-а, красный job `windows (2/3) / full-suite` (оба захода, с повтором): `main` bdd70bfe, run
44211591317 (2026-11-18); ветка `worfy-stuck-agents/03`, run 44032292083; ветка `worfy-continuity/09`, run 44236414105
(PR #1981, diff без Autopilot-а). На Mac test зелёный 5 из 5.

Кто: агент.

## Что происходит

- `test/contract/autopilot-faults-github.test.ts:156` («gh hangs the whole Run: the Waves go on, no narrow-round, the
  stop waits END_READ_MS at most, and no hung gh is left») падает на Windows с
  `Error: timed out waiting for the last read of the PRs` (ожидание `until` из `autopilot-faults-setup.ts:228-236`,
  вызов на строке 174 test-а). Оба захода (CI делает один повтор) — по 18 с, то есть до предела ожидания `until`.
- Из-за этого `ci-ok` красный на PR, которые Autopilot не трогают.

## Причина

- Test проверяет, что последнее чтение PR перед `run-stopped` ждёт зависший gh не дольше `END_READ_MS` на часах test-а.
  Ожидание на строке 174 ждёт, пока одновременно: зависший вызов gh этого чтения записал свой pid в `hang.pids`, и
  `END_READ_MS`-timer остался один (чтение Ticket-ов ответило).
- Каждому вызову gh `ghRunner` даёт `timeoutMs: GH_TIMEOUT_MS` — 500 мс × множитель 3 = 1,5 с реального времени. За эти
  1,5 с stand-in gh (скрипт под Electron с `ELECTRON_RUN_AS_NODE`) должен стартовать и записать pid, а Run — дочитать
  Ticket-ы (`readWorkflow`, процессы git). На нагруженном Windows runner-е это не успевает: `ghRunner` убивает
  stand-in раньше, чем тот записал pid, чтение PR заканчивается, и условие не выполняется никогда.
- Воспроизведено на Mac (временная правка, не в PR): задержка старта второго вызова stand-in-а на 1,7 с даёт ровно эту
  ошибку на строке 174; задержка чтения Ticket-ов на 1,6–2,5 с — падение на строке 181 (`alive(last)` — `false`).
  Гонка одна: окно test-а ограничено 1,5 с реального времени вместо условия.
- Это гонка test-а, не ошибка продукта: `src/` не меняется.

## Что делаем

1. Первый вызов gh (чтение Wave 1) по-прежнему кончается timeout-ом `ghRunner` (`GH_TIMEOUT_MS`): так test проверяет,
   что зависший gh не переживает timeout.
2. Следующим вызовам — timeout дольше любого ожидания test-а (`LATER_GH_TIMEOUT_MS`): последнее чтение PR висит, пока
   test не сдвинет часы на `END_READ_MS`, сколько бы ни стартовал stand-in и ни читались Ticket-ы.
3. `faultRun` (`autopilot-faults-setup.ts`) принимает `timeoutMs` и как функцию: она спрашивается при каждом вызове gh.
4. После остановки Run-а test сам убивает последний stand-in (SIGKILL) и ждёт, что живых stand-in-ов нет.
5. Предел ни одного test-а и ни одного ожидания не поднимается (правило «Timeout-ы test-ов не подстраивают по одному»).

## Готово, когда

- [ ] Test «gh hangs the whole Run» зелёный с задержкой старта второго вызова stand-in-а 1,7 с и 4 с и с задержкой
      чтения Ticket-ов 1,6 с и 2,5 с (временная правка, не в PR), где до исправления он красный.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-github.test.ts -t "gh hangs the whole Run"` exit 0 with EXP_STUB_SLOW=1700/4000 and EXP_SLOW=1600/2500 (temporary delay edits, reverted); exit 1 before the fix · mac - · b11ac4e27cb3ab05b55168751a558e0a3ac03b0e
  - evidence: review pass · PR #1985 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Все test-ы `test/contract/autopilot-faults-*.test.ts` зелёные; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-faults-*.test.ts test/contract/test-timeout-scale.test.ts` exit 0 · mac - · b11ac4e27cb3ab05b55168751a558e0a3ac03b0e
  - evidence: gate pass · `gate fast` exit 0 · mac - · b11ac4e27cb3ab05b55168751a558e0a3ac03b0e
  - evidence: review pass · PR #1985 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Job `windows (2/3) / full-suite` PR-а зелёный.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44243998755/job/134601622170 · ci - · c02d06a9e6d800067491f91bc707489c237e886a
- [ ] Записи карантина для этого test-а нет.
  - evidence: commit pass · worfy-polish/124: let the last gh call of the hung Run outlive the test's waits · - - · b11ac4e27cb3ab05b55168751a558e0a3ac03b0e
  - evidence: review pass · PR #1985 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590

## Где в коде

- `test/contract/autopilot-faults-github.test.ts`
- `test/contract/autopilot-faults-setup.ts`

## Вне скоупа

- Первый вызов gh того же test-а (ожидание на строке 165) в принципе подвержен той же гонке со стартом stand-in-а за
  1,5 с; в шести упавших заходах он ни разу не упал. Если упадёт — тот же приём: ждать условия, а не часов.
- Скорость старта Electron как node на Windows runner-е.
