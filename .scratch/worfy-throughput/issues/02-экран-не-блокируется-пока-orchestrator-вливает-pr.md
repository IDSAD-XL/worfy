# 02 — Экран не гаснет, пока Orchestrator вливает PR вне Autopilot; заблокированный экран перед gate full — одна строка, а не красный e2e

Type: task
Status: done — 2026-10-16, [PR #392](https://github.com/IDSAD-XL/worfy/pull/392)
Branch: worfy-throughput/02
Blocked by: 01
Source: [spec.md](../spec.md), решение владельца 2026-10-16, пункт 1, и «Решено без владельца»
(Ticket сужен); ночь 2026-10-16 — мержи стояли около 5,5 h;
[ADR-0034](../../../docs/adr/0034-autopilot-keeps-display-awake.md); урок
`docs/lessons/agents.md:47-54`.

## Что происходит

- **Autopilot уже держит экран.** Прогон берёт `powerSaveBlocker` типа `prevent-display-sleep`
  (`src/main/autopilot/power.ts:19`, `src/main/autopilot/run.ts:566-567`) и отпускает на остановке и
  на `will-quit` (`power.ts:10-12`). Подсказки кнопки и строки статуса Autopilot это говорят:
  «The display stays on until the run ends» (`src/renderer/canvas/actions/AutopilotAction.tsx:60`,
  `:263`, `:305`; e2e — `test/e2e/autopilot.spec.ts:268`). Так решил ADR-0034.
- **Переключатель worfy-link — другое.** «Keep this computer awake while linked machines are
  connected» держит blocker типа `prevent-app-suspension` (`src/main/link/keep-awake.ts:4-5`, `:20`), и
  только пока подключена Linked machine и включён доступ к Project-ам (`:6-11`). Это запрет сна
  **системы**: экран при нём гаснуть может. Три разных состояния:
  - сон системы — Mac спит, ничего не идёт; от него защищают оба blocker-а;
  - сон экрана — система работает, экран погас; от него защищает только `prevent-display-sleep`;
  - блокировка — macOS блокирует экран, когда он погас или включилась заставка (настройка «Require
    password after screen saver begins or display is turned off», ADR-0034, «Контекст»). Пока экран
    заблокирован, Electron не показывает окно, и каждый e2e падает на первом окне.

  Для gate full нужен экран, поэтому переключатель worfy-link здесь не помогает, а дублировать его
  незачем.
- **Дыра — мержи вне прогона Autopilot.** Ночью 2026-10-16 прогон Autopilot `worfy-polish`
  остановился в 04:39 по местному времени (`run-stopped`, `blocked-tickets`). Оставшиеся PR (#372,
  #378, #345) вливала Session Orchestrator-а в Claude Code — не прогон worfy, blocker-а нет. Экран погас
  и заблокировался; следующий мерж — в 10:09.
- **Проверки заблокированного экрана нет ни в одном скрипте.** Есть только урок
  (`docs/lessons/agents.md:52-53`: `ioreg -n Root -d1`, `IOConsoleLocked`) — агенты делали цикл
  ожидания сами, каждый раз заново. В `harness/`, `scripts/` и `rules.md` Profile-а `IOConsoleLocked`
  не встречается.

## Что делаем

1. **`wave-gate check` (Ticket 01) проверяет экран перед каждым gate full**, если в `PATH` есть `ioreg`
   (так проверка заменяется stub-ом и на Linux CI; ветки по `process.platform` нет):
   `ioreg -n Root -d1`, поле `IOConsoleLocked`. `Yes` — одна строка `screen locked: gate full waits` и
   ожидание разблокировки (опрос раз в 30 s), а не запуск e2e. Экран заблокировался посреди gate full
   и e2e упали на первом окне — прогон «не удалось проверить: экран заблокирован», не красный; он
   записывается в `state.json` как незаконченный и повторяется после разблокировки. `ioreg` в `PATH`
   нет — проверки нет.
2. **Экран держат сами команды Ticket-а 01, а не Session.** `wave-gate check` и `wave-gate merge`, если
   в `PATH` есть `caffeinate`, на старте запускают `caffeinate -d -w <собственный pid>`: экран не гаснет,
   пока команда жива, и `caffeinate` завершается сам вместе с ней — фонового процесса не остаётся.
   Каждая команда держит свой. pid Claude Code и Session не используются. Внутри прогона Autopilot это
   ничего не меняет: blocker прогона уже держит экран. Между командами (ожидание CI, ревью) экран
   может погаснуть — это закрывает проверка пункта 1.
3. **Правило в `rules.md` Profile-а worfy** (шаг Orchestrator-а после мержа, diff — в «Итог»): перед
   любым gate full и e2e на Mac вне `wave-gate` — проверка `IOConsoleLocked`; при `Yes` — строка «экран
   заблокирован» и ожидание, прогон не начинается. Это правило заменяет ручной цикл каждого агента.
4. **Урок `docs/lessons/agents.md`, раздел «Ночной прогон Autopilot»** дополняется: прогон держит экран,
   а проверку и мержи вне прогона — `caffeinate` самих команд `wave-gate` (пункт 2); источник — ночь
   2026-10-16.

**Этот Ticket — платформенный PR** по ADR-0056, пункт 2: он меняет скрипт Harness
(`harness/bin/wave-gate`). Он вливается по-старому, вне набора Ticket-а 01, с вердиктом Windows.

## Готово, когда

- [x] Test `wave-gate` со stub-ом `ioreg` в `PATH`: `IOConsoleLocked = Yes` — строка `screen locked`,
      gate не запускается; `No` — gate идёт; `ioreg` в `PATH` нет — проверки нет, gate идёт.
- [x] Test: красный gate, в выводе которого `the window was not shown within 30 s` при заблокированном
      экране (stub), — вердикт «не удалось проверить: экран заблокирован», не красный; прогон
      повторяется после разблокировки.
- [x] Test: `wave-gate check` и `wave-gate merge` со stub-ом `caffeinate` в `PATH` зовут его с
      `-d -w <pid самой команды>`; после выхода команды процесса stub-а нет; без `caffeinate` в `PATH`
      команды идут без него.
- [ ] (вручную) На Mac: во время `wave-gate check` `pmset -g assertions` показывает
      `PreventUserIdleDisplaySleep` от `caffeinate`, после выхода — нет. Вывод — в «Итог».
- [x] (вручную) Вердикт Windows по ADR-0056, пункт 2: на Windows-ПК — shell test-ы `wave-gate` через Git
      Bash и gate full; код и строка вердикта — в «Итог». Пока `worfy-windows` 14 не `done` — правило
      «Последствий» ADR-0056 (`:73-77`).
- [x] (вручную, Orchestrator) правило в `rules.md` Profile-а — diff в «Итог».
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; gate full —
      шаг Orchestrator-а перед merge; Linux CI зелёный.

## Тесты

- `harness/bin/tests/wave-gate.test.sh` — stub-ы `ioreg` и `caffeinate` в `PATH`; без них — тот же
  набор test-ов проходит без проверки экрана.
- Сначала красный: test «экран заблокирован — gate не запускается» до правки.
- Мутанты: не проверять экран; проверять по `process.platform`, а не по `ioreg` в `PATH`; считать
  падение первого окна при заблокированном экране красным; передать в `-w` не свой pid. Каждый
  краснит свой test.

## Где в коде

- `harness/bin/wave-gate`
- `harness/bin/tests/wave-gate.test.sh`
- `harness/skills/epic-wave/SKILL.md`
- `docs/lessons/agents.md`

Только читать: `src/main/autopilot/power.ts`, `src/main/link/keep-awake.ts`,
`docs/adr/0034-autopilot-keeps-display-awake.md`.
Вне репозитория (шаг Orchestrator-а): `~/.claude/worfy-harness/projects/worfy/rules.md`.

## Вне скоупа

- Код worfy: keep-awake Autopilot и переключатель worfy-link не меняются.
- Закрытая крышка и экран, заблокированный вручную, — worfy их не обходит (ADR-0034, пункт 3).
- Настройки macOS (заставка, пароль после сна экрана) — worfy и Harness их не трогают.
- Keep-awake самого Claude Code desktop: по его описанию он защищает от idle sleep; держит ли он
  экран, не проверено, поэтому на него не опираемся.

## Итог

Сделано в ветке `worfy-throughput/02` (implementer, 2026-10-16).

- **Проверка экрана перед каждым gate full** — `harness/bin/wave-gate`, функции `screenLocked`,
  `screenWait`, `gateOnce`. `ioreg -n Root -d1`, поле `IOConsoleLocked`; `ioreg` нет в `PATH` (spawn
  отвечает ENOENT) — проверки нет, ветки по `process.platform` нет. `Yes` — одна строка
  `screen locked: gate full waits`, опрос раз в 30 s (`WAVE_GATE_SCREEN_POLL_S`), замок e2e при
  ожидании не держится. Экран проверяется до замка e2e и ещё раз, когда замок взят: ожидание замка
  может длиться целый gate full соседа; заблокирован — замок отдаётся, ожидание идёт снова.
- **Экран заблокировался посреди gate full** — `screenWatch`: опрос во время прогона и проверка в его
  конце. Красный прогон, у которого среди упавших script-ов строки `[gate] красно (…): …` есть
  `test:e2e` или `test:package` (они запускают Electron), при экране, заблокированном за время прогона, записывается в
  `state.json` как `outcome: "unverified"`, `screen_locked: true`, `reason: "screen locked: …"` и
  повторяется после разблокировки в том же `check`. Не больше трёх прогонов подряд (`SCREEN_TRIES`),
  потом `check` кончается `STATUS=unverified`, exit 3; следующий `check` повторяет прогон (незаконченные
  прогоны он и так отбрасывает). Красный только в `test` (без e2e script-а) при заблокированном экране и
  красный e2e при незаблокированном экране (нагрузка параллельных e2e) — красные, как раньше.
  Предел числа прогонов: каждый законченный прогон может занять до трёх, поэтому `check` делает не
  больше 3 × (2 + ⌈log₂ N⌉) прогонов, а не 2 + ⌈log₂ N⌉, как пишет ADR-0065 (принятый ADR не правится;
  разница — только здесь и в комментарии `wave-gate`).
- **`caffeinate`** — `keepAwake` / `letSleep`: `check` и `merge` на старте зовут
  `caffeinate -d -w <process.pid>`; `caffeinate` нет в `PATH` — команды идут без него. На выходе, на
  ошибке и на сигнале процесс ещё и снимается явно; при SIGKILL его заканчивает `-w`.
- **Skill** `harness/skills/epic-wave/SKILL.md`, раздел «Gate before merge»: абзац об экране —
  что делают команды, строка ожидания не ошибка, ручная проверка `IOConsoleLocked` перед gate full
  вне `wave-gate`.
- **Урок** `docs/lessons/agents.md`, «Ночной прогон Autopilot»: раздел переписан под формат уроков
  (2–6 строк), добавлены `caffeinate` команд `wave-gate`, проверка перед gate full и ночь 2026-10-16.

Test-ы — `harness/bin/tests/wave-gate.test.sh`, 112 проверок (после доработки), exit 0. Stub-ы `ioreg` и `caffeinate`
лежат в отдельной папке впереди `PATH` во всех test-ах, поэтому настоящие `/usr/sbin/ioreg` и
`/usr/bin/caffeinate` не зовутся. Без них test идёт с `PATH` из ссылок на нужные инструменты, без
`/usr/bin` и `/usr/sbin`. Новые test-ы: экран заблокирован до прогона (одна строка, gate не идёт, замок
e2e свободен, `ioreg -n Root -d1` опрашивается); экран заблокировался, пока ждали замок e2e; экран не
заблокирован; экран заблокировался посреди прогона и остался заблокирован; заблокировался и
разблокировался посреди прогона; ошибка окна без блокировки — красный и flaky; другой красный при
блокировке — красный; три прогона подряд под блокировкой — exit 3, следующий `check` зелёный;
`caffeinate -d -w <pid команды>` у `check` и у `merge`; без `ioreg` и `caffeinate` в `PATH`; после
выхода, ошибки, SIGTERM и SIGKILL процессов stub-а нет.

Мутанты (копии скрипта в scratchpad, запуск через `BIN_DIR`), каждый краснит свой test:
| мутант | красный test |
| --- | --- |
| не проверять экран (`screenLocked` всегда `false`) | `locked screen: one line …` и ещё 9 |
| `ioreg` по `process.platform` (`/usr/sbin/ioreg` на darwin) | `locked screen: …` и ещё 9 |
| падение первого окна при заблокированном экране — красный | `screen locked during the run: …` (3), `screen locked during every run` (2) |
| `-w` с чужим pid (`process.ppid`) | `caffeinate: check/merge runs caffeinate -d -w <its own pid>`, `resume: no caffeinate left after a SIGKILL` |
| без повторной проверки экрана после замка e2e | `locked screen after the e2e lock: …` |
| без проверки экрана в конце прогона | `screen locked during the run: …` (3), `screen locked during every run` (2) |
| без опроса экрана во время прогона | `screen locked and unlocked during the run: …` |

Мутант «`return false` при `process.platform !== "darwin"`» на Mac не краснеет (здесь darwin); на Linux
CI его краснят те же test-ы — локально не проверено.

Проверки: `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (264 файла, 5541 test); shell test-ы
`wave-gate`, `skill-blocks`, `epic-wave-ship-ticket`, `agents-text` — exit 0; gate fast — exit 0,
`[gate] зелено (fast)`. gate full — шаг Orchestrator-а.

**Решено без владельца, подтвердить:**
1. Прогон, испорченный заблокированным экраном, повторяется в том же `check`, а не отдаётся
   Orchestrator-у кодом 3: ночью повтор без хода агента. Предел — три прогона, потом exit 3.
2. Испорченным считается только красный прогон, в котором упал e2e script (`test:e2e`, `test:package`),
   при экране, заблокированном за время прогона (опрос раз в 30 s и проверка в конце). Красный только в
   других script-ах остаётся красным. Имена script-ов зашиты в `wave-gate` (проект worfy); другому проекту
   понадобится поле профиля.
3. `caffeinate` снимается и явно на выходе — в дополнение к `-w`.
4. Раздел урока переписан целиком, а не дополнен: с добавкой он выходил за 6 строк формата.

**Правка `rules.md` Profile-а worfy** (шаг Orchestrator-а, `~/.claude/worfy-harness/projects/worfy/rules.md`),
после пункта «e2e и gate full разных агентов — по одному, под общим замком»:

```diff
+- **Перед любым gate full и e2e на Mac вне `wave-gate` — проверка экрана** (worfy-throughput/02).
+  Пока экран заблокирован, Electron не показывает окно, и каждый e2e падает на первом окне. Перед
+  прогоном, внутри той же команды Bash, перед командой замка:
+  `ioreg -n Root -d1 | grep -q '"IOConsoleLocked" = Yes' && { echo "экран заблокирован: жду"; while ioreg -n Root -d1 | grep -q '"IOConsoleLocked" = Yes'; do sleep 30; done; }`.
+  Прогон, упавший на первом окне («the window was not shown within 30 s»), пока экран был
+  заблокирован, — не красный: повторить после разблокировки. `wave-gate check` делает это сам и сам
+  держит экран (`caffeinate`). Это правило заменяет ручной цикл ожидания каждого агента.
```

Не проверено:
- (вручную) `pmset -g assertions` во время `wave-gate check` на Mac — шаг владельца или Orchestrator-а:
  настоящий `caffeinate` в test-ах и руками implementer-а не запускался.
- (вручную) вердикт Windows по ADR-0056, пункт 2 — шаг владельца. Stub-ы test-а — bash-скрипты без
  расширения; `wave-gate` зовёт `gh`, `ioreg`, `caffeinate` через `spawn` по имени, а на Windows так
  bash-скрипт не находится (и stub `gh`, и stub gate Ticket-а 01 — тоже). Без `ioreg` и `caffeinate` на
  Windows проверки экрана и `caffeinate` нет — это и ожидается.
- (вручную) правка `rules.md` — шаг Orchestrator-а, diff выше.

### Доработка, круг 1 (2026-10-16)

Вердикт `REJECTED`, [med]: признак «прогон испортил экран» искал в выводе gate сообщение
`the window was not shown within`, а gate оставляет от упавшего script-а последние 40 строк
(`harness/hooks/gate.mjs:895`). Там список упавших test-ов Playwright, и при 35+ test-ах сообщения в
выводе нет. Испорченный прогон выходил красным, дальше — flaky или бисекция, которая называет
невиновный PR.

- Признак теперь — упавший e2e script в строке `[gate] красно (full): <проект>/<workspace>:<script> …`
  (`failures(text).scripts`, регулярное выражение `WINDOW_SCRIPT` — `test:e2e`, `test:package`).
- Stub gate печатает настоящую форму: строку `[gate] красно (full): worfy/.:test:e2e (прошло: …)` и
  хвост из 40 строк с именами test-ов, без сообщения об окне. Новые test-ы: «экран заблокирован, упал
  `test:package`» → не проверено; «экран заблокирован, упал только `test`» → красный; в логе
  испорченного прогона нет `window was not shown`.
- Мутанты круга, каждый краснит свой test: прежний поиск сообщения в тексте (7 FAIL); любой красный при
  блокировке — испорченный (`screen locked, only test failed`); без `test:package` (`screen locked,
  test:package`); `test:e2e` ищется во всей строке, вместе со списком «прошло» (2 FAIL); испорченный
  прогон считать красным (7 FAIL).
- [low] Комментарий о пределе прогонов в `wave-gate` и предел в «Итог» — 3 × (2 + ⌈log₂ N⌉).
- [low] В урок вернулась ссылка «e2e идут только локально — урок о CI в `ci-merge.md`».
- Check «the real home changed» в `wave-gate.test.sh` изредка краснеет: 3 раза из примерно 15 прогонов,
  первый раз — ещё до правки скрипта. Снимки `~/.claude` каждые 3 s за два прогона (6 мин) изменений
  не показали. Причина не найдена.

### Merge (2026-10-16)

- Вердикт Windows-ПК (Session «Worfy тесты на ПК», [комментарий в PR #392](https://github.com/IDSAD-XL/worfy/pull/392#issuecomment-6218743860)): новых падений нет. `pnpm test` по именам: main `4089c03` — 413 failed, ветка `174e9f8` + main — 405; 4 падения только на ветке проходят отдельно. `wave-gate.test.sh` на Windows не запускается ни на ветке (23 ok / 89 FAIL), ни на main (18 / 68) — два механизма, оба в Ticket-е 06; логика экрана и `caffeinate` на Windows не проверена, 6 ok только на ветке тривиальные (ничего не запустилось).
- Тот же прогон на main — вердикт задним числом для 01 (PR #384): новых падений от 01 нет.
- Mac: merge origin/main в ветку (`1af824fe`, база `b33be1e3`), `GATE_SCOPE=all gate.sh full` — exit 0, `[gate] зелено (full)`; CI `check` — 0. Squash-merge `2f24d912`.
- Правка `rules.md` Profile-а внесена 2026-10-16 (абзац «Перед любым gate full и e2e на Mac вне `wave-gate` — проверка экрана», сразу после правила замка e2e).
- Не проверено: `pmset -g assertions` во время настоящего `wave-gate check` на Mac.
