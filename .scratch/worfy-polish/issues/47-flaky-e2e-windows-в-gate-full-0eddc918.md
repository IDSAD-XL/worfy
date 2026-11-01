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

Заполняется при закрытии. Ticket open: `subagent-tree`, `terminal-windows` и Git Bash ждут замеров ПК.

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
