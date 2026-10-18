# 28 — git и HARNESS_HOME в прогонах eval: копия git от `eval:harness`, переменные `EVAL_GIT` и `EVAL_HARNESS_HOME` в скриптах Harness

Type: task
Status: done 2026-10-18T11:18Z
PR: #476
Branch: worfy-harness/28
Blocked by:
Source: решение владельца 2026-10-10 по Ticket-у 27 (eval-кейсы Harness через `claude plugin eval`), вопрос «как дать прогонам eval git», вариант б — правка Harness отдельным Ticket-ом: `scripts/eval-harness.mjs` кладёт копию git в папку, которую песочница читает, скрипты Harness берут путь к git и `HARNESS_HOME` из переменных `EVAL_*`; [Ticket 27](27-eval-кейсы-harness-через-plugin-eval.md), раздел «Итог» (препятствие и пробы); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) (скрипты Harness на Node, bash — только в test-ах); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (состояние машины в `HARNESS_HOME`, по умолчанию `~/.claude/worfy-harness/`); [документация `claude plugin eval`](https://code.claude.com/docs/en/plugin-evals); [spec.md](../spec.md)

## Что происходит

- Платная часть Ticket-а 27 стоит: в прогоне `claude plugin eval` git не запускается. На этой
  машине git — только `/usr/bin/git`, shim Xcode Command Line Tools (CLT). Настройки песочницы,
  которые eval пишет прогону (`sandbox.credentials.files`), запрещают
  `/Library/Developer/CommandLineTools/usr/bin/git` рядом с `git-credential-*`; `xcrun` пишет кэш в
  `/var/folders/…/T`, а эта папка в `denyRead`
  (`.scratch/worfy-harness/issues/27-eval-кейсы-harness-через-plugin-eval.md:251-258`). В кейсе
  `epic-wave-tickets` `preflight` ответил «not a git repository», и агент остановился.
- Пробы обойти это настройками песочницы не сработали: settings прогона scaffold не может дописать
  (`EEXIST`), settings во временном `HOME` и в рабочей папке не читаются, копия git в `/tmp` и в копии
  plugin-а под `/var/folders/…/T` лежит в `denyRead` (`27-…md:260-273`). Из окружения в прогон
  доходят только allowlist (`PATH`, учётка модели, `ANTHROPIC_*`, `CLAUDE_CODE_*`) и `EVAL_*`
  (`27-…md:47-48`); папки `PATH` песочница читает (`27-…md:279-281`).
- Запись из песочницы — только в рабочую папку прогона. В `$HOME/.claude` временного `HOME` писать
  нельзя (`denyWrite`), а туда сейчас пишут состояние Gate и блокировки worktree (`27-…md:257-258`).
  Рабочая папка у каждого run-а своя, временная (`<tmp>/home/cwd`, `27-…md:232-233`): абсолютный
  путь к ней заранее не известен.
- Где скрипты Harness зовут git по имени из `PATH`:
  - `harness/bin/preflight:136` (`git rev-parse --show-toplevel` — отсюда «not a git repository»),
    `:180-268`, `:327-384`; `:220` — `git fetch` через `with_timeout`, это `perl … exec @ARGV`
    (`:73-77`): bash-функция `git` туда не доходит, путь нужно передать явно;
  - `harness/bin/epic-status:63`, `:72`, `:79-80`, `:307-308`;
  - `harness/bin/profile:117-119` (`execFileSync("git", ["-C", abs, …])`);
  - `harness/bin/ticket:47-49`, `:237`;
  - `harness/bin/worktree-lock:42-44`;
  - `harness/bin/silent-check:164`;
  - `harness/bin/epic-board:39`;
  - `harness/hooks/gate.sh:105-107`, `:153`, `:256-304`;
  - `harness/hooks/worktree-create.sh:51-91`.
  `harness/hooks/guard.mjs` git не запускает: `:77-187` разбирают текст команды, а `spawnSync` на
  `:192` зовёт `node`. `harness/bin/project-connect` и `harness/bin/qmd-*` тоже зовут git, но ни один
  из восьми кейсов Ticket-а 27 их не вызывает.
- Где читается `HARNESS_HOME` (по умолчанию `$HOME/.claude/worfy-harness`):
  `harness/bin/profile:36`, `harness/hooks/gate.sh:55` (и состояние `STATE` на `:63`, `mkdir -p` на
  `:67`), `harness/hooks/stop.sh:22-23`, `harness/hooks/gate-resolve.mjs:29`,
  `harness/bin/worktree-lock:75`, `harness/bin/epic-board:34`; в `harness/bin/preflight:151` — только в
  тексте ошибки. `hooks/session-start.sh` находит Profile через `bin/profile`.
- Фикстура кейсов пишет реестр Gate и Profile `demo` в `$HOME/.claude/worfy-harness`
  (`harness/evals/lib/demo-project.sh:32`) и отказывает, если реестр там уже есть (`:33`). Свой bare
  `origin` она уже держит внутри `.git` рабочей папки (`:16`, `:220`).
- `scripts/eval-harness.mjs` передаёт прогону окружение `childEnv`: без переменных Session Claude Code
  и без папок других копий Harness в `PATH` (`:87-90`); копию plugin-а кладёт в `tmpdir()`
  (`:163-178`), результаты — в `<evals>/results/<время>-<тег>/` (`:202`), запускает `claude` с
  `env: childEnv` (`:206`). Переменных `EVAL_*` и копии git он сейчас не делает.
- Те же скрипты правят Ticket-ы других Epic-ов, ещё `open`: `worfy-windows/03` (Gate на Node),
  `worfy-windows/05` (скрипты `bin/` на Node), `worfy-windows/06` (`preflight` на Node),
  `worfy-review/03` (предупреждение Gate о файле длиннее 1000 строк). Кто вливается вторым, делает
  rebase; правило этого Ticket-а держит test (ниже), он же поймает его потерю при переносе на Node.

## Что делаем

1. **Один helper для обеих переменных — `harness/hooks/eval-env.cjs`** (Node, ADR-0055; CommonJS,
   чтобы его брали и `require` из `bin/`, и `import` из `.mjs`). Экспортирует:
   - `git` — `process.env.EVAL_GIT || "git"`;
   - `harnessHome(cwd)` — порядок: `HARNESS_HOME`, если задан; иначе `EVAL_HARNESS_HOME`: абсолютный
     путь — как есть, относительный — от git common dir папки `cwd`
     (`<git> rev-parse --path-format=absolute --git-common-dir`, тем же `git`); вне git-репозитория или
     без обеих переменных — `$HOME/.claude/worfy-harness`, как сейчас.
   Запуск из командной строки `node eval-env.cjs harness-home` печатает папку для текущего `$PWD` —
   для bash-скриптов.
   Относительный путь нужен потому, что рабочая папка run-а временная: значение
   `EVAL_HARNESS_HOME=worfy-harness` даёт `<рабочая папка>/.git/worfy-harness` — туда песочница пишет,
   а `git status` эту папку не видит. Worktree того же репозитория получает ту же папку: common dir у
   них общий.
2. **Скрипты Harness берут git и `HARNESS_HOME` через helper.** Node: `bin/profile`, `bin/ticket`,
   `bin/worktree-lock`, `bin/silent-check`, `bin/epic-board`, `hooks/gate-resolve.mjs` — вместо
   `execFileSync("git", …)` путь `git` из helper-а, вместо `process.env.HARNESS_HOME || …` —
   `harnessHome()`. bash: `bin/preflight`, `bin/epic-status`, `hooks/gate.sh`, `hooks/stop.sh`,
   `hooks/worktree-create.sh` — в начале `git() { command "${EVAL_GIT:-git}" "$@"; }`; в
   `preflight:220` — `"${EVAL_GIT:-git}"` явно (внешний `perl` функцию не видит). `HARNESS_HOME` в
   `gate.sh` и `stop.sh` берётся из `node <папка скрипта>/eval-env.cjs harness-home` только когда
   `HARNESS_HOME` пуст, а `EVAL_HARNESS_HOME` задан: в обычной работе лишнего вызова `node` нет.
   Без переменных `EVAL_*` поведение и вывод скриптов не меняются.
3. **`scripts/eval-harness.mjs` кладёт копию git и задаёт `EVAL_*`.** Перед вызовами `claude`:
   - папка git — вывод `git --exec-path` (на этой машине
     `/Library/Developer/CommandLineTools/usr/libexec/git-core`, 17 МБ, в ней есть сам `git` и
     `git-upload-pack`) копируется в `<evals>/results/<время>-git/git-core/` без файлов
     `git-credential-*`; `results/` уже в `.gitignore` и не попадает в копию plugin-а
     (`eval-harness.mjs:165-171`);
   - рядом — `<…>-git/git`, обёртка `#!/bin/sh`: `GIT_EXEC_PATH=<копия>/git-core`,
     `GIT_CONFIG_NOSYSTEM=1` (системный gitconfig CLT лежит в папке CLT и задаёт `osxkeychain`),
     `exec <копия>/git-core/git "$@"`;
   - `childEnv.PATH` начинается с `<…>-git` — так работает и `git`, который агент зовёт сам;
     `childEnv.EVAL_GIT=<…>-git/git` — явный путь для скриптов, не зависит от порядка `PATH`;
     `childEnv.EVAL_HARNESS_HOME=worfy-harness`;
   - `<копия> --version` с `PATH=/usr/bin:/bin` должен дать код 0, иначе выход 1 с понятным
     сообщением, `claude` не запускается;
   - папка копии удаляется в `finally`, как копия plugin-а (`:212-214`).
4. **Фикстура пишет состояние туда же, куда смотрят скрипты.** `harness/evals/lib/demo-project.sh`:
   при заданном `EVAL_HARNESS_HOME` реестр Gate, Profile `demo` и `rules.md` пишутся в
   `harnessHome` (относительный путь — от `.git` фикстуры, после `git init`); без него — в
   `$HOME/.claude/worfy-harness`, как сейчас. Проверка «реестр уже есть» — по той же папке.
5. **Одна платная проба после бесплатных test-ов.** `pnpm eval:harness -- --case epic-wave-tickets
   --runs 1` (по шагу 0 Ticket-а 27 — около 0.3 USD, около 100 с). Цель — не оценка кейса, а ответ:
   в транскрипте `preflight` и `profile` из `Bash` в песочнице проходят git-шаги, Gate пишет
   состояние в `.git/worfy-harness`. Если копия git в `results/` для песочницы закрыта (`denyRead`),
   Ticket — в `block` с вопросом владельцу и строками из `<tmp>/config/settings.json` прогона. Другие
   отказы песочницы (например, `mktemp` в `preflight`) не чинятся здесь: они идут в «Итог» с
   строкой транскрипта.
6. **Ticket 27.** Сейчас у него `Blocked by: 05, 06, 07, 11` и статус `blocked`; в PR этого Ticket-а
   в его `Blocked by` добавляется 28, статус — `open`, в «Итог» — ссылка на этот Ticket и ответ
   платной пробы. После влития 28 платные пункты Ticket-а 27 идут дальше.
7. **`harness/README.md`**, раздел про eval: две строки — что делают `EVAL_GIT` и
   `EVAL_HARNESS_HOME`, что без них скрипты работают как раньше.

**Не входит:** `bin/project-connect`, `bin/qmd-*` (кейсов на них нет); Windows (eval только на Mac,
Ticket 27); сам полный прогон набора — Ticket 27; правило «когда гонять» и выбор кейсов по
изменённым файлам правил — Ticket 29; правка `.claude` вне
временных папок.

## Готово, когда

- [x] `bash harness/bin/tests/eval-env.test.sh` — код 0. В `PATH` test-а `git` — stub, который
  выходит с кодом 97; с `EVAL_GIT=<обёртка над настоящим git, пишет свои аргументы в лог>`
  `preflight`, `epic-status --json`, `profile -C <репозиторий> --name`, `ticket` (чтение Status),
  `gate.sh fast`, `worktree-lock claim`/`release`, `silent-check`, `epic-board --out <tmp> --no-open`
  дают тот же код и вывод, что с настоящим git в `PATH`, и каждый оставил строки в логе обёртки.
- [x] Тот же test: `EVAL_HARNESS_HOME=worfy-harness`, `HARNESS_HOME` не задан — `profile -C` находит
  Profile из `<репозиторий>/.git/worfy-harness/` (код 0); `gate.sh fast` пишет `gate/state/` туда же;
  `worktree-lock claim` — `worktree-sessions/` туда же; `$HOME/.claude` временного `HOME` не создан.
  `HARNESS_HOME=<папка>` при заданном `EVAL_HARNESS_HOME` — побеждает `HARNESS_HOME`; абсолютный
  `EVAL_HARNESS_HOME` берётся как есть; относительный вне git-репозитория — путь по умолчанию.
- [x] Тот же test: `grep -nE 'execFileSync\("git"|spawnSync\("git"|execFileSync\(.git.,'
  harness/bin/{profile,ticket,worktree-lock,silent-check,epic-board} harness/hooks/gate-resolve.mjs`
  — код 1 (git по имени из Node-скриптов не зовётся).
  Список шире: после переноса на Node ещё `bin/preflight`, `bin/epic-status`, `hooks/gate.mjs`,
  `hooks/gate-paths.mjs`, `hooks/stop.mjs`; шаблон ловит и `spawn`, `execFile`, `withTimeout(…, "git"`.
- [x] `bash harness/bin/tests/harness-home.test.sh` — код 0 без изменений в нём: без `EVAL_*` всё как
  было.
- [x] `test/contract/harness-evals.test.ts`, stub вместо `claude`: stub пишет в лог `EVAL_GIT`,
  `EVAL_HARNESS_HOME` и `PATH`; первая папка `PATH` — папка `EVAL_GIT`; `"$EVAL_GIT" --version` из
  stub-а с `PATH=/usr/bin:/bin` — код 0; в копии нет файлов `git-credential-*`;
  `EVAL_HARNESS_HOME` — `worfy-harness`; после выхода скрипта папки копии нет.
- [x] Тот же contract test: если `git --exec-path` не дал папку (в `PATH` test-а stub `git` с кодом 1),
  `eval:harness` выходит с кодом 1 и не вызывает `claude` (лог stub-а пуст).
- [x] Тот же contract test: scaffold каждого кейса с `EVAL_HARNESS_HOME=worfy-harness` во временном
  `HOME` — код 0, реестр в `<рабочая папка>/.git/worfy-harness/gate/config.json`,
  `$HOME/.claude` не создан; `bin/profile -C <рабочая папка> --name` с тем же окружением — `demo`,
  код 0. Без переменной — как сейчас (существующие проверки зелёные).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0; ни один test не запускает настоящий Claude
  Code, не обращается к модели и не пишет в `~/.claude` (все `HOME` — временные папки).
- [x] `gate.sh fast` на ветке — код 0 и строка `[gate] зелено (…)`.
- [ ] (вручную, платно) `pnpm eval:harness -- --case epic-wave-tickets --runs 1` — код 0 или 1, не 2;
  в транскрипте нет «not a git repository», `preflight` дошёл до последней строки; цена и ответ — в
  «Итог». Снимки `~/.claude` (список `projects`, хэши `settings.json` и `installed_plugins.json`) до и
  после совпали.
  Не проверено: по брифу Orchestrator-а платный run здесь не запускался — его делает Ticket 27 первым
  платным run-ом.
- [x] Ticket 27: `Blocked by` и «Итог» обновлены (шаг 6). `Blocked by: 05, 06, 07, 11, 28` и статус `open`
  там уже стояли; в «Итог» добавлен раздел «Ticket 28».

## Тесты

Сначала падающий test — `harness/bin/tests/eval-env.test.sh`, случай «`preflight` с `EVAL_GIT` при
сломанном git в `PATH`». На main `preflight` зовёт git по имени и отвечает «not a git repository» —
тот же отказ, что в прогоне eval. В «Итог» — как он падал.

- `harness/bin/tests/eval-env.test.sh` — новый: stub git в `PATH`, обёртка с логом в `EVAL_GIT`,
  временные `HOME` и репозиторий с локальным bare `origin`; все скрипты из шага 2; правило
  `EVAL_HARNESS_HOME`; grep на git по имени в Node-скриптах. Запускается из
  `test/contract/harness-scripts.test.ts` (он берёт все `*.test.sh`), идёт в CI.
- `test/contract/harness-evals.test.ts` — копия git, `EVAL_*` и `PATH` у вызова `claude` (stub),
  отказ без `git --exec-path`, удаление копии, scaffold с `EVAL_HARNESS_HOME`.
- `harness/bin/tests/harness-home.test.sh` — не меняется, должен остаться зелёным.
- Платная проба из шага 5 — вручную, на Mac, один run; не test и не в CI.

## Где в коде

- `harness/hooks/eval-env.cjs` — новый
- `harness/bin/preflight`
- `harness/bin/epic-status`
- `harness/bin/profile`
- `harness/bin/ticket`
- `harness/bin/worktree-lock`
- `harness/bin/silent-check`
- `harness/bin/epic-board`
- `harness/hooks/gate.sh`
- `harness/hooks/stop.sh`
- `harness/hooks/gate-resolve.mjs`
- `harness/hooks/worktree-create.sh`
- `harness/evals/lib/demo-project.sh`
- `scripts/eval-harness.mjs`
- `harness/bin/tests/eval-env.test.sh` — новый
- `test/contract/harness-evals.test.ts`
- `harness/README.md`
- `.scratch/worfy-harness/issues/27-eval-кейсы-harness-через-plugin-eval.md`

## Итог

Состояние на 2026-10-18: бесплатная часть сделана, PR с меткой `needs-mac-gate` (платформенный PR,
ADR-0056: правит скрипты Harness). Ветка `worfy-harness/28`. Платная проба шага 5 не запускалась —
её делает Ticket 27.

**Что сдвинулось с момента записи Ticket-а.** Скрипты Harness переписаны на Node (worfy-windows 04,
05, 06), и места из «Что происходит» теперь такие:

- `bin/preflight`, `bin/epic-status` — Node, не bash: git зовут `spawnSync` (`preflight:131`,
  `epic-status:101`, `:153`, `:498`) и `withTimeout(…, "git", …)` для `git fetch` (`preflight:492`),
  это `spawn` Node, а не `perl … exec`. Функция bash `git()` для них не нужна: путь из helper-а.
- `hooks/stop.sh` → `hooks/stop.mjs`; `hooks/session-start.sh` → `session-start.mjs`. `stop.mjs` и
  `gate-resolve.mjs` берут папку состояния и реестр из `hooks/gate-paths.mjs`, правка там — без
  правки самих файлов.
- `hooks/gate.sh` — теперь только запуск `gate.mjs`; Gate — `hooks/gate.mjs` (git — `:216`) и
  `hooks/gate-paths.mjs` (`harnessHome`, git — `:46`). Без node `gate.sh` отвечает сам: там
  `git()` через `EVAL_GIT` и правило `EVAL_HARNESS_HOME` на bash — вызвать `node eval-env.cjs` без
  node нельзя.
- `bin/profile`: `HARNESS_HOME` (`:38`) считался до разбора `-C`; теперь — после, от папки `-C`.
  `bin/ticket`: `HARNESS_HOME` — в `markLocal` (Silent mode, `:741`). `bin/epic-board`: `:34`, git — `:39`.
  `bin/worktree-lock`: git — `:46`, `HARNESS_HOME` — `:77`. `bin/silent-check`: git — `:191`.
- `test/contract/harness-evals.test.ts` теперь гоняет `eval-harness.mjs` на копии `harness/` во
  временной папке (`HARNESS_DIR`): копия git пишется в `<evals>/results/`, и под настоящим `harness/`
  она мешала `harness-install.test.ts`, который в то же время копирует `harness/` (красный в первом
  полном прогоне: ENOENT на `evals/results/…-git/git-core/git-add`).
- Вне «Где в коде», по необходимости: `eslint.config.js` (блок для `harness/**/*.cjs` — без него
  `pnpm lint` красный: `require`, `module`, `process` не определены), `bin/tests/preflight.test.sh`
  и `hooks/tests/gate-shim.test.sh` (копируют скрипты по одному — теперь и `hooks/eval-env.cjs`).

**Как падал первый test.** `bash harness/bin/tests/eval-env.test.sh` на main с готовым test-ом: 33 из
40 красные. `preflight` с `EVAL_GIT` при git в `PATH` с кодом 97 — код 2 и «not a git repository»,
тот же отказ, что в прогоне eval; `epic-status`, `silent-check`, `epic-board`, `gate` — другой вывод
или код 2; у всех скриптов — ни одной строки в логе обёртки; с `EVAL_HARNESS_HOME` реестр искался в
`$HOME/.claude/worfy-harness`; `gate.sh` без node молча выходил с 0; grep нашёл git по имени в 10
местах. После правки — 40 из 40.

**Проверки.** `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0 (285 файлов, 6022 test-а);
`eval-env.test.sh`, `harness-home.test.sh` (без правок), `preflight.test.sh`, `gate-shim.test.sh` —
код 0 по одному; `gate.mjs fast` — код 0, `[gate] зелено (fast): worfy/.:lint worfy/.:typecheck
worfy/.:test`. Mutants `scripts/eval-harness.mjs` и `demo-project.sh` (фильтр `git-credential*`, порядок
`PATH`, удаление копии, `EVAL_HARNESS_HOME`, проверка `git --exec-path`, папка состояния фикстуры) —
каждый делает contract test красным.

**Копия git.** Папка `git --exec-path` Command Line Tools — 172 имени, из них 146 symlink на один
бинарник `../../bin/git`. Копия держит каждый файл один раз: второе имя того же файла (symlink или
hard link, как в `/usr/lib/git-core` Linux) — symlink внутри копии; без `git-credential*`.

**Fix round 1 (PR #476).** Ревью нашло пять блокирующих пробелов и восемь мелких; все закрыты test-ом,
каждый mutant в своём дереве, файл восстановлен из копии:

- Фикстура (`demo-project.sh`) больше не читает `HARNESS_HOME`: без `EVAL_HARNESS_HOME` состояние —
  `$HOME/.claude/worfy-harness`, как в шаге 4; с ним — папка из `eval-env.cjs` без `HARNESS_HOME`.
  Прогон не получает `HARNESS_HOME` (sandbox передаёт `PATH` и `EVAL_*`), поэтому фикстура его не
  учитывает. Отказ на чужой реестр (`gate/config.json` уже есть) — exit 1, файл байт в байт.
- `eval-harness.mjs`: SIGHUP, как SIGINT и SIGTERM, не убивает скрипт; копия git удаляется в своём
  `finally`, даже если удаление копии плагина бросило; код выхода по сигналу — 128 + номер.
  Test-ы: сигналы, «копия не отвечает `--version`», «файл git не копируется», `--exec-path` копии,
  системный gitconfig не читается, соседняя папка в `results/` остаётся.
- `eval-env.test.sh`: Gate — на ветке с изменениями без `GATE_SCOPE=all`, stderr сравнивается;
  `worktree-lock status`; `profile -C` и `worktree-lock` из другой папки; `ticket mark` Silent,
  `epic-board` без `--out`, `worktree-create.sh`, `gate.sh` с абсолютным `EVAL_HARNESS_HOME`; список
  для grep собирается из всех Node-скриптов `bin/` и `hooks/`. `shortcut-ledger` и `wave-gate` зовут
  git через helper; `project-connect` и `qmd-collections` — названные исключения (работают с
  состоянием владельца, в кейсах eval не запускаются).
