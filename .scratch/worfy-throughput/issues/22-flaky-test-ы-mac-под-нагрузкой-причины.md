# 22 — Flaky test-ы Mac под нагрузкой: `collectNodeTypes`, `session-node-drop`, `login-shell-capture` — причина и правка

Type: task
Status: done 2026-10-29T12:58Z
PR: #991
Branch: worfy-throughput/22
Blocked by: 20
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 3; gate full на Mac
2026-10-27 — красные под load average 30–60
от параллельных агентов; запись карантина Ticket-а 20 называет этот Ticket владельцем.

## Что происходит

- `test/unit/canvas.test.tsx:48` (`collectNodeTypes`): динамический import модуля узлов в jsdom дольше 5 s под
  нагрузкой.
- `test/unit/session-node-drop.test.tsx` и `test/contract/login-shell-capture.test.ts` — красные в gate full
  2026-10-27, зелёные в повторе.
- Правило Profile-а: timeout одного test-а не поднимать; лечить причиной (stub вместо настоящего процесса,
  ожидание условия вместо отсчёта по часам, окружение).

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): кроме Mac под нагрузкой, повторы — и на macOS-runner-е `ci-ok`
(Ticket 35): test, красный там, мешает merge каждого PR.

## Что делаем

1. Для каждого — повтор под нагрузкой, как в gate full (полный `pnpm test` рядом с другим gate), и в тишине;
   сколько раз красный из скольких.
2. Причина и правка причины. Для `collectNodeTypes` — проверить, что дорогой import не повторяется в каждом
   test-е и не тянет весь renderer.
3. Снять запись карантина (`test/quarantine/<id>.json`) каждого починенного test-а.

Нужен ПК: нет. Трогает Harness: нет. Вердикт Windows: runner `full`, если правка трогает `src/`.

## Готово, когда

- [x] «Итог»: на каждый test — красных до правки (из N повторов под нагрузкой), причина, правка.
- [x] Каждый test зелёный в 10 повторах под нагрузкой (`pnpm test <файл>` параллельно с полным `pnpm test`);
      команда и коды выхода — в «Итог».
- [x] Записей карантина этого Ticket-а не осталось; timeout-ы test-ов не изменены (diff это показывает).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).

## Где в коде

- `test/unit/canvas.test.tsx`, `test/unit/session-node-drop.test.tsx`, `test/contract/login-shell-capture.test.ts`
- `test/quarantine/` — записи этих трёх test-ов
- `src/` — по найденной причине (дописать при claim)

## Вне скоупа

- `test/e2e/quiet-windows.spec.ts` (проверка Dock) — файл `PC_ONLY`, Ticket 34.
- `harness/bin/tests/wave-gate-lock.test.sh`, DST case — PR #867.

## Итог

### `login-shell-capture` — «keeps nothing of what that process writes after the answer» (2026-10-28)

- **Как падал.** В логах gate full 2026-10-25 и 2026-10-27 (`~/.claude/worfy-harness/gate/state/logs/…/03-worfy_._test.log`)
  test красный одним и тем же: `expected null to be +0` на `expect(run.status, run.stderr).toBe(0)`, длительность
  20 013–20 035 ms. `status` равен `null`, когда `spawnSync` убил процесс по своему timeout-у 20 s: процесс test-а
  не успевал закончить.
- **Причина — в test-е, не в `src/`.** Фоновый процесс из `.profile` писал 100 MB через `head -c … /dev/zero | tr '\0' a`.
  `tr` на macOS пропускает около 40 MB/s: 100 MB шли 2,4–2,5 s из 2,8 s всего процесса (замер скриптом-копией
  test-а: `floodMs` 2286–2510). Это работа одного ядра. На Mac с load average 30–60 от параллельных run-ов она растягивалась
  за предел 20 s. Сам `captureLoginShellEnv` (`src/main/agent/env.ts:174-175`, после ответа данные отбрасываются)
  читает те же 100 MB без `tr` за 20–30 ms: в нём узкого места нет.
