# 92 — Flaky test-ы 2026-11-09…10: под нагрузкой в CI и в локальном gate

Type: bug
Status: claimed 2026-11-10T12:39Z
PR: —
Blocked by: —
Source: Orchestrator 2026-11-10. Решение владельца: один Ticket на все flaky test-ы, замеченные 2026-11-09…10 в CI и в
локальном gate fast под полной нагрузкой машины.

## Что происходит

Красные без правки кода, на повторе зелёные:

1. `test/contract/terminal.test.ts:236` — процесс, оставшийся на pty после выхода shell-а.
2. `test/contract/harness-hook-stdin.test.ts:342` — `project-connect` на терминале: `expected '' to contain 'the draft is
   read from stdin'` (gate fast 2026-11-10T07:53Z).
3. `harness/hooks/tests/rules-hooks.test.sh` — случай «hung epic-status» под нагрузкой (job `harness-scripts-2`).
4. `harness/bin/tests/wave-gate-heartbeat.test.sh` — `exited 1` через `harness-scripts-4.test.ts` (2026-11-07, 11-08).
5. `test/contract/terminal-ai-assist.test.ts:1020` (в брифе `:1052` — строка `service.request` того же test-а) —
   `expected 'Folder: …' to contain 'Git branch: from-path-git'` (gate fast 2026-11-09T20:48Z, 20:52Z, 11-10T09:29Z).
6. `harness/hooks/tests/gate-verdict-signals.test.sh` — rc 137 (группа gate убита) и `exited 1` за 63 s (gate fast
   2026-11-09T20:52Z, 11-10T10:02Z).
7. `test/unit/link-tailscale.test.ts:196`, `:200` — `Command failed: …/worfy-tailscale-…/tailscale` за 5005 ms (gate fast
   2026-11-09T20:48Z, 20:52Z, 11-10T10:28Z).
8. `test/contract/link-reconnect.test.ts:473` — `could not reach ::1:52150 (ECONNRESET); also tried localhost: could not
   reach localhost:52150 (ECONNRESET)` (gate fast 2026-11-10T12:09Z).
9. Пределы времени в e2e, которые обходят `ms()` из `test/time-scale.ts` (множитель `DEFAULT_TIMEOUT_SCALE` = 3):
   `card-runtime.spec.ts:125`, `external-session.spec.ts:156`, `handoff.spec.ts:92`, `linked-cards.spec.ts:260`,
   `subagent-tree.spec.ts:139`, `:353`, `:362`, `edges.spec.ts:372`. `test/contract/test-timeout-scale.test.ts` их не
   ловит: это аргумент `toBeLessThanOrEqual`, а не предел test-а.

## Что делаем

- Для каждого — назвать причину и исправить её: ожидание события вместо отсчёта, общий множитель для предела, который
  зависит от машины, изоляция общего ресурса. Не поднимать числа в обход множителя.
- Пункт 9 — как #1780 для `epic-frame.spec.ts:350`: предел через `ms()`. `epic-frame.spec.ts` не трогаем (открытый PR
  #1780); проверки времени кадра только под `enforce` (`epic-frame:1196`, `:1209`, `snapping:373`) остаются как есть.
- Что не воспроизвелось и не нашлось за ~20 минут — в «Итог».

## Готово, когда

- [ ] Для каждого из пунктов 1–8 в «Итог» — причина с file:line и исправление, или что найдено и почему причина не
      названа.
  - evidence: commit pass · Fix six causes of flaky tests under load; scale eight e2e limits (worfy-polish 92) · - - · 86c92d1f212284449639b15a3e81ce9d288de664
