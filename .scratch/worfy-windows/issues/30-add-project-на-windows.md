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

—
