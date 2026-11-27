# 154 — Гонка в contract test-е Autopilot background-stalled: ждать таймер, а не строку journal; снять Windows exception

Type: bug
Status: claimed 2026-11-27T14:24Z
Branch: worfy-polish/154
Blocked by: —
Source: решение владельца 2026-11-26 (раунд Q1–Q12 вечернего отчёта 2026-11-25), Q9; запись Windows exception из
[worfy-polish 143](143-windows-exception-трёх-contract-test-ов.md) (PR #2208),
`test/quarantine/autopilot-faults-background-stalled-not-turn-hung.json`.

Кто: агент. Срок: до 2027-01-09 — конца Windows exception.

## Что происходит

Contract test «the silence of a background implementer after the turn stays background-stalled, not turn-hung»
(`test/contract/autopilot-faults-ladder.test.ts:369-382`) на Windows красный с первой попытки в 10 из 26 job-ов полного
набора (8 — FLAKY, зелёные только на повторе CI; 2 — красные и на повторе: `timed out waiting for run 1 to stop`,
15020 и 15015 ms). На Linux (57 job-ов) и macOS (20 job-ов) тех же run-ов он не падал ни разу. Он пропущен на Windows
записью `test/quarantine/autopilot-faults-background-stalled-not-turn-hung.json` (`kind` `windows-exception`,
до 2027-01-09).

Гонка в самом test-е. Test ждёт строку `background-tasks` в journal и конец хода всех Session
(`autopilot-faults-ladder.test.ts:373`), потом двигает часы test-а (`:375`, `:378`). Но таймер остановки run ставит
позже: строка journal пишется в очереди run-а, и `tasksTimer` взводится только после записи и только в фазе `tasks`
(`src/main/autopilot/run.ts:2657-2666`, `:3675-3703`). На медленном runner-е Windows таймер взводится после последнего
сдвига часов, не срабатывает никогда, и test ждёт остановку до своего предела.

## Что строить

1. **Ждать условие, а не момент.** Test ждёт, что таймер остановки run-а взведён на часах test-а, — например,
   `FaultClock.pending()` (`test/contract/autopilot-faults-setup.ts:214-217`) показывает таймер с `backgroundStallMs`,
   — и только потом двигает часы. Так же для первого сдвига на `QUIET_HUNG_MS + 60_000`: он проверяет, что тихий ход
   не стал `turn-hung`, и должен идти, когда таймер фоновых задач уже стоит.
2. **Код run-а не меняется**, если причина подтвердится такой: правило проекта — flaky test лечат причиной (ожидание
   условия вместо отсчёта), а не timeout-ом. Если окажется, что run и вправду может не взвести таймер, — это баг
   `src/main/autopilot/run.ts`, его чинит этот же Ticket с test-ом на него.
3. **Снять Windows exception**: удалить `test/quarantine/autopilot-faults-background-stalled-not-turn-hung.json` и
   вернуть `it(...)` вместо `quarantined('autopilot-faults-background-stalled-not-turn-hung')(...)`.
4. Предел ожидания `until` (5000 ms по умолчанию, `autopilot-faults-setup.ts:251`) и множитель timeout-ов не
   поднимаются.

## Где в коде

- `test/contract/autopilot-faults-ladder.test.ts:281` (`pause`), `:369-382` (test).
- `test/contract/autopilot-faults-setup.ts:197-217` (`FaultClock`, `pending`), `:251` (`until`), `:367` (`faultRun`).
- `test/quarantine/autopilot-faults-background-stalled-not-turn-hung.json` — удалить.
- Только читать: `src/main/autopilot/run.ts:2657-2666` (строка `background-tasks` и `tasksTimer`), `:3675-3703`
  (`tasksTimer`), `test/quarantine.ts` (виды записей).

## Решения

- Проверка на Windows — job-ы Windows CI PR (вердикт Windows — CI job). Повторять job ради зелёного нельзя.
- Доказательство, что гонка ушла: test зелёный с первой попытки во всех Windows job-ах PR; если CI даёт возможность
  прогнать файл несколько раз подряд в одном job-е без правки workflow, агент так и делает и пишет число прогонов в
  «Итог».

## Test-ы

- Сам test с ожиданием таймера. Проверка, что он ловит гонку: mutant test-а, который двигает часы до того, как таймер
  взведён (например, ожидание `pending()` убрано, а запись journal задержана в fixture), — красный.
- `test/unit/quarantine.test.ts` — зелёный после удаления записи.

## Готово, когда

- [ ] Test ждёт взведённый таймер остановки, а не строку journal; mutant без этого ожидания — красный.
  - evidence: test-run pass · `WFDELAY=1000 pnpm test <old copy> test/contract/autopilot-faults-ladder.test.ts -t background-stalled` exit 1: old copy timed out waiting for run 1 to stop, new passed; new alone with WFDELAY=3000 exit 0 · mac - · 00c947c67a910d4ce5c09e0f03318073eed2e194
- [ ] Windows exception снят: запись удалена, test объявлен через `it`.
  - evidence: commit pass · worfy-polish/154: wait for the armed stall timer before moving the clock in the background-stalled test · - - · 00c947c67a910d4ce5c09e0f03318073eed2e194
- [ ] Предел `until`, timeout-ы и множитель не изменены.
  - evidence: commit pass · worfy-polish/154: wait for the armed stall timer before moving the clock in the background-stalled test · - - · 00c947c67a910d4ce5c09e0f03318073eed2e194
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, Windows job-ы с этим test-ом —
      зелёные с первой попытки.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 00c947c67a910d4ce5c09e0f03318073eed2e194
