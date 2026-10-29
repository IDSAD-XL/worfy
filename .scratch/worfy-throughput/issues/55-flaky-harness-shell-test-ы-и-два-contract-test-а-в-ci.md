# 55 — Flaky test-ы в CI: shell test-ы Harness, `claude-home-registry` и `install-stable-functions`

Type: task
Status: claimed 2026-10-29T13:21Z
Blocked by: —
Source: правило владельца — 3 строки FLAKY за неделю у одного test-а дают Ticket; обход 633 логов job-ов CI с
2026-10-28T20:21Z (Orchestrator, таблицы `flaky-sweep.tsv` и `flaky-sweep-harness.tsv`); CI повторяет упавший
test один раз и печатает `FLAKY <runner> <file>:<line> > <title>`, если повтор прошёл (`test/flaky.ts`).

## Что происходит

- `test/contract/harness-scripts.test.ts:418` и `:427` (номер строки сдвинулся между commit-ами; это один case
  `<shell-файл> exits 0 with an empty HOME`): около 10 FLAKY в сутки по shell test-ам Harness, которые он запускает.
  По обходу: `hooks/tests/guard-silent.test.sh` ×4 (только Windows: `windows (3/3)` ×2, `harness-scripts 1/2` ×2),
  `bin/tests/wave-gate-lock.test.sh` ×2 (Linux, `linux-tests (4/4)`), `bin/tests/wave-gate-lock-killed.test.sh` ×1
  (Windows) и ещё ×1 в run-е 40871132928 (после обхода); job 123266234571 (run 40818811841, Windows
  `harness-scripts 2/2`) — пять файлов в одном run-е: `land`, `ticket-mark`, `wave-brief`, `wave-gate-merge`,
  `gate-file-size`.
- `test/contract/claude-home-registry.test.ts:597` («reports transcripts in a subfolder of the root, not those of a
  look-alike Project»): ×3, только Linux, `linux-tests (3/4)`, run-ы 40792349627, 40798035586, 40844213262.
- `test/unit/install-stable-functions.test.ts:561` («the deploy mark after a whole install > is set once…»): ×3,
  только Windows, `windows (3/3)`, run-ы 40811298374, 40812832776, 40816108815. В бриф он попал как
  `test/contract/…`; файл лежит в `test/unit/`.
- Текста первой, упавшей попытки нет ни в одном логе: vitest печатает ошибку test-а, только когда упал и повтор.

## Что делаем

1. Для каждого test-а — причина по логам и коду, повтор под нагрузкой там, где платформа есть на Mac.
2. Правка причины, не повтора. Timeout-ы test-ов не поднимаем (правило Profile-а).
3. Где причина не находится за разумное время — запись карантина (`test/quarantine/<id>.json`, owner
   «worfy-throughput 55», не дальше 14 дней) или, если карантин теряет слишком много проверок, — способ увидеть
   причину в следующем FLAKY. Решение и довод — в «Итог».

Нужен ПК: нет. Трогает Harness: да (`harness/hooks/tests/guard-silent.test.sh`). Вердикт Windows — по
`node scripts/windows-verdict-scope.mjs`.

## Готово, когда

- [ ] «Итог»: на каждый test — платформа, job и run, причина (или почему не найдена), правка.
- [ ] Каждый изменённый test-файл (или shell test под временным HOME) зелёный в 10 повторах; команды и коды
      выхода — в «Итог».
- [ ] Timeout-ы test-ов не изменены (diff это показывает).
- [ ] gate fast — `[gate] green`; вывод `windows-verdict-scope.mjs` — в «Итог».

## Где в коде

- `test/unit/install-stable-functions.test.ts` — case-ы «the deploy mark after a whole install»
- `src/main/claude-home/registry.ts` — `watch()`, новая папка транскриптов
- `test/contract/claude-home-registry-missed-event.test.ts` — test на пропущенное событие новой папки
- `test/contract/harness-scripts.test.ts` — `runFile`, вывод упавшей попытки
- `harness/hooks/tests/guard-silent.test.sh` — проверка времени «two checks, one budget»
- `test/quarantine/` — если понадобится запись

