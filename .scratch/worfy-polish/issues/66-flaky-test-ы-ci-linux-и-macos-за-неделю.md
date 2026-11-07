# 66 — Flaky test-ы CI Linux и macOS за неделю

Type: bug
Status: claimed 2026-11-07T22:28Z
Blocked by: —
Source: история CI 2026-11-01…11-07 (`ci.yml`): все 414 завершённых run-ов `main` с 2026-11-01 и 305 из 617 run-ов PR
(с 2026-11-04 22:37). Остальные run-ы PR и job-ы 42 run-ов из этих 305 не прочитаны: GitHub ответил «API rate limit
exceeded» на чтение логов job-ов.

## Что происходит

Строки FLAKY (test упал, retry прошёл; `test/flaky.ts`) из логов job-ов `linux-tests`, `macos-tests`, `macos-e2e`,
`windows*`. Счёт — job-ы, в которых test был flaky; строка файла — по последнему появлению. Ниже — test-ы, flaky хотя бы
дважды, кроме тех, что принадлежат открытым Ticket-ам (в конце).

| Test | Платформа: job-ов | Всего (main, PR) | Первый … последний |
|---|---|---|---|
| `test/e2e/autopilot-faults.spec.ts:36` «the app killed with SIGKILL in the middle of a Wave…» | Windows 17, macOS 5 | 22 (10, 12) | 11-05 … 11-07 |
| `test/contract/codex-app-server.test.ts:304` «close() kills a fake that outlives its stdin…» | Windows 21 (+3 красных) | 21 (20, 1) | 11-03 … 11-07 |
| `test/e2e/trash-undo.spec.ts:116` «a deleted Card comes back from the Trash…» | Windows 12 | 12 (8, 4) | 11-01 … 11-06 |
| `test/contract/autopilot-faults-github.test.ts:156` «gh hangs the whole Run…» | Windows 10 | 10 (1, 9) | 11-05 … 11-07 |
| `test/contract/e3-sandbox.test.ts:1114` «two runs that find the same abandoned lock…» | Linux 8 | 8 (7, 1) | 11-02 … 11-06 |
| `test/e2e/autopilot-faults.spec.ts:115` «GitHub out of reach for the whole Run…» | macOS 8 | 8 (4, 4) | 11-05 … 11-06 |
| `test/e2e/session-history-tail.spec.ts:53` «a 40 MB transcript opens on its newest turns…» | macOS 5, Windows 2 | 7 (6, 1) | 11-01 … 11-06 |
| `test/e2e/packaged.spec.ts:998` «a second dev run over the same data folder…» | macOS 7 | 7 (4, 3) | 11-01 … 11-06 |
| `harness/bin/tests/wave-gate-heartbeat.test.sh` (через `harness-scripts-1.test.ts`) | macOS 4, Windows 3 | 7 (6, 1) | 11-03 … 11-06 |
| `harness/bin/tests/wave-gate-lock.test.sh` (через `harness-scripts-1.test.ts`) | Windows 6 | 6 (3, 3) | 11-04 … 11-06 |
| `test/contract/flight-recorder-gate-logs.test.ts:460` «writes nothing to the Harness home or the repository…» | macOS 5 | 5 (5, 0) | 11-01 … 11-07 |
| `test/contract/autopilot-limits.test.ts:1422` «a Limits wait begun while the Wave settles…» | macOS 5 (+ gate fast на Mac) | 5 (5, 0) | 11-02 … 11-06 |
| `test/e2e/autopilot-queue.spec.ts:128` «a run over two Epics…» | macOS 4, Windows 1 | 5 (2, 3) | 11-07 … 11-07 |
| `test/e2e/linked-machines.spec.ts:791` «A opens a Project of B…» | Windows 5 | 5 (4, 1) | 11-01 … 11-06 |
| `test/e2e/browser-mcp.spec.ts:406` «a service worker of another site…» | macOS 5 | 5 (4, 1) | 11-01 … 11-05 |
| `test/e2e/toast-placement.spec.ts:135` «an error toast that stays covers no control…» | macOS 4 | 4 (3, 1) | 11-01 … 11-06 |
| `test/e2e/card-api.spec.ts:89` «a Card keeps its own data…» | Windows 4 | 4 (4, 0) | 11-01 … 11-01 |
| `test/contract/cards-watch-links.test.ts:64` «reports a change of a file of a Card…» | Windows 3 | 3 (3, 0) | 11-01 … 11-01 |
| `test/e2e/palette-find.spec.ts:107` «⌘K goes to a Ticket…» | macOS 2, Windows 1 | 3 (1, 2) | 11-02 … 11-06 |
| `test/contract/cards-watch-edits.test.ts:91` «reaches the listeners of the store of Cards» | macOS 2 | 2 (2, 0) | 11-03 … 11-06 |
| `test/contract/autopilot-limits.test.ts:1236` «five_hour (stub Limits): Start window, budget on…» | macOS 2 | 2 (2, 0) | 11-03 … 11-06 |
| `test/e2e/browser-family.spec.ts:155`, `browser-focus.spec.ts:459`, `external-session.spec.ts:134` | macOS 2 каждый | по 2 | 11-03 … 11-07 |

