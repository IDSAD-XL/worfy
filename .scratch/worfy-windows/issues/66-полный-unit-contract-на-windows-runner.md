# 66 — Полный `pnpm test` на Windows-runner-е GitHub: второй режим «Windows tests», его run — вердикт Windows для части платформенных PR

Type: task
Status: open
Blocked by: 14 (часть unit/contract), 65
Source: решение владельца 2026-10-19 (пункты 2–3: полный unit/contract на `windows-latest`, run на head платформенного PR и на main вместе с batch CI); [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) «Windows runner counts as the Windows verdict»; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2; [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md) (отметка `check/windows` на SHA); [ADR-0068](../../../docs/adr/0068-batch-ci-on-main-once-per-wave.md) (batch CI); [Ticket 25](25-ручной-job-windows-для-списка-test-файлов.md) (workflow «Windows tests»).

## Что происходит

- Вердикт Windows для платформенного PR (ADR-0056, пункт 2) — gate full на ПК владельца на head PR.
  Отметку `check/windows` ставит Orchestrator на Mac по отчёту Session на ПК (ADR-0067). Каждый
  сдвиг head (rebase на свежий main, правка круга ревью) — снова gate full на ПК и снова gate full на
  Mac; отчёты идут между Session-ами через репозиторий и владельца; e2e на каждой машине — по одному,
  под замком. Цена этого цикла — ADR-0071, «Контекст».
- Workflow «Windows tests» (`.github/workflows/windows-tests.yml`, Ticket 25) гоняет только список
  от 1 до 12 файлов `test/unit/` и `test/contract/`, один job, 10 минут: весь `pnpm test` на Windows был
  красным (около 700 упавших test-ов на 2026-10-12), и на runner он не должен был попадать. Пределы
  закреплены в `test/contract/windows-tests-workflow.test.ts`: один job, без `if`, один input
  `files`, никогда `pnpm test`.
- После части unit/contract Ticket-а 14 и Ticket-а 65 `pnpm test` на Windows — код 0 на main. Тогда
  полный unit/contract на чистой Windows дешевле и быстрее, чем gate full на ПК, для PR, которые не
  трогают то, что runner проверить не может: Terminal (ConPTY, PowerShell), окна, меню и уведомления,
  e2e и упаковку.

## Что делаем

1. **Второй режим workflow.** `windows-tests.yml` получает input `mode`: `files` (по умолчанию —
   сегодняшний режим, пределы без изменений: от 1 до 12 файлов, проверка
   `scripts/windows-test-list.mjs` первым шагом, 10 минут) и `full`. Режим `full` — отдельный job
   (`runs-on: windows-latest`, без matrix, `if` по `mode`), шаги: checkout, pnpm, node, install,
   `pnpm test` (unit и contract, без e2e, `test:package` и acceptance). Один dispatch запускает ровно
   один job. Триггер — только `workflow_dispatch`, как сейчас. `files` в режиме `full` — отказ, а не
   молчаливый пропуск; пустой `files` в режиме `files` — отказ, как сейчас.
2. **Предел времени по замеру.** Первый run режима `full` на main — с согласия владельца, с
   временным пределом 30 минут. Предел job-а — замер, умноженный на 1,5 и округлённый вверх до 5
   минут. Замер (install и `pnpm test` отдельно), предел и ссылка на run — в Итог.
3. **Пределы — в test-е.** `test/contract/windows-tests-workflow.test.ts` закрепляет оба режима так же,
   как сейчас один: единственный триггер `workflow_dispatch`; `permissions: contents: read`; два job-а,
   у каждого своё `if` по `mode`, `runs-on: windows-latest`, без matrix; `timeout-minutes` каждого —
   ровно своё число; шаги режима `full` — ровно перечисленные, команда — `pnpm test`, без e2e,
   `test:package` и acceptance; шаги режима `files` и проверка списка — как сейчас.