## Вне скоупа

- Остальные FLAKY обхода (`projects-connect.test.ts:705`, `harness-evals.test.ts`, `e2e-no-spawn-on-load.test.ts:507`
  и другие) — меньше 3 за неделю у каждого.

## Итог

Данные: таблицы обхода Orchestrator-а (633 лога, 29 строк FLAKY) и свой обход — 50 логов последних run-ов всех
vitest-job-ов и 30 логов Windows `harness-scripts`, по одному, в одном потоке (1 FLAKY Harness: run 40871132928,
`wave-gate-lock-killed`, 61 376 ms с повтором). Текста упавшей первой попытки нет ни в одном логе: vitest печатает
ошибку, только когда упал и повтор. Длительность с повтором видна в строке `✓ … (retry x1)`.

### `install-stable-functions.test.ts:561` — Windows

- **Как падал.** Job 123257471981 (run 40816108815, `windows (3/3)`): `is set once, on the installed commit…
  23554ms (retry x1)` при timeout case-а 15 s. Первая попытка дошла до 15 s, повтор — около 8,5 s.
- **Причина.** Case — первый в своём `describe`, ставит копию целиком через `installStable` с настоящим списком
  процессов: `processListing` на Windows запускает `powershell.exe … Get-CimInstance Win32_Process` дважды
  (`scripts/install-stable.mjs:361-362`), холодный старт PowerShell на загруженном runner-е — секунды. Проверка
  «копия запущена» в этих case-ах не участвует: они проверяют отметку deploy.
- **Правка.** Три case-а «the deploy mark after a whole install» передают `listing: noProcesses` (пустой список:
  `''` для `ps`, `'[]'` для PowerShell). Timeout не менялся. Установки `install-stable.test.ts`
  тоже получают пустой список (`inProcess`); настоящий проверяют его case-ы «refuses while a program of the copy is
  running» (в `install-stable.test.ts`; ссылка по имени, номера строк уходят).

### `claude-home-registry.test.ts:597` — Linux

- **Как падал.** `linux-tests (3/4)`, run-ы 40792349627, 40798035586, 40844213262. На Mac не воспроизводится:
  10 параллельных run-ов `-t 'watching the Claude home'` при load average 32 — 10 из 10 зелёные; отдельный
  скрипт с chokidar (папка и два файла сразу после неё) — 0 пропусков из 100.
- **Причина (по коду, без текста ошибки).** chokidar 5.0.0 сообщает о новой папке (`addDir`), потом читает её и
  только после чтения ставит `fs.watch` (`node_modules/chokidar/handler.js:543-554`, `_handleDir`). Файл,
  записанный между чтением и `fs.watch`, не сообщает никто до его следующей записи. Case создаёт папку и сразу
  пишет `foreign.jsonl` и `ours.jsonl`, потом ждёт `ours` 3 s. На Linux (inotify) окно открыто; на macOS FSEvents
  отдаёт недавние события и закрывает его. Это не только test: первый транскрипт нового worktree Claude Code
  пишет сразу после папки, и до следующей записи worfy его не видит.
- **Правка (в `src/`).** `ClaudeHomeRegistry.watch` на `addDir` папки Project-а под `projects/` читает её ещё раз
  через `NEW_DIR_RELIST_MS` (1 s) и отмечает каждый транскрипт в ней, как будто о нём сообщил chokidar
  (`src/main/claude-home/registry.ts`). Чужая папка не читается. Предел записан комментарием `shortcut:`.
- **Test.** `test/contract/claude-home-registry-missed-event.test.ts`, describe «a transcript in a new folder the
  file watcher never reports»: chokidar-mock сообщает только `addDir`, без файлов; `readdir` считается mock-ом
  `node:fs/promises`. Case 1: `ours.jsonl` пишется через 200 ms после `addDir` (после чтения папки chokidar-ом и
  до его `fs.watch`) и приходит в change; `foreign` (look-alike Project) и `old` (папка корня, бывшая до watch) — нет;
  из `projects/` прочитана только новая папка. Case 2: папка другого Project-а не читается. Case 3: watch, закрытый
  до второго чтения, больше ничего не читает. До правки case 1 красный (`Error: no change of ours yet`).

