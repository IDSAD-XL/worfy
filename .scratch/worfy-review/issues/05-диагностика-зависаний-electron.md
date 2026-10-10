# 05 — Диагностика зависаний и падений worfy: запись о падении процесса и стек при таймауте шага по CDP

Type: task
Status: claimed — 2026-10-10
Blocked by: —
Source: решение владельца 2026-10-09 («Хорошие идеи, сохрани их и добавь в планы к имплементации»), пункт «диагностика зависаний» из таблицы; [исследование](../../../docs/research/2026-10-09-ponytail-pstack-thermos.md), раздел о pstack: Unix-утилита `pstack` печатает стеки потоков процесса, на macOS её нет, ближайшая замена — `sample`; [spec.md](../spec.md)

## Что происходит

- **Падение renderer или дочернего процесса не оставляет следа.** В `src/main/index.ts` нет
  обработчиков `render-process-gone` и `child-process-gone` и нет `crashReporter`. Electron шлёт эти
  события, когда процесс окна или вспомогательный процесс (GPU, utility) завершился аварийно. Сейчас
  окно просто становится пустым.
- **Лога-файла у main process нет.** Main process пишет через `console.warn` и `console.error`
  (например, `src/main/index.ts:35`, `:49`, `src/main/startup-failure.ts:117`). Stable copy (копия
  `worfy.app` вне репозитория, на которой идёт Autopilot) запускается через `open -a`, и её
  stdout/stderr никто не читает. Запись о падении должна лечь в файл в папке данных (`dataRoot()`,
  `src/main/storage/paths.ts`).
- **Зависание при управлении по CDP не диагностируется.** Orchestrator управляет Stable copy через
  CDP (Chrome DevTools Protocol): запуск с `--remote-debugging-port=9351`, затем `Runtime.evaluate`.
  Выход — по точному pid. Этот порядок записан в личной памяти владельца, вне репозитория; в
  репозитории есть только раздел «Stable copy» в `README.md`. Когда шаг не отвечает, сейчас остаётся
  одно — убить процесс. Что он делал, неизвестно.
- **На macOS есть `sample`** (`/usr/bin/sample`). `sample <pid> 3 -file <файл>` три секунды снимает
  стеки всех потоков процесса без остановки. JS-кадров в нём нет, только нативные. Этого хватает,
  чтобы отличить ожидание I/O от занятого цикла.

## Что делаем

Ticket можно разделить на два независимых PR. Части не делят файлы.

**Часть А — код worfy.**
1. Новый модуль `src/main/diagnostics/process-gone.ts`: подписка на `app` события
   `render-process-gone` и `child-process-gone`. Каждое событие — одна JSON-строка в
   `<dataRoot()>/logs/process-gone.jsonl`: время, вид процесса, `reason`, `exitCode`, для окна — его
   URL. Запись дописывается в конец файла. Ошибка записи не роняет worfy, а уходит в `console.error`.
2. Подключение в `src/main/index.ts` рядом с другими `inStep(…)`. `inStep` принимает только имя
   шага из закрытого union `StartupStep` (`src/main/startup-failure.ts:11-21`), и у каждого шага
   есть запись в таблице `STEPS` (`:34`). Поэтому новый шаг (например, `installProcessGone`) — это и
   правка `src/main/startup-failure.ts`: имя в union и запись в `STEPS`.
3. Перезапуск окна после падения не делаем: только запись.

