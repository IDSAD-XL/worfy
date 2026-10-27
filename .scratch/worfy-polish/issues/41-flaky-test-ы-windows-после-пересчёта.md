# 41 — Flaky test-ы Windows после пересчёта 2026-10-23: 2 e2e и 5 unit/contract, красные только под нагрузкой или изредка

Type: task
Status: blocked
Blocked reason: нужен Windows-ПК; ПК на паузе до слова владельца
Waits: owner
Blocked by: —
Source: пересчёт на ПК владельца 2026-10-23 (e2e на main `f8ada2a3`, unit и contract на main `bc19f2f7`,
масштаб 150 %; `C:/Users/Alexey/worfy-wt/recount/summary.md` на ПК), решение владельца 2026-10-23 по отсечке
`worfy-windows`: flaky test-ы выходят из Epic-а одним Ticket-ом `worfy-polish`. Красные, которые повторяются
каждый раз, — в `worfy-windows` 106 и 109–112. Строки — по main `cf5adbf2`. Правка 2026-10-28
([spec `worfy-throughput`](../../worfy-throughput/spec.md), раздел «Решения владельца 2026-10-28: процесс»):
`workflow-reader` и `workflow-branches-handles` краснеют и на GitHub Windows-runner-е и перешли в
`worfy-throughput` [23](../../worfy-throughput/issues/23-flaky-test-ы-windows-видные-на-runner-е.md); добавлены
красные на ПК 2026-10-27; Ticket ждёт ПК; запись карантина (`worfy-throughput` 20) может называть его владельцем.

## Что происходит

Каждый из test-ов ниже был красным хотя бы раз 2026-10-23 и зелёным в других прогонах того же main. Ни один не
красный в тихом повторе (без другой нагрузки на ПК), кроме `epic-frame-undo` (2 из 3).

e2e (`pnpm exec playwright test --grep-invert @packaged`):
- `test/e2e/epic-frame-undo.spec.ts:125` («⌘Z puts a frame dragged by its header back…»): клик по
  «Collapse epic demo» (`:163`) — `Timeout 30000ms exceeded`, кнопка найдена (`aria-expanded="true"`), но
  клик не прошёл. Красный 2 из 3 на main.
- `test/e2e/projects-connect.spec.ts:217` («the GitHub account: the active account with access by default…»):
  `the app did not quit within 20 s and was killed` (`test/e2e/helpers.ts:276-278`). Только в пересчёте, в
  обоих gate full зелёный.

unit и contract (`pnpm test`; красные только в полном прогоне, когда параллельно идут другие файлы):
- ~~`test/contract/workflow-reader.test.ts`~~ и ~~`test/contract/workflow-branches-handles.test.ts`~~ — перешли
  в `worfy-throughput` 23 (правка 2026-10-28).
- `test/contract/shell.test.ts:293` («on darwin asks about every known launcher kind, in either letter
  case»).
- `test/contract/harness-evals-outcome.test.ts` — таймауты `beforeAll` (hook 300 s) и одного test-а на 60 s;
  в одном полном прогоне из трёх.
- `test/contract/terminal.test.ts:185` — после `closeAll()` pid-ы pty ещё живы (`[false, false, false]`
  ожидалось); в одном gate.

Добавлено 2026-10-28 (ПК, 3+3 run-а на main под нагрузкой 2026-10-27; разбор красных run-ов Windows):
- `test/contract/terminal.test.ts` — конец shell через PowerShell в `wireRegistry`; «one Terminal on several
  screens»; «Restart from A» (один раз при CPU 46 %).
- `harness/bin/tests/wave-gate-lock.test.sh` — случаи токена замка e2e, один раз красные на Windows (run PR #861).

## Что делаем

Для каждого — причина, потом правка причины. Правило владельца: таймаут или порог одного test-а не
подбирать. Если test честно требует больше времени — один общий множитель, цена называется заранее.

1. Повторить каждый test под той же нагрузкой, что в полном прогоне (`pnpm test` целиком или файл вместе с
   параллельными соседями), и в тишине; записать, сколько раз из скольких красный.
2. Временные границы (`harness-evals-outcome`): мерить время своей работы, а не время стены,
   если test проверяет скорость кода, а не машины.
3. Занятые файлы и живые процессы (`terminal.test.ts`, `projects-connect`): найти,
   кто держит файл или процесс, и ждать его завершения в коде, а не по времени.
4. Клики e2e (`epic-frame-undo`): снимок и трассировка при падении — что перекрывает кнопку.

## Готово, когда

- [ ] Для каждого test-а в «Итог» — сколько раз красный до правки, причина, правка.
- [ ] На ПК полный `pnpm test` — код 0 в 2 прогонах подряд; e2e `epic-frame-undo.spec.ts` и
      `projects-connect.spec.ts` с `--repeat-each 3` — код 0; `wave-gate-lock.test.sh` 3 раза подряд — код 0.
- [ ] Полный прогон GitHub Windows runner-а (`windows-tests.yml`, режим `full`) на main после правки — зелёный.

## Где в коде

- `test/e2e/epic-frame-undo.spec.ts:125`, `:163`; `test/e2e/projects-connect.spec.ts:217`;
  `test/e2e/helpers.ts:276-278`.
- `test/contract/shell.test.ts:293`; `test/contract/terminal.test.ts` (`:183-185` и случаи, добавленные
  2026-10-28).
- `harness/bin/tests/wave-gate-lock.test.sh` (случаи токена замка e2e).
