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