**Часть Б — снимок стека при таймауте.**
1. Новый скрипт `scripts/hang-sample.mjs <pid> [секунды]`. `<pid>` — main process Stable copy (тот
   точный pid, что получен при запуске). `Runtime.evaluate` исполняется не в нём, а в процессе
   renderer, дочернем процессе main. Поэтому скрипт снимает стеки main process и его дочерних
   процессов из того же бандла.
   - **Проверка pid.** Путь main process (`ps -o comm= -p <pid>`) — `<бандл>.app/Contents/MacOS/worfy`:
     имя исполняемого файла задаёт `productName: worfy` (`electron-builder.yml:4`). Бандл — любой
     `.app`: `pnpm install:stable` принимает любой путь, по умолчанию
     `~/Applications/worfy-stable.app` (`README.md`, раздел «Stable copy»). Имя бандла в скрипте не
     прописывается. Другой pid — отказ с ненулевым кодом.
   - **Какие дочерние процессы.** Из `pgrep -P <pid>` скрипт берёт те, чей путь лежит внутри того же
     бандла:
     - helper-ы Electron в `<бандл>/Contents/Frameworks/`: `worfy Helper (Renderer)` — окна
       (`--type=renderer`); `worfy Helper` — GPU-процесс (`--type=gpu-process`) и utility-процессы,
       например network service (`--type=utility`). Бандлы `worfy Helper (GPU).app` и
       `worfy Helper (Plugin).app` в `Frameworks/` есть, но процессов под этими именами нет: на
       запущенной Stable copy (Electron 44.5.1) GPU-процесс идёт как `worfy Helper`
       (`ps -axo pid,comm,args`, 2026-10-09). Вид процесса берётся из аргумента `--type=`, а не из
       имени;
     - `claude` Agent SDK — `<бандл>/Contents/Resources/app.asar.unpacked/…`
       (`src/main/agent/options.ts:75`).
   - **Дочерние процессы вне бандла — не отказ.** Это shell-ы Terminal (node-pty,
     `src/main/terminal/pty.ts:355`), `git` и `gh` через `execFile`. Скрипт их не снимает и печатает
     строкой `skipped: <pid> <путь>`.
   - Для каждого выбранного процесса запускает `sample <pid> <секунды> -file <файл>`, все
     параллельно, и печатает пути к файлам. Файлы — в `<data root>/logs/hang-<время>-<pid>.txt`; имя
     процесса — в первой строке файла `sample`.
   - Код выхода — 0, если все `sample` вернули 0; иначе первый ненулевой код.
2. В `README.md`, раздел «Stable copy», — абзац: при таймауте шага по CDP запустить скрипт на pid
   main process и приложить файлы как evidence (доказательство в отчёте), потом завершить процесс.
   Если в файле main process есть `NSPersistentUIRestorer` и `NSAlert runModal`, это окно macOS
   «восстановить окна?» — урок в `docs/lessons/agents.md`.
3. Шаг владельца, не в PR: дописать тот же шаг в личную заметку о CDP Autopilot.

Не проверенные альтернативы — для «Итог», если `sample` не хватит: `spindump <pid>` (нужен sudo);
`lldb -p <pid>` и `thread backtrace all` (останавливает процесс); `process.report.writeReport()` или
`--report-on-signal` у Node (даёт JS-стек, но требует флага при запуске).

## Готово, когда

- [x] Часть А. Unit `test/unit/process-gone.test.ts`: поддельный `app` шлёт `render-process-gone` и
  `child-process-gone` → в файле по строке с нужными полями; ошибка записи → `console.error`, без
  исключения. Сначала test красный: модуля нет.
