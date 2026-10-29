# 41 — Flaky test-ы Windows после пересчёта 2026-10-23: 2 e2e и 5 unit/contract, красные только под нагрузкой или изредка

Type: task
Status: claimed 2026-10-29T15:01Z
Branch: worfy-polish/41
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

## Итог, часть 1 (2026-10-29, ПК; Ticket остаётся open — остаток в «Не сделано»)

Данные — три gate full на ПК по ADR-0086 на main 2026-10-29: `755ce722`, `b2b30e07`, `0be09773`
(GATE_SCOPE=all, vitest с 15 worker-ами по умолчанию). Каждый красный test повторён в одиночку на том же SHA.

Quarantine win32 до 2026-11-12, владелец `worfy-polish 41` — test-ы, красные хотя бы в двух из трёх прогонов.
В одиночку каждый раз зелёный (код 0). Причина, кроме нагрузки полного прогона, не найдена. Таймауты не
менялись: правило владельца, решение о множителе — у владельца. Строки — на main d829ab9c; в логах
gate full они выше (ci-workflow — на 109 строк).
- `test/contract/ci-workflow.test.ts:1187` — красный 3 из 3, «Test timed out in 45000ms».
- `test/contract/shell.test.ts:482`, случай win32 — красный 3 из 3: timeout 45 s, затем «EBUSY … rmdir». Случай
  linux падает следом: случай win32 после своего timeout ещё работает с подменённой платформой.
- `test/contract/harness-evals-outcome.test.ts:1710` — красный 2 из 3, timeout 60 s.
- `test/contract/harness-migrate.test.ts:478` — красный 2 из 3, timeout 45 s.

Без quarantine, хоть и красный 2 из 3: `test/contract/harness-evals.test.ts:259` (случай
`reviewer-intended-breakage`, timeout 45 s). Время уходит на сборку fixture случая, а fixture строит первый
test, который её попросит (`builtFixture`, кэш по имени случая). Если пропустить этот test, сборку возьмёт на
себя `reviewer-intended-breakage is the diff the case describes` (`:681`) с тем же пределом 45 s. Это нарушает
правило `test/quarantine.ts`: в quarantine идёт только test, чья ошибка — его собственная. На gate full `00daddd0`
так же покраснел случай `reviewer-simplification`.

Красные один раз — без quarantine, только здесь:
- `755ce722`: `test/contract/docs.test.ts:467` (случай active); e2e `projects-connect.spec.ts:217` и
  `session-two-windows.spec.ts:183` — «the app did not quit within 20 s and was killed».
- `b2b30e07`: `harness-evals-outcome.test.ts:1670`, `harness-scripts.test.ts:433` (`guard-silent.test.sh`:
  `bin/silent-check` не уложился в 0.5 s и 0.4 s), `projects-connect.test.ts:1345` (timeout 45 s),
  `terminal-ai-suggest.test.ts:443` (ветка git прочиталась как `null`).
- `0be09773`: `terminal-windows.test.ts:160` (3123 ms при границе 3000), `workflow-reader.test.ts:825` (1517 ms при
  границе 1500), `affected-tests.test.ts:215` и `:355` (timeout 15 s), e2e `quiet-windows.spec.ts:75` («Target
  page, context or browser has been closed»).

Test-ы из списка выше:
- `epic-frame-undo.spec.ts:125` — 5 из 5 зелёный при масштабе 100 %. Красный 2026-10-23 был при 150 %, а
  масштаб экрана ПК менять нельзя. Не воспроизведён.
- `projects-connect.spec.ts:217` — красный 1 из 44 run-ов до трёх gate full и 1 из 3 gate full. Причина
  зависания выхода не найдена. Последняя строка вывода приложения — «Debugger ending on ws://…»: связь
  Playwright закрыта, а процесс Electron жив до kill на 20 s. Правка этого PR — диагностика:
  `test/e2e/quit-diagnosis.ts` и `helpers.ts` (`processesOf`). При зависании выхода на Windows лог test-а
  называет процесс приложения и его потомков (pid, родитель, число потоков, имя, командная строка). Процесс
  старше своего записанного родителя потомком не считается: Windows отдаёт освободившийся pid заново. Проверено
  unit test-ом на настоящем дочернем процессе; mutant без обхода потомков — красный. Следующее зависание
  покажет, что ещё живо.
- `terminal.test.ts:185` — не повторился ни в тихих прогонах, ни в трёх gate full.
- `wave-gate-lock.test.sh` — 3 из 3 зелёный (27/27 каждый раз).
- `shell.test.ts:293` (darwin) — теперь на `:481`, на ПК краснеет случай win32 (в quarantine выше).

Четвёртый gate full на ПК, main `00daddd0` (2026-10-29): lint, typecheck, e2e, package — код 0; vitest — код 1,
19 красных, каждый в одиночку на том же SHA зелёный. Впервые красные: `autopilot-limits.test.ts:643`, `:681`, `:700`,
`e3-sandbox.test.ts:1300`, `harness-migrate.test.ts:448` и `:459`, `harness-evals.test.ts` случай
`reviewer-simplification`, `workflow-reader.test.ts:994`. Второй раз красные: `docs.test.ts:467`,
`harness-evals-outcome.test.ts:1670`, `harness-scripts.test.ts:433`, `projects-connect.test.ts:1349`,
`workflow-reader.test.ts:825`.

Попутно: `test/contract/harness-scripts.test.ts` занимает 1367 s из 1542 s vitest (`b2b30e07`), последние ~13
мин идёт один. Это `worfy-throughput` 56; данные — `C:/Users/Alexey/worfy-wt/evidence/throughput-56/` на ПК.

Не сделано — часть 2, в этом же Ticket-е (правило владельца 2026-10-23: flaky Windows — один Ticket
`worfy-polish`):
- Test-ы, красные по одному разу: `docs.test.ts:467`, e2e `projects-connect.spec.ts:217` и
  `session-two-windows.spec.ts:183`, и красные из прогонов `b2b30e07` и `0be09773` (список выше). Если test
  краснеет повторно — запись quarantine или правка причины. Красные второй раз и новые — из gate full
  `00daddd0` выше.
- `harness-evals.test.ts:259`: сборку fixture случаев вынести из test-а, чья ошибка тогда станет его собственной,
  либо ускорить саму сборку под нагрузкой.
- Причина зависания выхода приложения на Windows: найти по дереву процессов из диагностики этого PR и
  поправить. Решение владельца 2026-10-29: если причина не найдена, test-ы выхода приложения на Windows
  не запускаются.
- Пункты 2 и 3 «Готово, когда»: полный `pnpm test` на ПК — код 0 два раза подряд (планка приёмки Windows —
  полностью зелёный gate full), прогон GitHub Windows runner-а после merge.