4. **Какой PR закрывает run, а какой ждёт ПК — скрипт, не суждение.**
   `scripts/windows-verdict-scope.mjs <base> <head>` берёт `git diff --name-only <base>...<head>` и
   сверяет со списком путей в самом скрипте. Совпал хоть один путь — печатает `pc` и совпавшие пути,
   код выхода 1; не совпал ни один — печатает `runner`, код 0. Начальный список (исполнитель сверяет с
   деревом и дописывает в Итог, что изменил):
   - Terminal: `src/main/terminal/**`, `src/main/terminal-ai/**`, `src/main/ipc/terminal*.ts`,
     `src/main/ipc/shell.ts`, `src/renderer/canvas/nodes/Terminal*`, `src/renderer/canvas/nodes/terminal-*`,
     `test/**/terminal*`;
   - окна, меню, уведомления: `src/main/window.ts`, `src/main/window-frame.ts`,
     `src/main/quiet-windows.ts`, `src/main/menu.ts`, `src/main/notify.ts`, `src/main/notify-pending.ts`,
     `src/main/dock-icon.ts`;
   - e2e: `test/e2e/**`, `playwright.config.ts`, `playwright.acceptance.config.ts`;
   - упаковка: `electron-builder.yml`, `build/**`, `electron.vite.config.ts`, `package.json`,
     `pnpm-lock.yaml`, `scripts/install-stable.mjs`, `scripts/make-icons.mjs`, `scripts/ico.mjs`,
     `scripts/postinstall.mjs`.
   Обычный PR (не платформенный по ADR-0056, пункт 2) скрипт не меняет: ему по-прежнему `skipped`.
5. **Порядок для Orchestrator-а на Mac** — в тексте Harness, где сегодня описан Check «windows»
   (skill `epic-wave`, раздел 4 «Merge by policy», отметки `check/<name>`, `:760-800`):
   - платформенный PR: `windows-verdict-scope` на base и head PR. `runner` — dispatch
     `gh workflow run windows-tests.yml --ref <ветка> -f mode=full`; run, у которого `headSha` равен
     head PR, с `conclusion: success` — `ticket mark <эпик> <NN> check/windows success --sha <head>`;
     красный run — `failure`. Сдвиг head — новый run. `pc` — как сегодня: gate full на ПК (ADR-0056);
   - main: вместе с каждым batch CI dispatch (`wave-gate ci`, ADR-0068) — dispatch режима `full` на
     `main`. Красный run на main — как красный batch CI run: Autopilot run останавливается после
     Wave, сбой — новый Ticket или строка `blocked`, исправление вперёд.
6. **Комментарий в начале `windows-tests.yml`** описывает оба режима: кто запускает (владелец;
   Orchestrator Session на Mac — режим `files` перед мержем PR с кодом для Windows, режим `full` — на
   head платформенного PR со скриптом `runner` и на main вместе с batch CI; больше никто), цена
   (минута Windows — $0.010; run режима `full` — замер из пункта 2, в минутах и долларах; потолок —
   предел job-а) и что run не заменяет: gate full на ПК для PR со скриптом `pc`.

**Не входит:** e2e, `test:package` и acceptance на runner-е; триггер `pull_request` или `push` (Q23 —
Windows-раннера на PR нет); gate full на ПК для PR, которые трогают Terminal, окна, e2e или упаковку
(ADR-0056 для них не меняется); правка Profile-а на машине (`workflow.ci_batch_run`, `rules.md`) — шаг
Orchestrator-а после мержа, команды — в Итог.

## Готово, когда

- [ ] `test/contract/windows-tests-workflow.test.ts` закрепляет оба режима (пункт 3); каждый ослабленный
      предел — мутант в своём worktree — делает test красным; таблица мутантов — в Итог.
- [ ] `git diff origin/main -- .github/workflows/windows-tests.yml`: шаги и пределы режима `files` те
      же; новый job — только при `mode: full`.
- [ ] Один run режима `full` на main — с согласия владельца (минута Windows — $0.010): job зелёный,
      ссылка, минуты и цена — в Итог. Без согласия пункт — «не проверено», с причиной.
- [ ] Один run режима `files` после правки — с тем же согласием: идёт только job списка, как до
      правки; ссылка — в Итог.
