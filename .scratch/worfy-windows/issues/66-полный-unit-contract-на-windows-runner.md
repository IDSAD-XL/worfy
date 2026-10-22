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

Ветка `worfy-windows/66` от main `0437d084`, два коммита: первый — скрипт, test-ы, текст Harness и
этот Итог; второй, последний, — только `.github/workflows/windows-tests.yml` (токен ПК не пушит
`.github/workflows/*`, патч этого коммита — `C:/Users/Alexey/worfy-wt/pr66-workflow.patch`, его пушит
Mac). PR не открыт, push не делался.

**Что сделано.**

- `windows-tests.yml`: input `mode` — `type: choice`, `files` (по умолчанию) и `full`, `required: true`;
  input `files` стал `required: false` (иначе dispatch `-f mode=full` без списка GitHub отклоняет);
  пустой список в режиме `files` по-прежнему отказывает `scripts/windows-test-list.mjs`. Два job-а:
  `listed-tests` (`if: inputs.mode == 'files'`, шаги и 10 минут — без изменений) и `full-suite`
  (`if: inputs.mode == 'full'`, `windows-latest`, без matrix, 30 минут). Шаги `full-suite`: отказ от
  списка (первым, до checkout: непустой `files` — `::error::` и код 1; вход через `env`), checkout,
  setup-node, corepack, setup-node с кэшем pnpm, `pnpm install --frozen-lockfile`, `pnpm test`.
  Комментарий в начале описывает оба режима, кто запускает, цену и что run не заменяет.
  `scripts/windows-test-list.mjs` не менялся: отказ списка в режиме `full` — шаг самого job-а.
- **Предел 30 минут — временный.** Окончательный — замер первого run-а `full` на main × 1,5, с
  округлением вверх до 5 минут (в workflow — комментарий `shortcut:` с этим условием). Замер ещё не
  сделан: run запускает Mac после открытия PR. Риск: `test/contract/harness-scripts.test.ts` идёт
  на ПК около 26 минут (`scripts/windows-test-list.mjs`, `RUNS_ON_THE_PC`), и вместе с install run
  может упереться в 30 минут — тогда первый run не даёт замера, и предел для второго run-а нужно
  поднять (например, до 45) отдельной правкой.
- `scripts/windows-verdict-scope.mjs <base> <head>`: `git diff --name-only --no-renames -z
  <base>...<head>` (переименование — обе стороны), сверка со списком `PC_ONLY`; совпадение — `pc` и
  пути, код 1; нет — `runner`, код 0; пустой diff — `runner`; неверные аргументы или ошибка git —
  код 2, без вердикта. `**/` — любое число папок, в том числе ноль; `*` — без `/`.
- `harness/skills/epic-wave/SKILL.md`, раздел 4, «Checks before merge»: новый пункт — скрипт на
  свежем checkout main (не ветки PR), dispatch `gh workflow run windows-tests.yml --ref <branch> -f
  mode=full`, поиск run-а с `headSha` = head PR, чтение `conclusion` job-а `full-suite` (run режима
  `files` на том же коммите тоже `success`, но с пропущенным `full-suite`), отметки `success` /
  `failure`, `pc` — gate full на ПК, другой код — ждать; main — dispatch режима `full` сразу после
  `wave-gate ci`, красный run — как красный batch CI run.

**Список путей скрипта сверен с `git ls-files` на `0437d084`.** Все пути начального списка есть в
дереве. Добавлено (ошибка в сторону `pc` стоит лишнего gate full, в сторону `runner` — пропущенной
регрессии):

- Terminal: `src/shared/ipc/terminal*.ts` (пара к `src/main/ipc/terminal*.ts`),
  `src/shared/terminal/**` (ответы курсора терминала), `src/renderer/canvas/ReadOnlyTerminal.tsx`
  (xterm-вид вне `nodes/`);
- окна, меню, уведомления: `src/main/window-show.ts`, `src/shared/window/**` (границы окна),
  `src/main/ipc/menu.ts`, `src/main/ipc/notify.ts`;
- e2e: `test/acceptance/**` (Playwright-приёмка, на runner-е не идёт);
- упаковка и установка: `pnpm-workspace.yaml` (`allowBuilds` для node-pty и electron, `engineStrict`),
  `scripts/build-version.ts`, `scripts/dev-bundle.ts` (их читает `electron.vite.config.ts`);
- правила самого run-а — PR, который их меняет, не должен получать вердикт от своего же run-а
  (`--ref <ветка>` берёт workflow и конфиг из ветки): `.github/workflows/windows-tests.yml`,
  `scripts/windows-verdict-scope.mjs`, `scripts/vitest-electron.mjs`, `vitest.config.ts`. Этот PR
  поэтому сам — `pc`.