- **Правка.** Писатель — `head -c 100000000 /dev/zero` без `tr`: те же 100 MB, но NUL-байтами; capture отбрасывает
  их так же. Процесс test-а — 0,4 s вместо 2,8 s (`floodMs` 85–86), весь файл — 3,3 s вместо 6,7 s. Timeout-ы не
  менялись, sleep не добавлен. Запись `test/quarantine/login-shell-capture-late-writes.json` удалена, test снова
  объявлен через `it`.
- **Красных из 10.** Нагрузка — `yes > /dev/null` на половине ядер (9 из 18), каждая серия не дольше 110 s, а не
  параллельный полный `pnpm test`. До правки: в тишине 0 из 10, под нагрузкой 0 из 10. После: в тишине 0 из 10,
  под нагрузкой 0 из 10. Такая нагрузка (load average около 10) красного не воспроизвела; причина найдена по
  логам gate и по замеру времени `tr`. Команда каждого run-а:
  `WORFY_QUARANTINE=run node scripts/vitest-electron.mjs test/contract/login-shell-capture.test.ts`, коды выхода во
  всех 40 run-ах — 0.
- **Mutant.** В `src/main/agent/env.ts:175` `if (settled) return` заменён на `if (settled) { output += chunk; return }`
  (capture держит всё, что пришло после ответа). Test красный: `AssertionError: expected 185.401344 to be less than 50`,
  файл — exit 1 (1 failed, 15 passed). Файл восстановлен из копии, `cmp` — 0.

Нагрузка во всех замерах ниже — `yes > /dev/null` на половине ядер (9 из 18 на Mac владельца),
свои pid-ы каждого прогона запущены перед ним и сняты `kill` сразу после; один прогон под нагрузкой —
2–4 s. Каждый прогон — `node scripts/vitest-electron.mjs <файл> --reporter=verbose`. «До правки» —
копия test-а до правки во временном файле `test/unit/zz-before-*.test.tsx` (удалён после замера).
Записей карантина у обоих test-ов не было (`grep -c` по `test/quarantine/*.json` — 0 во всех
11 файлах), снимать нечего. Timeout-ы не менялись.

### `test/unit/canvas.test.tsx`, `collectNodeTypes` (первый test файла)

- **Красные в gate full на Mac до правки:** 26 логов из 447 в `~/.claude/worfy-harness/gate/state/logs/`,
  везде `Test timed out in 5000ms` у первого test-а файла, файл целиком — 10,8–18,7 s (в тишине — 1,7 s).
  Последний красный — 2026-10-28T03:56Z.
- **Причина:** до PR #877 копия реестра Node type-ов строилась в `beforeAll`, а первый import реестра
  делал первый test (`collectNodeTypes`). Реестр (`src/renderer/canvas/nodes/index.ts:109`,
  `import.meta.glob('./*Node.tsx', { eager: true })`) тянет все Node type-ы: 143 модуля `src/`
  (658 вместе с `node_modules`, замер esbuild metafile) — почти весь renderer. Их transform шёл внутри
  5 s первого test-а; под load average 30–60 он не успевал.
- **Правка:** уже в `main` — PR #877 (`bdf72fff`): копия реестра строится, и реестр импортируется
  один раз, пока файл собирается (`test/unit/canvas.test.tsx:35-42`), вне timeout-а test-а. Проверено:
  1. дорогой import не повторяется — в файле нет `vi.resetModules`, остальные 11 `await import(...)`
     реестра берут модуль из кэша: первый test — 1–2 ms;
  2. весь renderer он тянет, но это нужно самому файлу: его test-ы рисуют настоящий `Canvas.tsx` с
     реестром, так что облегчить import только для `collectNodeTypes` (вынести функцию в отдельный
     модуль) — перенос той же цены, а не её снятие. Новой правки нет: причины, которую можно снять
     ещё, не нашлось.
