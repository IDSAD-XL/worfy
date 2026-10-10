# 28 — git и HARNESS_HOME в прогонах eval: копия git от `eval:harness`, переменные `EVAL_GIT` и `EVAL_HARNESS_HOME` в скриптах Harness

Type: task
Status: open
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

- [ ] `bash harness/bin/tests/eval-env.test.sh` — код 0. В `PATH` test-а `git` — stub, который
  выходит с кодом 97; с `EVAL_GIT=<обёртка над настоящим git, пишет свои аргументы в лог>`
  `preflight`, `epic-status --json`, `profile -C <репозиторий> --name`, `ticket` (чтение Status),
  `gate.sh fast`, `worktree-lock claim`/`release`, `silent-check`, `epic-board --out <tmp> --no-open`
  дают тот же код и вывод, что с настоящим git в `PATH`, и каждый оставил строки в логе обёртки.
- [ ] Тот же test: `EVAL_HARNESS_HOME=worfy-harness`, `HARNESS_HOME` не задан — `profile -C` находит
  Profile из `<репозиторий>/.git/worfy-harness/` (код 0); `gate.sh fast` пишет `gate/state/` туда же;
  `worktree-lock claim` — `worktree-sessions/` туда же; `$HOME/.claude` временного `HOME` не создан.
  `HARNESS_HOME=<папка>` при заданном `EVAL_HARNESS_HOME` — побеждает `HARNESS_HOME`; абсолютный
  `EVAL_HARNESS_HOME` берётся как есть; относительный вне git-репозитория — путь по умолчанию.
- [ ] Тот же test: `grep -nE 'execFileSync\("git"|spawnSync\("git"|execFileSync\(.git.,'
  harness/bin/{profile,ticket,worktree-lock,silent-check,epic-board} harness/hooks/gate-resolve.mjs`
  — код 1 (git по имени из Node-скриптов не зовётся).
- [ ] `bash harness/bin/tests/harness-home.test.sh` — код 0 без изменений в нём: без `EVAL_*` всё как
  было.
- [ ] `test/contract/harness-evals.test.ts`, stub вместо `claude`: stub пишет в лог `EVAL_GIT`,
  `EVAL_HARNESS_HOME` и `PATH`; первая папка `PATH` — папка `EVAL_GIT`; `"$EVAL_GIT" --version` из
  stub-а с `PATH=/usr/bin:/bin` — код 0; в копии нет файлов `git-credential-*`;
  `EVAL_HARNESS_HOME` — `worfy-harness`; после выхода скрипта папки копии нет.
- [ ] Тот же contract test: если `git --exec-path` не дал папку (в `PATH` test-а stub `git` с кодом 1),
  `eval:harness` выходит с кодом 1 и не вызывает `claude` (лог stub-а пуст).
- [ ] Тот же contract test: scaffold каждого кейса с `EVAL_HARNESS_HOME=worfy-harness` во временном
  `HOME` — код 0, реестр в `<рабочая папка>/.git/worfy-harness/gate/config.json`,
  `$HOME/.claude` не создан; `bin/profile -C <рабочая папка> --name` с тем же окружением — `demo`,
  код 0. Без переменной — как сейчас (существующие проверки зелёные).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0; ни один test не запускает настоящий Claude
  Code, не обращается к модели и не пишет в `~/.claude` (все `HOME` — временные папки).
- [ ] `gate.sh fast` на ветке — код 0 и строка `[gate] зелено (…)`.
- [ ] (вручную, платно) `pnpm eval:harness -- --case epic-wave-tickets --runs 1` — код 0 или 1, не 2;
  в транскрипте нет «not a git repository», `preflight` дошёл до последней строки; цена и ответ — в
  «Итог». Снимки `~/.claude` (список `projects`, хэши `settings.json` и `installed_plugins.json`) до и
  после совпали.
- [ ] Ticket 27: `Blocked by` и «Итог» обновлены (шаг 6).

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

Заполняется при закрытии.