- [x] Часть А. Ручная проверка на собранном приложении. `process.crash()` из DevTools не сработает:
  у окна `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
  (`src/main/window.ts:84-86`), `process` в renderer нет. Renderer роняется командой CDP `Page.crash`
  (запуск с `--remote-debugging-port`) или вызовом `webContents.forcefullyCrashRenderer()` из main →
  в `process-gone.jsonl` есть строка. Способ и вывод — в «Итог».
- [x] Часть Б. Ручной прогон `node scripts/hang-sample.mjs <pid main process>` на запущенной Stable
  copy с открытым Terminal в worfy → файлы с потоками main process и helper-ов, среди них файл
  `worfy Helper (Renderer)`; shell Terminal — строка `skipped:`, код выхода 0. На pid, который не
  main process упакованного worfy (например, pid того shell-а), — отказ с ненулевым кодом. Вывод и
  коды — в «Итог». Отметка стоит за прогон не на Stable copy владельца, а на копии той же сборки,
  установленной тем же `scripts/install-stable.sh` во временную папку: brief Wave запретил трогать
  Stable copy. На самой Stable copy — не проверено.
- [x] `gate.sh fast` — код 0 и строка `[gate] зелено (fast)`.

## Где в коде

- `src/main/index.ts`
- `src/main/startup-failure.ts` — новый шаг в union StartupStep и в таблице STEPS
- `src/main/diagnostics/process-gone.ts` — новый
- `test/unit/process-gone.test.ts` — новый
- `scripts/hang-sample.mjs` — новый
- `README.md` — раздел «Stable copy»

## Вне скоупа

- `crashReporter` с отправкой отчётов на сервер.
- Зависание main process самого по себе (без CDP): нужен watchdog, это отдельный Ticket.
- Перезапуск упавшего окна.

## Риски

- **`sample` без JS-стека.** Если причина в JS-цикле renderer-а, файл процесса renderer покажет
  только кадры V8. Файл main process этот цикл не покажет вовсе: `Runtime.evaluate` идёт в процессе
  renderer. Для JS-стека нужен `--report-on-signal`, а это смена флагов запуска.
- **Права macOS.** `sample` чужого процесса того же пользователя обычно разрешён; на подписанном
  приложении с hardened runtime может потребоваться sudo. Stable copy подписана ad-hoc — проверить.
- **Открытый вопрос:** лог `process-gone.jsonl` растёт без предела. Обрезать по размеру или оставить
  как есть, пока событий единицы. Решает исполнитель, итог — в «Итог».

## Итог

Сделано одним PR (ветка `worfy-review/05`, коммит кода `be305db`): обе части вместе.

**Часть А — запись о завершившемся процессе.** `src/main/diagnostics/process-gone.ts`,
`installProcessGone()`: подписка на `render-process-gone` и `child-process-gone` у `app`. Каждое
событие — одна JSON-строка в конец `<dataRoot()>/logs/process-gone.jsonl`:

```
{"time":"2026-10-10T04:37:29.957Z","process":"GPU","reason":"killed","exitCode":9,"service":"GPU"}
{"time":"2026-10-10T04:37:30.067Z","process":"renderer","reason":"killed","exitCode":2}
```

Поля: `time` (ISO), `process` (`renderer` для окна, иначе `type` из события — `GPU`, `Utility`, …),
`reason`, `exitCode`, у дочернего процесса — `service` (`serviceName` из события). Запись собирается
по полям, объект события целиком в файл не идёт. Текстовые поля проходят через `plain()`: всё, кроме
латинских букв, цифр, пробела, `.`, `_`, `-`, заменяется на `?`, длина — не больше 80 символов; не
строка — `unknown`; `exitCode` не целое число — `null`. Папка `logs` создаётся при первом событии, а
не при запуске: start worfy ничего не создаёт. Ошибка записи — `console.error` с самой записью, без
исключения. Окно после падения не перезапускается.

Подключение: `inStep('installProcessGone', …)` — первый шаг запуска в `src/main/index.ts` (до
`installAppMenu`), чтобы попало и падение во время запуска; в `src/main/startup-failure.ts` — имя в
`StartupStep` и запись в `STEPS`. В `index.ts` — две строки: импорт и шаг.

**Часть Б — `scripts/hang-sample.mjs <pid> [секунды]`.** Только macOS. Проверяет, что `<pid>` —
`<бандл>.app/Contents/MacOS/worfy` (`ps -o comm=`), берёт дочерние процессы (`pgrep -P`), чей путь
лежит в том же бандле (пути сравниваются после `realpath`: `/var` и `/private/var`), и запускает
`/usr/bin/sample <pid> <секунды> -file <файл>` на всех сразу. Секунды — от 1 до 60, по умолчанию 3.
Файлы — `<data root>/logs/hang-<время>-<pid>.txt`, рядом с `process-gone.jsonl`. Строки вывода:
`sampled: <pid> <вид> <файл>` (вид — `main`, значение `--type=` у helper-а или имя исполняемого
файла, например `claude`), `skipped: <pid> <путь>` — дочерний процесс вне бандла, `failed: <pid>
<вид>: <причина>` — в stderr. Аргументы процессов читаются только ради `--type=` и не печатаются: в
них может быть токен. Коды выхода: 0 — все `sample` вернули 0; иначе первый ненулевой код по порядку
строк (1 — `sample` не запустился или не создалась папка; 124 — `sample` не закончил за секунды + 60 s
и был завершён); 2 — неверные аргументы, не macOS, нет такого процесса, pid не main process
упакованного worfy. При коде 2 файлов нет.

В `README.md`, раздел «Stable copy», — абзац: что запускать при таймауте шага по CDP, куда ложатся
файлы, признак окна macOS «восстановить окна?», где лежит `process-gone.jsonl`.

**Файлы.** Новые: `src/main/diagnostics/process-gone.ts`, `scripts/hang-sample.mjs`,
`test/unit/process-gone.test.ts`, `test/unit/hang-sample.test.ts`. Изменены: `src/main/index.ts`,
`src/main/startup-failure.ts`, `README.md`. `test/unit/hang-sample.test.ts` в «Где в коде» не было:
файл разрешил Orchestrator (test-ы скрипта отдельно от test-ов модуля).

**Test-ы.** `test/unit/process-gone.test.ts` (10): строка на каждое из двух событий с нужными
полями; дописывание, а не перезапись; URL окна, лишние поля события и пути в файл не попадают;
значение не из словаря Electron — короткое слово без разделителей пути; ошибка записи —
`console.error` и без исключения; событие без `details`; при подключении ничего не создаётся; путь
файла; и запуск `src/main/index.ts` на поддельном Electron — обе подписки стоят до первого окна, и
строки ложатся в папку данных. `test/unit/hang-sample.test.ts` (31): выбор процессов, строки
вывода, параллельный запуск, коды выхода, отказы, папка файлов сверена с `dataRoot()`, запуск
скрипта как процесса на pid самого test-а — отказ с кодом 2 и без файлов. Сначала красное:
`process-gone.test.ts` без модуля — `Cannot find module …/process-gone`, exit 1. Мутанты: 45 (19 —
модуль и подключение в `index.ts`, 26 — скрипт), каждый краснит test; список —
`/tmp/worfy-review-w1/impl-05/mutants.txt` (scratchpad Wave, не в репозитории).

**Ручная проверка** (2026-10-10, macOS, Electron 44.5.1). Копия `pnpm package` установлена тем же
`scripts/install-stable.sh` во временную папку под именем `worfy check.app` (имя не `worfy.app`, с
пробелом) и запущена через `launchApp` с поддельным агентом и своей `WORFY_DATA_DIR`; в worfy открыт
Terminal (shell `/bin/sh`). Stable copy владельца не трогалась — так велел brief Wave. Временный
spec в репозиторий не вошёл.

Дочерние процессы main process (pid 75605): `gpu-process` и `utility` — `…/Frameworks/worfy
Helper.app/Contents/MacOS/worfy Helper`, `renderer` — `…/worfy Helper (Renderer).app/…`, shell —
`/bin/sh`.

```
$ node scripts/hang-sample.mjs 75605 3        → exit 0
skipped: 77639 /bin/sh
sampled: 75605 main <data>/logs/hang-20261010T043726Z-75605.txt
sampled: 77290 gpu-process <data>/logs/hang-20261010T043726Z-77290.txt
sampled: 77301 utility <data>/logs/hang-20261010T043726Z-77301.txt
sampled: 77339 renderer <data>/logs/hang-20261010T043726Z-77339.txt