- **После правки:** с 2026-10-28T05:32Z в 21 gate-логе ни одного красного у этого файла.
- **Повторы (exit code каждого прогона):**

  | Вариант | Тишина: красных | Нагрузка: красных | Первый test, тишина | Первый test, нагрузка |
  | --- | --- | --- | --- | --- |
  | до #877 | 0 из 10 (все exit 0) | 0 из 10 (все exit 0) | 590–621 ms | 828–897 ms |
  | после #877 | 0 из 10 (все exit 0) | 0 из 10 (все exit 0) | 1–2 ms | 1–2 ms |

  Красным `yes` на 9 ядрах при прогоне одного файла не сделать: этого мало до load average 30–60
  gate full, где 18 worker-ов делят один Vite server. Правку подтверждают время первого test-а и
  mutant.
- **Mutant:** `FALLBACK_WIDTH = 240` → `200` в `src/renderer/canvas/nodes/index.ts:36` — test
  `maps each kind to its component…` красный (exit 1, `1 failed | 42 passed`); файл восстановлен из
  копии, `cmp` — exit 0.

### `test/unit/session-node-drop.test.tsx`

- **Красные в gate full на Mac до правки:** 12 логов (2026-10-25 – 2026-10-27), везде
  `Test timed out in 5000ms`: первый test файла (`an image and a text file become two chips…`) —
  12 раз, второй (`a message of attachments only…`) — 7 раз, `a chip removed with ×…` — 1 раз; файл
  целиком — 10,3–18,3 s (в тишине — 3,5 s).
- **Причина:** та же, что у `collectNodeTypes`. `beforeEach` зовёт `vi.resetModules()`, и каждый
  test импортирует `SessionNode.tsx` заново; первый такой import делает transform Node-а и всего, до
  чего он доходит (56 модулей `src/`, 532 вместе с `node_modules`), внутри 5 s первого test-а.
  Второй test, если первый упал по timeout-у, ждёт тот же ещё не законченный transform — поэтому
  красные парами. `vi.resetModules()` сбрасывает только выполненные модули (`exports`, `evaluated`),
  результат transform-а остаётся, так что повторный import в следующих test-ах дешёвый.
- **Правка:** `test/unit/session-node-drop.test.tsx:13-17` — `await import(SessionNode)` один раз,
  пока файл собирается; каждый test по-прежнему выполняет свежую копию модулей после
  `vi.resetModules()` (test с `vi.doMock('../../src/renderer/ipc')` зелёный — mock доходит до Node-а).
- **Повторы (exit code каждого прогона):**

  | Вариант | Тишина: красных | Нагрузка: красных | Первый test, тишина | Первый test, нагрузка |
  | --- | --- | --- | --- | --- |
  | до правки | 0 из 10 (все exit 0) | 0 из 10 (все exit 0) | 519–563 ms | 686–725 ms |
  | после правки | 0 из 10 (все exit 0) | 0 из 10 (все exit 0) | 131–137 ms | 134–138 ms |

  Как и у `canvas`, `yes` на половине ядер красного не дал; правку подтверждают время первого test-а
  (вся разница — transform, ушедший из test-а в сбор файла: файл целиком — те же 3,5–3,7 s) и mutant.
- **Mutant:** в `src/renderer/canvas/nodes/SessionNode.tsx:291` `agent.send` получает
  `attachments: []` вместо chip-ов — 7 test-ов красные (exit 1, `7 failed | 18 passed`), в том числе
  первый; файл восстановлен из копии, `cmp` — exit 0.

### Проверки

- `pnpm lint` — exit 0; `pnpm typecheck` — exit 0.
- `node "$HOME/.claude/worfy-harness/plugin/hooks/gate.mjs" fast </dev/null` — exit 0,
  `[gate] green (fast): worfy/.:lint worfy/.:typecheck worfy/.:test` (весь `pnpm test`, 163,5 s).

### Наблюдения CI 2026-10-28 (Session-мост)

- `test/e2e/epic-frame.spec.ts:1103` (perf) — timeout на обеих попытках в run 40765186156 (PR #929); в 15 из 16
  последних macOS e2e run-ов зелёный. Один случай — строка здесь, не Ticket (правило: 3 FLAKY за неделю).
- `test/unit/session-view.test.tsx:391` — на #922, job macos-tests: timeout монтирования, повтор видел два textbox-а.
  Причина — гонка повтора; правка — PR #932 (Orchestrator), merge 2026-10-29.

### Повтор по методу Ticket-а и история после правок (2026-10-29, `origin/main` 1a428502)

Правки всех трёх test-ов уже в `main`: `canvas` — PR #877, `session-node-drop` — PR #906, `login-shell-capture` —
PR #904. Этот круг кода не меняет: проверяет их нагрузкой, которую называет «Готово, когда» (полный `pnpm test`
рядом), и историей gate и CI после merge.