### Shell test-ы Harness (`harness-scripts.test.ts:418/427`)

- **`guard-silent` ×4, только Windows.** Единственная проверка по часам с запасом меньше секунд — «two checks,
  one budget: the hook ends within two tries»: меньше `2,5 × 3000` ms при бюджете двух попыток 6000 ms. Время
  считалось от `now_ms` до hook-а и после него, а `now_ms` — это `node -e`; в замер входили старт node часов,
  старт node самого hook-а и jq. На загруженном Windows runner-е это и есть 1,5 s запаса. **Правка:** stand-in
  пишет время своего первого старта (`call <ms>`), замер идёт от него; `now_ms` берёт встроенные часы bash 5
  (`EPOCHREALTIME`), без запуска node (Git Bash и Linux — bash 5; bash 3.2 macOS — прежний `node -e`). Порог не
  менялся. Под нагрузкой на Mac (18 циклов CPU, load average около 50) замер — 6003–6120 ms.
- **`wave-gate-lock` ×2 (Linux), `wave-gate-lock-killed` ×2 (Windows), пять файлов в job 123266234571.** Причина не
  найдена: ни в одном логе нет строки FAIL первой попытки. В job 123266234571 у пяти файлов первая попытка упала
  быстро, не по пределу 900 s (с повтором: `land` 340 800 ms, `wave-gate-merge` 125 898, `wave-brief` 81 977,
  `ticket-mark` 62 151, `gate-file-size` 50 864). Это похоже на общий сбой runner-а (Git Bash под нагрузкой), а не
  на пять причин. Повтор на Mac: `wave-gate-lock`, `wave-gate-lock-killed`, `guard-silent`, `land`, `ticket-mark` —
  по 4 копии разом, зелёные; первые три по 6 копий при 36 циклах CPU (load average 120) — 18 из 18 зелёные.
  **Правка — видимость, не карантин:** `runFile` пишет в stderr каждую упавшую попытку с её строками FAIL
  (`[harness-scripts] <файл>, try <n> of <m>, failed: …`), так что следующий FLAKY в логе CI называет упавшую
  проверку. Только попытка, за которой есть повтор: ошибку последней vitest печатает сам, второй копии нет; локально
  (повторов 0) строк нет. Проверено временным файлом `harness/bin/tests/zz-probe.test.sh` (exit 1, удалён после):
  `CI=1` — одна строка `try 1 of 2`, без `CI` — ни одной.
  Карантин не взят: запись выключает весь shell-файл (десятки проверок Harness), а у каждого из этих файлов меньше
  3 FLAKY за неделю.

### Круг правок 1 (ревью PR #996)

- `NEW_DIR_RELIST_MS` проверен по времени: файл пишется после `addDir`. Добавлены папка корня, которую нельзя
  читать заново, счёт чтений `readdir` и case закрытого watch (раздел про `claude-home-registry` выше).
- `guard-silent`: в комментарии записана принятая ошибка замера. Бюджет hook-а начинается до запуска первого
  stand-in (`deadline`, `harness/hooks/guard.mjs:202`), а stand-in пишет время после своего старта node. Значит
  hook, превысивший бюджет меньше чем на один старт node, проходит. Ошибка «вторая проверка с собственной
  попыткой» добавляет целую попытку (3 s) и остаётся красной. Порог не менялся. Mutant ревью был красным с запасом
  всего 20–30 ms.
- Комментарий `install-stable-functions` исправлен: настоящий список процессов проверяют отказы
  `install-stable.test.ts`.

### Круг правок 2 (красный `ci-ok` на c68628d9)

- **Как падал.** `windows (1/3) / full-suite`, run 40888369746, job 123498218529: case 1 нового describe красный
  в обеих попытках, `Error: no change of ours yet` (`vi.waitFor`, 3000 ms); остальные 1035 test-ов shard-а
  зелёные, Linux и macOS зелёные.