$ node scripts/hang-sample.mjs 77639          → exit 2   (shell Terminal-а)
hang-sample: 77639 is not the main process of a packaged worfy (<bundle>.app/Contents/MacOS/worfy): /bin/sh

$ node scripts/hang-sample.mjs 77339          → exit 2   (renderer того же worfy)
hang-sample: 77339 is not the main process of a packaged worfy (…): …/worfy Helper (Renderer).app/Contents/MacOS/worfy Helper (Renderer)

$ node scripts/hang-sample.mjs 75605 0        → exit 2
usage: node scripts/hang-sample.mjs <pid of the main process of a packaged worfy> [seconds, 1-60, default 3]
```

Каждый файл — 1200–1600 строк, 220–260 КБ, с разделом `Call graph:`; первые строки файла renderer:
`Analysis of sampling worfy Helper (Renderer) (pid 77339) every 1 millisecond`, `Process: worfy
Helper (Renderer) [77339]`. `sample` на копии с ad-hoc подписью отработал без sudo и без окон
macOS.

Часть А на той же копии: до падений файла `process-gone.jsonl` нет. `kill -9` GPU-процесса (pid
77290) дал первую строку из примера выше, `webContents.forcefullyCrashRenderer()` из main (через
`app.evaluate` Playwright) — вторую: у принудительно уроненного renderer-а Electron сообщает
`reason: killed`, `exitCode: 2`, не `crashed`. Main process после этого жив. Обычный выход из worfy
строк не добавил.

**Проверки.** `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (185 файлов, 3766 test-ов);
`GATE_SCOPE=all gate.sh fast` — exit 0, «[gate] зелено (fast): worfy/.:lint worfy/.:typecheck
worfy/.:test». `GATE_SCOPE=all gate.sh full` на macOS (коммит `be305db`, под замком
`/tmp/worfy-e2e.lock`) — exit 0, «[gate] зелено (full): worfy/.:lint worfy/.:typecheck worfy/.:test
worfy/.:test:e2e worfy/.:test:package».

