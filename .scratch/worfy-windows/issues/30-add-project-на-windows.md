# 30 — «Add project» на Windows не проходит: worfy запускает `bin/project-connect` как файл

Type: task
Status: claimed 2026-10-18T05:46Z
Branch: worfy-windows/30-add-project
Blocked by: 05, 13
Source: ручная проверка владельца на Windows-ПК 2026-10-13 (установленный worfy из `dist\`, сборка с main после PR #257); разбор кода на Mac в тот же день

## Что происходит

- **Форма «Add project» на Windows не проходит ни для какой папки.** Владелец выбрал папку
  `C:\Users\Alexey\Desktop\Slop\Grim Dawn AI`; шаг 4 «Draft» ответил:
  `bin/project-connect could not be run: spawn C:\Users\Alexey\.claude\worfy-harness\plugin\bin\project-connect ENOENT`.
- **Причина.** `bin/project-connect` — скрипт на Node с первой строкой `#!/usr/bin/env node`. worfy
  запускает сам файл: `spawn(join(harness.binDir, 'project-connect'), …)`
  (`src/main/ipc/projects.ts:69`). macOS по первой строке находит Node. Windows эту строку не
  читает и файл без расширения не запускает — отсюда `ENOENT`. Есть ли файл на диске, по этой
  ошибке не понять.
- **Через тот же скрипт идут три шага формы:** `--facts` перед черновиком, `--schema-only` при
  проверке и запись Profile на шаге «Review» (`src/main/projects/connect.ts:12-23`).
- **Шаг 1 «Folder» на Windows отвечает неверно и молча.** `profileKnows`
  (`src/main/projects/connect.ts:197`) читает сбой запуска `bin/profile` как «Harness папку не
  знает». Папка, которую Harness уже знает, выглядит новой и идёт в форму, вместо того чтобы сразу
  попасть в список.
- **Ни один Ticket этого Epic-а вызов не покрывает.** Ticket 05 переводит на запуск через `node`
  два вызова: `bin/profile` (`src/main/workflow/profile.ts:78`) и `bin/epic-status`
  (`src/main/workflow/reader.ts:107`). `bin/ticket` идёт через тот же запуск, что `bin/profile`, и
  исправится вместе с ним. `bin/project-connect` и `bin/qmd-collections`
  (`src/main/harness/qmd.ts:382`) в Ticket-е 05 не названы: Ticket описывал скрипты до того, как в E3
  появилась форма «Add project».
- **Следствие для ручных проверок.** Владелец не смог проверить, что Session отвечает, ни в
  установленном worfy, ни в Stable copy (ручные пункты Ticket-а 12): без Project-а Session не
  начать.
- **Обходной путь сегодня** — записать Project в `%APPDATA%\worfy\projects.json` руками, как в
  Ticket-е 08 («Итог»): `{"projects":[{"id","name","path"}],"activeId"}`. `path` — вывод
  `git rev-parse --show-toplevel`, с прямыми слэшами; `id` — `<имя папки>-<первые 8 hex-цифр
  sha256 от path>` (`src/main/projects/store.ts:69`). Проверено на ПК 2026-10-13: установленный
  worfy показал записанный так Project, и Session в нём ответила (Ticket 12, «Готово, когда»).

### Ещё два наблюдения владельца с того же запуска

- **Экран первого запуска советует `brew install jq`.** Подсказка одна для всех систем
  (`src/main/first-run/checks.ts:243`). Её правит [Ticket 13](13-первый-запуск-на-windows.md); по
  решению владельца от 2026-10-09 `jq` на Windows не требуется.
- **Установка qmd: `npm install -g @tobilu/qmd@2.8.3 exited null: spawn npm ENOENT`.** `npm` на
  Windows — файл `npm.cmd`, а worfy запускает его без оболочки (`src/main/harness/qmd.ts:183`,
  `:320`; `src/main/first-run/actions.ts:81`). Что делать с qmd на Windows, решает
  [Ticket 15](15-qmd-на-windows-или-grep.md): либо установка работает, либо действия установки на
  Windows нет. Вызов там назван.

## Что делаем

1. **`bin/project-connect` запускается через `node`** — тем же способом, который Ticket 05 выберет
   для `bin/profile`: один общий запуск скрипта Harness, а не свой в каждом месте.
2. **`bin/qmd-collections`** (`qmd.ts:382`) идёт через него же, если Ticket 15 оставит этот вызов.
3. **Сбой запуска скрипта не читается как ответ.** `profileKnows` различает «скрипт ответил, что
   папку не знает» и «скрипт не запустился»; во втором случае форма показывает ошибку.
4. **Форма «Add project» проходит на Windows целиком:** папка, режим, Harness, черновик, запись.
   Черновик пишет Session со skill-ом `connect-project` — для этого Harness должен стоять на
   машине (Ticket 13).

## Готово, когда

- [ ] На Windows-ПК «Add project» для новой папки доходит до «Review» и пишет Profile; Project
      появляется в списке.
- [ ] Папка, которую Harness уже знает, на шаге «Folder» сразу попадает в список.
- [ ] Когда скрипт Harness не запустился, шаг «Folder» показывает ошибку, а не «новая папка».
- [ ] Test на всех системах: запуск `bin/project-connect` идёт через `node` с путём скрипта первым
      аргументом; сбой запуска `bin/profile` в `profileKnows` — ошибка, не `false`.
- [x] Ручные пункты Ticket-а 12 про Session пройдены и отмечены там: 2026-10-13, через Project,
      записанный в `projects.json` руками.
- [ ] `gate full` зелёный на Mac.

## Тесты

- Contract: `connectScript` с подменённым `spawn` — команда `node`, первый аргумент — путь скрипта.
- Unit: `profileKnows` при ошибке запуска.
- На ПК: форма целиком, руками.

## Где в коде

- `src/main/ipc/projects.ts:64-71` — `connectScript`.
- `src/main/projects/connect.ts` — шаги формы, `profileKnows`.
- `src/main/workflow/profile.ts:78`, `src/main/workflow/reader.ts:107` — вызовы Ticket-а 05.
- `src/main/harness/qmd.ts:183`, `:320`, `:382`; `src/main/first-run/actions.ts:81`.

## Вне скоупа

- Подсказки экрана первого запуска — Ticket 13.
- Работает ли qmd на Windows — Ticket 15.
- `bin/epic-status` на bash — Ticket 05.

## Риски

- **Какой `node` запускать.** Ticket 05 выбирает `node` из `PATH` окружения агента. Ticket 06
  запускает соседние скрипты через `process.execPath`. Собранное приложение может запустить скрипт
  и собой (`process.execPath` с `ELECTRON_RUN_AS_NODE`), тогда Node на машине не нужен. Выбор — один
  на все вызовы worfy, в Ticket-е 05.

## Итог

Session на Windows-ПК, 2026-10-18. Windows 11 Pro 10.0.26200, Git Bash; test-ы через `node scripts/vitest-electron.mjs` (Node из Electron), как в CI. Ветка `worfy-windows/30-add-project` от main `ee6c253`. Пункты 1–3 «Что делаем». **На macOS и Linux с ПК ничего не запускалось.**

- **Общий запуск со stdin — `runHarnessScript`** (`src/main/workflow/profile.ts`). Команду даёт тот же `harnessScriptCommand` Ticket-а 05: `node <скрипт> …`, node из PATH окружения скрипта; нет скрипта, нет node, на Windows не-Node скрипт старого Harness — `HarnessScriptStartError` до запуска. Сверх `harnessScriptRunner`: stdin, свой timeout с SIGKILL (код `null`, signal не ставится — как в `ProfileRun`), подменяемый `spawn` для test-ов.
- **`bin/project-connect`.** `connectScriptRunner` (`src/main/projects/connect.ts`) — `connect` из `ConnectDeps` по умолчанию: Harness, `scriptEnv` (HARNESS_HOME), `runHarnessScript`. `connectScript` в `src/main/ipc/projects.ts` — теперь одна строка вызова, свой `spawn` убран. Через него идут все три шага формы: `--facts`, `--schema-only`/`--check`, запись.
- **`bin/qmd-collections`.** `setupCollections` (`src/main/harness/qmd.ts`) идёт через `runHarnessScript`; сбой запуска — `code: null` и причина в `output` (как раньше у ENOENT). Вызовы `npm` (`qmd.ts`, `first-run/actions.ts`) не тронуты — Ticket 15.
- **`profileKnows`** различает ответ и его отсутствие. Бросает ошибку, когда `bin/profile` не запустился (reject runner-а: `HarnessScriptStartError`, ENOENT), когда система не нашла интерпретатор (exit code 127/126) и когда процесс убит (код `null`: timeout или signal). Шаг «Folder» (`ProjectConnector.inspect`) отдаёт тогда `rejected` с причиной `The Harness could not tell whether it knows <root>: …` — окно показывает её так же, как другие ошибки шага (`ProjectsSection.tsx`, `fail(answer.reason)`), UI не менялся. Шаг записи после `bin/project-connect` отвечает своей причиной (`…could not be asked about…`), а не «Harness не находит Profile».
- **Отклонение от буквы пункта 3:** любой другой exit code, кроме 0, остаётся ответом «не знает», не ошибкой. Причина: свежий Harness без `gate/config.json` отвечает exit 1 на любую папку (`gate-resolve.mjs` → 4 → `profile` → 1), а `bin/project-connect` создаёт реестр при первой записи. Ошибка на exit 1 сломала бы первый «Add project» на новой машине.
- **Test-ы.**
  - `test/unit/profile-knows.test.ts` (новый, 14): сбой запуска, timeout, signal, 127/126 — reject; exit 3 и exit 1 — `false`; exit 0 и `_resolved.workspace` — как раньше.
  - `test/contract/projects-connect.test.ts` (+5): `connectScriptRunner` с подменённым `spawn` — команда `NODE` из PATH окружения, первый аргумент — путь скрипта, затем аргументы; stdin и HARNESS_HOME доходят до stand-in-а без бита исполнения. Ещё: настоящий `harness/bin/project-connect --schema-only` через него; нет скрипта/нет node — `HarnessScriptStartError`, `spawn` не вызван; сбой запуска — причина шага «Draft»; шаг «Folder» при сбое `bin/profile` — `rejected`, draft Session не стартует.
  - `test/contract/harness-qmd.test.ts` (+2): `qmd-collections` запускается как `node <скрипт> <project>`; без node — `code: null` и `node not found in PATH: …`.
- **Как упали новые test-ы** (сначала test-ы, код временно в поведении main: запуск самого файла, `catch → false` в `profileKnows`, `qmd.ts` из `ee6c253`): 16 новых test-ов из 21 красные; 5 зелёных — случаи «скрипт ответил», где поведение и не менялось. `profileKnows`: `promise resolved "false" instead of rejecting` (9 случаев); `inspect`: `{ status: 'new' }` вместо `rejected`. `connectScriptRunner`: `Error: spawn …\harness-bin\project-connect ENOENT` — Windows не запускает файл с `#!` (тот же текст, что у владельца 2026-10-13); у настоящего `harness/bin/project-connect` — тоже ENOENT. `qmd-collections`: `{ code: null }` вместо `{ code: 0 }`, и `expected [] to deeply equal [ { … } ]` — `spawn` с node не вызывался.

| Прогон на ПК | Exit | Итог |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | — |
| vitest: `profile-knows`, `projects-connect`, `harness-qmd`, `e2e-no-spawn-on-load` (ветка) | 1 | 15 упало, 102 прошли из 117; все новые зелёные, `e2e-no-spawn-on-load` зелёный |
| то же: `projects-connect` + `harness-qmd` на main `ee6c253` | 1 | 15 упало, 33 прошли из 48 — те же 15 имён |
| vitest: остальные файлы, где есть изменённые модули (`first-run-checks`, `harness-script-command`, `harness-script-wiring`, `link-access`, `projects-hold`, `projects`, `workflow-profile`, `workflow-stages`, `agent-options`), ветка | 1 | 36 упало, 229 прошли, 26 пропущено |
| те же 9 файлов на main `ee6c253` | 1 | 36 упало, 229 прошли, 26 пропущено — те же имена |
| `pnpm lint` | 0 | — |
| `pnpm typecheck` | 0 | — |

- Новых падений по именам нет. Старые падения на ПК — Windows-специфика test-ов, не этого Ticket-а: stub-ы `#!/bin/sh` (`harness-qmd`: node/npm/qmd stand-in-ы не запускаются; старый случай `setupCollections` со stub-ом `#!/bin/sh` на Windows теперь падает с `NOT_NODE` вместо ENOENT — то же имя), пути `C:\` против `/` (`projects-connect` draft/write, `projects`, `first-run-checks`).
- `gate` не запускался: Harness profile на этом ПК нет намеренно, и gate пишет своё состояние в `~/.claude`, куда этой Session писать нельзя.

**Ждёт владельца:** пункты 1–3 «Готово, когда» на ПК — форма целиком руками: новая папка до «Review» и записи, знакомая папка сразу в список, ошибка шага «Folder» при сбое скрипта. Для этого Harness должен стоять на машине (Ticket 13), а эта Session в профиль владельца не пишет. Ещё — `gate full` на Mac. e2e (`projects-connect.spec.ts`) на ПК не запускались: окна приложения не открывались.
