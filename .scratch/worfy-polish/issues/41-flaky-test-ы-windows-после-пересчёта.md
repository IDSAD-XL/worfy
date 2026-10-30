# 41 — Flaky test-ы Windows после пересчёта 2026-10-23: 2 e2e и 5 unit/contract, красные только под нагрузкой или изредка

Type: task
Status: claimed 2026-10-30T13:35Z
Branch: worfy-polish/41-part2
Blocked by: —
Source: пересчёт на ПК владельца 2026-10-23 (e2e на main `f8ada2a3`, unit и contract на main `bc19f2f7`,
масштаб 150 %; `C:/Users/Alexey/worfy-wt/recount/summary.md` на ПК), решение владельца 2026-10-23 по отсечке
`worfy-windows`: flaky test-ы выходят из Epic-а одним Ticket-ом `worfy-polish`. Красные, которые повторяются
каждый раз, — в `worfy-windows` 106 и 109–112. Строки — по main `cf5adbf2`. Правка 2026-10-28
([spec `worfy-throughput`](../../worfy-throughput/spec.md), раздел «Решения владельца 2026-10-28: процесс»):
`workflow-reader` и `workflow-branches-handles` краснеют и на GitHub Windows-runner-е и перешли в
`worfy-throughput` [23](../../worfy-throughput/issues/23-flaky-test-ы-windows-видные-на-runner-е.md); добавлены
красные на ПК 2026-10-27; Ticket ждёт ПК; запись карантина (`worfy-throughput` 20) может называть его владельцем.

## Что происходит

Каждый из test-ов ниже был красным хотя бы раз 2026-10-23 и зелёным в других прогонах того же main. Ни один не
красный в тихом повторе (без другой нагрузки на ПК), кроме `epic-frame-undo` (2 из 3).

e2e (`pnpm exec playwright test --grep-invert @packaged`):
- `test/e2e/epic-frame-undo.spec.ts:125` («⌘Z puts a frame dragged by its header back…»): клик по
  «Collapse epic demo» (`:163`) — `Timeout 30000ms exceeded`, кнопка найдена (`aria-expanded="true"`), но
  клик не прошёл. Красный 2 из 3 на main.
- `test/e2e/projects-connect.spec.ts:217` («the GitHub account: the active account with access by default…»):
  `the app did not quit within 20 s and was killed` (`test/e2e/helpers.ts:276-278`). Только в пересчёте, в
  обоих gate full зелёный.

unit и contract (`pnpm test`; красные только в полном прогоне, когда параллельно идут другие файлы):
- ~~`test/contract/workflow-reader.test.ts`~~ и ~~`test/contract/workflow-branches-handles.test.ts`~~ — перешли
  в `worfy-throughput` 23 (правка 2026-10-28).
- `test/contract/shell.test.ts:293` («on darwin asks about every known launcher kind, in either letter
  case»).
- `test/contract/harness-evals-outcome.test.ts` — таймауты `beforeAll` (hook 300 s) и одного test-а на 60 s;
  в одном полном прогоне из трёх.
- `test/contract/terminal.test.ts:185` — после `closeAll()` pid-ы pty ещё живы (`[false, false, false]`
  ожидалось); в одном gate.

Добавлено 2026-10-28 (ПК, 3+3 run-а на main под нагрузкой 2026-10-27; разбор красных run-ов Windows):
- `test/contract/terminal.test.ts` — конец shell через PowerShell в `wireRegistry`; «one Terminal on several
  screens»; «Restart from A» (один раз при CPU 46 %).