**Решено без владельца, подтвердить:**
- **URL окна в запись не идёт**, хотя «Что делаем» его называет. Brief Wave запретил в этом журнале
  пути вне Project-а, а URL окна упакованного worfy — `file:///Users/<имя>/…/worfy.app/…/index.html`.
  Пользы от него мало: у всех окон worfy URL один, Card-ы — frame-ы внутри окна.
- **Журнал `process-gone.jsonl` не обрезается.** Строка — около 100 байт, worfy процессы не
  перезапускает, обычный выход строк не добавляет: мегабайт — это около 10 000 падений.
- **Пишется каждое событие**, включая `clean-exit`: причина видна в `reason`.
- **`service`** (`serviceName`) пишется, `name` — нет: `name` бывает переведённым и произвольным.
- **Папка файлов скрипта** — `WORFY_DATA_DIR` из окружения скрипта, иначе
  `~/Library/Application Support/worfy`. Если worfy запущен со своей `WORFY_DATA_DIR`, а скрипт без
  неё, файлы лягут в папку по умолчанию; путь всё равно напечатан.
- **Только прямые дочерние процессы** (`pgrep -P`), как в «Что делаем»: процессы, которые запустил
  `claude`, не снимаются.
- **Предел времени `sample`** — секунды + 60 s, потом `SIGKILL` и код 124: скрипт не должен висеть,
  если macOS покажет окно с запросом прав.
- **Шаг `installProcessGone` — первый** в запуске, а не рядом с `installNotifications`: так PR не
  пересекается по строкам с открытым PR #215 и ловит падения во время запуска.

**Не проверено:**
- На самой Stable copy владельца (`~/Applications/worfy-stable.app`) скрипт не запускался: brief
  запретил её трогать. Проверена копия, установленная тем же `install-stable.sh`.
- Процесс `claude` Agent SDK как дочерний процесс из `app.asar.unpacked` — только в test-е с
  поддельными `ps` и `pgrep`: настоящий Claude Code в проверках не запускался.
- `sample` на приложении с hardened runtime (не ad-hoc подпись) — такой сборки нет.
- Предел времени `sample` (код 124) test-ами не покрыт. Разбор вывода настоящих `ps` и `pgrep`
  покрыт test-ом раунда 2 на процессе самого test-а, а для живого упакованного worfy — ручным
  прогоном выше.
- `child-process-gone` для utility-процесса вживую (ронялся только GPU-процесс).
- Настоящее зависание шага по CDP не воспроизводилось: `sample` снят с работающего worfy.
- Альтернативы из «Что делаем» (`spindump`, `lldb`, `--report-on-signal`) не проверялись:
  `sample` хватило.
