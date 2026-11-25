# 143 — Windows exception трёх contract test-ов, красных на PR #2194

Type: task
Status: done 2026-11-25T12:51Z
PR: #2208
Branch: worfy-polish/143
Blocked by: none
Source: бриф Orchestrator-а 2026-11-25: CI run 45598235951 PR #2194 (worfy-product-session 37 — правило архива и
кнопка Archive у Session Node) красный только в job-е `windows (1/3) / full-suite` (job 139150176756) на трёх
contract test-ах; правило Windows exception — `rules-merge.md` проекта, пример — Ticket worfy-polish 47.

Кто: агент. Не платформенный PR: только test-ы и записи `test/quarantine/`.

## Что происходит

PR #2194 не трогает ни Terminal, ни Autopilot (`git diff origin/main...origin/worfy-product-session/37 --name-only`
не находит `autopilot` и `terminal`), но его CI run 45598235951 красный в одном job-е Windows на трёх test-ах:

- `test/contract/terminal-windows.test.ts:287` — «closing a Terminal on Windows, on a real pty > endDescendants ends
  what is under the shell and leaves the shell»;
- `test/contract/terminal-windows.test.ts:299` — «… endDescendants ends nothing when the process with the pid of the
  shell was created after the shell was started: it is another process»;
- `test/contract/autopilot-faults-ladder.test.ts:368` — «a quiet turn of the Orchestrator (worfy-stuck-agents ticket
  09) > the silence of a background implementer after the turn stays background-stalled, not turn-hung».

Ручной повтор job-а — не путь к merge (`rules-merge.md`). Test, красный только на Windows, либо чинят, либо дают ему
Windows exception (`"kind": "windows-exception"`, owner `worfy-windows 117`, предел 30 записей, срок до 45 дней).

### Evidence: CI run-ы 2026-11-23T21:14Z … 2026-11-25T11:51Z

Просмотрены все 119 завершённых (success и failure) run-ов workflow `CI` за эти дни, на `main` и на ветках PR:
305 job-ов `windows (N/3) / full-suite`, 57 job-ов `linux-tests` и 20 `macos-tests`, в которых шёл файл
`autopilot-faults-ladder.test.ts`. «FLAKY» — test упал с первой попытки и прошёл на повторе в CI (`test/flaky.ts`).

