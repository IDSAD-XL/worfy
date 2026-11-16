# Fake timers vitest: помогут ли они с flaky test-ами и со скоростью

- **Дата:** 2026-11-16
- **Статус:** исследование, не решение. Ticket-ов не заводит.
- **Вопрос владельца.** «Can fake timers (https://vitest.dev/guide/mocking/timers) help us with flaky tests and speed
  up the rest of the tests where applicable?»
- **Ответ коротко.**
  - **Flaky test-ы — почти нет.** Из 28 flaky test-ов истории (2026-10-23…11-12) fake timers полностью убрали бы
    причину у одного, частично — у одного. Ещё один из них сам был ошибкой установки fake timers. 14 из 28 упали на
    настоящих процессах, файлах, pty и fs watch-ах. Туда fake timers не достают.
  - **Скорость — мало.** Unit- и contract-test-ы при замере шли 405 s wall на Mac, суммарное время test-ов —
    3268 s. Ожиданий, которые можно убрать fake timers-ами или более коротким значением, — около 90 s из этих 3268 s
    (~3%). Wall time run-а держат shell test-ы Harness-а: файл `harness-scripts-1` идёт с 107-й по 405-ю секунду.
    Ни один кандидат на этом пути не лежит. Выигрыш на CI job — порядка 10–20 s, не минуты (**оценка**).
  - **Где помогают.** В unit/jsdom test-ах, где весь код в одном процессе: debounce формы, tooltip, задержки
    черновика, «за N ms ничего не случилось». Там они делают проверку и быстрой, и детерминированной. 87 из 794 файлов
    уже так делают. Для contract test-ов с настоящими процессами правильный инструмент другой: короткое значение
    через опцию (`returnGraceMs`, `ticketsRootRetryMs`, `quietMs` уже есть в `src/main`) или явный барьер вроде
    `watcher.idle()`.
- **Как проверено.** Документация vitest, `@sinonjs/fake-timers` и Playwright прочитана 2026-11-16. Утверждения о
  поведении по умолчанию перепроверены по коду в `node_modules` (vitest 5.0.3, playwright-core 1.63.0,
  `@testing-library/dom` 10.4.2, chokidar 5.0.0). Замер — два локальных run-а на `164474a3f` на Mac владельца:
  полный run с JSON reporter-ом и run без четырёх файлов `harness-scripts-*` со временным probe-ом. Probe
  записывал каждый настоящий (не фейковый) `setTimeout`/`setInterval` от 20 ms, который сработал, и место, откуда он
  поставлен. Probe не закоммичен. История flaky test-ов — тело PR-ов, `test/quarantine/` и его история в git.

## 1. Что говорят первоисточники

### vitest

- **Что подменяется по умолчанию.** Документация API называет `setTimeout`, `setInterval`, `clearTimeout`,
  `clearInterval`, `setImmediate`, `clearImmediate` и `Date` и отдельно говорит, что `process.nextTick` и
  `queueMicrotask` не подменяются ([vi.useFakeTimers](https://vitest.dev/api/vi#vi-usefaketimers)). Код vitest 5.0.3
  шире документации: без `toFake` подменяется **всё**, что знает `@sinonjs/fake-timers`, кроме `nextTick` и
  `queueMicrotask` (`vitest/dist/chunks/index.C4tKZ0yW.js`, `useFakeTimers()`, строки ~6830–6845). В этот список
  входят `performance`, `hrtime`, `requestAnimationFrame`, `requestIdleCallback`, `Intl` и `Temporal`
  (там же, строки 5326–5370). Отсюда следствие: `performance.now()` под fake timers стоит на месте. Проверка
  «уложилось в N ms» становится пустой.
- **`nextTick` в child process.** «Mocking `nextTick` is not supported when running Vitest inside
  `node:child_process` by using `--pool=forks`… NodeJS uses `process.nextTick` internally in `node:child_process` and
  hangs when it is mocked» ([vi API](https://vitest.dev/api/vi#vi-usefaketimers)). Код бросает ошибку
  «process.nextTick cannot be mocked inside child_process».
- **Async-варианты.** `vi.advanceTimersByTimeAsync` и `vi.runAllTimersAsync` вызывают и те timer-ы, которые
  поставлены асинхронно, после promise-а ([vi API](https://vitest.dev/api/vi#vi-advancetimersbytimeasync)).
  Синхронные варианты не отдают управление, поэтому код на promise-ах к их концу может ещё не выполниться
  ([fake-timers README](https://github.com/sinonjs/fake-timers): `tickAsync` «will also break the event loop,
  allowing any scheduled promise callbacks to execute before running the timers»).
- **Насколько async-вариант «отпускает» event loop.** Между timer-ами он ждёт один настоящий `setImmediate`
  (`originalSetTimeout = _global.setImmediate || _global.setTimeout`, тот же файл, строки 5373 и 5857). Promise-ы
  и уже готовые callback-и I/O за этот шаг успевают. Чтение файла в пуле потоков libuv, ответ git или pty — не
  обязательно. Значит, при настоящем I/O между timer-ами `advanceTimersByTimeAsync` может запустить следующий timer
  раньше, чем пришёл ответ: порядок событий станет не таким, как в приложении.
- **Ожидания условий.** `vi.waitFor` и `vi.waitUntil` под fake timers сами двигают время на `interval` перед каждой
  проверкой, `expect.poll` — после каждой неудачной ([гайд](https://vitest.dev/guide/mocking/timers)).
  `waitFor` и `findBy*` Testing Library этого не делают. `@testing-library/dom` 10.4.2 двигает только fake timers
  Jest: `jestFakeTimersAreEnabled()` требует глобальный `jest` (`dist/helpers.js:14`). Под fake timers vitest его
  `waitFor` ждёт на подменённом `setTimeout` и висит до своего предела.
- **`shouldAdvanceTime`.** Время идёт само, шагом `advanceTimeDelta` (по умолчанию 20 ms) по настоящему интервалу
  ([fake-timers README](https://github.com/sinonjs/fake-timers); vitest: tick mode `interval`,
  [гайд](https://vitest.dev/guide/mocking/timers)). Это компромисс для кода с настоящим I/O. Скорости он не даёт:
  время идёт с той же скоростью, что и настоящее.
- **Timer-ы, поставленные до установки.** Они остаются настоящими. vitest ставит `shouldClearNativeTimers: true`
  (`vitest/dist/chunks/defaults.D2ip7f-X.js:47`), и `clearTimeout` такого timer-а уходит в настоящий
  `clearTimeout`. `vi.useRealTimers()` выбрасывает все фейковые timer-ы, которые не успели сработать
  ([vi API](https://vitest.dev/api/vi#vi-userealtimers)).
- **`Date`.** Если `now` не задан, часы стартуют с настоящего `Date.now()` в момент установки (код
  `useFakeTimers()`: `now: fakeDate`, где `fakeDate = … || Date.now()`). `vi.setSystemTime` без fake timers
  подменяет только `Date` и `Temporal.Now` ([vi API](https://vitest.dev/api/vi#vi-setsystemtime)).
- **`loopLimit`.** У vitest по умолчанию 10 000 (`defaults.D2ip7f-X.js:47`). `runAllTimers` с бесконечным
  `setInterval` бросает ошибку после этого числа.

### Playwright `page.clock` и Electron

- `page.clock` подменяет `Date`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`,
  `performance` и `Event.timeStamp`. Методы: `install`, `fastForward`, `runFor`, `pauseAt`, `resume`,
  `setFixedTime`, `setSystemTime`. `install` должен идти раньше любых других вызовов часов
  ([Clock](https://playwright.dev/docs/clock)). Electron в документации не упомянут.
- **В окне Electron он у нас уже работает.** `test/e2e/autopilot.spec.ts:435` (`window.clock.install()`, потом
  `fastForward('01:00')` на строке 469) и `test/e2e/session-view.spec.ts:404` (часы за минуту до полуночи,
  `fastForward(60_000)` на строке 420). Оба test-а зелёные на main.
- **Граница.** Часы ставятся в страницу, то есть в renderer. Timer-ы главного процесса Electron (watch-и, Autopilot,
  link) идут по настоящему времени (**вывод из устройства API**: clock работает в контексте страницы, главный процесс
  — это Node). Ни один e2e-flake истории (раздел 3) не был ожиданием timer-а в renderer: это были главный процесс,
  размер окна и выбор окна.

## 2. Замер нашего набора

Run: `node scripts/vitest-electron.mjs --reporter=json --outputFile.json=… --reporter=dot` на `164474a3f`, Mac
владельца, без нагрузки от других run-ов. Exit 0: 787 файлов passed, 7 skipped; 18 425 test-ов passed, 123 skipped.

- **Wall time 405 s.** Суммарное время test-ов — 3268 s: contract 2906 s, unit (`.ts`) 168 s, jsdom (`.tsx`)
  194 s.
- **Четыре файла `harness-scripts-*` — 1188 s (36%).** Это bash test-ы Harness-а. Fake timers vitest на них не
  действуют. Без них тот же набор идёт **179 s** wall (второй run).
- **Критический путь.** `harness-scripts-1` стартует на 107-й секунде и идёт 299 s, до конца run-а. Ни один
  кандидат ниже на этом пути не лежит.
- **Долгих test-ов немного.** 550 test-ов дольше 1 s дают 2165 s. 14 863 из 18 548 test-ов короче 100 ms.

### Самые медленные файлы (сумма времени test-ов)

| Файл | s | Почему медленный |
|---|---:|---|
| contract/harness-scripts-1…4.test.ts | 586 / 219 / 201 / 184 | bash test-ы Harness-а: настоящие процессы (git, node, bash) |
| contract/harness-evals-run.test.ts | 101 | процессы (eval-скрипт, stub claude, git); 10 s — poll-цикл `sleep` на строке 83 |
| contract/harness-install.test.ts | 96 | процессы, копирование Harness-а |
| contract/workflow-reader.test.ts | 75 | git + chokidar; ~26 s — фиксированные паузы «ничего не случилось» (1418, 1550, 1727, 2043, 2301) |
| contract/e3-sandbox.test.ts | 62 | bash; 40 запусков lock-run (строка 1389, 27.5 s) |
| contract/ci-workflow.test.ts | 58 | разбор YAML и процессы, 283 test-а |
| contract/terminal-ai-suggest.test.ts | 55 | настоящий zsh в pty; ~26 s — `sleep` (строка 91) после пауз 150 ms |
| contract/harness-dependency-cleanup.test.ts | 55 | процессы |
| contract/harness-migrate.test.ts | 53 | процессы |
| contract/harness-evals-outcome.test.ts | 46 | процессы, stub claude |
| contract/terminal-ai-zle.test.ts | 46 | настоящий zsh в pty |
| contract/harness-codex-hooks.test.ts | 39 | hook-скрипты; **10 s** — test на 10 s предел резолвера (строка 463) |
| contract/harness-codex-install.test.ts | 38 | процессы |
| contract/harness-evals.test.ts | 37 | процессы |
| contract/autopilot-retry.test.ts | 36 | **30 s** — два test-а сидят по 15 s в `HALT_TURN_MS` (строки 672, 688) |
| contract/projects-connect.test.ts | 32 | процессы; poll-циклы ожидания pid (590–894) |
| contract/workflow-branches-handles.test.ts | 31 | один test, 16 кругов fs.watch + git; `SETTLE_MS = 400` (строка 32) |
| contract/projects.test.ts | 29 | git |
| contract/update-build.test.ts | 26 | процессы |
| contract/terminal-ai-next-command.test.ts | 25 | zsh в pty; ~11 s `sleep` (строка 93) |
| contract/update-harness.test.ts | 25 | процессы |
| contract/docs.test.ts | 24 | chokidar; ~12 s — `pastStartReads` (строка 112) ждёт `SETTLE_READS_MS`; 4.5 s — `ms(1500)` на строке 349 |
| contract/autopilot-background.test.ts | 22 | fake agent-процесс; ~5.5 s пауз test-а |
| unit/affected-tests.test.ts | 22 | дочерние процессы git (14–24 на test) |
| contract/profile-move.test.ts | 18 | настоящий `bin/profile-set --move` и watch-и |

Медленные test-ы вне shell-файлов: `workflow-branches-handles.test.ts:118` 30.6 s (fs.watch, git),
`e3-sandbox.test.ts:1389` 27.5 s (bash), `autopilot-retry.test.ts:688` и `:672` по 15.2 s (**timer продукта**),
`free-place.test.ts:229` 12.4 s (CPU: 1000 случайных раскладок), `harness-codex-hooks.test.ts:463` 10.2 s (**timer
hook-скрипта**), `chokidar-close-callers.test.ts:115` 7.6 s (CPU: разбор исходников).

### Сколько времени уходит на настоящие timer-ы

Probe-run без `harness-scripts-*`, 784 файла. Считались только timer-ы, которые **сработали**. Время — сумма их
задержек. Timer-ы в параллельных test-ах складываются, поэтому это верхняя граница ожидания, а не wall time.

| Откуда поставлен timer | n | s |
|---|---:|---:|
| `src/` (debounce, retry, предел продукта) | 913 + 449 interval | 346 + 33 |
| `test/` (пауза test-а: `new Promise(r => setTimeout(r, N))`, `pause`, `sleep`) | 2393 | 258 |
| библиотеки (chokidar, ws, …) | 449 | 44 |
| poll `vi.waitFor` / Testing Library | 352 | 17 |

- **По видам test-ов.** Unit + jsdom: test 37 s, src 35 s, poll 16 s. Contract: test 221 s, src 312 s.
- **Срабатывание ≠ ожидание.** Например, `src/main/link/service.ts:198` и `src/main/link/connection.ts:146` дали 82 s.
  Это `unref()`-timer-ы закрытия сокета на 1 s, они идут в фоне, и test их не ждёт (у `link-pairing.test.ts`
  всё время test-ов — 8 s).

### Сколько test-ов уже на fake timers

- **Уже на fake timers — 87 файлов из 794** (61 unit/jsdom, 26 contract): 220 вызовов `vi.useFakeTimers`,
  360 — `advanceTimersByTimeAsync`, 208 — `advanceTimersByTime`, 56 — `vi.setSystemTime`. `runAllTimers*` не
  используется ни разу. Самые частые варианты — узкий `toFake`: `['Date']` (18), `['setTimeout','clearTimeout']`
  (15), `['Date','setInterval','clearInterval']` (10). `shouldAdvanceTime` — в двух файлах.
- **Внедрённые часы и задержки.** Ещё 61 файл передаёт продукту свои часы (`now: () => …`), 33 — свой
  планировщик или timer-ы. В `src/main` 95 опций вида `…Ms?: number`. Этим путём проект уже ходит чаще, чем через
  fake timers.
- **Настоящие паузы test-ов.** `setTimeout(` встречается в 203 файлах (510 мест), `vi.waitFor` — в 143 (1413),
  `expect.poll` — в 5 (54). Паузы-литералы `new Promise(… setTimeout(r, N))`: 380 мест, из них от 50 ms — в 65
  файлах. Девять обёрнуты в `ms()` и поэтому идут втрое дольше (множитель `test/time-scale.ts` = 3): 4.8 s
  написано, 14.4 s на деле.

## 3. История flaky test-ов

28 flaky test-ов, 2026-10-23…11-12. Источники: PR #873, #877, #985, #996, #1013, #1052, #1131, #1252, #1444,
#1519, #1538, #1606, #1608, #1617, #1629, #1703, #1706, #1709, #1760, #1784. Ещё `test/quarantine/` (сейчас 3 записи)
и его история в git. Классы:
**A** — timing на медленном runner-е, **B** — race в продукте, **C** — настоящий I/O, процесс, pty или fs watch,
**D** — e2e.

| Test | PR | Причина | Класс | Fake timers? |
|---|---|---|---|---|
| contract/orchestrator-continue (строка retry) | #1760 | fake timers **без `now`** стартовали с настоящего времени; за минуту до полуночи retry падал на завтра | A | это ошибка установки fake timers; исправлено `now` |
| unit/chat-attachments (dropped files) | #1760 | фиксированный 50 ms timer против цепочки `setImmediate` jsdom FileReader | A | частично: нужен фейковый `setImmediate`, который тянет за собой FileReader |
| unit/platform-entry | #1629 | toast-timer сработал после снятия jsdom | A | спрятали бы, а не исправили |
| unit/getting-started-panel | #1629 | импорт модулей внутри первого test-а — 14.2 s из 15 s | A | нет (стоимость импорта) |
| unit/search-index | #1629 | wall-clock предел 100 ms | A | нет: фейковый `performance` обнулит проверку |
| contract/autopilot-wait (5 test-ов) | #1608 | race test-а + race продукта (устаревший grace 2 min) | B | нет: test уже висел на своих ручных часах |
| contract/evidence-image-protocol:287 | #1706 | 64-битный id файла Windows округлялся до 53 бит | B | нет |
| contract/workflow-watch-links | #877 | `close()` не ждал идущего scan-а | B | нет |
| contract/claude-home-registry:597 | #996 | chokidar пропускал файл между чтением папки и стартом её watch-а | C | нет |
| contract/autopilot-limits:1422, :1236 | #1617 | строка журнала читается раньше, чем `appendFile` resolve-ится | C | нет |
| contract/codex-app-server:304 | #1617 | на Windows `exit` отстаёт от `kill(pid, 0)` | C | нет |
| flight-recorder-gate-logs и ещё 7 | #1617, #1629 | фоновый `git maintenance` и его lock | C | нет |
| login-shell-capture:133; projects-connect | #1617, #1629 | полузаписанный файл, пустой pid-файл | C | нет |
| harness-hook-stdin | #1784 | macOS теряет вывод pty при закрытии | C | нет |
| terminal-ai-assist / next-command:215 / suggest:443 | #1784, #1052 | первая проверка нового скрипта macOS; `git branch` дольше 1 s | C | нет |
| link-reconnect | #1784 | `localhost` → `::1`, где слушает сервер другого test-а | C | нет |
| app-orchestrators | #1629 | fake Codex-процесс стартовал дольше 1 s `vi.waitFor` | C | нет |
| unit/affected-tests (5) | #1013, #1052, #1606 | 14–24 запуска git на test под нагрузкой | C | нет |
| harness-evals, demo-template, eval-outcome-check | #877, #1052, #1606 | ~80 запусков процессов на Windows | C | нет |
| workflow-reader (пределы 450 ms, 1.5 s) | #873, #1052 | wall-clock предел включал время git и epic-status | C | нет |
| workflow-branches-gone:70; terminal-windows:177 | #1052, #1131 | EBUSY от git watcher-а; пределы CPU и закрытия | C | нет |
| wave-gate-heartbeat, gate-verdict-signals, rules-hooks (.sh) | #1629, #1784 | фиксированные `sleep` в bash | C | не применимо: bash |
| e2e card-drag ×3, browser 640, linked-notify | #1252, #1444, #977→#1519 | окно на Windows runner-е не дорастало до ширины: диск C: в paging | D | нет, `page.clock` тоже |
| e2e quiet-windows, wheel-over-nodes, update-settings, browser-family | #985, #1052, #1538, #1606 | stall главного процесса; чтение до prompt-а Git Bash; не то окно | D | нет, `page.clock` тоже |

**Счёт по 28 test-ам: A 5, B 3, C 14, D 6.**
- **Fake timers исправили бы.** Полностью — один: orchestrator-continue, и тот был ошибкой самих fake timers.
  Частично — chat-attachments.
- **Fake timers спрятали бы один:** platform-entry.
- **Ни один flake не был фиксированным ожиданием в ms, которое fake timers просто убрали бы.** Проект почти всегда
  чинил flake детерминированно: ждал условие, ставил stub, запускал меньше процессов, правил продукт. Предел
  поднимали трижды (app-orchestrators, affected-tests, harness-evals). #1617, #1629, #1703, #1706 и #1709 прямо
  пишут «no timeout raised».

## 4. Оценка и кандидаты

### Сколько секунд даст перевод (время test-ов, Mac)

| Группа | Как | Время test-ов, s |
|---|---|---:|
| Timer-ы продукта, которые test высиживает | короткое значение через опцию, **не** fake timers (рядом настоящие процессы) | ~55 |
| Unit/jsdom: debounce и «ничего не случилось» | fake timers + `advanceTimersByTimeAsync` | ~25 |
| Негативные паузы в `ms()` | писать без множителя: ожидание отсутствия события не становится надёжнее от ×3 | ~10 |
| **Итого** | | **~90 из 3268 (~3%)** |

- **Wall time.** Локально — около 0 s: критический путь — `harness-scripts-1`, кандидатов на нём нет. На CI набор
  делится на 4 Linux-shard-а, macOS job и Windows job-ы. Каждый получает долю этих ~90 s, делённую на параллельность
  runner-а. Это порядка 10–20 s на job (**оценка**, на CI не замерено).
- **Flake-и.** Ни один из 28 не был бы предотвращён этой работой. Выигрыш — меньше будущих flake-ов в unit/jsdom
  test-ах с паузами «подождать N ms», где пауза гонится с нагрузкой. Пример такой гонки — chat-attachments.

### Кандидаты по файлам

Timer-ы продукта, которые test высиживает. Здесь лучше внедрить задержку: fake timers сломали бы соседний настоящий
I/O.

1. **`test/contract/autopilot-retry.test.ts:672`, `:688`: 2 × 15 s.** Stop во время хода ждёт `interruptTurn` с
   `HALT_TURN_MS = 15_000` (`src/main/agent/session/process.ts:9`; вызов `src/main/agent/session.ts:850`, timer —
   `:524`). Fake agent держит ход на `wait_release`, и предел истекает полностью. Как исправить: опция Session-а
   `haltTurnMs`, по образцу `returnGraceMs` у orchestrator-а (`src/main/agent/orchestrator.ts:899`). Test передаёт
   ~200 ms. Экономия ~30 s.
2. **`test/contract/harness-codex-hooks.test.ts:463`: 10 s.** Test проверяет 10-секундный предел резолвера
   hook-а. Hook — дочерний процесс, fake timers vitest до него не дотягиваются. Как исправить: предел из переменной
   окружения hook-а, test ставит 1 s и проверяет «≥ 1 s и < 60 s». Экономия ~9 s.
3. **`test/contract/docs.test.ts:112` (`pastStartReads`), `test/unit/docs-watch-root-gone.test.ts:115`: ~15 s.**
   Test-ы ждут чтений после старта `SETTLE_READS_MS = [100, 400, 1000]` (`src/main/docs/watch.ts:215`, timer —
   `:503`). У `DocsWatcher` уже есть опции (`DocsWatchOptions`). Нужна ещё одна, `settleReadsMs`; test-ы без
   проверки этих чтений ставят `[10]`. Экономия ~12–15 s.

Unit/jsdom: всё в одном процессе, здесь fake timers уместны.

4. **`test/unit/connect-project.test.tsx:254` (500 ms), `:336` (400 ms), poll `:134`: ~7 s.**
   `src/renderer/projects/ConnectProject.tsx:172` `CHECK_DELAY_MS = 350`, timer — `:259`. Как исправить:
   `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`, затем
   `await act(() => vi.advanceTimersByTimeAsync(350))`. `waitFor` Testing Library поменять на `vi.waitFor`: первый
   под fake timers vitest висит (раздел 1).
5. **`test/unit/edit-profile.test.tsx:133`: ~6 s.** Тот же debounce `CHECK_DELAY_MS = 350` в
   `src/renderer/projects/EditProfile.tsx:88`, timer — `:152`. Изменение то же.
6. **`test/unit/kit-tooltip.test.tsx:20` (`flush`, ×n): ~5 s.** Задержки tooltip-а Base UI
   (`src/renderer/theme/kit/Tooltip.tsx:150`). Как исправить: `toFake: ['setTimeout', 'clearTimeout']` +
   `advanceTimersByTimeAsync` в `act`. Риск: Base UI может ставить `requestAnimationFrame`. Тогда нужен
   `vi.advanceTimersToNextFrame()`.
7. **`test/unit/session-view.test.tsx:834` (400 ms), `test/unit/session-node-drop.test.tsx`: ~4 s.** Сохранение
   черновика `src/renderer/session/drafts.ts:108` и «main не спросили». Изменение то же, что в п. 4.
8. **`test/unit/mind-map-view.test.tsx:499` (`nextFrame`, 60 ms ×4), `test/unit/terminal-replies.test.tsx:362`
   и соседние (50 ms ×6): ~1 s.** Немного времени, но в таких паузах сидит гонка с нагрузкой. Для React Flow —
   `toFake: ['requestAnimationFrame']` и `vi.advanceTimersToNextFrame()`.

Негативные паузы, обёрнутые в `ms()`.

9. **Девять мест:** `test/contract/docs.test.ts:349` (`ms(1500)` = 4.5 s),
   `test/contract/project-pulse.test.ts:278, 314, 375, 386`, `test/contract/workflow-reader.test.ts:1550`,
   `test/contract/terminal-git-bash-close.test.ts:226`, `test/contract/auto-approve-codex.test.ts`,
   `test/contract/codex-session-limits.test.ts`. Множитель нужен **пределам** — ожиданиям того, что должно прийти. У
   негативной паузы он только удлиняет test. Как исправить: убрать `ms()` или заменить паузу барьером
   (`watcher.idle()`, как на `workflow-reader.test.ts:1419`). Экономия ~10 s. Решение спорное: на медленном runner-е
   короткая негативная пауза может пропустить запоздалое событие, то есть проверка станет слабее, но не краснее.

Не кандидаты, хотя пауз в них много: `workflow-reader.test.ts` (1418, 1727, 2043, 2301),
`workflow-branches-handles.test.ts:32`, `terminal-ai-suggest.test.ts` и `terminal-ai-next-command.test.ts`,
`projects-connect.test.ts` (590–894). Там пауза ждёт настоящий chokidar, fs.watch, git, zsh в pty или pid процесса.
Короче их делают внедрённые значения (например, `PAUSE_MS` terminal-ai уже 150/100 ms) и барьеры, а не fake timers.

### Риски

- **Настоящие дочерние процессы (git, bash, zsh в pty, fake agent).** Время в них идёт настоящее.
  `advanceTimersByTimeAsync` между timer-ами ждёт один `setImmediate` и может опередить их ответ. Получается порядок
  событий, которого в приложении нет, то есть новый flake.
- **chokidar 5.0.0** ставит свои `setTimeout` (throttle — `index.js:592`, `awaitWriteFinish` — `:638`, `:651`).
  Глобальные fake timers их замораживают: события watch-а не приходят, пока test не двинет время.
- **Promise-ы.** Синхронные `advanceTimersByTime`/`runAllTimers` не дают выполниться callback-ам promise-ов между
  timer-ами. Нужны `*Async`-варианты. В React — внутри `act`.
- **Testing Library.** Его `waitFor`/`findBy*` не двигают fake timers vitest (`@testing-library/dom`,
  `dist/helpers.js:14`): test висит до предела. Под fake timers нужен `vi.waitFor` или `shouldAdvanceTime: true`.
- **`Date` и время файлов.** Фейковый `Date` расходится с mtime файлов (`fs.stat`), датами коммитов git и
  временем других процессов. Код, который сравнивает `Date.now()` с mtime или временем коммита, начнёт видеть
  будущее или прошлое. Без `now` часы стартуют с настоящего момента: так и получился flake orchestrator-continue.
- **`performance` по умолчанию тоже фейковый.** Проверки «уложилось в N ms» (`search-index`,
  `workflow-reader`) под fake timers становятся пустыми.
- **Ничего не ловят там, где был баг.** Flake-и B и C — порядок настоящих событий. На фейковом времени test
  становится зелёным, а race остаётся в продукте. Пример — platform-entry.

### Правило: когда fake timers НЕ использовать

Fake timers — только если весь путь от действия test-а до проверки идёт в процессе test-а и не трогает настоящий
I/O. Нет дочерних процессов, pty, chokidar/fs.watch, сокетов, git. Нет чтения файлов, которое должно успеть между
timer-ами. В остальных случаях — короткое значение через опцию продукта, явный барьер (`idle()`) или ожидание
условия (`vi.waitFor`).

Если fake timers всё же нужны:
- узкий `toFake` (`['setTimeout', 'clearTimeout']`, отдельно `['Date']`);
- всегда явный `now`;
- только `*Async`-варианты;
- `vi.useRealTimers()` в `afterEach`/`finally`.

## 5. Что из этого следует (не решение)

- Перевод на fake timers ради скорости CI почти ничего не даёт: ~3% времени test-ов, около 0 s локального wall time.
  Ради flaky test-ов он не нужен: их корни — настоящий I/O и race-ы продукта.
- Самый крупный выигрыш по времени из найденных — не про timer-ы. Shell test-ы Harness-а занимают 36% времени
  test-ов и идут последними (`harness-scripts-1` стартует на 107-й секунде). Это отдельный вопрос к планированию run-а.
- Если делать: кандидаты 1–3 (внедрённые задержки, ~55 s) — один небольшой Ticket. Кандидаты 4–8 — правило для
  новых unit/jsdom test-ов плюс разовая правка пяти файлов.