- `harness/bin/tests/wave-gate-lock.test.sh` — случаи токена замка e2e, один раз красные на Windows (run PR #861).

## Что делаем

Для каждого — причина, потом правка причины. Правило владельца: таймаут или порог одного test-а не
подбирать. Если test честно требует больше времени — один общий множитель, цена называется заранее.

1. Повторить каждый test под той же нагрузкой, что в полном прогоне (`pnpm test` целиком или файл вместе с
   параллельными соседями), и в тишине; записать, сколько раз из скольких красный.
2. Временные границы (`harness-evals-outcome`): мерить время своей работы, а не время стены,
   если test проверяет скорость кода, а не машины.
3. Занятые файлы и живые процессы (`terminal.test.ts`, `projects-connect`): найти,
   кто держит файл или процесс, и ждать его завершения в коде, а не по времени.
4. Клики e2e (`epic-frame-undo`): снимок и трассировка при падении — что перекрывает кнопку.

## Готово, когда

- [ ] Для каждого test-а в «Итог» — сколько раз красный до правки, причина, правка.
- [ ] На ПК полный `pnpm test` — код 0 в 2 прогонах подряд; e2e `epic-frame-undo.spec.ts` и
      `projects-connect.spec.ts` с `--repeat-each 3` — код 0; `wave-gate-lock.test.sh` 3 раза подряд — код 0.
- [ ] Полный прогон GitHub Windows runner-а (`windows-tests.yml`, режим `full`) на main после правки — зелёный.

## Где в коде

- `test/e2e/epic-frame-undo.spec.ts:125`, `:163`; `test/e2e/projects-connect.spec.ts:217`;
  `test/e2e/helpers.ts:276-278`.
- `test/contract/shell.test.ts:293`; `test/contract/terminal.test.ts` (`:183-185` и случаи, добавленные
  2026-10-28).
- `harness/bin/tests/wave-gate-lock.test.sh` (случаи токена замка e2e).

## Итог, часть 1 (2026-10-29, ПК; Ticket остаётся open — остаток в «Не сделано»)

Данные — три gate full на ПК по ADR-0086 на main 2026-10-29: `755ce722`, `b2b30e07`, `0be09773`
(GATE_SCOPE=all, vitest с 15 worker-ами по умолчанию). Каждый красный test повторён в одиночку на том же SHA.

Quarantine win32 до 2026-11-12, владелец `worfy-polish 41` — test-ы, красные хотя бы в двух из трёх прогонов.
В одиночку каждый раз зелёный (код 0). Причина, кроме нагрузки полного прогона, не найдена. Таймауты не
менялись: правило владельца, решение о множителе — у владельца. Строки — на main d829ab9c; в логах
gate full они выше (ci-workflow — на 109 строк).
- `test/contract/ci-workflow.test.ts:1187` — красный 3 из 3, «Test timed out in 45000ms».
- `test/contract/shell.test.ts:482`, случай win32 — красный 3 из 3: timeout 45 s, затем «EBUSY … rmdir». Случай
  linux падает следом: случай win32 после своего timeout ещё работает с подменённой платформой.
- `test/contract/harness-evals-outcome.test.ts:1710` — красный 2 из 3, timeout 60 s.
- `test/contract/harness-migrate.test.ts:478` — красный 2 из 3, timeout 45 s.

Без quarantine, хоть и красный 2 из 3: `test/contract/harness-evals.test.ts:259` (случай
`reviewer-intended-breakage`, timeout 45 s). Время уходит на сборку fixture случая, а fixture строит первый
test, который её попросит (`builtFixture`, кэш по имени случая). Если пропустить этот test, сборку возьмёт на
себя `reviewer-intended-breakage is the diff the case describes` (`:681`) с тем же пределом 45 s. Это нарушает
правило `test/quarantine.ts`: в quarantine идёт только test, чья ошибка — его собственная. На gate full `00daddd0`
так же покраснел случай `reviewer-simplification`.

Красные один раз — без quarantine, только здесь:
- `755ce722`: `test/contract/docs.test.ts:467` (случай active); e2e `projects-connect.spec.ts:217` и
  `session-two-windows.spec.ts:183` — «the app did not quit within 20 s and was killed».
- `b2b30e07`: `harness-evals-outcome.test.ts:1670`, `harness-scripts.test.ts:433` (`guard-silent.test.sh`:
  `bin/silent-check` не уложился в 0.5 s и 0.4 s), `projects-connect.test.ts:1345` (timeout 45 s),
  `terminal-ai-suggest.test.ts:443` (ветка git прочиталась как `null`).
- `0be09773`: `terminal-windows.test.ts:160` (3123 ms при границе 3000), `workflow-reader.test.ts:825` (1517 ms при
  границе 1500), `affected-tests.test.ts:215` и `:355` (timeout 15 s), e2e `quiet-windows.spec.ts:75` («Target
  page, context or browser has been closed»).

Test-ы из списка выше:
- `epic-frame-undo.spec.ts:125` — 5 из 5 зелёный при масштабе 100 %. Красный 2026-10-23 был при 150 %, а
  масштаб экрана ПК менять нельзя. Не воспроизведён.
- `projects-connect.spec.ts:217` — красный 1 из 44 run-ов до трёх gate full и 1 из 3 gate full. Причина
  зависания выхода не найдена. Последняя строка вывода приложения — «Debugger ending on ws://…»: связь
  Playwright закрыта, а процесс Electron жив до kill на 20 s. Правка этого PR — диагностика:
  `test/e2e/quit-diagnosis.ts` и `helpers.ts` (`processesOf`). При зависании выхода на Windows лог test-а
  называет процесс приложения и его потомков (pid, родитель, число потоков, имя, командная строка). Процесс
  старше своего записанного родителя потомком не считается: Windows отдаёт освободившийся pid заново. Проверено
  unit test-ом на настоящем дочернем процессе; mutant без обхода потомков — красный. Следующее зависание
  покажет, что ещё живо.
- `terminal.test.ts:185` — не повторился ни в тихих прогонах, ни в трёх gate full.
- `wave-gate-lock.test.sh` — 3 из 3 зелёный (27/27 каждый раз).
- `shell.test.ts:293` (darwin) — теперь на `:481`, на ПК краснеет случай win32 (в quarantine выше).

Четвёртый gate full на ПК, main `00daddd0` (2026-10-29): lint, typecheck, e2e, package — код 0; vitest — код 1,
19 красных, каждый в одиночку на том же SHA зелёный. Впервые красные: `autopilot-limits.test.ts:643`, `:681`, `:700`,
`e3-sandbox.test.ts:1300`, `harness-migrate.test.ts:448` и `:459`, `harness-evals.test.ts` случай
`reviewer-simplification`, `workflow-reader.test.ts:994`. Второй раз красные: `docs.test.ts:467`,
`harness-evals-outcome.test.ts:1670`, `harness-scripts.test.ts:433`, `projects-connect.test.ts:1349`,
`workflow-reader.test.ts:825`.

Попутно: `test/contract/harness-scripts.test.ts` занимает 1367 s из 1542 s vitest (`b2b30e07`), последние ~13
мин идёт один. Это `worfy-throughput` 56; данные — `C:/Users/Alexey/worfy-wt/evidence/throughput-56/` на ПК.

Не сделано — часть 2, в этом же Ticket-е (правило владельца 2026-10-23: flaky Windows — один Ticket
`worfy-polish`):
- Test-ы, красные по одному разу: `docs.test.ts:467`, e2e `projects-connect.spec.ts:217` и
  `session-two-windows.spec.ts:183`, и красные из прогонов `b2b30e07` и `0be09773` (список выше). Если test
  краснеет повторно — запись quarantine или правка причины. Красные второй раз и новые — из gate full
  `00daddd0` выше.
- `harness-evals.test.ts:259`: сборку fixture случаев вынести из test-а, чья ошибка тогда станет его собственной,
  либо ускорить саму сборку под нагрузкой.
- Причина зависания выхода приложения на Windows: найти по дереву процессов из диагностики этого PR и
  поправить. Решение владельца 2026-10-29: если причина не найдена, test-ы выхода приложения на Windows
  не запускаются.
- Пункты 2 и 3 «Готово, когда»: полный `pnpm test` на ПК — код 0 два раза подряд (планка приёмки Windows —
  полностью зелёный gate full), прогон GitHub Windows runner-а после merge.

## Итог, часть 2 (2026-10-30, ПК)

Восемь test-ов: шесть из списка Моста 2026-10-29 и два новых из gate full на main `e6802c9e` (2026-10-30,
VITEST_MAX_WORKERS=8; красные там: `browser-family.spec.ts:155`, `affected-tests.test.ts:261`,
`workflow-branches-gone.test.ts:70`, `wheel-over-nodes.spec.ts:216`; каждый в одиночку на том же SHA зелёный).
Счёт «до правки» — по восьми gate full на ПК в `C:/Users/Alexey/worfy-wt/evidence/throughput-56/`. Лимит ни одного
test-а не поднят, продуктовые пороги не менялись; у `harness-evals` бюджет 45 s поделён между hook-ом сборки и
проверками, сумма не изменилась. Улики этой части — `C:/Users/Alexey/worfy-wt/evidence/polish41-part2/` на ПК.

- **`browser-family.spec.ts:155`** — красный 1 раз в 8 gate full (`e6802c9e`); на #975 — 2 из 19 run-ов.
  - Причина: `openSecondWindow` (`test/e2e/helpers.ts`) брал следующую страницу приложения, какой бы она ни была.
    Страница `<webview>` Browser-а приходит в Playwright тоже как окно: в trace падения expect шёл на странице
    `about:blank` 638×410.
  - Правка: helper ищет страницу, которой не было до вызова и у которой URL приложения.
  - Test `two-windows.spec.ts` «openSecondWindow gives the window it opened…»: скрытое окно открывается в первом
    вызове helper-а в main, раньше второго. На старом helper-е красный 6 из 6, на новом зелёный.
  - После правки: `browser-family.spec.ts` ×10 — 20/20; все 18 spec-файлов с `openSecondWindow` — 72 passed,
    1 skipped, 1 failed. Красный — `terminal.spec.ts:697 @packaged`, ему нужна сборка `dist\win-unpacked`,
    которой в worktree нет; к правке не относится.
- **`affected-tests.test.ts`** — красные в 4 из 8 gate full, каждый раз другой test: `:215`, `:355` (3 раза),
  `:261`. Timeout 15 s.
  - Причина: test-ы с 2–4 сценариями подряд. Сценарий — ветка (4 git) и прогон скрипта (2 git + node, внутри
    ещё 5 git). Выходило 14–24 запуска процессов на test, и под нагрузкой их время росло втрое.
  - Правка: по одному сценарию на test (37 → 50 test-ов) и без лишних `git checkout`. Запусков на test стало
    4–5. Самый долгий test под той же нагрузкой: 17,9 → 6,6 s.
  - Ни один сценарий не пропал. Строк `expect(` — 94 до и после, вызовов скрипта — 42 до и после. Три случая
    отказа с `--github-output`, раньше цикл в одном test-е, стали тремя test-ами с общим helper-ом.
  - Запись quarantine `affected-tests-github-output` (darwin) не тронута, но держит теперь один test из четырёх:
    три сценария отказа с `--github-output` стали отдельными test-ами вне quarantine и на macOS снова
    запускаются. Оркестратор решит по данным Mac после merge.
    Четыре записи `affected-tests-repo-*` — другая причина (`beforeAll` с `generate(REPO)`), остаются.
- **`guard-silent.test.sh`** (`harness-scripts`, «timeout twice») — красный 2 раза (`00daddd0`, `b2b30e07`).
  - Причина: `guard.mjs` даёт двум попыткам общий бюджет в две попытки, вторая получает остаток. Под нагрузкой
    остаток 0,4 s, а test ждал ровно 0,5 s.
  - Правка — в test-е: в «timeout twice» первая попытка 0,5 s, вторая — остаток 0,0–0,5 s. Остаток там почти
    всегда 0,5 s, поэтому общий бюджет проверяет новый случай «two checks, the first takes 0.3 s»: первая из
    двух проверок отвечает через 0,3 s, попытки второй вместе — не больше остатка 0,7 s (0,8 s с округлением).
    Код `guard.mjs` не менялся.
  - Опыт, проверка не стала пустой (`guard.mjs` менялся только локально):
    - полный бюджет каждой попытке — файл красный на «two checks, one budget» (silent-check 4 раза вместо 3,
      10,9 s при границе 7,5 s);
    - вторая попытка длиннее первой — красный;
    - одна попытка — красный;
    - без изменений — зелёный.
- **`terminal-ai-next-command.test.ts:215`** (`bd732aa4`) и **`terminal-ai-suggest.test.ts:443`** (`b2b30e07`) —
  по 1 разу, `branch: null` вместо ветки.
  - Причина: `gitBranch` ждёт `git branch --show-current` 1 s, под нагрузкой git дольше, и запрос уходит без
    ветки.
  - Правка: в этих двух файлах ветку test-а отдаёт `branchOf` без git.
  - `gitBranch` проверяется в `terminal-ai-assist.test.ts`: настоящий git со временем продукта 1 s, умноженным на
    общий множитель (`ms(GIT_BRANCH_TIMEOUT_MS)`). Новый test: медленный
    git (node с файлом `branch`, отвечает через 10 s) при времени 200 ms даёт `null`. С временем 30 s тот же test
    получает «late» и красный — значит, проверяет время, а не ошибку запуска.
  - Связь сервиса с `gitBranch` по умолчанию проверяет test «a service built without branchOf…»: `AssistService`
    без `branchOf`, первый git в PATH — node под именем git, в запросе ветка, которую он напечатал.
  - Продуктовое, без Ticket-а (решение Моста): на занятой Windows Haiku и Sonnet получают запрос без ветки, без
    пометки и без повтора — так по замыслу `git-branch.ts`. Сколько ждать ветку — вопрос владельцу в утреннем
    отчёте.
- **`workflow-reader.test.ts:827` и `:994`** (обещание «≤ 1,5 с после сохранения файла») — красный 4 раза
  (`00daddd0` дважды, `0be09773`, `e72ddded`), 1517–2107 ms.
  - Замер по стадиям, от записи файла, 15 раз тихо и 40 раз под нагрузкой (shell-test-ы Harness параллельно):
    - тихо — всего ≈480 ms: старт epic-status через ≈310 ms (событие файла и debounce 300 ms), epic-status
      ≈100 ms, `git worktree list` и чтения ≈75 ms;
    - под нагрузкой — медиана 1109 ms, 12 из 40 больше 1500, максимум 3323 ms;
    - старт стабилен (≈310 ms), растут два процесса: epic-status 1,2–2,8 s, `git worktree list` до 1,5 s.
  - **На занятой машине продукт обещание не держит.** Оба процесса запускаются и в приложении.
  - Правка — подтверждено владельцем 2026-10-30 (вариант Моста, принят Оркестратором):
    - граница 1500 ms применяется ко времени от записи до delta без времени дочерних процессов: `vi.mock` модуля
      `node:child_process` засекает `execFile` и `spawn` от вызова до конца процесса. Код worfy вокруг них
      (окружение, поиск Harness, разбор вывода) входит в 1500 ms;
    - сообщение падения называет стадии.
  - Опыт, проверка не пустая: debounce и maxWait 2000 ms (локально в `watch.ts`) — оба test-а красные:
    «3405 ms from the save to the delta, 1376 ms of it outside: epic-status 2009–3222 ms, git worktree list
    3232–3395 ms». Один debounce 2000 ms при maxWait 1000 ms test-ы не роняет: read запускается по maxWait.
  - Продуктовая правка (epic-status без отдельного процесса, без `git worktree list` на каждое изменение) —
    вопрос владельцу, не здесь.
- **`wheel-over-nodes.spec.ts:216`** — красный 1 раз в 8 gate full (`e6802c9e`): верхняя строка терминала 183
  вместо 181.
  - Причина доказана опытом: test читал верхнюю строку, когда `seq 1 200` уже вывел «200», а prompt Git Bash ещё
    нет. Prompt из пустой строки, строки пути и `$` сдвигает строки на две.
  - Опыт: prompt задержан на 1–8 s (`PROMPT_COMMAND='sleep N'`). С задержкой от 2 s test читает 181 при строках
    «198 | 199 | 200 | (пусто)». Без задержки — 183 при строках «200 | (пусто) | путь | $». Это ровно два
    значения падения. Между чтением и проверкой ≈140 ms, поэтому красный редок.
  - Правка: test ждёт prompt под строкой «200» и только потом читает верхнюю. С задержкой prompt 3 и 6 s —
    зелёный, читает 183.
- **`workflow-branches-gone.test.ts:70`** — красный 1 раз в 8 gate full (`e6802c9e`): EBUSY на `rmdir` папки
  `repo` в уборке test-а.
  - Причина доказана: папку держит `git worktree list --porcelain`, который запустил сам watcher, с рабочей
    папкой `repo`. Windows не удаляет папку, в которой работает живой процесс. В падении пробник записал этот
    git живым до и после удаления, ему было 774 ms. Повтор: 1 из 16 run-ов.
  - Опыт в отдельных скриптах: handle `fs.watch` на `repo`, `.git`, `refs\heads` даёт ENOTEMPTY, не EBUSY.
    Значит, chokidar не держит.
  - Правка — в test-е: перед удалением репозитория ждать `watcher.idle()`, конца чтения, которое запустил новый
    worktree. `src/main/storage/remove.ts` не менялся. После правки 10 из 10 зелёный.
  - Продуктовое наблюдение без Ticket-а: git, запущенный с рабочей папкой в репозитории пользователя, на время
    своей работы не даёт удалить эту папку.
- **`harness-evals.test.ts:240`** (случаи `reviewer-simplification` и `reviewer-intended-breakage`, сборка fixture)
  — красный 5 раз в 8 gate full (`00daddd0`, `b2b30e07`, `bd732aa4`, `e72ddded`, `ed23c176`): «Test timed out in
  45000ms», под нагрузкой сборка шла 53–78 s.
  - Почему дольше 45 s — измерено по шагам `scaffold.sh` (тихо → под нагрузкой). Ничего не ждёт: ни stub, ни
    sleep, ни замок, ни сеть. Сборка — около 80 запусков процессов, и под нагрузкой каждый запуск дорожает в
    2–3 раза:
    - 33 запуска мелких утилит Git Bash (20 из них — `cat` в файл): 3,2–4,1 → 7,8–11,9 s, по 100 → 240–360 ms;
    - 9 вызовов git в репозитории: 1,5–1,8 → 2,8–4,0 s;
    - push и fetch в локальный bare origin: 3,6–4,5 → 4,8–7,4 s;
    - 3 запуска node: 0,45 → 1,0–4,1 s.
  - Правка причины — меньше запусков: около 80 → около 47.
    - Запись файлов и замена текста — функциями bash, а не `cat` и `sed -i` с `rm`.
    - `git maintenance run --auto` выключен через окружение; его было 7 запусков без дела.
    - Путь папки скрипта режется в bash, а не через `dirname` и `cd … && pwd -P`.
    - Файлы: `harness/evals/lib/demo-project.sh`, `harness/evals/reviewer-*/scaffold.sh`.
  - Fixture тот же: все файлы, ref-ы fixture и его origin, `git log --all`, `git status`, `git ls-files -s`
    совпадают со старой сборкой. Отличаются только stat-данные `.git/index`, как и между двумя старыми сборками.
  - Сборка под нагрузкой (два прогона shell-test-ов Harness параллельно): 28,7–41,0 → 17,6–25,9 s.
  - Сборка вынесена в `beforeAll` случая. Бюджет 45 s поделён между hook-ом сборки и проверками, сумма не
    изменилась: hook `ms(10_000)`, test `ms(5_000)`, вместе `ms(15_000)`, как было у одного test-а.
    Оркестратор отклонил вариант с пределом самой сборки (180 s) по правилу владельца. Сборка дольше своей части
    роняет hook под своим именем. Test «builds its fixture with exit code 0» проверяет результат, который записал
    hook. Доли выбраны по замерам: сборка под нагрузкой 17,6–25,9 s (часть hook-а 30 s), проверки тихо 0,5–2,4 s (часть test-а 15 s).
  - Gate full на `55f37b62` (8 worker-ов): `harness-evals.test.ts` зелёный, файл 250,7 s. Время сборки gate не пишет,
    поэтому hook теперь печатает его в лог.
  - На macOS не проверено: функции bash рассчитаны на `read -d ''` и `$'\n'` в `${var//…}` у bash 3.2.
    Проверит CI.

Review (две линзы: корректность и test-ы), что исправлено:
- `swap()` в двух `scaffold.sh` писал строки с кавычками в bash 3.2 (macOS; проверено режимом `BASH_COMPAT=3.2`
  в bash 5.2). Теперь строки меняются циклом по строкам, без `${text//…}`. Одинаково в режимах 5.2, 4.2 и 3.2,
  и с `&`, кавычками и `$` в тексте.
- `workflow-reader`: вычитание не прячет лишние запуски. Test-ы ограничивают число внешних запусков после
  сохранения: `:827` — не больше 2, `:994` — не больше 3.
- `guard-silent`: вторая попытка короче 50 ms печатается как «0 s», это тоже принимается.
- Подставное окно в `two-windows.spec.ts` открывается только на вызове из helper-а, не из кода приложения
  (рассылка событий тоже зовёт `getAllWindows`). На старом helper-е test по-прежнему красный 3 из 3.
- `gitBranch` в `terminal-ai-assist.test.ts`: время git идёт через `ms()`, а у test-а медленного git есть и
  нижняя граница (не меньше 150 ms).

Не исправлено, записано: причина в `test/quarantine/affected-tests-github-output.json` устарела, test теперь
запускает скрипт один раз. Запись не тронута по решению Оркестратора; он проверит её по данным Mac после merge.

Не сделано — остаток списка части 2 выше, вне восьми test-ов этой части:
- красные по одному разу: `docs.test.ts:467`, e2e `projects-connect.spec.ts:217` и `session-two-windows.spec.ts:183`;
- причина зависания выхода приложения на Windows;
- приёмка: полный `pnpm test` на ПК с кодом 0 два раза подряд и прогон GitHub Windows runner-а после merge.

## Review, раунд 1 (Mac, 2026-10-30), что исправлено

Gate full на `55f37b62` (8 worker-ов): код 2, три красных.
- `script-node.test.ts:78` — моя ошибка. Новый test медленного git брал `process.execPath`, под `pnpm test` это
  Electron. Теперь `NODE` из `test/harness-node.ts`. В одиночку тоже красный.
- `guard-silent.test.sh`, «two checks, one budget»: 7533 ms при границе 7500. Тот же красный был на main:
  `e72ddded` — 7624 ms, `ffcb8ede` — 7690 ms. Всего 3 gate на 8 worker-ах.
  - Причина доказана замером: 10 прогонов под нагрузкой (harness-scripts-1..3 параллельно).
    - Hook отвечает всегда через 5810–6341 ms от первого запуска stand-in-а: бюджет 6 s держится.
    - Лишнее время — после ответа: выход node hook-а до +1224 ms, запуск `jq` в test-е до +1323 ms.
    - Итог до 7998 ms, 3 из 10 больше 7500. Тихо: ответ через 5987–5995 ms, всё вместе 6260–6496 ms.
  - Правка — в test-е: конец замера — момент, когда начался ответ hook-а (`guard_timed`), а не после его выхода и
    `jq`. Граница 7500 не менялась. После правки: 5958 ms.
- e2e `linked-browser.spec.ts:90` («what A typed reached B's page»: пусто вместо «hello») — красный 1 раз.
  - В одиночку зелёный (8,3 s). Spec не использует ничего, что менялось в этой части.
  - Смотрим на следующем gate.

Пять пунктов review. У каждой правки свой красный mutant; продуктовый файл менялся локально и возвращён через git.
1. guard-silent, общий бюджет: новый случай «two checks, the first takes 0.3 s».
   - Mutant `const t = SILENT_TRY_MS` (каждой попытке полное время) — код 1, красный только новый случай.
     «two checks, one budget» этот mutant не ловит: 6294 ms.
   - Mutant «у каждой проверки свой бюджет» (`left = 2 * SILENT_TRY_MS`) — код 1: 9136 ms, 4 вызова.
   - Без mutant-а — код 0, 104 passed.
   - Первый вариант («linger»: внук держит вывод открытым) не сработал. На Windows неизменённый guard печатал 0,5 s,
     случай заменён.
2. `gitBranch` в `terminal-ai-assist.test.ts`: время git — `ms(GIT_BRANCH_TIMEOUT_MS)` (1 s продукта на общий
   множитель) вместо `ms(10_000)`. Mutant аргументов git — код 1, красный «reads the branch…».
3. Связь `branchOf` по умолчанию: test «a service built without branchOf…».
   - git через PATH — node под именем git.
   - Модуль `git-branch` в этом файле обёрнут: время по умолчанию — `ms()` от 1 s продукта.
   - Mutant `branchOf ?? (async () => null)` — код 1, красный новый test.
4. `workflow-reader`: вычитается только время дочерних процессов; `vi.mock('node:child_process')` засекает
   `execFile` и `spawn`.
   - Mutant +1600 ms кода worfy после `env()` — код 1, оба test-а 1,5 s красные: «2091 ms from the save to the
     delta, 156 ms of it outside».
   - Без mutant-а — код 0, 60 passed.
5. `harness-evals`: бюджет 45 s поделён между hook-ом сборки и проверками, сумма не изменилась.
   - Hook — `ms(10_000)`, test — `ms(5_000)`. Hook печатает время сборки в лог.
   - Тихо: сборка 1,4–5,5 s, проверки 0,5–2,4 s.
   - Mutant `sleep 31` в `scaffold.sh` — код 1, «Hook timed out in 30000ms».

lint и typecheck — код 0.
