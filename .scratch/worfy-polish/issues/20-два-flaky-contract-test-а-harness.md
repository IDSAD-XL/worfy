# 20 — Два flaky contract test-а: timeout в `harness-script-wiring`, ENOTEMPTY в `harness-drift`

Type: task
Status: done — 2026-10-16, [PR #372](https://github.com/IDSAD-XL/worfy/pull/372)
Blocked by: —
Source: решение владельца 2026-10-15 по Gate Ticket-ов worfy-polish (разделы «Gate оркестратора
(2026-10-15)»): [01](01-панель-выделения-не-закрывает-шапку-рамки-epic-а.md) — CI красный в
`test/contract/harness-drift.test.ts` (уборка временной папки, ENOTEMPTY; вне diff);
[02](02-контраст-цвета-8-и-suggestion-в-terminal.md) и
[10](10-палитра-ищет-в-транскриптах-session-ов-вне-worfy.md) — gate full красный по timeout-у 15 s
в `harness-script-wiring.test.ts` (вне diff); «Итог»
[03](03-contract-test-ы-без-настоящего-claude-home.md) — тот же timeout и «следом лишняя строка в
файле вызовов от прерванного test-а». Слово владельца: найти причину, timeout вслепую не поднимать.

## Что происходит

Оба test-а краснят gate и CI чужих PR. Повтор зелёный, но merge съезжает: main успевает уйти.

### 1. `harness-script-wiring.test.ts` — timeout 15 s

- Test «the layout cache and the workflow read ask the source on each read»
  (`test/contract/harness-script-wiring.test.ts:357-371`). Предел — `testTimeout: 15_000`
  (`vitest.config.ts:68`).
- Падал под нагрузкой: gate full Ticket-ов 02 и 10 (load average до 23), прогоны Ticket-а 03 (load
  average 7–27). Отдельно файл зелёный: 21 из 21 (Ticket 03), 45/45 и 21/21 (Gate 10).
- Test запускает настоящие процессы: `LayoutCache.get` — stub-скрипты `profile` и `ticket` (shell);
  `readWorkflow` (`src/main/workflow/reader.ts:424`) — ещё раз layout и `epic-status`. Корень —
  `scratch`, временная папка вне git.
- **Общее состояние протекает в следующий test** (проверено чтением кода). `calls`, `asked` и
  `source` — переменные `describe` (`:315-318`). `source` читает `calls` и `scratch` в момент вызова,
  а не при создании (`:324-327`). Если test прерван timeout-ом, его цепочка вызовов продолжается.
  Следующий `beforeEach` уже поставил новые `scratch` и `calls`, и stub старого test-а пишет строку в
  файл вызовов нового. Это и есть «лишняя строка» из «Итог» Ticket-а 03. Причину самого timeout-а
  это не объясняет.

### 2. `harness-drift.test.ts` — ENOTEMPTY при уборке

- `afterEach` удаляет временные папки test-ов (`test/contract/harness-drift.test.ts:15-17`) через
  `removeTestTree` (`test/remove.ts:16-18`). Вне Windows это `rmSync(path, { recursive: true, force:
  true })` без повторов (`src/main/storage/remove.ts:293-301`).
- ENOTEMPTY у `rmSync` значит: пока папку удаляли, в ней появился файл. Кто его пишет — неизвестно.
  Кандидаты, не проверены:
  - `git` из `checkHarnessDrift`, который ещё идёт после конца test-а (`execFile` с `timeout:
    GIT_TIMEOUT_MS` = 10 s, `src/main/autopilot/harness-drift.ts:39`, `:65`);
  - фоновая работа `git` после `commit` (auto gc, maintenance): helper `git` test-а не выключает её
    (`harness-drift.test.ts:27-29`);
  - `git`-обёртка `loggingGit`, которая пишет журнал вызовов в ту же временную папку (`:57-65`).
- Видели один раз, в Linux CI (первая попытка merge PR #348, Ticket 01).

## Что делаем

1. **Найти причину timeout-а** в `harness-script-wiring`. Под нагрузкой (`yes > /dev/null`, половина
   ядер) прогнать файл в цикле до первого красного и замерить время каждого шага test-а
   (`cache.get`, `readWorkflow`, каждый запуск stub-а). Записать в «Итог», куда ушли 15 s.
2. **Убрать протечку состояния.** Каждый test получает свои `calls`, `asked`, `source` (замыкание на
   значения своего `beforeEach`, а не на переменные `describe`). Test: прерванный test не пишет в
   файл вызовов следующего — мутант «`source` читает переменную `describe`» его краснит.
3. **Найти, кто пишет в папку `harness-drift`.** Первый шаг — лог упавшего job-а CI (PR #348):
   какой test и какой путь. Затем воспроизвести: под нагрузкой, в цикле, при необходимости с
   журналом процессов `git` (обёртка, которая пишет PID и время). Причина — в «Итог».
4. **Лечить причину.** Test ждёт конца всех своих процессов до уборки, или выключает фоновую работу
   `git` в своём helper-е (`-c gc.auto=0`, `-c maintenance.auto=false`), — по найденной причине.
   `maxRetries` в `removeTree` без найденной причины не добавлять.
5. **Timeout не поднимать вслепую.** Если после пунктов 1–2 test честно идёт дольше 15 s под
   нагрузкой — предел для этого test-а поднимается только с замером из пункта 1 и пометкой «решено
   без владельца, подтвердить».

## Готово, когда

- [ ] Причины обоих падений названы в «Итог» с доказательством: вывод прогона, в котором test
      красный до правки. Timeout — да. ENOTEMPTY — нет: причина не воспроизведена (0 красных), см.
      «Итог», пункт 2.
- [x] После правки под той же нагрузкой: `harness-script-wiring.test.ts` и `harness-drift.test.ts` —
      0 красных из N прогонов (N — не меньше числа прогонов до первого красного × 3); вывод в «Итог».
- [x] Test на протечку состояния (пункт 2) и его мутант — красный на мутанте.
- [x] `testTimeout` в `vitest.config.ts` и пределы в файлах не подняты (или подняты по пункту 5).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный. lint, typecheck, test и gate fast — exit 0 у
      исполнителя; gate full и merge — шаг оркестратора.

## Тесты

- `node scripts/vitest-electron.mjs --project contract <файл>` в цикле shell — под нагрузкой и без;
  у каждого прогона — код выхода.
- Нагрузка — только когда других агентов Wave нет: в Wave Ticket-ов 01–11 нагрузка одного Ticket-а
  краснила gate соседей (Gate Ticket-ов 04 и 05).

## Где в коде

- `test/contract/harness-script-wiring.test.ts`
- `test/contract/harness-drift.test.ts`
- `test/fixtures/harness-stub/answer`, `test/fixtures/harness-stub/gone` — новые, дописаны при работе
  (общие stub-скрипты Harness вместо копии на каждый test)

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `src/main/workflow/folder.ts`,
`src/main/workflow/reader.ts`, `src/main/autopilot/harness-drift.ts`, `src/main/storage/remove.ts`,
`test/remove.ts`, `vitest.config.ts`. Если причина в коде приложения — исполнитель дописывает файл в
«Где в коде» при claim.

## Вне скоупа

- Расписание gate параллельных исполнителей под нагрузкой — Harness (spec.md, «Не в этом Epic-е»).
- Другие test-ы с timeout-ом под нагрузкой (`workflow-reader.test.ts`, `github-prs.test.ts`,
  `docs.test.ts`) — только если причина та же; иначе — запись в «Итог» как кандидат.

## Итог

### 1. Timeout в `harness-script-wiring.test.ts` — причина найдена

**Куда ушли 15 s.** macOS проверяет каждый новый исполняемый файл при первом запуске (процесс
`XprotectService`; у файла есть `com.apple.provenance`). Проверка идёт по одному файлу на всю машину.
Test писал свои stub-скрипты `epic-status`, `profile`, `ticket` заново в каждом test-е, и каждый
первый запуск ждал очереди.

- Без нагрузки, один процесс: первый запуск нового скрипта — 142–278 ms, повторный — 6–8 ms.
  Hard link и symlink на уже проверенный файл — 3–4 ms; кэш общий для процессов.
- Очередь общая: 1 процесс — около 145 ms на новый файл, 4 процесса разом — 355–1120 ms,
  8 процессов — 329–2543 ms. Во время замера `XprotectService` — 26 % CPU.
- Под нагрузкой (9 процессов `yes`, половина ядер) один файл в цикле не краснеет: 15 из 15 зелёные,
  test 673–1243 ms. `yes` грузит CPU, а не эту очередь.
- Красный до правки: два прогона `--project contract` разом под `yes` (как два gate параллельно,
  load 16.5). Первый же прогон — красный в обоих запусках:
  `FAIL … what each run of a script gets > the layout cache and the workflow read ask the source on
  each read — Error: Test timed out in 15000ms.` Шаги этого test-а по замеру (копия test-а с
  журналом каждого `execFile`):

  ```
  step cache.get 1 start
  exec bin/profile 5214ms        (первый запуск нового файла)
  exec bin/ticket 5315ms         (первый запуск нового файла)
  step cache.get 1 10530ms
  step cache.get 3 14ms          (profile 7ms, ticket 7ms — повторные)
  step readWorkflow start
  exec bin/profile 6ms, exec bin/ticket 8ms
  exec bin/epic-status 5507ms    (первый запуск нового файла)
  step readWorkflow 5524ms       → итого ~16 s, предел 15 s
  ```

  Остальные test-ы блока в тех же прогонах: 1.5–11.6 s. Тот же шаблон (три первых запуска по
  2.5–2.6 s) — в одиночном прогоне `--project contract` под `yes`: test 7.8 s, зелёный.
- **Правка.** Stub-скрипты — два файла в репозитории: `test/fixtures/harness-stub/answer` (пишет в
  `$CALLS` и отвечает по имени, под которым запущен: `epic-status`, `profile`, `ticket`; путь Workflow
  folder — из `$WORKFLOW`; код выхода `profile` для test-а watcher-а — из `$PROFILE_EXIT_FILE`) и
  `gone` (старый Harness, который удаляет себя). Test-ы ставят на них symlink-и, новых исполняемых
  файлов не пишут. Файл проверяется один раз после checkout, дальше — из кэша.
- **После правки под той же нагрузкой** (два прогона `--project contract` разом под `yes`, load
  14.8–16.5), 3 серии, N = 1 × 3: 6 прогонов из 6 — exit 0, 0 красных в обоих файлах.
  Test «the layout cache…» — 75–90 ms (до правки 7–15 s). Самый долгий test блока — 292 ms (watcher
  с таймерами повторов). В прогоне до правки, где копия старого файла упала, исправленный файл шёл
  13–73 ms.
- `testTimeout` и пределы в файле не подняты.

**Протечка состояния (пункт 2).** Замер её подтвердил: после timeout-а цепочка прерванного test-а
шла дальше (`exec bin/epic-status 5274ms`, `exec bin/profile 5932ms` — уже после конца test-а, в
журнале того же процесса). Правка: `scriptRun(root)` даёт каждому test-у свои `claudeHome`, `calls`,
`asked()` и `source`; `source` замкнут на значения этого вызова, а не на переменные `describe`.
Test на протечку — пара соседних test-ов (узкий раунд по комментарию владельца в PR #372). Первый
«a test leaves its run behind» кладёт свой run и свою папку в `leftover`. Второй «the run a test left
behind still logs into that test's calls file…» идёт после настоящих hook-ов (новый `scratch`, новый
run), спрашивает `source` первого и проверяет: `CALLS` — файл вызовов первого, не второго; `HOME` —
папка первого. Запущенный один (`-t`), второй test красный (`expected undefined to be defined`), а не
зелёный впустую. Мутанты, каждый красный только во втором test-е (exit 1, 1 failed | 22 passed):
- A: переменная файла, которую ставит тело `beforeEach`, и `source` читает её;
- C: `source` берёт `HOME` и `CALLS` из общего `scratch`, который переписывает `beforeEach` файла
  (исходная ошибка);
- общая переменная, которую переписывает `scriptRun`.

### 2. ENOTEMPTY в `harness-drift.test.ts` — причина не воспроизведена

- **Лог CI (PR #348, run 38723033081, попытка 1).** Test «a repository without
  harness/.claude-plugin/plugin.json, or whose plugin is not worfy: no mark», ошибка в `afterEach`:
  `ENOTEMPTY, Directory not empty: /tmp/worfy-harness-drift-fJb98K`. Runner — ubuntu-24.04, образ
  20261012.334, git 2.55.0. В этом test-е `checkHarnessDrift` не запускает git вовсе (оба раза выход
  на проверке plugin.json) и `loggingGit` не используется. Кандидаты 1 и 3 отпадают.
- **Кандидат 2 подтверждён как процесс, который переживает test.** `git commit` (2.50.1 на Mac,
  2.55.0 в контейнере Ubuntu 24.04 с PPA git-core, как на runner-е) запускает
  `git maintenance run --auto --quiet --detach`. Его foreground-часть берёт
  `.git/objects/maintenance.lock`, отделившийся процесс живёт после конца `git commit` и сам удаляет
  lock (strace: lock создан pid 4751, удалён pid 4752 после выхода `git commit`).
- **Воспроизвести ENOTEMPTY не удалось.** В контейнере (Electron 44.5.1 linux, как в CI): 96 + 128 +
  64 прогона файла параллельно, в том числе под `yes` на Mac и при 2 CPU у контейнера — 0 красных.
  На Mac: 10 без нагрузки и 12 под двумя прогонами suite — 0 красных. Shim `LD_PRELOAD`, который
  задерживает отделившийся maintenance на 300 ms: lock лежит в момент уборки в 10 из 13 уборок
  прогона, test-ы зелёные. Shim, который удаляет `maintenance.lock` в окне между `openat` и `unlinkat`
  `rmSync`: Electron удаляет дерево целиком (официальный Node 24.22 на Linux в том же случае молча
  оставляет дерево). strace прогонов под конкуренцией: после начала уборки никакой другой процесс в
  папку не пишет. Отделившийся maintenance git 2.55 в этих репозиториях только читает и удаляет
  свой lock, файлов не создаёт. Чем мог появиться новый файл в CI — не установлено.
- **Правка (решено без владельца, подтвердить).** Helper `git` test-а идёт с
  `-c maintenance.auto=false -c gc.auto=0` (как `test/unit/attachments.test.ts` после PR #33): к
  уборке у test-а не остаётся живых процессов git. С правкой и тем же shim-ом задержки lock в момент
  уборки не лежит ни разу (3 из 3 прогонов, 0 случаев). Test «a commit starts no background
  maintenance that would outlive it» делает commit через сам helper (`gitWith`, с `GIT_TRACE`) и
  проверяет, что git не запустил `maintenance`/`gc --auto`. Мутанты: без `maintenance.auto=false` в
  настройках и helper, который не передаёт `GIT_SETTINGS`, — оба красные (`run_command: git
  maintenance run --auto --quiet --detach`). `maxRetries` не добавлен.

### Кандидаты с той же причиной (вне diff)

Исполняемые файлы во время test-ов пишут (chmod `0o755`/`0o700`) и другие contract test-ы:
`agent-env-recapture`, `e3-owner-check`, `e3-sandbox`, `first-run-checks`, `github-prs`,
`harness-evals`, `harness-install`, `harness-script-env`, `harness-qmd`, `link-access`, `postinstall`,
`projects`, `statusline-bridge`, `terminal-ai-zle`, `workflow-reader`, `workflow-profile`, `trash`.
Самые долгие test-ы в красном прогоне до правки (два suite разом): `harness-qmd` 9.9 s, `docs` 9.9 s,
`github-prs` 9.8 s, `workflow-reader` 9.0 s, `harness-scripts` 8.5 s, `workflow-profile` 8.5 s. Та ли у
них причина, не проверено. Если та — лечение то же: общий файл в `test/fixtures/` и ссылки на него. Не в этом Ticket-е.

### Gate оркестратора (2026-10-15)

- Wave 3 Epic-а под Autopilot: Ticket-ы 14, 16, 17, 18, 19, 21, 23, 25 параллельно, затем 20 и 15 (их «Готово, когда» требует прогонов под нагрузкой). Один verifier на круг, глубина около low; UI-Ticket-ы — снимки в обеих темах. Worktree — `.claude/worktrees/pol-<NN>`.
- Круг 1: `REJECTED` на `47899730` ([комментарий в PR #372](https://github.com/IDSAD-XL/worfy/pull/372#issuecomment-6202332730)) — [med] test на протечку состояния (`harness-script-wiring.test.ts:352-362`) зелёный на мутанте, который называет Ticket (`source` читает переменную уровня `describe`).
- Круг 2: `REJECTED` на `6a007c98` ([комментарий в PR #372](https://github.com/IDSAD-XL/worfy/pull/372#issuecomment-6202757319)) — test ловит только переменную внутри `startRun` (мутант B); мутанты A (переменная файла, заданная в `beforeEach`) и C (`source` читает `scratch`) — 22/22 зелёные. `harness-drift.test.ts` исправлен: мутант D красный.
- Merge: нет. По правилу Wave после второго REJECTED Ticket выведен из волны; вопрос владельцу об узком круге отклонён автоматически (Autopilot). PR #372 открыт, worktree `pol-20` сохранён.
- Act on: [med] test на протечку — предложение verifier-а: настоящая пара test-ов (первый запускает run без await, второй после настоящих `beforeEach` ждёт его и проверяет, что в его `run.calls` ничего не пришло).
- Consider (**решено без владельца, подтвердить**): причина ENOTEMPTY в `harness-drift` не найдена (около 290 прогонов, strace, LD_PRELOAD shim); правка `maintenance.auto=false` и `gc.auto=0` правдоподобна и безвредна; если ENOTEMPTY вернётся в CI — новый Ticket с логом прогона.
- Noted: правка timeout подтверждена — XprotectService проверяет каждый новый исполняемый файл, по одному на машину (первый запуск нового скрипта 142–148 ms, symlink на уже запущенный 7–9 ms); stub-ы стали постоянными файлами в `test/fixtures/harness-stub`. Кандидаты с той же причиной timeout: `harness-qmd`, `docs`, `github-prs`, `workflow-reader`.
- Dismissed — нет (`testTimeout` и пределы в файлах не подняты — проверено).

### Gate оркестратора — узкий круг (2026-10-16)

- Узкий круг — по слову владельца на ночь 2026-10-16 («добить все оставшиеся тикеты»). Скептик подтвердил находку круга 2: [med] test на протечку не ловит мутанты A и C ([комментарий `NARROW:`](https://github.com/IDSAD-XL/worfy/pull/372#issuecomment-6206124470)).
- Доработка (`d7c7cc4d`): хелпер `startRun` убран, вместо него пара соседних test-ов — первый оставляет свой run (`harness-script-wiring.test.ts:357`), второй после настоящих hook-ов сверяет `CALLS` и `HOME` первого (`:362`); запущенный один, второй test падает (`expect(left).toBeDefined()`).
- Гейт узкого круга — `NARROW: VERIFIED` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/372#issuecomment-6206446186)): мутанты A и C — каждый 1 красный test из 23; `--sequence.shuffle` seed 1–4 зелёные.
- Merge: gate full на Mac зелёный (lint, typecheck, test, test:e2e, test:package), CI зелёный — `d20c379`.
- [low] debt: при `--sequence.shuffle.tests` пара может упасть (громко, не ложной зеленью); закрепить порядок `{ shuffle: false }` у `describe` (`harness-script-wiring.test.ts:345`). Проект этот режим не использует.