Красные под нагрузкой на Mac владельца (gate fast 2026-11-07, по данным Orchestrator-а), в CI за неделю не замечены:
`test/contract/login-shell-capture.test.ts:144-146` (2 из 2), `test/contract/harness-hook-stdin.test.ts:345`,
`test/unit/search-index.test.ts:282` (предел 100 ms, было 112 ms), `test/unit/getting-started-panel.test.tsx:141`, `:158`
(timeout 15 s), `test/contract/projects-connect.test.ts:876`.

Чужие, в этот Ticket не входят:

- `test/contract/autopilot-wait.test.ts` (строки 331, 477–515; Linux 13, macOS 4) — `worfy-polish` 65.
- `test/e2e/update-settings.spec.ts:98` (macOS 11, Windows 9) — `worfy-polish` 47, исправлен #1538
  (2026-11-06 23:11Z); после него в 66 run-ах `main` ни одного FLAKY.
- `test/e2e/browser-sleep.spec.ts:215`, `test/e2e/epic-frame.spec.ts:406`, `:1107`, `test/e2e/browser-profile.spec.ts:127`
  (macOS 6, Windows 1) — названы в `worfy-polish` 47.
- `test/e2e/evidence-capture.spec.ts:649`, `:755` (recordClip) — тема `worfy-polish` 60.
- Записи карантина (`test/quarantine/`) — `audit-code-2026-11-07` 03.

## Что делаем

1. Для каждого исправляемого test-а — сначала воспроизвести (цикл, задержка, параллельные копии), потом лечить причину:
   ожидание настоящего условия вместо отсчёта, без порядка между test-ами, свои временные папки и порты. Timeout-ы не
   подстраивать, новых записей карантина не заводить.
2. Исправить столько из таблицы, сколько воспроизводится; остальные — в «Итог» с тем, что известно.

Глубина review — `medium`. Не платформенный: правка только в test-ах, без путей и процессов ОС в коде приложения.

## Готово, когда

- [ ] Таблица flaky test-ов за 2026-11-01…11-07 в «Что происходит».
- [ ] Каждый исправленный test воспроизведён до правки и проходит после неё: счёт до и после в «Итог».
- [ ] Исправленные test-ы — 20 прогонов подряд зелёные; все unit и contract test-ы затронутых модулей, `pnpm lint`,
      `pnpm typecheck`, gate fast — exit 0.
- [ ] Не исправленные test-ы таблицы — в «Итог», с причиной или с тем, почему её не нашли.
- [ ] `ci-ok` зелёный на head PR.

## Где в коде

- `test/contract/codex-app-server.test.ts` — проверки выхода процесса после `close()` (строки 247, 297, 308 до правки).
- `test/contract/autopilot-limits.test.ts:1251`, `:1447` — ожидание Start window.
- `test/contract/flight-recorder-gate-logs.test.ts:351`, `test/contract/docs.test.ts`, `test/contract/projects.test.ts`,
  `test/contract/work-track-service.test.ts`, `test/contract/work-track-ticket-status.test.ts`,
  `test/contract/workflow-reader.test.ts` — git helper-ы test-ов, `maintenance.auto=false`.
