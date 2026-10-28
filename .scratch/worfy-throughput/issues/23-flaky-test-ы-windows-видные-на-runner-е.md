# 23 — Flaky test-ы Windows, которые краснеют на GitHub runner-е: `claude-home-registry`, `link-access`, `workflow-reader`, `workflow-branches-handles`

Type: task
Status: open
Blocked by: 20
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 1 и правка
`worfy-polish` 41; разбор run-ов «Windows tests» с
2026-10-18 (156 run-ов, 41 красный); run 39918292362 (полный run на main 2026-10-23, единственный красный —
`workflow-branches-handles`).

## Что происходит

- `test/contract/claude-home-registry.test.ts` — «watching the Claude home» и «claudeHome IPC channels»: 7
  test-ов красные в 3 run-ах («no matching change yet», пустой список событий) — время watcher-а на Windows.
- `test/contract/link-access.test.ts` — «read-only access» и «switching access off»: 3 run-а, вывод PowerShell
  приходит не в том порядке (ConPTY).
- `test/contract/workflow-reader.test.ts` — 682 Ticket-а за 597 ms при границе на Windows (`:1647`, `:1682`).
- `test/contract/workflow-branches-handles.test.ts:49`, `:94` — `cmd.exe /d /c rmdir /s /q`: «being used by
  another process».
- Два последних сейчас в `worfy-polish` 41 (нужен ПК); на runner-е они видны тоже, поэтому переходят сюда.

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): Windows job `full` входит в `ci-ok` каждого PR (Ticket 35), поэтому
эти flaky test-ы теперь краснят merge любого PR, а не только платформенного.

## Что делаем

1. Для каждого файла — 3 run-а `windows-tests.yml` в режиме `files` на ветке с меткой карантина, снятой на этот
   файл (`WORFY_QUARANTINE=run`): сколько раз красный.
2. Причина и правка причины: ожидание события watcher-а по условию, а не по часам; порядок вывода — ждать
   маркер, а не позицию; предел времени `workflow-reader` — мерить время своей работы (CPU), а не стены, если
   test проверяет скорость кода; `rmdir` — найти, кто держит handle, и дождаться его закрытия в коде.
3. Снять записи карантина починенных test-ов. Timeout-ы и пороги test-ов не поднимать.

Нужен ПК: нет — проверка на Windows-runner-е, режим `files` (dispatch). Трогает Harness: нет. Вердикт Windows:
runner `full` — run на PR (после Ticket-а 24 — автоматический, до него — dispatch Orchestrator-а).

## Готово, когда

- [ ] «Итог»: на каждый test — красных до правки, причина, правка, ссылки на run-ы.
- [ ] После правки — 3 run-а `files` на четыре файла подряд зелёные; ссылки и коды — в «Итог».
- [ ] Те же 3 run-а `files` зелёные и для test-ов, добавленных в карантин PR-ом #877: `orchestrator-relaunch`
      (оба test-а), `workflow-watch-links` (тот же link вместо папки issues, файла Ticket-а и корня Tickets),
      `demo-template` (оба test-а с `done`), `harness-evals` (`--changed` без case и округление бюджета) и
      `harness/bin/tests/wave-gate-lock-killed.test.sh` (lock убитого wave-gate, pid reuse, run 40615971705).