- **Нагрузка.** В фоне — полный `pnpm test` с `--maxWorkers=9` (половина из 18 ядер), в своей группе процессов,
  не дольше 115 s; на переднем плане — 10 прогонов одного файла подряд:
  `node scripts/vitest-electron.mjs <файл> --reporter=verbose` (то же, что `pnpm test <файл>`). По одному такому
  run-у на файл, после каждого фоновая группа снята и проверено, что процессов этого worktree не осталось (0).
  Load average за 1 минуту — 6,7–12,3. Тишина — те же 10 прогонов без фона (load average 2,8–3,3: на Mac
  работали другие агенты).

  | Test | Тишина: красных | Нагрузка: красных | Первый test, тишина | Первый test, нагрузка | Файл, нагрузка |
  | --- | --- | --- | --- | --- | --- |
  | `test/unit/canvas.test.tsx` (`collectNodeTypes`) | 0 из 10, все exit 0 | 0 из 10, все exit 0 | 1–2 ms | 1–2 ms | 2,0–5,3 s |
  | `test/unit/session-node-drop.test.tsx` | 0 из 10, все exit 0 | 0 из 10, все exit 0 | 129–132 ms | 132–148 ms | 3,6–5,5 s |
  | `test/contract/login-shell-capture.test.ts` (`keeps nothing…`) | 0 из 10, все exit 0 | 0 из 10, все exit 0 | 377–391 ms | 383–453 ms | 3,2–5,2 s |

- **Gate на Mac после правок.** В `~/.claude/worfy-harness/gate/state/logs/` 131 лог `pnpm test` с
  2026-10-28T05:32Z по 2026-10-28T21:20Z (позже gate full на Mac не запускался: условие merge — `ci-ok`). В 29 из
  них есть `FAIL` или `Test timed out` других test-ов; ни одного у трёх файлов этого Ticket-а.
- **CI после правок.** 195 законченных run-ов workflow `CI` с 2026-10-28T20:21Z по 2026-10-29T12:26Z, 1188 job-ов с test-ами.
  Прочитаны логи 633 job-ов (macOS — 33, Linux — 396, Windows — 204; остальные не скачались: GitHub ответил
  403 rate limit). Во всех 33 macOS-логах `canvas.test.tsx` выполнялся; строк `FLAKY` у macOS-job-ов нет совсем.
  Ни в одном прочитанном логе нет `FAIL`, `Test timed out` или `FLAKY` у трёх файлов. `FLAKY` в CI есть у других
  test-ов — `harness-scripts.test.ts` (shell-test-ы Harness), `claude-home-registry.test.ts:597`,
  `install-stable-functions.test.ts:561` и ещё 9 файлов; они вне этого Ticket-а.
- **Карантин.** В `test/quarantine/` одна запись — `linked-notify-turn-click-opens-in-b.json` (e2e на Windows,
  владелец — Ticket 44); записей этого Ticket-а нет. Timeout-ы не менялись: diff этого круга — только этот файл.
- **Проверки.** `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (`Test Files 464 passed | 7 skipped`,
  `Tests 10159 passed | 105 skipped`, 160,7 s). `GATE_SCOPE=all node <Harness>/hooks/gate.mjs fast` — exit 0,
  `[gate] green (fast): worfy/.:lint worfy/.:typecheck worfy/.:test`; без `GATE_SCOPE=all` gate ничего не
  запускает (diff — только документ).
- **Чего этот круг не воспроизвёл.** Load average 30–60, при котором test-ы краснели 2026-10-25 – 2026-10-27,
  половиной ядер не получить: предел брифа — не больше половины ядер и 2 минуты на run. Правки подтверждают время
  первого test-а (дорогой transform вынесен из test-а в сбор файла) и отсутствие красных в gate и CI после merge.