- [ ] Исправленные воспроизведены до правки (нагрузка CPU, задержка, параллельные копии) и проходят после: счёт в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs` and `bash` of each fixed test with an injected delay: red before on origin/main, green after (counts in Итог) exit 0 · mac - · 86c92d1f212284449639b15a3e81ce9d288de664
- [ ] Пункт 9: все восемь пределов через `ms()`; затронутые e2e spec-и прогнаны под замком e2e.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/card-runtime.spec.ts test/e2e/external-session.spec.ts test/e2e/handoff.spec.ts test/e2e/linked-cards.spec.ts test/e2e/subagent-tree.spec.ts test/e2e/edges.spec.ts` exit 0 (16 passed) · mac - · 86c92d1f212284449639b15a3e81ce9d288de664
- [ ] Все затронутые test-файлы и shell test-ы — exit 0; `plugin-neutral.test.sh` — exit 0.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs` of the four touched vitest files and test-timeout-scale.test.ts exit 0; rules-hooks, gate-verdict-signals, plugin-neutral .test.sh exit 0 · mac - · 86c92d1f212284449639b15a3e81ce9d288de664
- [ ] gate fast — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 86c92d1f212284449639b15a3e81ce9d288de664

## Где в коде

- `test/contract/harness-hook-stdin.test.ts` — скрипт `ON_TERMINAL` (python, pty).
- `test/contract/terminal-ai-assist.test.ts` — test «a service built without branchOf reads the branch with the git on
  PATH».
- `test/unit/link-tailscale.test.ts` — `runTailscaleCli`.
- `test/contract/link-reconnect.test.ts` — `resolveOnLoopback`, раздел «the names of a Linked machine», `link.setAddress`.
- `harness/hooks/tests/rules-hooks.test.sh` — раздел 9, случаи hang.
- `harness/hooks/tests/gate-verdict-signals.test.sh` — `stop_group`, `at`, случай (d).
- `test/e2e/card-runtime.spec.ts`, `external-session.spec.ts`, `handoff.spec.ts`, `linked-cards.spec.ts`,
  `subagent-tree.spec.ts`, `edges.spec.ts` — пределы через `ms()`.
- Только чтение: `test/contract/terminal.test.ts:236`, `harness/bin/tests/wave-gate-heartbeat.test.sh`,
  `harness/hooks/stage-lines.mjs:49`, `:66`, `src/main/link/service.ts:459–493`, `src/main/link/client.ts:107`,
  `src/main/terminal-ai/git-branch.ts:94–115`, `src/main/link/tailscale.ts:103`.

## Вне скоупа

- `test/e2e/epic-frame.spec.ts` (PR #1780) и файлы PR #1782, #1783.
- Пределы времени кадра под `WORFY_PERF=1`.

## Итог

Код приложения не менялся: правки только в test-ах и shell test-ах Harness. Шесть причин найдены и исправлены, две —
нет (пункты 1 и 4). Числа «до/после» — из копии `origin/main` (`git worktree add --detach /tmp/claude-501/impl-92/base`)
и из этой ветки, с одной и той же задержкой, которая заменяет нагрузку.

1. **`terminal.test.ts:236` — причина не найдена.** Текста ошибки нет: ни в записях о падениях локального gate
   (`~/.claude/worfy-harness/gate/state/failures`, 2026-11-05…11-10), ни в log-ах 18 красных CI run-ов 2026-11-09…10.
   Не воспроизвёлся: файл целиком 8 раз рядом с 24 процессами, которые грузят CPU, и сам test 40 раз (8 копий × 5)
   рядом с 48 такими процессами — все зелёные. Test ждёт событий (выход shell-а, файл-маркер) с пределом `ms(5000)`; его
   папки свои для каждого test-а (`terminal-harness.ts:114`). Не тронут.
2. **`harness-hook-stdin.test.ts:342` — исправлено.** Причина — macOS выбрасывает вывод, который ещё лежит в
   pseudo-terminal, когда закрывается последний дескриптор его терминальной стороны. Скрипт `ON_TERMINAL` закрывал свою
   копию сразу после старта команды; команда под нагрузкой успевала напечатать отказ и выйти между двумя чтениями, и
   вывод пропадал: `expected '' to contain 'the draft is read from stdin'`. Теперь скрипт держит свою копию, пока не
   прочтёт всё, что лежит в pty после выхода команды. Проверка: отдельный python (команда пишет и выходит до первого
   чтения) — 3 из 3 пустой вывод с закрытой копией, 3 из 3 полный с открытой; в test-е задержка 1 s перед первым чтением —
   до правки 2 из 2 test-ов режима `all` красные с тем же текстом, после — 6 из 6 зелёные.
3. **`rules-hooks.test.sh`, «hung epic-status» — исправлено.** Случаи hang укорачивали шаг hook-а `stage-lines.mjs` до
   300 ms (`CLAUDE_STAGE_STEP_MS`, `harness/hooks/stage-lines.mjs:66`). Каждая заглушка — процесс node; под нагрузкой его
   старт дольше 300 ms, и hook убивал заглушку раньше, чем она записала свой pid, а с epic-status — ещё раньше убивал
   заглушку profile, и epic-status не запускался совсем: «the hung epic-status is still running (or never wrote its
   pid)». Теперь эти два случая идут со своим пределом hook-а, 2,5 s (`stage-lines.mjs:49`); проверка «hook сдался за
   8 s» осталась. Цена — около 4 s на файл. Проверка: каждый старт node на 0,4 s позже (`NODE_OPTIONS=--require`) — до
   правки 2 красных (hung profile и hung epic-status), после — 0, файл зелёный.
4. **`wave-gate-heartbeat.test.sh` — причина не найдена.** Записи о падении (`exited 1`, 2026-11-07, 11-08) без текста
   строки FAIL; в CI log-ах 2026-11-09…10 падения нет. Не воспроизвёлся: 12 запусков файла (4 рядом с 24 процессами
   нагрузки, 8 рядом с 36) — все зелёные. Гонки этого файла, найденные раньше, закрыл `worfy-polish` 69 (#1629). Не тронут.
5. **`terminal-ai-assist.test.ts:1020` — исправлено** (в брифе `:1052` — строка `service.request` того же test-а).
   Причина — первый старт только что записанного файла: macOS проверяет новую программу перед первым запуском, и под
   нагрузкой это дольше бюджета `gitBranch` (1 s продукта × множитель, mock в начале файла). Заглушка git на PATH
   стартовала первый раз внутри запроса, ветка не успевала, запрос уходил без неё. Замер на этой машине при loadavg 31:
   первый запуск нового скрипта — медиана 155 ms, максимум 669 ms; второй — 7 ms; `node -e 0` — 32 ms. Теперь test
   запускает заглушку один раз до запроса и проверяет её ответ. Проверка: первый старт заглушки на 4 s позже — до правки
   красный с тем же текстом (`expected 'Folder: …' to contain 'Git branch: from-path-git'`), после — зелёный.
6. **`gate-verdict-signals.test.sh`, rc 137 — исправлено.** `at` ждал, пока gate дойдёт до задержанного вызова git или
   resolver-а, не больше 10 s, а потом убивал группу gate через SIGKILL: rc 137. `stop_group` так же ждал старта скрипта
   30 s, случай (d) — 10 s без проверки. Теперь все три ждут условия — «дошёл» или «gate завершился», — без часов: gate
   либо доходит до вызова, либо кончается; зависший gate ловит предел файла. Проверка: gate этих случаев стартует на 11 s
   позже — до правки `SIGTERM to the group in git diff HEAD of the fingerprint: rc=137 (expected 143)`, после — 71 из 71.
   Остаток: случаи `child+gate` шлют сигнал gate-у через 0,3 s, а gate ждёт свой сигнал 0,5 s — это окно самого gate,
   test его проверяет; не тронуто. `exited 1` за 63 s в gate fast 2026-11-09T20:52Z и 11-10T10:02Z — строки FAIL в записи
   нет; 8 запусков рядом с 24–30 процессами нагрузки зелёные.
7. **`link-tailscale.test.ts:196`, `:200` — исправлено.** Предел CLI в test-е — голые 5 000 ms, мимо множителя
   (`test-timeout-scale.test.ts` его не видит: это аргумент функции, не предел test-а). Та же первая проверка нового
   скрипта под нагрузкой дольше 5 s, и `runTailscaleCli` убивал заглушку: `Command failed: …/tailscale` за 5005 ms.
   Теперь `ms(5_000)`. Проверка: старт заглушки на 6 s позже — до правки 2 из 2 красные с тем же текстом, после — 2 из 2
   зелёные.
8. **`link-reconnect.test.ts:473` — исправлено.** Test считал, что на `::1` у порта B никто не слушает, и что имя
   `localhost` приведёт к B на 127.0.0.1. Порты `::1` и 127.0.0.1 разные: сервер другого test-а, который слушает `::`
   или `::1`, может получить тот же номер. Тогда и запомненный адрес, и `localhost` (Node пробует `::1` первым) попадали
   в чужой сервер: `could not reach ::1:52150 (ECONNRESET); also tried localhost: …(ECONNRESET)`. Теперь имя резолвится
   в 127.0.0.1 заглушкой `dns.lookup` (`resolveOnLoopback`, как уже делал test «the learnt worfy name»), в трёх test-ах
   имён и трёх test-ах `link.setAddress` с `localhost`; заглушки снимаются после каждого test-а (`vi.restoreAllMocks`).
   Ответ чужого сервера на запомненный адрес по-прежнему ведёт к именам (`src/main/link/service.ts:471–474`). Проверка:
   свой сервер на `::1` у порта B, который сбрасывает соединения, — до правки красный с тем же текстом, после — зелёный.
9. **Пределы e2e через `ms()`** — все восемь: `card-runtime.spec.ts:125`, `external-session.spec.ts:156`,
   `handoff.spec.ts:93` (добавлен импорт), `linked-cards.spec.ts:260`, `subagent-tree.spec.ts:139`, `:353`, `:362`,
   `edges.spec.ts:373` (локальная переменная `ms` переименована в `hoverToLit`, иначе она закрывала импорт).
   Строки сверены: в брифе верны все, кроме сдвига на 1 после нового импорта. `epic-frame.spec.ts` и проверки под
   `enforce` не тронуты. `pnpm test:e2e` этих шести spec-ов под замком e2e — 16 passed.

Удалённых test-ов нет.

Вне скоупа замечено: `test/contract/link-by-name.test.ts:159`, `:185` и `test/contract/link-connections.test.ts:297`
тоже соединяются с `localhost` у порта, где B слушает только 127.0.0.1, — та же возможная гонка с чужим `::1`; там не
падало.