| Test | Красный (обе попытки) | FLAKY | Зелёный с первой попытки |
| --- | --- | --- | --- |
| `terminal-windows.test.ts:287` (только Windows) | 1 из 44: 45598235951 (PR #2194, 4247c8669) | 0 | 43, в том числе `main` 45356382266, 45520869001, 45536490791 и прошлый head PR #2194 403b2b5da — 45575408703 |
| `terminal-windows.test.ts:299` (только Windows) | 1 из 44: 45598235951 (тот же job) | 0 | 43, те же run-ы |
| `autopilot-faults-ladder.test.ts:368`, Windows, после #2173 (ef7945d27, 2026-11-24T08:28Z) | 2 из 26: 45518017257 (worfy-resource-planner/13, a15e4598d), 45598235951 | 8: `main` 45356382266, 45362173673, 45450095203, 45511802931, 45527449545, 45536490791; PR 45502415204, 45575408703 | 16 |
| `autopilot-faults-ladder.test.ts:368`, Linux и macOS | 0 из 77 | 0 | 77 |

Вывод:

- Оба test-а `endDescendants` — flaky test под нагрузкой, не сломаны: прошли в 43 из 44 job-ов, на том же коде `main`
  и на прошлом head того же PR. В красном job-е весь файл шёл 45765 ms против 3.9–23.5 s в зелёных. Helper —
  PowerShell с `Get-CimInstance Win32_Process` — кончился «Command failed» без stderr. Так выглядит
  срабатывание `execFile` timeout `DESCENDANTS_TIMEOUT_MS` = 3000 (`src/main/terminal/windows-pty.ts:12`, `:237`);
  сигнала log не печатает, это гипотеза. Та же семья, что у записи `terminal-windows-close-no-console-host`
  (Ticket worfy-polish 47).
- `autopilot-faults-ladder.test.ts:368` — flaky test только на Windows: в 10 из 26 job-ов первая попытка красная, на
  Linux и macOS — ни разу. Сломанным его не назвать: 16 job-ов зелёные с первой попытки, 8 — на повторе. Ошибка обоих
  красных — `timed out waiting for run 1 to stop` (15020 ms и 15015 ms); в 45598235951 journal кончается двумя строками
  `background-tasks`, state — `running`, `backgroundTasks: 2`. Гипотеза, не установлена: test двигает fake clock,
  как только в journal есть `background-tasks` и ни одна Session не `busy`
  (`test/contract/autopilot-faults-ladder.test.ts:373`), а run ставит timer остановки `background-stalled` позже —
  через свою очередь и только в фазе `tasks` (`src/main/autopilot/run.ts:2657-2666`, `:3675-3703`). На медленном
  runner-е timer встаёт после последнего сдвига часов и не срабатывает.
- PR #2194 повлиять не мог: его diff не трогает `src/main/terminal`, `src/main/autopilot` и эти test-ы. PR
  worfy-resource-planner/13 тоже их не трогает.

## Что делаем

1. Три записи Windows exception в `test/quarantine/` — по одной на test, `platforms` `["win32"]`, owner
   `worfy-windows 117`, `since` 2026-11-25, `until` 2027-01-09 (45 дней); в `reason` — run-ы и job-ы выше, гипотеза
   причины и что пределы не подняты.
2. Метки `quarantined('<id>')` вместо `it` у трёх test-ов.
3. Timeout-ы и пределы не меняются: ни `DESCENDANTS_TIMEOUT_MS`, ни предел ожидания `until` в test-е.

## Готово, когда

- [ ] Три записи `test/quarantine/terminal-windows-end-descendants-under-shell.json`,
      `terminal-windows-end-descendants-pid-reused.json`, `autopilot-faults-background-stalled-not-turn-hung.json` —
      `"kind": "windows-exception"`, owner `worfy-windows 117`, срок в пределах 45 дней; три test-а помечены
      `quarantined('<id>')`; `test/unit/quarantine.test.ts` зелёный.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/quarantine.test.ts test/unit/quarantine-suggest.test.ts test/contract/gate-failures-report.test.ts test/contract/autopilot-faults-ladder.test.ts test/contract/terminal-windows.test.ts` exit 0 (64 passed, 14 skipped) · mac - · ac108f77926b8637245151cc86b9d7f9b9cd7259
  - evidence: review pass · PR #2208 · - - · 95919dbd056dfe9eb8fb20cf73bbb352f2ac15da
- [ ] Timeout-ы и пределы test-ов и `src/` не изменены.
  - evidence: commit pass · worfy-polish/143: Windows exceptions for three contract tests red only on Windows (no src/ change, no timeout changed) · - - · ac108f77926b8637245151cc86b9d7f9b9cd7259
  - evidence: review pass · PR #2208 · - - · 95919dbd056dfe9eb8fb20cf73bbb352f2ac15da
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · ac108f77926b8637245151cc86b9d7f9b9cd7259
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45615665811/job/139216218367 · ci - · 95919dbd056dfe9eb8fb20cf73bbb352f2ac15da

## Где в коде

- `test/quarantine/terminal-windows-end-descendants-under-shell.json` (новый)
- `test/quarantine/terminal-windows-end-descendants-pid-reused.json` (новый)
- `test/quarantine/autopilot-faults-background-stalled-not-turn-hung.json` (новый)
- `test/contract/terminal-windows.test.ts:287,299`
- `test/contract/autopilot-faults-ladder.test.ts:35,369` (в CI log до правки — `:368`)
- Только читать: `test/quarantine.ts`, `test/unit/quarantine.test.ts`, `src/main/terminal/windows-pty.ts`,
  `src/main/autopilot/run.ts`

## Вне скоупа

- Починка `autopilot-faults-ladder.test.ts:368`. Вероятная починка — test ждёт, пока run поставит timer
  `background-stalled` (признак в state или в snapshot run-а), и только потом двигает часы. Сначала гипотезу надо
  подтвердить: принудительная пауза перед `this.tasksTimer(run, true)` в `run.ts` — test красный на Mac.
- `endDescendants` под нагрузкой: если helper не успевает за 3000 ms, Terminal закрывается, а процессы под shell могут
  остаться. Это поведение продукта, не test-а; решение — у Ticket worfy-windows 117 и приёмки Windows.
