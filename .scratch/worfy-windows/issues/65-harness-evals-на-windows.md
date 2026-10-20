# 65 — `harness-evals.test.ts` на Windows: дочерний процесс не видит настоящий home, скрипты Harness через `node`, CRLF во front matter

Type: bug
Status: done 2026-10-20T04:42Z
PR: #517
Blocked by: —
Source: PR #496 (`worfy-harness` 27): замеры Session на Windows-ПК на main `74455f70` ([комментарий 6254019222](https://github.com/IDSAD-XL/worfy/pull/496#issuecomment-6254019222)) и на head `20823b78` ([комментарий 6254249938](https://github.com/IDSAD-XL/worfy/pull/496#issuecomment-6254249938)); вопрос Q-e утреннего списка 2026-10-19 (мерж #496 при красном на Windows файле); решение владельца 2026-10-19, пункт 1: сначала main зелёный на Windows ([Ticket 14](14-gate-full-на-windows.md), часть unit/contract, и этот Ticket); решение владельца 2026-10-09 о CRLF ([Ticket 14](14-gate-full-на-windows.md), «Что происходит»; evidence Ticket-а 01, раздел 27).

## Что происходит

- `test/contract/harness-evals.test.ts` красный на Windows на main: на `74455f70` — exit 1, 52 упали,
  83 прошли, 8 пропущены (замер ПК). Сами eval-случаи (`pnpm eval:harness`, `claude plugin eval`) идут
  только на Mac и платные; этот test — их бесплатная часть, и на Windows он должен быть зелёным.
  С веткой PR #496 упали 65 (замер ПК 2026-10-18 на `dc7b8c0b`). Порядок шагов в «Что делаем» — тот, что
  дал этот замер: сначала временный home (`USERPROFILE` и `HOME`) каждому ребёнку `harness()`, потом
  запуск через `node <скрипт>`, потом CRLF, потом путь `pm`.
- **Причина 1: скрипт с shebang, запущенный по пути.** `harness()` (`:81-88`) делает
  `spawnSync(join(HARNESS, 'bin', script), …)`. На Windows Node без shell запускает только `.exe` и
  `.com`: `error.code === 'ENOENT'`, `status === null` — отсюда «expected null to be +0» у
  `bin/profile -C <fixture>`, `epic-status` и случаев с `EVAL_HARNESS_HOME`. Нужен `node <скрипт>` —
  так сделал Ticket 30 для `project-connect`. Та же причина у stub-а `claude` в разделе
  «pnpm eval:harness (… claude replaced by a stub)» (`:441`): stub — shell-скрипт с `chmod 755`
  (`#!/usr/bin/env node`, `:298`, `:372`), на ПК `spawnSync …\claude ENOENT` (Ticket 14, «Что происходит»).
- **Причина 2: CRLF в файлах случаев.** У `harness/evals/**` нет правила `eol` в `.gitattributes`, на
  ПК `core.autocrlf=true`, и `case.yaml`, `prompt.md` и grader-ы приходят с CRLF. `frontMatter`
  (`:35`) ищет `^---\n` и ничего не находит: падают «has prompt.md …», «has at least two graders …» и
  test grader-а gate. Решение владельца 2026-10-09 (Ticket 14): CRLF-случай чинит test — `\r?\n` в
  `frontMatter`, а не LF для `harness/evals/**`: test читает файл в том виде, в каком git отдаёт его
  на машине.
- **Причина 3: путь `/tmp/…` к `pm` из Git Bash.** Fixture пишет в реестр Gate `pm` вида
  `/tmp/…/.git/demo-pm` — путь Git Bash. Gate на Node (`gate.mjs`) через `relative()` читает его как
  путь вне `work`, и gate fixture-а с красным test-ом выходит с кодом 3 («не удалось проверить»), а не 2.
  Видно в двух test-ах gate, которые добавляет PR #496.
- **Опасность, которую откроет починка причины 1.** Helper-ы test-а передают ребёнку белый список
  переменных: `PATH`, `HOME`, `TMPDIR` и немного ещё (`scaffold` `:71-73`, `harness` `:82-84`,
  `inFixture` `:202-205`, env stub-а `claude` `:375-385`). `USERPROFILE` в нём нет. Node на Windows
  берёт home из `USERPROFILE`, а без него спрашивает у Windows папку профиля учётной записи: на ПК
  `os.homedir()` ребёнка с одним `HOME` — настоящий `C:\Users\Alexey` (замер ПК, комментарий
  6254019222). Сейчас вызовы `harness()` без `EVAL_HARNESS_HOME` (на main `:132`, `:191`, `:195`) до этого не доходят
  только потому, что падают на `ENOENT`. Как только скрипт запустится через `node`, test прочтёт
  настоящий реестр владельца в `~/.claude/worfy-harness` и `~/.claude/gate`; скрипт, который пишет,
  записал бы туда. В замере ПК снимок этих папок до и после прогона не изменился — но только потому,
  что ни один скрипт не стартовал.

## Что делаем

1. **Первым шагом, до причины 1: home ребёнка — временная папка и на Windows.** Один helper собирает
   env для каждого запуска в этом файле: `HOME` и `USERPROFILE` — временный home; `HOMEDRIVE` и
   `HOMEPATH` — тоже в него, если замер на ПК покажет, что их читает хоть один ребёнок (Git для
   Windows берёт их, только когда `HOME` не задан). Через этот helper идут `scaffold`, `harness`,
   `inFixture`, env stub-а `claude` и каждый новый `spawn`/`spawnSync`, которому test даёт `HOME`.
   Test этого шага (см. «Тесты») — в том же commit-е, до правки причины 1.
2. **Причина 1.** Скрипты Harness — `process.execPath <скрипт>` с `ELECTRON_RUN_AS_NODE=1` (или тот же
   способ, что у `project-connect` в Ticket 30). Stub `claude` — тем способом, который Ticket 14 (пункт
   7 «Что делаем») выбрал для подмен на Windows; если для этого нужна правка
   `scripts/eval-harness.mjs`, поведение на Mac с настоящим `claude` не меняется.
3. **Причина 2.** `frontMatter` — `/^---\r?\n([\s\S]*?)\r?\n---/`; так же — каждое место файла, которое
   режет текст случая по `\n`. `.gitattributes` не трогаем (решение владельца 2026-10-09).
4. **Причина 3.** `pm` в реестре fixture-а — путь, который Node на Windows понимает как путь внутри
   `work` (например, `pwd -W` или `cygpath -m` в Git Bash), либо сравнение в test-е через нормализацию
   пути. Выбор и довод — в Итог. На Mac fixture пишет то же, что сейчас: eval-случаи идут только там и
   платные.
