# 69 — Flaky test-ы CI, вторая партия

Type: bug
Status: done 2026-11-08T03:13Z
PR: #1629
Blocked by: —
Source: таблица flaky test-ов worfy-polish 66 (PR #1617)

## Что происходит

Ticket `worfy-polish` 66 (PR #1617) собрал flaky test-ы CI за 2026-11-01…11-07 и исправил пять причин. Остальные
он назвал и оставил:

- `harness/bin/tests/wave-brief.test.sh` и `test/contract/harness-migrate-boundaries.test.ts:32` — краснели под
  обёрткой `git`, которая держит `.git/objects/maintenance.lock` после merge и commit. Новый git (2.56 на runner-ах)
  после merge и commit запускает `git maintenance run --auto --detach`, и lock появляется и пропадает, пока test
  сравнивает файлы репозитория. 66 закрыл это в git helper-ах vitest (`maintenance.auto=false`), а helper-ы Harness —
  нет.
- `harness/bin/tests/wave-gate-heartbeat.test.sh` (macOS 4, Windows 3) и `wave-gate-lock.test.sh` (Windows 6), оба
  через `test/contract/harness-scripts-1.test.ts`.
- Красные под нагрузкой на Mac владельца: `test/unit/search-index.test.ts:282` (предел 100 ms по часам, было 112 ms),
  `test/unit/getting-started-panel.test.tsx:141`, `:158` (timeout 15 s), `test/contract/projects-connect.test.ts:876`,
  `test/contract/harness-hook-stdin.test.ts:345`, `test/contract/app-orchestrators.test.ts:126`.
- Причина не найдена: `test/contract/e3-sandbox.test.ts:1114` (Linux 8), `test/e2e/autopilot-faults.spec.ts:36`
  (Windows 17: `journals()` пуст после kill), `test/contract/cards-watch-edits.test.ts:91` (macOS, FSEvents).

## Что делаем

1. Тот же приём, что в 66 (`maintenance.auto=false`), — в git helper-ах test-ов Harness. `harness/` остаётся
   английским и без номеров Ticket-ов worfy (`plugin-neutral.test.sh`).
2. Найти гонку в `wave-gate-heartbeat.test.sh` и `wave-gate-lock.test.sh`.
3. Test-ы под нагрузкой: лечить причину. Проверка производительности по часам в unit test-е — сама дефект: мерить
   детерминированное (число операций) или вынести, а не поднимать предел.
4. `e3-sandbox`, `autopilot-faults.spec.ts:36`, `cards-watch-edits` — разобрать, исправить, если причина найдена.

Для каждого — сначала воспроизвести (задержка, нагрузка CPU, параллельные копии, обёртка), счёт до и после и exit
code. Что не воспроизвелось или не исправилось — в «Итог». Timeout-ы не подстраивать, новых записей карантина не
заводить, файлы открытых PR не трогать.

Глубина review — `medium`. Не платформенный: правка только в test-ах и helper-ах test-ов.

## Готово, когда

- [ ] Каждый исправленный test воспроизведён до правки и проходит после неё: счёт до и после в «Итог».
  - evidence: test-run pass · `pnpm test <the test with the injected delay, slow touch or ps, or the git wrapper>` before red, after exit 0 (counts in Итог) · mac - · 71d13cb13a886e35dce03936712ece818adc9b47
- [ ] Исправленные test-ы — 20 прогонов подряд зелёные; все unit и contract test-ы затронутых модулей, затронутые
      shell test-ы Harness, `plugin-neutral.test.sh`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate fast — exit 0.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0; 20-run loops 20 of 20 (vitest files, wave-gate-heartbeat.test.sh, wave-brief.test.sh); plugin-neutral.test.sh exit 0 · mac - · 71d13cb13a886e35dce03936712ece818adc9b47
  - evidence: gate pass · `gate fast` exit 0 · mac - · 71d13cb13a886e35dce03936712ece818adc9b47
- [ ] Не исправленные — в «Итог», с причиной или с тем, почему её не нашли.
  - evidence: commit pass · Fix eight causes of flaky tests: git maintenance lock, heartbeat races, wall-clock limits (polish 69) · - - · 71d13cb13a886e35dce03936712ece818adc9b47
- [ ] `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42433584107/job/128589817780 · ci - · 3212e52f09b1dde1d54e4c642896224692aba8ca

## Где в коде

- `test/git-env.ts` (новый, `NO_GIT_MAINTENANCE`), `tsconfig.test.node.json` — git без auto maintenance для окружений,
  которые test собирает с нуля.
- `test/harness-scripts-suite.ts` (`emptyHomeEnv`) — окружение всех shell test-ов Harness (`wave-brief.test.sh` и
  остальные); `test/contract/harness-migrate-harness.ts` (`describeSandbox`) — sandbox `harness-migrate-*.test.ts`.
- `test/unit/auto-approve-run.test.ts:25` — git helper, `-c maintenance.auto=false`.
- `harness/bin/tests/wave-gate-heartbeat.test.sh` — `step_done` вместо паузы 0.5 s; счёт проходов trap-а вместо
  предела 1.2 s.
- `test/unit/search-index.test.ts` — счёт прочитанных символов вместо предела 100 ms.
- `test/unit/getting-started-panel.test.tsx:27-32` — модули грузятся при сборе файла.
- `test/contract/projects-connect.test.ts:715`, `:763` — файл pid приходит переименованием.
- `test/contract/app-orchestrators.test.ts` — ожидание fake Codex app-server до предела самого test-а.
- `test/unit/platform-entry.test.tsx` — test размонтирует app, которое запустил (timer `ToastRegion.tsx:133`).
- Только чтение: `test/contract/e3-sandbox.test.ts:1114`, `scripts/e3-sandbox.sh:376-424`, `test/e2e/autopilot-faults.spec.ts:36`,
  `test/contract/harness-hook-stdin.test.ts:345`, `test/contract/cards-watch-edits.test.ts:91`, `harness/bin/tests/wave-gate-lock.test.sh`,
  `src/main/agent/auto-approve/run-approval.ts:14`.

## Итог

Исправлено восемь причин, все в test-ах; код приложения не тронут. Каждая воспроизведена до правки, счёт — до и после.

1. **`maintenance.lock` в test-ах Harness** (`wave-brief.test.sh`, `harness-migrate-boundaries.test.ts:20`, `:32`). Тот же
   приём, что в 66: `maintenance.auto=false`, но через окружение (`GIT_CONFIG_COUNT`, `test/git-env.ts`), потому что
   git здесь запускают сами скрипты Harness и код переезда, а не helper test-а. Добавлено в два окружения, которые
   собираются с нуля: `emptyHomeEnv` (все shell test-ы Harness) и `describeSandbox` (sandbox переезда). Обёртка `git`
   (после commit и merge держит lock 0.3 s, молчит при `maintenance.auto=false`, как git): до правки
   `wave-brief` 3 из 3 красные (`FAIL read-only: something was written`), `harness-migrate-boundaries` 3 из 3 красные;
   после — 3 из 3 и 3 из 3 зелёные; `wave-brief` 20 из 20 под обёрткой. `harness/` не тронут.
   Общий `GIT_CONFIG_COUNT` для всех test-ов (через `test.env` vitest) попробован и отброшен: политика Auto-approval
   читает `GIT_CONFIG_COUNT` в окружении shell как настройку git, которую не может оценить
   (`src/main/agent/auto-approve/run-approval.ts:14`), и 15 её test-ов поменяли ответ.
2. **Тот же lock, `auto-approve-run.test.ts`** — найден прогоном всего `pnpm test` под обёрткой, которая держит lock
   3 s: единственный красный файл, удаление scratch-папки встречало lock (`ENOTEMPTY`). `-c maintenance.auto=false` в
   helper-е (в командной строке: окружение меняет ответ политики). До — 9 и 10 красных из 81, после — 0 и 0.
   Прочие файлы весь прогон с lock-ом 3 s прошли.
3. **`wave-gate-heartbeat.test.sh`, гонка с чужим `holder.json`.** После записи чужого `holder.json` test ждал 0.5 s и
   ставил старый mtime; шаг heartbeat-а, который прочёл старый `holder.json` раньше и задержался, делал `touch` позже
   и считался касанием чужого lock-а. Теперь test ждёт, пока heartbeat начнёт следующий `sleep` (`step_done`), — значит,
   шаг со старым файлом закончен. Воспроизведение: `touch` heartbeat-а на 1.5 s позже и test на 0.3 s позже после
   первого касания — до правки 6 из 6 (3 run-а × bash, zsh) красные, после — 6 из 6 зелёные.
4. **`wave-gate-heartbeat.test.sh`, предел 1.2 s на trap.** Test мерил часами время от конца gate до конца блока.
   Теперь `sleep`, первый в PATH, записывает паузы trap-а, и test считает проходы: trap кончает на трёх пустых
   проходах (3), а не на своих 40. Воспроизведение: каждый `ps` блока на 0.3 s медленнее — до правки 6 из 6 красные
   (1601–1702 ms), после 6 из 6 зелёные (3 прохода, ~1.75 s). Mutant: цикл без условия трёх пустых проходов — 40
   проходов, красный. Файл — 20 из 20 зелёных (по 5 копий параллельно).
5. **`search-index.test.ts:282`, предел 100 ms.** Проверка по часам заменена счётом работы: на каждый символ запрос
   читает каждый документ не больше одного раза, не переводит в нижний регистр ни одного документа, а выросший запрос
   читает только документы, совпавшие раньше (spy на `String.prototype.indexOf` и `toLowerCase`). Красным старый test
   у меня не стал: под нагрузкой 72 процессов — 33 ms из 100. Mutant-ы нового test-а — 3 из 3 красные: без сужения
   выросшего запроса, с `toLowerCase` документа в поиске, с лишним проходом по тексту.
6. **`getting-started-panel.test.tsx:141`, `:158` (timeout 15 s).** Первый test после `vi.resetModules` переводил всё
   дерево Sidebar внутри своего предела: 14 235 ms из 15 000 во время параллельного полного прогона. Теперь модули
   грузятся при сборе файла (там предела нет), test — 1 072 ms при той же нагрузке. Красным до правки не стал.
7. **`projects-connect.test.ts:876`** (и `:785`, `:819` с той же заглушкой). Внук писал файл pid на месте: файл
   есть, но пуст, test читал pid 0 и `grandchildRunning(0)` — `false`. Теперь файл приходит переименованием.
   Воспроизведение: пауза 0.3 s между созданием файла и текстом — до правки 3 из 3 красные (`expected false to be
   true`), после — 3 из 3 зелёные.
8. **`app-orchestrators.test.ts:126`** (и `:140`). `vi.waitFor` без предела ждёт 1 s, вне множителя run-а, а fake
   Codex app-server — новый процесс node. Теперь ожидание до предела самого test-а (`ms(15_000)`), не дольше.
   Воспроизведение: старт fake app-server на 1.5 s позже (`NODE_OPTIONS=--require`) — до 3 из 3 красные (`expected +0
   to be 1`), после 3 из 3 зелёные.
9. **`platform-entry.test.tsx`** (просьба Orchestrator-а): app из `src/renderer/main.tsx` оставался смонтированным,
   timer `ToastRegion` (каждые 200 ms) срабатывал после конца окружения jsdom — «document is not defined». Test
   теперь размонтирует корни, которые сделал модуль. Воспроизведение: `document` убран на 0.6 s после test-а — до
   3 из 3 красные (3 unhandled error), после 3 из 3 зелёные.

Не исправлены:

- `harness-hook-stdin.test.ts:345`, `cards-watch-edits.test.ts:91`: не воспроизвелись — 2 run-а под нагрузкой 18
  процессов и 8 run-ов (4 копии × 2) под нагрузкой 54.
- `e3-sandbox.test.ts:1114` (Linux 8): не воспроизвёлся — 16 run-ов (8 копий × 2) под нагрузкой 36 процессов. Шаги
  test-а связаны файлами-маркерами, по часам — только предел 90 s на run; текста ошибки из CI нет.
- `autopilot-faults.spec.ts:36` (Windows 17): лог job-а 128339081079 (run 42351046268) — две ошибки одной попытки:
  `ENOENT … playwright-artifacts-…\<hash>.trace` при `close()` после kill и пустой `journals()`. Пропали и файл trace
  Playwright в temp, и journal Run-а, который `expect.poll` строкой выше видел; в коде app и helper-ах e2e удаления
  `autopilot/*.jsonl` нет. Причина не найдена; Windows e2e здесь не запустить.
- `wave-gate-lock.test.sh` (Windows 6): только Windows, лог с текстом ошибки не найден; не разбирался.