- [ ] Записей карантина этого Ticket-а не осталось; timeout-ы и пороги не изменены.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` на Mac — exit 0; вердикт Windows — runner `full` на head; условие
      merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).

Run-ы: около 6–8 run-ов `files` и один `full`. Денег они не стоят: репозиторий публичный с 2026-10-27, и
GitHub-hosted runner-ы для него бесплатны. Dispatch по-прежнему запускает Session Orchestrator-а на Mac (правило
Profile-а), не implementer.

## Где в коде

- `test/contract/claude-home-registry.test.ts`, `test/contract/link-access.test.ts`,
  `test/contract/workflow-reader.test.ts`, `test/contract/workflow-branches-handles.test.ts`
- `test/contract/orchestrator-relaunch.test.ts`, `test/contract/workflow-watch-links.test.ts` (same-link),
  `test/contract/demo-template.test.ts`, `test/contract/harness-evals.test.ts` — добавлены в карантин PR-ом #877
- `harness/bin/tests/wave-gate-lock-killed.test.sh` — случай убитого wave-gate, вынесен из
  `wave-gate-lock.test.sh`; его запись — `test/quarantine/harness-wave-gate-lock-killed.json`
- `test/quarantine/` — их записи
- `src/main/claude-home/registry.ts`, `src/main/link-*` — по найденной причине (дописать при claim)

## Вне скоупа

- `test/contract/terminal.test.ts` на ПК — `worfy-polish` 41.
- `image-protocol.test.ts` (`RUNNER~1`) — чинится отдельно.

## Итог

### Terminal AI на Linux runner-е: prompt после команды не приходит (PR #892, ветка `fix/terminal-ai-prompt-wait`)

Два contract test-а покраснели на Linux runner-е в PR #892, правка которого их не трогает:
`test/contract/terminal-ai-zle.test.ts:233` («the shell closes its connection while a command runs and says hello again
at the next prompt…», job 122732532153: «the next prompt 9997 ms after the line») и
`test/contract/terminal-ai-suggest.test.ts:357` («the request carries the line, the folder, the last 20 commands…», job
122732532051: «expected 25 to be greater than 25»). Карантинных записей у них не было.

**Причина — одна на оба.** Гипотеза «под нагрузкой zsh не успевает нарисовать prompt» не подтвердилась: prompt не
опаздывает, он теряется. В логе job-а после `D` и `P;Cwd` сразу идёт `\e[K\e[?1h\e=\e[?2004h`, без `\r\e[0m…\e[J`, без
`A`, `zle% ` и `B`: zsh уже ждёт клавишу, а prompt на экран не попал и не попадёт. Механизм:

- Таймер Suggestion (`src/main/terminal/zsh/rc.d/20-suggest-ai.zsh`, `_worfy_suggest_timer`) — subshell, его pid
  виден zsh. Enter (line-finish) убивает его `kill -TERM` (`_worfy_suggest_stop`) и сразу идёт дальше: команда (`true`,
  `:` — builtin, мгновенно), precmd, prompt. SIGCHLD от умершего subshell-а приходит в этот момент. Таймер стартует на
  каждой строке test-ов: замер на Mac с логом в скрипте — `TIMER-START`/`TIMER-KILL` на всех 22 строках test-а zle.
- Обработчики сигналов zsh ставятся без `SA_RESTART`; на Linux `write()` в tty, во время которого пришёл сигнал,
  возвращает `EINTR` (strace: `write(10, "\10tr", 3) = ? ERESTARTSYS`), а stdio glibc при ошибке `fflush` выбрасывает
  буфер. Так пропадает запись `zrefresh` с prompt-ом и его `B`; worfy не видит события prompt, test ждёт до timeout-а.
  На macOS libc сохраняет недописанный буфер — поэтому на Mac test не краснеет ни разу.
- Воспроизведение механизма отдельно от worfy: контейнер `ubuntu:24.04`, zsh 5.9, python-pty вводит `true` 200 раз; без
  сигналов prompt потерян 0/200, с потоком `kill -CHLD` в zsh — 49/200, и хвост вывода тот же, что в логе CI
  (`\r \r\e[K\e[?1h\e=\e[?2004h`).

**Правка — в продукте.** `_worfy_suggest_stop` после `kill -TERM` ждёт, пока zsh пожнёт subshell
(`_worfy_suggest_reap`: `kill -0` до отказа, между проверками `zselect -t 1`, который будит тот же SIGCHLD; не больше
100 проверок на случай чужого pid). Сигнал приходит, пока zsh ничего не пишет в терминал. Timeout-ы и пороги test-ов
не менялись. Test `there is one timer however many keys are pressed, and Enter ends it and its subshell at once`
(`test/contract/terminal-ai-suggest.test.ts`) теперь проверяет subshell первым словом команды после Enter, до запуска
программы: «gone» значит, что zsh его уже пожал.

**Красных из 10** (Mac — `node scripts/vitest-electron.mjs <файл> -t <имя>`; нагрузка — `yes > /dev/null` на 9 из 18
ядер, pid-ы сохранены и убиты по одному; Linux — контейнер `node:24-bookworm`, 4 CPU, zsh 5.9, нагрузка — 4 `yes` в
контейнере):

| test | Mac тихо до/после | Mac нагрузка до/после | Linux тихо до/после | Linux нагрузка до/после |
| --- | --- | --- | --- | --- |
| zle, «says hello again at the next prompt» | 0 / 0 | 0 / 0 | 0 / 0 | **5** / 0 |
| suggest, «the request carries the line…» | 0 / 0 | 0 / 0 | 0 / 0 | **3** / 0 |

На Linux все 8 красных — с той же подписью, что в CI («expected N to be greater than N», хвост без prompt-а).

**Mutant:** исходный `20-suggest-ai.zsh` (без ожидания) против усиленного test-а Enter — 5 из 5 красных на Mac
(`expected 'alive\r\npipe-checked…' to contain 'gone'`); с правкой — 3 из 3 зелёных; файл восстановлен из копии,
`cmp` — код 0.

Команды и коды выхода: оба файла целиком на Mac с правкой
(`node scripts/vitest-electron.mjs test/contract/terminal-ai-suggest.test.ts test/contract/terminal-ai-zle.test.ts`) —
0, 86 passed; на Linux в контейнере suggest целиком — 0; zle целиком — 1 из-за `the messages of main > status is a grey
note…`, который красный и до правки (5 из 5): в контейнере нет locale `en_US.UTF-8`, «…» выводится байтами. Это
окружение контейнера, на runner-е этот test зелёный. `pnpm lint`, `pnpm typecheck`, gate fast — в PR.

### `harness/hooks/tests/guard-silent.test.sh`: EPIPE от `bin/silent-check` (2026-10-28, ветка `fix/guard-silent-epipe`)

- Где краснел: macOS runner — job 122744439103 («an unknown exit code», `exit 3`), job 122747558462 и
  job 122630495860 («killed by a signal»); на Mac под нагрузкой — «exit 0 -> allow at once». Во всех случаях
  вместо своей причины отказ «failed (EPIPE: spawnSync … EPIPE)».
- Причина: `harness/hooks/guard.mjs:228` передаёт текст в stdin `bin/silent-check` через `spawnSync(…, { input })`.
  Stub test-а выходит, не читая stdin. Если процесс закрыл pipe раньше, чем node дописал текст, `spawnSync`
  возвращает и код выхода, и `error` с кодом EPIPE. Hook смотрел на `r.error` раньше кода выхода и отказывал
  с причиной EPIPE. Гипотеза Orchestrator-а подтвердилась. С малым текстом это гонка; с текстом больше буфера
  pipe — каждый раз. Та же ошибка была и в продукте: настоящий `silent-check` в Full-проекте с attribution on
  выходит с кодом 0 сразу, и длинное сообщение commit-а получало бы отказ EPIPE.
- Правка: `guard.mjs:241-245` — EPIPE при известном коде выхода или сигнале не считается сбоем запуска,
  вердикт берётся из кода выхода (0 — пропустить, 1 — следы, 3 — «failed (exit 3)», сигнал — «signal SIGKILL»).
  EPIPE без кода выхода и любые другие ошибки запуска отказывают, как раньше. Timeout-ы не менялись, sleep нет.
- Детерминированный test: `guard-silent.test.sh:246-255` — текст commit-а в 1 MB через `git commit -F`, stub
  не читает stdin: exit 3 → «failed (exit 3)» без EPIPE, exit 0 → allow, SIGKILL → «signal SIGKILL» (кроме Windows).
- Красные (весь файл, `HOME` — пустая временная папка, около 60 s на run):
  - до правки, старый test: 0/10 без нагрузки, 0/10 под нагрузкой (`yes` на 9 из 18 ядер, предел 120 s на run);
  - до правки, новый test: 1/1 красный (4 FAIL, все с EPIPE);
  - после правки: 0/10 без нагрузки, 0/10 под нагрузкой;
  - mutant (старый `guard.mjs` с новым test-ом): exit 1, те же 4 FAIL; файл восстановлен из копии, `cmp` — exit 0.
- Команды: `bash harness/hooks/tests/guard-silent.test.sh` (с пустым `HOME`) — exit 0 после правки; `pnpm lint` —
  exit 0; `pnpm typecheck` — exit 0; `gate.mjs fast` — exit 0, «[gate] green (fast)» с третьего run-а. Два первых
  run-а — exit 2 при load average 20–25 от других Session-ов, красные чужие файлы: `terminal.test.ts`, затем
  `terminal-ai-suggest.test.ts` (3 test-а) и `gate-verdict.test.sh` (предел 120 s); `guard-silent.test.sh` в обоих
  зелёный.
- `harness/hooks/tests/gate-verdict.test.sh` — причина другая: в job 122744439103 он зелёный (113 s), а в job
  122747558462 красный из-за предела 120 s на файл в `test/contract/harness-scripts.test.ts` («killed after
  120 s»), строк FAIL и EPIPE нет. В этой правке его не трогали.

### e2e `browser-layer` zoom 0.25 на macOS runner-е (ветка `fix/browser-layer-zoom-quarter`)

- **Что было.** `test/e2e/browser-layer.spec.ts:370`, «zoom 0.25…», красный в job `macos-e2e (1/2)`: run-ы
  40649755730 (PR #884), 40644132756 (PR #882), PR #885; около минуты и «every edge of the page and of the
  frame found in the capture». Зелёные run-ы того же job: 40640810358, 40651661167.
- **Причина.** Край frame test читает по зелёной outline шириной 1 CSS px. Zoom Canvas-а 0.25 при display
  scale 1 (1024×768 runner-а) делает её четвертью device pixel: после antialiasing зелёного в пикселе на
  несколько уровней цвета, около порога `GREEN` (`test/e2e/browser-pixels.ts:76`). В части run-ов outline
  не находится ни на одном крае (Infinity). Ничего не перерисовывается, поэтому каждый следующий capture
  читает те же пиксели. Через 30 s Browser на zoom ниже 0.4 засыпает (`src/main/browser/sleep.ts`, правило
  far), и после этого test дожидается своего timeout-а 60 s. Доказательства: trace run-а 40649755730 —
  frame `data-life="live"` 30 s, потом `asleep`; пиксель outline на снимке run-а — `#d9f1dc` (вес `GREEN`
  1). Локально с `--force-device-scale-factor=1` (только для разбора, в PR нет) outline — `#e5f2e3`, вес 0.
- **Правка (только test).** Outline шириной `outlineWidth(zoom, scale)` = `max(1, 1 / (zoom × scale))`
  CSS px, то есть не меньше одного device pixel на экране. `edgeErrors` получает ширину outline
  (`line`), край body — на половину outline внутрь от её центра. Граница `edgeBound` (2.5 px при scale 1
  и zoom 0.25) и display scale не менялись; timeout-ов и sleep нет.
- **Красных до и после.** До: на Mac (scale 2) 0 из 10; с scale 1 — 5 из 5 красные с той же ошибкой.
  После: scale 2 — 0 из 10, края 0.25/0.28 px; scale 1 — 0 из 10, края 1 px на всех четырёх
  (граница 2.5). Mutant (`outlineWidth` снова 1 px), scale 1 — красный с ошибкой CI; restore, `cmp` 0.
  Mutant `edgeErrors` (`zoom / 2` вместо `line / 2`) — 3 unit-test-а красные; restore, `cmp` 0.
- **Команды.** `pnpm test:e2e test/e2e/browser-layer.spec.ts --grep "zoom 0.25" --repeat-each 10 --workers=1`
  под `/tmp/worfy-e2e.lock`: до — exit 0, после — exit 0; `pnpm test test/unit/e2e-browser-pixels.test.ts`
  — exit 0 (40 test-ов); `pnpm lint` — exit 0; `pnpm typecheck` — exit 0.
- **Не проверено здесь.** Числа на настоящем runner-е: первый run — CI этого PR.

#### Наблюдения

- 2026-10-28: `harness/hooks/tests/gate-verdict.test.sh` убит пределом 120 s на файл в `test/contract/harness-scripts.test.ts`, job 122747558462, это не EPIPE.

### Отложено

- 2026-10-28, из PR #907: `_worfy_suggest_timer_end` (`src/main/terminal/zsh/rc.d/20-suggest-ai.zsh:89`) — тот же
  SIGCHLD может прийти при естественном конце таймера Suggestion, и на Linux потеряется ask или перерисовка.
  Детерминированного test-а нет, правки нет. Если flaky test terminal-ai вернётся после мержа #907, берём это первым.

### Наблюдения, отложенные без PR

- 2026-10-28, `test/contract/harness-migrate.test.ts` › «Q19 matches the plugin…»: `Hook timed out in 60000ms` в
  beforeEach `useSandbox` (`test/contract/harness-migrate-harness.ts:130`), CI #892, job 122732532813. На runner-е
  первые два test-а файла шли 72 s и 52 s, остальные ~5 s; в то же окно шли harness-evals, projects, terminal-ai-suggest
  и link-server. На ПК sandbox — 1,6 s тихо (12 вызовов git — ~1,25 s), под нагрузкой 16 spinner-ов первый test 5,8 s;
  60 s не воспроизвелось. Готовый sandbox не скопировать: fixture пишет свой путь в файлы, которые коммитит. Решение
  Orchestrator-а: смотрим test после мержа #889; при повторе берём параллельный git плюс печать времени шагов
  sandbox-а в CI-лог.
- 2026-10-28, Windows job #884 (122747558557, образ windows-2025-vs2026 20261021.278.1): в выводе
  `project-connect.test.sh` 78 строк «line 97: shasum: command not found» — на этом образе у Git Bash нет `shasum`.
  Красным файл сделал не он: файл оборвался со статусом 2304 (exit 9) без строки FAIL, как ещё семь файлов этого
  job-а (wave-gate-heartbeat, wave-gate-screen, gate-args, wave-gate-lock и другие) — это давление на job, его
  закрывают #887 и shard-ы #889. Без `shasum` проверка «Harness home не изменился» сравнивала только имена
  файлов; #908 считает хеш через node.
- 2026-10-28, `test/contract/harness-evals.test.ts:1982` «says "cases mismatch" when a chosen case is missing…»: `Test
  timed out in 45000ms` на Windows runner-е (#885, job 122748777183). Head уже содержит #888, то есть одного
  временного git-репозитория на все `--changed` case-ы мало. Перемерить после #889 (shard-ы); если не уйдёт —
  разбирать, что в case-е стоит дороже 45 s.
- 2026-10-28, Windows `harness/bin/tests/preflight.test.sh` — «FAIL timeout, pipe held: []» на #900, job 122763723853
  (файл 93 s, 49 из 50 проверок `ok`). Вывод в скобках пустой: `node -e`, который зовёт `withTimeout(1, …)` с
  отсоединённым внуком, держащим pipe, не напечатал ни код, ни время, ни ошибку — похоже, его promise так и не
  разрешился и node вышел молча; соседняя проверка «timeout: exit 124 within 3 s, the grandchild is stopped too» в том
  же прогоне `ok`. Пока не чиним.
- 2026-10-28, Windows `harness/bin/tests/profile-set.test.sh` — «FAIL lock released while waiting» на #911, run
  40697796322. Diff #911 этот файл и `harness/bin/profile-set` не трогает. Проверка снимает lock через `sleep 0.5`
  после старта писателя, то есть по часам: под нагрузкой фоновый `rmdir` может прийти позже, чем кончается
  ожидание писателя. Ту же проверку лечит #892 (head 9f4f64f8, ещё открыт): lock снимается, когда
  писатель сказал, что ждёт. Скорее всего, это та же причина до мержа #892; отдельного PR не нужно, после мержа
  смотреть, повторится ли.
- 2026-10-28, Windows `harness/bin/tests/ticket-mark.test.sh`, case «silent: live lock» — «could not take the lock
  …\marks\shopfront-02.json.lock: EPERM: operation not permitted, mkdir» на #903 (a362aa8b), job 122870357635. Diff
  #903 этот файл не трогает. Похоже, `mkdir` lock-а пришёлся на момент, когда соседний процесс удаляет тот же
  каталог: на Windows такой `mkdir` даёт EPERM, а не EEXIST, и код принимает его за отказ, а не за занятый lock.
  Отдельного PR пока нет; при повторе — считать EPERM от `mkdir` lock-а таким же «занят», как EEXIST.