5. Что ещё красное на ПК после шагов 1–4 — починить или пропустить на `win32` с комментарием: почему и
   какой Ticket снимет пропуск. Список — в Итог.

**Не входит:** запуск eval-случаев (`pnpm eval:harness`) на Windows; правило `eol=lf` для
`harness/evals/**`; правки правил Harness, которые проверяют eval-случаи.

## Готово, когда

- [ ] На ПК владельца `node scripts/vitest-electron.mjs test/contract/harness-evals.test.ts` — exit 0;
      каждый пропуск на `win32` — с комментарием о причине; список — в Итог.
- [ ] На ПК: снимок настоящих `%USERPROFILE%\.claude\worfy-harness` и `%USERPROFILE%\.claude\gate`
      (список файлов с размером и временем изменения) до и после прогона файла — одинаковый; оба
      снимка — в Итог.
- [ ] Test «ребёнок не видит настоящий home» красный на мутанте: helper без `USERPROFILE` (мутант в
      своём worktree, файл возвращён из копии); красный на ПК и красный на Mac — строки vitest в Итог.
- [ ] `git diff origin/main -- .gitattributes` — пусто.
- [ ] На Mac `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; число test-ов `harness-evals` не
      меньше, чем на main.

## Тесты

Сначала падающий test шага 1 — на Mac и на ПК, до правки причины 1.

- `test/contract/harness-evals.test.ts`, новый `describe` «a child process sees the temporary home»:
  - каждый helper запуска (`scaffold`, `harness`, `inFixture`, env stub-а `claude`) отдаёт env, в
    котором `USERPROFILE` равен `HOME` и лежит во временной папке; на Mac и Linux test тоже красный,
    если `USERPROFILE` нет;
  - через env каждого helper-а `process.execPath -e "…os.homedir()…"` с `ELECTRON_RUN_AS_NODE=1`
    печатает временный home, а не `os.homedir()` процесса test-а; на Windows без шага 1 этот test
    красный;
  - текст файла: каждый вызов `spawn`/`spawnSync`, у которого есть `HOME:`, идёт через helper (поиск
    по исходнику, как в `test/contract/windows-tests-workflow.test.ts`), — чтобы новый запуск в обход
    helper-а сделал test красным.
- Существующие test-ы случаев — без изменений смысла: те же проверки, другой способ запуска и разбор
  CRLF.

## Где в коде

- `test/contract/harness-evals.test.ts` (`:35` `frontMatter`; `:59-77` `scaffold`; `:81-88` `harness`;
  `:202-208` `inFixture`; `:364-410` `stubSetup`, env stub-а `claude`)
- `harness/evals/lib/demo-project.sh` — только для причины 3, если `pm` чинится в fixture-е
- `scripts/eval-harness.mjs` — только если stub `claude` на Windows не запускается без правки скрипта

PR #496 (`worfy-harness` 27) меняет тот же test-файл и `harness/evals/lib/demo-project.sh` и
добавляет test-ы gate с причиной 3. Пока он открыт, этот Ticket в Wave не берётся; после его мержа
исполнитель делает rebase и чинит и новые test-ы.

## Вне скоупа

- Остальные красные на Windows unit- и contract-test-ы — часть unit/contract Ticket-а 14.
- `os.userInfo().homedir`, которого нет на диске, в `harness/evals/lib/state-guard.cjs` (файл из PR #496) — находка low
  третьего круга ревью #496, отдельно.

## Итог

Session на Windows-ПК, 2026-10-19. Windows 11 Pro 10.0.26200, Git Bash; test-ы через `node scripts/vitest-electron.mjs` (Node 24.21.0 из Electron 44.5.1). Ветка `worfy-windows/65` от main `29f35f57`, после rebase — на main `77c473cb` (hash-и commit-ов ниже — после rebase). Пункты 1, 2, 3 и 5 «Что делаем»; затем по решению Session на Mac снят пропуск `pnpm eval:harness` на Windows (`1b390da3`, ниже). **Пункт 4 (путь `pm`, причина 3) не сделан: он ждёт мержа PR #496.** На macOS и Linux с ПК ничего не запускалось. Внешний `gh` — не запускался (убран из PATH, `command -v gh` пусто); gate не запускался.

- **Пункт 1 (`db0e5ee0`, отдельным commit-ом до причины 1).** В `test/contract/harness-evals.test.ts` один helper `childEnv(home, vars)`: `vars`, затем `HOME` и `USERPROFILE` — временный home; оба ставятся последними, переменные вызова их не заменяют. Через него идут `scaffoldEnv` (`scaffold`), `harnessEnv` (`harness`), `fixtureEnv` (`inFixture`) и env stub-а `claude` (`stubSetup`). Новый `describe` «a child process sees the temporary home» — 9 test-ов:
  - «USERPROFILE is HOME, in a temporary folder» — для каждого из четырёх helper-ов;
  - «a Node child takes the temporary home for os.homedir()» — `process.execPath -e` с `ELECTRON_RUN_AS_NODE=1` через env каждого helper-а печатает временный home, а не `os.homedir()` процесса test-а;
  - «every spawn and spawnSync of this file that gives a home goes through childEnv» — поиск по исходнику: ключ `HOME` или `USERPROFILE` только в строке `childEnv`, и ни один вызов `spawn`/`spawnSync` не называет их сам.
- **`HOMEDRIVE`/`HOMEPATH` не добавлены — замер на ПК.** Каждый ребёнок запущен дважды: с env helper-а (`HOME` и `USERPROFILE` — временная папка) и с ним же плюс `HOMEDRIVE=C:`, `HOMEPATH=\Users\Alexey\AppData\Local\Temp\t65-homedrive-…\decoy` (папка-приманка со своим `.gitconfig`). Ответ одинаковый у всех шести: `node` из PATH и Node из Electron — `os.homedir()` = временный home; `bash` — `~` = `/tmp/…/home`, `cd ~; pwd -W` = `C:/…/home`; `git config --global` берёт `…/home/.gitconfig` (`worfy.probe=home`, `--show-origin` — `file:C:/…/home/.gitconfig`); `harness/bin/profile -C <папка>` ищет реестр в `…\home\.claude\worfy-harness\gate\config.json`. Ни один ребёнок не читает `HOMEDRIVE`/`HOMEPATH`, пока заданы `HOME` и `USERPROFILE`; белый список env их и не передаёт.
- **Пункт 2 (`eae1f006`).** `harness()` запускает `process.execPath <harness/bin/скрипт> …`, в `harnessEnv` — `ELECTRON_RUN_AS_NODE=1`; на всех системах (скрипты — Node, `#!/usr/bin/env node`). Stub `claude` — способом среза 3c Ticket-а 14: на Windows подмена — `claude.mjs`, который только загружает CommonJS-stub `claude.cjs`; на macOS и Linux — исполняемый файл `claude`, как раньше. `scripts/eval-harness.mjs`: `runClaude` запускает `CLAUDE_BIN`, который кончается на `.mjs`, как `process.execPath <файл>` с `ELECTRON_RUN_AS_NODE=1` (как `programStart` в `src/main/program.ts`); бинарник SDK и любой другой путь — как раньше, тем же `spawnSync(claude, args, options)`. На Mac с настоящим `claude` поведение не меняется.
- **Пункт 3 (`d2354867`).** `frontMatter` — `/^---\r?\n([\s\S]*?)\r?\n---/`. Других мест, которые режут текст случая по `\n`, в файле нет: `field` берёт значение регуляркой с флагом `m` и `trim()` (снимает `\r`), `caseTags` в `eval-harness.mjs` ищет `^tags:` с флагом `m` и CRLF не мешает. `split('\n')` и многострочные `toContain` в test-ах `reviewer-*` читают файлы fixture-а, которые пишет bash (LF), — на ПК зелёные. `.gitattributes` не тронут: `git diff origin/main -- .gitattributes` пусто (`origin/main` = `29f35f57`).
- **Пункт 5 (`e5f0b824`) — что осталось красным после 1–3 и пропущено на `win32` с комментарием:**
  - 20 test-ов «… bin/profile -C <fixture> exits 0 with profile demo» и «… with EVAL_HARNESS_HOME the state goes to <fixture>/.git/worfy-harness» (по 10 случаев). Причина: fixture пишет `"match"` реестра Gate из `pwd -P` Git Bash — `/tmp/…/work`, а `bin/profile` на Node видит `C:\…\work` и отвечает «not in a registered project» (exit 3). **Это та же причина 3, что у `pm`, но в поле `match`, и на main она есть уже сейчас** (без PR #496). Замер: временно `work="$(pwd -W 2>/dev/null || pwd -P)"` в `demo-project.sh` — все 25 test-ов этого `describe` зелёные (`25 passed | 64 skipped`, exit 0); файл возвращён из копии. Снимает пропуск пункт 4 этого Ticket-а после мержа #496 — **пункт 4 должен чинить и `match`, не только `pm`**.
  - ~~11 test-ов `pnpm eval:harness`~~ — пропуск снят в `1b390da3`, см. следующий пункт. Причина пропуска была: `eval-harness.mjs` даёт run-ам копию git за обёрткой `#!/bin/sh` и проверяет её `<обёртка> --version`; Windows не запускает её (`exit ENOENT`), а fake `git` из `fakeGitPath` и «failing-git» — тоже `#!/bin/sh`, и Windows берёт вместо них настоящий `git.exe`.
- **Пропуск `pnpm eval:harness` на Windows снят (`1b390da3`; решение Session на Mac, вопрос Q2, вариант b).** 11 test-ов («makes two calls …», «evaluates a removed copy …», «keeps other Harness copies off the PATH …», «gives the runs a copy of git …», «… `git --exec-path` gives no folder», «… the copy of git does not answer --version», «passes the arguments after -- through …», 4 «exits with the worst code …») идут на `win32` и зелёные.
  - `scripts/eval-harness.mjs`, только ветка `win32`: `git --exec-path` — через `sh -c` (так `git` ищется по PATH, как его ищет shell run-а, и fake `git` первым на PATH находится); проверка копии — `sh <обёртка> --version` с PATH run-ов: скопированный `git.exe` грузит DLL из `mingw64/bin` настоящего git через PATH (с `PATH=/usr/bin:/bin` — `zlib1.dll: cannot open shared object file`, замер на ПК; комментарий `shortcut:` в коде). `sh`, а не `bash`: обёртка — `#!/bin/sh`, а `bash` в PATH Windows может оказаться `bash.exe` WSL. На macOS и Linux `spawnSync('git', …)` и `spawnSync(<обёртка>, ['--version'], { PATH: '/usr/bin:/bin' })` — те же, что были.
  - Stub `claude` (helper test-а): на `win32` запускает `EVAL_GIT` через `sh` с PATH run-а, путь `--exec-path` приводит к виду Windows (`resolve`), имена файлов копии — без `.exe`.
  - Shim вида `git.cmd`/`git.exe` для поиска `git` по PATH не нужен этим test-ам: им важны только проверка `--version` в `eval-harness.mjs` и `EVAL_GIT` stub-а. Ребёнок настоящего `claude` на Windows, который зовёт `git` через PATH без shell, получил бы настоящий `git.exe`, а не обёртку; через Git Bash — обёртку. Это вопрос платных run-ов на Windows, которых нет («Не входит»).
  - Чтобы test-ы не проходили по неверной причине: «… does not answer --version» теперь требует `--version, exit 1)` (ответ самой копии, а не `ENOENT`); «exits with the worst code …» требует хотя бы один вызов `claude` (раньше «1,0 -> 1» проходил и на run-е, который остановился до `claude`).
  - Без изменений остаются 8 прежних пропусков: 6 test-ов сигналов (`skipIf(win32)`) и 2 test-а прав (`permissionsHold`). У пропуска сигналов теперь есть комментарий о причине: на Windows нет POSIX-сигналов и групп процессов, `process.kill` с SIGINT/SIGTERM/SIGHUP завершает процесс сразу, обработчик `eval-harness.mjs` не выполняется.
- **Правки после ревью (две линзы: корректность, test-ы).**
  - `runClaude` запускает `.mjs` через Node только на `win32`. Раньше ветка `.mjs` срабатывала на любой системе, и на Mac `CLAUDE_BIN=….mjs` отдал бы `ELECTRON_RUN_AS_NODE=1` всем детям платного run-а.
  - «… `git --exec-path` gives no folder» требует `exit 1)` в ошибке. Без `sh` в PATH он раньше проходил на `ENOENT`.
  - «exits with the worst code …» требует ровно два вызова, строки `main exited N` и `gui exited M` и пути результатов: их печатает только код после очистки. Так код 1 от сбоя очистки не сойдёт за «1,0 -> 1».
  - Test на `ELECTRON_RUN_AS_NODE=1` из `runClaude` не добавлен. Под Electron `eval-harness.mjs` сам работает только с этой переменной, и его `childEnv` передаёт её дальше. Под настоящим Node она ни на что не влияет. Убрать её из `runClaude` нельзя заметить ни одним test-ом.
  - На Windows stub через `.mjs` проверяет test «refuses with exit code 1 on claude older than 2.1.269 and runs nothing»: на шаге 1 он падал (`ENOENT`), после шага 2 зелёный.
- **Раунд 2 ревью Session на Mac (`fda5c81e`).**
  - Находка 1 (мутант T4 «`harnessEnv` без `ELECTRON_RUN_AS_NODE`» выживал). Новый test «%s: runs this process as Node (ELECTRON_RUN_AS_NODE=1)» для launcher-ов, которые запускают `process.execPath` (`harness` и env stub-а). Test «os.homedir()» больше не добавляет переменную сам этим launcher-ам — только `scaffold` и `inFixture`, которые запускают `bash` и `git`.
  - Находка 2. `ELECTRON_RUN_AS_NODE` из `runClaude` убрана — пункт «Test на `ELECTRON_RUN_AS_NODE=1` из `runClaude` не добавлен» выше этим заменён. Под `pnpm eval:harness` (`node scripts/eval-harness.mjs`) `process.execPath` — node, переменная ему не нужна. Под Electron скрипт работает как Node только потому, что переменная уже есть в его env, а `childEnv` её сохраняет. Явная установка была мёртвым кодом: ни один test не мог её увидеть.
  - Находка 3. Два test-а. На `win32`: `CLAUDE_BIN` = сам `process.execPath` (не `.mjs`) по своему пути отвечает на `--version` (`v24.21.0`), `--case no-such-case` пропускает оба вызова, exit 0. Вне `win32` (`skipIf(win32)`): `CLAUDE_BIN` = `claude-by-path.mjs` с `#!/bin/sh`, который запускает stub. Ядро запускает его по строке `#!`, а Node отказался бы разбирать его как JavaScript.
  - Находка 4. Три новых launcher-а, вызывающий которых передаёт свои `HOME` и `USERPROFILE` (настоящий home, ключи собраны из имён): `scaffold`, `harness`, stub. Временный home побеждает. Поиск по исходнику требует `env` у каждого `spawn`/`spawnSync` (и запрещает `env: process.env`). Исключения — два read-only вызова настоящего git в репозитории (`git --exec-path` и `git check-ignore`) — перечислены регулярками, и каждое должно существовать. Комментарий над `describe` сужен до того, что верно.
  - Мутанты на `fda5c81e`, Windows, по одному: копия файла, мутант, `node scripts/vitest-electron.mjs test/contract/harness-evals.test.ts`, возврат из копии, `git diff --quiet` = 0 после каждого.

    | id | что меняет | итог | упало |
    | --- | --- | --- | --- |
    | E3a | `runClaude`: без проверки `win32` (`claude.endsWith('.mjs') ? …`) | выжил на Windows (там условие и так истинно); его ловит test «outside Windows starts a .mjs CLAUDE_BIN by its path» — на Mac не запускался | 0 |
    | E3b | `runClaude`: без `.endsWith('.mjs')` (на `win32` любой claude через `process.execPath`) | убит | 1 (новый test на `win32`) |
    | E3c | `runClaude`: без ветки `win32` (`false ? …`) | убит | 12 |
    | E6 | проверка `--version` — `spawnSync(claude, …)` вместо `runClaude` | убит | 12 |
    | E7 | вызовы run-ов — `spawnSync(claude, args, …)` вместо `runClaude` | убит | 9 |
    | E8 | E6 и E7 вместе | убит | 12 |
    | E12 | `git --exec-path` на `win32` — `spawnSync('git', …)` вместо `sh -c` | убит | 2 |
    | E13 | проверка копии на `win32` — `spawnSync(<обёртка>, ['--version'])` вместо `sh <обёртка>` | убит | 11 |
    | T4 | `harnessEnv` без `ELECTRON_RUN_AS_NODE` (только `-t "runs this process as Node"`: остальные test-ы открыли бы окно Electron) | убит | 2 из 4 |
    | T5 | `harness()` запускает скрипт по пути, не через `process.execPath` | убит | 1 («epic-status sees the four tickets»; 20 test-ов `bin/profile` пропущены до пункта 4) |
    | T6 | `frontMatter` — `\n` вместо `\r?\n` | убит | 20 |
    | T7 | stub: `const windows = false` | убит | 9 |
    | N1 | `childEnv`: `HOME`/`USERPROFILE` перед `...vars` | убит | 6 |
    | N3 | `inFixture` без `env` (только `-t "names its environment"`) | убит | 1 |

### Проверка

| Что | Результат |
| --- | --- |
| Красный сначала: новый `describe` против launcher-ов main `29f35f57` (файл main + этот `describe` + env трёх launcher-ов дословно из main) | exit 1, `Tests 9 failed \| 80 skipped (89)`: «USERPROFILE is HOME» ×4 — `expected undefined to be 'C:\Users\Alexey\AppData\Local\Temp\wo…'`; «os.homedir()» ×4 — `Expected: "C:\Users\Alexey\AppData\Local\Temp\worfy-eval-home-LbAEAV"`, `Received: "C:\Users\Alexey"`; поиск по исходнику — `expected '    const helper = lineOf(source.inde…' to match /\bHOME: home\b/` |
| Мутант 1: `childEnv` без `USERPROFILE` (копия файла, мутант, прогон, возврат из копии, `git diff --quiet` — 0) | exit 1, `Tests 9 failed \| 80 skipped (89)` — красные все 9 |
| Мутант 2: `inFixture` с `env: { ...fixtureEnv(home), HOME: home }` | exit 1, `Tests 1 failed \| 8 passed`: красный test поиска по исходнику, находка — эта строка |
| `node scripts/vitest-electron.mjs test/contract/harness-evals.test.ts`, main `29f35f57` (временный worktree, удалён) | exit 1, `Tests 52 failed \| 20 passed \| 8 skipped (80)` |
| То же, ветка `68fa7625` (после rebase на `77c473cb`, до снятия пропуска) | exit 0, `Tests 50 passed \| 39 skipped (89)` (+9 новых test-ов; пропуски: 8 прежних + 20 + 11) |
| То же, ветка `1b390da3` | **exit 0, `Tests 61 passed \| 28 skipped (89)`** (пропуски: 8 прежних + 20 `bin/profile` до пункта 4) |
| Мутант 3: `eval-harness.mjs` из `68fa7625` (без ветки `win32`), test-ы `1b390da3`; возврат из копии, `cmp` — равны | exit 1, `Tests 11 failed \| 50 passed \| 28 skipped (89)` — красные все 11 снятых пропусков |
| Мутант 4: только проверка `--version` без `sh` (поиск `git` через `sh` оставлен) | exit 1, `Tests 10 failed \| 51 passed \| 28 skipped (89)`; зелёный один «… `git --exec-path` gives no folder» — он проверяет только поиск |
| То же, после правок ревью; снимок `~/.claude/worfy-harness` и `~/.claude/gate` до и после — одинаковый | **exit 0, `Tests 61 passed \| 28 skipped (89)`** |
| Мутант 5: PATH без `/usr/bin`, `/bin`, `/mingw64/bin`, `/usr/local/bin` (нет `sh`), `-t "gives no folder"` | exit 1, `Tests 1 failed \| 88 skipped (89)`; до правки ревью этот test был зелёным |
| То же, раунд 2: `8db4afa9` → `fda5c81e` | exit 0, `Tests 61 passed \| 28 skipped (89)` → **exit 0, `Tests 72 passed \| 29 skipped (101)`** (+11 test-ов; +1 пропуск — test вне `win32`) |
| `test/unit/no-rmsync.test.ts`, `test/unit/e2e-no-spawn-on-load.test.ts` | exit 0, `Tests 63 passed (63)` |
| `CI=true pnpm lint` / `CI=true pnpm typecheck` | exit 0 / exit 0 |
| `git diff origin/main -- .gitattributes` | пусто |

Замер Ticket-а на `74455f70` (52 упали, 83 прошли, 8 пропущены — 143) с числами main `29f35f57` (80 test-ов) не сходится по общему числу; причина не выяснялась.

### Снимки настоящих папок

`C:\Users\Alexey\.claude\worfy-harness` и `C:\Users\Alexey\.claude\gate`, PowerShell (`pwsh -NoProfile`, `Get-ChildItem -Recurse -Force`: каждый файл с размером и `LastWriteTimeUtc`, каждая папка с временем). Снимок сделан до и после каждого прогона: красный прогон, шаг 1, замер `HOMEDRIVE`, шаги 2–3, опыт с `match`, финальный прогон ветки, прогон main — 15 снимков, все побайтно одинаковые (SHA-256 `F3E924B6A4F9E0315BFC12C31270BC18473C5EE55BEE6FB3EB11701D879B62F6`). В worfy-harness 128 файлов, 60 папок, 951656 байт, самое новое изменение — 2026-10-18 15:00:57 UTC; `C:\Users\Alexey\.claude\gate` нет ни до, ни после. Для `1b390da3` (Git Bash, `find ~/.claude/worfy-harness` — путь, размер, время изменения, `md5sum`) снимок до прогонов и после всех (база `68fa7625`, два мутанта, финальный прогон, lint) одинаковый: `44f4b5646e2088442c802f3e06cc54d1`; `~/.claude/gate` нет ни до, ни после.

<details><summary>Снимок до и после финального прогона (одинаковы; время — UTC)</summary>

```
ROOT worfy-harness 2026-10-18 14:21:56
D worfy-harness/.git 2026-10-18 15:00:57
F worfy-harness/.git/COMMIT_EDITMSG 109 2026-10-18 15:00:57
F worfy-harness/.git/config 130 2026-10-18 14:21:56
F worfy-harness/.git/description 73 2026-10-18 14:21:56
F worfy-harness/.git/HEAD 23 2026-10-18 14:21:56
D worfy-harness/.git/hooks 2026-10-18 14:21:56
F worfy-harness/.git/hooks/applypatch-msg.sample 478 2026-10-18 14:21:56
F worfy-harness/.git/hooks/commit-msg.sample 896 2026-10-18 14:21:56
F worfy-harness/.git/hooks/fsmonitor-watchman.sample 4726 2026-10-18 14:21:56
F worfy-harness/.git/hooks/post-update.sample 189 2026-10-18 14:21:56
F worfy-harness/.git/hooks/pre-applypatch.sample 424 2026-10-18 14:21:56
F worfy-harness/.git/hooks/pre-commit.sample 1649 2026-10-18 14:21:56
F worfy-harness/.git/hooks/pre-merge-commit.sample 416 2026-10-18 14:21:56
F worfy-harness/.git/hooks/pre-push.sample 1374 2026-10-18 14:21:56
F worfy-harness/.git/hooks/pre-rebase.sample 4898 2026-10-18 14:21:56
F worfy-harness/.git/hooks/pre-receive.sample 544 2026-10-18 14:21:56
F worfy-harness/.git/hooks/prepare-commit-msg.sample 1492 2026-10-18 14:21:56
F worfy-harness/.git/hooks/push-to-checkout.sample 2783 2026-10-18 14:21:56
F worfy-harness/.git/hooks/sendemail-validate.sample 2308 2026-10-18 14:21:56
F worfy-harness/.git/hooks/update.sample 3650 2026-10-18 14:21:56
F worfy-harness/.git/index 501 2026-10-18 15:00:57
D worfy-harness/.git/info 2026-10-18 14:21:56
F worfy-harness/.git/info/exclude 240 2026-10-18 14:21:56
D worfy-harness/.git/logs 2026-10-18 14:21:57
F worfy-harness/.git/logs/HEAD 639 2026-10-18 15:00:57
D worfy-harness/.git/logs/refs 2026-10-18 14:21:57
D worfy-harness/.git/logs/refs/heads 2026-10-18 14:21:57
F worfy-harness/.git/logs/refs/heads/master 639 2026-10-18 15:00:57
D worfy-harness/.git/objects 2026-10-18 15:00:57
D worfy-harness/.git/objects/2b 2026-10-18 15:00:57
F worfy-harness/.git/objects/2b/1c88dcb37b90dfaa4c38086868578a0877a71d 9312 2026-10-18 14:27:06
F worfy-harness/.git/objects/2b/b021ec8657a4f6e71497535fa028e5789a22c6 237 2026-10-18 15:00:57
D worfy-harness/.git/objects/3b 2026-10-18 14:21:57
F worfy-harness/.git/objects/3b/f9801319a9256a9c17ac1f1972d1d20dfc35b7 88 2026-10-18 14:21:57
D worfy-harness/.git/objects/41 2026-10-18 15:00:57
F worfy-harness/.git/objects/41/c04a6c9ad75c2bedcb23d5f648bd27ee2f457b 118 2026-10-18 15:00:57
D worfy-harness/.git/objects/46 2026-10-18 14:27:06
F worfy-harness/.git/objects/46/57f73b9aa7f74e646760ce2402c7fdac8e1c0e 1991 2026-10-18 14:27:06
D worfy-harness/.git/objects/59 2026-10-18 15:00:57
F worfy-harness/.git/objects/59/fa80d3f008334cc6dbb92076f2f8037d4becf3 783 2026-10-18 15:00:57
D worfy-harness/.git/objects/61 2026-10-18 14:21:57
F worfy-harness/.git/objects/61/0fbcd061d0c66d6aa932bcd26a0225c1080b0d 137 2026-10-18 14:21:57
D worfy-harness/.git/objects/64 2026-10-18 14:21:57
F worfy-harness/.git/objects/64/f135b96829bfdcb46cd07d1115cb7fe67b7d24 47 2026-10-18 14:21:57
D worfy-harness/.git/objects/67 2026-10-18 14:27:06
F worfy-harness/.git/objects/67/d8d7199ac6085f97b4ef74a8867638820c818d 206 2026-10-18 14:27:06
D worfy-harness/.git/objects/69 2026-10-18 15:00:57
F worfy-harness/.git/objects/69/a537012f8a99868a1ceaf193ab435489898766 56 2026-10-18 15:00:57
D worfy-harness/.git/objects/71 2026-10-18 14:21:56
F worfy-harness/.git/objects/71/6d041e64cc361f59498874c2c25a3dadf66682 1906 2026-10-18 14:21:57
D worfy-harness/.git/objects/74 2026-10-18 14:21:57
F worfy-harness/.git/objects/74/bebb25b8b25cd6f682e88419206875aaf51dab 56 2026-10-18 14:21:57
D worfy-harness/.git/objects/76 2026-10-18 14:27:06
F worfy-harness/.git/objects/76/e13d44c07ccf07ad38c1efc67043a9754f0ca1 47 2026-10-18 14:27:06
D worfy-harness/.git/objects/7e 2026-10-18 14:21:56
F worfy-harness/.git/objects/7e/e68455fe87c97903f15236ac7c30dc3812f60b 618 2026-10-18 14:21:57
D worfy-harness/.git/objects/af 2026-10-18 14:21:57
F worfy-harness/.git/objects/af/8e872f94ef17de0dd393673862f4b45b35d710 118 2026-10-18 14:21:57
D worfy-harness/.git/objects/b7 2026-10-18 14:27:06
F worfy-harness/.git/objects/b7/2a438b135af9412f0d1837a377459e79ca9999 88 2026-10-18 14:27:06
D worfy-harness/.git/objects/b8 2026-10-18 14:27:06
F worfy-harness/.git/objects/b8/be561a57c47b1cc9a597543c50ea4e4d1b5031 118 2026-10-18 14:27:06
D worfy-harness/.git/objects/dc 2026-10-18 14:21:56
F worfy-harness/.git/objects/dc/ca8aa59a08876f510b130ceb420aeb89208a5f 214 2026-10-18 14:21:57
D worfy-harness/.git/objects/e4 2026-10-18 14:21:56
F worfy-harness/.git/objects/e4/0e9b56c5879d7cfc0a26ad3f6e4eee475ecd66 9003 2026-10-18 14:21:57
D worfy-harness/.git/objects/info 2026-10-18 14:21:56
D worfy-harness/.git/objects/pack 2026-10-18 14:21:56
D worfy-harness/.git/refs 2026-10-18 14:21:56
D worfy-harness/.git/refs/heads 2026-10-18 15:00:57
F worfy-harness/.git/refs/heads/master 41 2026-10-18 15:00:57
D worfy-harness/.git/refs/tags 2026-10-18 14:21:56
F worfy-harness/.gitignore 324 2026-10-18 14:21:56
D worfy-harness/backup-2026-10-18-14-17-28 2026-10-18 14:17:30
D worfy-harness/backup-2026-10-18-14-17-28/claude 2026-10-18 14:17:30
D worfy-harness/backup-2026-10-18-14-17-28/claude/skills 2026-10-18 14:17:30
D worfy-harness/backup-2026-10-18-14-17-28/claude/skills/retro 2026-10-18 14:17:30
D worfy-harness/backup-2026-10-18-14-17-28/claude/skills/retro/agents 2026-10-18 14:17:30
F worfy-harness/backup-2026-10-18-14-17-28/claude/skills/retro/agents/openai.yaml 146 2026-10-18 14:17:30
F worfy-harness/backup-2026-10-18-14-17-28/claude/skills/retro/SKILL.md 4369 2026-10-18 14:17:30
F worfy-harness/backup-2026-10-18-14-17-28/manifest.json 527 2026-10-18 14:17:30
F worfy-harness/backup-2026-10-18-14-17-28/restore.mjs 15959 2026-10-18 14:17:30
D worfy-harness/gate 2026-10-18 14:58:19
F worfy-harness/gate/config.json 1371 2026-10-18 14:58:19
D worfy-harness/gate/state 2026-10-18 15:00:57
D worfy-harness/gate/state/cache 2026-10-18 15:00:57
F worfy-harness/gate/state/cache/worfy__9d7d336e__.__fast__7fdae646 41 2026-10-18 15:00:57
F worfy-harness/gate/state/nokey-broken-1a0bbcd8-576d36fd-5538-4e5a-b87c-d6aa9088d509 401 2026-10-18 08:48:05
F worfy-harness/gate/state/nokey-broken-9aca2b35-576d36fd-5538-4e5a-b87c-d6aa9088d509 401 2026-10-18 08:05:46
F worfy-harness/gate/state/nokey-broken-a1786a27-576d36fd-5538-4e5a-b87c-d6aa9088d509 401 2026-10-18 13:40:37
F worfy-harness/gate/state/nokey-broken-b15ae112-576d36fd-5538-4e5a-b87c-d6aa9088d509 402 2026-10-18 03:27:48
F worfy-harness/gate/state/nokey-broken-b2d66198-576d36fd-5538-4e5a-b87c-d6aa9088d509 401 2026-10-18 14:04:09
F worfy-harness/gate/state/nokey-broken-c3989f13-576d36fd-5538-4e5a-b87c-d6aa9088d509 405 2026-10-15 21:35:49
F worfy-harness/gate/state/red-worfy-0e9627f8 21 2026-10-16 02:20:16
F worfy-harness/gate/state/red-worfy-2a9eda03 21 2026-10-15 23:23:11
F worfy-harness/gate/state/red-worfy-3c94ecee 21 2026-10-16 01:11:50
F worfy-harness/gate/state/red-worfy-64f0fb55 21 2026-10-15 22:35:11
F worfy-harness/gate/state/red-worfy-c3989f13 21 2026-10-15 21:58:32
D worfy-harness/gate/state/stop-blocks 2026-10-09 01:45:25
F worfy-harness/gate/state/verdict-0e9627f8.json 227 2026-10-16 02:20:16
F worfy-harness/gate/state/verdict-1a0bbcd8.json 481 2026-10-18 08:48:06
F worfy-harness/gate/state/verdict-2a9eda03.json 227 2026-10-15 23:23:11
F worfy-harness/gate/state/verdict-3c94ecee.json 227 2026-10-16 01:11:50
F worfy-harness/gate/state/verdict-64f0fb55.json 227 2026-10-15 22:35:11
F worfy-harness/gate/state/verdict-9aca2b35.json 481 2026-10-18 08:05:48
F worfy-harness/gate/state/verdict-9d7d336e.json 230 2026-10-18 15:00:57
F worfy-harness/gate/state/verdict-a1786a27.json 481 2026-10-18 13:40:37
F worfy-harness/gate/state/verdict-b15ae112.json 482 2026-10-18 03:27:48
F worfy-harness/gate/state/verdict-b2d66198.json 481 2026-10-18 14:04:10
F worfy-harness/gate/state/verdict-c3989f13.json 228 2026-10-15 21:58:32
F worfy-harness/gate/state/verdict-efb3d1c9.json 456 2026-10-09 01:45:28
D worfy-harness/plugin 2026-10-18 14:16:55
D worfy-harness/plugin/.claude-plugin 2026-10-18 14:16:55
F worfy-harness/plugin/.claude-plugin/marketplace.json 558 2026-10-18 14:14:19
F worfy-harness/plugin/.claude-plugin/plugin.json 350 2026-10-18 14:14:50
F worfy-harness/plugin/.mcp.json 105 2026-10-18 14:14:19
D worfy-harness/plugin/agents 2026-10-18 14:16:55
F worfy-harness/plugin/agents/implementer.md 20732 2026-10-18 14:14:19
F worfy-harness/plugin/agents/reviewer.md 20137 2026-10-18 14:14:19
F worfy-harness/plugin/agents/scout.md 5733 2026-10-18 14:14:19
D worfy-harness/plugin/bin 2026-10-18 14:16:55
F worfy-harness/plugin/bin/decision-log 6614 2026-10-18 14:14:19
F worfy-harness/plugin/bin/epic-board 20798 2026-10-18 14:14:19
F worfy-harness/plugin/bin/epic-status 28082 2026-10-18 14:14:19
F worfy-harness/plugin/bin/preflight 38778 2026-10-18 14:14:19
F worfy-harness/plugin/bin/profile 28557 2026-10-18 14:14:19
F worfy-harness/plugin/bin/project-connect 26319 2026-10-18 14:14:19
F worfy-harness/plugin/bin/qmd-collections 19871 2026-10-18 14:14:19
F worfy-harness/plugin/bin/qmd-mcp 4863 2026-10-18 14:14:19
F worfy-harness/plugin/bin/qmd-refresh 9940 2026-10-18 14:14:19
F worfy-harness/plugin/bin/qmd-sync-main 6163 2026-10-18 14:14:19
F worfy-harness/plugin/bin/shortcut-ledger 9359 2026-10-18 14:14:19
F worfy-harness/plugin/bin/silent-check 12684 2026-10-18 14:14:19
F worfy-harness/plugin/bin/ticket 42014 2026-10-18 14:14:19
F worfy-harness/plugin/bin/TICKETS.md 5369 2026-10-18 14:14:19
F worfy-harness/plugin/bin/wave-gate 44907 2026-10-18 14:14:19
F worfy-harness/plugin/bin/worktree-lock 12605 2026-10-18 14:14:19
D worfy-harness/plugin/hooks 2026-10-18 14:16:55
F worfy-harness/plugin/hooks/eval-env.cjs 2820 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/gate-paths.mjs 5108 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/gate-resolve.mjs 10984 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/gate.mjs 53180 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/gate.sh 7732 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/gh-token-env.mjs 5980 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/guard.mjs 18657 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/hooks.json 3338 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/inject-rules.mjs 2986 2026-10-18 14:14:19
D worfy-harness/plugin/hooks/rules 2026-10-18 14:16:55
F worfy-harness/plugin/hooks/rules/common.md 5478 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/rules/orchestrator.md 9429 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/session-end.mjs 3202 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/session-start.mjs 10889 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/stop.mjs 12000 2026-10-18 14:14:19
F worfy-harness/plugin/hooks/worktree-create.sh 5773 2026-10-18 14:14:19
F worfy-harness/plugin/package.json 366 2026-10-18 14:14:19
D worfy-harness/plugin/profiles 2026-10-18 14:16:55
F worfy-harness/plugin/profiles/draft.schema.json 10134 2026-10-18 14:14:19
F worfy-harness/plugin/profiles/README.md 52824 2026-10-18 14:14:19
F worfy-harness/plugin/README.md 9573 2026-10-18 14:14:19
D worfy-harness/plugin/skills 2026-10-18 14:16:55
D worfy-harness/plugin/skills/connect-project 2026-10-18 14:16:55
F worfy-harness/plugin/skills/connect-project/SKILL.md 7242 2026-10-18 14:14:19
D worfy-harness/plugin/skills/continuous-audit 2026-10-18 14:16:55
F worfy-harness/plugin/skills/continuous-audit/SKILL.md 16594 2026-10-18 14:14:19
D worfy-harness/plugin/skills/epic-wave 2026-10-18 14:16:55
F worfy-harness/plugin/skills/epic-wave/SKILL.md 92783 2026-10-18 14:14:19
D worfy-harness/plugin/skills/gate-queue 2026-10-18 14:16:55
F worfy-harness/plugin/skills/gate-queue/SKILL.md 13566 2026-10-18 14:14:19
D worfy-harness/plugin/skills/max-review 2026-10-18 14:16:55
F worfy-harness/plugin/skills/max-review/SKILL.md 12651 2026-10-18 14:14:19
D worfy-harness/plugin/skills/overnight-fix-loop 2026-10-18 14:16:55
F worfy-harness/plugin/skills/overnight-fix-loop/SKILL.md 25101 2026-10-18 14:14:19
D worfy-harness/plugin/skills/qmd 2026-10-18 14:16:55
F worfy-harness/plugin/skills/qmd/SKILL.md 8395 2026-10-18 14:14:19
D worfy-harness/plugin/skills/retro 2026-10-18 14:16:55
F worfy-harness/plugin/skills/retro/SKILL.md 7077 2026-10-18 14:14:19
D worfy-harness/plugin/skills/ship-ticket 2026-10-18 14:16:55
F worfy-harness/plugin/skills/ship-ticket/SKILL.md 58510 2026-10-18 14:14:19
D worfy-harness/plugin/skills/tickets-to-tasks 2026-10-18 14:16:55
F worfy-harness/plugin/skills/tickets-to-tasks/SKILL.md 6200 2026-10-18 14:14:19
D worfy-harness/projects 2026-10-18 14:21:56
D worfy-harness/projects/worfy 2026-10-18 14:26:59
F worfy-harness/projects/worfy/profile.json 4353 2026-10-18 14:26:55
F worfy-harness/projects/worfy/rules.md 21144 2026-10-18 14:26:59
D worfy-harness/worktree-sessions 2026-10-18 00:05:54
F worfy-harness/worktree-sessions/C-Users-Alexey-AppData-Local-Temp-worfy-01-wt456-a1f8cd65.json 3 2026-10-18 00:05:54
F worfy-harness/worktree-sessions/C-Users-Alexey-REA-e0a6d78e.json 3 2026-10-17 11:29:09
F worfy-harness/worktree-sessions/C-Users-Alexey-worfy-efb3d1c9.json 197 2026-10-17 06:47:00
MISSING gate
```

</details>

### Пункт 4 — пути реестра fixture-а (2026-10-19, после мержа PR #496, main `2e8fb988`)

- **Выбор.** `harness/evals/lib/demo-project.sh` пишет `match` и `pm` реестра Gate в написании node, а не
  через нормализацию в test-е: эти пути читают `bin/profile` и `gate.mjs`, и чинить надо то, что они читают.
  В Git Bash (там, где работает `pwd -W`) написание — `realpathSync.native(".")` node с `/` (JSON без
  экранирования). Не `pwd -W`: он оставляет короткое 8.3-имя (TEMP runner-а `C:\Users\RUNNER~1`) и букву
  диска `subst`, а git и node пишут длинное. Замер: с `pwd -W` и `TEMP=TMP=W:\` (`subst`) — 10 test-ов
  «bin/profile -C <fixture> exits 0» красные, с написанием node — зелёные. На Mac `pwd -W` не работает, и
  fixture пишет то же, что раньше (`pwd -P`).
- **`pm` на Windows.** Gate ищет `<pm>` с расширениями PATHEXT и запускает `.cmd` через `cmd.exe`; скрипт
  с shebang Windows не запускает («gate: …/demo-pm: command not found», exit 3 «ПРОВЕРИТЬ НЕ УДАЛОСЬ»).
  Поэтому в Git Bash fixture пишет рядом с `demo-pm` и `demo-pm.cmd` — тот же `run test` → `node --test`.
  В реестре по-прежнему `…/demo-pm`.
- **Пропуск `registryPathsMatch` снят:** 32 test-а идут на `win32` — по 10 случаев в трёх группах
  («bin/profile -C <fixture> exits 0 with profile demo», «a scaffold without EVAL_* leaves state …», «with
  EVAL_HARNESS_HOME the state goes to …») и два test-а gate («the gate of the fixture needs no npm …»,
  «gate fast of the fixture is red (exit 2) …»).

| Прогон (ПК, gh вне PATH) | Exit | Итог |
|---|---|---|
| `harness-evals.test.ts`, обычный TEMP | 0 | 119 passed, 9 skipped (128) |
| то же, `TEMP=TMP=W:\` | 0 | 119 passed, 9 skipped (128) |
| мутант: `demo-project.sh` с main, test-ы без пропуска | 1 | 32 failed, 87 passed, 9 skipped |
| head PR #496 `70040753` (замер ПК до мержа, оба TEMP) | 0 | 87 passed, 41 skipped |

Девять оставшихся пропусков на `win32` были и до шага 4, у каждого — комментарий с причиной.

- **Правка после ревью (линза «корректность»).** Test «the gate of the fixture needs no npm» проверял
  `relative(work, pm)`, где `work` — обычный `realpathSync` (8.3-имя TEMP runner-а остаётся), а `pm` теперь
  длинный: на runner-е он упал бы. Теперь обе стороны — `realpathSync.native`, и абсолютный ответ `relative`
  (разные диски) тоже считается «вне fixture-а»: раньше при `TEMP=W:\` проверка проходила, ничего не
  проверяя. Мутант «`pm` — копия вне fixture-а» красный в обоих TEMP (`harness-evals.test.ts:356`).

### Что не проверено

- Пункт 4 на Mac: Session на Mac сверяет, что число test-ов `harness-evals` и их итог там не изменились.
- На Mac не запускалось ничего: красный test шага 1 и мутант на Mac, `pnpm lint`, `pnpm typecheck`, `pnpm test` там — за Session на Mac. На Mac новый test «os.homedir()» зелёный и без `USERPROFILE` (Node там берёт `HOME`); test «USERPROFILE is HOME» красный без него на всех системах — по замыслу Ticket-а, не проверено запуском.
- Ветка `.mjs` в `runClaude` (`eval-harness.mjs`) есть только на `win32`; на Mac она не идёт. На ПК её проходят все test-ы со stub-ом.
- Раунд 2: test «outside Windows starts a .mjs CLAUDE_BIN by its path» на ПК пропущен и на Mac не запускался; мутант E3a на Mac не проверен. Снимок `find ~/.claude/worfy-harness ~/.claude/gate | sort | md5sum` до и после финального прогона одинаковый (`172741c2…`); со старта Session он изменился один раз — `gate/state/verdict-02c8f6a5.json` от gate worktree `14-migrate` (другая Session, 13:36), test-ы этого Ticket-а туда не пишут.
- `1b390da3` на Mac не запускался: ветки `win32` в `eval-harness.mjs` и в stub-е там не идут, а усиленные проверки («… --version, exit 1)», «… gives no folder» с `exit 1)` и «два вызова, `main exited N`, `gui exited M`, пути результатов» в «exits with the worst code …») там должны быть зелёными — не проверено запуском. Ветки `win32` проходят только test-ы на ПК; workflow «Windows tests» не запускался.

### Закрытие (2026-10-20)

Пункты 1–3 и 5 вошли в main с PR #517 (2026-10-19, `16931520`), пункт 4 — с PR #533 (2026-10-19, `a79f6102`). Ticket закрыт docs-PR-ом с ПК по просьбе Session на Mac; в `PR:` — #517, PR пункта 4 — #533.