Не добавлено: `src/shared/terminal-ai/**` и `src/renderer/settings/*TerminalAi*` (чистая логика и UI
настроек, их полностью гоняют unit-test-ы), `src/main/autopilot/power.ts` (`powerSaveBlocker`, не
окна/меню/уведомления), `src/main/workflow/waits-notify.ts` (без Electron API),
`src/renderer/settings/settings-window.ts` и `src/renderer/shortcuts/shortcuts-window.ts` (модули
renderer-а, окон не создают), `test/unit/e2e-*.test.ts` (unit-test-ы, на runner-е идут). Удалено
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

Из 60 последних PR main 32 — `runner`, 28 — `pc` (по одному прогону скрипта на коммит).

**Мутанты** (каждый — правка файла в worktree, прогон одного test-файла, восстановление из копии в
памяти; после прогона sha1 обоих файлов совпал с исходным):

| Мутант | Красный test |
| --- | --- |
| лишний триггер `push` | starts by hand only |
| matrix в `full-suite` | has two jobs … no matrix |
| нет `if` у `full-suite` / у `listed-tests`; `full-suite` с `if` на `files` | has two jobs … |
| `timeout-minutes` 45 у `full-suite`; 30 у `listed-tests` | stops the job … after 10 … after 30 |
| `pnpm test` в режиме `files` | mode files: steps, run step, never the whole suite (3) |
| `pnpm test:e2e` в `run` режима `full`; отдельный шаг e2e | mode full: steps; no e2e (2) |
| лишний шаг в режиме `full` / в режиме `files` | mode full: steps / mode files: steps (3) |
| шаг отказа удалён; отказ всегда пропускает | env expressions, corepack, steps (3) / steps |
| `default: full`; `files` `required: true`; `mode` — `type: string` | takes two inputs |
| `contents: write` | may only read the repository |
| скрипт: без `--no-renames` | rename out of the list is pc |
| скрипт: `..` вместо `...` | a later change on the base does not count |
| скрипт: группа `test/e2e/**` убрана | e2e helper in a subfolder; every matching file (2) |
| скрипт: `**/` требует папку | a Terminal helper right under test/ |
| скрипт: `pc` с кодом 0 | 29 test-ов |
| скрипт: ошибка git читается как `runner` | no verdict when git cannot compute the diff |

Мутант «`**/` требует папку» сначала выжил; добавлен случай `test/terminal-helper.ts`, после — красный.

**Проверки на ПК** (идёт cod.exe: только лёгкие прогоны, без полного `pnpm test`):
`test/contract/windows-tests-workflow.test.ts` до правки workflow — 7 упало, 65 прошло (красный, как
требует «Тесты»); после — три прогона `windows-tests-workflow`, `windows-verdict-scope` и
`test/unit/no-rmsync.test.ts` — 125 из 125, код 0 каждый; `test/contract/ci-workflow.test.ts` — код 0;
`pnpm lint` — код 0; `pnpm typecheck` — код 0; Harness: `plugin-neutral`, `epic-wave-ship-ticket`,
`review-depth`, `max-review`, `agents-text` (`.test.sh`) — код 0.

**Не проверено.**

- Пункты «Готово, когда» «Один run режима `full` на main» и «Один run режима `files` после
  правки» — not verified: the run is dispatched by the Mac after the PR opens.
  Run режима `full` на main и run режима `files` после правки: их запускает Mac после открытия PR
  (с согласия владельца, минута Windows — $0.010). Ссылки, минуты (install и `pnpm test` отдельно),
  цена и окончательный предел — после этих run-ов.
- `pnpm test` на Mac — код 0 (пункт «Готово, когда» для Mac).
- Остальные shell-test-ы Harness, которые режут блоки `epic-wave/SKILL.md` (`skill-blocks`,
  `wave-gate`, `decision-log`, `silent-mode`): новый текст — без bash-блока, якоря их блоков не
  тронуты, но на ПК они не запускались (весь набор — около 26 минут).

**После мержа — шаг Orchestrator-а (Profile на машине, вне PR).** `workflow.ci_batch_run` не
менять: `wave-gate ci` ищет run по имени workflow после `gh workflow run`, и вторая команда в той же
строке его бы сбила; dispatch режима `full` на main описан в skill отдельной командой. В `rules.md`
обеих машин абзац «Исключения из правила о платных прогонах» заменить на два режима: «`files` — от 1
до 12 файлов из `test/unit/` и `test/contract/`, 10 минут; `full` — весь `pnpm test`, предел по
замеру; `full` Orchestrator Session на Mac запускает на head платформенного PR, для которого
`node scripts/windows-verdict-scope.mjs origin/main <head>` печатает `runner`, и на `main` вместе с
batch CI; `pc` — gate full на ПК (ADR-0071)».
