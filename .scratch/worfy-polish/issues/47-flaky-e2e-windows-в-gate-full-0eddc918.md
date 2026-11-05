# 47 — Flaky test-ы Windows в gate full на ПК: two-windows, linked-browser, subagent-tree, epic-frame

Type: task
Status: open
Blocked by: —
Source: gate full на ПК владельца 2026-10-31, main `0eddc918`, 8 workers (журнал на ПК:
`evidence/throughput-56/gate-0eddc918-w8/`). Правило владельца 2026-10-23: flaky test-ы Windows — одним Ticket-ом
`worfy-polish`; открытого такого Ticket-а нет (41 закрыт #1052). Ticket заведён Orchestrator-ом ночью 2026-10-31.

## Что происходит

- `test/e2e/two-windows.spec.ts:212` («openSecondWindow gives the window it opened…»): красный в обоих прогонах
  шага `test:e2e`, строка 233 — `getAllWindows().length` ждали 3, получили 2. В одиночку зелёный (exit 0, 7 s).
  Возможна зависимость от порядка test-ов, не проверено.
- `test/e2e/linked-browser.spec.ts:90`: красный только в первом прогоне шага, строка 131 («what A typed reached B's
  page»). В одиночку не запускался.
- `test/e2e/subagent-tree.spec.ts:312`: красный только в первом прогоне, строка 353 — 1150 ms при пределе 1000 ms.
  В одиночку не запускался.

- `test/e2e/epic-frame.spec.ts:1104` («an Auction-sized Project is interactive within 3 s»): gate full на ПК, main
  `1b4009c5`, 2026-10-31 — 3394 ms при пределе 3000 ms; в одиночку тот же SHA — exit 0, 1300 ms; в девяти прошлых
  gate full на ПК — 1248–1951 ms. Причина не установлена. Предел не поднимать: исправление или quarantine.

- `test/contract/terminal-windows.test.ts:161` («close leaves no console host behind…; it is done well inside its
  bound»): gate full на ПК, полный vitest run — самое долгое из трёх закрытий 3122.6 ms на main `0be09773` и
  3128 ms на main `fc9279cf` при пределе 3000 ms (строка 177); красный в 2 из 11 сохранённых gate full на ПК, в одиночку
  зелёный. Гипотеза, не установлена: под нагрузкой helper закрытия упирается в свой же execFile timeout
  `DESCENDANTS_TIMEOUT_MS = 3000` (`src/main/terminal/windows-pty.ts:12`, `:231`). ПК замеряет время helper-а и
  срабатывания timeout-а. С 2026-10-31 — Windows exception (worfy-windows 117, до 2026-12-15): запись
  `test/quarantine/terminal-windows-close-no-console-host.json`. Предел не поднимать.
- `test/contract/terminal-git-bash-close.test.ts:33` (закрытие Git Bash сохраняет его history): ушёл из этого
  Ticket-а — баг продукта подтверждён замером ПК 2026-10-31 (26 из 120 закрытий под нагрузкой без `.bash_history`,
  все 26 — когда kill.exe оборван пределом 500 ms), Ticket worfy-windows 116. Test остаётся без quarantine.
- `test/contract/workflow-branches-gone.test.ts:70` («`git worktree remove` of the last worktree, then the repository
  itself…»): gate full на ПК, main `c01cd364`, 2026-10-31, 8 workers — `expected 328 to be less than 300`: время
  процессора worker-а за секунду после удаления (`process.cpuUsage`, строки 63–67; проверки на 87 и 104). Красный и
  в сохранённом gate full `e6802c9e`, то есть повторяется; в одиночку exit 0, 8 s. По ADR-0086 п.3 — quarantine только
  на win32; с 2026-10-31 — Windows exception (worfy-windows 117, до 2026-12-15): запись `test/quarantine/workflow-branches-gone-worktree-then-repository.json`. Предел 300 ms
  не поднимать.
- `test/e2e/chat-attachments.spec.ts:148` (png и pdf, брошенные в чат Orchestrator-а): gate full на ПК, main
  `c01cd364` — `Cannot read properties of null (reading 'dispatchEvent')` на строке 158; в одиночку exit 0. Test
  сразу после `launchApp` берёт `document.querySelector` для `.react-flow__pane` и `.w-sidebar-section`.
- `test/unit/docs-watch-root-gone.test.ts:450` («another name at the top of the root asks for no read; the root's own
  name and HANDOFF.md do»): gate full на ПК, main `ba7e09e5`, 2026-11-01 ~01:30Z — красный один раз, строка 457:
  `expected [ { handoff: …, adrs: [] } ] to deeply equal []`; в одиночку на том же коммите зелёный. Гипотеза, не
  установлена: чтение пришлось на момент, когда `writeFileSync` уже опустошил `HANDOFF.md`. Единственное основание —
  версия `e3b0c44298fc1c14` — начало SHA-256 пустого файла. Возможное исправление: в test-е писать через временный
  файл и rename.
- `bin/tests/wave-gate-merge.test.sh:159` («pid ended while asked»): gate full на ПК, main `d2ca34cf`, 2026-11-01 —
  красный один раз; в одиночку зелёный 3 из 3. Гипотеза, не установлена: `harness/bin/wave-gate:483` снова проверяет
  `pidAlive`, когда PowerShell не дал время старта процесса, а процесс Windows, который уже завершается, ещё проходит
  `pidAlive` — отсюда ложный отказ «another wave-gate check runs». Так может случиться и в настоящей работе, окно очень
  короткое.
- `test/e2e/card-api.spec.ts:124`: job `windows-e2e` (1 из 4), CI run 41275774521 (PR #1194, 2026-11-01) — `data.get`
  дал `{starts: 2}` вместо 1 в обеих попытках, то есть frame Card-а стартовал дважды (это не подделанная запись: нет
  `forged: true`). В Windows CI run-ах #1190 и #1195 зелёный. Гипотеза, не установлена: iframe Card-а на Windows
  перезагружается во время старта приложения.
- `test/e2e/card-drag.spec.ts:179` («a Card jerked by the lower end of its header…», раунд `the lower end` цикла) и
  `test/e2e/card-drag.spec.ts:196` («a Note jerked across a Card iframe…»): job `windows-e2e (1/4)` push run-а `main`
  https://github.com/IDSAD-XL/worfy/actions/runs/41463951333 (`e0d761ea`, 2026-11-02) — красные в обеих попытках:
  `Error: the window is 1600 px wide`, `Timeout 9989ms exceeded while waiting on the predicate`
  (`expect(received).toBe(expected)` в `canvasReady`, `test/e2e/helpers.ts:544`, вызов из `start` — строка 93).
  Окно не доросло до 1600 px за 10 s, то есть упал старт приложения, до жеста, который test проверяет. В том же run-е
  `card-drag.spec.ts:213` упал так же в первой попытке (`Received: 1264`) и прошёл во второй. То же дерево зелёное на
  head PR #1247. Причина не установлена. С 2026-11-02 — quarantine (win32), записи
  `test/quarantine/card-drag-card-jerked-lower-end.json` и `test/quarantine/card-drag-note-jerked-across-card.json`
  (до 2026-11-16; после строки import test-ы стоят на строках 180 и 197). Timeout не поднимать.
- `test/e2e/card-drag.spec.ts:232` («the Canvas panned with the middle button across a Card…»): та же причина —
  `the window is 1600 px wide` в `canvasReady` в обеих попытках, job `windows-e2e (1/4)` run-а
  https://github.com/IDSAD-XL/worfy/actions/runs/41840970500 (head PR #1367 `8be4575b`, diff не касается Canvas).
  С 2026-11-04 — quarantine (win32), запись `test/quarantine/card-drag-canvas-middle-pan.json` (до 2026-11-16).
- `test/e2e/browser.spec.ts:554` («the Open bar shows a long host whole and cuts only the path, in a frame 640 wide»,
  раунд `640` цикла): та же причина — `the window is 1400 px wide` в `canvasReady` (`test/e2e/helpers.ts:593`) в обеих
  попытках, job `windows-e2e (1/4)` run-а https://github.com/IDSAD-XL/worfy/actions/runs/42070024246 (head PR #1441
  `2ed0f881`, diff не касается Browser card; тот же shard зелёный на прошлом head `a7f463c7` того же diff). С 2026-11-05 —
  quarantine (win32), запись `test/quarantine/browser-open-bar-long-host-640.json` (до 2026-11-19).
- Кандидат во flaky test: `test/contract/login-shell-capture.test.ts:144-146` читает файл `after` сразу после
  `existsSync`; под нагрузкой файл может быть ещё пуст (замечено в gate PR #1190, не воспроизведено).

**Gate full на ПК, сводка на 2026-11-01.** Из последних шести gate full на ПК три зелёные (`15932ac9`, `ddfb35ce`,
`5557f744`), три красные (`ba7e09e5` — `docs-watch-root-gone.test.ts:450`, `d2ca34cf` — `wave-gate-merge.test.sh:159`,
`bf16bb7f` — `terminal-git-bash-close.test.ts:212`). Каждый красный — другой test, в одиночку зелёный. Orchestrator
отдал ПК исправление этих трёх, по одному PR на каждый; `terminal-git-bash-close` исправлен в #1197 (раздел ниже).

## Что делаем

1. Каждый — найти причину (порядок test-ов, нагрузка 8 workers, гонка в самом test-е) и исправить test или код.
2. Пределы времени не поднимать; test, который не поддаётся, — по правилу удаления test-ов владельца 2026-10-28.

## Готово, когда

- [ ] Причина каждого записана в «Итог» с доказательством (журнал, повтор `--repeat-each`).
- [ ] Каждый зелёный в одиночку `--repeat-each=5` и в шаге `test:e2e` gate full на ПК.
- [ ] Пределы test-ов не подняты; Windows-job CI зелёный.

## Где в коде

- `test/e2e/two-windows.spec.ts`, `test/e2e/linked-browser.spec.ts`, `test/e2e/subagent-tree.spec.ts`,
  `test/e2e/epic-frame.spec.ts`
- `test/contract/terminal-windows.test.ts`, `test/quarantine/terminal-windows-close-no-console-host.json`
- `test/contract/workflow-branches-gone.test.ts`, `test/quarantine/workflow-branches-gone-worktree-then-repository.json`
- `test/e2e/chat-attachments.spec.ts`
- код, на который укажет причина

## Итог

Заполняется при закрытии. Ticket open: ждёт 20 зелёных `windows-e2e` для `card-api`. Замеры ПК больше не нужны (ответ ПК
2026-11-01):

- `subagent-tree`: на ПК в одиночку (main `2186dd28`, `--repeat-each=5 --workers=1 --retries=0`) exit 0, 5 passed;
  дерево показано за 84–121 ms (предел 1000), выбросов нет. Выбросы бывают только в gate full (439/767/915/1150 ms,
  обычно 84–151); их причина не найдена, запас мал.
- `terminal-windows`: для 47 не нужен — Windows exception до 2026-12-15
  (`test/quarantine/terminal-windows-close-no-console-host.json`); время helper-а уже измерено (`load.jsonl` gate full
  `c01cd364`: медиана 1074 ms, максимум 2906 из 3000, 0 timeout-ов).
- Git Bash: не нужен — worfy-windows 116 (#1148), гонка исправлена в #1197 (12 из 104 → 0 из 80).

Часть 5: зелёный shell test Harness печатает в журнал свои строки `skip` (раздел «Часть 5» ниже). Приёмка подтверждена
2026-11-01: job Windows `harness-scripts 1/2` 124826726685 (run 41299286357) печатает `skip the dangerous direction of
a pid's start time`.

- Merged: часть 2 `wave-gate` — #1201 (`b0164889`); часть 3 `docs-watch-root-gone` — #1202 (`d6b0f908`); часть 4
  `card-api` — #1207 (`5c5b7693`); часть 5 — #1209. Ticket закрывается после 20 зелёных `windows-e2e` для `card-api`.
- `docs-watch-root-gone.test.ts:450`: гипотеза из «Что происходит» (чтение опустошённого `HANDOFF.md`) поправлена.
  Запись через rename не помогла бы. Причина — гонка в test-е: он ждал таймер последнего чтения плюс 100 ms, а чтение
  под нагрузкой шло дольше и попадало на запись `HANDOFF.md` (раздел «2026-11-01, ПК: три test-а» ниже).
- Gate full на ПК, main `b0164889`: зелёный, 3121 s (lint 43.2, typecheck 52.8, test 1194.6, e2e 1700.3, package
  128.9). Первый зелёный gate full на main после #1173/#1182/#1193/#1198–#1205; на ПК 4 зелёных из 7. Журнал на ПК:
  `throughput-56/gate-b0164889-w8/`. Следом ещё два зелёных подряд: main `2186dd28` — 3108 s, main `43d98801` — 3159 s
  (e2e: 369 expected, 18 skipped, 0 flaky).
- Замечены flaky test-ы, причина не установлена; второй случай — Ticket `worfy-polish`:
  - `harness/bin/tests/agents-text.test.sh:515-519` («a held e2e lock»): красный один раз в полном `pnpm test` на Mac
    под нагрузкой, в одиночку зелёный.
  - `test/contract/login-shell-capture.test.ts:146`: читает `after` раньше, чем он записан; красный один раз под полной
    нагрузкой, в одиночку зелёный. Второй случай кандидата из «Что происходит».
  - `test/unit/chat-attachments.test.tsx:293` и `:298`: вызов `agent.attach` попадает в следующий test; load average
    40–57, в одиночку зелёный.
  - Windows CI `harness-scripts 1/2` (full-suite), PR #1215, run 41305170019, 2026-11-01 12:10–12:58Z: шаг test-ов не
    закончился до timeout job-а (45 min), журнал GitHub не сохранил (BlobNotFound); PR не трогает `harness/`.

### 2026-10-31, ветка `worfy-polish/47-e2e-logic`: логика двух e2e test-ов, третий — вопрос владельцу; пределы не тронуты

- `test/e2e/linked-browser.spec.ts:90`. Путь ввода от A к B прочитан: каждое нажатие — отдельный `browser.input`
  без ответа (`sendBrowserInput`, `src/renderer/browser/frames.ts:79`), дальше `linked.invoke` → одно соединение
  link → CDP `Input.dispatch*` на B; порядок по дороге не меняется. Test печатал сразу после click и не ждал ни
  фокуса на `#typed` у B, ни фокуса на frames у A. Теперь click повторяется (`toPass`), пока страница B не скажет
  `document.activeElement.id === 'typed'` (helper `focusedOnB` рядом с `typedOnB`), потом `toBeFocused` у frames,
  потом ввод. Какой из двух фокусов не успел на ПК — не установлено: журнала с ПК, где виден текст в `#typed`
  при падении, нет; это ожидание условия, а не причина, доказанная замером.
- `test/e2e/epic-frame.spec.ts:1104` — не исправлен, test не тронут. **Вопрос владельцу.** Почему эталон есть только на
  GitHub Actions: `git log -S measuresReference` находит один коммит — #874 (`fbc1a749c`, 2026-10-28, «pass on the
  1024x768 macOS runner display»). Эталон там введён только для медленного macOS runner-а. 3 s взяты с Mac владельца
  (564 ms). Решения, что Windows держит абсолютные 3 s, нет ни в коммите, ни в ADR, ни в qmd. Предложение: включить
  эталон и на win32, то есть `startBudget`/`measuresReference` в `test/e2e/start-budget.ts` с условием
  `GITHUB_ACTIONS === 'true' || platform === 'win32'`. Тогда на ПК бюджет — 6 × медиана трёх стартов Project-а с одним
  Ticket-ом на той же машине, не ниже 3000 ms и не выше 7300 ms. Цена: фактический предел этого test-а на Windows
  растёт с 3000 до 7300 ms (под нагрузкой эталон медленнее, и бюджет растёт с ним), и на win32 прибавляются три
  запуска приложения. Множитель 6 и потолок 7,3 s измерены на macOS runner-е, не на ПК. По правилу «timeout-ы test-ов
  не подстраивают по одному» (2026-10-23) это решение владельца вместе с общим множителем для всего набора; в PR
  #1136 правка была и убрана после ревью.
- `test/e2e/two-windows.spec.ts:212`. Stub `getAllWindows` отличал вызов helper-а от вызова самого приложения по
  тексту stack (`/[\\/]out[\\/]main[\\/]/`). Счёт 2 вместо 3: либо stub к строке 233 ещё не сработал (тогда сам
  вызов счёта сделал decoy и вернул список до него), либо decoy закрылся — кода, который закрывает чужое окно, в
  `src/main` не нашлось. Почему stub пропустил вызов helper-а на ПК — не найдено (на Mac
  stack вызова helper-а — только кадры `UtilityScript` Playwright, без `out/main`). Stack больше не читается:
  stub одноразовый и делает decoy при первом вызове после установки, кто бы ни вызвал. Test проверяет, что decoy
  создан (`decoyId` — число, без ошибки конструктора), а окна сверяет по адресам через `expect.poll`
  (`about:blank` и два адреса приложения): красный run назовёт, какого окна нет. Сила test-а та же: с helper-ом,
  который берёт следующую страницу без проверки адреса, старая и новая версия красные 4 из 4. Оговорка: если между
  установкой stub-а и вызовом helper-а придёт broadcast приложения, decoy появится раньше. Если Playwright увидит
  страницу decoy до снимка `before` в helper-е, test пройдёт, так и не проверив защиту helper-а: такой run зелёный,
  но ничего не доказывает. На Mac без нагрузки stub сработал только на вызове helper-а (один вызов в диагностическом run).
- Проверка на Mac (нагрузка ~10–12): `two-windows` + `linked-browser` `--repeat-each=3 --workers=1` — 9 passed.
  На Windows правки не запускались: ПК, gate full.

### 2026-10-31, ветка `worfy-polish/47-c01cd364`: две находки gate full на ПК `c01cd364`

- `test/contract/workflow-branches-gone.test.ts:71` (после правки) — Windows exception (worfy-windows 117, до 2026-12-15), запись
  `test/quarantine/workflow-branches-gone-worktree-then-repository.json`, обёртка `quarantined('<id>')(name, fn)`.
  Причина не установлена. Гипотеза: замер — `process.cpuUsage()` всего worker-а за одну секунду (строки 64–68 после
  правки, проверки на 88 и 105), и при 8 workers в эту секунду попадает его собственная работа (сборка мусора,
  поздние события chokidar об удалении) без бесконечного цикла watcher-а. Предел 300 ms не тронут. Записей в
  quarantine после правки — 13 из 15; `test/unit/quarantine.test.ts` зелёный и красный, если имя test-а в записи
  не совпадает с кодом (проверено правкой имени).
- `test/e2e/chat-attachments.spec.ts:148` — исправлен test. `launchApp` (`test/e2e/helpers.ts:266`) возвращает окно,
  как только оно показано (`waitForFirstWindowShown`), а не когда Canvas и sidebar отрисованы. Под нагрузкой
  `.react-flow__pane` или `.w-sidebar-section` ещё не было, `querySelector` давал `null`. Теперь перед `evaluate`
  test ждёт `expect(...).toBeVisible()` для pane и первой секции sidebar; timeout-ы и фиксированные паузы не
  добавлены. Проверка на Mac: `--repeat-each=3` — 3 passed. На Windows правка не запускалась: ПК, gate full.

### 2026-11-01, ПК: три test-а, красные по одному в gate full при зелёном одиночном прогоне

- `test/unit/docs-watch-root-gone.test.ts:450` (строка 457, `expected [ … ] to deeply equal []`): gate full на ПК, main `ba7e09e5`, 2026-11-01; в
  одиночку зелёный. Причина доказана, это гонка в самом test-е, дефекта watcher-а нет. Гипотеза о чтении опустошённого файла верна лишь отчасти:
  запись через rename не помогла бы, потому что чтение нового текста даёт то же изменение. Test ждал таймер последнего чтения после старта плюс
  100 ms, а само чтение под нагрузкой шло дольше и попадало на запись `HANDOFF.md`. Копия с меткой в момент записи, 8 параллельных процессов и 12
  процессов на CPU: 7 красных из 66, во всех 7 чтение ещё шло; при законченном чтении 48 из 48 зелёные. 14 попыток не запустились вовсе (`spawn
  EBUSY` при старте Electron) и в счёт не вошли. Правка: test ждёт конца этого чтения через `relabel`, которая читает ещё раз и завершается после
  него; 100 ms убраны, лимиты не менялись. После правки красный 0 из 200 под той же нагрузкой. Сила test-а та же: если watcher читает на любое
  имя, test красный. То же ожидание получили ещё три test-а файла с той же паузой.
- `test/contract/terminal-git-bash-close.test.ts:212` (строка 222, `the stand-in ran`): gate full на ПК, main `bf16bb7f`, 2026-11-01; в
  одиночку зелёный 3 из 3. Причина доказана, это гонка в самом test-е, дефекта закрытия нет. Подставной `kill.exe` писал файл `beat` только после
  запуска настоящего `kill.exe`. Настоящий доставлял SIGHUP, bash завершался, и helper закрытия завершал подставной раньше первой записи.
  Нагрузка: 8 параллельных процессов и 12 процессов, занимающих CPU. До правки красный 5 из 40; копия с меткой первой строкой подставного — 7 из
  64, во всех 7 метка и `started` есть, `beat` нет, helper ответил `ended`; во всех 57 зелёных `beat` есть. Правка: первая запись `beat` идёт до
  запуска настоящего `kill.exe`; лимиты и паузы не менялись. После правки под той же нагрузкой красный 0 из 80. Сила test-а та же: без
  `$signal.Kill()` в helper-е он красный на строке `the stand-in still runs after the answer`.
- `harness/bin/tests/wave-gate-merge.test.sh:159` вместе с `harness/bin/wave-gate` (строка 483 на `d2ca34cf`): gate full на ПК, main `d2ca34cf`, 2026-11-01; в одиночку
  зелёный 3 из 3. Причина доказана, это дефект `wave-gate`, а не test-а: ложный отказ `another wave-gate check runs`. Проверка находила pid
  работающим и спрашивала PowerShell, когда стартовал процесс. Если ответа не было, она смотрела на pid ещё раз, а на занятой машине его уже мог
  получить другой короткий процесс. Гипотеза «процесс заканчивается и проходит повторную проверку» не подтвердилась: PowerShell уже сказал, что
  процесса нет, а живым был новый владелец pid. Замер: только случай `pid ended while asked`, 8 параллельных копий, журнал ответов PowerShell.
  Нагрузка: node с занятым циклом и процессы, каждый из которых держит запущенными 10 коротких `cmd /c exit`. 12 занятых циклов без запуска
  процессов — красный 0 из 120, её мало. 4 цикла и 8 запускающих — 2 из 120, в обоих PowerShell ответил «процесс не выполняется», pid при следующем
  взгляде жив и вскоре снова свободен; ещё в 13 из 120 PowerShell увидел в этом pid более поздний процесс.

  Первая версия правки: 0 из 200 при той же нагрузке и 0 из 400 при 16 запускающих; в этих 400 журнал один раз поймал «нет процесса» при живом pid, и
  попытка зелёная. Вторая версия (`get_StartTime()` и слово в stdout) — 0 из 120. При 2 из 120 до правки 0 из 120 само по себе слабо: без правки
  такое выпадает примерно в 13 % случаев; всего 0 из 720, это около 0,02 одностороннего уровня с учётом неточности базовой частоты. Третья версия (точное
  сравнение типа) под нагрузкой не прогонялась: владелец за машиной. Её логика на этом пути та же.

  Детерминированные случаи в test-е. Pid на единицу выше живого виден `process.kill`, но не `GetProcessById`: без правки красный с сообщением из
  gate. Pid 4, опасное направление: живой pid не получает ответ «нет процесса». С `catch` без типов проверка забирает его pid-файл, test красный, exit 1.
  Это ловит только машина без повышенных прав: на ПК время старта pid 4 не читается. На GitHub runner-е оно читается, тогда test печатает строку skip о
  том, что это направление здесь не покрыто. `csrss.exe` не помог: на ПК он отказывает, а на runner-е CI показал «it started at …» (job 124792813509,
  run 41287773509).
  Только рассуждением и ручной пробой, без случая в test-е: `get_StartTime()`, слово в stdout, точный тип. Ручная проба: pid 99999 — `no process`; pid 4
  — exit 1; живой pid — дата; в ConstrainedLanguage и живой pid, и pid 99999 — exit 1, то есть ожидание.

  Установленные копии plugin-а (Mac Stable, ПК) отказывают по-старому, пока их не обновят: следующий gate full на старом Harness может снова показать
  `another wave-gate check runs`, и это не значит, что правка не работает.
- `test/e2e/card-api.spec.ts:124` (`{starts: 2}`, CI run 41275774521, job `windows-e2e (1/4)`, две попытки): **ждём 20 зелёных `windows-e2e`**. Связь правки с
  этим падением не доказана: на ПК test не краснел ни разу, зелёный 263 из 263 под нагрузкой. Trace CI показывает только, что обе Card загружены дважды через
  100-112 ms, а это задержка `CARD_CHANGE_DELAY_MS` перед ростом revision; имён событий в нём нет. На ПК журнал watcher-а поймал в 3 из 261 журнала `change` с
  именем самой папки Card, `c2`, через единицы ms после постановки watch и без правки файлов: revision росла во всех трёх. Test оставался зелёным, потому что
  считает старты только у `c1`. Откуда это событие, не установлено. Запись data файла ни при чём: он лежит вне `cards/`. Правка: на Windows такой `change` не
  считается правкой Card, `rename` считается. После правки: test зелёный 200 из 200, событие пришло в 2 из 197 журналов, revision не выросла ни разу. Это
  доказывает снятие лишней revision, а не исчезновение падения. Настоящие правки не теряются: 13 видов действий по 5 раз на ПК, только смена времени самой
  папки дала единственный `change` с её именем; test с настоящим `fs.watch` идёт на Windows, macOS и Linux. На macOS и Linux отбрасывания нет, там chokidar.
  Осталось: такой же `change` бывает у папки внутри Card (`c1\js`, виден в журнале test-а сразу после записи). Он по-прежнему поднимает revision: без
  чтения диска его не отличить от файла. В Card test-а `card-api` вложенных папок нет.

### Часть 5. 2026-11-01, ветка `worfy-polish/47-skip-lines`: строки `skip` зелёного shell test-а видны в журнале

- Shell test Harness печатает строку `skip …`, когда проверку нельзя выполнить на этой машине. Обёртка vitest
  (`test/harness-scripts-suite.ts`) показывала вывод shell test-а только при красном run-е. Поэтому по зелёному job-у
  не было видно, какая ветка проверки выполнилась: в PR #1201 строка `skip the dangerous direction …` ни разу не
  попала в зелёный журнал Windows CI.
- Правка: `judge` печатает в stderr каждую строку вывода зелёного shell test-а, которая после trim начинается с `skip `,
  с именем файла впереди (`[harness-scripts] bin/tests/profile.test.sh: skip …`). Остальной вывод зелёного test-а не
  печатается. Красный run, как и раньше, печатает свой отчёт целиком. Запись идёт прямо в stderr, как у
  `test/quarantine.ts`: vitest под агентом скрывает console output файла, где все test-ы прошли.
- Test: случай обёртки в `harness-scripts-1` запускает подставной shell test с одной строкой `skip` и exit 0 и ждёт
  ровно эту строку с именем. Без печати он красный (проверено мутантом). На Mac run `harness-scripts-1` напечатал три
  строки `skip`, из `profile.test.sh` и `session-hooks.test.sh`. На Windows правку проверят job-ы Windows CI.

### Часть 6. 2026-11-01, ветка `worfy-polish/47-harness-status`: stub `claude` в `harness-install.spec.ts` затирал состояние при чтении

- Красный: gate full на `e2ca84dc`, только `harness-install.spec.ts:217`, `Expected "Update Harness"`, `Received "Install"`,
  33 опроса за 15 с. В одиночку 3 из 3 зелёные, 1 красный из 17 сохранённых gate.
- Причина в test-е, не в продукте. Stub писал своё состояние в конце каждой команды, в том числе чтения `plugin list`.
  Окно начала загрузки запускает `plugin list`, как только появилась папка плагина, то есть пока test её копирует. Если
  stub прочитал пустое состояние до записи test-а, а записал его обратно после неё, все следующие `plugin list` не видят
  плагин, и `stateOf` (`src/main/harness/install.ts`) даёт `not-installed`, то есть «Install».
- Продукт исключён чтением кода. Main не кэширует статус: `status()` каждый раз запускает `plugin list`. Renderer заново
  читает `harness.state` при монтировании после reload. `harness.changed` отправляется только после завершённой установки,
  а test до этой проверки кнопку не нажимает. Настоящий `claude plugin list` ничего не пишет.
- Правка: stub пишет состояние только в командах, которые его меняют, чтения `plugin list` и `plugin marketplace list` не
  пишут. Блокировок и ожиданий нет. Test «Cancel in the dialog writes nothing» теперь проверяет, что файла состояния нет;
  на старом stub он красный (проверено мутантом).
- Принудительное воспроизведение (временная правка spec, в PR не входит): `plugin list` ждёт появления записи test-а между
  своим чтением и записью. Старый stub: 5 красных из 5, `Received "Install"`, как в gate. Новый: 5 зелёных из 5.
- **Естественно исходный красный не воспроизвёлся:** 0 с «Install» из 424 прогонов старого stub при нагрузке на CPU и
  на диск. В 20 из них чтение stub было раньше записи test-а, но запись stub ни разу не попала после неё: окно между
  чтением и записью stub обычно 3–6 мс, наибольшее 97 мс. Новый stub: 0 с «Install» из 180. Поэтому редкость до правки не измерена, а причина
  доказана механизмом и совпадением ошибки.
- Отдельно, не этот красный: при искусственной нагрузке на диск (6 worker-ов, 4 процесса на CPU, 8 на диск) шаг после
  обновления, `toHaveText("Harness <версия>")`, не укладывается в 15 с, ошибка `element(s) not found`. Старый stub: 1 и 15
  из 120 в двух сериях, новый: 11 из 120. Шаги установки там занимают по 4–6 с. Только с нагрузкой на CPU (4 worker-а, 8
  процессов) новый stub 60 из 60 зелёные.

### Часть 7. 2026-11-04, ветка `fix/e2e-windows-window-width` (PR #1375): «the window is N px wide» — не размер экрана, а приложение не отвечает

Касается `card-drag.spec.ts:179/196/213/232`, `session-question.spec.ts:147`, `vendor-picker.spec.ts:72`,
`browser-webview-guard.spec.ts:158`: все падали в `canvasReady` (`test/e2e/helpers.ts`) с `the window is 1600 px wide`
или `… 1400 px wide`. Причина эпизода не установлена; гипотеза «экран runner-а меньше окна» опровергнута.

- **Экран не держит окно.** Экран Windows runner-а — 1024 × 768, рабочая область 1024 × 720, масштаб 1 (замер
  `screen.getPrimaryDisplay()` в run-ах 41854514599, 41857508829, 41860357961, 41868122584). При этом в тех же job-ах
  около сотни запусков с окном 1600 × 1000 и 1400 × 900 зелёные, а снимок Playwright после упавшего test-а — 1600 × 1000.
  Electron: `enableLargerThanScreen` — «Only relevant for macOS, as other OSes allow larger-than-screen windows by
  default» (https://www.electronjs.org/docs/latest/api/structures/base-window-options). `Received: 1264` — это начальное
  окно 1280 × 800 (`DEFAULT_SIZE`, `src/shared/window/bounds.ts:16`) минус рамка 16 px: размер ещё ни разу не задан.
- **Что на самом деле.** Trace-ы 12 упавших попыток (run-ы 41840970500, 41848977670, 41836397033, 41463951333;
  разбор `app-trace` внутри `trace.zip`): в 11 первый `window.evaluate(() => innerWidth)` в `canvasReady` отвечает через
  9–20 s (1264), снимок окна после — ещё 2–13 s; в двенадцатой (`Received: 1264`) первый ответ — 1.7 s, второй, уже
  1600, — 6.8 s, после конца ожидания. Опрос ждёт ответа страницы, и только потом зовёт `setContentSize`,
  поэтому за 10 s размер не задаётся. Ошибка называла ширину окна, хотя не отвечала страница.
- **Эпизоды машины, а не test-а.** Сбои идут подряд в одном окне времени: run 41463951333 — пять запусков приложения
  подряд красные с 14:48:00 до 14:49:45 (`card-drag` 179/196/213 и их retry), до и после всё зелёное; в остальных
  случаях красными были test и его немедленный retry. Частота: 3 из 131 job-ов `windows-e2e` в 60 последних run-ах CI.
- **Probe (`test/e2e/app-stall.ts`, четыре run-а CI на PR #1375).** Длинного эпизода в них не было; короткие (1.6–7.9 s)
  есть почти в каждом run-е. В них: цикл событий main стоит по 0.7–2 s подряд, а первый JavaScript main после остановки —
  обработчик `fs.watch` (`FSWatcher._handle.onchange`), то есть main стоял в native-коде, не в своём JavaScript; потока
  событий `fs.watch` нет (56–118 событий за вызов, от профиля Chromium в папке данных). CPU машины занят на 32–59 % из
  4 ядер, свободно 12 ГБ памяти; в единственном замере за 2 s один `svchost` взял 2.4 s CPU (какой службы — не узнали).
  Задачу Chromium, которая держит поток main, probe не поймал: длинного эпизода не было, а в одном run-е отчёт probe сам
  съел время ожидания (исправлено: отчёт печатается после ожидания).
- **Что изменено.** `canvasReady` при таком сбое теперь говорит правду: к ошибке добавляется строка «The page answered
  innerWidth only after up to N ms…: the app was not answering, so the window kept its start size (worfy-polish 47)»
  (проверено локально: страница занята 12 s → эта строка). Probe остаётся в репозитории, но включается только
  `WORFY_E2E_STALL_PROBE=1`; CI его не ставит. Timeout-ы не тронуты, записи quarantine `card-drag-*` остаются: причина
  эпизода не устранена.
- **Дальше.** Run диагностики с `WORFY_E2E_STALL_PROBE=1` в job `windows-e2e` до первого длинного эпизода: отчёт назовёт
  задачи потоков main (Chromium trace, категория `toplevel`) и службы занятого `svchost`.

### Часть 8. 2026-11-05/06, ветки `diag/polish-47-stall-probe` (draft PR #1452, закрыт) и `fix/polish-47-windows-stall` (PR #1462): main стоит в своём цикле на событиях `fs.watch` папки данных

Длинный эпизод (9 s и больше) не пойман. Короткие эпизоды разобраны: у части из них причина найдена и убрана PR #1462.
Связь с длинными эпизодами — гипотеза. Записи quarantine остаются.

- **Run-ы.** Восемь run-ов CI на draft PR #1452 с `WORFY_E2E_STALL_PROBE=1` в job `windows-e2e`, все 32 job-а
  `windows-e2e` зелёные. Без правки — 42093502619, 42095564144, 42098804932, 42101296468, 42104364363, 42107511689.
  С правкой PR #1462 поверх probe — 42110701277, 42113850717. Красные job-ы Linux и Windows unit на этом PR ожидаемы:
  contract test `test/contract/ci-workflow.test.ts:195` сверяет текст шага e2e дословно.
- **Без правки: 8 медленных ответов страницы (> 1.5 s).** Самый долгий — 3.9 s (run 42101296468, shard 4/4, test
  `ship-ticket.spec.ts:334`; test в первой попытке упал с «the Canvas did not come to rest within 10000 ms» и прошёл
  на retry). В 4 из 8 цикл событий main стоял по 1.1–2.0 s подряд (run-ы 42095564144 ×2, 42101296468, 42104364363).
  Во всех четырёх Chromium trace называет длинные задачи потока `CrBrowserMain`
  `electron/shell/common/node_bindings.cc:WakeupMainThread`, то есть прогон цикла Node (uv_run). Их 13 штук по
  0.3–2.0 s, в run-е 42101296468 — пять подряд, 7.1 s из примерно 8 s. CPU процесса Browser в это время 0–5 %:
  main ждёт, а не считает. Первый JavaScript main после остановки каждый раз — `FSWatcher._handle.onchange`. Так было и
  в трёх отчётах run-ов PR #1375. Из всех `fs.watch` main события есть только у одного — у не рекурсивного watch
  папки данных (`<tmp>\data`), 55–125 событий за вызов: `change:Network`, `change:Shared Dictionary`,
  `change:Code Cache`, `change:GPUCache`, `rename:DIPS`. У watch-ей проектов и `.git` событий 0. Этот watch открывает
  `LimitsTracker.watchStatusline` (`src/main/agent/limits.ts`): он ждёт `statusline-limits.json`. Папка данных — она же
  профиль Chromium: `app.setPath('userData', dataRoot())`, `src/main/index.ts:71`.
- **Почему событие держит main (из исходников, на runner-е не замерено).** libuv на Windows для каждого события
  watch-а папки, кроме удаления, дважды зовёт `GetLongPathNameW` на полный путь в потоке main, до callback-а
  (`src/win/fs-event.c`, `uv__process_fs_event_req`). Каждый такой вызов проходит все компоненты пути. Других блокирующих
  вызовов на этом пути нет. Пока поток main занят, страница тоже не отвечает: сообщения DevTools от Playwright к странице
  идут через этот поток. Сколько длится один `GetLongPathNameW` на runner-е, не измерено. В двух замерах машины во время
  эпизода больше всех CPU брал `svchost` со службой `StorSvc`: 3.1 s и 1.7 s CPU за 2 s. Связь этой службы с задержкой —
  гипотеза.
- **С правкой (2 run-а): 2 медленных ответа страницы, main ни разу не стоял.** Ответ на ping не дольше 6 ms, пауз
  цикла нет, папка данных не под watch. Но страница в run-е 42113850717 отвечала 3.4 s: 3 s заняла задача renderer-а
  `Receive mojo reply` (`electron.mojom.ElectronApiIPC`), такая же 2.7 s была в run-е 42101296468. Это второй источник
  медленной страницы, не через main, и его причина не установлена. Test `palette-find.spec.ts:107` там же упал в первой
  попытке с «did not come to rest» и прошёл на retry. Две таких ошибки за ночь, обе в run-ах с отчётом probe. Отчёт
  стоит после ожидания `innerWidth`, но до ожидания покоя Canvas, и сам тратит время `canvasReady` (остановка trace,
  PowerShell). Поэтому эти два красных probe мог вызвать сам.
- **Правка (PR #1462).** На Windows `LimitsTracker` приложения следит за `statusline-limits.json` только опросом раз в
  секунду: опрос был и раньше, как подстраховка. Watch папки данных не открывается (`statuslineWatchFor('win32')` →
  `watch: null`). На macOS и Linux всё как было. Цена: Limits из status line на Windows появляются до секунды позже.
  Unit test-ы в `test/unit/limits-watch-gone.test.ts`; мутант «`watch: null` падает на watch системы» даёт красный.
  Timeout-ы и пределы не тронуты.
- **Установлено:** короткие остановки main в 4 из 8 эпизодов без правки — это обработка libuv событий watch-а папки
  данных, то есть профиля Chromium. С правкой таких остановок нет (0 из 2 эпизодов).
- **Гипотеза:** длинные эпизоды 9–20 s, из-за которых в quarantine записи `card-drag-canvas-middle-pan`,
  `card-drag-card-jerked-lower-end`, `card-drag-note-jerked-across-card` и `browser-open-bar-long-host-640`, — тот же
  механизм в худшем виде. Против неё: страница бывает медленной и без main (задача renderer-а 2.7–3 s). Поэтому записи
  не сняты.
- **Дальше.** После merge PR #1462 считать красные `canvasReady` («the page answered innerWidth only after …») в
  `windows-e2e` run-ов `main` и PR-ов. Если до срока записей (2026-11-16 и 2026-11-19) их не будет, записи снять. Если
  будут — включить probe ещё раз, теперь ради задачи renderer-а `Receive mojo reply`: какой IPC приложения она обслуживает.