- gate full на Windows-ПК (платформенный PR: `src/main/index.ts`) — шаг Windows Session.
- Шаг владельца: дописать запуск скрипта в личную заметку о CDP Autopilot.

**Порядок мержа.** PR #222 не вливается, пока открыт PR #215 (worfy-windows/11: Ctrl вместо ⌘,
системная рамка окна и AppUserModelId на Windows). Так требует spec.md Epic-а, раздел о порядке
относительно worfy-windows: #215 открыт до этой Wave и правит тот же `src/main/index.ts`. После его
мержа — rebase этой ветки на main, `GATE_SCOPE=all gate.sh full` на Mac под замком
`/tmp/worfy-e2e.lock` и gate full на Windows-ПК (платформенный PR).

**Доработка после ревью (раунд 2, PR #222 — `VERIFIED` с долгами).** Только test-ы и этот файл; в
`src/` правок нет, в скрипте — одно слово `export`.
- `test/unit/process-gone.test.ts`: в поддельный `app` добавлен `setAppUserModelId`. PR #215 зовёт
  его в `start()` на Windows; без него после rebase на #215 test запуска `index.ts` краснел бы
  только на Windows-ПК. Проверка на этой ветке: с временным вызовом `app.setAppUserModelId(…)` в
  `start()` test зелёный (exit 0), без строки в поддельном `app` — красный (exit 1, `TypeError:
  app.setAppUserModelId is not a function`); оба файла восстановлены из копий.
- `scripts/hang-sample.mjs`: `systemDeps` экспортирован. Новый test в
  `test/unit/hang-sample.test.ts` — «ps gives the path of the executable apart from the arguments;
  pgrep gives the children of that pid alone», только macOS: настоящие `ps` и `pgrep` спрашиваются
  о самом процессе test-а и об одном `/bin/sleep 30`, который test запускает и завершает по точному
  pid; ничего не сэмплируется. Сначала красный: `TypeError: systemDeps is not a function`, exit 1.
  Мутанты раунда — 7, список в `/tmp/worfy-review-w1/impl-05/mutants-r2.txt`: `comm=` → `args=`,
  `args=` → `comm=`, `pgrep` без `-P`, `pgrep` по всем процессам, `ps` несуществующего процесса не
  `null`, родитель среди дочерних — красные (exit 1). Один выжил (exit 0): «вывод команды с
  ненулевым кодом читается как вывод» — для `ps` и `pgrep` он равнозначен коду: при ненулевом коде
  их stdout пуст.
- Проверки раунда: `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (185 файлов, 3767 test-ов);
  `GATE_SCOPE=all gate.sh fast` — exit 0, «[gate] зелено (fast)». gate full в раунде не
  повторялся: он нужен заново после rebase на main с влитым #215.

**Долги из вердикта ревью** ([low], не блокируют):
- `src/main/diagnostics/process-gone.ts:48-51` — `plain()` убирает только разделители путей. Строка
  из `[A-Za-z0-9 ._-]` до 80 символов, похожая на токен, прошла бы в файл. Сейчас гарантия держится
  на том, что `reason`, `type` и `serviceName` у Electron — из постоянного словаря. Исправление:
  список разрешённых значений для `reason` и `type`.
- `scripts/hang-sample.mjs:66`, `:158` — «main process упакованного worfy» определяется по
  `ps -o comm=`, а на macOS это `argv[0]`: процесс может назвать себя чужим путём. Это не граница
  безопасности — `sample` и так доступен тому же пользователю. Исправление: комментарий в скрипте.
- `process-gone.ts:14-15` — комментарий «worfy starts no process again after it ends» неполон:
  Chromium сам перезапускает GPU-процесс и network service, и `clean-exit` тоже пишется.
  Исправление: уточнить комментарий (и оценку роста журнала под ним).
- `scripts/hang-sample.mjs:181-195` — `runSample` test-ами не покрыт: мутанты «запуск через sudo»
  и «убрать предел времени» выживают. Проверен чтением и ручным прогоном.