- [ ] `scripts/windows-verdict-scope.mjs` на трёх PR из истории main — один только с документами или
      Harness без Terminal (`runner`), один с Terminal (`pc`), один с `test/e2e/**` (`pc`); номера PR и
      вывод — в Итог.
- [ ] Текст Harness (пункт 5) называет скрипт, команду dispatch и проверку `headSha`.
- [ ] На Mac `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

Сначала падающий test — `test/contract/windows-tests-workflow.test.ts` с ожиданием второго job-а и
input-а `mode` на неизменённом workflow.

- `test/contract/windows-tests-workflow.test.ts` — оба режима, пределы каждого.
- `test/contract/windows-verdict-scope.test.ts` — временный git-репозиторий: diff только с документами —
  `runner`, код 0; по одному пути из каждой группы списка — `pc`, код 1, путь в выводе; переименование
  файла из списка в путь вне него — `pc` (смотрим обе стороны); пустой diff — `runner`.

## Где в коде

- `.github/workflows/windows-tests.yml`
- `test/contract/windows-tests-workflow.test.ts`
- `scripts/windows-test-list.mjs` — только если отказ `files` при `mode: full` делает он
- `scripts/windows-verdict-scope.mjs` (новый)
- `test/contract/windows-verdict-scope.test.ts` (новый)
- `harness/skills/epic-wave/SKILL.md` (раздел 4 «Merge by policy», отметки `check/<name>`, `:760-800`)

## Вне скоупа

- Режим `full` на Mac-runner-е или в `ci.yml`.
- Как Orchestrator ждёт run (`gh run watch`) и где пишет его id — тем же способом, что batch CI
  (`wave-gate ci`); отдельной правки `bin/wave-gate` здесь нет, если хватает пункта 5.

## Риски

- runner — не ПК: права администратора, другой образ, `core.autocrlf` включён. Test, зелёный на ПК и
  красный на runner-е, — исправление вперёд или пропуск с причиной, не ослабление пределов.
- Неполный список путей пропускает платформенный PR мимо ПК. Ошибка в сторону `pc` стоит лишнего
  gate full; в сторону `runner` — регрессии, которую увидит следующий gate full на ПК.

## Итог

Ветка `worfy-windows/66` от main `0437d084`. Правка `.github/workflows/windows-tests.yml` — ровно в
одном коммите, последнем в ветке (токен ПК не пушит `.github/workflows/*`); её патч —
`C:/Users/Alexey/worfy-wt/pr66-workflow.patch`, его пушит Mac. Все остальные правки — в коммитах
раньше. PR не открыт, push не делался. Круг 1 ревью (замечания Mac) — в последнем разделе.

**Что сделано.**

- `windows-tests.yml`: input `mode` — `type: choice`, `files` (по умолчанию) и `full`, `required: true`;
  input `files` стал `required: false` (иначе dispatch `-f mode=full` без списка GitHub отклоняет);
  пустой список в режиме `files` по-прежнему отказывает `scripts/windows-test-list.mjs`. Два job-а:
  `listed-tests` (`if: inputs.mode == 'files'`, шаги и 10 минут — без изменений) и `full-suite`
  (`if: inputs.mode == 'full'`, `windows-latest`, без matrix, 45 минут). Шаги `full-suite`: отказ от
  списка (первым, до checkout: непустой `files` — `::error::` и код 1; вход через `env`), checkout,
  setup-node, corepack, setup-node с кэшем pnpm, `pnpm install --frozen-lockfile`, `pnpm test`
  (шаг «Run the whole unit and contract suite»). Комментарий в начале описывает оба режима, кто
  запускает, цену ($0.10 и $0.45 потолок) и что run не заменяет. `scripts/windows-test-list.mjs` не
  менялся: отказ списка в режиме `full` — шаг самого job-а.
- **Предел 45 минут — временный** (в круге 1 поднят с 30: `test/contract/harness-scripts.test.ts`
  один идёт на ПК около 26 минут, `RUNS_ON_THE_PC` в `scripts/windows-test-list.mjs`, и сверху
  install). Окончательный — замер первого run-а `full` на main × 1,5, с округлением вверх до 5 минут
  (в workflow — комментарий `shortcut:` с этим условием). Замер ещё не сделан: run запускает Mac после
  открытия PR.
- `scripts/windows-verdict-scope.mjs <base> <head>`: `git diff --name-only --no-renames -z
  <base>...<head>` (переименование — обе стороны), сверка со списком `PC_ONLY`; совпадение — `pc` и
  пути, код 1; нет — `runner`, код 0; пустой diff — `runner`; неверные аргументы или ошибка git —
  код 2, без вердикта. `**/` — любое число папок, в том числе ноль; `*` — без `/`.
- `harness/skills/epic-wave/SKILL.md` — общее правило без внутренностей worfy (см. «Отступление от
  Ticket-а»): в разделе 4, «Checks before merge», пункт «A check a CI runner may answer»; рядом с
  batch CI — абзац «A run that goes with the batch CI run» с блоком, который пишет dispatch в CI-файл.
- `harness/bin/tests/plugin-neutral.test.sh` (по просьбе Mac, больше ничего в `harness/bin/tests`):
  новый запрещённый шаблон — файлы `scripts/*.{mjs,cjs,js,ts,sh}` и `.github/workflows/*.y(a)ml`.
  Исключения для того, что уже было в дереве: скрипт фикстуры `shortcut-ledger.test.sh`
  (`scripts/make.sh`), `harness/README.md` (`scripts/eval-harness.mjs`,
  `scripts/eval-harness-coverage.mjs`) и `harness/bin/ticket:138` (`scripts/install-stable.mjs`) —
  известные утечки, их убирать отдельно. Дерево проходит; мутант — строка `` `node scripts/x.mjs` ``
  или `` `.github/workflows/ci.yml` `` в `harness/skills/qmd/SKILL.md` — красный (код 1, строка
  названа).

**Отступление от Ticket-а, пункт 5, — по ADR-0074 (решение Mac в круге 1).** Пункт 5 просил назвать в
тексте Harness скрипт, команду dispatch и job. ADR-0074, пункт 1: plugin не говорит о внутренностях
репозитория worfy. Поэтому `SKILL.md` не называет ни `scripts/windows-verdict-scope.mjs`, ни
`windows-tests.yml`, ни job `full-suite`, ни Windows-ПК: правила проекта (`rules.md`) называют команду
scope, команду dispatch, workflow, job и шаг test-ов; skill говорит, что с ними делать. Конкретные
команды worfy — в `rules.md` обеих машин (ниже). Цена: без правки `rules.md` после мержа Orchestrator
не знает команд, и правило skill-а не срабатывает (до правки всё идёт по-старому, gate full на ПК).

**Что говорит skill** (общее правило). PR: scope-команда на свежем checkout main, не ветки PR. Код 0 —
один dispatch, отметка `pending`, строка в журнале решений. Run ищется по `headSha` = head PR:
самый новый, у которого названный job не `skipped`. Не нашёлся — искать снова раз в минуту до
шести раз, но никогда не dispatch повторно: каждый dispatch — платный run. Дальше `gh run watch`
и чтение job-а. `success` — `success`. `failure` только при упавшем шаге test-ов — `failure`.
Run упёрся в предел (`timed_out` или `cancelled` примерно через `timeout-minutes`) — без отметки и
без нового dispatch, в отчёте run, минуты и предел, чтобы предел подняли. Любой другой конец
(checkout, install, отказ input-а, отмена руками) — без отметки, без dispatch. Код 1 — путь из правил
(gate full на ПК). Другой код — нет вердикта. main: блок сразу после `wave-gate ci`. Он берёт коммит
записанного batch CI run-а, делает один dispatch и пишет его в CI-файл (`extra_runs.<имя>`:
команда, коммит, время, `superseded`). Повторный вызов на том же коммите не делает dispatch. Id run-а
записывается тем же CI-файлом (`jq … '.extra_runs[$n] += {run_id, url}'`). Строка в журнале решений и
в отчёте Wave — как у batch CI. Красный — как красный batch CI. Упёрся в предел — не проверено, без
dispatch.

**`bin/wave-gate` не менялся, и правка не нужна:** `wave-gate ci` читает CI-файл целиком и пишет его
обратно целиком (`save`), чужой ключ `extra_runs` не теряется. Пробел: `wave-gate` сам не знает о
втором run-е — dispatch, поиск id и ожидание делает Orchestrator по skill-у, а не `wave-gate ci`
(вопрос в PR body). Блок проверен руками во временной папке (не test-ом: `harness/bin/tests` трогать
нельзя): первый вызов — dispatch, второй на том же коммите — `EXTRA_RUN=recorded`, без dispatch;
новый коммит `ci_run` — новый dispatch, старая запись в `superseded`; два вызова stand-in-а dispatch
на два коммита; без batch run-а и при упавшем dispatch — код 1, ничего не записано.

**Список путей скрипта сверен с `git ls-files` на `0437d084`.** Все пути начального списка есть в
дереве; `src/main/menu.ts`, `src/main/notify.ts` и `src/main/notify-pending.ts` — в списке. Добавлено
(ошибка в сторону `pc` стоит лишнего gate full, в сторону `runner` — пропущенной регрессии):

- Terminal: `src/shared/ipc/terminal*.ts` (пара к `src/main/ipc/terminal*.ts`),
  `src/shared/terminal/**` (ответы курсора терминала), `src/renderer/canvas/ReadOnlyTerminal.tsx`
  (xterm-вид вне `nodes/`);
- окна, меню, уведомления: `src/main/window-show.ts`, `src/shared/window/**` (границы окна),
  `src/main/ipc/menu.ts`, `src/main/ipc/notify.ts`; в круге 1 по решению Mac —
  `src/main/broadcast.ts`, `src/main/settings/interface-scale.ts`, `src/shared/ipc/menu.ts`,
  `src/shared/ipc/notify.ts`;
- e2e: `test/acceptance/**` (Playwright-приёмка, на runner-е не идёт);
- упаковка и установка: `pnpm-workspace.yaml` (`allowBuilds` для node-pty и electron, `engineStrict`),
  `scripts/build-version.ts`, `scripts/dev-bundle.ts` (их читает `electron.vite.config.ts`);
- правила самого run-а — PR, который их меняет, не должен получать вердикт от своего же run-а
  (`--ref <ветка>` берёт workflow и конфиг из ветки): `.github/workflows/windows-tests.yml`,
  `scripts/windows-verdict-scope.mjs`, `scripts/vitest-electron.mjs`, `vitest.config.ts`. Этот PR
  поэтому сам — `pc`.

Не добавлено: `src/main/index.ts` (по решению Mac: связывает все модули main process, его трогает
почти каждый PR с кодом main; поведение на Windows живёт в модулях списка — комментарий в скрипте);
`src/shared/terminal-ai/**` и `src/renderer/settings/*TerminalAi*` (чистая логика и UI настроек, их
полностью гоняют unit-test-ы); `src/main/autopilot/power.ts` (`powerSaveBlocker`, не
окна/меню/уведомления); `src/main/workflow/waits-notify.ts` (без Electron API);
`src/renderer/settings/settings-window.ts` и `src/renderer/shortcuts/shortcuts-window.ts` (модули
renderer-а, окон не создают); `test/unit/e2e-*.test.ts` (unit-test-ы, на runner-е идут). Удалено
ничего.

**Три PR из истории main** (локальный `git log origin/main --first-parent`, squash-коммиты с
`(#N)`, без сети; base — родитель коммита):

- #738 (`b1dd0ff8`, только Harness и тикет: `harness/skills/epic-wave/SKILL.md`, два
  `harness/bin/tests/*.test.sh`, файл тикета) — `runner`, код 0;
- #747 (`8f5238c8`, Terminal Git Bash) — `pc`, код 1: `src/main/terminal/pty.ts`,
  `src/main/terminal/windows-pty.ts`, `test/contract/terminal-git-bash-close.test.ts`,
  `test/contract/terminal-harness.ts`, `test/contract/terminal-windows.test.ts`,
  `test/unit/terminal-git-bash-close.test.ts`, `test/unit/terminal-shell.test.ts`;
- #741 (`1ba05450`, Browser с e2e) — `pc`, код 1: `test/e2e/browser-sleep.spec.ts` (остальные
  файлы — `src/main/browser/*`, не в списке).

Из 60 последних PR main 32 — `runner`, 28 — `pc` (список до круга 1).

**Test скрипта закрепляет каждый пункт `PC_ONLY`:** список в скрипте равен списку в test-е, в том
же порядке; файл каждого пункта есть в `git ls-files` репозитория (только чтение); каждый файл в
временном репозитории даёт `pc`. Вложенные случаи: `src/main/terminal/zsh/rc.d/10-assist.zsh`,
`src/main/terminal-ai/features/suggest.ts`, `build/brand/icon.svg`, `src/shared/window/bounds.ts`,
`src/shared/window/deep/frame.ts`, `test/acceptance/fixtures/silent-repo/src/index.js`. git в
test-е — без системного и пользовательского конфига (`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL` —
пустой временный файл) и без унаследованных `GIT_*`; так же запускается git самого скрипта.

**Мутанты** (каждый — правка файла в worktree, прогон одного test-файла, восстановление из копии в
памяти; после прогона sha1 обоих файлов совпал с исходным):

| Мутант | Красный test |
| --- | --- |
| лишний триггер `push` | starts by hand only |
| matrix в `full-suite` | has two jobs … no matrix |
| нет `if` у `full-suite` / у `listed-tests`; `full-suite` с `if` на `files` | has two jobs … |
| `timeout-minutes` 30 у `full-suite`; 45 у `listed-tests` | stops the job … after 10 … after 45 |
| `pnpm test` в режиме `files` | mode files: steps, run step, never the whole suite (3) |
| `pnpm test:e2e` в `run` режима `full`; отдельный шаг e2e | mode full: steps; no e2e (2) |
| лишний шаг в режиме `full` / в режиме `files` | mode full: steps / mode files: steps (3) |
| шаг отказа удалён; отказ всегда пропускает | env expressions, corepack, steps (3) / steps |
| `default: full`; `files` `required: true`; `mode` — `type: string` | takes two inputs |
| `contents: write` | may only read the repository |
| скрипт: без `--no-renames` | rename out of the list is pc |
| скрипт: `..` вместо `...` | a later change on the base does not count |
| скрипт: пункт `test/e2e/**` убран | список; файл пункта; e2e helper in a subfolder (4) |
| скрипт: `**/` требует папку | a Terminal helper right under test/ |
| скрипт: `src/main/terminal/**` → `/*` | список; `rc.d/10-assist.zsh` (2) |
| скрипт: `src/main/terminal-ai/**` → `/*` | список; `features/suggest.ts` (2) |
| скрипт: `build/**` → `build/*` | список; `build/brand/icon.svg` (2) |
| скрипт: пункт `src/shared/window/**` убран | список; `bounds.ts`; `deep/frame.ts` (3) |
| скрипт: `pc` с кодом 0 | 55 test-ов |
| скрипт: ошибка git читается как `runner` | no verdict when git cannot compute the diff |
| `plugin-neutral`: `` `node scripts/x.mjs` `` / `` `.github/workflows/ci.yml` `` в skill-е | код 1, строка названа |

Мутант «`**/` требует папку» в первом круге выжил; добавлен случай `test/terminal-helper.ts`, после —
красный.

**Проверки на ПК** (идёт cod.exe: только лёгкие прогоны, без полного `pnpm test`) — в последнем
разделе, по кругам.

**Не проверено.**

- Пункты «Готово, когда» «Один run режима `full` на main» и «Один run режима `files` после
  правки» — не проверено: run запускает Mac после открытия PR (с согласия владельца, минута Windows —
  $0.010). Ссылки, минуты (install и `pnpm test` отдельно), цена и окончательный предел — после этих
  run-ов.
- `pnpm test` на Mac — код 0 (пункт «Готово, когда» для Mac).
- Shell-test-ы Harness, которые режут блоки `epic-wave/SKILL.md` (`skill-blocks`, `wave-gate`,
  `decision-log`, `silent-mode`): новый блок не содержит их якорей, но на ПК они не запускались
  (весь набор — около 26 минут). Новый блок `extra_runs` test-ом не покрыт — только ручная проверка
  выше.

**После мержа — шаг Orchestrator-а на обеих машинах (вне PR).** `workflow.ci_batch_run` не менять:
`wave-gate ci` ищет run по имени workflow после `gh workflow run`, и вторая команда в той же строке
его бы сбила. В `rules.md` абзац «Исключения из правила о платных прогонах» заменить на два режима и
добавить правила для skill-а:

- «Workflow «Windows tests» (`.github/workflows/windows-tests.yml`) — два режима. `files`: от 1 до 12
  файлов из `test/unit/` и `test/contract/`, job `listed-tests`, 10 минут:
  `gh workflow run windows-tests.yml --ref <ветка> -f files="…"`. `full`: весь `pnpm test`, job
  `full-suite`, предел по замеру (до замера 45 минут): `gh workflow run windows-tests.yml --ref $ref -f mode=full`.»
- «Check `windows` может ответить run (ADR-0071). Команда scope —
  `node scripts/windows-verdict-scope.mjs <base> <head>` (код 0 — `runner`, 1 — `pc`, 2 — нет
  вердикта); команда dispatch — `gh workflow run windows-tests.yml --ref $ref -f mode=full`; workflow —
  `windows-tests.yml`; job — `full-suite`; шаг test-ов — `Run the whole unit and contract suite`.
  `pc` — gate full на Windows-ПК (ADR-0056).»
- «Run вместе с batch CI: имя `windows-full`, та же команда dispatch с `$ref` = `main`, тот же job и шаг.»

## Круг 1 ревью (Mac)

Решения Mac: A — skill нейтральный по ADR-0074, шаблон в `plugin-neutral.test.sh`; B —
`src/main/index.ts` вне списка, четыре файла в список. Исправления: 1 — предел 45 минут; 2 —
отдельный исход «упёрся в предел» (без отметки и без dispatch), `failure` только при упавшем шаге
test-ов; 3 — искать run повторно, никогда не повторять dispatch, самый новый run на `headSha` с
job-ом, который не `skipped`; 4 — run на main рядом с batch CI, id в CI-файле, без второго dispatch при
возобновлении, строка в журнале и отчёте; 5 — test закрепляет каждый пункт `PC_ONLY` и вложенные
пути, мутанты красные; 6 — git в test-е без системного и глобального конфига и `GIT_*`; 7 — убрана
повторная строка «Не проверено» на английском.

Проверки на ПК (идёт cod.exe: только лёгкие прогоны). Первый круг: `windows-tests-workflow.test.ts`
до правки workflow — 7 упало, 65 прошло (красный первым); три прогона двух contract-файлов и
`test/unit/no-rmsync.test.ts` — 125 из 125, код 0; `ci-workflow.test.ts`, `pnpm lint`,
`pnpm typecheck`, gate fast — код 0. Круг 1: три прогона `windows-tests-workflow.test.ts`,
`windows-verdict-scope.test.ts` и `no-rmsync.test.ts` — 153 из 153, код 0 каждый;
`plugin-neutral` (31 из 31), `epic-wave-ship-ticket` (336), `review-depth` (105), `max-review` (80),
`agents-text` (202) — код 0; `pnpm lint`, `pnpm typecheck` — код 0; gate fast — код 0,
`[gate] green (fast)`. `test/e2e` не тронут, `test/unit/e2e-*.test.ts` не нужны.

## Круг 2 ревью (Mac, high)

Ветка запушена как PR #784: коммит workflow от Mac `53e7ee59` и merge origin/main `d52922f2`. Правки
этого круга — новыми коммитами поверх, `.github/workflows/` не тронут.

- MED 1 — dispatch на head PR больше не повторяется. Перед dispatch skill смотрит отметку
  `check/<name>` на `$sha` и run-ы на этом `headSha`, у которых названный job не `skipped`. Есть run —
  ждать его. Есть только `pending` без run-а — не проверено, без dispatch. Нет ни того, ни другого —
  один dispatch. Правило общее, plugin-neutral зелёный.
- MED 2 — Browser считается кодом окон (решение Mac, ADR-0071): в `PC_ONLY` добавлены
  `src/main/browser/**`, `src/main/ipc/browser.ts`, `src/renderer/browser/**`, `src/shared/browser/**`.
  Все есть в `git ls-files` (9, 1, 5 и 3 файла, вложенных папок нет). Новый contract-случай: diff
  только Browser даёт `pc` и все четыре пути. Проверка истории из первого раздела писалась до этого:
  #741 теперь даёт `pc` и по `src/main/browser/*`, а не только по `test/e2e/browser-sleep.spec.ts`.
- LOW 3 — в группу «правила самого run-а» добавлены `test/setup-contract.ts`, `test/setup-dom.ts`,
  `test/windows-runner.ts`.
- LOW 4 — job не прочитать из `gh run list`: для каждого кандидата skill даёт команду
  `gh run view <id> --json jobs --jq '[.jobs[] | select(.name == "<job>") | .conclusion]'`.
- LOW 5 — блок run-а на main перед dispatch сверяет вершину main (`git fetch`, `rev-parse`) с
  `ci_run.commit`. Если они разные — `EXTRA_RUN=main-moved`, dispatch нет, сначала снова `wave-gate ci`.
  Проверено руками с временным origin: dispatch; `recorded`; `main-moved` без dispatch; новый dispatch
  после новой записи. Ровно два вызова stand-in-а.
- LOW 6 — команда dispatch сама вернула не 0 (например, 422: у workflow ветки нет такого input-а):
  без отметки, без повтора, причина — в отчёте. Для run-а на main это `EXTRA_RUN=dispatch-failed`,
  тоже без повтора.

Проверки круга 2 (идёт cod.exe, shell-test-ы по одному): два contract-файла — 146 из 146, код 0;
`plugin-neutral` 31, `epic-wave-ship-ticket` 336, `skill-blocks` 100, `decision-log` 125, `silent-mode` 89,
`agents-text` 202, `review-depth` 105, `max-review` 80 — код 0 каждый; `pnpm lint`, `pnpm typecheck` — код 0.

## Круг 3 ревью (Mac)

- MED — файлы Browser вне четырёх папок добавлены точными путями, без шаблона (шаблон по имени поймал бы `FolderBrowser.tsx`): `src/renderer/canvas/overlays/BrowserLayer.tsx`, `src/renderer/canvas/overlays/browser-pages.ts`, `src/renderer/canvas/nodes/BrowserNode.tsx`, `src/renderer/canvas/nodes/BrowserNode.css`, `src/renderer/canvas/nodes/browser-frame.ts`, `src/shared/ipc/browser.ts`, `src/main/mcp/browser-server.ts`. Все семь есть в `git ls-files`. Новые случаи: только `BrowserLayer.tsx` — `pc`; `src/renderer/projects/FolderBrowser.tsx` и `src/renderer/settings/BrowserSection.tsx` — `runner`.
- LOW — `[]` (job-ы ещё не показаны) у run-а со `status` не `completed` теперь считается run-ом этой проверки; `[]` у `completed` run-а (`startup_failure`) — нет.
- LOW — отметка `pending`, которую никакой run не закроет, снимается новым push в PR или `gh run rerun <id>` от Orchestrator-а после исправления причины; в отчёте владельцу — какой run и почему.
- Проверки круга 3: два contract-файла — 155 из 155, `plugin-neutral` 31, `epic-wave-ship-ticket` 336, `pnpm lint`, `pnpm typecheck` — код 0; gate fast — код 0.