- **Причина — в test-е, не в `src/`.** Имена папок test строил как `projectDirName(DEMO)`, без `resolve`. Registry
  берёт корень через `resolve` (`roots()`), а на Windows `/Users/test/projects/demo` превращается в
  `C:\Users\test\projects\demo`, имя папки — `C--Users-test-projects-demo`. Папка test-а `-Users-test-projects-demo-web`
  для `dirMatch` — `none`, и повторного чтения не было по правилу «чужая папка не читается». Case-ы 2 и 3 ждут
  «ничего не прочитано», поэтому на Windows прошли и ничего не проверили. Остальные test-ы registry строят имя
  через `projectDir()` из `test/contract/claude-home-fixture.ts` (`projectDirName(resolve(cwd))`).
- **Правка.** Новые case-ы берут имена папок через `projectDir()`, как остальные test-ы registry. Код в `src/`
  не менялся: он сравнивает имя с корнем, полученным через `resolve`.
- Ссылка на отказы `install-stable.test.ts` дана по имени case-а, а не номером строки.
- Проверки на Mac, Windows здесь нет: `claude-home-registry-missed-event` — exit 0 (7 passed), ×10 параллельно —
  10 из 10 exit 0; `claude-home-registry` — exit 0 (70); `install-stable-functions` — exit 0 (63). Mutant-ы
  `NEW_DIR_RELIST_MS = 0` и `= 5000` — exit 1, красный case 1; `registry.ts` восстановлен из копии, `cmp` — 0.
  Вердикт Windows — следующий `ci-ok`.

Mutant-ы `src/main/claude-home/registry.ts`, по одному; файл восстановлен из копии, `cmp` — 0. Команда каждого:
`node scripts/vitest-electron.mjs test/contract/claude-home-registry-missed-event.test.ts`.

| Mutant | Exit | Красный case |
| --- | --- | --- |
| `NEW_DIR_RELIST_MS = 0` | 1 | case 1 (новая папка) |
| `NEW_DIR_RELIST_MS = 5000` | 1 | case 1 |
| без обработчика `addDir` | 1 | case 1 |
| заново читаются все папки Project-а | 1 | case 1 (`old`, лишнее чтение) |
| читается и папка другого Project-а (без `dirMatch`) | 1 | case 2 |
| таймер не хранится в `relooks` (не снимается в `close()`) | 0 | — |
| таймер не хранится и нет проверки `closed` в нём | 1 | case 3 |

Таймер нового чтения защищён дважды: `close()` снимает его, а сам таймер выходит при `closed`. Снятие одной
защиты поведения не меняет (exit 0), поэтому case 3 краснеет, только когда сняты обе.

### Повторы и проверки (2026-10-29)

- Каждый файл — `node scripts/vitest-electron.mjs <файл>`, 10 run-ов одновременно, под 18 циклами CPU
  (`while :; do :; done`, сняты после) при load average около 50: `claude-home-registry-missed-event`,
  `claude-home-registry` и `install-stable-functions` одной командой — 10 из 10 exit 0, 139 test-ов в каждом
  (круг 1). После круга правок: `claude-home-registry-missed-event` — 10 из 10 exit 0, по 7 test-ов.
- `guard-silent.test.sh` — 10 копий разом, каждая с HOME во временной папке, под 18 циклами CPU: 10 из 10 exit 0,
  замер «two checks, one budget» — 6003–6120 ms. После круга правок: `HOME=$(mktemp -d) bash
  harness/hooks/tests/guard-silent.test.sh` — exit 0, `passed 103, failed 0`, 6029 ms.
- После круга правок, по одному: `claude-home-registry-missed-event` — exit 0 (7 passed), `claude-home-registry` —
  exit 0 (70), `claude-home-watch-dropped-change` — exit 0 (3), `install-stable-functions` — exit 0 (63).
- gate fast: `node ~/.claude/worfy-harness/plugin/hooks/gate.mjs fast </dev/null` — exit 0,
  `[gate] green (fast): worfy/.:lint worfy/.:typecheck worfy/.:test`.
- `node scripts/windows-verdict-scope.mjs $(git merge-base origin/main HEAD) HEAD` — `runner`, exit 0.