- `test/contract/login-shell-capture.test.ts:85-86`, `:142`, `:183` — файл HOME/after.
- Только чтение: `src/main/agent/session/process.ts:96-110` (`waitForExit`), `src/main/vendors/codex/app-server.ts:154-173`
  (`close`), `src/main/autopilot/run.ts:2386-2404`, `src/main/autopilot/journal.ts:71-87` (`append`),
  `test/e2e/autopilot-world.ts:29-36` (та же правка для e2e, #1510).

## Итог

Исправлены пять причин, все — в test-ах; код приложения не тронут. Каждая воспроизведена до правки.

1. **`codex-app-server.test.ts:304`** (Windows: 21 flaky и 3 красных job-а за неделю; ещё красный на PR #1603). `close()`
   кончается по ответу системы: `waitForExit` раз в 50 ms спрашивает `kill(pid, 0)`. Событие `exit` Node, которое
   ставит `exitCode`, на Windows приходит позже (`process.ts:96-104` это и описывает), и `hasExited()` сразу после
   `close()` — `false`. Та же проверка стояла ещё в двух test-ах файла (`:247`, `:297`). Теперь test-ы спрашивают
   систему (`kill(pid, 0)` → ESRCH), а код выхода читают после события `exit`. Воспроизведение на Mac: событие
   `exit` отложено на 400 ms (подмена `child.emit` в копии test-а): до правки 10 run-ов из 10 красные (3 test-а
   в каждом), после — 10 из 10 зелёные. Цикл 20 run-ов настоящего файла — 20 зелёных. Наблюдение `worfy-polish` 47
   про этот test можно снять.
2. **`autopilot-limits.test.ts:1422`** (macOS 5, красный в gate fast) и **`:1236`** (macOS 2). Test ждал строку
   journal-а, а сразу после неё проверял состояние run-а. Строка видна, как только `appendFile` её записал, а
   `append` (open, write, close) кончается позже; состояние run меняет только после двух строк. Теперь test ждёт само
   состояние (`waitingFor === start-window`). Воспроизведение: пауза 30 ms между двумя записями в `run.ts` —
   `:1422` до правки 8 из 10 красных, `:1236` — 8 из 10 красных; после — 10 из 10 зелёных; файл 20 раз подряд — 20
   зелёных.
3. **`flight-recorder-gate-logs.test.ts:460`** (macOS 5, последний 2026-11-07) и ещё пять test-ов с тем же риском. новый git после merge
   и commit запускает
   `git maintenance run --auto --detach`, и его `.git/objects/maintenance.lock` появляется и пропадает, пока test
   сравнивает файлы репозитория. Тот же lock был macOS-причиной `autopilot-faults.spec.ts:35` (лог run-а
   42245041471: `ENOENT … demo/.git/objects/maintenance.lock`), её закрыл #1510 для e2e. На Windows runner-е git 2.56.0 (лог run-а 42351046268), версию
   git macOS runner-а логи не печатают. В контейнере с git 2.56.0 lock появляется после merge и через доли секунды
   исчезает: `find` сразу после 30 merge-ей 16 раз не застал уже найденный lock (Apple git 2.50 на Mac lock не делает). Воспроизведение на Mac: обёртка `git`, которая после merge и commit держит
   lock 0.3 s и, как git, молчит при `maintenance.auto=false`. Весь `pnpm test` под обёрткой — 8 красных test-ов:
   `flight-recorder-gate-logs.test.ts:460`, `docs.test.ts:409`, `projects.test.ts:592`, `work-track-service.test.ts:201`,
   `work-track-ticket-status.test.ts:169`, `workflow-reader.test.ts:751`, `:977` и Harness-test
   `bin/tests/wave-brief.test.sh`. До правки: `flight-recorder-gate-logs` 8 из 10 красных, пять других файлов — 3 из 3
   run-ов красные. После `maintenance.auto=false` в их git helper-ах — 3 из 3 зелёных под обёрткой, циклы по 20 без
   обёртки — 20 зелёных. `wave-brief.test.sh` и `harness-migrate-boundaries.test.ts:32` (тоже краснел под обёрткой) не
   тронуты: это `harness/` и его test-ы, у них свой порядок правки.
4. **`login-shell-capture.test.ts:144-146`** (и `:133-134`, тот же приём): фоновый процесс писал `echo x > HOME/after`,
   test ждал появления файла и читал его пустым — `>` создаёт файл раньше текста. Теперь файл приходит переименованием
   `after.tmp`. Воспроизведение: пауза 0.3 s между созданием файла и текстом — до правки 5 из 5 красных
   (`expected  to be 0`, `expected  to be survived`), после — 5 из 5 зелёных; файл 20 раз подряд — 20 зелёных.

Не исправлены:

- `e3-sandbox.test.ts:1114` (Linux 8, последний 2026-11-06 15:09): не воспроизвёлся — 24 run-а на Mac по 8 параллельно,
  24 run-а test-а и 16 run-ов всего файла в Linux-контейнере (Debian, 4 CPU). Текста ошибки нет: vitest не печатает
  ошибку попытки, прошедшей на retry.
- `autopilot-faults.spec.ts:36` на Windows (17): ошибка — `journals(world.dataDir)` пуст после kill и `close`
  (`TypeError … reading split`, run 42351046268). Причина не найдена, Windows e2e — вне Linux/macOS.
- `trash-undo.spec.ts:116`, `autopilot-faults-github.test.ts:156`, `linked-machines.spec.ts:791`, `wave-gate-lock.test.sh`,
  `card-api.spec.ts:89`, `cards-watch-links.test.ts:64` — только Windows; не разбирались.
- macOS e2e `autopilot-faults.spec.ts:115`, `session-history-tail.spec.ts:53`, `packaged.spec.ts:998`,
  `browser-mcp.spec.ts:406`, `toast-placement.spec.ts:135`: последний FLAKY — 2026-11-05…11-06, после него 74–141 run-ов
  `main` без него. Не разбирались. `autopilot-queue.spec.ts:128` — последний FLAKY до #1558 (2026-11-07 04:55Z), после — нет.
- `wave-gate-heartbeat.test.sh` (macOS 4, Windows 3) — `harness/`, не разбирался.
- `cards-watch-edits.test.ts:91` (macOS 2) — FSEvents под нагрузкой, не разбирался.
- Красные под нагрузкой из данных Orchestrator-а: `harness-hook-stdin.test.ts:345` (pty отдал пустой вывод — причина
  не найдена), `search-index.test.ts:282` (предел времени 100 ms — подстройка одного предела запрещена правилом
  проекта), `getting-started-panel.test.tsx:141`, `:158` (timeout 15 s), `projects-connect.test.ts:876` — не разбирались.
